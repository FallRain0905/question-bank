'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { ReadingNote } from '@/types';

interface ReadingNotesPanelProps {
  documentId: string;
  documentTitle: string;
  documentUrl?: string;
  selectedText?: string;
  injectedNote?: ReadingNote | null;
}

export default function ReadingNotesPanel({
  documentId,
  documentTitle,
  documentUrl,
  selectedText,
  injectedNote,
}: ReadingNotesPanelProps) {
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const authHeaders = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    };
  };

  const loadNotes = async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/reading-notes?document_id=${documentId}`, { headers });
      if (res.ok) setNotes(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [documentId]);

  useEffect(() => {
    if (!injectedNote) return;
    setNotes(prev => [injectedNote, ...prev.filter(note => note.id !== injectedNote.id)]);
  }, [injectedNote]);

  const resetDraft = () => {
    setTitle('');
    setContent('');
    setEditingId(null);
  };

  const createFromSelection = () => {
    if (!selectedText) return;
    setEditingId(null);
    setTitle(selectedText.slice(0, 40));
    setContent(selectedText);
  };

  const saveDraft = async () => {
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      const headers = await authHeaders();
      const payload = {
        id: editingId,
        document_id: documentId,
        title: title.trim() || documentTitle || 'Reading note',
        content: content.trim(),
        selected_text: selectedText || null,
        source_url: documentUrl || null,
        metadata: { document_title: documentTitle },
      };
      const res = await fetch('/api/reading-notes', {
        method: editingId ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const saved = await res.json();
        setNotes(prev => editingId
          ? prev.map(note => note.id === saved.id ? saved : note)
          : [saved, ...prev]);
        resetDraft();
      }
    } finally {
      setSaving(false);
    }
  };

  const editNote = (note: ReadingNote) => {
    setEditingId(note.id);
    setTitle(note.title);
    setContent(note.content);
  };

  const deleteNote = async (id: string) => {
    const headers = await authHeaders();
    const res = await fetch(`/api/reading-notes?id=${id}`, { method: 'DELETE', headers });
    if (res.ok) setNotes(prev => prev.filter(note => note.id !== id));
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">随手笔记</h2>
        <p className="mt-1 text-xs text-gray-400">{notes.length} 条私人记录</p>
      </div>

      <div className="border-b border-gray-100 p-3">
        {selectedText && (
          <button
            type="button"
            onClick={createFromSelection}
            className="mb-2 w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-700 hover:bg-amber-100"
          >
            用选中文段新建笔记
          </button>
        )}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题"
          className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="随手记录想法、疑问、摘录..."
          rows={5}
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={resetDraft} className="text-xs text-gray-400 hover:text-gray-600">
            清空
          </button>
          <button
            type="button"
            onClick={saveDraft}
            disabled={saving || (!title.trim() && !content.trim())}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {editingId ? '保存修改' : '保存笔记'}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-400">加载中...</p>
        ) : notes.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-400">还没有笔记</p>
            <p className="mt-1 text-xs text-gray-300">读到有意思的地方，顺手记在这里。</p>
          </div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 text-sm font-medium text-gray-900">{note.title}</h3>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => editNote(note)} className="text-xs text-gray-400 hover:text-blue-600">编辑</button>
                  <button onClick={() => deleteNote(note.id)} className="text-xs text-gray-400 hover:text-red-500">删除</button>
                </div>
              </div>
              {note.selected_text && (
                <p className="mb-2 line-clamp-3 rounded-lg bg-white px-2 py-1.5 text-xs text-gray-500">{note.selected_text}</p>
              )}
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700">{note.content}</p>
              <p className="mt-2 text-[10px] text-gray-400">{new Date(note.updated_at || note.created_at).toLocaleString('zh-CN')}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

