import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

// GET - 获取用户加入的团队列表
export async function GET(request: NextRequest) {
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

    // 获取用户加入的团队
    const { data: classes, error } = await authSupabase
      .from('class_members')
      .select(`
        class_id,
        role,
        classes!id (
          id,
          name,
          description,
          invite_code,
          creator_id,
          created_at
        )
      `)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json(classes?.map((c: any) => ({
      ...c.classes,
      userRole: c.role,
    })) || []);
  } catch (error: any) {
    console.error('获取团队列表失败:', error);
    return NextResponse.json({ error: '获取团队列表失败' }, { status: 500 });
  }
}

// POST - 创建新团队
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServerClient();

    // 从请求头获取用户信息（用于服务端 API）
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    let user = null;
    if (token) {
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
    const { name, description } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: '团队名称不能为空' }, { status: 400 });
    }

    // 创建团队
    const { data, error } = await authSupabase
      .from('classes')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        creator_id: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('创建团队失败:', error);
    return NextResponse.json({ error: '创建团队失败' }, { status: 500 });
  }
}
