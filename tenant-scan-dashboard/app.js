/* ═══════════════════════════════════════════════════════════════════════════
   TENANT SCAN DASHBOARD — dashboard.js
   MSAL auth, DAX queries, ECharts rendering, tab navigation
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ─── CONFIG ───────────────────────────────────────────────────────────
  const CONFIG = {
    clientId:    '27240673-3200-4d06-846a-8d92be7af610',
    tenantId:    '663b2f1b-ccda-4999-8957-f576d062a5bc',
    workspaceId: '03d15a6c-7a38-4c1a-a9f0-687aa8ec02c4',
    datasetId:   '17fd7db8-f6dc-4ce3-95d7-ef9ff293f085',
    agentId:     '4fddf3bb-2fb9-44ca-a68e-6a21441ae4d9',
    agentBaseUrl:'https://api.fabric.microsoft.com/v1/workspaces/03d15a6c-7a38-4c1a-a9f0-687aa8ec02c4/dataagents/4fddf3bb-2fb9-44ca-a68e-6a21441ae4d9/aiassistant/openai',
    scopes:      ['https://analysis.windows.net/powerbi/api/.default'],
    agentScopes: ['https://api.fabric.microsoft.com/.default']
  };

  const API_BASE = `https://api.powerbi.com/v1.0/myorg/groups/${CONFIG.workspaceId}/datasets/${CONFIG.datasetId}/executeQueries`;

  // ─── MSAL SETUP ──────────────────────────────────────────────────────
  let msalApp = null;

  async function initMSAL() {
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.clientId,
        authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname
      },
      cache: { cacheLocation: 'sessionStorage' }
    });
    await msalApp.initialize();
    // Handle redirect promise (for redirect flow)
    await msalApp.handleRedirectPromise();
  }

  async function getToken() {
    const accounts = msalApp.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const result = await msalApp.acquireTokenSilent({
          scopes: CONFIG.scopes,
          account: accounts[0]
        });
        return result.accessToken;
      } catch (e) {
        // Silent failed, fall through to popup
      }
    }
    const result = await msalApp.acquireTokenPopup({ scopes: CONFIG.scopes });
    return result.accessToken;
  }

  function getUser() {
    const accounts = msalApp.getAllAccounts();
    return accounts.length > 0 ? accounts[0] : null;
  }

  // ─── DAX QUERY ENGINE ────────────────────────────────────────────────
  async function queryDAX(dax) {
    const token = await getToken();
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        queries: [{ query: dax }],
        serializerSettings: { includeNulls: true }
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Query failed');
    return data.results[0].tables[0].rows;
  }

  // ─── DAX QUERIES ─────────────────────────────────────────────────────
  const DAX = {
    overview: `EVALUATE ROW(
      "OverallScore", [Overall Score],
      "FabricReadiness", [Fabric Readiness],
      "RBACScore", [RBAC Score],
      "NamingScore", [Naming Score],
      "RefreshScore", [Refresh Score],
      "CapacityScore", [Capacity Score],
      "DescriptionScore", [Description Score],
      "ScoreRating", [Score Rating],
      "LastScanDate", [Last Scan Date],
      "Workspaces", [# Workspaces],
      "Items", [# Items],
      "Findings", [# Findings],
      "Recommendations", [# Recommendations],
      "Scans", [# Scans],
      "AdminRoles", [# Admin Roles],
      "PctAdmin", [% Admin Roles]
    )`,

    trend: `EVALUATE
      SUMMARIZECOLUMNS(
        tenant_scan_runs[scan_date],
        "Score", [Overall Score (Trend)]
      )
      ORDER BY tenant_scan_runs[scan_date] ASC`,

    findings: `EVALUATE
      SELECTCOLUMNS(
        TOPN(100, tenant_scan_findings, tenant_scan_findings[scan_date], DESC),
        "Finding", tenant_scan_findings[title],
        "Category", tenant_scan_findings[category],
        "Severity", tenant_scan_findings[severity],
        "Detail", tenant_scan_findings[detail]
      )`,

    recommendations: `EVALUATE
      SELECTCOLUMNS(
        tenant_scan_recommendations,
        "Recommendation", tenant_scan_recommendations[title],
        "Priority", tenant_scan_recommendations[priority],
        "Category", tenant_scan_recommendations[area],
        "Effort", tenant_scan_recommendations[effort],
        "Impact", tenant_scan_recommendations[impact]
      )`,

    workspaces: `EVALUATE
      SELECTCOLUMNS(
        tenant_scan_workspaces,
        "Name", tenant_scan_workspaces[name],
        "Type", tenant_scan_workspaces[type],
        "Capacity", tenant_scan_workspaces[capacity_name],
        "CapacitySku", tenant_scan_workspaces[capacity_sku],
        "Items", tenant_scan_workspaces[total_items]
      )`,

    roles: `EVALUATE
      SELECTCOLUMNS(
        tenant_scan_roles,
        "Workspace", tenant_scan_roles[workspace_name],
        "Role", tenant_scan_roles[role],
        "Principal", tenant_scan_roles[principal_id],
        "Type", tenant_scan_roles[principal_type]
      )`
  };

  // ─── UTILITY: DEBOUNCE ────────────────────────────────────────────────
  function debounce(fn, ms = 250) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // ─── STATE ───────────────────────────────────────────────────────────
  let state = {
    overview: null,
    trend: null,
    findings: null,
    recommendations: null,
    workspaces: null,
    roles: null,
    loaded: {
      overview: false,
      security: false,
      workspaces: false,
      findings: false
    }
  };

  // ─── DOM REFS ────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── TAB NAVIGATION ──────────────────────────────────────────────────
  function initTabs() {
    $$('.dash-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.dash-tab').forEach(t => t.classList.remove('active'));
        $$('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panelId = `tab-${tab.dataset.tab}`;
        $(`#${panelId}`).classList.add('active');
        // Lazy load tab data
        loadTabData(tab.dataset.tab);
      });
    });
  }

  // ─── LAZY TAB LOADING ────────────────────────────────────────────────
  async function loadTabData(tabName) {
    if (state.loaded[tabName]) return;
    try {
      switch (tabName) {
        case 'overview':
          // Already loaded on init
          break;
        case 'security':
          await loadSecurity();
          break;
        case 'workspaces':
          await loadWorkspaces();
          break;
        case 'findings':
          await loadFindings();
          break;
      }
      state.loaded[tabName] = true;
    } catch (err) {
      showError(err);
    }
  }

  // ─── SCORE COLOR HELPERS ─────────────────────────────────────────────
  function scoreColor(score) {
    if (score >= 80) return '#4ade80';
    if (score >= 60) return '#facc15';
    if (score >= 40) return '#fb923c';
    return '#f87171';
  }

  function ratingClass(rating) {
    if (!rating) return 'rating-needs';
    const r = rating.toLowerCase();
    if (r.includes('strong')) return 'rating-strong';
    if (r.includes('moderate')) return 'rating-moderate';
    if (r.includes('critical')) return 'rating-critical';
    return 'rating-needs';
  }

  function barClass(score) {
    if (score >= 60) return '';
    if (score >= 40) return 'warn';
    return 'danger';
  }

  function severityClass(severity) {
    if (!severity) return 'badge-medium';
    const s = severity.toLowerCase();
    if (s.includes('critical')) return 'badge-critical';
    if (s.includes('high')) return 'badge-high';
    if (s.includes('low')) return 'badge-low';
    return 'badge-medium';
  }

  function priorityClass(priority) {
    if (!priority) return 'badge-medium';
    const p = priority.toLowerCase();
    if (p.includes('critical') || p.includes('p1')) return 'badge-critical';
    if (p.includes('high') || p.includes('p2')) return 'badge-high';
    if (p.includes('low') || p.includes('p4')) return 'badge-low';
    return 'badge-medium';
  }

  // ─── SKELETON LOADERS ────────────────────────────────────────────────
  function showOverviewSkeleton() {
    // Score hero skeleton
    $('#scoreGauge').innerHTML = '<div class="skeleton skeleton-circle"></div>';
    $('#scoreRatingBadge').innerHTML = '';
    $('#scoreScanInfo').innerHTML = '';

    // Sub-scores skeleton
    const subGrid = $('#subScoresGrid');
    subGrid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      subGrid.innerHTML += `
        <div class="card sub-score-card">
          <div class="skeleton skeleton-line w60"></div>
          <div class="skeleton skeleton-line w40" style="height:28px;margin-bottom:10px;"></div>
          <div class="skeleton skeleton-bar" style="width:100%;"></div>
        </div>`;
    }

    // Stat pills skeleton
    const pills = $('#statPills');
    pills.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      pills.innerHTML += `
        <div class="card stat-pill">
          <div class="skeleton skeleton-line w40" style="height:28px;margin:0 auto 8px;"></div>
          <div class="skeleton skeleton-line w60" style="margin:0 auto;"></div>
        </div>`;
    }

    // Trend skeleton
    $('#trendChart').innerHTML = '<div class="skeleton" style="width:100%;height:280px;border-radius:12px;"></div>';
  }

  // ─── RENDER: EXECUTIVE OVERVIEW ──────────────────────────────────────
  function renderOverview(data) {
    const d = data[0];
    const overall = Math.round(d['[OverallScore]'] || 0);
    const rating = d['[ScoreRating]'] || 'Unknown';
    const lastScan = d['[LastScanDate]'] ? new Date(d['[LastScanDate]']).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const scans = d['[Scans]'] || 0;

    // Gauge chart
    renderGauge(overall);

    // Rating badge
    const badge = $('#scoreRatingBadge');
    badge.textContent = rating;
    badge.className = `score-rating-badge ${ratingClass(rating)}`;

    // Scan info
    $('#scoreScanInfo').textContent = `Last scanned: ${lastScan} · ${scans} scan${scans !== 1 ? 's' : ''} total`;

    // Sub-scores
    const subScores = [
      { label: 'Fabric Readiness', key: '[FabricReadiness]' },
      { label: 'RBAC / Least Privilege', key: '[RBACScore]' },
      { label: 'Naming Conventions', key: '[NamingScore]' },
      { label: 'Refresh Hygiene', key: '[RefreshScore]' },
      { label: 'Capacity Assignment', key: '[CapacityScore]' },
      { label: 'Descriptions', key: '[DescriptionScore]' }
    ];

    const subGrid = $('#subScoresGrid');
    subGrid.innerHTML = '';
    subScores.forEach(s => {
      const val = Math.round(d[s.key] || 0);
      subGrid.innerHTML += `
        <div class="card sub-score-card">
          <div class="sub-score-label">${s.label}</div>
          <div class="sub-score-value" style="color:${scoreColor(val)}">${val}<span>/100</span></div>
          <div class="score-bar-track">
            <div class="score-bar-fill ${barClass(val)}" style="width:0%" data-target="${val}"></div>
          </div>
        </div>`;
    });

    // Animate bars
    requestAnimationFrame(() => {
      setTimeout(() => {
        subGrid.querySelectorAll('.score-bar-fill').forEach(bar => {
          bar.style.width = bar.dataset.target + '%';
        });
      }, 100);
    });

    // Stat pills
    const statPills = [
      { num: d['[Workspaces]'] || 0, label: 'Workspaces' },
      { num: d['[Items]'] || 0, label: 'Items' },
      { num: d['[Findings]'] || 0, label: 'Findings' }
    ];

    const pills = $('#statPills');
    pills.innerHTML = '';
    statPills.forEach(s => {
      pills.innerHTML += `
        <div class="card stat-pill">
          <div class="stat-pill-num">${typeof s.num === 'number' ? s.num.toLocaleString() : s.num}</div>
          <div class="stat-pill-label">${s.label}</div>
        </div>`;
    });
  }

  // ─── RENDER: GAUGE CHART ─────────────────────────────────────────────
  function renderGauge(score) {
    const el = $('#scoreGauge');
    el.innerHTML = '';
    const chart = echarts.init(el);
    chart.setOption({
      series: [{
        type: 'gauge',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 100,
        progress: {
          show: true,
          width: 14,
          roundCap: true,
          itemStyle: { color: scoreColor(score) }
        },
        pointer: { show: false },
        axisLine: {
          lineStyle: { width: 14, color: [[1, 'rgba(255,255,255,0.06)']] }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 48,
          fontFamily: 'Syne',
          fontWeight: 800,
          color: scoreColor(score),
          offsetCenter: [0, '10%'],
          formatter: '{value}'
        },
        data: [{ value: score }],
        animationDuration: 1200,
        animationEasingUpdate: 'cubicOut'
      }]
    });
    window.addEventListener('resize', () => chart.resize());
  }

  // ─── RENDER: TREND CHART ─────────────────────────────────────────────
  function renderTrend(data) {
    const el = $('#trendChart');
    el.innerHTML = '';

    if (!data || data.length === 0) {
      el.innerHTML = '<div class="empty-state"><p>Trend data will appear after multiple scans.</p></div>';
      return;
    }

    const chart = echarts.init(el);
    const dates = data.map(r => {
      const d = new Date(r['tenant_scan_runs[scan_date]']);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const scores = data.map(r => Math.round(r['[Score]'] || 0));

    chart.setOption({
      backgroundColor: 'transparent',
      textStyle: { color: '#7a91aa', fontFamily: 'Figtree' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#131f31',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#fff', fontFamily: 'Figtree', fontSize: 13 },
        formatter: (params) => {
          const p = params[0];
          return `<strong>${p.axisValue}</strong><br/>Score: <span style="color:${scoreColor(p.value)};font-weight:700;">${p.value}</span>`;
        }
      },
      grid: {
        top: 20, right: 20, bottom: 40, left: 48,
        borderColor: 'rgba(255,255,255,0.06)'
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        axisLabel: { color: '#7a91aa', fontSize: 12 },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
        axisLine: { show: false },
        axisLabel: { color: '#7a91aa', fontSize: 12 }
      },
      series: [{
        type: 'line',
        data: scores,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { color: '#2ee8d3', width: 3 },
        itemStyle: { color: '#2ee8d3', borderWidth: 2, borderColor: '#080f1c' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(46,232,211,0.3)' },
              { offset: 1, color: 'rgba(46,232,211,0)' }
            ]
          }
        },
        animationDuration: 1000
      }]
    });
    window.addEventListener('resize', () => chart.resize());
  }

  // ─── RENDER: SECURITY TAB ────────────────────────────────────────────
  function renderSecurity(overviewData, rolesData) {
    const d = overviewData[0];
    const pctAdmin = d['[PctAdmin]'] || 0;
    const adminCount = d['[AdminRoles]'] || 0;
    const totalRoles = rolesData ? rolesData.length : 0;
    const isWarn = pctAdmin > 0.3;

    const hero = $('#securityHero');
    hero.innerHTML = `
      <div class="card security-big-stat">
        <div class="big-stat-num ${isWarn ? 'big-stat-warn' : 'big-stat-ok'}">${Math.round(pctAdmin * 100)}%</div>
        <div class="big-stat-label">Admin Role Assignments${isWarn ? ' ⚠️ Above 30% threshold' : ''}</div>
      </div>
      <div class="card security-big-stat">
        <div class="big-stat-num big-stat-ok">${adminCount}</div>
        <div class="big-stat-label">Admin Roles out of ${totalRoles} total</div>
      </div>`;

    renderRolesTable(rolesData);
  }

  function renderRolesTable(data) {
    const tbody = $('#rolesTableBody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No role data available</td></tr>';
      return;
    }
    state.roles = data;
    populateRolesTable(data);

    // Filter (debounced, guarded against duplicate binding)
    const rolesInput = $('#rolesFilter');
    if (!rolesInput._bound) {
      rolesInput.addEventListener('input', debounce((e) => {
        const q = e.target.value.toLowerCase();
        const filtered = state.roles.filter(r =>
          (r['[Workspace]'] || '').toLowerCase().includes(q) ||
          (r['[Role]'] || '').toLowerCase().includes(q) ||
          (r['[Principal]'] || '').toLowerCase().includes(q) ||
          (r['[Type]'] || '').toLowerCase().includes(q)
        );
        populateRolesTable(filtered);
      }));
      rolesInput._bound = true;
    }
  }

  function populateRolesTable(data) {
    const tbody = $('#rolesTableBody');
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${esc(r['[Workspace]'])}</td>
        <td>${esc(r['[Role]'])}</td>
        <td>${esc(r['[Principal]'])}</td>
        <td class="cell-muted">${esc(r['[Type]'])}</td>
      </tr>`).join('');
  }

  // ─── RENDER: WORKSPACES TAB ──────────────────────────────────────────
  function renderWorkspaces(data) {
    const count = data ? data.length : 0;
    $('#workspaceStatCard').innerHTML = `
      <div class="card security-big-stat" style="max-width:300px;">
        <div class="big-stat-num big-stat-ok">${count}</div>
        <div class="big-stat-label">Total Workspaces</div>
      </div>`;

    state.workspaces = data || [];
    populateWorkspacesTable(state.workspaces);

    const wsInput = $('#workspacesFilter');
    if (!wsInput._bound) {
      wsInput.addEventListener('input', debounce((e) => {
        const q = e.target.value.toLowerCase();
        const filtered = state.workspaces.filter(r =>
          (r['[Name]'] || '').toLowerCase().includes(q) ||
          (r['[Type]'] || '').toLowerCase().includes(q) ||
          (r['[Capacity]'] || '').toLowerCase().includes(q)
        );
        populateWorkspacesTable(filtered);
      }));
      wsInput._bound = true;
    }
  }

  function populateWorkspacesTable(data) {
    const tbody = $('#workspacesTableBody');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No workspace data</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${esc(r['[Name]'])}</td>
        <td class="cell-muted">${esc(r['[Type]'])}</td>
        <td class="cell-muted">${esc(r['[Capacity]'])}</td>
        <td class="cell-muted">${esc(r['[CapacitySku]'] || '—')}</td>
        <td>${r['[Items]'] != null ? r['[Items]'] : '—'}</td>
      </tr>`).join('');
  }

  // ─── RENDER: FINDINGS TAB ────────────────────────────────────────────
  function renderFindings(findings, recs) {
    state.findings = findings || [];
    state.recommendations = recs || [];

    populateFindingsGrid(state.findings);
    populateRecsGrid(state.recommendations);

    const findInput = $('#findingsFilter');
    if (!findInput._bound) {
      findInput.addEventListener('input', debounce((e) => {
        const q = e.target.value.toLowerCase();
        const filtered = state.findings.filter(r =>
          (r['[Finding]'] || '').toLowerCase().includes(q) ||
          (r['[Category]'] || '').toLowerCase().includes(q) ||
          (r['[Severity]'] || '').toLowerCase().includes(q) ||
          (r['[Detail]'] || '').toLowerCase().includes(q)
        );
        populateFindingsGrid(filtered);
      }));
      findInput._bound = true;
    }
  }

  function populateFindingsGrid(data) {
    const grid = $('#findingsGrid');
    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No Findings</h3><p>No governance findings in the latest scan.</p></div>';
      return;
    }
    grid.innerHTML = data.map((r, idx) => `
      <div class="card finding-card">
        <div class="finding-content">
          <div class="finding-text">${esc(r['[Finding]'])}</div>
          ${r['[Detail]'] ? `<div class="finding-detail">${esc(r['[Detail]'])}</div>` : ''}
          <div class="finding-meta">
            <span class="badge ${severityClass(r['[Severity]'])}">${esc(r['[Severity]'])}</span>
            <span class="badge badge-category">${esc(r['[Category]'])}</span>
          </div>
        </div>
        <button class="ask-about-btn" title="Ask AI about this finding" data-finding-idx="${idx}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>
          Ask AI
        </button>
      </div>`).join('');
    // Bind click handlers via JS to avoid inline escaping issues
    grid.querySelectorAll('.ask-about-btn[data-finding-idx]').forEach(btn => {
      const row = data[parseInt(btn.dataset.findingIdx)];
      btn.addEventListener('click', () => {
        window.Dashboard.askAbout(`Tell me more about the finding "${row['[Finding]']}" and how to fix it`);
      });
    });
  }

  function populateRecsGrid(data) {
    const grid = $('#recsGrid');
    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No Recommendations</h3><p>Check back after your next scan.</p></div>';
      return;
    }
    grid.innerHTML = data.map((r, idx) => `
      <div class="card rec-card">
        <div class="rec-content">
          <div class="rec-text">${esc(r['[Recommendation]'])}</div>
          <div class="finding-meta">
            <span class="badge ${priorityClass(r['[Priority]'])}">${esc(r['[Priority]'])}</span>
            <span class="badge badge-category">${esc(r['[Category]'])}</span>
            ${r['[Effort]'] ? `<span class="badge badge-workspace">${esc(r['[Effort]'])} effort</span>` : ''}
            ${r['[Impact]'] ? `<span class="badge badge-workspace">${esc(r['[Impact]'])} impact</span>` : ''}
          </div>
        </div>
        <button class="ask-about-btn" title="Ask AI about this recommendation" data-rec-idx="${idx}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>
          Ask AI
        </button>
      </div>`).join('');
    // Bind click handlers via JS to avoid inline escaping issues
    grid.querySelectorAll('.ask-about-btn[data-rec-idx]').forEach(btn => {
      const row = data[parseInt(btn.dataset.recIdx)];
      btn.addEventListener('click', () => {
        window.Dashboard.askAbout(`Explain the recommendation "${row['[Recommendation]']}" and give me step-by-step instructions to implement it`);
      });
    });
  }

  // ─── ERROR / UI HELPERS ──────────────────────────────────────────────
  function showError(err) {
    const errorState = $('#errorState');
    $('#errorMsg').textContent = 'Something went wrong while loading your dashboard data.';
    $('#errorDetail').textContent = err.message || String(err);
    errorState.style.display = 'block';
    // Hide tab panels
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
  }

  function hideError() {
    $('#errorState').style.display = 'none';
  }

  function esc(val) {
    if (val == null) return '—';
    const div = document.createElement('div');
    div.textContent = String(val);
    return div.innerHTML;
  }

  // ─── MAIN LOAD FLOW ─────────────────────────────────────────────────
  async function loadOverview() {
    showOverviewSkeleton();
    const [overviewRows, trendRows] = await Promise.all([
      queryDAX(DAX.overview),
      queryDAX(DAX.trend)
    ]);
    state.overview = overviewRows;
    state.trend = trendRows;
    renderOverview(overviewRows);
    renderTrend(trendRows);
    state.loaded.overview = true;

    // Score monitoring: record snapshot and check for alerts
    const { snapshot, previous } = recordScoreSnapshot(overviewRows);
    if (snapshot) {
      const alerts = checkScoreAlerts(snapshot, previous);
      if (alerts.length > 0) {
        // Slight delay to let the dashboard render first
        setTimeout(() => renderProactiveAlerts(alerts), 1500);
      }
    }
  }

  async function loadSecurity() {
    if (!state.overview) {
      state.overview = await queryDAX(DAX.overview);
    }
    const rolesData = await queryDAX(DAX.roles);
    renderSecurity(state.overview, rolesData);
  }

  async function loadWorkspaces() {
    const data = await queryDAX(DAX.workspaces);
    renderWorkspaces(data);
  }

  async function loadFindings() {
    const [findings, recs] = await Promise.all([
      queryDAX(DAX.findings),
      queryDAX(DAX.recommendations)
    ]);
    renderFindings(findings, recs);
  }

  // ─── AUTH FLOW ───────────────────────────────────────────────────────
  function showDashboard(user) {
    $('#authScreen').classList.add('hidden');
    $('#dashApp').classList.add('active');
    $('#navUser').textContent = user.username || user.name || '';
  }

  function showAuth() {
    $('#authScreen').classList.remove('hidden');
    $('#dashApp').classList.remove('active');
  }

  // ─── CHAT (FABRIC DATA AGENT) ─────────────────────────────────────────
  // Uses OpenAI Assistants API pattern: create assistant → thread → message → run → poll → read
  const API_VER = '2024-05-01-preview';
  let agentState = { assistantId: null, threadId: null };

  // ─── PERSISTENCE HELPERS ────────────────────────────────────────────
  const STORAGE_KEYS = {
    chatHistory: 'tsd_chat_history',
    agentSession: 'tsd_agent_session'
  };

  function saveAgentSession() {
    try {
      sessionStorage.setItem(STORAGE_KEYS.agentSession, JSON.stringify(agentState));
    } catch (e) { /* quota or private mode — ignore */ }
  }

  function loadAgentSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.agentSession);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.assistantId && saved.threadId) {
          agentState = saved;
          console.log('Restored agent session:', agentState);
        }
      }
    } catch (e) { /* corrupted — ignore */ }
  }

  function saveChatHistory() {
    try {
      const bubbles = document.querySelectorAll('#chat-messages .chat-bubble');
      const history = Array.from(bubbles)
        .filter(b => !b.classList.contains('loading'))
        .map(b => ({
          role: b.classList.contains('user') ? 'user' : 'assistant',
          text: b.dataset.rawText || b.textContent.trim(),
          html: b.innerHTML
        }))
        .filter(m => m.text);
      sessionStorage.setItem(STORAGE_KEYS.chatHistory, JSON.stringify(history));
    } catch (e) { /* quota — ignore */ }
  }

  function restoreChatHistory() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.chatHistory);
      if (!raw) return false;
      const history = JSON.parse(raw);
      if (!history.length) return false;

      const msgs = document.getElementById('chat-messages');
      // Clear default welcome bubble
      msgs.innerHTML = '';

      history.forEach(m => {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-bubble-wrap';
        const col = document.createElement('div');
        col.className = 'chat-bubble-col';
        const div = document.createElement('div');
        div.className = `chat-bubble ${m.role}`;
        div.innerHTML = m.html;
        col.appendChild(div);
        wrapper.appendChild(col);
        if (m.role === 'assistant') {
          wrapper.appendChild(createCopyBtn(m.text));
        }
        msgs.appendChild(wrapper);
      });

      // Re-add suggestions container
      const sugDiv = document.createElement('div');
      sugDiv.id = 'chat-suggestions';
      sugDiv.className = 'chat-suggestions';
      msgs.appendChild(sugDiv);

      msgs.scrollTop = msgs.scrollHeight;
      return true;
    } catch (e) { return false; }
  }

  // ─── FABRIC REST API ACTIONS (Tier 3) ─────────────────────────────────
  // Remediation actions that call Fabric Admin REST APIs directly from the dashboard
  const FABRIC_ACTIONS = {
    assignCapacity: {
      id: 'assignCapacity',
      label: 'Assign to Capacity',
      icon: '⚡',
      description: 'Assign this workspace to a Fabric capacity',
      api: {
        method: 'POST',
        url: (params) => `https://api.powerbi.com/v1.0/myorg/admin/capacities/${params.capacityId}/AssignWorkspaces`,
        body: (params) => ({ targetWorkspacesToAssign: [params.workspaceId] })
      },
      paramPrompts: [
        { key: 'workspaceId', label: 'Workspace ID', placeholder: 'e.g. 03d15a6c-7a38-...' },
        { key: 'capacityId', label: 'Capacity ID', placeholder: 'e.g. a1b2c3d4-...' }
      ],
      confirmText: (params) => `Assign workspace ${params.workspaceId} to capacity ${params.capacityId}?`,
      scope: 'https://analysis.windows.net/powerbi/api/.default'
    },
    addWorkspaceUser: {
      id: 'addWorkspaceUser',
      label: 'Add User to Workspace',
      icon: '👤',
      description: 'Add a user to a workspace with a specific role',
      api: {
        method: 'POST',
        url: (params) => `https://api.powerbi.com/v1.0/myorg/admin/groups/${params.workspaceId}/users`,
        body: (params) => ({
          emailAddress: params.userEmail,
          groupUserAccessRight: params.role || 'Viewer',
          principalType: 'User'
        })
      },
      paramPrompts: [
        { key: 'workspaceId', label: 'Workspace ID', placeholder: 'e.g. 03d15a6c-7a38-...' },
        { key: 'userEmail', label: 'User email', placeholder: 'user@contoso.com' },
        { key: 'role', label: 'Role', placeholder: 'Admin | Member | Contributor | Viewer' }
      ],
      confirmText: (params) => `Add ${params.userEmail} as ${params.role || 'Viewer'} to workspace?`,
      scope: 'https://analysis.windows.net/powerbi/api/.default'
    },
    removeWorkspaceUser: {
      id: 'removeWorkspaceUser',
      label: 'Remove User from Workspace',
      icon: '🚫',
      description: 'Remove a user from a workspace',
      api: {
        method: 'DELETE',
        url: (params) => `https://api.powerbi.com/v1.0/myorg/admin/groups/${params.workspaceId}/users/${params.userEmail}`,
        body: () => null
      },
      paramPrompts: [
        { key: 'workspaceId', label: 'Workspace ID', placeholder: 'e.g. 03d15a6c-7a38-...' },
        { key: 'userEmail', label: 'User email', placeholder: 'user@contoso.com' }
      ],
      confirmText: (params) => `Remove ${params.userEmail} from workspace?`,
      scope: 'https://analysis.windows.net/powerbi/api/.default'
    },
    downgradeRole: {
      id: 'downgradeRole',
      label: 'Downgrade Role',
      icon: '🔽',
      description: 'Change a user role to a lower privilege level',
      api: {
        method: 'PUT',
        url: (params) => `https://api.powerbi.com/v1.0/myorg/groups/${params.workspaceId}/users`,
        body: (params) => ({
          emailAddress: params.userEmail,
          groupUserAccessRight: params.newRole || 'Contributor',
          principalType: 'User'
        })
      },
      paramPrompts: [
        { key: 'workspaceId', label: 'Workspace ID', placeholder: 'e.g. 03d15a6c-7a38-...' },
        { key: 'userEmail', label: 'User email', placeholder: 'user@contoso.com' },
        { key: 'newRole', label: 'New role', placeholder: 'Member | Contributor | Viewer' }
      ],
      confirmText: (params) => `Downgrade ${params.userEmail} to ${params.newRole || 'Contributor'}?`,
      scope: 'https://analysis.windows.net/powerbi/api/.default'
    }
  };

  // Token acquisition for Fabric Admin API actions
  async function getAdminToken(scope) {
    const accounts = msalApp.getAllAccounts();
    const request = { scopes: [scope], account: accounts[0] };
    try {
      return (await msalApp.acquireTokenSilent(request)).accessToken;
    } catch (e) {
      return (await msalApp.acquireTokenPopup(request)).accessToken;
    }
  }

  // Execute a Fabric REST API action
  async function executeFabricAction(actionId, params) {
    const action = FABRIC_ACTIONS[actionId];
    if (!action) throw new Error(`Unknown action: ${actionId}`);

    const token = await getAdminToken(action.scope);
    const url = action.api.url(params);
    const body = action.api.body(params);

    const opts = {
      method: action.api.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      throw new Error(`API ${res.status}: ${err}`);
    }
    return res.status === 200 ? await res.json().catch(() => ({})) : {};
  }

  // Render confirmation modal for Fabric actions
  function showActionConfirmModal(action, params) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'action-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'action-modal';

      modal.innerHTML = `
        <div class="action-modal-header">
          <span class="action-modal-icon">${action.icon}</span>
          <span class="action-modal-title">${action.label}</span>
        </div>
        <p class="action-modal-desc">${action.confirmText(params)}</p>
        <div class="action-modal-params">
          ${Object.entries(params).map(([k, v]) => `<div class="action-modal-param"><span class="param-key">${k}:</span> <span class="param-val">${v}</span></div>`).join('')}
        </div>
        <div class="action-modal-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          This will make changes to your Fabric tenant. This action cannot be undone.
        </div>
        <div class="action-modal-buttons">
          <button class="action-modal-cancel">Cancel</button>
          <button class="action-modal-confirm">Execute</button>
        </div>`;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('active'));

      modal.querySelector('.action-modal-cancel').addEventListener('click', () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
        resolve(false);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
          setTimeout(() => overlay.remove(), 200);
          resolve(false);
        }
      });
      modal.querySelector('.action-modal-confirm').addEventListener('click', () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
        resolve(true);
      });
    });
  }

  // Render action button bar for a remediation card
  function renderActionButtons(card, actionText) {
    // Match action keywords to available Fabric actions
    const lc = actionText.toLowerCase();
    const matched = [];

    if (lc.includes('capacity') && (lc.includes('assign') || lc.includes('move') || lc.includes('migrate'))) {
      matched.push(FABRIC_ACTIONS.assignCapacity);
    }
    if (lc.includes('remove') && (lc.includes('admin') || lc.includes('user') || lc.includes('role'))) {
      matched.push(FABRIC_ACTIONS.removeWorkspaceUser);
    }
    if (lc.includes('downgrade') || lc.includes('demote') || (lc.includes('change') && lc.includes('role'))) {
      matched.push(FABRIC_ACTIONS.downgradeRole);
    }
    if (lc.includes('add') && (lc.includes('user') || lc.includes('viewer') || lc.includes('contributor'))) {
      matched.push(FABRIC_ACTIONS.addWorkspaceUser);
    }

    if (matched.length === 0) return;

    const bar = document.createElement('div');
    bar.className = 'action-btn-bar';

    matched.forEach(action => {
      const btn = document.createElement('button');
      btn.className = 'fabric-action-btn';
      btn.innerHTML = `${action.icon} ${action.label}`;
      btn.title = action.description;

      btn.addEventListener('click', async () => {
        // Collect params via inline prompt
        const params = {};
        for (const prompt of action.paramPrompts) {
          const val = window.prompt(`${prompt.label}:`, prompt.placeholder);
          if (!val || val === prompt.placeholder) return; // user cancelled
          params[prompt.key] = val;
        }

        const confirmed = await showActionConfirmModal(action, params);
        if (!confirmed) return;

        btn.disabled = true;
        btn.innerHTML = `⏳ Executing...`;
        try {
          await executeFabricAction(action.id, params);
          btn.innerHTML = `✅ Done`;
          btn.className = 'fabric-action-btn action-success';
          // Notify in chat
          appendBubble('assistant', `${action.icon} **${action.label}** completed successfully.`);
          saveChatHistory();
        } catch (e) {
          btn.innerHTML = `❌ Failed`;
          btn.className = 'fabric-action-btn action-error';
          btn.title = e.message;
          appendBubble('assistant', `${action.icon} **${action.label}** failed: ${e.message}`);
          saveChatHistory();
          setTimeout(() => {
            btn.innerHTML = `${action.icon} ${action.label}`;
            btn.className = 'fabric-action-btn';
            btn.disabled = false;
          }, 3000);
        }
      });

      bar.appendChild(btn);
    });

    card.appendChild(bar);
  }

  // ─── SCORE MONITORING (Operations Agent — client-side) ────────────────
  const MONITOR_KEY = 'tsd_score_history';
  const ALERT_THRESHOLDS = {
    scoreDrop: 5,      // Alert if score drops by 5+ points
    criticalScore: 40, // Alert if overall score falls below 40
    adminPctWarn: 0.30  // Alert if admin % exceeds 30%
  };

  function recordScoreSnapshot(overviewData) {
    if (!overviewData || !overviewData[0]) return;
    const d = overviewData[0];
    const snapshot = {
      ts: new Date().toISOString(),
      overall: Math.round(d['[OverallScore]'] || 0),
      rbac: Math.round(d['[RBACScore]'] || 0),
      naming: Math.round(d['[NamingScore]'] || 0),
      refresh: Math.round(d['[RefreshScore]'] || 0),
      capacity: Math.round(d['[CapacityScore]'] || 0),
      description: Math.round(d['[DescriptionScore]'] || 0),
      fabric: Math.round(d['[FabricReadiness]'] || 0),
      pctAdmin: d['[PctAdmin]'] || 0,
      findings: d['[Findings]'] || 0
    };

    try {
      const history = JSON.parse(sessionStorage.getItem(MONITOR_KEY) || '[]');
      // Only add if different from last snapshot
      const last = history[history.length - 1];
      if (!last || last.overall !== snapshot.overall || last.findings !== snapshot.findings) {
        history.push(snapshot);
        // Keep last 50 snapshots
        if (history.length > 50) history.splice(0, history.length - 50);
        sessionStorage.setItem(MONITOR_KEY, JSON.stringify(history));
      }
      return { snapshot, previous: last || null };
    } catch (e) { return { snapshot, previous: null }; }
  }

  function checkScoreAlerts(snapshot, previous) {
    const alerts = [];

    // Score dropped significantly
    if (previous && previous.overall - snapshot.overall >= ALERT_THRESHOLDS.scoreDrop) {
      const drop = previous.overall - snapshot.overall;
      // Find which sub-scores dropped most
      const drops = [];
      if (previous.rbac - snapshot.rbac > 3) drops.push(`RBAC (${previous.rbac}→${snapshot.rbac})`);
      if (previous.naming - snapshot.naming > 3) drops.push(`Naming (${previous.naming}→${snapshot.naming})`);
      if (previous.refresh - snapshot.refresh > 3) drops.push(`Refresh (${previous.refresh}→${snapshot.refresh})`);
      if (previous.capacity - snapshot.capacity > 3) drops.push(`Capacity (${previous.capacity}→${snapshot.capacity})`);
      if (previous.fabric - snapshot.fabric > 3) drops.push(`Fabric Readiness (${previous.fabric}→${snapshot.fabric})`);
      if (previous.description - snapshot.description > 3) drops.push(`Descriptions (${previous.description}→${snapshot.description})`);

      alerts.push({
        type: 'score-drop',
        severity: drop >= 10 ? 'critical' : 'warning',
        title: `Governance score dropped ${drop} points`,
        detail: `Score went from ${previous.overall} to ${snapshot.overall}.${drops.length ? ' Biggest drops: ' + drops.join(', ') + '.' : ''} Want me to analyze what changed?`,
        action: 'Analyze why my score dropped and suggest fixes'
      });
    }

    // Score critically low
    if (snapshot.overall < ALERT_THRESHOLDS.criticalScore && (!previous || previous.overall >= ALERT_THRESHOLDS.criticalScore)) {
      alerts.push({
        type: 'critical-score',
        severity: 'critical',
        title: `Governance score is critically low (${snapshot.overall}/100)`,
        detail: 'Your tenant governance posture needs immediate attention. Multiple areas likely need remediation.',
        action: 'Give me an emergency remediation plan for my critical governance issues'
      });
    }

    // Admin % too high
    if (snapshot.pctAdmin > ALERT_THRESHOLDS.adminPctWarn) {
      alerts.push({
        type: 'admin-warning',
        severity: 'warning',
        title: `Admin role assignments at ${Math.round(snapshot.pctAdmin * 100)}%`,
        detail: `Exceeds the ${Math.round(ALERT_THRESHOLDS.adminPctWarn * 100)}% recommended threshold. Too many admin roles increase your security surface area.`,
        action: 'Which admin role assignments should I review or remove?'
      });
    }

    return alerts;
  }

  function renderProactiveAlerts(alerts) {
    if (!alerts.length) return;

    const panel = document.getElementById('chat-panel');
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    alerts.forEach(alert => {
      const wrapper = document.createElement('div');
      wrapper.className = `chat-bubble-wrap`;

      const bubble = document.createElement('div');
      bubble.className = `chat-bubble assistant alert-bubble alert-${alert.severity}`;
      bubble.innerHTML = `
        <div class="alert-indicator">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${alert.severity === 'critical'
              ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
              : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
          </svg>
          ${alert.title}
        </div>
        <p style="margin:6px 0 8px;font-size:12px;color:var(--muted);">${alert.detail}</p>
        <button class="alert-action-btn" onclick="window.Dashboard.askAbout('${alert.action.replace(/'/g, "\\'")}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>
          Investigate
        </button>`;

      wrapper.appendChild(bubble);
      // Insert before suggestions
      const suggestions = document.getElementById('chat-suggestions');
      if (suggestions) {
        msgs.insertBefore(wrapper, suggestions);
      } else {
        msgs.appendChild(wrapper);
      }
    });

    // Auto-open chat panel if critical alert
    if (alerts.some(a => a.severity === 'critical') && panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
    }

    msgs.scrollTop = msgs.scrollHeight;
  }

  async function getAgentToken() {
    const accounts = msalApp.getAllAccounts();
    if (accounts.length === 0) throw new Error('Not signed in');
    try {
      const result = await msalApp.acquireTokenSilent({
        scopes: CONFIG.agentScopes,
        account: accounts[0]
      });
      return result.accessToken;
    } catch (e) {
      const result = await msalApp.acquireTokenPopup({ scopes: CONFIG.agentScopes });
      return result.accessToken;
    }
  }

  async function agentFetch(path, token, opts = {}, _retries = 3) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${CONFIG.agentBaseUrl}${path}${sep}api-version=${API_VER}`;
    const activityId = crypto.randomUUID();

    for (let attempt = 0; attempt <= _retries; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          ...opts,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'ActivityId': activityId,
            ...(opts.headers || {})
          }
        });
      } catch (networkErr) {
        // Network-level failure (offline, DNS, etc.)
        if (attempt < _retries) {
          console.warn(`Agent fetch network error (attempt ${attempt + 1}/${_retries}):`, networkErr.message);
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error('Network error — check your connection');
      }

      // 401 → token expired, let caller re-acquire
      if (res.status === 401) {
        const err = new Error('Token expired');
        err.status = 401;
        throw err;
      }

      // Transient server errors → retry with backoff
      if (res.status >= 500 && attempt < _retries) {
        console.warn(`Agent API ${res.status} on ${path} (attempt ${attempt + 1}/${_retries})`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }

      // 429 rate-limited → respect Retry-After header
      if (res.status === 429 && attempt < _retries) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '3', 10);
        console.warn(`Agent API rate-limited, retrying in ${retryAfter}s`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Agent API ${opts.method || 'GET'} ${path}:`, res.status, errText);
        throw new Error(`Agent returned ${res.status}`);
      }

      if (res.status === 204) return null;
      return res.json();
    }
  }

  async function initAgentSession(token) {
    if (agentState.assistantId && agentState.threadId) {
      // Validate existing thread is still alive
      try {
        await agentFetch(`/threads/${agentState.threadId}`, token, {}, 0);
        return; // Thread still valid
      } catch (e) {
        console.warn('Existing thread invalid, creating new session:', e.message);
        agentState = { assistantId: null, threadId: null };
      }
    }

    // Create assistant
    const assistant = await agentFetch('/assistants', token, {
      method: 'POST', body: JSON.stringify({ model: 'not used' })
    });
    agentState.assistantId = assistant.id;

    // Create thread
    const thread = await agentFetch('/threads', token, {
      method: 'POST', body: '{}'
    });
    agentState.threadId = thread.id;
    saveAgentSession();
    console.log('Agent session created:', agentState);
  }

  async function pollRun(token, threadId, runId) {
    const terminal = new Set(['completed', 'failed', 'cancelled', 'requires_action']);
    const maxWait = 120000; // 2 min timeout
    const start = Date.now();
    let interval = 1000; // Start fast, back off
    const maxInterval = 5000;

    while (true) {
      const run = await agentFetch(`/threads/${threadId}/runs/${runId}`, token, {}, 1); // fewer retries for polling
      if (terminal.has(run.status)) return run;
      if (Date.now() - start > maxWait) throw new Error('Agent timed out after 2 minutes');
      await new Promise(r => setTimeout(r, interval));
      interval = Math.min(interval * 1.5, maxInterval); // exponential backoff, cap at 5s
    }
  }

  function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      updateSuggestions();
      document.getElementById('chat-input').focus();
    }
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text);
    }
    // Fallback: escape HTML and convert newlines
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
  }

  async function typewrite(el, fullText) {
    el.dataset.rawText = fullText; // stash for persistence
    const msgContainer = document.getElementById('chat-messages');
    const chars = [...fullText];
    const total = chars.length;
    let rendered = '';
    // Adaptive speed: short replies type slower for readability, long ones faster
    const baseDelay = total > 500 ? 4 : total > 200 ? 8 : 15;
    let i = 0;
    while (i < total) {
      // Batch multiple chars per frame for speed on long replies
      const batch = Math.max(1, Math.floor(total / 200));
      for (let b = 0; b < batch && i < total; b++, i++) {
        rendered += chars[i];
      }
      el.innerHTML = renderMarkdown(rendered);
      msgContainer.scrollTop = msgContainer.scrollHeight;
      await new Promise(r => setTimeout(r, baseDelay));
    }
    // Final render to ensure completeness
    el.innerHTML = renderMarkdown(fullText);
  }

  function createCopyBtn(rawText) {
    const btn = document.createElement('button');
    btn.className = 'chat-copy-btn';
    btn.title = 'Copy to clipboard';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawText);
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 2000);
      } catch (e) { console.error('Copy failed', e); }
    });
    return btn;
  }

  function formatTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendBubble(cls, text, useMarkdown = false) {
    const messages = document.getElementById('chat-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-bubble-wrap';
    const col = document.createElement('div');
    col.className = 'chat-bubble-col';
    const div = document.createElement('div');
    div.className = `chat-bubble ${cls}`;
    if (useMarkdown) {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    const ts = document.createElement('span');
    ts.className = 'chat-timestamp';
    ts.textContent = formatTime();
    col.appendChild(div);
    col.appendChild(ts);
    wrapper.appendChild(col);
    if (useMarkdown) {
      wrapper.appendChild(createCopyBtn(text));
    }
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  // ─── DASHBOARD CONTEXT FOR AGENT ─────────────────────────────────────
  function buildContextPrefix() {
    const tab = getActiveTab();
    const parts = [`[Dashboard context: user is on the "${tab}" tab.`];

    // Inject overview scores if available
    if (state.overview && state.overview[0]) {
      const d = state.overview[0];
      const overall = Math.round(d['[OverallScore]'] || 0);
      const rating = d['[ScoreRating]'] || 'Unknown';
      parts.push(`Overall governance score: ${overall}/100 (${rating}).`);

      const subs = [
        ['Fabric Readiness', d['[FabricReadiness]']],
        ['RBAC', d['[RBACScore]']],
        ['Naming', d['[NamingScore]']],
        ['Refresh', d['[RefreshScore]']],
        ['Capacity', d['[CapacityScore]']],
        ['Descriptions', d['[DescriptionScore]']]
      ].map(([label, val]) => `${label}: ${Math.round(val || 0)}`).join(', ');
      parts.push(`Sub-scores: ${subs}.`);

      const ws = d['[Workspaces]'] || 0;
      const items = d['[Items]'] || 0;
      const findings = d['[Findings]'] || 0;
      const recs = d['[Recommendations]'] || 0;
      const pctAdmin = d['[PctAdmin]'] ? Math.round(d['[PctAdmin]'] * 100) : 0;
      parts.push(`${ws} workspaces, ${items} items, ${findings} findings, ${recs} recommendations. Admin role %: ${pctAdmin}%.`);
    }

    // Tab-specific context
    if (tab === 'security' && state.roles) {
      const adminCount = state.roles.filter(r => (r['[Role]'] || '').toLowerCase() === 'admin').length;
      parts.push(`Security tab: ${state.roles.length} total role assignments, ${adminCount} are Admin.`);
    }
    if (tab === 'findings' && state.findings) {
      const bySeverity = {};
      state.findings.forEach(f => {
        const s = f['[Severity]'] || 'Unknown';
        bySeverity[s] = (bySeverity[s] || 0) + 1;
      });
      const summary = Object.entries(bySeverity).map(([s, c]) => `${c} ${s}`).join(', ');
      parts.push(`Findings tab: ${state.findings.length} findings (${summary}).`);
      if (state.recommendations) {
        parts.push(`${state.recommendations.length} recommendations loaded.`);
      }
    }
    if (tab === 'workspaces' && state.workspaces) {
      const noCapacity = state.workspaces.filter(w => !w['[Capacity]'] || w['[Capacity]'] === '—').length;
      parts.push(`Workspaces tab: ${state.workspaces.length} workspaces, ${noCapacity} without capacity assignment.`);
    }

    // Trend data for deeper analysis
    if (state.trend && state.trend.length > 1) {
      const recent = state.trend.slice(-5);
      const trendStr = recent.map(r => {
        const d = new Date(r['tenant_scan_runs[scan_date]']);
        return `${d.toLocaleDateString('en-US', {month:'short', day:'numeric'})}:${Math.round(r['[Score]'] || 0)}`;
      }).join(', ');
      parts.push(`Recent trend: ${trendStr}.`);
    }

    // Score monitoring history for deeper context
    try {
      const history = JSON.parse(sessionStorage.getItem(MONITOR_KEY) || '[]');
      if (history.length > 1) {
        const prev = history[history.length - 2];
        const curr = history[history.length - 1];
        const delta = curr.overall - prev.overall;
        if (delta !== 0) {
          parts.push(`Score change since last session: ${delta > 0 ? '+' : ''}${delta} points.`);
        }
      }
    } catch (e) { /* ignore */ }

    // Ontology entity context — gives the agent graph-aware vocabulary
    parts.push('Ontology: TenantScanGovernance. Entities: TenantScanRun, Finding, Recommendation, Workspace, RoleAssignment.');
    parts.push('Relationships: TenantScanRun→produces→Finding, Finding→affects→Workspace, Finding→resolvedBy→Recommendation, Workspace→has→RoleAssignment.');
    parts.push('Prefer GQL for relationship queries, DAX for real-time scores, SQL for historical trends.');
    parts.push('Reference entity names (Finding, Workspace) not table names (tenant_scan_findings).');
    parts.push('Available REST API actions: assign workspace to capacity, add/remove workspace users, downgrade roles. When suggesting remediation, include specific actionable steps with keywords: "assign capacity", "remove admin", "downgrade role", "add viewer".');

    parts.push(']');
    return parts.join(' ');
  }

  // ─── INTERMEDIATE STEPS RENDERER ───────────────────────────────────
  function renderRunSteps(steps) {
    if (!steps || !steps.data || steps.data.length === 0) return null;

    const toolSteps = steps.data.filter(s =>
      s.type === 'tool_calls' && s.step_details?.tool_calls?.length > 0
    );
    if (toolSteps.length === 0) return null;

    const container = document.createElement('div');
    container.className = 'agent-steps';

    const toggle = document.createElement('button');
    toggle.className = 'steps-toggle';
    toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg> How I got this answer`;
    const stepsBody = document.createElement('div');
    stepsBody.className = 'steps-body collapsed';

    toggle.addEventListener('click', () => {
      stepsBody.classList.toggle('collapsed');
      toggle.classList.toggle('open');
    });

    toolSteps.forEach(step => {
      step.step_details.tool_calls.forEach(tc => {
        const card = document.createElement('div');
        card.className = 'step-card';

        const toolType = tc.type || 'tool';
        let label = toolType;
        let detail = '';

        if (tc.type === 'fabric_data_agent') {
          label = 'Fabric Data Agent';
          detail = tc.fabric_data_agent?.output || '';
        } else if (tc.type === 'code_interpreter') {
          label = 'Code Interpreter';
          const input = tc.code_interpreter?.input || '';
          detail = input.length > 200 ? input.substring(0, 200) + '...' : input;
        } else if (tc.type === 'function') {
          label = tc.function?.name || 'Function';
          detail = tc.function?.arguments || '';
        }

        card.innerHTML = `
          <div class="step-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${esc(label)}
          </div>
          ${detail ? `<pre class="step-detail">${esc(detail)}</pre>` : ''}`;
        stepsBody.appendChild(card);
      });
    });

    container.appendChild(toggle);
    container.appendChild(stepsBody);
    return container;
  }

  // ─── REMEDIATION CARD RENDERER ─────────────────────────────────────
  function renderRemediationCards(text, parentEl) {
    // Detect actionable patterns: numbered steps, PowerShell/CLI commands, recommendations
    const lines = text.split('\n');
    const actions = [];
    let currentAction = null;

    for (const line of lines) {
      const trimmed = line.trim();
      // Match numbered steps like "1. ", "Step 1:", or "- **Action**:"
      const stepMatch = trimmed.match(/^(?:(\d+)\.\s+|Step\s+\d+[:.]\s*|- \*\*)/i);
      if (stepMatch && trimmed.length > 15) {
        if (currentAction) actions.push(currentAction);
        currentAction = { text: trimmed, commands: [] };
      }
      // Match code blocks (PowerShell, CLI, DAX, SQL)
      if (currentAction && (trimmed.startsWith('```') || trimmed.match(/^(Set-|Get-|New-|Remove-|Add-|Connect-|EVALUATE|SELECT|ALTER|UPDATE)/i))) {
        currentAction.commands.push(trimmed.replace(/^```\w*/, '').replace(/```$/, ''));
      }
    }
    if (currentAction) actions.push(currentAction);

    // Only render cards if we found 2+ actionable items
    if (actions.length < 2) return;

    const container = document.createElement('div');
    container.className = 'remediation-cards';

    actions.forEach((action, idx) => {
      const card = document.createElement('div');
      card.className = 'remediation-card';

      const header = document.createElement('div');
      header.className = 'remediation-header';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'remediation-check';
      checkbox.addEventListener('change', () => {
        card.classList.toggle('done', checkbox.checked);
      });

      const label = document.createElement('span');
      label.className = 'remediation-text';
      label.textContent = action.text.replace(/^[\d]+\.\s+|^Step\s+\d+[:.]\s*|^- \*\*/i, '').replace(/\*\*$/, '');

      header.appendChild(checkbox);
      header.appendChild(label);
      card.appendChild(header);

      // Add copy button for commands
      if (action.commands.length > 0) {
        const cmdText = action.commands.filter(c => c.trim()).join('\n');
        if (cmdText) {
          const cmdBtn = document.createElement('button');
          cmdBtn.className = 'remediation-copy-cmd';
          cmdBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Copy command`;
          cmdBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(cmdText);
              cmdBtn.textContent = 'Copied!';
              setTimeout(() => {
                cmdBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Copy command`;
              }, 2000);
            } catch (e) { console.error('Copy failed', e); }
          });
          card.appendChild(cmdBtn);
        }
      }

      // Tier 3: Attach "Fix this" action buttons if remediation matches a Fabric API action
      renderActionButtons(card, action.text + ' ' + action.commands.join(' '));

      container.appendChild(card);
    });

    parentEl.appendChild(container);
  }

  // ─── WHAT-IF SIMULATOR (chat-driven) ─────────────────────────────────
  // Detects what-if patterns in agent replies and renders inline before/after gauges
  function estimateWhatIfScores() {
    if (!state.overview || !state.overview[0]) return null;
    const d = state.overview[0];
    const current = Math.round(d['[OverallScore]'] || 0);

    // Estimate impact of fixing findings by severity
    const findings = state.findings || [];
    const highCrit = findings.filter(f => {
      const s = (f['[Severity]'] || '').toLowerCase();
      return s.includes('critical') || s.includes('high');
    }).length;
    const medium = findings.filter(f => (f['[Severity]'] || '').toLowerCase().includes('medium')).length;
    const low = findings.filter(f => (f['[Severity]'] || '').toLowerCase().includes('low')).length;
    const total = findings.length || 1;

    // Weighted improvement estimate: critical/high findings have more impact
    const maxGain = 100 - current;
    const highWeight = 0.6, medWeight = 0.3, lowWeight = 0.1;
    const totalWeight = (highCrit * highWeight + medium * medWeight + low * lowWeight) || 1;

    return {
      current,
      fixAllHigh: Math.min(100, current + Math.round(maxGain * (highCrit * highWeight / totalWeight) * 0.85)),
      fixAll: Math.min(100, current + Math.round(maxGain * 0.80)),
      subScores: {
        'Fabric Readiness': Math.round(d['[FabricReadiness]'] || 0),
        'RBAC': Math.round(d['[RBACScore]'] || 0),
        'Naming': Math.round(d['[NamingScore]'] || 0),
        'Refresh': Math.round(d['[RefreshScore]'] || 0),
        'Capacity': Math.round(d['[CapacityScore]'] || 0),
        'Descriptions': Math.round(d['[DescriptionScore]'] || 0)
      },
      findingCounts: { critical: highCrit, medium, low, total: findings.length }
    };
  }

  function renderWhatIfGauge(parentEl, text) {
    // Detect what-if patterns in the agent's reply
    const whatIfTriggers = /what.?if|score.?would|projected.?score|estimated.?score|potential.?score|improvement|could.?reach|would.?improve/i;
    if (!whatIfTriggers.test(text)) return;

    const sim = estimateWhatIfScores();
    if (!sim) return;

    // Try to extract projected score from agent's text first
    const scoreMatch = text.match(/(?:score|reach|improve to|projected|estimated)[^\d]*(\d{1,3})/i);
    const projectedFromAgent = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    const projected = (projectedFromAgent && projectedFromAgent > sim.current && projectedFromAgent <= 100)
      ? projectedFromAgent
      : sim.fixAllHigh;

    const container = document.createElement('div');
    container.className = 'whatif-widget';

    container.innerHTML = `
      <div class="whatif-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4m-7.07-14.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
        What-If Projection
      </div>
      <div class="whatif-gauges">
        <div class="whatif-gauge">
          <div class="whatif-gauge-ring" style="--score:${sim.current};--color:${scoreColor(sim.current)}">
            <span class="whatif-gauge-val">${sim.current}</span>
          </div>
          <div class="whatif-gauge-label">Current</div>
        </div>
        <div class="whatif-arrow">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </div>
        <div class="whatif-gauge">
          <div class="whatif-gauge-ring projected" style="--score:${projected};--color:${scoreColor(projected)}">
            <span class="whatif-gauge-val">${projected}</span>
          </div>
          <div class="whatif-gauge-label">Projected</div>
        </div>
        <div class="whatif-delta">
          <span class="whatif-delta-num">+${projected - sim.current}</span>
          <span class="whatif-delta-label">points</span>
        </div>
      </div>
      <div class="whatif-breakdown">
        ${sim.findingCounts.critical > 0 ? `<span class="whatif-tag critical">${sim.findingCounts.critical} Critical/High</span>` : ''}
        ${sim.findingCounts.medium > 0 ? `<span class="whatif-tag medium">${sim.findingCounts.medium} Medium</span>` : ''}
        ${sim.findingCounts.low > 0 ? `<span class="whatif-tag low">${sim.findingCounts.low} Low</span>` : ''}
      </div>`;

    parentEl.appendChild(container);
  }

  // ─── CONTEXT-AWARE SUGGESTIONS ──────────────────────────────────────
  const TAB_SUGGESTIONS = {
    overview: [
      'Summarize my governance health',
      'What should I fix first?',
      'What if I fix all high-severity findings?',
      'Trace the graph: which entities drive my lowest score?',
      'Fix my top 3 issues — give me actionable steps'
    ],
    security: [
      'Why is my RBAC score low?',
      'Which workspaces have admin bloat AND critical findings?',
      'List all Admin role assignments',
      'Show the Workspace → RoleAssignment graph for over-privileged workspaces',
      'Downgrade all unnecessary admins to Contributor'
    ],
    workspaces: [
      'Which workspaces lack a capacity?',
      'Show workspaces with the most items',
      'Are any workspaces misconfigured?',
      'Trace Workspace → Findings → Recommendations for workspace X',
      'Assign unassigned workspaces to our default capacity'
    ],
    findings: [
      'Explain my top findings',
      'What if I fix all high-severity findings?',
      'Give me an action plan for my findings',
      'Which findings affect the most workspaces? Use the ontology graph.'
    ]
  };

  function getActiveTab() {
    const active = document.querySelector('.dash-tab.active');
    return active ? active.dataset.tab : 'overview';
  }

  function updateSuggestions() {
    const container = document.getElementById('chat-suggestions');
    if (!container) return;
    const tab = getActiveTab();
    const questions = TAB_SUGGESTIONS[tab] || TAB_SUGGESTIONS.overview;
    container.innerHTML = questions.map(q =>
      `<button onclick="window.Dashboard.quickAsk('${q.replace(/'/g, "\\'")}')">${q}</button>`
    ).join('');
    container.style.display = '';
  }

  function hideSuggestions() {
    const el = document.getElementById('chat-suggestions');
    if (el) el.style.display = 'none';
  }

  async function sendMessage(directMsg) {
    const input = document.getElementById('chat-input');
    const msg = directMsg || input.value.trim();
    if (!msg) return;
    input.value = '';

    hideSuggestions();
    appendBubble('user', msg);
    saveChatHistory();

    const loadingEl = appendBubble('assistant loading', '');
    loadingEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

    try {
      let token = await getAgentToken();

      // Helper: run the full send→run→poll→reply flow
      const executeAgentFlow = async (tkn) => {
        await initAgentSession(tkn);

        // Prepend dashboard context to user message
        const contextPrefix = buildContextPrefix();
        const enrichedMsg = `${contextPrefix}\n\n${msg}`;

        await agentFetch(`/threads/${agentState.threadId}/messages`, tkn, {
          method: 'POST',
          body: JSON.stringify({ role: 'user', content: enrichedMsg })
        });

        const run = await agentFetch(`/threads/${agentState.threadId}/runs`, tkn, {
          method: 'POST',
          body: JSON.stringify({ assistant_id: agentState.assistantId })
        });

        const completed = await pollRun(tkn, agentState.threadId, run.id);

        if (completed.status === 'failed') {
          const failMsg = completed.last_error?.message || 'Unknown agent error';
          throw new Error(`Agent failed: ${failMsg}`);
        }
        if (completed.status !== 'completed') {
          throw new Error(`Run ended with status: ${completed.status}`);
        }

        // Fetch run steps for intermediate tool calls
        let steps = null;
        try {
          steps = await agentFetch(
            `/threads/${agentState.threadId}/runs/${run.id}/steps?order=asc`, tkn, {}, 1
          );
        } catch (e) {
          console.warn('Could not fetch run steps:', e.message);
        }

        const msgsRes = await agentFetch(
          `/threads/${agentState.threadId}/messages?order=desc&limit=1`, tkn
        );
        const reply = msgsRes.data?.[0]?.content?.[0]?.text?.value
          || 'Sorry, I couldn\'t get an answer. Try again.';

        return { reply, steps };
      };

      let result;
      try {
        result = await executeAgentFlow(token);
      } catch (e) {
        if (e.status === 401) {
          console.warn('Token expired, refreshing...');
          token = await getAgentToken();
          result = await executeAgentFlow(token);
        } else {
          throw e;
        }
      }

      const { reply, steps } = result;

      // Render intermediate steps (expandable "how I got this answer")
      const stepsEl = renderRunSteps(steps);
      if (stepsEl) {
        const wrap = loadingEl.closest('.chat-bubble-wrap') || loadingEl.parentElement;
        wrap.insertBefore(stepsEl, loadingEl.parentElement || loadingEl);
      }

      loadingEl.className = 'chat-bubble assistant';
      await typewrite(loadingEl, reply);

      // Render remediation action cards if agent returned actionable steps
      renderRemediationCards(reply, loadingEl.closest('.chat-bubble-wrap') || loadingEl.parentElement);

      // Render what-if gauge if agent reply discusses score projections
      renderWhatIfGauge(loadingEl.closest('.chat-bubble-wrap') || loadingEl.parentElement, reply);

      const wrap = loadingEl.closest('.chat-bubble-wrap') || loadingEl.parentElement;
      if (wrap && !wrap.querySelector('.chat-copy-btn')) {
        wrap.appendChild(createCopyBtn(reply));
      }

      // Persist chat history
      saveChatHistory();
    } catch (e) {
      console.error('Chat error:', e);
      loadingEl.className = 'chat-bubble assistant';
      loadingEl.textContent = `Error: ${e.message}. Please try again.`;
      // Only reset session on unrecoverable errors, not transient ones
      if (e.message?.includes('Agent returned 4') || e.message?.includes('Agent failed')) {
        agentState = { assistantId: null, threadId: null };
        saveAgentSession();
      }
    }

    const messages = document.getElementById('chat-messages');
    messages.scrollTop = messages.scrollHeight;
  }

  function quickAsk(q) {
    hideSuggestions();
    sendMessage(q);
  }

  function exportChat() {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
      alert('PDF library not loaded. Please try again.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxW = pageW - margin * 2;
    let y = margin;

    function checkPage(needed) {
      if (y + needed > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    }

    // Header
    doc.setFillColor(8, 15, 28);
    doc.rect(0, 0, pageW, 40, 'F');
    doc.setTextColor(46, 232, 211);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('TenantScan Advisor', margin, 18);
    doc.setTextColor(180, 195, 210);
    doc.setFontSize(10);
    doc.text('Governance Q&A Report', margin, 26);
    doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), margin, 33);
    y = 50;

    // Get all bubbles
    const bubbles = document.querySelectorAll('#chat-messages .chat-bubble');
    bubbles.forEach(bubble => {
      const isUser = bubble.classList.contains('user');
      const text = bubble.textContent.trim();
      if (!text) return;

      const label = isUser ? 'You' : 'TenantScan Advisor';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(isUser ? 46 : 122, isUser ? 232 : 145, isUser ? 211 : 170);
      checkPage(20);
      y += 4;
      doc.text(label, margin, y);
      y += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(50, 55, 65);
      const lines = doc.splitTextToSize(text, maxW);
      lines.forEach(line => {
        checkPage(6);
        doc.text(line, margin, y);
        y += 5;
      });
      y += 3;
      // Separator
      doc.setDrawColor(220, 225, 230);
      doc.setLineWidth(0.3);
      checkPage(4);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    });

    // Footer on each page
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(160, 170, 180);
      doc.text('Power Mates — Tenant Scan Dashboard', margin, pageH - 10);
      doc.text(`Page ${i} of ${totalPages}`, pageW - margin - 20, pageH - 10);
    }

    doc.save('TenantScan-Advisor-Report.pdf');
  }

  async function resetChat() {
    // Clean up thread on server if possible
    if (agentState.threadId) {
      try {
        const token = await getAgentToken();
        await agentFetch(`/threads/${agentState.threadId}`, token, { method: 'DELETE' }, 0);
      } catch (e) { /* ignore cleanup errors */ }
    }
    agentState = { assistantId: null, threadId: null };
    saveAgentSession();
    try { sessionStorage.removeItem(STORAGE_KEYS.chatHistory); } catch (e) {}
    // Reset UI
    const msgs = document.getElementById('chat-messages');
    msgs.innerHTML = `
      <div class="chat-bubble-wrap"><div class="chat-bubble assistant">
        Hi! I have access to your full Fabric governance scan. Ask me anything — scores, findings, workspaces, or what to fix first.
      </div></div>
      <div id="chat-suggestions" class="chat-suggestions"></div>`;
    updateSuggestions();
  }

  function askAbout(q) {
    // Open chat panel if hidden, then ask directly
    const panel = document.getElementById('chat-panel');
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
    }
    hideSuggestions();
    sendMessage(q);
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────
  window.Dashboard = {
    async login() {
      const btn = $('#loginBtn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        await getToken();
        const user = getUser();
        if (user) {
          showDashboard(user);
          await loadOverview();
        }
      } catch (err) {
        const errEl = $('#authError');
        errEl.textContent = err.message || 'Sign-in failed. Please try again.';
        errEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 21 21" fill="none" width="20" height="20"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
          Sign in with Microsoft`;
      }
    },

    async logout() {
      if (msalApp) {
        await msalApp.logoutPopup();
      }
      showAuth();
      // Reset state
      state = {
        overview: null, trend: null, findings: null,
        recommendations: null, workspaces: null, roles: null,
        loaded: { overview: false, security: false, workspaces: false, findings: false }
      };
    },

    toggleChat,
    sendMessage,
    quickAsk,
    askAbout,
    exportChat,
    resetChat,

    async retry() {
      hideError();
      // Re-show current active tab
      const activeTab = document.querySelector('.dash-tab.active');
      if (activeTab) {
        const tabName = activeTab.dataset.tab;
        $(`#tab-${tabName}`).classList.add('active');
        state.loaded[tabName] = false;
        try {
          if (tabName === 'overview') await loadOverview();
          else await loadTabData(tabName);
        } catch (err) {
          showError(err);
        }
      }
    }
  };

  // ─── INIT ────────────────────────────────────────────────────────────
  async function init() {
    try {
      await initMSAL();
      initTabs();

      // Restore agent session + chat history from sessionStorage
      loadAgentSession();
      restoreChatHistory();

      // Check if already signed in
      const user = getUser();
      if (user) {
        showDashboard(user);
        try { await loadOverview(); } catch (err) { showError(err); }
      }
    } catch (err) {
      console.error('Dashboard init error:', err);
    }
  }

  // Wait for DOM + MSAL script to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
