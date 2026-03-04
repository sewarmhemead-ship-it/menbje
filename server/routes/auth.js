/**
 * Auth routes: login, register, me.
 * Passwords stored in plain for demo; use bcrypt in production.
 */

import { Router } from 'express';
import { store } from '../config/store.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();

function makeToken() {
  return 'tk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'البريد وكلمة المرور مطلوبان' });
  }
  const user = Array.from(store.users.values()).find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: 'البريد أو كلمة المرور غير صحيحة' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ success: false, error: 'تم إيقاف الحساب، يرجى مراجعة الإدارة', code: 'SUSPENDED' });
  }
  if (user.status === 'expired' || (user.expiresAt && new Date(user.expiresAt) < new Date())) {
    return res.status(403).json({ success: false, error: 'انتهت صلاحية الحساب', code: 'EXPIRED' });
  }
  const token = makeToken();
  store.sessions.set(token, { userId: user.id, createdAt: new Date().toISOString() });
  const expiresAt = user.expiresAt ? new Date(user.expiresAt) : null;
  const daysLeft = expiresAt ? Math.ceil((expiresAt - new Date()) / (24 * 60 * 60 * 1000)) : null;
  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        status: user.status,
        expiresAt: user.expiresAt,
        daysRemaining: daysLeft,
      },
    },
  });
});

router.post('/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'البريد وكلمة المرور مطلوبان' });
  }
  const exists = Array.from(store.users.values()).some(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
  if (exists) {
    return res.status(400).json({ success: false, error: 'البريد مستخدم مسبقاً' });
  }
  const id = 'u_' + Date.now();
  const user = {
    id,
    email: (email || '').trim().toLowerCase(),
    password: (password || '').trim(),
    tier: 'basic',
    status: 'pending',
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };
  store.users.set(id, user);
  res.status(201).json({
    success: true,
    data: {
      message: 'تم إنشاء الحساب. بانتظار تفعيل من الإدارة.',
      user: { id: user.id, email: user.email, status: user.status, tier: user.tier },
    },
  });
});

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  const expiresAt = u.expiresAt ? new Date(u.expiresAt) : null;
  const daysRemaining = expiresAt ? Math.ceil((expiresAt - new Date()) / (24 * 60 * 60 * 1000)) : null;
  res.json({
    success: true,
    data: {
      user: {
        id: u.id,
        email: u.email,
        tier: u.tier,
        status: u.status,
        expiresAt: u.expiresAt,
        daysRemaining,
      },
      tierFeatures: req.tierFeatures,
    },
  });
});

router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.token;
  if (token) store.sessions.delete(token);
  res.json({ success: true, data: { message: 'تم تسجيل الخروج' } });
});

export default router;
