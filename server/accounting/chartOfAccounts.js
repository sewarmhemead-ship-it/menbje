/**
 * Chart of Accounts – tailored for Syrian trade (SYP as base).
 * Types: Asset, Liability, Equity, Revenue, Expense.
 * Codes follow a simple hierarchy for reporting.
 */

export const ACCOUNT_TYPE = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  REVENUE: 'revenue',
  EXPENSE: 'expense',
};

/** Default Syrian-trade CoA. Expand per business needs. parentId for hierarchical tree. */
export const DEFAULT_CHART = [
  // Assets (1xxx) — groups and leaves
  { id: '1000', code: '1000', name: 'نقد وما يعادله', type: ACCOUNT_TYPE.ASSET, parentId: null },
  { id: '1010', code: '1010', name: 'Cash SYP', type: ACCOUNT_TYPE.ASSET, parentId: '1000' },
  { id: '1020', code: '1020', name: 'Cash USD', type: ACCOUNT_TYPE.ASSET, parentId: '1000' },
  { id: '1030', code: '1030', name: 'Gold (reserve)', type: ACCOUNT_TYPE.ASSET, parentId: '1000' },
  { id: '1100', code: '1100', name: 'Inventory', type: ACCOUNT_TYPE.ASSET, parentId: null },
  { id: '1200', code: '1200', name: 'Debtors (Accounts Receivable)', type: ACCOUNT_TYPE.ASSET, parentId: null },
  { id: '1300', code: '1300', name: 'Prepayments', type: ACCOUNT_TYPE.ASSET, parentId: null },
  // Liabilities (2xxx)
  { id: '2000', code: '2000', name: 'ذمم دائنة وقروض', type: ACCOUNT_TYPE.LIABILITY, parentId: null },
  { id: '2010', code: '2010', name: 'Creditors (Accounts Payable)', type: ACCOUNT_TYPE.LIABILITY, parentId: '2000' },
  { id: '2020', code: '2020', name: 'Short-term debt', type: ACCOUNT_TYPE.LIABILITY, parentId: '2000' },
  { id: '2100', code: '2100', name: 'Barter clearing', type: ACCOUNT_TYPE.LIABILITY, parentId: '2000' },
  // Equity (3xxx)
  { id: '3000', code: '3000', name: 'Owner\'s Equity', type: ACCOUNT_TYPE.EQUITY, parentId: null },
  { id: '3900', code: '3900', name: 'Retained earnings', type: ACCOUNT_TYPE.EQUITY, parentId: null },
  // Revenue (4xxx)
  { id: '4000', code: '4000', name: 'Sales revenue', type: ACCOUNT_TYPE.REVENUE, parentId: null },
  { id: '4010', code: '4010', name: 'Sales returns', type: ACCOUNT_TYPE.REVENUE, parentId: '4000' },
  { id: '4100', code: '4100', name: 'Barter revenue (fair value)', type: ACCOUNT_TYPE.REVENUE, parentId: '4000' },
  { id: '4110', code: '4110', name: 'Inventory gain (أرباح جرد)', type: ACCOUNT_TYPE.REVENUE, parentId: '4000' },
  { id: '4120', code: '4120', name: 'Revaluation gain (أرباح فرق العملة)', type: ACCOUNT_TYPE.REVENUE, parentId: '4000' },
  // Expenses (5xxx)
  { id: '5000', code: '5000', name: 'Cost of goods sold (COGS)', type: ACCOUNT_TYPE.EXPENSE, parentId: null },
  { id: '5100', code: '5100', name: 'Barter COGS (given)', type: ACCOUNT_TYPE.EXPENSE, parentId: '5000' },
  { id: '5200', code: '5200', name: 'Exchange loss', type: ACCOUNT_TYPE.EXPENSE, parentId: '5000' },
  { id: '5210', code: '5210', name: 'Stock shortage (عجز مخزون)', type: ACCOUNT_TYPE.EXPENSE, parentId: '5000' },
  { id: '5300', code: '5300', name: 'Exchange gain', type: ACCOUNT_TYPE.REVENUE, parentId: null },
  { id: '5400', code: '5400', name: 'Salaries', type: ACCOUNT_TYPE.EXPENSE, parentId: '5000' },
  { id: '5500', code: '5500', name: 'Rent', type: ACCOUNT_TYPE.EXPENSE, parentId: '5000' },
  { id: '5600', code: '5600', name: 'Utilities', type: ACCOUNT_TYPE.EXPENSE, parentId: '5000' },
];

export function getAccountById(accountsMap, id) {
  return accountsMap.get(id) || null;
}

export function getAccountsByType(accountsMap, type) {
  return Array.from(accountsMap.values()).filter((a) => a.type === type);
}
