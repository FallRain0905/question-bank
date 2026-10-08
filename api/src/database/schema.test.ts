import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { VECTOR_DIMENSIONS, kbChunks } from './schema';

describe('kb_chunks embedding column', () => {
  // The published column type does not expose `dimensions`; the runtime
  // instance does, which is what the assertion below relies on.
  const embedding = getTableColumns(kbChunks).embedding as unknown as {
    columnType: string;
    dimensions: number;
  };

  it('stores embeddings as halfvec because HNSW rejects vector wider than 2000 dimensions', () => {
    expect(embedding.columnType).toBe('PgHalfVector');
    expect(embedding.dimensions).toBe(VECTOR_DIMENSIONS);
    expect(VECTOR_DIMENSIONS).toBeGreaterThan(2000);
  });

  it('keeps the configured dimension in sync with the embedding default', () => {
    // The API rejects embeddings whose length differs, so the migration must be
    // regenerated whenever the model dimension changes.
    expect(VECTOR_DIMENSIONS).toBe(2560);
  });
});
