/**
 * REST API for Smart Fractioning Engine.
 * Sales auto-post double-entry (Dr Cash, Cr Revenue; Dr COGS, Cr Inventory).
 */

import { Router } from 'express';
import * as engine from './engine.js';
import { store } from '../../config/store.js';
import { postSaleJournal } from '../../accounting/transactions.js';
import { recordStockMovement } from '../../inventory/stockMovement.js';
import * as multiCurrency from '../multiCurrency/index.js';
import * as audit from '../../audit/actionLog.js';

const router = Router();

router.get('/rules', (req, res) => {
  try {
    const rules = engine.listFractioningRules();
    res.json({ success: true, data: rules });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/rules', (req, res) => {
  try {
    const { productId, bulkUnitId, subUnitId, factor, costPerSubUnit, pricePerSubUnit } = req.body;
    if (!productId || !bulkUnitId || !subUnitId || factor == null) {
      return res.status(400).json({ success: false, error: 'productId, bulkUnitId, subUnitId, factor required' });
    }
    const rule = engine.registerFractioningRule(
      productId,
      bulkUnitId,
      subUnitId,
      Number(factor),
      costPerSubUnit != null ? Number(costPerSubUnit) : null,
      pricePerSubUnit != null ? Number(pricePerSubUnit) : null
    );
    if (pricePerSubUnit != null || costPerSubUnit != null) {
      audit.log('PRICE_CHANGE', { entityType: 'FractioningRule', entityId: rule.id, newValue: { pricePerSubUnit: rule.pricePerSubUnit, costPerSubUnit: rule.costPerSubUnit }, reasonCode: 'RULE_CREATE' });
    }
    res.status(201).json({ success: true, data: rule });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/inventory/:productId/:unitId', (req, res) => {
  try {
    const { productId, unitId } = req.params;
    const inv = engine.getEffectiveInventory(productId, unitId);
    res.json({ success: true, data: inv });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/sell-sub', (req, res) => {
  try {
    const { productId, subUnitId, subQuantity, salePricePerSubUnit, currencyId } = req.body;
    const result = engine.sellInSubUnits(
      productId,
      subUnitId,
      Number(subQuantity),
      Number(salePricePerSubUnit),
      currencyId || 'SYP'
    );
    if (!result.success) return res.status(400).json(result);

    const rates = multiCurrency.getRates();
    const amountSYP = result.revenue;
    const cogsSYP = result.cogsSYP ?? result.cost ?? 0;
    const refId = result.productId + '-sub-' + Date.now();
    postSaleJournal(amountSYP, cogsSYP, {
      refId,
      memo: `Sale sub ${result.subQuantity} ${result.subUnitId}`,
      amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? amountSYP * rates.SYP : null,
    });
    // Logic Bridge: sync inventory with central stock movements
    recordStockMovement(result.productId, result.subUnitId, result.subQuantity, 'out', 'sale', refId);

    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/sell-bulk', (req, res) => {
  try {
    const { productId, bulkUnitId, bulkQuantity, salePricePerBulk, currencyId } = req.body;
    const result = engine.sellInBulk(
      productId,
      bulkUnitId,
      Number(bulkQuantity),
      Number(salePricePerBulk),
      currencyId || 'SYP'
    );
    if (!result.success) return res.status(400).json(result);

    const rates = multiCurrency.getRates();
    const amountSYP = result.revenue;
    const cogsSYP = result.cogsSYP ?? result.cost ?? 0;
    const refId = result.productId + '-bulk-' + Date.now();
    postSaleJournal(amountSYP, cogsSYP, {
      refId,
      memo: `Sale bulk ${result.bulkQuantity} ${result.bulkUnitId}`,
      amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? amountSYP * rates.SYP : null,
    });
    // Logic Bridge: sync inventory with central stock movements
    recordStockMovement(result.productId, result.bulkUnitId, result.bulkQuantity, 'out', 'sale', refId);

    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/inventory', (req, res) => {
  try {
    const data = engine.getAllInventory();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
