/**
 * Smart Returns Module – إدارة مرتجعات المبيعات مع تكلفة أصلية ومحاسبة مركبة.
 * يتكامل مع FIFO (addReturnLot)، التجزئة (addReturnToOpenSub)، والقيد المركب (postCompoundEntry).
 */

import { store, getNextId } from '../config/store.js';
import * as journal from '../accounting/journal.js';
import * as fifo from './fifo.js';
import * as fractioning from '../modules/fractioning/engine.js';
import { recordStockMovement } from './stockMovement.js';

const { salesInvoices, stockMovements, accounts } = store;

const SALES_RETURNS = '4010';
const CASH_SYP = '1010';
const DEBTORS = '1200';
const INVENTORY = '1100';
const COGS = '5000';

const COST_DECIMALS = 2;
function roundCost(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Number(Number(value).toFixed(COST_DECIMALS));
}

/**
 * جلب التكلفة الأصلية من حركات المخزون لصنف خرج في فاتورة معينة.
 * @returns {{ totalCostSYP, totalQuantity, costPerUnit }}
 */
function getOriginalCostFromMovements(saleRefId, productId, unitId) {
  const movements = (stockMovements || []).filter(
    (m) =>
      m.refId === saleRefId &&
      m.refType === 'invoice' &&
      m.productId === productId &&
      (m.unitId || 'piece') === (unitId || 'piece') &&
      m.type === 'out'
  );
  let totalCostSYP = 0;
  let totalQuantity = 0;
  for (const m of movements) {
    const q = Number(m.quantity) || 0;
    totalQuantity += q;
    totalCostSYP += (Number(m.costAtMovement) || 0);
  }
  const costPerUnit = totalQuantity > 0 ? totalCostSYP / totalQuantity : 0;
  return { totalCostSYP, totalQuantity, costPerUnit: roundCost(costPerUnit) };
}

/**
 * معالجة مرتجع مبيعات: استلام البضاعة بتكلفتها الأصلية، وقيد مركب عكسي، وتكامل مع FIFO/التجزئة.
 * المرتجع المتكرر: يُحدّث returnedQuantity في أصناف الفاتورة الأصلية بعد كل مرتجع ناجح، فلا يُسمح بإرجاع أكثر من (الكمية المباعة − المرتجع سابقاً).
 * أرباح/خسائر الصرف: يُمرَّر amountUSDAtTx (قيمة المرتجع بالدولار بسعر الفاتورة) إلى القيد المركب كي لا يحسب تقرير valuation فرق عملة على مبلغ مُلغى.
 *
 * @param {string} saleRefId - رقم الفاتورة الأصلية (مثل inv-2025-0001)
 * @param {Array<{ productId: string, unitId?: string, returnQuantity: number }>} itemsToReturn
 * @param {Object} opts - { refundToCash?: boolean, memo?: string, returnId?: string, createdBy?: string }
 * @returns {{ success: boolean, returnId?: string, entry?: object, movements?: Array, error?: string }}
 */
