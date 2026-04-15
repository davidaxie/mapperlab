// app.js — Main orchestrator. Wires all modules together.

import { fetchHeatmap, fetchStatus, fetchEvents, triggerUpdate, pollUntilDone } from './api.js';
import { renderHeatmap, applyTransitions } from './heatmap.js';
import { initSidebar, openSidebar } from './sidebar.js';
import { renderTicker, renderEventCards } from './events.js';
import { initFilters, getFilterState, renderTopMovers, renderSummaryBar } from './filters.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const heatmapEl      = document.getElementById('heatmap');
const detailPanel    = document.getElementById('detail-panel');
const filterRail     = document.getElementById('filter-rail');
const tickerTrack    = document.getElementById('ticker-track');
const eventsFeed     = document.getElementById('events-feed');
const eventsCount    = document.getElementById('events-count');
const summaryBar     = document.getElementById('summary-bar');
const topMovers      = document.getElementById('top-movers');
const refreshBtn     = document.getElementById('refresh-btn');
const liveDot        = document.getElementById('live-dot');
const liveLabel      = document.getElementById('live-label');
const lastUpdateEl   = document.getElementById('last-update-label');
const statNodes      = document.getElementById('stat-nodes');
const statEvents     = document.getElementById('stat-events');

// ── State ─────────────────────────────────────────────────────────────────────
let lastHeatmap   = null;
let filterState   = { direction: 'all', sort: 'sector', search: '', sectors: new Set() };
let isFetching    = false;
let filtersReady  = false;

// ── Status indicator ──────────────────────────────────────────────────────────
function setLive(state, label) {
  if (liveDot)   liveDot.className  = 'live-dot ' + state;
  if (liveLabel) liveLabel.textContent = label;
}

// ── Re-render heatmap with current filter state ───────────────────────────────
function rerenderWithFilters() {
  if (!lastHeatmap) return;
  renderHeatmap(heatmapEl, lastHeatmap, { filter: filterState });
  // Do NOT re-attach cell-click here — the delegation listener on heatmapEl
  // is already set in the first-render branch of refresh() and persists
  // across innerHTML replacements on the container element.
}

// ── Cell click handler ────────────────────────────────────────────────────────
function onCellClick(e) {
  const { id, name, sector, score, instruments } = e.detail;

  // Find full industry object in lastHeatmap for live data
  let industry = null;
  if (lastHeatmap) {
    for (const sec of lastHeatmap.sectors ?? []) {
      for (const ind of sec.industries ?? []) {
        if (ind.id === id) { industry = ind; break; }
      }
      if (industry) break;
    }
  }

  openSidebar(detailPanel, { id, name, sector, score, instruments }, industry);
}

// ── Main refresh loop ─────────────────────────────────────────────────────────
async function refresh() {
  if (isFetching) return;
  isFetching = true;
  setLive('yellow', 'Refreshing…');

  try {
    const [heatmap, status, events] = await Promise.all([
      fetchHeatmap(),
      fetchStatus(),
      fetchEvents(50),
    ]);

    const sectors = heatmap?.sectors ?? [];

    if (!lastHeatmap) {
      // First render — build full DOM
      renderHeatmap(heatmapEl, heatmap, { filter: filterState });
      heatmapEl.addEventListener('cell-click', onCellClick);

      if (!filtersReady) {
        initFilters(filterRail, sectors, newState => {
          filterState = newState;
          rerenderWithFilters();
        });
        filtersReady = true;
      }
    } else {
      // Subsequent renders — in-place transitions
      applyTransitions(heatmapEl, heatmap);
    }

    lastHeatmap = heatmap;

    // Render feed modules
    renderTicker(tickerTrack, events);
    renderEventCards(eventsFeed, events, eventsCount);
    renderTopMovers(topMovers, sectors);
    renderSummaryBar(summaryBar, sectors);

    // Update status text
    const updatedAt = status?.lastUpdate;
    if (lastUpdateEl) {
      lastUpdateEl.textContent = updatedAt
        ? `Updated ${_relTime(updatedAt)}`
        : 'Baseline';
    }
    if (statNodes)  statNodes.textContent  = `${status?.scoresCount ?? 0} nodes`;
    if (statEvents) statEvents.textContent = `${status?.eventsCount ?? 0} events`;

    // Live indicator
    if (status?.updating) {
      setLive('yellow', 'Updating…');
    } else if (updatedAt) {
      setLive('green', 'Live');
    } else {
      setLive('gray', 'Baseline');
    }

  } catch (err) {
    setLive('red', `Error: ${err.message}`);
    console.error('[MapperLab] Refresh failed:', err);
  } finally {
    isFetching = false;
  }
}

// Simple relTime for timestamps (avoids importing from utils for this one use)
function _relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Manual update trigger ─────────────────────────────────────────────────────
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    setLive('yellow', 'Starting update…');

    try {
      const result = await triggerUpdate();

      if (result?.status === 'updating') {
        setLive('yellow', 'Update already running…');
        refreshBtn.disabled = false;
        return;
      }

      setLive('yellow', 'Update running…');
      await pollUntilDone(3000, 30);
      await refresh();
    } catch (err) {
      setLive('red', `Update failed: ${err.message}`);
      console.error('[MapperLab] Update failed:', err);
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

// ── Sidebar init ──────────────────────────────────────────────────────────────
initSidebar(detailPanel);

// ── Boot ──────────────────────────────────────────────────────────────────────
refresh();
setInterval(refresh, 2 * 60 * 1000);
