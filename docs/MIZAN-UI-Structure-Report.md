# تقرير هيكل واجهة MIZAN (Vault AI) — للتقديم إلى Gemini

هذا المستند يصف هيكل واجهة المستخدم في `dashboard/index.html` والملفات المرتبطة، لتمكين تحليل أو أتمتة أو تكامل مع نموذج Gemini.

---

## 1. هيكل القائمة الجانبية (Sidebar / التنقل)

الواجهة **لا تستخدم شريطاً جانبياً ثابتاً** على الديسكتوب. التنقل يعمل بآليتين:

### أ) الديسكتوب (md فما فوق): شريط علوي أفقي (Top Nav) + قوائم منسدلة

- **العنصر:** `<header class="top-nav fixed top-0 left-0 right-0 z-40 hidden md:block">`
- **البنية:** صف واحد: شعار + بحث (اختياري) + قائمة أفقية من **مجموعات** (كل مجموعة = زر + قائمة منسدلة عند الـ hover).

| المجموعة   | الأيقونة/النص | الروابط الفرعية (أوامر القائمة) |
|------------|----------------|-----------------------------------|
| **ملف**    | نص "ملف"       | لوحة التحكم، إعدادات الشركة، إعدادات النظام، إدارة المستخدمين، خروج |
| **تحرير**  | نص "تحرير"     | حقل بحث عام (صنف، فاتورة، عميل) + نتائج البحث |
| **المبيعات** | نص "المبيعات" | فاتورة بيع، مرتجع بيع، تقارير المبيعات |
| **المشتريات** (data-rbac="admin") | نص "المشتريات" | فاتورة مشتريات، مرتجع مشتريات، الموردين |
| **التصنيع** (data-rbac="admin") | نص "التصنيع" | وصفات BOM، أمر تصنيع |
| **المستودع** (data-rbac="admin") | نص "المستودع" | بطاقة مادة، حركات مخزون، جرد وتقارير |
| **السندات** (data-rbac="admin") | نص "السندات" | سند قبض، سند دفع، سند قيد، سند تحويل عملات |
| **المحاسبة** (data-rbac="admin") | نص "المحاسبة" | شجرة الحسابات، قيود اليومية، ميزان المراجعة، العملاء والموردين، كشف الحساب، المصاريف، مركز التقارير، لوحة التحكم المالية، تقارير محاسبية |
| **ملحق** (data-rbac="admin") | نص "ملحق" | العملات والذهب، المقايضة |
| **واتساب** | نص "واتساب" | صفحة واتساب والـ QR، الإعدادات (كارت واتساب) |
| **التعليمات** | نص "التعليمات" | عن البرنامج (معطّل) |

- **بعد القائمة:** زر لمبة حالة واتساب (`#wa-global-indicator-desktop`) يظهر على الديسكتوب فقط (`hidden md:flex`)، والنقر عليه يستدعي `showSection('whatsapp')`.
- **أسفل الهيدر:** شريط تبويبات مفتوحة `#tab-strip` (تبويبات الوحدات المفتوحة مثل ميزان المراجعة، قيود اليومية، إلخ).

**الكلاسات المهمة للقائمة الديسكتوب:**
- الحاوية: `menu-item-wrap relative group`
- الزر الظاهر: `menu-btn tap-haptic px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 rounded`
- القائمة المنسدلة: `menu-dropdown hidden group-hover:block absolute top-full right-0 mt-0 min-w-[...] glass rounded-lg shadow-xl py-1 border border-white/10`
- عنصر داخل القائمة: `w-full text-right px-4 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white`

**الإجراءات:** معظم الروابط تستدعي `openModule(moduleId, title)` (لوحدات المحاسبة/المبيعات/المستودع…) أو `showSection(id)` (لصفحات مثل المقايضة، واتساب، الإعدادات).

---

### ب) الموبايل: Drawer من اليمين (Nav Drawer) + شريط سفلي

- **العناصر:**  
  - `#nav-drawer-overlay` (خلفية معتمة، `md:hidden`)  
  - `#nav-drawer` (القائمة المنزلقة، `md:hidden`، عرض `min(85vw, 280px)`)

**هيكل الـ Drawer:**

| القسم        | المحتوى |
|-------------|---------|
| **drawer-header** | زر إغلاق، أيقونة درع، "سوار أمان التاجر"، نص فرعي "نظام Vault AI المحاسبي الذكي" |
| **nav** (قائمة) | أزرار من نوع `drawer-item tap-haptic`، كل زر: أيقونة SVG (class `lucide-thin`) + نص: المحاسبة، المخزون، المقايضة، التقارير، الإعدادات |
| **drawer-footer** | زر واحد: تسجيل الخروج (نص بلون وردي) |

