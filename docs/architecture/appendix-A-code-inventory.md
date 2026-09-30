# پیوست A — فهرست کد فعلی و حکم هر بخش

> بخشی از [SIMORGH ERP — Enterprise Architecture v1.0](./SIMORGH-ERP-Enterprise-Architecture-v1.0.md)

**مخازن و نسخه‌های بررسی‌شده (۱۴۰۵/۰۷/۰۷):**

| مخزن | برنچ | commit |
|---|---|---|
| `shahram-tabasi/simorgh-chatbot-ekc-deploy` | `claude/nifty-keller-0t006m` | `1667e02` |
| `shahram-tabasi/SIMORGH-KARA` | `main` | `6fcfce0` |
| `shahram-tabasi/simorgh-ledger` | `main` | `448c435` |

**برچسب‌ها:**

| برچسب | معنی |
|---|---|
| **KEEP** | کد همان‌طور منتقل می‌شود (حداکثر جابه‌جایی مسیر و import) |
| **REFACTOR** | منطق حفظ می‌شود، ساختار یا لایهٔ ذخیره‌سازی عوض می‌شود |
| **MOVE** | MOVE TO ERP CORE: مفهوم/کد به هستهٔ عمومی می‌رود و دیگر مخصوص یک اپ نیست |
| **REPLACE** | کنار گذاشته می‌شود و معادل ERP جای آن را می‌گیرد |
| **DROP** | حذف بدون جایگزین (تکراری، نمونه، مرده) |

ستون «مقصد» مسیر در ساختار monorepo بخش ۲۱ است. اعداد، تعداد خطوط هستند.

---

## A.1 Simorgh Design Suite — فرانت‌اند (`simorgh-agent/simorgh-soft/simorgh-frontend/src`)

### پوسته و وضعیت

| فایل | خط | حکم | مقصد / توضیح |
|---|---:|---|---|
| `App.tsx` | 1774 | REFACTOR | پوسته و تب‌ها → routeهای `apps/web/app/[tenant]/eng/*`؛ منطق تب‌ها به `packages/design-suite` |
| `AppRouter.tsx` | 14 | REPLACE | App Router در Next.js |
| `index.tsx` | 8 | REPLACE | mount در صفحهٔ Next.js با `ssr:false` |
| `branding.ts`، `theme.css`، `useTheme.ts`، `fonts.css`، `index.css` | 35/—/82/—/— | REFACTOR | `packages/ui` (توکن‌های طراحی مشترک) |
| `global.d.ts` | 22 | KEEP | |
| `context/ProjectContext.tsx` | 1306 | REFACTOR | state مدیریت پروژه: به‌جای ذخیرهٔ کل `ProjectData`، از API ماژول `elec` با TanStack Query؛ `guardEdit()` حفظ شود |
| `context/PanelsContext.tsx` | 133 | KEEP | |
| `types/project.ts` | 500 | REFACTOR | مبنای Zod contracts در `packages/contracts/elec`؛ نگاشت به جداول `elec.*` (بخش ۷.۲) |

### سرویس‌ها

| فایل | خط | حکم | مقصد / توضیح |
|---|---:|---|---|
| `services/projectService.ts` | 870 | REPLACE | SDK تولیدشده از OpenAPI (`packages/sdk`) |
| `services/lockService.ts` | 102 | MOVE | کلاینت `core.edit_locks` |
| `services/documentsApi.ts` | 102 | MOVE | کلاینت `core.attachments` |
| `services/eplanApi.ts` | 131 | REFACTOR | کلاینت `integrations/eplan-bridge` |
| `services/plotframeFieldsApi.ts` | 31 | REFACTOR | تنظیمات tenant در ماژول `elec` |
| `services/tpmsSync.ts` | 440 | REFACTOR | کلاینت `integrations/tpms-connector`؛ منطق merge سه‌طرفه (baseline) حفظ شود |
| `services/chatbotTools.ts` | 1003 | REFACTOR | ابزارهای AI → MCP tools در `industry-packs/electrical/ai` |
| `services/intentParser.ts` | 427 | REFACTOR | به agent-runtime (Design Assistant) |

### Simorgh Draw

