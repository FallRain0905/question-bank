import { Injectable, Logger } from '@nestjs/common';
import { resolveEmbeddingConfig, type EmbeddingProvider } from '../config/ai-config';
import { hashEmbedding } from './embedding-hash';

interface EmbeddingApiResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string } | string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly config = resolveEmbeddingConfig();
  private warnedAboutFallback = false;

  get provider(): EmbeddingProvider {
    return this.config.provider;
  }

  get model(): string {
    return this.config.provider === 'local-hash' ? 'local-hash' : this.config.model;
  }

  get dimensions(): number {
    return this.config.dimensions;
  }

  /**
   * @param onBatch optional progress callback: (embeddedSoFar, total)
   */
  async embedTexts(
    texts: string[],
    onBatch?: (done: number, total: number) => Promise<void> | void,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    if (this.config.provider === 'local-hash') {
      if (!this.warnedAboutFallback) {
        this.warnedAboutFallback = true;
        this.logger.warn(
          '未配置嵌入模型 API Key，使用 local-hash 开发回退向量（检索质量有限，仅适合联调）。',
        );
      }
      const vectors = texts.map((text) => hashEmbedding(text, this.config.dimensions));
      await onBatch?.(texts.length, texts.length);
      return vectors;
    }

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += this.config.batchSize) {
      const batch = texts.slice(start, start + this.config.batchSize);
      vectors.push(...(await this.requestEmbeddings(batch)));
      await onBatch?.(vectors.length, texts.length);
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedTexts([text]);
    return vector;
  }

  private async requestEmbeddings(batch: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      input: batch,
      encoding_format: 'float',
    };
    if (this.config.sendDimensions) {
      body.dimensions = this.config.dimensions;
    }

    let response: Response;
    try {
      response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(
        `嵌入接口连接失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }

    const raw = await response.text();
    let payload: EmbeddingApiResponse = {};
    try {
      payload = raw ? (JSON.parse(raw) as EmbeddingApiResponse) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const detail =
        typeof payload.error === 'string' ? payload.error : payload.error?.message;
      throw new Error(`嵌入接口返回 ${response.status}：${detail || raw.slice(0, 300)}`);
    }

    const rows = payload.data ?? [];
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((row) => row.embedding ?? []);

    if (vectors.length !== batch.length) {
      throw new Error(`嵌入接口返回条数不匹配：期望 ${batch.length}，实际 ${vectors.length}`);
    }
    for (const vector of vectors) {
      if (vector.length !== this.config.dimensions) {
        throw new Error(
          `嵌入维度不匹配：模型返回 ${vector.length} 维，配置为 ${this.config.dimensions} 维。` +
            '请调整 EMBEDDING_DIMENSIONS/EMBEDDING_MODEL，或新增数据库迁移修改向量列维度。',
        );
      }
    }

    return vectors;
  }
}