**الأيقونات في الـ Drawer:** SVG inline، كلها `stroke-width="1"` (أسلوب Lucide thin). لا تُستخدم صور خارجية للأيقونات.

**الإجراءات:** كل زر يستدعي `showSection('...'); closeNavDrawer();` أو `showSection('accounting'); openModule('reports','مركز التقارير'); closeNavDrawer();` (للتقارير).

**شريط سفلي (موبايل فقط):** `nav.flex.md:hidden...bottom-nav` — ثلاثة عناصر: الرئيسية، FAB كاميرا، القائمة (فتح الـ Drawer). الحالة النشطة للزر تُحدد بـ `data-mobile-nav` و class `active` على `.mobile-nav-btn`.

---

## 2. نظام التنقل (Navigation Logic)

### التمييز بين "قسم" و"وحدة/موديول"

- **Sections (أقسام):** عناصر لها `data-section` و `id="section-{id}"` (مثل `section-dashboard`, `section-inventory`, `section-settings`). تُعرض في منطقة المحتوى الرئيسية وتتبدّل عبر `showSection(id)`.
- **Modules (وحدات):** محتوى يُعرض داخل `#module-content` ويُولَّد ديناميكياً عبر `renderModulePanel(moduleId)`. يُفتح بـ `openModule(moduleId, title)` ويُضاف تبويب في `#tab-strip`.

### دالة `showSection(id)`

```js
function showSection(id) {
  const section = document.getElementById('section-' + id);
  const feature = section?.getAttribute('data-feature');
  // إذا القسم مقيّد بباقة (tier) ولا يملك المستخدم الميزة → إظهار tier-overlay والخروج
  if (feature && currentUser && !tierFeatures.includes(feature)) {
    document.getElementById('tier-overlay').classList.remove('hidden');
    return;
  }
  // إزالة active من كل الأقسام وكل روابط التنقل
  document.querySelectorAll('[data-section]').forEach(s => { s.classList.remove('active'); });
  document.querySelectorAll('[data-nav]').forEach(n => { n.classList.remove('active'); });
  // إخفاء منطقة الوحدات
  const mc = document.getElementById('module-content');
  if (mc) mc.classList.add('hidden');
  // إظهار القسم المطلوب وتفعيل الرابط المطابق
  if (section) section.classList.add('active');
  const nav = document.querySelector('[data-nav="' + id + '"]');
  if (nav) nav.classList.add('active');
  closeNavDrawer();
  // تحديث شريط الموبايل السفلي إن لزم
  if (id === 'dashboard') setMobileNav('dashboard');
  else document.querySelectorAll('.mobile-nav-btn').forEach(n => { n.classList.remove('active'); });
  // أحداث خاصة حسب القسم (تحديث واتساب، تحميل واتساب، جرد، إلخ)
  if (id === 'dashboard' && typeof refreshDashboardCharts === 'function') refreshDashboardCharts();
  if (id === 'settings' && typeof updateWhatsAppGlobalIndicator === 'function') updateWhatsAppGlobalIndicator();
  if (id === 'barter' && typeof refresh === 'function') refresh('barter');
  if (id === 'whatsapp') { /* تحميل حالة واتساب و QR */ }
  // ...
}
```

### الحالة النشطة (Active State)

- **الأقسام:** يُعرض القسم فقط إذا كان له class `active`. القاعدة في CSS:
  - `[data-section] { display: none; }`
  - `[data-section].active { display: block; animation: fadeIn 0.3s ease; }`
- **روابط التنقل (الديسكتوب القديم / الموبايل):** العنصر الذي يُطابق القسم الحالي يحمل `data-nav="{id}"` و class `active`. للقائمة العلوية: `.topnav-item.active` (لون أخضر وتأثير ظل).
- **الموبايل السفلي:** `.mobile-nav-btn.active` (لون أزرق و glow).
- **تبويبات الوحدات:** في `#tab-strip`، التبويب النشط يُحدد بـ `activeTabId` و class مثل `bg-emerald-500/30 text-emerald-300`.

### فتح وحدة (موديول) — `openModule(moduleId, title)`

