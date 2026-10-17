// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake ENGIE.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EngieApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import {
  HOUR,
  KEEP_ALIVE_INTERVAL,
  MINUTE,
  POLL_INTERVAL,
  RATE_LIMIT_MAX,
  SESSION_RETRY,
} from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { installEngie, json } from './helpers/fakeEngie.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import * as F from './fixtures/engie.js';

let engie;
afterEach(() => engie?.restore());

const SELECTOR = 'engie-belgium';
const ELEC = `ext:${SELECTOR}:electricity:${F.ELEC_EAN}`;
const GAS = `ext:${SELECTOR}:gas:${F.GAS_EAN}`;
const ACCOUNT = `ext:${SELECTOR}:account:${F.BAN}`;
const CONFIG = { email: ` ${F.EMAIL} `, password: F.PASSWORD };
const KEPT = { session: { account: accountKey(F.EMAIL), refreshToken: 'kept' } };
const SECRETS = [F.PASSWORD, F.EMAIL, F.CODE, 'refresh-', 'kept', 'AUTH-CODE', 'Bearer'];

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

async function setup({
  config = CONFIG,
  memory = null,
  overrides = {},
  mfa = true,
  seed = true,
} = {}) {
  const clock = { now: Date.now() };
  engie = installEngie({ clock, overrides, mfa });
  if (seed) engie.seed('kept');
  const gladys = createFakeGladys({ selector: SELECTOR, config });
  const timers = createFakeTimers();
  const store = memoryStore(memory);
  const logger = createLogger();
  const app = new EngieApp({ gladys, logger, now: () => clock.now, timers, store });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  await app.idle();
  return { app, gladys, timers, clock, store, logger };
}

const status = (gladys) => gladys.fake.connectionStatus;
const keys = (device) => device.features.map((f) => f.external_id.split(':').at(-1));

/** The user creates every discovered device. */
async function createAll(gladys, app) {
  for (const device of gladys.fake.discoveredDevices) {
    gladys.fake.devices.push(device);
    await app.deviceCreated(device);
  }
}

function assertNoSecret(logger) {
  for (const line of logger.lines) {
    for (const secret of SECRETS) {
      assert.ok(!line.includes(secret), `a log line carries a secret: ${line}`);
    }
  }
}

test('no credentials: the status says so, nothing is called, no timer', async () => {
  const { gladys, timers } = await setup({ config: {} });
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /mot de passe/);
  assert.equal(engie.calls.length, 0);
  assert.equal(timers.pending.size, 0);
});

