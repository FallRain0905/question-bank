/**
 * Deterministic offline embedding used when no embedding API key is configured.
 *
 * This is a feature-hashing bag-of-words vector. It keeps the upload → chunk →
 * embed → retrieve pipeline testable without network access, but its retrieval
 * quality is far below a real embedding model. Do not treat it as production
 * semantic search.
 */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** FNV-1a 32-bit hash. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9]+/g) ?? [];
  tokens.push(...latin);

  const cjk = Array.from(normalized).filter((char) => CJK_PATTERN.test(char));
  tokens.push(...cjk);
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    tokens.push(cjk[index] + cjk[index + 1]);
  }

  return tokens;
}

export function hashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % dimensions;
    const sign = (hash >>> 16) & 1 ? 1 : -1;
    vector[index] += sign;
  }

  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }

  return vector.map((value) => value / norm);
}
