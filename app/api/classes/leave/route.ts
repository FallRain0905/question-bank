import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

// POST - 退出团队
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServerClient();

    // 从请求头获取用户信息（用于服务端 API）
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    let user = null;
    if (token) {
      // 验证 token 并获取用户信息
      const { data: { user: authUser }, error } = await supabase.auth.getUser(token);
      if (!error && authUser) {
        user = authUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    // 创建一个带认证上下文的客户端用于 RLS 操作
    const { createClient } = await import('@supabase/supabase-js');
    const authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const body = await request.json();
    const { classId } = body;

    if (!classId) {
      return NextResponse.json({ error: '团队ID不能为空' }, { status: 400 });
    }

    // 检查是否是团队创建者
    const { data: classData } = await authSupabase
      .from('classes')
      .select('creator_id')
      .eq('id', classId)
      .single();

    if (classData?.creator_id === user.id) {
      return NextResponse.json({ error: '团队创建者不能退出团队' }, { status: 400 });
    }

    // 退出团队
    const { error } = await authSupabase
      .from('class_members')
      .delete()
      .eq('class_id', classId)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('退出团队失败:', error);
    return NextResponse.json({ error: '退出团队失败' }, { status: 500 });
  }
}
