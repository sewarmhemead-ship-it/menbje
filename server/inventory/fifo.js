/**
 * FIFO (First-In-First-Out) costing for inventory.
 * Lots are stored per (productId, unitId). Consumption returns COGS from oldest lots.
 * Used by Smart Fractioning: selling pieces consumes carton lots and computes exact profit.
 */

import { store, getNextId } from '../config/store.js';

const { inventoryLots, inventoryByProduct } = store;

function getInventoryKey(productId, unitId) {
  return `${productId}:${unitId}`;
}

/**
 * Record a purchase/receipt: add a lot and update aggregate inventory.
 */
export function receiveLot(productId, unitId, quantity, unitCostSYP) {
  const id = getNextId('inventoryLots');
  const lot = {
    id,
    productId,
    unitId,
    quantity: Number(quantity),
    unitCostSYP: Number(unitCostSYP),
    receivedAt: new Date().toISOString(),
    remaining: Number(quantity),
  };
  inventoryLots.push(lot);

  const key = getInventoryKey(productId, unitId);
  const agg = inventoryByProduct.get(key) || { productId, unitId, quantity: 0, reserved: 0 };
  agg.quantity = (agg.quantity || 0) + Number(quantity);
  inventoryByProduct.set(key, agg);

  return lot;
}

/**
 * إضافة مرتجع كدفعة (Lot) جديدة بتكلفتها الأصلية لاستهلاكها لاحقاً وفق FIFO.
 * يُستخدم عند استلام مرتجع مبيعات؛ التكلفة من costAtMovement في حركة الخروج الأصلية.
 * @param {string} productId
 * @param {string} unitId
 * @param {number} quantity
 * @param {number} unitCostSYP - التكلفة الأصلية للوحدة عند الخروج
 * @param {{ isReturn?: boolean }} opts - isReturn: true (افتراضي) لتمييز الدفعة كمرتجع
 * @returns {{ lot, success: boolean }}
 */
export function addReturnLot(productId, unitId, quantity, unitCostSYP, opts = {}) {
  const isReturn = opts.isReturn !== false;
  const id = getNextId('inventoryLots');
  const qty = Number(quantity);
  const cost = Number(unitCostSYP) || 0;
  const lot = {
    id,
    productId,
    unitId,
    quantity: qty,
    unitCostSYP: cost,
    receivedAt: new Date().toISOString(),
    remaining: qty,
    isReturn: !!isReturn,
  };
  inventoryLots.push(lot);

  const key = getInventoryKey(productId, unitId);
  const agg = inventoryByProduct.get(key) || { productId, unitId, quantity: 0, reserved: 0 };
  agg.quantity = (agg.quantity || 0) + qty;
  inventoryByProduct.set(key, agg);

  return { success: true, lot };
}

/**
 * استهلاك كمية من أقدم الدفعات (FIFO). يُستخدم من محرك التجزئة عند البيع بالوحدة الكبرى أو عند كسر كرتونة.
 * الربط مع التجزئة: sellInSubUnits تستدعي consumeFIFO عند الحاجة لكرتونات (bulkUnitId)؛ الناتج cogsSYP يُستخدم
 * في القيد المحاسبي وتكلفة القطع المتبقية في "مخزن القطع المفتوحة".
 * @param {string} productId
 * @param {string} unitId - وحدة الدفعة (كرتون أو وحدة كبرى)
 * @param {number} quantityNeeded
 * @returns {{ consumed, cogsSYP, lotsUsed, error? }}
 */
export function consumeFIFO(productId, unitId, quantityNeeded) {
  const qty = Number(quantityNeeded);
  if (qty <= 0) return { consumed: 0, cogsSYP: 0, lotsUsed: [] };

  const available = getFIFOQuantity(productId, unitId);
  if (qty > available) {
    return {
      consumed: 0,
      cogsSYP: 0,
      lotsUsed: [],
      error: 'كمية غير كافية في المخزون: المطلوب ' + qty + '، المتاح ' + available,
    };
  }

  const eligible = inventoryLots
    .filter(
      (l) =>
        l.productId === productId &&
        l.unitId === unitId &&
        l.remaining > 0
    )
    .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));

  let remaining = qty;
  let cogsSYP = 0;
  const lotsUsed = [];

  for (const lot of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remaining, remaining);
    lot.remaining -= take;
    remaining -= take;
    cogsSYP += take * lot.unitCostSYP;
    lotsUsed.push({ lotId: lot.id, quantity: take, unitCostSYP: lot.unitCostSYP });
  }

  const consumed = qty - remaining;
  const key = getInventoryKey(productId, unitId);
  const agg = inventoryByProduct.get(key);
  if (agg) {
    agg.quantity = Math.max(0, (agg.quantity || 0) - consumed);
    inventoryByProduct.set(key, agg);
  }

  return { consumed, cogsSYP, lotsUsed };
}

/**
 * Get total quantity available in FIFO lots for (productId, unitId).
 */
export function getFIFOQuantity(productId, unitId) {
  return inventoryLots
    .filter((l) => l.productId === productId && l.unitId === unitId && l.remaining > 0)
    .reduce((sum, l) => sum + l.remaining, 0);
}

/**
 * List lots for a product (for reporting).
 */
export function listLots(productId, unitId = null) {
  return inventoryLots.filter(
    (l) =>
      l.productId === productId &&
      (unitId == null || l.unitId === unitId) &&
      l.remaining > 0
  );
}
