# TenantScan Governance Ontology — Setup Guide

## Overview

The TenantScan Governance Ontology adds a semantic graph layer on top of your existing tenant scan data. It defines entity types (TenantScanRun, Finding, Recommendation, Workspace, RoleAssignment), their relationships, and condition-action rules — giving both the Data Agent and Operations Agent a governed business vocabulary instead of raw table/column references.

**What this unlocks:**
- **Graph reasoning** — Agent traverses relationships (Workspace → Roles → Findings → Recommendations) instead of complex joins
- **Governed vocabulary** — Entity names, properties, and relationships are typed and constrained
- **Shared rules** — Alert thresholds defined once in the ontology, consumed by both client-side monitoring and Operations Agent
- **GQL queries** — Agent can query the ontology via GraphQL-like syntax for cross-domain questions

## Prerequisites

- Microsoft Fabric workspace with your TenantScan semantic model already deployed
- Lakehouse with `tenant_scan_runs`, `tenant_scan_findings`, `tenant_scan_roles`, `tenant_scan_workspaces` tables (for historical data)
- Data Agent (`TenantScan-Advisor`) already configured per the main setup
- Fabric IQ workload enabled in your tenant (preview)

## Step 1: Generate Ontology from Semantic Model

The fastest path — auto-generate from what you already have.

1. Go to your Fabric workspace
2. Click **New** → **Ontology** (under the IQ section)
3. Select **Generate from semantic model**
4. Choose your TenantScan semantic model
5. Fabric will scaffold entity types from your tables, properties from columns, and relationships from model relationships
6. Name it `TenantScanGovernance`

### What gets auto-generated:
- Entity types for each table: `tenant_scan_runs` → TenantScanRun, `tenant_scan_findings` → Finding, etc.
- Properties from columns with inferred types (String, Int32, DateTime, etc.)
- Relationships from existing Power BI model relationships

### What you'll need to refine:
- Rename auto-generated entity types to clean business names (see `ontology-config.json` for the target schema)
- Add missing relationship labels (e.g., "produces", "affects", "resolvedBy")
- Set key properties for each entity type
- Add `description` fields for agent context

## Step 2: Extend with Lakehouse Bindings

For historical trend analysis, bind alternate data sources:

1. In the ontology editor, select each entity type
2. Under **Data Binding**, add an alternate source pointing to the Lakehouse table
3. This gives the Data Agent dual-path access:
   - Semantic model → real-time scores and current scan
   - Lakehouse → full scan history for trend/comparison queries

**Entity → Table mapping:**

| Entity Type      | Semantic Model Table        | Lakehouse Table              |
|------------------|-----------------------------|------------------------------|
| TenantScanRun    | tenant_scan_runs            | tenant_scan_runs             |
| Finding          | tenant_scan_findings        | tenant_scan_findings         |
| Recommendation   | tenant_scan_recommendations | —                            |
| Workspace        | tenant_scan_workspaces      | tenant_scan_workspaces       |
| RoleAssignment   | tenant_scan_roles           | tenant_scan_roles            |

## Step 3: Define Condition-Action Rules

These rules power the Operations Agent (TenantScan-Watchdog) and align with the client-side `ALERT_THRESHOLDS` in `app.js`.

In the ontology editor, go to the **Rules** tab and create:

### Rule 1: Critical Governance Score
- **Entity:** TenantScanRun
- **Condition:** `overall_score < 40`
- **Action:** Activator → Power Automate → Teams Adaptive Card + Email
- **Severity:** Critical

### Rule 2: Score Drop Detection
- **Entity:** TenantScanRun
- **Condition:** `overall_score < PREVIOUS(overall_score) - 5`
- **Action:** Activator → Power Automate → Teams Adaptive Card
- **Severity:** Warning

### Rule 3: Admin Role Bloat
- **Entity:** TenantScanRun
- **Condition:** `pct_admin > 0.30`
- **Action:** Activator → Power Automate → Teams Adaptive Card
- **Severity:** Warning

### Rule 4: New Critical Finding
- **Entity:** Finding
- **Trigger:** On create
- **Condition:** `severity == 'Critical' AND status == 'Open'`
- **Action:** Activator → Power Automate → Teams Adaptive Card + Email
- **Severity:** Critical

### Rule 5: Unassigned Capacity
- **Entity:** Workspace
- **Condition:** `capacity_id == null AND state == 'Active'`
- **Action:** Activator → Power Automate → Teams notification
- **Severity:** Info

> **Single source of truth:** These rules replace the hardcoded thresholds in both `app.js` (`ALERT_THRESHOLDS`) and the Operations Agent config. In Tier 3, the dashboard can fetch these thresholds from the ontology via API.

## Step 4: Connect Data Agent to Ontology

