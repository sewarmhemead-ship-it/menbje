/**
 * WhatsApp message parser: detect intent and extract product name / quantity.
 * Handles: "Is [Product] available?", "What is the price of [Product]?", "I want to order..."
 */

const AVAILABILITY_PATTERNS = [
  /is\s+(.+?)\s+available\??/i,
  /do\s+you\s+have\s+(.+?)\??/i,
  /(.+?)\s+available\??/i,
  /do\s+we\s+have\s+(.+?)\??/i,
];

const PRICE_PATTERNS = [
  /(?:what(?:'s| is)\s+)?(?:the\s+)?price\s+of\s+(.+?)\??/i,
  /how\s+much\s+(?:is|for)\s+(.+?)\??/i,
  /(.+?)\s+price\??/i,
  /cost\s+of\s+(.+?)\??/i,
];

const ORDER_PATTERNS = [
  /(?:i\s+)?(?:want\s+to\s+)?order\s+(.+)/i,
  /(?:please\s+)?(?:give\s+me|send\s+me)\s+(.+)/i,
  /(?:add\s+)?(.+?)\s+to\s+(?:my\s+)?order/i,
  /(\d+)\s+(?:x\s+)?(.+)/i,
];

/**
 * Extract product name from "Is X available?" type message.
 */
export function parseAvailability(text) {
  const t = (text || '').trim();
  for (const re of AVAILABILITY_PATTERNS) {
    const m = t.match(re);
    if (m) return { intent: 'availability', productQuery: m[1].trim() };
  }
  return null;
}

/**
 * Extract product name from "What is the price of X?" type message.
 */
export function parsePrice(text) {
  const t = (text || '').trim();
  for (const re of PRICE_PATTERNS) {
    const m = t.match(re);
    if (m) return { intent: 'price', productQuery: m[1].trim() };
  }
  return null;
}

/**
 * Extract order line: product name and optional quantity.
 */
export function parseOrder(text) {
  const t = (text || '').trim();
  for (const re of ORDER_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    const rest = m[1].trim();
    const qtyMatch = rest.match(/^(\d+)\s+(.+)$/);
    if (qtyMatch) {
      return { intent: 'order', productQuery: qtyMatch[2].trim(), quantity: parseInt(qtyMatch[1], 10) };
    }
    return { intent: 'order', productQuery: rest, quantity: 1 };
  }
  return null;
}

/**
 * Single entry: parse message and return intent + extracted data.
 */
export function parseMessage(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return { intent: 'unknown' };
  return (
    parseAvailability(text) ||
    parsePrice(text) ||
    parseOrder(text) ||
    { intent: 'unknown', raw: text }
  );
}
