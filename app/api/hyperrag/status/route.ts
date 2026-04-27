import { NextRequest, NextResponse } from 'next/server';
import { getUserEmbeddingConfig } from '@/lib/user-settings';

export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const kb_id = req.nextUrl.searchParams.get('kb_id');
  if (!kb_id) return NextResponse.json({ error: '缺少 kb_id' }, { status: 400 });

  const embeddingConfig = await getUserEmbeddingConfig(token);
  const serviceUrl = embeddingConfig?.hyperragServiceUrl || process.env.HYPERRAG_SERVICE_URL || 'http://localhost:8001';

  try {
    const res = await fetch(`${serviceUrl}/api/status/${kb_id}`, {
      signal: AbortSignal.timeout(5000),
    });
    const result = await res.json();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ indexed: false, error: '服务不可用' }, { status: 502 });
  }
}
