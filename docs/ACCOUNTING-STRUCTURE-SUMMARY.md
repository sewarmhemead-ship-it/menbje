# بنية قسم المحاسبة — القيود، دفتر الأستاذ، ميزان المراجعة

ملخص للمراجعة مع Gemini أو لأي تطوير لاحق. المشروع لا يستخدم `public/dashboard/` منفصلاً؛ الواجهة والـ JS مدمجان في ملف واحد.

---

## 1. الملفات الأساسية (خرائط سريعة)

| الدور | المسار | الوصف |
|------|--------|--------|
| **الواجهة الرئيسية + JS أمامي** | `dashboard/index.html` | كل واجهة الداشبورد: قوائم، كروت، جداول القيود وميزان المراجعة وشجرة الحسابات. الـ JS مضمّن في نفس الملف (لا يوجد `app.js` أو `accounting.js` منفصل). |
| **دفتر القيود (عرض عام)** | نفس الملف، عنصر `#trial-balance-content` وقسم المحاسبة | ميزان المراجعة يُعرض داخل الصفحة الرئيسية وفي تاب "ميزان المراجعة". |
| **واجهة صفحة الدين للعميل** | `dashboard/debt.html` | صفحة عامة لرصيد العميل (رابط دينك) — لا تدير القيود. |

---

## 2. Backend — الملفات المسؤولة عن المنطق

### 2.1 القيود (Journal) ودفتر الأستاذ

| الملف | المسؤولية |
|-------|------------|
| `server/accounting/journal.js` | محرك القيد المزدوج: `postDoubleEntry`, `postCompoundEntry`, `ensureBalance`. جلب الرصيد: `getAccountBalance`, `getAccountBalanceExtended`. قائمة القيود: `listJournalEntries`. حذف (إبطال): `deleteJournalEntry`. التخزين في `store.journalEntriesList`. |
| `server/accounting/vouchers.js` | سندات تمسك بالقيود: سند قبض، سند دفع، سند قيد (`postJournalVoucher`). تستدعي `journal.postDoubleEntry` أو `journal.postCompoundEntry`. |
| `server/accounting/chartOfAccounts.js` | شجرة الحسابات: تعريف أنواع الحسابات (أصول، خصوم، حقوق ملكية، إيرادات، مصروفات) والـ `DEFAULT_CHART`. لا يخزن القيود. |
| `server/accounting/statements.js` | ميزان المراجعة `getTrialBalance(asOfDate)`، قائمة الأرباح والخسائر، كشف الحساب. يقرأ من `journalEntriesList` و `accounts`. |

### 2.2 التخزين (Store)

- **`server/config/store.js`**
  - `accounts`: خريطة (Map) الحسابات — تُملأ من البذرة أو من واجهة الإعدادات.
  - `journalEntriesList`: مصفوفة القيود. كل قيد إما بسيط (`debitAccountId`, `creditAccountId`, `amountSYP`) أو مركب (`compoundLines`: مصفوفة `{ accountId, debit, credit }`).

### 2.3 الـ API (Controllers)

- **`server/routes/api.js`**
  - **الحسابات:** `GET /accounts` → قائمة الحسابات.
  - **القيود:** `GET /journal` (فلترة: refType, accountId, fromDate, toDate, limit)، `GET /journal/:id`، `POST /journal` (body: `lines[]`, date, createdBy)، `POST /journal/:id/void` (body: reasonCode).
  - **رصيد حساب:** `GET /accounts/:id/balance`.
  - **ميزان المراجعة:** `GET /statements/trial-balance?asOfDate=...`.
  - **كشف حساب:** `GET /statements/account?accountId=...&fromDate=...&toDate=...`.
  - **سند قيد:** `POST /vouchers/journal` (يستدعي `vouchers.postJournalVoucher`).

---

## 3. Frontend — أين المنطق في الواجهة؟

كل الـ JS أمامي داخل **`dashboard/index.html`** (بدون ملف `app.js` أو `accounting.js` منفصل). الدوال الرئيسية للمحاسبة:

