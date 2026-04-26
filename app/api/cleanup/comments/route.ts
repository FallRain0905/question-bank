import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 清理超长评论的 API 路由
// 超过250字的评论会被自动删除
export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  // 查找所有评论并筛选超过250字的
  const { data: allComments, error } = await supabase
    .from('comments')
    .select('id, content');

  if (error) {
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }

  const longComments = allComments?.filter(c => c.content && c.content.length > 250) || [];

  if (longComments.length === 0) {
    return NextResponse.json({ message: '没有需要清理的评论' });
  }

  // 删除超长评论
  const commentIds = longComments.map(c => c.id);
  const { error: deleteError } = await supabase
    .from('comments')
    .delete()
    .in('id', commentIds);

  if (deleteError) {
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }

  return NextResponse.json({
    message: `已清理 ${commentIds.length} 条超长评论`,
    deletedCount: commentIds.length
  });
}
