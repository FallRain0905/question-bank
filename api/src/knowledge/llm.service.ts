import { Injectable, Logger } from '@nestjs/common';
import { resolveLlmConfig } from '../config/ai-config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly config = resolveLlmConfig();

  get isConfigured(): boolean {
    return this.config !== null;
  }

  get model(): string | null {
    return this.config?.model ?? null;
  }

  async chat(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}) {
    if (!this.config) {
      throw new Error('LLM 未配置：请设置 LLM_API_KEY、DEEPSEEK_API_KEY 或 SILICONFLOW_API_KEY。');
    }

    let response: Response;
    try {
      response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 1200,
          stream: false,
        }),
      });
    } catch (error) {
      throw new Error(
        `LLM 接口连接失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }

    const raw = await response.text();
    let payload: ChatApiResponse = {};
    try {
      payload = raw ? (JSON.parse(raw) as ChatApiResponse) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const detail =
        typeof payload.error === 'string' ? payload.error : payload.error?.message;
      this.logger.warn(`LLM 请求失败：${response.status} ${detail || raw.slice(0, 200)}`);
      throw new Error(`LLM 接口返回 ${response.status}：${detail || raw.slice(0, 300)}`);
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('LLM 返回了空内容');
    }
    return content;
  }
}
