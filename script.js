/* ============================================================
   FIFA WORLD CUP 2026 — MAIN SCRIPT
   Features: Data loading, filtering, search, countdowns,
             match cards, standings, match detail modal,
             live simulation, PWA registration
   ============================================================ */

'use strict';

/* ===================== STATE ===================== */
const state = {
  data:         null,       // Raw JSON from matches.json
  teams:        {},         // Keyed by team ID
  stadiums:     {},         // Keyed by stadium ID
  matches:      [],         // Processed match objects
  filtered:     [],         // Currently visible matches
  activeTab:    'all',
  activeStage:  'all',
  searchQuery:  '',
  modalMatchId: null,
  countdownTimers: {},      // Per-card countdown intervals
  liveSimInterval: null,    // Simulated live match ticking
  heroCountdownInterval: null,
  modalCountdownInterval: null,
};

/* ===================== DOM REFS ===================== */
const dom = {
  matchesList:        document.getElementById('matchesList'),
  matchesEmpty:       document.getElementById('matchesEmpty'),
  matchesView:        document.getElementById('matchesView'),
  standingsView:      document.getElementById('standingsView'),
  standingsContainer: document.getElementById('standingsContainer'),
  tabBtns:            document.querySelectorAll('.tab-btn'),
  bnavBtns:           document.querySelectorAll('.bnav-btn'),
  chips:              document.querySelectorAll('.chip'),
  searchToggle:       document.getElementById('searchToggleBtn'),
  searchBar:          document.getElementById('searchBar'),
  searchInput:        document.getElementById('searchInput'),
  searchClear:        document.getElementById('searchClear'),
  matchModal:         document.getElementById('matchModal'),
  modalBox:           document.getElementById('modalBox'),
  modalContent:       document.getElementById('modalContent'),
  modalClose:         document.getElementById('modalClose'),
  cdDays:             document.getElementById('cdDays'),
  cdHours:            document.getElementById('cdHours'),
  cdMins:             document.getElementById('cdMins'),
  cdSecs:             document.getElementById('cdSecs'),
  heroCountdown:      document.getElementById('heroCountdown'),
  filterChips:        document.getElementById('filterChips'),
};

/* ===================== INIT ===================== */
async function init() {
  try {
    const res  = await fetch('matches.json');
    const json = await res.json();
    processData(json);
    renderAll();
    startHeroCountdown();
    startLiveSimulation();
    bindEvents();
    handleDeepLink();
    registerServiceWorker();
  } catch (err) {
    console.error('Failed to load match data:', err);
    showError();
  }
}

/* ===================== DATA PROCESSING ===================== */
function processData(json) {
  state.data = json;

  // Index teams
  json.teams.forEach(t => { state.teams[t.id] = t; });

  // Index stadiums
  json.stadiums.forEach(s => { state.stadiums[s.id] = s; });

  // Process matches — attach team + stadium objects
  state.matches = json.matches.map(m => {
    const home    = state.teams[m.homeTeam] || makeTBD(m.homeTeam);
    const away    = state.teams[m.awayTeam] || makeTBD(m.awayTeam);
    const stadium = state.stadiums[m.stadiumId] || { name: 'TBD', city: 'TBD' };
    return { ...m, home, away, stadium };
  });

  state.filtered = [...state.matches];
}

// Fallback team for TBD entries
function makeTBD(id) {
  return { id, name: 'TBD', flag: '🏳️', group: '-' };
}

/* ===================== DEEP LINK ===================== */
// Support ?tab=live / ?tab=today etc. in URL (used by PWA shortcuts)
function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab) switchTab(tab);
}