test('first start: the two code buttons sign in, then the devices, the prices, the consumption', async () => {
  const { app, gladys, store, logger, timers } = await setup({ seed: false });
  // No session yet: nothing is called, the status asks for a code.
  assert.equal(engie.calls.length, 0);
  assert.match(status(gladys).message.en, /verification code/);
  assert.equal(timers.intervals().length, 2);

  const sent = await gladys.fake.action('request_code', { channel: 'sms' });
  assert.equal(sent.success, true);
  assert.match(JSON.stringify(sent), /sent a code by SMS/);
  assert.match((await app.requestCode({ channel: 'sms' })).en, /less than a minute/);
  assert.match((await app.requestCode({})).en, /Gladys 5.1/);

  const verified = await app.verifyCode({ code: ' 123 456 ' });
  assert.match(verified.en, /Code accepted/);
  assert.equal(store.peek().session.refreshToken, 'refresh-1');
  assert.equal(store.peek().session.account, accountKey(F.EMAIL));
  assert.ok(!JSON.stringify(store.peek()).includes(F.PASSWORD));
  assert.ok(!JSON.stringify(store.peek()).includes(F.EMAIL));
  assert.equal(status(gladys).connected, true);

  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name]),
    [
      [ELEC, 'ENGIE electricity (EAN …0001)'],
      [GAS, 'ENGIE gas (EAN …0002)'],
      [ACCOUNT, 'ENGIE account (…0001)'],
    ],
  );
  assert.deepEqual(keys(devices[0]), [
    'price',
    'price_day',
    'price_night',
    'injection_price',
    'daily_consumption',
    'consumption_last_day',
    'injection_last_day',
  ]);
  // The gas never enters the energy monitoring: a price and a plain sensor.
  assert.deepEqual(keys(devices[1]), ['price', 'consumption_last_day']);
  assert.ok(devices[1].features.every((f) => f.category !== 'energy-sensor'));
  assert.deepEqual(keys(devices[2]), [
    'open_amount',
    'next_due_date',
    'advance_amount',
    'next_advance_date',
  ]);
  // Units of the core: euro for currency, kWh for the energy sensor, none elsewhere.
  for (const f of devices.flatMap((d) => d.features)) {
    const expected = { currency: 'euro', 'energy-sensor': 'kilowatt-hour' }[f.category];
    assert.equal(f.unit, expected, f.external_id);
  }

  // Nothing published before the devices exist; then their values at once.
  assert.equal(gladys.fake.states.length, 0);
  await createAll(gladys, app);
  const state = (id) => gladys.fake.lastState(id);
  assert.equal(state(`${ELEC}:price`), 0.123456);
  assert.equal(state(`${ELEC}:price_day`), 0.18);
  assert.equal(state(`${ELEC}:price_night`), 0.09);
  assert.equal(state(`${ELEC}:injection_price`), 0.05);
  assert.equal(state(`${ELEC}:consumption_last_day`), 12);
  assert.equal(state(`${ELEC}:injection_last_day`), 1.2);
  assert.equal(state(`${GAS}:price`), 0.045);
  assert.equal(state(`${GAS}:consumption_last_day`), 22);
  assert.equal(state(`${ACCOUNT}:open_amount`), 80.6);
  assert.equal(state(`${ACCOUNT}:advance_amount`), 62);
  const texts = gladys.fake.states.filter((s) => s.text !== undefined).map((s) => s.text);
  assert.deepEqual(texts, ['2099-07-22', '2099-10-11']);
  // The daily consumption only through publishEnergyConsumption, electricity only.
  assert.ok(
    gladys.fake.states.every((s) => !s.device_feature_external_id.endsWith('daily_consumption')),
  );
  const published = gladys.fake.publishedEnergyConsumption;
  assert.deepEqual(
    published.map((p) => p.device_feature_external_id),
    [`${ELEC}:daily_consumption`],
  );
  assert.deepEqual(
    published[0].intervals.map((i) => i.date),
    F.completeDates(Date.now()),
  );
  assert.equal(published[0].intervals[0].kwh, 17);
  // The usage asks the 7 days before today, daily, without simulation.
  const usage = engie.named('usage')[0].query;
  assert.equal(usage.granularity, 'DAILY');
  assert.equal(usage.includeSimulation, 'false');
  assertNoSecret(logger);
});

test('a restart with the kept session: one refresh, the rotated token written, no code asked', async () => {
  const { gladys, store, logger } = await setup({ memory: KEPT });
  assert.equal(engie.named('POST token').length, 1);
  assert.equal(store.peek().session.refreshToken, 'refresh-1');
  assert.equal(engie.named('GET authorize').length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /2 meter\(s\), 1 contract\(s\)/);
  assertNoSecret(logger);
});

test('a dead refresh token: the session is dropped, a code is asked, never a password sign-in', async () => {
  const { app, gladys, store, timers, logger } = await setup({ memory: KEPT, seed: false });
  assert.equal(store.peek().session, null);
  assert.match(status(gladys).message.en, /ended the session/);
  assert.equal(engie.named('GET authorize').length, 0);
  assert.equal(engie.named('POST password').length, 0);
  // The regular reads and the keep-alive wait for the user.
  const before = engie.calls.length;
  await timers.runIntervals();
  await app.idle();
  assert.equal(engie.calls.length, before);
  assert.match((await app.testConnection()).en, /verification code/);
  assertNoSecret(logger);
});

