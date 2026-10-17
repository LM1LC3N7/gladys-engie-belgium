// -----------------------------------------------------------------------------
// The sign-in against the fake ENGIE: PKCE, the second factor by SMS and by
// e-mail, refused password and code, the token grants and their errors, the
// HTML parsing (linear, bounded) and the HTTP rules.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formScope,
  hiddenInputs,
  jwtExpiry,
  refreshTokens,
  startLogin,
  stateFromBody,
  submitCode,
  unescapeHtml,
} from '../src/engie/auth.js';
import { CookieJar, isAllowedUrl, retryAfterMs, send, setFetch } from '../src/http.js';
import { html, installEngie, json, jwt } from './helpers/fakeEngie.js';
import { CODE, EMAIL, PASSWORD } from './fixtures/engie.js';

let engie;
afterEach(() => engie?.restore());

test('a sign-in by SMS: PKCE, cookies, the password to account.engie.be only, then the tokens', async () => {
  engie = installEngie();
  const { pending, tokens } = await startLogin({
    email: EMAIL,
    password: PASSWORD,
    channel: 'sms',
  });
  assert.equal(tokens, undefined);
  assert.equal(pending.channel, 'sms');
  assert.equal(pending.challengeState, 'CHALLENGE-STATE');
  assert.equal(pending.loginState, 'LOGIN-STATE');
  const authorize = engie.named('GET authorize')[0];
  assert.equal(authorize.query.code_challenge_method, 'S256');
  assert.equal(authorize.query.client_id, 'R0PQyUdjO5B2tBaRnltgitVnnUmjGyld');
  assert.equal(authorize.query.audience, 'customer');
  assert.equal(authorize.redirect, 'manual');
  // The hidden inputs go back, entities decoded; the cookie of another site is dropped.
  const post = engie.named('POST password')[0];
  assert.equal(post.form.extra, 'a&b');
  assert.equal(post.form.password, PASSWORD);
  assert.equal(post.headers.Cookie, 'auth0=session-1');
  const withPassword = engie.calls.filter((c) => c.form?.password !== undefined);
  assert.deepEqual(
    withPassword.map((c) => `${c.host}${c.path}`),
    ['account.engie.be/u/login/password'],
  );

  const result = await submitCode(pending, CODE);
  assert.match(result.accessToken, /\./);
  assert.equal(result.refreshToken, 'refresh-1');
  assert.ok(result.expiresAt > Date.now());
  assert.equal(engie.named('POST token')[0].form.grant_type, 'authorization_code');
});

test('a sign-in by e-mail switches the second factor first', async () => {
  engie = installEngie();
  const { pending } = await startLogin({ email: EMAIL, password: PASSWORD, channel: 'email' });
  assert.equal(pending.channel, 'email');
  assert.deepEqual(engie.calls.map((c) => c.name).slice(-5), [
    'GET sms',
    'POST sms',
    'GET options',
    'POST options',
    'GET emailChallenge',
  ]);
  assert.equal(engie.named('POST options')[0].form.action, 'email::1');
  const tokens = await submitCode(pending, CODE);
  assert.equal(tokens.refreshToken, 'refresh-1');
});

test('a refused password, a refused code (tried again), no second factor asked', async () => {
  engie = installEngie();
  await assert.rejects(startLogin({ email: EMAIL, password: 'wrong' }), { code: 'refused' });
  const { pending } = await startLogin({ email: EMAIL, password: PASSWORD });
  await assert.rejects(submitCode(pending, '000000'), { code: 'code_refused' });
  const tokens = await submitCode(pending, CODE);
  assert.equal(tokens.refreshToken, 'refresh-1');
  engie.restore();

  engie = installEngie({ mfa: false });
  const direct = await startLogin({ email: EMAIL, password: PASSWORD });
  assert.equal(direct.pending, undefined);
  assert.equal(direct.tokens.refreshToken, 'refresh-1');
  assert.equal(engie.named('GET sms').length, 0);
});

test('a callback for another sign-in, a 5xx, a page without state', async () => {
  engie = installEngie({
    mfa: false,
    overrides: {
      'GET resume': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'be.engie.smart://login-callback/nl?code=AUTH-CODE&state=other' },
        }),
    },
  });
  await assert.rejects(startLogin({ email: EMAIL, password: PASSWORD }), { code: 'login_changed' });
  engie.restore();
  engie = installEngie({ overrides: { 'POST password': () => html('oops', 503) } });
  await assert.rejects(startLogin({ email: EMAIL, password: PASSWORD }), { code: 'http' });
  engie.restore();
  engie = installEngie({ overrides: { 'GET authorize': () => html('<html>no state</html>') } });
  await assert.rejects(startLogin({ email: EMAIL, password: PASSWORD }), { code: 'login_changed' });
});

