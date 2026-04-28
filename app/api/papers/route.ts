import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase(token?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  );
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const supabase = getSupabase(token);

  const date = req.nextUrl.searchParams.get('date');
  const keyword = req.nextUrl.searchParams.get('keyword');
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1');
  const pageSize = parseInt(req.nextUrl.searchParams.get('page_size') || '20');

  let query = supabase
    .from('daily_papers')
    .select('*', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    query = query.gte('published_at', start.toISOString()).lt('published_at', end.toISOString());
  }

  if (keyword) {
    query = query.contains('keywords', [keyword]);
  }

  const { data: papers, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If user is logged in, check favorites
  let favoriteIds: string[] = [];
  if (token) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: favs } = await supabase
        .from('paper_favorites')
        .select('paper_id')
        .eq('user_id', user.id);
      favoriteIds = (favs || []).map((f: any) => f.paper_id);
    }
  }

  const enriched = (papers || []).map((p: any) => ({
    ...p,
    is_favorited: favoriteIds.includes(p.id),
  }));

  return NextResponse.json({ papers: enriched, total: count || 0, page, page_size: pageSize });
}
