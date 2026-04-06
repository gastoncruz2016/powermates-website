# TenantScan Operations Agent — Setup Guide

## Overview

The TenantScan dashboard includes client-side score monitoring that detects:
- Score drops of 5+ points between sessions
- Overall score falling below 40 (critical)
- Admin role % exceeding 30%

To complete the full Operations Agent loop with Teams alerts and automated responses, follow these steps in the Fabric portal.

## Step 1: Create an Operations Agent in Fabric

1. Go to your Fabric workspace → **New** → **Operations Agent**
2. Name it `TenantScan-Watchdog`
3. Configure the data source: point it at the `tenant_scan_runs` table in your Lakehouse or the semantic model
4. Set monitoring rules:
   - **Score drop rule**: `IF [Overall Score] < [Previous Overall Score] - 5 THEN alert`
   - **Critical score rule**: `IF [Overall Score] < 40 THEN escalate`
   - **Admin % rule**: `IF [% Admin Roles] > 0.30 THEN warn`

## Step 2: Connect to Activator

1. In the Operations Agent settings, add an **Activator** trigger
2. Configure the Activator to fire when any rule is matched
3. Set the evaluation frequency (recommended: every time a new scan completes)

## Step 3: Power Automate Flow for Teams Alerts

Create a Power Automate flow triggered by the Activator:

**Flow: TenantScan-ScoreDrop-Alert**
- Trigger: When Activator fires (score drop or critical)
- Action 1: Post adaptive card to Teams channel
  - Channel: your governance/admin channel
  - Card template:
    ```json
    {
      "type": "AdaptiveCard",
      "body": [
        { "type": "TextBlock", "text": "⚠️ Governance Score Alert", "weight": "Bolder", "size": "Medium" },
        { "type": "FactSet", "facts": [
          { "title": "Current Score", "value": "@{triggerBody()?['OverallScore']}" },
          { "title": "Previous Score", "value": "@{triggerBody()?['PreviousScore']}" },
          { "title": "Drop", "value": "@{triggerBody()?['ScoreDelta']} points" }
        ]},
        { "type": "TextBlock", "text": "Open the TenantScan Dashboard to investigate." }
      ],
      "actions": [
        { "type": "Action.OpenUrl", "title": "Open Dashboard", "url": "https://your-site/tenant-scan-dashboard/" }
      ]
    }
    ```
- Action 2 (optional): Send email to tenant admins

## Step 4: Multi-Source Grounding

To give the Data Agent access to deeper historical data:

1. Go to your existing **Data Agent** in the Fabric workspace
2. Under **Data Sources**, add a second source:
   - Type: **Lakehouse**
   - Select tables: `tenant_scan_runs`, `tenant_scan_findings`, `tenant_scan_roles`
3. Update the **Data Agent Instructions** to include:

```
When answering questions about trends, historical changes, or "what changed", prefer querying the Lakehouse tables which contain full scan history.

When answering questions about current scores, sub-scores, or dashboard metrics, prefer the Power BI semantic model.

The Lakehouse tables contain:
- tenant_scan_runs: scan_date, overall_score, sub_scores (one row per scan)
- tenant_scan_findings: title, category, severity, detail, scan_date (findings per scan)
- tenant_scan_roles: workspace_name, role, principal_id, principal_type (RBAC data per scan)

Use SQL for Lakehouse queries and DAX for semantic model queries.
```

4. Add example queries for the Lakehouse source:
   - "What findings were resolved between the last two scans?" → SQL comparing findings by scan_date
   - "Show me the score trend over the last 30 days" → SQL aggregating tenant_scan_runs

## Step 5: Verify Integration

1. Run a tenant scan
2. Check that the Operations Agent detects the new data
3. Verify Teams alert fires if score changed
4. In the dashboard, ask the Data Agent: "Compare my last two scans" — it should now query the Lakehouse for historical comparison

## Step 6: Bind to IQ Ontology (Tier 2.5)

Once the `TenantScanGovernance` ontology is deployed (see `ONTOLOGY-SETUP.md`), switch the Operations Agent from manual threshold config to ontology-driven rules:

1. Go to your **TenantScan-Watchdog** Operations Agent
2. Under **Data Source**, change from direct table reference to **Ontology** → `TenantScanGovernance`
3. The agent now reads condition-action rules from the ontology:
   - `critical_score_alert` — overall_score < 40 → Critical → Teams + Email
   - `score_drop_alert` — score dropped 5+ points → Warning → Teams
   - `admin_role_bloat` — pct_admin > 30% → Warning → Teams
   - `new_critical_finding` — new Critical finding created → Critical → Teams + Email
   - `unassigned_capacity_warning` — active workspace without capacity → Info → Teams
4. Remove any manually configured rules that are now defined in the ontology
5. Verify the Activator connection still routes to the existing Power Automate flow

**Benefits of ontology-driven rules:**
- Single source of truth — thresholds defined once, consumed by Operations Agent + dashboard
- Auditable — rule changes tracked in the ontology version history
- Extensible — add new rules (e.g., "stale workspace not accessed in 90 days") without touching agent config
- In Tier 3, the dashboard `ALERT_THRESHOLDS` config can fetch these from the ontology API instead of being hardcoded in JS

See `ontology-config.json` → `conditionActionRules` for the full rule definitions.

## Client-Side Monitoring (Already Built)

The dashboard's `app.js` includes:
- `recordScoreSnapshot()` — records each overview load to sessionStorage
- `checkScoreAlerts()` — compares current vs previous snapshot against thresholds
- `renderProactiveAlerts()` — surfaces alert bubbles in the chat panel with "Investigate" buttons
- Auto-opens chat panel on critical alerts
- Passes score history + trend data to the agent via `buildContextPrefix()`

These thresholds are configurable in `ALERT_THRESHOLDS` at the top of the monitoring section:
```javascript
const ALERT_THRESHOLDS = {
  scoreDrop: 5,       // points
  criticalScore: 40,  // out of 100
  adminPctWarn: 0.30  // 30%
};
```