/* ===================== FILTER & SEARCH ===================== */
function applyFilters() {
  const q     = state.searchQuery.trim().toLowerCase();
  const tab   = state.activeTab;
  const stage = state.activeStage;

  state.filtered = state.matches.filter(m => {
    // Tab filter
    if (tab === 'live'     && m.status !== 'live')     return false;
    if (tab === 'today'    && !isToday(m.utcDate))     return false;
    if (tab === 'upcoming' && m.status !== 'upcoming') return false;
    if (tab === 'finished' && m.status !== 'finished') return false;

    // Stage chip
    if (stage !== 'all') {
      if (stage === 'Group' && !m.stage.startsWith('Group'))  return false;
      if (stage !== 'Group' && m.stage !== stage)              return false;
    }

    // Search
    if (q) {
      const searchable = [
        m.home.name, m.away.name, m.stadium.name, m.stadium.city, m.stage,
        m.home.group, m.away.group,
        m.label || ''
      ].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    return true;
  });

  renderMatches();
}

/**
 * isToday — timezone-safe comparison.
 * Converts both dates to locale date strings so the comparison
 * always reflects the user's local calendar day, regardless of
 * how far the UTC timestamp crosses midnight.
 */
function isToday(utcDate) {
  const toLocalDateStr = dt =>
    dt.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return toLocalDateStr(new Date(utcDate)) === toLocalDateStr(new Date());
}

/* ===================== RENDER ===================== */
function renderAll() {
  applyFilters();
  renderStandings();
  updateLiveBadge();
}

/* --- MATCH CARDS --- */
function renderMatches() {
  // Clear existing countdown timers
  Object.values(state.countdownTimers).forEach(clearInterval);
  state.countdownTimers = {};

  const list = state.filtered;

  if (list.length === 0) {
    dom.matchesList.hidden = true;
    dom.matchesEmpty.hidden = false;
    return;
  }

  dom.matchesList.hidden = false;
  dom.matchesEmpty.hidden = true;

  // Group matches by stage for section headers
  const grouped = groupByStage(list);
  const frag    = document.createDocumentFragment();

  grouped.forEach(({ stage, matches }) => {
    const header = document.createElement('div');
    header.className = 'stage-group-header';
    header.setAttribute('role', 'heading');
    header.setAttribute('aria-level', '2');
    header.innerHTML = `
      <span class="stage-group-label">${escHtml(stage)}</span>
      <span class="stage-group-line" aria-hidden="true"></span>
    `;
    frag.appendChild(header);

    matches.forEach(m => {
      const card = buildMatchCard(m);
      frag.appendChild(card);
    });
  });

  dom.matchesList.innerHTML = '';
  dom.matchesList.appendChild(frag);
}

function groupByStage(matches) {
  const order = [
    'Group A','Group B','Group C','Group D','Group E','Group F',
    'Group G','Group H','Group I','Group J','Group K','Group L',
    'Round of 32','Round of 16','Quarter Final','Semi Final','Third Place','Final'
  ];

  const map = new Map();
  matches.forEach(m => {
    if (!map.has(m.stage)) map.set(m.stage, []);
    map.get(m.stage).push(m);
  });

  const sorted = [];
  order.forEach(s => { if (map.has(s)) sorted.push({ stage: s, matches: map.get(s) }); });
  map.forEach((v, k) => {
    if (!order.includes(k)) sorted.push({ stage: k, matches: v });
  });

  return sorted;
}

function buildMatchCard(m) {
  const card = document.createElement('div');
  card.className = `match-card${m.status === 'live' ? ' is-live' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${m.home.name} vs ${m.away.name}, ${m.stage}`);
  card.dataset.matchId = m.id;

  card.innerHTML = buildCardHTML(m);

  card.addEventListener('click', () => openModal(m.id));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(m.id); }
  });

  if (m.status === 'upcoming') {
    startCardCountdown(card, m);
  }

  return card;
}

