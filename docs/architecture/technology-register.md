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
| MinIO | AGPL-3.0 | ⚠️ ❓ | سرویس جدا و دست‌نخورده، پس AGPL به کد ما نمی‌رسد. دیگر باینری و image رسمی ندارد و از سورس build می‌شود (تصمیم ۲) |
| OpenSearch | Apache-2.0 | ✅ (هدف) | جست‌وجو و لاگ (تصمیم ۱) |
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
| Neo4j Community | GPL-3.0 | ⚠️ ❓ | خوشه‌بندی و backup آنلاین فقط در نسخهٔ تجاری است (تصمیم ۳) |
| Elasticsearch · Kibana · Logstash (ELK فعلی) | AGPL-3.0 / ELv2 / SSPL | ❓ | تصمیم ۱ |
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

## ۵. تصمیم‌های باز (نیاز به نظر صاحب محصول)

### تصمیم ۱ — جست‌وجو و لاگ: OpenSearch یا Elasticsearch

- **الف (پیشنهاد):** OpenSearch + OpenSearch Dashboards + Fluent Bit، همه Apache-2.0.
  مستقل از یک شرکت و امکانات امنیتی رایگان است. ELK فعلی در M5 منتقل می‌شود.
- **ب:** Elasticsearch با مجوز AGPL-3.0 (از ۲۰۲۴). متن‌باز است، ولی بعضی امکانات فقط
  در مجوز Elastic هستند و مسیر مجوز آن قبلاً یک بار عوض شده است.

### تصمیم ۲ — ذخیره‌ساز فایل (S3): MinIO یا SeaweedFS

- **الف (پیشنهاد فعلی):** فعلاً MinIO بماند، چون همه‌چیز با آن آزموده شده است. پیش از
  MVP، SeaweedFS (Apache-2.0) با همان آزمون‌های S3 (از جمله رد آپلود دست‌کاری‌شده)
  سنجیده شود. کد به ذخیره‌ساز خاصی وابسته نیست، پس تعویض فقط تنظیمات است.
- **ب:** همین حالا به SeaweedFS برویم.
- دلیل طرح این موضوع: MinIO از ۲۰۲۵ باینری و image رسمی منتشر نمی‌کند، کنسول مدیریت را
  از نسخهٔ متن‌باز حذف کرده و AGPL است.

### تصمیم ۳ — پایگاه‌دادهٔ گراف لایهٔ AI: Neo4j یا Apache AGE

- **الف (پیشنهاد):** Apache AGE (Apache-2.0)، افزونهٔ PostgreSQL که در زیرساخت فعلی
  (`infra-postgres-age.yml`) هم هست. یک پایگاه‌داده کمتر برای نگه‌داری، backup و
  RLS یکسان.
- **ب:** Neo4j Community بماند. GPL است و خوشه‌بندی ندارد.
- زمان تصمیم: پیش از M5 (تجمیع سرویس‌های AI).
