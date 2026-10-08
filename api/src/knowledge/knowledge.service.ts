import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { kbChunks, kbCollections, kbDocumentLogs, kbDocuments } from '../database/schema';
import { ObjectStorageService } from '../storage/object-storage.service';
import { chunkMarkdown } from './chunking';
import { EmbeddingService } from './embedding.service';
import { LlmService } from './llm.service';
import { normalizeAnswerMarkdown } from './markdown-output';
import { MineruService } from './mineru.service';
import { pdfBufferToMarkdown, plainTextToMarkdown } from './pdf-markdown';

const IN_PROGRESS_STATUSES = ['pending', 'extracting', 'chunking', 'embedding'] as const;
export type DocumentStatus = (typeof IN_PROGRESS_STATUSES)[number] | 'ready' | 'failed';

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'md', 'markdown', 'txt']);
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 400;

export interface UploadedDocumentInput {
  filename: string;
  mimetype?: string;
  buffer: Buffer;
}

interface ExtractionOutcome {
  markdown: string;
  pageCount: number | null;
  converter: string;
}

interface SearchRow {
  id: string;
  documentId: string;
  ordinal: number;
  heading: string | null;
  page: number | null;
  content: string;
  title: string;
  score: number;
}

export interface AskInput {
  question: string;
  topK?: number;
  documentIds?: string[];
  /** Restrict retrieval to one knowledge base. Omit to search every collection. */
  collectionId?: string;
}

