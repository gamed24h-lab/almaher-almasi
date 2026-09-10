# ID Studio V3 — Checklist التنفيذ

## المرحلة 1 — Foundation ✅
- [x] فرع تطوير معزول عن Stable.
- [x] مواصفات الموديول.
- [x] صلاحيات ID Studio منفصلة في منطق `has()`.
- [x] Catalog مركزي لصلاحيات ID Studio.
- [x] Migration تأسيسي للجداول مع `linked_employee_id` اختياري.
- [x] QR token عشوائي غير قابل للتخمين.
- [x] حالات البطاقة ودعم وجه واحد/وجهين.
- [x] 5 قوالب ابتدائية في الـschema.
- [x] واجهة Module أولية ومعرض قوالب حقيقي الاختلاف.

## المرحلة 2 — Integration (التالي)
- [ ] إضافة صلاحيات ID Studio كقسم مستقل داخل شاشة الصلاحيات بدون إدخالها في قوالب الأدوار تلقائيًا.
- [ ] إضافة Route `/id-studio` وحمايته بـ `id_studio_access`.
- [ ] إضافة عنصر القائمة بشرط `id_studio_access` فقط.
- [ ] Worker API مستقل `/api/id-studio/*` مع فحص صلاحية لكل Action.
- [ ] CRUD على Test فقط.
- [ ] تقييد الفروع مع `id_card_view_all_branches`.

## المرحلة 3 — Issuance
- [ ] مولد Card Number ذري بدون تكرار.
- [ ] Standalone / Linked employee.
- [ ] Translation + Transliteration مع override يدوي.
- [ ] رفع الصورة إلى التخزين السحابي.
- [ ] اعتماد وقفل وإعادة إصدار وإبطال QR القديم.
- [ ] Public verification endpoint يعرض الحد الأدنى فقط.

## المرحلة 4 — Templates & Print
- [ ] Makkah Luxury.
- [ ] Executive Side.
- [ ] Clean Formal.
- [ ] Royal Dark.
- [ ] Minimal Corporate.
- [ ] Full ID وFront/Back لكل قالب.
- [ ] CR80 85.60 × 53.98 mm.
- [ ] Printer calibration / Offset profile.
- [ ] Front / Back / Both / Batch print.
- [ ] Print logs.

## المرحلة 5 — Admin
- [ ] Dashboard الحالات والانتهاء.
- [ ] Audit log.
- [ ] CSV/Excel import.
- [ ] Duplicate card.
- [ ] Quick Issue.
- [ ] Expiry alerts.

## Gate
لا Merge ولا Stable Deploy قبل:
1. تشغيل migration على Test ومراجعة schema.
2. اختبار API permissions بحساب يملك Staff ولا يملك ID Studio والتأكد أنه مرفوض.
3. اختبار حساب ID Studio محدود الفرع.
4. اختبار إصدار بطاقة مستقلة بدون إنشاء User.
5. اختبار بطاقة مرتبطة بموظف بدون تعديل سجله الأصلي.
6. اعتماد المستخدم للقوالب والطباعة.
