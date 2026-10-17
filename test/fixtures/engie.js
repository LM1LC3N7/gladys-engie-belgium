// -----------------------------------------------------------------------------
// Synthetic ENGIE answers, shaped after the fixtures of aioengiebelgium
// (customer_account_relations_sample.json, energy_contracts_fixed_dual_fuel.json,
// prices_sample.json, usage_details_daily.json, billing_open_debit.json,
// budget_billing_plan_monthly.json). Made-up numbers, no real account.
// -----------------------------------------------------------------------------

import { addDays, localDate } from '../../src/engie/model.js';

export const EMAIL = 'me@example.be';
export const PASSWORD = 'pa ss&word=1';
export const CODE = '123456';
export const BAN = '000000000001';
export const ELEC_EAN = '541448820000000001';
export const GAS_EAN = '541448820000000002';
const DAY = 24 * 60 * 60_000;

export const RELATIONS = {
  items: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      admin: true,
      customerAccount: {
        customerAccountNumber: '1500000001',
        segment: 'RESIDENTIAL',
        name: 'Test Customer',
        businessAgreements: [
          {
            businessAgreementNumber: BAN,
            active: true,
            consumptionAddress: { postalCode: '1000', city: 'BRUSSELS' },
            electricityContract: { hasSmartMeter: true, active: true, hasSolar: true },
            gasContract: { hasSmartMeter: true, active: true },
          },
          {
            businessAgreementNumber: '000000000009',
            active: false,
            electricityContract: { active: false },
          },
        ],
      },
    },
  ],
};

export const CONTRACTS = {
  items: [
    {
      businessAgreementNumber: BAN,
      servicePointNumber: `${ELEC_EAN}_ID1`,
      division: 'ELECTRICITY',
      status: 'ACTIVE',
      productConfiguration: { energyProduct: 'EASY', type: 'INDEXED' },
    },
    {
      businessAgreementNumber: BAN,
      servicePointNumber: `${GAS_EAN}_ID2`,
      division: 'GAS',
      status: 'ACTIVE',
      productConfiguration: { energyProduct: 'EASY', type: 'INDEXED' },
    },
  ],
};

export const PRICES = {
  items: [
    {
      ean: `${ELEC_EAN}_ID1`,
      prices: [
        {
          from: '2000-01-01',
          to: '2001-01-01',
          vatTariff: 6.0,
          proportionalPriceConfigurations: {
            offtake: [{ timeOfUseSlotCode: 'TOTAL_HOURS', priceValue: 9, priceValueExclVAT: 9 }],
          },
        },
        {
          from: '2001-01-01',
          to: '2099-12-31',
          vatTariff: 6.0,
          proportionalPriceConfigurations: {
            offtake: [
              {
                timeOfUseSlotCode: 'TOTAL_HOURS',
                priceValue: 0.123456,
                priceValueExclVAT: 0.116468,
              },
              {
                timeOfUseSlotCode: 'S_TOU1_OFFTAKE_PEAK',
                priceValue: 0.18,
                priceValueExclVAT: 0.169811,
              },
              {
                timeOfUseSlotCode: 'S_TOU1_OFFTAKE_OFFPEAK',
                priceValue: 0.09,
                priceValueExclVAT: 0.084906,
              },
              { timeOfUseSlotCode: 'EN', priceValue: 0.1, priceValueExclVAT: 0.09434 },
            ],
            injection: [
              { timeOfUseSlotCode: 'TOTAL_HOURS', priceValue: 0.05, priceValueExclVAT: 0.04717 },
            ],
          },
        },
      ],
    },
    {
      ean: `${GAS_EAN}_ID2`,
      prices: [
        {
          from: '2000-01-01',
          to: '2099-12-31',
          vatTariff: 6.0,
          proportionalPriceConfigurations: {
            offtake: [
              { timeOfUseSlotCode: 'TOTAL_HOURS', priceValue: 0.045, priceValueExclVAT: 0.042453 },
            ],
          },
        },
      ],
    },
  ],
};

/** The daily usage of the 7 local days before `now`, plus today (running) and a partial day. */
export function usage(now) {
  const today = localDate(now, 'Europe/Brussels');
  const items = [];
  for (let i = 7; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    items.push({
      start: `${date}T00:00:00+01:00`,
      end: `${addDays(date, 1)}T00:00:00+01:00`,
      partialData: i === 0 || i === 1,
      energy: {
        electricity: {
          injection: { kWhSum: 1 + i / 10 },
          netto: 0,
          offtake: { kWhSum: 10 + i },
        },
        gas: { kWh: 20 + i },
      },
    });
  }
  return { items, total: {} };
}

/** The dates of the complete days of `usage(now)` (today and yesterday are partial). */
export const completeDates = (now) => {
  const today = localDate(now, 'Europe/Brussels');
  return [7, 6, 5, 4, 3, 2].map((i) => addDays(today, -i));
};

export const BALANCE = {
  status: 'OPEN_DEBIT',
  details: {
    pendingOnlinePayments: [],
    financialTransactions: [
      {
        type: 'INVOICE',
        dueAmount: 0,
        openAmount: 80.6,
        dueDate: '2099-07-22',
        invoiceType: 'PERIODIC_INVOICE',
      },
      {
        type: 'INVOICE',
        dueAmount: 0,
        openAmount: 12,
        dueDate: '2000-01-01',
        invoiceType: 'PERIODIC_INVOICE',
      },
    ],
    invoiceStructuredCommunication: '000000000000',
  },
  overview: {
    totalAmount: 80.6,
    openAmount: 80.6,
    dueAmount: 0,
    pendingOnlinePaymentsAmount: 0,
    installmentPlanAmount: 0,
  },
  refundBlocked: 'false',
};

export const PLAN = {
  businessAgreementId: BAN,
  budgetBillingPlanUpdatable: true,
  budgetBillingPlan: {
    currentAmount: 62.0,
    billingCycle: 'MONTHLY',
    remainingSlices: 1,
    amountPaid: 620.0,
    billingCycleTotal: 682.0,
    monthlyAmount: 62.0,
    nextPartialInvoiceDate: '2099-10-11',
    paymentSlices: [{ date: '2024-01-01', status: 'PAID' }],
  },
};

export { DAY };
