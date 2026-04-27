'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';
import { applyHighlightsToHtml, getSelectionOffsets } from '@/lib/highlight-utils';
import DocumentOutline from '@/components/DocumentOutline';
import ReaderToolbar from '@/components/reader/ReaderToolbar';
import TextSelectionPopup from '@/components/reader/TextSelectionPopup';
import AIPanel from '@/components/reader/AIPanel';
import type { KBDocument, DocumentHighlight, DocumentAnnotation } from '@/types';

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
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);
  const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [readerTheme, setReaderTheme] = useState<'light' | 'dark' | 'sepia'>('light');
  const [fontSize, setFontSize] = useState(16);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { init(); }, [docId]);

  const init = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { router.push('/login'); return; }
    tokenRef.current = token;

    try {
      // Parallel fetch
      const [docRes, hlRes, annRes] = await Promise.all([
        fetch(`/api/kb/documents/${docId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/reader/highlights?document_id=${docId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/reader/annotations?document_id=${docId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (docRes.ok) setDoc(await docRes.json());
      if (hlRes.ok) setHighlights(await hlRes.json());
      if (annRes.ok) setAnnotations(await annRes.json());
    } catch (e) {
      console.error('Failed to load reader data:', e);
    } finally {
      setLoading(false);
    }
  };

  // Render markdown with highlights applied
  const highlightedHtml = useCallback(() => {
    if (!doc?.content_md) return { __html: '' };

    let processed = doc.content_md.replace(/^(#{1,4})\s+(.+)$/gm, (_: string, hashes: string, text: string) => {
      const id = text.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/(^-|-$)/g, '');
      return `${hashes} <span id="${id}">${text}</span>`;
    });

    const html = renderMarkdown(processed);
    const withHighlights = applyHighlightsToHtml(html, highlights);
    return { __html: withHighlights };
  }, [doc?.content_md, highlights]);

  // Text selection handler
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

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setSelection({ text, rect });
  };

  // Clear selection on scroll
  useEffect(() => {
    const handleScroll = () => setSelection(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  // AI action handler (explain / translate / polish)
  const handleAIAction = async (action: 'explain' | 'translate' | 'polish') => {
    if (!selection || !tokenRef.current) return;

    const text = selection.text;
    setSelection(null);

    // Show in AI panel via global hook
    const addMsg = (window as any).__readerAddAIMessage;
    if (addMsg) {
      // We need to show loading state - add user message first
      addMsg(text, '...', action);
    }

    try {
      const res = await fetch('/api/reader/ai-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({
          action,
          text,
          context: doc?.content_md?.slice(0, 2000),
          document_id: docId,
        }),
      });

      const data = await res.json();

      if (data.response) {
        // Update the last assistant message with actual response
        if (addMsg) {
          addMsg(text, data.response, action, data.annotationId);
        }

        // Also create highlight automatically
        const offsets = contentRef.current ? getSelectionOffsets(contentRef.current) : null;
        if (offsets) {
          const hlRes = await fetch('/api/reader/highlights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
            body: JSON.stringify({
              document_id: docId,
              selected_text: text,
              start_offset: offsets.start,
              end_offset: offsets.end,
              color: action === 'explain' ? 'blue' : action === 'translate' ? 'green' : 'pink',
            }),
          });
          if (hlRes.ok) {
            const hl = await hlRes.json();
            setHighlights(prev => [...prev, hl]);
          }
        }

        if (data.annotationId) {
          setAnnotations(prev => [{
            id: data.annotationId,
            document_id: docId,
            user_id: '',
            highlight_id: null,
            action_type: action,
            selected_text: text,
            ai_response: data.response,
            saved_as_note_id: null,
            created_at: new Date().toISOString(),
          }, ...prev]);
        }
      }
    } catch (e) {
      console.error('AI action failed:', e);
      if (addMsg) addMsg(text, '请求失败，请重试', action);
    }
  };

  // Save selection as note
  const handleSaveAsNote = async () => {
    if (!selection || !tokenRef.current) return;
    const text = selection.text;
    setSelection(null);

    try {
      const res = await fetch('/api/reader/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({
          document_id: docId,
          action_type: 'note',
          selected_text: text,
          ai_response: '用户摘录',
          save_to_notes: true,
          doc_title: doc?.title,
        }),
      });

      if (res.ok) {
        const ann = await res.json();
        setAnnotations(prev => [ann, ...prev]);
      }
    } catch { /* ignore */ }
  };

  const handleAction = (action: 'explain' | 'translate' | 'polish' | 'save') => {
    if (action === 'save') {
      handleSaveAsNote();
    } else {
      handleAIAction(action);
    }
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

  const handleAnnotationSaved = (ann: DocumentAnnotation) => {
    setAnnotations(prev => [ann, ...prev]);
  };

  const handleAnnotationDeleted = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const handleNoteSaved = (annotationId: string) => {
    setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, saved_as_note_id: 'saved' } : a));
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-2">文档不存在</p>
          <button onClick={() => router.back()} className="text-sm text-blue-600 hover:text-blue-700">返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-white">
      {/* Left: Document Outline */}
      {!outlineCollapsed && (
        <aside className="w-56 border-r border-gray-100 bg-white shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">文档目录</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <DocumentOutline markdown={doc.outline_md || doc.content_md || ''} />
          </div>
        </aside>
      )}

      {/* Center: Reading Area */}
      <main className={`flex-1 min-w-0 flex flex-col ${themeClasses[readerTheme]}`}>
        <ReaderToolbar
          title={doc.title}
          docId={docId}
          readerTheme={readerTheme}
          fontSize={fontSize}
          onThemeChange={setReaderTheme}
          onFontSizeChange={setFontSize}
          onDownload={handleDownload}
          onBack={() => router.back()}
        />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-8">
            {/* Outline toggle */}
            <button
              onClick={() => setOutlineCollapsed(!outlineCollapsed)}
              className="fixed left-0 top-1/2 -translate-y-1/2 z-10 w-5 h-10 bg-gray-100 hover:bg-gray-200 rounded-r flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              style={{ left: outlineCollapsed ? 0 : '13.5rem' }}
            >
              <svg className={`w-3 h-3 transition-transform ${outlineCollapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div
              ref={contentRef}
              onMouseUp={handleTextSelect}
              className={`${proseThemeClasses[readerTheme]}`}
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
              dangerouslySetInnerHTML={highlightedHtml()}
            />
          </div>
        </div>

        {/* Selection popup */}
        {selection && (
          <TextSelectionPopup
            position={{ x: selection.rect.x + selection.rect.width / 2, y: selection.rect.y }}
            text={selection.text}
            onAction={handleAction}
            onClose={() => setSelection(null)}
          />
        )}
      </main>

      {/* Right: AI Panel */}
      <aside className="w-96 border-l border-gray-100 bg-white shrink-0 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">AI 阅读助手</span>
        </div>
        <div className="flex-1 min-h-0">
          <AIPanel
            documentId={docId}
            documentContent={doc.content_md || ''}
            docTitle={doc.title}
            annotations={annotations}
            onAnnotationSaved={handleAnnotationSaved}
            onAnnotationDeleted={handleAnnotationDeleted}
            onNoteSaved={handleNoteSaved}
          />
        </div>
      </aside>
    </div>
  );
}
