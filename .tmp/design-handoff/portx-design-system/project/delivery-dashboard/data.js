/* PortX Delivery Dashboard — mock data
 * 25 active integration projects, 18-person delivery team.
 * Data is generated deterministically so the dashboard is stable across reloads.
 */

(function () {
  const PHASES = [
    { key: 'discovery',    label: 'Discovery',    short: 'DSC' },
    { key: 'kickoff',      label: 'Kickoff',      short: 'KOF' },
    { key: 'requirements', label: 'Requirements', short: 'REQ' },
    { key: 'design',       label: 'Design',       short: 'DSG' },
    { key: 'build',        label: 'Build',        short: 'BLD' },
    { key: 'deploy',       label: 'Deploy',       short: 'DEP' },
    { key: 'uat',          label: 'UAT',          short: 'UAT' },
    { key: 'goLive',       label: 'Go Live',      short: 'GOL' },
    { key: 'hypercare',    label: 'Hypercare',    short: 'HYP' },
    { key: 'support',      label: 'Support',      short: 'SUP' },
  ];

  // 18 team members across the three roles
  const TEAM = [
    // Project Managers (6)
    { id: 'p1', name: 'Alex Paoloni',   role: 'PM', initials: 'AP', tone: '#7C3AED', startedAt: '2021-03-08' },
    { id: 'p2', name: 'Sarah Chen',     role: 'PM', initials: 'SC', tone: '#DB2777', startedAt: '2022-06-14' },
    { id: 'p3', name: 'David Wexler',   role: 'PM', initials: 'DW', tone: '#0EA5E9', startedAt: '2020-11-02' },
    { id: 'p4', name: 'Priya Patel',    role: 'PM', initials: 'PP', tone: '#F59E0B', startedAt: '2023-01-23' },
    { id: 'p5', name: 'Marcus Johnson', role: 'PM', initials: 'MJ', tone: '#10B981', startedAt: '2022-09-19' },
    { id: 'p6', name: 'Rebecca Lin',    role: 'PM', initials: 'RL', tone: '#EF4444', startedAt: '2024-04-08' },

    // Solution Architects (6)
    { id: 'a1', name: 'Jon Fancey',     role: 'SA', initials: 'JF', tone: '#06B6D4', startedAt: '2019-08-12' },
    { id: 'a2', name: 'Kent Brown',     role: 'SA', initials: 'KB', tone: '#8B5CF6', startedAt: '2020-02-04' },
    { id: 'a3', name: 'Diana Okafor',   role: 'SA', initials: 'DO', tone: '#F97316', startedAt: '2022-05-30' },
    { id: 'a4', name: 'Tomás Reyes',    role: 'SA', initials: 'TR', tone: '#14B8A6', startedAt: '2021-10-11' },
    { id: 'a5', name: 'Hiroshi Tanaka', role: 'SA', initials: 'HT', tone: '#6366F1', startedAt: '2023-07-25' },
    { id: 'a6', name: 'Maya Goldberg',  role: 'SA', initials: 'MG', tone: '#EC4899', startedAt: '2022-12-12' },

    // Solution Consultants (6)
    { id: 'c1', name: 'Ryan Haning',    role: 'SC', initials: 'RH', tone: '#22C55E', startedAt: '2023-03-15' },
    { id: 'c2', name: 'Emma Bauer',     role: 'SC', initials: 'EB', tone: '#A855F7', startedAt: '2024-01-09' },
    { id: 'c3', name: 'Carlos Mendez',  role: 'SC', initials: 'CM', tone: '#EAB308', startedAt: '2022-08-22' },
    { id: 'c4', name: 'Aisha Williams', role: 'SC', initials: 'AW', tone: '#3B82F6', startedAt: '2023-11-06' },
    { id: 'c5', name: 'Nikhil Sharma',  role: 'SC', initials: 'NS', tone: '#F43F5E', startedAt: '2024-06-17' },
    { id: 'c6', name: 'Olivia Park',    role: 'SC', initials: 'OP', tone: '#0891B2', startedAt: '2021-04-26' },
  ];

  const CORES = [
    'Fiserv DNA', 'Fiserv Premier', 'Jack Henry SilverLake',
    'Jack Henry Symitar', 'Corelation KeyStone', 'COCC Insight',
    'FIS Horizon', 'Mambu',
  ];

  // realistic-feeling but obviously fictional FI / fintech names
  const CUSTOMERS = [
    { name: 'Sound Credit Union',      type: 'cu',      core: 'Corelation KeyStone' },
    { name: 'Colony Bank',             type: 'bank',    core: 'Fiserv DNA' },
    { name: 'Plains Commerce Bank',    type: 'bank',    core: 'Jack Henry SilverLake' },
    { name: 'Cascade Federal CU',      type: 'cu',      core: 'Jack Henry Symitar' },
    { name: 'HarborOne Bank',          type: 'bank',    core: 'FIS Horizon' },
    { name: 'Midwest Community Bank',  type: 'bank',    core: 'Fiserv Premier' },
    { name: 'Iron Horse FCU',          type: 'cu',      core: 'Corelation KeyStone' },
    { name: 'Pacific Trust Bank',      type: 'bank',    core: 'Fiserv DNA' },
    { name: 'Summit Credit Union',     type: 'cu',      core: 'Jack Henry Symitar' },
    { name: 'Northland Savings',       type: 'bank',    core: 'COCC Insight' },
    { name: 'Riverbend Bank',          type: 'bank',    core: 'Jack Henry SilverLake' },
    { name: 'Sequoia FCU',             type: 'cu',      core: 'Corelation KeyStone' },
    { name: 'Beacon State Bank',       type: 'bank',    core: 'Fiserv Premier' },
    { name: 'Lakeshore Credit Union',  type: 'cu',      core: 'Jack Henry Symitar' },
    { name: 'Western Mutual Bank',     type: 'bank',    core: 'FIS Horizon' },
    { name: 'Stellar Banking',         type: 'fintech', core: 'Mambu' },
    { name: 'Atlas Lending',           type: 'fintech', core: 'Mambu' },
    { name: 'Apex Capital Co',         type: 'fintech', core: 'Mambu' },
    { name: 'Bluefin Treasury',        type: 'fintech', core: 'Mambu' },
    { name: 'Helix Financial',         type: 'fintech', core: 'Mambu' },
    { name: 'Foundry Credit Union',    type: 'cu',      core: 'Corelation KeyStone' },
    { name: 'Maritime Bank',           type: 'bank',    core: 'Fiserv DNA' },
    { name: 'Cornerstone Trust',       type: 'bank',    core: 'COCC Insight' },
    { name: 'Greenleaf Bank',          type: 'bank',    core: 'Jack Henry SilverLake' },
    { name: 'Frontier Credit Union',   type: 'cu',      core: 'Jack Henry Symitar' },
  ];

  // Each scope is a connector / fintech to wire in
  const CONNECTOR_LIB = [
    { name: 'Salesforce FSC',       cat: 'CRM' },
    { name: 'Encompass LOS',        cat: 'Lending' },
    { name: 'MeridianLink',         cat: 'Lending' },
    { name: 'Q2 Digital Banking',   cat: 'Digital Banking' },
    { name: 'Alkami',               cat: 'Digital Banking' },
    { name: 'nCino',                cat: 'Lending' },
    { name: 'MANTL',                cat: 'Account Opening' },
    { name: 'Plaid',                cat: 'Aggregation' },
    { name: 'Bottomline',           cat: 'Payments' },
    { name: 'Yodlee',               cat: 'Aggregation' },
    { name: 'FedNow Service',       cat: 'Payments' },
    { name: 'Nacha ACH',            cat: 'Payments' },
    { name: 'Fedwire',              cat: 'Payments' },
    { name: 'Zelle',                cat: 'Payments' },
    { name: 'Persona KYC',          cat: 'Compliance' },
    { name: 'Unit21 AML',           cat: 'Compliance' },
    { name: 'Snowflake',            cat: 'Data' },
    { name: 'HubSpot Marketing',    cat: 'CRM' },
  ];

  // Seeded RNG so the data is stable across page loads
  function rng(seed) {
    let s = seed;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function pickN(arr, n, r) {
    const copy = arr.slice();
    const out = [];
    for (let i = 0; i < n && copy.length; i++) {
      const idx = Math.floor(r() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  }

  function addMonths(date, m) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + m);
    return d;
  }

  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function shortDate(d) {
    if (!(d instanceof Date)) d = new Date(d);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const TODAY = new Date('2026-05-14'); // fix "today" for repeatable demo

  // Project status archetypes (so we have a variety of states represented)
  // currentPhase index, schedule, scope, budget, progress, monthsToGoLive
  const ARCHETYPES = [
    { phase: 0, sch: 'green', scope: 'green', bud: 'green', progress: 4,  goLiveOffset: 11 }, // brand new
    { phase: 1, sch: 'green', scope: 'green', bud: 'green', progress: 8,  goLiveOffset: 9 },
    { phase: 2, sch: 'amber', scope: 'green', bud: 'green', progress: 15, goLiveOffset: 8 },
    { phase: 2, sch: 'green', scope: 'amber', bud: 'green', progress: 18, goLiveOffset: 7 },
    { phase: 3, sch: 'green', scope: 'green', bud: 'green', progress: 28, goLiveOffset: 6 },
    { phase: 3, sch: 'amber', scope: 'amber', bud: 'green', progress: 30, goLiveOffset: 6 },
    { phase: 4, sch: 'green', scope: 'green', bud: 'green', progress: 45, goLiveOffset: 5 },
    { phase: 4, sch: 'red',   scope: 'amber', bud: 'amber', progress: 38, goLiveOffset: 4 },
    { phase: 4, sch: 'green', scope: 'green', bud: 'amber', progress: 50, goLiveOffset: 4 },
    { phase: 4, sch: 'amber', scope: 'green', bud: 'green', progress: 48, goLiveOffset: 4 },
    { phase: 5, sch: 'green', scope: 'green', bud: 'green', progress: 62, goLiveOffset: 3 },
    { phase: 5, sch: 'amber', scope: 'amber', bud: 'green', progress: 58, goLiveOffset: 3 },
    { phase: 6, sch: 'green', scope: 'green', bud: 'green', progress: 72, goLiveOffset: 2 },
    { phase: 6, sch: 'red',   scope: 'red',   bud: 'amber', progress: 65, goLiveOffset: 1 },
    { phase: 6, sch: 'amber', scope: 'green', bud: 'green', progress: 75, goLiveOffset: 2 },
    { phase: 7, sch: 'green', scope: 'green', bud: 'green', progress: 88, goLiveOffset: 0 },
    { phase: 7, sch: 'amber', scope: 'green', bud: 'amber', progress: 85, goLiveOffset: 1 },
    { phase: 8, sch: 'green', scope: 'green', bud: 'green', progress: 94, goLiveOffset: -1 },
    { phase: 8, sch: 'green', scope: 'green', bud: 'amber', progress: 92, goLiveOffset: -1 },
    { phase: 9, sch: 'green', scope: 'green', bud: 'green', progress: 100, goLiveOffset: -3 },
    { phase: 9, sch: 'green', scope: 'green', bud: 'green', progress: 100, goLiveOffset: -2 },
    { phase: 5, sch: 'green', scope: 'amber', bud: 'green', progress: 55, goLiveOffset: 3 },
    { phase: 3, sch: 'amber', scope: 'green', bud: 'red',   progress: 25, goLiveOffset: 6 },
    { phase: 1, sch: 'green', scope: 'green', bud: 'green', progress: 6,  goLiveOffset: 10 },
    { phase: 6, sch: 'green', scope: 'green', bud: 'green', progress: 80, goLiveOffset: 1 },
  ];

  function rollHealth(arch) {
    return { schedule: arch.sch, scope: arch.scope, budget: arch.bud };
  }
  function worstHealth(h) {
    if (h.schedule === 'red' || h.scope === 'red' || h.budget === 'red') return 'red';
    if (h.schedule === 'amber' || h.scope === 'amber' || h.budget === 'amber') return 'amber';
    return 'green';
  }

  // Generate ~10 milestone segments per project for the Gantt
  function buildMilestones(currentPhase, kickoff, goLive) {
    const totalMs = goLive.getTime() - kickoff.getTime();
    const out = [];
    // Distribute the 10 phases across the timeline with some natural weighting
    const weights = [0.06, 0.04, 0.08, 0.12, 0.28, 0.08, 0.12, 0.04, 0.08, 0.10];
    let acc = 0;
    weights.forEach((w, i) => {
      const start = new Date(kickoff.getTime() + acc * totalMs);
      acc += w;
      const end = new Date(kickoff.getTime() + acc * totalMs);
      let status = 'upcoming';
      if (i < currentPhase) status = 'done';
      else if (i === currentPhase) status = 'active';
      out.push({ phase: PHASES[i], start, end, status });
    });
    return out;
  }

  function buildBurnup(progress, estimatedHrs, weeks) {
    const out = [];
    let cumActual = 0;
    let cumScope = estimatedHrs * 0.85;
    const planSlope = estimatedHrs / weeks;
    const actualSlope = (estimatedHrs * (progress / 100)) / Math.max(weeks * (progress / 100), 1);
    for (let w = 0; w < weeks; w++) {
      const isPast = w <= Math.floor(weeks * (progress / 100));
      // Scope can grow slightly (scope creep) over time
      if (w === Math.floor(weeks * 0.3)) cumScope = estimatedHrs * 0.95;
      if (w === Math.floor(weeks * 0.6)) cumScope = estimatedHrs * 1.02;
      const plan = Math.min(planSlope * (w + 1), estimatedHrs);
      const actual = isPast ? Math.min(actualSlope * (w + 1) * (0.9 + Math.random() * 0.25), cumScope) : null;
      if (actual !== null) cumActual = actual;
      out.push({
        week: w + 1,
        plan: Math.round(plan),
        scope: Math.round(cumScope),
        actual: actual === null ? null : Math.round(actual),
      });
    }
    return out;
  }

  const GH_VERBS = [
    'opened PR', 'merged PR', 'pushed to', 'reviewed PR', 'commented on issue',
    'closed issue', 'deployed', 'tagged release', 'opened issue', 'requested review on',
  ];
  const GH_TARGETS = [
    'feat/orca-account-search', 'fix/ach-validation-edge-case', 'main',
    'release/2026.04', 'feat/fednow-webhook', 'fix/swift-mt103-parser',
    'feat/customer360-stream', 'chore/bump-pixi-sdk', 'docs/runbook',
    'feat/wire-approval-workflow', 'fix/data-mapper-null-pivot',
  ];
  function buildGitHub(seed, count) {
    const r = rng(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = new Date(TODAY.getTime() - i * (8 + r() * 18) * 3600 * 1000);
      const person = TEAM[Math.floor(r() * TEAM.length)];
      out.push({
        when: t,
        actor: person,
        verb: GH_VERBS[Math.floor(r() * GH_VERBS.length)],
        target: GH_TARGETS[Math.floor(r() * GH_TARGETS.length)],
        sha: Math.floor(r() * 16777215).toString(16).padStart(7, '0'),
      });
    }
    return out;
  }

  const ARTIFACT_TYPES = [
    { type: 'SOW', icon: '📄', tag: 'PDF' },
    { type: 'Solution Design Doc', icon: '🏗', tag: 'Confluence' },
    { type: 'Architecture Diagram', icon: '🗺', tag: 'Figma' },
    { type: 'Integration Runbook', icon: '📘', tag: 'Confluence' },
    { type: 'Data Mapping Spec', icon: '🧬', tag: 'Sheet' },
    { type: 'Test Plan', icon: '🧪', tag: 'Doc' },
    { type: 'Go-Live Checklist', icon: '✅', tag: 'Doc' },
    { type: 'Risk Register', icon: '⚠️', tag: 'Sheet' },
  ];
  function buildArtifacts(seed, phaseIdx) {
    const r = rng(seed);
    // earlier phases have fewer artifacts; later phases have most
    const available = ARTIFACT_TYPES.slice(0, Math.min(ARTIFACT_TYPES.length, 3 + phaseIdx));
    return available.map(a => ({
      ...a,
      updatedAt: new Date(TODAY.getTime() - Math.floor(r() * 30) * 86400000),
      updatedBy: TEAM[Math.floor(r() * TEAM.length)],
    }));
  }

  // Build the 25 projects
  const PROJECTS = CUSTOMERS.map((cust, i) => {
    const r = rng(i * 137 + 9);
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const kickoff = addMonths(TODAY, -(9 - arch.goLiveOffset));
    const goLive = addMonths(TODAY, arch.goLiveOffset);
    const phase = PHASES[arch.phase];

    // 3-6 connectors in scope
    const connectorCount = 3 + Math.floor(r() * 4);
    const integrations = pickN(CONNECTOR_LIB, connectorCount, r).map((c, j) => ({
      ...c,
      // status mirrors phase progression of the project
      status:
        j < Math.floor((arch.progress / 100) * connectorCount) ? 'done'
        : j === Math.floor((arch.progress / 100) * connectorCount) ? 'in-progress'
        : 'planned',
    }));

    // Always include the core as an integration
    integrations.unshift({ name: cust.core, cat: 'Banking Core', status: arch.progress > 20 ? 'done' : 'in-progress' });

    // Assign team
    const pms = TEAM.filter(t => t.role === 'PM');
    const sas = TEAM.filter(t => t.role === 'SA');
    const scs = TEAM.filter(t => t.role === 'SC');
    const pm = pms[i % pms.length];
    const sa = sas[i % sas.length];
    const sc = scs[i % scs.length];
    // Maybe add a second SC for larger projects
    const extraSc = arch.progress > 30 && arch.progress < 90 && i % 2 === 0
      ? scs[(i + 3) % scs.length]
      : null;

    const project = {
      id: 'PRJ-' + String(1024 + i).padStart(4, '0'),
      name: `${cust.name} — ${integrations[1] ? integrations[1].name : 'Core'} Integration`,
      shortName: cust.name,
      customer: cust.name,
      customerType: cust.type, // bank / cu / fintech
      core: cust.core,
      phase,
      phaseIndex: arch.phase,
      health: rollHealth(arch),
      progress: arch.progress,
      kickoff,
      goLive,
      pm, sa, sc,
      teamExtras: extraSc ? [extraSc] : [],
      integrations,
      blockers: arch.sch === 'red' ? 2 + Math.floor(r() * 2) : arch.sch === 'amber' ? Math.floor(r() * 2) : 0,
      lastUpdate: new Date(TODAY.getTime() - Math.floor(r() * 6) * 86400000),
      description:
        cust.type === 'fintech'
          ? `${cust.name} is integrating with PortX Integration Manager to connect their ${integrations[1]?.cat || 'platform'} stack to multiple core banking partners via ORCA. Includes onboarding to the Connect Marketplace.`
          : `${cust.name} is modernizing their integration foundation on PortX. Replacing point-to-point ${cust.core} integrations with a reusable, API-led layer that supports Customer360 and real-time payments.`,
      milestones: buildMilestones(arch.phase, kickoff, goLive),
      github: buildGitHub(i * 31 + 5, 14),
      artifacts: buildArtifacts(i * 19 + 7, arch.phase),
    };

    // Build burnup using the rough kickoff→goLive duration in weeks
    const totalWeeks = Math.max(8, Math.round((goLive - kickoff) / (7 * 86400000)));
    const estHrs = 240 + Math.round(r() * 8) * 80;
    project.burnup = buildBurnup(arch.progress, estHrs, totalWeeks);
    project.estimatedHrs = estHrs;
    project.actualHrs = project.burnup.filter(b => b.actual !== null).slice(-1)[0]?.actual || 0;

    return project;
  });

  // --- Capacity allocation
  // Distribute team across projects: each PM owns 3-5 projects at ~20-30% each;
  // SAs across 2-4 at 30-50%; SCs across 2-3 at 30-60%.
  const ALLOCATIONS = {}; // personId -> [{projectId, pct}]
  TEAM.forEach(p => (ALLOCATIONS[p.id] = []));

  PROJECTS.forEach((proj, i) => {
    const r = rng(i * 11 + 3);
    const pmPct = 15 + Math.floor(r() * 16); // 15-30
    ALLOCATIONS[proj.pm.id].push({ projectId: proj.id, pct: pmPct });
    const saPct = 25 + Math.floor(r() * 26); // 25-50
    ALLOCATIONS[proj.sa.id].push({ projectId: proj.id, pct: saPct });
    const scPct = 30 + Math.floor(r() * 31); // 30-60
    ALLOCATIONS[proj.sc.id].push({ projectId: proj.id, pct: scPct });
    proj.teamExtras.forEach(extra => {
      ALLOCATIONS[extra.id].push({ projectId: proj.id, pct: 20 + Math.floor(r() * 21) });
    });
  });

  // Compute total allocation per person — capped at sane values
  TEAM.forEach(p => {
    const total = ALLOCATIONS[p.id].reduce((s, a) => s + a.pct, 0);
    p.allocatedPct = total;
    p.projectsAssigned = ALLOCATIONS[p.id].length;
  });

  // Capacity status helper
  function capacityStatus(pct) {
    if (pct >= 100) return 'over';
    if (pct >= 85) return 'high';
    if (pct >= 50) return 'healthy';
    if (pct > 0) return 'low';
    return 'bench';
  }

  // Aggregated team summary
  const TEAM_SUMMARY = {
    total: TEAM.length,
    byRole: {
      PM: TEAM.filter(t => t.role === 'PM').length,
      SA: TEAM.filter(t => t.role === 'SA').length,
      SC: TEAM.filter(t => t.role === 'SC').length,
    },
    avgAllocation: Math.round(TEAM.reduce((s, p) => s + p.allocatedPct, 0) / TEAM.length),
    over: TEAM.filter(t => t.allocatedPct >= 100).length,
    high: TEAM.filter(t => t.allocatedPct >= 85 && t.allocatedPct < 100).length,
    healthy: TEAM.filter(t => t.allocatedPct >= 50 && t.allocatedPct < 85).length,
    low: TEAM.filter(t => t.allocatedPct > 0 && t.allocatedPct < 50).length,
    bench: TEAM.filter(t => t.allocatedPct === 0).length,
  };

  // Portfolio summary
  const PORTFOLIO_SUMMARY = {
    total: PROJECTS.length,
    onTrack: PROJECTS.filter(p => worstHealth(p.health) === 'green').length,
    atRisk: PROJECTS.filter(p => worstHealth(p.health) === 'amber').length,
    blocked: PROJECTS.filter(p => worstHealth(p.health) === 'red').length,
    goingLiveSoon: PROJECTS.filter(p => {
      const days = (p.goLive - TODAY) / 86400000;
      return days >= 0 && days <= 60 && p.phaseIndex < 8;
    }).length,
    inHypercare: PROJECTS.filter(p => p.phaseIndex === 8 || p.phaseIndex === 9).length,
  };

  // Export to window for the other scripts
  window.PORTX_DATA = {
    PHASES,
    TEAM,
    CORES,
    PROJECTS,
    ALLOCATIONS,
    TEAM_SUMMARY,
    PORTFOLIO_SUMMARY,
    TODAY,
    helpers: { worstHealth, capacityStatus, shortDate, fmtDate },
  };
})();