function buildCardHTML(m) {
  const statusBadge = buildStatusBadge(m);
  const scoreArea   = buildScoreArea(m);
  const goals       = buildGoalsSnippet(m);
  const venue       = `${m.stadium.name} · ${m.stadium.city}`;
  const countdown   = m.status === 'upcoming'
    ? `<span class="card-countdown" data-utc="${m.utcDate}"></span>` : '';

  // For knockout TBD matches, show the label if available
  const stageLabel = m.label
    ? `<span class="card-stage" title="${escHtml(m.label)}">${escHtml(m.stage)}</span>`
    : `<span class="card-stage">${escHtml(m.stage)}</span>`;

  return `
    <div class="card-top">
      <div class="card-status">${statusBadge}</div>
      ${stageLabel}
    </div>
    <div class="card-teams">
      <div class="card-team card-team-home">
        <span class="team-flag" role="img" aria-label="${escHtml(m.home.name)} flag">${m.home.flag}</span>
        <span class="team-name">${escHtml(m.home.name)}</span>
      </div>
      ${scoreArea}
      <div class="card-team card-team-away">
        <span class="team-flag" role="img" aria-label="${escHtml(m.away.name)} flag">${m.away.flag}</span>
        <span class="team-name">${escHtml(m.away.name)}</span>
      </div>
    </div>
    ${goals}
    <div class="card-bottom">
      <div class="card-venue">
        <span class="card-venue-icon" aria-hidden="true">📍</span>
        <span class="card-venue-text"><strong>${escHtml(m.stadium.name)}</strong> · ${escHtml(m.stadium.city)}</span>
      </div>
      ${countdown}
    </div>
  `;
}

function buildStatusBadge(m) {
  if (m.status === 'live') {
    return `<span class="badge badge-live">
      <span class="badge-live-dot" aria-hidden="true"></span>LIVE
    </span>
    <span class="card-minute">${m.liveMinute || 45}'</span>`;
  }
  if (m.status === 'finished') {
    return `<span class="badge badge-ft">FT</span>`;
  }
  return `<span class="badge-upcoming">${formatLocalDateTime(m.utcDate)}</span>`;
}

function buildScoreArea(m) {
  if (m.status === 'live' || m.status === 'finished') {
    const h = m.score.home ?? 0;
    const a = m.score.away ?? 0;
    return `
      <div class="card-score-area">
        <div class="score-display">
          <span>${h}</span>
          <span class="score-sep">–</span>
          <span>${a}</span>
        </div>
      </div>`;
  }
  return `
    <div class="card-score-area">
      <span class="score-vs">vs</span>
      <span class="card-time-display">${formatLocalTime(m.utcDate)}</span>
    </div>`;
}

function buildGoalsSnippet(m) {
  if (!m.goals || m.goals.length === 0) return '';

  const items = m.goals.slice(0, 4).map(g =>
    `<div class="goal-event">
      ${g.teamFlag || ''} <span>${g.minute}'</span> ${escHtml(g.player)}
    </div>`
  ).join('');

  return `<div class="card-goals">${items}</div>`;
}

/* --- STANDINGS --- */
function renderStandings() {
  const groups = 'ABCDEFGHIJKL'.split('');
  const frag   = document.createDocumentFragment();

  groups.forEach(g => {
    const groupTeams = Object.values(state.teams).filter(t => t.group === g);
    if (groupTeams.length === 0) return;

    const standings = computeGroupStandings(g, groupTeams);
    const el        = buildStandingsGroupEl(g, standings);
    frag.appendChild(el);
  });

  dom.standingsContainer.innerHTML = '';
  dom.standingsContainer.appendChild(frag);
}

function computeGroupStandings(group, teams) {
  const stats = {};
  teams.forEach(t => {
    stats[t.id] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  });

  state.matches.forEach(m => {
    if (!m.stage.startsWith('Group ' + group)) return;
    if (m.status !== 'finished' && m.status !== 'live') return;
    if (!stats[m.homeTeam] || !stats[m.awayTeam]) return;

    const h   = m.score.home ?? 0;
    const a   = m.score.away ?? 0;
    const hs  = stats[m.homeTeam];
    const as_ = stats[m.awayTeam];

    hs.p++; as_.p++;
    hs.gf += h; hs.ga += a;
    as_.gf += a; as_.ga += h;

    if (h > a)      { hs.w++; hs.pts += 3; as_.l++; }
    else if (h < a) { as_.w++; as_.pts += 3; hs.l++; }
    else            { hs.d++; hs.pts++; as_.d++; as_.pts++; }
  });

  return Object.values(stats).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}

