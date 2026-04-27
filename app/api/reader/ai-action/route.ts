import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig } from '@/lib/user-settings';

const SYSTEM_PROMPTS: Record<string, string> = {
  explain: '你是一个学术辅导专家。用户正在阅读一篇文档，选中了以下文本片段。请用简洁、清晰的方式解释这段文本的含义，包括关键概念、术语的解释，以及上下文中的意义。如果涉及专业术语，请给出通俗的解释。回答使用中文。如果涉及数学公式，请使用 LaTeX 格式。',
  translate: '你是专业翻译。请将以下文本翻译为中文（如果是中文则翻译为英文）。保持专业术语的准确性，遇到数学公式请保留 LaTeX 格式。请直接给出翻译结果，不需要额外解释。',
  polish: '你是文字润色专家。请对以下文本进行润色改进，使其表达更流畅、更专业。保持原意不变，改善语句结构和用词。请直接输出润色后的文本，并在其后简要说明修改了哪些地方。',
};

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { action, text, context, document_id } = await req.json();

  if (!action || !text || !document_id) {
    return NextResponse.json({ error: '参数不完整' }, { status: 400 });
  }

  const systemPrompt = SYSTEM_PROMPTS[action] || SYSTEM_PROMPTS.explain;
  const config = await getUserLLMConfig(token);

  if (!config.apiKey) {
    return NextResponse.json({ error: '请先配置 AI API Key' }, { status: 400 });
  }

  const userMessage = context
    ? `文档上下文：\n${context.slice(0, 2000)}\n\n选中文本：\n${text}`
    : text;

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.defaultModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('AI API error:', res.status, errText);
      return NextResponse.json({ error: `AI 服务错误 (${res.status})` }, { status: 500 });
    }

    const data = await res.json();
    const aiResponse = data.choices?.[0]?.message?.content || '无法生成回答';

    // 自动创建批注
    const { data: annotation, error } = await supabase
      .from('document_annotations')
      .insert({
        document_id,
        user_id: user.id,
        action_type: action,
        selected_text: text,
        ai_response: aiResponse,
      })
      .select()
      .single();

    if (error) console.error('Failed to save annotation:', error);

    return NextResponse.json({
      response: aiResponse,
      annotationId: annotation?.id || null,
    });
  } catch (err: any) {
    console.error('AI action error:', err);
    return NextResponse.json({ error: err.message || '请求失败' }, { status: 500 });
  }
}