- يضيف/يختار تبويباً في `openTabs` ويستدعي `switchTab(tab.id)`.
- يخفّي كل الأقسام (`[data-section]` بدون `active`) ويُظهر `#module-content` ويستدعي `renderModulePanel(moduleId)` لملء المحتوى.

---

## 3. تنسيق الصفحات (Sections) — مثالان

### مثال 1: قسم المواد/المخزون (`#section-inventory`)

- **الهيكل:**
  - عنوان: `<h2 class="page-title-h2 mb-1">المخزون</h2>`
  - وصف: `<p class="page-desc mb-4">...</p>`
  - كارت رئيسي: `div.card-standard`
    - هيدر فرعي: `flex flex-wrap items-center justify-between gap-2 mb-3` (عنوان "خريطة حرارة المخزون" + وسيلة إيضاح ألوان)
    - منطقة المحتوى: `#fractioning-heatmap` (شبكة `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3`)
    - نص ملخص: `#fractioning-summary`
    - زر "عرض التفاصيل": `toggleDetail('inv-detail')`
    - لوحة تفاصيل قابلة للطي: `#inv-detail.detail-panel` ← بداخلها `#inv-detail-inner.detail-table-wrap` (للجدول)
- **لا يوجد جدول رئيسي في الهيكل الثابت:** الجدول يُحقن داخل `#inv-detail-inner` عند الطلب.

### مثال 2: ميزان المراجعة (وحدة داخل `#module-content`)

ميزان المراجعة **ليس** section بل **module**: المحتوى يُولَّد في `#module-content` عبر `renderTrialBalanceGrid(mc)` (من `public/js/modules/accounting.js`).

- **الهيكل الناتج ديناميكياً:**
  - غلاف: `div.card-standard`
  - عنوان: `<h3 class="page-title-h3 mb-4">ميزان المراجعة</h3>`
  - فلتر: `label` + `input type="date"` (id `tb-filter-date`) مع `onchange="refreshActiveModule()"`
  - أزرار: زر "طباعة / تصدير PDF" (`printTrialBalance()`)
  - جدول: داخل `div.detail-table-wrap.mt-4` ← `table.table-glass.w-full.text-sm.text-right`
    - رأس: الكود، اسم الحساب، مدين، دائن
    - جسم: صفوف من البيانات
    - تذييل: صف الإجمالي (مدين/دائن)
  - نص: "متوازن: نعم/لا"

**الخلاصة:** قسم المخزون = section ثابت مع كروت وعناصر ثابتة + حقن تفاصيل. ميزان المراجعة = محتوى كامل مُنشأ داخل `#module-content` بكارت واحد وجدول واحد وفلتر تاريخ وأزرار إجراء.

---

## 4. نظام التصميم (CSS Architecture)

### مصدر الأنماط

- **ملف خارجي:** `/dist/tailwind.css` (Tailwind مُجمَّع).
- **أنماط مضمّنة في الصفحة:** كتلة `<style>` كبيرة داخل `dashboard/index.html` (من حوالي السطر 25 إلى حوالي 350)، تحتوي على:
  - متغيرات CSS (`:root`) للألوان والخطوط والمسافات.
  - كلاسات للصفحات، الجداول، الكروت، الأزرار، التنقل، الـ modals، الطباعة، والموبايل.

**لا يوجد ملف CSS موحد منفصل للمشروع:** الجزء الأكبر من التصميم إما Tailwind (كلاسات utility في الـ HTML) أو أنماط مضمّنة في نفس الـ HTML.

### كلاسات موحدة للجداول

| الكلاس | الاستخدام |
|--------|-----------|
| `table-glass` | الجدول الرئيسي: خلفية شبه شفافة، حدود زمردية، نص يمين. يُستخدم في ميزان المراجعة، قيود اليومية، كشف الحساب، التفاصيل داخل الـ modals. |
| `table-glass thead th` | رأس الجدول: خلفية زمردية خفيفة، لون نص slate. |
| `table-glass tbody td` | خلايا الجسم: حدود سفلية خفيفة، hover بلون زمردي خفيف. |
| `table-glass tfoot td` | تذييل الجدول: خلفية أغمق، خط علوي. |
| `detail-table-wrap` | غلاف الجدول: overflow-x/y، أقصى ارتفاع، لمس سلس على الموبايل. |
| `table-cell-ellipsis` | اختصار النص الطويل بنقاط (max-width + ellipsis). |
| `um-table` | جدول إدارة المستخدمين (هيكل مختلف قليلاً). |
| `return-excel-table`, `reports-returns-table` | جداول مرتجعات وتقارير. |
| `table-sticky-header` | رأس ثابت عند التمرير. |
| `table-zebra` | تناوب لون صفوف. |

