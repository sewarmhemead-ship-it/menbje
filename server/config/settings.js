/**
 * Global config store for white-label SaaS.
 * branding, localization, features. Persisted in-memory; replace with DB for production.
 * أي تغيير في الهوية (branding) يُسجّل في actionLog لمراقبة الإعدادات.
 */

import { logEntityEdit } from '../audit/actionLog.js';

const defaultSettings = {
  branding: {
    companyName: 'Vault AI',
    logoBase64: null,
    primaryColor: '#10b981',
    secondaryColor: '#34d399',
    companyPhone: '',
    companyAddress: '',
    returnsPolicy: 'المرتجعات خلال 14 يوماً من تاريخ الشراء. يرجى إرجاع المنتج بحالته الأصلية.',
    /** نص الرد التلقائي عند طلب "دين/حساب". Placeholders: {{companyName}} {{balance}} {{link}} */
    whatsappAutoReplyTemplate: '',
  },
  localization: {
    currencySymbol: 'ل.س',
    defaultTaxRate: 0,
    isTaxEnabled: false,
    dateFormat: 'YYYY-MM-DD',
  },
  features: {
    enableBarcode: true,
    enableMultiUnit: true,
    enableBatchTracking: false,
    enableAttachments: false,
  },
};

let currentSettings = { ...JSON.parse(JSON.stringify(defaultSettings)) };

export function getSettings() {
  return JSON.parse(JSON.stringify(currentSettings));
}

export function updateSettings(patch, userId = 'system') {
  if (patch.branding && typeof patch.branding === 'object') {
    const oldBranding = JSON.parse(JSON.stringify(currentSettings.branding));
    currentSettings.branding = { ...currentSettings.branding, ...patch.branding };
    logEntityEdit('SETTINGS_EDIT', 'Settings', 'branding', oldBranding, currentSettings.branding, userId);
  }
  if (patch.localization && typeof patch.localization === 'object') {
    currentSettings.localization = { ...currentSettings.localization, ...patch.localization };
  }
  if (patch.features && typeof patch.features === 'object') {
    currentSettings.features = { ...currentSettings.features, ...patch.features };
  }
  return getSettings();
}

export function resetSettings() {
  currentSettings = JSON.parse(JSON.stringify(defaultSettings));
  return getSettings();
}
