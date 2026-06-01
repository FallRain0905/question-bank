import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markdownToDocx } from '@/lib/docx-export';
import { researchDbErrorResponse } from '@/lib/research-api-errors';
import type { ResearchGraphTemplate } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getAuthedClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  const supabase = clientForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  return { supabase, user };
}

function filenameFromTopic(topic: string, ext: string) {
  const safe = topic.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 60) || 'research-report';
  return `${safe}.${ext}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const format = req.nextUrl.searchParams.get('format') || 'markdown';

  const { data: session, error } = await auth.supabase
    .from('research_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error) return researchDbErrorResponse(error);
  if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 });

  const graph = session.graph_template as ResearchGraphTemplate | null;
  const draft = String(graph?.reportDraft || '').trim();
  if (!draft) {
    return NextResponse.json({ error: 'Please generate a draft before downloading artifacts.' }, { status: 400 });
  }

  if (format === 'docx') {
    const bytes = markdownToDocx(draft);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filenameFromTopic(session.topic, 'docx'))}`,
      },
    });
  }

  return new Response(draft, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filenameFromTopic(session.topic, 'md'))}`,
    },
  });
}

