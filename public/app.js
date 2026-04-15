/**
 * app.js — MapperLab heatmap frontend
 *
 * All content from external APIs (RSS headlines, source names) is run through
 * escHtml() before being set via innerHTML.  URLs from external feeds are
 * validated to only allow http/https schemes before being used in href attrs.
 */

const REFRESH_INTERVAL = 2 * 60 * 1000;  // 2-min auto-refresh

// ─── DOM refs ────────────────────────────────────────────────────────────────
const heatmapEl    = document.getElementById('heatmap');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const refreshBtn   = document.getElementById('refresh-btn');
const lastUpdateEl = document.getElementById('last-update-label');
const eventsFeedEl = document.getElementById('events-feed');
const sidebar      = document.getElementById('sidebar');
const sidebarTitle = document.getElementById('sidebar-title');
const sidebarScore = document.getElementById('sidebar-score');
const sidebarClose = document.getElementById('sidebar-close');
const timelineList = document.getElementById('timeline-list');
const sourcesList  = document.getElementById('sources-list');

// ─── State ───────────────────────────────────────────────────────────────────
let lastData     = null;
let activeCellId = null;

// ─── Security helpers ────────────────────────────────────────────────────────
/** Escape all HTML special chars — MUST be applied to every untrusted string. */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * safeHref — validates a URL only allows http/https.
 * Returns '' for any non-http(s) URL (including javascript: and data:).
 */
function safeHref(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch {
    return '';
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function badgeClass(direction, intensity) {
  if (direction === 'tailwind') return intensity === 'strong' ? 'badge-tailwind-strong' : 'badge-tailwind';
  if (direction === 'headwind') return intensity === 'strong' ? 'badge-headwind-strong' : 'badge-headwind';
  return 'badge-neutral';
}

function scoreColor(direction) {
  if (direction === 'tailwind') return '#90c4ff';
  if (direction === 'headwind') return '#ff9090';
  return '#8b949e';
}

function formatScore(s) { return Number(s).toFixed(1); }

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Render heatmap ──────────────────────────────────────────────────────────
/**
 * Taxonomy names/ids come from our own static taxonomy.json — they are trusted
 * but we still escHtml them as defence-in-depth.  Industry IDs are used only
 * as data-attributes and in data-id/onclick strings; they contain only
 * alphanumerics and hyphens (enforced by taxonomy schema).
 */
function renderHeatmap(data) {
  lastData = data;
  const sectors = data?.sectors ?? [];

  if (sectors.length === 0) {
    heatmapEl.textContent = 'No data available yet. Click ↻ Update to pull live data.';
    return;
  }

  const parts = [];
  for (const sector of sectors) {
    const sScore  = formatScore(sector.score);
    const sBadge  = badgeClass(sector.direction, sector.intensity);
    const sColor  = scoreColor(sector.direction);
    const sName   = escHtml(sector.name);
    const sDir    = escHtml(sector.direction ?? 'neutral');
    const sInt    = escHtml(sector.intensity ?? 'mild');
    const sId     = escHtml(sector.id);

    const indParts = [];
    for (const ind of sector.industries ?? []) {
      const iId   = escHtml(ind.id);
      const iName = escHtml(ind.name);
      const iDir  = escHtml(ind.direction ?? 'neutral');
      const iInt  = escHtml(ind.intensity ?? 'mild');
      const iSc   = formatScore(ind.score);
      indParts.push(`
        <div class="industry-cell"
             data-id="${iId}"
             data-direction="${iDir}"
             data-intensity="${iInt}"
             title="${iName}: ${iSc}"
             role="button"
             tabindex="0"
             data-label="${iName}">
          <div class="industry-name">${iName}</div>
          <div class="industry-score">${iSc}</div>
          <div class="industry-dir">${iDir}</div>
        </div>`);
    }

    parts.push(`
      <div class="sector-card">
        <div class="sector-header" role="button" tabindex="0">
          <span class="sector-name">${sName}</span>
          <span class="sector-score-badge ${sBadge}" style="color:${sColor}">${sScore}</span>
        </div>
        <div class="industries-grid">${indParts.join('')}</div>
      </div>`);
  }

  heatmapEl.innerHTML = parts.join('');

  // Attach click handlers after DOM insertion (avoids inline onclick)
  heatmapEl.querySelectorAll('.industry-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      openSidebar(cell.dataset.id, cell.dataset.label);
    });
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openSidebar(cell.dataset.id, cell.dataset.label);
    });
  });

  heatmapEl.querySelectorAll('.sector-header').forEach(header => {
    header.addEventListener('click', () => {
      const grid = header.nextElementSibling;
      if (grid) grid.style.display = grid.style.display === 'none' ? '' : 'none';
    });
  });
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
async function openSidebar(id, name) {
  activeCellId = id;
  sidebarTitle.textContent = name; // textContent — safe for untrusted strings

  const industry = findIndustry(id);
  if (industry) {
    const color = scoreColor(industry.direction);
    // escHtml on direction in case API data is unexpected
    const dir   = escHtml(industry.direction ?? 'neutral');
    sidebarScore.innerHTML = `
      <div class="big-score" style="color:${escHtml(color)}">${formatScore(industry.score)}</div>
      <div style="font-size:0.78rem;color:${escHtml(color)};text-transform:uppercase;font-weight:600">${dir}</div>
    `;
  }

  try {
    const [tlRes, srcRes] = await Promise.all([
      fetch(`/api/timeline/${encodeURIComponent(id)}`),
      fetch(`/api/sources/${encodeURIComponent(id)}`),
    ]);
    renderTimeline(await tlRes.json());
    renderSources(await srcRes.json());
  } catch {
    timelineList.innerHTML = '<li>Failed to load timeline.</li>';
    sourcesList.innerHTML  = '<li>Failed to load sources.</li>';
  }
}

