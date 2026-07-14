import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserEmbeddingConfig, getUserLLMConfig } from '@/lib/user-settings';
import { sanitizeForPostgres, sanitizeTextForPostgres } from '@/lib/synapse-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FLASH_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function adminClient(token: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return clientForToken(token);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function getAuthedClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  const supabase = clientForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  return { token, supabase, user };
}

async function getOrCreateKnowledgeBase(
  supabase: ReturnType<typeof clientForToken>,
  userId: string,
  rawName: string,
) {
  const name = sanitizeTextForPostgres(rawName || 'Synapse Agent Files', 120);
  const { data: existing, error: existingError } = await supabase
    .from('knowledge_bases')
    .select('id,name')
    .eq('user_id', userId)
    .eq('name', name)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing;

  const { data, error } = await supabase
    .from('knowledge_bases')
    .insert({
      user_id: userId,
      name,
      description: 'Documents imported from Synapse Agent workspace.',
    })
    .select('id,name')
    .single();
  if (error) throw error;
  return data;
}

async function syncDocument(
  token: string,
  supabase: ReturnType<typeof clientForToken>,
  userId: string,
  kbId: string,
  doc: { id: string; title: string; content_md: string },
  logs: string[],
) {
  const [llmConfig, embeddingConfig] = await Promise.all([
    getUserLLMConfig(token),
    getUserEmbeddingConfig(token),
  ]);

  if (!embeddingConfig?.apiKey) {
    return { ok: false, error: '缺少嵌入模型 API Key，请在个人设置或后台系统配置中填写。' };
  }

  logs.push(`使用嵌入模型：${embeddingConfig.model}`);
  await supabase.from('kb_documents').update({ index_status: 'indexing' }).eq('id', doc.id);

  try {
    const res = await fetch(`${embeddingConfig.hyperragServiceUrl}/api/sync-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kb_id: kbId,
        user_id: userId,
        documents: [{
          doc_id: doc.id,
          title: doc.title,
          content_md: doc.content_md,
        }],
        config: {
          llm: {
            api_key: llmConfig?.apiKey || '',
            model_name: llmConfig?.defaultModel || FLASH_MODEL,
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

    const text = await res.text();
    let result: any = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { raw: text };
    }

    if (!res.ok) {
      await supabase.from('kb_documents').update({ index_status: 'index_error' }).eq('id', doc.id);
      return { ok: false, error: result.detail || result.error || text || 'HyperRAG 同步失败' };
    }

    await supabase
      .from('kb_documents')
      .update({ index_status: 'indexed', indexed_at: new Date().toISOString() })
      .eq('id', doc.id);
    return { ok: true, result };
  } catch (error: any) {
    await supabase.from('kb_documents').update({ index_status: 'index_error' }).eq('id', doc.id);
    return { ok: false, error: `HyperRAG 服务连接失败：${error.message}` };
  }
}

export async function POST(req: NextRequest, { params }: any) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const kbName = sanitizeTextForPostgres(String(body.kbName || body.kb_name || 'Synapse Agent Files'), 120);
  const indexNow = body.indexNow !== false;
  const logs: string[] = [];

  try {
    const { data: file, error: fileError } = await auth.supabase
      .from('agent_files')
      .select('*')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .single();
    if (fileError) throw fileError;
    if (!file?.content_text?.trim()) {
      return NextResponse.json({ error: '该文件没有可写入知识库的 Markdown/Text 内容。' }, { status: 400 });
    }

    logs.push(`读取文件：${file.file_name}`);
    const kb = await getOrCreateKnowledgeBase(auth.supabase, auth.user.id, kbName);
    logs.push(`知识库已准备：${kb.name}`);

    const title = sanitizeTextForPostgres(String(file.file_name || 'Synapse Document').replace(/\.[^/.]+$/, ''), 240);
    const { data: doc, error: docError } = await auth.supabase
      .from('kb_documents')
      .insert({
        kb_id: kb.id,
        user_id: auth.user.id,
        title,
        content_md: sanitizeTextForPostgres(file.content_text),
        file_url: file.file_url,
        file_name: file.file_name,
        file_type: file.file_type === 'pdf' ? 'md' : file.file_type,
        file_size: file.file_size || 0,
        status: 'ready',
      })
      .select('id,title,content_md')
      .single();
    if (docError) throw docError;
    logs.push(`Markdown 已写入知识库文档：${doc.title}`);

    let sync: any = { ok: true, skipped: true };
    if (indexNow) {
      logs.push('开始 HyperRAG 嵌入同步。');
      sync = await syncDocument(auth.token, auth.supabase, auth.user.id, kb.id, doc, logs);
      logs.push(sync.ok ? 'HyperRAG 嵌入同步完成。' : `HyperRAG 嵌入同步失败：${sync.error}`);
    } else {
      logs.push('已按你的选择跳过立即嵌入。');
    }

    const nextMetadata = sanitizeForPostgres({
      ...(file.metadata || {}),
      kbId: kb.id,
      kbName: kb.name,
      kbDocumentId: doc.id,
      embeddingStatus: indexNow ? (sync.ok ? 'indexed' : 'index_error') : 'created',
      embeddingError: sync.ok ? '' : sync.error,
      embeddingUpdatedAt: new Date().toISOString(),
    });

    const { data: updatedFile, error: updateError } = await adminClient(auth.token)
      .from('agent_files')
      .update({ metadata: nextMetadata })
      .eq('id', file.id)
      .eq('user_id', auth.user.id)
      .select()
      .single();

    await auth.supabase.from('agent_tool_traces').insert({
      user_id: auth.user.id,
      conversation_id: file.conversation_id,
      tool_name: 'documentEmbedding',
      status: sync.ok ? 'completed' : 'failed',
      input: sanitizeForPostgres({ fileId: file.id, kbName, indexNow }),
      output: sanitizeForPostgres({ kb, document: doc, sync }),
      summary: sanitizeTextForPostgres(logs.join('\n')),
    });

    await auth.supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', file.conversation_id)
      .eq('user_id', auth.user.id);

    return NextResponse.json({
      file: updateError ? { ...file, metadata: nextMetadata } : updatedFile,
      knowledgeBase: kb,
      document: doc,
      sync,
      logs,
    });
  } catch (error: any) {
    console.error('Synapse file embed error:', error);
    return NextResponse.json({ error: error.message || 'Knowledge base import failed', logs }, { status: 500 });
  }
}
