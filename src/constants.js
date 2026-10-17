// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// feature keys, manifest keys) is forever: never rename one.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  REQUEST_CODE: 'request_code',
  VERIFY_CODE: 'verify_code',
};

/** The second factor channels ENGIE offers (the key of the `channel` field). */
export const CODE_CHANNELS = { sms: 'sms', email: 'email' };

/** The ENGIE time zone: days, prices and request bounds follow it. */
export const TIME_ZONE = 'Europe/Brussels';

// --- ENGIE endpoints (as aioengiebelgium uses them) -------------------------------
export const AUTH_BASE_URL = 'https://account.engie.be';
export const API_BASE_URL = 'https://api.engie.be/engie/ms';
export const URLS = {
  relations: `${API_BASE_URL}/accounts/customer/v1/customer-account-relations`,
  contracts: (ban) =>
    `${API_BASE_URL}/business-agreements/customer/v1/business-agreements/${ban}/energy-contracts`,
  prices: (ban) =>
    `${API_BASE_URL}/billing/customer/v1/business-agreements/${ban}/supplier-energy-prices`,
  usage: (ban) =>
    `${API_BASE_URL}/energy-insights/customer/v2/business-agreements/${ban}/usage-details`,
  balance: (ban) =>
    `${API_BASE_URL}/billing/customer/v1/business-agreements/${ban}/account-balance`,
  plan: (ban) =>
    `${API_BASE_URL}/billing/customer/v2/business-agreements/${ban}/billing-period-bbp-details`,
};

// The public OAuth client of the ENGIE Smart app, as the library uses it.
export const CLIENT_ID = 'R0PQyUdjO5B2tBaRnltgitVnnUmjGyld';
export const REDIRECT_URI = 'be.engie.smart://login-callback/nl';
export const OAUTH_SCOPES = 'openid profile roles offline_access';
export const OAUTH_AUDIENCE = 'customer';

/** The version of the integration (package.json, bumped by the Release workflow). */
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();
// The login pages are the app's web view; the API calls are the app's. Both
// say who is calling, as the library does with its own name.
export const USER_AGENT_BROWSER = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36 gladys-engie-belgium/${VERSION}`;
export const USER_AGENT_NATIVE = `Dalvik/2.1.0 (Linux; U; Android 16; Pixel 6 Build/BP4A.251205.006) gladys-engie-belgium/${VERSION}`;

export const HTTP_TIMEOUT = 20_000;
/** The buttons answer within 60 s: shorter requests there. */
export const QUICK_TIMEOUT = 10_000;
/** A login page is ~100 KB, a JSON answer far less: more is hostile. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** At most this many cookies kept from one answer. */
export const MAX_COOKIES = 50;

// --- Schedule ------------------------------------------------------------------
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** ENGIE updates its data at most once a day: one read every 6 hours. */
export const POLL_INTERVAL = 6 * HOUR;
/**
 * The access token lives about 2 minutes and the refresh token rotates at
 * each use: a token-only refresh every hour keeps the session alive between
 * two reads (no data read).
 */
export const KEEP_ALIVE_INTERVAL = HOUR;
/** Refreshed when it expires within this delay. */
export const TOKEN_SKEW = 30_000;
/** The days of consumption read at each cycle (the core upserts by date). */
export const USAGE_DAYS = 7;
/** A refused session (a fresh token refused): one new try after 6 h, 12 h, then every 24 h. */
export const SESSION_RETRY = [6 * HOUR, 12 * HOUR, 24 * HOUR];
/**
 * A passing failure (network, timeout, 5xx, a broken answer): new tries after
 * 15, 30, 60, 120, 240 minutes, never later than the regular read.
 */
export const RETRY_BACKOFF = [15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 4 * HOUR].map((d) =>
  Math.min(d, POLL_INTERVAL),
);
/** A day flagged partial by ENGIE is published anyway once older than this (it will not change). */
export const PARTIAL_DAY_AGE = 3;
/** stop() waits at most this long for a read, a refresh or a write in progress. */
export const STOP_WAIT = 5_000;
/** 429: every path waits, between 1 minute and 6 hours whatever Retry-After says. */
export const RATE_LIMIT_DEFAULT = 15 * MINUTE;
export const RATE_LIMIT_MIN = MINUTE;
export const RATE_LIMIT_MAX = 6 * HOUR;
/** A waiting sign-in (code sent, not typed yet) expires after this delay. */
export const PENDING_LIFETIME = 10 * MINUTE;
/** One code sent per minute at most. */
export const CODE_COOLDOWN = MINUTE;
/** The test button signs in (refreshes) at most once per 30 s. */
export const TEST_COOLDOWN = 30_000;
/** publishEnergyConsumption takes at most 2,000 intervals per call. */
export const MAX_INTERVALS_PER_CALL = 2000;
