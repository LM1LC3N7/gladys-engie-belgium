// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/** Where the daily electricity consumption goes. */
export const CONSUMPTION = {
  /** The Gladys energy monitoring (publishEnergyConsumption). */
  ENERGY_MONITORING: 'energy_monitoring',
  /** Only the plain "last published day" sensor (another integration feeds the monitoring). */
  SENSOR_ONLY: 'sensor_only',
};

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  consumption: CONSUMPTION.ENERGY_MONITORING,
};

/** A short hash of the e-mail: the account a session belongs to, without the e-mail itself. */
export const accountKey = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

export function normalizeConfig(raw = {}) {
  const email = typeof raw?.email === 'string' ? raw.email.trim() : '';
  return {
    email,
    // A password is taken as typed: spaces may belong to it.
    password: typeof raw?.password === 'string' ? raw.password : '',
    account: email ? accountKey(email) : '',
    consumption:
      raw?.consumption === CONSUMPTION.SENSOR_ONLY
        ? CONSUMPTION.SENSOR_ONLY
        : CONSUMPTION.ENERGY_MONITORING,
  };
}