| الدالة | السطور (تقريباً) | الوظيفة |
|--------|-------------------|---------|
| `openModule(moduleId, title)` | ~1570 | يفتح تاب المحاسبة ويستدعي المُصغّر المناسب (مثلاً `renderJournalGrid`, `renderTrialBalanceGrid`, `renderChartOfAccounts`). |
| `renderChartOfAccounts(container)` | ~2792–2836 | يجلب `GET /accounts`، يبني شجرة حسب النوع (أصول، خصوم، إلخ) ويعرضها قابلة للطي. |
| `renderJournalGrid(container)` | ~2874–2886 | يجلب `GET /journal?limit=100` و `GET /accounts`، يبني جدول (التاريخ، مدين، دائن، المبلغ ل.س، البيان). يدعم قيوداً بسيطة فقط في العرض الحالي (المركبة تُعرض كسطر واحد أو تحتاج توسيع). |
| `renderTrialBalanceGrid(container)` | ~2891–2906 | يجلب `GET /statements/trial-balance?asOfDate=...`، يعرض جدول (كود، اسم الحساب، مدين، دائن)، تاريخ الفلتر، زر طباعة/PDF. |
| `refresh('journal')`, `refresh('trial-balance')` | مستخدمة في أماكن متعددة | تعيد تحميل بيانات التاب وتحديث الواجهة (مثلاً بعد إضافة قيد أو سند). |
| `formatNum(n)` | في نفس الملف | تنسيق الأرقام للعرض (ل.س). |

**ملاحظة:** الجمع والطرح الفعلي لا يحدث في الواجهة؛ الواجهة تعرض فقط ما يرجعه الـ API. المنطق الحسابي (مدين/دائن، توازن، رصيد) في السيرفر (`journal.js`, `statements.js`).

---

## 4. الأكواد الأساسية (مقتطفات للمراجعة)

### 4.1 Backend — قيد مزدوج بسيط (`server/accounting/journal.js`)

```javascript
export function postDoubleEntry(debitAccountId, creditAccountId, amountSYP, opts = {}) {
  // التحقق من الحسابات والمبلغ
  if (!accounts.has(debitAccountId) || !accounts.has(creditAccountId))
    return { success: false, error: 'Account not found' };
  const entry = {
    id: getNextId('journalEntries'),
    date: new Date().toISOString(),
    debitAccountId,
    creditAccountId,
    amountSYP: Number(amountSYP),
    memo: opts.memo || '',
    deleted: false,
  };
  store.journalEntriesList.push(entry);
  return { success: true, entry };
}
```

### 4.2 Backend — ميزان المراجعة (`server/accounting/statements.js`)

```javascript
export function getTrialBalance(asOfDate = null) {
  const list = (journalEntriesList || []).filter((e) => !e.deleted);
  const byAccount = new Map();
  for (const [id, acc] of accounts)
    byAccount.set(id, { id, code: acc.code, name: acc.name, type: acc.type, debit: 0, credit: 0 });
  for (const e of list) {
    if (asOfDate && e.date > asOfDate) continue;
    if (e.compoundLines) {
      for (const line of e.compoundLines) {
        const row = byAccount.get(line.accountId);
        if (row) { row.debit += line.debit || 0; row.credit += line.credit || 0; }
      }
    } else {
      const amt = e.amountSYP || 0;
      const dr = byAccount.get(e.debitAccountId);
      const cr = byAccount.get(e.creditAccountId);
      if (dr) dr.debit += amt;
      if (cr) cr.credit += amt;
    }
  }
  const rows = Array.from(byAccount.values()).filter((r) => r.debit !== 0 || r.credit !== 0);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return {
    asOfDate: asOfDate || new Date().toISOString(),
    rows,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}
```

### 4.3 Backend — مسارات القيود وميزان المراجعة (`server/routes/api.js`)

