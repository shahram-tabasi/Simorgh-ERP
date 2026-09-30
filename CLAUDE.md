# Simorgh ERP — notes for Claude

AI-native industrial ERP; first industry pack is electrical switchgear. The
architecture document is the source of truth:
`docs/architecture/SIMORGH-ERP-Enterprise-Architecture-v1.0.md` (Persian; ADRs in section 0).

The owner writes in Persian; answer in Persian.

## Standing rules from the owner

- **Open source only, and say when something better exists.** Before bringing
  in or changing any technology — including one the owner names — load the
  `tech-decisions` skill. Anything not OSI open source, unmaintained, or with a
  clearly better alternative is raised for a decision *before* building it.
  Settled choices are in `docs/architecture/technology-register.md`; don't re-ask those.
- Avoid rework: when a choice now is cheap and later is expensive (a message
  bus before its consumers exist, a schema before data exists), raise it now.

## Layout

`apps/api` NestJS 12 kernel · `apps/worker` outbox → Kafka · `apps/web` Next.js 16 UI/BFF ·
`packages/db` SQL migrations (source of truth) + Drizzle · `packages/contracts` Zod, permissions, events.

## Checking a change

```bash
pnpm build && pnpm lint && pnpm typecheck
pnpm check:boundaries      # module boundaries (architecture §3, §19)
pnpm check:licenses        # open-source policy (ADR-16)
pnpm test                  # real PostgreSQL + Kafka (+ S3 when S3_TEST_ENDPOINT is set)
```

Tests run against real services on purpose (RLS, triggers, grants, broker
behaviour are what is tested). Env: `DATABASE_URL_OWNER`, `KAFKA_BROKERS`,
`S3_TEST_ENDPOINT` — see the root README.

## Rules the code keeps

- Every tenant table has `tenant_id` + forced RLS; the API connects as
  `simorgh_app` (no BYPASSRLS). `core.assert_rls()` fails on a table without it.
- A migration, once applied, is never edited — add a new numbered file.
- Every route declares its access (`@Public`, `@Authenticated`,
  `@PlatformAdminOnly`, `@RequirePermission`); an undeclared route is refused.
- Audit and outbox rows are written in the same transaction as the change.
- Posted journal entries are immutable; correct them with a reversal.
- Event types are `<module>.<entity>.<verb>`, module letters only; topic `erp.<module>.events`, key = subject id.
