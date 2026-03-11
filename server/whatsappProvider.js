/**
 * WhatsApp connection via Baileys (WhatsApp Web).
 * Session stored in data/wa-session so connection survives restart.
 * QR is exposed for dashboard; on messages containing "دين" or "حساب" we reply with debt link.
 */

import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import qrcode from 'qrcode';
import * as debtLink from './modules/debtLink/index.js';
import * as reports from './accounting/reports.js';
import * as waStats from './modules/whatsapp/stats.js';
import { getSettings } from './config/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FOLDER = path.join(process.cwd(), 'data', 'wa-session');

let sock = null;
let currentQR = null;
let connected = false;

// Rate limit: one debt-link reply per JID per 45 seconds to prevent spam/DDoS
const DEBT_REPLY_COOLDOWN_MS = 45000;
const lastDebtReplyAt = new Map();
function canReplyDebt(jid) {
  const now = Date.now();
  const last = lastDebtReplyAt.get(jid);
  if (last != null && now - last < DEBT_REPLY_COOLDOWN_MS) return false;
  lastDebtReplyAt.set(jid, now);
  return true;
}

function ensureSessionDir() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(SESSION_FOLDER)) fs.mkdirSync(SESSION_FOLDER, { recursive: true });
}

/**
 * Get debt info and link for a customer (phone as customerId).
 */
function getCustomerDebt(phoneAsCustomerId, tenantId = 'default') {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const gen = debtLink.generateToken(phoneAsCustomerId, tenantId, 168);
  if (!gen.success) return null;
  const link = baseUrl + '/dashboard/debt.html?t=' + gen.token;
  const result = reports.generateAccountStatement(phoneAsCustomerId, null, null, tenantId);
  const header = result.header || {};
  const data = result.data || {};
  const companyName = header.companyName || 'المحل';
  const balance = data.closingBalance != null ? Number(data.closingBalance) : 0;
  return { link, balance, companyName };
}

/**
 * Start Baileys connection. Call once at server start or on first QR request.
 */
export async function start() {
  if (sock) return;
  ensureSessionDir();
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (update.qr) {
      currentQR = update.qr;
      connected = false;
    }
    if (update.connection === 'open') {
      currentQR = null;
      connected = true;
      console.log('[Baileys] WhatsApp connected.');
    }
    if (update.connection === 'close') {
      connected = false;
      const reason = update.lastDisconnect?.error?.message || 'unknown';
      console.log('[Baileys] Disconnected:', reason);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const from = msg.key?.remoteJid;
      if (!from || from.endsWith('@g.us')) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const body = (text || '').trim();
      if (!body) continue;
      const hasDebtKeyword = /دين|حساب/.test(body);
      if (!hasDebtKeyword) continue;
      if (!canReplyDebt(from)) continue; // rate limit: skip reply, avoid spam/ban
      const phone = from.replace(/\D/g, '').replace(/^0+/, '') || from.split('@')[0];
      const customerId = phone;
      const debt = getCustomerDebt(customerId);
      if (!debt) {
        await sendMessage(from, 'لم نعثر على حساب مرتبط بهذا الرقم. تواصل مع المحل.');
        continue;
      }
      const settings = getSettings();
      const companyName = (settings.branding && settings.branding.companyName) || debt.companyName;
      const balanceStr = debt.balance.toLocaleString('ar-SY');
      const template = (settings.branding && settings.branding.whatsappAutoReplyTemplate) || '';
      const reply = template.trim()
        ? template
            .replace(/\{\{companyName\}\}/g, companyName)
            .replace(/\{\{balance\}\}/g, balanceStr)
            .replace(/\{\{link\}\}/g, debt.link)
        : `رصيدك لدى ${companyName}: ${balanceStr} ل.س.\nلمتابعة التفاصيل وآخر الحركات: ${debt.link}\nشكراً لتعاملك معنا - نظام MIZAN`;
      await sendMessage(from, reply);
      waStats.incrementAutoReply();
    }
  });

  return sock;
}

/**
 * Send a text message to a JID (e.g. 963991234567@s.whatsapp.net).
 */
export async function sendMessage(jid, text) {
  if (!sock) return;
  try {
    await sock.sendMessage(jid, { text });
  } catch (e) {
    console.error('[Baileys] Send error:', e.message);
  }
}

/**
 * Get current QR as data URL for dashboard (or null if connected).
 * Baileys may send raw QR string; we convert to image via qrcode package.
 */
export async function getQR() {
  if (connected || !currentQR) return null;
  if (currentQR.startsWith('data:')) return currentQR;
  try {
    return await qrcode.toDataURL(currentQR, { margin: 1, width: 280 });
  } catch (_) {
    return `data:image/png;base64,${currentQR}`;
  }
}

/**
 * Whether Baileys is connected.
 */
export function isConnected() {
  return !!connected;
}

export default { start, getQR, isConnected, sendMessage };
