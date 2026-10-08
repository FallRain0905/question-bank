import { timingSafeEqual } from 'node:crypto';

/**
 * Temporary bearer-token gate for the learning API.
 *
 * Until Better Auth lands, `API_ACCESS_TOKEN` protects endpoints that cost
 * money or write data (uploads, embeddings, LLM calls). When the variable is
 * unset the API is open, which is intended for local development only.
 */
export function isAuthorizedRequest(
  expectedToken: string | undefined,
  authorizationHeader: string | string[] | undefined,
) {
  if (!expectedToken) {
    return true;
  }

  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided) {
    return false;
  }

  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
