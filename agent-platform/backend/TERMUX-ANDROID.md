# تشغيل Agent Hub على Android عبر Termux

هذا الدليل لتشغيل واجهة Agent Hub وواجهة API على **الهاتف نفسه** دون Docker. لا يحتاج إلى أي قاعدة بيانات من مشاريعك الأخرى.

## المتطلبات والحدود

- هاتف Android مع Termux من مصدر موثوق، واتصال إنترنت أثناء تثبيت الحزم واستخدام مزود النموذج.
- Node.js بإصدار 22.9 أو أحدث، وPostgreSQL، وGit.
- مفتاح API صالح لمزود متوافق مع OpenAI Chat Completions واسم نموذج مدعوم. قد يترتب على استخدام النموذج رسوم حسب المزود.
- تستطيع النسخة الحالية إنشاء ملفات مصدر لتطبيق ويب ثابت وحفظها في قاعدة البيانات ومجلد مساحة العمل. لكنها لا تشغّل الشيفرة المولّدة، ولا تختبر البناء آليًا، ولا تستخرج محتوى الكتب، ولا تبني APK أو تنشر التطبيقات تلقائيًا.
- لا تشارك رمز المالك أو مفتاح النموذج، ولا تفتح منفذ الخادم للإنترنت.

## التثبيت الأول

نفّذ الأوامر داخل Termux:

```bash
pkg update
pkg upgrade
pkg install nodejs-lts postgresql git openssl
node --version
```

تأكد أن إصدار Node.js هو 22.9 أو أحدث. ثم نزّل المستودع:

```bash
cd ~
git clone --depth 1 https://github.com/safwt771754091s-crypto/awesome-llm-apps.git
cd ~/awesome-llm-apps/agent-platform/backend
npm install --no-audit --no-fund
```

## تهيئة PostgreSQL

تهيئة مجلد قاعدة البيانات أول مرة فقط:

```bash
mkdir -p "$PREFIX/var/lib/postgresql"
if [ ! -s "$PREFIX/var/lib/postgresql/PG_VERSION" ]; then
  initdb -D "$PREFIX/var/lib/postgresql"
fi
pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$PREFIX/var/lib/postgresql/server.log" start
```

أنشئ مستخدم قاعدة البيانات؛ سيطلب الأمر كلمة مرور مرتين. استخدم كلمة مرور عشوائية قوية واحفظها:

```bash
createuser -P agent_platform
createdb -O agent_platform agent_platform
```

إذا كنت قد أنشأت المستخدم وقاعدة البيانات من قبل، لا تكرر أوامر الإنشاء؛ شغّل PostgreSQL فقط.

## إعداد أسرار التشغيل

أنشئ رمز مالك عشوائيًا لنسخه إلى ملف الإعداد:

```bash
openssl rand -hex 32
```

افتح ملف إعداد محلي:

```bash
cd ~/awesome-llm-apps/agent-platform/backend
nano .env
```

ضع القيم التالية مع استبدال القيم التجريبية. لا تضع الملف في GitHub ولا ترسل الأسرار في المحادثة:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
OWNER_API_TOKEN=PASTE_A_RANDOM_64_HEX_CHARACTER_TOKEN_HERE
DATABASE_URL=postgresql://agent_platform:PASTE_DB_PASSWORD_HERE@127.0.0.1:5432/agent_platform
DATABASE_SSL=false
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=PASTE_YOUR_PROVIDER_API_KEY_HERE
LLM_MODEL=PASTE_A_MODEL_NAME_SUPPORTED_BY_YOUR_PROVIDER
LLM_TIMEOUT_MS=45000
RATE_LIMIT_PER_MINUTE=20
```

استخدم كلمة مرور قاعدة البيانات التي أدخلتها عند إنشاء المستخدم. إذا احتوت على رموز خاصة فيجب ترميزها في رابط DATABASE_URL؛ استخدام كلمة مرور عشوائية من الأحرف والأرقام فقط يجعل الإعداد أسهل.

## التشغيل والتحقق

```bash
cd ~/awesome-llm-apps/agent-platform/backend
npm start
```

اترك جلسة Termux مفتوحة، ثم افتح هذا العنوان في متصفح الهاتف نفسه:

`http://127.0.0.1:8080`

أدخل رمز المالك واضغط فحص الخادم. يجب أن تكون قاعدة البيانات متاحة، وأن تكون بيانات مزود النموذج صحيحة قبل طلب إنشاء الملفات.

## الإيقاف والتشغيل مرة أخرى

- لإيقاف API: اضغط `Ctrl+C` في جلسة تشغيله.
- لإيقاف PostgreSQL عند الحاجة: `pg_ctl -D "$PREFIX/var/lib/postgresql" stop`
- لتشغيل PostgreSQL لاحقًا: `pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$PREFIX/var/lib/postgresql/server.log" start`
- لتحديث الكود لاحقًا: انتقل إلى مجلد المستودع ونفّذ `git pull`، ثم راجع تغييرات الإعدادات قبل إعادة التشغيل.

**مهم:** هذا إعداد محلي إرشادي ولم يتم اختباره على جهاز Android الخاص بك. إذا فشل تثبيت PostgreSQL أو Node.js في إصدار Termux لديك، احتفظ برسالة الخطأ كاملة دون تضمين مفاتيح أو كلمات مرور.
