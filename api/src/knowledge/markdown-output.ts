/**
 * Normalises LLM markdown so the frontend renders it as the model intended.
 *
 * Two failure modes show up in practice with Chinese answers:
 *  1. the whole answer is wrapped in a single ```markdown code fence, which the
 *     renderer then shows as a code block full of raw markdown;
 *  2. list items are emitted inline (`说明： - 第一点 - 第二点`) instead of one
 *     per line, so the renderer keeps them inside a paragraph.
 *
 * Both are repaired here, conservatively: inline splitting only happens when a
 * line really looks like a list (two or more markers, no table pipes), so prose
 * dashes and hyphenated words are left alone.
 */

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/** Strip a fence that wraps the entire answer. */
export function unwrapWholeCodeFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(FENCE);
  if (!match) {
    return markdown;
  }
  const inner = match[1];
  // Only unwrap when the fence wraps everything and contains no nested fence.
  if (inner.includes('```')) {
    return markdown;
  }
  return inner.trim();
}

function isTableRow(line: string) {
  return line.includes('|');
}

/**
 * Turn inline bullet sequences into real list items.
 * `说明： - 甲 - 乙` -> `说明：\n- 甲\n- 乙`
 */
export function splitInlineBullets(line: string): string {
  if (isTableRow(line)) {
    return line;
  }
  const markers = line.match(/\s+[-•·]\s+(?=\S)/g);
  if (!markers || markers.length < 2) {
    return line;
  }
  return line.replace(/\s+([-•·])\s+(?=\S)/g, '\n$1 ');
}

/**
 * Turn inline ordered sequences into real list items.
 * `步骤： 1. 甲 2. 乙` -> `步骤：\n1. 甲\n2. 乙`
 * Only triggers on an increasing 1..n sequence, so decimals such as `3.5 分` survive.
 */
export function splitInlineOrdered(line: string): string {
  if (isTableRow(line)) {
    return line;
  }
  const matches = [...line.matchAll(/\s+(\d{1,2})[.、]\s+(?=\S)/g)];
  if (matches.length < 2) {
    return line;
  }
  const startsAtOne = matches[0][1] === '1' || matches[0][1] === '2';
  const increasing = matches.every((match, index) =>
    index === 0 ? true : Number(match[1]) === Number(matches[index - 1][1]) + 1,
  );
  if (!startsAtOne || !increasing) {
    return line;
  }
  return line.replace(/\s+(\d{1,2})[.、]\s+(?=\S)/g, '\n$1. ');
}

export function normalizeAnswerMarkdown(markdown: string): string {
  if (!markdown) {
    return markdown;
  }
  const unwrapped = unwrapWholeCodeFence(markdown);
  const lines = unwrapped.split('\n');
  const repaired = lines.map((line) => {
    // Code fences and indented code must stay untouched.
    if (/^\s{4,}/.test(line) || line.trim().startsWith('```')) {
      return line;
    }
    return splitInlineOrdered(splitInlineBullets(line));
  });
  return repaired.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
