import {
  halfvec,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Dimension of the embedding column. Changing this requires a new migration,
 * because pgvector fixes the dimension at the column level.
 *
 * Half precision is deliberate: pgvector cannot build an HNSW index over
 * `vector` columns wider than 2000 dimensions, and the default embedding model
 * (Qwen3-Embedding-4B via SiliconFlow) returns 2560. `halfvec` supports HNSW up
 * to 4000 dimensions and halves storage; the precision loss is irrelevant for
 * cosine similarity retrieval.
 */
export const VECTOR_DIMENSIONS = 2560;

export const apiMetadata = pgTable('api_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value'),
  schemaVersion: integer('schema_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbDocuments = pgTable('kb_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  sourceFilename: text('source_filename'),
  mimeType: text('mime_type'),
  byteSize: integer('byte_size'),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  converter: text('converter'),
  sourceStorageKey: text('source_storage_key'),
  markdown: text('markdown'),
  pageCount: integer('page_count'),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    heading: text('heading'),
    page: integer('page'),
    content: text('content').notNull(),
    embedding: halfvec('embedding', { dimensions: VECTOR_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('kb_chunks_document_id_idx').on(table.documentId),
    index('kb_chunks_embedding_hnsw').using('hnsw', table.embedding.op('halfvec_cosine_ops')),
  ],
);

export const kbDocumentLogs = pgTable(
  'kb_document_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    level: text('level').notNull().default('info'),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('kb_document_logs_document_id_idx').on(table.documentId)],
);

export const schema = {
  apiMetadata,
  kbDocuments,
  kbChunks,
  kbDocumentLogs,
};
