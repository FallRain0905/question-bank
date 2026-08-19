import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase(token?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const supabase = getSupabase(token);

  const { data: paper, error } = await supabase
    .from('daily_papers')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !paper) {
    return NextResponse.json({ error: '论文不存在' }, { status: 404 });
  }

  // If user is logged in, check favorite status
  let is_favorited = false;
  if (token) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: fav } = await supabase
        .from('paper_favorites')
        .select('paper_id')
        .eq('user_id', user.id)
        .eq('paper_id', id)
        .maybeSingle();
      is_favorited = !!fav;
    }
  }

  return NextResponse.json({ paper: { ...paper, is_favorited } });
}
