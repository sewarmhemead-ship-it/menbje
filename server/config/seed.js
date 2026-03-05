/**
 * Seed demo data: CoA, products, units, fractioning rules, FIFO lots, barter needs.
 */

import { store, getNextId } from './store.js';
import { DEFAULT_CHART } from '../accounting/chartOfAccounts.js';
import * as fractioning from '../modules/fractioning/engine.js';
import * as barter from '../modules/barter/index.js';
import * as fifo from '../inventory/fifo.js';

const { products, units, accounts, users } = store;

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

  const p1 = getNextId('products');
  const p2 = getNextId('products');
  const p3 = getNextId('products');
  products.set(p1, {
    id: p1,
    tenantId: 'default',
    name: 'Tomato Paste Can',
    sku: 'TP-001',
    defaultUnitId: 'carton',
    costPerDefaultUnit: 24,
    active: true,
  });
  products.set(p2, {
    id: p2,
    tenantId: 'default',
    name: 'Olive Oil',
    sku: 'OO-002',
    defaultUnitId: 'carton',
    costPerDefaultUnit: 60,
    active: true,
  });
  products.set(p3, {
    id: p3,
    tenantId: 'default',
    name: 'Milk',
    sku: 'MLK-003',
    defaultUnitId: 'piece',
    costPerDefaultUnit: 2,
    active: true,
  });

  fractioning.registerFractioningRule(p1, 'carton', 'piece', 24, 1.2, 1.8);
  fractioning.registerFractioningRule(p2, 'carton', 'piece', 12, 5, 7.5);

  // FIFO lots (cost in SYP; same as costPerDefaultUnit per bulk unit)
  fifo.receiveLot(p1, 'carton', 50, 24);
  fifo.receiveLot(p2, 'carton', 30, 60);
  fifo.receiveLot(p3, 'piece', 100, 2);

  const tomato = products.get(p1);
  barter.addNeed(p1, tomato?.name, 5, 'user-demo');
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
