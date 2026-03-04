/**
 * Vision module – OCR for invoices; updates FIFO + Purchase Ledger (double-entry).
 * Extracted lines become FIFO lots and post Dr Inventory Cr Cash.
 */

import { store } from '../../config/store.js';
import { findProduct } from '../whatsapp/inventoryResolver.js';
import * as fifo from '../../inventory/fifo.js';
import { postPurchaseJournal } from '../../accounting/transactions.js';

export function getVisionCache() {
  return store.visionCache || [];
}

export function addVisionResult(productId, label, confidence) {
  store.visionCache.push({
    productId,
    label,
    confidence,
    at: new Date().toISOString(),
  });
  return store.visionCache.slice(-20);
}

/**
 * Mock OCR: returns line items with quantity. Unit cost from product (landed cost).
 */
export function mockOcrFromImage(imageBufferOrBase64) {
  const items = [
    { productName: 'Tomato Paste Can', quantity: 10 },
    { productName: 'Olive Oil', quantity: 5 },
    { productName: 'Milk', quantity: 20 },
  ];
  return items;
}

/**
 * Add OCR lines to FIFO (landed cost from product) and post Purchase journal.
 */
export function addOcrLinesToInventory(lines) {
  const results = [];
  let totalCostSYP = 0;

  for (const line of lines || []) {
    const product = findProduct(line.productName);
    if (!product) {
      results.push({ productName: line.productName, quantity: line.quantity, added: false, error: 'Product not found' });
      continue;
    }
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) {
      results.push({ productName: line.productName, quantity: qty, added: false, error: 'Invalid quantity' });
      continue;
    }
    const unitId = product.defaultUnitId || 'piece';
    const unitCostSYP = Number(line.unitCostSYP) ?? product.costPerDefaultUnit ?? 0;
    fifo.receiveLot(product.id, unitId, qty, unitCostSYP);
    totalCostSYP += qty * unitCostSYP;
    addVisionResult(product.id, line.productName, 0.95);
    results.push({
      productName: line.productName,
      productId: product.id,
      quantity: qty,
      unitId,
      unitCostSYP,
      added: true,
    });
  }

  if (totalCostSYP > 0) {
    postPurchaseJournal(totalCostSYP, {
      refId: 'vision-ocr-' + Date.now(),
      memo: 'Purchase from invoice (Vision OCR)',
      createdBy: 'vision',
    });
  }

  return { results, totalCostSYP };
}
