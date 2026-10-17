// -----------------------------------------------------------------------------
// The ENGIE client: the token pair (rotated at each refresh, every new pair
// handed to `onTokens` to be kept in /data), and the read-only GET calls of
// the data, with their 401 rule: one refresh and one retry, never a refresh
// loop. Endpoints, parameters and user agents as aioengiebelgium
// (`_endpoints.py`, `client.py`, MIT).
// -----------------------------------------------------------------------------

import { TOKEN_SKEW, URLS, USER_AGENT_BROWSER, USER_AGENT_NATIVE } from '../constants.js';
import { EngieError, dataError, parseJson, send } from '../http.js';
import { refreshTokens } from './auth.js';

const DIGITS = /^\d{1,20}$/;
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export class EngieClient {
  constructor({ now = Date.now, onTokens = async () => {}, refresh = refreshTokens } = {}) {
    this.now = now;
    this.onTokens = onTokens;
    this.refreshImpl = refresh;
    /** `{ accessToken, refreshToken, expiresAt }` or null. */
    this.session = null;
    this.refreshing = undefined;
    /** Request timeout (shorter for the buttons); undefined: the default one. */
    this.timeout = undefined;
  }

  setSession(session) {
    this.session = session?.refreshToken ? { ...session } : null;
  }

  get hasSession() {
    return Boolean(this.session?.refreshToken);
  }

  /**
   * One refresh at a time: concurrent callers share it. The new pair is
   * kept (onTokens) before anything uses it: the refresh token sent is dead.
   */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  async doRefresh() {
    if (!this.session?.refreshToken) {
      throw new EngieError('grant_refused', 'No ENGIE session: a verification code is needed');
    }
    const tokens = await this.refreshImpl(this.session.refreshToken, { timeout: this.timeout });
    this.session = tokens;
    await this.onTokens(tokens);
    return tokens;
  }

  /** Refresh when the access token is missing or expires within TOKEN_SKEW. */
  async ensureFresh() {
    const { accessToken, expiresAt } = this.session ?? {};
    if (!accessToken || expiresAt === undefined || this.now() >= expiresAt - TOKEN_SKEW) {
      await this.refresh();
    }
  }

  async get(url, params = {}, { userAgent = USER_AGENT_NATIVE } = {}) {
    await this.ensureFresh();
    const target = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value);
    }
    for (let attempt = 0; ; attempt += 1) {
      const answer = await send(target.href, {
        headers: {
          Accept: 'application/json, application/problem+json',
          'User-Agent': userAgent,
          Authorization: `Bearer ${this.session.accessToken}`,
        },
        timeout: this.timeout,
      });
      if (answer.status === 401) {
        if (attempt > 0) {
          // A token just refreshed is refused: no loop, a spaced new try.
          throw new EngieError('session_refused', 'ENGIE refused a fresh access token', 401);
        }
        await this.refresh();
        continue;
      }
      if (answer.status < 200 || answer.status >= 300) {
        throw dataError(answer.status);
      }
      const json = parseJson(answer.text);
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new EngieError('bad_response', 'ENGIE answered something else than JSON');
      }
      return json;
    }
  }

  // --- Read-only endpoints ---------------------------------------------------------

  relations() {
    return this.get(URLS.relations, { withBusinessAgreements: 'SMART_APP' });
  }

  contracts(ban) {
    return this.get(
      URLS.contracts(checkBan(ban)),
      {
        filter: 'ONLY_ACTIVE_ENERGY_CONTRACTS',
        includeActions: 'true',
        includeSapData: 'true',
      },
      { userAgent: USER_AGENT_BROWSER },
    );
  }

  prices(ban) {
    return this.get(
      URLS.prices(checkBan(ban)),
      { maxGranularity: 'MONTHLY' },
      { userAgent: USER_AGENT_BROWSER },
    );
  }

  /** Daily usage, `start` included, `end` excluded (YYYY-MM-DD). */
  usage(ban, start, end) {
    if (!isoDate(start) || !isoDate(end) || start > end) {
      throw new EngieError('bad_request', 'Invalid usage window');
    }
    return this.get(URLS.usage(checkBan(ban)), {
      startDate: start,
      endDate: end,
      granularity: 'DAILY',
      includeSimulation: 'false',
    });
  }

  balance(ban) {
    return this.get(URLS.balance(checkBan(ban)));
  }

  plan(ban) {
    return this.get(URLS.plan(checkBan(ban)));
  }
}

/** A business agreement number goes into a path: digits only. */
function checkBan(ban) {
  const clean = String(ban ?? '').replace(/\s/g, '');
  if (!DIGITS.test(clean)) {
    throw new EngieError('bad_response', 'ENGIE gave an invalid business agreement number');
  }
  return clean;
}
