/**
 * Pure parsers for MinerU responses.
 *
 * MinerU wraps results differently per endpoint and has changed field names
 * over time, so every field is read defensively instead of assuming one shape.
 * Keeping this logic pure makes the fragile part of the integration testable
 * without network access.
 */

export const MINERU_DONE_STATES = new Set(['done', 'completed', 'success']);
export const MINERU_FAILED_STATES = new Set(['failed', 'error']);

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

export function isMineruDone(state: string) {
  return MINERU_DONE_STATES.has(state.toLowerCase());
}

export function isMineruFailed(state: string) {
  return MINERU_FAILED_STATES.has(state.toLowerCase());
}

/** Error message from a MinerU envelope (`code`/`msg`), or null when successful. */
export function readMineruError(payload: unknown): string | null {
  const record = asRecord(payload);
  const code = record.code;
  if (code === undefined || code === null || code === 0 || code === '0') {
    return null;
  }
  return firstString(record.msg, record.message, record.error, `MinerU 返回错误码 ${String(code)}`);
}

/** `POST /api/v4/file-urls/batch` → signed upload URLs. */
export function pickBatchUpload(payload: unknown): { batchId: string; fileUrls: string[] } {
  const data = asRecord(asRecord(payload).data);
  const urls = Array.isArray(data.file_urls) ? data.file_urls.filter((url): url is string => typeof url === 'string') : [];
  return { batchId: firstString(data.batch_id), fileUrls: urls };
}

/** `GET /api/v4/extract-results/batch/{batch_id}` → per-file result. */
export function pickBatchResult(payload: unknown): { state: string; zipUrl: string; errMsg: string } {
  const data = asRecord(asRecord(payload).data);
  const results = Array.isArray(data.extract_result)
    ? data.extract_result
    : Array.isArray(data.extract_results)
      ? data.extract_results
      : [];
  const first = asRecord(results[0]);
  return {
    state: firstString(first.state, first.status),
    zipUrl: firstString(first.full_zip_url, first.zip_url),
    errMsg: firstString(first.err_msg, first.error),
  };
}

/** `POST /api/v1/agent/parse/file` → task id plus signed upload URL. */
export function pickAgentTask(payload: unknown): { taskId: string; fileUrl: string } {
  const data = asRecord(asRecord(payload).data);
  return {
    taskId: firstString(data.task_id, asRecord(payload).task_id),
    fileUrl: firstString(data.file_url, data.upload_url),
  };
}

/** `GET /api/v1/agent/parse/{task_id}` → markdown URL. */
export function pickAgentResult(payload: unknown): { state: string; markdownUrl: string; errMsg: string } {
  const data = asRecord(asRecord(payload).data);
  return {
    state: firstString(data.state, data.status),
    markdownUrl: firstString(data.markdown_url, data.md_url, data.full_md_url),
    errMsg: firstString(data.err_msg, data.error, asRecord(payload).err_msg),
  };
}

/** Prefer `full.md`, otherwise the first markdown entry of the MinerU zip. */
export function selectMarkdownEntry(names: string[]): string | null {
  const markdownFiles = names.filter((name) => /\.md$/i.test(name) && !name.endsWith('/'));
  if (markdownFiles.length === 0) {
    return null;
  }
  const full = markdownFiles.find((name) => /(^|\/)full\.md$/i.test(name));
  if (full) {
    return full;
  }
  const shallow = [...markdownFiles].sort((a, b) => a.split('/').length - b.split('/').length);
  return shallow[0];
}

/**
 * MinerU markdown references extracted images that this product does not
 * store, so image syntax is replaced with a placeholder instead of leaving
 * broken links behind.
 */
export function normalizeMineruMarkdown(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
