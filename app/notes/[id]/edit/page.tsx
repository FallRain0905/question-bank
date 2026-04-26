'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import NoteEditor from '@/components/NoteEditor';

export default function EditNotePage() {
  const router = useRouter();
  const params = useParams();
  const noteId = params.id as string;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNote();
  }, [noteId]);

  const loadNote = async () => {
    const supabase = getSupabase();
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) { router.push('/login'); return; }

    const { data: note, error } = await supabase
      .from('notes')
      .select('*')
      .eq('id', noteId)
      .single();

    if (error || !note) {
      alert('笔记不存在');
      router.push('/notes');
      return;
    }
    if (note.user_id !== u.id) {
      alert('无权编辑此笔记');
      router.push('/notes');
      return;
    }

    setTitle(note.title || '');
    setContent(note.content || '');
    setTags(note.tags || []);
    setLoading(false);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) { setTags([...tags, t]); setTagInput(''); }
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const handleSave = async () => {
    if (!title.trim()) { alert('请输入笔记标题'); return; }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('notes').update({
        title: title.trim(),
        content,
        tags,
        updated_at: new Date().toISOString(),
      }).eq('id', noteId);

      if (error) throw error;
      router.push(`/notes/${noteId}`);
      router.refresh();
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="笔记标题..."
        className="w-full text-3xl font-bold text-gray-900 placeholder-gray-300 outline-none mb-6 bg-transparent"
      />

      <NoteEditor content={content} onChange={setContent} />

      <div className="mt-6">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">标签</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-red-500">&times;</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="添加标签..."
            className="flex-1 max-w-[200px] px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-blue-400"
          />
          <button onClick={addTag} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200">添加</button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-100">
        <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          ← 返回
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
