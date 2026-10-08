import { afterEach, describe, expect, it, vi } from 'vitest';
import { MineruService } from './mineru.service';

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('MineruService (agent flow)', () => {
  it('uploads the file, polls the task and downloads markdown_url', async () => {
    process.env.MINERU_PARSE_MODE = 'agent';
    process.env.MINERU_POLL_INTERVAL_MS = '1';

    let polls = 0;
    const calls: Array<{ method: string; url: string; headers?: unknown }> = [];
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ method: init?.method ?? 'GET', url, headers: init?.headers });
      if (url.endsWith('/api/v1/agent/parse/file')) {
        return jsonResponse({ code: 0, data: { task_id: 't-1', file_url: 'https://upload/1' } });
      }
      if (url === 'https://upload/1') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/api/v1/agent/parse/t-1')) {
        polls += 1;
        return polls === 1
          ? jsonResponse({ data: { state: 'running' } })
          : jsonResponse({ data: { state: 'done', markdown_url: 'https://md/1' } });
      }
      if (url === 'https://md/1') {
        return new Response('# 解析结果\n\n![图](images/1.jpg)\n\n正文', { status: 200 });
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }) as unknown as typeof fetch;

    const service = new MineruService();
    const result = await service.parsePdf(Buffer.from('%PDF-1.4'), 'sample.pdf', { fetchImpl, sleep: async () => {} });

    expect(result.converter).toBe('mineru-agent');
    expect(result.taskId).toBe('t-1');
    expect(result.markdown).toContain('# 解析结果');
    expect(result.markdown).toContain('[图片]');
    expect(result.markdown).not.toContain('images/1.jpg');

    const upload = calls.find((call) => call.method === 'PUT');
    expect(upload?.headers).toBeUndefined();
    expect(calls.filter((call) => call.url.endsWith('/api/v1/agent/parse/t-1'))).toHaveLength(2);
  });
});

describe('MinerU batch flow', () => {
  it('authenticates batch calls, downloads the zip and extracts markdown', async () => {
    process.env.MINERU_API_TOKEN = 'token-1';
    process.env.MINERU_PARSE_MODE = 'v4-batch';
    process.env.MINERU_POLL_INTERVAL_MS = '1';

    let polls = 0;
    const calls: Array<{ method: string; url: string; headers?: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ method: init?.method ?? 'GET', url, headers: init?.headers });
      if (url.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'b-1', file_urls: ['https://upload/b-1'] } });
      }
      if (url === 'https://upload/b-1') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/api/v4/extract-results/batch/b-1')) {
        polls += 1;
        return polls === 1
          ? jsonResponse({ code: 0, data: { extract_result: [{ state: 'running' }] } })
          : jsonResponse({
              code: 0,
              data: { extract_result: [{ state: 'done', full_zip_url: 'https://zip/1' }] },
            });
      }
      if (url === 'https://zip/1') {
        return new Response(Buffer.from('fake-zip'), { status: 200 });
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }) as unknown as typeof fetch;

    const readZip = vi.fn(async () => '# 来自 zip\n\n内容');

    const service = new MineruService();
    const result = await service.parsePdf(Buffer.from('%PDF-1.4'), 'sample.pdf', {
      fetchImpl,
      readZip,
      sleep: async () => {},
    });

    expect(result.converter).toBe('mineru-v4');
    expect(result.markdown).toBe('# 来自 zip\n\n内容');
    expect(readZip).toHaveBeenCalledOnce();

    const createCall = calls.find((call) => call.url.endsWith('/api/v4/file-urls/batch'));
    expect(createCall?.headers?.Authorization).toBe('Bearer token-1');
    const pollCall = calls.find((call) => call.url.includes('/api/v4/extract-results/batch/b-1'));
    expect(pollCall?.headers?.Authorization).toBe('Bearer token-1');
  });

  it('surfaces MinerU error envelopes', async () => {
    process.env.MINERU_API_TOKEN = 'token-1';
    process.env.MINERU_PARSE_MODE = 'v4-batch';

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 'A0202', msg: 'token 无效' }),
    ) as unknown as typeof fetch;

    const service = new MineruService();
    await expect(service.parsePdf(Buffer.from('%PDF'), 'a.pdf', { fetchImpl })).rejects.toThrow(
      /token 无效/,
    );
  });

  it('reports a failed task with the MinerU error message', async () => {
    process.env.MINERU_API_TOKEN = 'token-1';
    process.env.MINERU_PARSE_MODE = 'v4-batch';
    process.env.MINERU_POLL_INTERVAL_MS = '1';

    const fetchImpl = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'b-2', file_urls: ['https://upload/b-2'] } });
      }
      if (url === 'https://upload/b-2') {
        return new Response('', { status: 200 });
      }
      return jsonResponse({
        code: 0,
        data: { extract_result: [{ state: 'failed', err_msg: '文件超过 200MB' }] },
      });
    }) as unknown as typeof fetch;

    const service = new MineruService();
    await expect(
      service.parsePdf(Buffer.from('%PDF'), 'big.pdf', { fetchImpl, sleep: async () => {} }),
    ).rejects.toThrow(/文件超过 200MB/);
  });

  it('times out when the task never finishes', async () => {
    process.env.MINERU_API_TOKEN = 'token-1';
    process.env.MINERU_PARSE_MODE = 'v4-batch';
    process.env.MINERU_TIMEOUT_MS = '30';
    process.env.MINERU_POLL_INTERVAL_MS = '1';

    const fetchImpl = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'b-3', file_urls: ['https://upload/b-3'] } });
      }
      if (url === 'https://upload/b-3') {
        return new Response('', { status: 200 });
      }
      return jsonResponse({ code: 0, data: { extract_result: [{ state: 'running' }] } });
    }) as unknown as typeof fetch;

    const service = new MineruService();
    await expect(
      service.parsePdf(Buffer.from('%PDF'), 'slow.pdf', { fetchImpl, sleep: async () => {} }),
    ).rejects.toThrow(/超时/);
  });
});
