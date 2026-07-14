import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig } from '@/lib/user-settings';

function outlineToMarkdown(node: any, level = 1): string {
  const prefix = '#'.repeat(Math.min(level, 6));
  let md = `${prefix} ${node.title}\n\n`;
  if (node.children) for (const child of node.children) md += outlineToMarkdown(child, level + 1);
  return md;
}

const SYSTEM_PROMPT = `你是一个文档分析专家。请根据文档内容生成结构化大纲。

规则：
1. 严格按 JSON 格式输出，不要包含代码块标记
2. 大纲以树形结构表示：每个节点有 title（标题）和 children（子节点数组）
3. 叶子节点不需要 children 字段
4. 最多 3 层深度
5. summary 字段用一句话概括文档主题

输出格式：
{
  "summary": "文档主题概括",
  "outline": {
    "title": "根标题",
    "children": [
      {
        "title": "一级节点",
        "children": [
          { "title": "二级节点" }
        ]
      }
    ]
  }
}`;

export async function POST(req: NextRequest) {
  try {
    console.log('Generate outline request received');
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);

    console.log('Outline API config:', { apiKey: apiKey ? '***' : 'missing', endpoint, defaultModel });

    if (!apiKey) {
      console.error('API Key missing');
      return NextResponse.json({ error: 'AI 服务未配置，请检查 API Key 设置' }, { status: 500 });
    }

    if (!endpoint) {
      console.error('API endpoint missing');
      return NextResponse.json({ error: 'API 端点未配置，请联系管理员' }, { status: 500 });
    }

    const { content_md, document_id } = await req.json();
    if (!content_md?.trim()) {
      console.error('Content missing');
      return NextResponse.json({ error: '请提供文档内容' }, { status: 400 });
    }

    // Truncate content to avoid token limits
    const truncated = content_md.slice(0, 8000);
    console.log('Calling AI API for outline generation');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: defaultModel || 'deepseek-ai/DeepSeek-V4-Flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `请分析以下文档并生成结构化大纲：\n\n${truncated}` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    console.log('Outline API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Outline API error:', { status: response.status, errorText });
      return NextResponse.json({ error: `AI 服务暂不可用 (${response.status})` }, { status: 502 });
    }

    const data = await response.json();
    console.log('Outline API response data:', JSON.stringify(data).substring(0, 200) + '...');

    const rawContent = data.choices?.[0]?.message?.content || data?.message?.content || '';
    let jsonStr = rawContent.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');

    try {
      const outline = JSON.parse(jsonStr);

      // Save outline to database if document_id provided
      if (document_id) {
        try {
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: `Bearer ${token}` } } }
          );
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            // Convert outline tree to markdown for storage
            const outlineMd = outlineToMarkdown(outline.outline || outline);
            await supabase
              .from('kb_documents')
              .update({ outline_md: outlineMd, outline_summary: outline.summary || '' })
              .eq('id', document_id)
              .eq('user_id', user.id);
          }
        } catch (e) {
          console.error('Failed to save outline:', e);
        }
      }

      return NextResponse.json({ success: true, ...outline });
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return NextResponse.json({ success: true, ...JSON.parse(match[0]) });
        } catch {
          // ignore — will return error below
        }
      }
      return NextResponse.json({ error: 'AI 返回格式异常', raw: rawContent.substring(0, 500) }, { status: 500 });
    }
  } catch (e: any) {
    console.error('Generate outline error:', e);
    return NextResponse.json({ error: e.message || '生成失败' }, { status: 500 });
  }
}