| فایل | خط | حکم | مقصد |
|---|---:|---|---|
| `components/SimorghDraw/DrawingEditor.tsx` | 3314 | KEEP | `packages/design-suite/draw` |
| `DrawingCanvas.tsx` | 1020 | KEEP | 〃 |
| `PageNavigator.tsx`، `PageMenu.tsx` | 816/172 | KEEP | 〃 |
| `SymbolLibrary.tsx`، `SymbolMaker.tsx`، `SymbolGraphicEditor.tsx` | 1067/648/572 | KEEP | 〃؛ ذخیره از طریق API `elec.symbol_library` |
| `DxfSymbolPack.tsx`، `IoListImport.tsx` | 256/262 | KEEP | 〃 |
| `DrawingReportsModal.tsx`، `DrawingHelp.tsx`، `SheetEditorWindow.tsx`، `TemplateGraphicEditor.tsx` | 133/92/78/89 | KEEP | 〃 |
| `lang.ts` | 1304 | REFACTOR | `packages/i18n` (fa/en/tr) با همان قرارداد type-safe |
| `overlayHost.ts`، `theme.ts`، `drawing.css` | 49/103/— | KEEP | |

### PLC و Logic

| فایل | خط | حکم | مقصد |
|---|---:|---|---|
| `components/PLC/*` (LadderEditor 1656، PlcTab 763، CodeEditor 506، PlcAssistant 507، PlcProjectTree 460، InterfaceTable 408، TagTable 358، InstructionCatalog 350، NewBlockDialog 345، usePlc 81، monacoSetup 189) | ~5600 | KEEP | `packages/design-suite/plc`؛ `PlcAssistant` از ai-gateway |
| `components/PLC/lang.ts` | 735 | REFACTOR | `packages/i18n` |
| `components/SimorghLogic/LogicWorkspace.tsx`، `LadderAsk.tsx` | 392/354 | KEEP | 〃 |
| `utils/plc/*` (instructions 1757، analyze 671، model 624، aiContext 497، ladderEdit 491، sclExport 435، sclLanguage 313، dataTypes 237، checkLang 217) | ~5240 | KEEP | `packages/plc-engine` + تست واحد |
| `utils/ladder/*` (render 494، dialects 336، model 300) | 1130 | KEEP | `packages/plc-engine/ladder` |

### Template، Device، Project

| فایل | خط | حکم | مقصد / توضیح |
|---|---:|---|---|
| `components/TemplateCreation/TemplateProperties.tsx` | 1332 | REFACTOR | UI می‌ماند؛ داده از `elec.templates`/`template_parts`؛ انتخاب قطعه از `core.items` |
| `HierarchicalTemplateWizard.tsx`، `TemplateTree.tsx` | 859/812 | KEEP | |
| `TemplateCreationTab.tsx`، `MechanicalQuestions.tsx`، `PartCell.tsx`، `PartSchematicPanel.tsx` | 331/260/191/251 | KEEP | |
| `components/DeviceSelection/DeviceSelectionTab.tsx` | 3797 | REFACTOR | بزرگ‌ترین فایل؛ تفکیک به جدول + منطق import/duplicate؛ داده از `elec.device_lines` |
| `DeviceTable.tsx`، `FeederDuplicateModal.tsx`، `DeviceList.tsx` | 356/189/35 | KEEP | قاعدهٔ «شمارهٔ فیدر یکتا نیست» حفظ و تست شود |
| `components/ProjectDefinition/ProjectDefinitionTab.tsx` | 1291 | REFACTOR | اطلاعات پایهٔ پروژه → فرم `prj.projects` (Core)؛ تنظیمات فنی → `elec.tech_settings` |
| `components/ProjectSelection/ProjectSelection.tsx` | 742 | REPLACE | لیست پروژه‌های ERP (`/[tenant]/prj`) |
| `ProjectSelection/SkyIntro.tsx`، `SplashScreen/SplashScreen.tsx`، `shared/ShineEffects.tsx`، `shared/SimorghMark.tsx` | 378/194/212/29 | KEEP | برندینگ در `packages/ui` |
| `components/OutputTypes/OutputTypesTab.tsx` | 1367 | MOVE | `core.print_templates` (Document Engine) + قالب‌های Electrical |
| `components/Documents/DocumentsTab.tsx`، `DocumentViewer.tsx` | 222/305 | MOVE | UI عمومی پیوست/Annotation در `packages/ui` |
| `components/Eplanix/EplanixTab.tsx` | 738 | KEEP | ورود به Simorgh Draw |
| `components/SendToEplan/SendToEplanTab.tsx`، `CreatingProjectSlideshow.tsx` | 959/278 | REFACTOR | از طریق `integrations/eplan-bridge` |
| `components/TpmsImport/TpmsImportModal.tsx` | 327 | REFACTOR | با `tpms-connector` |
| `components/Chatbot/Chatbot.tsx`، `MarkdownView.tsx` | 970/235 | REPLACE | پنل Simorgh AI سراسری در `apps/web` |
| `components/Chatbot/ProposalCard.tsx` | 154 | MOVE | الگوی عمومی `ai.proposals` در `packages/ui` |
| `components/shared/ProjectHistoryModal.tsx`، `RevisionLockedModal.tsx` | 220/98 | MOVE | UI عمومی Revision/Lock |
| `components/shared/AppDialog.tsx`، `PanelFrame.tsx`، `MenuBox.tsx`، `CascadeDeleteModal.tsx`، `PartSelectionDialog.tsx` | 271/161/47/112/336 | KEEP | `PartSelectionDialog` به `core.items` وصل شود |
| `components/Tabs/TabNavigation.tsx` | 145 | REPLACE | ناوبری Next.js |

