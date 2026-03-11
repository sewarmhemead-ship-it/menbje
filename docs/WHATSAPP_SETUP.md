# إعداد واتساب الحقيقي (WhatsApp Business API)

لتوصيل التطبيق بواتساب فعلياً بحيث يصل رسائل الزبائن ويُرسل الردود تلقائياً، اتبع الخطوات التالية.

---

## 1. إنشاء تطبيق في Meta for Developers

1. ادخل إلى [developers.facebook.com](https://developers.facebook.com) وسجّل الدخول.
2. من **"My Apps"** اختر **Create App** → **Other** → **Business** (أو **Consumer** حسب النوع).
3. أدخل اسم التطبيق وانتهِ من الإنشاء.

---

## 2. إضافة منتج WhatsApp

1. من لوحة التطبيق، اضغط **Add Product**.
2. اختر **WhatsApp** → **Set up**.
3. اختر **API Setup** أو **Getting started**.
4. سترى:
   - **Phone number ID** (هذا هو `WHATSAPP_PHONE_ID`).
   - **Temporary access token** للاختبار (أو إنشاء token دائم لاحقاً) → هذا هو `WHATSAPP_TOKEN`.

---

## 3. عنوان الـ Webhook (رابط الاستقبال)

Meta يرسل رسائل الواردة إلى عنوان (URL) على سيرفرك. التطبيق يستمع على:

- **الرابط المطلوب:**  
  `https://<نطاقك>/webhook/whatsapp`  
  مثال: `https://your-domain.com/webhook/whatsapp`

يجب أن يكون السيرفر متاحاً على الإنترنت (لا localhost إلا للاختبار مع أدوات مثل ngrok).

---

## 4. التحقق من الـ Webhook (Verification)

عند إدخال الرابط في Meta يرسل طلب **GET** للتحقق:

- **Verify token:** قيمة أنت تختارها وتضعها في `.env` تحت اسم `WHATSAPP_VERIFY_TOKEN`.
- التطبيق يقارن القيمة المرسلة من Meta مع القيمة في `.env`؛ إن تطابقت يرد بـ `challenge` ويتم تفعيل الـ webhook.

---

## 5. متغيرات البيئة (.env)

انسخ من `.env.example` واملأ القيم:

```env
# WhatsApp Business API (Meta Cloud API)
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_TOKEN=EAAxxxx...
WHATSAPP_VERIFY_TOKEN=كلمة_سر_تحقق_اختيارية
```

| المتغير | المصدر |
|--------|--------|
| `WHATSAPP_PHONE_ID` | من لوحة WhatsApp في Meta (API Setup) → Phone number ID |
| `WHATSAPP_TOKEN` | من نفس الصفحة: Temporary access token أو System User token دائم |
| `WHATSAPP_VERIFY_TOKEN` | أنت تختارها (مثلاً سلسلة عشوائية) وتدخلها عند إعداد Webhook في Meta |

---

## 6. إعداد الـ Webhook في Meta

1. من **WhatsApp** → **Configuration** (أو **Webhook**).
2. اضغط **Edit** بجانب **Callback URL**.
3. أدخل: `https://<نطاقك>/webhook/whatsapp`.
4. في **Verify token** أدخل نفس قيمة `WHATSAPP_VERIFY_TOKEN` من `.env`.
5. احفظ. إن ظهرت علامة صح فالتحقق نجح.
6. اشترك في حقل **messages** (Subscribe to: messages) حتى تصل رسائل الزبائن.

---

## 7. اختبار الاتصال

- أرسل رسالة نصية إلى رقم واتساب التجريبي (المرتبط بالتطبيق) مثل: **"هل عندكم حليب؟"** أو **"كم سعر X?"**.
- التطبيق يستقبلها على `/webhook/whatsapp`، يبحث في المخزون، وينشئ مسودة إذا وُجد الصنف، ويرسل الرد عبر WhatsApp Cloud API.
- تحقق من **مسودات واتساب** في لوحة التحكم ومن وصول الرد على واتساب.

---

## 8. ملاحظات

- **الرقم التجريبي:** في وضع التطوير يمكنك استخدام رقم تجريبي من Meta؛ الرسائل مسموحة فقط من أرقام مضافة في قائمة الاختبار.
- **النشر (Production):** لاستقبال رسائل من أي عميل تحتاج الموافقة على تطبيق WhatsApp Business من Meta وربط رقم واتساب رسمي.
- **التوكن الدائم:** التوكن المؤقت ينتهي؛ لاستخدام دائم أنشئ System User وولّد token له مع صلاحية `whatsapp_business_messaging`.
- إذا لم يُرسل الرد: تحقق من وجود `WHATSAPP_PHONE_ID` و `WHATSAPP_TOKEN` في `.env` وإعادة تشغيل السيرفر.

---

## الروابط المرجعية

- [WhatsApp Cloud API – Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [Send Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)