sidebarClose.addEventListener('click', () => {
  sidebar.classList.add('hidden');
  activeCellId = null;
});

function findIndustry(id) {
  if (!lastData) return null;
  for (const sector of lastData.sectors ?? []) {
    for (const ind of sector.industries ?? []) {
      if (ind.id === id) return ind;
    }
    if (sector.id === id) return sector;
  }
  return null;
}

function renderTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    timelineList.innerHTML = '<li>No history yet.</li>';
    return;
  }
  timelineList.innerHTML = timeline.slice(0, 20).map(t => `
    <li>
      <span class="tl-score">${formatScore(t.score)}</span>
      <span class="tl-event">${escHtml(t.event ?? '')}</span>
      <span class="tl-date">${escHtml(relTime(t.timestamp))}</span>
    </li>
  `).join('');
}

function renderSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    sourcesList.innerHTML = '<li>No sources recorded yet.</li>';
    return;
  }
  sourcesList.innerHTML = sources.map(s => `<li>${escHtml(s)}</li>`).join('');
}

// ─── Events feed ─────────────────────────────────────────────────────────────
function renderEventChips(events) {
  if (!Array.isArray(events) || events.length === 0) {
    eventsFeedEl.innerHTML = '<p class="muted">No events yet — click ↻ Update to pull live data.</p>';
    return;
  }

  const chips = events.slice(0, 30).map(ev => {
    const source   = escHtml(ev.source ?? '');
    const time     = escHtml(relTime(ev.timestamp));
    const headline = escHtml(ev.headline ?? '');
    const href     = safeHref(ev.url);   // validated — empty string if not http(s)

    const headlineHtml = href
      ? `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${headline}</a>`
      : headline;

    return `
      <div class="event-chip">
        <span class="ev-source">${source} · ${time}</span>
        <span class="ev-headline">${headlineHtml}</span>
      </div>`;
  });

  eventsFeedEl.innerHTML = chips.join('');
}

// ─── Status bar ──────────────────────────────────────────────────────────────
function setStatus(state, msg) {
  statusDot.className   = `dot dot-${state}`;
  statusText.textContent = msg;   // textContent — safe
}

// ─── Fetch & render ──────────────────────────────────────────────────────────
let isFetching = false;

async function refresh() {
  if (isFetching) return;
  isFetching = true;
  setStatus('yellow', 'Refreshing…');
  refreshBtn.disabled = true;

  try {
    const [heatmapRes, statusRes] = await Promise.all([
      fetch('/api/heatmap'),
      fetch('/api/status'),
    ]);

    if (!heatmapRes.ok) throw new Error(`HTTP ${heatmapRes.status}`);

    const [heatmap, status] = await Promise.all([
      heatmapRes.json(),
      statusRes.ok ? statusRes.json() : Promise.resolve({}),
    ]);

    renderHeatmap(heatmap);

    const updatedAt = status.lastUpdate;
    lastUpdateEl.textContent = updatedAt
      ? `Last updated ${relTime(updatedAt)}`
      : 'Baseline scores';

    if (status.updating) {
      setStatus('yellow', 'Updating…');
    } else if (updatedAt) {
      setStatus('green', `Live · ${status.scoresCount ?? 0} nodes · ${status.eventsCount ?? 0} events`);
    } else {
      setStatus('gray', `Baseline · ${status.scoresCount ?? 0} nodes`);
    }

    // Render event count note (no /api/events route; use status.eventsCount)
    if ((status.eventsCount ?? 0) === 0) {
      eventsFeedEl.innerHTML = '<p class="muted">No events yet — click ↻ Update to pull live data.</p>';
    } else {
      eventsFeedEl.innerHTML = `<p class="muted">${status.eventsCount} events processed. Click any industry cell for timeline + sources.</p>`;
    }

  } catch (err) {
    setStatus('red', `Error: ${err.message}`);
    console.error('[MapperLab] Refresh failed:', err);
  } finally {
    isFetching     = false;
    refreshBtn.disabled = false;
  }
}

// ─── Manual update ───────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  setStatus('yellow', 'Triggering update…');
  refreshBtn.disabled = true;

  try {
    const res  = await fetch('/api/update', { method: 'POST' });
    const body = await res.json();

    if (res.status === 429) {
      setStatus('yellow', 'Update already running…');
      refreshBtn.disabled = false;
      return;
    }

    setStatus('yellow', 'Update started…');

    // Poll until done (max 90 s)
    let polls = 0;
    const poll = setInterval(async () => {
      polls++;
      try {
        const st = await fetch('/api/status');
        const s  = await st.json();
        if (!s.updating || polls > 30) {
          clearInterval(poll);
          await refresh();
        }
      } catch {
        clearInterval(poll);
        refreshBtn.disabled = false;
      }
    }, 3000);

  } catch (e) {
    setStatus('red', `Update failed: ${e.message}`);
    refreshBtn.disabled = false;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────
refresh();
setInterval(refresh, REFRESH_INTERVAL);
