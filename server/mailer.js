/**
 * Optional email sender for backup and notifications.
 * Set env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM.
 * If not set, sendEmail returns { ok: false, error: '...' }.
 */

import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter !== null) return transporter;
  const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const port = parseInt(process.env.SMTP_PORT || process.env.MAIL_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.MAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASS;
  const from = process.env.SMTP_FROM || process.env.MAIL_FROM || (user || 'noreply@vault.local');
  if (!host || !user || !pass) {
    transporter = false;
    return false;
  }
  try {
    const trans = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: { user, pass },
    });
    transporter = { sendMail: trans.sendMail.bind(trans), _from: from };
    return transporter;
  } catch (e) {
    transporter = false;
    return false;
  }
}

export async function sendEmail({ to, subject, text, html, attachments }) {
  const trans = getTransporter();
  if (!trans) {
    return { ok: false, error: 'البريد غير مُعدّ. قم بتعيين SMTP_HOST, SMTP_USER, SMTP_PASS في البيئة.' };
  }
  try {
    await trans.sendMail({
      from: trans._from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject || 'Mizan',
      text: text || '',
      html: html || undefined,
      attachments: attachments || [],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'فشل الإرسال' };
  }
}
