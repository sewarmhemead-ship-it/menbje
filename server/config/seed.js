/**
 * Seed demo data: CoA, products, units, fractioning rules, FIFO lots, barter needs.
 */

import { store, getNextId } from './store.js';
import { DEFAULT_CHART } from '../accounting/chartOfAccounts.js';
import * as fractioning from '../modules/fractioning/engine.js';
import * as barter from '../modules/barter/index.js';
import * as fifo from '../inventory/fifo.js';
import * as debtLedger from '../accounting/debtLedger.js';

const { products, units, accounts, users, suppliers, exchangeRates } = store;

export function seedDemoData() {
  if (products.size > 0) return;

  // Chart of Accounts (Syrian trade)
  for (const a of DEFAULT_CHART) {
    accounts.set(a.id, { ...a });
  }

  units.set('carton', { id: 'carton', name: 'Carton', symbol: 'ctn', type: 'discrete' });
  units.set('piece', { id: 'piece', name: 'Piece', symbol: 'pc', type: 'discrete' });
  units.set('gram', { id: 'gram', name: 'Gram', symbol: 'g', type: 'continuous' });
  units.set('kg', { id: 'kg', name: 'Kilogram', symbol: 'kg', type: 'continuous' });
  units.set('box', { id: 'box', name: 'علبة', symbol: 'علبة', type: 'discrete' });
  units.set('strip', { id: 'strip', name: 'شريط', symbol: 'شريط', type: 'discrete' });
  units.set('capsule', { id: 'capsule', name: 'كبسولة', symbol: 'كبسولة', type: 'discrete' });
  units.set('spray', { id: 'spray', name: 'بخاخ', symbol: 'بخاخ', type: 'discrete' });
  units.set('dozen', { id: 'dozen', name: 'دزينة', symbol: 'دزينة', type: 'discrete' });
  units.set('set', { id: 'set', name: 'طقم', symbol: 'طقم', type: 'discrete' });
  units.set('linear_meter', { id: 'linear_meter', name: 'متر طولي', symbol: 'م.ط', type: 'continuous' });
  units.set('sq_meter', { id: 'sq_meter', name: 'متر مربع', symbol: 'م²', type: 'continuous' });
  units.set('cubic_meter', { id: 'cubic_meter', name: 'متر مكعب', symbol: 'م³', type: 'continuous' });
  units.set('bag', { id: 'bag', name: 'كيس', symbol: 'كيس', type: 'discrete' });
  units.set('ton', { id: 'ton', name: 'طن', symbol: 'طن', type: 'continuous' });
  units.set('bundle', { id: 'bundle', name: 'ربطة', symbol: 'ربطة', type: 'discrete' });
  units.set('meal', { id: 'meal', name: 'وجبة', symbol: 'وجبة', type: 'discrete' });
  units.set('sandwich', { id: 'sandwich', name: 'ساندويش', symbol: 'ساندويش', type: 'discrete' });
  units.set('order', { id: 'order', name: 'طلب', symbol: 'طلب', type: 'discrete' });
  units.set('person', { id: 'person', name: 'نفر', symbol: 'نفر', type: 'discrete' });
  units.set('ml', { id: 'ml', name: 'ميل ml', symbol: 'مل', type: 'continuous' });
  units.set('tola', { id: 'tola', name: 'توله', symbol: 'توله', type: 'discrete' });
  units.set('bottle', { id: 'bottle', name: 'عبوة', symbol: 'عبوة', type: 'discrete' });
  units.set('board', { id: 'board', name: 'لوح', symbol: 'لوح', type: 'discrete' });
  units.set('fabric_meter', { id: 'fabric_meter', name: 'متر قماش', symbol: 'م.قماش', type: 'continuous' });
  units.set('packet', { id: 'packet', name: 'باكت', symbol: 'باكت', type: 'discrete' });
  units.set('stationery_bundle', { id: 'stationery_bundle', name: 'شدّة', symbol: 'شدّة', type: 'discrete' });

  // Suppliers (low-stock + stress test)
  const sup1 = getNextId('suppliers');
  const sup2 = getNextId('suppliers');
  suppliers.set(sup1, { id: sup1, name: 'مورد المعاجين والزيوت', phone: '0912345678', address: 'دمشق، الميدان', tenantId: 'default', createdAt: new Date().toISOString() });
  suppliers.set(sup2, { id: sup2, name: 'مورد الألبان', phone: '0945678901', address: 'ريف دمشق', tenantId: 'default', createdAt: new Date().toISOString() });
  const sup3 = getNextId('suppliers');
  const sup4 = getNextId('suppliers');
  const sup5 = getNextId('suppliers');
  suppliers.set(sup3, { id: sup3, name: 'Al-Khair Wholesaler', phone: '0933330001', address: 'Damascus', tenantId: 'default', createdAt: new Date().toISOString() });
  suppliers.set(sup4, { id: sup4, name: 'Modern Electronics', phone: '0933330002', address: 'Aleppo', tenantId: 'default', createdAt: new Date().toISOString() });
  suppliers.set(sup5, { id: sup5, name: 'Global Food Co', phone: '0933330003', address: 'Homs', tenantId: 'default', createdAt: new Date().toISOString() });

  const p1 = getNextId('products');
  const p2 = getNextId('products');
  const p3 = getNextId('products');
  products.set(p1, {
    id: p1,
    tenantId: 'default',
    name: 'Tomato Paste Can',
    sku: 'TP-001',
    barcode: '6221000010011',
    defaultUnitId: 'carton',
    costPerDefaultUnit: 24,
    min_stock_level: 80,
    supplierId: sup1,
    base_currency: 'USD',
    base_price: 0.5,
    active: true,
  });
  products.set(p2, {
    id: p2,
    tenantId: 'default',
    name: 'Olive Oil',
    sku: 'OO-002',
    barcode: '6221000010028',
    defaultUnitId: 'carton',
    costPerDefaultUnit: 60,
    min_stock_level: 50,
    supplierId: sup1,
    base_currency: 'SYP',
    base_price: null,
    active: true,
  });
  products.set(p3, {
    id: p3,
    tenantId: 'default',
    name: 'Milk',
    sku: 'MLK-003',
    barcode: '6221000010035',
    defaultUnitId: 'piece',
    costPerDefaultUnit: 2,
    min_stock_level: 200,
    supplierId: sup2,
    base_currency: 'SYP',
    base_price: null,
    active: true,
  });

  // Test Oil: demo for pricing engine & low-stock. After seed + rate 15k SYP/USD:
  // - Barcode 999, base_currency USD, base_price 10 → salesPricePerUnit = 150,000 SYP
  // - min_stock_level 20, current_stock 5 → appears in Low Stock Alerts
  const p4 = getNextId('products');
  products.set(p4, {
    id: p4,
    tenantId: 'default',
    name: 'Test Oil',
    sku: 'TO-999',
    barcode: '999',
    defaultUnitId: 'piece',
    costPerDefaultUnit: 0,
    min_stock_level: 20,
    supplierId: sup1,
    base_currency: 'USD',
    base_price: 10,
    active: true,
  });
  fifo.receiveLot(p4, 'piece', 5, 0);

  // Stress test: diverse inventory (multi-currency, barcode)
  const p5 = getNextId('products');
  const p6 = getNextId('products');
  const p7 = getNextId('products');
  products.set(p5, {
    id: p5,
    tenantId: 'default',
    name: 'iPhone 15',
    sku: 'IP15-888',
    barcode: '888',
    defaultUnitId: 'piece',
    costPerDefaultUnit: 0,
    min_stock_level: 5,
    supplierId: sup4,
    base_currency: 'USD',
    base_price: 800,
    active: true,
  });
  fifo.receiveLot(p5, 'piece', 2, 0);
  products.set(p6, {
    id: p6,
    tenantId: 'default',
    name: 'Sugar 50kg',
    sku: 'SUG-777',
    barcode: '777',
    defaultUnitId: 'bag',
    costPerDefaultUnit: 400000,
    min_stock_level: 10,
    supplierId: sup5,
    base_currency: 'SYP',
    base_price: 400000,
    active: true,
  });
  fifo.receiveLot(p6, 'bag', 50, 400000);
  products.set(p7, {
    id: p7,
    tenantId: 'default',
    name: 'Cooking Oil',
    sku: 'CO-666',
    barcode: '666',
    defaultUnitId: 'piece',
    costPerDefaultUnit: 0,
    min_stock_level: 100,
    supplierId: sup3,
    base_currency: 'USD',
    base_price: 2.5,
    active: true,
  });
  // Cooking Oil: stock 0 (no receiveLot) → out of stock in Low Stock Alerts

  fractioning.registerFractioningRule(p1, 'carton', 'piece', 24, 1.2, 1.8);
  fractioning.registerFractioningRule(p2, 'carton', 'piece', 12, 5, 7.5);

  // FIFO lots (cost in SYP; same as costPerDefaultUnit per bulk unit)
  fifo.receiveLot(p1, 'carton', 50, 24);
  fifo.receiveLot(p2, 'carton', 30, 60);
  fifo.receiveLot(p3, 'piece', 100, 2);

  const tomato = products.get(p1);
  barter.addNeed(p1, tomato?.name, 5, 'user-demo');

  // Currency: 14,850 SYP/USD (stress test) — bulk price update for all USD-linked products
  exchangeRates.set('SYP', 1 / 14850);
  const sypPerUsd = 14850;
  for (const p of products.values()) {
    if ((p.base_currency || 'SYP') !== 'USD') continue;
    const basePrice = p.base_price != null ? Number(p.base_price) : null;
    if (basePrice == null) continue;
    p.salesPricePerUnit = Math.round(basePrice * sypPerUsd);
  }

  // Customers (receivables): Customer A 500k, Customer B 1.2M + sale 10 Sugar (4M) = 5.2M total
  debtLedger.recordDebt(500000, { debtorId: 'Customer A', memo: 'Seed receivable' });
  debtLedger.recordDebt(1200000, { debtorId: 'Customer B', memo: 'Seed receivable' });
  debtLedger.recordDebt(4000000, { debtorId: 'Customer B', memo: 'Sale 10 Sugar 50kg' });

  // --- Full-Scale Stress Test Validation (Dashboard) ---
  // Low Stock Alerts: iPhone 15 (2 < 5), Cooking Oil (0 < 100). Test Oil, Tomato, Olive, Milk per min_level.
  // Profit & Liquidity: Cash (1010+1020), Receivables = 500k + 5.2M = 5.7M, Inventory = warehouse valuation.
  // Search (Ctrl+K): "iPhone" → iPhone 15; "Al-Khair" → Al-Khair Wholesaler (supplier).
  // USD prices @ 14,850: iPhone 15 = 11,880,000 SYP; Cooking Oil = 37,125 SYP; Test Oil = 148,500 SYP; Tomato = 7,425 SYP.
}

