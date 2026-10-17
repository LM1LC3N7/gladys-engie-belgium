// -----------------------------------------------------------------------------
// A fake ENGIE (the Auth0 pages of account.engie.be, its token endpoint, the
// API of api.engie.be) behind `setFetch`: it keeps the state of a sign-in,
// checks PKCE, rotates the refresh tokens, records every call and fails
// loudly on an unexpected one. No test touches the network.
//
// The pages are synthetic, shaped after the fixtures and the tests of
// aioengiebelgium (forms marked `data-form-primary="true"`, hidden inputs,
// the `ulp-input-error-message` marker, redirect stubs).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { setFetch } from '../../src/http.js';
import * as F from '../fixtures/engie.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const html = (body, status = 200, cookies = []) =>
  new Response(body, {
    status,
    headers: [['content-type', 'text/html'], ...cookies.map((c) => ['set-cookie', c])],
  });

export const redirect = (location, status = 302, cookies = []) =>
  new Response(`<a href="${location.replace(/&/g, '&amp;')}">Found</a>`, {
    status,
    headers: [['location', location], ...cookies.map((c) => ['set-cookie', c])],
  });

const form = (state, extra = '', marker = 'data-form-primary="true"') =>
  `<html><body><form method="POST" class="_form-login" ${marker}>` +
  `<input type="hidden" name="state" value="${state}">${extra}` +
  '<input type="text" name="code"></form></body></html>';

