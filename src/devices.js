// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   electricity:<EAN>   an electricity connection point of the account
//   gas:<EAN>           a gas connection point
//   account:<BAN>       a business agreement (balance, advance invoices)
// The EAN (18 digits) and the business agreement number are ENGIE's stable
// ids, never a label.
//
// Units are the ones the core lists for each category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): `currency` takes `euro`, the energy
// sensor `kilowatt-hour`; `unknown` and `text` take none (the unit is in the
// name).
//
// Energy monitoring rules (Gladys core):
// - the electricity consumption goes ONLY through publishEnergyConsumption,
//   dated by ENGIE, on a `daily-consumption` feature (Gladys >= 5.2.0),
//   never through publishStates, and there is no index feature;
// - the gas NEVER goes there: the core would attach it to the main electric
//   meter and bill it at the electricity tariff. Its last published day is a
//   plain sensor;
// - the injection is never a consumption (it would be billed): plain sensor;
// - the prices are plain `currency` sensors (€/kWh in the name): the
//   integration does not declare an energy contract.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { CONSUMPTION } from './config.js';

export const KIND = { ELECTRICITY: 'electricity', GAS: 'gas' };

/** Feature keys (forever). */
export const FEATURE = {
  PRICE: 'price',
  PRICE_DAY: 'price_day',
  PRICE_NIGHT: 'price_night',
  INJECTION_PRICE: 'injection_price',
  DAILY_CONSUMPTION: 'daily_consumption',
  CONSUMPTION_LAST_DAY: 'consumption_last_day',
  INJECTION_LAST_DAY: 'injection_last_day',
  OPEN_AMOUNT: 'open_amount',
  NEXT_DUE_DATE: 'next_due_date',
  ADVANCE_AMOUNT: 'advance_amount',
  NEXT_ADVANCE_DATE: 'next_advance_date',
};

/** "—" for a text with no value. */
export const NONE = '—';

export const meterIds = (gladys, kind, ean) => gladys.externalIds(kind, String(ean));
export const accountIds = (gladys, ban) => gladys.externalIds('account', String(ban));

