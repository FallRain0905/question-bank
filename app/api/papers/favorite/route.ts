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

  const { paper_id, action } = await req.json();
  if (!paper_id) return NextResponse.json({ error: '缺少 paper_id' }, { status: 400 });

  if (action === 'unfavorite') {
    const { error } = await supabase
      .from('paper_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('paper_id', paper_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ favorited: false });
  }

  const { error } = await supabase
    .from('paper_favorites')
    .insert({ user_id: user.id, paper_id });
  if (error) {
    if (error.code === '23505') return NextResponse.json({ favorited: true }); // already favorited
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ favorited: true });
}
