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
import * as audit from '../audit/actionLog.js';
import * as statements from '../accounting/statements.js';
import * as debtLedger from '../accounting/debtLedger.js';
import * as vouchers from '../accounting/vouchers.js';
import { postSaleJournal } from '../accounting/transactions.js';
import { recordStockMovement } from '../inventory/stockMovement.js';
import * as fifo from '../inventory/fifo.js';
import * as procurement from '../modules/procurement/index.js';
import * as manufacturing from '../modules/manufacturing/index.js';
import * as expenses from '../modules/expenses/index.js';
import * as backup from '../backup/index.js';
import * as settings from '../config/settings.js';
import { optionalAuth, requireAuth, requireSuperAdmin } from '../auth/middleware.js';

const router = Router();
router.use(optionalAuth);
const { products, units, draftOrders, accounts, stockMovements, salesInvoices, salesReturns, users } = store;

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
    const updated = settings.updateSettings(req.body || {});
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// —— User Management (Admin only; tenant-scoped) ——
function getUsersForTenant(tenantId) {
  return Array.from(users.values()).filter((u) => (u.tenantId || 'default') === tenantId);
}

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
    if (req.user.id === targetId) {
      return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك' });
    }
    const tenantId = getTenantId(req);
    const u = users.get(targetId);
    if (!u || (u.tenantId || 'default') !== tenantId) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }
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

    const role = (req.user && req.user.role || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_ADMIN';

    if (industryType !== undefined || bodyStatus !== undefined) {
      if (!isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'تعديل النشاط أو الحالة مسموح للمدير الأعلى فقط', code: 'FORBIDDEN' });
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
  const { name, sku, barcode, defaultUnitId, costPerDefaultUnit, salesPricePerUnit } = req.body;
  const id = getNextId('products');
  const tenantId = getTenantId(req);
  const p = {
    id,
    tenantId,
    name,
    sku: sku || id,
    barcode: barcode || null,
    defaultUnitId: defaultUnitId || 'piece',
    costPerDefaultUnit: Number(costPerDefaultUnit) || 0,
    salesPricePerUnit: salesPricePerUnit != null ? Number(salesPricePerUnit) : null,
    active: true,
  };
  products.set(id, p);
  res.status(201).json({ success: true, data: p });
});

