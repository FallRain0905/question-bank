'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSupabase } from '@/lib/supabase';

const STORAGE_KEY = 'english_sessions';

const SCENARIOS = [
  { id: 'free', label: '自由对话', icon: '💬' },
  { id: 'travel', label: '旅行', icon: '✈️' },
  { id: 'business', label: '商务', icon: '💼' },
  { id: 'daily', label: '日常', icon: '🏠' },
  { id: 'academic', label: '学术', icon: '🎓' },
];

interface Message {
  id: string;
  role: 'user' | 'partner';
  content: string;
  timestamp: number;
}

interface EnglishSession {
  id: string;
  scenario: string;
  messages: Message[];
  vocabulary: string[];
  createdAt: number;
  updatedAt: number;
}

function generateId() { return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`; }

export default function EnglishPage() {
  const [sessions, setSessions] = useState<EnglishSession[]>([]);
  const [sid, setSid] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [assistInput, setAssistInput] = useState('');
  const [assistReply, setAssistReply] = useState('');
  const [assistLoading, setAssistLoading] = useState(false);
  const [autoSuggestion, setAutoSuggestion] = useState<{ type: string; original: string; suggestion: string; note: string } | null>(null);
  const [vocab, setVocab] = useState<string[]>([]);
  const [assistOpen, setAssistOpen] = useState(true);
  const [showSessions, setShowSessions] = useState(false);
  const sessionsMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const session = sessions.find(s => s.id === sid);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      setSessions(parsed);
      if (parsed.length > 0) setSid(parsed[0].id);
    }
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [session?.messages]);

  useEffect(() => {
    if (!showSessions) return;
    const close = (e: MouseEvent) => {
      if (sessionsMenuRef.current && !sessionsMenuRef.current.contains(e.target as Node)) setShowSessions(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showSessions]);

  const save = (s: EnglishSession[]) => {
    setSessions(s);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  };

  const newSession = (scenario: string) => {
    const s: EnglishSession = { id: generateId(), scenario, messages: [], vocabulary: [], createdAt: Date.now(), updatedAt: Date.now() };
    save([s, ...sessions]);
    setSid(s.id);
    setAssistReply('');
  };

  const handleSend = async () => {
    if (!input.trim() || !session) return;
    const msg: Message = { id: generateId(), role: 'user', content: input, timestamp: Date.now() };
    const updated = sessions.map(s => s.id === session.id ? { ...s, messages: [...s.messages, msg], updatedAt: Date.now() } : s);
    save(updated);
    setInput('');
    setChatLoading(true);

    try {
      const sb = getSupabase();
      const { data: { session: authSession } } = await sb.auth.getSession();
      const res = await fetch('/api/english/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession?.access_token}` },
        body: JSON.stringify({ messages: [...session.messages, msg].map(m => ({ role: m.role === 'partner' ? 'assistant' : 'user', content: m.content })), scenario: session.scenario }),
      });
      const d = await res.json();
      if (d.reply) {
        const reply: Message = { id: generateId(), role: 'partner', content: d.reply, timestamp: Date.now() };
        const withMsgReply = [...session.messages, msg, reply];
        const withReply = sessions.map(s => s.id === session.id ? { ...s, messages: withMsgReply, updatedAt: Date.now() } : s);
        save(withReply);
        // Auto-analyze user's message
        autoAnalyze(withMsgReply, withReply);
      }
    } catch { /* ignore */ }
    finally { setChatLoading(false); }
  };

  const autoAnalyze = async (msgs: Message[], currentSessions: EnglishSession[]) => {
    if (!session) return;
    try {
      const sb = getSupabase();
      const { data: { session: authSession } } = await sb.auth.getSession();
      const res = await fetch('/api/english/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession?.access_token}` },
        body: JSON.stringify({
          mode: 'auto',
          conversation: msgs.map(m => ({ role: m.role === 'partner' ? 'assistant' : 'user', content: m.content })),
        }),
      });
      const d = await res.json();
      if (d.suggestion && d.suggestion.type !== 'none') {
        setAutoSuggestion(d.suggestion);
      } else {
        setAutoSuggestion(null);
      }
    } catch { /* ignore */ }
  };

  const handleAssist = async () => {
    if (!assistInput.trim() || !session) return;
    setAssistLoading(true);
    setAssistReply('');
    try {
      const sb = getSupabase();
      const { data: { session: authSession } } = await sb.auth.getSession();
      const res = await fetch('/api/english/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession?.access_token}` },
        body: JSON.stringify({ question: assistInput, conversation: session.messages.map(m => ({ role: m.role === 'partner' ? 'assistant' : 'user', content: m.content })) }),
      });
      const d = await res.json();
      if (d.reply) {
        setAssistReply(d.reply);
        // Extract potential vocabulary
        const words = d.reply.match(/`(\w+)`|"(\w+)"/g)?.map((w: string) => w.replace(/[`"]/g, '').toLowerCase()) || [];
        if (words.length > 0) {
          const newVocab = [...new Set([...vocab, ...words])];
          setVocab(newVocab);
          save(sessions.map(s => s.id === session.id ? { ...s, vocabulary: newVocab } : s));
        }
      }
      setAssistInput('');
    } catch { /* ignore */ }
    finally { setAssistLoading(false); }
  };

  return (
    <div className="flex h-[calc(100vh-1px)]">
      {/* Left Panel - Conversation */}
      <div className="flex flex-col flex-1 min-w-0 border-r border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-900 shrink-0">英语对话</h1>

            {/* Session selector */}
            <div className="relative" ref={sessionsMenuRef}>
              <button
                onClick={() => setShowSessions(!showSessions)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {session ? SCENARIOS.find(s => s.id === session.scenario)?.icon : '💬'}
                <span className="max-w-[100px] truncate">{session ? SCENARIOS.find(s => s.id === session.scenario)?.label : '无会话'}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showSessions && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                  {sessions.map(s => (
                    <div
                      key={s.id}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors cursor-pointer ${
                        s.id === sid ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      onClick={() => { setSid(s.id); setShowSessions(false); setAutoSuggestion(null); setAssistReply(''); }}
                    >
                      <span className="truncate flex-1 text-left">
                        {SCENARIOS.find(sc => sc.id === s.scenario)?.icon} {SCENARIOS.find(sc => sc.id === s.scenario)?.label}
                      </span>
                      <span className="text-gray-300 mx-2">{s.messages.length}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const updated = sessions.filter(x => x.id !== s.id);
                          save(updated);
                          if (sid === s.id) setSid(updated.length > 0 ? updated[0].id : null);
                        }}
                        className="text-gray-300 hover:text-red-500 transition-colors p-0.5"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-gray-100 pt-1 mt-1">
                    <button
                      onClick={() => { newSession('free'); setShowSessions(false); }}
                      className="w-full px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      新建对话
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scenario tabs */}
            <div className="flex gap-1 overflow-x-auto">
              {SCENARIOS.map(sc => (
                <button
                  key={sc.id}
                  onClick={() => newSession(sc.id)}
                  className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                    session?.scenario === sc.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {sc.icon} {sc.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-gray-50/50">
          {!session || session.messages.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-3xl mb-3">🗣️</p>
              <p className="text-gray-500 text-sm">选择一个场景开始练习英语</p>
              <p className="text-gray-300 text-xs mt-1">AI 会用纯英文与你对话，并自然纠正语法错误</p>
            </div>
          ) : (
            <AnimatePresence>
              {session.messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="flex items-start gap-2.5 max-w-[75%]">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
                      m.role === 'user' ? 'bg-gray-900 text-white order-2' : 'bg-blue-100 text-blue-600'
                    }`}>
                      {m.role === 'user' ? '我' : 'AI'}
                    </div>
                    <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-gray-900 text-white rounded-br-md'
                        : 'bg-white border border-gray-100 text-gray-800 rounded-bl-md shadow-sm'
                    }`}>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl rounded-bl-md shadow-sm">
                <span className="text-sm text-gray-400 animate-pulse">typing...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-100 bg-white shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={session ? 'Type your message in English...' : 'Select a scenario first'}
              disabled={!session}
              className="flex-1 px-4 py-2.5 bg-gray-50 border-0 rounded-xl text-sm outline-none focus:ring-1 focus:ring-gray-300 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={chatLoading || !input.trim() || !session}
              className="px-5 py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel - Assistant */}
      <div className={`${assistOpen ? 'w-80' : 'w-0'} transition-all duration-200 flex flex-col bg-white shrink-0 overflow-hidden`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <span className="text-sm font-medium text-gray-700">语言助手</span>
          <button onClick={() => setAssistOpen(!assistOpen)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={assistOpen ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Auto suggestion */}
          {autoSuggestion && (
            <div className={`rounded-xl p-3 ${
              autoSuggestion.type === 'expression' ? 'bg-amber-50 border border-amber-100' : 'bg-red-50 border border-red-100'
            }`}>
              <p className="text-[10px] font-medium text-amber-600 mb-1 uppercase tracking-wider">
                {autoSuggestion.type === 'expression' ? '✨ 地道表达' : '📝 语法建议'}
              </p>
              <p className="text-xs text-gray-400 line-through mb-1">{autoSuggestion.original}</p>
              <p className="text-sm text-gray-800 font-medium">{autoSuggestion.suggestion}</p>
              {autoSuggestion.note && (
                <p className="text-xs text-gray-400 mt-1">{autoSuggestion.note}</p>
              )}
            </div>
          )}

          <div className="text-xs text-gray-400 space-y-1">
            <p>💡 随时问我：</p>
            <p>· 这个词什么意思？</p>
            <p>· 这句话怎么说更好？</p>
            <p>· 我的语法对吗？</p>
          </div>

          {assistReply && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-sm text-blue-800 whitespace-pre-wrap leading-relaxed">{assistReply}</p>
            </div>
          )}

          {session && session.vocabulary.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">📖 生词本</p>
              <div className="flex flex-wrap gap-1.5">
                {session.vocabulary.map((w, i) => (
                  <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{w}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-100 shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={assistInput}
              onChange={(e) => setAssistInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAssist()}
              placeholder={session ? '询问语言助手...' : '---'}
              disabled={!session}
              className="flex-1 px-3 py-2 bg-gray-50 border-0 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-50"
            />
            <button
              onClick={handleAssist}
              disabled={assistLoading || !assistInput.trim() || !session}
              className="px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {assistLoading ? '...' : '提问'}
            </button>
          </div>
        </div>
      </div>

      {/* Collapse toggle when closed */}
      {!assistOpen && (
        <button
          onClick={() => setAssistOpen(true)}
          className="fixed right-4 top-1/2 -translate-y-1/2 z-40 w-8 h-20 bg-white border border-gray-200 rounded-l-lg flex items-center justify-center hover:bg-gray-50 shadow-sm"
        >
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}
