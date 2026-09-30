# ثبت فناوری‌ها و مجوزها (Technology Register)

> بخشی از [SIMORGH ERP — Enterprise Architecture v1.0](./SIMORGH-ERP-Enterprise-Architecture-v1.0.md) — ADR-16

**قاعده (ADR-16):** Simorgh فقط از نرم‌افزار **متن‌باز با مجوز مورد تأیید OSI** ساخته
می‌شود. هر پیشنهادی (از هر کسی) که متن‌باز نیست، یا جایگزینی جامع‌تر و بهتر دارد، **پیش
از پیاده‌سازی** برای تصمیم مطرح می‌شود و تصمیم همین‌جا ثبت می‌شود.

**اجرای خودکار:** `pnpm check:licenses` در CI:
- مجوز هر بستهٔ npm را بررسی می‌کند؛
- هر image در compose، CI و Dockerfileها باید در `tools/approved-components.json` باشد؛
- هر استثنا باید با دلیلش در همان فایل ثبت شود.

| وضعیت | معنی |
|---|---|
| ✅ | تأییدشده و در حال استفاده |
| 🔁 | جایگزین شد (دلیل در ستون آخر) |
| ⚠️ | متن‌باز است، ولی شرطی دارد که باید رعایت شود |
| ❓ | **تصمیم باز**؛ منتظر نظر صاحب محصول |
| ⛔ | متن‌باز نیست؛ فقط به‌عنوان سیستم بیرونی مشتری یا در حال حذف |

## ۱. پشتهٔ ERP (مخزن Simorgh-ERP)

| مؤلفه | مجوز | وضعیت | یادداشت |
|---|---|---|---|
| PostgreSQL 16 | PostgreSQL | ✅ | |
| Apache Kafka 4.2 (KRaft) | Apache-2.0 | ✅ | جای RabbitMQ (ADR-07، بازنگری ۱۴۰۵/۰۷/۰۸) |
| `@platformatic/kafka` | Apache-2.0 | ✅ | کلاینت JS خالص و فعال؛ `kafkajs` از ۲۰۲۳ به‌روز نشده |
| RabbitMQ | MPL-2.0 | 🔁 | متن‌باز بود؛ به دلیل بازپخش، ترتیب و IoT جای خود را به Kafka داد |
| Valkey 8 | BSD-3-Clause | ✅ | جای Redis |
| Redis ≥ 7.4 | RSALv2 / SSPL (از ۸.۰ AGPL هم) | 🔁 | از ۷.۴ متن‌باز نیست؛ Valkey همان پروتکل است و BullMQ بی‌تغییر کار می‌کند |
| SeaweedFS 4.48 | Apache-2.0 | ✅ | ذخیره‌ساز فایل پیش‌فرض (تصمیم ۲، ۱۴۰۵/۰۷/۰۸). CI و compose از image رسمی `chrislusf/seaweedfs:4.48` با احراز هویت فعال استفاده می‌کنند. نسخهٔ Enterprise جدایی دارد که استفاده نمی‌شود |
| MinIO (community) | AGPL-3.0 | 🔁 | **پایان عمر:** کد از ۲۰۲۵-۱۰-۲۳ منجمد است و وصلهٔ امنیتی نمی‌گیرد. از CI و compose هم حذف شد. جزئیات در بخش ۶ |
| MinIO AIStor Free / Enterprise | تجاری | ⛔ | AIStor Free رایگان ولی تجاری است: کلید لایسنس، فقط یک نود، «Redistribution is prohibited». قابل گنجاندن در Simorgh نیست |
| OpenSearch (+ Dashboards، Fluent Bit) | Apache-2.0 | ✅ | جست‌وجو و لاگ (تصمیم ۱، ۱۴۰۵/۰۷/۰۸) |
| NestJS · Next.js · React · Fastify | MIT | ✅ | |
| Drizzle ORM · Zod · jose · pg | Apache-2.0 / MIT | ✅ | |
| `@node-rs/argon2` · `@aws-sdk/*` | MIT / Apache-2.0 | ✅ | |
| Turborepo · pnpm · Vitest · SWC · Playwright | MIT / Apache-2.0 | ✅ | |
| sharp → libvips | Apache-2.0 → LGPL-3.0 | ⚠️ | کتابخانهٔ جدا و دست‌نخورده (استثنای ثبت‌شده) |
| Electron · Flutter | MIT / BSD-3 | ✅ | |
| Docker Engine · Compose | Apache-2.0 | ✅ | Docker Desktop تجاری است و لازم نیست |

