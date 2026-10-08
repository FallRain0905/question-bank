import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolveMineruConfig } from './mineru-config';
import {
  normalizeMineruMarkdown,
  pickAgentResult,
  pickAgentTask,
  pickBatchResult,
  pickBatchUpload,
  isMineruDone,
  isMineruFailed,
  readMineruError,
} from './mineru-payloads';
import { readMarkdownFromZip } from './mineru-zip';

export interface MineruParseResult {
  markdown: string;
  converter: string;
  taskId: string;
}

/** Injectable seams so the MinerU flows can be tested without the network or a real zip. */
export interface MineruDeps {
  fetchImpl?: typeof fetch;
  readZip?: (buffer: Buffer) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type FetchImpl = typeof fetch;

@Injectable()
export class MineruService implements OnModuleInit {
  private readonly logger = new Logger(MineruService.name);
  private readonly config = resolveMineruConfig();

  onModuleInit() {
    if (this.config.enabled) {
      this.logger.log(
        `PDF 转换使用 MinerU（${this.config.mode}${this.config.token ? '' : '，未配置 token'}）`,
      );
    } else {
      this.logger.warn('MinerU 已关闭（MINERU_ENABLED=false），PDF 使用本地文本层解析');
    }
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  get mode(): string {
    return this.config.mode;
  }

  get converter(): string {
    return this.config.mode === 'v4-batch' ? 'mineru-v4' : 'mineru-agent';
  }

  async parsePdf(
    buffer: Buffer,
    filename: string,
    deps: MineruDeps = {},
  ): Promise<MineruParseResult> {
    if (!this.config.enabled) {
      throw new Error('MinerU 已通过 MINERU_ENABLED=false 关闭');
    }

    const fetchImpl = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

    return this.config.mode === 'v4-batch'
      ? this.parseWithBatchApi(buffer, filename, fetchImpl, deps.readZip ?? readMarkdownFromZip, sleep)
      : this.parseWithAgentApi(buffer, filename, fetchImpl, sleep);
  }

  private async parseWithBatchApi(
    buffer: Buffer,
    filename: string,
    fetchImpl: FetchImpl,
    readZip: (zipBuffer: Buffer) => Promise<string>,
    sleep: (ms: number) => Promise<void>,
  ): Promise<MineruParseResult> {
    const payload: Record<string, unknown> = {
      files: [{ name: filename, is_ocr: this.config.isOcr }],
      language: this.config.language,
      enable_formula: true,
      enable_table: true,
    };
    if (this.config.modelVersion) {
      payload.model_version = this.config.modelVersion;
    }

    const created = await this.postJson(
      fetchImpl,
      `${this.config.baseUrl}/api/v4/file-urls/batch`,
      payload,
      this.authHeaders(),
      '申请上传链接',
    );
    const { batchId, fileUrls } = pickBatchUpload(created);
    if (!batchId || fileUrls.length === 0) {
      throw new Error('MinerU 未返回 batch_id 或上传链接');
    }

    await this.uploadFile(fetchImpl, fileUrls[0], buffer);
    const result = await this.poll(
      fetchImpl,
      `${this.config.baseUrl}/api/v4/extract-results/batch/${batchId}`,
      this.authHeaders(),
      (payload) => {
        const parsed = pickBatchResult(payload);
        return { state: parsed.state, errMsg: parsed.errMsg, resultUrl: parsed.zipUrl };
      },
      sleep,
    );

    if (!result.resultUrl) {
      throw new Error('MinerU 解析完成但未返回 full_zip_url');
    }

    const zipResponse = await fetchImpl(result.resultUrl);
    if (!zipResponse.ok) {
      throw new Error(`下载 MinerU 解析结果失败 (${zipResponse.status})`);
    }
    const markdown = await readZip(Buffer.from(await zipResponse.arrayBuffer()));

    return {
      markdown: normalizeMineruMarkdown(markdown),
      converter: 'mineru-v4',
      taskId: batchId,
    };
  }

  private async parseWithAgentApi(
    buffer: Buffer,
    filename: string,
    fetchImpl: FetchImpl,
    sleep: (ms: number) => Promise<void>,
  ): Promise<MineruParseResult> {
    const created = await this.postJson(
      fetchImpl,
      `${this.config.baseUrl}/api/v1/agent/parse/file`,
      {
        file_name: filename,
        language: this.config.language,
        is_ocr: this.config.isOcr,
        enable_formula: true,
        enable_table: true,
      },
      this.authHeaders(),
      '申请解析任务',
    );
    const { taskId, fileUrl } = pickAgentTask(created);
    if (!taskId || !fileUrl) {
      throw new Error('MinerU 未返回 task_id 或上传链接');
    }

    await this.uploadFile(fetchImpl, fileUrl, buffer);
    const result = await this.poll(
      fetchImpl,
      `${this.config.baseUrl}/api/v1/agent/parse/${taskId}`,
      this.authHeaders(),
      (payload) => {
        const parsed = pickAgentResult(payload);
        return { state: parsed.state, errMsg: parsed.errMsg, resultUrl: parsed.markdownUrl };
      },
      sleep,
    );

    if (!result.resultUrl) {
      throw new Error('MinerU 解析完成但未返回 markdown_url');
    }

    const markdownResponse = await fetchImpl(result.resultUrl);
    if (!markdownResponse.ok) {
      throw new Error(`下载 MinerU Markdown 失败 (${markdownResponse.status})`);
    }

    return {
      markdown: normalizeMineruMarkdown(await markdownResponse.text()),
      converter: 'mineru-agent',
      taskId,
    };
  }

  private authHeaders(): Record<string, string> {
    return this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {};
  }

  private async postJson(
    fetchImpl: FetchImpl,
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
    action: string,
  ): Promise<unknown> {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(`MinerU ${action}失败 (${response.status})：${text.slice(0, 300)}`);
    }
    const envelopeError = readMineruError(payload);
    if (envelopeError) {
      throw new Error(`MinerU ${action}失败：${envelopeError}`);
    }
    return payload;
  }

