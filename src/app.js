// -----------------------------------------------------------------------------
// The integration: the ENGIE Belgium account (e-mail, password, and the
// verification code ENGIE asks for at each sign-in, through two buttons),
// one read every 6 hours (prices, daily usage, balance, advance invoices),
// a token-only refresh every hour to keep the session, the Gladys devices
// and their states, the daily electricity consumption fed to the energy
// monitoring. Read only: nothing is ever changed on the ENGIE account.
// index.js (through src/handlers.js) only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { CONSUMPTION, normalizeConfig } from './config.js';
import {
  CODE_CHANNELS,
  CODE_COOLDOWN,
  KEEP_ALIVE_INTERVAL,
  MAX_INTERVALS_PER_CALL,
  PARTIAL_DAY_AGE,
  PENDING_LIFETIME,
  POLL_INTERVAL,
  QUICK_TIMEOUT,
  RATE_LIMIT_DEFAULT,
  RATE_LIMIT_MAX,
  RATE_LIMIT_MIN,
  RETRY_BACKOFF,
  SESSION_RETRY,
  STOP_WAIT,
  TEST_COOLDOWN,
  TIME_ZONE,
  USAGE_DAYS,
} from './constants.js';
import {
  FEATURE,
  KIND,
  accountIds,
  accountStates,
  buildAccountDevice,
  buildMeterDevice,
  meterIds,
  meterStates,
} from './devices.js';
import { EngieClient } from './engie/api.js';
import { startLogin, submitCode } from './engie/auth.js';
import {
  agreementsOf,
  balanceOf,
  dailyIntervals,
  divisionsOf,
  lastDays,
  localDate,
  planOf,
  pricesOf,
  usageDays,
  usageWindow,
} from './engie/model.js';
import { EngieError } from './http.js';
import { T, age, join } from './i18n.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors that stop the whole cycle: the session is gone or refused. */
const SESSION_ERRORS = new Set(['grant_refused', 'session_refused']);
/** The buttons answer within this delay (their timeout is 60 s). */
const ANSWER_WITHIN = 50_000;
const HEARTBEAT = 12 * 60 * 60_000;

const codeOf = (err) => (err instanceof EngieError ? err.code : 'unknown');
/** Passing failures: tried again sooner than the regular read, with a growing delay. */
const isPassing = (err) =>
  ['network', 'timeout', 'bad_response'].includes(codeOf(err)) ||
  (codeOf(err) === 'http' && err.status >= 500);
/** The credentials a refusal was for (memory only, never the password itself). */
const fingerprint = ({ email, password }) =>
  createHash('sha256').update(`${email}\u0000${password}`).digest('hex');
/** A reason we can show and log: our own message, never a remote text. */
const reasonOf = (err) =>
  err instanceof EngieError ? err.message : `internal error (${err?.name ?? 'unknown'})`;

