import { describe, expect, it } from 'vitest';
import { pagesToMarkdown } from './pdf-markdown';

describe('pagesToMarkdown', () => {
  it('emits page markers and keeps text', () => {
    const markdown = pagesToMarkdown([
      { num: 1, text: 'Unit One\n\nVocabulary is important.' },
      { num: 2, text: 'Reading practice.' },
    ]);

    expect(markdown).toContain('<!-- page: 1 -->');
    expect(markdown).toContain('<!-- page: 2 -->');
    expect(markdown).toContain('Vocabulary is important.');
    expect(markdown).toContain('Reading practice.');
  });

  it('promotes numbered titles to markdown headings', () => {
    const markdown = pagesToMarkdown([
      { num: 1, text: '1.2 Listening Skills\nThis section covers listening.' },
    ]);

    expect(markdown).toContain('### 1.2 Listening Skills');
  });

  it('drops page-number-only lines and repeated running headers', () => {
    const pages = [
      { num: 1, text: 'CET-6 Vocabulary Handbook\n12\nFirst page body text.' },
      { num: 2, text: 'CET-6 Vocabulary Handbook\n13\nSecond page body text.' },
      { num: 3, text: 'CET-6 Vocabulary Handbook\n14\nThird page body text.' },
    ];

    const markdown = pagesToMarkdown(pages);

    expect(markdown).not.toContain('CET-6 Vocabulary Handbook');
    expect(markdown).not.toMatch(/\n12\n/);
    expect(markdown).toContain('First page body text.');
    expect(markdown).toContain('Third page body text.');
  });

  it('joins hyphenated words split across lines', () => {
    const markdown = pagesToMarkdown([
      { num: 1, text: 'This is a well-\nknown example.' },
    ]);

    expect(markdown).toContain('wellknown example');
  });

  it('skips pages without extractable text', () => {
    const markdown = pagesToMarkdown([{ num: 1, text: '   \n\n' }, { num: 2, text: 'Content.' }]);

    expect(markdown).not.toContain('<!-- page: 1 -->');
    expect(markdown).toContain('<!-- page: 2 -->');
  });
});
