/**
 * WhatsApp message parser: detect intent and extract product name / quantity.
 * Handles: "Is [Product] available?", "What is the price of [Product]?", "I want to order..."
 * Security: max input length, capped productQuery length, clamped quantity to avoid DoS/injection.
 */

const MAX_INPUT_LENGTH = 1000;
const MAX_PRODUCT_QUERY_LENGTH = 200;
const MAX_ORDER_QUANTITY = 10000;

function truncate(s, maxLen) {
  if (typeof s !== 'string') return '';
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

function clampQuantity(n) {
  const num = parseInt(n, 10);
  if (!Number.isFinite(num) || num < 1) return 1;
  return Math.min(num, MAX_ORDER_QUANTITY);
}

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
  const t = truncate((text || '').trim(), MAX_INPUT_LENGTH);
  for (const re of AVAILABILITY_PATTERNS) {
    const m = t.match(re);
    if (m) return { intent: 'availability', productQuery: truncate(m[1].trim(), MAX_PRODUCT_QUERY_LENGTH) };
  }
  return null;
}

/**
 * Extract product name from "What is the price of X?" type message.
 */
export function parsePrice(text) {
  const t = truncate((text || '').trim(), MAX_INPUT_LENGTH);
  for (const re of PRICE_PATTERNS) {
    const m = t.match(re);
    if (m) return { intent: 'price', productQuery: truncate(m[1].trim(), MAX_PRODUCT_QUERY_LENGTH) };
  }
  return null;
}

/**
 * Extract order line: product name and optional quantity.
 */
export function parseOrder(text) {
  const t = truncate((text || '').trim(), MAX_INPUT_LENGTH);
  for (const re of ORDER_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    const rest = m[1].trim();
    const qtyMatch = rest.match(/^(\d+)\s+(.+)$/);
    if (qtyMatch) {
      return { intent: 'order', productQuery: truncate(qtyMatch[2].trim(), MAX_PRODUCT_QUERY_LENGTH), quantity: clampQuantity(qtyMatch[1]) };
    }
    return { intent: 'order', productQuery: truncate(rest, MAX_PRODUCT_QUERY_LENGTH), quantity: 1 };
  }
  return null;
}

/**
 * Single entry: parse message and return intent + extracted data.
 */
export function parseMessage(text) {
  const raw = typeof text === 'string' ? truncate(text.trim(), MAX_INPUT_LENGTH) : '';
  const t = raw.toLowerCase();
  if (!t) return { intent: 'unknown' };
  return (
    parseAvailability(raw) ||
    parsePrice(raw) ||
    parseOrder(raw) ||
    { intent: 'unknown', raw }
  );
}
