# SIMORGH ERP

**AI-Native Industrial ERP** — ERP + Engineering + AI Agents + Digital Twin.
نسخهٔ اول برای صنعت برق (سازندگان تابلو و تجهیزات برقی) ساخته می‌شود و Core
عمومی می‌ماند.

```
SIMORGH ERP
├── Core            Tenant · Organization · Party · User/Role/Permission · Item · UOM
│                   Currency · Tax · Project · Document · Workflow · Audit · Event
├── CRM · Sales · Procurement · Inventory · Finance · Projects · HCM
├── Manufacturing · MRP · Quality · Maintenance
├── SIMORGH DESIGN SUITE   (Electrical Industry Pack)
├── SIMORGH AI
└── SIMORGH TWIN
```

## مستندات معماری

| سند | محتوا |
|---|---|
| [SIMORGH ERP — Enterprise Architecture v1.0](docs/architecture/SIMORGH-ERP-Enterprise-Architecture-v1.0.md) | تصمیم‌های معماری (ADR)، مدل Tenant/RBAC، مدل داده، API، Document/Workflow Engine، مالی، انبار/BOM/MRP، تولید، کیفیت، پروژه، AI، Industry Pack، رویدادها، ساختار مخزن، مهاجرت و Roadmap |
| [پیوست A — فهرست کد فعلی](docs/architecture/appendix-A-code-inventory.md) | حکم KEEP / REFACTOR / MOVE / REPLACE برای Design Suite، پلتفرم AI، Kara و Ledger |
| [پیوست B — DDL هستهٔ دیتابیس](docs/architecture/appendix-B-core-schema.sql) | اسکیمای Core + Finance/GL (از M1 منبع اصلی: `packages/db/migrations`) |
| [ثبت فناوری‌ها و مجوزها](docs/architecture/technology-register.md) | همهٔ مؤلفه‌ها با مجوزشان، جایگزینی‌ها و تصمیم‌های باز (سیاست فقط‌متن‌باز، ADR-16) |

## ساختار مخزن

```
apps/
  api/        NestJS 12 (Fastify) — Modular Monolith؛ فعلاً Kernel هسته
  worker/     Outbox relay → Kafka
  web/        Next.js 16 — UI و BFF (فارسی، RTL)
packages/
  db/         migrationهای SQL (منبع حقیقت)، schema در Drizzle، migrator، ابزار تست
  contracts/  Zod: درخواست‌ها و پاسخ‌های API، کاتالوگ مجوزها، envelope رویداد
infra/compose/  PostgreSQL · Valkey · Kafka · MinIO برای توسعه
tools/          check-boundaries (مرزهای معماری) · check-licenses (سیاست فقط‌متن‌باز) — هر دو در CI
```

## راه‌اندازی محلی

نیازمندی‌ها: Node 22، pnpm 10، Docker.

```bash
cp .env.example .env                       # JWT_SECRET را پر کنید: openssl rand -base64 48
docker compose -f infra/compose/docker-compose.yml up -d
pnpm install
pnpm build
set -a; . ./.env; set +a
pnpm db:migrate                            # با DATABASE_URL_OWNER
pnpm --filter @simorgh/api seed:platform-admin
pnpm --filter @simorgh/api start           # API روی :4000
pnpm --filter @simorgh/worker start        # outbox relay
pnpm --filter @simorgh/web dev             # UI روی :3000
```

ساخت اولین شرکت (با توکن مدیر پلتفرم):

```bash
TOKEN=$(curl -s -XPOST localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$PLATFORM_ADMIN_EMAIL\",\"password\":\"$PLATFORM_ADMIN_PASSWORD\"}" | jq -r .accessToken)
curl -XPOST localhost:4000/api/v1/platform/tenants -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "code":"ekc","name":"الکتروکویر",
  "legalEntity":{"code":"EKC","name":"شرکت الکتروکویر"},
  "owner":{"email":"owner@ekc.test","displayName":"مالک","password":"owner-pass-123"}}'
```

سپس در `http://localhost:3000` با کد شرکت `ekc` وارد شوید.

## آزمون‌ها

آزمون‌ها روی **PostgreSQL و Kafka واقعی** اجرا می‌شوند، چون RLS، triggerها و grantها
خودشان موضوع آزمون‌اند. هر فایل آزمون یک دیتابیس تازهٔ migrate‌شده می‌سازد.

```bash
DATABASE_URL_OWNER=postgres://postgres:postgres@localhost:5432/postgres \
KAFKA_BROKERS=localhost:9092 \
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY=simorgh S3_TEST_SECRET_KEY=simorgh-dev-secret \
pnpm test
```

## وضعیت M1 (Kernel)

| بخش | آنچه ساخته شد |
|---|---|
| Tenancy | جداسازی با RLS روی همهٔ جداول tenant (`FORCE`)؛ نقش `simorgh_app` بدون BYPASSRLS؛ provisioning اتمیک (tenant + شرکت + نقش‌های سیستمی + مالک) |
| Identity | ورود tenant و ورود مدیر پلتفرم؛ argon2id؛ قفل حساب پس از تلاش ناموفق؛ access JWT ۱۵ دقیقه‌ای + refresh چرخشی با تشخیص استفادهٔ مجدد؛ خروج و غیرفعال‌سازی عضو فوراً اثر می‌کند |
| RBAC | کاتالوگ مجوز در کد (`definePermissions`) و همگام‌سازی در بوت؛ نقش + scope + context؛ guard با پیش‌فرض «رد» برای routeهای بی‌اعلان؛ نقش admin همیشه همهٔ مجوزها را دارد |
| Audit | در همان تراکنش تغییر؛ append-only (trigger + grant)؛ tenantها audit پلتفرم را نمی‌بینند |
| Outbox | رویداد در همان تراکنش؛ relay با `FOR UPDATE SKIP LOCKED` به Kafka (producer idempotent، `acks=all`، یک topic به ازای ماژول، کلید = شناسهٔ سند) و ارسال حداقل‌یک‌بار |
| Numbering | سری شماره به ازای نوع سند/شرکت/دوره؛ بدون شکاف در rollback |
| Files | پیوست با آپلود مستقیم به S3/MinIO؛ اندازه، نوع و SHA-256 در امضا؛ تأیید پیش از `stored` |
| Web | ورود فارسی RTL، پیشخوان، صفحهٔ نقش‌ها؛ توکن‌ها فقط در کوکی httpOnly؛ refresh خودکار |
| CI | boundaries، سیاست مجوزها، build، lint، typecheck، test با PostgreSQL/Kafka/MinIO واقعی |

**هنوز انجام نشده (M1.x / M2):** Idempotency-Key و If-Match در API؛ تولید OpenAPI و
ابزارهای MCP؛ اعمال Data Scope در کوئری‌ها (فعلاً فقط وجود مجوز بررسی می‌شود)؛
دعوت‌نامه برای افزودن کاربرِ دارای حساب (فعلاً مستقیم عضو می‌شود)؛ rate limit بر اساس IP؛
MFA/TOTP و SSO؛ صفحات مدیریت اعضا و نقش در UI.
