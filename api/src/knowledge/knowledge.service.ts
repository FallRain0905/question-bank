import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { kbChunks, kbDocuments } from '../database/schema';
import { chunkMarkdown } from './chunking';
import { EmbeddingService } from './embedding.service';
import { LlmService } from './llm.service';
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
}

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly embeddings: EmbeddingService,
    private readonly llm: LlmService,
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
    if (!this.database.db) {
      return;
    }
    try {
      const stale = await this.database.db
        .update(kbDocuments)
        .set({
          status: 'failed',
          errorMessage: '服务重启中断了索引流程，请重新索引。',
          updatedAt: new Date(),
        })
        .where(inArray(kbDocuments.status, [...IN_PROGRESS_STATUSES]))
        .returning({ id: kbDocuments.id });
      if (stale.length > 0) {
        this.logger.warn(`已将 ${stale.length} 个中断的索引任务标记为失败`);
      }
    } catch (error) {
      this.logger.warn(
        `启动清理索引状态失败（数据库可能尚未迁移）：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  async createDocument(input: UploadedDocumentInput) {
    const extension = input.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new BadRequestException('暂只支持 PDF、Markdown 和纯文本文件');
    }
    if (input.buffer.length === 0) {
      throw new BadRequestException('上传的文件为空');
    }

    const title = input.filename.replace(/\.[^.]+$/, '').slice(0, MAX_TITLE_LENGTH) || '未命名资料';
    const [document] = await this.db
      .insert(kbDocuments)
      .values({
        title,
        sourceFilename: input.filename,
        mimeType: input.mimetype ?? null,
        byteSize: input.buffer.length,
        status: 'pending',
      })
      .returning();

    void this.ingest(document.id, input.buffer, extension).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : '索引失败';
      this.logger.error(`文档 ${document.id} 索引失败：${message}`);
      await this.markFailed(document.id, message);
    });

    return this.toSummary(document);
  }

  private async ingest(documentId: string, buffer: Buffer, extension: string) {
    await this.setStatus(documentId, 'extracting');

    const extracted =
      extension === 'pdf'
        ? await pdfBufferToMarkdown(buffer)
        : { markdown: plainTextToMarkdown(buffer), pageCount: null };

    if (!extracted.markdown.trim()) {
      throw new Error('未提取到文本内容：可能是扫描版 PDF，当前不支持 OCR，请改用带文本层的 PDF');
    }

    await this.db
      .update(kbDocuments)
      .set({
        markdown: extracted.markdown,
        pageCount: extracted.pageCount,
        status: 'chunking',
        updatedAt: new Date(),
      })
      .where(eq(kbDocuments.id, documentId));

    await this.indexMarkdown(documentId, extracted.markdown);
  }

  private async indexMarkdown(documentId: string, markdown: string) {
    const chunks = chunkMarkdown(markdown);
    if (chunks.length === 0) {
      throw new Error('分块结果为空，请检查文档内容');
    }

    await this.setStatus(documentId, 'embedding');
    const vectors = await this.embeddings.embedTexts(
      chunks.map((chunk) => (chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content)),
    );

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

  async listDocuments() {
    const rows = await this.db
      .select({
        id: kbDocuments.id,
        title: kbDocuments.title,
        sourceFilename: kbDocuments.sourceFilename,
        status: kbDocuments.status,
        errorMessage: kbDocuments.errorMessage,
        pageCount: kbDocuments.pageCount,
        chunkCount: kbDocuments.chunkCount,
        byteSize: kbDocuments.byteSize,
        createdAt: kbDocuments.createdAt,
        updatedAt: kbDocuments.updatedAt,
      })
      .from(kbDocuments)
      .orderBy(desc(kbDocuments.createdAt));
    return rows;
  }

  async getDocument(id: string) {
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

  async deleteDocument(id: string) {
    const [deleted] = await this.db
      .delete(kbDocuments)
      .where(eq(kbDocuments.id, id))
      .returning({ id: kbDocuments.id });
    if (!deleted) {
      throw new NotFoundException('文档不存在');
    }
    return { id: deleted.id, deleted: true };
  }

  async reindex(id: string) {
    const document = await this.getDocument(id);
    if (!document.markdown?.trim()) {
      throw new BadRequestException('该文档没有可用的解析文本，请删除后重新上传');
    }

    try {
      await this.setStatus(id, 'chunking');
      await this.indexMarkdown(id, document.markdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新索引失败';
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
          1 - (c.embedding <=> ${vectorLiteral}::vector) as score
        from kb_chunks c
        join kb_documents d on d.id = c.document_id
        where d.status = 'ready'
          ${documentFilter}
        order by c.embedding <=> ${vectorLiteral}::vector
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
        ].join('\n'),
      },
      {
        role: 'user',
        content: `资料片段：\n\n${context}\n\n问题：${question}`,
      },
    ]);

    return { answer, citations, notice: null, ...meta };
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
