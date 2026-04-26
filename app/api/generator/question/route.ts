import { NextRequest, NextResponse } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';

const SYSTEM_PROMPT = `你是一个题目生成专家。请根据用户提供的文本和要求，生成题目。

规则：
1. 严格按照 JSON 格式输出，不要包含代码块标记（\`\`\`json），不要输出任何其他文字
2. 选择题 question_type 为 "choice"，options 为字符串数组，answer 为选项字母
3. 填空题 question_type 为 "fill_blank"，answer 为正确答案文本
4. 简答题 question_type 为 "short_answer"，answer 为参考答案
5. 所有题目必须包含 explanation（答案解析）

输出格式示例：
{"question_text":"题目内容","question_type":"choice","options":["A. 选项1","B. 选项2","C. 选项3","D. 选项4"],"answer":"A","explanation":"解析..."}`;

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);
    if (!apiKey) {
      return NextResponse.json({ error: 'AI 服务未配置，请在设置中填写 API Key' }, { status: 500 });
    }

    const { source_text, requirement, question_type } = await req.json();
    if (!source_text?.trim() || !requirement?.trim()) {
      return NextResponse.json({ error: '请提供文本内容和出题要求' }, { status: 400 });
    }

    const userPrompt = `文本内容：
${source_text}

出题要求：${requirement}
${question_type ? `题目类型：${question_type}` : ''}`;

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
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'AI 服务暂时不可用' }, { status: 502 });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = rawContent.trim();
    jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');

    try {
      const questionData = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, question: questionData });
    } catch {
      // Try to extract JSON object
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const questionData = JSON.parse(match[0]);
          return NextResponse.json({ success: true, question: questionData });
        } catch {
          return NextResponse.json({ error: 'AI 返回格式异常，请重试', raw: rawContent }, { status: 500 });
        }
      }
      return NextResponse.json({ error: 'AI 返回格式异常，请重试', raw: rawContent }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '出题失败' }, { status: 500 });
  }
}
