'use client';

import { useState, useEffect, useRef } from 'react';
import { getSupabase, getUserProfiles } from '@/lib/supabase';
import { uploadImage } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import Link from 'next/link';

interface Post {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  user_name: string;
  user_avatar?: string;
  is_liked: boolean;
}

interface PostComment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  user_name: string;
}

export default function SocialPage() {
  const [user, setUser] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 发帖表单
  const [content, setContent] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 评论
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [showComments, setShowComments] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Map<string, PostComment[]>>(new Map());

  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    loadPosts();
  }, [user]);

  const checkUser = async () => {
    try {
      const { data: { user } } = await getSupabase().auth.getUser();
      setUser(user);
    } catch (err) {
      console.error('获取用户信息失败:', err);
      setUser(null);
    }
    setLoading(false);
  };

  const loadPosts = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();

      // 获取帖子
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false });

      if (postsError) {
        // 表可能还不存在，显示空列表
        console.log('posts 表可能还不存在');
        setPosts([]);
        setLoading(false);
        return;
      }

      // 获取用户信息
      const userIds = [...new Set(postsData?.map(p => p.user_id) || [])];
      let profileMap = new Map();
      if (userIds.length > 0) {
        try {
          profileMap = await getUserProfiles(userIds);
        } catch (err) {
          console.log('获取用户信息失败');
        }
      }

      // 获取当前用户的点赞状态
      let likedPostIds = new Set<string>();
      if (user) {
        try {
          const { data: likesData } = await supabase
            .from('post_likes')
            .select('post_id')
            .eq('user_id', user.id);
          likedPostIds = new Set(likesData?.map(l => l.post_id) || []);
        } catch (err) {
          console.log('获取点赞状态失败');
        }
      }

      // 组合数据
      const formattedPosts = (postsData || []).map((post: any) => {
        const profile = profileMap.get(post.user_id);
        const displayName = profile?.username || profile?.display_name || '用户';
        return {
          ...post,
          user_name: displayName,
          user_avatar: profile?.avatar_url,
          is_liked: likedPostIds.has(post.id),
        } as Post;
      });

      setPosts(formattedPosts);
    } catch (err) {
      console.error('加载帖子失败:', err);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const loadComments = async (postId: string) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('post_comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // 获取评论用户信息
      const userIds = [...new Set(data?.map(c => c.user_id) || [])];
      const profileMap = await getUserProfiles(userIds);

      const formattedComments = (data || []).map((comment: any) => {
        const profile = profileMap.get(comment.user_id);
        const displayName = profile?.username || profile?.display_name || '用户';
        return {
          ...comment,
          user_name: displayName,
        };
      });

      setComments(prev => new Map(prev).set(postId, formattedComments));
    } catch (err) {
      console.error('加载评论失败:', err);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }

    setImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() && !imageFile) {
      alert('请输入内容或上传图片');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabase();
      let imageUrl: string | null = null;

      if (imageFile) {
        imageUrl = await uploadImage(imageFile, user.id);
      }

      const { error } = await supabase
        .from('posts')
        .insert({
          user_id: user.id,
          content: content.trim(),
          image_url: imageUrl,
        });

      if (error) throw error;

      // 重置表单
      setContent('');
      removeImage();

      // 重新加载帖子
      await loadPosts();
    } catch (err: any) {
      console.error('发布失败:', err);
      alert('发布失败: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!user) {
      alert('请先登录');
      return;
    }

    try {
      const supabase = getSupabase();
      const post = posts.find(p => p.id === postId);

      if (post?.is_liked) {
        // 取消点赞
        await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);

        setPosts(prev => prev.map(p =>
          p.id === postId
            ? { ...p, is_liked: false, likes_count: Math.max(0, p.likes_count - 1) }
            : p
        ));
      } else {
        // 点赞
        await supabase
          .from('post_likes')
          .insert({ post_id: postId, user_id: user.id });

        setPosts(prev => prev.map(p =>
          p.id === postId
            ? { ...p, is_liked: true, likes_count: p.likes_count + 1 }
            : p
        ));
      }
    } catch (err) {
      console.error('点赞失败:', err);
    }
  };

  const handleToggleComments = async (postId: string) => {
    const newShowComments = new Set(showComments);
    if (newShowComments.has(postId)) {
      newShowComments.delete(postId);
    } else {
      newShowComments.add(postId);
      if (!comments.has(postId)) {
        await loadComments(postId);
      }
    }
    setShowComments(newShowComments);
  };

  const handleSubmitComment = async (postId: string) => {
    if (!user) {
      alert('请先登录');
      return;
    }

    if (!commentText.trim()) {
      alert('请输入评论内容');
      return;
    }

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('post_comments')
        .insert({
          post_id: postId,
          user_id: user.id,
          content: commentText.trim(),
        });

      if (error) throw error;

      setCommentText('');

      // 重新加载评论
      await loadComments(postId);

      // 更新帖子评论数
      setPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, comments_count: p.comments_count + 1 }
          : p
      ));
    } catch (err) {
      console.error('评论失败:', err);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('确定要删除这条帖子吗？')) return;

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId)
        .eq('user_id', user.id);

      if (error) throw error;

      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败');
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          {/* 移动端返回按钮 */}
          <Link href="/" className="flex items-center gap-1 text-gray-600 hover:text-gray-900">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7 7-7 7l5 5-5" />
            </svg>
            <span className="sm:hidden">首页</span>
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">论坛</h1>

        {/* 发帖表单 - 只有登录用户可见 */}
        {user ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="分享你的学习心得..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              rows={3}
              disabled={submitting}
            />

            {imagePreview && (
              <div className="mt-3 relative inline-block">
                <img src={imagePreview} alt="预览" className="max-h-48 rounded-lg" />
                <button
                  onClick={removeImage}
                  className="absolute top-2 right-2 w-6 h-6 bg-black/50 text-white rounded-full hover:bg-black/70"
                  type="button"
                >
                  ×
                </button>
              </div>
            )}

            <div className="flex items-center justify-between mt-3">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
                disabled={submitting}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                type="button"
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                disabled={submitting}
              >
                📷 图片
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || (!content.trim() && !imageFile)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {submitting ? '发布中...' : '发布'}
            </button>
          </div>
        </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 text-center">
            <p className="text-gray-500 mb-3">登录后可以发布帖子</p>
            <Link href="/login" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition inline-block">
              去登录
            </Link>
          </div>
        )}

        {/* 帖子列表 */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-500">加载中...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="text-6xl mb-4">💬</div>
            <h2 className="text-xl font-medium text-gray-900 mb-2">还没有帖子</h2>
            <p className="text-gray-500">来发布第一条帖子吧！</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                {/* 帖子头部 */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center text-white text-sm font-medium">
                    {post.user_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1">
                    <Link
                      href={`/users/${post.user_id}`}
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {post.user_name}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(post.created_at), { locale: zhCN, addSuffix: true })}
                    </p>
                  </div>
                  {post.user_id === user.id && (
                    <button
                      onClick={() => handleDeletePost(post.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      🗑️
                    </button>
                  )}
                </div>

                {/* 帖子内容 */}
                {post.content && (
                  <p className="text-gray-700 mb-3 whitespace-pre-wrap">{post.content}</p>
                )}

                {/* 帖子图片 */}
                {post.image_url && (
                  <img
                    src={post.image_url}
                    alt="帖子图片"
                    className="w-full rounded-lg mb-3 max-h-96 object-cover"
                  />
                )}

                {/* 帖子操作 */}
                <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => handleLike(post.id)}
                    className={`flex items-center gap-1 ${post.is_liked ? 'text-red-500' : 'text-gray-500'} hover:text-red-500 transition`}
                  >
                    {post.is_liked ? '❤️' : '🤍'}
                    <span>{post.likes_count || 0}</span>
                  </button>
                  <button
                    onClick={() => handleToggleComments(post.id)}
                    className="flex items-center gap-1 text-gray-500 hover:text-blue-500 transition"
                  >
                    💬
                    <span>{post.comments_count || 0}</span>
                  </button>
                </div>

                {/* 评论区 */}
                {showComments.has(post.id) && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    {/* 评论列表 */}
                    {comments.get(post.id)?.map((comment) => (
                      <div key={comment.id} className="flex gap-3 mb-3">
                        <div className="w-8 h-8 bg-gray-900 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                          {comment.user_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 bg-gray-50 rounded-lg p-3">
                          <Link
                            href={`/users/${comment.user_id}`}
                            className="font-medium text-gray-900 text-sm hover:text-blue-600"
                          >
                            {comment.user_name}
                          </Link>
                          <p className="text-sm text-gray-500 mb-1">
                            {formatDistanceToNow(new Date(comment.created_at), { locale: zhCN, addSuffix: true })}
                          </p>
                          <p className="text-gray-700 text-sm">{comment.content}</p>
                        </div>
                      </div>
                    ))}

                    {/* 评论输入 */}
                    <div className="flex gap-2 mt-3">
                      <input
                        type="text"
                        value={commentPostId === post.id ? commentText : ''}
                        onChange={(e) => {
                          setCommentPostId(post.id);
                          setCommentText(e.target.value);
                        }}
                        placeholder="写下你的评论..."
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handleSubmitComment(post.id);
                          }
                        }}
                      />
                      <button
                        onClick={() => handleSubmitComment(post.id)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                      >
                        发送
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
