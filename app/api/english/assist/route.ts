import { NextRequest, NextResponse } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);
  if (!apiKey) return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });

  const { question, conversation, mode } = await req.json();

  const contextStr = conversation?.slice(-8).map((m: any) => `${m.role}: ${m.content}`).join('\n') || '';

  const systemPrompt = mode === 'auto'
    ? `You are watching an English conversation between a student and a conversation partner.

Latest messages:
${contextStr}

Analyze the student's LAST message. Provide ONE suggestion in this exact JSON format (no other text):
{
  "type": "expression" | "grammar" | "none",
  "original": "the student's phrase",
  "suggestion": "a more natural/native way to say it",
  "note": "brief explanation in Chinese (max 15 words)"
}

Rules:
- type "expression": the English is correct but too simple — suggest a more native/natural alternative
- type "grammar": there's a grammar mistake — show the correction
- type "none": the English is already natural and correct, no improvement needed
- Keep suggestions short and practical
- Always return valid JSON, even for "none" type`
    : `You are an English learning assistant helping a student practice. The student may ask in Chinese or English.

Current conversation:
${contextStr}

When the student asks:
1. Word meaning → explain in Chinese with examples
2. How to express something → provide 2-3 natural alternatives
3. Grammar questions → explain briefly and show corrections
4. Be encouraging. Use Chinese for explanations, English for examples.`;

  try {
    // For auto mode, use lower temperature for consistent output
    const isAuto = mode === 'auto';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: defaultModel || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: isAuto ? 'Analyze the student\'s last message and return JSON.' : (question || '') },
        ],
        temperature: isAuto ? 0.3 : 0.5,
        max_tokens: isAuto ? 300 : 600,
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'AI 服务暂不可用' }, { status: 502 });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    if (isAuto) {
      // Parse JSON from auto mode
      try {
        const json = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
        return NextResponse.json({ reply: raw, suggestion: json });
      } catch {
        // If JSON parsing fails, try to extract
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try { return NextResponse.json({ reply: raw, suggestion: JSON.parse(match[0]) }); } catch {}
        }
        return NextResponse.json({ reply: raw, suggestion: { type: 'none', original: '', suggestion: '', note: '' } });
      }
    }

    return NextResponse.json({ reply: raw });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
