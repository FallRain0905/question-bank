/**
 * Local PDF → Markdown conversion.
 *
 * Text-based PDFs are extracted page by page and normalised into Markdown:
 * `<!-- page: N -->` markers preserve page numbers for citations, likely
 * section titles become headings, and lines repeating on most pages (running
 * headers/footers) are removed.
 *
 * Scanned/image-only PDFs are not supported: they contain no extractable text
 * layer, and this module deliberately does not fake content via OCR.
 */

import { PDFParse } from 'pdf-parse';

export interface PdfPage {
  num: number;
  text: string;
}

const HEADING_PATTERNS = [
  /^\d+(?:\.\d+){0,3}[\s.、)．]/,
  /^第[一二三四五六七八九十百千\d]+[章节讲课部]分?/,
  /^[A-Z][A-Z0-9 ,.&\-:]{6,60}$/,
];

const LIST_ITEM = /^([-•·*]|\d+[.)、])\s+/;
const PAGE_NUMBER_LINE = /^[-–—\s]*\d{1,4}[-–—\s]*$/;

function looksLikeHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) {
    return false;
  }
  if (/[。！？；;，,、：:!?]$/.test(trimmed)) {
    return false;
  }
  if (LIST_ITEM.test(trimmed)) {
    return false;
  }
  return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function headingLevel(line: string) {
  const numbered = line.trim().match(/^(\d+(?:\.\d+)*)/);
  if (numbered) {
    const depth = numbered[1].split('.').length;
    return Math.min(2 + depth - 1, 5);
  }
  return 2;
}

/** Detect short lines that repeat across most pages (headers, footers, watermarks). */
function findRepeatingLines(pages: PdfPage[]) {
  if (pages.length < 3) {
    return new Set<string>();
  }
  const linePages = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 80 || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      linePages.set(trimmed, (linePages.get(trimmed) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const repeating = new Set<string>();
  for (const [line, count] of linePages) {
    if (count >= threshold) {
      repeating.add(line);
    }
  }
  return repeating;
}

export function pagesToMarkdown(pages: PdfPage[]): string {
  const repeating = findRepeatingLines(pages);
  const blocks: string[] = [];

  for (const page of pages) {
    const lines: string[] = [];
    for (const rawLine of page.text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = rawLine.trim();
      if (!line || PAGE_NUMBER_LINE.test(line) || repeating.has(line)) {
        continue;
      }
      if (looksLikeHeading(line)) {
        lines.push(`${'#'.repeat(headingLevel(line))} ${line}`);
      } else {
        lines.push(line);
      }
    }

    if (lines.length > 0) {
      blocks.push(`<!-- page: ${page.num} -->\n\n${lines.join('\n')}`);
    }
  }

  return blocks
    .join('\n\n')
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function pdfBufferToMarkdown(buffer: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages: PdfPage[] = result.pages.map((page) => ({ num: page.num, text: page.text }));
    return {
      markdown: pagesToMarkdown(pages),
      pageCount: result.total ?? pages.length,
    };
  } catch (error) {
    throw new Error(
      `PDF 解析失败：${error instanceof Error ? error.message : '未知错误'}`,
    );
  } finally {
    await parser.destroy();
  }
}

export function plainTextToMarkdown(buffer: Buffer) {
  const text = new TextDecoder('utf-8').decode(buffer).replace(/\r\n?/g, '\n');
  return text.trim();
}
