import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserEmbeddingConfig } from '@/lib/user-settings';

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { kb_id, doc_id, doc_ids } = await req.json();

  // Get user configs
  const [llmConfig, embeddingConfig] = await Promise.all([
    getUserLLMConfig(token),
    getUserEmbeddingConfig(token),
  ]);

  if (!embeddingConfig?.apiKey) {
    return NextResponse.json({ error: '请先在设置中配置嵌入模型' }, { status: 400 });
  }

  // Fetch documents
  let docs;
  if (doc_ids && Array.isArray(doc_ids)) {
    const { data, error } = await supabase
      .from('kb_documents')
      .select('id, title, content_md')
      .in('id', doc_ids)
      .eq('kb_id', kb_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    docs = data;
  } else if (doc_id) {
    const { data, error } = await supabase
      .from('kb_documents')
      .select('id, title, content_md')
      .eq('id', doc_id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    docs = [data];
  } else {
    const { data, error } = await supabase
      .from('kb_documents')
      .select('id, title, content_md')
      .eq('kb_id', kb_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    docs = data;
  }

  // Filter out docs without content
  docs = docs.filter((d: any) => d.content_md?.trim());

  if (docs.length === 0) {
    return NextResponse.json({ error: '没有可索引的文档' }, { status: 400 });
  }

  // Update status to indexing
  await supabase
    .from('kb_documents')
    .update({ index_status: 'indexing' })
    .in('id', docs.map((d: any) => d.id));

  // Forward to Python service
  const serviceUrl = embeddingConfig.hyperragServiceUrl;

  try {
    const res = await fetch(`${serviceUrl}/api/sync-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kb_id,
        user_id: user.id,
        documents: docs.map((d: any) => ({
          doc_id: d.id,
          title: d.title,
          content_md: d.content_md,
        })),
        config: {
          llm: {
            api_key: llmConfig?.apiKey || '',
            model_name: llmConfig?.defaultModel || 'deepseek-chat',
            base_url: llmConfig?.endpoint?.replace('/chat/completions', '') || 'https://api.deepseek.com/v1',
          },
          embedding: {
            api_key: embeddingConfig.apiKey,
            model_name: embeddingConfig.model,
            base_url: embeddingConfig.apiUrl,
            dimensions: embeddingConfig.dimensions,
          },
        },
      }),
    });

    const result = await res.json();

    if (res.ok) {
      // Update status to indexed
      await supabase
        .from('kb_documents')
        .update({ index_status: 'indexed', indexed_at: new Date().toISOString() })
        .in('id', docs.map((d: any) => d.id));
      return NextResponse.json(result);
    } else {
      // Update status to error
      await supabase
        .from('kb_documents')
        .update({ index_status: 'index_error' })
        .in('id', docs.map((d: any) => d.id));
      return NextResponse.json({ error: result.detail || '索引失败' }, { status: 500 });
    }
  } catch (err: any) {
    await supabase
      .from('kb_documents')
      .update({ index_status: 'index_error' })
      .in('id', docs.map((d: any) => d.id));
    return NextResponse.json({ error: `服务连接失败: ${err.message}` }, { status: 502 });
  }
}
