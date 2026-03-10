/**
 * موديول التقارير المالية: أعمار الديون، كشف حساب (حسب العميل أو حسب الحساب)، مع ربط بيانات الهوية من settings.
 * يستبعد القيود المحذوفة (deleted: true). جميع المبالغ المالية تُقرّب بـ roundCost.
 */

import { store } from '../config/store.js';
import * as statements from './statements.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';
import { getSettings } from '../config/settings.js';
import * as valuation from '../currency/valuation.js';
import { ACCOUNT_TYPE } from './chartOfAccounts.js';

const { journalEntriesList, accounts, salesInvoices } = store;

// حسابات التصنيفات للـ Financial Summary
const REVENUE_CODE_PREFIX = '4';       // الفئة 4 (المبيعات والإيرادات)
const COGS_ACCOUNT_IDS = new Set(['5000', '5100']);  // تكلفة المبيعات (يغذيها FIFO)
const EXPENSE_ACCOUNT_IDS = new Set(['5400', '5500', '5600']); // رواتب، إيجار، كهرباء
const INVENTORY_LOSS_ACCOUNT = '5210'; // عجز مخزون (خسائر الجرد)

const DEBTORS = '1200';

const DECIMALS = 2;
function roundCost(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Number(Number(value).toFixed(DECIMALS));
}

/**
 * استخراج المبلغ بالليرة من قيد مركب (مجموع المدين).
 */
function getCompoundEntryAmountSYP(entry) {
  if (!entry.compoundLines || !entry.compoundLines.length) return 0;
  return entry.compoundLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
}

/**
 * تقرير أعمار الديون (Aging Report): تصنيف ديون حساب المدينين (0-30، 31-60، 61-90، +90 يوم).
 * لكل فئة: القيمة بالليرة، القيمة بالدولار وقت النشأة، والقيمة الآن لإظهار خسارة القوة الشرائية.
 * يستبعد القيود المحذوفة.
 */
export function getAgingReport(asOfDate = null) {
  const now = asOfDate ? new Date(asOfDate) : new Date();
  const list = (journalEntriesList || []).filter((e) => !e.deleted);

  const buckets = {
    '0-30': { amountSYP: 0, amountUSDAtTx: 0, amountUSDNow: 0, count: 0 },
    '31-60': { amountSYP: 0, amountUSDAtTx: 0, amountUSDNow: 0, count: 0 },
    '61-90': { amountSYP: 0, amountUSDAtTx: 0, amountUSDNow: 0, count: 0 },
    '90+': { amountSYP: 0, amountUSDAtTx: 0, amountUSDNow: 0, count: 0 },
  };

  const rateNow = multiCurrency.getRates().SYP;

  for (const e of list) {
    let amountSYP = 0;
    if (e.compoundLines) {
      for (const line of e.compoundLines) {
        if (line.accountId === DEBTORS) amountSYP += (line.debit || 0) - (line.credit || 0);
      }
    } else {
      if (e.debitAccountId === DEBTORS) amountSYP += e.amountSYP || 0;
      if (e.creditAccountId === DEBTORS) amountSYP -= e.amountSYP || 0;
    }
    if (amountSYP <= 0) continue;

    const entryDate = e.date ? new Date(e.date) : now;
    const days = Math.floor((now - entryDate) / (24 * 60 * 60 * 1000));

    let bucket;
    if (days <= 30) bucket = '0-30';
    else if (days <= 60) bucket = '31-60';
    else if (days <= 90) bucket = '61-90';
    else bucket = '90+';

    const totalEntrySYP = e.compoundLines ? getCompoundEntryAmountSYP(e) : (e.amountSYP || 0);
    const prorate = totalEntrySYP !== 0 ? amountSYP / totalEntrySYP : 1;
    const usdAtTx = e.amountUSDAtTx != null ? (e.amountUSDAtTx * prorate) : null;
    const usdNow = rateNow != null && rateNow !== 0 ? amountSYP * rateNow : null;

    buckets[bucket].amountSYP += amountSYP;
    if (usdAtTx != null) buckets[bucket].amountUSDAtTx += usdAtTx;
    if (usdNow != null) buckets[bucket].amountUSDNow += usdNow;
    buckets[bucket].count += 1;
  }

  const summary = {};
  const oneUsdInSYP = rateNow != null && rateNow !== 0 ? 1 / rateNow : null;
  for (const [key, v] of Object.entries(buckets)) {
    const lossUSD = (v.amountUSDAtTx != null && v.amountUSDNow != null) ? (v.amountUSDNow - v.amountUSDAtTx) : null;
    const purchasingPowerLossSYP = (lossUSD != null && oneUsdInSYP != null) ? lossUSD * oneUsdInSYP : 0;
    summary[key] = {
      amountSYP: roundCost(v.amountSYP),
      amountUSDAtTx: roundCost(v.amountUSDAtTx),
      amountUSDNow: roundCost(v.amountUSDNow),
      purchasingPowerLossSYP: roundCost(purchasingPowerLossSYP),
      count: v.count,
    };
  }

  const totalSYP = Object.values(buckets).reduce((s, v) => s + v.amountSYP, 0);
  return {
    asOfDate: now.toISOString(),
    debtorAccountId: DEBTORS,
    buckets: summary,
    totalAmountSYP: roundCost(totalSYP),
  };
}

