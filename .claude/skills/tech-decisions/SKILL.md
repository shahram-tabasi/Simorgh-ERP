---
name: tech-decisions
description: Choosing or adding any technology in Simorgh ERP — a library, service, database, container image, SaaS API, tool, or a change of an existing one — including when the user names a specific product ("use X"). Use before writing the code that brings it in. Enforces the open-source-only policy (ADR-16) and the "tell the owner when something better exists" rule, and says where decisions are recorded.
---

# Technology decisions in Simorgh ERP

## The owner's standing rule — read first

The product owner asked for this explicitly:

> If I ask for something that is **not open source**, or where a **more complete
> or better alternative** exists, tell me so we decide together — before building it.

So, whenever a technology enters or changes — whoever proposed it, including the
owner and including you:

1. **Check it** (the checklist below).
2. If it is **not OSI open source**, is **unmaintained**, or a **clearly better
   alternative** exists: **stop and ask** before writing code. Present, in Persian,
   the options (2–3 at most), their licenses, the trade-off in one line each, your
   recommendation and why, and what it costs to change later. Then wait.
3. If it passes and nothing better exists: go ahead, and record it (below).

Do not silently substitute something else for what the owner asked for, and do
not silently accept it either. Raising it once, briefly, is the job.

Exception: an owner decision already recorded in
`docs/architecture/technology-register.md` is settled — do not re-ask.

## Checklist

| Question | How to check | Fails when |
|---|---|---|
| License | `npm view <pkg> license`; the project's LICENSE file; SPDX id | not OSI-approved: SSPL, BUSL/BSL, Elastic License, RSAL, Commons Clause, Confluent Community, "source-available", proprietary |
| Copyleft reach | GPL/AGPL in a library we link = our code must follow it | GPL/AGPL linked into our code. As a separate, unmodified network service it is OK (e.g. Mailcow) |
| Maintained | last release date, open issues, deprecation notices | no release in ~12 months (kafkajs), archived, or "maintenance mode" |
| Distribution | official image or binary still published? | the upstream stopped shipping it (MinIO images, Bitnami free images) |
| Fit | ADRs in the architecture document | contradicts an ADR (e.g. business logic in Next.js server actions, a second transactional database) |
| Better option | the same need, better met by an OSI project | e.g. Valkey over Redis ≥ 7.4, OpenSearch over Elastic, Apache AGE over a separate graph DB |

## Where decisions live

- `docs/architecture/technology-register.md` — every component: license,
  status and open decisions. Add a row for anything new, and move an open
  decision to settled once the owner answers.
- `tools/approved-components.json` — what CI enforces (`pnpm check:licenses`):
  license allow-lists, npm exceptions with their reason, approved container
  images. A new image or an exception goes here **with the reason**.
- Architecture document, section 0 — a new or changed ADR for anything
  structural (a database, a message bus, a runtime, a framework).

## Settled so far (details in the register)

- Event bus: **Apache Kafka** (KRaft), client `@platformatic/kafka` — not RabbitMQ, not kafkajs.
- Cache and queues: **Valkey** — not Redis ≥ 7.4.
- Search and logs target: **OpenSearch** (moving the current ELK is open decision 1).
- Object storage: **SeaweedFS** 4.48 (Apache-2.0), used only through the S3 API. Not MinIO: its community edition is end of life (frozen, no security patches) and AIStor Free forbids redistribution. Versity S3 Gateway remains a supported alternative for plain-files-on-NAS installs.
- Open: graph database for the AI layer (decision 3).