function buildStandingsGroupEl(group, rows) {
  const div = document.createElement('div');
  div.className = 'standings-group';

  const tableRows = rows.map((r, i) => {
    const gd       = r.gf - r.ga;
    const gdClass  = gd > 0 ? 'positive' : gd < 0 ? 'negative' : '';
    const posClass = i < 2 ? 'qualify' : i === 2 ? 'playoff' : '';
    return `
      <tr>
        <td><span class="standing-pos ${posClass}">${i + 1}</span></td>
        <td>
          <div class="standing-team">
            <span class="standing-flag" role="img" aria-label="${escHtml(r.team.name)}">${r.team.flag}</span>
            <span class="standing-name">${escHtml(r.team.name)}</span>
          </div>
        </td>
        <td>${r.p}</td>
        <td>${r.w}</td>
        <td>${r.d}</td>
        <td>${r.l}</td>
        <td><span class="standing-gd ${gdClass}">${gd > 0 ? '+' : ''}${gd}</span></td>
        <td><strong class="standing-pts">${r.pts}</strong></td>
      </tr>`;
  }).join('');

  div.innerHTML = `
    <div class="standings-group-header">
      <span class="standings-group-name">Group ${escHtml(group)}</span>
    </div>
    <table class="standings-table" aria-label="Group ${escHtml(group)} standings">
      <thead>
        <tr>
          <th aria-label="Position">#</th>
          <th>Team</th>
          <th aria-label="Played">P</th>
          <th aria-label="Won">W</th>
          <th aria-label="Drawn">D</th>
          <th aria-label="Lost">L</th>
          <th aria-label="Goal difference">GD</th>
          <th aria-label="Points">Pts</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="standings-legend">
      <div class="legend-item"><span class="legend-dot qualify"></span>Advance to R32</div>
      <div class="legend-item"><span class="legend-dot playoff"></span>Play-off spot</div>
    </div>
  `;

  return div;
}

/* ===================== MODAL ===================== */
function openModal(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  state.modalMatchId = matchId;

  dom.modalContent.innerHTML = buildModalHTML(m);
  dom.matchModal.hidden = false;
  document.body.style.overflow = 'hidden';

  if (m.status === 'upcoming') {
    startModalCountdown(m);
  }

  requestAnimationFrame(() => {
    document.querySelectorAll('.stat-bar-fill[data-pct]').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });

  dom.modalClose.focus();
}

function closeModal() {
  dom.matchModal.hidden = true;
  document.body.style.overflow = '';
  state.modalMatchId = null;
  if (state.modalCountdownInterval) {
    clearInterval(state.modalCountdownInterval);
    state.modalCountdownInterval = null;
  }
}

