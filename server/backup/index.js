/**
 * Data Safety & Portability: Backup (export) and Restore (import) for the central store.
 * Does not duplicate existing store or journal logic; only serializes/deserializes.
 */

import { store } from '../config/store.js';

const BACKUP_VERSION = 1;
const MAP_KEYS = [
  'products', 'units', 'fractioningRules', 'inventoryByProduct', 'orders', 'draftOrders',
  'accounts', 'exchangeRates', 'users', 'sessions',
];
const ARRAY_KEYS = [
  'inventoryLots', 'barterLedger', 'barterSurplus', 'barterNeeds', 'barterMatchAlerts',
  'journalEntriesList', 'vouchers', 'stockMovements', 'debtLedger', 'actionLog', 'visionCache',
  'purchaseInvoices', 'purchaseReturns', 'boms', 'expenseRecords', 'debtLinkTokens',
];
const OBJECT_KEYS = ['companyProfile'];

/**
 * Export full store to a JSON-serializable object. Maps → array of entries.
 */
export function exportBackup() {
  const payload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
  };
  for (const key of MAP_KEYS) {
    const m = store[key];
    payload[key] = m instanceof Map ? Array.from(m.entries()) : [];
  }
  for (const key of ARRAY_KEYS) {
    const a = store[key];
    payload[key] = Array.isArray(a) ? [...a] : [];
  }
  for (const key of OBJECT_KEYS) {
    const o = store[key];
    payload[key] = o && typeof o === 'object' && !Array.isArray(o) ? { ...o } : (store[key] || {});
  }
  return payload;
}

/**
 * Validate backup payload has expected structure (version and key presence).
 */
function validateBackup(data) {
  if (!data || typeof data !== 'object') return { valid: false, error: 'Invalid backup: not an object' };
  if (data.version !== BACKUP_VERSION) return { valid: false, error: 'Invalid backup: unsupported version' };
  for (const key of MAP_KEYS) {
    if (!Array.isArray(data[key])) return { valid: false, error: 'Invalid backup: missing or invalid ' + key };
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(data[key])) return { valid: false, error: 'Invalid backup: missing or invalid ' + key };
  }
  for (const key of OBJECT_KEYS) {
    if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))
      return { valid: false, error: 'Invalid backup: missing or invalid ' + key };
  }
  return { valid: true };
}

/**
 * Overwrite store with backup data. Call after validateBackup.
 */
export function restoreBackup(data) {
  for (const key of MAP_KEYS) {
    const entries = data[key];
    store[key].clear();
    if (Array.isArray(entries)) {
      for (const [k, v] of entries) store[key].set(k, v);
    }
  }
  for (const key of ARRAY_KEYS) {
    const arr = store[key];
    arr.length = 0;
    if (Array.isArray(data[key])) arr.push(...data[key]);
  }
  for (const key of OBJECT_KEYS) {
    const o = data[key];
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      Object.keys(store[key]).forEach((k) => delete store[key][k]);
      Object.assign(store[key], o);
    }
  }
}

/**
 * Validate and restore in one step. Returns { success, error }.
 */
export function validateAndRestore(data) {
  const v = validateBackup(data);
  if (!v.valid) return { success: false, error: v.error };
  restoreBackup(data);
  return { success: true };
}
