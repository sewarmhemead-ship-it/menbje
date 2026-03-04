/**
 * Multi-Currency 'Ghost' Layer.
 * Every transaction stores: amountSYP, amountUSD/Gold at tx time.
 * Real-time valuation and Exchange Gain/Loss report.
 */

import { store } from '../config/store.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';

const { journalEntriesList, exchangeRates } = store;

/**
 * Get current valuation of an amount in SYP to USD (and optionally gold).
 */
export function getCurrentValuation(amountSYP) {
  const rates = multiCurrency.getRates();
  const sypPerUsd = rates.SYP != null && rates.SYP !== 0 ? 1 / rates.SYP : null;
  const usd = sypPerUsd != null ? amountSYP * rates.SYP : null;
  return { amountSYP, amountUSD: usd, rateUsed: rates.SYP };
}

/**
 * Re-value a past transaction at current rates.
 * Returns { amountSYP, amountUSDAtTx, amountUSDNow, unrealizedGainLossSYP }.
 */
export function revalueAtCurrent(entry) {
  const amountSYP = entry.amountSYP || 0;
  const usdAtTx = entry.amountUSDAtTx;
  const rates = multiCurrency.getRates();
  const sypRate = rates.SYP;
  const usdNow = sypRate != null && sypRate !== 0 ? amountSYP * sypRate : null;
  const gainLossSYP = usdAtTx != null && usdNow != null ? (usdNow - usdAtTx) / sypRate : null;
  return {
    amountSYP,
    amountUSDAtTx: usdAtTx,
    amountUSDNow: usdNow,
    unrealizedGainLossSYP: gainLossSYP,
  };
}

/**
 * Exchange Gain/Loss report: sum of (current USD value - tx USD value) for all journal lines in period.
 * Positive = gain (we hold assets that appreciated in USD terms).
 */
export function getExchangeGainLossReport(fromDate, toDate) {
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  let totalGainLossSYP = 0;
  const details = [];

  for (const e of list) {
    if (fromDate && e.date < fromDate) continue;
    if (toDate && e.date > toDate) continue;
    const v = revalueAtCurrent(e);
    if (v.unrealizedGainLossSYP != null) {
      totalGainLossSYP += v.unrealizedGainLossSYP;
      details.push({
        entryId: e.id,
        date: e.date,
        amountSYP: e.amountSYP,
        amountUSDAtTx: e.amountUSDAtTx,
        amountUSDNow: v.amountUSDNow,
        gainLossSYP: v.unrealizedGainLossSYP,
      });
    }
  }

  return {
    fromDate: fromDate || null,
    toDate: toDate || null,
    totalGainLossSYP,
    totalGainLossUSD: multiCurrency.getRates().SYP != null
      ? totalGainLossSYP * multiCurrency.getRates().SYP
      : null,
    details,
  };
}
