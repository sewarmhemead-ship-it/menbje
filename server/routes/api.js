/**
 * Unified API: products, units, fractioning, barter, multi-currency, vision, drafts,
 * accounting (accounts, journal), exchange gain/loss, audit, barter confirm.
 */

import { Router } from 'express';
import { store, getNextId } from '../config/store.js';
import * as fractioning from '../modules/fractioning/engine.js';
import * as barter from '../modules/barter/index.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';
import * as vision from '../modules/vision/index.js';
import * as draftOrdersApi from '../modules/whatsapp/draftOrders.js';
import * as journal from '../accounting/journal.js';
import * as valuation from '../currency/valuation.js';
import * as debtRevaluation from '../currency/debtRevaluation.js';
import * as audit from '../audit/actionLog.js';
import * as statements from '../accounting/statements.js';
import * as debtLedger from '../accounting/debtLedger.js';
import * as vouchers from '../accounting/vouchers.js';
import { postSaleJournal } from '../accounting/transactions.js';
import { recordStockMovement } from '../inventory/stockMovement.js';
import * as fifo from '../inventory/fifo.js';
import * as returns from '../inventory/returns.js';
import * as reconciliation from '../inventory/reconciliation.js';
import * as reports from '../accounting/reports.js';
import * as procurement from '../modules/procurement/index.js';
import * as manufacturing from '../modules/manufacturing/index.js';
import * as expenses from '../modules/expenses/index.js';
import * as backup from '../backup/index.js';
import * as settings from '../config/settings.js';
import * as debtLink from '../modules/debtLink/index.js';
import { optionalAuth, requireAuth, requireSuperAdmin, authorize } from '../auth/middleware.js';
import { voucherReceiptSchema, voucherPaymentSchema, voucherJournalSchema, expenseSchema, validateBody } from '../validation/schemas.js';

const router = Router();
router.use(optionalAuth);
const { products, units, draftOrders, accounts, stockMovements, salesInvoices, salesReturns, users, suppliers } = store;

/** مستخدم "صمام الأمان" — لا يُحذف أبداً (حتى من قبله) لئلا يُقفل النظام على الجميع. */
const SAFETY_ADMIN_USERNAME = 'admin';

function getTenantId(req) {
  return (req.user && req.user.tenantId) || 'default';
}

function requireAdmin(req, res, next) {
  const role = (req.user && req.user.role || '').toUpperCase();
  if (!req.user || (role !== 'ADMIN' && role !== 'SUPER_ADMIN')) {
    return res.status(403).json({ success: false, error: 'صلاحيات غير كافية', code: 'FORBIDDEN' });
  }
  next();
}

/** تقارير وأداء حساسة: لا يصل لها الكاشير (ADMIN و SUPER_ADMIN فقط). */
const requireNoCashier = [requireAuth, authorize('ADMIN', 'SUPER_ADMIN')];

