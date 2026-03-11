# POS Unified System

Unified POS with **Barter**, **Multi-currency**, **Smart Fractioning**, **Vision**, and **WhatsApp Business** integration. All modules are interconnected on the main Dashboard.

## Quick start

```bash
npm install
npm start
```

- **Dashboard:** http://localhost:3000/dashboard/
- **API base:** http://localhost:3000/api/

## Modules

### 1. Smart Fractioning Engine
- Links bulk units (e.g. Cartons) to sub-units (e.g. Pieces/Grams) via rules.
- On sale in sub-units: auto-decrements bulk stock and computes fragmented cost/profit.
- **API:** `GET/POST /api/fractioning/rules`, `GET /api/fractioning/inventory/:productId/:unitId`, `POST /api/fractioning/sell-sub`, `POST /api/fractioning/sell-bulk`, `GET /api/fractioning/summary` (dashboard).

### 2. WhatsApp Business Integration
- Webhook for WhatsApp Bot: **GET/POST** `/webhook/whatsapp` (or `/api/whatsapp`).
- Handles: *"Is [Product] available?"*, *"What is the price of [Product]?"*, and *"Order [Product]"* / *"Order 2 x [Product]"*.
- Creates **Draft Orders** that can be converted into POS orders.
- **API:** `GET /api/whatsapp/drafts`, `GET /api/whatsapp/drafts/:id`, `POST /api/whatsapp/drafts/:id/convert`, or same under `/api/drafts` and `POST /api/drafts/:id/convert`.

### 3. Barter
- Stub: barter ledger and trade summary. **API:** `GET /api/barter/summary`.

### 4. Multi-currency
- Stub: exchange rates and conversion. **API:** `GET /api/multi-currency/rates`.

### 5. Vision
- Stub: recognition cache for barcode/OCR. **API:** `GET /api/vision/cache`.

## WhatsApp setup (واتساب حقيقي)

لربط واتساب الحقيقي (استقبال رسائل الزبائن وإرسال الردود):

1. أنشئ تطبيقاً في [Meta for Developers](https://developers.facebook.com) وأضف منتج **WhatsApp**.
2. من لوحة WhatsApp خذ **Phone number ID** و **Access token** وضعهما في `.env` كـ `WHATSAPP_PHONE_ID` و `WHATSAPP_TOKEN`.
3. اختر **Verify token** (سلسلة سرية) وضعه في `.env` كـ `WHATSAPP_VERIFY_TOKEN`.
4. في إعدادات Webhook في Meta ضع الرابط: `https://<نطاقك>/webhook/whatsapp` ونفس الـ Verify token.
5. اشترك في حقل **messages**.

**دليل مفصل بالعربية:** [`docs/WHATSAPP_SETUP.md`](docs/WHATSAPP_SETUP.md).

## Dashboard

The main Dashboard at `/dashboard/` shows live data for:
- Smart Fractioning (rules + inventory)
- Barter (trade summary)
- Multi-currency (rates)
- Vision (cache)
- WhatsApp Draft Orders

Use "Refresh" on each card to reload. All modules use the same API base and are interconnected through the shared store and POS flow.

## Converting a draft to POS order

1. `POST /api/drafts/:id/convert` → returns order payload.
2. `POST /api/pos/orders` with that payload (or with `lines`, `customerPhone`, etc.) to create the order in the POS.

## Adding new ideas & project structure

- **Ideas / roadmap:** See [`IDEAS.md`](IDEAS.md) to log new features and [`docs/IDEAS_AND_ROADMAP.md`](docs/IDEAS_AND_ROADMAP.md) for how to add them and suggested project organization.
- **Global accounting, Syria-oriented (محاسبة شاملة وعالمية موجّهة لسوريا، بدون ضريبة):** See [`docs/GLOBAL_ACCOUNTING_ROADMAP.md`](docs/GLOBAL_ACCOUNTING_ROADMAP.md) for a phased plan (base currency, multi-currency invoicing, fiscal periods, fixed assets, bank reconciliation, cost centers, projects, KPIs, export). No VAT — Syria has no sales tax.
- **Product for shops (منتج للمحلات — تدقيق الأقسام):** See [`docs/MERCHANT_SECTIONS_SPEC.md`](docs/MERCHANT_SECTIONS_SPEC.md) for a full audit of every section (sales, purchases, warehouse, accounting, vouchers, etc.) with merchant needs and global ideas so the product is ready as a game-changer in Syria. Includes P0/P1/P2 priorities.
