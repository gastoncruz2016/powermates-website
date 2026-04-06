# TenantScan Advisor — WOW Agent Roadmap

## Tier 1: Quick Wins (This Sprint)

- **Context-aware agent prompts** — Inject active tab + dashboard scores into every agent message so it knows what the user is looking at (e.g., "Security tab, RBAC score 42%, 17 admin role assignments")
- **Intermediate steps display** — Surface the agent's tool invocations (NL2SQL, NL2DAX, NL2KQL) as expandable "how I got this answer" cards under each reply
- **Structured remediation cards** — Parse agent responses for actionable items and render as interactive cards with severity badges, copy-to-PowerShell buttons, and "Mark as done" toggles

## Tier 2: Smart Advisor (2-4 Weeks)

- **Operations Agent integration** — Wire up a Fabric Operations Agent to watch tenant scan scores and proactively alert via Teams when governance scores drop below thresholds
- **Multi-source grounding** — Add a Lakehouse with raw scan history alongside the semantic model (Fabric agents support up to 5 data sources) for deep-dive trend analysis
- **What-if simulator** — "What would my score be if I fixed all High-severity findings?" Pre-compute client-side from DAX data, show before/after gauge, agent explains reasoning

## Tier 2.5: IQ Ontology Semantic Layer

- **Generate TenantScanGovernance ontology** — Auto-generate from existing Power BI semantic model, then refine entity types (TenantScanRun, Finding, Recommendation, Workspace, RoleAssignment) with proper business names, relationships, and key properties
- **Dual data bindings** — Bind ontology entities to both the semantic model (real-time) and Lakehouse (historical), giving the agent three query paths: GQL (graph traversals), DAX (scores), SQL (trends)
- **Condition-action rules** — Define alert thresholds (critical score, score drop, admin bloat, new critical finding, unassigned capacity) as ontology rules instead of hardcoded values — single source of truth for dashboard + Operations Agent
- **Ontology-grounded Data Agent** — Connect ontology as a data source to TenantScan-Advisor, add GQL query instructions, entity-aware context prefix, and graph-path reasoning in agent responses
- **Operations Agent rule binding** — Switch TenantScan-Watchdog from manual threshold config to ontology-driven condition-action rules via Activator

**Files:** `ontology-config.json` (entity schema), `ONTOLOGY-SETUP.md` (step-by-step Fabric setup)

## Tier 3: Actionable Agent (Ongoing Roadmap)

- **Fabric REST API actions** ✅ — "Fix this" buttons on remediation cards call Fabric Admin REST APIs (assign capacity, add/remove workspace users, downgrade roles). Confirmation modal with param review + warning before execution. MSAL token acquisition per action scope.
- **Copilot Studio + M365 integration** — Publish Data Agent to Copilot Studio, embed in Teams. Admins get governance insights in their flow of work via OBO auth
- **Azure Foundry multi-agent orchestration** — Governance Orchestrator coordinating TenantScan Data Agent (Q&A) + Operations Agent (monitoring) + Remediation Agent (Azure Functions + Fabric REST APIs)
- **Scheduled governance reports** — Operations Agent triggers weekly scan, Data Agent generates narrative summary, Power Automate emails PDF report to stakeholders

## The WOW Demo Moment

Open the dashboard → agent says "I noticed your RBAC score dropped 12 points since last scan — 3 new Admin role assignments were added to Workspace X. Want me to show who added them and draft a remediation plan?" → one click generates remediation actions with PowerShell scripts → optionally executes them.

That's the gap between a chatbot and a governance agent.
