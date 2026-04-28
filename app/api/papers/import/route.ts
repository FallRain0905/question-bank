import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const { paper_id, kb_id } = await req.json();
  if (!paper_id || !kb_id) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

  // Get paper content
  const { data: paper, error: paperError } = await supabase
    .from('daily_papers')
    .select('*')
    .eq('id', paper_id)
    .single();

  if (paperError || !paper) {
    return NextResponse.json({ error: '论文不存在' }, { status: 404 });
  }

  // Build markdown content for knowledge base
  const content = [
    `# ${paper.title_zh || paper.title_en}`,
    paper.title_zh ? `*${paper.title_en}*` : '',
    '',
    `**Authors:** ${paper.authors.join(', ')}`,
    `**Published:** ${new Date(paper.published_at).toLocaleDateString('zh-CN')}`,
    `**Source:** ${paper.arxiv_url}`,
    '',
    '## AI Summary',
    ...(paper.summary_zh ? JSON.parse(paper.summary_zh).map((p: string) => `- ${p}`) : []),
    '',
    '## Abstract',
    paper.abstract_en || '',
  ].filter(Boolean).join('\n');

  // Call the existing sync API to index this document
  const syncRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/hyperrag/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      kb_id,
      doc_id: `paper-${paper.arxiv_id}`,
      title: paper.title_zh || paper.title_en,
      content_md: content,
    }),
  });

  if (!syncRes.ok) {
    const err = await syncRes.json();
    return NextResponse.json({ error: err.error || '同步失败' }, { status: syncRes.status });
  }

  return NextResponse.json({ success: true, message: '已导入知识库' });
}
