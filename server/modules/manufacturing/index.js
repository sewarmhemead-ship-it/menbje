/**
 * Manufacturing & Assembly (التصنيع): BOM (recipe) and Build.
 * Build deducts raw materials from stock and adds finished product; all to central journal + stockMovements.
 */

import { store, getNextId } from '../../config/store.js';
import * as journal from '../../accounting/journal.js';
import * as fifo from '../../inventory/fifo.js';
import * as fractioning from '../fractioning/engine.js';
import { recordStockMovement } from '../../inventory/stockMovement.js';

const { boms, products, inventoryLots, inventoryByProduct } = store;
const INVENTORY = '1100';

function getInventoryKey(productId, unitId) {
  return `${productId}:${unitId}`;
}

/**
 * Create or update a BOM: finished product + components (quantity per 1 unit of finished).
 */
export function saveBOM({ id = null, finishedProductId, finishedUnitId, components = [] }) {
  if (!finishedProductId || !Array.isArray(components) || components.length === 0) {
    return { success: false, error: 'finishedProductId and non-empty components required' };
  }
  const finishedUnit = finishedUnitId || 'piece';
  const comps = components.map((c) => ({
    productId: c.productId,
    unitId: c.unitId || 'piece',
    quantityPerUnit: Number(c.quantityPerUnit) || 0,
  })).filter((c) => c.productId && c.quantityPerUnit > 0);
  if (comps.length === 0) return { success: false, error: 'At least one component with quantityPerUnit > 0 required' };

  const bomId = id || getNextId('boms');
  const existing = boms.find((b) => b.id === bomId);
  const bom = {
    id: bomId,
    finishedProductId,
    finishedUnitId: finishedUnit,
    components: comps,
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    Object.assign(existing, bom);
    return { success: true, bom: existing };
  }
  boms.push(bom);
  return { success: true, bom };
}

export function getBOM(id) {
  return boms.find((b) => b.id === id) || null;
}

export function listBOMs(finishedProductId = null) {
  let list = [...boms];
  if (finishedProductId) list = list.filter((b) => b.finishedProductId === finishedProductId);
  return list;
}

/**
 * Build: produce quantity of finished product per BOM. Deduct components, add finished; post journal (Dr 1100 Cr 1100 for value transfer).
 */
export function executeBuild({ bomId, quantity, memo = '', createdBy = 'user' }) {
  const bom = getBOM(bomId);
  if (!bom) return { success: false, error: 'BOM not found' };
  const qty = Number(quantity) || 0;
  if (qty <= 0) return { success: false, error: 'quantity must be positive' };

  const buildId = 'build-' + Date.now();
  const { finishedProductId, finishedUnitId, components } = bom;
  const finUnit = finishedUnitId || 'piece';

  // 1) Check and consume components (FIFO), collect total cost
  let totalRawCostSYP = 0;
  const movementsOut = [];
  for (const comp of components) {
    const need = qty * comp.quantityPerUnit;
    if (need <= 0) continue;
    const inv = fractioning.getEffectiveInventory(comp.productId, comp.unitId);
    const available = inv?.quantity ?? 0;
    if (available < need) {
      return {
        success: false,
        error: 'Insufficient raw material',
        productId: comp.productId,
        unitId: comp.unitId,
        required: need,
        available,
      };
    }
    const consumed = fifo.consumeFIFO(comp.productId, comp.unitId, need);
    if (consumed.consumed < need) {
      return { success: false, error: consumed.error || 'FIFO consume failed', productId: comp.productId };
    }
    totalRawCostSYP += consumed.cogsSYP || 0;
    const mov = recordStockMovement(comp.productId, comp.unitId, need, 'out', 'manufacturing', buildId);
    movementsOut.push(mov);
  }

  // 2) Add finished product to stock (at average cost of raw)
  const unitCost = totalRawCostSYP / qty;
  fifo.receiveLot(finishedProductId, finUnit, qty, unitCost);
  const movIn = recordStockMovement(finishedProductId, finUnit, qty, 'in', 'manufacturing', buildId);

  // 3) Journal: transfer value within inventory (Dr 1100 Cr 1100) so ledger stays consistent
  if (totalRawCostSYP > 0) {
    const r = journal.postDoubleEntry(INVENTORY, INVENTORY, totalRawCostSYP, {
      refType: 'manufacturing',
      refId: buildId,
      memo: memo || 'تصنيع ' + buildId,
      createdBy,
    });
    if (!r.success) return r;
  }

  return {
    success: true,
    buildId,
    quantity: qty,
    finishedProductId,
    finishedUnitId: finUnit,
    totalRawCostSYP,
    movementsOut,
    movementIn: movIn,
  };
}
