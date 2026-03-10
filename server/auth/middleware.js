/**
 * Auth middleware: resolve token and attach user to req.
 * Token resolution order: req.cookies.vault_token (HttpOnly, preferred for security) then header/query/body.
 * Supports JWT (jwt_...) for serverless. Super-admin routes use Master-Key header separately.
 */

import { store } from '../config/store.js';
import { verifyJWT } from './jwt.js';

const TIER_FEATURES = {
  basic: ['accounting', 'inventory', 'dashboard', 'settings'],
  pro: ['accounting', 'inventory', 'dashboard', 'settings', 'barter', 'currency'],
  enterprise: ['accounting', 'inventory', 'dashboard', 'settings', 'barter', 'currency', 'vision', 'whatsapp'],
};

function resolveUser(token) {
  if (!token) return null;
  if (token.startsWith('jwt_')) {
    const payload = verifyJWT(token);
    if (!payload || !payload.userId) return null;
    return store.users.get(payload.userId) || null;
  }
  const session = store.sessions.get(token);
  if (!session) return null;
  return store.users.get(session.userId) || null;
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.vault_token || req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token || req.body?.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'غير مصرح', code: 'UNAUTHORIZED' });
  }
  const user = resolveUser(token);
  if (!user) {
    return res.status(401).json({ success: false, error: 'انتهت الجلسة', code: 'UNAUTHORIZED' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ success: false, error: 'تم إيقاف الحساب، يرجى مراجعة الإدارة', code: 'SUSPENDED' });
  }
  if (user.status === 'expired' || (user.expiresAt && new Date(user.expiresAt) < new Date())) {
    return res.status(403).json({ success: false, error: 'انتهت صلاحية الحساب', code: 'EXPIRED' });
  }
  req.user = user;
  req.token = token;
  req.tierFeatures = TIER_FEATURES[user.tier] || TIER_FEATURES.basic;
  next();
}

export function optionalAuth(req, res, next) {
  const token = req.cookies?.vault_token || req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token || req.body?.token;
  if (!token) {
    req.user = null;
    req.tierFeatures = TIER_FEATURES.basic;
    return next();
  }
  const user = resolveUser(token);
  req.user = user || null;
  req.token = user ? token : null;
  req.tierFeatures = user ? (TIER_FEATURES[user.tier] || TIER_FEATURES.basic) : TIER_FEATURES.basic;
  next();
}

export function requireMasterKey(req, res, next) {
  const key = req.headers['master-key'] || req.query?.masterKey || req.body?.masterKey;
  const masterKey = process.env.MASTER_KEY || 'vault-super-admin-key';
  if (key !== masterKey) {
    return res.status(403).json({ success: false, error: 'مفتاح الإدارة غير صحيح', code: 'FORBIDDEN' });
  }
  next();
}

/** Only users with role SUPER_ADMIN may proceed. Use after requireAuth. */
export function requireSuperAdmin(req, res, next) {
  if (!req.user || (req.user.role || '').toUpperCase() !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'صلاحيات مدير أعلى مطلوبة', code: 'FORBIDDEN' });
  }
  next();
}

export function hasTierFeature(tier, feature) {
  const list = TIER_FEATURES[tier] || TIER_FEATURES.basic;
  return list.includes(feature);
}

export { TIER_FEATURES };
