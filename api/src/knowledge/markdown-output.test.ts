import { describe, expect, it } from 'vitest';
import {
  normalizeAnswerMarkdown,
  splitInlineBullets,
  splitInlineOrdered,
  unwrapWholeCodeFence,
} from './markdown-output';

describe('unwrapWholeCodeFence', () => {
  it('removes a fence that wraps the whole answer', () => {
    const input = '```markdown\n## 高频词优先\n\n先背高频词\n```';

    expect(unwrapWholeCodeFence(input)).toBe('## 高频词优先\n\n先背高频词');
  });

  it('keeps normal answers unchanged', () => {
    expect(unwrapWholeCodeFence('## 标题\n\n- 第一条')).toBe('## 标题\n\n- 第一条');
  });

  it('keeps a code block that is part of a longer answer', () => {
    const input = '说明：\n\n```ts\nconst a = 1;\n```\n\n结束';
    expect(unwrapWholeCodeFence(input)).toBe(input);
  });

  it('keeps nested fences intact', () => {
    const input = '```md\n文字\n```\n```ts\ncode\n```';
    expect(unwrapWholeCodeFence(input)).toBe(input);
  });
});

describe('splitInlineBullets', () => {
  it('splits an inline bullet list into separate lines', () => {
    const input = '根据资料：  - **每段一个论点**：先给论点。  - **再给例证**：随后举例。';

    expect(splitInlineBullets(input)).toBe(
      '根据资料：\n- **每段一个论点**：先给论点。\n- **再给例证**：随后举例。',
    );
  });

  it('leaves a single dash untouched', () => {
    const input = '这是一个 50 - 60 分的分数区间。';
    expect(splitInlineBullets(input)).toBe(input);
  });

  it('leaves hyphenated words untouched', () => {
    const input = 'This is a well-known and cost-effective approach.';
    expect(splitInlineBullets(input)).toBe(input);
  });

  it('leaves table rows untouched', () => {
    const input = '| 阶段 | 重点 |\n| --- | --- |';
    expect(splitInlineBullets(input)).toBe(input);
  });
});

describe('splitInlineOrdered', () => {
  it('splits an inline ordered list', () => {
    expect(splitInlineOrdered('步骤： 1. 背单词 2. 做真题 3. 复盘')).toBe(
      '步骤：\n1. 背单词\n2. 做真题\n3. 复盘',
    );
  });

  it('keeps decimal numbers intact', () => {
    const input = '目标 6.5 分，当前 5.5 分。';
    expect(splitInlineOrdered(input)).toBe(input);
  });

  it('keeps non-sequential numbers intact', () => {
    const input = '参考 3.2 节和 4.1 节。';
    expect(splitInlineOrdered(input)).toBe(input);
  });
});

describe('normalizeAnswerMarkdown', () => {
  it('repairs the two production failure modes together', () => {
    const input = '```markdown\n建议：  - **高频词优先**  - **间隔复习**\n```';

    expect(normalizeAnswerMarkdown(input)).toBe('建议：\n- **高频词优先**\n- **间隔复习**');
  });

  it('is idempotent for already well-formed markdown', () => {
    const input = '## 建议\n\n- 第一条\n- 第二条\n\n> 提示';

    expect(normalizeAnswerMarkdown(input)).toBe(input);
  });

  it('does not touch indented code blocks', () => {
    const input = '说明：\n\n    这是代码 - 不要动 - 真的';

    expect(normalizeAnswerMarkdown(input)).toBe(input);
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeAnswerMarkdown('')).toBe('');
  });
});
