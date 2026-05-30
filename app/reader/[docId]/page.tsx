'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import { applyHighlightsToHtml } from '@/lib/highlight-utils';
import DocumentOutline from '@/components/DocumentOutline';
import ReaderToolbar from '@/components/reader/ReaderToolbar';
import TextSelectionPopup from '@/components/reader/TextSelectionPopup';
import ResearchAgentPanel from '@/components/reader/ResearchAgentPanel';
import ReadingNotesPanel from '@/components/reader/ReadingNotesPanel';
import type { KBDocument, DocumentHighlight, ReadingNote } from '@/types';

const themeClasses: Record<string, string> = {
  light: 'bg-white text-gray-900',
  dark: 'bg-gray-950 text-gray-100',
  sepia: 'reader-sepia',
};

const proseThemeClasses: Record<string, string> = {
  light: 'prose prose-sm max-w-none',
  dark: 'prose prose-sm max-w-none prose-invert',
  sepia: 'prose prose-sm max-w-none',
};

export default function ReaderPage() {
  const router = useRouter();
  const params = useParams();
  const docId = params.docId as string;

  const contentRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<string | null>(null);

  const [doc, setDoc] = useState<KBDocument | null>(null);
  const [highlights, setHighlights] = useState<DocumentHighlight[]>([]);
  const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [readerTheme, setReaderTheme] = useState<'light' | 'dark' | 'sepia'>('light');
  const [fontSize, setFontSize] = useState(16);
  const [readingMode, setReadingMode] = useState<'pdf' | 'markdown'>('markdown');
  const [mobilePanel, setMobilePanel] = useState<'outline' | 'ai' | 'notes' | null>(null);
  const [latestNote, setLatestNote] = useState<ReadingNote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { init(); }, [docId]);

  const init = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { router.push('/login'); return; }
    tokenRef.current = token;

    try {
      const [docRes, hlRes] = await Promise.all([
        fetch(`/api/kb/documents/${docId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/reader/highlights?document_id=${docId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (docRes.ok) {
        const loadedDoc = await docRes.json();
        setDoc(loadedDoc);
        setReadingMode(loadedDoc.file_url ? 'pdf' : 'markdown');
      }
      if (hlRes.ok) setHighlights(await hlRes.json());
    } catch (e) {
      console.error('Failed to load reader data:', e);
    } finally {
      setLoading(false);
    }
  };

  const highlightedHtml = useCallback(() => {
    if (!doc?.content_md) return { __html: '' };

    const processed = doc.content_md.replace(/^(#{1,4})\s+(.+)$/gm, (_: string, hashes: string, text: string) => {
      const id = text.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/(^-|-$)/g, '');
      return `${hashes} <span id="${id}">${text}</span>`;
    });

    return { __html: applyHighlightsToHtml(renderMarkdown(processed), highlights) };
  }, [doc?.content_md, highlights]);

  const handleTextSelect = () => {
    if (!contentRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text || text.length < 2) {
      setSelection(null);
      return;
    }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({ text, rect });
  };

  useEffect(() => {
    const handleScroll = () => setSelection(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  const saveSelectionAsReadingNote = async () => {
    if (!selection || !tokenRef.current) return;
    const text = selection.text;
    setSelection(null);

    try {
      const res = await fetch('/api/reading-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({
          document_id: docId,
          title: text.slice(0, 40) || doc?.title || 'Reading note',
          content: text,
          selected_text: text,
          source_url: doc?.file_url || null,
          metadata: { document_title: doc?.title },
        }),
      });
      if (res.ok) setLatestNote(await res.json());
    } catch {
      // ignore
    }
  };

  const askAgentWithSelection = (prompt: string, text: string) => {
    const ask = (window as any).__researchAgentAsk;
    if (ask) ask(prompt, text);
    setMobilePanel('ai');
  };

  const handleAction = (action: 'explain' | 'translate' | 'ask' | 'summarize' | 'save') => {
    if (!selection) return;
    const text = selection.text;
    if (action === 'save') {
      saveSelectionAsReadingNote();
      return;
    }

    const prompts = {
      translate: '请把我选中的这段论文内容翻译成中文，并保留关键术语。',
      explain: '请解释我选中的这段论文内容，包括必要背景和关键概念。',
      ask: '请围绕我选中的这段内容继续追问并回答：它为什么重要？有什么潜在问题？',
      summarize: '请总结我选中的这段内容，并提炼成可以记录的要点。',
    };
    setSelection(null);
    askAgentWithSelection(prompts[action], text);
  };

  const handleDownload = () => {
    if (!doc?.content_md) return;
    const blob = new Blob([doc.content_md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title || 'document'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="mb-2 text-gray-400">文档不存在</p>
          <button onClick={() => router.back()} className="text-sm text-blue-600 hover:text-blue-700">返回</button>
        </div>
      </div>
    );
  }

  const canShowPdf = !!doc.file_url;
  const selectedText = selection?.text || '';

  return (
    <div className="fixed inset-0 z-50 flex bg-white">
      <aside className="hidden w-80 shrink-0 border-r border-gray-100 bg-white lg:flex lg:flex-col">
        <ResearchAgentPanel
          documentId={docId}
          kbId={doc.kb_id}
          documentTitle={doc.title}
          documentContent={doc.content_md || ''}
          documentUrl={doc.file_url}
          selectedText={selectedText}
          onNoteSaved={setLatestNote}
        />
      </aside>

      <main className={`flex min-w-0 flex-1 flex-col ${themeClasses[readerTheme]}`}>
        <ReaderToolbar
          title={doc.title}
          docId={docId}
          readerTheme={readerTheme}
          fontSize={fontSize}
          readingMode={readingMode}
          canShowPdf={canShowPdf}
          onThemeChange={setReaderTheme}
          onFontSizeChange={setFontSize}
          onReadingModeChange={setReadingMode}
          onDownload={handleDownload}
          onBack={() => router.back()}
        />

        <div className="flex-1 overflow-y-auto">
          {readingMode === 'pdf' && canShowPdf ? (
            <div className="h-full bg-gray-100 p-2 sm:p-4">
              <iframe
                src={doc.file_url}
                title={doc.title}
                className="h-full w-full rounded-lg border border-gray-200 bg-white"
              />
            </div>
          ) : doc.content_md ? (
            <div className="mx-auto max-w-3xl px-4 py-5 sm:px-8 sm:py-8">
              <div
                ref={contentRef}
                onMouseUp={handleTextSelect}
                className={proseThemeClasses[readerTheme]}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
                dangerouslySetInnerHTML={highlightedHtml()}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div>
                <p className="text-sm text-gray-400">这个文档暂无可阅读内容</p>
                <p className="mt-1 text-xs text-gray-300">请确认是否已上传 PDF 或完成 Markdown 解析。</p>
              </div>
            </div>
          )}
        </div>

        {selection && (
          <TextSelectionPopup
            position={{ x: selection.rect.x + selection.rect.width / 2, y: selection.rect.y }}
            text={selection.text}
            onAction={handleAction}
            onClose={() => setSelection(null)}
          />
        )}
      </main>

      <aside className="hidden w-80 shrink-0 border-l border-gray-100 bg-white lg:flex lg:flex-col">
        <ReadingNotesPanel
          documentId={docId}
          documentTitle={doc.title}
          documentUrl={doc.file_url}
          selectedText={selectedText}
          injectedNote={latestNote}
        />
      </aside>

      <div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel('outline')}
          className="touch-target rounded-full px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          目录
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('ai')}
          className="touch-target rounded-full bg-gray-900 px-4 py-2 text-xs font-medium text-white"
        >
          AI
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('notes')}
          className="touch-target rounded-full px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          笔记
        </button>
      </div>

      {mobilePanel && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            aria-label="关闭面板"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobilePanel(null)}
          />
          <div className="absolute inset-x-3 bottom-20 top-20 flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">
                {mobilePanel === 'outline' ? '文档目录' : mobilePanel === 'ai' ? '研究助手' : '随手笔记'}
              </span>
              <button
                type="button"
                onClick={() => setMobilePanel(null)}
                className="touch-target flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {mobilePanel === 'outline' ? (
                <div className="p-3">
                  <DocumentOutline markdown={doc.outline_md || doc.content_md || ''} />
                </div>
              ) : mobilePanel === 'notes' ? (
                <ReadingNotesPanel
                  documentId={docId}
                  documentTitle={doc.title}
                  documentUrl={doc.file_url}
                  selectedText={selectedText}
                  injectedNote={latestNote}
                />
              ) : (
                <ResearchAgentPanel
                  documentId={docId}
                  kbId={doc.kb_id}
                  documentTitle={doc.title}
                  documentContent={doc.content_md || ''}
                  documentUrl={doc.file_url}
                  selectedText={selectedText}
                  onNoteSaved={setLatestNote}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
