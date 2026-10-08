import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Dimension of the embedding column. Changing this requires a new migration,
 * because pgvector fixes the dimension at the column level.
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
    embedding: vector('embedding', { dimensions: VECTOR_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('kb_chunks_document_id_idx').on(table.documentId),
    index('kb_chunks_embedding_hnsw').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

export const schema = {
  apiMetadata,
  kbDocuments,
  kbChunks,
};
