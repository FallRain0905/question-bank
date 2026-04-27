import { NextRequest, NextResponse } from 'next/server';
import { getUserMineruConfig } from '@/lib/user-settings';

export async function POST(req: NextRequest) {
  try {
    console.log('Create convert task request received');

    const body = await req.json();
    const { fileUrl, fileName } = body;

    if (!fileUrl || !fileName) {
      return NextResponse.json({ error: '缺少必要参数：fileUrl 或 fileName' }, { status: 400 });
    }

    console.log('Processing file:', { fileName, fileUrl });

    // 获取用户MinerU配置
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { token: mineruToken } = await getUserMineruConfig(token);

    console.log('MinerU token configured:', !!mineruToken);

    if (!mineruToken || mineruToken.trim() === '') {
      return NextResponse.json({
        error: 'MinerU API Token 未配置，请在设置中填写。\n请在 https://mineru.net/apiManage 获取您的API Token。'
      }, { status: 500 });
    }

    // 调用MinerU Precision Extract API创建任务
    const mineruResponse = await fetch('https://mineru.net/api/v4/extract/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mineruToken}`,
      },
      body: JSON.stringify({
        url: fileUrl,
        model_version: 'vlm', // 使用vlm模型，效果更好
        enable_formula: true,
        enable_table: true,
        language: 'ch',
        extra_formats: ['docx', 'html'], // 额外生成docx和html格式
      }),
    });

    console.log('MinerU task creation response status:', mineruResponse.status);

    if (!mineruResponse.ok) {
      const errorText = await mineruResponse.text();
      console.error('MinerU task creation error:', { status: mineruResponse.status, errorText });

      // 检查是否是Token错误
      if (mineruResponse.status === 401) {
        return NextResponse.json({ error: 'MinerU API Token 无效或已过期，请检查设置中的配置。' }, { status: 500 });
      }

      return NextResponse.json({ error: `MinerU API 请求失败 (${mineruResponse.status})` }, { status: 500 });
    }

    const mineruData = await mineruResponse.json();
    console.log('MinerU task creation response:', JSON.stringify(mineruData).substring(0, 300));

    if (mineruData.code !== 0) {
      return NextResponse.json({ error: `MinerU API 错误: ${mineruData.msg || '未知错误'}` }, { status: 500 });
    }

    const taskId = mineruData.data?.task_id;
    if (!taskId) {
      return NextResponse.json({ error: 'MinerU API 未返回任务ID' }, { status: 500 });
    }

    console.log('Task created successfully:', taskId);

    return NextResponse.json({
      success: true,
      task_id: taskId,
      message: '转换任务已创建',
    });

  } catch (error: any) {
    console.error('Create convert task error:', error);
    return NextResponse.json({ error: error.message || '创建转换任务失败' }, { status: 500 });
  }
}