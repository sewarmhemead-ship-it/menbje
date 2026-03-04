/**
 * Auth middleware: resolve token from header/cookie/body and attach user to req.
 * Super-admin routes use Master-Key header separately.
 */

import { store } from '../config/store.js';

const TIER_FEATURES = {
  basic: ['accounting', 'inventory', 'dashboard', 'settings'],
  pro: ['accounting', 'inventory', 'dashboard', 'settings', 'barter', 'currency'],
  enterprise: ['accounting', 'inventory', 'dashboard', 'settings', 'barter', 'currency', 'vision', 'whatsapp'],
};

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token || req.body?.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'غير مصرح', code: 'UNAUTHORIZED' });
  }
  const session = store.sessions.get(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'انتهت الجلسة', code: 'UNAUTHORIZED' });
  }
  const user = store.users.get(session.userId);
  if (!user) {
    store.sessions.delete(token);
    return res.status(401).json({ success: false, error: 'المستخدم غير موجود', code: 'UNAUTHORIZED' });
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
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token || req.body?.token;
  if (!token) {
    req.user = null;
    req.tierFeatures = TIER_FEATURES.basic;
    return next();
  }
  const session = store.sessions.get(token);
  const user = session ? store.users.get(session.userId) : null;
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

export function hasTierFeature(tier, feature) {
  const list = TIER_FEATURES[tier] || TIER_FEATURES.basic;
  return list.includes(feature);
}

export { TIER_FEATURES };