test('a fresh token refused: one refresh and one retry, then spaced new tries kept in /data', async () => {
  const { app, gladys, store, timers, clock } = await setup({
    memory: KEPT,
    overrides: { relations: () => json({}, 401) },
  });
  assert.equal(engie.named('POST token').length, 2);
  assert.equal(engie.named('relations').length, 2);
  assert.match(status(gladys).message.en, /fresh access token/);
  assert.equal(store.peek().sessionRetryAt, clock.now + SESSION_RETRY[0]);
  assert.equal(SESSION_RETRY[0] >= POLL_INTERVAL, true);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [SESSION_RETRY[0]],
  );
  // The regular read before the new try calls nothing.
  await timers.runIntervals();
  await app.idle();
  assert.equal(engie.named('relations').length, 2);
  // After the delay: one try, and the next delay is longer.
  clock.now += SESSION_RETRY[0];
  await timers.runTimeouts();
  await app.idle();
  assert.equal(engie.named('relations').length, 4);
  assert.equal(store.peek().sessionRetryAt, clock.now + SESSION_RETRY[1]);
  // A restart keeps the delay.
  const again = new EngieApp({
    gladys,
    logger: createLogger(),
    now: () => clock.now,
    timers: createFakeTimers(),
    store,
  });
  await again.start(CONFIG);
  await again.idle();
  assert.equal(engie.named('relations').length, 4);
  // The test button is one real try.
  await app.testConnection();
  assert.equal(engie.named('relations').length, 6);
});

test('a 429 on a secondary read: what was read is shown, every path paused (bounded), kept across a restart', async () => {
  const { app, gladys, store, timers, clock } = await setup({
    memory: KEPT,
    overrides: { balance: () => json({}, 429, { 'retry-after': '99999' }) },
  });
  assert.equal(engie.named('plan').length, 0, 'no read after the 429');
  assert.equal(gladys.fake.discoveredDevices.length, 3);
  await createAll(gladys, app);
  assert.equal(gladys.fake.lastState(`${ELEC}:price`), 0.123456);
  assert.equal(store.peek().rateLimitedUntil, clock.now + RATE_LIMIT_MAX);
  assert.match(status(gladys).message.en, /slow down: every call paused for 6 h/);
  assert.equal(status(gladys).connected, true);

  // Every path waits: the regular read, the keep-alive, the buttons.
  const before = engie.calls.length;
  await timers.runIntervals();
  await app.idle();
  assert.match((await app.testConnection()).en, /slow down/);
  assert.match((await app.requestCode({ channel: 'sms' })).en, /slow down|Already connected/);
  assert.equal(engie.calls.length, before);
  // The regular read during the pause plans one read at its end, never sooner.
  assert.ok(timers.timeouts().some((t) => t.ms === RATE_LIMIT_MAX));

  // A restart and a reconnection keep the pause.
  await app.connected(CONFIG);
  const again = new EngieApp({
    gladys,
    logger: createLogger(),
    now: () => clock.now,
    timers: createFakeTimers(),
    store,
  });
  await again.start(CONFIG);
  await again.idle();
  assert.equal(engie.calls.length, before);
});

test('a 429 Retry-After below a minute pauses a minute; a 429 on the main read too', async () => {
  const { store, clock } = await setup({
    memory: KEPT,
    overrides: { relations: () => json({}, 429, { 'retry-after': '1' }) },
  });
  assert.equal(store.peek().rateLimitedUntil, clock.now + MINUTE);
});

