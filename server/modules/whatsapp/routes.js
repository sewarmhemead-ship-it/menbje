/**
 * WhatsApp Business API webhook and draft-order API.
 * GET: verification (Meta requires this for webhook URL).
 * POST: receive incoming messages (Meta Cloud API format).
 */

import { Router } from 'express';
import { handleIncomingMessage } from './handler.js';
import * as draftOrders from './draftOrders.js';

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

/**
 * Send reply via WhatsApp Cloud API. Replace with your actual API call.
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
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body: text },
    }),
  }).catch((err) => console.error('[WhatsApp] Send error:', err));
}

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
