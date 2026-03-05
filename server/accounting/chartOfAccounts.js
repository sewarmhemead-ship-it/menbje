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

/** Default Syrian-trade CoA. Expand per business needs. */
export const DEFAULT_CHART = [
  // Assets (1xxx)
  { id: '1010', code: '1010', name: 'Cash SYP', type: ACCOUNT_TYPE.ASSET },
  { id: '1020', code: '1020', name: 'Cash USD', type: ACCOUNT_TYPE.ASSET },
  { id: '1030', code: '1030', name: 'Gold (reserve)', type: ACCOUNT_TYPE.ASSET },
  { id: '1100', code: '1100', name: 'Inventory', type: ACCOUNT_TYPE.ASSET },
  { id: '1200', code: '1200', name: 'Debtors (Accounts Receivable)', type: ACCOUNT_TYPE.ASSET },
  { id: '1300', code: '1300', name: 'Prepayments', type: ACCOUNT_TYPE.ASSET },
  // Liabilities (2xxx)
  { id: '2010', code: '2010', name: 'Creditors (Accounts Payable)', type: ACCOUNT_TYPE.LIABILITY },
  { id: '2020', code: '2020', name: 'Short-term debt', type: ACCOUNT_TYPE.LIABILITY },
  { id: '2100', code: '2100', name: 'Barter clearing', type: ACCOUNT_TYPE.LIABILITY },
  // Equity (3xxx)
  { id: '3000', code: '3000', name: 'Owner\'s Equity', type: ACCOUNT_TYPE.EQUITY },
  { id: '3900', code: '3900', name: 'Retained earnings', type: ACCOUNT_TYPE.EQUITY },
  // Revenue (4xxx)
  { id: '4000', code: '4000', name: 'Sales revenue', type: ACCOUNT_TYPE.REVENUE },
  { id: '4010', code: '4010', name: 'Sales returns', type: ACCOUNT_TYPE.REVENUE },
  { id: '4100', code: '4100', name: 'Barter revenue (fair value)', type: ACCOUNT_TYPE.REVENUE },
  // Expenses (5xxx)
  { id: '5000', code: '5000', name: 'Cost of goods sold (COGS)', type: ACCOUNT_TYPE.EXPENSE },
  { id: '5100', code: '5100', name: 'Barter COGS (given)', type: ACCOUNT_TYPE.EXPENSE },
  { id: '5200', code: '5200', name: 'Exchange loss', type: ACCOUNT_TYPE.EXPENSE },
  { id: '5300', code: '5300', name: 'Exchange gain', type: ACCOUNT_TYPE.REVENUE },
  { id: '5400', code: '5400', name: 'Salaries', type: ACCOUNT_TYPE.EXPENSE },
  { id: '5500', code: '5500', name: 'Rent', type: ACCOUNT_TYPE.EXPENSE },
  { id: '5600', code: '5600', name: 'Utilities', type: ACCOUNT_TYPE.EXPENSE },
];

export function getAccountById(accountsMap, id) {
  return accountsMap.get(id) || null;
}

export function getAccountsByType(accountsMap, type) {
  return Array.from(accountsMap.values()).filter((a) => a.type === type);
}
