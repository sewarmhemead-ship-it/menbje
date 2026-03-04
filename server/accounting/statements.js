/**
 * Automated Financial Statements (ميزان مراجعة، قائمة الأرباح والخسائر، التدفقات النقدية).
 * Trial Balance, Profit & Loss, Statement of Cash Flows.
 */

import { store } from '../config/store.js';
import * as journal from './journal.js';
import { ACCOUNT_TYPE } from './chartOfAccounts.js';
import * as valuation from '../currency/valuation.js';

const { accounts, journalEntriesList } = store;

/**
 * Trial Balance (ميزان مراجعة): all accounts with total Debits and total Credits.
 */
export function getTrialBalance(asOfDate = null) {
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  const byAccount = new Map();

  for (const [id, acc] of accounts) {
    byAccount.set(id, {
      id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      debit: 0,
      credit: 0,
    });
  }

  for (const e of list) {
    if (asOfDate && e.date > asOfDate) continue;
    const amt = e.amountSYP || 0;
    const dr = byAccount.get(e.debitAccountId);
    const cr = byAccount.get(e.creditAccountId);
    if (dr) dr.debit += amt;
    if (cr) cr.credit += amt;
  }

  const rows = Array.from(byAccount.values()).filter((r) => r.debit !== 0 || r.credit !== 0);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return {
    asOfDate: asOfDate || new Date().toISOString(),
    rows,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

/**
 * Profit & Loss (قائمة الأرباح والخسائر): Revenue - Expenses for period.
 * Includes Exchange Gain/Loss for 'True Profit' (purchasing power).
 */
export function getProfitAndLoss(fromDate, toDate) {
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  let revenue = 0;
  let expenses = 0;

  for (const e of list) {
    if (fromDate && e.date < fromDate) continue;
    if (toDate && e.date > toDate) continue;
    const amt = e.amountSYP || 0;
    const drAcc = accounts.get(e.debitAccountId);
    const crAcc = accounts.get(e.creditAccountId);
    if (drAcc?.type === ACCOUNT_TYPE.REVENUE) revenue -= amt;
    if (crAcc?.type === ACCOUNT_TYPE.REVENUE) revenue += amt;
    if (drAcc?.type === ACCOUNT_TYPE.EXPENSE) expenses += amt;
    if (crAcc?.type === ACCOUNT_TYPE.EXPENSE) expenses -= amt;
  }

  const grossProfit = revenue - expenses;
  const fxReport = valuation.getExchangeGainLossReport(fromDate, toDate);
  const trueProfit = grossProfit + (fxReport.totalGainLossSYP || 0);

  return {
    fromDate: fromDate || null,
    toDate: toDate || null,
    revenue,
    expenses,
    grossProfit,
    exchangeGainLossSYP: fxReport.totalGainLossSYP ?? 0,
    trueProfit,
  };
}

/**
 * Statement of Cash Flows: Operating (from P&L + working capital), Investing, Financing.
 * Simplified: Operating = net change in Cash from operations (Cash debits - Cash credits).
 */
export function getCashFlowStatement(fromDate, toDate) {
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  const CASH = '1010';
  let operatingIn = 0;
  let operatingOut = 0;

  for (const e of list) {
    if (fromDate && e.date < fromDate) continue;
    if (toDate && e.date > toDate) continue;
    const amt = e.amountSYP || 0;
    if (e.debitAccountId === CASH) operatingIn += amt;
    if (e.creditAccountId === CASH) operatingOut += amt;
  }

  const netOperating = operatingIn - operatingOut;

  return {
    fromDate: fromDate || null,
    toDate: toDate || null,
    operating: {
      inflows: operatingIn,
      outflows: operatingOut,
      net: netOperating,
    },
    investing: { inflows: 0, outflows: 0, net: 0 },
    financing: { inflows: 0, outflows: 0, net: 0 },
    netChangeInCash: netOperating,
  };
}

/**
 * كشف الحساب (Statement of Account): حركات حساب مع الرصيد الجاري.
 * Returns: { accountId, accountName, rows: [{ date, memo, debit, credit, balance }], openingBalance, closingBalance }
 */
export function getAccountStatement(accountId, fromDate = null, toDate = null) {
  if (!accounts.has(accountId))
    return { success: false, error: 'الحساب غير موجود' };
  const acc = accounts.get(accountId);
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  const relevant = list.filter(
    (e) => (e.debitAccountId === accountId || e.creditAccountId === accountId)
  );
  const beforeFrom = fromDate ? relevant.filter((e) => e.date < fromDate) : [];
  let openingBalance = 0;
  for (const e of beforeFrom) {
    if (e.debitAccountId === accountId) openingBalance += e.amountSYP || 0;
    if (e.creditAccountId === accountId) openingBalance -= e.amountSYP || 0;
  }
  let filtered = relevant;
  if (fromDate) filtered = filtered.filter((e) => e.date >= fromDate);
  if (toDate) filtered = filtered.filter((e) => e.date <= toDate);
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  const rows = [];
  let running = openingBalance;
  for (const e of filtered) {
    const debit = e.debitAccountId === accountId ? (e.amountSYP || 0) : 0;
    const credit = e.creditAccountId === accountId ? (e.amountSYP || 0) : 0;
    running += debit - credit;
    rows.push({
      date: e.date,
      memo: e.memo || '',
      debit,
      credit,
      balance: running,
      entryId: e.id,
    });
  }
  return {
    accountId,
    accountCode: acc.code,
    accountName: acc.name,
    fromDate: fromDate || null,
    toDate: toDate || null,
    openingBalance,
    closingBalance: running,
    rows,
  };
}

/**
 * Balance Sheet (الميزانية العمومية): Assets, Liabilities, Equity as of date.
 */
export function getBalanceSheet(asOfDate = null) {
  const tb = getTrialBalance(asOfDate);
  const byType = { asset: [], liability: [], equity: [] };
  for (const row of tb.rows) {
    const acc = accounts.get(row.id);
    if (!acc || !acc.type) continue;
    if (acc.type === ACCOUNT_TYPE.ASSET) byType.asset.push(row);
    else if (acc.type === ACCOUNT_TYPE.LIABILITY) byType.liability.push(row);
    else if (acc.type === ACCOUNT_TYPE.EQUITY) byType.equity.push(row);
  }
  const totalAssets = byType.asset.reduce((s, r) => s + (r.debit - r.credit), 0);
  const totalLiabilities = byType.liability.reduce((s, r) => s + (r.credit - r.debit), 0);
  const totalEquity = byType.equity.reduce((s, r) => s + (r.credit - r.debit), 0);
  return {
    asOfDate: asOfDate || new Date().toISOString(),
    assets: { rows: byType.asset, total: totalAssets },
    liabilities: { rows: byType.liability, total: totalLiabilities },
    equity: { rows: byType.equity, total: totalEquity },
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

/**
 * Warehouse Inventory Valuation (جرد المستودع): total value by Cost Price and by sub-units.
 * Uses inventoryByProduct + inventoryLots (FIFO) for cost; optional fractioning for sub-unit view.
 */
export function getWarehouseValuation() {
  const { inventoryByProduct, inventoryLots, products, units } = store;
  const byProductUnit = [];
  let totalValueCost = 0;
  let totalValueBySubUnits = 0;

  const keys = new Set();
  for (const [key] of inventoryByProduct) keys.add(key);
  for (const lot of inventoryLots || []) {
    if (lot.remaining > 0) keys.add(`${lot.productId}:${lot.unitId}`);
  }

  for (const key of keys) {
    const [productId, unitId] = key.split(':');
    const agg = inventoryByProduct.get(key) || { productId, unitId, quantity: 0 };
    const qty = agg.quantity || 0;
    if (qty <= 0) continue;

    const product = products?.get?.(productId) || {};
    const unit = units?.get?.(unitId) || {};
    const lots = (inventoryLots || []).filter(
      (l) => l.productId === productId && l.unitId === unitId && l.remaining > 0
    );
    let valueCost = 0;
    let remaining = qty;
    for (const l of lots.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt))) {
      const take = Math.min(l.remaining, remaining);
      valueCost += take * (l.unitCostSYP || 0);
      remaining -= take;
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      const defaultCost = product.costPerDefaultUnit ?? 0;
      valueCost += remaining * defaultCost;
    }
    totalValueCost += valueCost;
    byProductUnit.push({
      productId,
      productName: product.name || productId,
      unitId,
      unitName: unit.name || unitId,
      quantity: qty,
      valueCostSYP: valueCost,
    });
  }

  return {
    asOfDate: new Date().toISOString(),
    rows: byProductUnit,
    totalValueCostSYP: totalValueCost,
    totalValueBySubUnitsSYP: totalValueBySubUnits ?? totalValueCost,
  };
}
