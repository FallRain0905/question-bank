'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { KBDocument } from '@/types';
import KnowledgeGraph from '@/components/KnowledgeGraph';

type TabKey = 'docs' | 'index' | 'graph';

export default function KnowledgeBaseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const kbId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [kbName, setKbName] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('docs');
  const [entities, setEntities] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [entitiesTotal, setEntitiesTotal] = useState(0);
  const [relationshipsTotal, setRelationshipsTotal] = useState(0);
  const [entitiesPage, setEntitiesPage] = useState(1);
  const [relationshipsPage, setRelationshipsPage] = useState(1);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [loadingRelationships, setLoadingRelationships] = useState(false);
  const [indexLogs, setIndexLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string | null>(null);
  const [authToken, setAuthToken] = useState<string>('');

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabase();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      userIdRef.current = u.id;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) setAuthToken(session.access_token);
      loadDocs(u.id);
    };
    init();
  }, [kbId]);

  const loadDocs = async (uid?: string) => {
    const currentUserId = uid || userIdRef.current;
    if (!currentUserId) return;
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch('/api/kb', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const kbs = await res.json();
      const kb = kbs.find((k: any) => k.id === kbId);
      if (kb) setKbName(kb.name);
    }

    const { data, error } = await supabase
      .from('kb_documents')
      .select('*')
      .eq('kb_id', kbId)
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false });

    if (!error && data) setDocs(data as KBDocument[]);
    setLoading(false);
  };

  const getToken = async () => {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  const loadEntities = async (page = 1) => {
    const token = await getToken();
    if (!token) return;
    setLoadingEntities(true);
    try {
      const res = await fetch(`/api/hyperrag/entities?kb_id=${kbId}&page=${page}&page_size=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntities(data.entities || []);
        setEntitiesTotal(data.total || 0);
        setEntitiesPage(page);
      }
    } catch {}
    setLoadingEntities(false);
  };

  const loadRelationships = async (page = 1) => {
    const token = await getToken();
    if (!token) return;
    setLoadingRelationships(true);
    try {
      const res = await fetch(`/api/hyperrag/relationships?kb_id=${kbId}&page=${page}&page_size=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRelationships(data.relationships || []);
        setRelationshipsTotal(data.total || 0);
        setRelationshipsPage(page);
      }
    } catch {}
    setLoadingRelationships(false);
  };

  useEffect(() => {
    if (activeTab === 'index') {
      loadEntities(1);
      loadRelationships(1);
    }
  }, [activeTab]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [indexLogs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('file', file);

      const res = await fetch(`/api/kb/${kbId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (res.ok) {
        loadDocs(userIdRef.current || undefined);
      } else {
        const err = await res.json();
        alert(err.error || '上传失败');
      }
    } catch {
      alert('上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('确定删除此文档？')) return;
    const token = await getToken();
    await fetch(`/api/kb/documents/${docId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setDocs(docs.filter((d) => d.id !== docId));
  };

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setIndexLogs(prev => [...prev, `[${time}] ${msg}`]);
  };

  const handleBuildIndex = async (docIds?: string[]) => {
    setIndexing(true);
    setIndexLogs([]);
    const startTime = Date.now();
    const getElapsed = () => {
      const s = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(s / 60);
      return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
    };

    addLog('开始构建索引...');
    addLog('正在准备文档数据和模型配置');

    let progressInterval: NodeJS.Timeout | null = null;
    let lastProgressLog = '';

    try {
      const token = await getToken();
      const body: any = { kb_id: kbId };
      if (docIds) body.doc_ids = docIds;

      const docCount = docIds ? docIds.length : docs.filter((d: any) => d.content_md).length;
      addLog(`发送 ${docCount} 个文档到 Graph-RAG 索引服务`);
      addLog('文档嵌入过程需要调用 AI 模型提取实体和关系，请耐心等待...');

      // Start polling real progress from Python service
      progressInterval = setInterval(async () => {
        try {
          const t = await getToken();
          if (!t) return;
          const res = await fetch(`/api/hyperrag/sync-progress?kb_id=${kbId}`, {
            headers: { Authorization: `Bearer ${t}` },
          });
          if (!res.ok) return;
          const p = await res.json();
          if (p.status === 'running') {
            const parts: string[] = [];
            if (p.current_doc) parts.push(`当前: ${p.current_doc}`);
            parts.push(`进度: ${p.processed_docs || 0}/${p.total_docs || '?'} 文档`);
            if (p.entities) parts.push(`${p.entities} 实体`);
            if (p.relations) parts.push(`${p.relations} 关系`);
            if (p.progress) parts.push(`${p.progress.toFixed(1)}%`);
            const msg = parts.join(' · ');
            if (msg !== lastProgressLog) {
              addLog(msg);
              lastProgressLog = msg;
            }
          }
        } catch {}
      }, 3000);

      const res = await fetch('/api/hyperrag/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (res.ok) {
        const successCount = result.results?.filter?.((r: any) => r.success)?.length || 0;
        const failCount = result.results?.filter?.((r: any) => !r.success)?.length || 0;
        const errorDetails = result.results?.filter?.((r: any) => !r.success)?.map((r: any) => r.error)?.join('; ');
        addLog(`索引构建完成 (耗时 ${getElapsed()}): ${successCount} 个文档成功${failCount > 0 ? `, ${failCount} 个失败` : ''}`);
        if (errorDetails) addLog(`失败原因: ${errorDetails}`);
        loadDocs(userIdRef.current || undefined);
      } else {
        addLog(`索引构建失败 (耗时 ${getElapsed()}): ${result.error || '未知错误'}`);
      }
    } catch (err: any) {
      addLog(`索引构建异常 (耗时 ${getElapsed()}): ${err.message}`);
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIndexing(false);
      setTimeout(() => {
        if (activeTab === 'index') {
          loadEntities(1);
          loadRelationships(1);
        }
      }, 500);
    }
  };

  const indexStatusLabel = (status?: string) => {
    switch (status) {
      case 'indexed': return <span className="text-green-600">已索引</span>;
      case 'indexing': return <span className="text-blue-600">索引中</span>;
      case 'index_error': return <span className="text-red-500">索引失败</span>;
      default: return <span className="text-gray-400">未索引</span>;
    }
  };

  const indexedCount = docs.filter(d => (d as any).index_status === 'indexed').length;
  const notIndexedDocIds = docs.filter(d => (d as any).index_status !== 'indexed').map(d => d.id);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'docs', label: '文档' },
    { key: 'index', label: '索引管理' },
    { key: 'graph', label: '知识图谱' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/kb" className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-1 inline-block">← 知识库</Link>
          <h1 className="text-2xl font-bold text-gray-900">{kbName || '加载中...'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/qa" className="px-3 py-2 text-sm text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
            知识问答 →
          </Link>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Docs Tab */}
      {activeTab === 'docs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{docs.length} 个文档</p>
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept=".md,.docx,.txt" onChange={handleUpload} className="hidden" />
              <button
                onClick={() => handleBuildIndex()}
                disabled={indexing || docs.length === 0}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {indexing ? '索引中...' : '构建全部索引'}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {uploading ? '上传中...' : '上传文档'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">加载中...</div>
          ) : docs.length === 0 ? (
            <div className="text-center py-16 bg-white border border-gray-100 rounded-xl">
              <p className="text-gray-400 mb-2">还没有文档</p>
              <p className="text-xs text-gray-300">暂且只支持 Markdown、DOCX、TXT 文件</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {docs.map((doc) => (
                <div key={doc.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 hover:shadow-sm transition-all flex items-center justify-between">
                  <Link href={`/kb/${kbId}/doc/${doc.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-medium uppercase">
                        {doc.file_type || 'md'}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-gray-900 truncate">{doc.title}</h3>
                        <p className="text-xs text-gray-400">
                          {doc.content_md ? `${doc.content_md.length} 字符` : ''}
                          {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                        </p>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 ml-3">
                    <span className="text-[10px]">{indexStatusLabel((doc as any).index_status)}</span>
                    <Link href={`/generator?doc=${doc.id}`} className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1">出题</Link>
                    <button onClick={() => handleDelete(doc.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Index Management Tab */}
      {activeTab === 'index' && (
        <div className="space-y-6">
          {/* Status Overview */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">索引状态概览</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900">{docs.length}</div>
                <div className="text-xs text-gray-500">总文档</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{indexedCount}</div>
                <div className="text-xs text-green-600">已索引</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-400">{docs.length - indexedCount}</div>
                <div className="text-xs text-gray-500">未索引</div>
              </div>
            </div>
            {docs.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${docs.length > 0 ? (indexedCount / docs.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">{docs.length > 0 ? Math.round((indexedCount / docs.length) * 100) : 0}%</span>
                <button
                  onClick={() => handleBuildIndex(notIndexedDocIds.length > 0 ? notIndexedDocIds : undefined)}
                  disabled={indexing || docs.length === 0}
                  className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {indexing ? '索引中...' : notIndexedDocIds.length > 0 ? `构建未索引 (${notIndexedDocIds.length})` : '重新构建全部'}
                </button>
              </div>
            )}
          </div>

          {/* Index Log */}
          {(indexing || indexLogs.length > 0) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-300">索引日志</h3>
                {indexing && (
                  <span className="text-xs text-amber-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                    文档嵌入过程需要调用 AI 模型抽取实体和关系，可能需要数分钟，请耐心等待
                  </span>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto font-mono text-xs space-y-0.5">
                {indexLogs.map((log, i) => (
                  <div key={i} className={`${
                    log.includes('失败') || log.includes('异常') ? 'text-red-400' :
                    log.includes('完成') ? 'text-green-400' : 'text-gray-400'
                  }`}>{log}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* Entities Table */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-700">实体 ({entitiesTotal})</h3>
              <button onClick={() => loadEntities(entitiesPage)} disabled={loadingEntities}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50">
                {loadingEntities ? '加载中...' : '刷新'}
              </button>
            </div>
            {entities.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">暂无实体数据，请先构建索引</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs">
                        <th className="px-4 py-2 text-left font-medium">实体名称</th>
                        <th className="px-4 py-2 text-left font-medium">类型</th>
                        <th className="px-4 py-2 text-left font-medium">描述</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entities.map((ent: any, i: number) => (
                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{ent.entity_name}</td>
                          <td className="px-4 py-2.5">
                            {ent.entity_type ? (
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{ent.entity_type}</span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">{ent.description || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {entitiesTotal > 20 && (
                  <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-gray-100">
                    <button
                      onClick={() => loadEntities(entitiesPage - 1)}
                      disabled={entitiesPage <= 1}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded disabled:opacity-50"
                    >上一页</button>
                    <span className="text-xs text-gray-400">{entitiesPage} / {Math.ceil(entitiesTotal / 20)}</span>
                    <button
                      onClick={() => loadEntities(entitiesPage + 1)}
                      disabled={entitiesPage >= Math.ceil(entitiesTotal / 20)}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded disabled:opacity-50"
                    >下一页</button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Relationships Table */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-700">关系 ({relationshipsTotal})</h3>
              <button onClick={() => loadRelationships(relationshipsPage)} disabled={loadingRelationships}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50">
                {loadingRelationships ? '加载中...' : '刷新'}
              </button>
            </div>
            {relationships.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">暂无关系数据，请先构建索引</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs">
                        <th className="px-4 py-2 text-left font-medium">实体集</th>
                        <th className="px-4 py-2 text-left font-medium">关键词</th>
                        <th className="px-4 py-2 text-left font-medium">摘要</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relationships.map((rel: any, i: number) => (
                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {(rel.entity_set || '').split('|').map((name: string, j: number) => (
                                <span key={j} className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">{name}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{rel.keywords || '-'}</td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">{rel.summary || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {relationshipsTotal > 20 && (
                  <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-gray-100">
                    <button
                      onClick={() => loadRelationships(relationshipsPage - 1)}
                      disabled={relationshipsPage <= 1}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded disabled:opacity-50"
                    >上一页</button>
                    <span className="text-xs text-gray-400">{relationshipsPage} / {Math.ceil(relationshipsTotal / 20)}</span>
                    <button
                      onClick={() => loadRelationships(relationshipsPage + 1)}
                      disabled={relationshipsPage >= Math.ceil(relationshipsTotal / 20)}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded disabled:opacity-50"
                    >下一页</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Graph Tab */}
      {activeTab === 'graph' && authToken && (
        <KnowledgeGraph kbId={kbId} token={authToken} height="calc(100vh - 320px)" />
      )}
    </div>
  );
}
