'use client';

import { useState, useRef, useEffect } from 'react';
import type { DocumentAnnotation } from '@/types';
import { renderLatexText } from '@/lib/render-markdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionType?: string;
  annotationId?: string;
}

interface AIPanelProps {
  documentId: string;
  documentContent: string;
  docTitle: string;
  annotations: DocumentAnnotation[];
  onAnnotationSaved: (annotation: DocumentAnnotation) => void;
  onAnnotationDeleted: (id: string) => void;
  onNoteSaved: (annotationId: string) => void;
}

const actionLabels: Record<string, { label: string; color: string }> = {
  explain: { label: '解释', color: 'bg-blue-100 text-blue-700' },
  translate: { label: '翻译', color: 'bg-green-100 text-green-700' },
  polish: { label: '润色', color: 'bg-purple-100 text-purple-700' },
  qa: { label: '问答', color: 'bg-gray-100 text-gray-700' },
};

export default function AIPanel({
  documentId, documentContent, docTitle, annotations, onAnnotationSaved, onAnnotationDeleted, onNoteSaved,
}: AIPanelProps) {
  const [activeTab, setActiveTab] = useState<'ai' | 'notes'>('ai');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addAIActionMessage = (text: string, response: string, actionType: string, annotationId?: string) => {
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text, actionType };
    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(), role: 'assistant', content: response, actionType, annotationId,
    };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
  };

  const handleAskQuestion = async () => {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: question, actionType: 'qa' };
    setMessages(prev => [...prev, userMsg]);

    try {
      const supabase = (await import('@/lib/supabase')).getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: `基于以下文档内容回答问题。\n\n文档内容：\n${documentContent.slice(0, 4000)}\n\n问题：${question}`,
        }),
      });
      const data = await res.json();
      const answer = data.answer || '无法回答';

      // 保存为 annotation
      const annRes = await fetch('/api/reader/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          document_id: documentId,
          action_type: 'qa',
          selected_text: question,
          ai_response: answer,
          doc_title: docTitle,
        }),
      });
      const ann = await annRes.json();

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(), role: 'assistant', content: answer, actionType: 'qa', annotationId: ann?.id,
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (ann?.id) onAnnotationSaved(ann);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: '请求失败，请重试' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsNote = async (annotation: DocumentAnnotation) => {
    try {
      const supabase = (await import('@/lib/supabase')).getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      await fetch('/api/reader/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          document_id: documentId,
          action_type: annotation.action_type,
          selected_text: annotation.selected_text,
          ai_response: annotation.ai_response,
          save_to_notes: true,
          doc_title: docTitle,
        }),
      });

      onNoteSaved(annotation.id);
    } catch { /* ignore */ }
  };

  const handleDeleteAnnotation = async (id: string) => {
    try {
      const supabase = (await import('@/lib/supabase')).getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      await fetch('/api/reader/annotations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });

      onAnnotationDeleted(id);
    } catch { /* ignore */ }
  };

  // Expose addAIActionMessage to parent
  useEffect(() => {
    (window as any).__readerAddAIMessage = addAIActionMessage;
    return () => { delete (window as any).__readerAddAIMessage; };
  }, [documentId]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab switcher */}
      <div className="flex border-b border-gray-100 shrink-0">
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === 'ai' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
        >
          AI 助手
        </button>
        <button
          onClick={() => setActiveTab('notes')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${activeTab === 'notes' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
        >
          批注 {annotations.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-600 rounded-full">{annotations.length}</span>}
        </button>
      </div>

      {activeTab === 'ai' ? (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">选中文本即可获得 AI 辅助</p>
                <p className="text-xs text-gray-300 mt-1">或直接在此提问关于文档的问题</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-50 text-gray-800'
                }`}>
                  {msg.actionType && msg.role === 'user' && (
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded mb-1 ${actionLabels[msg.actionType]?.color || 'bg-gray-100 text-gray-600'}`}>
                      {actionLabels[msg.actionType]?.label || msg.actionType}
                    </span>
                  )}
                  <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: msg.role === 'assistant' ? renderLatexText(msg.content) : msg.content }} />
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 rounded-xl px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 p-3 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAskQuestion()}
                placeholder="基于文档提问..."
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
                disabled={loading}
              />
              <button
                onClick={handleAskQuestion}
                disabled={loading || !input.trim()}
                className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Annotations list */
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {annotations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">暂无批注</p>
              <p className="text-xs text-gray-300 mt-1">选中文本后使用 AI 功能即可创建批注</p>
            </div>
          ) : (
            annotations.map((ann) => {
              const action = actionLabels[ann.action_type] || { label: ann.action_type, color: 'bg-gray-100 text-gray-600' };
              return (
                <div key={ann.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${action.color}`}>{action.label}</span>
                    <button onClick={() => handleDeleteAnnotation(ann.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2 mb-1.5">{ann.selected_text}</p>
                  <p className="text-xs text-gray-800 line-clamp-3 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderLatexText(ann.ai_response) }} />
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
                    <span className="text-[10px] text-gray-400">{new Date(ann.created_at).toLocaleString('zh-CN')}</span>
                    <button
                      onClick={() => handleSaveAsNote(ann)}
                      className="text-[10px] text-blue-600 hover:text-blue-700"
                    >
                      {ann.saved_as_note_id ? '已保存' : '存至笔记草稿箱'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
