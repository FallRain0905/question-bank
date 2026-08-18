// 纯字符串/JSON 净化工具，供 synapse-runtime 与 synapse-planning 共用。
// 从 synapse-runtime.ts 原样迁出，避免 planning 模块反向依赖 runtime 造成循环导入。

export function sanitizeTextForPostgres(value: string, maxLength = 120000) {
  let output = '';
  for (let index = 0; index < value.length && output.length < maxLength; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    output += value[index];
  }
  return output;
}

export function sanitizeForPostgres<T>(value: T, depth = 0): T {
  if (depth > 8) return null as T;
  if (typeof value === 'string') return sanitizeTextForPostgres(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeForPostgres(item, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      next[sanitizeTextForPostgres(key, 200)] = sanitizeForPostgres(item, depth + 1);
    }
    return next as T;
  }
  return value;
}
