import type { AgentArtifactKind, AgentArtifactStatus } from '@/types';

type SupabaseLike = {
  from: (table: string) => any;
};

export type AgentArtifactInput = {
  userId: string;
  conversationId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  parentArtifactId?: string | null;
  kind: AgentArtifactKind;
  status?: AgentArtifactStatus;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number;
  uri?: string | null;
  storagePath?: string | null;
  workspaceRef?: Record<string, any> | null;
  sourceTool?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  contentPreview?: string;
  metadata?: Record<string, any>;
};

function sanitizeText(value: unknown, maxLength = 120000) {
  let output = '';
  const input = String(value || '');
  for (let index = 0; index < input.length && output.length < maxLength; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    output += input[index];
  }
  return output;
}

function sanitizeJson<T>(value: T, depth = 0): T {
  if (depth > 8) return null as T;
  if (typeof value === 'string') return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeJson(item, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      next[sanitizeText(key, 200)] = sanitizeJson(item, depth + 1);
    }
    return next as T;
  }
  return value;
}

function isMissingArtifactsTable(error: any) {
  const message = String(error?.message || error?.details || error?.hint || '');
  return error?.code === '42P01' || /agent_artifacts|schema cache|could not find/i.test(message);
}

function mimeTypeFromName(name: string, fallback = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain';
  return fallback || 'application/octet-stream';
}

export function artifactKindForAgentFile(file: any): AgentArtifactKind {
  const type = String(file?.file_type || '').toLowerCase();
  const name = String(file?.file_name || '').toLowerCase();
  if (type === 'zip' || name.endsWith('.zip')) return 'archive';
  if (type === 'md' || type === 'markdown' || name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(type)) return 'image';
  return 'file';
}

function firstWorkspaceRef(file: any) {
  const workspace = file?.metadata?.workspace || {};
  return (
    workspace.originalFile ||
    workspace.markdownFile ||
    workspace.zip ||
    workspace.mineruZip?.markdownFile ||
    workspace.mineruZip?.zip ||
    workspace.archive?.markdownFile ||
    null
  );
}

function uriForAgentFile(file: any, workspaceRef: any) {
  if (file?.file_url) return file.file_url;
  if (file?.storage_path) return `storage://files/${file.storage_path}`;
  if (workspaceRef?.relativePath) return `workspace://${workspaceRef.relativePath}`;
  return `agent-file://${file?.id || ''}`;
}

export async function upsertAgentArtifact(supabase: SupabaseLike, input: AgentArtifactInput) {
  const row = sanitizeJson({
    user_id: input.userId,
    conversation_id: input.conversationId || null,
    run_id: input.runId || null,
    step_id: input.stepId || null,
    parent_artifact_id: input.parentArtifactId || null,
    kind: input.kind,
    status: input.status || 'ready',
    name: sanitizeText(input.name, 240) || 'artifact',
    mime_type: input.mimeType || null,
    size_bytes: Math.max(0, Number(input.sizeBytes || 0)),
    uri: input.uri || null,
    storage_path: input.storagePath || null,
    workspace_ref: input.workspaceRef || {},
    source_tool: input.sourceTool || null,
    source_table: input.sourceTable || null,
    source_id: input.sourceId || null,
    content_preview: sanitizeText(input.contentPreview || '', 4000),
    metadata: input.metadata || {},
  });

  try {
    const query = input.sourceTable && input.sourceId
      ? supabase
          .from('agent_artifacts')
          .upsert(row, { onConflict: 'user_id,source_table,source_id,kind' })
      : supabase.from('agent_artifacts').insert(row);
    const { data, error } = await query.select().single();
    if (error) throw error;
    return data;
  } catch (error: any) {
    if (isMissingArtifactsTable(error)) {
      console.warn('agent_artifacts table is not available yet; skipping artifact write.');
      return null;
    }
    throw error;
  }
}