### كلاسات موحدة للكروت

| الكلاس | الاستخدام |
|--------|-----------|
| `card-standard` | الكارت الأساسي: خلفية داكنة شبه شفافة، حدود، padding، زوايا مستديرة. |
| `glass-card` | كارت زجاجي مع backdrop-filter وظل وتأثير hover. |
| `glass` | خلفية زجاجية للقوائم المنسدلة ونتائج البحث. |
| `vault-card` | كروت لوحة التحكم الموحدة (خريطة الميزان، الصرف، إلخ): حد، ظل، hover. |
| `bento-tilt` | كروت بتأثير 3D خفيف عند hover. |

### كلاسات موحدة للأزرار

| النمط | الكلاس / النمط |
|-------|-----------------|
| زر أساسي (أخضر) | `bg-emerald-500/20 text-emerald-400` أو `bg-emerald-500/20 text-emerald-400 text-sm font-medium` مع `rounded-lg`, `px-4 py-2`. |
| زر تحذير/ثانوي | `bg-amber-500/20 text-amber-400`, `bg-red-500/20 text-red-400`. |
| زر محايد | `bg-white/5 border border-white/10 text-slate-300`, `bg-white/10 text-slate-300`. |
| تفاعل اللمس | `tap-haptic` (تقليل scale عند active). |
| حجم/تباعد موحد في الوحدات | داخل `#module-content`: أزرار بـ `min-height: 2.5rem`, `padding: 0.5rem 0.75rem` (في media الموبايل). |

### عناوين ونصوص

- `page-title-h1`, `page-title-h2`, `page-title-h3`: أحجام وأوزان مختلفة، لون أبيض أو slate.
- `page-desc`: وصف بلون رمادي.
- `state-empty`, `state-loading`, `state-error`, `state-empty-box`: حالات فارغة أو تحميل أو خطأ.

### لوحات قابلة للطي (Detail panels)

- `detail-panel`: `max-height: 0` و `overflow: hidden` افتراضياً.
- `detail-panel.open`: `max-height: 420px` لإظهار المحتوى.
- التبديل عبر `toggleDetail(id)` (إضافة/إزالة class `open`).

---

## 5. كود الـ Layout الرئيسي (Body + Sidebar + Main Content)

الواجهة **لا تحتوي على sidebar ثابت**؛ الـ "sidebar" على الموبايل هو الـ drawer المنزلق. على الديسكتوب المحتوى تحت الشريط العلوي فقط. فيما يلي الهيكل المُستخرج للـ body والتوزيع المساحي.

