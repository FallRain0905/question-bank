import { describe, expect, it } from 'vitest';
import {
  isMineruDone,
  isMineruFailed,
  normalizeMineruMarkdown,
  pickAgentResult,
  pickAgentTask,
  pickBatchResult,
  pickBatchUpload,
  readMineruError,
  selectMarkdownEntry,
} from './mineru-payloads';

describe('MinerU envelopes', () => {
  it('treats numeric or string zero codes as success', () => {
    expect(readMineruError({ code: 0 })).toBeNull();
    expect(readMineruError({ code: '0', msg: 'ok' })).toBeNull();
    expect(readMineruError({})).toBeNull();
  });

  it('surfaces the error message for non-zero codes', () => {
    expect(readMineruError({ code: 'A0202', msg: 'token 无效' })).toBe('token 无效');
    expect(readMineruError({ code: 500 })).toContain('500');
  });

  it('reads batch upload links', () => {
    const parsed = pickBatchUpload({
      code: 0,
      data: { batch_id: 'batch-1', file_urls: ['https://upload/1', 'https://upload/2'] },
    });

    expect(parsed.batchId).toBe('batch-1');
    expect(parsed.fileUrls).toEqual(['https://upload/1', 'https://upload/2']);
  });

  it('reads batch extract results', () => {
    const parsed = pickBatchResult({
      code: 0,
      data: {
        extract_result: [{ file_name: 'a.pdf', state: 'done', full_zip_url: 'https://zip/1' }],
      },
    });

    expect(parsed).toEqual({ state: 'done', zipUrl: 'https://zip/1', errMsg: '' });
  });

  it('reads a failed batch result with its error message', () => {
    const parsed = pickBatchResult({
      data: { extract_result: [{ state: 'failed', err_msg: '页面超过 200 页' }] },
    });

    expect(parsed.state).toBe('failed');
    expect(parsed.errMsg).toBe('页面超过 200 页');
    expect(isMineruFailed(parsed.state)).toBe(true);
  });

  it('reads agent task creation payloads', () => {
    const parsed = pickAgentTask({ code: 0, data: { task_id: 't-1', file_url: 'https://upload/x' } });

    expect(parsed).toEqual({ taskId: 't-1', fileUrl: 'https://upload/x' });
  });

  it('reads agent task results', () => {
    const parsed = pickAgentResult({ data: { state: 'running', markdown_url: 'https://md/x' } });

    expect(parsed.state).toBe('running');
    expect(parsed.markdownUrl).toBe('https://md/x');
    expect(isMineruDone(parsed.state)).toBe(false);
    expect(isMineruDone('done')).toBe(true);
  });
});

describe('selectMarkdownEntry', () => {
  it('prefers full.md at any depth', () => {
    expect(selectMarkdownEntry(['images/a.png', 'summary.md', 'deep/full.md'])).toBe('deep/full.md');
  });

  it('falls back to the shallowest markdown file', () => {
    expect(selectMarkdownEntry(['nested/dir/a.md', 'b.md', 'images/x.jpg'])).toBe('b.md');
  });

  it('returns null when the archive has no markdown', () => {
    expect(selectMarkdownEntry(['a.json', 'images/x.png'])).toBeNull();
  });
});

describe('normalizeMineruMarkdown', () => {
  it('replaces image references that the product does not store', () => {
    const markdown = normalizeMineruMarkdown('# 标题\n\n![图1](images/1.jpg)\n\n正文\n\n\n\n结尾');

    expect(markdown).toContain('[图片]');
    expect(markdown).not.toContain('images/1.jpg');
    expect(markdown).not.toContain('\n\n\n');
  });
});
