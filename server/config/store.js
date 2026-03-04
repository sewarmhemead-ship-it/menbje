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
const debtLedger = [];              // { id, debtorId, amountSYP, amountGoldAtTx, dueDate, ... }
const actionLog = [];               // Audit trail
const exchangeRates = new Map();
const visionCache = [];

// Auth: users and sessions (in-memory)
const users = new Map();       // id -> { id, email, password, tier, status, expiresAt, createdAt }
const sessions = new Map();    // token -> { userId, createdAt }

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
  debtLedger,
  actionLog,
  exchangeRates,
  visionCache,
  users,
  sessions,
};

export function getNextId(collection) {
  const map = store[collection] || new Map();
  return String((map.size || 0) + 1 + Date.now());
}
