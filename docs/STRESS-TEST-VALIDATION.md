# Vault AI – Full-Scale Stress Test Validation

This document describes the seed data used for the **Comprehensive Validation** and how to verify the Dashboard, Inventory, Suppliers, and Currency engines.

---

## 1. Suppliers & Customers (Seed)

| Type | Name | Notes |
|------|------|------|
| **Suppliers** | Al-Khair Wholesaler, Modern Electronics, Global Food Co | + original 2 (مورد المعاجين، مورد الألبان) |
| **Customer A** | Receivable 500,000 SYP | Dr Debtors, Cr Revenue |
| **Customer B** | Receivable 1,200,000 + 4,000,000 (sale 10 Sugar) = **5,200,000 SYP** | Total Receivables from B |

---

## 2. Diverse Inventory (Multi-Currency & Barcode)

| Product | Barcode | Currency | Base Price | Stock | Min Level | Expected in Low Stock |
|---------|---------|----------|------------|-------|-----------|------------------------|
| iPhone 15 | 888 | USD | 800 | 2 | 5 | **Yes** (2 < 5) |
| Sugar 50kg | 777 | SYP | 400,000 | 50 | 10 | No |
| Cooking Oil | 666 | USD | 2.5 | 0 | 100 | **Yes** (out of stock) |

Exchange rate at seed: **14,850 SYP/USD**. After bulk price update (applied in seed):

- iPhone 15: **11,880,000 SYP**
- Cooking Oil: **37,125 SYP**
- Test Oil: **148,500 SYP**
- Tomato Paste Can: **7,425 SYP**

---

## 3. Financial Transactions (Seed)

- **Rate:** 14,850 SYP/USD (set in seed; no extra trigger needed).
- **Bulk price update:** Applied in seed for all USD-linked products.
- **Receivables:** Customer A = 500k; Customer B = 1.2M + 4M (sale 10 Sugar) = 5.2M.
- **Total Receivables (account 1200):** **5,700,000 SYP**.

---

## 4. Dashboard UI Validation

| Check | Expected |
|-------|----------|
| **Low Stock Alerts** | iPhone 15 (Low), Cooking Oil (Out of stock). Also Test Oil, Tomato Paste, Olive Oil, Milk per their min_level vs current stock. |
| **Profit & Liquidity Map** | Cash (صندوق 1010+1020), Receivables (5.7M), Inventory (warehouse valuation). Percentages and bar (Green / Amber / Blue). |
| **Search (Ctrl+K)** | "iPhone" → iPhone 15; "Al-Khair" → Al-Khair Wholesaler (موردين). |

---

## 5. Final Report – Expected Totals

- **Total Receivables:** **5,700,000 SYP** (500k + 5.2M).
- **Total Inventory Value:** From `GET /api/dashboard/summary` → `inventoryValue`. Includes: Tomato 50×24, Olive 30×60, Milk 100×2, Test Oil 5×0, iPhone 2×0, Sugar 50×400000, Cooking Oil 0. Approximate: **20,000,000+ SYP** (dominated by Sugar 50×400,000).
- **Cash:** Depends on initial CoA and any vouchers; seed does not add cash movements except via debt (Cr Revenue, so cash unchanged). Check **Cash** in dashboard/summary for actual value.

**UI cards:** All dashboard cards (رصيد الصندوق، تنبيهات المخزون، تحليل أرباحك وسيولتك، الإيرادات vs المصروفات، etc.) should render without overflow. Use card-standard and scroll where needed (e.g. Low Stock list).

---

## How to Run a Fresh Stress Test

1. **Reset data:** Clear in-memory store (restart server with empty state, or use a script that resets store and re-runs seed).
2. **Start server:** `npm start` (seed runs on first load).
3. **Open dashboard:** Log in, open لوحة التحكم.
4. **Verify:** Low Stock, Profit & Liquidity map, Ctrl+K for "iPhone" and "Al-Khair".
