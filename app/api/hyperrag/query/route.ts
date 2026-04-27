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

  const { kb_id, question, mode } = await req.json();
  if (!question?.trim()) return NextResponse.json({ error: '请输入问题' }, { status: 400 });

  // Get user configs
  const [llmConfig, embeddingConfig] = await Promise.all([
    getUserLLMConfig(token),
    getUserEmbeddingConfig(token),
  ]);

  if (!embeddingConfig?.apiKey) {
    return NextResponse.json({ error: '请先在设置中配置嵌入模型' }, { status: 400 });
  }

  const serviceUrl = embeddingConfig.hyperragServiceUrl;

  try {
    const res = await fetch(`${serviceUrl}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kb_id,
        user_id: user.id,
        question: question.trim(),
        mode: mode || 'hyper',
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

    if (!res.ok) {
      return NextResponse.json({ error: result.detail || '查询失败' }, { status: res.status });
    }

    // Resolve doc IDs to document titles for source tracing
    const textUnits = result.text_units || [];
    if (textUnits.length > 0) {
      const { data: documents } = await supabase
        .from('kb_documents')
        .select('id, title, content_md')
        .eq('kb_id', kb_id);

      if (documents) {
        // Build mapping: content hash -> document
        const docMap = new Map<string, { id: string; title: string }>();
        for (const doc of documents) {
          if (doc.content_md) {
            // Hyper-RAG uses md5 of content as doc key
            const crypto = require('crypto');
            const hash = crypto.createHash('md5').update(doc.content_md.trim()).digest('hex');
            docMap.set(`doc-${hash}`, { id: doc.id, title: doc.title });
          }
        }

        // Enrich text units
        result.text_units = textUnits.map((unit: any) => ({
          ...unit,
          document_title: docMap.get(unit.full_doc_id)?.title || null,
          document_id: docMap.get(unit.full_doc_id)?.id || null,
        }));
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: `服务连接失败: ${err.message}` }, { status: 502 });
  }
}
