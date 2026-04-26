import { NextRequest, NextResponse } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';

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
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);
    if (!apiKey) return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });

    const { content_md } = await req.json();
    if (!content_md?.trim()) return NextResponse.json({ error: '请提供文档内容' }, { status: 400 });

    // Truncate content to avoid token limits
    const truncated = content_md.slice(0, 8000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: defaultModel || 'qwen-plus',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `请分析以下文档并生成结构化大纲：\n\n${truncated}` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'AI 服务暂不可用' }, { status: 502 });

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    let jsonStr = rawContent.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');

    try {
      const outline = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, ...outline });
    } catch {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return NextResponse.json({ success: true, ...JSON.parse(match[0]) });
        } catch {
          // ignore — will return error below
        }
      }
      return NextResponse.json({ error: 'AI 返回格式异常', raw: rawContent }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '生成失败' }, { status: 500 });
  }
}