/**
 * كشف حساب تفصيلي يربط كل قيد برقم الفاتورة (refId).
 * يستبعد القيود المحذوفة. المبالغ مقرّبة.
 */
export function getAccountStatement(accountId, fromDate = null, toDate = null) {
  const result = statements.getAccountStatement(accountId, fromDate, toDate);
  if (result.error) return { success: false, error: result.error };

  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  const byId = new Map(list.map((e) => [e.id, e]));

  const rows = (result.rows || []).map((row) => {
    const entry = byId.get(row.entryId);
    return {
      ...row,
      debit: roundCost(row.debit),
      credit: roundCost(row.credit),
      balance: roundCost(row.balance),
      refId: entry?.refId ?? null,
    };
  });

  return {
    ...result,
    rows,
    openingBalance: roundCost(result.openingBalance),
    closingBalance: roundCost(result.closingBalance),
  };
}

/**
 * كشف حساب للعميل (customerId): حركات مدينون المرتبطة بفواتيره، مع ترويسة هوية الشركة من الإعدادات.
 * الخرج: header (اسم الشركة، اللوغو، العنوان، الهاتف) و data (الحركات المنسقة، رصيد افتتاحي/ختامي).
 */
export function generateAccountStatement(customerId, fromDate = null, toDate = null) {
  const settings = getSettings();
  const branding = settings.branding || {};
  const header = {
    companyName: branding.companyName || 'الشركة',
    logoBase64: branding.logoBase64 || null,
    address: branding.companyAddress || '',
    phone: branding.companyPhone || '',
    primaryColor: branding.primaryColor || '#10b981',
  };

  const invoiceIds = (salesInvoices || [])
    .filter((inv) => String(inv.customerId || '') === String(customerId))
    .map((inv) => inv.id);
  if (invoiceIds.length === 0) {
    return {
      header,
      data: {
        customerId,
        movements: [],
        openingBalance: 0,
        closingBalance: 0,
        message: 'لا توجد فواتير لهذا العميل',
      },
    };
  }

  const refIds = new Set(invoiceIds);
  const list = (journalEntriesList || []).filter((e) => !e.deleted && refIds.has(e.refId));

  const relevant = list.filter((e) => {
    if (e.compoundLines) return e.compoundLines.some((l) => l.accountId === DEBTORS);
    return e.debitAccountId === DEBTORS || e.creditAccountId === DEBTORS;
  });

  let filtered = relevant;
  if (fromDate) filtered = filtered.filter((e) => e.date >= fromDate);
  if (toDate) filtered = filtered.filter((e) => e.date <= toDate);
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  const beforeFrom = fromDate ? relevant.filter((e) => e.date < fromDate) : [];
  let openingBalance = 0;
  for (const e of beforeFrom) {
    if (e.compoundLines) {
      for (const line of e.compoundLines) {
        if (line.accountId === DEBTORS) openingBalance += (line.debit || 0) - (line.credit || 0);
      }
    } else {
      if (e.debitAccountId === DEBTORS) openingBalance += e.amountSYP || 0;
      if (e.creditAccountId === DEBTORS) openingBalance -= e.amountSYP || 0;
    }
  }

  const movements = [];
  let running = openingBalance;
  for (const e of filtered) {
    let debit = 0;
    let credit = 0;
    if (e.compoundLines) {
      for (const line of e.compoundLines) {
        if (line.accountId === DEBTORS) {
          debit += line.debit || 0;
          credit += line.credit || 0;
        }
      }
    } else {
      if (e.debitAccountId === DEBTORS) debit = e.amountSYP || 0;
      if (e.creditAccountId === DEBTORS) credit = e.amountSYP || 0;
    }
    running += debit - credit;
    movements.push({
      date: e.date,
      memo: e.memo || '',
      refId: e.refId || null,
      debit: roundCost(debit),
      credit: roundCost(credit),
      balance: roundCost(running),
      entryId: e.id,
    });
  }

  const data = {
    customerId,
    accountId: DEBTORS,
    fromDate: fromDate || null,
    toDate: toDate || null,
    openingBalance: roundCost(openingBalance),
    closingBalance: roundCost(running),
    movements,
  };

  return { header, data };
}

