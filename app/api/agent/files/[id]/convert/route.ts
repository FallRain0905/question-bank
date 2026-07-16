import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { materializeMineruZip } from '@/lib/agent-workspace';
import { recordAgentFileArtifact, recordExtractedDirArtifact } from '@/lib/agent-artifacts';
import { getUserMineruConfig } from '@/lib/user-settings';
import { sanitizeForPostgres, sanitizeTextForPostgres } from '@/lib/synapse-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function adminClient(token: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return clientForToken(token);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
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

function markdownName(name: string) {
  return `${name.replace(/\.[^/.]+$/, '') || 'converted'}-mineru.md`;
}

function isProcessingState(state: string) {
  return ['running', 'processing', 'pending', 'waiting', 'created', 'extracting'].includes(String(state || '').toLowerCase());
}

function isDoneState(state: string) {
  return ['done', 'completed', 'success', 'finished'].includes(String(state || '').toLowerCase());
}

function isFailedState(state: string) {
  return ['failed', 'error', 'cancelled', 'canceled'].includes(String(state || '').toLowerCase());
}

function firstString(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function markdownFromTask(task: any) {
  return firstString(
    task?.markdown,
    task?.content,
    task?.data?.markdown,
    task?.data?.content,
    task?.result?.markdown,
    task?.result?.content
  );
}

function markdownUrlFromTask(task: any) {
  return firstString(
    task?.markdown_url,
    task?.md_url,
    task?.full_md_url,
    task?.data?.markdown_url,
    task?.data?.md_url,
    task?.data?.full_md_url,
    task?.result?.markdown_url,
    task?.result?.md_url,
    task?.result?.full_md_url
  );
}

async function fetchMarkdownFromTask(task: any) {
  const inline = markdownFromTask(task);
  if (inline) return { markdown: inline, markdownUrl: '' };

  const markdownUrl = markdownUrlFromTask(task);
  if (!markdownUrl) return { markdown: '', markdownUrl: '' };
  const res = await fetch(markdownUrl);
  if (!res.ok) return { markdown: '', markdownUrl };
  return { markdown: await res.text(), markdownUrl };
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

async function pollMineruTask(taskId: string, mineruToken: string) {
  const res = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
    headers: { Authorization: `Bearer ${mineruToken}` },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.msg || text || `MinerU polling failed (${res.status})`);
  const task = data?.data || data;
  const state = task?.state || task?.status || 'running';
  const zipUrl = task.full_zip_url || task.zip_url || task.data?.full_zip_url || '';
  return { state, zipUrl, task };
}

async function updateSourceMetadata(auth: Awaited<ReturnType<typeof getAuthedClient>> & { error?: undefined }, file: any, metadata: Record<string, any>) {
  const { data } = await adminClient(auth.token)
    .from('agent_files')
    .update({ metadata: sanitizeForPostgres(metadata) })
    .eq('id', file.id)
    .eq('user_id', auth.user.id)
    .select()
    .single();
  return data || { ...file, metadata };
}

async function finalizeConversion(auth: Awaited<ReturnType<typeof getAuthedClient>> & { error?: undefined }, file: any, taskId: string, task: any, zipUrl: string) {
  let workspaceResult: Awaited<ReturnType<typeof materializeMineruZip>> | null = null;
  let workspaceError = '';
  if (!file.metadata?.workspace?.mineruZip?.extractionStatus || file.metadata?.workspace?.mineruZip?.extractionStatus !== 'completed') {
    try {
      workspaceResult = await materializeMineruZip(auth.user.id, file.id, file.file_name, zipUrl);
    } catch (error: any) {
      workspaceError = error?.message || 'Workspace extraction failed';
    }
  }

  let zipFile = null;
  const existingZipId = file.metadata?.convertedZipFileId;
  if (existingZipId) {
    const { data } = await auth.supabase
      .from('agent_files')
      .select('*')
      .eq('id', existingZipId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    zipFile = data || null;
  }

  if (!zipFile && zipUrl) {
    const { data, error } = await auth.supabase
      .from('agent_files')
      .insert({
        user_id: auth.user.id,
        conversation_id: file.conversation_id,
        file_name: sanitizeTextForPostgres(zipName(file.file_name), 240),
        file_type: 'zip',
        file_size: workspaceResult?.zip.bytes || 0,
        storage_path: null,
        file_url: zipUrl,
        content_text: '',
        metadata: sanitizeForPostgres({
          generatedBy: 'mineru',
          sourceFileId: file.id,
          sourceFileName: file.file_name,
          taskId,
          state: task?.state || task?.status || 'done',
          workspace: {
            zip: workspaceResult?.zip || null,
            extractedDir: workspaceResult?.extractRelativeDir || '',
            extractedFiles: (workspaceResult?.files || []).slice(0, 200).map(item => ({
              relativePath: item.relativePath,
              originalName: item.originalName,
              bytes: item.bytes,
            })),
            extractionStatus: workspaceResult ? 'completed' : 'failed',
            extractionError: workspaceError,
          },
        }),
      })
      .select()
      .single();
    if (error) throw error;
    zipFile = data;
  }

  const taskMarkdown = await fetchMarkdownFromTask(task);
  const markdown = taskMarkdown.markdown || workspaceResult?.markdown || '';
  const markdownUrl = taskMarkdown.markdownUrl;
  let markdownFile = null;
  if (markdown) {
    const existingMarkdownId = file.metadata?.convertedMarkdownFileId;
    if (existingMarkdownId) {
      const { data } = await auth.supabase
        .from('agent_files')
        .select('*')
        .eq('id', existingMarkdownId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      markdownFile = data || null;
    }

    if (!markdownFile) {
      const { data, error } = await auth.supabase
        .from('agent_files')
        .insert({
          user_id: auth.user.id,
          conversation_id: file.conversation_id,
          file_name: sanitizeTextForPostgres(markdownName(file.file_name), 240),
          file_type: 'md',
          file_size: Buffer.byteLength(markdown, 'utf8'),
          storage_path: null,
          file_url: markdownUrl || null,
          content_text: sanitizeTextForPostgres(markdown),
          metadata: sanitizeForPostgres({
            generatedBy: 'mineru_markdown',
            sourceFileId: file.id,
            sourceFileName: file.file_name,
            taskId,
            markdownUrl,
            workspace: workspaceResult?.markdownFile ? {
              markdownFile: workspaceResult.markdownFile,
              extractedDir: workspaceResult.extractRelativeDir,
            } : null,
          }),
        })
        .select()
        .single();
      if (error) throw error;
      markdownFile = data;
    }
  }

  const completedMetadata = sanitizeForPostgres({
    ...(file.metadata || {}),
    conversionStatus: 'completed',
    conversionTaskId: taskId,
    convertedZipFileId: zipFile?.id || file.metadata?.convertedZipFileId || '',
    convertedZipUrl: zipUrl || file.metadata?.convertedZipUrl || '',
    convertedMarkdownFileId: markdownFile?.id || file.metadata?.convertedMarkdownFileId || '',
    convertedMarkdownUrl: markdownUrl || file.metadata?.convertedMarkdownUrl || '',
    workspace: {
      ...(file.metadata?.workspace || {}),
      mineruZip: {
        zip: workspaceResult?.zip || file.metadata?.workspace?.mineruZip?.zip || null,
        extractedDir: workspaceResult?.extractRelativeDir || file.metadata?.workspace?.mineruZip?.extractedDir || '',
        extractedFiles: (workspaceResult?.files || []).slice(0, 200).map(item => ({
          relativePath: item.relativePath,
          originalName: item.originalName,
          bytes: item.bytes,
        })),
        markdownFile: workspaceResult?.markdownFile || file.metadata?.workspace?.mineruZip?.markdownFile || null,
        extractionStatus: workspaceResult ? 'completed' : (workspaceError ? 'failed' : file.metadata?.workspace?.mineruZip?.extractionStatus || ''),
        extractionError: workspaceError,
      },
    },
    conversionCompletedAt: new Date().toISOString(),
    conversionError: '',
  });

  const updates: Record<string, any> = { metadata: completedMetadata };
  if (markdown) updates.content_text = sanitizeTextForPostgres(markdown);
  const { data: updatedSource, error } = await adminClient(auth.token)
    .from('agent_files')
    .update(updates)
    .eq('id', file.id)
    .eq('user_id', auth.user.id)
    .select()
    .single();
  if (error) throw error;

  await auth.supabase.from('agent_tool_traces').insert({
    user_id: auth.user.id,
    conversation_id: file.conversation_id,
    tool_name: 'convertDocument',
    status: 'completed',
    input: sanitizeForPostgres({ fileId: file.id, fileName: file.file_name }),
    output: sanitizeForPostgres({ taskId, zipUrl, zipFile, markdownFile, workspace: completedMetadata.workspace }),
    summary: `MinerU 转换完成：${zipFile?.file_name || file.file_name}`,
  });

  try {
    const sourceArtifact = await recordAgentFileArtifact(auth.supabase, updatedSource || file, {
      sourceTool: 'convertDocument',
      status: 'ready',
      metadata: {
        conversionTaskId: taskId,
        convertedZipFileId: zipFile?.id || '',
        convertedMarkdownFileId: markdownFile?.id || '',
      },
    });
    if (zipFile) {
      await recordAgentFileArtifact(auth.supabase, zipFile, {
        parentArtifactId: sourceArtifact?.id || null,
        sourceTool: 'convertDocument',
      });
    }
    if (markdownFile) {
      await recordAgentFileArtifact(auth.supabase, markdownFile, {
        parentArtifactId: sourceArtifact?.id || null,
        sourceTool: 'convertDocument',
      });
    }
    if (workspaceResult) {
      await recordExtractedDirArtifact(auth.supabase, updatedSource || file, {
        extractRelativeDir: workspaceResult.extractRelativeDir,
        files: workspaceResult.files,
        markdownFile: workspaceResult.markdownFile,
        markdown: workspaceResult.markdown,
      }, {
        parentArtifactId: sourceArtifact?.id || null,
        sourceTool: 'convertDocument',
      });
    }
  } catch (artifactError) {
    console.warn('Synapse artifact write failed after conversion:', artifactError);
  }

  return { updatedSource, zipFile, markdownFile };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const waitForResult = new URL(req.url).searchParams.get('wait') === '1';

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
    const runningMetadata = sanitizeForPostgres({
      ...(file.metadata || {}),
      conversionStatus: 'processing',
      conversionTaskId: taskId,
      conversionStartedAt: new Date().toISOString(),
      conversionError: '',
    });
    const { data: updatedSource } = await adminClient(auth.token)
      .from('agent_files')
      .update({ metadata: runningMetadata })
      .eq('id', file.id)
      .eq('user_id', auth.user.id)
      .select()
      .single();

    try {
      await recordAgentFileArtifact(auth.supabase, updatedSource || { ...file, metadata: runningMetadata }, {
        sourceTool: 'convertDocument',
        status: 'processing',
        metadata: { conversionTaskId: taskId },
      });
    } catch (artifactError) {
      console.warn('Synapse artifact write failed after conversion submit:', artifactError);
    }

    await auth.supabase.from('agent_tool_traces').insert({
      user_id: auth.user.id,
      conversation_id: file.conversation_id,
      tool_name: 'convertDocument',
      status: 'running',
      input: sanitizeForPostgres({ fileId: file.id, fileName: file.file_name }),
      output: sanitizeForPostgres({ taskId }),
      summary: `MinerU 转换任务已提交：${taskId}`,
    });

    if (!waitForResult) {
      return NextResponse.json({
        success: true,
        async: true,
        status: 'processing',
        taskId,
        file: updatedSource || { ...file, metadata: runningMetadata },
      });
    }
    const { zipUrl, task } = await waitForZip(taskId, mineruToken);
    const finalized = await finalizeConversion(auth, updatedSource || file, taskId, task, zipUrl);
    return NextResponse.json({
      success: true,
      status: 'completed',
      taskId,
      zipUrl,
      file: finalized.updatedSource,
      zipFile: finalized.zipFile,
      markdownFile: finalized.markdownFile,
    });
  } catch (error: any) {
    console.error('Synapse convert file error:', error);
    return NextResponse.json({ error: error.message || '转换失败' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const taskIdFromUrl = new URL(req.url).searchParams.get('task_id') || '';

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

    const taskId = taskIdFromUrl || file.metadata?.conversionTaskId || '';
    if (!taskId) return NextResponse.json({ error: '该文件没有正在运行的 MinerU 转换任务。' }, { status: 400 });

    const { state, zipUrl, task } = await pollMineruTask(taskId, mineruToken);
    if (isProcessingState(state)) {
      const updated = await updateSourceMetadata(auth, file, {
        ...(file.metadata || {}),
        conversionStatus: 'processing',
        conversionTaskId: taskId,
        conversionLastCheckedAt: new Date().toISOString(),
        conversionError: '',
      });
      return NextResponse.json({
        success: true,
        async: true,
        status: 'processing',
        taskId,
        state,
        file: updated,
      });
    }

    if (isFailedState(state)) {
      const errorMessage = task?.err_msg || task?.error || 'MinerU conversion failed';
      const updated = await updateSourceMetadata(auth, file, {
        ...(file.metadata || {}),
        conversionStatus: 'failed',
        conversionTaskId: taskId,
        conversionError: errorMessage,
        conversionFailedAt: new Date().toISOString(),
      });
      await auth.supabase.from('agent_tool_traces').insert({
        user_id: auth.user.id,
        conversation_id: file.conversation_id,
        tool_name: 'convertDocument',
        status: 'failed',
        input: sanitizeForPostgres({ fileId: file.id, fileName: file.file_name }),
        output: sanitizeForPostgres({ taskId, state, error: errorMessage }),
        summary: `MinerU 转换失败：${errorMessage}`,
      });
      return NextResponse.json({
        success: false,
        status: 'failed',
        taskId,
        state,
        error: errorMessage,
        file: updated,
      }, { status: 500 });
    }

    if (!isDoneState(state)) {
      const updated = await updateSourceMetadata(auth, file, {
        ...(file.metadata || {}),
        conversionStatus: 'processing',
        conversionTaskId: taskId,
        conversionLastCheckedAt: new Date().toISOString(),
        conversionState: state,
      });
      return NextResponse.json({
        success: true,
        async: true,
        status: 'processing',
        taskId,
        state,
        file: updated,
      });
    }

    if (!zipUrl) throw new Error('MinerU finished but did not return full_zip_url');
    const finalized = await finalizeConversion(auth, file, taskId, task, zipUrl);
    return NextResponse.json({
      success: true,
      status: 'completed',
      taskId,
      state,
      zipUrl,
      file: finalized.updatedSource,
      zipFile: finalized.zipFile,
      markdownFile: finalized.markdownFile,
    });
  } catch (error: any) {
    console.error('Synapse poll convert file error:', error);
    return NextResponse.json({ error: error.message || '转换状态查询失败' }, { status: 500 });
  }
}
