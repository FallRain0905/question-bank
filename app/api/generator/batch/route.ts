import { NextRequest, NextResponse } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';

const SYSTEM_PROMPT = `你是一个题目生成专家。根据文本和要求批量生成题目。

规则：
1. 严格按 JSON 格式输出，不要包含代码块标记
2. 生成指定数量的题目，放在 questions 数组中
3. 每道题包含 question_text, question_type, options(选择题), answer, explanation

输出格式：
[
  {
    "question_text": "题目1",
    "question_type": "choice",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "answer": "A",
    "explanation": "解析"
  }
]`;

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);
    if (!apiKey) return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });

    const { source_text, requirement, count = 3, question_type = 'choice' } = await req.json();
    if (!source_text?.trim() || !requirement?.trim()) {
      return NextResponse.json({ error: '请提供文本和要求' }, { status: 400 });
    }

    const userPrompt = `文本内容：
${source_text.slice(0, 6000)}

出题要求：${requirement}
题目类型：${question_type}
生成数量：${count} 道`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: defaultModel || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'AI 服务暂不可用' }, { status: 502 });

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    let jsonStr = rawContent.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');

    const parse = (s: string) => {
      try { return JSON.parse(s); } catch {
        const m = s.match(/\[[\s\S]*\]/);
        if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
        return null;
      }
    };

    const questions = parse(jsonStr);
    if (!questions || !Array.isArray(questions)) {
      return NextResponse.json({ error: 'AI 返回格式异常', raw: rawContent }, { status: 500 });
    }

    return NextResponse.json({ success: true, questions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '生成失败' }, { status: 500 });
  }
}