### موتور CAD (`utils/cad`)

| فایل‌ها | خط | حکم | مقصد |
|---|---:|---|---|
| `geom.ts` 957، `readDxf.ts` 482، `fromSvg.ts` 426، `dxf.ts` 395، `pages.ts` 393، `schematic.ts` 386، `header.ts` 377، `symbolSource.ts` 377، `terminals.ts` 371، `edit.ts` 331، `symbolFrame.ts` 306، `drawingReports.ts` 301، `ioPages.ts` 279، `shapes.ts` 274، `annotate.ts` 246، `pdf.ts` 227، `dxfSymbols.ts` 199، `connect.ts` 174، `replaceSymbol.ts` 163، `svg.ts` 150، `table.ts` 146، `symbolLibraries.ts` 112، `officeSymbols.ts` 101، `paper.ts` 87، `useSymbols.ts` 81، `symbolArt.ts` 79، `projectSymbols.ts` 33، `sheetDxf.ts` 30 | ~7500 | KEEP | `packages/cad-engine` (مستقل از React به‌جز `useSymbols.ts` که به `design-suite` می‌رود) |
| `wdSymbols.ts` | 488 | KEEP | `industry-packs/electrical/symbols` |

### منطق دامنهٔ برق (`utils/*`)

| فایل | خط | حکم | مقصد / توضیح |
|---|---:|---|---|
| `eplanSingleLine.ts` | 1342 | KEEP | `industry-packs/electrical/engine/sld` |
| `iecSymbols.ts` | 913 | KEEP | `…/electrical/symbols` |
| `mechanicalReport.ts`، `mechanicalItems.ts` | 953/162 | KEEP | `…/electrical/engine/mechanical`؛ `mechanicalItems` = ورودی MBOM مکانیکال |
| `utils/mechanical/*` (catalog 215، index 202، simoprimeA4 239، ek36 180، parts 139، template 117) | 1092 | KEEP | 〃 |
| `utils/outline/*` (index 319، rules 283، parts 158، simoprimeWorld 143، poleCenter 110، simoprimeA4 56) | 1069 | KEEP | `…/engine/outline` |
| `panelLayout.ts` | 269 | KEEP | `…/engine/layout` |
| `eplanDataExport.ts` | 598 | KEEP | `integrations/eplan-bridge` (قالب داده) |
| `bpmsExport.ts` | 463 | KEEP | قالب چاپ Electrical (`print/`) |
| `deviceImport.ts`، `simarisImport.ts` | 499/178 | REFACTOR | روی Import Framework عمومی Document Engine |
| `tpmsImport.ts`، `tpmsProjectImport.ts` | 523/281 | REFACTOR | `integrations/tpms-connector` (ترجمه به قالب ERP) |
| `revisionDiff.ts`، `projectMerge.ts` | 364/132 | MOVE | Document Engine (`core.document_revisions`) |
| `cascadeDelete.ts` | 134 | REFACTOR | در سرویس `elec` (سمت سرور) |
| `tiers.ts`، `tierEquipmentMatrix.ts`، `templateFamilies.ts`، `templateMeta.ts`، `deviceCodes.ts`، `deviceProperties.ts`، `feederDuplicates.ts`، `ioList.ts` | 80/189/124/52/64/88/68/244 | KEEP | `…/electrical/domain` |
| `download.ts`، `fileHandleStore.ts`، `buildStamp.ts` | 29/77/37 | KEEP | `packages/ui/utils` |