/** A JWT that only carries an expiry (the fake never checks signatures). */
export function jwt(exp) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp: Math.floor(exp / 1000), sub: 'auth0|x' })}.sig`;
}

/** The name of a call. */
export function routeName(parsed, method) {
  const { hostname, pathname } = parsed;
  if (hostname === 'account.engie.be') {
    const name = {
      '/authorize': 'authorize',
      '/authorize/resume': 'resume',
      '/u/login/identifier': 'identifier',
      '/u/login/password': 'password',
      '/u/mfa-sms-challenge': 'sms',
      '/u/mfa-login-options': 'options',
      '/u/mfa-email-challenge': 'emailChallenge',
      '/oauth/token': 'token',
    }[pathname];
    return name ? `${method} ${name}` : 'unknown';
  }
  if (hostname === 'api.engie.be') {
    if (pathname.endsWith('/customer-account-relations')) return 'relations';
    if (pathname.endsWith('/energy-contracts')) return 'contracts';
    if (pathname.endsWith('/supplier-energy-prices')) return 'prices';
    if (pathname.endsWith('/usage-details')) return 'usage';
    if (pathname.endsWith('/account-balance')) return 'balance';
    if (pathname.endsWith('/billing-period-bbp-details')) return 'plan';
  }
  return 'unknown';
}

/**
 * Install the fake. `overrides` maps a call name to handler(call, engie) ->
 * Response (or undefined to fall back to the default behaviour).
 */
export function installEngie({ clock = { now: Date.now() }, overrides = {}, mfa = true } = {}) {
  const engie = {
    calls: [],
    clock,
    mfa,
    flow: undefined,
    codeAccepted: false,
    refreshTokens: new Set(),
    accessTokens: new Set(),
    issued: 0,
    named: (name) => engie.calls.filter((c) => c.name === name),
    issue() {
      engie.issued += 1;
      const accessToken = jwt(clock.now + 120_000) + engie.issued;
      const refreshToken = `refresh-${engie.issued}`;
      engie.accessTokens = new Set([accessToken]);
      engie.refreshTokens = new Set([refreshToken]);
      return { access_token: accessToken, refresh_token: refreshToken, expires_in: 120 };
    },
    /** Seed a valid refresh token (a session kept in /data). */
    seed(refreshToken) {
      engie.refreshTokens.add(refreshToken);
    },
  };

  const defaults = {
    'GET authorize': (call) => {
      engie.flow = {
        state: call.query.state,
        challenge: call.query.code_challenge,
        redirect: call.query.redirect_uri,
        codeAccepted: false,
      };
      return redirect('/u/login/identifier?state=AUTH-STATE', 302, [
        'auth0=session-1; Path=/; Secure; HttpOnly',
        'tracker=x; Domain=example.com',
      ]);
    },
    'GET identifier': () => html(form('AUTH-STATE')),
    'POST identifier': () => redirect('/u/login/password?state=AUTH-STATE'),
    'GET password': () =>
      html(form('AUTH-STATE', '<input type="hidden" name="extra" value="a&amp;b">')),
    'POST password': (call) =>
      call.form.password === F.PASSWORD && call.form.username === F.EMAIL
        ? redirect('/authorize/resume?state=LOGIN-STATE')
        : html(`${form('AUTH-STATE')}<span class="ulp-input-error-message">Wrong</span>`, 400),
    'GET resume': () => {
      if (!engie.mfa || engie.flow.codeAccepted) {
        return redirect(
          `${engie.flow.redirect}?code=AUTH-CODE&state=${encodeURIComponent(engie.flow.state)}`,
        );
      }
      return redirect('/u/mfa-sms-challenge?state=CHALLENGE-STATE');
    },
    'GET sms': () =>
      html(
        form('CHALLENGE-STATE') +
          form('CHALLENGE-STATE', '', 'class="ulp-action-form-pick-authenticator" data-x="1"'),
      ),
    'POST sms': (call) => {
      if (call.form.action === 'pick-authenticator') {
        return redirect('/u/mfa-login-options?state=CHALLENGE-STATE');
      }
      if (call.form.code === F.CODE) {
        engie.flow.codeAccepted = true;
        return redirect('/authorize/resume?state=LOGIN-STATE');
      }
      return html(
        `${form('CHALLENGE-STATE')}<span class="ulp-input-error-message">Bad code</span>`,
        400,
      );
    },
    'GET options': () => html(form('CHALLENGE-STATE')),
    'POST options': () => redirect('/u/mfa-email-challenge?state=CHALLENGE-STATE'),
    'GET emailChallenge': () => html(form('CHALLENGE-STATE')),
    'POST emailChallenge': (call) => {
      if (call.form.code === F.CODE && call.form.action === 'default') {
        engie.flow.codeAccepted = true;
        return redirect('/authorize/resume?state=LOGIN-STATE');
      }
      return html(
        `${form('CHALLENGE-STATE')}<span class="ulp-input-error-message">Bad code</span>`,
        400,
      );
    },
    'POST token': (call) => {
      const f = call.form;
      if (f.client_id !== 'R0PQyUdjO5B2tBaRnltgitVnnUmjGyld') {
        return json({ error: 'invalid_client' }, 401);
      }
      if (f.grant_type === 'authorization_code') {
        const challenge = createHash('sha256').update(f.code_verifier).digest('base64url');
        if (f.code !== 'AUTH-CODE' || challenge !== engie.flow?.challenge) {
          return json({ error: 'invalid_grant' }, 403);
        }
        return json(engie.issue());
      }
      if (f.grant_type === 'refresh_token' && engie.refreshTokens.has(f.refresh_token)) {
        return json(engie.issue());
      }
      return json(
        { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' },
        403,
      );
    },
    relations: () => json(F.RELATIONS),
    contracts: () => json(F.CONTRACTS),
    prices: () => json(F.PRICES),
    usage: () => json(F.usage(clock.now)),
    balance: () => json(F.BALANCE),
    plan: () => json(F.PLAN),
  };

  const previous = setFetch(async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : undefined;
    const call = {
      url,
      name: routeName(parsed, method),
      method,
      host: parsed.hostname,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: init.headers ?? {},
      redirect: init.redirect,
      body,
      form: body ? Object.fromEntries(new URLSearchParams(body)) : undefined,
    };
    engie.calls.push(call);
    if (parsed.hostname === 'api.engie.be') {
      const token = String(call.headers.Authorization ?? '').replace(/^Bearer /, '');
      if (!engie.accessTokens.has(token) && !overrides[`${call.name}:noauth`]) {
        return json({ message: 'Unauthorized' }, 401);
      }
    }
    const answer = await overrides[call.name]?.(call, engie);
    if (answer) return answer;
    const handler = defaults[call.name];
    if (!handler) {
      throw new Error(
        `Unexpected ENGIE call in a test: ${call.name} ${parsed.host}${parsed.pathname}`,
      );
    }
    return handler(call, engie);
  });
  engie.restore = () => setFetch(previous);
  return engie;
}
