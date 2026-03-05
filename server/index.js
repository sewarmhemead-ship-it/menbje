import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import fractioningRoutes from './modules/fractioning/routes.js';
import whatsappRoutes from './modules/whatsapp/routes.js';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import superAdminRoutes from './routes/superAdmin.js';
import importRoutes from './routes/import.js';
import { seedDemoData, seedUsers, ensureDevAdmin } from './config/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/import', importRoutes);
app.use('/api', apiRoutes);
app.use('/api/fractioning', fractioningRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Dashboard (static)
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard')));
app.get('/', (req, res) => res.redirect('/dashboard/'));

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
  });
}

export default app;
