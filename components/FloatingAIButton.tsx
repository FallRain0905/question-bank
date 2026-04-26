'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { getSupabase } from '@/lib/supabase';

const STORAGE_KEY = 'qwen_chat_sessions';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: string;
  timestamp: number;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default function FloatingAIButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionsMenuRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // 首次打开时加载会话
  useEffect(() => {
    if (isOpen && !loaded) {
      loadSessions();
      setLoaded(true);
    }
  }, [isOpen]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  // 点击外部关闭会话菜单
  useEffect(() => {
    if (!showSessions) return;
    const handleClick = (e: MouseEvent) => {
      if (sessionsMenuRef.current && !sessionsMenuRef.current.contains(e.target as Node)) {
        setShowSessions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSessions]);

  const loadSessions = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: ChatSession[] = JSON.parse(stored);
        setSessions(parsed);
        if (parsed.length > 0) {
          setCurrentSessionId(parsed[0].id);
        }
      }
    } catch {
      // ignore
    }
  };

  const saveSessions = (newSessions: ChatSession[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSessions));
    } catch {
      // ignore
    }
  };

  const createSession = () => {
    const newSession: ChatSession = {
      id: generateId(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const newSessions = [newSession, ...sessions];
    setSessions(newSessions);
    setCurrentSessionId(newSession.id);
    saveSessions(newSessions);
    setShowSessions(false);
  };

  const deleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    if (currentSessionId === sessionId) {
      setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
    }
    saveSessions(newSessions);
  };

  const addMessageToSession = (sessionId: string, role: 'user' | 'assistant', content: string, image?: string) => {
    const message: ChatMessage = {
      id: generateId(),
      role,
      content,
      ...(image ? { image } : {}),
      timestamp: Date.now(),
    };

    const newSessions = sessions.map(s => {
      if (s.id === sessionId) {
        const newMessages = [...s.messages, message];
        const newTitle = role === 'user' && s.messages.length === 0
          ? (content.slice(0, 20) || '新对话')
          : s.title;
        return { ...s, messages: newMessages, title: newTitle, updatedAt: Date.now() };
      }
      return s;
    });

    setSessions(newSessions);
    saveSessions(newSessions);
  };

  const renderLatex = (text: string) => {
    let result = text.replace(/\$([^$]+)\$/g, (match, latex) => {
      try { return katex.renderToString(latex, { throwOnError: false }); }
      catch { return match; }
    });
    result = result.replace(/\$\$([^$]+)\$\$/g, (match, latex) => {
      try { return katex.renderToString(latex, { throwOnError: false, displayMode: true }); }
      catch { return match; }
    });
    result = result.replace(/\\\[([\s\S]+?)\\\]/g, (match, latex) => {
      try { return katex.renderToString(latex, { throwOnError: false, displayMode: true }); }
      catch { return match; }
    });
    result = result.replace(/\\\(([\s\S]+?)\\\)/g, (match, latex) => {
      try { return katex.renderToString(latex, { throwOnError: false }); }
      catch { return match; }
    });
    return result;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setScreenshot(event.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if ((!input.trim() && !screenshot) || !currentSession) return;

    // 确保 session 存在
    if (!currentSessionId) return;

    const savedInput = input;
    const savedImage = screenshot;

    addMessageToSession(currentSessionId, 'user', savedInput, savedImage || undefined);
    setInput('');
    setScreenshot(null);
    setLoading(true);

    try {
      // 构建消息历史
      const session = sessions.find(s => s.id === currentSessionId);
      const messagesToSend = (session?.messages || []).map(m => ({
        role: m.role,
        content: m.content,
        ...(m.image ? { image: m.image } : {}),
      }));

      if (savedInput || savedImage) {
        messagesToSend.push({
          role: 'user',
          content: savedInput,
          ...(savedImage ? { image: savedImage } : {}),
        });
      }

      const sb = getSupabase();
      const { data: { session: authSession } } = await sb.auth.getSession();
      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession?.access_token}`,
        },
        body: JSON.stringify({
          messages: messagesToSend,
          temperature: 0.7,
        }),
      });

      const data = await response.json();
      addMessageToSession(currentSessionId, 'assistant', data.answer || '抱歉，我暂时无法回答这个问题。');
    } catch {
      alert('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* 浮动按钮 */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gray-900 rounded-2xl shadow-lg hover:shadow-xl flex items-center justify-center"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="AI 助手"
      >
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          {isOpen ? (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          )}
        </motion.div>

        {!isOpen && (
          <motion.span
            className="absolute inset-0 rounded-2xl ring-1 ring-gray-400/20"
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </motion.button>

      {/* 对话框 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed z-40 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col"
            style={{ bottom: '6rem', right: '1.5rem', width: '480px', maxWidth: 'calc(100vw - 2rem)', height: '600px', maxHeight: 'calc(100vh - 10rem)' }}
          >
            {/* 标题栏 + 会话选择器 */}
            <div className="bg-gray-900 px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 relative" ref={sessionsMenuRef}>
                <svg className="w-5 h-5 text-white shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>

                {/* 会话选择按钮 */}
                <button
                  onClick={() => setShowSessions(!showSessions)}
                  className="flex items-center gap-1 text-white hover:text-white/80 transition-colors"
                >
                  <span className="text-sm font-medium max-w-[160px] truncate">
                    {currentSession?.title || '新对话'}
                  </span>
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 会话下拉菜单 */}
                <AnimatePresence>
                  {showSessions && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50"
                    >
                      <div className="px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                        会话
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {sessions.map(s => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setCurrentSessionId(s.id);
                              setShowSessions(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                              s.id === currentSessionId
                                ? 'bg-blue-50 text-blue-600'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <span className="truncate flex-1 text-left">{s.title}</span>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <span className="text-[10px] text-gray-300">
                                {s.messages.length}
                              </span>
                              <svg
                                onClick={(e) => deleteSession(s.id, e)}
                                className="w-3.5 h-3.5 text-gray-300 hover:text-red-500 transition-colors"
                                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button
                          onClick={createSession}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          新建会话
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="text-white/60 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!currentSession || currentSession.messages.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-12">
                  <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                  <p>有问题随时问我</p>
                  <p className="text-xs mt-1 text-gray-300">可以提问、上传图片截图</p>
                </div>
              ) : (
                <AnimatePresence>
                  {currentSession.messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {msg.image && (
                          <img src={msg.image} alt="" className="max-w-full rounded-lg mb-2" />
                        )}
                        <div
                          className="whitespace-pre-wrap prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: msg.role === 'assistant' ? renderLatex(msg.content) : msg.content,
                          }}
                        />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 rounded-xl px-4 py-2 text-sm">
                    <motion.span
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      思考中...
                    </motion.span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 截图预览 */}
            {screenshot && (
              <div className="px-4 pb-2 shrink-0">
                <div className="relative inline-block">
                  <img src={screenshot} alt="" className="h-16 rounded-lg border border-gray-200" />
                  <button
                    onClick={() => setScreenshot(null)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-900 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {/* 输入区 */}
            <div className="p-3 border-t border-gray-100 shrink-0">
              <div className="flex items-center gap-1 mb-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="上传图片"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handleSend()}
                  placeholder={currentSession ? '输入问题...' : '创建会话后即可提问'}
                  disabled={!currentSession}
                  className="flex-1 px-3 py-2 bg-gray-50 border-0 rounded-lg text-sm outline-none focus:ring-1 focus:ring-gray-300 disabled:text-gray-300"
                />
                <button
                  onClick={handleSend}
                  disabled={loading || (!input.trim() && !screenshot) || !currentSession}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  发送
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