### سایر فایل‌های فرانت

| مسیر | حکم | توضیح |
|---|---|---|
| `simorgh-frontend/server/` (`server.js`، `ProjectService.js`، `models/Project.js`) | DROP | سرور mongoose تکراری و قدیمی کنار backend اصلی |
| `public/fonts`، `public/intro`، `public/videos`، `src/assets` | KEEP | `apps/web/public` |
| `vite.config.ts`، `tailwind.config.js`، `postcss.config.js`، `tsconfig*.json` | REPLACE | پیکربندی monorepo |
| `docs/`، `scripts/` | KEEP | `docs/domain/electrical` |

---

## A.2 Simorgh Design Suite — بک‌اند (`simorgh-soft/simorgh-backend`)

| فایل | خط | حکم | مقصد / توضیح |
|---|---:|---|---|
| `server.js` | 1897 | REPLACE | routeهای projects/revisions/parts/selected-parts → ماژول NestJS `elec` + `core`؛ بدون auth بودن برطرف می‌شود |
| `tpmsImport.js` | 989 | REFACTOR | `integrations/tpms-connector` (کوئری‌های MySQL فقط‌خواندنی حفظ شوند) |
| `drawAssist.js` | 741 | REFACTOR | ابزار AI در `…/electrical/ai` از طریق ai-gateway |
| `chatModel.js` | 437 | REPLACE | ai-gateway |
| `server-example.js` | 432 | DROP | نمونه |
| `eplanSend.js` | 399 | REFACTOR | `integrations/eplan-bridge` |
| `eplanSymbols.js` | 344 | REFACTOR | `elec.symbol_library` + bridge |
| `ladderAssist.js`، `plcAssist.js` | 247/238 | REFACTOR | ابزار AI |
| `symbolLibrary.js` | 231 | REFACTOR | ماژول `elec` (Postgres) |
| `localDesktop.js` | 227 | REFACTOR | `apps/desktop` (حالت محلی Electron) |
| `documents.js` | 208 | MOVE | `core.attachments` + S3 (SeaweedFS) |
| `projectHistory.js` | 187 | MOVE | Document Engine / Audit |
| `partsAccess.js` | 141 | REFACTOR | `integrations/eplan-bridge` → همگام‌سازی به `core.items` |
| `projectLocks.js` | 131 | MOVE | `core.edit_locks` |
| `plotframeFields.js` | 61 | REFACTOR | تنظیمات `elec` |
| `desktopDownload.js` | 51 | KEEP | انتشار نسخهٔ Desktop |
| `projectNames.js` | 40 | REPLACE | جستجوی پروژه ERP |
| `dbTimeout.js`، `pdfText.js` | 28/25 | KEEP | ابزار |
| `tpmsDoctor.cjs`، `tpmsConnCheck.sh` | 237/93 | KEEP | ابزار عیب‌یابی `tpms-connector` |
| `eplan-symbols/`، `downloads/` | KEEP | دارایی |
| `mongo/` (Dockerfile، backup.sh) | REPLACE | پشتیبان‌گیری Postgres/S3 |
| `desktop/` (Electron: main، preload، installer NSIS) | KEEP | `apps/desktop` |
| `docs/*.pdf`، `DATA-SAFETY.md`، `EPLAN_SEND.md`، `TPMS_IMPORT.md`، `TPMS_MTU.md` | KEEP | `docs/domain/electrical` |
| `.claude/skills/simorgh-soft/SKILL.md` | KEEP | `.claude/skills/design-suite` + تبدیل قواعد به تست |