export function seedUsers() {
  if (users.size > 0) return;
  const now = new Date();
  const exp = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  users.set('u-demo-basic', { id: 'u-demo-basic', username: 'basic', email: 'basic@demo.local', password: 'password123', fullName: 'مدير أساسي', tier: 'basic', status: 'active', tenantId: 'default', role: 'ADMIN', industryType: 'GENERAL', expiresAt: exp, createdAt: now.toISOString() });
  users.set('u-demo-pro', { id: 'u-demo-pro', username: 'pro', email: 'pro@demo.local', password: 'demo', fullName: 'مدير احترافي', tier: 'pro', status: 'active', tenantId: 'default', role: 'ADMIN', industryType: 'GENERAL', expiresAt: exp, createdAt: now.toISOString() });
  users.set('u-demo-enterprise', { id: 'u-demo-enterprise', username: 'enterprise', email: 'enterprise@demo.local', password: 'demo', fullName: 'مدير مؤسسة', tier: 'enterprise', status: 'active', tenantId: 'default', role: 'ADMIN', industryType: 'GENERAL', expiresAt: exp, createdAt: now.toISOString() });
  users.set('u-demo-cashier', { id: 'u-demo-cashier', username: 'cashier', email: 'cashier@demo.local', password: 'demo', fullName: 'كاشير تجريبي', tier: 'basic', status: 'active', tenantId: 'default', role: 'CASHIER', industryType: 'SUPERMARKET', expiresAt: exp, createdAt: now.toISOString() });
}

/** Dev/admin master key: always present so login works and session is valid (used with JWT on serverless). */
export function ensureDevAdmin() {
  const now = new Date();
  const exp = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const id = 'u-admin-vault';
  users.set(id, {
    id,
    username: 'admin',
    email: 'admin@vault.local',
    password: 'admin123',
    fullName: 'Admin',
    tier: 'enterprise',
    status: 'active',
    tenantId: 'default',
    role: 'SUPER_ADMIN',
    industryType: 'GENERAL',
    expiresAt: exp,
    createdAt: now.toISOString(),
  });
}
