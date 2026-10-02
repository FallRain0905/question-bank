import { describe, expect, it } from 'vitest';
import { getHealthResponse, getReadinessResponse } from './health.responses';

describe('health responses', () => {
  it('reports a live API process', () => {
    const result = getHealthResponse();

    expect(result).toMatchObject({
      status: 'ok',
      service: 'learning-api',
    });
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('reports readiness for the process-only foundation', () => {
    expect(getReadinessResponse('ok')).toMatchObject({
      status: 'ready',
      service: 'learning-api',
      checks: { process: 'ok', database: 'ok' },
    });
  });

  it('reports degraded readiness when database is not configured', () => {
    expect(getReadinessResponse('not_configured')).toMatchObject({
      status: 'degraded',
      checks: { database: 'not_configured' },
    });
  });
});
