import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './chunking';

describe('chunkMarkdown', () => {
  it('keeps heading context and paragraph boundaries', () => {
    const chunks = chunkMarkdown(
      ['# 第一章 词汇', '', 'abandon 表示放弃。', '', '## 1.1 用法', '', 'abandon the plan 表示放弃计划。'].join('\n'),
      { minChars: 0 },
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual(['第一章 词汇', '1.1 用法']);
    expect(chunks[0].content).toBe('abandon 表示放弃。');
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[1].ordinal).toBe(1);
  });

  it('attaches the nearest page marker to chunks', () => {
    const chunks = chunkMarkdown(
      ['<!-- page: 1 -->', '', '第一页内容，足够长度的句子用来避免被合并处理。', '', '<!-- page: 2 -->', '', '第二页内容，同样需要一定长度才能形成独立分块。'].join('\n'),
      { minChars: 0 },
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].page).toBe(1);
    expect(chunks[1].page).toBe(2);
  });

  it('splits oversized blocks and respects the maximum size', () => {
    const sentence = '这是一句用于测试分块长度的中文句子。';
    const paragraph = sentence.repeat(60);
    const chunks = chunkMarkdown(paragraph, { maxChars: 200, overlapChars: 20, minChars: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(240);
    }
  });

  it('returns no chunks for empty content', () => {
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('keeps long fenced code blocks inside a chunk instead of dropping them', () => {
    const code = '```ts\n' + 'const value = 1;\n'.repeat(30) + '```';
    const chunks = chunkMarkdown(code, { maxChars: 400, overlapChars: 50, minChars: 0 });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((chunk) => chunk.content).join('')).toContain('const value');
  });
});
