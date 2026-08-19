'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import type { UserSettings } from '@/types';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings>({
    llm_provider: 'deepseek',
    llm_api_url: '',
    llm_model: '',
    mineru_api_key: '',
    embedding_api_key: '',
    embedding_api_url: '',
    embedding_model: '',
    embedding_dimensions: 1024,
    hyperrag_service_url: '',
    semantic_scholar_api_key: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showMineruKey, setShowMineruKey] = useState(false);
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false);
  const [showScholarKey, setShowScholarKey] = useState(false);
  const [ragStatus, setRagStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/settings', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (res.ok) setSettings(await res.json());
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSettings(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      const data = await res.json().catch(() => null);
      alert(data?.hint || data?.error || '保存失败');
    }
    setSaving(false);
  };

  const update = (k: keyof UserSettings, v: string | number) => setSettings({ ...settings, [k]: v });

  const testRagConnection = async () => {
    const url = settings.hyperrag_service_url || 'http://localhost:8001';
    setRagStatus('testing');
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) setRagStatus('ok');
      else setRagStatus('fail');
    } catch { setRagStatus('fail'); }
  };

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-10 text-center text-gray-400">加载中...</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">设置</h1>
      <p className="text-sm text-gray-500 mb-8">配置 API，留空则使用系统默认</p>

      <form onSubmit={handleSave} className="space-y-8">
        {/* LLM */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">AI 大模型</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">提供商</label>
              <select value={settings.llm_provider} onChange={(e) => update('llm_provider', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400">
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">千问 (DashScope)</option>
                <option value="kimi">Kimi (Moonshot)</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API URL</label>
              <input type="text" value={settings.llm_api_url} onChange={(e) => update('llm_api_url', e.target.value)}
                placeholder={settings.llm_provider === 'deepseek' ? 'https://api.siliconflow.cn/v1/chat/completions' :
                  settings.llm_provider === 'qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' :
                  settings.llm_provider === 'kimi' ? 'https://api.moonshot.cn/v1/chat/completions' :
                  'https://api.example.com/v1/chat/completions'}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">模型名称</label>
              <input type="text" value={settings.llm_model} onChange={(e) => update('llm_model', e.target.value)}
                placeholder={settings.llm_provider === 'deepseek' ? 'deepseek-ai/DeepSeek-V4-Flash' :
                  settings.llm_provider === 'qwen' ? 'qwen-plus' :
                  settings.llm_provider === 'kimi' ? 'moonshot-v1-8k' : 'gpt-4o'}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
            </div>

            <p className="text-xs text-gray-400">
              API Key 统一在服务器 <code className="text-gray-600">.env.local</code> 的 <code className="text-gray-600">LLM_API_KEY</code> 中配置，此处无需填写。
            </p>
          </div>
        </div>

        {/* MinerU */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">MinerU 文档解析</h2>
          <p className="text-xs text-gray-400 mb-4">
            在 <a href="https://mineru.net/apiManage" target="_blank" rel="noopener noreferrer" className="text-blue-600">mineru.net</a> 获取 API Token
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">API Token</label>
            <div className="relative">
              <input type={showMineruKey ? 'text' : 'password'} value={settings.mineru_api_key} onChange={(e) => update('mineru_api_key', e.target.value)}
                placeholder="留空使用系统默认" className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
              <button type="button" onClick={() => setShowMineruKey(!showMineruKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={showMineruKey ? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 00-3-3m0 0a9.97 9.97 0 00-3.029 1.563M4.222 4.222l15.556 15.556' : 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.733 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z'} />
              </svg>
            </button>
          </div>
        </div>
        </div>

        {/* Embedding Model */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">嵌入模型</h2>
          <p className="text-xs text-gray-400 mb-4">用于知识库文档向量化，支持跨文档检索问答。所有字段均需手动填写。</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API URL</label>
              <input type="text" value={settings.embedding_api_url} onChange={(e) => update('embedding_api_url', e.target.value)}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">模型名称</label>
              <input type="text" value={settings.embedding_model} onChange={(e) => update('embedding_model', e.target.value)}
                placeholder="text-embedding-v3"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">向量维度</label>
              <input type="number" value={settings.embedding_dimensions} onChange={(e) => update('embedding_dimensions', parseInt(e.target.value) || 1024)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
              <div className="relative">
                <input type={showEmbeddingKey ? 'text' : 'password'} value={settings.embedding_api_key} onChange={(e) => update('embedding_api_key', e.target.value)}
                  placeholder="sk-..." className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
                <button type="button" onClick={() => setShowEmbeddingKey(!showEmbeddingKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={showEmbeddingKey ? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 00-3-3m0 0a9.97 9.97 0 00-3.029 1.563M4.222 4.222l15.556 15.556' : 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.733 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z'} />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Hyper-RAG Service */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Hyper-RAG 服务</h2>
          <p className="text-xs text-gray-400 mb-4">知识库问答的 Python 后端服务地址</p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">服务地址</label>
              <input type="text" value={settings.hyperrag_service_url} onChange={(e) => update('hyperrag_service_url', e.target.value)}
                placeholder="http://localhost:8001"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400" />
            </div>
            <button type="button" onClick={testRagConnection} disabled={ragStatus === 'testing'}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
              {ragStatus === 'testing' ? '测试中...' : '测试连接'}
            </button>
          </div>
          {ragStatus === 'ok' && <p className="text-xs text-green-600 mt-2">连接成功</p>}
          {ragStatus === 'fail' && <p className="text-xs text-red-500 mt-2">连接失败，请检查服务是否启动</p>}
        </div>

        {/* Research Tools */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">AI Tools</h2>
          <p className="text-xs text-gray-400 mb-4">
            Semantic Scholar is used by the AI reading agent and research search for academic paper lookup.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Semantic Scholar API Key</label>
            <div className="relative">
              <input
                type={showScholarKey ? 'text' : 'password'}
                value={settings.semantic_scholar_api_key}
                onChange={(e) => update('semantic_scholar_api_key', e.target.value)}
                placeholder="Leave blank to use system default or unauthenticated search"
                className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
              />
              <button type="button" onClick={() => setShowScholarKey(!showScholarKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={showScholarKey ? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 00-3-3m0 0a9.97 9.97 0 00-3.029 1.563M4.222 4.222l15.556 15.556' : 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.733 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z'} />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving}
          className={`w-full py-3 rounded-lg text-sm font-medium transition-colors ${
            saved ? 'bg-green-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-800'
          } disabled:opacity-50`}>
          {saving ? '保存中...' : saved ? '✓ 已保存' : '保存设置'}
        </button>
      </form>
    </div>
  );
}
