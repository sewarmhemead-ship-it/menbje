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

## WhatsApp setup

1. Create a WhatsApp Business API app (Meta Developer Console).
2. Set webhook URL to `https://your-domain.com/webhook/whatsapp`.
3. Set `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_ID`, and `WHATSAPP_TOKEN` in `.env` (see `.env.example`).

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
