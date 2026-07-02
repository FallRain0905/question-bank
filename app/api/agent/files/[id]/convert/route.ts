import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserMineruConfig } from '@/lib/user-settings';
import { sanitizeForPostgres, sanitizeTextForPostgres } from '@/lib/synapse-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getAuthedClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  const supabase = clientForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  return { token, supabase, user };
}

function zipName(name: string) {
  return `${name.replace(/\.[^/.]+$/, '') || 'converted'}-mineru.zip`;
}

async function createMineruTask(fileUrl: string, mineruToken: string) {
  const res = await fetch('https://mineru.net/api/v4/extract/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mineruToken}`,
    },
    body: JSON.stringify({
      url: fileUrl,
      model_version: 'vlm',
      enable_formula: true,
      enable_table: true,
      language: 'ch',
      extra_formats: ['docx', 'html'],
    }),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || data?.code !== 0) {
    throw new Error(data?.msg || text || `MinerU task failed (${res.status})`);
  }
  const taskId = data?.data?.task_id || data?.task_id;
  if (!taskId) throw new Error('MinerU did not return task_id');
  return taskId;
}

async function waitForZip(taskId: string, mineruToken: string) {
  for (let index = 0; index < 45; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const res = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
      headers: { Authorization: `Bearer ${mineruToken}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const task = data?.data || data;
    const state = task?.state || task?.status;
    if (state === 'done' || state === 'completed') {
      const zipUrl = task.full_zip_url || task.zip_url || task.data?.full_zip_url || '';
      if (!zipUrl) throw new Error('MinerU finished but did not return full_zip_url');
      return { zipUrl, task };
    }
    if (state === 'failed') {
      throw new Error(task?.err_msg || 'MinerU conversion failed');
    }
  }
  throw new Error('MinerU conversion timed out');
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  try {
    const { token: mineruToken } = await getUserMineruConfig(auth.token);
    if (!mineruToken) {
      return NextResponse.json({ error: 'MinerU API Token 未配置，请先在设置中填写。' }, { status: 500 });
    }

    const { data: file, error } = await auth.supabase
      .from('agent_files')
      .select('*')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (!file.file_url) return NextResponse.json({ error: '该文件没有可访问 URL，无法提交 MinerU 转换。' }, { status: 400 });

    const taskId = await createMineruTask(file.file_url, mineruToken);
    const { zipUrl, task } = await waitForZip(taskId, mineruToken);
    const { data: zipFile, error: insertError } = await auth.supabase
      .from('agent_files')
      .insert({
        user_id: auth.user.id,
        conversation_id: file.conversation_id,
        file_name: sanitizeTextForPostgres(zipName(file.file_name), 240),
        file_type: 'zip',
        file_size: 0,
        storage_path: null,
        file_url: zipUrl,
        content_text: '',
        metadata: sanitizeForPostgres({
          generatedBy: 'mineru',
          sourceFileId: file.id,
          sourceFileName: file.file_name,
          taskId,
          state: task?.state || task?.status || 'done',
        }),
      })
      .select()
      .single();
    if (insertError) throw insertError;

    await auth.supabase.from('agent_tool_traces').insert({
      user_id: auth.user.id,
      conversation_id: file.conversation_id,
      tool_name: 'convertDocument',
      status: 'completed',
      input: sanitizeForPostgres({ fileId: file.id, fileName: file.file_name }),
      output: sanitizeForPostgres({ taskId, zipUrl, zipFile }),
      summary: `MinerU 转换完成：${zipFile.file_name}`,
    });

    return NextResponse.json({ success: true, taskId, zipUrl, file: zipFile });
  } catch (error: any) {
    console.error('Synapse convert file error:', error);
    return NextResponse.json({ error: error.message || '转换失败' }, { status: 500 });
  }
}
