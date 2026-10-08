import { describe, expect, it } from 'vitest';
import { stripMarkdownForDisplay } from './markdown-plain';

describe('stripMarkdownForDisplay', () => {
  it('removes heading markers that leaked into citation snippets', () => {
    expect(stripMarkdownForDisplay('## 高频词优先\n先集中复习高频词。')).toBe(
      '高频词优先\n先集中复习高频词。',
    );
  });

  it('removes emphasis and inline code markers', () => {
    expect(stripMarkdownForDisplay('**间隔复习**：按 `1/3/7/15` 天安排。')).toBe(
      '间隔复习：按 1/3/7/15 天安排。',
    );
  });

  it('turns list markers into a bullet character', () => {
    expect(stripMarkdownForDisplay('- 第一条\n- 第二条')).toBe('· 第一条\n· 第二条');
  });

  it('keeps link and image labels', () => {
    expect(stripMarkdownForDisplay('见 [官方指南](https://example.com) 与 ![示意图](a.png)')).toBe(
      '见 官方指南 与 示意图',
    );
  });

  it('drops code fences but keeps the code text', () => {
    expect(stripMarkdownForDisplay('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
  });

  it('flattens table rows into readable separators', () => {
    // The separator row is dropped, leaving a blank line between the two rows.
    expect(stripMarkdownForDisplay('| 阶段 | 重点 |\n| --- | --- |\n| 第一周 | 高频词 |')).toBe(
      '阶段 · 重点\n\n第一周 · 高频词',
    );
  });

  it('returns plain text unchanged apart from whitespace tidy-up', () => {
    expect(stripMarkdownForDisplay('普通的一段中文说明。')).toBe('普通的一段中文说明。');
  });
});
