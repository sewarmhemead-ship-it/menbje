/**
 * Auth routes: login, register, me.
 * Passwords stored in plain for demo; use bcrypt in production.
 * Login returns a JWT so the token works on serverless (Vercel) where in-memory sessions are not shared.
 */

import { Router } from 'express';
import { store } from '../config/store.js';
import { requireAuth } from '../auth/middleware.js';
import { createJWT } from '../auth/jwt.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, username, password } = req.body || {};
  const loginId = (email || username || '').toString().trim().toLowerCase();
  if (!loginId || !password) {
    return res.status(400).json({ success: false, error: 'معرف الدخول (بريد أو اسم مستخدم) وكلمة المرور مطلوبان' });
  }
  const user = Array.from(store.users.values()).find(u =>
    (u.email || '').toLowerCase() === loginId || (u.username || '').toLowerCase() === loginId
  );
  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: 'معرف الدخول أو كلمة المرور غير صحيحة' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ success: false, error: 'تم إيقاف الحساب، يرجى مراجعة الإدارة', code: 'SUSPENDED' });
  }
  if (user.status === 'expired' || (user.expiresAt && new Date(user.expiresAt) < new Date())) {
    return res.status(403).json({ success: false, error: 'انتهت صلاحية الحساب', code: 'EXPIRED' });
  }
  const token = createJWT(user);
  const expiresAt = user.expiresAt ? new Date(user.expiresAt) : null;
  const daysLeft = expiresAt ? Math.ceil((expiresAt - new Date()) / (24 * 60 * 60 * 1000)) : null;
  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        username: user.username || user.email,
        email: user.email,
        fullName: user.fullName || user.email,
        tier: user.tier,
        status: user.status,
        tenantId: user.tenantId || 'default',
        role: user.role || 'ADMIN',
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
        username: u.username || u.email,
        email: u.email,
        fullName: u.fullName || u.email,
        tier: u.tier,
        status: u.status,
        tenantId: u.tenantId || 'default',
        role: u.role || 'ADMIN',
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
