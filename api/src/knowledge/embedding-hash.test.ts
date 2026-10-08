import { describe, expect, it } from 'vitest';
import { hashEmbedding, tokenize } from './embedding-hash';

describe('tokenize', () => {
  it('splits latin words and adds CJK unigrams plus bigrams', () => {
    const tokens = tokenize('Abandon 学习');

    expect(tokens).toContain('abandon');
    expect(tokens).toContain('学');
    expect(tokens).toContain('习');
    expect(tokens).toContain('学习');
  });
});

describe('hashEmbedding', () => {
  it('is deterministic and returns the requested dimension', () => {
    const first = hashEmbedding('间隔复习很重要', 256);
    const second = hashEmbedding('间隔复习很重要', 256);

    expect(first).toHaveLength(256);
    expect(first).toEqual(second);
  });

  it('is L2-normalized', () => {
    const vector = hashEmbedding('vector embedding test', 128);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    expect(norm).toBeCloseTo(1, 6);
  });

  it('produces different vectors for different texts', () => {
    expect(hashEmbedding('词汇学习', 64)).not.toEqual(hashEmbedding('语法练习', 64));
  });

  it('returns a zero vector for empty text', () => {
    expect(hashEmbedding('', 32).every((value) => value === 0)).toBe(true);
  });
});
