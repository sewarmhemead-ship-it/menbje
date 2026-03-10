/**
 * Action Log (Audit Trail) for fraud analysis and compliance.
 * Records every price change, entry deletion, and sensitive mutations with a reason-code.
 */

import { store, getNextId } from '../config/store.js';

const { actionLog } = store;

export const REASON_CODES = {
  PRICE_CHANGE: 'PRICE_CHANGE',
  ENTRY_DELETE: 'ENTRY_DELETE',
  ENTRY_VOID: 'ENTRY_VOID',
  INVENTORY_ADJUST: 'INVENTORY_ADJUST',
  BARTER_CONFIRM: 'BARTER_CONFIRM',
  MANUAL_JOURNAL: 'MANUAL_JOURNAL',
  USER_EDIT: 'USER_EDIT',
  SYSTEM: 'SYSTEM',
};

/**
 * Log an action. Reason-code is required for deletions and price changes.
 */
export function log(action, opts = {}) {
  const {
    entityType = null,
    entityId = null,
    oldValue = null,
    newValue = null,
    reasonCode = null,
    userId = 'system',
    memo = '',
  } = opts;

  const id = getNextId('actionLog');
  const entry = {
    id,
    action,
    entityType,
    entityId,
    oldValue,
    newValue,
    reasonCode,
    userId,
    memo,
    at: new Date().toISOString(),
  };
  actionLog.push(entry);
  return entry;
}

/**
 * Log a price change (product, rule, or account).
 */
export function logPriceChange(entityType, entityId, oldPrice, newPrice, userId, reasonCode) {
  return log('PRICE_CHANGE', {
    entityType,
    entityId,
    oldValue: oldPrice,
    newValue: newPrice,
    reasonCode: reasonCode || REASON_CODES.PRICE_CHANGE,
    userId,
  });
}

/**
 * Log journal entry deletion/void. Stores deleted entry snapshot as oldValue for audit.
 */
export function logEntryDelete(entryId, reasonCode, userId, oldEntrySnapshot = null) {
  return log('ENTRY_DELETE', {
    entityType: 'JournalEntry',
    entityId: entryId,
    oldValue: oldEntrySnapshot,
    newValue: null,
    reasonCode: reasonCode || REASON_CODES.ENTRY_DELETE,
    userId,
  });
}

/**
 * Log any entity edit (who changed what: old vs new).
 */
export function logEntityEdit(action, entityType, entityId, oldValue, newValue, userId = 'system', reasonCode = null) {
  return log(action || 'USER_EDIT', {
    entityType,
    entityId,
    oldValue,
    newValue,
    reasonCode: reasonCode || REASON_CODES.USER_EDIT,
    userId,
  });
}

export function listActionLog(filters = {}) {
  let list = [...(store.actionLog || [])].reverse();
  if (filters.action) list = list.filter((e) => e.action === filters.action);
  if (filters.entityType) list = list.filter((e) => e.entityType === filters.entityType);
  if (filters.fromDate) list = list.filter((e) => e.at >= filters.fromDate);
  return list.slice(0, filters.limit ?? 200);
}