export const DEFAULT_COLLECTION_NAME = '默认知识库';

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  /** Serialises indexing work so MinerU and embedding calls are not fired in parallel bursts. */
  private queueTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: DatabaseService,
    private readonly embeddings: EmbeddingService,
    private readonly llm: LlmService,
    private readonly mineru: MineruService,
    private readonly storage: ObjectStorageService,
  ) {}

  private get db() {
    const db = this.database.db;
    if (!db) {
      throw new ServiceUnavailableException(
        '数据库未配置：请设置 DATABASE_URL 并启动 PostgreSQL（npm run api:compose:up），再执行 npm run db:migrate。',
      );
    }
    return db;
  }

  async onModuleInit() {
    await this.reconcileInterrupted();
  }

  /** Re-queue indexing work that a restart interrupted, using the stored source file when available. */
  private async reconcileInterrupted() {
    if (!this.database.db) {
      return;
    }

    try {
      const stale = await this.database.db
        .select({
          id: kbDocuments.id,
          sourceFilename: kbDocuments.sourceFilename,
          sourceStorageKey: kbDocuments.sourceStorageKey,
        })
        .from(kbDocuments)
        .where(inArray(kbDocuments.status, [...IN_PROGRESS_STATUSES]));

      if (stale.length === 0) {
        return;
      }

      let retried = 0;
      let failed = 0;

      for (const document of stale) {
        const key = document.sourceStorageKey;
        const canRetry = Boolean(key) && this.storage.isAvailable && (await this.storage.exists(key as string));

        if (canRetry && key) {
          await this.db
            .update(kbDocuments)
            .set({ status: 'pending', errorMessage: null, updatedAt: new Date() })
            .where(eq(kbDocuments.id, document.id));
          await this.log(document.id, 'warn', '服务重启中断了索引，已使用原始文件重新排队');
          const filename = document.sourceFilename ?? 'document.pdf';
          this.enqueue(() =>
            this.ingestFromStorage(document.id, key, filename).catch((error: unknown) =>
              this.failDocument(document.id, error),
            ),
          );
          retried += 1;
        } else {
          await this.log(
            document.id,
            'error',
            '服务重启中断了索引，且没有可用的原始文件，请删除后重新上传',
          );
          await this.markFailed(
            document.id,
            '服务重启中断了索引流程，且没有可用的原始文件，请删除后重新上传。',
          );
          failed += 1;
        }
      }

      this.logger.log(`启动恢复：${retried} 个索引任务重新排队，${failed} 个标记为失败`);
    } catch (error) {
      this.logger.warn(
        `启动恢复索引任务失败（数据库可能尚未迁移）：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  private enqueue(task: () => Promise<void>) {
    this.queueTail = this.queueTail.then(task).catch((error: unknown) => {
      this.logger.error(
        `知识库后台任务异常：${error instanceof Error ? error.message : '未知错误'}`,
      );
    });
  }

  private extensionOf(filename: string) {
    return filename.split('.').pop()?.toLowerCase() ?? '';
  }

  async createDocument(input: UploadedDocumentInput, collectionId?: string) {
    const extension = this.extensionOf(input.filename);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new BadRequestException('暂只支持 PDF、Markdown 和纯文本文件');
    }
    if (input.buffer.length === 0) {
      throw new BadRequestException('上传的文件为空');
    }

    const collection = await this.resolveCollection(collectionId);
    const title = input.filename.replace(/\.[^.]+$/, '').slice(0, MAX_TITLE_LENGTH) || '未命名资料';
    const [document] = await this.db
      .insert(kbDocuments)
      .values({
        collectionId: collection.id,
        title,
        sourceFilename: input.filename,
        mimeType: input.mimetype ?? null,
        byteSize: input.buffer.length,
        status: 'pending',
      })
      .returning();

    const storageKey = await this.storeSource(document.id, input.filename, input.buffer);
    if (storageKey) {
      await this.db
        .update(kbDocuments)
        .set({ sourceStorageKey: storageKey, updatedAt: new Date() })
        .where(eq(kbDocuments.id, document.id));
    }

    this.enqueue(() =>
      this.ingest(document.id, input.buffer, input.filename, extension).catch((error: unknown) =>
        this.failDocument(document.id, error),
      ),
    );

    await this.log(
      document.id,
      'info',
      `已接收 ${input.filename}（${(input.buffer.length / 1024).toFixed(1)} KB），归入知识库「${collection.name}」，开始索引`,
    );

    return {
      ...this.toSummary(document),
      collectionId: collection.id,
      converter: null,
      hasSource: Boolean(storageKey),
    };
  }

  private async storeSource(documentId: string, filename: string, buffer: Buffer) {
    if (!this.storage.isAvailable) {
      this.logger.warn('文件存储不可用，跳过保存原始文件；重启后无法自动重试该文档');
      return null;
    }
    try {
      const key = this.storage.buildKey(documentId, filename);
      await this.storage.put(key, buffer);
      return key;
    } catch (error) {
      this.logger.warn(
        `保存原始文件失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
      return null;
    }
  }

  /**
   * PDF handling: MinerU is the primary converter when enabled, and the local
   * text-layer extractor is the fallback (or the only option when MinerU is
   * disabled). The converter actually used is stored on the document.
   */
  private async extract(
    documentId: string,
    buffer: Buffer,
    filename: string,
    extension: string,
  ): Promise<ExtractionOutcome> {
    if (extension !== 'pdf') {
      const markdown = plainTextToMarkdown(buffer);
      return { markdown, pageCount: null, converter: 'text' };
    }

    if (this.mineru.isEnabled) {
      await this.log(documentId, 'info', `PDF 解析：MinerU（${this.mineru.mode}）`);
      const startedAt = Date.now();
      try {
        const result = await this.mineru.parsePdf(buffer, filename);
        if (!result.markdown.trim()) {
          throw new Error('MinerU 返回的 Markdown 为空');
        }
        await this.log(
          documentId,
          'info',
          `MinerU 解析完成（${result.converter}，${((Date.now() - startedAt) / 1000).toFixed(1)} 秒，Markdown ${result.markdown.length} 字）`,
        );
        return { markdown: result.markdown, pageCount: null, converter: result.converter };
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        if (process.env.KB_PDF_FALLBACK_LOCAL === 'false') {
          throw error;
        }
        await this.log(documentId, 'warn', `MinerU 解析失败：${message}；回退本地文本层解析`);
      }
    }

    const local = await pdfBufferToMarkdown(buffer);
    await this.log(
      documentId,
      'info',
      `本地文本层解析完成（${local.pageCount ?? '未知'} 页，Markdown ${local.markdown.length} 字）`,
    );
    return { markdown: local.markdown, pageCount: local.pageCount, converter: 'local-pdf-parse' };
  }

  private async ingest(documentId: string, buffer: Buffer, filename: string, extension: string) {
    await this.setStatus(documentId, 'extracting');
    await this.log(documentId, 'info', `抽取内容（${extension}）`);

    const outcome = await this.extract(documentId, buffer, filename, extension);
    if (!outcome.markdown.trim()) {
      throw new Error('未提取到文本内容：可能是扫描版 PDF，请在环境变量中启用 MinerU OCR 或改用带文本层的文件');
    }

    await this.db
      .update(kbDocuments)
      .set({
        markdown: outcome.markdown,
        pageCount: outcome.pageCount,
        converter: outcome.converter,
        status: 'chunking',
        updatedAt: new Date(),
      })
      .where(eq(kbDocuments.id, documentId));

    await this.indexMarkdown(documentId, outcome.markdown);
  }

  private async ingestFromStorage(documentId: string, key: string, filename: string) {
    const buffer = await this.storage.read(key);
    await this.ingest(documentId, buffer, filename, this.extensionOf(filename));
  }

  private async indexMarkdown(documentId: string, markdown: string) {
    const chunks = chunkMarkdown(markdown);
    if (chunks.length === 0) {
      throw new Error('分块结果为空，请检查文档内容');
    }

    await this.setStatus(documentId, 'embedding');
    await this.log(documentId, 'info', `分块完成：${chunks.length} 个分块，开始向量化（${this.embeddings.model}）`);

    const inputs = chunks.map((chunk) =>
      chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content,
    );
    const vectors = await this.embeddings.embedTexts(inputs, async (done, total) => {
      await this.log(documentId, 'info', `向量化 ${done}/${total} 个分块`);
    });
    await this.log(documentId, 'info', '向量化完成，写入向量库');

    const rows = chunks.map((chunk, index) => ({
      documentId,
      ordinal: chunk.ordinal,
      heading: chunk.heading,
      page: chunk.page,
      content: chunk.content,
      embedding: vectors[index],
    }));

    await this.db.transaction(async (tx) => {
      await tx.delete(kbChunks).where(eq(kbChunks.documentId, documentId));
      for (let start = 0; start < rows.length; start += 100) {
        await tx.insert(kbChunks).values(rows.slice(start, start + 100));
      }
      await tx
        .update(kbDocuments)
        .set({
          status: 'ready',
          chunkCount: rows.length,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(kbDocuments.id, documentId));
    });

    await this.log(documentId, 'info', `索引完成：${rows.length} 个分块可供检索`);
  }

  private async failDocument(documentId: string, error: unknown) {
    const message = error instanceof Error ? error.message : '索引失败';
    this.logger.error(`文档 ${documentId} 索引失败：${message}`);
    try {
      await this.log(documentId, 'error', `索引失败：${message}`);
      await this.markFailed(documentId, message);
    } catch (markError) {
      this.logger.error(
        `更新失败状态时出错：${markError instanceof Error ? markError.message : '未知错误'}`,
      );
    }
  }

  /**
   * Indexing progress is stored per document so the UI can show what happened
   * (and what failed) instead of forcing users to read PM2 logs.
   */
  private async log(documentId: string, level: 'info' | 'warn' | 'error', message: string) {
    this.logger.log(`[${documentId}] ${message}`);
    if (!this.database.db) {
      return;
    }
    try {
      await this.database.db.insert(kbDocumentLogs).values({
        documentId,
        level,
        message: message.slice(0, 1000),
      });
    } catch (error) {
      this.logger.warn(
        `写入索引日志失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  async getDocumentLogs(id: string, limit = 200) {
    await this.getDocumentRow(id);
    return this.db
      .select({
        id: kbDocumentLogs.id,
        level: kbDocumentLogs.level,
        message: kbDocumentLogs.message,
        createdAt: kbDocumentLogs.createdAt,
      })
      .from(kbDocumentLogs)
      .where(eq(kbDocumentLogs.documentId, id))
      .orderBy(kbDocumentLogs.createdAt)
      .limit(Math.min(Math.max(limit, 1), 500));
  }

  private async setStatus(documentId: string, status: DocumentStatus) {
    await this.db
      .update(kbDocuments)
      .set({ status, updatedAt: new Date() })
      .where(eq(kbDocuments.id, documentId));
  }

  private async markFailed(documentId: string, message: string) {
    await this.db
      .update(kbDocuments)
      .set({ status: 'failed', errorMessage: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(kbDocuments.id, documentId));
  }

  private normalizeCollectionName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('知识库名称不能为空');
    }
    return trimmed.slice(0, 80);
  }

  private isDuplicateNameError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505'
    );
  }

  /** The default collection keeps uploads working when the client sends no collection id. */
  private async ensureDefaultCollection() {
    const [existing] = await this.db
      .select()
      .from(kbCollections)
      .where(eq(kbCollections.name, DEFAULT_COLLECTION_NAME))
      .limit(1);
    if (existing) {
      return existing;
    }
    const [created] = await this.db
      .insert(kbCollections)
      .values({ name: DEFAULT_COLLECTION_NAME, description: '未指定知识库时的默认归档位置' })
      .onConflictDoNothing()
      .returning();
    if (created) {
      return created;
    }
    const [fallback] = await this.db
      .select()
      .from(kbCollections)
      .where(eq(kbCollections.name, DEFAULT_COLLECTION_NAME))
      .limit(1);
    return fallback;
  }

  private async resolveCollection(collectionId?: string) {
    if (!collectionId) {
      return this.ensureDefaultCollection();
    }
    const [collection] = await this.db
      .select()
      .from(kbCollections)
      .where(eq(kbCollections.id, collectionId))
      .limit(1);
    if (!collection) {
      throw new NotFoundException('知识库不存在');
    }
    return collection;
  }

  async listCollections() {
    const rows = await this.db
      .select({
        id: kbCollections.id,
        name: kbCollections.name,
        description: kbCollections.description,
        createdAt: kbCollections.createdAt,
        documentCount: count(kbDocuments.id),
        readyCount: sql<number>`count(*) filter (where ${kbDocuments.status} = 'ready')`,
        chunkCount: sql<number>`coalesce(sum(${kbDocuments.chunkCount}), 0)`,
      })
      .from(kbCollections)
      .leftJoin(kbDocuments, eq(kbDocuments.collectionId, kbCollections.id))
      .groupBy(kbCollections.id)
      .orderBy(kbCollections.createdAt);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
      documentCount: Number(row.documentCount),
      readyCount: Number(row.readyCount),
      chunkCount: Number(row.chunkCount),
    }));
  }

  async createCollection(input: { name: string; description?: string }) {
    const name = this.normalizeCollectionName(input.name);
    try {
      const [created] = await this.db
        .insert(kbCollections)
        .values({ name, description: input.description?.trim() || null })
        .returning();
      return { ...created, documentCount: 0, readyCount: 0, chunkCount: 0 };
    } catch (error) {
      if (this.isDuplicateNameError(error)) {
        throw new BadRequestException(`已存在名为「${name}」的知识库`);
      }
      throw error;
    }
  }

  async updateCollection(id: string, input: { name?: string; description?: string }) {
    await this.getCollection(id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      patch.name = this.normalizeCollectionName(input.name);
    }
    if (input.description !== undefined) {
      patch.description = input.description?.trim() || null;
    }

    try {
      const [updated] = await this.db
        .update(kbCollections)
        .set(patch)
        .where(eq(kbCollections.id, id))
        .returning();
      return updated;
    } catch (error) {
      if (this.isDuplicateNameError(error)) {
        throw new BadRequestException('已存在同名知识库');
      }
      throw error;
    }
  }

  private async getCollection(id: string) {
    const [collection] = await this.db
      .select()
      .from(kbCollections)
      .where(eq(kbCollections.id, id))
      .limit(1);
    if (!collection) {
      throw new NotFoundException('知识库不存在');
    }
    return collection;
  }

  async deleteCollection(id: string, options: { force?: boolean } = {}) {
    const collection = await this.getCollection(id);
    const documents = await this.db
      .select({ id: kbDocuments.id, sourceStorageKey: kbDocuments.sourceStorageKey })
      .from(kbDocuments)
      .where(eq(kbDocuments.collectionId, id));

    if (documents.length > 0 && !options.force) {
      throw new BadRequestException(
        `知识库「${collection.name}」中还有 ${documents.length} 篇资料；请先删除资料，或选择连同资料一起删除`,
      );
    }

    for (const document of documents) {
      if (!document.sourceStorageKey) continue;
      try {
        await this.storage.remove(document.sourceStorageKey);
      } catch (error) {
        this.logger.warn(
          `删除原始文件失败：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }

    await this.db.delete(kbCollections).where(eq(kbCollections.id, id));
    return { id, deleted: true, documentsDeleted: documents.length };
  }

  async listDocuments(options: { collectionId?: string } = {}) {
    const rows = await this.db
      .select({
        id: kbDocuments.id,
        collectionId: kbDocuments.collectionId,
        title: kbDocuments.title,
        sourceFilename: kbDocuments.sourceFilename,
        status: kbDocuments.status,
        errorMessage: kbDocuments.errorMessage,
        converter: kbDocuments.converter,
        sourceStorageKey: kbDocuments.sourceStorageKey,
        pageCount: kbDocuments.pageCount,
        chunkCount: kbDocuments.chunkCount,
        byteSize: kbDocuments.byteSize,
        createdAt: kbDocuments.createdAt,
        updatedAt: kbDocuments.updatedAt,
      })
      .from(kbDocuments)
      .where(
        options.collectionId ? eq(kbDocuments.collectionId, options.collectionId) : undefined,
      )
      .orderBy(desc(kbDocuments.createdAt));

    return rows.map(({ sourceStorageKey, ...rest }) => ({
      ...rest,
      hasSource: Boolean(sourceStorageKey),
    }));
  }

  private async getDocumentRow(id: string) {
    const [document] = await this.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, id))
      .limit(1);
    if (!document) {
      throw new NotFoundException('文档不存在');
    }
    return document;
  }

  async getDocument(id: string) {
    const document = await this.getDocumentRow(id);
    const { sourceStorageKey, ...rest } = document;
    return { ...rest, hasSource: Boolean(sourceStorageKey) };
  }

  async deleteDocument(id: string) {
    const [deleted] = await this.db
      .delete(kbDocuments)
      .where(eq(kbDocuments.id, id))
      .returning({ id: kbDocuments.id, sourceStorageKey: kbDocuments.sourceStorageKey });
    if (!deleted) {
      throw new NotFoundException('文档不存在');
    }

    if (deleted.sourceStorageKey) {
      try {
        await this.storage.remove(deleted.sourceStorageKey);
      } catch (error) {
        this.logger.warn(
          `删除原始文件失败：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }

    return { id: deleted.id, deleted: true };
  }

  async reindex(id: string, options: { fromSource?: boolean } = {}) {
    const document = await this.getDocumentRow(id);
    const sourceKey = document.sourceStorageKey;
    const fromSource = Boolean(options.fromSource);

    if (fromSource) {
      if (!sourceKey || !(await this.storage.exists(sourceKey))) {
        throw new BadRequestException('没有可用的原始文件，无法重新解析；请重新上传或退回普通重新索引');
      }
      await this.log(id, 'info', '收到重新解析请求：使用保存的原始文件重跑解析');
      try {
        await this.setStatus(id, 'extracting');
        await this.ingestFromStorage(id, sourceKey, document.sourceFilename ?? 'document.pdf');
      } catch (error) {
        const message = error instanceof Error ? error.message : '重新解析失败';
        await this.log(id, 'error', `重新解析失败：${message}`);
        await this.markFailed(id, message);
        throw new BadRequestException(message);
      }
      return this.getDocument(id);
    }

    if (!document.markdown?.trim()) {
      throw new BadRequestException('该文档没有可用的解析文本，请使用原始文件重新解析或重新上传');
    }

    await this.log(id, 'info', '收到重新索引请求：基于已保存的 Markdown 重新分块和向量化');
    try {
      await this.setStatus(id, 'chunking');
      await this.indexMarkdown(id, document.markdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新索引失败';
      await this.log(id, 'error', `重新索引失败：${message}`);
      await this.markFailed(id, message);
      throw new BadRequestException(message);
    }

    return this.getDocument(id);
  }

  private async search(embedding: number[], input: AskInput) {
    const vectorLiteral = `[${embedding.join(',')}]`;
    const topK = Math.min(Math.max(input.topK ?? 6, 1), 20);
    const documentFilter =
      input.documentIds && input.documentIds.length > 0
        ? sql`and c.document_id = any(${input.documentIds}::uuid[])`
        : sql``;
    const collectionFilter = input.collectionId
      ? sql`and c.document_id in (select id from kb_documents where collection_id = ${input.collectionId}::uuid)`
      : sql``;

    let raw: unknown;
    try {
      raw = await this.db.execute(sql`
        select
          c.id,
          c.document_id as "documentId",
          c.ordinal,
          c.heading,
          c.page,
          c.content,
          d.title,
          1 - (c.embedding <=> ${vectorLiteral}::halfvec) as score
        from kb_chunks c
        join kb_documents d on d.id = c.document_id
        where d.status = 'ready'
          ${documentFilter}
          ${collectionFilter}
        order by c.embedding <=> ${vectorLiteral}::halfvec
        limit ${topK}
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/does not exist|不存在/.test(message) && /kb_chunks|kb_documents|extension|vector/.test(message)) {
        throw new ServiceUnavailableException(
          '知识库数据表尚未创建：请在数据库可用的环境执行 npm run db:migrate。',
        );
      }
      throw error;
    }

    const rows = (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])) as SearchRow[];
    return rows;
  }

  async ask(input: AskInput) {
    const question = input.question.trim();
    if (!question) {
      throw new BadRequestException('问题不能为空');
    }

    // Resolve the scope first so a stale id fails loudly instead of returning
    // "no results" as if the knowledge base were empty.
    const collection = input.collectionId ? await this.getCollection(input.collectionId) : null;

    const embedding = await this.embeddings.embedQuery(question);
    const matches = await this.search(embedding, input);

    const citations = matches.map((row, index) => ({
      index: index + 1,
      documentId: row.documentId,
      title: row.title,
      ordinal: row.ordinal,
      heading: row.heading,
      page: row.page,
      score: Number(row.score),
      snippet:
        row.content.length > MAX_SNIPPET_LENGTH
          ? `${row.content.slice(0, MAX_SNIPPET_LENGTH)}…`
          : row.content,
    }));

    const meta = {
      embedding: { provider: this.embeddings.provider, model: this.embeddings.model },
      llm: { configured: this.llm.isConfigured, model: this.llm.model },
      retrieved: citations.length,
      collection: collection ? { id: collection.id, name: collection.name } : null,
    };

    if (citations.length === 0) {
      return {
        answer: null,
        citations: [],
        notice: '知识库中没有检索到相关内容，请先上传资料或换一种问法。',
        ...meta,
      };
    }

    if (!this.llm.isConfigured) {
      return {
        answer: null,
        citations,
        notice:
          '未配置 LLM（LLM_API_KEY / DEEPSEEK_API_KEY / SILICONFLOW_API_KEY），仅返回检索到的资料片段。',
        ...meta,
      };
    }

    const context = citations
      .map((citation) => {
        const location = [
          citation.heading ? `章节：${citation.heading}` : null,
          citation.page ? `第 ${citation.page} 页` : null,
        ]
          .filter(Boolean)
          .join('，');
        return `[${citation.index}] 《${citation.title}》${location ? `（${location}）` : ''}\n${citation.snippet}`;
      })
      .join('\n\n');

    const answer = await this.llm.chat([
      {
        role: 'system',
        content: [
          '你是学习助手的知识库问答模块。',
          '只依据用户提供的资料片段回答，不要编造资料中没有的内容。',
          '引用资料时在句末标注序号，例如 [1][2]。',
          '资料不足以回答时，明确说明缺少什么信息。',
          '使用与提问一致的语言，回答保持简洁、条理清晰。',
          '直接输出 Markdown 正文：列表的每个条目必须单独占一行，不要写成一行；',
          '不要用代码块（```）包裹整个回答。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `资料片段：\n\n${context}\n\n问题：${question}`,
      },
    ]);

    return { answer: normalizeAnswerMarkdown(answer), citations, notice: null, ...meta };
  }

  private toSummary(document: typeof kbDocuments.$inferSelect) {
    return {
      id: document.id,
      title: document.title,
      sourceFilename: document.sourceFilename,
      status: document.status,
      chunkCount: document.chunkCount,
      createdAt: document.createdAt,
    };
  }
}
