/**
 * رابط دينك — Debt Link: generate a shareable link so the customer can see their balance without logging in.
 * Token is short-lived; public page shows company name, balance (SYP), last movement date.
 */

import crypto from 'crypto';
import { store } from '../../config/store.js';
import * as reports from '../../accounting/reports.js';

const { debtLinkTokens } = store;

const DEFAULT_EXPIRES_HOURS = 168; // 7 days

/**
 * Generate a new debt link token for a customer.
 * @param {string} customerId - Customer identifier (same as in invoices)
 * @param {string} tenantId - Tenant ID for isolation
 * @param {number} expiresInHours - Token validity in hours (default 168 = 7 days)
 * @returns {{ success: boolean, token?: string, link?: string, expiresAt?: string, error?: string }}
 */
export function generateToken(customerId, tenantId = 'default', expiresInHours = DEFAULT_EXPIRES_HOURS) {
  const cid = String(customerId || '').trim();
  if (!cid) return { success: false, error: 'معرّف العميل مطلوب' };

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  debtLinkTokens.push({
    token,
    customerId: cid,
    tenantId: tenantId || 'default',
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  return {
    success: true,
    token,
    expiresAt,
    link: null, // caller will set full URL
  };
}

/**
 * Resolve token to customerId and tenantId if valid and not expired.
 * @param {string} token
 * @returns {{ customerId: string, tenantId: string } | null}
 */
export function getByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const t = debtLinkTokens.find(
    (e) => e.token === token && new Date(e.expiresAt) > new Date()
  );
  return t ? { customerId: t.customerId, tenantId: t.tenantId } : null;
}

/**
 * Get public debt info for a valid token: company name, balance (SYP), last movement date.
 * Uses generateAccountStatement with optional tenantId filter.
 * @param {string} token
 * @param {string} baseUrl - Base URL for link (e.g. origin from request)
 * @returns {{ success: boolean, companyName?: string, customerId?: string, balanceSYP?: number, lastMovementDate?: string, message?: string, error?: string }}
 */
export function getPublicDebt(token) {
  const resolved = getByToken(token);
  if (!resolved) {
    return { success: false, error: 'الرابط غير صالح أو منتهي الصلاحية' };
  }

  // generateAccountStatement(customerId, fromDate, toDate, tenantId) — we need to add tenantId to reports
  const result = reports.generateAccountStatement(
    resolved.customerId,
    null,
    null,
    resolved.tenantId
  );
  const header = result.header || {};
  const data = result.data || {};
  const movements = data.movements || [];
  const lastMovement = movements.length ? movements[movements.length - 1] : null;

  return {
    success: true,
    companyName: header.companyName || 'الشركة',
    customerId: data.customerId,
    balanceSYP: data.closingBalance != null ? Number(data.closingBalance) : 0,
    lastMovementDate: lastMovement ? (lastMovement.date || '').slice(0, 10) : null,
    message: data.message || null,
  };
}
