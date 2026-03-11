/**
 * WhatsApp Business API webhook and draft-order API.
 * GET: verification (Meta requires this for webhook URL).
 * POST: receive incoming messages (Meta Cloud API format).
 */

import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import { handleIncomingMessage } from './handler.js';
import * as draftOrders from './draftOrders.js';
import * as debtLink from '../debtLink/index.js';
import { getSettings } from '../../config/settings.js';

const router = Router();
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'your_webhook_verify_token';

/**
 * Webhook verification (GET) - required by Meta.
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/**
 * Webhook callback (POST) - incoming messages from WhatsApp.
 * Payload format: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
router.post('/', (req, res) => {
  res.status(200).send('OK');
  const body = req.body;
  if (body?.object !== 'whatsapp_business_account') return;

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const messages = value?.messages || [];
      const contacts = value?.contacts || [];
      const from = value?.metadata?.display_phone_number;
      for (const msg of messages) {
        if (msg.type !== 'text') continue;
        const text = msg.text?.body;
        const fromPhone = msg.from;
        const contact = contacts.find((c) => c.wa_id === fromPhone);
        const fromName = contact?.profile?.name || null;
        const result = handleIncomingMessage(text, fromPhone, fromName);
        sendWhatsAppReply(fromPhone, result.reply);
      }
    }
  }
});

const WELCOME_TEXT = 'تم ربط نظام ميزان بنجاح.. سوار أمان تجارتك مفعل الآن';

/**
 * Send a message via WhatsApp Cloud API. Returns Promise<{ ok: boolean, error?: string }>.
 */
async function sendWhatsAppMessage(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    return { ok: false, error: 'WhatsApp غير مُعد (WHATSAPP_PHONE_ID أو WHATSAPP_TOKEN)' };
  }
  const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
  const toNum = String(to || '').replace(/\D/g, '');
  if (!toNum || toNum.length < 10) return { ok: false, error: 'رقم هاتف غير صالح' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toNum,
        type: 'text',
        text: { body: text },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error?.message || data.error?.error_user_msg || res.statusText;
      return { ok: false, error: err || 'فشل الإرسال' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'خطأ في الاتصال' };
  }
}

/**
 * Send reply via WhatsApp Cloud API (fire-and-forget for webhook).
 */
function sendWhatsAppReply(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    console.log('[WhatsApp] Reply (no API config):', to, text);
    return;
  }
  const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
  fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: (to || '').replace(/\D/g, ''),
      type: 'text',
      text: { body: text },
    }),
  }).catch((err) => console.error('[WhatsApp] Send error:', err));
}

/**
 * Baileys QR code for linking WhatsApp (personal number).
 * Returns QR as base64 image; when connected, qr is null.
 */
router.get('/qr', async (req, res) => {
  try {
    const provider = (await import('../../whatsappProvider.js')).default;
    await provider.start();
    const qr = await provider.getQR();
    const connected = provider.isConnected();
    res.json({ success: true, qr: qr || null, connected });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, qr: null, connected: false });
  }
});

/**
 * Status: whether real WhatsApp is configured (for dashboard).
 */
router.get('/status', (req, res) => {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const connected = !!(phoneId && token);
  res.json({
    success: true,
    data: {
      connected,
      webhookPath: '/webhook/whatsapp',
    },
  });
});

/**
 * Format phone to WhatsApp JID (international): digits only, default Syria +963 if 9 digits.
 */
function toWhatsAppJid(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 9 && !digits.startsWith('963')) digits = '963' + digits;
  return digits ? digits + '@s.whatsapp.net' : null;
}

/**
 * Send debt link via WhatsApp to customer phone (Baileys).
 * Body: { customerId, phone, customerName? }. Auth required.
 * Uses whatsappProvider (Baileys) if connected; otherwise fails with hint to connect.
 */
router.post('/send-debt-link', requireAuth, async (req, res) => {
  try {
    const customerId = (req.body?.customerId || '').toString().trim();
    const phone = (req.body?.phone || '').toString().trim();
    const customerName = (req.body?.customerName || customerId || 'العميل').toString().trim();
    if (!customerId) return res.status(400).json({ success: false, error: 'معرّف العميل مطلوب' });
    if (!phone) return res.status(400).json({ success: false, error: 'رقم واتساب العميل مطلوب' });

    const jid = toWhatsAppJid(phone);
    if (!jid) return res.status(400).json({ success: false, error: 'رقم الهاتف غير صالح' });

    const provider = (await import('../../whatsappProvider.js')).default;
    if (!provider.isConnected()) {
      return res.status(400).json({ success: false, error: 'واتساب غير متصل. اربط رقمك من قسم واتساب (مسح رمز QR) ثم جرّب مرة أخرى.' });
    }

    const tenantId = (req.user && req.user.tenantId) || 'default';
    const gen = debtLink.generateToken(customerId, tenantId, 168);
    if (!gen.success) return res.status(400).json(gen);

    const baseUrl = (req.protocol || 'http') + '://' + (req.get('host') || 'localhost:3000');
    const link = baseUrl + '/dashboard/debt.html?t=' + gen.token;
    const settings = getSettings();
    const companyName = (settings.branding && settings.branding.companyName) || 'المحل';

    const message =
      'عزيزي ' + customerName + '، يمكنك متابعة رصيدك وحركاتك المالية لدى ' + companyName + ' عبر الرابط التالي: ' + link + ' شكراً لتعاملك معنا - نظام MIZAN';

    await provider.sendMessage(jid, message);
    res.json({ success: true, message: 'تم إرسال رابط الدين إلى واتساب العميل بنجاح.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Send test message (ترحيب ميزان) to a phone number. Confirms WhatsApp setup.
 * Body: { phone: "+963..." }. Message: "تم ربط نظام ميزان بنجاح.. سوار أمان تجارتك مفعل الآن"
 */
router.post('/send-test-message', async (req, res) => {
  try {
    const phone = (req.body?.phone || req.body?.to || '').toString().trim();
    if (!phone) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف مطلوب' });
    }
    const result = await sendWhatsAppMessage(phone, WELCOME_TEXT);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error || 'فشل الإرسال' });
    }
    res.json({ success: true, message: 'تم إرسال الرسالة التجريبية. تحقق من واتساب على الرقم المُدخل.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Simulate incoming WhatsApp message (e.g. "Do you have Milk?"). Creates draft if item in stock.
 */
router.post('/simulate', (req, res) => {
  try {
    const { message } = req.body;
    const text = (message || '').trim() || 'Do you have Milk?';
    const result = handleIncomingMessage(text, '+963900000000', 'Demo User');
    res.json({
      success: true,
      data: {
        reply: result.reply,
        draftId: result.draftId,
        intent: result.intent,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * API for dashboard: list draft orders from WhatsApp (and other sources).
 */
router.get('/drafts', (req, res) => {
  try {
    const status = req.query.status || null;
    const list = draftOrders.listDrafts(status);
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/drafts/:id', (req, res) => {
  const draft = draftOrders.getDraft(req.params.id);
  if (!draft) return res.status(404).json({ success: false, error: 'Draft not found' });
  res.json({ success: true, data: draft });
});

router.post('/drafts/:id/convert', (req, res) => {
  const payload = draftOrders.convertDraftToOrderPayload(req.params.id);
  if (!payload) return res.status(400).json({ success: false, error: 'Draft not found or not in draft status' });
  draftOrders.setDraftStatus(req.params.id, 'converted');
  res.json({ success: true, data: payload, message: 'Use this payload to create the order in POS' });
});

export default router;