router.patch('/products/:id', (req, res) => {
  const tenantId = getTenantId(req);
  const p = products.get(req.params.id);
  if (!p || (p.tenantId || 'default') !== tenantId) return res.status(404).json({ success: false, error: 'Product not found' });
  const { costPerDefaultUnit, salesPricePerUnit, barcode, name } = req.body;
  if (costPerDefaultUnit !== undefined) {
    const oldVal = p.costPerDefaultUnit;
    p.costPerDefaultUnit = Number(costPerDefaultUnit);
    audit.logPriceChange('Product', p.id, oldVal, p.costPerDefaultUnit, req.body.userId || 'api');
  }
  if (salesPricePerUnit !== undefined) p.salesPricePerUnit = Number(salesPricePerUnit);
  if (barcode !== undefined) p.barcode = barcode || null;
  if (name !== undefined) p.name = name;
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

// —— Barter (with Matchmaker) ——
router.get('/barter/summary', (req, res) => {
  res.json({ success: true, data: barter.getBarterSummary() });
});

router.post('/barter/surplus', (req, res) => {
  try {
    const { productId, productName, quantity, userId } = req.body;
    if (!productId) return res.status(400).json({ success: false, error: 'productId required' });
    const result = barter.addSurplus(productId, productName, quantity, userId);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/barter/needs', (req, res) => {
  try {
    const { productId, productName, quantity, userId } = req.body;
    if (!productId) return res.status(400).json({ success: false, error: 'productId required' });
    const result = barter.addNeed(productId, productName, quantity, userId);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/barter/confirm', (req, res) => {
  try {
    const { matchAlertId, createdBy } = req.body;
    if (!matchAlertId) return res.status(400).json({ success: false, error: 'matchAlertId required' });
    const result = barter.confirmBarterMatch(matchAlertId, createdBy || 'api');
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

router.get('/journal', (req, res) => {
  const { refType, accountId, fromDate, toDate, limit } = req.query;
  const list = journal.listJournalEntries({ refType, accountId, fromDate, toDate, limit: limit ? Number(limit) : 100 });
  res.json({ success: true, data: list });
});

router.post('/journal', (req, res) => {
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

router.post('/journal/:id/void', (req, res) => {
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
router.get('/statements/trial-balance', (req, res) => {
  try {
    const { asOfDate } = req.query;
    const data = statements.getTrialBalance(asOfDate || null);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/statements/account', (req, res) => {
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

router.get('/reports/profit-loss', (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const data = statements.getProfitAndLoss(fromDate || null, toDate || null);
    res.json({ success: true, data, titleAr: 'قائمة الدخل' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.get('/reports/balance-sheet', (req, res) => {
  try {
    const data = statements.getBalanceSheet(req.query.asOfDate || null);
    res.json({ success: true, data, titleAr: 'الميزانية العمومية' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.get('/reports/warehouse-valuation', (req, res) => {
  try {
    const data = statements.getWarehouseValuation();
    res.json({ success: true, data, titleAr: 'جرد المستودع' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
router.get('/statements/profit-loss', (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const data = statements.getProfitAndLoss(fromDate || null, toDate || null);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/statements/cash-flow', (req, res) => {
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
router.get('/audit', (req, res) => {
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
    const { cashAccountId, creditAccountId, amountSYP, memo, createdBy } = req.body;
    if (!creditAccountId || amountSYP == null) return res.status(400).json({ success: false, error: 'creditAccountId and amountSYP required' });
    const result = vouchers.postReceiptVoucher({ cashAccountId, creditAccountId, amountSYP: Number(amountSYP), memo, createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/vouchers/payment', (req, res) => {
  try {
    const { creditAccountId, debitAccountId, amountSYP, memo, createdBy } = req.body;
    if (!debitAccountId || amountSYP == null) return res.status(400).json({ success: false, error: 'debitAccountId and amountSYP required' });
    const result = vouchers.postPaymentVoucher({ creditAccountId, debitAccountId, amountSYP: Number(amountSYP), memo, createdBy });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/vouchers/journal', (req, res) => {
  try {
    const { date, lines, createdBy } = req.body;
    if (!lines || !Array.isArray(lines)) return res.status(400).json({ success: false, error: 'lines required' });
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

// —— Sales Invoice (Logic Bridge): validate all → deduct stock → ONE journal entry → multiple stock movements ——
router.post('/sales/invoice', requireAuth, (req, res) => {
  try {
    const { items = [], customerId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array required with at least one item' });
    }

    // 1) Validate stock for ALL items first
    for (const line of items) {
      const { productId, unitId, quantity, unitPrice } = line;
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

    const invoiceId = 'inv-' + Date.now();
    let totalRevenue = 0;
    let totalCogsSYP = 0;
    const movements = [];

    // 2) Execute sale per line (deduct stock), collect totals
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
        return res.status(400).json({ success: false, error: result.error, productId, unitId: u });
      }

      totalRevenue += result.revenue ?? 0;
      totalCogsSYP += result.cogsSYP ?? result.cost ?? 0;

      const mov = recordStockMovement(productId, u, quantity, 'out', 'invoice', invoiceId);
      movements.push(mov);
    }

    // 3) One journal entry for the whole invoice
    const rates = multiCurrency.getRates();
    postSaleJournal(totalRevenue, totalCogsSYP, {
      refId: invoiceId,
      memo: 'فاتورة بيع ' + invoiceId,
      amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? totalRevenue * rates.SYP : null,
    });

    const tenantId = getTenantId(req);
    const createdBy = req.user ? (req.user.fullName || req.user.username || req.user.email || req.user.id) : 'user';
    const invoiceDoc = {
      id: invoiceId,
      tenantId,
      createdBy,
      date: new Date().toISOString(),
      customerId: customerId || null,
      items: items.map((l) => ({
        productId: l.productId,
        unitId: l.unitId || 'piece',
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
      totalRevenue,
      totalCogsSYP,
    };
    salesInvoices.push(invoiceDoc);

    res.status(201).json({
      success: true,
      data: {
        invoiceId,
        totalRevenue,
        totalCogsSYP,
        movements,
        customerId: customerId || null,
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
    const { invoiceId, items = [], refundToCash = true } = req.body;
    if (!invoiceId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'invoiceId and items array required' });
    }
    const inv = salesInvoices.find((i) => i.id === invoiceId && (i.tenantId || 'default') === tenantId);
    if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const returnId = 'sret-' + Date.now();
    let totalAmount = 0;
    const movements = [];

    for (const line of items) {
      const { productId, unitId, returnQuantity, unitPrice } = line;
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
      totalAmount += returnQty * price;

      const rule = fractioning.getFractioningRule(productId, u);
      if (rule) {
        const bulkQty = Math.ceil(returnQty / rule.factor);
        fractioning.addBulkInventory(productId, rule.bulkUnitId, bulkQty);
        fifo.receiveLot(productId, rule.bulkUnitId, bulkQty, 0);
      } else {
        fractioning.addBulkInventory(productId, u, returnQty);
        fifo.receiveLot(productId, u, returnQty, 0);
      }
      const mov = recordStockMovement(productId, u, returnQty, 'in', 'sales_return', returnId);
      movements.push(mov);
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

    const doc = {
      id: returnId,
      tenantId,
      invoiceId,
      date: new Date().toISOString(),
      items: items.filter((l) => (Number(l.returnQuantity) || 0) > 0),
      totalAmount,
      refundToCash,
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
    const { items, supplierId, payWithCash, memo, createdBy } = req.body;
    const result = procurement.postPurchaseInvoice({ items: items || [], supplierId, payWithCash: !!payWithCash, memo, createdBy: createdBy || 'user' });
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
    const result = manufacturing.saveBOM({ ...req.body, id: req.params.id });
    if (!result.success) return res.status(400).json(result);
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
    const { accountId, amountSYP, memo, date, createdBy } = req.body;
    const result = expenses.recordExpense({ accountId, amountSYP, memo, date, createdBy });
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
  const { logoUrl, taxId, defaultCurrency, name } = req.body;
  if (logoUrl !== undefined) store.companyProfile.logoUrl = logoUrl;
  if (taxId !== undefined) store.companyProfile.taxId = taxId;
  if (defaultCurrency !== undefined) store.companyProfile.defaultCurrency = defaultCurrency;
  if (name !== undefined) store.companyProfile.name = name;
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

// —— Multi-currency (live SYP sync) ——
router.get('/multi-currency/rates', (req, res) => {
  res.json({ success: true, data: multiCurrency.getRates() });
});

router.post('/multi-currency/rates', (req, res) => {
  try {
    const { currency, rate } = req.body;
    if (!currency || rate == null) return res.status(400).json({ success: false, error: 'currency and rate required' });
    const data = multiCurrency.setRate(currency, rate);
    res.json({ success: true, data });
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
