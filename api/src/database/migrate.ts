import '../load-env';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Production-friendly migration entry point.
 *
 * `drizzle-kit migrate` is a dev tool: it renders an interactive spinner and,
 * on this project's server, exited with code 1 without printing any error.
 * drizzle-orm's own migrator applies the same journal-based migrations and
 * surfaces failures, so deployments use this instead.
 */
export function resolveMigrationsFolder(env: NodeJS.ProcessEnv = process.env) {
  return env.MIGRATIONS_DIR?.trim() || join(process.cwd(), 'api', 'drizzle');
}

export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL 未配置：请先设置环境变量或通过 .env.api 提供');
  }

  const folder = resolveMigrationsFolder();
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    return folder;
  } finally {
    await pool.end();
  }
}

// `require` is undefined when the file is loaded by the ESM test runner.
if (typeof require !== 'undefined' && require.main === module) {
  runMigrations()
    .then((folder) => {
      console.log(`数据库迁移已完成（${folder}）`);
    })
    .catch((error: unknown) => {
      console.error(
        `数据库迁移失败：${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
