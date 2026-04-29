'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { renderMarkdown } from '@/lib/render-markdown';

interface KBItem {
  id: string;
  name: string;
  doc_count?: number;
}

interface Conversation {
  id: string;
  title: string;
  kb_id: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: {
    entities: any[];
    hyperedges: any[];
    text_units: any[];
  };
}

export default function QAPage() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KBItem[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [mode, setMode] = useState('hyper');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: { session } } = await supabase.auth.getSession();
      setToken(session?.access_token || null);

      const res = await fetch('/api/kb', { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (res.ok) {
        const data = await res.json();
        setKbs(data.map((kb: any) => ({ id: kb.id, name: kb.name, doc_count: kb.doc_count })));
        if (data.length > 0) setSelectedKb(data[0].id);
      }

      await loadConversations(session?.access_token);
    };
    init();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversations = async (t?: string) => {
    const authToken = t || token;
    if (!authToken) return;
    try {
      const res = await fetch('/api/hyperrag/conversations', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) setConversations(await res.json());
    } catch {}
  };

  const loadMessages = async (convId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/hyperrag/messages?conversation_id=${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: m.sources || undefined,
        })));
      }
    } catch {}
  };

  const saveMessage = async (convId: string, role: string, content: string, sources?: any) => {
    if (!token) return;
    try {
      await fetch('/api/hyperrag/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversation_id: convId, role, content, sources }),
      });
    } catch {}
  };

  const handleNewConversation = async () => {
    if (!token || !selectedKb) return;
    try {
      const res = await fetch('/api/hyperrag/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kb_id: selectedKb, mode }),
      });
      if (res.ok) {
        const conv = await res.json();
        setConversations(prev => [conv, ...prev]);
        setActiveConvId(conv.id);
        setMessages([]);
      }
    } catch {}
  };

  const handleSelectConversation = async (conv: Conversation) => {
    setActiveConvId(conv.id);
    setSelectedKb(conv.kb_id);
    setMode(conv.mode);
    await loadMessages(conv.id);
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定删除此对话？')) return;
    if (!token) return;
    try {
      await fetch(`/api/hyperrag/conversations?id=${convId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch {}
  };

  const handleRenameConversation = async (convId: string) => {
    if (!renameText.trim() || !token) {
      setRenamingId(null);
      return;
    }
    try {
      await fetch('/api/hyperrag/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: convId, title: renameText.trim() }),
      });
      setConversations(prev =>
        prev.map(c => c.id === convId ? { ...c, title: renameText.trim() } : c)
      );
    } catch {}
    setRenamingId(null);
  };

  const handleAsk = async () => {
    if (!input.trim() || loading || !selectedKb || !token) return;
    const question = input.trim();
    setInput('');
    setLoading(true);

    // Auto-create conversation if none active
    let convId = activeConvId;
    if (!convId) {
      try {
        const res = await fetch('/api/hyperrag/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kb_id: selectedKb, mode, title: question.slice(0, 30) + (question.length > 30 ? '...' : '') }),
        });
        if (res.ok) {
          const conv = await res.json();
          convId = conv.id;
          setActiveConvId(convId);
          setConversations(prev => [conv, ...prev]);
        }
      } catch {}
    }

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    if (convId) saveMessage(convId, 'user', question);

    try {
      const res = await fetch('/api/hyperrag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kb_id: selectedKb, question, mode }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '查询失败');

      const sources = {
        entities: data.entities || [],
        hyperedges: data.hyperedges || [],
        text_units: data.text_units || [],
      };
      const hasSources = sources.entities.length > 0 || sources.hyperedges.length > 0 || sources.text_units.length > 0;

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || '无法回答',
        sources: hasSources ? sources : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (convId) saveMessage(convId, 'assistant', assistantMsg.content, hasSources ? sources : undefined);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: (Date.now() + 1).toString(), role: 'assistant', content: `错误: ${err.message}`,
      };
      setMessages(prev => [...prev, errMsg]);
      if (convId) saveMessage(convId, 'assistant', errMsg.content);
    } finally {
      setLoading(false);
    }
  };

  const toggleSources = (msgId: string) => {
    setExpandedSources(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const modeOptions = [
    { value: 'hyper', label: 'Hyper' },
    { value: 'hyper-lite', label: 'Hyper-Lite' },
    { value: 'naive', label: 'Naive' },
    { value: 'graph', label: 'Graph' },
    { value: 'llm', label: 'LLM' },
  ];

  const filteredConvs = conversations.filter(c => c.kb_id === selectedKb);

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-7xl mx-auto">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
          <div className="p-3 border-b border-gray-100">
            <button onClick={handleNewConversation}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-700">
              + 新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConvs.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-xs">暂无对话</div>
            ) : (
              filteredConvs.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className={`group px-3 py-2.5 cursor-pointer border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    activeConvId === conv.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                  }`}
                >
                  {renamingId === conv.id ? (
                    <input
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => handleRenameConversation(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameConversation(conv.id);
                        if (e.key === 'Escape') setRenamingId(null);
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="w-full px-1.5 py-0.5 text-sm border border-blue-300 rounded outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 truncate flex-1">{conv.title}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(conv.id);
                          setRenameText(conv.title);
                        }}
                        className="text-gray-300 hover:text-blue-500 transition-colors"
                        title="重命名"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {new Date(conv.updated_at || conv.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex-1 flex flex-wrap items-center gap-3">
            <div className="min-w-[160px]">
              <select value={selectedKb} onChange={(e) => setSelectedKb(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none">
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
            </div>
            <div>
              <select value={mode} onChange={(e) => setMode(e.target.value)}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none">
                {modeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {selectedKb && (
              <Link href={`/kb/${selectedKb}`}
                className="text-xs text-blue-600 hover:text-blue-700">
                管理文档 →
              </Link>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {kbs.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 mb-2">请先创建知识库并上传文档</p>
              <Link href="/kb" className="text-sm text-blue-600 hover:text-blue-700">前往知识库</Link>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <p className="text-lg font-medium text-gray-300">Graph-RAG</p>
                  <p className="text-sm mt-2">选择知识库，输入问题开始提问</p>
                  <p className="text-xs text-gray-300 mt-1">支持跨文档检索，回答会附带来源溯源</p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                    msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-100'
                  }`}>
                    <div className={`text-sm whitespace-pre-wrap ${msg.role === 'assistant' ? 'text-gray-800 prose prose-sm max-w-none' : ''}`}
                      dangerouslySetInnerHTML={msg.role === 'assistant' ? { __html: renderMarkdown(msg.content) } : undefined}
                    >
                      {msg.role === 'user' ? msg.content : null}
                    </div>

                    {/* Source tracing */}
                    {msg.sources && (msg.sources.entities.length > 0 || msg.sources.text_units.length > 0 || msg.sources.hyperedges.length > 0) && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <button onClick={() => toggleSources(msg.id)}
                          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2">
                          <svg className={`w-3 h-3 transition-transform ${expandedSources[msg.id] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          检索溯源
                          <span className="ml-1 flex gap-1">
                            {msg.sources.entities.length > 0 && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px]">{msg.sources.entities.length} 实体</span>}
                            {msg.sources.hyperedges.length > 0 && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded-full text-[10px]">{msg.sources.hyperedges.length} 关系</span>}
                            {msg.sources.text_units.length > 0 && <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded-full text-[10px]">{msg.sources.text_units.length} 段落</span>}
                          </span>
                        </button>

                        {expandedSources[msg.id] && (
                          <div className="space-y-2 text-xs">
                            {/* Entities Panel */}
                            {msg.sources.entities.length > 0 && (
                              <details open className="bg-blue-50/50 rounded-lg overflow-hidden">
                                <summary className="px-3 py-2 bg-blue-50 cursor-pointer font-medium text-blue-700 flex items-center gap-2">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  实体 ({msg.sources.entities.length})
                                </summary>
                                <div className="p-2 space-y-1.5 max-h-48 overflow-y-auto">
                                  {msg.sources.entities.slice(0, 15).map((ent: any, i: number) => (
                                    <div key={i} className="bg-white rounded-md p-2">
                                      <div className="flex items-center gap-2 mb-0.5">
                                        <span className="font-medium text-gray-800">{ent.entity_name}</span>
                                        {ent.entity_type && (
                                          <span className="px-1 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">{ent.entity_type}</span>
                                        )}
                                      </div>
                                      {ent.description && <p className="text-gray-500 line-clamp-2">{ent.description}</p>}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            {/* Hyperedges Panel */}
                            {msg.sources.hyperedges.length > 0 && (
                              <details open className="bg-purple-50/50 rounded-lg overflow-hidden">
                                <summary className="px-3 py-2 bg-purple-50 cursor-pointer font-medium text-purple-700 flex items-center gap-2">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                  </svg>
                                  关系 ({msg.sources.hyperedges.length})
                                </summary>
                                <div className="p-2 space-y-1.5 max-h-48 overflow-y-auto">
                                  {msg.sources.hyperedges.slice(0, 10).map((edge: any, i: number) => (
                                    <div key={i} className="bg-white rounded-md p-2">
                                      <div className="flex flex-wrap gap-1 mb-1">
                                        {(Array.isArray(edge.entity_set) ? edge.entity_set : (edge.entity_set || '').split('|')).map((name: string, j: number) => (
                                          <span key={j} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px]">{name}</span>
                                        ))}
                                      </div>
                                      {edge.keywords && <p className="text-gray-500 text-[10px] mb-0.5">关键词: {Array.isArray(edge.keywords) ? edge.keywords.join(', ') : edge.keywords}</p>}
                                      {edge.description && <p className="text-gray-600 line-clamp-2">{edge.description}</p>}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            {/* Text Units Panel */}
                            {msg.sources.text_units.length > 0 && (
                              <details open className="bg-green-50/50 rounded-lg overflow-hidden">
                                <summary className="px-3 py-2 bg-green-50 cursor-pointer font-medium text-green-700 flex items-center gap-2">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  原文段落 ({msg.sources.text_units.length})
                                </summary>
                                <div className="p-2 space-y-1.5 max-h-96 overflow-y-auto">
                                  {msg.sources.text_units.map((unit: any, i: number) => (
                                    <div key={i} className="bg-white rounded-md p-2.5">
                                      <p className="text-gray-700 text-xs leading-relaxed whitespace-pre-wrap">{unit.content}</p>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
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
          )}
        </div>

        {/* Input */}
        <div className="border-t border-gray-100 bg-white px-4 py-3">
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAsk()}
              placeholder="输入问题..."
              disabled={loading}
              className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:border-gray-400 disabled:opacity-50"
            />
            <button
              onClick={handleAsk}
              disabled={loading || !input.trim() || !selectedKb}
              className="px-6 py-3 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