test('the refresh grant rotates; invalid_grant and 401 are a dead session, other errors pass', async () => {
  engie = installEngie();
  engie.seed('kept');
  const tokens = await refreshTokens('kept');
  assert.equal(tokens.refreshToken, 'refresh-1');
  const call = engie.named('POST token')[0].form;
  assert.deepEqual(
    [call.grant_type, call.scope, call.audience, call.redirect_uri],
    [
      'refresh_token',
      'openid profile roles offline_access',
      'customer',
      'be.engie.smart://login-callback/nl',
    ],
  );
  await assert.rejects(refreshTokens('kept'), { code: 'grant_refused' });
  engie.restore();
  for (const [answer, code] of [
    [json({}, 401), 'grant_refused'],
    [json({ error: 'server_error' }, 403), 'http'],
    [json({}, 500), 'http'],
    [json({ access_token: 'a' }), 'bad_response'],
  ]) {
    engie = installEngie({ overrides: { 'POST token': () => answer.clone() } });
    await assert.rejects(refreshTokens('x'), { code }, code);
    engie.restore();
  }
});

test('a 429 anywhere carries its Retry-After; the messages never carry a remote text', async () => {
  engie = installEngie({
    overrides: {
      'POST token': () => json({ error: 'secret-text' }, 429, { 'retry-after': '120' }),
    },
  });
  const err = await refreshTokens('x').catch((e) => e);
  assert.equal(err.code, 'rate_limited');
  assert.equal(err.retryAfter, 120_000);
  assert.doesNotMatch(err.message, /secret-text/);
  assert.equal(
    retryAfterMs('Thu, 01 Jan 2099 00:00:00 GMT', Date.parse('2098-12-31T23:59:00Z')),
    60_000,
  );
  assert.equal(retryAfterMs('soon'), undefined);
});

test('the HTML is parsed linearly: forms, hidden inputs, states, entities', () => {
  const page =
    '<form id="other"><input type="hidden" name="state" value="NOT-THIS"></form>' +
    '<form method="post" data-form-primary="true"><input name="x" type="hidden" value="&quot;q&#39;&#x41;&amp;">' +
    '<input type="hidden" name="state" value="S1"><input type="text" name="state2" value="no"></form>';
  assert.deepEqual(hiddenInputs(formScope(page)), { x: '"q\'A&', state: 'S1' });
  assert.equal(stateFromBody(page), 'S1');
  assert.equal(stateFromBody('<a href="/u/x?a=1&amp;state=ABC">go</a>'), 'ABC');
  assert.equal(stateFromBody('<p>nothing</p>'), undefined);
  assert.equal(unescapeHtml('&#99999999;'), '&#99999999;');
  // A huge hostile page parses in linear time.
  const hostile = `<form data-form-primary="true">${'<input '.repeat(200_000)}</form>`;
  const started = Date.now();
  hiddenInputs(formScope(hostile));
  stateFromBody(`${'<a '.repeat(200_000)}`);
  assert.ok(Date.now() - started < 2000);
});

test('the JWT expiry; the hosts allowed; the cookie jar; a body too large', async () => {
  assert.equal(jwtExpiry(jwt(1_800_000_000_000)), 1_800_000_000_000);
  assert.equal(jwtExpiry('not-a-jwt'), undefined);
  assert.ok(isAllowedUrl('https://account.engie.be/authorize'));
  assert.ok(isAllowedUrl('https://api.engie.be/engie/ms/x'));
  assert.ok(!isAllowedUrl('http://account.engie.be/'));
  assert.ok(!isAllowedUrl('https://account.engie.be.evil.com/'));
  assert.ok(!isAllowedUrl('https://engie.be/'));
  await assert.rejects(send('https://evil.example/'), { code: 'login_changed' });

  const jar = new CookieJar();
  const headers = new Headers([
    ['set-cookie', 'a=1; Path=/'],
    ['set-cookie', 'b=2; Domain=engie.be'],
    ['set-cookie', 'c=3; Domain=evil.com'],
    ['set-cookie', 'a=; Max-Age=0'],
  ]);
  jar.store('https://account.engie.be/x', headers);
  assert.equal(jar.header('https://account.engie.be/y'), 'b=2');
  assert.equal(jar.header('https://api.engie.be/y'), 'b=2');

  const previous = setFetch(async () => new Response('x'.repeat(2 * 1024 * 1024)));
  try {
    await assert.rejects(send('https://api.engie.be/big'), { code: 'too_large' });
  } finally {
    setFetch(previous);
  }
  const failing = setFetch(async () => {
    throw new TypeError('fetch failed: secret');
  });
  try {
    const err = await send('https://api.engie.be/x').catch((e) => e);
    assert.equal(err.code, 'network');
    assert.doesNotMatch(err.message, /secret/);
  } finally {
    setFetch(failing);
  }
});
