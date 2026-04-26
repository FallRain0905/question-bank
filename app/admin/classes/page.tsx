'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

interface ClassApprovalRequest {
  id: string;
  class_id: string;
  user_id: string;
  name: string;
  description: string;
  invite_code: string;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason?: string;
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  message?: string;
}

export default function AdminClassesPage() {
  const [requests, setRequests] = useState<ClassApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // 审核相关状态
  const [selectedRequest, setSelectedRequest] = useState<ClassApprovalRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const SUPER_ADMIN_EMAIL = '3283254551@qq.com';

  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    if (user && isAdmin) {
      loadRequests();
    }
  }, [user, isAdmin]);

  const checkUser = async () => {
    const { data: { user } } = await getSupabase().auth.getUser();
    if (user) {
      setUser(user);
      setIsAdmin(user?.user_metadata?.is_admin === true || user?.email === SUPER_ADMIN_EMAIL);
    } else {
      setLoading(false);
    }
  };

  const loadRequests = async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('class_approval_requests')
        .select('*')
        .order('requested_at', { ascending: false });

      if (error) {
        console.error('获取审核请求失败:', error);
        setRequests([]);
      } else {
        setRequests(data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedRequest) return;

    setProcessing(true);
    try {
      const supabase = getSupabase();

      // 更新 classes 表状态为 approved
      const { error: classError } = await supabase
        .from('classes')
        .update({ status: 'approved' })
        .eq('id', selectedRequest.class_id);

      if (classError) throw classError;

      // 更新 class_approval_requests 表
      const { error: requestError } = await supabase
        .from('class_approval_requests')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', selectedRequest.id);

      if (requestError) throw requestError;

      await loadRequests();
      setSelectedRequest(null);
      alert(`已批准班级 "${selectedRequest.name}" 的创建申请`);
    } catch (error: any) {
      console.error('批准班级失败:', error);
      alert('批准失败: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest || !rejectReason.trim()) {
      alert('请输入拒绝原因');
      return;
    }

    if (!confirm(`确定要拒绝班级 "${selectedRequest.name}" 的创建申请吗？`)) {
      return;
    }

    setProcessing(true);
    try {
      const supabase = getSupabase();

      // 更新 classes 表状态为 rejected
      const { error: classError } = await supabase
        .from('classes')
        .update({
          status: 'rejected',
          reject_reason: rejectReason,
        })
        .eq('id', selectedRequest.class_id);

      if (classError) throw classError;

      // 更新 class_approval_requests 表
      const { error: requestError } = await supabase
        .from('class_approval_requests')
        .update({
          status: 'rejected',
          reject_reason: rejectReason,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', selectedRequest.id);

      if (requestError) throw requestError;

      await loadRequests();
      setSelectedRequest(null);
      setRejectReason('');
      alert(`已拒绝班级 "${selectedRequest.name}" 的创建申请`);
    } catch (error: any) {
      console.error('拒绝班级失败:', error);
      alert('拒绝失败: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-3 py-1 text-sm bg-yellow-100 text-yellow-700 rounded-full">待审核</span>;
      case 'approved':
        return <span className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded-full">已通过</span>;
      case 'rejected':
        return <span className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-full">已拒绝</span>;
      default:
        return <span className="px-3 py-1 text-sm bg-gray-100 text-gray-300 rounded-full">{status}</span>;
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <p className="text-gray-400 mb-4">请先登录</p>
          <a href="/login" className="inline-block px-6 py-2 bg-gray-500 text-gray-50 rounded-lg hover:bg-gray-400">
            去登录
          </a>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <p className="text-gray-400">您没有权限访问此页面</p>
          <a href="/" className="inline-block mt-4 px-6 py-2 bg-gray-500 text-gray-50 rounded-lg hover:bg-gray-400">
            返回首页
          </a>
        </div>
      </div>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-50">班级创建审核</h1>
              <p className="text-gray-400 mt-1">审核用户提交的班级创建申请</p>
            </div>
            {/* 系统配置按钮 - 仅超级管理员可见 */}
            {isAdmin && (
              <Link
                href="/admin/settings"
                className="px-3 py-1.5 bg-gray-700 text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-600 transition flex items-center gap-1"
              >
                ⚙️ 系统配置
              </Link>
            )}
          </div>
          <div className="flex gap-4">
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2">
              <span className="text-gray-400 text-sm">待审核:</span>
              <span className="ml-2 text-yellow-400 font-bold">{pendingRequests.length}</span>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2">
              <span className="text-gray-400 text-sm">已处理:</span>
              <span className="ml-2 text-gray-200 font-bold">{processedRequests.length}</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-gray-400">加载中...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h2 className="text-xl font-medium text-gray-200 mb-2">暂无审核请求</h2>
            <p className="text-gray-400">目前没有待审核的班级创建申请</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 待审核 */}
            {pendingRequests.length > 0 && (
              <div>
                <h2 className="text-lg font-medium text-gray-200 mb-4 flex items-center gap-2">
                  <span>📋</span>
                  <span>待审核 ({pendingRequests.length})</span>
                </h2>
                <div className="grid gap-4">
                  {pendingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6"
                    >
                      <div className="flex justify-between items-start gap-6">
                        <div className="flex-1">
                          <h3 className="text-xl font-medium text-gray-50 mb-2">{request.name}</h3>
                          {request.description && (
                            <p className="text-gray-400 mb-4">{request.description}</p>
                          )}
                          <div className="flex flex-wrap gap-6 text-sm text-gray-500">
                            <span>邀请码: <code className="bg-gray-900 px-2 py-1 rounded text-gray-200">{request.invite_code}</code></span>
                            <span>创建者: <span className="text-gray-400 text-xs ml-1">{request.user_id?.slice(0, 8)}...</span></span>
                            <span className="text-gray-400 text-xs">
                              {new Date(request.requested_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {getStatusBadge(request.status)}
                          <button
                            onClick={() => {
                              setSelectedRequest(request);
                              setRejectReason('');
                            }}
                            className="px-4 py-2 text-sm bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
                          >
                            审核
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 已处理 */}
            {processedRequests.length > 0 && (
              <div>
                <h2 className="text-lg font-medium text-gray-200 mb-4 flex items-center gap-2">
                  <span>✅</span>
                  <span>已处理 ({processedRequests.length})</span>
                </h2>
                <div className="grid gap-4">
                  {processedRequests.map((request) => (
                    <div
                      key={request.id}
                      className="bg-gray-800/30 border border-gray-800/50 rounded-xl p-6"
                    >
                      <div className="flex justify-between items-start gap-6">
                        <div className="flex-1">
                          <h3 className="text-lg font-medium text-gray-200 mb-2">{request.name}</h3>
                          {request.description && (
                            <p className="text-gray-500 mb-4">{request.description}</p>
                          )}
                          <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                            <span>邀请码: <code className="bg-gray-900 px-2 py-1 rounded text-gray-400">{request.invite_code}</code></span>
                            <span className="text-gray-400 text-xs">
                              {new Date(request.requested_at).toLocaleString()}
                            </span>
                          </div>
                          {request.reject_reason && (
                            <div className="mt-3 bg-red-900/20 border border-red-800/30 rounded-lg p-3">
                              <span className="text-red-400 text-sm">拒绝原因: {request.reject_reason}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {getStatusBadge(request.status)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 审核弹窗 */}
        {selectedRequest && (
          <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full">
              <div className="p-6 border-b border-gray-700">
                <div className="flex justify-between items-start">
                  <h2 className="text-xl font-bold text-gray-50">审核班级创建申请</h2>
                  <button
                    onClick={() => {
                      setSelectedRequest(null);
                      setRejectReason('');
                    }}
                    className="text-gray-500 hover:text-gray-400 text-2xl"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-400">班级名称</label>
                    <p className="text-lg font-medium text-gray-100">{selectedRequest.name}</p>
                  </div>
                  {selectedRequest.description && (
                    <div>
                      <label className="text-sm font-medium text-gray-400">班级描述</label>
                      <p className="text-gray-200">{selectedRequest.description}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-400">邀请码</label>
                    <code className="bg-gray-900 px-3 py-1 rounded text-gray-200">{selectedRequest.invite_code}</code>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-400">创建者 ID</label>
                    <code className="bg-gray-900 px-3 py-1 rounded text-gray-200">{selectedRequest.user_id?.slice(0, 8)}...</code>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-400">申请时间</label>
                    <p className="text-gray-200">{new Date(selectedRequest.requested_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-400">申请说明</label>
                    <p className="text-gray-200">{selectedRequest.message || '无'}</p>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-gray-700 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    拒绝原因（拒绝时必填）
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="请说明拒绝原因..."
                    rows={3}
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none text-gray-100 placeholder-gray-500 resize-none"
                    disabled={processing}
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setSelectedRequest(null);
                      setRejectReason('');
                    }}
                    className="px-6 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg hover:bg-gray-700"
                    disabled={processing}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleReject}
                    className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-800"
                    disabled={processing}
                  >
                    {processing ? '处理中...' : '拒绝'}
                  </button>
                  <button
                    onClick={handleApprove}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-800"
                    disabled={processing}
                  >
                    {processing ? '处理中...' : '批准'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
