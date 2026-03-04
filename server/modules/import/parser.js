/**
 * Zero-config parser: CSV/text and fuzzy column mapping for Vault AI.
 * Maps columns like اسم المادة, Qty, Product Name -> productId/name, quantity, etc.
 */

const PRODUCT_ALIASES = ['اسم المادة', 'اسم المنتج', 'product name', 'product', 'productid', 'item', 'المادة', 'المنتج', 'name', 'اسم'];
const QTY_ALIASES = ['qty', 'quantity', 'الكمية', 'كمية', 'stock', 'المخزون', 'عدد', 'amount'];
const UNIT_ALIASES = ['unit', 'وحدة', 'الوحدة', 'unit id', 'unitid'];
const COST_ALIASES = ['cost', 'تكلفة', 'التكلفة', 'price', 'السعر', 'سعر'];
const ACCOUNT_CODE_ALIASES = ['code', 'كود', 'رمز الحساب', 'account code', 'رقم الحساب'];
const ACCOUNT_NAME_ALIASES = ['account name', 'اسم الحساب', 'اسم الحساب', 'حساب', 'account'];
const CLIENT_ALIASES = ['client', 'عميل', 'العميل', 'customer', 'debtor', 'اسم العميل'];

export function parseCSV(text) {
  const lines = (text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => (h || '').trim().replace(/^["']|["']$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => (v || '').trim().replace(/^["']|["']$/g, ''));
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] != null ? vals[j] : ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function bestMatch(header, aliases) {
  const n = normalize(header);
  for (const a of aliases) {
    if (n.includes(normalize(a)) || normalize(a).includes(n)) return true;
  }
  return false;
}

export function suggestMapping(headers) {
  const mapping = {};
  for (const h of headers) {
    if (bestMatch(h, PRODUCT_ALIASES)) mapping[h] = 'productName';
    else if (bestMatch(h, QTY_ALIASES)) mapping[h] = 'quantity';
    else if (bestMatch(h, UNIT_ALIASES)) mapping[h] = 'unitId';
    else if (bestMatch(h, COST_ALIASES)) mapping[h] = 'cost';
    else if (bestMatch(h, ACCOUNT_CODE_ALIASES)) mapping[h] = 'accountCode';
    else if (bestMatch(h, ACCOUNT_NAME_ALIASES)) mapping[h] = 'accountName';
    else if (bestMatch(h, CLIENT_ALIASES)) mapping[h] = 'clientName';
  }
  return mapping;
}

export function previewFromMapping(rows, mapping) {
  const products = new Set();
  const accounts = new Set();
  const clients = new Set();
  const revMap = {};
  for (const [col, field] of Object.entries(mapping)) revMap[field] = col;
  for (const row of rows) {
    if (revMap.productName && row[revMap.productName]) products.add(String(row[revMap.productName]).trim());
    if (revMap.accountCode && row[revMap.accountCode]) accounts.add(String(row[revMap.accountCode]).trim());
    if (revMap.accountName && row[revMap.accountName]) accounts.add(String(row[revMap.accountName]).trim());
    if (revMap.clientName && row[revMap.clientName]) clients.add(String(row[revMap.clientName]).trim());
  }
  return {
    itemsCount: products.size || rows.length,
    accountsCount: accounts.size,
    clientsCount: clients.size,
    rowsCount: rows.length,
  };
}