export class EngieApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'engie' }),
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
    login = startLogin,
    verify = submitCode,
    refresh,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.login = login;
    this.verify = verify;
    this.client = new EngieClient({
      now,
      onTokens: (tokens, account) => this.keepSession(tokens, account),
      ...(refresh ? { refresh } : {}),
    });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** The sign-in waiting for its code (memory only, 10 minutes at most). */
    this.pending = undefined;
    /** `${kind}:${ean}` -> { kind, ean, ban, prices, lastDay, intervals } */
    this.meters = new Map();
    /** ban -> { ban, balance, plan } */
    this.accounts = new Map();
    /** ban -> Map(ean -> division), kept when a read of the contracts fails. */
    this.divisions = new Map();
    this.issues = [];
    this.read = false;
    /** undefined | 'needs_code' (waits for the buttons) | 'session_refused' (spaced new tries). */
    this.blocked = undefined;
    this.pausedUntil = 0;
    this.createdFeatures = new Set();
    this.published = undefined;
    this.intervals = [];
    this.wakeTimer = undefined;
    this.running = undefined;
    this.firstRun = Promise.resolve();
    this.generation = 0;
    this.started = false;
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    /** Passing failures in a row (the backoff index), reset by a successful read. */
    this.failures = 0;
    /** The fingerprint of the credentials ENGIE refused: no new sign-in with them. */
    this.refusedFor = undefined;
    this.pendingTimer = undefined;
    /** The last write to /data failed. */
    this.storeFailed = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    // Nothing runs while the session is swapped: a read, a keep-alive refresh
    // or a write still going on is waited for first.
    await this.stop({ bounded: false });
    const generation = this.generation;
    const previous = this.config.account;
    this.config = normalizeConfig(raw);
    this.memory = normalizeMemory(await this.store.load().catch(() => null));
    const now = this.now();
    // Dates read back from /data are bounded: a broken file never blocks for long.
    const bound = (value, max) => (value === undefined ? undefined : Math.min(value, max));
    this.memory.rateLimitedUntil = bound(this.memory.rateLimitedUntil, now + RATE_LIMIT_MAX);
    this.memory.sessionRetryAt = bound(
      this.memory.sessionRetryAt,
      now + SESSION_RETRY[SESSION_RETRY.length - 1],
    );
    this.memory.codeAt = bound(this.memory.codeAt, now);
    // A 429 pause survives a restart, a reconnection and a change of account.
    this.pausedUntil = Math.min(
      Math.max(this.pausedUntil, this.memory.rateLimitedUntil ?? 0),
      now + RATE_LIMIT_MAX,
    );
    const { account } = this.config;
    const session = this.memory.session?.account === account ? this.memory.session : null;
    this.client.setSession(session ? { refreshToken: session.refreshToken } : null, account);
    if (this.pending?.account !== account || !this.pendingAlive()) {
      this.dropPending();
    }
    if (previous !== account) {
      this.meters = new Map();
      this.accounts = new Map();
      this.divisions = new Map();
      this.read = false;
      this.published = undefined;
    }
    if (!session) {
      this.blocked = 'needs_code';
    } else if ((this.memory.sessionRetryAt ?? 0) > now) {
      this.blocked = 'session_refused';
    } else {
      this.blocked = undefined;
    }
    if (!this.config.email || !this.config.password) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    // Always armed, whatever happens: never a dead integration.
    this.intervals.push(
      this.timers.setInterval(() => this.guard(generation, () => this.tick()), POLL_INTERVAL),
      this.timers.setInterval(
        () => this.guard(generation, () => this.keepAlive()),
        KEEP_ALIVE_INTERVAL,
      ),
    );
    if (this.blocked === 'needs_code') {
      await this.setStatus(false, this.pending ? T.code.sent(this.pending.channel) : T.needsCode);
      return;
    }
    if (this.blocked === 'session_refused') {
      this.wakeAt(this.memory.sessionRetryAt);
      await this.setStatus(false, T.sessionRefused(age(this.memory.sessionRetryAt - now)));
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    // Not awaited: a save of the form answers at once.
    this.firstRun = this.tick();
  }

  /**
   * Stop the timers at once, then wait (STOP_WAIT at most) for the read, the
   * refresh and the writes to /data in progress: a rotated refresh token is
   * never lost to a shutdown.
   */
  async stop({ bounded = true } = {}) {
    this.generation += 1;
    for (const id of this.intervals) {
      this.timers.clearInterval(id);
    }
    this.intervals = [];
    this.clearWake();
    const work = (async () => {
      // Until nothing runs any more: a job may end by starting a refresh.
      while (this.running || this.client.refreshing) {
        await Promise.all([this.running?.catch(() => {}), this.client.refreshing?.catch(() => {})]);
      }
      await this.store.flush?.()?.catch(() => {});
    })();
    if (!bounded) {
      // A start (new configuration): the session is never swapped under a
      // job, however long it takes (its requests have their own timeouts).
      await work;
      return;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(resolve, STOP_WAIT);
      timer.unref?.();
    });
    try {
      await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Whether the waiting sign-in is still usable (10 minutes). */
  pendingAlive() {
    return Boolean(this.pending) && this.now() - this.pending.at <= PENDING_LIFETIME;
  }

  /** Forget the waiting sign-in: its Auth0 cookies and PKCE verifier. */
  dropPending() {
    this.pending = undefined;
    this.timers.clearTimeout(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  /** Resolves once the read in progress is done (tests). */
  async idle() {
    await this.firstRun?.catch(() => {});
    await this.running?.catch(() => {});
  }

  async guard(generation, job) {
    if (generation !== this.generation) return;
    try {
      await job();
    } catch (err) {
      this.logger.error(`ENGIE: ${reasonOf(err)}`);
    }
  }

  clearWake() {
    this.timers.clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
  }

  /** One read at `at` (the end of a pause, a spaced new try). */
  wakeAt(at) {
    this.clearWake();
    const generation = this.generation;
    this.wakeTimer = this.timers.setTimeout(
      () => {
        this.wakeTimer = undefined;
        return this.guard(generation, () => this.tick());
      },
      Math.max(0, at - this.now()),
    );
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, states). The pauses, the blocks and the session stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    this.published = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.publishAll();
  }

  /** New credentials restart; a new consumption choice republishes the devices. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.email !== previous.email || next.password !== previous.password) {
      // New credentials: a refused password may have been corrected.
      this.refusedFor = undefined;
      return this.start(raw);
    }
    this.config = next;
    if (next.consumption !== previous.consumption) {
      this.published = undefined;
      await this.publishDevices();
    }
    return undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    try {
      await this.store.save(this.memory);
      this.storeFailed = false;
    } catch (err) {
      // No path nor content in the message: the file holds the refresh token.
      this.logger.error(`Saving the state to /data failed (${err?.code ?? err?.name ?? 'error'})`);
      if (!this.storeFailed) {
        this.storeFailed = true;
        const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
        await this.setStatus(connected, join(message ?? undefined, T.storeFailed));
      }
    }
  }

  /**
   * A new token pair: the rotated refresh token is written before any use,
   * under the account it was obtained for (never under another one).
   */
  async keepSession(tokens, account = this.config.account) {
    if (account !== this.config.account) return;
    this.memory.session = { account, refreshToken: tokens.refreshToken };
    await this.saveMemory();
  }

  pauseMessage() {
    const left = this.pausedUntil - this.now();
    return left > 0 ? T.rateLimited(age(left)) : undefined;
  }

  // --- Reads -------------------------------------------------------------------

  /** One run at a time: a tick during a run joins it. */
  tick({ quick = false } = {}) {
    if (this.running && this.runningKind === 'keepalive') {
      // A read due during the hourly refresh is not lost: it runs right after.
      const generation = this.generation;
      return this.running.then(() =>
        generation === this.generation ? this.tick({ quick }) : undefined,
      );
    }
    if (!this.running) {
      this.runningKind = 'read';
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
        this.runningKind = undefined;
      });
    }
    return this.running;
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    if (!this.config.email || !this.config.password) return;
    const now = this.now();
    if (this.blocked === 'session_refused' && now >= (this.memory.sessionRetryAt ?? 0)) {
      this.logger.info('ENGIE: trying the session again');
      this.blocked = undefined;
    }
    if (this.blocked) return;
    if (now < this.pausedUntil) {
      // The regular read came during a pause: one read at its end.
      this.wakeAt(this.pausedUntil);
      return;
    }
    this.client.timeout = quick ? QUICK_TIMEOUT : undefined;
    try {
      const limited = await this.readAll();
      if (generation !== this.generation) return;
      this.read = true;
      this.failures = 0;
      if (this.memory.sessionRetries || this.memory.sessionRetryAt) {
        this.memory.sessionRetries = 0;
        this.memory.sessionRetryAt = undefined;
        await this.saveMemory();
      }
      await this.publishAll();
      await this.reportOk();
      if (limited) {
        await this.failed(limited);
      }
    } catch (err) {
      if (generation === this.generation) {
        await this.failed(err);
      }
    } finally {
      this.client.timeout = undefined;
    }
  }

  /**
   * Every read of a cycle. The account relations are the main data (their
   * failure fails the cycle); every other read is secondary: its failure
   * keeps the previous values and never holds the others back. A refused
   * session stops at once; a 429 stops the reads still to come, what was read
   * is shown, then the pause applies (resolved as the 429 error).
   */
  async readAll() {
    const agreements = agreementsOf(await this.client.relations());
    const now = this.now();
    const today = localDate(now, TIME_ZONE);
    const window = usageWindow(now, USAGE_DAYS, TIME_ZONE);
    const issues = [];
    let limited;
    const attempt = async (label, job) => {
      if (limited) return undefined;
      try {
        return await job();
      } catch (err) {
        const code = codeOf(err);
        if (SESSION_ERRORS.has(code)) throw err;
        if (code === 'rate_limited') {
          limited = err;
        } else {
          this.logger.warn(`ENGIE ${label} not read: ${reasonOf(err)}`);
        }
        issues.push(label);
        return undefined;
      }
    };

    const meters = new Map();
    const accounts = new Map();
    for (const agreement of agreements) {
      const { ban } = agreement;
      const divisions = await attempt('contracts', async () =>
        divisionsOf(await this.client.contracts(ban)),
      );
      // An empty answer teaches nothing: the guess of the meters stays possible.
      if (divisions?.size > 0) this.divisions.set(ban, divisions);
      const known = this.divisions.get(ban) ?? new Map();
      const prices = await attempt('prices', async () =>
        pricesOf(await this.client.prices(ban), today),
      );
      const days = await attempt('consumption', async () =>
        usageDays(
          await this.client.usage(ban, window.start, window.end),
          now,
          TIME_ZONE,
          PARTIAL_DAY_AGE,
        ),
      );
      const balance = await attempt('balance', async () =>
        balanceOf(await this.client.balance(ban), today),
      );
      const plan = await attempt('advance invoices', async () =>
        planOf(await this.client.plan(ban)),
      );

      // The meters of the agreement: the EANs of the contracts and of the prices.
      const eans = new Set([...known.keys(), ...(prices?.keys() ?? [])]);
      // An EAN of the prices without a contract: guessed from the only energy
      // of the agreement, and only while its contracts were never read (else
      // it is an old or foreign one: a ghost meter would steal the usage).
      const single = this.divisions.has(ban)
        ? undefined
        : agreement.electricity && !agreement.gas
          ? KIND.ELECTRICITY
          : agreement.gas && !agreement.electricity
            ? KIND.GAS
            : undefined;
      for (const ean of eans) {
        const division = known.get(ean);
        const kind =
          division === 'GAS' ? KIND.GAS : division === 'ELECTRICITY' ? KIND.ELECTRICITY : single;
        if (!kind) continue;
        const key = `${kind}:${ean}`;
        const before = this.meters.get(key);
        meters.set(key, {
          kind,
          ean,
          ban,
          prices: prices ? prices.get(ean) : before?.prices,
          lastDay: before?.lastDay,
          intervals: [],
        });
      }
      // The usage is per agreement: given to its meter only when it has one of that kind.
      if (days) {
        const last = lastDays(days);
        const ofKind = (kind) =>
          [...meters.values()].filter((m) => m.ban === ban && m.kind === kind);
        const [elec, ...otherElec] = ofKind(KIND.ELECTRICITY);
        if (elec && otherElec.length === 0) {
          elec.intervals = dailyIntervals(days);
          elec.lastDay = last.electricity ?? elec.lastDay;
        }
        const [gas, ...otherGas] = ofKind(KIND.GAS);
        if (gas && otherGas.length === 0) {
          gas.lastDay = last.gas ?? gas.lastDay;
        }
      }
      const before = this.accounts.get(ban);
      accounts.set(ban, {
        ban,
        balance: balance ?? before?.balance,
        plan: plan ?? before?.plan,
      });
    }
    this.meters = meters;
    this.accounts = accounts;
    this.issues = [...new Set(issues)];
    return limited;
  }

  async failed(err) {
    const code = codeOf(err);
    const reason = reasonOf(err);
    const now = this.now();
    if (code === 'rate_limited') {
      const wait = Math.min(
        RATE_LIMIT_MAX,
        Math.max(RATE_LIMIT_MIN, err.retryAfter ?? RATE_LIMIT_DEFAULT),
      );
      this.pausedUntil = Math.max(this.pausedUntil, now + wait);
      this.memory.rateLimitedUntil = this.pausedUntil;
      await this.saveMemory();
      this.logger.warn(`ENGIE: ${reason}; every call paused ${Math.round(wait / 1000)} s`);
      await this.setStatus(this.read && !this.blocked, T.rateLimited(age(this.pausedUntil - now)));
      return;
    }
    if (code === 'grant_refused') {
      // The refresh token is dead: only a new code brings the session back.
      // Never a password sign-in by itself (each one sends an SMS).
      this.client.setSession(null);
      this.memory.session = null;
      await this.saveMemory();
      this.blocked = 'needs_code';
      this.logger.warn(`ENGIE stopped: ${reason}`);
      await this.setStatus(false, T.sessionLost);
      return;
    }
    if (code === 'session_refused') {
      const retries = this.memory.sessionRetries ?? 0;
      const wait = SESSION_RETRY[Math.min(retries, SESSION_RETRY.length - 1)];
      this.memory.sessionRetries = retries + 1;
      this.memory.sessionRetryAt = now + wait;
      await this.saveMemory();
      this.blocked = 'session_refused';
      this.wakeAt(this.memory.sessionRetryAt);
      this.logger.warn(`ENGIE: ${reason}; one new try in ${Math.round(wait / 60_000)} min`);
      await this.setStatus(false, T.sessionRefused(age(wait)));
      return;
    }
    if (isPassing(err)) {
      // Network, timeout, 5xx, a broken answer: 15 min, 30 min, 1 h... never
      // later than the regular read; reset by a successful read.
      const wait = RETRY_BACKOFF[Math.min(this.failures, RETRY_BACKOFF.length - 1)];
      this.failures += 1;
      this.wakeAt(now + wait);
      this.logger.warn(`ENGIE: ${reason}; new try in ${Math.round(wait / 60_000)} min`);
      await this.setStatus(false, T.retryIn(reason, age(wait)));
      return;
    }
    // Anything else (changed pages, a 4xx): the next regular read, never sooner.
    this.logger.warn(`ENGIE: ${reason}`);
    await this.setStatus(false, code === 'login_changed' ? T.loginChanged : T.retry(reason));
  }

  async reportOk() {
    if (this.accounts.size === 0) {
      await this.setStatus(true, T.noAgreement);
      return;
    }
    const ok = T.ok({ meters: this.meters.size, accounts: this.accounts.size });
    await this.setStatus(
      true,
      join(
        ok,
        this.issues.length > 0 ? T.partial(this.issues) : undefined,
        this.storeFailed ? T.storeFailed : undefined,
      ),
    );
  }

  /**
   * Every hour: a token-only refresh keeps the session (no data read). It
   * holds the same exclusivity as a read (`running`): a start, a button or a
   * read never swaps the session under it.
   */
  keepAlive() {
    if (!this.client.hasSession || this.blocked || this.running || this.now() < this.pausedUntil) {
      return undefined;
    }
    const generation = this.generation;
    this.runningKind = 'keepalive';
    this.running = (async () => {
      try {
        await this.client.refresh();
      } catch (err) {
        if (generation !== this.generation) return;
        const code = codeOf(err);
        if (code === 'rate_limited' || code === 'grant_refused') {
          await this.failed(err);
        } else {
          // A passing failure: the next read refreshes anyway.
          this.logger.info(`ENGIE session refresh failed: ${reasonOf(err)}`);
        }
      }
    })().finally(() => {
      this.running = undefined;
      this.runningKind = undefined;
    });
    return this.running;
  }

  // --- Gladys ----------------------------------------------------------------

  async publishAll() {
    await this.publishDevices();
    await this.publishConsumption();
    await this.publishStates();
  }

  devices() {
    return [
      ...[...this.meters.values()].map((m) => buildMeterDevice(this.gladys, m, this.config)),
      ...[...this.accounts.values()].map((a) => buildAccountDevice(this.gladys, a)),
    ];
  }

  async publishDevices() {
    if (!this.read) return;
    const devices = this.devices();
    const json = JSON.stringify(devices);
    if (devices.length === 0 || json === this.published) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The feature external ids of the created devices. */
  created() {
    const ids = new Set(this.createdFeatures);
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        ids.add(feature.external_id);
      }
    }
    return ids;
  }

  /**
   * The daily electricity consumption: publishEnergyConsumption only, never
   * publishStates. `only`: the feature ids of one device just created.
   */
  async publishConsumption(only) {
    if (this.config.consumption !== CONSUMPTION.ENERGY_MONITORING) return;
    const created = only ?? this.created();
    for (const meter of this.meters.values()) {
      if (meter.kind !== KIND.ELECTRICITY || meter.intervals.length === 0) continue;
      const feature = meterIds(this.gladys, meter.kind, meter.ean).feature(
        FEATURE.DAILY_CONSUMPTION,
      );
      if (!created.has(feature)) continue;
      const send = async (intervals) => {
        for (let i = 0; i < intervals.length; i += MAX_INTERVALS_PER_CALL) {
          await this.gladys.publishEnergyConsumption(
            feature,
            intervals.slice(i, i + MAX_INTERVALS_PER_CALL),
          );
        }
      };
      try {
        try {
          await send(meter.intervals);
        } catch (err) {
          // 400: with Gladys on a clock behind Brussels, the latest day may
          // not be over yet for the core. Sent again without it (it comes at
          // the next read).
          if (err?.status !== 400 || meter.intervals.length < 2) throw err;
          await send(meter.intervals.slice(0, -1));
        }
      } catch (err) {
        // 404: the device was deleted meanwhile.
        const log = err?.status === 404 ? this.logger.debug : this.logger.warn;
        log?.call(this.logger, `ENGIE consumption not published: ${err.message}`);
      }
    }
  }

  async publishStates() {
    const created = this.created();
    const states = [
      ...[...this.meters.values()].flatMap((m) =>
        meterStates(meterIds(this.gladys, m.kind, m.ean), m),
      ),
      ...[...this.accounts.values()].flatMap((a) =>
        accountStates(accountIds(this.gladys, a.ban), a),
      ),
    ].filter((s) => created.has(s.device_feature_external_id));
    if (states.length === 0) return;
    await this.gladys
      .publishChangedStates(states, { heartbeat: HEARTBEAT })
      .catch((err) => this.logger.warn(`ENGIE states failed: ${err.message}`));
  }

  /** A device was created (or updated): its last values at once, no ENGIE read. */
  async deviceCreated(device) {
    const features = new Set((device?.features ?? []).map((f) => f.external_id));
    for (const id of features) {
      this.createdFeatures.add(id);
    }
    await this.publishConsumption(features);
    await this.publishStates();
  }

  deviceDeleted(device) {
    const prefix = `${device?.external_id}:`;
    for (const id of [...this.createdFeatures]) {
      if (id.startsWith(prefix)) this.createdFeatures.delete(id);
    }
  }

  /** The Discovery tab asks for a scan: the devices of the last read (no ENGIE call). */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration buttons ----------------------------------------------------

  /** A button's work, answered within 50 s (the work goes on after). */
  async answer(work) {
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.slow), ANSWER_WITHIN);
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /** One button at a time, never during a read. */
  exclusive(job) {
    if (this.running) return T.busy;
    this.runningKind = 'button';
    this.running = job().finally(() => {
      this.running = undefined;
      this.runningKind = undefined;
    });
    return this.answer(this.running);
  }

  async testConnection() {
    if (!this.config.email || !this.config.password) return T.noCredentials;
    if (this.blocked === 'needs_code')
      return this.pending ? T.code.sent(this.pending.channel) : T.needsCode;
    const paused = this.pauseMessage();
    if (paused) return paused;
    if (this.now() - this.lastTestAt < TEST_COOLDOWN) {
      return join(T.test.cooldown, this.lastMessage);
    }
    if (this.running) return T.busy;
    this.lastTestAt = this.now();
    // A press of the button is one real try of a refused session.
    if (this.blocked === 'session_refused') {
      this.memory.sessionRetryAt = this.now();
    }
    const result = await this.answer(this.tick({ quick: true }));
    if (result === T.slow) return T.slow;
    return this.lastMessage ?? T.connecting;
  }

  /** Step 1: sign in with the e-mail and password; ENGIE sends a code by SMS or e-mail. */
  async requestCode(fields) {
    const channel = String(fields?.channel ?? '').toLowerCase();
    if (!fields || typeof fields !== 'object' || !CODE_CHANNELS[channel]) return T.code.needsFields;
    if (!this.config.email || !this.config.password) return T.noCredentials;
    if (this.client.hasSession && !this.blocked) return T.code.alreadyConnected;
    // A refused password is never sent again: repeated refusals may lock the account.
    if (this.refusedFor === fingerprint(this.config)) return T.passwordRefused;
    const paused = this.pauseMessage();
    if (paused) return paused;
    if (this.now() - (this.memory.codeAt ?? -Infinity) < CODE_COOLDOWN) return T.code.cooldown;
    if (this.running) return T.busy;
    // The account is bound at the start: whatever is saved meanwhile, the
    // result of this sign-in only ever goes to it.
    const { account, email, password } = this.config;
    return this.exclusive(async () => {
      this.memory.codeAt = this.now();
      await this.saveMemory();
      let result;
      try {
        result = await this.login({
          email,
          password,
          channel,
          timeout: QUICK_TIMEOUT,
          now: this.now,
        });
      } catch (err) {
        if (this.config.account !== account) return T.code.changed;
        return this.codeFailure(err, { email, password });
      }
      if (this.config.account !== account) return T.code.changed;
      if (result.tokens) {
        await this.signedIn(result.tokens, account);
        return T.code.notNeeded;
      }
      this.dropPending();
      const pending = { ...result.pending, account };
      this.pending = pending;
      // The Auth0 cookies and the PKCE verifier are forgotten after 10 minutes.
      this.pendingTimer = this.timers.setTimeout(async () => {
        if (this.pending !== pending) return;
        this.dropPending();
        if (this.blocked === 'needs_code') await this.setStatus(false, T.needsCode);
      }, PENDING_LIFETIME);
      this.blocked = 'needs_code';
      this.logger.info(`ENGIE verification code requested (${channel})`);
      await this.setStatus(false, T.code.sent(this.pending.channel));
      return T.code.sent(this.pending.channel);
    });
  }

  /** Step 2: the code received; the session is kept in /data. */
  async verifyCode(fields) {
    if (!fields || typeof fields !== 'object' || !('code' in fields)) return T.code.needsFields;
    const code = String(fields.code ?? '').replace(/[\s-]/g, '');
    if (!/^\d{4,10}$/.test(code)) return T.code.badFormat;
    if (!this.pendingAlive() || this.pending.account !== this.config.account) {
      this.dropPending();
      return T.code.noPending;
    }
    const paused = this.pauseMessage();
    if (paused) return paused;
    if (this.running) return T.busy;
    const { account } = this.config;
    const pending = this.pending;
    return this.exclusive(async () => {
      let tokens;
      try {
        tokens = await this.verify(pending, code, { timeout: QUICK_TIMEOUT });
      } catch (err) {
        if (this.config.account !== account) return T.code.changed;
        return this.codeFailure(err, this.config);
      }
      if (this.config.account !== account) return T.code.changed;
      this.logger.info('ENGIE verification code accepted');
      await this.signedIn(tokens, account);
      return T.code.verified;
    });
  }

  /**
   * A new session of `account` (bound when the button was pressed): kept, the
   * blocks lifted, one read at once. Nothing at all when the account of the
   * configuration changed meanwhile.
   */
  async signedIn(tokens, account) {
    if (account !== this.config.account) return;
    this.dropPending();
    this.refusedFor = undefined;
    this.client.setSession(tokens, account);
    await this.keepSession(tokens, account);
    this.blocked = undefined;
    this.memory.sessionRetries = 0;
    this.memory.sessionRetryAt = undefined;
    await this.saveMemory();
    await this.run({ quick: true });
  }

  /** An error of the code buttons -> the message under the button. */
  async codeFailure(err, credentials = this.config) {
    const code = codeOf(err);
    this.logger.warn(`ENGIE verification: ${reasonOf(err)}`);
    switch (code) {
      case 'refused':
        this.dropPending();
        this.refusedFor = fingerprint(credentials);
        await this.setStatus(false, T.refused);
        return T.refused;
      case 'code_refused':
        return T.code.refused;
      case 'code_expired':
        this.dropPending();
        return T.code.expired;
      case 'login_changed':
        await this.setStatus(false, T.loginChanged);
        return T.loginChanged;
      case 'rate_limited':
        await this.failed(err);
        return this.pauseMessage() ?? T.rateLimited(age(RATE_LIMIT_MIN));
      default:
        return T.code.failed(reasonOf(err));
    }
  }
}
