/**
 * Accounting module: chart of accounts (tree), journal grid, trial balance, journal voucher (pro grid).
 * Depends on globals: fetchJson, postJson, getAuthHeaders, API, formatNum, showToast, emptyStateHTML, getPrintHeaderTemplate, refreshActiveModule, openModule.
 */
(function () {
  'use strict';

  var MIN_JOURNAL_LINES = 2;
  var BALANCE_TOLERANCE = 0.01;

  // —— Tree: Chart of Accounts (شجرة الحسابات) ——
  window.renderChartOfAccounts = async function (container) {
    var r = await fetchJson('/accounts');
    var accounts = r.data || [];
    var byId = {};
    accounts.forEach(function (a) { byId[a.id] = a; });

    function buildTree(typeFilter) {
      var list = accounts.filter(function (a) { return a.type === typeFilter; });
      var roots = list.filter(function (a) { return !a.parentId || !byId[a.parentId]; });
      var childrenOf = {};
      list.forEach(function (a) {
        var pid = a.parentId && byId[a.parentId] ? a.parentId : null;
        if (!childrenOf[pid]) childrenOf[pid] = [];
        childrenOf[pid].push(a);
      });
      function sortByCode(arr) { return arr.slice().sort(function (x, y) { return (x.code || '').localeCompare(y.code || ''); }); }
      function renderNode(acc, depth, isLeaf) {
        var id = 'coa-' + (acc.id || '').replace(/\s/g, '_');
        var kids = sortByCode(childrenOf[acc.id] || []);
        var hasChildren = kids.length > 0;
        var isOpen = window._coaOpen && window._coaOpen[id] !== false;
        var icon = hasChildren ? '📁' : '📄';
        var html = '<div class="coa-node" data-id="' + id + '" data-account-id="' + acc.id + '" data-is-leaf="' + (!hasChildren) + '">';
        html += '<div class="flex items-center gap-2 py-1.5 px-3 rounded hover:bg-white/10 cursor-pointer coa-row" style="padding-right: ' + (12 + depth * 20) + 'px">';
        if (hasChildren) html += '<span class="coa-toggle text-slate-400 w-6">' + (isOpen ? '▼' : '▶') + '</span>';
        else html += '<span class="w-6 inline-block"></span>';
        html += '<span class="text-lg">' + icon + '</span>';
        html += '<span class="text-slate-300">' + (acc.code || '') + ' · ' + (acc.name || '').replace(/</g, '&lt;') + '</span></div>';
        if (hasChildren && isOpen) {
          html += '<div class="coa-children border-r border-white/10" style="margin-right: ' + (depth * 12 + 12) + 'px">';
          kids.forEach(function (child) { html += renderNode(child, depth + 1, false); });
          html += '</div>';
        }
        html += '</div>';
        return html;
      }
      return roots.map(function (acc) { return renderNode(acc, 0, false); }).join('');
    }

    window._coaOpen = window._coaOpen || {};
    var types = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    var typeNames = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
    container.innerHTML =
      '<div class="flex gap-4 flex-wrap"><div class="card-standard flex-1 min-w-0"><h3 class="page-title-h3 mb-4">شجرة الحسابات</h3><p class="page-desc mb-3">انقر على الحساب الرئيسي للطي/التوسيع. انقر على حساب فرعي (📄) لعرض الرصيد.</p><div class="space-y-4">' +
      types.map(function (t) { return '<div><h4 class="text-sm font-medium text-emerald-400 mb-2">' + (typeNames[t] || t) + '</h4><div class="coa-tree">' + buildTree(t) + '</div></div>'; }).join('') +
      '</div></div><div id="coa-side-card" class="card-standard w-72 shrink-0 hidden"><h4 class="text-sm font-medium text-slate-400 mb-2">رصيد الحساب</h4><p id="coa-side-balance" class="text-xl font-semibold text-emerald-400">—</p><p id="coa-side-account" class="text-slate-500 text-sm mt-1">—</p><button type="button" id="coa-btn-statement" class="tap-haptic mt-3 w-full py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-medium">كشف حساب</button></div></div>';

    container.querySelectorAll('.coa-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        var node = e.currentTarget.closest('.coa-node');
        if (!node) return;
        var accountId = node.getAttribute('data-account-id');
        var isLeaf = node.getAttribute('data-is-leaf') === 'true';
        var toggle = node.querySelector('.coa-toggle');
        if (toggle && !isLeaf) {
          var id = node.getAttribute('data-id');
          window._coaOpen[id] = !window._coaOpen[id];
          var mc = document.getElementById('module-content');
          if (mc) window.renderChartOfAccounts(mc);
          return;
        }
        if (isLeaf && accountId) {
          showCoaSideCard(accountId, node);
        }
      });
    });

    var btnStatement = document.getElementById('coa-btn-statement');
    if (btnStatement) btnStatement.addEventListener('click', function () {
      var accountId = document.getElementById('coa-side-card')?.getAttribute('data-account-id');
      if (accountId && typeof openModule === 'function') openModule('statement-of-account', 'كشف الحساب');
      if (window._coaSelectedAccountId) window._coaSelectedAccountId = accountId;
    });
  };

  function showCoaSideCard(accountId, node) {
    var card = document.getElementById('coa-side-card');
    var balanceEl = document.getElementById('coa-side-balance');
    var accountEl = document.getElementById('coa-side-account');
    if (!card || !balanceEl) return;
    card.setAttribute('data-account-id', accountId);
    card.classList.remove('hidden');
    balanceEl.textContent = 'جاري…';
    accountEl.textContent = accountId;
    fetchJson('/accounts/' + encodeURIComponent(accountId) + '/balance').then(function (res) {
      if (res.data) {
        var b = res.data.balance != null ? res.data.balance : (res.data.debit || 0) - (res.data.credit || 0);
        balanceEl.textContent = (typeof formatNum === 'function' ? formatNum(b) : b) + ' ل.س';
      }
    }).catch(function () { balanceEl.textContent = '—'; });
    var name = node.querySelector('.text-slate-300');
    if (name) accountEl.textContent = name.textContent || accountId;
    window._coaSelectedAccountId = accountId;
  }

  window.toggleCoaNode = function (id) {
    if (!window._coaOpen) window._coaOpen = {};
    window._coaOpen[id] = !window._coaOpen[id];
    var mc = document.getElementById('module-content');
    if (mc) window.renderChartOfAccounts(mc);
  };

  // —— Journal entries list ——
  window.renderJournalGrid = async function (container) {
    var r = await fetchJson('/journal?limit=100');
    var list = r.data || [];
    var accR = await fetchJson('/accounts');
    var accMap = {};
    (accR.data || []).forEach(function (a) { accMap[a.id] = a.name || a.code; });
    var rows = list.map(function (e) {
      var debit = '';
      var credit = '';
      var amount = 0;
      if (e.compoundLines && e.compoundLines.length) {
        debit = e.compoundLines.filter(function (l) { return (l.debit || 0) > 0; }).map(function (l) { return accMap[l.accountId] || l.accountId; }).join('، ');
        credit = e.compoundLines.filter(function (l) { return (l.credit || 0) > 0; }).map(function (l) { return accMap[l.accountId] || l.accountId; }).join('، ');
        amount = e.compoundLines.reduce(function (s, l) { return s + (Number(l.debit) || 0); }, 0);
      } else {
        debit = accMap[e.debitAccountId] || e.debitAccountId;
        credit = accMap[e.creditAccountId] || e.creditAccountId;
        amount = e.amountSYP || 0;
      }
      return { date: e.date ? e.date.slice(0, 10) : '', debit: debit, credit: credit, amount: amount, memo: e.memo || '' };
    });
    var tableBody = rows.length ? rows.map(function (r) {
      var memo = (r.memo || '').toString().replace(/</g, '&lt;');
      return '<tr class="border-b border-white/5 hover:bg-white/5"><td class="p-2">' + r.date + '</td><td class="p-2 table-cell-ellipsis" title="' + memo.replace(/"/g, '&quot;') + '">' + (r.debit || '') + '</td><td class="p-2 table-cell-ellipsis">' + (r.credit || '') + '</td><td class="p-2 text-emerald-400">' + (typeof formatNum === 'function' ? formatNum(r.amount || 0) : r.amount) + '</td><td class="p-2 text-slate-400 table-cell-ellipsis" title="' + memo.replace(/"/g, '&quot;') + '">' + memo + '</td></tr>';
    }).join('') : '';
    container.innerHTML = '<div class="card-standard"><h3 class="page-title-h3 mb-4">قيود اليومية</h3>' + (rows.length ? '<div class="detail-table-wrap overflow-x-auto"><table class="table-glass w-full text-sm text-right"><thead><tr class="text-slate-400 border-b border-white/10"><th class="p-2">التاريخ</th><th class="p-2">مدين</th><th class="p-2">دائن</th><th class="p-2">المبلغ ل.س</th><th class="p-2">البيان</th></tr></thead><tbody>' + tableBody + '</tbody></table></div>' : (typeof emptyStateHTML === 'function' ? emptyStateHTML('لا توجد قيود لعرضها حالياً') : '<p>لا توجد قيود</p>')) + '</div>';
  };

  // —— Trial balance ——
  window.renderTrialBalanceGrid = async function (container) {
    var asOf = document.getElementById('tb-filter-date') && document.getElementById('tb-filter-date').value || new Date().toISOString().slice(0, 10);
    var r = await fetchJson('/statements/trial-balance?asOfDate=' + asOf);
    var d = r.data;
    if (!d || !d.rows || d.rows.length === 0) {
      container.innerHTML = '<div class="card-standard"><h3 class="page-title-h3 mb-4">ميزان المراجعة</h3><label class="text-slate-400 text-sm">حتى تاريخ: <input type="date" id="tb-filter-date" value="' + (d && d.asOfDate ? (d.asOfDate + '').slice(0, 10) : new Date().toISOString().slice(0, 10)) + '" onchange="refreshActiveModule()" class="bg-white/5 border border-white/10 rounded px-2 py-1 text-white"/></label><div class="state-empty-box mt-4"><span class="state-empty-icon" aria-hidden="true">📋</span><p>لا توجد بيانات لهذا الحساب حالياً</p></div></div>';
      return;
    }
    var bodyRows = d.rows.map(function (r) {
      var name = (r.name || '').toString().replace(/</g, '&lt;');
      var code = (r.code || '').toString();
      return '<tr class="border-b border-white/5 hover:bg-white/5"><td class="p-2">' + code + '</td><td class="p-2 table-cell-ellipsis" title="' + name.replace(/"/g, '&quot;') + '">' + name + '</td><td class="p-2 text-emerald-400">' + (typeof formatNum === 'function' ? formatNum(r.debit || 0) : r.debit) + '</td><td class="p-2 text-amber-400">' + (typeof formatNum === 'function' ? formatNum(r.credit || 0) : r.credit) + '</td></tr>';
    }).join('');
    window._lastTrialBalanceData = d;
    container.innerHTML = '<div class="card-standard"><h3 class="page-title-h3 mb-4">ميزان المراجعة</h3><label class="text-slate-400 text-sm">حتى تاريخ: <input type="date" id="tb-filter-date" value="' + (d.asOfDate || '').slice(0, 10) + '" onchange="refreshActiveModule()" class="bg-white/5 border border-white/10 rounded px-2 py-1 text-white"/></label><div class="flex flex-wrap gap-2 mt-2 mb-2"><button type="button" onclick="printTrialBalance()" class="tap-haptic px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-medium inline-flex items-center gap-1">طباعة / تصدير PDF</button></div><div class="detail-table-wrap mt-4"><table class="table-glass w-full text-sm text-right"><thead><tr class="text-slate-400 border-b border-white/10"><th class="p-2">الكود</th><th class="p-2">اسم الحساب</th><th class="p-2">مدين</th><th class="p-2">دائن</th></tr></thead><tbody>' + bodyRows + '</tbody><tfoot><tr class="font-medium text-white border-t border-white/10"><td class="p-2" colspan="2">الإجمالي</td><td class="p-2 text-emerald-400">' + (typeof formatNum === 'function' ? formatNum(d.totalDebit || 0) : d.totalDebit) + '</td><td class="p-2 text-amber-400">' + (typeof formatNum === 'function' ? formatNum(d.totalCredit || 0) : d.totalCredit) + '</td></tr></tfoot></table></div><p class="text-slate-500 text-sm mt-2">متوازن: ' + (d.balanced ? 'نعم' : 'لا') + '</p></div>';
  };

  window.printTrialBalance = async function () {
    var asOf = document.getElementById('tb-filter-date') && document.getElementById('tb-filter-date').value || new Date().toISOString().slice(0, 10);
    var d = window._lastTrialBalanceData;
    if (!d || (d.asOfDate || '').slice(0, 10) !== asOf) {
      try { d = (await fetchJson('/statements/trial-balance?asOfDate=' + asOf)).data; } catch (e) { showToast('خطأ', e.message || 'فشل تحميل البيانات', 'error'); return; }
    }
    if (!d || !d.rows || !d.rows.length) { showToast('تنبيه', 'لا توجد بيانات للطباعة', 'error'); return; }
    var printRows = d.rows.map(function (r) {
      return '<tr class="print-td-row"><td class="print-td">' + (r.code || '') + '</td><td class="print-td">' + (r.name || '').replace(/</g, '&lt;') + '</td><td class="print-td">' + (typeof formatNum === 'function' ? formatNum(r.debit || 0) : r.debit) + '</td><td class="print-td">' + (typeof formatNum === 'function' ? formatNum(r.credit || 0) : r.credit) + '</td></tr>';
    }).join('');
    var printDate = new Date().toLocaleDateString('ar-SY') + ' ' + new Date().toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
    var t = getPrintHeaderTemplate('ميزان المراجعة — حتى ' + (d.asOfDate || asOf).slice(0, 10), printDate, { showPageNumber: true });
    var tableHtml = '<table class="print-table"><thead><tr class="print-th"><th class="print-th">الكود</th><th class="print-th">اسم الحساب</th><th class="print-th">مدين</th><th class="print-th">دائن</th></tr></thead><tbody>' + printRows + '</tbody><tfoot><tr class="print-th"><td class="print-td" colspan="2">الإجمالي</td><td class="print-td">' + (typeof formatNum === 'function' ? formatNum(d.totalDebit || 0) : d.totalDebit) + '</td><td class="print-td">' + (typeof formatNum === 'function' ? formatNum(d.totalCredit || 0) : d.totalCredit) + '</td></tr></tfoot></table>';
    var bodyHtml = '<div class="print-body" dir="rtl" style="font-family:Cairo,Tajawal,sans-serif"><h2 style="font-size:1.125rem;font-weight:700;margin-bottom:12px;">ميزان المراجعة</h2><p class="print-period">حتى تاريخ: ' + (d.asOfDate || asOf).slice(0, 10) + ' · متوازن: ' + (d.balanced ? 'نعم' : 'لا') + '</p>' + tableHtml + '</div>';
    var win = window.open('', '_blank');
    win.document.write('<html dir="rtl"><head><title>ميزان المراجعة</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet"/>' + t.css + '</head><body style="background:#fff;color:#111">' + t.headerHTML + bodyHtml + '</body></html>');
    win.document.close();
    win.focus();
    win.print();
    setTimeout(function () { try { if (win && !win.closed) win.close(); } catch (e) {} }, 10000);
  };

  window.openAuditEntryModal = async function (entryId) {
    if (!entryId) return;
    var modal = document.getElementById('audit-entry-modal');
    var body = document.getElementById('audit-entry-modal-body');
    if (!modal || !body) return;
    body.textContent = 'جاري التحميل…';
    modal.classList.remove('hidden');
    try {
      var res = await fetch((typeof API !== 'undefined' ? API : '') + '/journal/' + encodeURIComponent(entryId), { headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {} });
      var json = await res.json();
      if (!json.success || !json.data) { body.innerHTML = '<p class="text-rose-400">' + (json.error || 'قيد غير موجود') + '</p>'; return; }
      var e = json.data;
      var html = '<p><span class="text-slate-500">التاريخ:</span> ' + (e.date || '').slice(0, 19) + '</p>';
      html += '<p><span class="text-slate-500">البيان:</span> ' + (e.memo || '—').replace(/</g, '&lt;') + '</p>';
      if (e.deleted) html += '<p class="text-rose-400 font-medium">هذا القيد معطّل (محذوف)</p>';
      if (e.compoundLines && e.compoundLines.length) {
        html += '<table class="table-glass w-full text-right mt-3"><thead><tr class="text-slate-400 border-b border-white/10"><th class="p-2">الحساب</th><th class="p-2">مدين</th><th class="p-2">دائن</th></tr></thead><tbody>';
        e.compoundLines.forEach(function (l) {
          html += '<tr class="border-b border-white/5"><td class="p-2">' + (l.accountId || '—') + '</td><td class="p-2 text-emerald-400">' + (typeof formatNum === 'function' ? formatNum(l.debit || 0) : l.debit) + '</td><td class="p-2 text-amber-400">' + (typeof formatNum === 'function' ? formatNum(l.credit || 0) : l.credit) + '</td></tr>';
        });
        html += '</tbody></table>';
      } else {
        html += '<p><span class="text-slate-500">مدين:</span> ' + (e.debitAccountId || '—') + ' · <span class="text-slate-500">دائن:</span> ' + (e.creditAccountId || '—') + '</p>';
        html += '<p><span class="text-slate-500">المبلغ ل.س:</span> ' + (typeof formatNum === 'function' ? formatNum(e.amountSYP || 0) : e.amountSYP) + '</p>';
      }
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = '<p class="text-rose-400">' + (err.message || 'فشل تحميل التفاصيل') + '</p>';
    }
  };

  // —— Pro Grid: Journal Voucher (سند القيد) ——
  window.renderVoucherJournal = async function (container) {
    var accR = await fetchJson('/accounts');
    var accounts = accR.data || [];
    window._vjAccounts = accounts;
    window._vjGridRows = [{ id: 'vj-1', accountId: '', debit: '', credit: '', memo: '' }, { id: 'vj-2', accountId: '', debit: '', credit: '', memo: '' }];
    var gridHtml = '<div class="voucher-journal-wrap bg-white text-slate-800 rounded-xl border border-slate-200 overflow-hidden" style="max-width:900px">';
    gridHtml += '<h3 class="text-lg font-semibold p-4 border-b border-slate-200">سند قيد (مدين/دائن متوازن)</h3>';
    gridHtml += '<div class="overflow-x-auto"><table class="vj-grid w-full text-sm text-right border-collapse"><thead><tr class="bg-slate-100 border-b border-slate-200"><th class="p-2 border-l border-slate-200">اسم الحساب</th><th class="p-2 w-28 border-l border-slate-200">مدين</th><th class="p-2 w-28 border-l border-slate-200">دائن</th><th class="p-2 border-l border-slate-200">البيان</th><th class="p-2 w-12"></th></tr></thead><tbody id="vj-grid-tbody"></tbody></table></div>';
    gridHtml += '<div class="vj-totals flex justify-end gap-6 p-4 border-t border-slate-200 bg-slate-50"><span>إجمالي المدين: <strong id="vj-total-debit">0</strong> ل.س</span><span>إجمالي الدائن: <strong id="vj-total-credit">0</strong> ل.س</span></div>';
    gridHtml += '<p id="vj-balance-msg" class="px-4 pb-2 text-sm hidden"></p>';
    gridHtml += '<div class="p-4 flex gap-2 flex-wrap"><button type="button" id="vj-add-row" class="tap-haptic px-4 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300">+ إضافة سطر</button><button type="button" id="vj-submit" class="tap-haptic px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700" disabled>ترحيل</button></div></div>';
    container.innerHTML = gridHtml;
    renderVjGridRows();
    bindVjGridEvents();
    updateVjTotals();
  };

  function renderVjGridRows() {
    var tbody = document.getElementById('vj-grid-tbody');
    if (!tbody) return;
    var accounts = window._vjAccounts || [];
    var opts = '<option value="">— اختر الحساب —</option>' + accounts.map(function (a) {
      return '<option value="' + a.id + '">' + (a.code || '') + ' ' + (a.name || '').replace(/</g, '&lt;') + '</option>';
    }).join('');
    tbody.innerHTML = (window._vjGridRows || []).map(function (row, idx) {
      return '<tr class="vj-row border-b border-slate-200 hover:bg-slate-50" data-row-id="' + row.id + '"><td class="p-1 border-l border-slate-200"><select class="vj-account w-full border border-slate-200 rounded px-2 py-1.5 text-right" data-id="' + row.id + '">' + opts + '</select></td><td class="p-1 border-l border-slate-200"><input type="number" step="0.01" min="0" class="vj-debit w-full border border-slate-200 rounded px-2 py-1.5 text-right" data-id="' + row.id + '" placeholder="0" value="' + (row.debit || '') + '"/></td><td class="p-1 border-l border-slate-200"><input type="number" step="0.01" min="0" class="vj-credit w-full border border-slate-200 rounded px-2 py-1.5 text-right" data-id="' + row.id + '" placeholder="0" value="' + (row.credit || '') + '"/></td><td class="p-1 border-l border-slate-200"><input type="text" class="vj-memo w-full border border-slate-200 rounded px-2 py-1.5 text-right" data-id="' + row.id + '" placeholder="بيان" value="' + (row.memo || '').replace(/"/g, '&quot;') + '"/></td><td class="p-1"><button type="button" class="vj-remove tap-haptic text-rose-500 hover:text-rose-700 p-1" data-id="' + row.id + '" title="حذف السطر">✕</button></td></tr>';
    }).join('');
  }

  function getVjLines() {
    var rows = window._vjGridRows || [];
    var lines = [];
    rows.forEach(function (row) {
      var debit = Number(document.querySelector('.vj-debit[data-id="' + row.id + '"]')?.value) || 0;
      var credit = Number(document.querySelector('.vj-credit[data-id="' + row.id + '"]')?.value) || 0;
      var accountId = document.querySelector('.vj-account[data-id="' + row.id + '"]')?.value || '';
      var memo = document.querySelector('.vj-memo[data-id="' + row.id + '"]')?.value || '';
      if (accountId && (debit > 0 || credit > 0)) lines.push({ accountId: accountId, debit: debit, credit: credit, memo: memo });
    });
    return lines;
  }

  function updateVjTotals() {
    var lines = getVjLines();
    var totalDebit = lines.reduce(function (s, l) { return s + (Number(l.debit) || 0); }, 0);
    var totalCredit = lines.reduce(function (s, l) { return s + (Number(l.credit) || 0); }, 0);
    var debitEl = document.getElementById('vj-total-debit');
    var creditEl = document.getElementById('vj-total-credit');
    var msgEl = document.getElementById('vj-balance-msg');
    var submitBtn = document.getElementById('vj-submit');
    if (debitEl) debitEl.textContent = (typeof formatNum === 'function' ? formatNum(totalDebit) : totalDebit);
    if (creditEl) creditEl.textContent = (typeof formatNum === 'function' ? formatNum(totalCredit) : totalCredit);
    var diff = Math.abs(totalDebit - totalCredit);
    var balanced = diff < BALANCE_TOLERANCE;
    if (msgEl) {
      msgEl.classList.toggle('hidden', balanced);
      msgEl.classList.toggle('text-red-600', !balanced);
      msgEl.textContent = balanced ? '' : 'القيد غير متوازن، الفارق: ' + (typeof formatNum === 'function' ? formatNum(diff) : diff) + ' ل.س';
    }
    if (submitBtn) submitBtn.disabled = !balanced || lines.length < MIN_JOURNAL_LINES;
  }

  function bindVjGridEvents() {
    var tbody = document.getElementById('vj-grid-tbody');
    if (!tbody) return;
    tbody.addEventListener('input', function () { updateVjTotals(); });
    tbody.addEventListener('change', function () { updateVjTotals(); });
    tbody.addEventListener('keydown', function (e) {
      var target = e.target;
      if (e.key === 'Tab' && !e.shiftKey && target.classList.contains('vj-memo')) {
        var row = target.closest('.vj-row');
        var next = row && row.nextElementSibling;
        if (!next) {
          e.preventDefault();
          addVjRow();
        }
      }
    });
    tbody.addEventListener('click', function (e) {
      if (e.target.classList.contains('vj-remove')) {
        var id = e.target.getAttribute('data-id');
        removeVjRow(id);
      }
    });
    document.getElementById('vj-add-row')?.addEventListener('click', addVjRow);
    document.getElementById('vj-submit')?.addEventListener('click', submitVoucherJournal);
  }

  function addVjRow() {
    window._vjGridRows = window._vjGridRows || [];
    if (window._vjGridRows.length >= 50) return;
    window._vjGridRows.push({ id: 'vj-' + Date.now(), accountId: '', debit: '', credit: '', memo: '' });
    renderVjGridRows();
    bindVjGridEvents();
    updateVjTotals();
  }

  function removeVjRow(id) {
    window._vjGridRows = (window._vjGridRows || []).filter(function (r) { return r.id !== id; });
    if (window._vjGridRows.length < MIN_JOURNAL_LINES) {
      window._vjGridRows.push({ id: 'vj-' + Date.now(), accountId: '', debit: '', credit: '', memo: '' });
    }
    renderVjGridRows();
    bindVjGridEvents();
    updateVjTotals();
  }

  window.submitVoucherJournal = async function () {
    var lines = getVjLines();
    if (lines.length < MIN_JOURNAL_LINES) { showToast('تنبيه', 'أضف سطرين على الأقل (مدين ودائن)', 'warning'); return; }
    var totalDebit = lines.reduce(function (s, l) { return s + (Number(l.debit) || 0); }, 0);
    var totalCredit = lines.reduce(function (s, l) { return s + (Number(l.credit) || 0); }, 0);
    if (Math.abs(totalDebit - totalCredit) >= BALANCE_TOLERANCE) { showToast('تنبيه', 'القيد غير متوازن', 'warning'); return; }
    try {
      await postJson('/vouchers/journal', { lines: lines });
      showToast('تم', 'تم ترحيل سند القيد', 'success');
      if (typeof openModule === 'function') openModule('journal-entries', 'قيود اليومية');
    } catch (e) {
      showToast('خطأ', e.message || 'فشل الترحيل', 'error');
    }
  };

})();
