import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import type { Class } from '@/types';

interface ExistingMember {
  status: 'pending' | 'approved' | 'rejected';
}

// POST - 通过邀请码申请加入团队
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

    const body = await request.json();
    const { inviteCode, message } = body;

    if (!inviteCode?.trim()) {
      return NextResponse.json({ error: '邀请码不能为空' }, { status: 400 });
    }

    // 查找团队
    const { data: classData, error: classError } = await supabase
      .from('classes')
      .select('*')
      .eq('invite_code', inviteCode.trim().toUpperCase())
      .single();

    if (classError || !classData) {
      return NextResponse.json({ error: '邀请码无效' }, { status: 404 });
    }

    const classInfo = classData as Class;

    // 检查是否已经有待审核或已批准的记录
    const { data: existingMember } = await supabase
      .from('class_members')
      .select('status')
      .eq('class_id', classInfo.id)
      .eq('user_id', user.id)
      .maybeSingle() as { data: ExistingMember | null };

    if (existingMember) {
      if (existingMember.status === 'approved') {
        return NextResponse.json({ error: '你已经是该团队成员' }, { status: 400 });
      } else if (existingMember.status === 'pending') {
        return NextResponse.json({ error: '你已经提交了加入申请，请等待审核' }, { status: 400 });
      }
    }

    // 插入加入申请（状态为 pending）
    const { error: insertError } = await supabase
      .from('class_members')
      // @ts-ignore - Supabase types not inferring correctly
      .insert({
        class_id: classInfo.id,
        user_id: user.id,
        role: 'member',
        status: 'pending',
        message: message?.trim() || null,
      });

    if (insertError) throw insertError;

    return NextResponse.json({
      success: true,
      message: '申请已提交，等待团队管理员审核',
      class: {
        id: classInfo.id,
        name: classInfo.name,
        description: classInfo.description,
      }
    });
  } catch (error: any) {
    console.error('申请加入团队失败:', error);
    return NextResponse.json({ error: '申请失败，请重试' }, { status: 500 });
  }
}
