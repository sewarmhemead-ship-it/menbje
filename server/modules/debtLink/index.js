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
    clickCount: 0,
  });

  return {
    success: true,
    token,
    expiresAt,
    link: null, // caller will set full URL
  };
}

const EXPIRED_MESSAGE = 'هذا الرابط انتهت صلاحيته لدواعي الأمان، يرجى طلب رابط جديد من المحل';

/**
 * Resolve token to customerId and tenantId if valid and not expired.
 * Increments clickCount when token is used.
 * @param {string} token
 * @returns {{ customerId: string, tenantId: string } | null}
 */
export function getByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const t = debtLinkTokens.find((e) => e.token === token);
  if (!t) return null;
  if (new Date(t.expiresAt) <= new Date()) return null;
  if (typeof t.clickCount === 'number') t.clickCount += 1;
  else t.clickCount = 1;
  return { customerId: t.customerId, tenantId: t.tenantId };
}

/**
 * Check if token exists but is expired (for custom expiry message).
 */
function isExpiredToken(token) {
  if (!token || typeof token !== 'string') return false;
  const t = debtLinkTokens.find((e) => e.token === token);
  return t && new Date(t.expiresAt) <= new Date();
}

const MAX_MOVEMENTS_PUBLIC = 500;

/**
 * Get public debt info for a valid token: company name, balance (SYP), full statement (movements) with optional date range.
 * Uses generateAccountStatement with optional tenantId and fromDate/toDate.
 * @param {string} token
 * @param {string|null} fromDate - optional YYYY-MM-DD
 * @param {string|null} toDate - optional YYYY-MM-DD
 * @returns {{ success: boolean, companyName?: string, customerId?: string, balanceSYP?: number, openingBalance?: number, movements?: array, fromDate?: string, toDate?: string, lastMovementDate?: string, lastMovements?: array, message?: string, error?: string }}
 */
export function getPublicDebt(token, fromDate = null, toDate = null) {
  const resolved = getByToken(token);
  if (!resolved) {
    const error = isExpiredToken(token) ? EXPIRED_MESSAGE : 'الرابط غير صالح أو منتهي الصلاحية';
    return { success: false, error };
  }

  const from = fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate : null;
  const to = toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? toDate : null;

  const result = reports.generateAccountStatement(
    resolved.customerId,
    from || null,
    to || null,
    resolved.tenantId
  );
  const header = result.header || {};
  const data = result.data || {};
  const movements = data.movements || [];
  const lastMovement = movements.length ? movements[movements.length - 1] : null;

  // كشف كامل للعرض (تاريخ، بيان، مدين، دائن، رصيد) — نحدّ بعدد معقول
  const capped = movements.slice(-MAX_MOVEMENTS_PUBLIC);
  const statementRows = capped.map((m) => ({
    date: (m.date || '').slice(0, 10),
    memo: (m.memo || '').slice(0, 120),
    debit: m.debit != null ? Number(m.debit) : 0,
    credit: m.credit != null ? Number(m.credit) : 0,
    balance: m.balance != null ? Number(m.balance) : 0,
  }));

  // آخر 5 حركات (ملخص سريع) للتوافق مع الواجهة القديمة
  const last5 = movements.slice(-5).reverse().map((m) => {
    const debit = Number(m.debit) || 0;
    const credit = Number(m.credit) || 0;
    const type = debit > 0 ? 'بيع/فاتورة' : 'قبض';
    const amount = debit > 0 ? debit : credit;
    return {
      date: (m.date || '').slice(0, 10),
      type,
      amount: Math.round(amount * 100) / 100,
      memo: (m.memo || '').slice(0, 60),
    };
  });

  return {
    success: true,
    companyName: header.companyName || 'الشركة',
    customerId: data.customerId,
    balanceSYP: data.closingBalance != null ? Number(data.closingBalance) : 0,
    openingBalance: data.openingBalance != null ? Number(data.openingBalance) : 0,
    movements: statementRows,
    fromDate: from || null,
    toDate: to || null,
    lastMovementDate: lastMovement ? (lastMovement.date || '').slice(0, 10) : null,
    lastMovements: last5,
    message: data.message || null,
  };
}
