'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { renderLatexText } from '@/lib/render-markdown';
import type { ReadingNote, ResearchAgentSource, ResearchAgentToolCall } from '@/types';

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ResearchAgentToolCall[];
  sources?: ResearchAgentSource[];
}

interface ResearchAgentPanelProps {
  documentId: string;
  kbId?: string;
  documentTitle: string;
  documentContent: string;
  documentUrl?: string;
  selectedText?: string;
  onNoteSaved?: (note: ReadingNote) => void;
}

interface ToolStatus {
  name: string;
  enabled: boolean;
  detail: string;
}

const quickActions = [
  { label: '总结论文', prompt: '请总结当前论文的核心问题、方法、结论和我应该重点关注的概念。' },
  { label: '解释选区', prompt: '请解释我选中的这段内容，并补充必要背景。' },
  { label: '联网搜索', prompt: '请联网搜索这篇论文相关的背景资料和近期进展。' },
  { label: '相关论文', prompt: '请搜索本地论文库/arXiv 中和当前论文相关的论文。' },
];

export default function ResearchAgentPanel({
  documentId,
  kbId,
  documentTitle,
  documentContent,
  documentUrl,
  selectedText,
  onNoteSaved,
}: ResearchAgentPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<ToolStatus[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const selectedTextRef = useRef(selectedText);

  useEffect(() => {
    selectedTextRef.current = selectedText;
  }, [selectedText]);

  useEffect(() => {
    const loadToolStatus = async () => {
      try {
        const supabase = getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/research-agent', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setToolStatus(data.tools || []);
        }
      } catch {
        setToolStatus([]);
      }
    };

    loadToolStatus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const runAgent = async (question: string, overrideSelection?: string) => {
    if (!question.trim() || loading) return;

    const userMsg: AgentMessage = { id: `${Date.now()}-user`, role: 'user', content: question.trim() };
    const assistantId = `${Date.now()}-assistant`;
    const assistantMsg: AgentMessage = { id: assistantId, role: 'assistant', content: '', toolCalls: [], sources: [] };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/research-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          question: question.trim(),
          documentId,
          kbId,
          documentTitle,
          documentContent,
          documentUrl,
          selection: overrideSelection ?? selectedTextRef.current ?? '',
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Agent request failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applyEvent = (event: string, data: any) => {
        if (event === 'token') {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + (data.content || '') } : m));
        }
        if (event === 'tool') {
          setMessages(prev => prev.map((m) => {
            if (m.id !== assistantId) return m;
            const calls = m.toolCalls || [];
            const next = calls.some(c => c.id === data.id)
              ? calls.map(c => c.id === data.id ? { ...c, ...data } : c)
              : [...calls, data];
            return { ...m, toolCalls: next };
          }));
        }
        if (event === 'savedNote' && data.note) {
          onNoteSaved?.(data.note);
        }
        if (event === 'done') {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, sources: data.sources || m.sources } : m));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          const event = lines.find(line => line.startsWith('event: '))?.slice(7) || 'message';
          const dataLine = lines.find(line => line.startsWith('data: '));
          if (!dataLine) continue;
          try {
            applyEvent(event, JSON.parse(dataLine.slice(6)));
          } catch { /* ignore malformed event */ }
        }
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `请求失败：${err.message}` } : m));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (window as any).__researchAgentAsk = (question: string, selection?: string) => runAgent(question, selection);
    return () => { delete (window as any).__researchAgentAsk; };
  }, [documentId, kbId, documentTitle, documentContent, documentUrl, loading]);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">研究助手</h2>
        <p className="mt-1 line-clamp-2 text-xs text-gray-400">{documentTitle}</p>
      </div>

      <div className="border-b border-gray-100 px-3 py-2">
        {toolStatus.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {toolStatus.map((tool) => (
              <span
                key={tool.name}
                title={tool.detail}
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  tool.enabled ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {tool.enabled ? 'on' : 'needs config'} · {tool.name}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => runAgent(action.prompt)}
              disabled={loading}
              className="rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
        {selectedText && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            已选中：<span className="line-clamp-2 text-amber-800">{selectedText}</span>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm text-gray-400">可以问论文、查资料、搜知识库，也可以让助手保存笔记。</p>
            <p className="mt-1 text-xs text-gray-300">第一版工具：联网搜索、知识库、论文库、保存笔记、总结当前论文。</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${
              msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-800'
            }`}>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mb-2 space-y-1">
                  {msg.toolCalls.map((tool) => (
                    <div key={tool.id} className="rounded-md bg-white px-2 py-1 text-[10px] text-gray-500">
                      <span className="font-medium text-gray-700">{tool.name}</span>
                      <span className="ml-1">{tool.status === 'running' ? '运行中' : tool.status === 'done' ? '完成' : '失败'}</span>
                      {tool.result && <span className="ml-1 text-gray-400">{tool.result}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div
                className="whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: msg.role === 'assistant' ? renderLatexText(msg.content) : msg.content }}
              />
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 border-t border-gray-200 pt-2">
                  <p className="mb-1 text-[10px] font-medium text-gray-400">来源</p>
                  <div className="space-y-1">
                    {msg.sources.slice(0, 5).map((source, idx) => (
                      source.url ? (
                        <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="block text-[10px] text-blue-600 hover:text-blue-700">
                          [{idx + 1}] {source.title}
                        </a>
                      ) : (
                        <p key={source.id} className="text-[10px] text-gray-500">[{idx + 1}] {source.title}</p>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="text-xs text-gray-400">助手正在处理...</div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-gray-100 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runAgent(input)}
            placeholder="问论文、搜资料、保存笔记..."
            disabled={loading}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
          />
          <button
            type="button"
            onClick={() => runAgent(input)}
            disabled={loading || !input.trim()}
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
