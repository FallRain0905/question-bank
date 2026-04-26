'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { KBDocument } from '@/types';
import DocumentOutline from '@/components/DocumentOutline';
import { renderMarkdown } from '@/lib/render-markdown';

export default function DocumentViewerPage() {
  const router = useRouter();
  const params = useParams();
  const kbId = params.id as string;
  const docId = params.docId as string;

  const [doc, setDoc] = useState<KBDocument | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineMd, setOutlineMd] = useState('');
  const [outlineSummary, setOutlineSummary] = useState('');
  const [showOutline, setShowOutline] = useState(true);

  useEffect(() => { loadDoc(); }, [docId]);

  const loadDoc = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { router.push('/login'); return; }
    const res = await fetch(`/api/kb/documents/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const d = await res.json();
      setDoc(d);
      setOutlineMd(d.content_md || '');
    }
  };

  const getAuthHeaders = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` };
  };

  const handleTextSelect = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) setSelectedText(sel.toString().trim());
  };

  const handleAskAI = async () => {
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiAnswer('');
    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ question: `基于以下文档内容回答问题。\n\n文档内容：\n${doc?.content_md?.slice(0, 4000) || ''}\n\n问题：${aiQuestion}` }),
      });
      const data = await res.json();
      setAiAnswer(data.answer || '无法回答');
    } catch { setAiAnswer('请求失败'); }
    finally { setAiLoading(false); }
  };

  const handleGenerateOutline = async () => {
    setOutlineLoading(true);
    try {
      const res = await fetch('/api/kb/generate-outline', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ content_md: doc?.content_md }),
      });
      const data = await res.json();
      if (data.success && data.outline) {
        setOutlineSummary(data.summary || '');
        setOutlineMd(outlineToMarkdown(data.outline));
      } else {
        // Fallback: use document's own headings as outline
        setOutlineMd(doc?.content_md || '');
      }
    } catch {
      setOutlineMd(doc?.content_md || '');
    }
    finally { setOutlineLoading(false); }
  };

  const outlineToMarkdown = (node: any, level = 1): string => {
    const prefix = '#'.repeat(Math.min(level, 6));
    let md = `${prefix} ${node.title}\n\n`;
    if (node.children) for (const child of node.children) md += outlineToMarkdown(child, level + 1);
    return md;
  };

  const renderContent = useCallback((md: string) => {
    // Add IDs to headings for anchor navigation
    let processed = md.replace(/^(#{1,4})\s+(.+)$/gm, (_, hashes, text) => {
      const id = text.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/(^-|-$)/g, '');
      return `${hashes} <span id="${id}">${text}</span>`;
    });
    return { __html: renderMarkdown(processed) };
  }, []);

  if (!doc) return <div className="max-w-4xl mx-auto px-4 py-10 text-center text-gray-400">加载中...</div>;

  return (
    <div className="flex h-[calc(100vh-1px)]">
      {/* Document Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <Link href={`/kb/${kbId}`} className="text-sm text-gray-400 hover:text-gray-600">← 返回</Link>
              <h1 className="text-xl font-bold text-gray-900 mt-1">{doc.title}</h1>
              <p className="text-xs text-gray-400">{doc.file_type?.toUpperCase()} · {doc.content_md?.length || 0} 字符</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleGenerateOutline} disabled={outlineLoading} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {outlineLoading ? '生成中...' : 'AI 分析'}
              </button>
              <button onClick={() => setShowOutline(!showOutline)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                {showOutline ? '隐藏目录' : '显示目录'}
              </button>
              <Link href={`/generator?doc=${doc.id}`} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800">出题</Link>
            </div>
          </div>

          {/* Content */}
          <div onMouseUp={handleTextSelect} className="bg-white border border-gray-100 rounded-xl p-6 prose prose-sm max-w-none min-h-[400px]" dangerouslySetInnerHTML={renderContent(doc.content_md || '')} />

          {/* AI Q&A */}
          <div className="mt-6 bg-white border border-gray-100 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">AI 文档问答</h3>
            <div className="flex gap-2">
              <input type="text" value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAskAI()} placeholder="基于文档提问..." className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
              <button onClick={handleAskAI} disabled={aiLoading} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">{aiLoading ? '...' : '提问'}</button>
            </div>
            {aiAnswer && <div className="mt-4 p-3 bg-gray-50 rounded-lg"><p className="text-sm text-gray-700 whitespace-pre-wrap">{aiAnswer}</p></div>}
          </div>
        </div>
      </div>

      {/* Outline Sidebar */}
      {showOutline && (
        <div className="w-60 border-l border-gray-100 bg-white overflow-y-auto shrink-0">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">📑 文档目录</span>
            </div>
            {outlineSummary && <p className="text-xs text-gray-400 mt-2 leading-relaxed">{outlineSummary}</p>}
          </div>
          <div className="p-3">
            <DocumentOutline markdown={outlineMd} />
          </div>
        </div>
      )}

      {/* Selected text */}
      {selectedText && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 max-w-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">已选中文本</span>
            <button onClick={() => setSelectedText('')} className="text-gray-300 hover:text-gray-500">&times;</button>
          </div>
          <p className="text-xs text-gray-600 line-clamp-2 mb-3">{selectedText}</p>
          <Link href={`/generator?doc=${doc.id}&text=${encodeURIComponent(selectedText)}`} className="inline-block text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
            以此为源出题
          </Link>
        </div>
      )}
    </div>
  );
}
