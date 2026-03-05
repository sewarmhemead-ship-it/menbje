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
  users.set('u-demo-basic', { id: 'u-demo-basic', username: 'basic', email: 'basic@demo.local', password: 'demo', fullName: 'مدير أساسي', tier: 'basic', status: 'active', tenantId: 'default', role: 'ADMIN', expiresAt: exp, createdAt: now.toISOString() });
  users.set('u-demo-pro', { id: 'u-demo-pro', username: 'pro', email: 'pro@demo.local', password: 'demo', fullName: 'مدير احترافي', tier: 'pro', status: 'active', tenantId: 'default', role: 'ADMIN', expiresAt: exp, createdAt: now.toISOString() });
  users.set('u-demo-enterprise', { id: 'u-demo-enterprise', username: 'enterprise', email: 'enterprise@demo.local', password: 'demo', fullName: 'مدير مؤسسة', tier: 'enterprise', status: 'active', tenantId: 'default', role: 'ADMIN', expiresAt: exp, createdAt: now.toISOString() });
  users.set('u-demo-cashier', { id: 'u-demo-cashier', username: 'cashier', email: 'cashier@demo.local', password: 'demo', fullName: 'كاشير تجريبي', tier: 'basic', status: 'active', tenantId: 'default', role: 'CASHIER', expiresAt: exp, createdAt: now.toISOString() });
}
