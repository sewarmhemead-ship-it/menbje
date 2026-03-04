/**
 * Draft Orders: created from WhatsApp (or other channels) and fed into POS.
 */

import { store, getNextId } from '../../config/store.js';

const { draftOrders } = store;

export function createDraftOrder({ source = 'whatsapp', customerPhone, customerName, lines, notes = '' }) {
  const id = getNextId('draftOrders');
  const draft = {
    id,
    source,
    customerPhone: customerPhone || null,
    customerName: customerName || null,
    lines: Array.isArray(lines) ? lines : [],
    notes,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  draftOrders.set(id, draft);
  return draft;
}

export function addLineToDraft(draftId, { productId, productName, unitId, quantity, unitPrice }) {
  const draft = draftOrders.get(draftId);
  if (!draft) return null;
  const line = {
    productId,
    productName: productName || '',
    unitId,
    quantity: Number(quantity) || 1,
    unitPrice: Number(unitPrice) || 0,
  };
  draft.lines.push(line);
  return draft;
}

export function getDraft(draftId) {
  return draftOrders.get(draftId) || null;
}

export function listDrafts(status = null) {
  const list = Array.from(draftOrders.values());
  if (status) return list.filter((d) => d.status === status);
  return list;
}

export function setDraftStatus(draftId, status) {
  const draft = draftOrders.get(draftId);
  if (!draft) return null;
  draft.status = status;
  draft.updatedAt = new Date().toISOString();
  return draft;
}

/**
 * Convert draft to a POS order (call from POS when accepting the draft).
 */
export function convertDraftToOrderPayload(draftId) {
  const draft = draftOrders.get(draftId);
  if (!draft || draft.status !== 'draft') return null;
  return {
    source: 'draft',
    draftId,
    customerPhone: draft.customerPhone,
    customerName: draft.customerName,
    lines: draft.lines,
    notes: draft.notes,
  };
}
