import type { DocumentHighlight } from '@/types';

/**
 * 从 DOM Selection 的 Range 计算相对于 container 的字符偏移量
 */
export function getSelectionOffsets(container: HTMLElement): { start: number; end: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  const text = sel.toString().trim();
  if (!text) return null;

  const preRange = document.createRange();
  preRange.setStart(container, 0);
  preRange.setEnd(range.startContainer, range.startOffset);

  const start = getTextLength(preRange.toString());
  const end = start + getTextLength(text);

  return { start, end, text };
}

function getTextLength(str: string): number {
  return str.replace(/\s+/g, ' ').trim().length;
}

/**
 * 在渲染后的 HTML 字符串中，按偏移量插入 <mark> 高亮标签
 * 在 renderMarkdown() 输出后执行，不影响 LaTeX 渲染
 */
export function applyHighlightsToHtml(html: string, highlights: DocumentHighlight[]): string {
  if (!highlights.length) return html;

  // 按偏移量排序，先处理靠后的高亮，避免偏移变化
  const sorted = [...highlights].sort((a, b) => b.start_offset - a.start_offset);

  // 从 HTML 中提取纯文本内容用于偏移定位
  const textContent = extractTextFromHtml(html);

  for (const h of sorted) {
    // 在纯文本中验证偏移
    if (h.start_offset < 0 || h.end_offset > textContent.length) continue;

    const expectedText = textContent.slice(h.start_offset, h.end_offset).replace(/\s+/g, ' ').trim();
    const highlightText = h.selected_text.replace(/\s+/g, ' ').trim();

    // 如果偏移对应的文本不匹配，尝试文本搜索
    let startIdx = h.start_offset;
    if (expectedText !== highlightText) {
      const found = textContent.indexOf(highlightText);
      if (found === -1) continue;
      startIdx = found;
    }

    // 在 HTML 中定位并插入 <mark> 标签
    html = insertMarkInHtml(html, startIdx, startIdx + highlightText.length, h.color);
  }

  return html;
}

function extractTextFromHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
}

function insertMarkInHtml(html: string, textStart: number, textEnd: number, color: string): string {
  // 遍历 HTML，区分标签和文本节点，定位文本偏移
  let result = '';
  let textPos = 0;
  let i = 0;
  let markInserted = false;

  while (i < html.length) {
    if (html[i] === '<') {
      // 跳过整个标签
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) { result += html.slice(i); break; }
      result += html.slice(i, tagEnd + 1);
      i = tagEnd + 1;
      continue;
    }

    // 文本内容
    let charCount = 0;
    let start = i;
    while (i < html.length && html[i] !== '<') {
      const ch = html[i];
      if (/\s/.test(ch)) {
        // 合并空白
        if (charCount === 0 || !/\s/.test(html[i - 1])) {
          charCount++;
        }
      } else {
        charCount++;
      }
      i++;
    }

    if (!markInserted && textPos + charCount > textStart) {
      // 这个文本节点包含高亮起点
      const textNode = html.slice(start, i);
      const localStart = textStart - textPos;
      const localEnd = Math.min(textEnd - textPos, charCount);

      // 简单处理：将整个文本节点包裹在 mark 中
      const before = textNode.slice(0, Math.max(0, localStart));
      const marked = textNode.slice(Math.max(0, localStart), localEnd);
      const after = textNode.slice(localEnd);

      result += before;
      result += `<mark class="mark-highlight-${color}" data-highlight="true">`;
      result += marked;
      result += '</mark>';
      result += after;

      markInserted = true;
    } else {
      result += html.slice(start, i);
    }

    textPos += charCount;
  }

  return result;
}
