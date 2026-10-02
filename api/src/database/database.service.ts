import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from './schema';

export type DatabaseStatus = 'ok' | 'not_configured' | 'error';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool | null;
  readonly db: NodePgDatabase<typeof schema> | null;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.pool = null;
      this.db = null;
      return;
    }

    this.pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });
    this.db = drizzle(this.pool, { schema });
  }

  async check(): Promise<DatabaseStatus> {
    if (!this.pool) {
      return 'not_configured';
    }

    try {
      await this.pool.query('select 1');
      return 'ok';
    } catch (error) {
      this.logger.warn(
        `Database readiness check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return 'error';
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
