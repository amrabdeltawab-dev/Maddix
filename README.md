# Maddix

نظام إدارة طلبات وخامات المخزن، مبني باستخدام React + Vite + TypeScript في الواجهة، وExpress + tRPC + Drizzle + MySQL في الخادم.

## التشغيل المحلي

يتطلب Node.js 20+ وpnpm 10+.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# املأ قيم البيئة المطلوبة داخل .env
pnpm check
pnpm test
pnpm dev
```

## إعداد Production

1. أنشئ قاعدة MySQL/TiDB مستقلة.
2. عرّف المتغيرات المطلوبة في منصة الاستضافة باستخدام `.env.example` كمرجع.
3. استخدم قيمة عشوائية قوية لـ `JWT_SECRET` بطول 32 حرفًا على الأقل.
4. نفّذ البناء والتحقق:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm start
```

الخادم يستمع افتراضيًا على المنفذ `3000` أو قيمة `PORT` المحددة. نقطة فحص الحالة هي:

```text
GET /healthz
```

ويجب أن ترجع حالة `ok` مع حالة اتصال قاعدة البيانات.

## Vercel

المشروع يحتوي على `vercel.json` يوجه ملفات الواجهة Static إلى مجلد `public` ويشغل خادم Express من `dist/index.js`.

- Build command: `pnpm build`
- لا ترفع ملفات `.env` أو الأسرار إلى Git أو ZIP.
- أضف متغيرات البيئة من لوحة Vercel قبل أول نشر Production.

## الملفات المستبعدة عمدًا

تم استبعاد `node_modules` و`.git` وملفات البيئة السرية وملفات Manus المؤقتة ونتائج السجلات والكاش من حزمة التسليم. يتم إنشاء ملفات البناء تلقائيًا بواسطة `pnpm build`.

## فحص الجودة

```bash
pnpm check
pnpm test
```

لا يحتوي هذا الإصدار على بيانات تجريبية أو Mock Data؛ يعتمد على قاعدة البيانات والمتغيرات التي يحددها مسؤول النشر.