---

## A.3 پلتفرم AI و چت (`simorgh-agent/*`)

> ~۴۳۴٬۶۰۰ خط Python که فقط ~۱۳۸٬۵۰۰ خط آن یکتاست. حکم در سطح سرویس داده شده،
> چون فایل‌های داخلی بیشتر سرویس‌ها کپی `backend/services/*` هستند (مثلاً
> `cot_engine.py`، `neo4j_service.py` و `project_agent.py` هرکدام ۹ نسخه دارند).
> قاعدهٔ مهاجرت: **فقط نسخهٔ `backend/` (یا جدیدترین نسخه) منبع است، بقیهٔ کپی‌ها DROP.**

| سرویس | خط (با کپی‌ها) | حکم | مقصد |
|---|---:|---|---|
| `backend` | 59397 | REFACTOR | منبع کد یکتا؛ ماژول‌ها بین `agent-runtime`، `knowledge` و `simorgh_py` تقسیم می‌شوند |
| `backend/services/*auth*`، `oauth_service.py`، `session_*`، `postgres_auth_service.py` | — | MOVE | Identity هستهٔ ERP (NestJS)؛ اسکیمای `001_create_auth_tables.sql` مبنای `core.users` و … |
| `backend/services/tpms_*`، `sql_auth_service.py` | — | REFACTOR | `integrations/tpms-connector`، SSO/LDAP |
| `backend/services/payment_service.py`، `user_tier_service.py` | — | REPLACE | Subscription/Billing پلتفرم |
| `backend/database/migrations/003…009` (projects، project_*، soft_spec_*) | — | REFACTOR | `ai.*` (conversations، proposals)؛ `projects` → `prj.projects` |
| `chat-service` | 54318 | REFACTOR | `services/agent-runtime` (فقط کد یکتا: `hr_chat.py`، `general_chat_cache.py`، `container_mirror.py`، routeها) |
| `project-agent-service` | 62669 | REFACTOR | `agent-runtime` |
| `specification-agent-service` | 39031 | REFACTOR | `agent-runtime` (Spec Agent؛ Electrical Pack) |
| `graph-rag-service` | 38534 | REFACTOR | `services/knowledge` |
| `documents-rag-service` | 43313 | REFACTOR | `services/knowledge` |
| `context-search-service` | 1741 | REFACTOR | `services/knowledge` (hybrid BM25+kNN) |
| `embeddings-service`، `tei`، `doc-processor`، `docling`، `grounding-verifier` | 75/0/652/0/151 | REFACTOR | `services/knowledge` |
| `llm-gateway` (+ `harmony.py`، `live_settings.py`)، `litellm` | 3350 | KEEP | `services/ai-gateway` |
| `admin-service` | 42599 | MOVE | users/features/settings/audit → Kernel ERP؛ `db_shell.py` (اجرای SQL/Redis/Qdrant دلخواه از HTTP) DROP |
| `auth-service` | 6135 | MOVE | Identity ERP |
| `payments-service` | 38455 | REPLACE | کپی backend + یک router؛ Billing پلتفرم |
| `tier-quota-service` | 38394 | REPLACE | `core.plans`/`usage_counters` |
| `hr-kb-service` | 2289 | REFACTOR | ابزار دانش HCM در `knowledge` |
| `org-data-service` | 188 | REPLACE | داده‌های HR از ماژول HCM ERP (دیگر نیازی به MySQL جدا نیست) |
| `tpms-fetcher-service`، `tpms-context-agent` | 889/206 | REFACTOR | `integrations/tpms-connector` + ابزار MCP |
| `eplan-sql-service`، `eplan-bridge-service`، `eplan-port-forwarder` | 207/472/177 | REFACTOR | `integrations/eplan-bridge` |
| `runtime-broker` | 1064 | KEEP | sandbox اجرای کد برای Agent |
| `gitlab-mcp-service`، `techserver-mcp-service` | 528/893 | KEEP | ابزار MCP (دورهٔ گذار) |
| `mail-bridge` | 268 | KEEP | `integrations/mail` (ایمیل ورودی به سند/کارتابل) |
| `stt-service`، `tts-service`، `whisper`، `tts` | 399/354/0/0 | KEEP | `services/ai-gateway` (voice) |
| `file-export-service` | 483 | MOVE | موتور خروجی Document Engine |
| `search-service`، `searxng` | 289/0 | KEEP | ابزار جستجوی وب Agent |
| `chat-history-mcp-service`، `command-gen-service`، `project-analysis-service`، `project-explorer-service`، `project-init-service` | 393/357/289/335/1126 | REFACTOR | ابزارهای `agent-runtime` |
| `shared/simorgh_logging`، `simorgh_clients`، `simorgh_rank_fusion`، `simorgh_graph`، `simorgh_artifacts` | 1676 | KEEP | `services/simorgh_py` |
| `frontend` (چت؛ React + Vite) | 25834 | REFACTOR | پنل Simorgh AI در `apps/web` (کامپوننت‌های Markdown/Chat) |
| `compose/*`، `docker-compose*.yml` | — | REFACTOR | `infra/compose` (با تعداد سرویس بسیار کمتر) |
| `elk/`، `nginx_configs/` | — | KEEP | `infra/observability`، `infra/compose/nginx` |
| `docs/`، `MIGRATION_2026_05.md` | — | KEEP | `docs/` |
| `llms/` (ریشه)، `vagrant/eplan-vms`، `host-nginx-config` | — | KEEP | `infra/` |
| `Human Capital/`، `knowledge/` | — | KEEP | دادهٔ دانش `knowledge` (نه کد) |

