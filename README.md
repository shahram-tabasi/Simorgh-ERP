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
| [پیوست B — DDL هستهٔ دیتابیس](docs/architecture/appendix-B-core-schema.sql) | اسکیمای اجرایی Core + Finance/GL برای PostgreSQL 16 (RLS، دفتر کل تغییرناپذیر، Outbox) |

## پشتهٔ فناوری (خلاصه)

Next.js (UI/BFF) · NestJS (Modular Monolith) · PostgreSQL 16 + RLS · Drizzle ·
Redis/BullMQ · RabbitMQ (Outbox) · MinIO · OpenSearch · Python (فقط لایهٔ AI)