// —— رابط دينك (Public debt link: customer sees balance without login) ——
router.get('/public/debt/:token', (req, res) => {
  try {
    const data = debtLink.getPublicDebt(req.params.token);
    if (!data.success) return res.status(400).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/debt-link/generate', requireAuth, (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { customerId, expiresInHours } = req.body;
    const hours = expiresInHours != null ? Math.min(720, Math.max(1, Number(expiresInHours))) : 168;
    const result = debtLink.generateToken(customerId, tenantId, hours);
    if (!result.success) return res.status(400).json(result);
    const baseUrl = (req.protocol || 'http') + '://' + (req.get('host') || 'localhost:3000');
    result.link = baseUrl + '/dashboard/debt.html?t=' + result.token;
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Global Search (البحث الموحد): أصناف، فواتير، عملاء ——
router.get('/search', (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const tenantId = getTenantId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const productsList = [];
    const invoicesList = [];
    const customersList = [];
    const suppliersList = [];

    if (q.length >= 1) {
      for (const [id, p] of products) {
        if ((p.tenantId || 'default') !== tenantId) continue;
        const name = (p.name || '').toLowerCase();
        const barcode = (p.barcode || '').toString().toLowerCase();
        const sku = (p.sku || '').toString().toLowerCase();
        if (name.includes(q) || barcode.includes(q) || sku.includes(q)) {
          productsList.push({ id: p.id, name: p.name, barcode: p.barcode, sku: p.sku });
          if (productsList.length >= limit) break;
        }
      }

      for (const [id, s] of suppliers) {
        if ((s.tenantId || 'default') !== tenantId) continue;
        const name = (s.name || '').toLowerCase();
        const phone = (s.phone || '').toString().toLowerCase();
        if (name.includes(q) || phone.includes(q)) {
          suppliersList.push({ id: s.id, name: s.name, phone: s.phone });
          if (suppliersList.length >= limit) break;
        }
      }

      const invList = [...salesInvoices].filter((inv) => (inv.tenantId || 'default') === tenantId);
      for (const inv of invList) {
        const id = (inv.id || '').toLowerCase();
        const cust = (inv.customerId || '').toString().toLowerCase();
        if (id.includes(q) || cust.includes(q)) {
          invoicesList.push({ id: inv.id, date: inv.date, customerId: inv.customerId, totalRevenue: inv.totalRevenue });
          if (invoicesList.length >= limit) break;
        }
      }

      const seen = new Set();
      for (const inv of invList) {
        const cust = (inv.customerId || '').toString().trim();
        if (!cust || seen.has(cust)) continue;
        if (cust.toLowerCase().includes(q)) {
          seen.add(cust);
          customersList.push({ customerId: cust });
          if (customersList.length >= limit) break;
        }
      }
    }

    res.json({
      success: true,
      data: { products: productsList, invoices: invoicesList, customers: customersList, suppliers: suppliersList },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— رصيد الصندوق (Cash balance): مقبوضات - مصروفات على حسابات الصندوق ——
router.get('/dashboard/cash-balance', (req, res) => {
  try {
    const asOfDate = req.query.asOfDate || null;
    const b1010 = journal.getAccountBalance('1010', asOfDate);
    const b1020 = journal.getAccountBalance('1020', asOfDate);
    const totalSYP = (b1010.balance || 0) + (b1020.balance || 0);
    const acc1010 = accounts.get('1010');
    const acc1020 = accounts.get('1020');
    res.json({
      success: true,
      data: {
        totalSYP,
        byAccount: [
          { accountId: '1010', name: (acc1010 && acc1010.name) || 'صندوق ل.س', balance: b1010.balance },
          { accountId: '1020', name: (acc1020 && acc1020.name) || 'صندوق دولار', balance: b1020.balance },
        ],
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Dashboard summary: Single Source of Truth (Unified Dashboard). Same payload as /dashboard/os. ——
router.get('/dashboard/summary', async (req, res) => {
  try {
    const asOfDate = req.query.asOfDate || null;
    const today = new Date().toISOString().slice(0, 10);
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

    const journalList = (store.journalEntriesList || []).filter((e) => !e.deleted);
    const journalEntryCount = journalList.length;

    const tb = statements.getTrialBalance(asOfDate || today);
    const pl = statements.getProfitAndLoss(firstDayOfMonth, today);
    const fxReport = valuation.getExchangeGainLossReport(firstDayOfMonth, today);
    const rates = multiCurrency.getRates();
    const rateSYP = rates.SYP != null && rates.SYP !== 0 ? Number(rates.SYP) : 1 / 15000;
    const oneUsdInSYP = 1 / rateSYP;

    const b1010 = journal.getAccountBalance('1010', asOfDate);
    const b1020 = journal.getAccountBalance('1020', asOfDate);
    const cashSYP = (b1010.balance ?? 0) + (b1020.balance ?? 0);
    const receivables = journal.getAccountBalance('1200', asOfDate);
    const payables = journal.getAccountBalance('2010', asOfDate);
    const warehouse = statements.getWarehouseValuation();
    const inventoryValueSYP = warehouse.totalValueCostSYP ?? 0;

    const barterSummary = barter.getBarterSummary(getTenantId(req));
    const draftsList = store.draftOrders && typeof store.draftOrders.size === 'number' ? store.draftOrders.size : (Array.isArray(store.draftOrders) ? store.draftOrders.length : 0);
    const vouchersList = (store.vouchers || []);
    const voucherCount = Array.isArray(vouchersList) ? vouchersList.length : 0;

    const lowStockRes = await Promise.resolve().then(() => {
      const tenantId = getTenantId(req);
      const from30 = new Date();
      from30.setDate(from30.getDate() - 30);
      const from30Str = from30.toISOString().slice(0, 10);
      const soldByProduct = {};
      for (const inv of salesInvoices) {
        if ((inv.tenantId || 'default') !== tenantId || !inv.date || (inv.date + '').slice(0, 10) < from30Str) continue;
        const items = inv.items || inv.lines || [];
        for (const line of items) {
          const pid = line.productId || line.product_id;
          if (!pid) continue;
          soldByProduct[pid] = (soldByProduct[pid] || 0) + (Number(line.quantity) || 0);
        }
      }
      const list = [];
      for (const p of products.values()) {
        if ((p.tenantId || 'default') !== tenantId || !p.active) continue;
        const minLevel = p.min_stock_level != null ? Number(p.min_stock_level) : null;
        if (minLevel == null) continue;
        const unitId = p.defaultUnitId || 'piece';
        const inv = fractioning.getEffectiveInventory(p.id, unitId);
        const current_stock = (inv && inv.quantity != null) ? Number(inv.quantity) : 0;
        if (current_stock > minLevel) continue;
        list.push({ id: p.id, name: p.name || p.id, current_stock, min_stock_level: minLevel });
      }
      return list;
    }).catch(() => []);

    const aging = reports.getAgingReport(asOfDate || today);
    const cashFlow = statements.getCashFlowStatement(firstDayOfMonth, today);

    const data = {
      trialBalance: { balanced: tb.balanced, totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, asOfDate: tb.asOfDate },
      journalEntryCount,
      exchangeRate: { oneUsdInSYP, rateSYP },
      cash: { syp: cashSYP },
      receivables: receivables.balance ?? 0,
      payables: payables.balance ?? 0,
      inventoryValueSYP,
      pl: { revenue: pl.revenue, expenses: pl.expenses, grossProfit: pl.grossProfit, trueProfit: pl.trueProfit, exchangeGainLossSYP: pl.exchangeGainLossSYP },
      fxGainLossSYP: fxReport.totalGainLossSYP ?? 0,
      barter: { totalTrades: barterSummary.totalTrades, surplusCount: (barterSummary.surplus || []).length, needsCount: (barterSummary.needs || []).length, matchAlertsCount: (barterSummary.matchAlerts || []).length },
      draftsCount: draftsList,
      voucherCount,
      lowStock: lowStockRes,
      aging: { buckets: aging.buckets || {}, totalSYP: (aging.buckets && Object.values(aging.buckets).reduce((s, b) => s + (b.amountSYP || 0), 0)) || 0 },
      cashFlow: { operating: cashFlow.operating, investing: cashFlow.investing, financing: cashFlow.financing },
    };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— تنبيهات المخزون المنخفض (Low stock alerts) + تاريخ نفاد المخزون (Stock Run-out Date) ——
router.get('/dashboard/low-stock', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const from30 = new Date();
    from30.setDate(from30.getDate() - 30);
    const from30Str = from30.toISOString().slice(0, 10);
    const soldByProduct = {};
    for (const inv of salesInvoices) {
      if ((inv.tenantId || 'default') !== tenantId || !inv.date || (inv.date + '').slice(0, 10) < from30Str) continue;
      const items = inv.items || inv.lines || [];
      for (const line of items) {
        const pid = line.productId || line.product_id;
        if (!pid) continue;
        const qty = Number(line.quantity) || 0;
        soldByProduct[pid] = (soldByProduct[pid] || 0) + qty;
      }
    }
    const list = [];
    for (const p of products.values()) {
      if ((p.tenantId || 'default') !== tenantId || !p.active) continue;
      const minLevel = p.min_stock_level != null ? Number(p.min_stock_level) : null;
      if (minLevel == null) continue;
      const unitId = p.defaultUnitId || 'piece';
      const inv = fractioning.getEffectiveInventory(p.id, unitId);
      const current_stock = (inv && inv.quantity != null) ? Number(inv.quantity) : 0;
      if (current_stock > minLevel) continue;
      const sold30 = soldByProduct[p.id] || 0;
      const dailyConsumption = sold30 / 30;
      let run_out_days = null;
      let run_out_date_iso = null;
      if (dailyConsumption > 0 && current_stock >= 0) {
        run_out_days = Math.floor(current_stock / dailyConsumption);
        const d = new Date();
        d.setDate(d.getDate() + run_out_days);
        run_out_date_iso = d.toISOString().slice(0, 10);
      }
      const supplier = p.supplierId ? suppliers.get(p.supplierId) : null;
      list.push({
        id: p.id,
        name: p.name || p.id,
        current_stock,
        min_stock_level: minLevel,
        supplier_name: supplier ? supplier.name : null,
        supplier_phone: supplier ? supplier.phone : null,
        supplier_address: supplier ? supplier.address : null,
        run_out_days,
        run_out_date_iso,
        sold_last_30_days: sold30,
      });
    }
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Accounting OS: unified dashboard payload (Zero-Hidden — كل المزايا في واجهة واحدة) ——
router.get('/dashboard/os', async (req, res) => {
  try {
    const asOfDate = req.query.asOfDate || null;
    const today = new Date().toISOString().slice(0, 10);
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

    const journalList = (store.journalEntriesList || []).filter((e) => !e.deleted);
    const journalEntryCount = journalList.length;

    const tb = statements.getTrialBalance(asOfDate || today);
    const pl = statements.getProfitAndLoss(firstDayOfMonth, today);
    const fxReport = valuation.getExchangeGainLossReport(firstDayOfMonth, today);
    const rates = multiCurrency.getRates();
    const rateSYP = rates.SYP != null && rates.SYP !== 0 ? Number(rates.SYP) : 1 / 15000;
    const oneUsdInSYP = 1 / rateSYP;

    const b1010 = journal.getAccountBalance('1010', asOfDate);
    const b1020 = journal.getAccountBalance('1020', asOfDate);
    const cashSYP = (b1010.balance ?? 0) + (b1020.balance ?? 0);
    const receivables = journal.getAccountBalance('1200', asOfDate);
    const payables = journal.getAccountBalance('2010', asOfDate);
    const warehouse = statements.getWarehouseValuation();
    const inventoryValueSYP = warehouse.totalValueCostSYP ?? 0;

    const barterSummary = barter.getBarterSummary(getTenantId(req));
    const draftsList = store.draftOrders && typeof store.draftOrders.size === 'number' ? store.draftOrders.size : (Array.isArray(store.draftOrders) ? store.draftOrders.length : 0);
    const vouchersList = (store.vouchers || []);
    const voucherCount = Array.isArray(vouchersList) ? vouchersList.length : 0;

    const lowStockRes = await Promise.resolve().then(() => {
      const tenantId = getTenantId(req);
      const from30 = new Date();
      from30.setDate(from30.getDate() - 30);
      const from30Str = from30.toISOString().slice(0, 10);
      const soldByProduct = {};
      for (const inv of salesInvoices) {
        if ((inv.tenantId || 'default') !== tenantId || !inv.date || (inv.date + '').slice(0, 10) < from30Str) continue;
        const items = inv.items || inv.lines || [];
        for (const line of items) {
          const pid = line.productId || line.product_id;
          if (!pid) continue;
          soldByProduct[pid] = (soldByProduct[pid] || 0) + (Number(line.quantity) || 0);
        }
      }
      const list = [];
      for (const p of products.values()) {
        if ((p.tenantId || 'default') !== tenantId || !p.active) continue;
        const minLevel = p.min_stock_level != null ? Number(p.min_stock_level) : null;
        if (minLevel == null) continue;
        const unitId = p.defaultUnitId || 'piece';
        const inv = fractioning.getEffectiveInventory(p.id, unitId);
        const current_stock = (inv && inv.quantity != null) ? Number(inv.quantity) : 0;
        if (current_stock > minLevel) continue;
        list.push({ id: p.id, name: p.name || p.id, current_stock, min_stock_level: minLevel });
      }
      return list;
    }).catch(() => []);

    const aging = reports.getAgingReport(asOfDate || today);
    const cashFlow = statements.getCashFlowStatement(firstDayOfMonth, today);

    res.json({
      success: true,
      data: {
        trialBalance: { balanced: tb.balanced, totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, asOfDate: tb.asOfDate },
        journalEntryCount,
        exchangeRate: { oneUsdInSYP, rateSYP },
        cash: { syp: cashSYP },
        receivables: receivables.balance ?? 0,
        payables: payables.balance ?? 0,
        inventoryValueSYP,
        pl: { revenue: pl.revenue, expenses: pl.expenses, grossProfit: pl.grossProfit, trueProfit: pl.trueProfit, exchangeGainLossSYP: pl.exchangeGainLossSYP },
        fxGainLossSYP: fxReport.totalGainLossSYP ?? 0,
        barter: { totalTrades: barterSummary.totalTrades, surplusCount: (barterSummary.surplus || []).length, needsCount: (barterSummary.needs || []).length, matchAlertsCount: (barterSummary.matchAlerts || []).length },
        draftsCount: draftsList,
        voucherCount,
        lowStock: lowStockRes,
        aging: { buckets: aging.buckets || {}, totalSYP: (aging.buckets && Object.values(aging.buckets).reduce((s, b) => s + (b.amountSYP || 0), 0)) || 0 },
        cashFlow: { operating: cashFlow.operating, investing: cashFlow.investing, financing: cashFlow.financing },
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Pricing engine: update selling prices for USD-linked products when rate changes ——
router.post('/prices/update-by-rate', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const rates = multiCurrency.getRates();
    const sypPerUsd = (req.body.rate != null && Number(req.body.rate) > 0)
      ? Number(req.body.rate)
      : (rates.SYP != null && rates.SYP !== 0 ? 1 / rates.SYP : null);
    if (sypPerUsd == null || sypPerUsd <= 0) {
      return res.status(400).json({ success: false, error: 'سعر الصرف غير متوفر. قم بمزامنة سعر الل.س أولاً.' });
    }
    let updated = 0;
    for (const p of products.values()) {
      if ((p.tenantId || 'default') !== tenantId || !p.active) continue;
      if ((p.base_currency || 'SYP') !== 'USD') continue;
      const basePrice = p.base_price != null ? Number(p.base_price) : null;
      if (basePrice == null) continue;
      p.salesPricePerUnit = Math.round(basePrice * sypPerUsd);
      updated++;
    }
    res.json({ success: true, data: { updated, rateUsed: sypPerUsd } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Global settings (white-label config) ——
router.get('/settings', (req, res) => {
  try {
    res.json({ success: true, data: settings.getSettings() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = req.user?.id || req.user?.username || 'api';
    const updated = settings.updateSettings(req.body || {}, userId);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— User Management (Admin only; tenant-scoped) ——
function getUsersForTenant(tenantId) {
  return Array.from(users.values()).filter((u) => (u.tenantId || 'default') === tenantId);
}

// —— سجل الرقابة (Audit Log) للمدير ——
router.get('/admin/audit-log', requireAuth, requireAdmin, (req, res) => {
  try {
    const { userId, action, entityType, fromDate, limit } = req.query;
    const list = audit.listActionLog({
      userId: userId || undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      fromDate: fromDate || undefined,
      limit: limit != null ? Math.min(Number(limit) || 200, 500) : 200,
    });
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const role = (req.user && req.user.role || '').toUpperCase();
    const list = (role === 'SUPER_ADMIN'
      ? Array.from(users.values())
      : getUsersForTenant(getTenantId(req))
    ).map((u) => ({
      id: u.id,
      username: u.username || u.email,
      email: u.email,
      fullName: u.fullName || null,
      role: u.role || 'ADMIN',
      industryType: u.industryType || 'GENERAL',
      status: u.status,
      tier: u.tier,
      tenantId: u.tenantId || 'default',
      createdAt: u.createdAt,
    }));
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const { username, password, fullName, role, industryType } = req.body || {};
    const tenantId = getTenantId(req);
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }
    const un = String(username).trim().toLowerCase();
    if (un === SAFETY_ADMIN_USERNAME) {
      return res.status(403).json({ success: false, error: 'اسم المستخدم "admin" محجوز لصمام الأمان', code: 'SAFETY_ADMIN_PROTECTED' });
    }
    const exists = Array.from(users.values()).some(
      (u) => ((u.username || '').toLowerCase() === un || (u.email || '').toLowerCase() === un) && (u.tenantId || 'default') === tenantId
    );
    if (exists) return res.status(400).json({ success: false, error: 'اسم المستخدم أو البريد مستخدم مسبقاً' });
    const validIndustry = ['GENERAL', 'SUPERMARKET', 'PHARMACY', 'CLOTHING', 'ELECTRONICS', 'CONSTRUCTION', 'RESTAURANT', 'BEAUTY', 'FURNITURE', 'STATIONERY'].includes(industryType) ? industryType : 'GENERAL';
    const id = 'u_' + Date.now();
    const user = {
      id,
      username: un,
      email: un.includes('@') ? un : un + '@local',
      password: String(password).trim(),
      fullName: fullName ? String(fullName).trim() : null,
      role: role === 'CASHIER' ? 'CASHIER' : 'ADMIN',
      industryType: validIndustry,
      tier: 'basic',
      status: 'active',
      tenantId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    };
    users.set(id, user);
    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        industryType: user.industryType,
        status: user.status,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const targetId = req.params.id;
    const u = users.get(targetId);
    if (!u) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }
    if ((u.username || '').toLowerCase() === SAFETY_ADMIN_USERNAME) {
      return res.status(403).json({ success: false, error: 'لا يمكن حذف مستخدم صمام الأمان (admin) أبداً', code: 'SAFETY_ADMIN_PROTECTED' });
    }
    if (req.user.id === targetId) {
      return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك' });
    }
    const tenantId = getTenantId(req);
    if ((u.tenantId || 'default') !== tenantId) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }
    audit.log('USER_DELETE', { entityType: 'User', entityId: targetId, oldValue: { id: u.id, fullName: u.fullName, role: u.role }, newValue: null, userId: req.user?.id });
    users.delete(targetId);
    res.json({ success: true, data: { message: 'تم حذف المستخدم' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).trim().length < 1) {
      return res.status(400).json({ success: false, error: 'كلمة المرور الجديدة مطلوبة' });
    }
    const tenantId = getTenantId(req);
    const u = users.get(req.params.id);
    if (!u || (u.tenantId || 'default') !== tenantId) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }
    audit.log('PASSWORD_CHANGE', { entityType: 'User', entityId: u.id, oldValue: null, newValue: null, userId: req.user?.id, reasonCode: 'USER_EDIT' });
    u.password = String(newPassword).trim();
    res.json({ success: true, data: { message: 'تم تغيير كلمة المرور' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const VALID_INDUSTRY = ['GENERAL', 'SUPERMARKET', 'PHARMACY', 'CLOTHING', 'ELECTRONICS', 'CONSTRUCTION', 'RESTAURANT', 'BEAUTY', 'FURNITURE', 'STATIONERY'];
const VALID_STATUS = ['active', 'suspended', 'expired', 'pending'];

router.patch('/users/:id', requireAuth, (req, res) => {
  try {
    const { industryType, status: bodyStatus, fullName } = req.body || {};
    const targetId = req.params.id;
    const u = users.get(targetId);
    if (!u) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

    const oldSnapshot = { industryType: u.industryType, status: u.status, fullName: u.fullName };
    const role = (req.user && req.user.role || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';
    const isSafetyAdmin = (u.username || '').toLowerCase() === SAFETY_ADMIN_USERNAME;

    if (industryType !== undefined || bodyStatus !== undefined) {
      if (!isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'تعديل النشاط أو الحالة مسموح للمدير الأعلى فقط', code: 'FORBIDDEN' });
      }
      if (isSafetyAdmin && bodyStatus !== undefined && bodyStatus !== 'active') {
        return res.status(403).json({ success: false, error: 'لا يمكن تعطيل أو إيقاف مستخدم صمام الأمان (admin)', code: 'SAFETY_ADMIN_PROTECTED' });
      }
      if (industryType !== undefined) {
        u.industryType = VALID_INDUSTRY.includes(industryType) ? industryType : 'GENERAL';
      }
      if (bodyStatus !== undefined) {
        if (!VALID_STATUS.includes(bodyStatus)) {
          return res.status(400).json({ success: false, error: 'الحالة غير صالحة' });
        }
        u.status = bodyStatus;
      }
    } else {
      if (role !== 'ADMIN' && !isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'صلاحيات غير كافية', code: 'FORBIDDEN' });
      }
      const tenantId = getTenantId(req);
      if ((u.tenantId || 'default') !== tenantId) {
        return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
      }
      if (fullName !== undefined) u.fullName = String(fullName).trim() || null;
    }

    audit.log('USER_EDIT', { entityType: 'User', entityId: targetId, oldValue: oldSnapshot, newValue: { industryType: u.industryType, status: u.status, fullName: u.fullName }, userId: req.user?.id });
    res.json({
      success: true,
      data: {
        id: u.id,
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        industryType: u.industryType || 'GENERAL',
        status: u.status,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Products & Units (tenant-filtered) ——
router.get('/products', (req, res) => {
  const tenantId = getTenantId(req);
  const list = Array.from(products.values()).filter((p) => (p.tenantId || 'default') === tenantId);
  res.json({ success: true, data: list });
});

router.post('/products', (req, res) => {
  const { name, sku, barcode, defaultUnitId, costPerDefaultUnit, salesPricePerUnit, min_stock_level, supplierId, base_currency, base_price } = req.body;
  const id = getNextId('products');
  const tenantId = getTenantId(req);
  const baseCurrency = (base_currency === 'USD' || base_currency === 'SYP') ? base_currency : 'SYP';
  const p = {
    id,
    tenantId,
    name,
    sku: sku || id,
    barcode: barcode || null,
    defaultUnitId: defaultUnitId || 'piece',
    costPerDefaultUnit: Number(costPerDefaultUnit) || 0,
    salesPricePerUnit: salesPricePerUnit != null ? Number(salesPricePerUnit) : null,
    min_stock_level: min_stock_level != null ? Number(min_stock_level) : null,
    supplierId: supplierId || null,
    base_currency: baseCurrency,
    base_price: base_price != null ? Number(base_price) : null,
    active: true,
  };
  products.set(id, p);
  res.status(201).json({ success: true, data: p });
});

router.patch('/products/:id', (req, res) => {
  const tenantId = getTenantId(req);
  const p = products.get(req.params.id);
  if (!p || (p.tenantId || 'default') !== tenantId) return res.status(404).json({ success: false, error: 'Product not found' });
  const userId = req.body.userId || req.user?.id || 'api';
  const { costPerDefaultUnit, salesPricePerUnit, barcode, name, min_stock_level, supplierId, base_currency, base_price } = req.body;
  const oldSnapshot = { name: p.name, salesPricePerUnit: p.salesPricePerUnit, barcode: p.barcode, min_stock_level: p.min_stock_level };
  if (costPerDefaultUnit !== undefined) {
    const oldVal = p.costPerDefaultUnit;
    p.costPerDefaultUnit = Number(costPerDefaultUnit);
    audit.logPriceChange('Product', p.id, oldVal, p.costPerDefaultUnit, userId);
  }
  if (salesPricePerUnit !== undefined) p.salesPricePerUnit = Number(salesPricePerUnit);
  if (barcode !== undefined) p.barcode = barcode || null;
  if (name !== undefined) p.name = name;
  if (min_stock_level !== undefined) p.min_stock_level = min_stock_level == null ? null : Number(min_stock_level);
  if (supplierId !== undefined) p.supplierId = supplierId || null;
  if (base_currency !== undefined) p.base_currency = (base_currency === 'USD' || base_currency === 'SYP') ? base_currency : 'SYP';
  if (base_price !== undefined) p.base_price = base_price == null ? null : Number(base_price);
  if (name !== undefined || salesPricePerUnit !== undefined || barcode !== undefined) {
    audit.logEntityEdit('USER_EDIT', 'Product', p.id, oldSnapshot, { name: p.name, salesPricePerUnit: p.salesPricePerUnit, barcode: p.barcode, min_stock_level: p.min_stock_level }, userId);
  }
  res.json({ success: true, data: p });
});

router.get('/units', (req, res) => {
  res.json({ success: true, data: Array.from(units.values()) });
});

router.post('/units', (req, res) => {
  const { id, name, symbol, type } = req.body;
  const u = { id: id || getNextId('units'), name, symbol: symbol || name, type: type || 'discrete' };
  units.set(u.id, u);
  res.status(201).json({ success: true, data: u });
});

// —— Fractioning (summary for dashboard; prices in SYP when rate available) ——
router.get('/fractioning/summary', (req, res) => {
  const rules = fractioning.listFractioningRules();
  const inventory = fractioning.getAllInventory();
  const rates = multiCurrency.getRates();
  const sypRate = rates.SYP;
  const toSYP = (usd) => (sypRate != null && sypRate !== 0 && usd != null ? Math.round(usd / sypRate) : null);
  const rulesWithSYP = rules.map((r) => ({
    ...r,
    pricePerSubUnitSYP: toSYP(r.pricePerSubUnit),
    costPerSubUnitSYP: toSYP(r.costPerSubUnit),
  }));
  const inventoryWithSYP = inventory.map((inv) => {
    const rule = rules.find((r) => r.productId === inv.productId && r.bulkUnitId === inv.unitId);
    return {
      ...inv,
      pricePerUnitSYP: rule ? toSYP(rule.pricePerSubUnit) : null,
    };
  });
  res.json({
    success: true,
    data: {
      rules: rulesWithSYP,
      inventory: inventoryWithSYP,
      sypRate: sypRate ?? null,
    },
  });
});

// —— Barter (with Matchmaker) — per-tenant: مطاعم لحال، محلات لحال، صيدليات لحال ——
router.get('/barter/summary', (req, res) => {
  const tenantId = getTenantId(req);
  res.json({ success: true, data: barter.getBarterSummary(tenantId) });
});

router.post('/barter/surplus', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { productId, productName, quantity, userId } = req.body;
    if (!productId) return res.status(400).json({ success: false, error: 'productId required' });
    const result = barter.addSurplus(productId, productName, quantity, userId || req.user?.id, tenantId);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/barter/needs', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { productId, productName, quantity, userId } = req.body;
    if (!productId) return res.status(400).json({ success: false, error: 'productId required' });
    const result = barter.addNeed(productId, productName, quantity, userId || req.user?.id, tenantId);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/barter/confirm', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { matchAlertId, createdBy } = req.body;
    if (!matchAlertId) return res.status(400).json({ success: false, error: 'matchAlertId required' });
    const result = barter.confirmBarterMatch(matchAlertId, createdBy || 'api', tenantId);
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Accounting (Chart of Accounts, Journal, Void with reason) ——
router.get('/accounts', (req, res) => {
  res.json({ success: true, data: Array.from(accounts.values()) });
});

router.get('/journal', requireNoCashier, (req, res) => {
  const { refType, accountId, fromDate, toDate, limit } = req.query;
  const list = journal.listJournalEntries({ refType, accountId, fromDate, toDate, limit: limit ? Number(limit) : 100 });
  res.json({ success: true, data: list });
});

router.get('/journal/:id', requireNoCashier, (req, res) => {
  try {
    const entry = journal.getJournalEntryById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'قيد غير موجود' });
    res.json({ success: true, data: entry });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/accounts/:id/balance', (req, res) => {
  try {
    const accountId = req.params.id;
    if (!accounts.has(accountId)) return res.status(404).json({ success: false, error: 'الحساب غير موجود' });
    const balance = journal.getAccountBalance(accountId);
    const lastActivityDate = journal.getAccountLastActivityDate(accountId);
    res.json({ success: true, data: { balance: balance.balance, debit: balance.debit, credit: balance.credit, lastActivityDate } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/journal', requireNoCashier, (req, res) => {
  try {
    const { date, lines, createdBy } = req.body;
    if (!lines || !Array.isArray(lines) || lines.length === 0)
      return res.status(400).json({ success: false, error: 'lines required (array of { accountId, debit, credit, memo })' });
    const result = vouchers.postJournalVoucher({ lines, date: date || null, createdBy: createdBy || 'user' });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/journal/:id/void', requireNoCashier, (req, res) => {
  try {
    const { reasonCode, deletedBy } = req.body;
    if (!reasonCode) return res.status(400).json({ success: false, error: 'reasonCode required' });
    const result = journal.deleteJournalEntry(req.params.id, reasonCode, deletedBy || 'api');
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Currency: Exchange Gain/Loss & True Profit ——
router.get('/currency/exchange-gain-loss', (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const report = valuation.getExchangeGainLossReport(fromDate || null, toDate || null);
    res.json({ success: true, data: report });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Financial Statements (ميزان مراجعة، قائمة الأرباح والخسائر، التدفقات النقدية، كشف الحساب) ——
router.get('/statements/trial-balance', requireNoCashier, (req, res) => {
  try {
    const { asOfDate } = req.query;
    const data = statements.getTrialBalance(asOfDate || null);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/statements/account', requireNoCashier, (req, res) => {
  try {
    const { accountId, fromDate, toDate } = req.query;
    if (!accountId) return res.status(400).json({ success: false, error: 'accountId required' });
    const data = statements.getAccountStatement(accountId, fromDate || null, toDate || null);
    if (data.error) return res.status(400).json({ success: false, error: data.error });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/reports/profit-loss', requireNoCashier, (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const data = statements.getProfitAndLoss(fromDate || null, toDate || null);
    res.json({ success: true, data, titleAr: 'قائمة الدخل' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.get('/reports/balance-sheet', requireNoCashier, (req, res) => {
  try {
    const data = statements.getBalanceSheet(req.query.asOfDate || null);
    res.json({ success: true, data, titleAr: 'الميزانية العمومية' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.get('/reports/warehouse-valuation', requireNoCashier, (req, res) => {
  try {
    const data = statements.getWarehouseValuation();
    res.json({ success: true, data, titleAr: 'جرد المستودع' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/reports/dashboard-summary', requireNoCashier, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const data = reports.getFinancialSummary(startDate || null, endDate || null);
    const appSettings = settings.getSettings();
    const branding = appSettings.branding || {};
    res.json({
      success: true,
      data,
      branding: {
        primaryColor: branding.primaryColor || '#10b981',
        logoBase64: branding.logoBase64 || null,
        companyName: branding.companyName || 'Vault AI',
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/reports/aging', requireNoCashier, (req, res) => {
  try {
    const data = reports.getAgingReport(req.query.asOfDate || null);
    res.json({ success: true, data, titleAr: 'تقرير أعمار الديون' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/reports/statement/:customerId', requireNoCashier, (req, res) => {
  try {
    const { customerId } = req.params;
    const { fromDate, toDate } = req.query;
    const result = reports.generateAccountStatement(customerId, fromDate || null, toDate || null);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/reports/account-statement', requireNoCashier, (req, res) => {
  try {
    const { accountId, fromDate, toDate } = req.query;
    if (!accountId) return res.status(400).json({ success: false, error: 'accountId required' });
    const data = reports.getAccountStatement(accountId, fromDate || null, toDate || null);
    if (data.error) return res.status(400).json({ success: false, error: data.error });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/statements/profit-loss', requireNoCashier, (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const data = statements.getProfitAndLoss(fromDate || null, toDate || null);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/statements/cash-flow', requireNoCashier, (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const data = statements.getCashFlowStatement(fromDate || null, toDate || null);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Debt Ledger (posts to journal: Dr Debtors Cr Revenue) ——
router.get('/debt', (req, res) => {
  res.json({ success: true, data: debtLedger.listDebt(req.query) });
});

router.post('/debt', (req, res) => {
  try {
    const { amountSYP, debtorId, dueDate, memo, isLoan } = req.body;
    if (amountSYP == null) return res.status(400).json({ success: false, error: 'amountSYP required' });
    const result = debtLedger.recordDebt(Number(amountSYP), { debtorId, dueDate, memo, isLoan });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Audit Trail ——
router.get('/audit', requireNoCashier, (req, res) => {
  try {
    const { action, entityType, fromDate, limit } = req.query;
    const list = audit.listActionLog({ action, entityType, fromDate, limit: limit ? Number(limit) : 200 });
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Vouchers (سند قبض، دفع، قيد، تحويل) ——
router.get('/vouchers', (req, res) => {
  const { type, fromDate, toDate } = req.query;
  const list = vouchers.listVouchers({ type, fromDate, toDate });
  res.json({ success: true, data: list });
});

router.post('/vouchers/receipt', (req, res) => {
  try {
    const validated = validateBody(voucherReceiptSchema, req);
    if (!validated.success) return res.status(400).json({ success: false, error: validated.error });
    const { cashAccountId, creditAccountId, amountSYP, memo } = validated.data;
    const result = vouchers.postReceiptVoucher({ cashAccountId, creditAccountId, amountSYP, memo, createdBy: req.body?.createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/vouchers/payment', (req, res) => {
  try {
    const validated = validateBody(voucherPaymentSchema, req);
    if (!validated.success) return res.status(400).json({ success: false, error: validated.error });
    const { creditAccountId, debitAccountId, amountSYP, memo } = validated.data;
    const result = vouchers.postPaymentVoucher({ creditAccountId, debitAccountId, amountSYP, memo, createdBy: req.body?.createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/vouchers/journal', (req, res) => {
  try {
    const validated = validateBody(voucherJournalSchema, req);
    if (!validated.success) return res.status(400).json({ success: false, error: validated.error });
    const { lines } = validated.data;
    const { date, createdBy } = req.body || {};
    const result = vouchers.postJournalVoucher({ lines, date, createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/vouchers/transfer', (req, res) => {
  try {
    const { fromAccountId, toAccountId, amountInFromCurrency, rateToSYP, memo, createdBy } = req.body;
    if (!fromAccountId || !toAccountId || amountInFromCurrency == null || !rateToSYP)
      return res.status(400).json({ success: false, error: 'fromAccountId, toAccountId, amountInFromCurrency, rateToSYP required' });
    const result = vouchers.postTransferVoucher({ fromAccountId, toAccountId, amountInFromCurrency: Number(amountInFromCurrency), rateToSYP: Number(rateToSYP), memo, createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ترقيم تسلسلي سنوي: inv-YYYY-NNNN أو sret-YYYY-NNNN
function getNextSeqForYear(collection, prefix, year) {
  const y = String(year);
  const list = collection.filter((d) => d.id && String(d.id).startsWith(prefix + '-' + y + '-'));
  const nums = list.map((d) => parseInt(String(d.id).split('-')[2], 10)).filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return max + 1;
}

// —— Sales Invoice: محرك التجزئة + FIFO + قيد مركب مع Rollback ودعم واجهة قديمة ——
const CASH_SYP = '1010';
const DEBTORS = '1200';
const REVENUE = '4000';
const COGS = '5000';
const INVENTORY = '1100';

function roundCostForResponse(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Number(Number(value).toFixed(2));
}

/**
 * Rollback: إعادة الكميات المخصومة عند فشل صنف لاحق (استدعاء من محرك التجزئة/FIFO).
 */
function rollbackInvoiceLines(processedLines) {
  for (let i = processedLines.length - 1; i >= 0; i--) {
    const p = processedLines[i];
    if (p.hadRule) {
      fractioning.addReturnToOpenSub(p.productId, p.unitId, p.quantity, p.lineCostSYP);
    } else {
      fifo.addReturnLot(p.productId, p.unitId, p.quantity, p.costPerUnit, { isReturn: true });
    }
  }
}

router.post('/sales/invoice', requireAuth, (req, res) => {
  try {
    const { items = [], customerId, paymentType = 'cash' } = req.body;
    const isCash = paymentType !== 'credit' && paymentType !== 'ذمة';
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array required with at least one item' });
    }

    // 1) Validate stock for ALL items first
    for (const line of items) {
      const { productId, unitId, quantity } = line;
      if (!productId || quantity == null || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Each item must have productId and positive quantity' });
      }
      const u = unitId || 'piece';
      const inv = fractioning.getEffectiveInventory(productId, u);
      const available = inv?.quantity ?? 0;
      if (available < quantity) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient stock',
          productId,
          unitId: u,
          required: quantity,
          available,
        });
      }
    }

    const year = new Date().getFullYear();
    const seq = getNextSeqForYear(salesInvoices, 'inv', year);
    const invoiceId = 'inv-' + year + '-' + String(seq).padStart(4, '0');
    let totalRevenue = 0;
    let totalCogsSYP = 0;
    const processedLines = [];
    const seenKeys = new Set();

    // 2) Execute sale per line: وحدة فرعية (Piece) → sellInSubUnits؛ وحدة كبرى (Carton) → sellInBulk. عند الفشل: Rollback.
    for (const line of items) {
      const { productId, unitId, quantity, unitPrice } = line;
      const u = unitId || 'piece';
      const rule = fractioning.getFractioningRule(productId, u);
      const price = Number(unitPrice) || 0;

      let result;
      if (rule) {
        result = fractioning.sellInSubUnits(productId, u, quantity, price, 'SYP');
      } else {
        result = fractioning.sellInBulk(productId, u, quantity, price, 'SYP');
      }
      if (!result.success) {
        rollbackInvoiceLines(processedLines);
        return res.status(400).json({
          success: false,
          error: result.error || 'نقص مخزون',
          productId,
          unitId: u,
          rollback: true,
        });
      }

      const lineCost = result.cogsSYP ?? result.cost ?? 0;
      const costPerUnit = quantity > 0 ? lineCost / quantity : 0;
      totalRevenue += result.revenue ?? 0;
      totalCogsSYP += lineCost;

      processedLines.push({
        productId,
        unitId: u,
        quantity,
        lineCostSYP: lineCost,
        costPerUnit: roundCostForResponse(costPerUnit),
        hadRule: !!rule,
      });
      seenKeys.add(productId + ':' + u);
    }

    // 3) تسجيل حركات المخزون (بعد نجاح كل الأسطر) مع costAtMovement لدقة المرتجعات والتقييم التاريخي
    const movements = [];
    for (const p of processedLines) {
      const mov = recordStockMovement(
        p.productId,
        p.unitId,
        p.quantity,
        'out',
        'invoice',
        invoiceId,
        p.lineCostSYP
      );
      movements.push(mov);
    }

    // 4) قيد مركب: مدين صندوق/زبون، دائن إيرادات؛ مدين COGS، دائن مخزون. مرر amountUSDAtTx لـ valuation.
    const debitAccountId = isCash ? CASH_SYP : DEBTORS;
    const rates = multiCurrency.getRates();
    const rateAtTx = rates.SYP != null && rates.SYP !== 0 ? rates.SYP : null;
    const amountUSDAtTx = rateAtTx != null ? totalRevenue * rateAtTx : null;

    const compoundLines = [
      { accountId: debitAccountId, debit: totalRevenue, credit: 0 },
      { accountId: REVENUE, debit: 0, credit: totalRevenue },
    ];
    if (totalCogsSYP > 0) {
      compoundLines.push({ accountId: COGS, debit: totalCogsSYP, credit: 0 });
      compoundLines.push({ accountId: INVENTORY, debit: 0, credit: totalCogsSYP });
    }

    const createdBy = req.user ? (req.user.fullName || req.user.username || req.user.email || req.user.id) : 'user';
    const journalResult = journal.postCompoundEntry(compoundLines, {
      refType: 'sale',
      refId: invoiceId,
      memo: 'فاتورة بيع ' + invoiceId,
      createdBy,
      amountUSDAtTx,
    });

    if (!journalResult.success) {
      rollbackInvoiceLines(processedLines);
      const movIds = new Set(movements.map((m) => m.id));
      if (stockMovements && stockMovements.length) {
        for (let i = stockMovements.length - 1; i >= 0; i--) {
          if (movIds.has(stockMovements[i].id)) stockMovements.splice(i, 1);
        }
      }
      return res.status(400).json({ success: false, error: journalResult.error || 'فشل إنشاء القيد المحاسبي' });
    }

    const tenantId = getTenantId(req);
    const invoiceDoc = {
      id: invoiceId,
      tenantId,
      createdBy,
      date: new Date().toISOString(),
      customerId: customerId || null,
      paymentType: isCash ? 'cash' : 'credit',
      items: items.map((l) => ({
        productId: l.productId,
        unitId: l.unitId || 'piece',
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        returnedQuantity: 0,
      })),
      totalRevenue,
      totalCogsSYP,
      rateAtTx,
      amountUSDAtTx,
    };
    salesInvoices.push(invoiceDoc);

    // 5) أرصدة محدثة للأصناف (لتحديث الواجهة فوراً)
    const stockUpdated = [];
    for (const key of seenKeys) {
      const [productId, unitId] = key.split(':');
      const inv = fractioning.getEffectiveInventory(productId, unitId);
      const available = inv?.quantity ?? 0;
      stockUpdated.push({ productId, unitId, available });
    }

    // استجابة مع حقول جديدة + توافق قديم (total_price, stock_left) وجميع المبالغ مقرّبة
    const total_price = roundCostForResponse(totalRevenue);
    const totalCogsRounded = roundCostForResponse(totalCogsSYP);
    const stock_left = stockUpdated.map((s) => ({
      ...s,
      available: roundCostForResponse(s.available),
    }));

    res.status(201).json({
      success: true,
      data: {
        invoiceId,
        totalRevenue: total_price,
        totalCogsSYP: totalCogsRounded,
        total_price,
        stock_left,
        stockUpdated,
        movements,
        customerId: customerId || null,
        paymentType: isCash ? 'cash' : 'credit',
        entryId: journalResult.entry?.id,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/sales/invoices', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    let list = [...salesInvoices].filter((inv) => (inv.tenantId || 'default') === tenantId);
    const { fromDate, toDate, customerId } = req.query;
    if (fromDate) list = list.filter((inv) => inv.date >= fromDate);
    if (toDate) list = list.filter((inv) => inv.date <= toDate);
    if (customerId) list = list.filter((inv) => inv.customerId === customerId);
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/sales/invoices/:id', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const inv = salesInvoices.find((i) => i.id === req.params.id && (i.tenantId || 'default') === tenantId);
    if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/sales/return', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { invoiceId, items = [], refundToCash = true, reason, notes, rmaNumber, returnDate } = req.body;
    if (!invoiceId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'invoiceId and items array required' });
    }
    const inv = salesInvoices.find((i) => i.id === invoiceId && (i.tenantId || 'default') === tenantId);
    if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const year = new Date().getFullYear();
    const seq = getNextSeqForYear(salesReturns, 'sret', year);
    const returnId = 'sret-' + year + '-' + String(seq).padStart(4, '0');
    let totalAmount = 0;
    let totalDamagedAmount = 0;
    const movements = [];
    const itemsToSave = [];

    for (const line of items) {
      const { productId, unitId, returnQuantity, unitPrice, restock } = line;
      const u = unitId || 'piece';
      const returnQty = Number(returnQuantity) || 0;
      if (!productId || returnQty <= 0) continue;

      const origLine = inv.items.find((i) => i.productId === productId && (i.unitId || 'piece') === u);
      if (!origLine) {
        return res.status(400).json({ success: false, error: 'Line not found on invoice', productId, unitId: u });
      }
      const maxReturn = Number(origLine.quantity) || 0;
      if (returnQty > maxReturn) {
        return res.status(400).json({
          success: false,
          error: 'Return quantity exceeds original',
          productId,
          unitId: u,
          returnQuantity: returnQty,
          originalQuantity: maxReturn,
        });
      }

      const price = Number(unitPrice) != null ? Number(unitPrice) : Number(origLine.unitPrice) || 0;
      const lineAmount = returnQty * price;
      totalAmount += lineAmount;

      const doRestock = restock !== false;
      if (!doRestock) totalDamagedAmount += lineAmount;
      itemsToSave.push({
        productId,
        unitId: u,
        returnQuantity: returnQty,
        unitPrice: price,
        restock: doRestock,
      });
      if (doRestock) {
        const rule = fractioning.getFractioningRule(productId, u);
        if (rule) {
          const bulkQty = Math.ceil(returnQty / rule.factor);
          fractioning.addBulkInventory(productId, rule.bulkUnitId, bulkQty);
          fifo.receiveLot(productId, rule.bulkUnitId, bulkQty, 0);
        } else {
          fractioning.addBulkInventory(productId, u, returnQty);
          fifo.receiveLot(productId, u, returnQty, 0);
        }
        const mov = recordStockMovement(productId, u, returnQty, 'in', 'sales_return', returnId, null);
        movements.push(mov);
      }
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ success: false, error: 'No valid return items' });
    }

    const SALES_RETURNS = '4010';
    const CASH_SYP = '1010';
    const DEBTORS = '1200';
    const creditAccountId = refundToCash ? CASH_SYP : DEBTORS;
    if (!accounts.has(SALES_RETURNS) || !accounts.has(creditAccountId)) {
      return res.status(500).json({ success: false, error: 'Account not found' });
    }
    const rates = multiCurrency.getRates();
    const r = journal.postDoubleEntry(SALES_RETURNS, creditAccountId, totalAmount, {
      refType: 'sales_return',
      refId: returnId,
      memo: 'مرتجع بيع ' + invoiceId,
      amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? totalAmount * rates.SYP : null,
    });
    if (!r.success) return res.status(400).json(r);

    const docDate = returnDate && /^\d{4}-\d{2}-\d{2}/.test(String(returnDate).trim()) ? new Date(returnDate.trim()).toISOString() : new Date().toISOString();
    const doc = {
      id: returnId,
      tenantId,
      invoiceId,
      date: docDate,
      items: itemsToSave,
      totalAmount,
      totalDamagedAmount: totalDamagedAmount || 0,
      refundToCash,
      reason: reason != null ? String(reason).trim() : '',
      notes: notes != null ? String(notes).trim() : '',
      rmaNumber: rmaNumber != null ? String(rmaNumber).trim() : '',
      entryIds: [r.entry.id],
      movements: movements.map((m) => m.id),
    };
    salesReturns.push(doc);

    res.status(201).json({
      success: true,
      data: { returnId, totalAmount, movements, entry: r.entry },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/sales/returns', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    let list = [...salesReturns].filter((r) => (r.tenantId || 'default') === tenantId);
    const { fromDate, toDate, invoiceId } = req.query;
    if (fromDate) list = list.filter((r) => r.date >= fromDate);
    if (toDate) list = list.filter((r) => r.date <= toDate);
    if (invoiceId) list = list.filter((r) => r.invoiceId === invoiceId);
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Procurement (المشتريات): Purchase Invoice & Purchase Return ——
router.post('/procurement/purchase-invoice', (req, res) => {
  try {
    const { items, supplierId, payWithCash, memo, invoiceDate, dueDate, createdBy } = req.body;
    const result = procurement.postPurchaseInvoice({ items: items || [], supplierId, payWithCash: !!payWithCash, memo, invoiceDate, dueDate, createdBy: createdBy || 'user' });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/procurement/purchase-return', (req, res) => {
  try {
    const { items, supplierId, receiveCash, memo, createdBy } = req.body;
    const result = procurement.postPurchaseReturn({ items: items || [], supplierId, receiveCash: !!receiveCash, memo, createdBy: createdBy || 'user' });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/procurement/purchase-invoices', (req, res) => {
  const list = procurement.listPurchaseInvoices({ supplierId: req.query.supplierId, fromDate: req.query.fromDate, toDate: req.query.toDate });
  res.json({ success: true, data: list });
});

router.get('/procurement/purchase-returns', (req, res) => {
  const list = procurement.listPurchaseReturns({ supplierId: req.query.supplierId, fromDate: req.query.fromDate, toDate: req.query.toDate });
  res.json({ success: true, data: list });
});

// —— Suppliers (الموردين) ——
router.get('/suppliers', (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const list = Array.from(suppliers.values())
      .filter((s) => (s.tenantId || 'default') === tenantId)
      .map((s) => ({ id: s.id, name: s.name, phone: s.phone || null, address: s.address || null, createdAt: s.createdAt }));
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/suppliers', requireAuth, (req, res) => {
  try {
    const { name, phone, address } = req.body || {};
    const tenantId = getTenantId(req);
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'اسم المورد مطلوب' });
    const id = 'sup_' + Date.now();
    const doc = { id, name: String(name).trim(), phone: phone ? String(phone).trim() : null, address: address ? String(address).trim() : null, tenantId, createdAt: new Date().toISOString() };
    suppliers.set(id, doc);
    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/suppliers/:id', requireAuth, (req, res) => {
  try {
    const s = suppliers.get(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: 'المورد غير موجود' });
    const tenantId = getTenantId(req);
    if ((s.tenantId || 'default') !== tenantId) return res.status(404).json({ success: false, error: 'المورد غير موجود' });
    const oldVal = { name: s.name, phone: s.phone, address: s.address };
    const { name, phone, address } = req.body || {};
    if (name !== undefined) s.name = String(name).trim();
    if (phone !== undefined) s.phone = phone ? String(phone).trim() : null;
    if (address !== undefined) s.address = address ? String(address).trim() : null;
    audit.log('USER_EDIT', { entityType: 'Supplier', entityId: req.params.id, oldValue: oldVal, newValue: { name: s.name, phone: s.phone, address: s.address }, userId: req.user?.id });
    res.json({ success: true, data: s });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/suppliers/:id', requireAuth, (req, res) => {
  try {
    const s = suppliers.get(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: 'المورد غير موجود' });
    const tenantId = getTenantId(req);
    if ((s.tenantId || 'default') !== tenantId) return res.status(404).json({ success: false, error: 'المورد غير موجود' });
    audit.log('ENTITY_DELETE', { entityType: 'Supplier', entityId: req.params.id, oldValue: { id: s.id, name: s.name }, newValue: null, userId: req.user?.id });
    suppliers.delete(req.params.id);
    res.json({ success: true, data: { message: 'تم حذف المورد' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Manufacturing (التصنيع): BOM + Build ——
router.get('/manufacturing/boms', (req, res) => {
  const list = manufacturing.listBOMs(req.query.finishedProductId || null);
  res.json({ success: true, data: list });
});
router.get('/manufacturing/boms/:id', (req, res) => {
  const bom = manufacturing.getBOM(req.params.id);
  if (!bom) return res.status(404).json({ success: false, error: 'BOM not found' });
  res.json({ success: true, data: bom });
});
router.post('/manufacturing/boms', (req, res) => {
  try {
    const result = manufacturing.saveBOM(req.body);
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result.bom });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.put('/manufacturing/boms/:id', (req, res) => {
  try {
    const oldBom = manufacturing.getBOM(req.params.id) || null;
    const result = manufacturing.saveBOM({ ...req.body, id: req.params.id });
    if (!result.success) return res.status(400).json(result);
    audit.log('USER_EDIT', { entityType: 'BOM', entityId: req.params.id, oldValue: oldBom ? { finishedProductId: oldBom.finishedProductId, components: oldBom.components } : null, newValue: result.bom ? { finishedProductId: result.bom.finishedProductId, components: result.bom.components } : null, userId: req.user?.id });
    res.json({ success: true, data: result.bom });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.post('/manufacturing/build', (req, res) => {
  try {
    const { bomId, quantity, memo, createdBy } = req.body;
    if (!bomId || quantity == null) return res.status(400).json({ success: false, error: 'bomId and quantity required' });
    const result = manufacturing.executeBuild({ bomId, quantity, memo, createdBy: createdBy || 'user' });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Expenses (المصاريف) ——
router.post('/expenses', (req, res) => {
  try {
    const validated = validateBody(expenseSchema, req);
    if (!validated.success) return res.status(400).json({ success: false, error: validated.error });
    const { accountId, amountSYP, memo, date, createdBy } = validated.data;
    const result = expenses.recordExpense({ accountId, amountSYP, memo, date, createdBy: createdBy || req.body?.createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.get('/expenses', (req, res) => {
  const list = expenses.listExpenses({ accountId: req.query.accountId, fromDate: req.query.fromDate, toDate: req.query.toDate });
  res.json({ success: true, data: list });
});

// —— Company Profile (الإعدادات العامة) ——
router.get('/settings/company-profile', (req, res) => {
  res.json({ success: true, data: { ...store.companyProfile } });
});
router.put('/settings/company-profile', (req, res) => {
  const oldProfile = { ...store.companyProfile };
  const { logoUrl, taxId, defaultCurrency, name } = req.body;
  if (logoUrl !== undefined) store.companyProfile.logoUrl = logoUrl;
  if (taxId !== undefined) store.companyProfile.taxId = taxId;
  if (defaultCurrency !== undefined) store.companyProfile.defaultCurrency = defaultCurrency;
  if (name !== undefined) store.companyProfile.name = name;
  audit.log('USER_EDIT', { entityType: 'CompanyProfile', entityId: 'default', oldValue: oldProfile, newValue: { ...store.companyProfile }, userId: req.user?.id });
  res.json({ success: true, data: { ...store.companyProfile } });
});

// —— Backup / Restore (النسخ الاحتياطي واستعادة البيانات) ——
router.get('/backup/export', (req, res) => {
  try {
    const data = backup.exportBackup();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="VaultAI_Backup_' + Date.now() + '.json"');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.post('/backup/restore', (req, res) => {
  try {
    const data = req.body;
    const result = backup.validateAndRestore(data);
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, message: 'تم استعادة النسخة الاحتياطية' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Inventory: stock movements (حركات مخزون) ——
router.get('/inventory/movements', (req, res) => {
  const { productId, fromDate, toDate, type } = req.query;
  let list = [...(stockMovements || [])];
  if (productId) list = list.filter((m) => m.productId === productId);
  if (fromDate) list = list.filter((m) => m.date >= fromDate);
  if (toDate) list = list.filter((m) => m.date <= toDate);
  if (type) list = list.filter((m) => m.type === type);
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ success: true, data: list });
});

router.post('/inventory/movements', (req, res) => {
  try {
    const { productId, unitId, quantity, type, refType, refId } = req.body;
    if (!productId || quantity == null) return res.status(400).json({ success: false, error: 'productId and quantity required' });
    const id = getNextId('stockMovements');
    const movement = {
      id,
      productId,
      unitId: unitId || 'piece',
      quantity: Number(quantity),
      type: type === 'out' ? 'out' : 'in',
      refType: refType || null,
      refId: refId || null,
      date: new Date().toISOString(),
    };
    stockMovements.push(movement);
    res.status(201).json({ success: true, data: movement });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— تسوية الجرد (مطابقة الرصيد الفعلي مع النظامي) ——
router.post('/inventory/reconcile', requireNoCashier, (req, res) => {
  try {
    const { productId, actualQty, unitId, reasonCode } = req.body;
    if (!productId || actualQty == null) {
      return res.status(400).json({ success: false, error: 'productId and actualQty required' });
    }
    const userId = req.user?.id || req.user?.username || 'api';
    const result = reconciliation.reconcileStock(productId, Number(actualQty), unitId || 'piece', {
      reasonCode: reasonCode || audit.REASON_CODES.INVENTORY_ADJUST,
      userId,
    });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Smart Returns (مرتجعات مخزون بتكلفة أصلية وقيد مركب) ——
router.post('/inventory/return', (req, res) => {
  try {
    const { saleRefId, itemsToReturn = [], refundToCash = true, memo, returnId, createdBy } = req.body;
    const createdByUser = req.user ? (req.user.fullName || req.user.username || req.user.id) : (createdBy || 'api');
    const result = returns.processReturn(saleRefId, itemsToReturn, {
      refundToCash: !!refundToCash,
      memo: memo != null ? String(memo) : '',
      returnId: returnId || undefined,
      createdBy: createdByUser,
    });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.status(201).json({
      success: true,
      data: {
        returnId: result.returnId,
        entry: result.entry,
        movements: result.movements,
        processedLines: result.processedLines,
        totalRefundSYP: result.totalRefundSYP,
        totalCostReversalSYP: result.totalCostReversalSYP,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Multi-currency (live SYP sync) ——
router.get('/multi-currency/rates', (req, res) => {
  res.json({ success: true, data: multiCurrency.getRates() });
});

router.post('/multi-currency/rates', requireAuth, requireNoCashier, (req, res) => {
  try {
    const { currency, rate, runRevaluation } = req.body;
    if (!currency || rate == null) return res.status(400).json({ success: false, error: 'currency and rate required' });
    const role = (req.user && req.user.role || '').toUpperCase();
    if (runRevaluation === true && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'إعادة تقييم الديون مسموحة لمدير النظام (SUPER_ADMIN) فقط', code: 'FORBIDDEN' });
    }
    const rates = multiCurrency.getRates();
    const oldRate = rates[currency] ?? null;
    const data = multiCurrency.setRate(currency, rate);
    const userId = req.user?.id || req.user?.username || 'api';
    audit.logPriceChange('ExchangeRate', currency, oldRate, Number(rate), userId);
    let revaluation = null;
    if (runRevaluation === true && currency === 'SYP' && data.SYP != null && data.SYP !== 0) {
      const oneUsdInSYP = 1 / data.SYP;
      const revalResult = debtRevaluation.runDebtRevaluation(String(oneUsdInSYP), userId);
      revaluation = revalResult.success ? { revalued: revalResult.revalued, adjustmentAmount: revalResult.adjustmentAmount, message: revalResult.message } : { error: revalResult.error };
    }
    res.json({ success: true, data, revaluation: revaluation || undefined });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** إعادة تقييم الديون (دفعة واحدة). مسموح لـ SUPER_ADMIN فقط. */
router.post('/currency/revalue-debts', requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const { newRateOneUsdInSYP } = req.body || {};
    const userId = req.user?.id || req.user?.username || 'api';
    const result = debtRevaluation.runDebtRevaluation(newRateOneUsdInSYP != null ? String(newRateOneUsdInSYP) : null, userId);
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/multi-currency/rates/sync', async (req, res) => {
  try {
    const data = await multiCurrency.fetchSYPRate();
    res.json({ success: true, data: { ...data, rates: multiCurrency.getRates() } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Vision (OCR upload → add to Fractioning inventory) ——
router.get('/vision/cache', (req, res) => {
  res.json({ success: true, data: vision.getVisionCache() });
});

router.post('/vision/upload', (req, res) => {
  try {
    const raw = req.body?.image ?? req.body?.file;
    const base64 = typeof raw === 'string' && raw.replace(/^data:image\/\w+;base64,/, '');
    const buffer = base64 ? Buffer.from(base64, 'base64') : null;
    const lines = vision.mockOcrFromImage(buffer);
    const { results, totalCostSYP } = vision.addOcrLinesToInventory(lines);
    res.json({
      success: true,
      data: {
        extracted: lines,
        inventoryAdded: results,
        totalCostSYP,
        journalPosted: totalCostSYP > 0,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— Draft orders (WhatsApp + POS) ——
router.get('/drafts', (req, res) => {
  const status = req.query.status || null;
  const list = status
    ? Array.from(draftOrders.values()).filter((d) => d.status === status)
    : Array.from(draftOrders.values());
  res.json({ success: true, data: list });
});

router.post('/drafts/:id/convert', (req, res) => {
  const payload = draftOrdersApi.convertDraftToOrderPayload(req.params.id);
  if (!payload) return res.status(400).json({ success: false, error: 'Draft not found or not in draft status' });
  draftOrdersApi.setDraftStatus(req.params.id, 'converted');
  res.json({ success: true, data: payload, message: 'Use this payload to create the order in POS' });
});

// —— POS: create order (can accept draft payload) ——
router.post('/pos/orders', (req, res) => {
  const body = req.body;
  const lines = body.lines || [];
  const orderId = getNextId('orders');
  store.orders.set(orderId, {
    id: orderId,
    source: body.source || 'pos',
    draftId: body.draftId || null,
    customerPhone: body.customerPhone,
    customerName: body.customerName,
    lines,
    notes: body.notes || '',
    status: 'completed',
    createdAt: new Date().toISOString(),
  });
  res.status(201).json({ success: true, data: { id: orderId }, message: 'Order created' });
});

export default router;
