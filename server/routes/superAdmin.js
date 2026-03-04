/**
 * Super Admin API: user management, tiers, status, expiry.
 * All routes require Master-Key header.
 */

import { Router } from 'express';
import { store } from '../config/store.js';
import { requireMasterKey } from '../auth/middleware.js';

const router = Router();

router.use(requireMasterKey);

function daysRemaining(expiresAt) {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt) - new Date()) / (24 * 60 * 60 * 1000));
}

router.get('/users', (req, res) => {
  const list = Array.from(store.users.values()).map(u => ({
    id: u.id,
    email: u.email,
    tier: u.tier,
    status: u.status,
    expiresAt: u.expiresAt,
    daysRemaining: daysRemaining(u.expiresAt),
    createdAt: u.createdAt,
  }));
  res.json({ success: true, data: list });
});

router.patch('/users/:id', (req, res) => {
  const { id } = req.params;
  const user = store.users.get(id);
  if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
  const { tier, status, expiresAt } = req.body || {};
  if (tier !== undefined) {
    if (!['basic', 'pro', 'enterprise'].includes(tier)) return res.status(400).json({ success: false, error: 'الباقة غير صالحة' });
    user.tier = tier;
  }
  if (status !== undefined) {
    if (!['active', 'suspended', 'expired', 'pending'].includes(status)) return res.status(400).json({ success: false, error: 'الحالة غير صالحة' });
    user.status = status;
  }
  if (expiresAt !== undefined) user.expiresAt = expiresAt || null;
  const days = daysRemaining(user.expiresAt);
  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      status: user.status,
      expiresAt: user.expiresAt,
      daysRemaining: days,
    },
  });
});

export default router;
