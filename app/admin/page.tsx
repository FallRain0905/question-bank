'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { getFileIcon, formatFileSize, deleteFile } from '@/lib/upload';
import type { QuestionWithTags, NoteWithTags } from '@/types';

type ContentType = 'questions' | 'notes';
type ItemStatus = 'pending' | 'approved' | 'rejected';

export default function AdminPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isClassModerator, setIsClassModerator] = useState(false);
  const [userClasses, setUserClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [contentType, setContentType] = useState<ContentType>('questions');
  const [questions, setQuestions] = useState<QuestionWithTags[]>([]);
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [filterStatus, setFilterStatus] = useState<ItemStatus>('pending');

  useEffect(() => {
    checkPermission();
  }, []);

  useEffect(() => {
    if (isAdmin || isClassModerator) {
      loadData();
    }
  }, [isAdmin, isClassModerator, contentType, filterStatus, selectedClassId]);

  const checkPermission = async () => {
    const { data: { user } } = await getSupabase().auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 检查是否是管理员
    if (user.user_metadata?.is_admin === true) {
      setIsAdmin(true);
      setLoading(false);
      return;
    }

    // 检查是否是班级创建者或审核员
    const supabase = getSupabase();
    try {
      const { data: classMembers } = await supabase
        .from('class_members')
        .select(`
          class_id,
          role,
          classes (
            id,
            name
          )
        `)
        .eq('user_id', user.id)
        .in('role', ['creator', 'moderator']);

      if (classMembers && classMembers.length > 0) {
        setIsClassModerator(true);
        const classIds = classMembers.map((c: any) => c.class_id);
        setUserClasses(classMembers.map((c: any) => ({
          id: c.classes.id,
          name: c.classes.name,
          role: c.role
        })));
        if (classIds.length > 0) {
          setSelectedClassId(classIds[0]);
        }
      } else {
        router.push('/');
        return;
      }
    } catch (err) {
      console.error('检查班级权限失败:', err);
      router.push('/');
      return;
    }

    setLoading(false);
  };

  const loadData = async () => {
    setLoading(true);
    const supabase = getSupabase();

    if (contentType === 'questions') {
      let query = supabase
        .from('questions')
        .select(`
          *,
          tags (
            id,
            name
          )
        `)
        .eq('status', filterStatus);

      // 班级审核员只能看到本班级的内容
      if (isClassModerator && selectedClassId) {
        query = query.eq('class_id', selectedClassId);
      }

      const { data: questionsData, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('获取题目失败:', error);
      } else {
        setQuestions((questionsData || []).map((q: any) => ({
          ...q,
          tags: q.tags || []
        })));
      }
    } else {
      let query = supabase
        .from('notes')
        .select(`
          *,
          tags (
            id,
            name
          )
        `)
        .eq('status', filterStatus);

      // 班级审核员只能看到本班级的内容
      if (isClassModerator && selectedClassId) {
        query = query.eq('class_id', selectedClassId);
      }

      const { data: notesData, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('获取笔记失败:', error);
      } else {
        setNotes((notesData || []).map((n: any) => ({
          ...n,
          tags: n.tags || []
        })));
      }
    }

    setLoading(false);
  };

  const handleApproveQuestion = async (questionId: string) => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert('请先登录');
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      }
    );

    const { error } = await authSupabase
      .from('questions')
      .update({ status: 'approved' })
      .eq('id', questionId)
      .select();

    if (error) {
      alert('审核通过失败: ' + error.message);
    } else {
      alert('审核通过！');
      await loadData();
    }
  };

  const handleRejectQuestion = async (questionId: string) => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert('请先登录');
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      }
    );

    const { error } = await authSupabase
      .from('questions')
      .update({ status: 'rejected' })
      .eq('id', questionId)
      .select();

    if (error) {
      alert('拒绝失败: ' + error.message);
    } else {
      alert('已拒绝！');
      await loadData();
    }
  };

  const handleApproveNote = async (noteId: string) => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert('请先登录');
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      }
    );

    const { error } = await authSupabase
      .from('notes')
      .update({ status: 'approved' })
      .eq('id', noteId);

    if (error) {
      alert('审核通过失败: ' + error.message);
    } else {
      alert('审核通过！');
      await loadData();
    }
  };

  const handleRejectNote = async (noteId: string) => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert('请先登录');
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      }
    );

    const { error } = await authSupabase
      .from('notes')
      .update({ status: 'rejected' })
      .eq('id', noteId);

    if (error) {
      alert('拒绝失败: ' + error.message);
    } else {
      alert('已拒绝！');
      await loadData();
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm('确定要删除这道题目吗？')) return;

    // 获取当前用户的 session token 用于 RLS 操作
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert('请先登录');
      return;
    }

    // 创建带认证上下文的客户端
    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      }
    );

    const { error } = await authSupabase
      .from('questions')
      .delete()
      .eq('id', questionId);

    if (error) {
      console.error('删除题目失败:', error);
      alert('删除失败: ' + error.message);
    } else {
      alert('删除成功！');
      await loadData();
    }
  };

  const handleDeleteNote = async (note: NoteWithTags) => {
    if (!confirm('确定要删除这篇笔记吗？')) return;

    // 获取当前用户的 session token 用于 RLS 操作
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert('请先登录');
      return;
    }

    // 创建带认证上下文的客户端
    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      }
    );

    // 删除文件
    if (note.file_url) {
      try {
        const path = note.file_url.split('/').pop();
        if (path) {
          await deleteFile(`notes/${path}`, 'files');
        }
      } catch (err) {
        console.error('删除文件失败:', err);
      }
    }

    // 删除记录
    const { error } = await authSupabase
      .from('notes')
      .delete()
      .eq('id', note.id);

    if (error) {
      console.error('删除笔记失败:', error);
      alert('删除失败: ' + error.message);
    } else {
      alert('删除成功！');
      await loadData();
    }
  };

  if (!isAdmin && !isClassModerator) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const statusTabs: { key: ItemStatus; label: string; color: string }[] = [
    { key: 'pending', label: '待审核', color: 'bg-yellow-100 text-yellow-700' },
    { key: 'approved', label: '已通过', color: 'bg-green-100 text-green-700' },
    { key: 'rejected', label: '已拒绝', color: 'bg-red-100 text-red-700' },
  ];

  const currentItems = contentType === 'questions' ? questions : notes;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      {/* 页头和筛选 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {isAdmin ? '审核管理' : '班级审核'}
              </h1>
              {/* 系统配置按钮 - 仅超级管理员可见 */}
              {isAdmin && (
                <Link
                  href="/admin/settings"
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition flex items-center gap-1"
                >
                  ⚙️ 系统配置
                </Link>
              )}
            </div>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              刷新
            </button>
          </div>

          {/* 班级选择器 - 仅班级审核员显示 */}
          {isClassModerator && userClasses.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择班级
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {userClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} {cls.role === 'creator' ? '(管理员)' : '(审核员)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 内容类型切换 */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setContentType('questions')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                contentType === 'questions'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              题目 ({questions.length})
            </button>
            <button
              onClick={() => setContentType('notes')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                contentType === 'notes'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              笔记 ({notes.length})
            </button>
          </div>

          {/* 状态筛选 */}
          <div className="flex gap-2">
            {statusTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilterStatus(tab.key)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  filterStatus === tab.key
                    ? `${tab.color} ring-2 ring-offset-2 ring-opacity-50`
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 内容列表 */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-500">加载中...</p>
          </div>
        ) : currentItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">
              暂无{statusTabs.find(t => t.key === filterStatus)?.label}的{contentType === 'questions' ? '题目' : '笔记'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {contentType === 'questions'
              ? questions.map((question) => (
                  <QuestionItem
                    key={question.id}
                    question={question}
                    filterStatus={filterStatus}
                    onApprove={handleApproveQuestion}
                    onReject={handleRejectQuestion}
                    onDelete={handleDeleteQuestion}
                  />
                ))
              : notes.map((note) => (
                  <NoteItem
                    key={note.id}
                    note={note}
                    filterStatus={filterStatus}
                    onApprove={handleApproveNote}
                    onReject={handleRejectNote}
                    onDelete={handleDeleteNote}
                  />
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionItem({ question, filterStatus, onApprove, onReject, onDelete }: {
  question: QuestionWithTags;
  filterStatus: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      {/* 题目内容 */}
      <div className="mb-4">
        <h3 className="font-medium text-gray-900 mb-2">题目</h3>
        {question.question_text && (
          <p className="text-gray-700 whitespace-pre-wrap">{question.question_text}</p>
        )}
        {question.question_image_url && (
          <img
            src={question.question_image_url}
            alt="题目图片"
            className="mt-3 max-w-full h-auto rounded-lg border border-gray-200"
          />
        )}
      </div>

      {/* 答案内容 */}
      <div className="mb-4">
        <h3 className="font-medium text-gray-900 mb-2">答案</h3>
        {question.answer_text && (
          <p className="text-gray-700 whitespace-pre-wrap">{question.answer_text}</p>
        )}
        {question.answer_image_url && (
          <img
            src={question.answer_image_url}
            alt="答案图片"
            className="mt-3 max-w-full h-auto rounded-lg border border-gray-200"
          />
        )}
      </div>

      {/* 标签 */}
      {question.tags && question.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {question.tags.map((tag) => (
            <span
              key={tag.id}
              className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded-full"
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <span className="text-sm text-gray-400">
          {new Date(question.created_at).toLocaleString('zh-CN')}
        </span>
        <div className="flex gap-2">
          {filterStatus === 'pending' && (
            <>
              <button
                onClick={() => onApprove(question.id)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition"
              >
                通过
              </button>
              <button
                onClick={() => onReject(question.id)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
              >
                拒绝
              </button>
            </>
          )}
          <button
            onClick={() => onDelete(question.id)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteItem({ note, filterStatus, onApprove, onReject, onDelete }: {
  note: NoteWithTags;
  filterStatus: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (note: NoteWithTags) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-start gap-4">
        {/* 文件图标 */}
        <div className="text-4xl">{getFileIcon(note.file_name || '')}</div>

        <div className="flex-1">
          {/* 标题 */}
          <h3 className="font-medium text-gray-900 text-lg mb-2">{note.title}</h3>

          {/* 描述 */}
          {note.description && (
            <p className="text-gray-600 mb-3">{note.description}</p>
          )}

          {/* 文件信息 */}
          {note.file_name && (
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
              <span>📄 {note.file_name}</span>
              {note.file_size && <span>({formatFileSize(note.file_size)})</span>}
            </div>
          )}

          {/* 文件预览/下载 */}
          {note.file_url && (
            <a
              href={note.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100 transition mb-3"
            >
              查看文件
            </a>
          )}

          {/* 标签 */}
          {note.tags && note.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {note.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded-full"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <span className="text-sm text-gray-400">
              {new Date(note.created_at).toLocaleString('zh-CN')}
            </span>
            <div className="flex gap-2">
              {filterStatus === 'pending' && (
                <>
                  <button
                    onClick={() => onApprove(note.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition"
                  >
                    通过
                  </button>
                  <button
                    onClick={() => onReject(note.id)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
                  >
                    拒绝
                  </button>
                </>
              )}
              <button
                onClick={() => onDelete(note)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
