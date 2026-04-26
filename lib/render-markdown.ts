import { marked } from 'marked';
import katex from 'katex';

let placeholderId = 0;
const placeholders = new Map<string, string>();

function protectLatex(text: string): string {
  placeholderId = 0;
  placeholders.clear();

  let result = text;

  // Protect display math: $$...$$
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    const id = `__LATEX_BLOCK_${placeholderId++}__`;
    try {
      placeholders.set(id, katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      placeholders.set(id, `<pre>${latex.trim()}</pre>`);
    }
    return id;
  });

  // Protect inline math: $...$ (but not $$)
  result = result.replace(/(?<!\$)\$(?!\$)([^\$]+?)\$(?!\$)/g, (_, latex) => {
    const id = `__LATEX_INLINE_${placeholderId++}__`;
    try {
      placeholders.set(id, katex.renderToString(latex.trim(), { throwOnError: false }));
    } catch {
      placeholders.set(id, `<code>${latex.trim()}</code>`);
    }
    return id;
  });

  // Protect \[...\] display math
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_, latex) => {
    const id = `__LATEX_BLOCK_${placeholderId++}__`;
    try {
      placeholders.set(id, katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      placeholders.set(id, `<pre>${latex.trim()}</pre>`);
    }
    return id;
  });

  // Protect \(...\) inline math
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_, latex) => {
    const id = `__LATEX_INLINE_${placeholderId++}__`;
    try {
      placeholders.set(id, katex.renderToString(latex.trim(), { throwOnError: false }));
    } catch {
      placeholders.set(id, `<code>${latex.trim()}</code>`);
    }
    return id;
  });

  return result;
}

function restoreLatex(html: string): string {
  let result = html;
  for (const [id, rendered] of placeholders) {
    result = result.replace(id, rendered);
  }
  return result;
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  const protectedMd = protectLatex(md);
  const html = marked.parse(protectedMd, { breaks: true }) as string;
  return restoreLatex(html);
}

export function renderLatexText(text: string): string {
  if (!text) return '';
  // Only render LaTeX — keep other text as-is (HTML escaped)
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const protected_ = protectLatex(escaped);
  return restoreLatex(protected_);
}
