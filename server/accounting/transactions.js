/**
 * Transaction posting: every Sale, Purchase, Barter posts double-entry.
 * Account IDs from chartOfAccounts (1100 Inventory, 1010 Cash SYP, 4000 Revenue, 5000 COGS, etc.).
 */

import { store } from '../config/store.js';
import * as journal from './journal.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';

const CASH_SYP = '1010';
const INVENTORY = '1100';
const DEBTORS = '1200';
const REVENUE = '4000';
const COGS = '5000';
const BARTER_CLEARING = '2100';

function getValuationAtTx(amountSYP) {
  const rates = multiCurrency.getRates();
  return {
    amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? amountSYP * rates.SYP : null,
    amountGoldAtTx: rates.GOLD != null && rates.GOLD !== 0 ? amountSYP * rates.GOLD : null,
  };
}

/**
 * Convert amount to SYP using rate (rate = SYP per 1 foreign unit, or if rateToBase then amountSYP = amount / rate).
 */
function toSYP(amount, currencyId) {
  const rates = multiCurrency.getRates();
  if (currencyId === 'SYP' || !currencyId) return amount;
  const rate = rates[currencyId];
  if (rate == null || rate === 0) return amount;
  return amount / rate;
}

/**
 * Post journal for a sale: Dr Cash, Cr Revenue; Dr COGS, Cr Inventory.
 * amountSYP = revenue in SYP, cogsSYP = cost of goods sold.
 */
export function postSaleJournal(amountSYP, cogsSYP, opts = {}) {
  const { refId, memo, amountUSDAtTx, amountGoldAtTx, createdBy } = opts;
  const v = getValuationAtTx(amountSYP);
  const entries = [];

  const r1 = journal.postDoubleEntry(CASH_SYP, REVENUE, amountSYP, {
    refType: 'sale',
    refId,
    memo: memo || 'Sale revenue',
    amountUSDAtTx: amountUSDAtTx ?? v.amountUSDAtTx,
    amountGoldAtTx: amountGoldAtTx ?? v.amountGoldAtTx,
    createdBy,
  });
  if (!r1.success) return r1;
  entries.push(r1.entry);

  if (cogsSYP > 0) {
    const r2 = journal.postDoubleEntry(COGS, INVENTORY, cogsSYP, {
      refType: 'sale',
      refId,
      memo: 'COGS',
      createdBy,
    });
    if (!r2.success) return r2;
    entries.push(r2.entry);
  }

  return { success: true, entries };
}

/**
 * Post barter: swap inventory; if values differ, balance with Cash in SYP.
 * Dr Inventory (received), Cr Barter clearing; Dr Barter clearing, Cr Inventory (given).
 * If valueReceived > valueGiven: Dr Cash (valueReceived - valueGiven). If valueGiven > valueReceived: Cr Cash.
 */
export function postBarterJournal(valueReceivedSYP, valueGivenSYP, opts = {}) {
  const { refId, memo, createdBy } = opts;
  const entries = [];
  const common = Math.min(valueReceivedSYP, valueGivenSYP);

  if (common > 0) {
    const r1 = journal.postDoubleEntry(INVENTORY, BARTER_CLEARING, common, {
      refType: 'barter',
      refId,
      memo: memo || 'Barter: inventory received',
      ...getValuationAtTx(common),
      createdBy,
    });
    if (!r1.success) return r1;
    entries.push(r1.entry);
    const r2 = journal.postDoubleEntry(BARTER_CLEARING, INVENTORY, common, {
      refType: 'barter',
      refId,
      memo: 'Barter: inventory given',
      createdBy,
    });
    if (!r2.success) return r2;
    entries.push(r2.entry);
  }

  const diff = valueReceivedSYP - valueGivenSYP;
  if (diff > 0) {
    const r3 = journal.postDoubleEntry(CASH_SYP, BARTER_CLEARING, diff, {
      refType: 'barter',
      refId,
      memo: 'Barter: cash top-up received',
      ...getValuationAtTx(diff),
      createdBy,
    });
    if (r3.success) entries.push(r3.entry);
  } else if (diff < 0) {
    const r3 = journal.postDoubleEntry(BARTER_CLEARING, CASH_SYP, -diff, {
      refType: 'barter',
      refId,
      memo: 'Barter: cash top-up paid',
      ...getValuationAtTx(-diff),
      createdBy,
    });
    if (r3.success) entries.push(r3.entry);
  }

  return { success: true, entries };
}

/**
 * Post purchase: Dr Inventory, Cr Cash. Stores SYP, USD, Gold at tx.
 */
export function postPurchaseJournal(amountSYP, opts = {}) {
  const { refId, memo, createdBy } = opts;
  const v = getValuationAtTx(amountSYP);
  const r = journal.postDoubleEntry(INVENTORY, CASH_SYP, amountSYP, {
    refType: 'purchase',
    refId,
    memo: memo || 'Inventory purchase',
    amountUSDAtTx: v.amountUSDAtTx,
    amountGoldAtTx: v.amountGoldAtTx,
    createdBy,
  });
  return r;
}

/**
 * Post debt: Dr Debtors (1200), Cr Revenue (or Cash if loan). Records in debt ledger with gold at tx.
 */
export function postDebtJournal(amountSYP, opts = {}) {
  const { refId, memo, createdBy, isLoan } = opts;
  const v = getValuationAtTx(amountSYP);
  const r = journal.postDoubleEntry(
    DEBTORS,
    isLoan ? CASH_SYP : REVENUE,
    amountSYP,
    {
      refType: 'debt',
      refId,
      memo: memo || 'Debt / Receivable',
      amountUSDAtTx: v.amountUSDAtTx,
      amountGoldAtTx: v.amountGoldAtTx,
      createdBy,
    }
  );
  return r;
}
