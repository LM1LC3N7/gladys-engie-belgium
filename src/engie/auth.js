// -----------------------------------------------------------------------------
// The ENGIE Belgium sign-in: the Auth0 pages of account.engie.be driven over
// HTTP as the ENGIE Smart app does (OAuth 2 authorization code with PKCE),
// with the second factor ENGIE asks for (a code by SMS or e-mail), then the
// token endpoint (code exchange, refresh with rotation).
//
// Ported from aioengiebelgium (MIT, by Daan Vervacke, `_auth.py`,
// `_oauth.py`, `_tokens.py`, `const.py`): the authorize parameters, the
// login pages and their hidden inputs, the markers of a refused password or
// code, the e-mail second-factor switch, the resume and callback checks, the
// token grants and their error taxonomy.
//
// Parsing is linear (indexOf, short bounded slices) on bodies already
// bounded by src/http.js. No error message carries a remote text.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import {
  AUTH_BASE_URL,
  CLIENT_ID,
  OAUTH_AUDIENCE,
  OAUTH_SCOPES,
  REDIRECT_URI,
  USER_AGENT_BROWSER,
  USER_AGENT_NATIVE,
} from '../constants.js';
import { CookieJar, EngieError, parseJson, send } from '../http.js';

const BROWSER_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'User-Agent': USER_AGENT_BROWSER,
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
};
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

const PRIMARY_FORM = 'data-form-primary="true"';
const PICK_AUTHENTICATOR_FORM = 'ulp-action-form-pick-authenticator';
/** The Auth0 marker of a field refused (wrong password, wrong code). */
const FIELD_ERROR = 'class="ulp-input-error-message"';
/** A state value as Auth0 writes it. */
const STATE_RE = /^[A-Za-z0-9_-]{1,2048}$/;
/** An HTML tag is never longer than this here: a longer one is not parsed. */
const MAX_TAG = 4096;

const base64url = (buffer) => buffer.toString('base64url');

export function pkce() {
  const state = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier, 'ascii').digest());
  return { state, nonce, codeVerifier, codeChallenge };
}

// --- HTML (linear) -------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export function unescapeHtml(value) {
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6}|#39);/gi, (all, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = parseInt(lower.slice(2), 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    if (lower.startsWith('#') && lower !== '#39') {
      const code = parseInt(lower.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[lower] ?? all;
  });
}

/** The value of attribute `name` in one tag ('"' or "'" quoted), or undefined. */
function attribute(tag, name) {
  const lower = tag.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(`${name}=`, from);
    if (at < 0) return undefined;
    from = at + name.length + 1;
    // A whole attribute name: preceded by a space.
    if (!/\s/.test(lower[at - 1] ?? '')) continue;
    const quote = tag[from];
    if (quote !== '"' && quote !== "'") return undefined;
    const end = tag.indexOf(quote, from + 1);
    return end < 0 ? undefined : tag.slice(from + 1, end);
  }
}

/** The inner HTML of the first form whose opening tag carries `marker`, or undefined. */
export function formScope(body, marker = PRIMARY_FORM) {
  const at = body.indexOf(marker);
  if (at < 0) return undefined;
  const open = body.lastIndexOf('<form', at);
  const close = body.indexOf('>', at);
  if (open < 0 || close < 0 || at - open > MAX_TAG) return undefined;
  // The marker must sit in the opening tag of the form, not after it.
  if (body.slice(open, at).includes('>')) return undefined;
  const end = body.indexOf('</form>', close);
  return end < 0 ? undefined : body.slice(close + 1, end);
}

/** { name: value } of the hidden inputs of a piece of HTML. */
export function hiddenInputs(scope = '') {
  const result = {};
  const lower = scope.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf('<input', from);
    if (at < 0) break;
    const end = lower.indexOf('>', at);
    if (end < 0) break;
    from = end + 1;
    if (end - at > MAX_TAG) continue;
    const tag = scope.slice(at, end + 1);
    if ((attribute(tag, 'type') ?? '').toLowerCase() !== 'hidden') continue;
    const name = attribute(tag, 'name');
    if (!name) continue;
    result[name] = unescapeHtml(attribute(tag, 'value') ?? '');
  }
  return result;
}

const stateIn = (url) => {
  try {
    const state = new URL(url, AUTH_BASE_URL).searchParams.get('state');
    return state && STATE_RE.test(state) ? state : undefined;
  } catch {
    return undefined;
  }
};

/** `?state=` or `&state=` inside a piece of HTML (an attribute value). */
function stateInText(text) {
  const match = /[?&](?:amp;)?state=([A-Za-z0-9_-]{1,2048})/.exec(text);
  return match ? match[1] : undefined;
}

/**
 * The state of a page: the hidden `state` input of the primary form, else a
 * `state=` in that form; a page without form carries it in a link only.
 */
