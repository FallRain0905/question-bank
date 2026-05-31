import { NextResponse } from 'next/server';

const RESEARCH_SCHEMA_HINT =
  '请先在 Supabase SQL Editor 执行 supabase/migration_research_sessions.sql，创建 research_sessions 和 research_evidence 后再使用 /research。';

export function isResearchSchemaMissing(error: any) {
  const message = String(error?.message || '');
  return (
    error?.code === 'PGRST205' ||
    (message.includes('schema cache') &&
      (message.includes('research_sessions') || message.includes('research_evidence')))
  );
}

export function researchDbErrorResponse(error: any) {
  if (isResearchSchemaMissing(error)) {
    return NextResponse.json(
      {
        error: '研究工作台数据库表尚未创建',
        detail: error?.message || String(error),
        hint: RESEARCH_SCHEMA_HINT,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
}