## ۲. لایهٔ AI و زیرساخت فعلی (`simorgh-agent`)

| مؤلفه | مجوز | وضعیت | یادداشت |
|---|---|---|---|
| vLLM · LiteLLM (هسته) | Apache-2.0 / MIT | ✅ | پوشهٔ `enterprise/` در LiteLLM تجاری است و استفاده نمی‌شود |
| Qdrant | Apache-2.0 | ✅ | |
| Neo4j Community | GPL-3.0 | 🔁 | با Apache AGE جایگزین می‌شود (تصمیم ۳، ۱۴۰۵/۰۷/۰۸)؛ انتقال در M5 |
| Apache AGE | Apache-2.0 | ✅ | گراف دانش لایهٔ AI داخل PostgreSQL (تصمیم ۳)؛ همان backup و همان RLS |
| Elasticsearch · Kibana · Logstash (ELK فعلی) | AGPL-3.0 / ELv2 / SSPL | 🔁 | با OpenSearch + Dashboards + Fluent Bit جایگزین می‌شود (تصمیم ۱)؛ انتقال در M5 |
| Mailcow · GitLab CE | GPL-3.0 / MIT | ✅ | امکانات EE در GitLab تجاری است و استفاده نمی‌شود |
| Claude API | سرویس تجاری | ⚠️ | فقط از طریق ai-gateway؛ On-prem با مدل متن‌باز روی vLLM هم کار می‌کند |

## ۳. سیستم‌های بیرونی مشتری (جزء محصول نیستند)

| سیستم | مجوز | وضعیت | یادداشت |
|---|---|---|---|
| EPLAN | تجاری | ⛔ | متعلق به مشتری؛ Simorgh فقط از طریق `eplan-bridge` یکپارچه می‌شود و بدون آن هم کار می‌کند |
| MongoDB (Design Suite فعلی) | SSPL | ⛔ | در M4 حذف و به PostgreSQL منتقل می‌شود |
| SQL Server / MySQL (TPMS، EPLAN parts) | تجاری / GPL | ⛔ | Legacy؛ فقط connector فقط‌خواندنی |

## ۴. گزینه‌هایی که از پیش کنار گذاشته شده‌اند

| گزینه | دلیل | جایگزین متن‌باز |
|---|---|---|
| Confluent Schema Registry و connectorهای Confluent | Confluent Community License | Apicurio Registry یا Karapace (Apache-2.0)؛ Debezium (Apache-2.0) |
| Redpanda | BSL | Apache Kafka |
| Kafka UIهای تجاری | — | Kafbat UI (Apache-2.0) |
| `kafkajs` | متن‌باز ولی بی‌نگهداری از ۲۰۲۳ | `@platformatic/kafka` |

## ۵. تصمیم‌ها (هر سه بسته شده‌اند؛ متن گزینه‌ها برای سابقه می‌ماند)

### تصمیم ۱ — جست‌وجو و لاگ: OpenSearch یا Elasticsearch — ✅ **تصمیم گرفته شد: OpenSearch** (۱۴۰۵/۰۷/۰۸)

- **الف (پیشنهاد):** OpenSearch + OpenSearch Dashboards + Fluent Bit، همه Apache-2.0.
  مستقل از یک شرکت و امکانات امنیتی رایگان است. ELK فعلی در M5 منتقل می‌شود.
