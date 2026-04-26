'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase, getUserProfiles, getUserDisplayName } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import Link from 'next/link';
import { formatFileSize } from '@/lib/upload';
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
    pending: { text: '待审核', className: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' },
    approved: { text: '已审核', className: 'bg-green-900/30 text-green-400 border-green-800' },
    rejected: { text: '已拒绝', className: 'bg-red-900/30 text-red-400 border-red-800' },
  };

  const statusInfo = statusConfig[question.status] || statusConfig.pending;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-brand-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* 返回按钮 */}
        <Link
          href="/search"
          className="inline-flex items-center text-brand-300 hover:text-brand-50 mb-6"
        >
          ← 返回题库
        </Link>

        {/* 题目内容 */}
        <div className="bg-brand-800/50 rounded-xl shadow-sm border border-brand-800 p-6 mb-6">
          {/* 状态提示和操作按钮 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {question.status !== 'approved' && (
                <span className={`px-3 py-1 text-xs rounded border ${statusInfo.className}`}>
                  {statusInfo.text}
                </span>
              )}
              {question.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-3 py-1 text-sm bg-brand-600/30 text-brand-500 rounded-full"
                >
                  {tag.name}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleFavorite}
                className={`p-2 rounded-lg transition ${
                  isFavorited ? 'text-yellow-500 bg-yellow-50' : 'text-brand-500 hover:text-yellow-500 hover:bg-brand-950'
                }`}
                title="收藏"
              >
                {isFavorited ? '⭐' : '☆'}
              </button>
              {isOwner && (
                <button
                  onClick={handleDelete}
                  className="p-2 text-brand-500 hover:text-red-400 hover:bg-brand-950 rounded-lg transition"
                  title="删除"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>

          {/* 待审核提示 */}
          {question.status === 'pending' && isOwner && (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
              <p className="text-sm text-yellow-300">
                ⏳ 您的题目正在等待审核，审核通过后其他用户才能查看。公开题目需要审核后才能在题库中显示。
              </p>
            </div>
          )}

          {/* 题目 */}
          <div className="mb-6">
            <h2 className="text-lg font-medium text-brand-50 mb-3">题目</h2>

            {/* 文档预览和下载 */}
            {question.question_file_url && (
              <div className="mb-4 p-4 bg-brand-600/30 border border-brand-700 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <p className="text-sm font-medium text-brand-50">{question.question_file_name || '题目文档'}</p>
                    {(question.question_file_type || question.question_file_size) && (
                      <p className="text-xs text-brand-400">
                        {question.question_file_type && <span>{question.question_file_type}</span>}
                        {question.question_file_type && question.question_file_size && <span> · </span>}
                        {question.question_file_size && <span>{formatFileSize(question.question_file_size)}</span>}
                      </p>
                    )}
                  </div>
                </div>
                <a
                  href={question.question_file_url}
                  download={question.question_file_name || '题目文档'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 text-brand-50 rounded-lg text-sm font-medium hover:bg-brand-600 transition no-underline"
                >
                  <span>下载题目文档</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
              </div>
            )}

            {question.question_text && (
              <p className="text-brand-200 whitespace-pre-wrap">{question.question_text}</p>
            )}

            {question.question_image_url && (
              <img
                src={question.question_image_url}
                alt="题目图片"
                className="mt-3 max-w-full rounded-lg"
              />
            )}
          </div>

          {/* 答案 */}
          <div className="border-t border-brand-900 pt-6">
            <h2 className="text-lg font-medium text-brand-50 mb-3">答案</h2>

            {/* 答案文档预览和下载 */}
            {question.answer_file_url && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <p className="text-sm font-medium text-brand-50">{question.answer_file_name || '答案文档'}</p>
                    {(question.answer_file_type || question.answer_file_size) && (
                      <p className="text-xs text-brand-400">
                        {question.answer_file_type && <span>{question.answer_file_type}</span>}
                        {question.answer_file_type && question.answer_file_size && <span> · </span>}
                        {question.answer_file_size && <span>{formatFileSize(question.answer_file_size)}</span>}
                      </p>
                    )}
                  </div>
                </div>
                <a
                  href={question.answer_file_url}
                  download={question.answer_file_name || '答案文档'}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-brand-50 rounded-lg text-sm font-medium hover:bg-green-700 transition no-underline"
                >
                  <span>下载答案文档</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
              </div>
            )}

            {question.answer_text && (
              <p className="text-brand-200 whitespace-pre-wrap">{question.answer_text}</p>
            )}

            {question.answer_image_url && (
              <img
                src={question.answer_image_url}
                alt="答案图片"
                className="mt-3 max-w-full rounded-lg"
              />
            )}
          </div>

          {/* 上传信息 */}
          <div className="border-t border-brand-900 pt-5 mt-6">
            <div className="flex items-center justify-between">
              <UserAvatar
                userId={question.user_id}
                username={question.user_name}
                avatarUrl={questionAuthor?.avatar_url}
                email={questionAuthor?.email}
                size="md"
                subtitle={`上传于 ${formatDistanceToNow(new Date(question.created_at), { locale: zhCN, addSuffix: true })}`}
              />
            </div>
          </div>
        </div>

        {/* 评论区 */}
        <div className="bg-brand-800/50 rounded-xl shadow-sm border border-brand-800 p-6">
          <h3 className="text-lg font-medium text-brand-50 mb-4">评论 ({comments.length})</h3>

          {/* 评论输入 */}
          {user ? (
            <div className="mb-6">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="写下你的评论..."
                className="w-full px-4 py-3 border border-brand-700 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none resize-none"
                rows={3}
                maxLength={250}
              />
              <div className="flex justify-between items-center mt-2">
                <span className={`text-xs ${commentText.length > 250 ? 'text-red-500' : 'text-brand-400'}`}>
                  {commentText.length}/250
                </span>
                <button
                  onClick={handleComment}
                  disabled={commentText.trim().length === 0 || commentText.trim().length > 250}
                  className="px-4 py-2 bg-brand-500 text-brand-50 rounded-lg hover:bg-brand-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  发表评论
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-6 p-4 bg-brand-950 rounded-lg text-center">
              <Link href="/login" className="text-brand-500 hover:text-brand-600">
                登录后参与评论
              </Link>
            </div>
          )}

          {/* 评论列表 */}
          <div className="space-y-6">
            {comments.length === 0 ? (
              <p className="text-brand-400 text-center py-8">还没有评论，快来抢沙发吧！</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="border-b border-brand-900 pb-5 last:border-0">
                  <div className="flex items-start gap-3">
                    <UserTag
                      username={comment.user.username}
                      avatarUrl={comment.user.avatar_url}
                      email={comment.user.email}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs text-brand-400">
                          {formatDistanceToNow(new Date(comment.created_at), { locale: zhCN, addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-brand-200">{comment.content}</p>

                      {/* 回复按钮 */}
                      {user && (
                        <button
                          onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                          className="text-sm text-brand-400 hover:text-brand-500 mt-2"
                        >
                          {replyTo === comment.id ? '取消回复' : '回复'}
                        </button>
                      )}

                      {/* 回复输入 */}
                      {replyTo === comment.id && (
                        <div className="mt-3">
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder={`回复 ${comment.user.username || comment.user.email}...`}
                            className="w-full px-3 py-2 border border-brand-700 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none resize-none text-sm"
                            rows={2}
                            maxLength={250}
                          />
                          <div className="flex justify-between items-center mt-2">
                            <span className={`text-xs ${replyText.length > 250 ? 'text-red-500' : 'text-brand-400'}`}>
                              {replyText.length}/250
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setReplyTo(null);
                                  setReplyText('');
                                }}
                                className="px-3 py-1 text-sm text-brand-300 hover:text-brand-100"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleReply(comment.id)}
                                disabled={replyText.trim().length === 0 || replyText.trim().length > 250}
                                className="px-3 py-1 text-sm bg-brand-500 text-brand-50 rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                回复
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 子评论 */}
                      {comment.replies && comment.replies.length > 0 && (
                        <div className="mt-4 space-y-3 pl-4 border-l-2 border-brand-900">
                          {comment.replies.map((reply) => (
                            <div key={reply.id} className="flex items-start gap-2">
                              <UserTag
                                username={reply.user.username}
                                avatarUrl={reply.user.avatar_url}
                                email={reply.user.email}
                                className="flex-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-1">
                                  <span className="text-xs text-brand-400">
                                    {formatDistanceToNow(new Date(reply.created_at), { locale: zhCN, addSuffix: true })}
                                  </span>
                                </div>
                                <p className="text-brand-200 text-sm">{reply.content}</p>
                              </div>
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
        </div>
      </div>
    </div>
  );
}
