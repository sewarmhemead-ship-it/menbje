/**
 * Multi-currency – exchange rates and converted amounts.
 * Live SYP fetch; Fractioning uses rate for price display in SYP.
 */

import { store } from '../../config/store.js';

const defaultRates = { USD: 1, EUR: 1.08, SYP: 0.0004, TRY: 0.029, GOLD: 0.00002 };

export function getRates() {
  const rates = store.exchangeRates;
  if (rates.size) {
    return Object.fromEntries(rates);
  }
  return { ...defaultRates };
}

export function setRate(currency, rateToBase) {
  store.exchangeRates.set(currency, Number(rateToBase));
  return getRates();
}

/**
 * Fetch SYP rate in real-time (1 USD = X SYP). Uses public API; falls back to stored/default.
 */
export async function fetchSYPRate() {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('Rate fetch failed');
    const data = await res.json();
    const syp = data.rates?.SYP;
    if (syp != null && typeof syp === 'number') {
      store.exchangeRates.set('SYP', 1 / syp);
      return { SYP: 1 / syp, oneUsdInSYP: syp };
    }
  } catch (e) {
    console.warn('[Multi-currency] SYP fetch failed, using stored:', e.message);
  }
  const current = store.exchangeRates.get('SYP') ?? defaultRates.SYP;
  return { SYP: current, oneUsdInSYP: 1 / current };
}

export function convert(amount, fromCurrency, toCurrency = 'USD') {
  const rates = getRates();
  const from = rates[fromCurrency] ?? 1;
  const to = rates[toCurrency] ?? 1;
  return (amount / from) * to;
}