---

## A.4 SIMORGH-KARA

### کتابخانه (`src/lib`)

| فایل | خط | حکم | مقصد / توضیح |
|---|---:|---|---|
| `sql.ts` | 402 | REPLACE | DDL schema-per-tenant → migrationهای Drizzle با RLS (`packages/db`)؛ جداول حضور/مرخصی به `hcm.*` |
| `db.ts` | 70 | REFACTOR | الگوی `withTenant` + `SET LOCAL` حفظ، ولی `app.tenant_id` به‌جای `search_path` |
| `provision.ts` | 181 | MOVE | provisioning tenant در Kernel (ساخت legal entity، نقش‌های پیش‌فرض، سری شماره) |
| `rbac.ts` | 65 | MOVE | کاتالوگ مجوز + `definePermissions` + scope |
| `auth.ts`، `session.ts`، `password.ts` | 61/109/15 | MOVE | Identity (jose حفظ؛ bcrypt → argon2id با rehash هنگام ورود) |
| `device-auth.ts` | 22 | MOVE | `core.api_clients` |
| `jalali.ts` | 197 | KEEP | `packages/jalali` |
| `iran-holidays.ts`، `iran-events.ts`، `online-holidays.ts`، `holiday-sync.ts` | 127/67/68/68 | KEEP | `packages/jalali` + job در worker |
| `ics.ts` | 69 | KEEP | `packages/ui` / Kernel notifications |
| `attendance.ts`، `face.ts` | 162/51 | KEEP | ماژول `hcm` (سمت سرور) |
| `leave-types.ts`، `leave-balance.ts` | 220/204 | KEEP | ماژول `hcm` (قانون کار ایران) |
| `ai.ts` | 35 | REPLACE | ai-gateway |
| `utils.ts` | 23 | KEEP | |

### صفحات و Actionها (`src/app`)

