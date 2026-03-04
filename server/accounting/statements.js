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
