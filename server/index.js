import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import fractioningRoutes from './modules/fractioning/routes.js';
import whatsappRoutes from './modules/whatsapp/routes.js';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import superAdminRoutes from './routes/superAdmin.js';
import importRoutes from './routes/import.js';
import { seedDemoData, seedUsers, ensureDevAdmin } from './config/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.join(__dirname, '../dashboard');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// On Vercel: only handle /api and /webhook — avoid handling / or static paths (prevents 307 loop)
if (process.env.VERCEL) {
  app.use((req, res, next) => {
    const p = (req.path || req.url || '').split('?')[0];
    if (p.startsWith('/api') || p.startsWith('/webhook')) return next();
    res.status(404).end();
  });
}

// API — rate limit general API (100 req/min per IP). تخطي localhost للتطوير.
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { success: false, error: 'عدد الطلبات كبير. انتظر قليلاً.', code: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (ip === '127.0.0.1' || ip === '::1') return true;
    const skipIps = (process.env.RATE_LIMIT_SKIP_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (skipIps.includes(ip)) return true;
    if (process.env.NODE_ENV !== 'production') return true;
    return false;
  },
});
app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/import', importRoutes);
app.use('/api', apiRoutes);
app.use('/api/fractioning', fractioningRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Dashboard (static) — enabled when not on Vercel (Render / local)
if (!process.env.VERCEL) {
  app.use('/dashboard', express.static(dashboardPath));
  app.use('/js', express.static(path.join(__dirname, '../public/js')));
  // خدمة ملف CSS المبني من أي صفحة (/login أو /dashboard) لتجنب 404 على Render
  app.use('/dist', express.static(path.join(__dirname, '../dashboard/dist')));
}
// Root and /login, /super-admin — only reached when not Vercel (Vercel 404s non-API first)
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => {
  res.sendFile(path.join(dashboardPath, 'login.html'));
});
app.get('/super-admin', (req, res) => {
  res.sendFile(path.join(dashboardPath, 'super-admin.html'));
});

// WhatsApp webhook (Meta expects this path often)
app.use('/webhook/whatsapp', whatsappRoutes);

seedDemoData();
seedUsers();
ensureDevAdmin();

// Only listen when not on Vercel (serverless handles requests there)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`POS Unified System running at http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard/`);
    console.log(`API: http://localhost:${PORT}/api/`);
    console.log(`WhatsApp webhook: http://localhost:${PORT}/webhook/whatsapp`);
    // Start Baileys (WhatsApp Web) in background; session saved in data/wa-session
    import('./whatsappProvider.js').then((m) => m.start().catch((e) => console.error('[Baileys]', e.message)));
  });
}

export default app;
