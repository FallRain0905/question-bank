import { describe, expect, it } from 'vitest';
import { isAuthorizedRequest } from './access-token';

describe('isAuthorizedRequest', () => {
  it('allows every request when no token is configured', () => {
    expect(isAuthorizedRequest(undefined, undefined)).toBe(true);
  });

  it('requires a matching bearer token when configured', () => {
    expect(isAuthorizedRequest('secret', 'Bearer secret')).toBe(true);
    expect(isAuthorizedRequest('secret', 'Bearer wrong')).toBe(false);
    expect(isAuthorizedRequest('secret', undefined)).toBe(false);
    expect(isAuthorizedRequest('secret', 'secret')).toBe(false);
    expect(isAuthorizedRequest('secret', 'Bearer  secret')).toBe(true);
  });

  it('handles array headers from the HTTP layer', () => {
    expect(isAuthorizedRequest('secret', ['Bearer secret'])).toBe(true);
  });
});