test('a secondary read that fails keeps the others and the previous values', async () => {
  let fail = false;
  const { app, gladys, timers } = await setup({
    memory: KEPT,
    overrides: {
      usage: () => json({ error: 'x' }, 500),
      plan: () => (fail ? json({}, 503) : undefined),
    },
  });
  await createAll(gladys, app);
  assert.equal(gladys.fake.lastState(`${ELEC}:price`), 0.123456);
  assert.equal(gladys.fake.lastState(`${ACCOUNT}:advance_amount`), 62);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  assert.match(status(gladys).message.en, /could not be read.*consumption/);
  assert.equal(status(gladys).connected, true);
  // The advance invoices fail at the next read: their previous value stays.
  fail = true;
  await timers.runIntervals();
  await app.idle();
  assert.equal(gladys.fake.lastState(`${ACCOUNT}:advance_amount`), 62);
  assert.match(status(gladys).message.en, /advance invoices/);
});

test('a passing failure of the main read: the next try is the next regular read', async () => {
  const { gladys, timers } = await setup({
    memory: KEPT,
    overrides: { relations: () => json({}, 502) },
  });
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /ENGIE answered 502/);
  assert.equal(timers.timeouts().length, 0);
  assert.deepEqual(
    timers.intervals().map((t) => t.ms),
    [POLL_INTERVAL, KEEP_ALIVE_INTERVAL],
  );
});

test('"sensor only": no consumption feature, nothing in the energy monitoring', async () => {
  const { app, gladys } = await setup({
    memory: KEPT,
    config: { ...CONFIG, consumption: 'sensor_only' },
  });
  const elec = gladys.fake.discoveredDevices[0];
  assert.ok(!keys(elec).includes('daily_consumption'));
  await createAll(gladys, app);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  assert.equal(gladys.fake.lastState(`${ELEC}:consumption_last_day`), 12);
});

test('a reconnection resends the devices, the status and the states; the session stays', async () => {
  const { app, gladys } = await setup({ memory: KEPT });
  await createAll(gladys, app);
  const discovered = gladys.fake.bodies('POST', '/discovered_device').length;
  const states = gladys.fake.states.length;
  const statuses = gladys.fake.connectionStatuses.length;
  const tokens = engie.named('POST token').length;
  await app.connected(CONFIG);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discovered + 1);
  assert.ok(gladys.fake.states.length > states);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(engie.named('POST token').length, tokens);
});

test('the keep-alive refresh rotates and writes the token, never during a pause', async () => {
  const { app, store, clock } = await setup({ memory: KEPT });
  clock.now += HOUR;
  await app.keepAlive();
  assert.equal(store.peek().session.refreshToken, 'refresh-2');
  assert.equal(engie.named('relations').length, 1, 'no data read');
  app.pausedUntil = clock.now + MINUTE;
  await app.keepAlive();
  assert.equal(store.peek().session.refreshToken, 'refresh-2');
});

test('the code buttons: wrong password, wrong code, expired wait, already connected', async () => {
  const { app, gladys, clock } = await setup({
    seed: false,
    config: { ...CONFIG, password: 'wrong' },
  });
  assert.match(
    (await app.requestCode({ channel: 'email' })).en,
    /refused the e-mail or the password/,
  );
  assert.match(status(gladys).message.en, /refused the e-mail/);
  assert.match((await app.verifyCode({ code: '123456' })).en, /No code is awaited/);
  assert.match((await app.verifyCode({ code: 'abc' })).en, /4 to 10 digits/);
  assert.match((await app.verifyCode({})).en, /Gladys 5.1/);

  await app.configUpdated(CONFIG);
  clock.now += 2 * MINUTE;
  assert.match((await app.requestCode({ channel: 'email' })).en, /by e-mail/);
  assert.match((await app.verifyCode({ code: '999999' })).en, /refused this code/);
  clock.now += 11 * MINUTE;
  assert.match((await app.verifyCode({ code: F.CODE })).en, /No code is awaited/);
  clock.now += 2 * MINUTE;
  await app.requestCode({ channel: 'sms' });
  assert.match((await app.verifyCode({ code: F.CODE })).en, /Code accepted/);
  assert.match((await app.requestCode({ channel: 'sms' })).en, /Already connected/);
  assert.equal(status(gladys).connected, true);
});

test('read only: a command is refused', async () => {
  const { gladys } = await setup({ memory: KEPT });
  const device = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
});
