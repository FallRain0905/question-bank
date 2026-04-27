import { NextRequest, NextResponse } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';

const SCENARIOS: Record<string, { role: string; context: string }> = {
  travel: {
    role: 'airport staff, hotel receptionist, or local resident in a travel setting',
    context: 'The user is a traveler. You are helping them navigate airports, hotels, restaurants, and tourist attractions. Use practical travel vocabulary.',
  },
  business: {
    role: 'business colleague, client, or interviewer in a professional setting',
    context: 'You are in a professional business environment. Use formal but friendly language. Topics include meetings, presentations, emails, and networking.',
  },
  daily: {
    role: 'friendly neighbor, friend, or acquaintance',
    context: 'Casual everyday conversation. Topics include weather, hobbies, shopping, food, weekend plans. Keep it relaxed and natural.',
  },
  academic: {
    role: 'classmate, professor, or study partner in an academic setting',
    context: 'Academic environment. Topics include lectures, assignments, research, campus life. Use academic vocabulary appropriately.',
  },
  free: {
    role: 'friendly conversation partner',
    context: 'Free conversation on any topic. Keep the conversation engaging and natural.',
  },
};

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);
  if (!apiKey) return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });

  const { messages, scenario = 'free' } = await req.json();
  const scene = SCENARIOS[scenario] || SCENARIOS.free;

  const systemPrompt = `You are a ${scene.role}. ${scene.context}

Important rules:
- ONLY speak in English. Never use any other language.
- Keep your responses natural and conversational (2-4 sentences).
- If the user makes a grammar mistake, subtly model the correct form in your reply. Do NOT explicitly point out errors unless asked.
- Match the user's English level. If they use simple language, respond simply.
- Stay in character throughout the conversation.
- Ask follow-up questions to keep the conversation going.`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: defaultModel || 'deepseek-v4-flash',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.8,
        max_tokens: 500,
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'AI 服务暂不可用' }, { status: 502 });

    const data = await response.json();
    return NextResponse.json({ reply: data.choices?.[0]?.message?.content || '' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