| مسیر | خط | حکم | مقصد |
|---|---:|---|---|
| `admin/*` (companies، holdings، actions) | ~594 | MOVE | کنسول پلتفرم (`apps/web/(platform)/admin`) روی API Kernel |
| `holding/*` | ~267 | MOVE | مدیریت Legal Entityها در tenant |
| `c/[slug]/*`، `login/*`، `logout/*` | ~463 | MOVE | صفحات ورود ERP |
| `app/[slug]/actions.ts` | 647 | REFACTOR | منطق به use caseهای NestJS (`org`، `workflow`)؛ Server Action فقط فراخوانی API |
| `app/[slug]/members/*`، `roles/*`، `groups/*` | ~1017 | MOVE | صفحات Org/RBAC هسته |
| `app/[slug]/kartabl/*` | ~633 | MOVE | کارتابل عمومی (`core.wf_tasks`) |
| `app/[slug]/tasks/*` | ~840 | MOVE | میز کار (`core.tasks`) |
| `app/[slug]/notifications/feed`، `reminders/feed` | 81 | MOVE | Kernel notifications (SSE) |
| `app/[slug]/calendar/*` | ~1191 | MOVE | `core.calendars` + UI |
| `app/[slug]/attendance/*`، `api/[slug]/attendance/*` | ~2190 | REFACTOR | ماژول `hcm` (API در NestJS؛ endpoint ingest برای device-bridge) |
| `app/[slug]/leave/*` | ~2194 | REFACTOR | `hcm` + گردش تأیید روی Workflow Engine |
| `app/[slug]/ledger/page.tsx` | 68 | REPLACE | ماژول Finance |
| `app/[slug]/profile/*` | 271 | MOVE | پروفایل کاربر |
| `app/[slug]/page.tsx`، `layout.tsx`، `app/layout.tsx`، `globals.css` | ~510 | REFACTOR | پوستهٔ `apps/web` (منوی گروه‌بندی‌شده، داشبورد) |
| `api/cron/holidays` | 58 | REFACTOR | job در `apps/worker` |
| `components/*` (Shell، SideNav، NotificationBell، ReminderWatcher، ThemeToggle، ToggleForm) | — | REFACTOR | `packages/ui` |

### سایر

| مسیر | حکم | مقصد |
|---|---|---|
| `apps/device-bridge` (Node) | KEEP | `integrations/device-bridge` |
| `apps/guard`، `apps/mine-attendance` (Flutter) | KEEP | `apps/mobile-attendance` |
| `scripts/migrate.ts`، `reset.ts`، `seed.ts`، `demo.ts` | REPLACE | `tools/migrate-kara` (انتقال داده از هر `tenant_<slug>`) + seed جدید |
| `data/holidays.json` | KEEP | `packages/jalali/data` |
| `ROADMAP.md`، `DEVICE_INTEGRATION.md`، `docs/guide` | KEEP | `docs/modules/hcm` |
| `docker-compose.yml`، `next.config.js`، `tailwind.config.ts` | REPLACE | پیکربندی monorepo |

---

## A.5 simorgh-ledger

| مسیر | خط | حکم | توضیح |
|---|---:|---|---|
| `src/*.tsx` (App 2031، Attendance 1321، Accounting 1105، Fund 612، Inventory 559، Tools 542، …) | ~7760 | REPLACE | اپ کلاینت محلی بدون سرور چندکاربره؛ ماژول‌های معادل در ERP ساخته می‌شوند |
| `src/barcode.ts`، `Scanner.tsx`، `BarcodeView.tsx` | — | REFACTOR (ایده) | مرجع تجربهٔ اسکن در `apps/mobile-warehouse` |
| `electron/`، `android/`، `capacitor.config.json` | — | DROP | Desktop/Mobile ERP از `apps/desktop` و Flutter |

---

## A.6 جمع‌بندی عددی

| مخزن | حجم تقریبی | KEEP | REFACTOR | MOVE | REPLACE/DROP |
|---|---:|---|---|---|---|
| Design Suite (فرانت + بک) | ~۷۶k خط | موتور CAD، PLC، Draw، منطق برق (~۶۰٪) | Template/Device/Project، TPMS، EPLAN، AI assist (~۲۵٪) | Revision، Lock، Documents، Output، Proposal (~۵٪) | Express/Mongo server، چت، ناوبری (~۱۰٪) |
| پلتفرم AI | ~۱۳۹k خط یکتا (۴۳۵k با کپی) | gateway، runtime-broker، ابزارهای MCP، shared | agent/knowledge (تجمیع) | auth، admin، export | payments، tier-quota، ~۲۹۶k خط کپی |
| Kara | ~۱۴k خط | jalali، holidays، hcm، device/flutter | db، actions، attendance/leave | tenant، RBAC، kartabl، tasks، calendar، auth | sql.ts، ledger، ai.ts |
| simorgh-ledger | ~۸k خط | — | ایدهٔ بارکد | — | تمام |
