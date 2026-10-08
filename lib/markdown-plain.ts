/**
 * Converts a markdown excerpt into clean plain text for display.
 *
 * Citation snippets are cut out of markdown sources and truncated mid-document,
 * so rendering them as markdown is unreliable and showing them raw leaks `##`,
 * `**` and `[]()` markers into the UI. Stripping the syntax keeps the panel
 * readable without pretending the fragment is a complete document.
 */

function isHorizontalRule(line: string) {
  return /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line);
}

function isTableSeparator(line: string) {
  const trimmed = line.trim();
  return /^[-:|\s]{5,}$/.test(trimmed) && trimmed.includes('-') && trimmed.includes('|');
}

function tableRowToText(line: string) {
  const cells = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  return cells.length >= 2 ? cells.join(' · ') : line;
}

export function stripMarkdownForDisplay(markdown: string): string {
  const unfenced = markdown.replace(/\r\n?/g, '\n').replace(/^```[^\n]*\n?/gm, '');

  const inline = unfenced
    // images: keep alt text; links: keep the label
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // emphasis and inline code markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1');

  const lines = inline.split('\n').map((rawLine) => {
    const line = rawLine
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s{0,3}#{1,6}\s+/, '');

    if (isHorizontalRule(line) || isTableSeparator(line)) {
      return '';
    }
    if (line.includes('|')) {
      return tableRowToText(line);
    }
    return line.replace(/^\s{0,3}([-*+]|\d{1,3}[.)、])\s+/, '· ');
  });

  return lines
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
