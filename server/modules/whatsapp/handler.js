/**
 * WhatsApp webhook handler: process incoming message, query inventory/prices, create draft orders.
 * Responds with text reply (to be sent back via WhatsApp Business API).
 */

import { parseMessage } from './parser.js';
import { resolveQuery } from './inventoryResolver.js';
import * as draftOrders from './draftOrders.js';

/**
 * Handle one incoming text message. Returns reply text and optional side effects (e.g. draft created).
 */
export function handleIncomingMessage(text, fromPhone = null, fromName = null) {
  const parsed = parseMessage(text);
  const result = { reply: '', draftId: null, intent: parsed.intent };

  if (parsed.intent === 'availability') {
    const res = resolveQuery(parsed.productQuery);
    if (!res.found) {
      result.reply = `We couldn't find a product matching "${parsed.productQuery}". Please check the name or ask for our catalog.`;
    } else if (res.availability.available) {
      result.reply = `Yes, *${res.product.name}* is available. We have ${res.availability.quantity} ${res.availability.unitId || 'units'} in stock.`;
      const price = res.price?.price ?? 0;
      const draft = draftOrders.createDraftOrder({
        source: 'whatsapp',
        customerPhone: fromPhone,
        customerName: fromName,
        lines: [
          {
            productId: res.product.id,
            productName: res.product.name,
            unitId: res.availability.unitId || res.price?.unitId,
            quantity: 1,
            unitPrice: price,
          },
        ],
        notes: `WhatsApp availability query from ${fromPhone || 'unknown'}: "${parsed.productQuery}"`,
      });
      result.draftId = draft.id;
      result.reply += ` A draft order (Ref: ${draft.id}) has been created for you.`;
    } else {
      result.reply = `Sorry, *${res.product.name}* is currently out of stock. We'll restock soon.`;
    }
    return result;
  }

  if (parsed.intent === 'price') {
    const res = resolveQuery(parsed.productQuery);
    if (!res.found) {
      result.reply = `We couldn't find a product matching "${parsed.productQuery}".`;
    } else {
      const p = res.price;
      result.reply = `The price of *${res.product.name}* is ${p?.price ?? 'N/A'} per ${p?.unitId || 'unit'}.`;
    }
    return result;
  }

  if (parsed.intent === 'order') {
    const res = resolveQuery(parsed.productQuery);
    if (!res.found) {
      result.reply = `We couldn't find "${parsed.productQuery}". Please check the product name and try again.`;
      return result;
    }
    const qty = parsed.quantity || 1;
    const price = res.price?.price ?? 0;
    const draft = draftOrders.createDraftOrder({
      source: 'whatsapp',
      customerPhone: fromPhone,
      customerName: fromName,
      lines: [
        {
          productId: res.product.id,
          productName: res.product.name,
          unitId: res.price?.unitId || res.availability?.unitId,
          quantity: qty,
          unitPrice: price,
        },
      ],
      notes: `WhatsApp order from ${fromPhone || 'unknown'}`,
    });
    result.draftId = draft.id;
    result.reply = `Your draft order has been created (Ref: ${draft.id}). We have added *${qty} x ${res.product.name}* at ${price} each. You can add more items by messaging "Order [product name]" or visit our store to confirm.`;
    return result;
  }

  result.reply =
    "Hi! You can ask me:\n• \"Is [product] available?\"\n• \"What is the price of [product]?\"\n• \"I want to order [product]\" or \"Order 2 x [product]\"";
  return result;
}
