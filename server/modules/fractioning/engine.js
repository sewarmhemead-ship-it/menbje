/**
 * Smart Fractioning Engine
 * Links bulk units to sub-units. Uses FIFO for exact COGS when lots exist; else rule/product cost.
 * يدعم "مخزن القطع المفتوحة": عند كسر كرتونة تُخصم من الكراتين وتُضاف القطع إلى رصيد الوحدة الفرعية.
 * الدقة الرقمية: جميع تكاليف "لكل وحدة" تُقرّب إلى منزلتين عشريتين لمنع تراكم أخطاء الفاصلة العائمة.
 */

import { store, getNextId } from '../../config/store.js';
import * as fifo from '../../inventory/fifo.js';
import * as multiCurrency from '../multiCurrency/index.js';
import * as journal from '../../accounting/journal.js';

const { fractioningRules, inventoryByProduct, products, units, inventoryLots, accounts } = store;

/** تقريب إلى منزلتين عشريتين لمنع تراكم كسور عشرية (Floating Point). */
const COST_DECIMALS = 2;
function roundCost(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Number(Number(value).toFixed(COST_DECIMALS));
}

const CASH_SYP = '1010';
const INVENTORY = '1100';
const REVENUE = '4000';
const COGS = '5000';

function postFractioningSaleJournal(revenueSYP, cogsSYP, opts) {
  const lines = [
    { accountId: CASH_SYP, debit: revenueSYP, credit: 0 },
    { accountId: REVENUE, debit: 0, credit: revenueSYP },
  ];
  if (cogsSYP > 0) {
    lines.push({ accountId: COGS, debit: cogsSYP, credit: 0 });
    lines.push({ accountId: INVENTORY, debit: 0, credit: cogsSYP });
  }
  return journal.postCompoundEntry(lines, {
    refType: opts.refType || 'sale',
    refId: opts.refId,
    memo: opts.memo || 'بيع بالوحدة الفرعية',
    createdBy: opts.createdBy || 'system',
  });
}

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
 * إعادة قطع مرتجعة إلى "مخزن القطع المفتوحة" (وحدة فرعية) مع تحديث التكلفة بشكل تناسبي.
 * يُستخدم عند مرتجع مبيعات كان بالقطعة من كرتونة؛ تُعاد القطع إلى الرصيد المفتوح بنفس التكلفة الأصلية.
 * @param {string} productId
 * @param {string} subUnitId - الوحدة الفرعية (مثلاً piece)
 * @param {number} quantity - عدد القطع المرتجعة
 * @param {number} totalCostSYP - إجمالي تكلفة هذه القطع (من costAtMovement)
 * @returns {{ success: boolean, error?: string }}
 */
export function addReturnToOpenSub(productId, subUnitId, quantity, totalCostSYP) {
  const rule = getFractioningRule(productId, subUnitId);
  if (!rule) {
    return { success: false, error: 'No fractioning rule for this product and sub-unit' };
  }
  const subKey = getInventoryKey(productId, subUnitId);
  const openSub = inventoryByProduct.get(subKey) || {
    productId,
    unitId: subUnitId,
    quantity: 0,
    reserved: 0,
    totalCostSYP: 0,
  };
  const addQty = Number(quantity) || 0;
  const addCost = roundCost(Number(totalCostSYP) || 0);
  openSub.quantity = (openSub.quantity || 0) + addQty;
  openSub.totalCostSYP = roundCost((openSub.totalCostSYP || 0) + addCost);
  inventoryByProduct.set(subKey, openSub);
  return { success: true };
}

/**
 * Get effective inventory in requested unit.
 * If unit is sub-unit and rule exists: (bulkQty * factor) + open sub-unit quantity (قطع مفتوحة).
 */
export function getEffectiveInventory(productId, unitId) {
  const bulkKey = getInventoryKey(productId, unitId);
  let bulkLevel = inventoryByProduct.get(bulkKey);
  if (bulkLevel) return { quantity: bulkLevel.quantity - (bulkLevel.reserved || 0), unitId, isBulk: true };

  const rule = Array.from(fractioningRules.values()).find(
    (r) => r.productId === productId && r.subUnitId === unitId
  );
  if (!rule) return { quantity: 0, unitId, isBulk: false };

  const bulkInv = inventoryByProduct.get(getInventoryKey(productId, rule.bulkUnitId));
  const bulkQty = bulkInv ? bulkInv.quantity - (bulkInv.reserved || 0) : 0;
  const subKey = getInventoryKey(productId, rule.subUnitId);
  const openSub = inventoryByProduct.get(subKey);
  const openSubQty = openSub && openSub.quantity != null ? openSub.quantity - (openSub.reserved || 0) : 0;
  return {
    quantity: bulkQty * rule.factor + openSubQty,
    unitId,
    isBulk: false,
    bulkUnitId: rule.bulkUnitId,
    factor: rule.factor,
    openSubQuantity: openSubQty,
  };
}

/**
 * تكلفة افتراضية للوحدة الفرعية مع مراعاة سعر الصرف (rateAtTx) إن وُجد.
 */
function getFallbackCostPerSubUnit(productId, rule) {
  const product = products.get(productId);
  const raw =
    rule.costPerSubUnit ??
    (product?.costPerDefaultUnit != null ? product.costPerDefaultUnit / rule.factor : 0) ??
    0;
  const nominal = roundCost(raw);
  const rates = multiCurrency.getRates();
  const rateAtTx = rates?.SYP;
  if (rateAtTx != null && rateAtTx !== 0 && product?.costCurrency === 'USD') {
    return roundCost(nominal * rateAtTx);
  }
  return nominal;
}

