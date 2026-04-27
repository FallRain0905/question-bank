import { NextRequest, NextResponse } from 'next/server';
import { getUserMineruConfig } from '@/lib/user-settings';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }

    console.log('Query task progress:', taskId);

    // 获取用户MinerU配置
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { token: mineruToken } = await getUserMineruConfig(token);

    if (!mineruToken || mineruToken.trim() === '') {
      return NextResponse.json({ error: 'MinerU API Token 未配置' }, { status: 500 });
    }

    // 查询任务进度
    const mineruResponse = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${mineruToken}`,
      },
    });

    if (!mineruResponse.ok) {
      const errorText = await mineruResponse.text();
      console.error('MinerU progress query error:', { status: mineruResponse.status, errorText });

      // 如果任务不存在，返回特定错误
      if (mineruResponse.status === 404) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 });
      }

      return NextResponse.json({ error: `查询进度失败 (${mineruResponse.status})` }, { status: 500 });
    }

    const mineruData = await mineruResponse.json();

    if (mineruData.code !== 0) {
      return NextResponse.json({ error: `MinerU API 错误: ${mineruData.msg || '未知错误'}` }, { status: 500 });
    }

    const taskData = mineruData.data;
    console.log('Task progress:', {
      taskId,
      state: taskData.state,
      extracted_pages: taskData.extract_progress?.extracted_pages,
      total_pages: taskData.extract_progress?.total_pages,
    });

    // 转换为统一格式
    const response = {
      success: true,
      data: {
        task_id: taskId,
        state: taskData.state, // done, pending, running, failed, converting
        extracted_pages: taskData.extract_progress?.extracted_pages || 0,
        total_pages: taskData.extract_progress?.total_pages || 0,
        full_zip_url: taskData.full_zip_url || '',
        err_msg: taskData.err_msg || '',
      },
    };

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('Query progress error:', error);
    return NextResponse.json({ error: error.message || '查询进度失败' }, { status: 500 });
  }
}