```javascript
router.get('/accounts', (req, res) => {
  res.json({ success: true, data: Array.from(accounts.values()) });
});
router.get('/journal', requireNoCashier, (req, res) => {
  const list = journal.listJournalEntries({ refType, accountId, fromDate, toDate, limit });
  res.json({ success: true, data: list });
});
router.post('/journal', requireNoCashier, (req, res) => {
  const { lines, date, createdBy } = req.body;
  const result = vouchers.postJournalVoucher({ lines, date, createdBy });
  res.status(201).json({ success: true, data: result });
});
router.get('/statements/trial-balance', requireNoCashier, (req, res) => {
  const data = statements.getTrialBalance(req.query.asOfDate || null);
  res.json({ success: true, data });
});
```

### 4.4 Frontend — عرض قيود اليومية (`dashboard/index.html`)

```javascript
async function renderJournalGrid(container) {
  const r = await fetchJson('/journal?limit=100');
  const list = r.data || [];
  const accR = await fetchJson('/accounts');
  const accMap = {};
  (accR.data || []).forEach(a => { accMap[a.id] = a.name || a.code; });
  const rows = list.map(e => ({
    date: e.date ? e.date.slice(0,10) : '',
    debit: accMap[e.debitAccountId] || e.debitAccountId,
    credit: accMap[e.creditAccountId] || e.creditAccountId,
    amount: e.amountSYP,
    memo: e.memo || ''
  }));
  // بناء HTML الجدول من rows وعرضه في container
  container.innerHTML = '... جدول: التاريخ، مدين، دائن، المبلغ ل.س، البيان ...';
}
```

### 4.5 Frontend — عرض ميزان المراجعة (`dashboard/index.html`)

```javascript
async function renderTrialBalanceGrid(container) {
  const asOf = document.getElementById('tb-filter-date')?.value || new Date().toISOString().slice(0,10);
  const r = await fetchJson('/statements/trial-balance?asOfDate=' + asOf);
  const d = r.data;
  // إنشاء جدول: الكود، اسم الحساب، مدين، دائن + الإجمالي + متوازن: نعم/لا
  container.innerHTML = '... جدول + فلتر تاريخ + زر طباعة/PDF ...';
}
```

---

## 5. تدفق البيانات (سريع)

1. **إضافة قيد:** المستخدم يملأ نموذج سند القيد (أو فاتورة بيع/مقايضة) → `POST /journal` أو `POST /vouchers/journal` → `vouchers.postJournalVoucher` → `journal.postCompoundEntry` (أو postDoubleEntry) → يُدفع إلى `store.journalEntriesList`.
2. **عرض القيود:** الواجهة تستدعي `renderJournalGrid` → `GET /journal` → `journal.listJournalEntries` → عرض الجدول.
3. **ميزان المراجعة:** الواجهة تستدعي `renderTrialBalanceGrid` → `GET /statements/trial-balance?asOfDate=...` → `statements.getTrialBalance` → تجميع مدين/دائن لكل حساب حتى التاريخ → عرض الجدول + الإجمالي + متوازن.

---

## 6. ملخص للمراجعة مع Gemini

- **ملف الواجهة الرئيسي:** `dashboard/index.html` (جداول الحسابات والقيود وميزان المراجعة كلها داخل هذا الملف أو تُحقن فيه عبر JS).
- **ملف المنطق الأمامي:** لا يوجد ملف JS منفصل للمحاسبة؛ الدوال `renderChartOfAccounts`, `renderJournalGrid`, `renderTrialBalanceGrid`, و`refresh` موجودة داخل `dashboard/index.html`.
- **ملفات السيرفر (الـ "Controllers" والمنطق):**
  - القيود: `server/accounting/journal.js`, `server/accounting/vouchers.js`
  - الحسابات (تعريف): `server/accounting/chartOfAccounts.js`
  - ميزان المراجعة وكشف الحساب: `server/accounting/statements.js`
  - مسارات الـ API: `server/routes/api.js` (القطاعات المذكورة أعلاه).

يمكنك نسخ هذا الملف أو فتح الملفات المذكورة في Cursor وتمرير المقتطفات لـ Gemini للمراجعة أو للتعديلات المقترحة.
