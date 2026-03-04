/**
 * Barter module – trade without cash.
 * Matchmaker: surplus vs needs; confirm posts non-cash journal.
 */

import { store, getNextId } from '../../config/store.js';
import * as multiCurrency from '../multiCurrency/index.js';
import { postBarterJournal } from '../../accounting/transactions.js';

const { barterLedger, barterSurplus, barterNeeds, barterMatchAlerts, products } = store;

export function getBarterSummary() {
  const ledger = barterLedger || [];
  const surplus = Array.from(barterSurplus || []);
  const needs = Array.from(barterNeeds || []);
  const alerts = Array.from(barterMatchAlerts || []).slice(-20);
  return {
    totalTrades: ledger.length,
    recent: ledger.slice(-10),
    surplus,
    needs,
    matchAlerts: alerts,
  };
}

/**
 * Add a surplus item. Runs matchmaker: if any need matches this product, create Match Alert with Fair Value in SYP.
 */
export function addSurplus(productId, productName, quantity, userId = 'current-user') {
  const id = `surplus-${Date.now()}`;
  const entry = {
    id,
    productId,
    productName: productName || products.get(productId)?.name || productId,
    quantity: Number(quantity) || 1,
    userId,
    createdAt: new Date().toISOString(),
  };
  barterSurplus.push(entry);

  const matchAlert = runMatchmakerSurplus(entry);
  if (matchAlert) barterMatchAlerts.push(matchAlert);

  return { entry, matchAlert };
}

/**
 * Add a need. Optionally run matchmaker against existing surplus.
 */
export function addNeed(productId, productName, quantity, userId = 'current-user') {
  const id = `need-${Date.now()}`;
  const entry = {
    id,
    productId,
    productName: productName || products.get(productId)?.name || productId,
    quantity: Number(quantity) || 1,
    userId,
    createdAt: new Date().toISOString(),
  };
  barterNeeds.push(entry);

  const matchAlert = runMatchmakerNeed(entry);
  if (matchAlert) barterMatchAlerts.push(matchAlert);

  return { entry, matchAlert };
}

function getFairValueSYP(productId) {
  const product = products.get(productId);
  const costUSD = product ? (product.costPerDefaultUnit || 0) : 0;
  const rates = multiCurrency.getRates();
  const sypRate = rates.SYP;
  if (sypRate == null || sypRate === 0) return null;
  return Math.round(costUSD / sypRate);
}

function runMatchmakerSurplus(surplusEntry) {
  const need = barterNeeds.find((n) => n.productId === surplusEntry.productId);
  if (!need) return null;
  const fairValueSYP = getFairValueSYP(surplusEntry.productId);
  const alertId = `match-${Date.now()}`;
  const matchAlert = {
    id: alertId,
    surplusId: surplusEntry.id,
    needId: need.id,
    productId: surplusEntry.productId,
    productName: surplusEntry.productName,
    fairValueSYP: fairValueSYP != null ? fairValueSYP : 0,
    createdAt: new Date().toISOString(),
  };
  return matchAlert;
}

function runMatchmakerNeed(needEntry) {
  const surplus = barterSurplus.find((s) => s.productId === needEntry.productId);
  if (!surplus) return null;
  const fairValueSYP = getFairValueSYP(needEntry.productId);
  const alertId = `match-${Date.now()}`;
  const matchAlert = {
    id: alertId,
    surplusId: surplus.id,
    needId: needEntry.id,
    productId: needEntry.productId,
    productName: needEntry.productName,
    fairValueSYP: fairValueSYP != null ? fairValueSYP : 0,
    createdAt: new Date().toISOString(),
  };
  return matchAlert;
}

export function registerBarterTrade(offerProductId, wantProductId, quantity, note) {
  const id = `barter-${Date.now()}`;
  const trade = { id, offerProductId, wantProductId, quantity, note, createdAt: new Date().toISOString() };
  barterLedger.push(trade);
  return trade;
}

/**
 * Confirm a barter match: post non-cash journal (swap inventory at fair value) and record trade.
 */
export function confirmBarterMatch(matchAlertId, createdBy = 'system') {
  const alert = barterMatchAlerts.find((a) => a.id === matchAlertId);
  if (!alert) return { success: false, error: 'Match alert not found' };

  const fairValueSYP = alert.fairValueSYP ?? 0;
  if (fairValueSYP <= 0) return { success: false, error: 'Invalid fair value' };

  const result = postBarterJournal(fairValueSYP, fairValueSYP, {
    refId: matchAlertId,
    memo: `Barter: ${alert.productName}`,
    createdBy,
  });
  if (!result.success) return result;

  const trade = {
    id: `barter-${Date.now()}`,
    matchAlertId,
    productId: alert.productId,
    productName: alert.productName,
    fairValueSYP,
    createdAt: new Date().toISOString(),
  };
  barterLedger.push(trade);

  return { success: true, trade, journalEntries: result.entries };
}
