import { NextRequest, NextResponse } from 'next/server';
import { getUserEmbeddingConfig } from '@/lib/user-settings';

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const kb_id = req.nextUrl.searchParams.get('kb_id');
  const page = req.nextUrl.searchParams.get('page') || '1';
  const page_size = req.nextUrl.searchParams.get('page_size') || '20';
  if (!kb_id) return NextResponse.json({ error: '缺少 kb_id' }, { status: 400 });

  const embeddingConfig = await getUserEmbeddingConfig(token);
  const serviceUrl = embeddingConfig?.hyperragServiceUrl || process.env.HYPERRAG_SERVICE_URL || 'http://localhost:8001';

  try {
    const res = await fetch(`${serviceUrl}/api/relationships/${kb_id}?page=${page}&page_size=${page_size}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: `服务连接失败: ${err.message}` }, { status: 502 });
  }
}
