/**
 * Vision Engine — OCR لفاتورة باستخدام Tesseract.js
 * معالجة الصورة (تفتيح، تباين، grayscale) + استخراج النص + منطق محاسبي (تاريخ، إجمالي، أصناف)
 */
(function (global) {
  'use strict';

  var Tesseract = global.Tesseract;
  if (!Tesseract) {
    console.warn('Vision Engine: Tesseract.js غير محمّل. أضف السكريبت من CDN.');
    return;
  }

  /**
   * معالجة الصورة قبل OCR: تفتيح، تباين، وتحويل لـ grayscale لتحسين دقة العربية
   * @param {string|HTMLImageElement|File} imageSource - data URL أو عنصر img أو File
   * @returns {Promise<string>} data URL للصورة المعالجة
   */
  function preprocessImage(imageSource) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';

      function draw() {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          var ctx = canvas.getContext('2d');
          if (!ctx) { resolve(img.src || imageSource); return; }
          ctx.drawImage(img, 0, 0);
          var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var data = imageData.data;
          var contrast = 1.25;
          var brightness = 15;
          for (var i = 0; i < data.length; i += 4) {
            var r = data[i];
            var g = data[i + 1];
            var b = data[i + 2];
            var gray = Math.min(255, (r * 0.299 + g * 0.587 + b * 0.114));
            gray = (gray - 128) * contrast + 128 + brightness;
            gray = Math.max(0, Math.min(255, Math.round(gray)));
            data[i] = data[i + 1] = data[i + 2] = gray;
          }
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (e) {
          reject(e);
        }
      }

      if (typeof imageSource === 'string') {
        img.onload = draw;
        img.onerror = function () { reject(new Error('فشل تحميل الصورة')); };
        img.src = imageSource;
      } else if (imageSource instanceof File) {
        var reader = new FileReader();
        reader.onload = function () {
          img.onload = draw;
          img.onerror = function () { reject(new Error('فشل تحميل الصورة')); };
          img.src = reader.result;
        };
        reader.onerror = function () { reject(new Error('فشل قراءة الملف')); };
        reader.readAsDataURL(imageSource);
      } else if (imageSource && imageSource.tagName === 'IMG') {
        img.onload = draw;
        img.onerror = function () { reject(new Error('فشل تحميل الصورة')); };
        img.src = imageSource.src;
      } else {
        reject(new Error('مصدر الصورة غير مدعوم'));
      }
    });
  }

  /**
   * استخراج بيانات محاسبية من النص باستخدام Regex
   * @param {string} text
   * @returns {{ date: string|null, total: number|null, totalRaw: string|null, items: Array<{name:string, qty:number, price:number}> }}
   */
  function extractWithRegex(text) {
    var result = { date: null, total: null, totalRaw: null, items: [] };
    if (!text || typeof text !== 'string') return result;
    var t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    var datePatterns = [
      /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/g,
      /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/g,
      /(\d{1,2})\s*(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s*(\d{2,4})/gi
    ];
    for (var i = 0; i < datePatterns.length; i++) {
      var m = datePatterns[i].exec(t);
      if (m) {
        if (m[0].length <= 12) result.date = m[0].trim();
        break;
      }
    }

    var totalPatterns = [
      /(?:الإجمالي|اجمالي|الإجمالي\s*النهائي|صافي\s*القيمة|المبلغ\s*الإجمالي|المجموع)\s*[:\s]*([\d\s\u0660-\u0669\u06f0-\u06f9.,]+)/gi,
      /(?:Total|TOTAL|total)\s*[:\s]*([\d\s\u0660-\u0669\u06f0-\u06f9.,]+)/g,
      /(?:المبلغ|مبلغ|ل\.س|ل\.س\.)\s*[:\s]*([\d\s\u0660-\u0669\u06f0-\u06f9.,]+)/gi
    ];
    var maxNum = 0;
    for (var j = 0; j < totalPatterns.length; j++) {
      var reg = new RegExp(totalPatterns[j].source, totalPatterns[j].flags);
      var match;
      while ((match = reg.exec(t)) !== null) {
        var numStr = (match[1] || '').replace(/\s/g, '').replace(/\u0660/g, '0').replace(/\u0661/g, '1').replace(/\u0662/g, '2').replace(/\u0663/g, '3').replace(/\u0664/g, '4').replace(/\u0665/g, '5').replace(/\u0666/g, '6').replace(/\u0667/g, '7').replace(/\u0668/g, '8').replace(/\u0669/g, '9').replace(/\u06f0/g, '0').replace(/\u06f1/g, '1').replace(/\u06f2/g, '2').replace(/\u06f3/g, '3').replace(/\u06f4/g, '4').replace(/\u06f5/g, '5').replace(/\u06f6/g, '6').replace(/\u06f7/g, '7').replace(/\u06f8/g, '8').replace(/\u06f9/g, '9');
        var num = parseFloat(numStr.replace(/,/g, ''), 10);
        if (!isNaN(num) && num > maxNum && num < 1e10) {
          maxNum = num;
          result.total = num;
          result.totalRaw = match[1].trim();
        }
      }
    }
    if (result.total == null && maxNum === 0) {
      var anyNum = /[\d\u0660-\u0669\u06f0-\u06f9][\d\u0660-\u0669\u06f0-\u06f9.,\s]{2,}/g;
      var am;
      while ((am = anyNum.exec(t)) !== null) {
        var n = parseFloat((am[0] || '').replace(/[\s\u0660-\u0669\u06f0-\u06f9]/g, function (c) {
          var map = { '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4', '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9', '\u06f0': '0', '\u06f1': '1', '\u06f2': '2', '\u06f3': '3', '\u06f4': '4', '\u06f5': '5', '\u06f6': '6', '\u06f7': '7', '\u06f8': '8', '\u06f9': '9' };
          return map[c] != null ? map[c] : (c === ' ' || c === ',' ? c : '');
        }).replace(/,/g, ''), 10);
        if (!isNaN(n) && n > maxNum && n < 1e9) maxNum = n;
      }
      if (maxNum > 0) result.total = maxNum;
    }

    var lines = t.split(/\n/).filter(function (l) { return l.trim().length > 0; });
    for (var k = 0; k < lines.length; k++) {
      var line = lines[k];
      var numPart = line.match(/[\d\u0660-\u0669\u06f0-\u06f9.,]+/g);
      if (numPart && numPart.length >= 1) {
        var lastNum = (numPart[numPart.length - 1] || '').replace(/,/g, '');
        var price = parseFloat(lastNum, 10);
        if (!isNaN(price) && price > 0 && price < 1e8) {
          var namePart = line.replace(/[\d\u0660-\u0669\u06f0-\u06f9.,\s]+$/, '').trim();
          if (namePart.length > 0 && namePart.length < 120)
            result.items.push({ name: namePart.slice(0, 80), qty: 1, price: price });
        }
      }
    }

    return result;
  }

  /**
   * تشغيل OCR على صورة فاتورة مع دعم التقدّم واستخراج البيانات المحاسبية
   * @param {string|HTMLImageElement|File} imageSource
   * @param {function(status: string, progress: number)} onProgress - الحالة والنسبة 0..1
   * @returns {Promise<{ text: string, date: string|null, total: number|null, totalRaw: string|null, items: Array, raw: object }>}
   */
  function processInvoiceImage(imageSource, onProgress) {
    onProgress = onProgress || function () {};
    return preprocessImage(imageSource)
      .then(function (dataUrl) {
        onProgress('جاري قراءة النص (عربي + إنجليزي)...', 0.1);
        return Tesseract.recognize(dataUrl, 'ara+eng', {
          logger: function (m) {
            if (m.status) onProgress(m.status, 0.1 + (m.progress || 0) * 0.85);
          }
        });
      })
      .then(function (result) {
        var text = (result && result.data && result.data.text) ? result.data.text : '';
        onProgress('جاري استخراج البيانات...', 0.95);
        var extracted = extractWithRegex(text);
        onProgress('تم', 1);
        return {
          text: text,
          date: extracted.date,
          total: extracted.total,
          totalRaw: extracted.totalRaw,
          items: extracted.items,
          raw: extracted
        };
      })
      .finally(function () {
        try {
          if (typeof Tesseract.terminate === 'function') Tesseract.terminate();
        } catch (e) {}
      });
  }

  global.VisionEngine = {
    preprocessImage: preprocessImage,
    extractWithRegex: extractWithRegex,
    processInvoiceImage: processInvoiceImage
  };
})(typeof window !== 'undefined' ? window : this);