export async function recordAgentFileArtifact(
  supabase: SupabaseLike,
  file: any,
  overrides: Partial<AgentArtifactInput> = {},
) {
  const workspaceRef = overrides.workspaceRef || firstWorkspaceRef(file) || {};
  const kind = overrides.kind || artifactKindForAgentFile(file);
  return upsertAgentArtifact(supabase, {
    userId: overrides.userId || file.user_id,
    conversationId: overrides.conversationId ?? file.conversation_id ?? null,
    runId: overrides.runId || null,
    stepId: overrides.stepId || null,
    parentArtifactId: overrides.parentArtifactId || null,
    kind,
    status: overrides.status || (file.metadata?.conversionStatus === 'processing' ? 'processing' : 'ready'),
    name: overrides.name || file.file_name || 'file',
    mimeType: overrides.mimeType || file.metadata?.mimeType || mimeTypeFromName(file.file_name || '', file.file_type),
    sizeBytes: overrides.sizeBytes ?? Number(file.file_size || workspaceRef?.bytes || 0),
    uri: overrides.uri || uriForAgentFile(file, workspaceRef),
    storagePath: overrides.storagePath ?? file.storage_path ?? null,
    workspaceRef,
    sourceTool: overrides.sourceTool || file.metadata?.generatedBy || file.metadata?.source || 'agent_file',
    sourceTable: overrides.sourceTable || 'agent_files',
    sourceId: overrides.sourceId || file.id,
    contentPreview: overrides.contentPreview ?? String(file.content_text || '').slice(0, 4000),
    metadata: {
      fileType: file.file_type,
      sourceFileId: file.metadata?.sourceFileId || '',
      conversionStatus: file.metadata?.conversionStatus || '',
      ...file.metadata,
      ...(overrides.metadata || {}),
    },
  });
}

export async function recordExtractedDirArtifact(
  supabase: SupabaseLike,
  file: any,
  extraction: any,
  overrides: Partial<AgentArtifactInput> = {},
) {
  if (!extraction?.extractRelativeDir) return null;
  return upsertAgentArtifact(supabase, {
    userId: overrides.userId || file.user_id,
    conversationId: overrides.conversationId ?? file.conversation_id ?? null,
    runId: overrides.runId || null,
    stepId: overrides.stepId || null,
    parentArtifactId: overrides.parentArtifactId || null,
    kind: 'extracted_dir',
    status: overrides.status || 'ready',
    name: overrides.name || `${file.file_name || 'archive'} extracted`,
    mimeType: 'inode/directory',
    sizeBytes: overrides.sizeBytes || 0,
    uri: overrides.uri || `workspace://${extraction.extractRelativeDir}`,
    storagePath: null,
    workspaceRef: {
      relativePath: extraction.extractRelativeDir,
      files: (extraction.files || []).slice(0, 200).map((item: any) => ({
        relativePath: item.relativePath,
        originalName: item.originalName,
        bytes: item.bytes,
      })),
      markdownFile: extraction.markdownFile || null,
    },
    sourceTool: overrides.sourceTool || 'extractArchive',
    sourceTable: overrides.sourceTable || 'agent_files',
    sourceId: overrides.sourceId || file.id,
    contentPreview: overrides.contentPreview || String(extraction.markdown || '').slice(0, 4000),
    metadata: overrides.metadata || {},
  });
}

export async function recordAgentDocumentArtifact(
  supabase: SupabaseLike,
  document: any,
  overrides: Partial<AgentArtifactInput> = {},
) {
  return upsertAgentArtifact(supabase, {
    userId: overrides.userId || document.user_id,
    conversationId: overrides.conversationId ?? document.metadata?.conversationId ?? null,
    runId: overrides.runId || document.metadata?.runId || null,
    stepId: overrides.stepId || null,
    parentArtifactId: overrides.parentArtifactId || null,
    kind: overrides.kind || (document.source === 'synapse_report' ? 'report' : 'document'),
    status: overrides.status || 'ready',
    name: overrides.name || document.title || 'document',
    mimeType: overrides.mimeType || 'text/markdown',
    sizeBytes: overrides.sizeBytes ?? Buffer.byteLength(String(document.content_md || ''), 'utf8'),
    uri: overrides.uri || `agent-document://${document.id}`,
    storagePath: overrides.storagePath || null,
    workspaceRef: overrides.workspaceRef || {},
    sourceTool: overrides.sourceTool || 'createDocument',
    sourceTable: overrides.sourceTable || 'agent_documents',
    sourceId: overrides.sourceId || document.id,
    contentPreview: overrides.contentPreview ?? String(document.content_md || '').slice(0, 4000),
    metadata: {
      source: document.source,
      ...document.metadata,
      ...(overrides.metadata || {}),
    },
  });
}
