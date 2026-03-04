# Professional Core Engine (النواة الاحترافية)

## 1. Double-Entry Accounting
- **Chart of Accounts** (`chartOfAccounts.js`): Syrian-trade CoA — Assets (1xxx), Liabilities (2xxx), Equity (3xxx), Revenue (4xxx), Expenses (5xxx).
- **Journal** (`journal.js`): Every transaction posts Debit + Credit (amount in SYP). Optional `amountUSDAtTx` / `amountGoldAtTx` for valuation.
- **Transactions** (`transactions.js`): `postSaleJournal(revenueSYP, cogsSYP)`, `postBarterJournal(fairValueSYP)`, `postPurchaseJournal(amountSYP)`.

## 2. FIFO & Costing
- **FIFO** (`../inventory/fifo.js`): `receiveLot(productId, unitId, qty, unitCostSYP)`, `consumeFIFO(...)` returns `cogsSYP`.
- **Fractioning** uses FIFO when lots exist; selling one Piece consumes from Carton lots and computes exact profit from original purchase cost.

## 3. Barter (Non-Cash)
- Confirm match → `postBarterJournal(fairValueSYP)`: Dr Inventory, Cr Barter clearing; Dr Barter clearing, Cr Inventory. No Cash.

## 4. Multi-Currency
- Each journal line stores `amountSYP`, `amountUSDAtTx`. **Exchange Gain/Loss** report: revalue at current rate, sum (current USD − tx USD) → gain/loss in SYP.

## 5. SQL Schema
- See `../db/schema.sql`: accounts, journal_entries, products, stock_units, fractioning_rules, inventory, inventory_lots, barter_offers, barter_ledger, debt_ledger, exchange_rates, action_log.

## 6. Audit Trail
- **Action Log** (`../audit/actionLog.js`): `logPriceChange`, `logEntryDelete`. Every journal void and product cost change recorded with `reasonCode` for AI/fraud analysis.

## API (examples)
- `GET /api/accounts` — Chart of Accounts
- `GET /api/journal` — Journal entries (filter: refType, accountId, fromDate, toDate)
- `POST /api/journal/:id/void` — body: `{ reasonCode, deletedBy }`
- `GET /api/currency/exchange-gain-loss?fromDate=&toDate=`
- `GET /api/audit` — action log
- `POST /api/barter/confirm` — body: `{ matchAlertId, createdBy }`
- Sales via `POST /api/fractioning/sell-sub` or `sell-bulk` auto-post double-entry.