function buildModalHTML(m) {
  const statusClass = m.status === 'live' ? 'live' : m.status === 'finished' ? 'ft' : 'upcoming';
  const statusLabel = m.status === 'live'
    ? `LIVE ${m.liveMinute || 45}'`
    : m.status === 'finished'
      ? 'Full Time'
      : formatLocalDateTime(m.utcDate);

  const scoreHTML = (m.status === 'live' || m.status === 'finished')
    ? `<span class="modal-score">${m.score.home ?? 0} – ${m.score.away ?? 0}</span>`
    : `<span class="modal-score-vs">vs</span>`;

  const goalsHTML = m.goals && m.goals.length > 0
    ? `<div class="modal-section-title">⚽ Goals</div>
       <div class="modal-goals-list">
         ${m.goals.map(g => `
           <div class="modal-goal-row">
             <span class="goal-minute">${g.minute}'</span>
             <span class="goal-player">${escHtml(g.player)}</span>
             <span class="goal-team-flag">${g.teamFlag || ''}</span>
           </div>`).join('')}
       </div>` : '';

  const statsHTML = m.stats
    ? buildModalStats(m.stats, m.home.flag, m.away.flag)
    : '';

  const countdownHTML = m.status === 'upcoming'
    ? `<div class="modal-countdown">
         <div class="modal-countdown-label">Match starts in</div>
         <div class="modal-countdown-value" id="modalCdValue">--:--:--</div>
       </div>` : '';

  // For TBD knockout matches, show the matchup label
  const labelHTML = m.label && (m.home.name === 'TBD' || m.away.name === 'TBD')
    ? `<div class="modal-tbd-label">${escHtml(m.label)}</div>` : '';

  return `
    <div class="modal-hero">
      <span class="modal-stage-badge">${escHtml(m.stage)}</span>
      ${labelHTML}
      <div class="modal-teams">
        <div class="modal-team">
          <span class="modal-team-flag" role="img" aria-label="${escHtml(m.home.name)}">${m.home.flag}</span>
          <span class="modal-team-name">${escHtml(m.home.name)}</span>
        </div>
        <div class="modal-score-center">
          ${scoreHTML}
          <span class="modal-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="modal-team">
          <span class="modal-team-flag" role="img" aria-label="${escHtml(m.away.name)}">${m.away.flag}</span>
          <span class="modal-team-name">${escHtml(m.away.name)}</span>
        </div>
      </div>
    </div>
    ${countdownHTML}
    <div class="modal-info-grid">
      <div class="modal-info-item">
        <div class="modal-info-label">Date</div>
        <div class="modal-info-value">${formatLocalDateFull(m.utcDate)}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Kick-off</div>
        <div class="modal-info-value">${formatLocalTime(m.utcDate)}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">Stadium</div>
        <div class="modal-info-value">${escHtml(m.stadium.name)}</div>
      </div>
      <div class="modal-info-item">
        <div class="modal-info-label">City</div>
        <div class="modal-info-value">${escHtml(m.stadium.city)}</div>
      </div>
    </div>
    ${goalsHTML}
    ${statsHTML}
  `;
}

function buildModalStats(stats, homeFlag, awayFlag) {
  const rows = [
    { label: 'Possession',      homeVal: stats.possessionHome, awayVal: stats.possessionAway, unit: '%' },
    { label: 'Shots',           homeVal: stats.shotsHome,      awayVal: stats.shotsAway,      unit: '' },
    { label: 'Shots on Target', homeVal: stats.shotsOnHome,    awayVal: stats.shotsOnAway,    unit: '' },
    { label: 'Corners',         homeVal: stats.cornersHome,    awayVal: stats.cornersAway,    unit: '' },
    { label: 'Fouls',           homeVal: stats.foulsHome,      awayVal: stats.foulsAway,      unit: '' },
  ].filter(r => r.homeVal !== undefined && r.awayVal !== undefined);

  if (rows.length === 0) return '';

  const rowsHTML = rows.map(r => {
    const total   = r.homeVal + r.awayVal || 1;
    const homePct = Math.round((r.homeVal / total) * 100);
    const awayPct = 100 - homePct;
    return `
      <div class="modal-stat-row">
        <span class="modal-stat-val">${r.homeVal}${r.unit}</span>
        <div class="modal-stat-bars">
          <div class="stat-bar-wrap">
            <div class="stat-bar-fill" data-pct="${homePct}" style="width:0%"></div>
          </div>
          <span class="modal-stat-label">${escHtml(r.label)}</span>
          <div class="stat-bar-wrap">
            <div class="stat-bar-fill" data-pct="${awayPct}" style="width:0%"></div>
          </div>
        </div>
        <span class="modal-stat-val right">${r.awayVal}${r.unit}</span>
      </div>`;
  }).join('');

  return `
    <div class="modal-section-title" style="margin-top:4px">📊 Match Stats</div>
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.78rem;color:var(--text-muted)">
      <span>${homeFlag}</span><span>${awayFlag}</span>
    </div>
    ${rowsHTML}
  `;
}