export function stateFromBody(body) {
  const scope = formScope(body);
  if (scope === undefined) {
    const lower = body.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf('<a', from);
      if (at < 0) return undefined;
      const end = lower.indexOf('>', at);
      if (end < 0) return undefined;
      from = end + 1;
      if (end - at > MAX_TAG) continue;
      const href = attribute(body.slice(at, end + 1), 'href');
      const state = href ? stateIn(unescapeHtml(href)) : undefined;
      if (state) return state;
    }
  }
  const hidden = hiddenInputs(scope).state;
  if (hidden && STATE_RE.test(hidden)) return hidden;
  return stateInText(scope);
}

/** The continuation state of an answer: the Location first, the body second. */
export const stateFromAnswer = (answer) =>
  (answer.location ? stateIn(answer.location) : undefined) ?? stateFromBody(answer.text);

// --- Requests ----------------------------------------------------------------------

function authUrl(path, params) {
  const url = new URL(`${AUTH_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

/** A login page: an error status is a failure (passing, or a refusal on a 401). */
function checkPage(answer) {
  if (answer.status === 401) {
    throw new EngieError('refused', 'ENGIE refused the sign-in', 401);
  }
  if (answer.status >= 400) {
    throw new EngieError('http', `ENGIE login answered ${answer.status}`, answer.status);
  }
  return answer;
}

async function page(jar, method, path, state, { data, timeout, check = true } = {}) {
  const answer = await send(authUrl(path, { state, ui_locales: 'nl' }), {
    method,
    headers: data ? { ...BROWSER_HEADERS, ...FORM } : BROWSER_HEADERS,
    body: data ? new URLSearchParams(data).toString() : undefined,
    jar,
    timeout,
  });
  return check ? checkPage(answer) : answer;
}

const resume = (jar, loginState, timeout) =>
  send(authUrl('/authorize/resume', { state: loginState }), {
    headers: BROWSER_HEADERS,
    jar,
    timeout,
  }).then(checkPage);

const isCallback = (location) =>
  typeof location === 'string' && location.startsWith(`${REDIRECT_URI}?`);

// --- Token endpoint ------------------------------------------------------------------

/** The payload of a JWT (no signature check: only its expiry is read). */
export function jwtExpiry(token) {
  const part = typeof token === 'string' ? token.split('.')[1] : undefined;
  if (!part) return undefined;
  try {
    const exp = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))?.exp;
    return Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** POST the token endpoint: `{ accessToken, refreshToken, expiresAt }`. */
export async function exchangeToken(data, { timeout } = {}) {
  const answer = await send(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT_NATIVE, ...FORM },
    body: new URLSearchParams(data).toString(),
    timeout,
  });
  if (answer.status === 401) {
    throw new EngieError('grant_refused', 'ENGIE refused the session (401)', 401);
  }
  if (answer.status >= 400) {
    const error = [400, 403].includes(answer.status) ? parseJson(answer.text)?.error : undefined;
    if (error === 'invalid_grant') {
      throw new EngieError(
        'grant_refused',
        'ENGIE refused the session (invalid_grant)',
        answer.status,
      );
    }
    throw new EngieError('http', `ENGIE token endpoint answered ${answer.status}`, answer.status);
  }
  const json = parseJson(answer.text);
  const accessToken = json?.access_token;
  const refreshToken = json?.refresh_token;
  if (
    typeof accessToken !== 'string' ||
    !accessToken ||
    typeof refreshToken !== 'string' ||
    !refreshToken
  ) {
    throw new EngieError('bad_response', 'ENGIE token answer without tokens');
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken,
    refreshToken,
    expiresAt:
      jwtExpiry(accessToken) ??
      (Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined),
  };
}

/** A new token pair from a refresh token (the one sent is dead afterwards: rotation). */
export const refreshTokens = (refreshToken, { timeout } = {}) =>
  exchangeToken(
    {
      refresh_token: refreshToken,
      audience: OAUTH_AUDIENCE,
      grant_type: 'refresh_token',
      scope: OAUTH_SCOPES,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    },
    { timeout },
  );

function codeOfCallback(location, expectedState) {
  const url = new URL(location);
  if (url.searchParams.get('state') !== expectedState) {
    throw new EngieError('login_changed', 'ENGIE answered another sign-in (state mismatch)');
  }
  const code = url.searchParams.get('code');
  if (!code) {
    throw new EngieError('login_changed', 'ENGIE callback without authorization code');
  }
  return code;
}

const exchangeCode = (code, codeVerifier, timeout) =>
  exchangeToken(
    {
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
    },
    { timeout },
  ).catch((err) => {
    // A code refused at the exchange: the sign-in must start again.
    throw err.code === 'grant_refused'
      ? new EngieError('code_expired', 'ENGIE refused the authorization code', err.status)
      : err;
  });

// --- The sign-in -------------------------------------------------------------------

/** Switch the second factor to e-mail; the e-mail challenge page. */
async function switchToEmail(jar, challengeState, timeout) {
  const sms = await page(jar, 'GET', '/u/mfa-sms-challenge', challengeState, { timeout });
  const pick = hiddenInputs(formScope(sms.text, PICK_AUTHENTICATOR_FORM));
  await page(jar, 'POST', '/u/mfa-sms-challenge', challengeState, {
    data: { ...pick, action: 'pick-authenticator' },
    timeout,
  });
  const options = await page(jar, 'GET', '/u/mfa-login-options', challengeState, { timeout });
  await page(jar, 'POST', '/u/mfa-login-options', challengeState, {
    data: { ...hiddenInputs(formScope(options.text)), action: 'email::1' },
    timeout,
  });
  return page(jar, 'GET', '/u/mfa-email-challenge', challengeState, { timeout });
}

/**
 * Sign in with the e-mail and the password, up to the second factor: ENGIE
 * sends a code by `channel` (sms | email). Resolves `{ pending }` to give to
 * `submitCode`, or `{ tokens }` when ENGIE asks for no code.
 */
export async function startLogin({ email, password, channel = 'sms', timeout, now = Date.now }) {
  const jar = new CookieJar();
  const { state, nonce, codeVerifier, codeChallenge } = pkce();
  const authorize = checkPage(
    await send(
      authUrl('/authorize', {
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        response_type: 'code',
        ui_locales: 'nl',
        state,
        nonce,
        scope: OAUTH_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        audience: OAUTH_AUDIENCE,
        app_scheme: 'be-engie-smart',
        cancel_redirect: 'be-engie-smart://cancel-registration-redirect',
      }),
      { headers: BROWSER_HEADERS, jar, timeout },
    ),
  );
  const authorizeState = stateFromAnswer(authorize);
  if (!authorizeState) {
    throw new EngieError('login_changed', 'ENGIE login page without state');
  }

  const identifier = await page(jar, 'GET', '/u/login/identifier', authorizeState, { timeout });
  await page(jar, 'POST', '/u/login/identifier', authorizeState, {
    data: { ...hiddenInputs(formScope(identifier.text)), username: email },
    timeout,
  });
  const passwordPage = await page(jar, 'GET', '/u/login/password', authorizeState, { timeout });
  // The password goes to account.engie.be only (src/http.js allows no other host).
  const submitted = await page(jar, 'POST', '/u/login/password', authorizeState, {
    data: { ...hiddenInputs(formScope(passwordPage.text)), username: email, password },
    timeout,
    check: false,
  });
  if (submitted.status >= 500) {
    throw new EngieError('http', `ENGIE login answered ${submitted.status}`, submitted.status);
  }
  if (submitted.text.includes(FIELD_ERROR)) {
    throw new EngieError('refused', 'ENGIE refused the e-mail or the password', submitted.status);
  }
  const loginState = stateFromAnswer(submitted);
  if (!loginState) {
    if (submitted.status === 400 || submitted.status === 401 || submitted.status < 400) {
      throw new EngieError('refused', 'ENGIE refused the e-mail or the password', submitted.status);
    }
    throw new EngieError('http', `ENGIE login answered ${submitted.status}`, submitted.status);
  }

  const resumed = await resume(jar, loginState, timeout);
  if (isCallback(resumed.location)) {
    // No second factor asked for this sign-in.
    const code = codeOfCallback(resumed.location, state);
    return { tokens: await exchangeCode(code, codeVerifier, timeout) };
  }
  const challengeState = stateFromAnswer(resumed);
  if (!challengeState) {
    throw new EngieError('login_changed', 'ENGIE second factor page without state');
  }
  const challenge =
    channel === 'email'
      ? await switchToEmail(jar, challengeState, timeout)
      : await page(jar, 'GET', '/u/mfa-sms-challenge', challengeState, { timeout });
  return {
    pending: {
      jar,
      loginState,
      challengeState,
      formInputs: hiddenInputs(formScope(challenge.text)),
      codeVerifier,
      expectedState: state,
      channel: channel === 'email' ? 'email' : 'sms',
      at: now(),
    },
  };
}

/**
 * The code received: resolves the tokens. A refused code throws
 * `code_refused` and leaves `pending` usable for another try.
 */
export async function submitCode(pending, code, { timeout } = {}) {
  const email = pending.channel === 'email';
  const answer = await page(
    pending.jar,
    'POST',
    email ? '/u/mfa-email-challenge' : '/u/mfa-sms-challenge',
    pending.challengeState,
    {
      data: { ...pending.formInputs, code, ...(email ? { action: 'default' } : {}) },
      timeout,
      check: false,
    },
  );
  const echoed = hiddenInputs(formScope(answer.text)).state;
  if (echoed === pending.challengeState || answer.text.includes(FIELD_ERROR)) {
    throw new EngieError('code_refused', 'ENGIE refused the code', answer.status);
  }
  if (!stateFromAnswer(answer)) {
    if (answer.status >= 400 && answer.status !== 401) {
      throw new EngieError('http', `ENGIE answered ${answer.status}`, answer.status);
    }
    throw new EngieError(
      'code_expired',
      'ENGIE did not accept the code (sign-in expired?)',
      answer.status,
    );
  }
  const resumed = await resume(pending.jar, pending.loginState, timeout);
  if (!isCallback(resumed.location)) {
    throw new EngieError('login_changed', 'ENGIE did not finish the sign-in');
  }
  return exchangeCode(
    codeOfCallback(resumed.location, pending.expectedState),
    pending.codeVerifier,
    timeout,
  );
}
