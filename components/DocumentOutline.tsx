'use client';

import { useState, useMemo } from 'react';

interface Heading {
  id: string;
  level: number;
  text: string;
  children: Heading[];
}

function parseHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n');
  const headings: Heading[] = [];
  const stack: Heading[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim();
    const id = text.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/(^-|-$)/g, '');

    const heading: Heading = { id, level, text, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      headings.push(heading);
    } else {
      stack[stack.length - 1].children.push(heading);
    }
    stack.push(heading);
  }

  return headings;
}

interface DocumentOutlineProps {
  markdown: string;
  onNavigate?: (id: string) => void;
  activeId?: string;
}

export default function DocumentOutline({ markdown, onNavigate, activeId }: DocumentOutlineProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const headings = useMemo(() => parseHeadings(markdown), [markdown]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleClick = (id: string) => {
    onNavigate?.(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (headings.length === 0) {
    return (
      <div className="text-xs text-gray-400 py-8 text-center">
        文档中没有检测到标题结构
      </div>
    );
  }

  return <OutlineTree headings={headings} collapsed={collapsed} activeId={activeId} onToggle={toggleCollapse} onClick={handleClick} depth={0} />;
}

function OutlineTree({
  headings, collapsed, activeId, onToggle, onClick, depth,
}: {
  headings: Heading[];
  collapsed: Set<string>;
  activeId?: string;
  onToggle: (id: string) => void;
  onClick: (id: string) => void;
  depth: number;
}) {
  return (
    <ul className={`space-y-0 ${depth === 0 ? '' : ''}`}>
      {headings.map((h) => (
        <li key={h.id}>
          <button
            onClick={() => {
              if (h.children.length > 0) onToggle(h.id);
              onClick(h.id);
            }}
            className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2 rounded-md text-xs transition-colors hover:bg-gray-100 ${
              activeId === h.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600'
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            {h.children.length > 0 ? (
              <svg
                className={`w-3 h-3 shrink-0 transition-transform ${collapsed.has(h.id) ? '' : 'rotate-90'}`}
                fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="truncate">{h.text}</span>
          </button>
          {h.children.length > 0 && !collapsed.has(h.id) && (
            <OutlineTree headings={h.children} collapsed={collapsed} activeId={activeId} onToggle={onToggle} onClick={onClick} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