/**
 * بيع بالوحدة الفرعية: يستهلك من "القطع المفتوحة" أولاً، ثم يكسر كرتونة جديدة عند الحاجة.
 * لا تُفقد الكميات المتبقية؛ تُضاف إلى مخزن الفرعي (productId:subUnitId).
 */
export function sellInSubUnits(productId, subUnitId, subQuantity, salePricePerSubUnit, currencyId = 'default', opts = {}) {
  const rule = getFractioningRule(productId, subUnitId);
  if (!rule) {
    return { success: false, error: 'No fractioning rule for this product and sub-unit' };
  }

  const subKey = getInventoryKey(productId, subUnitId);
  const bulkKey = getInventoryKey(productId, rule.bulkUnitId);
  let openSub = inventoryByProduct.get(subKey) || { productId, unitId: subUnitId, quantity: 0, reserved: 0, totalCostSYP: 0 };
  const openQty = (openSub.quantity || 0) - (openSub.reserved || 0);
  let remainingToSell = subQuantity;
  let totalCostSYP = 0;
  let bulkConsumedThisSale = 0;

  // 1) استهلاك من القطع المفتوحة أولاً
  if (openQty > 0 && remainingToSell > 0) {
    const takeFromOpen = Math.min(openQty, remainingToSell);
    const openTotalCost = openSub.totalCostSYP || 0;
    const openTotalQty = openSub.quantity || 0;
    let costPerOpen = openTotalQty > 0 ? roundCost(openTotalCost / openTotalQty) : 0;
    if (costPerOpen === 0) costPerOpen = getFallbackCostPerSubUnit(productId, rule);
    totalCostSYP += roundCost(takeFromOpen * costPerOpen);
    openSub.quantity = (openSub.quantity || 0) - takeFromOpen;
    openSub.totalCostSYP = roundCost(Math.max(0, (openSub.totalCostSYP || 0) - takeFromOpen * costPerOpen));
    remainingToSell -= takeFromOpen;
    inventoryByProduct.set(subKey, openSub);
  }

  // 2) عند الحاجة، كسر كرتونة (أو أكثر) وإضافة الباقي للمخزن المفتوح
  if (remainingToSell > 0) {
    const bulkLevel = inventoryByProduct.get(bulkKey);
    const bulkAvailable = bulkLevel ? bulkLevel.quantity - (bulkLevel.reserved || 0) : 0;
    const bulkNeeded = Math.ceil(remainingToSell / rule.factor);
    if (bulkNeeded > bulkAvailable) {
      return { success: false, error: 'Insufficient bulk stock', required: bulkNeeded, available: bulkAvailable };
    }

    const fifoResult = fifo.consumeFIFO(productId, rule.bulkUnitId, bulkNeeded);
    if (fifoResult.error || fifoResult.consumed < bulkNeeded) {
      return { success: false, error: fifoResult.error || 'Insufficient FIFO lots' };
    }

    const consumedBulk = fifoResult.consumed;
    const newPiecesFromBulk = consumedBulk * rule.factor;
    const costOfBulk = fifoResult.cogsSYP || 0;
    const costPerPieceFromBulk =
      newPiecesFromBulk > 0 ? roundCost(costOfBulk / newPiecesFromBulk) : 0;

    totalCostSYP += roundCost(remainingToSell * costPerPieceFromBulk);
    const remainderPieces = newPiecesFromBulk - remainingToSell;
    remainingToSell = 0;

    openSub = inventoryByProduct.get(subKey) || { productId, unitId: subUnitId, quantity: 0, reserved: 0, totalCostSYP: 0 };
    openSub.quantity = (openSub.quantity || 0) + remainderPieces;
    openSub.totalCostSYP = roundCost((openSub.totalCostSYP || 0) + remainderPieces * costPerPieceFromBulk);
    inventoryByProduct.set(subKey, openSub);
  }

  const totalRevenue = salePricePerSubUnit * subQuantity;
  const profit = totalRevenue - totalCostSYP;

  let journalResult = null;
  if (opts.postJournal && opts.refId && accounts) {
    journalResult = postFractioningSaleJournal(totalRevenue, totalCostSYP, opts);
  }

  return {
    success: true,
    productId,
    subUnitId,
    subQuantity,
    decrementedBulk: bulkConsumedThisSale,
    bulkUnitId: rule.bulkUnitId,
    cost: roundCost(totalCostSYP),
    revenue: totalRevenue,
    profit: roundCost(totalRevenue - totalCostSYP),
    currencyId,
    cogsSYP: roundCost(totalCostSYP),
    journalEntry: journalResult?.entry ?? null,
  };
}

/**
 * Decrement bulk stock directly (sale in bulk units). Uses FIFO for COGS when lots exist.
 * عند استخدام التكلفة الافتراضية: تُضرب بـ rateAtTx إن كانت العملة USD. خيار postJournal يربط بالقيد المركب.
 */
export function sellInBulk(productId, bulkUnitId, bulkQuantity, salePricePerBulk, currencyId = 'default', opts = {}) {
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
    costSYP = roundCost(fifoResult.cogsSYP);
  } else {
    const product = products.get(productId);
    let defaultCost = (product?.costPerDefaultUnit ?? 0) * bulkQuantity;
    const rates = multiCurrency.getRates();
    if (rates?.SYP != null && rates.SYP !== 0 && product?.costCurrency === 'USD') {
      defaultCost = defaultCost * rates.SYP;
    }
    costSYP = roundCost(defaultCost);
    level.quantity -= bulkQuantity;
    inventoryByProduct.set(key, level);
  }

  const revenue = salePricePerBulk * bulkQuantity;
  let journalResult = null;
  if (opts.postJournal && opts.refId && accounts) {
    journalResult = postFractioningSaleJournal(revenue, costSYP, opts);
  }

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
    journalEntry: journalResult?.entry ?? null,
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