  private async uploadFile(fetchImpl: FetchImpl, uploadUrl: string, buffer: Buffer) {
    // MinerU signed upload URLs reject requests that set their own Content-Type.
    const response = await fetchImpl(uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(buffer),
    });
    if (!response.ok) {
      throw new Error(`上传文件到 MinerU 失败 (${response.status})`);
    }
  }

  private async poll(
    fetchImpl: FetchImpl,
    url: string,
    headers: Record<string, string>,
    pick: (payload: unknown) => { state: string; errMsg: string; resultUrl: string },
    sleep: (ms: number) => Promise<void>,
  ): Promise<{ state: string; errMsg: string; resultUrl: string }> {
    const startedAt = Date.now();
    let lastState = '';
    let lastError = '';

    while (Date.now() - startedAt < this.config.timeoutMs) {
      const response = await fetchImpl(url, { headers });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(`查询 MinerU 任务失败 (${response.status})：${text.slice(0, 300)}`);
      }
      const envelopeError = readMineruError(payload);
      if (envelopeError) {
        throw new Error(`查询 MinerU 任务失败：${envelopeError}`);
      }

      const result = pick(payload);
      lastState = result.state || lastState;
      if (result.errMsg) {
        lastError = result.errMsg;
      }

      if (isMineruFailed(result.state)) {
        throw new Error(`MinerU 解析失败：${result.errMsg || lastState || '未知原因'}`);
      }
      if (isMineruDone(result.state) && result.resultUrl) {
        return result;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed + this.config.pollIntervalMs >= this.config.timeoutMs) {
        break;
      }
      await sleep(this.config.pollIntervalMs);
    }

    throw new Error(
      `MinerU 解析超时（${Math.round(this.config.timeoutMs / 1000)} 秒，最后状态：${lastState || '未开始'}${lastError ? `，${lastError}` : ''}）`,
    );
  }
}
