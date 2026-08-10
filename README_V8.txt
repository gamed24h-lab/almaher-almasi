الماهر الماسي V8.0 — التحديث التأسيسي الكبير

طريقة التثبيت لأول مرة:
1) خذ نسخة احتياطية من قاعدة Supabase الحالية.
2) افتح Supabase > SQL Editor.
3) شغّل almaher_v8_master_migration.sql مرة واحدة.
4) ارفع مجلد V8 إلى Netlify كتحديث رئيسي واحد.
5) تأكد أن متغيرات البيئة SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY ما زالت موجودة.
6) جرّب دخول المدير/موظف من جهاز آخر، ثم المالية والطباعة والتقارير.

مهم:
- مركز تحديث النظام بدون Deploy موجود في لوحة المطور. بعد تثبيت V8، يمكن رفع index.html لإصدار لاحق على قناة Test أو Stable من داخل النظام.
- التحديث من داخل النظام يغيّر واجهة HTML. التغييرات التي تحتاج Netlify Functions جديدة أو متغيرات سرية جديدة قد تحتاج Deploy تقليدي نادرًا.
- قواعد البريد/WhatsApp/SMS والدفع تحتاج مزودًا فعليًا ومفاتيح خدمة قبل أن تصبح مراسلات/دفعات حقيقية.
- الملف MASTER_CHECKLIST_V8.md هو المرجع الكامل لنطاق المشروع حتى لا تضيع أي نقطة متفق عليها.

الملفات المهمة:
- index.html
- almaher_v8_master_migration.sql
- netlify/functions/system-release.js
- netlify/functions/platform-data.js
- MASTER_CHECKLIST_V8.md