```html
<body class="bg-[#0b1220] text-slate-200 font-sans min-h-screen antialiased safe-area-pt">
  <!-- خلفية متحركة -->
  <div class="mesh-bg" aria-hidden="true"></div>

  <!-- طبقات ثابتة: قفل شاشة، ترقية باقة، سبلايش، أوفلاين، توست، مودالات -->
  <div id="lock-screen" class="hidden fixed ..."></div>
  <div id="tier-overlay" class="hidden fixed ..."></div>
  <div id="splash" class="fixed inset-0 z-[100] ...">...</div>
  <div id="offline-indicator" class="hidden fixed ...">...</div>
  <div id="toast-container" ...></div>
  <!-- ... مودالات (supplier, audit-entry, إلخ) ... -->

  <!-- الشريط العلوي (ديسكتوب فقط) -->
  <header class="top-nav fixed top-0 left-0 right-0 z-40 hidden md:block">
    <div class="flex items-center h-12 px-3 gap-2">
      <!-- شعار + بحث + قائمة المجموعات + لمبة واتساب -->
    </div>
    <div id="tab-strip" class="flex items-center gap-1 px-2 py-1 bg-black/20 border-t border-white/5 overflow-x-auto min-h-[36px]"></div>
  </header>

  <!-- الحاوية الرئيسية: لا يوجد sidebar ثابت، فقط main -->
  <div class="flex min-h-screen">
    <main class="flex-1 w-full pt-4 md:pt-24 transition-all duration-300 p-4 md:p-6 lg:p-8 pb-24 md:pb-8 overflow-x-hidden">
      <!-- هيدر الصفحة: عنوان + لمبة واتساب (موبايل) + أزرار (قائمة، تركيز، خروج) -->
      <header class="mb-6 md:mb-8 pb-4 md:pb-6 border-b border-white/5 md:border-none flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="... md:hidden">Vault AI</h1>
          <p class="text-slate-500 text-xs md:text-sm mt-1 hidden sm:block">...</p>
        </div>
        <div id="wa-global-indicator" class="flex md:hidden items-center gap-2 ...">...</div>
        <div class="flex items-center gap-2">
          <button class="... md:hidden" onclick="openNavDrawer()">...</button>
          <button id="focus-mode-btn" ...>وضع التركيز</button>
          <button onclick="logout()">خروج</button>
        </div>
      </header>

      <!-- منطقة الوحدات (تبويبات المحاسبة، المبيعات، إلخ) -->
      <div id="module-content" class="hidden w-full"></div>

      <!-- الأقسام (Sections): واحد فقط visible (active) في كل مرة -->
      <section id="section-dashboard" data-section class="unified-dashboard active" style="background-color:#0b1220">...</section>
      <section id="section-accounting" data-section>...</section>
      <section id="section-barter" data-section data-feature="barter">...</section>
      <section id="section-vision" data-section data-feature="vision">...</section>
      <section id="section-inventory" data-section>...</section>
      <section id="section-currency" data-section data-feature="currency">...</section>
      <section id="section-whatsapp" data-section data-feature="whatsapp">...</section>
      <section id="section-settings" data-section>...</section>
      <section id="section-import" data-section>...</section>
    </main>
  </div>

  <!-- Drawer (موبايل): خارج الـ flex، fixed -->
  <div id="nav-drawer-overlay" class="md:hidden" onclick="closeNavDrawer()"></div>
  <aside id="nav-drawer" class="md:hidden" aria-label="قائمة التنقل">...</aside>

  <!-- شريط سفلي (موبايل فقط) -->
  <nav class="flex md:hidden fixed bottom-0 left-0 right-0 z-40 bottom-nav safe-area-pb">...</nav>
</body>
```

### التوزيع المساحي (Spacing)

| العنصر | القيم |
|--------|--------|
| **body** | `min-h-screen`, خلفية `#0b1220`, نص `slate-200`. |
| **الحاوية الرئيسية** | `div.flex.min-h-screen`: عنصر واحد فقط وهو `main` (لا sidebar ثابت). |
| **main** | `flex-1 w-full`؛ علوي: `pt-4 md:pt-24` (تعويض الشريط العلوي على الديسكتوب)؛ أفقياً: `p-4 md:p-6 lg:p-8`؛ سفلي: `pb-24 md:pb-8` (تعويض الشريط السفلي على الموبايل). |
| **هيدر الصفحة** | `mb-6 md:mb-8`, `pb-4 md:pb-6`, حد سفلي على الموبايل فقط (`md:border-none`). |
| **#module-content** | `hidden` افتراضياً؛ عند الظهور يأخذ `w-full` ولا padding إضافي من الكلاس (الـ padding من الـ main). |
| **Top nav** | `h-12` للصف الأول؛ `tab-strip` بحد علوي و`min-h-[36px]`. |
| **Nav drawer** | عرض `min(85vw, 280px)`؛ يفتح من اليمين بـ `transform: translateX(0)` عند class `open`. |
| **Bottom nav** | `safe-area-pb` لتعويض شريط الأمان في الهواتف. |

---

## ملخص للمراجع الخارجية (Gemini)

- **ملف الواجهة الرئيسي:** `dashboard/index.html`.
- **موديول المحاسبة (شجرة حسابات، قيود، ميزان مراجعة، سند قيد):** `public/js/modules/accounting.js`؛ الدوال معرّفة على `window` وتُستدعى من `renderModulePanel` في `index.html`.
- **التنقل:** `showSection(id)` للأقسام، `openModule(moduleId, title)` للوحدات؛ الحالة النشطة عبر class `active` على `[data-section]` و`[data-nav]` وتبويبات `#tab-strip`.
- **التصميم:** Tailwind (`/dist/tailwind.css`) + كتلة `<style>` مضمنة في `index.html`؛ لا ملف CSS موحد منفصل للمشروع. الجداول الموحدة: `table-glass` و`detail-table-wrap`؛ الكروت: `card-standard`, `glass-card`, `vault-card`؛ الأزرار: نمط زمردي/أمبير/أبيض شفاف مع `tap-haptic`.

تم إعداد هذا التقرير آلياً من تحليل الكود المصدري لواجهة MIZAN (Vault AI).