function startModalCountdown(m) {
  const el = document.getElementById('modalCdValue');
  if (!el) return;

  function tick() {
    const diff = new Date(m.utcDate) - Date.now();
    if (diff <= 0) { el.textContent = 'Starting soon'; return; }
    el.textContent = formatDiffLong(diff);
  }

  tick();
  state.modalCountdownInterval = setInterval(tick, 1000);
}

/* ===================== CARD COUNTDOWNS ===================== */
function startCardCountdown(card, m) {
  const el = card.querySelector('.card-countdown');
  if (!el) return;

  function tick() {
    const diff = new Date(m.utcDate) - Date.now();
    if (diff <= 0) { el.textContent = 'Soon'; return; }
    el.textContent = formatDiffShort(diff);
  }

  tick();
  const id = setInterval(tick, 1000);
  state.countdownTimers[m.id] = id;
}

/* ===================== HERO COUNTDOWN ===================== */
function startHeroCountdown() {
  const tournamentStart = new Date(state.data.tournament.startDate);
  const tournamentEnd   = new Date(state.data.tournament.finalDate);
  const now             = Date.now();

  // Tournament already over
  if (now > tournamentEnd.getTime()) {
    if (dom.heroCountdown) dom.heroCountdown.innerHTML =
      `<div class="countdown-label" style="font-size:0.9rem;color:var(--accent)">Tournament Complete 🏆</div>`;
    return;
  }

  // Tournament is underway — count down to the Final instead
  const target      = now > tournamentStart.getTime() ? tournamentEnd : tournamentStart;
  const labelText   = now > tournamentStart.getTime() ? 'Final Kicks Off In' : 'Tournament Opens In';

  // Update label text
  const labelEl = dom.heroCountdown ? dom.heroCountdown.querySelector('.countdown-label') : null;
  if (labelEl) labelEl.textContent = labelText;

  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      dom.cdDays.textContent  = '00';
      dom.cdHours.textContent = '00';
      dom.cdMins.textContent  = '00';
      dom.cdSecs.textContent  = '00';
      clearInterval(state.heroCountdownInterval);
      return;
    }
    const { days, hours, mins, secs } = splitDiff(diff);
    dom.cdDays.textContent  = pad2(days);
    dom.cdHours.textContent = pad2(hours);
    dom.cdMins.textContent  = pad2(mins);
    dom.cdSecs.textContent  = pad2(secs);
  }

  tick();
  state.heroCountdownInterval = setInterval(tick, 1000);
}

/* ===================== LIVE BADGE UPDATE ===================== */
function updateLiveBadge() {
  const count = state.matches.filter(m => m.status === 'live').length;
  document.querySelectorAll('[data-tab="live"]').forEach(btn => {
    const dot = btn.querySelector('.live-dot');
    if (dot) dot.style.display = count > 0 ? 'block' : 'none';
  });
}

/* ===================== LIVE SIMULATION ===================== */
/**
 * Marks any match that started <105 minutes ago as "live" and
 * ticks the minute counter every 60 seconds.
 */
