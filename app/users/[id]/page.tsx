'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { getSupabase, getUserDisplayName } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import Link from 'next/link';
import { getFileIcon, formatFileSize } from '@/lib/upload';
import type { QuestionWithTags, NoteWithTags } from '@/types';

type TabType = 'questions' | 'notes' | 'favorites';

export default function UserProfilePage() {
  const params = useParams();
  const userId = params.id as string;

  const [profileUser, setProfileUser] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('questions');
  const [questions, setQuestions] = useState<QuestionWithTags[]>([]);
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [favorites, setFavorites] = useState<{ questions: QuestionWithTags[], notes: NoteWithTags[] }>({
    questions: [],
    notes: []
  });
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const loadFavorites = async () => {
    const supabase = getSupabase();
    
    // 获取收藏的题目
    const { data: favQuestions } = await supabase
      .from('favorites')
      .select('target_id')
      .eq('user_id', userId)
      .eq('target_type', 'question');

    if (favQuestions && favQuestions.length > 0) {
      const questionIds = favQuestions.map(f => f.target_id);
      const { data: questionsData } = await supabase
        .from('questions')
        .select('*, tags(id, name)')
        .in('id', questionIds)
        .eq('status', 'approved');
      setFavorites(prev => ({ ...prev, questions: questionsData || [] }));
    }

    // 获取收藏的笔记
    const { data: favNotes } = await supabase
      .from('favorites')
      .select('target_id')
      .eq('user_id', userId)
      .eq('target_type', 'note');

    if (favNotes && favNotes.length > 0) {
      const noteIds = favNotes.map(f => f.target_id);
      const { data: notesData } = await supabase
        .from('notes')
        .select('*, tags(id, name)')
        .in('id', noteIds)
        .eq('status', 'approved');
      setFavorites(prev => ({ ...prev, notes: notesData || [] }));
    }
  };

  const checkUser = async () => {
    const { data: { user } } = await getSupabase().auth.getUser();
    setCurrentUser(user);
  };

  const loadUserData = async () => {
    setLoading(true);
    const supabase = getSupabase();

    // 先从 user_profiles 表获取用户信息
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileData) {
      setProfileUser({
        id: profileData.id,
        email: profileData.email || '',
        username: profileData.username || profileData.display_name || '用户',
        avatar_url: profileData.avatar_url || null,
        createdAt: profileData.created_at,
      });
    } else {
      // 如果没有找到，尝试从题目/笔记中获取用户信息
      const { data: questionData } = await supabase
        .from('questions')
        .select('user_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (questionData) {
        // 有这个用户的题目，说明用户存在
        setProfileUser({
          id: userId,
          email: '',
          username: '用户',
          avatar_url: null,
          createdAt: new Date().toISOString(),
        });
      } else {
        // 尝试使用工具函数获取显示名称
        const displayName = await getUserDisplayName(userId, currentUser);
        setProfileUser({
          id: userId,
          email: '',
          username: displayName,
          avatar_url: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 检查关注状态
    if (currentUser) {
      const { data: followData } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', currentUser.id)
        .eq('following_id', userId)
        .maybeSingle();
      setIsFollowing(!!followData);
    }

    // 获取用户上传的内容
    loadContent();

    // 获取关注统计
    const { count: followersCount } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);

    const { count: followingCount } = await supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);

    setFollowersCount(followersCount || 0);
    setFollowingCount(followingCount || 0);

    setLoading(false);
  };

  const loadContent = async () => {
    const supabase = getSupabase();

    if (activeTab === 'questions') {
      const { data: questionsData } = await supabase
        .from('questions')
        .select('*, tags(id, name)')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      setQuestions(questionsData || []);
    } else if (activeTab === 'notes') {
      const { data: notesData } = await supabase
        .from('notes')
        .select('*, tags(id, name)')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      setNotes(notesData || []);
    }
  };

  useEffect(() => {
    checkUser();
    loadUserData();
  }, [userId]);

  useEffect(() => {
    if (currentUser) {
      loadFavorites();
    }
  }, [currentUser, userId]);

  useEffect(() => {
    if (profileUser) {
      loadContent();
    }
  }, [activeTab, profileUser]);

  const handleFollow = async () => {
    if (!currentUser) {
      alert('请先登录');
      return;
    }

    const supabase = getSupabase();

    if (isFollowing) {
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', currentUser.id)
        .eq('following_id', userId);
      setIsFollowing(false);
      setFollowersCount(prev => Math.max(0, prev - 1));
    } else {
      await supabase
        .from('follows')
        .insert({
          follower_id: currentUser.id,
          following_id: userId,
        });
      setIsFollowing(true);
      setFollowersCount(prev => prev + 1);

      // 通知被关注用户
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'follow',
        title: '新增粉丝',
        content: `${currentUser.user_metadata?.username || currentUser.email} 关注了你`,
        link: `/users/${currentUser.id}`,
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!profileUser) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-gray-500">用户不存在</div>
      </div>
    );
  }

  const isOwnProfile = currentUser && currentUser.id === userId;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 背景 */}
      
      
      {/* 用户信息头部 */}
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-200 relative z-10">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center gap-6">
            {/* 头像 */}
            <div className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl overflow-hidden border-4 border-white shadow-lg ${
              profileUser.avatar_url ? '' : 'bg-gradient-to-br from-gray-400 to-gray-600'
            }`}>
              {profileUser.avatar_url ? (
                <img 
                  src={profileUser.avatar_url} 
                  alt="头像" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                  }}
                />
              ) : (
                <span className="text-white text-3xl font-medium">
                  {(profileUser.username || '用户').charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            {/* 用户信息 */}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-1">
                {profileUser.username || '用户'}
              </h1>
              {profileUser.bio && (
                <p className="text-gray-600 mb-2">{profileUser.bio}</p>
              )}
              <p className="text-sm text-gray-500">
                加入于 {formatDistanceToNow(new Date(profileUser.createdAt), { locale: zhCN, addSuffix: true })}
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-3">
              {!isOwnProfile && (
                <button
                  onClick={handleFollow}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    isFollowing
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isFollowing ? '已关注' : '关注'}
                </button>
              )}
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">{followersCount}</p>
                <p className="text-xs text-gray-500">粉丝</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">{followingCount}</p>
                <p className="text-xs text-gray-500">关注</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 内容标签 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('questions')}
              className={`py-4 border-b-2 transition ${
                activeTab === 'questions'
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              题目 ({questions.length})
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`py-4 border-b-2 transition ${
                activeTab === 'notes'
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              笔记 ({notes.length})
            </button>
            {(isOwnProfile || currentUser) && (
              <button
                onClick={() => setActiveTab('favorites')}
                className={`py-4 border-b-2 transition ${
                  activeTab === 'favorites'
                    ? 'border-blue-600 text-blue-600 font-medium'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                收藏 ({favorites.questions.length + favorites.notes.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 内容列表 */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'questions' && (
          <div className="space-y-4">
            {questions.length === 0 ? (
              <p className="text-center text-gray-500 py-8">还没有上传题目</p>
            ) : (
              questions.map((question) => (
                <Link
                  key={question.id}
                  href={`/questions/${question.id}`}
                  className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition"
                >
                  <div className="mb-3">
                    {question.question_file_url && (
                      <div className="flex items-center gap-2 text-sm text-blue-600 mb-2">
                        <span>📄</span>
                        <span>{question.question_file_name || '文档'}</span>
                      </div>
                    )}
                    {question.question_text && (
                      <p className="text-gray-800 line-clamp-2">{question.question_text}</p>
                    )}
                    {question.question_image_url && (
                      <img
                        src={question.question_image_url}
                        alt="题目"
                        className="mt-2 max-h-32 rounded-lg object-cover"
                      />
                    )}
                  </div>
                  {question.tags && question.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {question.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-full"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="grid gap-4 md:grid-cols-2">
            {notes.length === 0 ? (
              <p className="text-center text-gray-500 py-8 col-span-2">还没有上传笔记</p>
            ) : (
              notes.map((note) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="text-3xl">{getFileIcon(note.file_name || '')}</div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{note.title}</h3>
                      {note.file_name && (
                        <p className="text-sm text-gray-500 truncate">{note.file_name}</p>
                      )}
                    </div>
                  </div>
                  {note.description && (
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">{note.description}</p>
                  )}
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>{note.likes_count || 0} 点赞</span>
                    <span>{formatFileSize(note.file_size || 0)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}

        {activeTab === 'favorites' && (
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">收藏的题目</h3>
            <div className="space-y-4 mb-8">
              {favorites.questions.length === 0 ? (
                <p className="text-center text-gray-500 py-8">还没有收藏题目</p>
              ) : (
                favorites.questions.map((question) => (
                  <Link
                    key={question.id}
                    href={`/questions/${question.id}`}
                    className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition"
                  >
                    <p className="text-gray-800">{question.question_text}</p>
                  </Link>
                ))
              )}
            </div>

            <h3 className="text-lg font-medium text-gray-900 mb-4">收藏的笔记</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {favorites.notes.length === 0 ? (
                <p className="text-center text-gray-500 py-8 col-span-2">还没有收藏笔记</p>
              ) : (
                favorites.notes.map((note) => (
                  <Link
                    key={note.id}
                    href={`/notes/${note.id}`}
                    className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition"
                  >
                    <h3 className="font-medium text-gray-900">{note.title}</h3>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
