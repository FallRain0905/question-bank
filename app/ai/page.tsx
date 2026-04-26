'use client';

import { useState, useEffect, useRef } from 'react';

interface Dimension {
  width: number;
  height: number;
}

// Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: string; // Single image URL from Qwen
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const MODEL_OPTIONS = [
  { id: 'qwen-vl-max-latest', name: '千问-VL-Max', description: '最强图文性能' },
  { id: 'qwen-vl-plus', name: '千问-VL-Plus', description: '图文对话模型' },
  { id: 'qwen-plus', name: '千问-Plus', description: '纯文本模型' },
];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default function AIPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('qwen-vl-max-latest');
  const [showModelSelect, setShowModelSelect] = useState(false);

  // 可调节尺寸功能
  const [isResizing, setIsResizing] = useState(false);
  const [chatWidth, setChatWidth] = useState(384);
  const [chatHeight, setChatHeight] = useState(512);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载尺寸设置
  useEffect(() => {
    const savedDimensions = localStorage.getItem('ai-chat-dimensions');
    if (savedDimensions) {
      const dims = JSON.parse(savedDimensions) as Dimension;
      setChatWidth(dims.width);
      setChatHeight(dims.height);
    }
  }, []);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // Initialize sessions from localStorage
  useEffect(() => {
    loadSessions();
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  const loadSessions = () => {
    try {
      const stored = localStorage.getItem('qwen_chat_sessions');
      if (stored) {
        const parsed = JSON.parse(stored);
        setSessions(parsed);
        if (!currentSessionId && parsed.length > 0) {
          setCurrentSessionId(parsed[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const saveSessions = (newSessions: ChatSession[]) => {
    try {
      localStorage.setItem('qwen_chat_sessions', JSON.stringify(newSessions));
    } catch (error) {
      console.error('Failed to save sessions:', error);
    }
  };

  const createNewSession = () => {
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
  };

  const deleteSession = (sessionId: string) => {
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    if (currentSessionId === sessionId) {
      setCurrentSessionId(newSessions.length > 0 ? newSessions[0].id : null);
    }
    saveSessions(newSessions);
  };

  // Create session if none exists
  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
    }
  }, [sessions.length]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (limit to 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过5MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImages([reader.result as string]);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setUploadedImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const addMessageToSession = (
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    image?: string
  ): ChatMessage => {
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
        let newTitle = s.title;
        if (role === 'user' && s.messages.length === 0) {
          newTitle = content.slice(0, 20) || '新对话';
        }
        return {
          ...s,
          messages: newMessages,
          title: newTitle,
          updatedAt: Date.now(),
        };
      }
      return s;
    });

    setSessions(newSessions);
    saveSessions(newSessions);
    return message;
  };

  // 发送消息
  const handleSendMessage = async () => {
    const message = inputMessage.trim();
    if ((!message && uploadedImages.length === 0) || isLoading || !currentSession) {
      console.log('无法发送：没有消息或图片，或正在加载中');
      return;
    }

    // Save message and images BEFORE clearing state
    const savedMessage = message;
    const savedImages = uploadedImages.length > 0 ? [uploadedImages[0]] : [];

    console.log('准备发送消息:', { message: savedMessage, images: savedImages });

    // 添加用户消息
    addMessageToSession(currentSession.id, 'user', savedMessage, savedImages[0] || undefined);
    setInputMessage('');
    setUploadedImages([]);

    setIsLoading(true);

    try {
      // Get the updated session with the new message
      const updatedSession = sessions.find(s => s.id === currentSession.id);

      // 准备发送的历史消息
      const messagesToSend: any[] = [];

      if (updatedSession) {
        for (const msg of updatedSession.messages) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messagesToSend.push({
              role: msg.role,
              content: msg.content,
              ...(msg.image ? { image: msg.image } : {}),
            });
          }
        }
      }

      // 添加当前用户消息到发送列表（因为刚添加但可能还未反映在updatedSession中）
      if (savedImages.length > 0 || savedMessage) {
        const lastMessage = messagesToSend[messagesToSend.length - 1];
        if (!lastMessage || lastMessage.content !== savedMessage) {
          messagesToSend.push({
            role: 'user',
            content: savedMessage,
            ...(savedImages[0] ? { image: savedImages[0] } : {}),
          });
        }
      }

      console.log('发送请求，消息数量:', messagesToSend.length);

      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesToSend,
          model: selectedModel,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API错误响应:', errorText);
        throw new Error(`API返回错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('API响应:', data);

      // 千问API返回格式: { content: string, image?: string }
      const content = data.content || '抱歉，我无法回答这个问题。';
      const image = data.image; // 千问可能返回的图片URL

      console.log('助手内容:', content?.substring(0, 100));
      console.log('是否有图片返回:', image ? '是' : '否');

      // 添加助手回复
      addMessageToSession(currentSession.id, 'assistant', content, image);
      loadSessions();
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorMsg = error?.message || '抱歉，发生了一些错误，请稍后再试。';
      addMessageToSession(currentSession.id, 'assistant', `错误：${errorMsg}`);
      loadSessions();
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // SVG Icons
  const SendIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  );

  const PlusIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );

  const TrashIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );

  const ImageIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );

  const XIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  const ResizeIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3h6v6h-6M9 9h6M9 3h6v6h-6m6 6h-6v-6h6" />
    </svg>
  );

  // 保存尺寸到 localStorage
  const saveDimensions = () => {
    localStorage.setItem('ai-chat-dimensions', JSON.stringify({ width: chatWidth, height: chatHeight }));
  };

  // 开始调整尺寸
  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height
    });
    setIsResizing(true);
  };

  // 调整尺寸中
  const handleResizeMove = (e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;

    const newWidth = Math.max(300, Math.min(1200, resizeStart.width + deltaX)); // 最小300px，最大1200px
    const newHeight = Math.max(400, Math.min(900, resizeStart.height + deltaY)); // 最小400px，最大900px

    setChatWidth(newWidth);
    setChatHeight(newHeight);
  };

  // 结束调整尺寸
  const handleResizeEnd = () => {
    if (isResizing) {
      setIsResizing(false);
      saveDimensions();
    }
  };

  // 添加鼠标事件监听
  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing, resizeStart]);

  const BotIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );

  const UserIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );

  const ChevronDownIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  return (
    <div
      className={`flex flex-col h-[calc(100vh-64px)] ${isResizing ? 'select-none' : ''}`}
    >
      {/* Header */}
      <div className="glass-card mx-4 mt-4 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="glass-icon glass-float !w-12 !h-12 !rounded-xl !p-2.5">
            <BotIcon />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">千问AI助手</h1>
            <p className="text-sm text-gray-400">智能问答，图文对话</p>
          </div>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowModelSelect(!showModelSelect)}
            className="glass-button px-4 py-2 flex items-center gap-2 text-sm"
          >
            {MODEL_OPTIONS.find(m => m.id === selectedModel)?.name || '选择模型'}
            <ChevronDownIcon />
          </button>
          {showModelSelect && (
            <div className="absolute right-0 mt-2 w-48 glass-card py-2 z-50">
              {MODEL_OPTIONS.map(option => (
                <button
                  key={option.id}
                  onClick={() => {
                    setSelectedModel(option.id);
                    setShowModelSelect(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-800 transition"
                >
                  <div className="text-gray-100 text-sm">{option.name}</div>
                  <div className="text-gray-500 text-xs">{option.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar - Session History */}
        <div className="hidden lg:block w-64 border-r border-gray-800 bg-gray-900 overflow-y-auto">
          {/* 调整尺寸按钮 */}
          <button
            onClick={() => {
              // 重置到默认尺寸
              setChatWidth(384);
              setChatHeight(512);
              saveDimensions();
            }}
            className="fixed top-20 right-4 lg:right-[280px] glass-button p-2 rounded-lg z-50 flex items-center gap-2 hover:bg-gray-800 transition"
            title="重置对话框尺寸"
          >
            <ResizeIcon />
            <span className="text-xs">重置尺寸</span>
          </button>
        </div>
          <div className="p-4">
            <button
              onClick={createNewSession}
              className="w-full glass-button flex items-center justify-center gap-2 py-2"
            >
              <PlusIcon />
              新对话
            </button>
          </div>
          <div className="space-y-1 px-2">
            {sessions.map(session => (
              <div
                key={session.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition ${
                  session.id === currentSessionId
                    ? 'bg-gray-700 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
                onClick={() => setCurrentSessionId(session.id)}
              >
                <div className="flex-1 truncate text-sm">{session.title}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Main Chat Area */}
        <div
          className="flex-1 flex flex-col overflow-hidden relative"
          style={{ width: `${chatWidth}px`, height: `${chatHeight}px` }}
        >
          {/* 右下角尺寸调整手柄 */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize hover:bg-gray-800 transition flex items-center justify-center rounded-tl z-10"
            title="拖动调整尺寸"
          >
            <div className="w-0.5 h-0.5 bg-gray-400 rounded-full"></div>
            <div className="w-0.5 h-3 bg-gray-400 rounded"></div>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {currentSession?.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <div className="glass-icon glass-float mb-4">
                  <BotIcon />
                </div>
                <p className="text-lg mb-2">开始与千问AI对话</p>
                <p className="text-sm">支持文本输入和图片上传</p>
              </div>
            ) : (
              currentSession?.messages.map(message => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex max-w-[80%] gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-shrink-0 glass-icon !w-8 !h-8 !rounded-lg !p-1.5`}>
                      {message.role === 'user' ? <UserIcon /> : <BotIcon />}
                    </div>
                    <div className={`glass-card p-3 ${message.role === 'user' ? 'bg-gray-700' : 'bg-gray-800'}`}>
                      {message.image && (
                        <img
                          src={message.image}
                          alt="Attachment"
                          className="max-w-[200px] sm:max-w-[300px] rounded-lg mb-2 object-contain"
                        />
                      )}
                      <p className="text-gray-100 whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-gray-800 bg-gray-900 flex-shrink-0">
            {uploadedImages.length > 0 && (
              <div className="mb-3 flex items-center gap-3">
                <div className="relative">
                  <img
                    src={uploadedImages[0]}
                    alt="Uploaded"
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                  <button
                    onClick={removeImage}
                    className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 hover:bg-red-600 transition"
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            )}
            <div className="glass-card flex items-end gap-2 p-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 hover:bg-gray-800 rounded-lg transition"
                title="上传图片"
              >
                <ImageIcon />
              </button>
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter发送，Shift+Enter换行)"
                className="flex-1 bg-transparent resize-none outline-none text-gray-100 placeholder-gray-500 py-2 max-h-32"
                rows={1}
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || (!inputMessage.trim() && uploadedImages.length === 0)}
                className="p-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition disabled:opacity-50"
              >
                {isLoading ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <SendIcon />
                )}
              </button>
            </div>
          </div>
        </div>

      {/* Mobile New Session Button */}
      <button
        onClick={createNewSession}
        className="lg:hidden fixed bottom-20 right-4 glass-button p-3 rounded-full z-40"
      >
        <PlusIcon />
      </button>
    </div>
  );
}
