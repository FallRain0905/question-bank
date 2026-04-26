'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import type { UserSettings } from '@/types';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings>({
    llm_provider: 'qwen',
    llm_api_key: '',
    llm_api_url: '',
    mineru_api_key: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showMineruKey, setShowMineruKey] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/settings', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data);
    }
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      alert('保存失败');
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="max-w-2xl mx-auto px-4 py-10 text-center text-gray-400">加载中...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">设置</h1>
      <p className="text-sm text-gray-500 mb-8">配置你的 API Key，将使用你的个人额度</p>

      <form onSubmit={handleSave} className="space-y-8">
        {/* LLM Settings */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">AI 大模型</h2>
          <p className="text-xs text-gray-400 mb-4">配置后将使用你的个人 API Key 调用 AI，否则使用系统默认配置</p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">提供商</label>
              <select
                value={settings.llm_provider}
                onChange={(e) => setSettings({ ...settings, llm_provider: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
              >
                <option value="qwen">千问 (DashScope)</option>
                <option value="kimi">Kimi (Moonshot)</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showLlmKey ? 'text' : 'password'}
                  value={settings.llm_api_key}
                  onChange={(e) => setSettings({ ...settings, llm_api_key: e.target.value })}
                  placeholder="留空使用系统默认"
                  className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
                />
                <button
                  type="button"
                  onClick={() => setShowLlmKey(!showLlmKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={showLlmKey ? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 00-3-3m0 0a9.97 9.97 0 00-3.029 1.563M4.222 4.222l15.556 15.556' : 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.733 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z'} />
                  </svg>
                </button>
              </div>
            </div>

            {settings.llm_provider === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">自定义 API URL</label>
                <input
                  type="text"
                  value={settings.llm_api_url}
                  onChange={(e) => setSettings({ ...settings, llm_api_url: e.target.value })}
                  placeholder="https://api.example.com/v1/chat/completions"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
                />
              </div>
            )}
          </div>
        </div>

        {/* MinerU Settings */}
        <div className="bg-white border border-gray-100 rounded-xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">MinerU 文档解析</h2>
          <p className="text-xs text-gray-400 mb-4">
            在 <a href="https://mineru.net/apiManage" target="_blank" rel="noopener noreferrer" className="text-blue-600">mineru.net</a> 获取 API Token
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">API Token</label>
            <div className="relative">
              <input
                type={showMineruKey ? 'text' : 'password'}
                value={settings.mineru_api_key}
                onChange={(e) => setSettings({ ...settings, mineru_api_key: e.target.value })}
                placeholder="留空使用系统默认"
                className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
              />
              <button
                type="button"
                onClick={() => setShowMineruKey(!showMineruKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={showMineruKey ? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 00-3-3m0 0a9.97 9.97 0 00-3.029 1.563M4.222 4.222l15.556 15.556' : 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.733 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.478 0-8.268-2.943-9.542-7z'} />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className={`w-full py-3 rounded-lg text-sm font-medium transition-colors ${
            saved
              ? 'bg-green-600 text-white'
              : 'bg-gray-900 text-white hover:bg-gray-800'
          } disabled:opacity-50`}
        >
          {saving ? '保存中...' : saved ? '✓ 已保存' : '保存设置'}
        </button>
      </form>
    </div>
  );
}
