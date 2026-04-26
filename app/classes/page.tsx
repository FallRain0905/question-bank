'use client';

import { useState, useEffect, useRef } from 'react';
import { getSupabase, getUserProfiles } from '@/lib/supabase';
import type { ClassWithRole } from '@/types';

interface ClassMember {
  id: string;
  user_id: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  username: string;
  display_name: string;
  avatar_url?: string;
  joined_at: string;
  message?: string;
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  // 使用 ref 防止组件卸载后更新状态
  const isMounted = useRef(true);

  // 创建班级表单
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [className, setClassName] = useState('');
  const [classDesc, setClassDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // 加入班级表单
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joinMessage, setJoinMessage] = useState('');

  // 成员管理
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [selectedClass, setSelectedClass] = useState<ClassWithRole | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    isMounted.current = true;
    checkUser();

    return () => {
      isMounted.current = false;
    };
  }, []);

  // 只有当 user 存在时才加载班级列表
  useEffect(() => {
    if (user) {
      loadClasses();
    }
  }, [user]);

  const checkUser = async () => {
    const { data: { user } } = await getSupabase().auth.getUser();
    if (isMounted.current) {
      setUser(user);
      if (!user) {
        setLoading(false);
      }
    }
  };

  const loadClasses = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();

      // 1. 查询用户的班级成员记录（已批准的）
      const { data: members, error: membersError } = await supabase
        .from('class_members')
        .select('class_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'approved');

      if (membersError) {
        console.error('查询 class_members 失败:', membersError.message, membersError);
        setClasses([]);
        return;
      }

      let resultClasses: ClassWithRole[] = [];

      // 2. 获取已批准的班级信息
      if (members && members.length > 0) {
        const classIds = members.map(m => m.class_id);
        const { data: approvedClasses, error: classesError } = await supabase
          .from('classes')
          .select('id, name, description, invite_code, creator_id, status, created_at, updated_at')
          .in('id', classIds)
          .eq('status', 'approved');

        if (!classesError && approvedClasses) {
          const classesMap = new Map(approvedClasses.map(c => [c.id, c]));
          resultClasses = members
            .map(m => ({
              ...classesMap.get(m.class_id),
              userRole: m.role,
            }))
            .filter(c => c.id) as ClassWithRole[];
        }
      }

      // 3. 查询用户创建的待审核班级
      const { data: pendingClasses, error: pendingError } = await supabase
        .from('classes')
        .select('id, name, description, invite_code, creator_id, status, created_at, updated_at')
        .eq('creator_id', user.id)
        .eq('status', 'pending');

      if (!pendingError && pendingClasses && pendingClasses.length > 0) {
        // 添加待审核班级到结果中（用户角色为 creator）
        resultClasses = [
          ...resultClasses,
          ...pendingClasses.map(c => ({
            ...c,
            userRole: 'creator' as const,
          }))
        ];
      }

      // 4. 按创建时间倒序排列
      resultClasses.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setClasses(resultClasses);
    } catch (err) {
      console.error('加载班级时出错:', err);
      setClasses([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async (classId: string) => {
    setLoadingMembers(true);
    try {
      const supabase = getSupabase();
      const { data: members, error } = await supabase
        .from('class_members')
        .select('*')
        .eq('class_id', classId)
        .eq('status', 'approved')
        .order('joined_at', { ascending: true });

      if (error) {
        console.error('获取成员列表失败:', error);
        setMembers([]);
        return;
      }

      if (!members || members.length === 0) {
        setMembers([]);
        return;
      }

      // 获取所有用户 ID
      const userIds = members.map(m => m.user_id);

      // 使用工具函数批量获取用户信息
      const profileMap = await getUserProfiles(userIds);

      if (isMounted.current) {
        setMembers(members.map((m: any) => {
          const profile = profileMap.get(m.user_id);
          const displayName = profile?.username || profile?.display_name || '用户';
          return {
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            status: m.status,
            message: m.message,
            joined_at: m.joined_at,
            username: displayName,
            display_name: displayName,
            avatar_url: profile?.avatar_url ?? undefined,
          };
        }));
      }
    } catch (err) {
      console.error('加载成员时出错:', err);
      if (isMounted.current) {
        setMembers([]);
      }
    } finally {
      if (isMounted.current) {
        setLoadingMembers(false);
      }
    }
  };

  const handleCreateClass = async () => {
    if (!className.trim()) {
      alert('请输入班级名称');
      return;
    }

    setCreating(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('classes')
        .insert({
          name: className.trim(),
          description: classDesc.trim() || null,
          creator_id: user.id,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      // 创建班级审核请求记录（供管理员查看和审核）
      await supabase
        .from('class_approval_requests')
        .insert({
          class_id: data.id,
          user_id: user.id,
          name: data.name,
          description: data.description || '',
          invite_code: data.invite_code,
          status: 'pending',
        });

      // 注意：触发器会自动将创建者添加为班级成员（status = 'approved'）
      // 不需要手动插入

      setClassName('');
      setClassDesc('');
      setShowCreateModal(false);

      alert(`班级 "${data.name}" 创建成功！正在等待超级管理员审核。`);
    } catch (error: any) {
      console.error('创建班级失败:', error);
      const errorMsg = error?.message || '未知错误';
      console.error('错误详情:', errorMsg, error?.details, error?.hint);
      alert('创建失败: ' + errorMsg);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinClass = async () => {
    setJoinError('');
    setJoinMessage('');

    if (!inviteCode.trim()) {
      setJoinError('请输入邀请码');
      return;
    }

    setJoining(true);
    try {
      const supabase = getSupabase();

      // 先查找班级
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select('*')
        .eq('invite_code', inviteCode.trim().toUpperCase())
        .maybeSingle();

      if (classError || !classData) {
        throw new Error('邀请码无效');
      }

      // 检查班级状态
      if (classData.status !== 'approved') {
        throw new Error('该班级还在审核中');
      }

      // 检查是否已经是班级成员
      const { data: existingMember } = await supabase
        .from('class_members')
        .select('status')
        .eq('class_id', classData.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingMember && existingMember.status === 'approved') {
        throw new Error('你已经是该班级成员');
      }

      // 插入加入申请
      const { error: insertError } = await supabase
        .from('class_members')
        .insert({
          class_id: classData.id,
          user_id: user.id,
          role: 'member',
          status: 'pending',
          message: joinMessage.trim() || null,
        });

      if (insertError) throw insertError;

      setInviteCode('');
      setShowJoinModal(false);
      alert(`已提交加入 "${classData.name}" 的申请，等待班级管理员审核。`);
    } catch (error: any) {
      console.error('加入班级失败:', error);
      setJoinError(error.message || '加入失败，请重试');
    } finally {
      setJoining(false);
    }
  };

  const handleLeaveClass = async (classId: string, className: string) => {
    if (!confirm(`确定要退出班级 "${className}" 吗？`)) return;
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/classes/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.user && { Authorization: `Bearer ${session.access_token}` }),
        },
        body: JSON.stringify({ classId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '退出失败');
      }

      await loadClasses();
      alert('已退出班级');
    } catch (error: any) {
      console.error('退出班级失败:', error);
      alert('退出失败: ' + error.message);
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!confirm(`确定要将 "${memberName}" 移出班级吗？`)) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('class_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      await loadMembers(selectedClass!.id);
      alert('已移除成员');
    } catch (error: any) {
      console.error('移除成员失败:', error);
      alert('移除失败: ' + error.message);
    }
  };

  const openMembersModal = async (cls: ClassWithRole) => {
    setSelectedClass(cls);
    setShowMembersModal(true);
    await loadMembers(cls.id);
  };

  const getUserAvatar = (member: ClassMember) => {
    if (member.avatar_url) {
      return (
        <img
          src={member.avatar_url}
          alt={member.username}
          className="w-10 h-10 rounded-full object-cover"
        />
      );
    }
    return (
      <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white text-sm font-medium">
        {member.username?.[0]?.toUpperCase() || '?'}
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full">待审核</span>;
      case 'approved':
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">已加入</span>;
      case 'rejected':
        return <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full">已拒绝</span>;
      default:
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">{status}</span>;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'creator':
        return <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full">创建者</span>;
      case 'moderator':
        return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">审核员</span>;
      default:
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">成员</span>;
    }
  };

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-9000 mb-4">请先登录</p>
          <a href="/login" className="inline-block px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800">
            去登录
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50">
        <p className="text-gray-9000">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 背景 */}
      
      
      <div className="max-w-4xl mx-auto px-4 py-8 relative z-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-700">我的班级</h1>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setShowJoinModal(true)}
            className="px-4 py-2 bg-white text-gray-600 border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
          >
            加入班级
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-200 transition-colors"
          >
            创建班级
          </button>
        </div>

        {classes.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center mt-6">
            <div className="text-6xl mb-4">📚</div>
            <h2 className="text-xl font-medium text-gray-700 mb-2">还没有加入任何班级</h2>
            <p className="text-gray-9000 mb-6">创建班级或使用邀请码加入现有班级</p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                创建班级
              </button>
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-6 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg hover:border-gray-300"
              >
                加入班级
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-6">
            {classes.map((cls) => {
              const isPending = cls.status === 'pending';
              return (
                <div
                  key={cls.id}
                  className={`bg-white border border rounded-xl p-6 ${
                    isPending ? 'border-yellow-700/50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-medium text-gray-900">{cls.name}</h3>
                        {isPending ? (
                          <span className="px-3 py-1 text-sm bg-yellow-100 text-yellow-700 rounded-full">待审核</span>
                        ) : (
                          <span className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded-full">已通过</span>
                        )}
                      </div>
                      {isPending && (
                        <p className="text-yellow-400 text-sm mb-3">⚠️ 班级正在审核中，审核通过后方可正常使用</p>
                      )}
                      {cls.description && (
                        <p className="text-gray-9000 mb-3">{cls.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-9000">
                        <span>邀请码: <code className="bg-gray-50 px-2 py-1 rounded text-gray-700">{cls.invite_code}</code></span>
                        {!isPending && (cls.userRole === 'creator' || cls.userRole === 'moderator') && (
                          <span className="text-gray-9000 text-xs ml-2">
                            · {cls.userRole === 'creator' ? '管理员' : '审核员'}
                          </span>
                        )}
                        <span className="text-gray-9000 text-xs ml-2">
                          创建于 {new Date(cls.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!isPending && (cls.userRole === 'creator' || cls.userRole === 'moderator') && (
                        <button
                          onClick={() => openMembersModal(cls)}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                        >
                          管理成员
                        </button>
                      )}
                      {!isPending && cls.userRole !== 'creator' && (
                        <button
                          onClick={() => handleLeaveClass(cls.id, cls.name)}
                          className="px-4 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition-colors text-sm"
                        >
                          退出班级
                        </button>
                      )}
                      {isPending && (
                        <span className="px-4 py-2 text-sm text-gray-9000">等待审核</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 创建班级弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-50/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">创建新班级</h2>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-gray-600">
                ⚠️ 新创建的班级需要超级管理员审核后才能正常使用。
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  班级名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="例如：高等数学A班"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none text-gray-800 placeholder-gray-500"
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  班级描述
                </label>
                <textarea
                  value={classDesc}
                  onChange={(e) => setClassDesc(e.target.value)}
                  placeholder="简单描述一下这个班级..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none resize-none text-gray-800 placeholder-gray-500"
                  disabled={creating}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-9000 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={creating}
              >
                取消
              </button>
              <button
                onClick={handleCreateClass}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:bg-white disabled:text-gray-9000"
              >
                {creating ? '创建中...' : '提交审核'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加入班级弹窗 */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-gray-50/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">加入班级</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  邀请码 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="输入8位邀请码"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none text-gray-800 placeholder-gray-500 uppercase"
                  disabled={joining}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  申请说明（可选）
                </label>
                <textarea
                  value={joinMessage}
                  onChange={(e) => setJoinMessage(e.target.value)}
                  placeholder="告诉管理员一些关于你的信息..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none resize-none text-gray-800 placeholder-gray-500"
                  disabled={joining}
                />
              </div>
              {joinError && (
                <p className="text-sm text-red-400">{joinError}</p>
              )}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-600">
                  ⚠️ 提交申请后，需要等待班级管理员审核批准后才能加入班级。
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinError('');
                }}
                className="px-4 py-2 text-gray-9000 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={joining}
              >
                取消
              </button>
              <button
                onClick={handleJoinClass}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:bg-white disabled:text-gray-9000"
              >
                {joining ? '提交申请...' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 成员管理弹窗 */}
      {showMembersModal && selectedClass && (
        <div className="fixed inset-0 bg-gray-50/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">{selectedClass.name} - 成员管理</h2>
              <button
                onClick={() => setShowMembersModal(false)}
                className="text-gray-9000 hover:text-gray-9000 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-4 border-b border-gray-200">
              <p className="text-sm text-gray-9000">邀请码: <code className="bg-gray-50 px-2 py-1 rounded text-gray-700">{selectedClass.invite_code}</code></p>
            </div>
            {loadingMembers ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-9000">加载中...</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {members.length === 0 ? (
                  <p className="text-center text-gray-9000 py-8">暂无成员</p>
                ) : (
                  <div className="space-y-2">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 bg-gray-50/50 border border-gray-200 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {getUserAvatar(member)}
                          <div>
                            <p className="font-medium text-gray-800">{member.username}</p>
                            <div className="flex items-center gap-2 text-xs text-gray-9000">
                              <span>加入于 {new Date(member.joined_at).toLocaleDateString()}</span>
                              {getStatusBadge(member.status)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getRoleBadge(member.role)}
                          {member.message && (
                            <button
                              onClick={() => alert(`申请说明: ${member.message}`)}
                              className="text-gray-9000 hover:text-gray-9000 text-xs"
                              title="查看申请说明"
                            >
                              💬
                            </button>
                          )}
                          {(selectedClass.userRole === 'creator' || selectedClass.userRole === 'moderator') && (
                            <button
                              onClick={() => handleRemoveMember(member.id, member.username)}
                              className="text-red-400 hover:text-red-300 p-2 hover:bg-red-900/30 rounded-lg transition-colors"
                              title="移除成员"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
