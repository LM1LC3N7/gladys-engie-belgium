// -----------------------------------------------------------------------------
// What the ENGIE answers mean. Pure: no network, no Gladys. Every value is
// checked (type, finite, bounded) before use: an answer is never trusted.
//
// Shapes as aioengiebelgium parses them (`parsers.py`, MIT):
// - customer-account-relations: items[].customerAccount.businessAgreements[]
//   { businessAgreementNumber, active, electricityContract, gasContract };
// - energy-contracts: items[] { servicePointNumber: "<EAN>_ID1", division:
//   ELECTRICITY | GAS, status };
// - supplier-energy-prices: items[] { ean: "<EAN>_ID1", prices[] { from, to,
//   proportionalPriceConfigurations: { offtake[], injection[] } } }, each
//   slot { timeOfUseSlotCode, priceValue (VAT incl.), priceValueExclVAT };
// - usage-details (DAILY): items[] { start, end, partialData, energy: {
//   electricity: { offtake: { kWhSum }, injection: { kWhSum } }, gas: { kWh } } };
// - account-balance: { status, overview: { openAmount, ... }, details: {
//   financialTransactions[] { openAmount, dueDate } } };
// - billing-period-bbp-details: { budgetBillingPlan: { currentAmount,
//   monthlyAmount, nextPartialInvoiceDate } }.
// -----------------------------------------------------------------------------

const DAY = 24 * 60 * 60_000;
const round = (value, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** At most this many entries read from any list of an answer. */
const MAX_ITEMS = 500;

const list = (value) => (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []);
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
/** A finite number within bounds, else undefined. */
export function number(value, min = -1e9, max = 1e9) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}
/** A `YYYY-MM-DD` date (the date part of a date-time too), else undefined. */
export function dateOf(value) {
  if (typeof value !== 'string') return undefined;
  const date = value.slice(0, 10);
  return DATE_RE.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ? date : undefined;
}

