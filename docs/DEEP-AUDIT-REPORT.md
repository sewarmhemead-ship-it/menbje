# تقرير التدقيق العميق والتحقق من المنطق — MIZAN

**التاريخ:** 2026-03-04  
**النطاق:** Industry Logic, OCR Engine, Navigation Sync, localStorage/Init, Global Variables.

---

## 1. منطق المهن (Industry Logic)

### IndustryManager وعدم تسرب بيانات Seed
- **النتيجة:** لا يوجد تسرب لبيانات البذرة بين الأنشطة.
- **التحقق:** `getSeedDataForModule(moduleId)` تستدعي `getIndustry()` عند كل استدعاء، و`applySeedDataForModule` تُستدعى من `openModule(moduleId, title)` قبل فتح الوحدة. بيانات المخبز (bakery) والموبايلات (mobile) معزولة في `SEED_BY_INDUSTRY[industry]` ولا تُختار إلا حسب النشاط الحالي.
- **إصلاح مطبّق:** في `getVisibleMenu(menu)` عند استلام قيمة غير مصفوفة (`!Array.isArray(menu)`) كان يُعاد `menu` كما هو، مما قد يسبب `menu.forEach` لاحقاً إلى استثناء وواجهة مكسورة. تم تغيير السلوك إلى إرجاع `[]` لتفادي ذلك.

### getVisibleMenu والـ DOM
- **النتيجة:** لا تبقى روابط مكسورة بعد الإخفاء.
- **التحقق:** القائمة المعروضة تُبنى من مصفوفة **مُصفاة** (عناصر ذات `hiddenIf` يحتوي النشاط الحالي تُستبعد). الـ Sidebar والـ Drawer يملآن من نفس `menu` ولا يُضاف إلى الـ DOM أي عنصر مخفي؛ العناصر المخفية ببساطة لا تُعرض.

---

## 2. سلامة محرك الـ OCR (vision-engine.js و runOcrOnCapture)

### تنظيف الذاكرة (Memory Cleanup)
- **الملاحظة:** `preprocessImage` تستخدم `Image` و`canvas` و`toDataURL`؛ الناتج data URL يُمرّر إلى Tesseract ولا يُعاد تحريره (لا يوجد revoke لـ data URL). Tesseract.js ينشئ Worker داخلياً.
- **إصلاح مطبّق:** في `vision-engine.js` تمت إضافة `.finally()` بعد سلسلة `processInvoiceImage` لاستدعاء `Tesseract.terminate()` إن وُجدت الدالة، لتقليل احتباس موارد الـ Worker بعد انتهاء المعالجة.

### إخفاء الـ Loader في كل الحالات (بما فيها Edge Cases)
- **المشكلة:** إذا لم تُستوفَ أو تُرفض وعدة `processInvoiceImage` (مثلاً تعليق أو انهيار Worker)، يبقى الـ Loader ظاهراً.
- **إصلاح مطبّق:**
  - إضافة **مهلة زمنية 120 ثانية** في `runOcrOnCapture`: عند انتهائها يتم إخفاء الـ Loader وإظهار تنبيه للمستخدم.
  - استدعاء `clearTimeout(loaderTimeout)` في كل من `.then` و`.catch` و`.finally` حتى لا تُنفَّذ المهلة بعد انتهاء المعالجة.
  - إضافة `.finally(hideOcrLoader)` لضمان إخفاء الـ Loader في أي مسار (نجاح، فشل، أو أي استثناء غير متوقع).

---

## 3. تزامن القوائم (Navigation Sync)

### مصدر واحد للقائمة المفلترة
- **النتيجة:** الـ Sidebar (`#pro-sidebar-nav`) والـ Drawer (`#nav-drawer-nav`) يقرآن من **نفس المتغير** `menu` الناتج من `IndustryManager.getVisibleMenu(erpMenu)` في نفس استدعاء `renderNavigation()`، ثم يُبنى HTML لكل منهما من نفس المصفوفة. لا يوجد مصدر ثانٍ للقائمة.

### إعادة الرسم عند تغيير النشاط
- **النتيجة:** عند تغيير النشاط من إعدادات النظام، `IndustryManager.initializeIndustry(this.value)` يصدّر حدث `vault-industry-changed`، والمستمع يستدعي `renderNavigation()`. `renderNavigation()` **تزامنية** (لا await) وتعيد رسم Sidebar و Drawer دفعة واحدة؛ لا يوجد تعليق متعمد للواجهة.
- **إصلاح مطبّق:** تم لف جسم `renderNavigation()` بـ `try/catch` مع `console.error` عند حدوث خطأ (مثلاً من `applyRBAC`) حتى لا يترك استثناء غير معالج واجهة نصف محدّثة. كما تم التعامل مع حالة عدم وجود `IndustryManager` أو `erpMenu` غير مصفوفة باستخدام `(Array.isArray(erpMenu) ? erpMenu : [])` كاحتياط.

