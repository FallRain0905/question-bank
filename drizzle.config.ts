import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './api/src/database/schema.ts',
  out: './api/drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://learning:learning_dev@localhost:5432/learning',
  },
  strict: true,
  verbose: true,
});
