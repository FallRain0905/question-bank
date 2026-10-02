import type { DatabaseStatus } from '../database/database.service';

export function getHealthResponse() {
  return {
    status: 'ok' as const,
    service: 'learning-api' as const,
    timestamp: new Date().toISOString(),
  };
}

export function getReadinessResponse(database: DatabaseStatus) {
  return {
    status: database === 'ok' ? ('ready' as const) : ('degraded' as const),
    service: 'learning-api' as const,
    checks: {
      process: 'ok' as const,
      database,
    },
    timestamp: new Date().toISOString(),
  };
}