---

## 4. الأداء واستقرار البيانات (localStorage و Init)

### تداخل localStorage
- **المفاتيح المستخدمة:** `vault_industry`, `vault_token`, `vault_user`, `vault_branding`, `vault_tasks`, `vault_autosave_backup`, `vault_autosave_time`, ومفتاح خاص بـ INV_HOLDS_KEY. كلها ذات بادئة `vault_` أو ثابتة، ولا يوجد تعارض بينها.

### تضخم البيانات عند Seed
- **الخادم (server/config/seed.js):** `seedDemoData()` تخرج فوراً إذا `products.size > 0`، أي أن الـ Seed يُنفَّذ مرة واحدة فقط. لا يوجد خطر تكرار إدراج نفس البيانات.
- **العميل:** بيانات البذرة حسب النشاط (`SEED_BY_INDUSTRY`) مخزنة في الذاكرة فقط ولا تُكتب إلى localStorage. تغيير النشاط يغيّر فقط `vault_industry` (قيمة واحدة).

### المستخدم الجديد (localStorage فارغ)
- **IndustryManager:** عند عدم وجود `vault_industry` أو قيمة غير صالحة، `getIndustry()` ترجع `'general'`. لا استثناء.
- **المهام (Tasks):** `window._tasks = window._tasks || []` ثم قراءة `vault_tasks`؛ إن لم يوجد أو فشل parse يُبقى مصفوفة فارغة.
- **Branding:** استدعاءات `localStorage.getItem('vault_branding')` داخل try/catch. التعامل مع المستخدم الجديد سليم.

---

## 5. كشف الأخطاء الصامتة والمتغيرات العالمية

### تعارض محتمل بين المحاسبة والمستودع
- **الفحص:** تم تتبع الاستخدامات:
  - **محاسبة:** `_coaSelectedAccountId`, `_lastStatementData`, `_customerStatementData`, `_contactProfileData`, `_contactsDirectoryList`, إلخ.
  - **مبيعات:** `_invoiceLines`, `_salesProductMap`, `_salesUnits`, `_salesFractioningRules`, `_pendingResumeHoldIndex`, `_startOfDayFocus`.
  - **مشتريات/OCR:** `_purchaseLines`, `_purchaseProducts`, `_lastOcrResult`.
  - **مستودع:** `_inventoryProductMap`.
- **النتيجة:** لا يوجد استخدام لنفس الاسم العالمي بين موديول المحاسبة وموديول المستودع بمعنى يتصادم. التسميات منفصلة (مثل _coa*, _purchase*, _inventory*, _sales*).

---

## ملخص الإصلاحات المطبقة

| الملف | التعديل |
|-------|---------|
| `dashboard/industry-manager.js` | `getVisibleMenu`: إرجاع `[]` بدلاً من `menu` عندما `menu` ليست مصفوفة، لتفادي استثناء وواجهة مكسورة. |
| `dashboard/index.html` | `runOcrOnCapture`: مهلة 120 ثانية لإخفاء الـ Loader، و`clearTimeout` في then/catch/finally، و`.finally(hideOcrLoader)` لضمان إخفاء الـ Loader في كل المسارات. |
| `dashboard/index.html` | `renderNavigation`: لف الجسم بـ try/catch مع console.error، واستخدام `(Array.isArray(erpMenu) ? erpMenu : [])` عند غياب IndustryManager. |
| `dashboard/vision-engine.js` | في `processInvoiceImage`: إضافة `.finally()` لاستدعاء `Tesseract.terminate()` إن وُجدت لتنظيف موارد الـ Worker. |

---

## التوصيات الاختيارية للمستقبل

1. **OCR:** مراقبة استهلاك الذاكرة عند معالجة عدد كبير من الصور؛ إن لزم، إعادة استخدام Worker واحد ثم إنهاؤه دورياً حسب سياسة التطبيق.
2. **العالميات:** تقليل الاعتماد على `window._*` عبر كائن واحد من namespaces (مثل `window.MIZAN.state`) لتحسين الوضوح والصيانة.
3. **القائمة:** إذا زاد تعقيد الـ RBAC أو الصلاحيات، يمكن استخراج بناء عناصر القائمة إلى دالة قابلة للاختبار ووحدات اختبار لها.
