import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { zipUrl } = body;

    if (!zipUrl) {
      return NextResponse.json({ error: '缺少ZIP文件URL' }, { status: 400 });
    }

    console.log('Processing ZIP file:', zipUrl);

    // 验证ZIP URL是否可访问
    const response = await fetch(zipUrl, { method: 'HEAD' });
    if (!response.ok) {
      return NextResponse.json({ error: 'ZIP文件无法访问' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      zipUrl: zipUrl,
      message: 'ZIP文件已准备好下载'
    });

  } catch (error: any) {
    console.error('Process convert result error:', error);
    return NextResponse.json({ error: error.message || '处理转换结果失败' }, { status: 500 });
  }
}