const base = (external, key, name, extra) => ({
  name,
  external_id: external.feature(key),
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A price per kWh: a negative one is a credit, a few euros the worst crisis. */
const price = (external, key, name) =>
  base(external, key, name, {
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    unit: U.EURO,
    min: -10,
    max: 10,
  });

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, max) =>
  base(external, key, name, { category: C.UNKNOWN, type: T.SENSOR.DECIMAL, min: 0, max });

const money = (external, key, name) =>
  base(external, key, name, {
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    unit: U.EURO,
    min: -100_000,
    max: 100_000,
  });

const text = (external, key, name) =>
  base(external, key, name, {
    category: C.TEXT,
    type: T.TEXT.TEXT,
    min: 0,
    max: 0,
    keep_history: false,
  });

const shortEan = (ean) => `EAN …${String(ean).slice(-4)}`;

/** The price features of a meter: the slots ENGIE gives for it (fixed at creation). */
function priceFeatures(external, meter) {
  if (!meter.prices) {
    // No price for this meter (a dynamic contract has none): no price feature.
    return [];
  }
  const offtake = meter.prices.offtake ?? {};
  const label = meter.kind === KIND.GAS ? 'Gas price' : 'Electricity price';
  const features = [];
  if (offtake.total !== undefined || (offtake.day === undefined && offtake.night === undefined)) {
    features.push(price(external, FEATURE.PRICE, `${label} (€/kWh)`));
  }
  if (meter.kind === KIND.ELECTRICITY) {
    if (offtake.day !== undefined) {
      features.push(price(external, FEATURE.PRICE_DAY, 'Electricity price, day (€/kWh)'));
    }
    if (offtake.night !== undefined) {
      features.push(price(external, FEATURE.PRICE_NIGHT, 'Electricity price, night (€/kWh)'));
    }
    if (meter.prices?.injection?.total !== undefined) {
      features.push(price(external, FEATURE.INJECTION_PRICE, 'Injection price (€/kWh)'));
    }
  }
  return features;
}

export function buildMeterDevice(
  gladys,
  meter,
  { consumption = CONSUMPTION.ENERGY_MONITORING } = {},
) {
  const external = meterIds(gladys, meter.kind, meter.ean);
  if (meter.kind === KIND.GAS) {
    return {
      name: `ENGIE gas (${shortEan(meter.ean)})`,
      external_id: external.device,
      features: [
        ...priceFeatures(external, meter),
        plain(
          external,
          FEATURE.CONSUMPTION_LAST_DAY,
          'Gas consumption, last published day (kWh)',
          1_000_000,
        ),
      ],
      params: [{ name: 'ean', value: meter.ean }],
    };
  }
  const monitored = consumption === CONSUMPTION.ENERGY_MONITORING;
  return {
    name: `ENGIE electricity (${shortEan(meter.ean)})`,
    external_id: external.device,
    features: [
      ...priceFeatures(external, meter),
      ...(monitored
        ? [
            base(external, FEATURE.DAILY_CONSUMPTION, 'Consumption (day)', {
              category: C.ENERGY_SENSOR,
              type: T.ENERGY_SENSOR.DAILY_CONSUMPTION,
              unit: U.KILOWATT_HOUR,
              min: 0,
              max: 100_000,
            }),
          ]
        : []),
      plain(
        external,
        FEATURE.CONSUMPTION_LAST_DAY,
        'Consumption, last published day (kWh)',
        100_000,
      ),
      plain(external, FEATURE.INJECTION_LAST_DAY, 'Injection, last published day (kWh)', 100_000),
    ],
    params: [
      { name: 'ean', value: meter.ean },
      { name: 'consumption', value: consumption },
    ],
  };
}

export function buildAccountDevice(gladys, account) {
  const external = accountIds(gladys, account.ban);
  return {
    name: `ENGIE account (…${String(account.ban).slice(-4)})`,
    external_id: external.device,
    features: [
      money(external, FEATURE.OPEN_AMOUNT, 'Open amount to pay (€)'),
      text(external, FEATURE.NEXT_DUE_DATE, 'Next due date'),
      money(external, FEATURE.ADVANCE_AMOUNT, 'Advance invoice amount (€)'),
      text(external, FEATURE.NEXT_ADVANCE_DATE, 'Next advance invoice'),
    ],
    params: [],
  };
}

const value = (external, key, v, digits = 6) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? []
    : [
        {
          device_feature_external_id: external.feature(key),
          state: Math.round(v * 10 ** digits) / 10 ** digits,
        },
      ];

const words = (external, key, v) => [
  { device_feature_external_id: external.feature(key), text: v ?? NONE },
];

/** The plain states of a meter (never the consumption: publishEnergyConsumption). */
export function meterStates(external, meter) {
  const offtake = meter.prices?.offtake ?? {};
  return [
    ...value(external, FEATURE.PRICE, offtake.total),
    ...value(external, FEATURE.PRICE_DAY, offtake.day),
    ...value(external, FEATURE.PRICE_NIGHT, offtake.night),
    ...value(external, FEATURE.INJECTION_PRICE, meter.prices?.injection?.total),
    ...value(external, FEATURE.CONSUMPTION_LAST_DAY, meter.lastDay?.consumption, 3),
    ...value(external, FEATURE.INJECTION_LAST_DAY, meter.lastDay?.injection, 3),
  ];
}

/** The states of an account: what is known (a failed read keeps the previous values). */
export function accountStates(external, account) {
  return [
    ...(account.balance
      ? [
          ...value(external, FEATURE.OPEN_AMOUNT, account.balance.openAmount, 2),
          ...words(external, FEATURE.NEXT_DUE_DATE, account.balance.nextDue?.date),
        ]
      : []),
    ...(account.plan
      ? [
          ...value(external, FEATURE.ADVANCE_AMOUNT, account.plan.amount, 2),
          ...words(external, FEATURE.NEXT_ADVANCE_DATE, account.plan.nextDate),
        ]
      : []),
  ];
}