export function processReturn(saleRefId, itemsToReturn, opts = {}) {
  const { refundToCash = true, memo = '', returnId: optsReturnId, createdBy = 'system' } = opts;

  if (!saleRefId || !Array.isArray(itemsToReturn) || itemsToReturn.length === 0) {
    return { success: false, error: 'saleRefId ومصفوفة itemsToReturn مطلوبة' };
  }

  const invoice = salesInvoices.find((inv) => inv.id === saleRefId);
  if (!invoice) {
    return { success: false, error: 'الفاتورة الأصلية غير موجودة: ' + saleRefId };
  }

  const creditAccountId = refundToCash ? CASH_SYP : DEBTORS;
  if (!accounts.has(SALES_RETURNS) || !accounts.has(creditAccountId) || !accounts.has(INVENTORY) || !accounts.has(COGS)) {
    return { success: false, error: 'حساب محاسبي مطلوب غير موجود' };
  }

  const returnId = optsReturnId || 'ret-' + saleRefId + '-' + Date.now();
  const processedLines = [];
  let totalRefundSYP = 0;
  let totalCostReversalSYP = 0;
  const movements = [];

  for (const item of itemsToReturn) {
    const productId = item.productId;
    const unitId = item.unitId || 'piece';
    const returnQty = Number(item.returnQuantity) || 0;
    if (!productId || returnQty <= 0) continue;

    const origLine = invoice.items.find(
      (i) => i.productId === productId && (i.unitId || 'piece') === unitId
    );
    if (!origLine) {
      return { success: false, error: 'صنف غير موجود في الفاتورة', productId, unitId };
    }

    const soldQty = Number(origLine.quantity) || 0;
    const alreadyReturned = Number(origLine.returnedQuantity) || 0;
    const maxReturnable = soldQty - alreadyReturned;
    if (returnQty > maxReturnable) {
      return {
        success: false,
        error: 'كمية المرتجع تتجاوز المتبقي القابل للإرجاع (بعد خصم ما تم إرجاعه سابقاً)',
        productId,
        unitId,
        returnQuantity: returnQty,
        soldQuantity: soldQty,
        alreadyReturned,
        maxReturnable,
      };
    }

    const unitPrice = Number(origLine.unitPrice) || 0;
    const lineRefund = roundCost(returnQty * unitPrice);
    const { costPerUnit, totalQuantity: soldInMovements } = getOriginalCostFromMovements(
      saleRefId,
      productId,
      unitId
    );
    const lineCostSYP = roundCost(returnQty * costPerUnit);

    totalRefundSYP += lineRefund;
    totalCostReversalSYP += lineCostSYP;

    const rule = fractioning.getFractioningRule(productId, unitId);
    if (rule) {
      const addResult = fractioning.addReturnToOpenSub(
        productId,
        unitId,
        returnQty,
        lineCostSYP
      );
      if (!addResult.success) {
        return { success: false, error: addResult.error, productId, unitId };
      }
    } else {
      fifo.addReturnLot(productId, unitId, returnQty, costPerUnit, { isReturn: true });
    }

    const mov = recordStockMovement(
      productId,
      unitId,
      returnQty,
      'in',
      'inventory_return',
      returnId,
      lineCostSYP
    );
    movements.push(mov);

    processedLines.push({
      productId,
      unitId,
      returnQuantity: returnQty,
      unitPrice,
      lineRefund,
      lineCostSYP,
    });
  }

  if (processedLines.length === 0) {
    return { success: false, error: 'لا توجد بنود صالحة للمرتجع' };
  }

  totalRefundSYP = roundCost(totalRefundSYP);
  totalCostReversalSYP = roundCost(totalCostReversalSYP);

  const rateAtTx = invoice.rateAtTx;
  const amountUSDAtTx =
    rateAtTx != null && rateAtTx !== 0 ? totalRefundSYP * rateAtTx : null;

  const lines = [
    { accountId: SALES_RETURNS, debit: totalRefundSYP, credit: 0 },
    { accountId: INVENTORY, debit: totalCostReversalSYP, credit: 0 },
    { accountId: creditAccountId, debit: 0, credit: totalRefundSYP },
    { accountId: COGS, debit: 0, credit: totalCostReversalSYP },
  ];

  const journalResult = journal.postCompoundEntry(lines, {
    refType: 'inventory_return',
    refId: returnId,
    memo: memo || 'مرتجع مخزون ' + saleRefId,
    createdBy,
    amountUSDAtTx,
  });

  if (!journalResult.success) {
    return { success: false, error: journalResult.error };
  }

  for (const line of processedLines) {
    const orig = invoice.items.find(
      (i) =>
        i.productId === line.productId &&
        (i.unitId || 'piece') === line.unitId
    );
    if (orig) {
      orig.returnedQuantity = (Number(orig.returnedQuantity) || 0) + line.returnQuantity;
    }
  }

  return {
    success: true,
    returnId,
    entry: journalResult.entry,
    movements,
    processedLines,
    totalRefundSYP,
    totalCostReversalSYP,
  };
}
