/**
 * Product & Unit models.
 * Products can be sold in multiple units; fractioning links bulk to sub-units.
 */

export function createProduct({ id, name, sku, defaultUnitId, costPerDefaultUnit = 0 }) {
  return { id, name, sku, defaultUnitId, costPerDefaultUnit, active: true };
}

export function createUnit({ id, name, symbol, type = 'discrete' }) {
  return { id, name, symbol, type };
}

export function createFractioningRule({
  id,
  productId,
  bulkUnitId,
  subUnitId,
  factor,
  costPerSubUnit = null,
  pricePerSubUnit = null,
}) {
  return {
    id,
    productId,
    bulkUnitId,
    subUnitId,
    factor,
    costPerSubUnit,
    pricePerSubUnit,
  };
}

export function createInventoryLevel({ productId, unitId, quantity, reserved = 0 }) {
  return { productId, unitId, quantity, reserved };
}

export function createPrice({ productId, unitId, price, currencyId = 'default' }) {
  return { productId, unitId, price, currencyId };
}
