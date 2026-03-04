/**
 * Smart Fractioning Engine
 * Links bulk units to sub-units. Uses FIFO for exact COGS when lots exist; else rule/product cost.
 */

import { store, getNextId } from '../../config/store.js';
import * as fifo from '../../inventory/fifo.js';

const { fractioningRules, inventoryByProduct, products, units, inventoryLots } = store;

function getRuleKey(productId, subUnitId) {
  return `${productId}:${subUnitId}`;
}

function getInventoryKey(productId, unitId) {
  return `${productId}:${unitId}`;
}

/**
 * Register a fractioning rule: 1 bulkUnit = factor × subUnit.
 * e.g. 1 Carton = 24 Pieces → { bulkUnitId: 'carton', subUnitId: 'piece', factor: 24 }
 */
export function registerFractioningRule(productId, bulkUnitId, subUnitId, factor, costPerSubUnit = null, pricePerSubUnit = null) {
  const id = getNextId('fractioningRules');
  const rule = {
    id,
    productId,
    bulkUnitId,
    subUnitId,
    factor,
    costPerSubUnit: costPerSubUnit ?? null,
    pricePerSubUnit: pricePerSubUnit ?? null,
  };
  fractioningRules.set(id, rule);
  fractioningRules.set(getRuleKey(productId, subUnitId), rule);
  return rule;
}

/**
 * Get the rule that defines how subUnit relates to bulk for this product.
 */
export function getFractioningRule(productId, subUnitId) {
  return fractioningRules.get(getRuleKey(productId, subUnitId)) || null;
}

/**
 * Set inventory for a product in a given unit (bulk or sub).
 * If sub-unit and a rule exists, we don't store separate sub-unit stock;
 * we derive it from bulk. So we only persist bulk inventory and optionally
 * "sub-unit only" stock if no bulk (e.g. loose items).
 */
export function setBulkInventory(productId, unitId, quantity) {
  const key = getInventoryKey(productId, unitId);
  const existing = inventoryByProduct.get(key) || { productId, unitId, quantity: 0, reserved: 0 };
  existing.quantity = quantity;
  inventoryByProduct.set(key, existing);
  return existing;
}

/** Add quantity to existing bulk inventory (for OCR import). */
export function addBulkInventory(productId, unitId, addQuantity) {
  const key = getInventoryKey(productId, unitId);
  const existing = inventoryByProduct.get(key) || { productId, unitId, quantity: 0, reserved: 0 };
  existing.quantity = (existing.quantity || 0) + Number(addQuantity) || 0;
  inventoryByProduct.set(key, existing);
  return existing;
}

/**
 * Get effective inventory in requested unit.
 * If unit is sub-unit and rule exists: convert bulk to sub (bulkQty * factor).
 */
export function getEffectiveInventory(productId, unitId) {
  const bulkKey = getInventoryKey(productId, unitId);
  let bulkLevel = inventoryByProduct.get(bulkKey);
  if (bulkLevel) return { quantity: bulkLevel.quantity - (bulkLevel.reserved || 0), unitId, isBulk: true };

  // Check if this is a sub-unit with a rule
  const rule = Array.from(fractioningRules.values()).find(
    (r) => r.productId === productId && r.subUnitId === unitId
  );
  if (!rule) return { quantity: 0, unitId, isBulk: false };

  const bulkInv = inventoryByProduct.get(getInventoryKey(productId, rule.bulkUnitId));
  const bulkQty = bulkInv ? bulkInv.quantity - (bulkInv.reserved || 0) : 0;
  return {
    quantity: bulkQty * rule.factor,
    unitId,
    isBulk: false,
    bulkUnitId: rule.bulkUnitId,
    factor: rule.factor,
  };
}

/**
 * Decrement stock when a sale is made in sub-units.
 * Uses FIFO for COGS when lots exist; else rule/product cost. Returns cost in SYP for journal.
 */
export function sellInSubUnits(productId, subUnitId, subQuantity, salePricePerSubUnit, currencyId = 'default') {
  const rule = getFractioningRule(productId, subUnitId);
  if (!rule) {
    return { success: false, error: 'No fractioning rule for this product and sub-unit' };
  }

  const bulkNeeded = Math.ceil(subQuantity / rule.factor);
  const bulkKey = getInventoryKey(productId, rule.bulkUnitId);
  const bulkLevel = inventoryByProduct.get(bulkKey);
  const bulkAvailable = bulkLevel ? bulkLevel.quantity - (bulkLevel.reserved || 0) : 0;
  if (bulkNeeded > bulkAvailable) {
    return { success: false, error: 'Insufficient bulk stock', required: bulkNeeded, available: bulkAvailable };
  }

  let totalCostSYP;
  const fifoResult = fifo.consumeFIFO(productId, rule.bulkUnitId, bulkNeeded);
  if (fifoResult.error && fifoResult.consumed < bulkNeeded) {
    return { success: false, error: fifoResult.error || 'Insufficient FIFO lots' };
  }
  if (fifoResult.consumed > 0) {
    totalCostSYP = fifoResult.cogsSYP;
  } else {
    const costPerSub = rule.costPerSubUnit ?? (products.get(productId)?.costPerDefaultUnit / rule.factor) ?? 0;
    totalCostSYP = costPerSub * subQuantity;
    if (bulkLevel) {
      bulkLevel.quantity -= bulkNeeded;
      inventoryByProduct.set(bulkKey, bulkLevel);
    }
  }

  const totalRevenue = salePricePerSubUnit * subQuantity;
  const profit = totalRevenue - totalCostSYP;

  return {
    success: true,
    productId,
    subUnitId,
    subQuantity,
    decrementedBulk: bulkNeeded,
    bulkUnitId: rule.bulkUnitId,
    cost: totalCostSYP,
    revenue: totalRevenue,
    profit,
    currencyId,
    cogsSYP: totalCostSYP,
  };
}

/**
 * Decrement bulk stock directly (sale in bulk units). Uses FIFO for COGS when lots exist.
 */
export function sellInBulk(productId, bulkUnitId, bulkQuantity, salePricePerBulk, currencyId = 'default') {
  const key = getInventoryKey(productId, bulkUnitId);
  const level = inventoryByProduct.get(key);
  if (!level) return { success: false, error: 'No inventory for this product in bulk unit' };
  const available = level.quantity - (level.reserved || 0);
  if (bulkQuantity > available) {
    return { success: false, error: 'Insufficient stock', required: bulkQuantity, available };
  }

  let costSYP;
  const fifoResult = fifo.consumeFIFO(productId, bulkUnitId, bulkQuantity);
  if (fifoResult.consumed > 0 && !fifoResult.error) {
    costSYP = fifoResult.cogsSYP;
  } else {
    const product = products.get(productId);
    costSYP = (product?.costPerDefaultUnit ?? 0) * bulkQuantity;
    level.quantity -= bulkQuantity;
    inventoryByProduct.set(key, level);
  }

  const revenue = salePricePerBulk * bulkQuantity;
  return {
    success: true,
    productId,
    bulkUnitId,
    bulkQuantity,
    cost: costSYP,
    revenue,
    profit: revenue - costSYP,
    currencyId,
    cogsSYP: costSYP,
  };
}

/**
 * List all fractioning rules (for dashboard/admin).
 */
export function listFractioningRules() {
  const seen = new Set();
  return Array.from(fractioningRules.values()).filter((r) => {
    if (typeof r.productId !== 'undefined' && seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export function getAllInventory() {
  const entries = [];
  for (const [key, inv] of inventoryByProduct) {
    if (key.includes(':')) entries.push({ ...inv, key });
  }
  return entries;
}
