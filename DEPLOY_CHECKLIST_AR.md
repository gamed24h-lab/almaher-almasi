# Checklist نشر AL-MAHER NEXT

## قبل الرفع
- [ ] احتفظ بنسخة من ملفات GitHub الحالية كمرجع فقط.
- [ ] تأكد أن Cloudflare Worker اسمه `almaher-almasi`.
- [ ] تأكد أن `SUPABASE_URL` موجود.
- [ ] تأكد أن `SUPABASE_SERVICE_ROLE_KEY` موجود كـ Secret.
- [ ] لا تحذف Custom Domain الحالي.

## رفع GitHub
- [ ] ارفع كل ملفات ومجلدات الحزمة إلى جذر Repository.
- [ ] احذف من الجذر أي `wrangler.jsonc` قديم حتى يبقى `wrangler.toml` فقط.
- [ ] لا ترفع `node_modules`.
- [ ] Commit.

## Cloudflare Build
- [ ] Build command = `npm run build`
- [ ] Deploy command = `npx wrangler deploy`
- [ ] Root directory = `/`
- [ ] راقب أول Deploy حتى Success.

## اختبار بعد النشر
- [ ] افتح `/api/health` وتأكد أن `ok=true`.
- [ ] دخول موظف.
- [ ] Refresh مع بقاء الجلسة.
- [ ] فتح الرحلات والحجوزات.
- [ ] إنشاء حجز تجريبي Test data ثم Refresh.
- [ ] فتح التذكرة والطباعة.
- [ ] QR يدوي ثم كاميرا.
- [ ] فحص السكن والمقاعد.
- [ ] فحص عزل مالية فرع عادي.
- [ ] فحص حساب مدير عام.
- [ ] فحص الاسترداد Request → Approve → Complete.
