/**
 * Resolve product name (from WhatsApp message) to product + unit + stock + price.
 * Uses live inventory and fractioning for availability and price.
 */

import { store } from '../../config/store.js';
import * as fractioning from '../fractioning/engine.js';

const { products, units } = store;

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find best-matching product by name/sku.
 */
export function findProduct(query) {
  const q = normalize(query);
  if (!q) return null;
  for (const [id, p] of products) {
    if (normalize(p.name).includes(q) || normalize(p.sku || '').includes(q)) return { id, ...p };
  }
  return null;
}

/**
 * Get selling price for product in default or first available unit.
 */
export function getPrice(productId, unitId = null) {
  // If your store has a separate prices map, use it. Here we use fractioning rule or product default.
  const product = products.get(productId);
  if (!product) return null;
  const unitIdToUse = unitId || product.defaultUnitId;
  const rule = unitIdToUse && fractioning.getFractioningRule(productId, unitIdToUse);
  if (rule && rule.pricePerSubUnit != null) {
    return { unitId: rule.subUnitId, price: rule.pricePerSubUnit };
  }
  // Fallback: use product default unit and a dummy price (in real app, load from prices table).
  return { unitId: product.defaultUnitId, price: product.costPerDefaultUnit * 1.5 };
}

/**
 * Get live availability for product (in default or given unit).
 */
export function getAvailability(productId, unitId = null) {
  const product = products.get(productId);
  if (!product) return { available: false, quantity: 0, unitId: null };
  const u = unitId || product.defaultUnitId;
  const inv = fractioning.getEffectiveInventory(productId, u);
  return {
    available: inv.quantity > 0,
    quantity: inv.quantity,
    unitId: inv.unitId,
    bulkUnitId: inv.bulkUnitId,
  };
}

/**
 * Combined: resolve query string to product + availability + price.
 */
export function resolveQuery(productQuery) {
  const product = findProduct(productQuery);
  if (!product) return { found: false, product: null, availability: null, price: null };
  const availability = getAvailability(product.id);
  const price = getPrice(product.id, availability.unitId);
  return {
    found: true,
    product: { id: product.id, name: product.name, sku: product.sku },
    availability,
    price,
  };
}