// --- Local time ------------------------------------------------------------------

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(t, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/** A calendar date moved by `days` (calendar arithmetic, no time zone). */
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** The usage window: the `days` local days before today (today excluded, as ENGIE has none yet). */
export function usageWindow(now, days, timeZone) {
  const today = localDate(now, timeZone);
  return { start: addDays(today, -days), end: today };
}

// --- Account ---------------------------------------------------------------------

/** An EAN without its delivery point suffix (`_ID1`), 18 digits, else undefined. */
export function bareEan(value) {
  if (typeof value !== 'string') return undefined;
  const ean = value.replace(/_ID\d{1,3}$/, '');
  return /^\d{18}$/.test(ean) ? ean : undefined;
}

/** The active business agreements of the account: `[{ ban, electricity, gas }]`. */
export function agreementsOf(relations) {
  const seen = new Map();
  for (const relation of list(object(relations).items)) {
    const account = object(object(relation).customerAccount);
    for (const agreement of list(account.businessAgreements)) {
      const a = object(agreement);
      const ban = a.businessAgreementNumber;
      if (typeof ban !== 'string' || !/^\d{1,20}$/.test(ban) || a.active === false) continue;
      seen.set(ban, {
        ban,
        electricity: object(a.electricityContract).active === true,
        gas: object(a.gasContract).active === true,
      });
    }
  }
  return [...seen.values()].slice(0, 10);
}

const DIVISIONS = new Set(['ELECTRICITY', 'GAS']);

/**
 * EAN -> ELECTRICITY | GAS, from the ACTIVE energy contracts of a business
 * agreement (as hass-engie-be `_contracts.py`).
 */
export function divisionsOf(contracts) {
  const divisions = new Map();
  for (const item of list(object(contracts).items)) {
    const c = object(item);
    if (c.status !== 'ACTIVE') continue;
    const ean = bareEan(c.servicePointNumber);
    const division = typeof c.division === 'string' ? c.division.toUpperCase() : '';
    if (ean && DIVISIONS.has(division)) {
      divisions.set(ean, division);
    }
  }
  return divisions;
}

// --- Prices ------------------------------------------------------------------------

/**
 * A slot code without its direction prefix (`S_TOU1_OFFTAKE_PEAK` -> PEAK),
 * the load-hours names mapped to PEAK / OFFPEAK (as the library does).
 */
export function slotCode(raw) {
  const code = String(raw ?? '')
    .toUpperCase()
    .replace(/^S_TOU\d{1,3}_(OFFTAKE|INJECTION)_/, '');
  if (code === 'HIGH_LOAD_HOURS') return 'PEAK';
  if (code === 'LOW_LOAD_HOURS') return 'OFFPEAK';
  return code;
}

/** The slots the integration shows; others (EN: exclusive night, ...) are left out. */
const SLOT_KEYS = { TOTAL_HOURS: 'total', PEAK: 'day', OFFPEAK: 'night' };

/**
 * The price period in force on `today`: the one covering it (`to` excluded,
 * as Home Assistant reads it), else the latest started one, else none.
 */
export function currentPeriod(periods, today) {
  let covering;
  let latest;
  for (const raw of list(periods)) {
    const p = object(raw);
    const from = dateOf(p.from);
    const to = dateOf(p.to);
    if (!from || from > today) continue;
    if (!to || today < to) {
      if (!covering || from > dateOf(covering.from)) covering = p;
    }
    if (!latest || from > dateOf(latest.from)) latest = p;
  }
  return covering ?? latest;
}

/** One direction of a period: `{ total, day, night }` in €/kWh, VAT included. */
function slotPrices(slots) {
  const prices = {};
  for (const raw of list(slots)) {
    const s = object(raw);
    const key = SLOT_KEYS[slotCode(s.timeOfUseSlotCode)];
    const value = number(s.priceValue, -10, 10);
    if (key && value !== undefined && prices[key] === undefined) {
      prices[key] = round(value);
    }
  }
  return prices;
}

/** EAN -> `{ offtake: { total, day, night }, injection: { total } }` for today. */
export function pricesOf(json, today) {
  const prices = new Map();
  for (const raw of list(object(json).items)) {
    const item = object(raw);
    const ean = bareEan(item.ean);
    const period = currentPeriod(item.prices, today);
    if (!ean || !period) continue;
    const configs = object(period.proportionalPriceConfigurations);
    const injection = slotPrices(configs.injection);
    prices.set(ean, {
      offtake: slotPrices(configs.offtake),
      injection: injection.total === undefined ? {} : { total: injection.total },
    });
  }
  return prices;
}

// --- Usage ---------------------------------------------------------------------------

/**
 * The complete days of a DAILY usage answer, oldest first:
 * `[{ date, electricity: { consumption, injection } | undefined, gas | undefined }]`.
 * A day still running (ending after `now`) is left out. A recent day marked
 * partial is left out too (it comes back complete at a later read; the core
 * upserts by date); one older than `partialAge` days is kept: ENGIE also
 * flags final days that way, and it will not change any more.
 */
export function usageDays(json, now, timeZone, partialAge = 3) {
  const byDate = new Map();
  const oldest = addDays(localDate(now, timeZone), -partialAge);
  for (const raw of list(object(json).items)) {
    const item = object(raw);
    const start = Date.parse(item.start);
    const end = Date.parse(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now) continue;
    if (item.partialData === true && localDate(start, timeZone) > oldest) continue;
    const energy = object(item.energy);
    const elec =
      energy.electricity && typeof energy.electricity === 'object'
        ? object(energy.electricity)
        : undefined;
    const offtake = elec ? number(object(elec.offtake).kWhSum, 0, 100_000) : undefined;
    const injection = elec ? number(object(elec.injection).kWhSum, 0, 100_000) : undefined;
    const gas =
      energy.gas && typeof energy.gas === 'object'
        ? number(object(energy.gas).kWh, 0, 1_000_000)
        : undefined;
    byDate.set(localDate(start, timeZone), {
      date: localDate(start, timeZone),
      electricity:
        offtake === undefined
          ? undefined
          : { consumption: round(offtake), injection: round(injection ?? 0) },
      gas: gas === undefined ? undefined : round(gas),
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The daily electricity consumption of the energy monitoring: `[{ date, kwh }]`. */
export const dailyIntervals = (days) =>
  days.filter((d) => d.electricity).map((d) => ({ date: d.date, kwh: d.electricity.consumption }));

/** The latest day with electricity, and the latest with gas. */
export function lastDays(days) {
  const elec = days.findLast((d) => d.electricity);
  const gas = days.findLast((d) => d.gas !== undefined);
  return {
    electricity: elec ? { date: elec.date, ...elec.electricity } : undefined,
    gas: gas ? { date: gas.date, consumption: gas.gas } : undefined,
  };
}

// --- Billing ---------------------------------------------------------------------------

/** `{ openAmount, nextDue: { date, amount } | undefined }` of an account balance. */
export function balanceOf(json, today) {
  const data = object(json);
  const openAmount = number(object(data.overview).openAmount, -1e6, 1e6);
  let nextDue;
  for (const raw of list(object(data.details).financialTransactions)) {
    const tx = object(raw);
    const amount = number(tx.openAmount, -1e6, 1e6);
    const date = dateOf(tx.dueDate);
    if (!amount || amount <= 0 || !date || date < today) continue;
    if (!nextDue || date < nextDue.date) nextDue = { date, amount: round(amount, 2) };
  }
  return {
    openAmount: openAmount === undefined ? undefined : round(openAmount, 2),
    nextDue,
  };
}

/** `{ amount, nextDate }` of the budget billing plan (the advance invoices). */
export function planOf(json) {
  const plan = object(object(json).budgetBillingPlan);
  const amount = number(plan.currentAmount, 0, 1e5) ?? number(plan.monthlyAmount, 0, 1e5);
  return {
    amount: amount === undefined ? undefined : round(amount, 2),
    nextDate: dateOf(plan.nextPartialInvoiceDate),
  };
}