/**
 * ملخص مالي لفترة (الإيرادات - التكاليف - المصاريف = صافي الربح).
 * Sales: مجموع الدائن في حسابات الفئة 4 ناقصاً المدين (المرتجعات).
 * COGS: مجموع المدين في حسابات تكلفة المبيعات (5000, 5100).
 * Expenses: مجموع المدين في المصاريف التشغيلية (رواتب، إيجار، كهرباء: 5400, 5500, 5600).
 * Inventory Loss: مدين حساب 5210 (عجز مخزون).
 * FX Gains/Loss: من valuation (الفرق بين amountUSDAtTx والقيمة الحالية للديون/المخزون في الفترة).
 */
export function getFinancialSummary(startDate, endDate) {
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  let sales = 0;
  let cogs = 0;
  let expenses = 0;
  let inventoryLoss = 0;

  for (const e of list) {
    if (startDate && e.date < startDate) continue;
    if (endDate && e.date > endDate) continue;

    if (e.compoundLines) {
      for (const line of e.compoundLines) {
        const acc = accounts.get(line.accountId);
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        if (acc?.type === ACCOUNT_TYPE.REVENUE && (acc.code || '').toString().startsWith(REVENUE_CODE_PREFIX)) {
          sales += credit - debit;
        }
        if (COGS_ACCOUNT_IDS.has(line.accountId)) cogs += debit;
        if (EXPENSE_ACCOUNT_IDS.has(line.accountId)) expenses += debit;
        if (line.accountId === INVENTORY_LOSS_ACCOUNT) inventoryLoss += debit;
      }
    } else {
      const amt = e.amountSYP || 0;
      const drAcc = accounts.get(e.debitAccountId);
      const crAcc = accounts.get(e.creditAccountId);
      if (drAcc?.type === ACCOUNT_TYPE.REVENUE && (drAcc.code || '').toString().startsWith(REVENUE_CODE_PREFIX)) sales -= amt;
      if (crAcc?.type === ACCOUNT_TYPE.REVENUE && (crAcc.code || '').toString().startsWith(REVENUE_CODE_PREFIX)) sales += amt;
      if (COGS_ACCOUNT_IDS.has(e.debitAccountId)) cogs += amt;
      if (EXPENSE_ACCOUNT_IDS.has(e.debitAccountId)) expenses += amt;
      if (e.debitAccountId === INVENTORY_LOSS_ACCOUNT) inventoryLoss += amt;
    }
  }

  const fxReport = valuation.getExchangeGainLossReport(startDate || null, endDate || null);
  const fxGainsLoss = fxReport.totalGainLossSYP ?? 0;

  const grossProfit = sales - cogs;
  const netProfit = grossProfit - expenses - inventoryLoss + fxGainsLoss;

  const rates = multiCurrency.getRates();
  const rateSYP = rates.SYP != null && rates.SYP !== 0 ? Number(rates.SYP) : 1 / 15000;
  const currentExchangeRate = 1 / rateSYP; // 1 USD = currentExchangeRate SYP
  const netProfitUSD = currentExchangeRate !== 0 ? netProfit / currentExchangeRate : 0;

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    sales: roundCost(sales),
    cogs: roundCost(cogs),
    grossProfit: roundCost(grossProfit),
    expenses: roundCost(expenses),
    inventoryLoss: roundCost(inventoryLoss),
    fxGainsLoss: roundCost(fxGainsLoss),
    netProfit: roundCost(netProfit),
    netProfitUSD: roundCost(netProfitUSD),
    currentExchangeRate: roundCost(currentExchangeRate),
    fxDetails: fxReport.details ? fxReport.details.slice(0, 50) : [],
  };
}
