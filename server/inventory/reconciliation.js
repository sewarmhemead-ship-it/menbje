/**
 * موديول تسوية الجرد: مطابقة الرصيد الفعلي مع الرصيد النظامي (FIFO + القطع المفتوحة).
 * عجز: خصم عبر consumeFIFO وقيد (مدين مصاريف عجز، دائن مخزون). زيادة: addReturnLot وقيد (مدين مخزون، دائن أرباح جرد).
 * جميع المبالغ تُقرّب بـ roundCost. كل تسوية تُسجّل في actionLog (INVENTORY_ADJUST) مع إجبار reasonCode.
 */

import { store, getNextId } from '../config/store.js';
import * as fractioning from '../modules/fractioning/engine.js';
import * as fifo from './fifo.js';
import * as journal from '../accounting/journal.js';
import { log, REASON_CODES } from '../audit/actionLog.js';

const { inventoryByProduct, accounts } = store;

const INVENTORY = '1100';
const STOCK_SHORTAGE_EXPENSE = '5210';
const INVENTORY_GAIN = '4110';

const DECIMALS = 2;
function roundCost(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Number(Number(value).toFixed(DECIMALS));
}

function getInventoryKey(productId, unitId) {
  return `${productId}:${unitId}`;
}

/**
 * تسوية الرصيد الفعلي مع الرصيد النظامي (FIFO + وحدات مفتوحة).
 * عجز: خصم الفرق (consumeFIFO أو تخفيض القطع المفتوحة ثم FIFO)، قيد مدين مصاريف عجز مخزون دائن مخزون.
 * زيادة: إضافة الفرق (addReturnLot أو addReturnToOpenSub)، قيد مدين مخزون دائن أرباح جرد.
 */
export function reconcileStock(productId, actualQty, unitId = 'piece', opts = {}) {
  return syncPhysicalStock(productId, actualQty, unitId, opts);
}

export function syncPhysicalStock(productId, actualQty, unitId = 'piece', opts = {}) {
  const actual = Number(actualQty);
  if (Number.isNaN(actual) || actual < 0) {
    return { success: false, error: 'الكمية الفعلية يجب أن تكون رقماً موجباً' };
  }

  const inv = fractioning.getEffectiveInventory(productId, unitId);
  const current = inv?.quantity ?? 0;
  const diff = actual - current;

  if (diff === 0) {
    return { success: true, reconciled: false, message: 'الرصيد مطابق', current, actual };
  }

  const reasonCode = opts.reasonCode || REASON_CODES.INVENTORY_ADJUST;
  const userId = opts.userId || 'system';
  log('INVENTORY_ADJUST', {
    entityType: 'Product',
    entityId: productId,
    oldValue: current,
    newValue: actual,
    reasonCode,
    userId,
    memo: `تسوية جرد يدوية - الفرق: ${diff}`,
  });

  const rule = fractioning.getFractioningRule(productId, unitId);
  const refId = 'recon-' + productId + '-' + unitId + '-' + Date.now();

  if (diff > 0) {
    const addQty = roundCost(diff);
    const product = store.products?.get?.(productId);
    const estimatedCost = roundCost((product?.costPerDefaultUnit ?? 0) * addQty);
    if (rule) {
      fractioning.addReturnToOpenSub(productId, unitId, addQty, estimatedCost);
    } else {
      const costPerUnit = addQty > 0 ? estimatedCost / addQty : 0;
      fifo.addReturnLot(productId, unitId, addQty, costPerUnit, { isReturn: true });
    }
    if (!accounts.has(INVENTORY) || !accounts.has(INVENTORY_GAIN)) {
      return { success: false, error: 'حساب المخزون أو أرباح الجرد غير موجود' };
    }
    const entry = journal.postCompoundEntry(
      [
        { accountId: INVENTORY, debit: estimatedCost, credit: 0 },
        { accountId: INVENTORY_GAIN, debit: 0, credit: estimatedCost },
      ],
      { refType: 'inventory_reconcile', refId, memo: 'زيادة جرد ' + productId + ' ' + unitId, createdBy: 'system' }
    );
    if (!entry.success) return { success: false, error: entry.error };
    return {
      success: true,
      reconciled: true,
      type: 'surplus',
      current,
      actual,
      diff: addQty,
      costSYP: estimatedCost,
      entry: entry.entry,
    };
  }

  const shortfall = roundCost(-diff);
  let costSYP = 0;

  if (rule) {
    const subKey = getInventoryKey(productId, unitId);
    const bulkKey = getInventoryKey(productId, rule.bulkUnitId);
    let openSub = inventoryByProduct.get(subKey);
    const openQty = openSub ? (openSub.quantity || 0) - (openSub.reserved || 0) : 0;
    let remaining = shortfall;

    if (openQty > 0) {
      const take = Math.min(openQty, remaining);
      const totalCost = openSub.totalCostSYP || 0;
      const totalQty = openSub.quantity || 0;
      const costPer = totalQty > 0 ? totalCost / totalQty : 0;
      costSYP += roundCost(take * costPer);
      openSub.quantity = (openSub.quantity || 0) - take;
      openSub.totalCostSYP = roundCost(Math.max(0, (openSub.totalCostSYP || 0) - take * costPer));
      inventoryByProduct.set(subKey, openSub);
      remaining -= take;
    }

    if (remaining > 0) {
      const bulkNeeded = Math.ceil(remaining / rule.factor);
      const fifoResult = fifo.consumeFIFO(productId, rule.bulkUnitId, bulkNeeded);
      if (fifoResult.error) {
        return { success: false, error: fifoResult.error };
      }
      const consumedSub = fifoResult.consumed * rule.factor;
      const costFromBulk = fifoResult.cogsSYP || 0;
      const costPerSub = consumedSub > 0 ? costFromBulk / consumedSub : 0;
      costSYP += roundCost(Math.min(remaining, consumedSub) * costPerSub);
    }
  } else {
    const fifoResult = fifo.consumeFIFO(productId, unitId, shortfall);
    if (fifoResult.error) {
      return { success: false, error: fifoResult.error };
    }
    costSYP = roundCost(fifoResult.cogsSYP || 0);
  }

  if (!accounts.has(STOCK_SHORTAGE_EXPENSE) || !accounts.has(INVENTORY)) {
    return { success: false, error: 'حساب مصاريف العجز أو المخزون غير موجود' };
  }

  const entry = journal.postCompoundEntry(
    [
      { accountId: STOCK_SHORTAGE_EXPENSE, debit: costSYP, credit: 0 },
      { accountId: INVENTORY, debit: 0, credit: costSYP },
    ],
    { refType: 'inventory_reconcile', refId, memo: 'عجز جرد ' + productId + ' ' + unitId, createdBy: 'system' }
  );

  if (!entry.success) return { success: false, error: entry.error };

  return {
    success: true,
    reconciled: true,
    type: 'shortfall',
    current,
    actual,
    diff: shortfall,
    costSYP,
    entry: entry.entry,
  };
}
