/**
 * Logic Bridge: central stock movement recording for Sales, Accounting, and Inventory.
 * recordStockMovement(productId, unitId, quantity, type, refType, refId) writes to store.stockMovements.
 * Used by: POST /api/sales/invoice, fractioning POST /sell-sub and POST /sell-bulk, procurement, manufacturing.
 */

import { store, getNextId } from '../config/store.js';

const { stockMovements } = store;

/**
 * Push a record into store.stockMovements.
 * @param {string} productId
 * @param {string} unitId
 * @param {number} quantity - positive number (direction is in type)
 * @param {'in'|'out'} type
 * @param {string|null} refType - e.g. 'sale', 'invoice', 'purchase', 'adjustment'
 * @param {string|null} refId - e.g. invoice id, sale ref
 * @returns {{ id, productId, unitId, quantity, type, refType, refId, date }}
 */
export function recordStockMovement(productId, unitId, quantity, type, refType = null, refId = null) {
  const id = getNextId('stockMovements');
  const record = {
    id,
    productId,
    unitId: unitId || 'piece',
    quantity: Number(quantity),
    type: type === 'out' ? 'out' : 'in',
    refType: refType || null,
    refId: refId || null,
    date: new Date().toISOString(),
  };
  stockMovements.push(record);
  return record;
}
