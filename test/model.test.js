// -----------------------------------------------------------------------------
// What the ENGIE answers mean (pure).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  agreementsOf,
  balanceOf,
  bareEan,
  currentPeriod,
  dailyIntervals,
  divisionsOf,
  lastDays,
  planOf,
  pricesOf,
  slotCode,
  usageDays,
  usageWindow,
} from '../src/engie/model.js';
import * as F from './fixtures/engie.js';

const TZ = 'Europe/Brussels';

test('the active business agreements, the divisions of the meters', () => {
  assert.deepEqual(agreementsOf(F.RELATIONS), [{ ban: F.BAN, electricity: true, gas: true }]);
  assert.deepEqual(
    agreementsOf({
      items: [{ customerAccount: { businessAgreements: [{ businessAgreementNumber: '../x' }] } }],
    }),
    [],
  );
  assert.deepEqual(agreementsOf(null), []);
  assert.deepEqual(
    [...divisionsOf(F.CONTRACTS)],
    [
      [F.ELEC_EAN, 'ELECTRICITY'],
      [F.GAS_EAN, 'GAS'],
    ],
  );
  assert.equal(bareEan('541448820000000001_ID1'), '541448820000000001');
  assert.equal(bareEan('5414'), undefined);
  assert.equal(bareEan(42), undefined);
});

test('the prices of today: the period in force, day and night, injection, EN left out', () => {
  const prices = pricesOf(F.PRICES, '2026-10-17');
  assert.deepEqual(prices.get(F.ELEC_EAN), {
    offtake: { total: 0.123456, day: 0.18, night: 0.09 },
    injection: { total: 0.05 },
  });
  assert.deepEqual(prices.get(F.GAS_EAN), { offtake: { total: 0.045 }, injection: {} });
  assert.equal(slotCode('S_TOU1_OFFTAKE_PEAK'), 'PEAK');
  assert.equal(slotCode('HIGH_LOAD_HOURS'), 'PEAK');
  assert.equal(slotCode('LOW_LOAD_HOURS'), 'OFFPEAK');
  // A future period is never taken; without a covering one, the latest started.
  const periods = [
    { from: '2026-01-01', to: '2026-06-01', id: 'old' },
    { from: '2027-01-01', to: '2027-12-31', id: 'future' },
  ];
  assert.equal(currentPeriod(periods, '2026-10-17').id, 'old');
  assert.equal(currentPeriod(periods, '2025-01-01'), undefined);
  // Hostile values are dropped.
  const odd = pricesOf(
    {
      items: [
        {
          ean: `${F.ELEC_EAN}_ID1`,
          prices: [
            {
              from: '2000-01-01',
              to: '2099-01-01',
              proportionalPriceConfigurations: {
                offtake: [
                  { timeOfUseSlotCode: 'TOTAL_HOURS', priceValue: '1e9' },
                  { timeOfUseSlotCode: 'PEAK', priceValue: true },
                  { timeOfUseSlotCode: 'OFFPEAK', priceValue: '0.2' },
                ],
              },
            },
          ],
        },
      ],
    },
    '2026-10-17',
  );
  assert.deepEqual(odd.get(F.ELEC_EAN).offtake, { night: 0.2 });
});

test('the daily usage: complete days only, the offtake as consumption, the gas apart', () => {
  const now = Date.now();
  const days = usageDays(F.usage(now), now, TZ);
  assert.deepEqual(
    days.map((d) => d.date),
    F.completeDates(now),
  );
  const intervals = dailyIntervals(days);
  assert.deepEqual(intervals[0], { date: F.completeDates(now)[0], kwh: 17 });
  const last = lastDays(days);
  assert.deepEqual(last.electricity, {
    date: F.completeDates(now).at(-1),
    consumption: 12,
    injection: 1.2,
  });
  assert.deepEqual(last.gas, { date: F.completeDates(now).at(-1), consumption: 22 });
  // Never a negative or absurd value.
  const hostile = usageDays(
    {
      items: [
        {
          start: '2026-01-01T00:00:00+01:00',
          end: '2026-01-02T00:00:00+01:00',
          energy: { electricity: { offtake: { kWhSum: -5 } }, gas: { kWh: 'x' } },
        },
      ],
    },
    now,
    TZ,
  );
  assert.deepEqual(hostile, [{ date: '2026-01-01', electricity: undefined, gas: undefined }]);
});

test('the usage window: the 7 local days before today', () => {
  const now = Date.parse('2026-03-29T12:00:00Z');
  assert.deepEqual(usageWindow(now, 7, TZ), { start: '2026-03-22', end: '2026-03-29' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('the balance and the advance invoices', () => {
  assert.deepEqual(balanceOf(F.BALANCE, '2026-10-17'), {
    openAmount: 80.6,
    nextDue: { date: '2099-07-22', amount: 80.6 },
  });
  assert.deepEqual(balanceOf({}, '2026-10-17'), { openAmount: undefined, nextDue: undefined });
  assert.deepEqual(planOf(F.PLAN), { amount: 62, nextDate: '2099-10-11' });
  assert.deepEqual(planOf({ budgetBillingPlan: { monthlyAmount: 40 } }), {
    amount: 40,
    nextDate: undefined,
  });
});
