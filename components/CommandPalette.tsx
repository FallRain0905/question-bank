'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentTheme, setCurrentTheme } from '@/lib/theme';

interface Command {
  label: string;
  href?: string;
  icon: string;
  keywords?: string;
  action?: () => void;
  group: string;
}

const COMMANDS: Command[] = [
  { group: '页面', icon: '🤖', label: 'Agent 工作台', href: '/agent', keywords: 'agent synapse 助手' },
  { group: '页面', icon: '🕘', label: 'Agent 运行历史', href: '/agent/history', keywords: 'history run 历史 记录' },
  { group: '页面', icon: '🔬', label: '研究', href: '/research', keywords: 'research 调研 报告' },
  { group: '页面', icon: '🔎', label: '搜索', href: '/search', keywords: 'search 检索' },
  { group: '页面', icon: '📚', label: '知识库', href: '/kb', keywords: 'knowledge base kb 文档' },
  { group: '页面', icon: '💬', label: '知识问答', href: '/qa', keywords: 'qa question answer 问答' },
  { group: '页面', icon: '📖', label: 'AI 阅读', href: '/reader', keywords: 'reader reading 阅读' },
  { group: '页面', icon: '📄', label: '论文库', href: '/papers', keywords: 'paper arxiv 论文' },
  { group: '页面', icon: '🕸️', label: '研究图谱', href: '/graph', keywords: 'graph 图谱 关系' },
  { group: '页面', icon: '📝', label: '题库', href: '/questions', keywords: 'question bank 题目' },
  { group: '页面', icon: '🗒️', label: '笔记', href: '/notes', keywords: 'note 笔记 记录' },
  { group: '工具', icon: '🔄', label: '文档转换', href: '/convert', keywords: 'convert mineru pdf' },
  { group: '工具', icon: '🎓', label: '英语训练', href: '/english', keywords: 'english 英语 单词' },
  { group: '账户', icon: '👤', label: '个人中心', href: '/me', keywords: 'profile me 个人 收藏' },
  { group: '账户', icon: '🔔', label: '通知', href: '/notifications', keywords: 'notification 通知 消息' },
  { group: '账户', icon: '⚙️', label: '设置', href: '/settings', keywords: 'settings 配置 api key' },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggleThemeCommand: Command = useMemo(() => {
    const dark = getCurrentTheme().isDark;
    return {
      group: '操作',
      icon: dark ? '☀️' : '🌙',
      label: dark ? '切换浅色模式' : '切换深色模式',
      keywords: 'theme dark light 主题 深色 浅色 暗色',
      action: () => {
        setCurrentTheme(dark ? 'light' : 'dark');
        setOpen(false);
      },
    };
  }, [open]);

  const allCommands: Command[] = useMemo(() => [...COMMANDS, toggleThemeCommand], [toggleThemeCommand]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(c => {
      const haystack = `${c.label} ${c.keywords || ''} ${c.href || ''} ${c.group}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query, allCommands]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
        setActiveIndex(0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      // Focus input after the modal paints
      const id = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const selectCommand = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      if (cmd.action) {
        cmd.action();
      } else if (cmd.href) {
        setOpen(false);
        router.push(cmd.href);
      }
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectCommand(filtered[activeIndex]);
    }
  };

  // Keep the active item scrolled into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  // Group filtered results by group label (preserving command order)
  const grouped: { group: string; items: Command[] }[] = [];
  for (const cmd of filtered) {
    const last = grouped[grouped.length - 1];
    if (last && last.group === cmd.group) last.items.push(cmd);
    else grouped.push({ group: cmd.group, items: [cmd] });
  }

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="关闭命令面板"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-4">
          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.35-5.65a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索页面或执行操作…"
            className="flex-1 bg-transparent py-3.5 text-sm text-gray-800 outline-none placeholder:text-gray-400"
          />
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">没有匹配的结果</div>
          ) : (
            grouped.map(g => (
              <div key={g.group} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  {g.group}
                </div>
                {g.items.map(cmd => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={`${cmd.label}-${idx}`}
                      type="button"
                      data-index={idx}
                      onClick={() => selectCommand(cmd)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-base">
                        {cmd.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                      {cmd.href && <span className="text-xs text-gray-300">{cmd.href}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1">↑↓</kbd> 选择
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1">↵</kbd> 打开
          </span>
          <span className="ml-auto">Cmd/Ctrl + K 唤起</span>
        </div>
      </div>
    </div>
  );
}