- **ب:** Elasticsearch با مجوز AGPL-3.0 (از ۲۰۲۴). متن‌باز است، ولی بعضی امکانات فقط
  در مجوز Elastic هستند و مسیر مجوز آن قبلاً یک بار عوض شده است.

### تصمیم ۲ — ذخیره‌ساز فایل (S3): جایگزین MinIO — ✅ **تصمیم گرفته شد: SeaweedFS** (۱۴۰۵/۰۷/۰۸)

نسخهٔ پین‌شده: **4.48** (آخرین انتشار، ۲۰۲۶-۰۹-۲۸، مجوز Apache-2.0 در همان تگ). همان
نسخه با آزمون‌های S3 پروژه دوباره آزموده شد و هر ۳ آزمون قبول شد. Versity S3 Gateway
در صورت نیاز مشتری به ذخیرهٔ فایل‌ها به‌صورت فایل عادی روی NAS، گزینهٔ پشتیبانی‌شده
می‌ماند (بدون تغییر کد).

**نکتهٔ عملیاتی (در آزمون پیدا شد):** SeaweedFS برای هر bucket مجموعه‌ای از volumeها را
از پیش رزرو می‌کند و سقف پیش‌فرض ۸ volume است. با چند bucket فضا تمام شد و آپلود با
«No writable volumes» شکست خورد. Simorgh فقط یک bucket دارد (`S3_BUCKET`)، و CI و compose
با `-volume.max=0` (تعداد volume بر اساس فضای آزاد دیسک) و `-master.volumeSizeLimitMB=1024`
اجرا می‌شوند. نصب‌کنندهٔ On-prem هم باید همین تنظیمات را داشته باشد.

MinIO دیگر گزینه نیست (بخش ۶). کد Simorgh فقط با API استاندارد S3 کار می‌کند، پس
هر سه گزینهٔ زیر بدون تغییر کد کار می‌کنند. هر سه در ۱۴۰۵/۰۷/۰۸ با آزمون‌های S3
پروژه (`apps/api/test/s3.test.ts`) و احراز هویت فعال آزموده شدند و **هر ۳ آزمون**،
از جمله رد آپلود دست‌کاری‌شده، قبول شدند:

| گزینه | مجوز | نسخهٔ آزموده | بلوغ | مناسب برای |
|---|---|---|---|---|
| **SeaweedFS** | Apache-2.0 | `chrislusf/seaweedfs:latest` (۲۰۲۶-۰۹) | از ۲۰۱۴، فعال | از یک نود تا خوشه؛ replication در نسخهٔ متن‌باز. نسخهٔ Enterprise جدا دارد (بازسازی erasure coding و…)؛ ریسک open-core کم ولی قابل پیگیری |
| **Versity S3 Gateway** | Apache-2.0 | `v1.8.0` (۲۰۲۶-۰۹-۰۴) | v1 از ۲۰۲۴، انتشار ماهانه | On-prem ساده: فایل‌ها به‌صورت فایل عادی روی دیسک یا NAS می‌مانند و backup با ابزار معمولی انجام می‌شود؛ replication ندارد و به دیسک/NAS تکیه می‌کند |
| **RustFS** | Apache-2.0 | `1.0.0` (۲۰۲۶-۰۹-۱۶) | 1.0 تازه منتشر شده | جایگزین هم‌سبک MinIO؛ برای محصول هنوز جوان است و فقط زیر نظر می‌ماند |

کنار گذاشته شده: **Garage** (AGPL-3.0، همان نگرانی MinIO)؛ **Ceph RGW** برای مقیاس
بزرگ مناسب است ولی برای استقرار معمول مشتری بیش از حد سنگین است. مشتری می‌تواند S3
خودش (AWS، Ceph، یا حتی AIStor با لایسنس خودش) را هم وصل کند.

### تصمیم ۳ — پایگاه‌دادهٔ گراف لایهٔ AI: Neo4j یا Apache AGE — ✅ **تصمیم گرفته شد: Apache AGE** (۱۴۰۵/۰۷/۰۸)

