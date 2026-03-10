/**
 * Logic Bridge: central stock movement recording for Sales, Accounting, and Inventory.
 * recordStockMovement(productId, unitId, quantity, type, refType, refId, costAtMovement) writes to store.stockMovements.
 * Used by: POST /api/sales/invoice, fractioning POST /sell-sub and POST /sell-bulk, procurement, manufacturing.
 * costAtMovement يسمح بتقرير "قيمة المخزن في أي تاريخ سابق" وعكس العملية (Undo) بدقة.
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
 * @param {number|null} costAtMovement - تكلفة الوحدة أو الإجمالي وقت الحركة (SYP) لتقارير القيمة والتدقيق
 * @returns {{ id, productId, unitId, quantity, type, refType, refId, date, costAtMovement }}
 */
export function recordStockMovement(productId, unitId, quantity, type, refType = null, refId = null, costAtMovement = null) {
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
    costAtMovement: costAtMovement != null ? Number(costAtMovement) : null,
  };
  stockMovements.push(record);
  return record;
}
