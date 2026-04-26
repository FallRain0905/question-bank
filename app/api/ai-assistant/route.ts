import { NextRequest, NextResponse } from 'next/server';
import { getUserLLMConfig } from '@/lib/user-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, history, image, messages, model, temperature = 0.7 } = body;

    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { apiKey, endpoint, defaultModel } = await getUserLLMConfig(token);

    if (!apiKey) {
      return NextResponse.json({
        answer: 'AI 服务尚未配置，请在设置中填写 API Key 或联系管理员。',
        content: 'AI 服务尚未配置，请在设置中填写 API Key 或联系管理员。',
      });
    }

    let apiMessages: any[];
    let selectedModel: string;

    if (messages && Array.isArray(messages)) {
      // 高级模式: 直接使用原始消息格式 (来自 /ai 页面)
      apiMessages = messages.map((m: any) => {
        if (m.image) {
          return {
            role: m.role,
            content: [
              { type: 'image_url', image_url: { url: m.image } },
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ],
          };
        }
        return { role: m.role, content: m.content || '' };
      });
      selectedModel = model || 'qwen-plus';
    } else if (question || image) {
      // 简单模式: question + history + image (来自 FloatingAIButton)
      apiMessages = (history || []).map((m: any) => ({
        role: m.role,
        content: m.content,
      }));

      if (image) {
        apiMessages.push({
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            ...(question ? [{ type: 'text', text: question }] : [{ type: 'text', text: '请描述这张图片中的内容' }]),
          ],
        });
      } else {
        apiMessages.push({
          role: 'user',
          content: question || '',
        });
      }
      selectedModel = image ? 'qwen-vl-max' : (defaultModel || 'qwen-plus');
    } else {
      return NextResponse.json({
        answer: '请输入问题或上传图片',
        content: '请输入问题或上传图片',
      });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          {
            role: 'system',
            content: '你是一个友好的学习助手，专门帮助学生理解题目和知识点。回答要简洁明了，适合学生理解。如果涉及数学公式，请使用 LaTeX 格式。',
          },
          ...apiMessages,
        ],
        temperature,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('千问 API 错误:', errorText);
      return NextResponse.json({
        answer: 'AI 服务暂时不可用，请稍后再试。',
        content: 'AI 服务暂时不可用，请稍后再试。',
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '抱歉，我暂时无法回答这个问题。';
    const responseImage = data.choices?.[0]?.message?.image;

    return NextResponse.json({
      answer: content,
      content: content,
      ...(responseImage ? { image: responseImage } : {}),
    });
  } catch (error: any) {
    console.error('AI Assistant error:', error);
    return NextResponse.json({
      answer: '发生错误，请稍后重试。',
      content: '发生错误，请稍后重试。',
    });
  }
}
