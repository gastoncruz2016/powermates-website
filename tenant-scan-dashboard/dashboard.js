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

    // Filter
    $('#rolesFilter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = state.roles.filter(r =>
        (r['[Workspace]'] || '').toLowerCase().includes(q) ||
        (r['[Role]'] || '').toLowerCase().includes(q) ||
        (r['[Principal]'] || '').toLowerCase().includes(q) ||
        (r['[Type]'] || '').toLowerCase().includes(q)
      );
      populateRolesTable(filtered);
    });
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

    $('#workspacesFilter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = state.workspaces.filter(r =>
        (r['[Name]'] || '').toLowerCase().includes(q) ||
        (r['[Type]'] || '').toLowerCase().includes(q) ||
        (r['[Capacity]'] || '').toLowerCase().includes(q)
      );
      populateWorkspacesTable(filtered);
    });
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

    $('#findingsFilter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = state.findings.filter(r =>
        (r['[Finding]'] || '').toLowerCase().includes(q) ||
        (r['[Category]'] || '').toLowerCase().includes(q) ||
        (r['[Severity]'] || '').toLowerCase().includes(q) ||
        (r['[Detail]'] || '').toLowerCase().includes(q)
      );
      populateFindingsGrid(filtered);
    });
  }

  function populateFindingsGrid(data) {
    const grid = $('#findingsGrid');
    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No Findings</h3><p>No governance findings in the latest scan.</p></div>';
      return;
    }
    grid.innerHTML = data.map(r => `
      <div class="card finding-card">
        <div class="finding-content">
          <div class="finding-text">${esc(r['[Finding]'])}</div>
          ${r['[Detail]'] ? `<div class="finding-detail">${esc(r['[Detail]'])}</div>` : ''}
          <div class="finding-meta">
            <span class="badge ${severityClass(r['[Severity]'])}">${esc(r['[Severity]'])}</span>
            <span class="badge badge-category">${esc(r['[Category]'])}</span>
          </div>
        </div>
      </div>`).join('');
  }

  function populateRecsGrid(data) {
    const grid = $('#recsGrid');
    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No Recommendations</h3><p>Check back after your next scan.</p></div>';
      return;
    }
    grid.innerHTML = data.map(r => `
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
      </div>`).join('');
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
  const chatHistory = [];
  let agentToken = null;

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

  function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      document.getElementById('chat-input').focus();
    }
  }

  function appendBubble(cls, text) {
    const messages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-bubble ${cls}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function hideSuggestions() {
    const suggestions = document.querySelector('.chat-suggestions');
    if (suggestions) suggestions.style.display = 'none';
  }

  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    hideSuggestions();
    appendBubble('user', msg);
    chatHistory.push({ role: 'user', content: msg });

    const loadingEl = appendBubble('assistant loading', 'Thinking...');

    try {
      const token = await getAgentToken();
      const res = await fetch(
        `https://api.fabric.microsoft.com/v1/workspaces/${CONFIG.workspaceId}/aifoundry/dataAgents/${CONFIG.agentId}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messages: chatHistory,
            stream: false
          })
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error('Agent API error:', res.status, errText);
        throw new Error(`Agent returned ${res.status}`);
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I couldn\'t get an answer. Try again.';
      chatHistory.push({ role: 'assistant', content: reply });
      loadingEl.className = 'chat-bubble assistant';
      loadingEl.textContent = reply;
    } catch (e) {
      console.error('Chat error:', e);
      loadingEl.className = 'chat-bubble assistant';
      loadingEl.textContent = 'Connection error. Please try again.';
    }

    const messages = document.getElementById('chat-messages');
    messages.scrollTop = messages.scrollHeight;
  }

  function quickAsk(q) {
    document.getElementById('chat-input').value = q;
    sendMessage();
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
      // Check if already signed in
      const user = getUser();
      if (user) {
        showDashboard(user);
        await loadOverview();
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
