// sidebar.js — Detail panel with gauge, sparkline, timeline, sources

import { escHtml, relTime, formatScore, scoreToTextColor, scoreToDirection, scoreToIntensity, sparklineSVG, gaugeSVG } from './utils.js';
import { fetchTimeline, fetchSources } from './api.js';

/**
 * Initialize the detail panel: wire close button and Escape key.
 * @param {HTMLElement} panel - the #detail-panel element
 */
export function initSidebar(panel) {
  const closeBtn = panel.querySelector('#dp-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeSidebar(panel));
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      closeSidebar(panel);
    }
  });
}

/**
 * Close the detail panel.
 * @param {HTMLElement} panel
 */
export function closeSidebar(panel) {
  panel.classList.add('hidden');
}

/**
 * Open the detail panel for an industry/sector.
 * @param {HTMLElement} panel - the #detail-panel element
 * @param {{ id: string, name: string, sector: string, score: number, instruments: string[] }} detail
 * @param {Object|null} industry - full industry object from lastHeatmap (optional)
 */
export async function openSidebar(panel, detail, industry) {
  panel.classList.remove('hidden');

  // Header
  const sectorTag = panel.querySelector('#dp-sector-tag');
  const title     = panel.querySelector('#dp-title');
  if (sectorTag) sectorTag.textContent = detail.sector ?? '';
  if (title)     title.textContent     = detail.name ?? '';

  // Score zone
  const scoreZone = panel.querySelector('#dp-score-zone');
  if (scoreZone) {
    const score = detail.score ?? (industry?.score ?? 50);
    const color = scoreToTextColor(score);
    const dir   = scoreToDirection(score);
    const inten = scoreToIntensity(score);
    scoreZone.innerHTML =
      gaugeSVG(score, 72) +
      `<div>` +
      `<div class="dp-score-number" style="color:${escHtml(color)}">${formatScore(score)}</div>` +
      `<div class="dp-score-dir" style="color:${escHtml(color)}">${escHtml(dir)} · ${escHtml(inten)}</div>` +
      `</div>`;
  }

  // Instruments
  const instrEl = panel.querySelector('#dp-instruments');
  if (instrEl) {
    if (detail.instruments && detail.instruments.length > 0) {
      instrEl.innerHTML = detail.instruments.map(t => `<span class="instrument-tag">${escHtml(t)}</span>`).join('');
    } else {
      instrEl.innerHTML = '<span class="instrument-tag" style="opacity:0.4">—</span>';
    }
  }

  // Loading placeholders
  const timelineEl  = panel.querySelector('#dp-timeline');
  const sparklineEl = panel.querySelector('#dp-sparkline');
  const sourcesEl   = panel.querySelector('#dp-sources');
  if (timelineEl)  timelineEl.innerHTML  = '<li style="color:var(--text-dim);font-size:0.7rem">Loading…</li>';
  if (sourcesEl)   sourcesEl.innerHTML   = '<li style="color:var(--text-dim);font-size:0.7rem">Loading…</li>';
  if (sparklineEl) sparklineEl.innerHTML = '';

  // Fetch timeline + sources concurrently
  try {
    const [timeline, sources] = await Promise.all([
      fetchTimeline(detail.id),
      fetchSources(detail.id),
    ]);

    // Render sparkline
    if (sparklineEl && Array.isArray(timeline) && timeline.length > 0) {
      const points = [...timeline].reverse().map(t => Number(t.score));
      sparklineEl.innerHTML = sparklineSVG(points, 220, 44);
    }

    // Render timeline
    if (timelineEl) {
      if (!Array.isArray(timeline) || timeline.length === 0) {
        timelineEl.innerHTML = '<li style="color:var(--text-dim);font-size:0.7rem">No history yet.</li>';
      } else {
        timelineEl.innerHTML = timeline.slice(0, 20).map(t => `
          <li>
            <span class="tl-score">${formatScore(t.score)}</span>
            <span class="tl-event">${escHtml(t.event ?? '')}</span>
            <span class="tl-time">${escHtml(relTime(t.timestamp))}</span>
          </li>`).join('');
      }
    }

    // Render sources
    if (sourcesEl) {
      if (!Array.isArray(sources) || sources.length === 0) {
        sourcesEl.innerHTML = '<li style="color:var(--text-dim);font-size:0.7rem">No sources recorded.</li>';
      } else {
        sourcesEl.innerHTML = sources.map(s => `<li>${escHtml(s)}</li>`).join('');
      }
    }

  } catch {
    if (timelineEl) timelineEl.innerHTML = '<li style="color:var(--text-dim);font-size:0.7rem">Failed to load.</li>';
    if (sourcesEl)  sourcesEl.innerHTML  = '<li style="color:var(--text-dim);font-size:0.7rem">Failed to load.</li>';
  }
}
