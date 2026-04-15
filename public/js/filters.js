// filters.js — Filter rail, top movers list, summary bar.

import { escHtml } from './utils.js';

/**
 * Initialize the filter rail.
 * Builds sector toggles and wires direction/sort/search inputs.
 *
 * @param {HTMLElement} rail - the #filter-rail aside element
 * @param {Array} sectors    - sector array from /api/heatmap
 * @param {Function} onChange - called with filterState on every change
 */
export function initFilters(rail, sectors, onChange) {
  // Build sector toggles
  const togglesEl = rail.querySelector('#sector-toggles');
  if (togglesEl) {
    togglesEl.innerHTML = sectors.map(s => `
      <label class="sector-toggle">
        <input type="checkbox" name="sector-toggle" value="${escHtml(s.id)}" checked>
        <span></span>
      </label>`).join('');

    // Set sector name via textContent (not innerHTML) to avoid XSS
    togglesEl.querySelectorAll('label.sector-toggle').forEach((label, i) => {
      const span = label.querySelector('span');
      if (span) span.textContent = sectors[i]?.name ?? '';
    });

    togglesEl.addEventListener('change', e => {
      const checkbox = e.target;
      if (checkbox.name === 'sector-toggle') {
        const parentLabel = checkbox.closest('label');
        if (parentLabel) parentLabel.classList.toggle('dimmed', !checkbox.checked);
        onChange(getFilterState(rail));
      }
    });
  }

  // Wire direction filter radio buttons
  const dirGroup = rail.querySelector('#filter-direction');
  if (dirGroup) {
    dirGroup.addEventListener('click', e => {
      const label = e.target.closest('label.filter-radio');
      if (!label) return;
      dirGroup.querySelectorAll('label.filter-radio').forEach(l => l.classList.remove('active'));
      label.classList.add('active');
      const input = label.querySelector('input[type=radio]');
      if (input) input.checked = true;
      onChange(getFilterState(rail));
    });
  }

  // Wire sort filter radio buttons
  const sortGroup = rail.querySelector('#filter-sort');
  if (sortGroup) {
    sortGroup.addEventListener('click', e => {
      const label = e.target.closest('label.filter-radio');
      if (!label) return;
      sortGroup.querySelectorAll('label.filter-radio').forEach(l => l.classList.remove('active'));
      label.classList.add('active');
      const input = label.querySelector('input[type=radio]');
      if (input) input.checked = true;
      onChange(getFilterState(rail));
    });
  }

  // Wire search input with 200ms debounce
  const searchInput = rail.querySelector('#search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(getFilterState(rail)), 200);
    });
  }
}

/**
 * Read the current filter state from the DOM.
 *
 * @param {HTMLElement} rail
 * @returns {{ direction: string, sort: string, search: string, sectors: Set<string> }}
 */
export function getFilterState(rail) {
  // Direction
  const dirChecked = rail.querySelector('#filter-direction input[type=radio]:checked');
  const direction  = dirChecked?.value ?? 'all';

  // Sort
  const sortChecked = rail.querySelector('#filter-sort input[type=radio]:checked');
  const sort        = sortChecked?.value ?? 'sector';

  // Search
  const searchInput = rail.querySelector('#search-input');
  const search      = (searchInput?.value ?? '').trim().toLowerCase();

  // Sectors: collect unchecked sector IDs (these are filtered OUT)
  const sectors = new Set();
  rail.querySelectorAll('input[name=sector-toggle]:not(:checked)').forEach(cb => {
    sectors.add(cb.value);
  });

  return { direction, sort, search, sectors };
}

/**
 * Render the top-5 movers list.
 *
 * @param {HTMLElement} moversEl - the #top-movers element
 * @param {Array} sectors        - sector array from /api/heatmap
 */
export function renderTopMovers(moversEl, sectors) {
  // Flatten all industries
  const industries = [];
  for (const sector of sectors) {
    for (const ind of sector.industries ?? []) {
      industries.push(ind);
    }
  }

  // Sort by absolute deviation from 50 (most extreme first)
  industries.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));

  const top = industries.slice(0, 5);

  if (top.length === 0) {
    moversEl.textContent = '—';
    return;
  }

  moversEl.innerHTML = top.map(ind => {
    const score = Number(ind.score);
    const cls   = score >= 50 ? 'mover-score mover-tw' : 'mover-score mover-hw';
    const name  = ind.name.length > 18 ? ind.name.slice(0, 16) + '…' : ind.name;
    return `<div class="mover-row">
      <span class="mover-name">${escHtml(name)}</span>
      <span class="${cls}">${score.toFixed(1)}</span>
    </div>`;
  }).join('');
}

/**
 * Render the summary bar showing TW / Neutral / HW counts.
 *
 * @param {HTMLElement} barEl - the #summary-bar element
 * @param {Array} sectors     - sector array from /api/heatmap
 */
export function renderSummaryBar(barEl, sectors) {
  let tw = 0, neutral = 0, hw = 0;
  for (const sector of sectors) {
    for (const ind of sector.industries ?? []) {
      const score = Number(ind.score);
      if (score >= 56)      tw++;
      else if (score <= 44) hw++;
      else                  neutral++;
    }
  }

  barEl.innerHTML =
    `<span class="summary-pill pill-tw"><span class="pill-count">${tw}</span> Tailwind</span>` +
    `<span class="summary-pill pill-neutral"><span class="pill-count">${neutral}</span> Neutral</span>` +
    `<span class="summary-pill pill-hw"><span class="pill-count">${hw}</span> Headwind</span>`;
}
