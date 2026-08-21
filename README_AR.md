# الماهر الماسي — AL-MAHER NEXT 1.0.0

إعادة بناء كاملة لواجهة نظام الماهر الماسي على بنية Modular حديثة:

- React 19 + Vite 8
- Cloudflare Worker واحد للـAPI
- Cloudflare Static Assets للواجهة
- Supabase هو مصدر الحقيقة للبيانات
- Cookie جلسة HttpOnly للموظفين
- Service Role موجود في Cloudflare فقط ولا يصل للمتصفح
- Desktop-First مع دعم آمن للموبايل

## الموديولات الموجودة

- Dashboard
- Trips + Trip Center
- Bookings + Booking Editor
- Passengers
- Tickets + A4 / 80mm / 58mm
- QR Scanner (صعود/وصول/سكن/عودة)
- Housing
- Seats
- Fleet
- Finance
- Refund Workflow
- Operations
- CRM
- Documents
- Notifications
- Return Operations
- Staff & Permissions
- Reports
- Customer Portal
- Developer / System

## قواعد محفوظة من المرجع

- Supabase هو مصدر الحقيقة؛ لا توجد بيانات تشغيلية أساسية في localStorage.
- الرحلات المشتركة تسمح بالتشغيل عبر الفروع المشاركة مع عزل مالية كل فرع.
- `allBranches` لا تعني `allBranchesFinance`.
- الجلسة تستمر بعد Refresh عبر Cookie آمنة.
- الحجز والرحلات يستخدمان الدوال الذرية الموجودة في Supabase.
- فشل WhatsApp/SMS/Email لا يوقف الحجز.
- `keep_vars = true` لحماية Variables الموجودة على Cloudflare.

## متغيرات Cloudflare المطلوبة

يجب أن تبقى القيم الحالية كما هي في Worker Settings:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (Secret)

ولا تضع أي Secret داخل ملفات المشروع.

## طريقة النشر

### لو GitHub مربوط بالفعل بـ Cloudflare Worker

1. ارفع محتويات هذا المشروع إلى جذر Repository الخاص بـ `almaher-almasi`.
2. لا ترفع مجلد `node_modules`.
3. Build command: `npm run build`
4. Deploy command: `npx wrangler deploy`
5. Root directory: جذر المشروع `/`.
6. بعد نجاح Deploy افتح `system.almaheralmasi.sa`.

اسم الـWorker في `wrangler.toml` هو نفسه `almaher-almasi`، لذلك النشر يستهدف نفس Worker.

## Supabase

المجلد `supabase/` يحتوي ملفات المرجع والمراجعة القديمة اللازمة لاستعادة/فحص البنية. لا تشغّل Migration عشوائيًا على قاعدة بيانات الإنتاج؛ ابدأ أولًا بملف الفحص القراءة فقط:

`supabase/AL_MAHER_V9_MASTER_GAP_AUDIT.sql`

إذا كانت قاعدة البيانات الحالية فيها الجداول والدوال التي ثبتناها سابقًا، لا تحتاج لإعادة تشغيل كل ملفات Migration.

## الفحوصات المنفذة على الحزمة

- Worker JavaScript syntax: PASS
- Worker `/api/health`: PASS (HTTP 200)
- Unauthorized `/api/auth/me`: PASS (HTTP 401)
- Internal import graph: PASS
- Missing local imports: 0
- Source JS/JSX files audited: 33
- CSS brace check: PASS
- `package.json` JSON: PASS

ملاحظة: `npm install` داخل بيئة إنشاء الحزمة تعطل بسبب عدم توفر اتصال DNS خارجي في البيئة، لذلك لم يتم تنفيذ Vite production build محليًا هنا. الحزم مثبتة بإصدارات npm الحالية المعروفة وقت إنشاء الحزمة، وCloudflare/GitHub سيقومان بالتثبيت والبناء أثناء Deploy.