function startLiveSimulation() {
  const now = Date.now();
  state.matches.forEach(m => {
    const start = new Date(m.utcDate).getTime();
    const age   = (now - start) / 60000; // minutes since kickoff
    if (age >= 0 && age <= 105 && m.status === 'upcoming') {
      m.status     = 'live';
      m.liveMinute = Math.min(90, Math.floor(age));
    }
  });

  updateLiveBadge();

  state.liveSimInterval = setInterval(() => {
    state.matches.forEach(m => {
      if (m.status !== 'live') return;
      m.liveMinute = (m.liveMinute || 0) + 1;
      if (m.liveMinute > 95) {
        m.status = 'finished';
        if (m.score.home === null) m.score = { home: 0, away: 0 };
      }
      const card = document.querySelector(`[data-match-id="${m.id}"]`);
      if (card) {
        const minEl = card.querySelector('.card-minute');
        if (minEl) minEl.textContent = `${m.liveMinute}'`;
      }
    });
    updateLiveBadge();
  }, 60000);
}

/* ===================== VIEW SWITCHING ===================== */
function switchTab(tab) {
  state.activeTab = tab;

  dom.tabBtns.forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });

  dom.bnavBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  const isStandings = tab === 'standings';
  dom.matchesView.hidden   = isStandings;
  dom.standingsView.hidden = !isStandings;
  dom.filterChips.style.display = isStandings ? 'none' : '';

  if (!isStandings) applyFilters();
}

/* ===================== EVENT BINDING ===================== */
function bindEvents() {
  dom.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  dom.bnavBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  dom.chips.forEach(chip => {
    chip.addEventListener('click', () => {
      dom.chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeStage = chip.dataset.stage;
      applyFilters();
    });
  });

  dom.searchToggle.addEventListener('click', () => {
    const open = !dom.searchBar.classList.contains('open');
    dom.searchBar.classList.toggle('open', open);
    dom.searchBar.setAttribute('aria-hidden', !open);
    if (open) {
      dom.searchInput.focus();
    } else {
      clearSearch();
    }
  });

  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value;
    applyFilters();
    dom.searchClear.style.display = state.searchQuery ? 'block' : 'none';
  });

  dom.searchClear.addEventListener('click', () => {
    clearSearch();
    dom.searchInput.focus();
  });

  dom.modalClose.addEventListener('click', closeModal);

  dom.matchModal.addEventListener('click', e => {
    if (e.target === dom.matchModal) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !dom.matchModal.hidden) closeModal();
  });
}

function clearSearch() {
  dom.searchInput.value  = '';
  state.searchQuery      = '';
  dom.searchClear.style.display = 'none';
  applyFilters();
}

/* ===================== SERVICE WORKER ===================== */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ===================== DATE / TIME HELPERS ===================== */
function formatLocalDateTime(utcStr) {
  const d = new Date(utcStr);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatLocalDateFull(utcStr) {
  return new Date(utcStr).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function formatLocalTime(utcStr) {
  return new Date(utcStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function splitDiff(ms) {
  const totalSec = Math.floor(ms / 1000);
  const days     = Math.floor(totalSec / 86400);
  const hours    = Math.floor((totalSec % 86400) / 3600);
  const mins     = Math.floor((totalSec % 3600) / 60);
  const secs     = totalSec % 60;
  return { days, hours, mins, secs };
}

function formatDiffShort(ms) {
  const { days, hours, mins, secs } = splitDiff(ms);
  if (days > 0)  return `${days}d ${pad2(hours)}h`;
  if (hours > 0) return `${hours}h ${pad2(mins)}m`;
  return `${pad2(mins)}:${pad2(secs)}`;
}

function formatDiffLong(ms) {
  const { days, hours, mins, secs } = splitDiff(ms);
  return `${pad2(days)}d ${pad2(hours)}h ${pad2(mins)}m ${pad2(secs)}s`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* ===================== UTILS ===================== */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError() {
  dom.matchesList.hidden  = true;
  dom.matchesEmpty.hidden = false;
  dom.matchesEmpty.innerHTML = `
    <div class="empty-icon">⚠️</div>
    <p>Could not load match data</p>
    <span>Make sure matches.json is in the same folder</span>
  `;
}

/* ===================== BOOT ===================== */
document.addEventListener('DOMContentLoaded', init);
