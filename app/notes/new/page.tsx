'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import NoteEditor from '@/components/NoteEditor';

export default function NewNotePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [classId, setClassId] = useState<string>('');
  const [visibility, setVisibility] = useState<'public' | 'class'>('public');
  const [classes, setClasses] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);

      const { data: members } = await supabase
        .from('class_members')
        .select('class_id, classes(name)')
        .eq('user_id', u.id)
        .eq('status', 'approved');
      if (members) {
        setClasses(members.map((m: any) => ({
          id: m.class_id,
          name: m.classes?.name || m.class_id,
        })));
      }
    };
    init();
  }, []);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfLoading(true);
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/mineru', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (data.success && data.markdown) {
        setContent((prev) => prev + '\n' + data.markdown);
      } else {
        alert(data.error || 'PDF 解析失败');
      }
    } catch {
      alert('PDF 解析请求失败');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleSave = async (status: 'pending' | 'approved') => {
    if (!title.trim()) { alert('请输入笔记标题'); return; }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('notes').insert({
        user_id: user.id,
        title: title.trim(),
        content,
        tags,
        class_id: classId || null,
        visibility: classId ? 'class' : visibility,
        status,
      }).select().single();

      if (error) throw error;
      router.push('/notes');
      router.refresh();
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      {/* Title */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="笔记标题..."
        className="w-full text-3xl font-bold text-gray-900 placeholder-gray-300 outline-none mb-6 bg-transparent"
      />

      {/* Editor */}
      <NoteEditor content={content} onChange={setContent} />

      {/* Meta */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Tags */}
        <div>
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
              className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-blue-400"
            />
            <button onClick={addTag} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200">添加</button>
          </div>
        </div>

        {/* Class */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">班级（可选）</label>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs outline-none"
          >
            <option value="">公开</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Visibility */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">可见性</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'public' | 'class')}
            disabled={!!classId}
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs outline-none disabled:bg-gray-50"
          >
            <option value="public">公开</option>
            <option value="class">仅班级</option>
          </select>
          {classId && <p className="text-[10px] text-gray-400 mt-1">选择班级后自动设为仅班级可见</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handlePdfUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={pdfLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            {pdfLoading ? '解析中...' : '导入 PDF (MinerU)'}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleSave('pending')}
            disabled={saving}
            className="px-5 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            保存草稿
          </button>
          <button
            onClick={() => handleSave('approved')}
            disabled={saving}
            className="px-5 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            发布
          </button>
        </div>
      </div>
    </div>
  );
}
