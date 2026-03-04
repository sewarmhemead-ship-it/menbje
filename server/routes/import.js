/**
 * Smart Data Importer: upload (as base64/text), fuzzy mapping, preview, execute.
 * Accepts CSV or pasted text. Reconstructs products and chart of accounts.
 */

import { Router } from 'express';
import { store, getNextId } from '../config/store.js';
import * as fractioning from '../modules/fractioning/engine.js';
import { parseCSV, suggestMapping, previewFromMapping } from '../modules/import/parser.js';

const router = Router();
const { products, units, accounts } = store;

function ensureDefaultUnits() {
  if (!units.has('piece')) units.set('piece', { id: 'piece', name: 'Piece', symbol: 'pc', type: 'discrete' });
  if (!units.has('unit')) units.set('unit', { id: 'unit', name: 'Unit', symbol: 'u', type: 'discrete' });
}

// Parse: POST body { content: "csv text" or base64 string, fileName?: "x.csv" }
router.post('/parse', (req, res) => {
  try {
    let content = req.body?.content || req.body?.fileContent || '';
    if (req.body?.base64) {
      try { content = Buffer.from(req.body.base64, 'base64').toString('utf8'); } catch (_) { content = ''; }
    }
    const { headers, rows } = parseCSV(content);
    const mapping = suggestMapping(headers);
    const preview = previewFromMapping(rows, mapping);
    res.json({
      success: true,
      data: { headers, rows, mapping, preview, totalRows: rows.length },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Execute migration: POST body { rows, mapping }
router.post('/execute', (req, res) => {
  try {
    const { rows = [], mapping = {} } = req.body || {};
    ensureDefaultUnits();
    const revMap = {};
    for (const [col, field] of Object.entries(mapping)) revMap[field] = col;
    let productsAdded = 0;
    let accountsAdded = 0;
    const existingAccounts = new Set(accounts.keys());
    for (const row of rows) {
      const name = revMap.productName ? String(row[revMap.productName] || '').trim() : '';
      const qty = parseFloat(revMap.quantity ? row[revMap.quantity] : 0) || 0;
      const unitId = (revMap.unitId ? String(row[revMap.unitId] || '').trim() : '') || 'piece';
      const cost = parseFloat(revMap.cost ? row[revMap.cost] : 0) || 0;
      if (name) {
        const id = getNextId('products');
        if (!units.has(unitId)) units.set(unitId, { id: unitId, name: unitId, symbol: unitId, type: 'discrete' });
        products.set(id, { id, name, sku: id.slice(-8), defaultUnitId: unitId, costPerDefaultUnit: cost, active: true });
        fractioning.setBulkInventory(id, unitId, qty);
        productsAdded++;
      }
      const code = revMap.accountCode ? String(row[revMap.accountCode] || '').trim() : '';
      const accName = revMap.accountName ? String(row[revMap.accountName] || '').trim() : '';
      const key = code || accName;
      if (key && !existingAccounts.has(key)) {
        const aid = code || 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        accounts.set(aid, { id: aid, code: code || aid, name: accName || code || 'Imported', type: 'asset', createdAt: new Date().toISOString() });
        existingAccounts.add(key);
        accountsAdded++;
      }
    }
    res.json({
      success: true,
      data: { productsAdded, accountsAdded, message: 'تم الاستيراد بنجاح' },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
