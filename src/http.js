// -----------------------------------------------------------------------------
// The only place that talks HTTP: one request with a timeout, the cookies of
// the login (a tiny cookie jar), redirects never followed (the caller reads
// them), a bounded body. The tests replace `fetch` with `setFetch()`.
//
// Never put a URL, a body, a header or any text of an ENGIE answer in an
// error message: the e-mail, the password, the codes and the tokens travel
// there, and a remote text is not ours to log.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, MAX_COOKIES } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/**
 * Codes: network | timeout | too_large | http (5xx, others) | bad_response |
 * rate_limited | unauthorized (401 on a data call) | forbidden (403) |
 * not_found (404) | bad_request (400) | refused (e-mail or password) |
 * code_refused | code_expired | no_pending | grant_refused (refresh token
 * dead: a new code is needed) | session_refused (a fresh token refused) |
 * login_changed (the login pages are not what the integration knows).
 */
export class EngieError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'EngieError';
    this.code = code;
    this.status = status;
  }
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/**
 * The hosts the integration talks to: the ENGIE login (Auth0) and the ENGIE
 * API, https only. The password is only ever posted to account.engie.be.
 */
export function isAllowedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === 'https:' && (host === 'account.engie.be' || host === 'api.engie.be');
}

/** Cookies by name, per host, as a browser keeps them for the login pages. */
export class CookieJar {
  constructor() {
    this.cookies = [];
  }

  /** Store the Set-Cookie headers of a response to `url`. */
  store(url, headers) {
    const host = new URL(url).hostname.toLowerCase();
    const lines =
      typeof headers?.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers?.get?.('set-cookie')].filter(Boolean);
    for (const line of lines.slice(0, MAX_COOKIES)) {
      const [pair, ...attributes] = String(line).split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      let hostOnly = true;
      let expired = false;
      let foreign = false;
      for (const attribute of attributes) {
        const [key, ...rest] = attribute.split('=');
        const k = key.trim().toLowerCase();
        const v = rest.join('=').trim();
        if (k === 'domain' && v) {
          const d = v.replace(/^\./, '').toLowerCase();
          // A cookie for another site is dropped, like a browser does.
          if (host === d || host.endsWith(`.${d}`)) {
            domain = d;
            hostOnly = false;
          } else {
            foreign = true;
          }
        } else if (k === 'max-age' && Number(v) <= 0) {
          expired = true;
        } else if (k === 'expires' && Date.parse(v) < Date.now()) {
          expired = true;
        }
      }
      if (foreign) {
        continue;
      }
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain));
      if (!expired) {
        this.cookies.push({ name, value, domain, hostOnly });
      }
    }
    // A hostile answer never grows the jar without bound.
    this.cookies = this.cookies.slice(-MAX_COOKIES);
  }

  /** The Cookie header for a request to `url` ('' when none). */
  header(url) {
    const host = new URL(url).hostname.toLowerCase();
    return this.cookies
      .filter((c) => host === c.domain || (!c.hostOnly && host.endsWith(`.${c.domain}`)))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }
}

/** Read at most `max` bytes of a body; more is refused (a hostile or broken answer). */
async function readBody(response, max) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > max) {
      throw new EngieError('too_large', 'ENGIE answered too much data');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new EngieError('too_large', 'ENGIE answered too much data');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * One request, redirects NOT followed (the caller decides). Resolves
 * `{ status, headers, text, location }`, `location` absolute. Throws an
 * EngieError on a network failure, a timeout, a 429 or a body too large.
 */
export async function send(
  url,
  { method = 'GET', headers = {}, body, jar, timeout = HTTP_TIMEOUT } = {},
) {
  if (!isAllowedUrl(url)) {
    throw new EngieError('login_changed', 'ENGIE pointed to an unexpected address');
  }
  const all = { 'Accept-Language': 'nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.7', ...headers };
  const cookie = jar?.header(url);
  if (cookie) {
    all.Cookie = cookie;
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: all,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const late = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new EngieError(late ? 'timeout' : 'network', late ? 'timeout' : 'network error');
  }
  jar?.store(url, response.headers);
  if (response.status === 429) {
    await response.body?.cancel?.().catch(() => {});
    const error = new EngieError('rate_limited', 'ENGIE asked to slow down (429)', 429);
    error.retryAfter = retryAfterMs(response.headers?.get?.('retry-after'));
    throw error;
  }
  let text;
  try {
    text = await readBody(response, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof EngieError) throw err;
    // The connection broke or timed out while the body came.
    const late = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new EngieError(late ? 'timeout' : 'network', late ? 'timeout' : 'network error');
  }
  const raw = response.headers?.get?.('location');
  let location;
  if (raw) {
    try {
      location = new URL(raw, url).href;
    } catch {
      location = undefined;
    }
  }
  return { status: response.status, headers: response.headers, text, location };
}

/** Parse a JSON text; undefined when it is not JSON. */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The error of a data call (Bearer GET) answering `status`. */
export function dataError(status) {
  if (status === 401) {
    return new EngieError('unauthorized', 'ENGIE refused the access token (401)', 401);
  }
  if (status === 403) {
    return new EngieError('forbidden', 'ENGIE refused access (403)', 403);
  }
  if (status === 404) {
    return new EngieError('not_found', 'ENGIE has no such data (404)', 404);
  }
  if (status === 400) {
    return new EngieError('bad_request', 'ENGIE refused the request (400)', 400);
  }
  return new EngieError('http', `ENGIE answered ${status}`, status);
}