- **الف (پیشنهاد):** Apache AGE (Apache-2.0)، افزونهٔ PostgreSQL که در زیرساخت فعلی
  (`infra-postgres-age.yml`) هم هست. یک پایگاه‌داده کمتر برای نگه‌داری، backup و
  RLS یکسان.
- **ب:** Neo4j Community بماند. GPL است و خوشه‌بندی ندارد.
- زمان تصمیم: پیش از M5 (تجمیع سرویس‌های AI).

## ۶. MinIO — وضعیت دقیق (بررسی‌شده از منابع اصلی، ۱۴۰۵/۰۷/۰۸)

| موضوع | واقعیت | منبع |
|---|---|---|
| مجوز | تا ۲۰۲۱-۰۴-۲۳ Apache-2.0؛ از آن تاریخ AGPL-3.0 | کامیت `06943256` «update license change for MinIO» در `github.com/minio/minio` |
| وضعیت مخزن | README: «**THIS REPOSITORY IS NO LONGER MAINTAINED**»؛ کاربران به AIStor ارجاع داده می‌شوند | کامیت‌های `27742d46` (۲۰۲۵-۱۲-۰۳، maintenance mode)، `be7800c8`، `7aac2a2c` |
| وضعیت از نگاه شرکت | «codebase is frozen, with no new features, bug fixes, or security patches»؛ توصیه به «evaluate alternatives» | min.io/pricing |
| آخرین انتشار رسمی | `RELEASE.2025-10-15T17-29-55Z` | تگ‌های git |
| آخرین تغییر کد | ۲۰۲۵-۱۰-۲۳ (از جمله اصلاح امنیتی PostPolicy tagging، بعد از آخرین انتشار)؛ بعد از آن فقط README و مستندات | `git log RELEASE.2025-10-15T17-29-55Z..7aac2a2c` |
| توزیع | فقط سورس؛ باینری و image رسمی منتشر نمی‌شود | README («Source-Only Distribution») |
| نسخه‌ای که Simorgh الان در CI و compose می‌سازد | `v0.0.0-20260212201848-7aac2a2c5b7c` = HEAD شاخهٔ master، یعنی همان کد ۲۰۲۵-۱۰-۲۳ به‌علاوهٔ تغییرات README | `go version -m` روی باینری |
| نظر خود MinIO دربارهٔ AGPL | «MinIO cannot make the determination as to whether your application's usage … is in compliance»؛ برای هر کاربردی که تعهدات AGPL را فعال کند، لایسنس تجاری پیشنهاد می‌کند | `COMPLIANCE.md` در همان مخزن |
| AIStor Free | تجاری (نه متن‌باز)، کلید لایسنس، فقط یک نود، «Redistribution is prohibited» | min.io/pricing |

**نتیجه برای محصول تجاری Simorgh:**
1. **نسخهٔ AGPL:** مشکل اصلی دیگر مجوز نیست، امنیت است. سرور ذخیره‌سازی‌ای که وصلهٔ
   امنیتی نمی‌گیرد نباید به مشتری تحویل داده شود. اگر Simorgh آن را در نصب‌کننده عرضه
   کند، تعهدات AGPL (ارائهٔ سورس و متن مجوز) هم اضافه می‌شود و خود MinIO تفسیر AGPL را
   به عهدهٔ کاربر می‌گذارد.
2. **AIStor Free:** به دلیل منع بازتوزیع و نیاز به کلید لایسنس، اصلاً قابل گنجاندن
   در Simorgh نیست.
3. **تصمیم ۲ گرفته شد:** SeaweedFS جایگزین شد و MinIO از CI، compose و
   `approved-components.json` هم حذف شد؛ دیگر در هیچ جای Simorgh نیست.

این جمع‌بندی فنی است، نه نظر حقوقی. پیش از فروش تجاری، فهرست مجوزهای نهایی (SBOM) را
یک مشاور حقوقی آشنا با مجوزهای متن‌باز مرور کند.
