/**
 * In-memory store. Replace with DB for production.
 * Includes: products, units, fractioning, inventory, FIFO lots, orders, drafts,
 * barter, accounts, journal entries, debt ledger, action log, rates, vision.
 */

const products = new Map();
const units = new Map();
const fractioningRules = new Map();
const inventoryByProduct = new Map();
const inventoryLots = [];           // FIFO: { id, productId, unitId, quantity, unitCostSYP, receivedAt }
const orders = new Map();
const draftOrders = new Map();
const barterLedger = [];
const barterSurplus = [];
const barterNeeds = [];
const barterMatchAlerts = [];
const accounts = new Map();         // Chart of Accounts
const journalEntriesList = [];      // Double-entry lines
const vouchers = [];                // سندات: { id, type, date, amountSYP, accountId, memo, entryIds, ... }
const stockMovements = [];         // حركات مخزون: { id, productId, unitId, qty, type: 'in'|'out', refType, refId, date }
const debtLedger = [];              // { id, debtorId, amountSYP, amountGoldAtTx, dueDate, ... }
const actionLog = [];               // Audit trail
const exchangeRates = new Map();
const visionCache = [];

// Procurement: purchase invoices & returns (ref to journal + stockMovements)
const purchaseInvoices = [];
const purchaseReturns = [];

// Sales: invoices and returns (for lookup and reports)
const salesInvoices = [];           // { id, date, customerId, items: [{ productId, unitId, quantity, unitPrice }], totalRevenue, totalCogsSYP }
const salesReturns = [];            // { id, invoiceId, date, items: [...], totalAmount, refundToCash, reason? }

// Manufacturing: BOMs and build orders
const boms = [];                   // { id, finishedProductId, finishedUnitId, components: [{ productId, unitId, quantityPerUnit }] }

// Expenses: recorded in journal (expense account Dr, Cash/Creditors Cr)
const expenseRecords = [];

// Company profile (global settings)
const companyProfile = { logoUrl: null, taxId: null, defaultCurrency: 'SYP', name: 'Vault AI' };

// Auth: users and sessions (in-memory)
const users = new Map();       // id -> { id, username, email, password, fullName, role, tier, status, tenantId, expiresAt, createdAt }
const sessions = new Map();    // token -> { userId, createdAt }

// Suppliers (الموردين): for procurement and purchase returns
const suppliers = new Map();   // id -> { id, name, phone, address, tenantId, createdAt }

export const store = {
  products,
  units,
  fractioningRules,
  inventoryByProduct,
  inventoryLots,
  orders,
  draftOrders,
  barterLedger,
  barterSurplus,
  barterNeeds,
  barterMatchAlerts,
  accounts,
  journalEntriesList,
  vouchers,
  stockMovements,
  debtLedger,
  actionLog,
  exchangeRates,
  visionCache,
  purchaseInvoices,
  purchaseReturns,
  salesInvoices,
  salesReturns,
  boms,
  expenseRecords,
  companyProfile,
  users,
  sessions,
  suppliers,
};

export function getNextId(collection) {
  const map = store[collection] || new Map();
  return String((map.size || 0) + 1 + Date.now());
}
