/**
 * API request validation with Zod. Use in routes to avoid crashes and reject invalid input.
 */

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
}).refine((data) => (data.email || data.username || '').toString().trim().length > 0, {
  message: 'معرف الدخول (بريد أو اسم مستخدم) مطلوب',
  path: ['email'],
});

export const voucherReceiptSchema = z.object({
  cashAccountId: z.string().min(1).optional(),
  creditAccountId: z.string().min(1, 'الحساب الدائن مطلوب'),
  amountSYP: z.number().positive('المبلغ يجب أن يكون رقماً موجباً').finite(),
  memo: z.string().optional(),
});

export const voucherPaymentSchema = z.object({
  creditAccountId: z.string().optional(),
  debitAccountId: z.string().min(1, 'الحساب المدين مطلوب'),
  amountSYP: z.number().positive('المبلغ يجب أن يكون رقماً موجباً').finite(),
  memo: z.string().optional(),
});

export const voucherJournalSchema = z.object({
  lines: z.array(z.object({
    accountId: z.string().min(1),
    debit: z.number().min(0).finite(),
    credit: z.number().min(0).finite(),
    memo: z.string().optional(),
  })).min(2, 'أضف سطرين على الأقل (مدين ودائن)'),
});

export const expenseSchema = z.object({
  accountId: z.string().min(1, 'حساب المصروف مطلوب'),
  amountSYP: z.number().positive('المبلغ يجب أن يكون رقماً موجباً').finite(),
  memo: z.string().optional(),
  date: z.string().optional(),
  createdBy: z.string().optional(),
});

/**
 * Coerce request body and validate. Returns { success: true, data } or { success: false, error: string }.
 */
export function validateBody(schema, req) {
  try {
    const body = req.body || {};
    if (schema === voucherReceiptSchema || schema === voucherPaymentSchema) {
      const coerced = {
        ...body,
        amountSYP: body.amountSYP != null ? Number(body.amountSYP) : NaN,
      };
      const data = schema.parse(coerced);
      return { success: true, data };
    }
    if (schema === voucherJournalSchema) {
      const lines = (body.lines || []).map((l) => ({
        ...l,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }));
      const data = schema.parse({ lines });
      return { success: true, data };
    }
    if (schema === expenseSchema) {
      const coerced = {
        ...body,
        amountSYP: body.amountSYP != null ? Number(body.amountSYP) : NaN,
      };
      const data = schema.parse(coerced);
      return { success: true, data };
    }
    const data = schema.parse(body);
    return { success: true, data };
  } catch (err) {
    const msg = err.errors?.[0]?.message || err.message || 'بيانات غير صالحة';
    return { success: false, error: msg };
  }
}
