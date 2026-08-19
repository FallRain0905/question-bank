'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

type ApiSettings = {
  llm_provider: string;
  llm_api_url: string;
  llm_model: string;
  embedding_api_url: string;
  embedding_api_key: string;
  embedding_model: string;
  embedding_dimensions: string;
  hyperrag_service_url: string;
  mineru_api_key: string;
  semantic_scholar_api_key: string;
  tavily_api_key: string;
  github_token: string;
  nextcloud_url: string;
  nextcloud_user: string;
  nextcloud_password: string;
  nextcloud_public_url: string;
};

const defaultApiSettings: ApiSettings = {
  llm_provider: 'deepseek',
  llm_api_url: 'https://api.siliconflow.cn/v1/chat/completions',
  llm_model: 'deepseek-ai/DeepSeek-V4-Flash',
  embedding_api_url: 'https://api.siliconflow.cn/v1/embeddings',
  embedding_api_key: '',
  embedding_model: 'Qwen/Qwen3-Embedding-4B',
  embedding_dimensions: '2560',
  hyperrag_service_url: 'http://localhost:8001',
  mineru_api_key: '',
  semantic_scholar_api_key: '',
  tavily_api_key: '',
  github_token: '',
  nextcloud_url: '',
  nextcloud_user: '',
  nextcloud_password: '',
  nextcloud_public_url: '',
};

function settingRows() {
  return [
    {
      title: '对话模型',
      description: '全站默认 LLM（模型名/地址/供应商可修改）。API Key 统一在服务器 .env.local 的 LLM_API_KEY 中配置。',
      fields: [
        ['llm_provider', '提供商', 'deepseek'],
        ['llm_api_url', 'API 地址', 'https://api.siliconflow.cn/v1/chat/completions'],
        ['llm_model', '模型', 'deepseek-ai/DeepSeek-V4-Flash'],
      ],
    },
    {
      title: '嵌入模型与 HyperRAG',
      description: '知识库同步、文档嵌入和检索增强会使用这组默认值。',
      fields: [
        ['embedding_api_url', '嵌入 API 地址', 'https://api.siliconflow.cn/v1/embeddings'],
        ['embedding_api_key', '嵌入 API Key', 'sk-...', 'password'],
        ['embedding_model', '嵌入模型', 'Qwen/Qwen3-Embedding-4B'],
        ['embedding_dimensions', '向量维度', '2560'],
        ['hyperrag_service_url', 'HyperRAG 服务地址', 'http://localhost:8001'],
      ],
    },
    {
      title: '工具 API',
      description: 'Agent、搜索和文档转换工具的系统级默认 Key。',
      fields: [
        ['mineru_api_key', 'MinerU Token', 'MinerU API Token', 'password'],
        ['semantic_scholar_api_key', 'Semantic Scholar Key', '可选', 'password'],
        ['tavily_api_key', 'Tavily Key', '可选', 'password'],
        ['github_token', 'GitHub Token', '可选', 'password'],
      ],
    },
  ] as Array<{
    title: string;
    description: string;
    fields: Array<[keyof ApiSettings, string, string, string?]>;
  }>;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [apiSettings, setApiSettings] = useState<ApiSettings>(defaultApiSettings);

  useEffect(() => {
    bootstrap();
  }, []);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await getSupabase().auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  };

  const bootstrap = async () => {
    try {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      if (user.user_metadata?.is_admin !== true && user.email !== '3283254551@qq.com') {
        router.push('/');
        return;
      }
      setIsAdmin(true);
      await loadApiSettings();
    } finally {
      setLoading(false);
    }
  };

  const loadApiSettings = async () => {
    const res = await fetch('/api/admin/api-settings', { headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载 API 设置失败');
    setApiSettings({
      ...defaultApiSettings,
      ...(data.settings || {}),
      embedding_dimensions: String(data.settings?.embedding_dimensions || defaultApiSettings.embedding_dimensions),
    });
  };

  const updateApiSetting = (key: keyof ApiSettings, value: string) => {
    setApiSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const normalized = {
        ...apiSettings,
      };
      const res = await fetch('/api/admin/api-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ settings: normalized }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存 API 设置失败');
      setApiSettings({ ...normalized, ...(data.settings || {}) });
      setMessage('配置已保存。');
    } catch (error: any) {
      setMessage(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestNextcloud = async () => {
    if (!apiSettings.nextcloud_url || !apiSettings.nextcloud_user || !apiSettings.nextcloud_password) {
      setMessage('请先填写 Nextcloud 配置信息。');
      return;
    }
    const response = await fetch('/api/test-nextcloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: apiSettings.nextcloud_url,
        user: apiSettings.nextcloud_user,
        password: apiSettings.nextcloud_password,
      }),
    });
    const result = await response.json();
    setMessage(result.success ? 'Nextcloud 连接测试成功。' : `Nextcloud 连接测试失败：${result.error || '未知错误'}`);
  };

  if (!isAdmin) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">系统配置</h1>
            <p className="mt-1 text-sm text-gray-600">管理系统级 API、嵌入模型、主控 Agent 默认模型和云盘配置。</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>

        {message && (
          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">加载配置中...</div>
        ) : (
          <div className="space-y-6">
            {settingRows().map(section => (
              <section key={section.title} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
                  <p className="mt-1 text-xs text-gray-500">{section.description}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.fields.map(([key, label, placeholder, type]) => (
                    <label key={key} className="block">
                      <span className="text-xs font-medium text-gray-600">{label}</span>
                      <input
                        type={type === 'password' ? 'password' : type === 'readonly' ? 'text' : 'text'}
                        value={apiSettings[key]}
                        readOnly={type === 'readonly'}
                        onChange={event => updateApiSetting(key, event.target.value)}
                        placeholder={placeholder}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 disabled:bg-gray-50 read-only:bg-gray-50"
                      />
                    </label>
                  ))}
                </div>
              </section>
            ))}

            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Nextcloud 云盘配置</h2>
                  <p className="mt-1 text-xs text-gray-500">保留原有云盘能力。</p>
                </div>
                <button
                  onClick={handleTestNextcloud}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-300"
                >
                  测试连接
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Nextcloud URL</span>
                  <input value={apiSettings.nextcloud_url} onChange={event => updateApiSetting('nextcloud_url', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">公共访问 URL</span>
                  <input value={apiSettings.nextcloud_public_url} onChange={event => updateApiSetting('nextcloud_public_url', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">用户名</span>
                  <input value={apiSettings.nextcloud_user} onChange={event => updateApiSetting('nextcloud_user', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">密码</span>
                  <input type="password" value={apiSettings.nextcloud_password} onChange={event => updateApiSetting('nextcloud_password', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300" />
                </label>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
