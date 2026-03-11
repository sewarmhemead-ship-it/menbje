/**
 * Industry Manager — تهيئة نظام Vault AI لأنشطة تجارية مختلفة
 * (مخبز، مطعم، محل موبايلات) دون تداخل الكود.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'vault_industry';

  var INDUSTRIES = {
    bakery: { id: 'bakery', label: 'مخبز' },
    restaurant: { id: 'restaurant', label: 'مطعم' },
    mobile: { id: 'mobile', label: 'محل موبايلات' },
    general: { id: 'general', label: 'عام' }
  };

  /**
   * الحصول على نوع النشاط الحالي من localStorage
   * @returns {string} 'bakery' | 'restaurant' | 'mobile' | 'general'
   */
  function getIndustry() {
    try {
      var stored = (global.localStorage && global.localStorage.getItem(STORAGE_KEY)) || '';
      if (INDUSTRIES[stored]) return stored;
    } catch (e) {}
    return 'general';
  }

  /**
   * ضبط نوع النشاط في localStorage (بدون إعادة تحميل)
   * @param {string} type - 'bakery' | 'restaurant' | 'mobile' | 'general'
   */
  function setIndustry(type) {
    var t = (type && INDUSTRIES[type]) ? type : 'general';
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, t);
    } catch (e) {}
    return t;
  }

  /**
   * تهيئة النشاط: ضبط localStorage وتفعيل الواجهة حسب النوع
   * @param {string} type - 'bakery' | 'restaurant' | 'mobile' | 'general'
   * @returns {string} النوع المُطبَّق
   */
  function initializeIndustry(type) {
    var applied = setIndustry(type);
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('vault-industry-changed', { detail: { industry: applied } }));
      } catch (e) {}
    }
    return applied;
  }

  /**
   * إرجاع قائمة القائمة (erpMenu) بعد تصفية العناصر حسب hiddenIf والنشاط الحالي
   * @param {Array} menu - مصفوفة erpMenu (كل عنصر له groupTitle و items؛ كل item قد يحتوي hiddenIf: ['mobile', ...])
   * @returns {Array} مصفوفة جديدة، كل مجموعة تحتوي فقط العناصر الظاهرة للنشاط الحالي
   */
  function getVisibleMenu(menu) {
    var industry = getIndustry();
    if (!Array.isArray(menu)) return menu;
    return menu.map(function (group) {
      var items = (group.items || []).filter(function (item) {
        var hiddenIf = item.hiddenIf;
        if (!Array.isArray(hiddenIf)) return true;
        return hiddenIf.indexOf(industry) === -1;
      });
      return { groupTitle: group.groupTitle, items: items };
    }).filter(function (group) {
      return (group.items || []).length > 0;
    });
  }

  /**
   * بيانات تجريبية (Seed Data) تناسب النشاط المختار لكل وحدة
   * تُستخدم عند فتح الوحدة عبر openModule لتعبئة اقتراحات أو قوائم افتراضية.
   */
  var SEED_BY_INDUSTRY = {
    bakery: {
      'sales-invoice': {
        suggestedProducts: [
          { name: 'خبز عربي', unitId: 'piece' },
          { name: 'خبز صاج', unitId: 'piece' },
          { name: 'حلويات', unitId: 'kg' },
          { name: 'كعك', unitId: 'piece' }
        ],
        defaultCustomerLabel: 'عميل جملة'
      },
      'item-card': {
        defaultUnitId: 'piece',
        suggestedNames: ['خبز عربي', 'خبز صاج', 'حلويات', 'كعك']
      },
      'purchase-invoice': {
        suggestedSupplierLabel: 'مورد دقيق/خامات'
      }
    },
    restaurant: {
      'sales-invoice': {
        suggestedProducts: [
          { name: 'وجبة غداء', unitId: 'piece' },
          { name: 'وجبة عشاء', unitId: 'piece' },
          { name: 'مشروب', unitId: 'piece' },
          { name: 'حلوى', unitId: 'piece' }
        ],
        defaultCustomerLabel: 'عميل'
      },
      'item-card': {
        defaultUnitId: 'piece',
        suggestedNames: ['وجبة غداء', 'مشروب', 'حلوى']
      },
      'purchase-invoice': {
        suggestedSupplierLabel: 'مورد خضار/لحوم'
      }
    },
    mobile: {
      'sales-invoice': {
        suggestedProducts: [
          { name: 'هاتف ذكي', unitId: 'piece' },
          { name: 'كفر', unitId: 'piece' },
          { name: 'سماعة', unitId: 'piece' },
          { name: 'شاحن', unitId: 'piece' }
        ],
        defaultCustomerLabel: 'العميل'
      },
      'item-card': {
        defaultUnitId: 'piece',
        suggestedNames: ['هاتف ذكي', 'كفر', 'سماعة']
      },
      'purchase-invoice': {
        suggestedSupplierLabel: 'مورد أجهزة'
      }
    },
    general: {
      'sales-invoice': { defaultCustomerLabel: 'العميل' },
      'item-card': { defaultUnitId: 'piece' },
      'purchase-invoice': {}
    }
  };

  /**
   * إرجاع بيانات تجريبية للوحدة الحالية حسب النشاط المختار
   * @param {string} moduleId - معرف الوحدة (مثل 'sales-invoice', 'item-card', 'purchase-invoice')
   * @returns {object} كائن Seed Data أو {} إن لم يوجد
   */
  function getSeedDataForModule(moduleId) {
    var industry = getIndustry();
    var byIndustry = SEED_BY_INDUSTRY[industry] || SEED_BY_INDUSTRY.general;
    return (byIndustry && byIndustry[moduleId]) ? byIndustry[moduleId] : {};
  }

  /**
   * تطبيق بيانات البذرة للوحدة (يُستدعى من openModule)
   * يضع النتيجة في window._industrySeedData لاستخدامها داخل الوحدة.
   * @param {string} moduleId
   */
  function applySeedDataForModule(moduleId) {
    var seed = getSeedDataForModule(moduleId);
    try {
      global.window._industrySeedData = seed;
    } catch (e) {}
  }

  /**
   * إرجاع قائمة الأنشطة المعرّفة (للاختيار في الإعدادات)
   * @returns {{ id: string, label: string }[]}
   */
  function getIndustryList() {
    return Object.keys(INDUSTRIES).map(function (id) {
      return { id: id, label: INDUSTRIES[id].label };
    });
  }

  var IndustryManager = {
    getIndustry: getIndustry,
    setIndustry: setIndustry,
    initializeIndustry: initializeIndustry,
    getVisibleMenu: getVisibleMenu,
    getSeedDataForModule: getSeedDataForModule,
    applySeedDataForModule: applySeedDataForModule,
    getIndustryList: getIndustryList,
    INDUSTRIES: INDUSTRIES,
    STORAGE_KEY: STORAGE_KEY
  };

  if (global.window) global.window.IndustryManager = IndustryManager;
  global.IndustryManager = IndustryManager;
})(typeof window !== 'undefined' ? window : this);
