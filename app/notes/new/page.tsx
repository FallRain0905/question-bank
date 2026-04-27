'use client';

import { useState, useEffect } from 'react';
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
  const [drafts, setDrafts] = useState<any[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [user, setUser] = useState<any>(null);

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

      // Load drafts
      const { data: draftData, error: draftErr } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', u.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (draftErr) console.error('Load drafts error:', draftErr);
      if (draftData) setDrafts(draftData);
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

  const handleImportDraft = (draft: any) => {
    const draftContent = draft.content || draft.description || '';
    if (!title) setTitle(draft.title || '');
    if (draftContent) setContent((prev) => prev ? prev + '\n\n' + draftContent : draftContent);
    setShowDrafts(false);
  };

  const handleSave = async (status: 'pending' | 'approved') => {
    if (!title.trim()) { alert('请输入笔记标题'); return; }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { data: noteData, error } = await supabase.from('notes').insert({
        user_id: user.id,
        title: title.trim(),
        description: content,
        class_id: classId || null,
        visibility: classId ? 'class' : visibility,
        status,
      }).select().single();

      if (error) throw error;

      // Save tags through junction table
      if (noteData && tags.length > 0) {
        const { data: existingTags } = await supabase
          .from('tags')
          .select('id, name')
          .in('name', tags);

        const tagMap = new Map((existingTags || []).map((t: any) => [t.name, t.id]));
        const tagInserts = [];
        for (const tagName of tags) {
          let tagId = tagMap.get(tagName);
          if (!tagId) {
            const { data: newTag } = await supabase
              .from('tags')
              .insert({ name: tagName })
              .select('id')
              .single();
            tagId = newTag?.id;
          }
          if (tagId) {
            tagInserts.push({ note_id: noteData.id, tag_id: tagId });
          }
        }
        if (tagInserts.length > 0) {
          await supabase.from('note_tags').insert(tagInserts);
        }
      }

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
          <label className="block text-xs font-medium text-gray-500 mb-1.5">团队（可选）</label>
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
            <option value="class">仅团队</option>
          </select>
          {classId && <p className="text-[10px] text-gray-400 mt-1">选择团队后自动设为仅团队可见</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-100">
        <div className="relative">
          <button
            onClick={() => setShowDrafts(!showDrafts)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            导入笔记草稿
          </button>
          {showDrafts && drafts.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto">
              <div className="px-3 py-2 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500">选择草稿导入</span>
              </div>
              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  onClick={() => handleImportDraft(draft)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <p className="text-sm font-medium text-gray-800 truncate">{draft.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{new Date(draft.created_at).toLocaleString('zh-CN')}</p>
                </button>
              ))}
            </div>
          )}
          {showDrafts && drafts.length === 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-4 text-center">
              <p className="text-xs text-gray-400">暂无草稿</p>
              <p className="text-[10px] text-gray-300 mt-1">在 AI 阅读器中"存至草稿箱"即可创建</p>
            </div>
          )}
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
