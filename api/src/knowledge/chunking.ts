/**
 * Markdown-aware chunking for retrieval.
 *
 * The chunker keeps heading context on every chunk and preserves the nearest
 * `<!-- page: N -->` marker (emitted by the PDF converter) so answers can cite
 * a page. Oversized blocks are split on sentence boundaries with a small
 * overlap to avoid cutting mid-sentence.
 */

export interface MarkdownChunk {
  ordinal: number;
  heading: string | null;
  page: number | null;
  content: string;
}

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
  minChars?: number;
}

const DEFAULT_MAX_CHARS = 1000;
const DEFAULT_OVERLAP_CHARS = 120;
const DEFAULT_MIN_CHARS = 40;

const PAGE_MARKER = /^<!--\s*page:\s*(\d+)\s*-->$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function splitOversized(block: string, maxChars: number, overlapChars: number): string[] {
  const sentences = block.split(/(?<=[。！？!?；;\.])\s*/).filter((part) => part.length > 0);
  const parts: string[] = [];
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) {
      parts.push(trimmed);
    }
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push();
      for (let start = 0; start < sentence.length; start += maxChars - overlapChars) {
        const piece = sentence.slice(start, start + maxChars).trim();
        if (piece) {
          parts.push(piece);
        }
      }
      continue;
    }

    if ((current + sentence).length > maxChars) {
      push();
      const tail = parts.length > 0 ? parts[parts.length - 1].slice(-overlapChars) : '';
      current = tail ? `${tail}${sentence}` : sentence;
    } else {
      current += sentence;
    }
  }
  push();

  return parts;
}

export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): MarkdownChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = Math.min(options.overlapChars ?? DEFAULT_OVERLAP_CHARS, Math.floor(maxChars / 2));
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const chunks: MarkdownChunk[] = [];
  let heading: string | null = null;
  let page: number | null = null;
  let buffer = '';

  const flush = (forced = false) => {
    const content = buffer.trim();
    buffer = '';
    if (!content) {
      return;
    }
    if (!forced && content.length < minChars) {
      // Merge tiny trailing fragments into the previous chunk instead of
      // emitting near-empty chunks that pollute retrieval results.
      const previous = chunks[chunks.length - 1];
      if (previous && previous.heading === heading && previous.page === page) {
        previous.content = `${previous.content}\n\n${content}`;
        return;
      }
    }
    chunks.push({ ordinal: chunks.length, heading, page, content });
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    const marker = line.trim().match(PAGE_MARKER);
    if (marker) {
      flush(true);
      page = Number(marker[1]);
      continue;
    }

    const headingMatch = line.match(HEADING);
    if (headingMatch) {
      flush(true);
      heading = headingMatch[2].trim();
      continue;
    }

    if (!line.trim()) {
      flush(true);
      continue;
    }

    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (candidate.length > maxChars) {
      flush(true);
      const pieces = splitOversized(candidate, maxChars, overlapChars);
      for (const piece of pieces) {
        buffer = piece;
        flush(true);
      }
      continue;
    }

    buffer = candidate;
  }

  flush();

  return chunks.map((chunk, index) => ({ ...chunk, ordinal: index }));
}
