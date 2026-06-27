'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase, getUserProfiles, getUserDisplayName } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import Link from 'next/link';
import { formatFileSize } from '@/lib/upload';
import { renderLatexText } from '@/lib/render-markdown';
import type { QuestionWithTags, CommentWithUser } from '@/types';
import { UserAvatar, UserTag } from '@/components/UserAvatar';

export default function QuestionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const questionId = params.id as string;

  const [question, setQuestion] = useState<QuestionWithTags | null>(null);
  const [questionAuthor, setQuestionAuthor] = useState<any>(null);
  const [comments, setComments] = useState<CommentWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // 未登录时的用户状态检查
  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    if (questionId) {
      loadQuestion();
      cleanupLongComments();
      loadComments();
    }
  }, [questionId]);

  useEffect(() => {
    if (user && question) {
      checkFavoriteStatus();
    }
  }, [user, question]);

  const checkUser = async () => {
    const { data: { user } } = await getSupabase().auth.getUser();
    setUser(user);
  };

  const loadQuestion = async () => {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('questions')
      .select(`
        *,
        tags (
          id,
          name
        )
      `)
      .eq('id', questionId)
      .single();

    // 检查是否返回了数据（RLS 会处理权限）
    if (error || !data) {
      console.log('无权访问该题目或题目不存在:', error);
      router.push('/search');
      return;
    }

    // 获取上传者用户信息
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data.user_id)
      .single();

    let userName = '用户';
    if (profileData) {
      userName = profileData.username || profileData.display_name || '用户';
    } else {
      // 如果没有找到 profile，尝试从 user_metadata 获取或自动创建
      userName = await getUserDisplayName(data.user_id);
    }

    setQuestion({
      ...data,
      tags: data.tags || [],
      user_name: userName,
      user_avatar_url: profileData?.avatar_url,
    });

    setQuestionAuthor(profileData || { id: data.user_id, username: userName });

    setLoading(false);
  };

  const cleanupLongComments = async () => {
    try {
      const supabase = getSupabase();
      const { data: allComments } = await supabase
        .from('comments')
        .select('id, content');

      const longComments = allComments?.filter(c => c.content && c.content.length > 250) || [];

      if (longComments.length > 0) {
        const commentIds = longComments.map(c => c.id);
        await supabase
          .from('comments')
          .delete()
          .in('id', commentIds);
        console.log(`已清理 ${commentIds.length} 条超长评论`);
      }
    } catch (error) {
      console.error('清理超长评论失败:', error);
    }
  };

  const loadComments = async () => {
    const supabase = getSupabase();

    const { data } = await supabase
      .from('comments')
      .select('*')
      .eq('target_type', 'question')
      .eq('target_id', questionId)
      .is('parent_id', null)
      .order('created_at', { ascending: true });

    if (data) {
      // 获取所有评论用户 ID
      const userIds = [...new Set(data.map(c => c.user_id))];

      // 使用工具函数批量获取用户信息
      const profileMap = await getUserProfiles(userIds);

      // 获取每个评论的用户信息
      const commentsWithUsers = await Promise.all(
        data.map(async (comment) => {
          const profile = profileMap.get(comment.user_id);
          const displayName = profile?.username || profile?.display_name || '用户';
          const userWithComments = {
            ...comment,
            user: {
              id: comment.user_id,
              username: displayName,
              email: profile?.id || '',
              avatar_url: profile?.avatar_url,
            },
          } as CommentWithUser;

          // 获取回复
          const { data: replies } = await supabase
            .from('comments')
            .select('*')
            .eq('parent_id', comment.id)
            .order('created_at', { ascending: true });

          if (replies && replies.length > 0) {
            // 获取回复者的用户 ID
            const replyUserIds = [...new Set(replies.map(r => r.user_id))];
            const replyProfileMap = await getUserProfiles(replyUserIds);

            userWithComments.replies = await Promise.all(
              replies.map(async (reply) => {
                const replyProfile = replyProfileMap.get(reply.user_id);
                const replyDisplayName = replyProfile?.username || replyProfile?.display_name || '用户';
                return {
                  ...reply,
                  user: {
                    id: reply.user_id,
                    username: replyDisplayName,
                    email: replyProfile?.id || '',
                    avatar_url: replyProfile?.avatar_url,
                  },
                };
              })
            );
          }

          return userWithComments;
        })
      );

      setComments(commentsWithUsers);
    }
  };

  const checkFavoriteStatus = async () => {
    if (!user) return;
    const supabase = getSupabase();

    const { data } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('target_type', 'question')
      .eq('target_id', questionId)
      .maybeSingle();

    setIsFavorited(!!data);
  };

  const handleFavorite = async () => {
    if (!user) {
      alert('请先登录');
      return;
    }

    const supabase = getSupabase();

    if (isFavorited) {
      await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('target_type', 'question')
        .eq('target_id', questionId);
      setIsFavorited(false);
    } else {
      await supabase
        .from('favorites')
        .insert({
          user_id: user.id,
          target_type: 'question',
          target_id: questionId,
        });
      setIsFavorited(true);
    }
  };

  const handleComment = async () => {
    if (!user) {
      alert('请先登录');
      return;
    }

    if (!commentText.trim()) {
      alert('请输入评论内容');
      return;
    }

    if (commentText.trim().length > 250) {
      alert('评论字数不能超过250字');
      return;
    }

    const supabase = getSupabase();

    await supabase.from('comments').insert({
      user_id: user.id,
      target_type: 'question',
      target_id: questionId,
      content: commentText.trim(),
    });

    setCommentText('');
    loadComments();

    // 通知题目作者
    if (question && question.user_id !== user.id) {
      await supabase.from('notifications').insert({
        user_id: question.user_id,
        type: 'comment',
        title: '新评论',
        content: `${user.user_metadata?.username || user.email} 评论了你的题目`,
        link: `/questions/${questionId}`,
      });
    }
  };

  const handleReply = async (commentId: string) => {
    if (!user) {
      alert('请先登录');
      return;
    }

    if (!replyText.trim()) {
      alert('请输入回复内容');
      return;
    }

    if (replyText.trim().length > 250) {
      alert('回复字数不能超过250字');
      return;
    }

    const supabase = getSupabase();

    await supabase.from('comments').insert({
      user_id: user.id,
      target_type: 'question',
      target_id: questionId,
      content: replyText.trim(),
      parent_id: commentId,
    });

    setReplyText('');
    setReplyTo(null);
    loadComments();

    // 通知被回复的用户
    const comment = comments.find(c => c.id === commentId);
    if (comment && comment.user_id !== user.id) {
      await supabase.from('notifications').insert({
        user_id: comment.user_id,
        type: 'reply',
        title: '新回复',
        content: `${user.user_metadata?.username || user.email} 回复了你的评论`,
        link: `/questions/${questionId}`,
      });
    }
  };

  const handleDelete = async () => {
    if (!question) return;
    if (!confirm('确定要删除这道题目吗？')) return;

    const supabase = getSupabase();

    // 删除关联的评论
    await supabase
      .from('comments')
      .delete()
      .eq('target_type', 'question')
      .eq('target_id', questionId);

    // 删除题目
    await supabase
      .from('questions')
      .delete()
      .eq('id', questionId);

    router.push('/search');
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-brand-400">加载中...</div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-brand-400">题目不存在</div>
      </div>
    );
  }

  const isOwner = user && user.id === question.user_id;

  // 状态显示配置
  const statusConfig: Record<string, { text: string; className: string }> = {
    pending: { text: '待审核', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
    approved: { text: '已审核', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    rejected: { text: '已拒绝', className: 'border-red-200 bg-red-50 text-red-700' },
  };

  const statusInfo = statusConfig[question.status] || statusConfig.pending;
  const createdAt = formatDistanceToNow(new Date(question.created_at), { locale: zhCN, addSuffix: true });
  const questionFilesCount = [question.question_file_url, question.question_image_url].filter(Boolean).length;
  const answerFilesCount = [question.answer_file_url, question.answer_image_url].filter(Boolean).length;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-4 flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href="/questions" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900">
              <svg className="mr-1 h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              返回题库
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">题目详情</h1>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}>
                {statusInfo.text}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleFavorite}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                isFavorited
                  ? 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              <svg className="h-4 w-4" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.6.6 0 011.04 0l2.1 4.255 4.698.683a.6.6 0 01.333 1.024l-3.399 3.313.802 4.68a.6.6 0 01-.87.632L12 15.886l-4.202 2.21a.6.6 0 01-.87-.632l.802-4.69-3.4-3.313a.6.6 0 01.333-1.024l4.698-.683 2.12-4.255z" />
              </svg>
              {isFavorited ? '已收藏' : '收藏'}
            </button>
            {isOwner && (
              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M10 11v6m4-6v6M9 7V5h6v2m-8 0l1 13h8l1-13" />
                </svg>
                删除
              </button>
            )}
          </div>
        </div>

        {question.status === 'pending' && isOwner && (
          <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            您的题目正在等待审核。审核通过后，其他用户才能在题库中看到这道题。
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0 space-y-5">
            <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <section className="border-b border-gray-100 p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Question</p>
                    <h2 className="mt-1 text-lg font-semibold text-gray-900">题目</h2>
                  </div>
                  {questionFilesCount > 0 && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
                      {questionFilesCount} 个附件
                    </span>
                  )}
                </div>

                {question.question_file_url && (
                  <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{question.question_file_name || '题目文档'}</p>
                        {(question.question_file_type || question.question_file_size) && (
                          <p className="mt-1 text-xs text-gray-500">
                            {question.question_file_type && <span>{question.question_file_type}</span>}
                            {question.question_file_type && question.question_file_size && <span> · </span>}
                            {question.question_file_size && <span>{formatFileSize(question.question_file_size)}</span>}
                          </p>
                        )}
                      </div>
                      <a
                        href={question.question_file_url}
                        download={question.question_file_name || '题目文档'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                      >
                        下载
                      </a>
                    </div>
                  </div>
                )}

                {question.question_text ? (
                  <div
                    className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800 sm:prose-base"
                    dangerouslySetInnerHTML={{ __html: renderLatexText(question.question_text || '') }}
                  />
                ) : !question.question_file_url && !question.question_image_url ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-400">
                    这道题暂时没有文本内容
                  </div>
                ) : null}

                {question.question_image_url && (
                  <img
                    src={question.question_image_url}
                    alt="题目图片"
                    className="mt-4 max-w-full rounded-lg border border-gray-200 bg-white"
                  />
                )}
              </section>

              <section className="bg-emerald-50/40 p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Answer</p>
                    <h2 className="mt-1 text-lg font-semibold text-gray-900">答案与解析</h2>
                  </div>
                  {answerFilesCount > 0 && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs text-gray-500">
                      {answerFilesCount} 个附件
                    </span>
                  )}
                </div>

                {question.answer_file_url && (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{question.answer_file_name || '答案文档'}</p>
                        {(question.answer_file_type || question.answer_file_size) && (
                          <p className="mt-1 text-xs text-gray-500">
                            {question.answer_file_type && <span>{question.answer_file_type}</span>}
                            {question.answer_file_type && question.answer_file_size && <span> · </span>}
                            {question.answer_file_size && <span>{formatFileSize(question.answer_file_size)}</span>}
                          </p>
                        )}
                      </div>
                      <a
                        href={question.answer_file_url}
                        download={question.answer_file_name || '答案文档'}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        下载
                      </a>
                    </div>
                  </div>
                )}

                {question.answer_text ? (
                  <div
                    className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800 sm:prose-base"
                    dangerouslySetInnerHTML={{ __html: renderLatexText(question.answer_text || '') }}
                  />
                ) : !question.answer_file_url && !question.answer_image_url ? (
                  <div className="rounded-lg border border-dashed border-emerald-200 bg-white/70 p-6 text-center text-sm text-gray-500">
                    暂无答案内容
                  </div>
                ) : null}

                {question.answer_image_url && (
                  <img
                    src={question.answer_image_url}
                    alt="答案图片"
                    className="mt-4 max-w-full rounded-lg border border-emerald-200 bg-white"
                  />
                )}
              </section>
            </article>

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">讨论</h2>
                  <p className="mt-1 text-sm text-gray-500">{comments.length} 条评论</p>
                </div>
              </div>

              {user ? (
                <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="写下你的评论..."
                    className="min-h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    rows={3}
                    maxLength={250}
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className={`text-xs ${commentText.length > 250 ? 'text-red-500' : 'text-gray-400'}`}>
                      {commentText.length}/250
                    </span>
                    <button
                      onClick={handleComment}
                      disabled={commentText.trim().length === 0 || commentText.trim().length > 250}
                      className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      发表评论
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                  <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
                    登录后参与评论
                  </Link>
                </div>
              )}

              <div className="space-y-4">
                {comments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
                    还没有评论
                  </div>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className="rounded-lg border border-gray-100 bg-white p-4">
                      <div className="flex items-start gap-3">
                        <UserTag
                          username={comment.user.username}
                          avatarUrl={comment.user.avatar_url}
                          email={comment.user.email}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-xs text-gray-400">
                            {formatDistanceToNow(new Date(comment.created_at), { locale: zhCN, addSuffix: true })}
                          </span>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{comment.content}</p>

                          {user && (
                            <button
                              onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                              className="mt-2 text-sm text-gray-500 hover:text-blue-600"
                            >
                              {replyTo === comment.id ? '取消回复' : '回复'}
                            </button>
                          )}

                          {replyTo === comment.id && (
                            <div className="mt-3 rounded-lg bg-gray-50 p-3">
                              <textarea
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder={`回复 ${comment.user.username || comment.user.email}...`}
                                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                rows={2}
                                maxLength={250}
                              />
                              <div className="mt-2 flex items-center justify-between gap-3">
                                <span className={`text-xs ${replyText.length > 250 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {replyText.length}/250
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      setReplyTo(null);
                                      setReplyText('');
                                    }}
                                    className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
                                  >
                                    取消
                                  </button>
                                  <button
                                    onClick={() => handleReply(comment.id)}
                                    disabled={replyText.trim().length === 0 || replyText.trim().length > 250}
                                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    回复
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {comment.replies && comment.replies.length > 0 && (
                            <div className="mt-4 space-y-3 border-l border-gray-200 pl-4">
                              {comment.replies.map((reply) => (
                                <div key={reply.id} className="rounded-lg bg-gray-50 p-3">
                                  <UserTag
                                    username={reply.user.username}
                                    avatarUrl={reply.user.avatar_url}
                                    email={reply.user.email}
                                    className="mb-2"
                                  />
                                  <span className="text-xs text-gray-400">
                                    {formatDistanceToNow(new Date(reply.created_at), { locale: zhCN, addSuffix: true })}
                                  </span>
                                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{reply.content}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </main>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">题目信息</h2>
              <div className="mt-4 space-y-4">
                <UserAvatar
                  userId={question.user_id}
                  username={question.user_name}
                  avatarUrl={questionAuthor?.avatar_url}
                  email={questionAuthor?.email}
                  size="md"
                  subtitle={`上传于 ${createdAt}`}
                />
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">题目附件</p>
                    <p className="mt-1 font-semibold text-gray-900">{questionFilesCount}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">答案附件</p>
                    <p className="mt-1 font-semibold text-gray-900">{answerFilesCount}</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-400">标签</p>
                  {question.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {question.tags.map((tag) => (
                        <span key={tag.id} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">暂无标签</p>
                  )}
                </div>
                <dl className="space-y-2 border-t border-gray-100 pt-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-400">状态</dt>
                    <dd className="font-medium text-gray-700">{statusInfo.text}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-400">发布时间</dt>
                    <dd className="text-right text-gray-700">{new Date(question.created_at).toLocaleDateString('zh-CN')}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">快捷操作</h2>
              <div className="mt-3 grid gap-2">
                <Link href="/generator" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50">
                  智能出题
                </Link>
                <Link href="/questions" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50">
                  浏览更多题目
                </Link>
                <Link href="/notes" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50">
                  查看笔记
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