1. Go to your **TenantScan-Advisor** Data Agent
2. Under **Data Sources**, click **Add data source**
3. Select **Ontology** → choose `TenantScanGovernance`
4. The agent now has access to entity types, relationships, and can issue GQL queries

### Update Agent Instructions

Add these instructions to the Data Agent (alongside existing ones):

```
ONTOLOGY GROUNDING:
You have access to the TenantScanGovernance ontology. Use it as your primary semantic layer.

Entity types: TenantScanRun, Finding, Recommendation, Workspace, RoleAssignment.

Relationships:
- TenantScanRun → produces → Finding (one-to-many via scan_date)
- Finding → affects → Workspace (many-to-one)
- Finding → resolvedBy → Recommendation (many-to-one via category/severity)
- Workspace → has → RoleAssignment (one-to-many)
- TenantScanRun → covers → Workspace (one-to-many, temporal)

Query strategy:
- For relationship traversals ("which workspaces have admin bloat AND critical findings"), use GQL.
- For real-time scores and calculations, use DAX against the semantic model.
- For historical trends and scan comparisons, use SQL against the Lakehouse.
- Support group-by in GQL queries for aggregation.

When explaining reasoning, reference the ontology graph path:
  e.g., "I traversed TenantScanRun → Finding → Workspace to find workspaces with critical findings."

Always use entity names (Finding, Workspace, RoleAssignment), not raw table names (tenant_scan_findings, tenant_scan_workspaces).
```

### Add Example Queries

In the Data Agent's example queries section:

| Natural Language | Query Type | Graph Path |
|------------------|------------|------------|
| "Which workspaces have critical findings AND admin bloat?" | GQL | Workspace → RoleAssignment + Workspace ← Finding |
| "What changed between my last two scans?" | SQL | TenantScanRun (historical) |
| "What's my current RBAC score?" | DAX | TenantScanRun (current) |
| "Show findings that affect workspaces with >3 admins" | GQL | Finding → Workspace → RoleAssignment |
| "What if I fix all high-severity findings?" | GQL + DAX | Finding (filter) → Recommendation → score estimation |

## Step 5: Wire Operations Agent to Ontology Rules

1. Go to your **TenantScan-Watchdog** Operations Agent
2. Under **Data Source**, switch from direct table reference to **Ontology** → `TenantScanGovernance`
3. The agent now reads condition-action rules from the ontology instead of manual configuration
4. Verify the Activator connection routes to the existing Power Automate flow

## Step 6: Verify End-to-End

1. **Ontology explorer:** Open the ontology in the Fabric portal. Verify all 5 entity types, 5 relationships, and 5 rules are defined
2. **Data Agent test:** Ask "Which workspaces have critical findings?" — the agent should reference the ontology graph in its reasoning
3. **GQL test:** Ask "Show me the relationship between workspace X and its role assignments" — agent should use GQL
4. **Operations Agent test:** Trigger a score drop (or simulate one) and verify the rule fires through Activator
5. **Dashboard test:** Open the TenantScan dashboard, verify the agent chat still works with the enriched context prefix

## Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│                 TenantScan Dashboard                 │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Score Viz │  │ Findings │  │  Agent Chat (JS) │  │
│  └─────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│        │              │                 │            │
│        └──────────────┼─────────────────┘            │
│                       │ DAX + Context Prefix         │
└───────────────────────┼──────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │   Fabric Data Agent        │
          │   (TenantScan-Advisor)     │
          │                            │
          │  ┌──────────────────────┐  │
          │  │  Ontology (GQL)      │──┼──→ Entity graph reasoning
          │  ├──────────────────────┤  │
          │  │  Semantic Model (DAX)│──┼──→ Real-time scores
          │  ├──────────────────────┤  │
          │  │  Lakehouse (SQL)     │──┼──→ Historical trends
          │  └──────────────────────┘  │
          └────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │   Fabric IQ Ontology       │
          │   (TenantScanGovernance)   │
          │                            │
          │  Entity Types ──► Rules    │
          │       │              │     │
          │  Relationships    Activator│
          │       │              │     │
          │  Data Bindings       │     │
          └──────────────────────┼─────┘
                                 │
          ┌──────────────────────▼─────┐
          │   Operations Agent         │
          │   (TenantScan-Watchdog)    │
          │                            │
          │  Monitors ontology rules   │
          │  → Activator → PA → Teams  │
          └────────────────────────────┘
```

## File Reference

| File | Purpose |
|------|---------|
| `ontology-config.json` | Full entity/relationship/rule definitions (reference schema) |
| `app.js` | Dashboard with ontology-aware context prefix and entity-based suggestions |
| `AGENT-ROADMAP.md` | Tier 2.5 ontology layer in the roadmap |
| `OPERATIONS-AGENT-SETUP.md` | Operations Agent wiring with ontology rules |
