/**
 * WhatsApp daily stats: auto-reply count and debt-link sent count (for dashboard).
 */

import { store } from '../../config/store.js';

const stats = store.whatsappDailyStats;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureToday() {
  const today = todayKey();
  if (stats.date !== today) {
    stats.date = today;
    stats.autoReplyCount = 0;
    stats.debtLinkSentCount = 0;
  }
}

export function incrementAutoReply() {
  ensureToday();
  stats.autoReplyCount += 1;
}

export function incrementDebtLinkSent() {
  ensureToday();
  stats.debtLinkSentCount += 1;
}

export function getStats() {
  ensureToday();
  return {
    autoRepliesToday: stats.autoReplyCount,
    debtLinksSentToday: stats.debtLinkSentCount,
    date: stats.date,
  };
}
