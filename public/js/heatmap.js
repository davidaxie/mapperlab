import { escHtml, formatScore, scoreToBackground, scoreToTextColor, scoreToBarColor, scoreToDirection, scoreToIntensity } from './utils.js';

// Snapshot of previous scores for delta calculation
let _prevScores = {}; // { [id]: score }

export function renderHeatmap(container, data, options = {}) {
  const sectors = data?.sectors ?? [];
  const filter = options.filter ?? {};

  if (sectors.length === 0) {
    container.innerHTML = '<div class="loading-state"><span>No data yet — click ↻ Update.</span></div>';
    return;
  }

  // Filter sectors
  let filtered = sectors;
  if (filter.sectors && filter.sectors.size > 0) {
    filtered = filtered.filter(s => !filter.sectors.has(s.id));
  }

  // Sort sectors
  if (filter.sort === 'score-desc') {
    filtered = [...filtered].sort((a, b) => b.score - a.score);
  } else if (filter.sort === 'score-asc') {
    filtered = [...filtered].sort((a, b) => a.score - b.score);
  }

  const parts = [];
  for (const sector of filtered) {
    const sScore = Number(sector.score);
    const sDir   = scoreToDirection(sScore);
    const sText  = scoreToTextColor(sScore);
    const sBar   = scoreToBarColor(sScore);
    const sDirClass = sDir === 'tailwind' ? 'dir-tw' : sDir === 'headwind' ? 'dir-hw' : 'dir-neutral';

    // Filter industries within the sector
    let inds = sector.industries ?? [];

    if (filter.direction && filter.direction !== 'all') {
      inds = inds.filter(ind => {
        const d = scoreToDirection(Number(ind.score));
        const intensity = scoreToIntensity(Number(ind.score));
        if (filter.direction === 'tailwind-strong') return d === 'tailwind' && intensity === 'strong';
        if (filter.direction === 'headwind-strong') return d === 'headwind' && intensity === 'strong';
        return d === filter.direction;
      });
    }

    if (filter.search) {
      inds = inds.filter(ind => ind.name.toLowerCase().includes(filter.search));
    }

    // Build industry cell HTML
    const cellParts = inds.map(ind => {
      const iScore = Number(ind.score);
      const iBg    = scoreToBackground(iScore);
      const iText  = scoreToTextColor(iScore);
      const iBar   = scoreToBarColor(iScore);
      const iDir   = scoreToDirection(iScore);
      const instruments = escHtml(JSON.stringify(ind.instruments ?? []));

      return `<div class="industry-cell"
          data-id="${escHtml(ind.id)}"
          data-label="${escHtml(ind.name)}"
          data-sector="${escHtml(sector.name)}"
          data-score="${iScore}"
          data-instruments="${instruments}"
          role="button"
          tabindex="0"
          aria-label="${escHtml(ind.name)}: ${formatScore(iScore)}"
          style="--cell-bg:${iBg}; --cell-text:${escHtml(iText)}">
        <div class="cell-name">${escHtml(ind.name)}</div>
        <div class="cell-score">${formatScore(iScore)}</div>
        <div class="cell-footer">
          <span class="cell-dir">${escHtml(iDir)}</span>
          <span class="cell-delta"></span>
        </div>
        <div class="cell-score-bar">
          <div class="cell-score-bar-fill" style="width:${iScore}%; background-color:${escHtml(iBar)}"></div>
        </div>
      </div>`;
    });

    parts.push(`<div class="sector-row" data-id="${escHtml(sector.id)}">
      <div class="sector-row-header">
        <span class="sector-row-name">${escHtml(sector.name)}</span>
        <div class="sector-row-bar">
          <div class="sector-row-bar-fill" style="width:${sScore}%; background-color:${escHtml(sBar)}"></div>
        </div>
        <span class="sector-row-score" style="color:${escHtml(sText)}">${formatScore(sScore)}</span>
        <span class="sector-row-dir ${sDirClass}">${escHtml(sDir)}</span>
        <span class="sector-collapse-icon">▾</span>
      </div>
      <div class="industries-wrap">${cellParts.join('')}</div>
    </div>`);
  }

  container.innerHTML = parts.join('');

  // Attach sector collapse toggle
  container.querySelectorAll('.sector-row-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.sector-row').classList.toggle('collapsed');
    });
  });

  // Attach cell click/keydown listeners (event delegation via per-cell listeners)
  container.querySelectorAll('.industry-cell').forEach(cell => {
    cell.addEventListener('click', () => _dispatchCellClick(cell));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _dispatchCellClick(cell);
      }
    });
  });

  _snapshotScores(sectors);
}

function _dispatchCellClick(cell) {
  const instruments = (() => {
    try { return JSON.parse(cell.dataset.instruments || '[]'); } catch { return []; }
  })();
  cell.dispatchEvent(new CustomEvent('cell-click', {
    bubbles: true,
    detail: {
      id:          cell.dataset.id,
      name:        cell.dataset.label,
      sector:      cell.dataset.sector,
      score:       Number(cell.dataset.score),
      instruments,
    }
  }));
}

export function applyTransitions(container, newData) {
  const sectors = newData?.sectors ?? [];
  let changedCount = 0;

  for (const sector of sectors) {
    for (const ind of sector.industries ?? []) {
      const cell = container.querySelector(`.industry-cell[data-id="${CSS.escape(ind.id)}"]`);
      if (!cell) continue;

      const newScore = Number(ind.score);
      const oldScore = _prevScores[ind.id] ?? newScore;
      const delta    = newScore - oldScore;

      // Update CSS custom properties for smooth transition
      cell.style.setProperty('--cell-bg',   scoreToBackground(newScore));
      cell.style.setProperty('--cell-text', scoreToTextColor(newScore));

      // Update score display
      const scoreEl = cell.querySelector('.cell-score');
      if (scoreEl) scoreEl.textContent = formatScore(newScore);

      // Update direction label
      const dirEl = cell.querySelector('.cell-dir');
      if (dirEl) dirEl.textContent = scoreToDirection(newScore);

      // Update bar
      const barFill = cell.querySelector('.cell-score-bar-fill');
      if (barFill) {
        barFill.style.width = `${newScore}%`;
        barFill.style.backgroundColor = scoreToBarColor(newScore);
      }

      // Update delta indicator
      const deltaEl = cell.querySelector('.cell-delta');
      if (deltaEl) {
        if (Math.abs(delta) >= 0.3) {
          const sign = delta > 0 ? '+' : '';
          deltaEl.textContent = `${sign}${delta.toFixed(1)}`;
          deltaEl.className = `cell-delta ${delta > 0 ? 'pos' : 'neg'}`;
        } else {
          deltaEl.textContent = '';
          deltaEl.className = 'cell-delta';
        }
      }

      // Pulse animation for significant changes
      if (Math.abs(delta) >= 1.0) {
        changedCount++;
        cell.classList.remove('score-changed');
        void cell.offsetWidth; // force reflow
        cell.classList.add('score-changed');
        cell.dataset.score = String(newScore);
      }
    }
  }

  _snapshotScores(sectors);
  return changedCount;
}

function _snapshotScores(sectors) {
  for (const sector of sectors) {
    if (sector.id) _prevScores[sector.id] = Number(sector.score);
    for (const ind of sector.industries ?? []) {
      if (ind.id) _prevScores[ind.id] = Number(ind.score);
    }
  }
}
