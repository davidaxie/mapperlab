// events.js — Ticker tape and event card feed.

import { escHtml, safeHref, relTime } from './utils.js';

/**
 * Render the ticker tape (sticky top strip).
 * Content is doubled for a seamless CSS loop animation.
 *
 * @param {HTMLElement} trackEl - the #ticker-track element
 * @param {Array} events - event objects from /api/events
 */
export function renderTicker(trackEl, events) {
  if (!Array.isArray(events) || events.length === 0) {
    trackEl.textContent = 'No events yet — click ↻ Update to pull live data.';
    return;
  }

  // Build one set of ticker items
  const items = events.slice(0, 30).map(ev => {
    const source   = escHtml(ev.source ?? '');
    const headline = escHtml(ev.headline ?? '');
    return `<span class="ticker-item"><span class="ti-source">${source}</span>${headline}</span>`;
  }).join('');

  // Double for seamless loop (CSS animates -50%)
  const inner = document.createElement('span');
  inner.className = 'ticker-inner';
  inner.innerHTML = items + items;

  trackEl.innerHTML = '';
  trackEl.appendChild(inner);
}

/**
 * Render the event card grid.
 *
 * @param {HTMLElement} feedEl    - the #events-feed element
 * @param {Array}       events    - event objects from /api/events
 * @param {HTMLElement|null} countEl - the #events-count element (optional)
 */
export function renderEventCards(feedEl, events, countEl) {
  const isArr = Array.isArray(events);
  if (countEl) {
    countEl.textContent = isArr && events.length > 0 ? `${events.length} events` : '';
  }

  if (!isArr || events.length === 0) {
    feedEl.innerHTML = '<p class="muted">No events yet — click ↻ Update to pull live data.</p>';
    return;
  }

  feedEl.innerHTML = events.slice(0, 40).map(ev => {
    const source     = escHtml(ev.source ?? '');
    const time       = escHtml(relTime(ev.timestamp));
    const confidence = escHtml(ev.confidence ?? '');
    const confClass  = ev.confidence === 'high' ? 'ec-confidence high' : 'ec-confidence';
    const headline   = escHtml(ev.headline ?? '');
    const href       = safeHref(ev.url);

    const headlineHtml = href
      ? `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${headline}</a>`
      : headline;

    const sectors = Array.isArray(ev.sectors) ? ev.sectors : [];
    const sectorTags = sectors.slice(0, 4)
      .map(s => `<span class="ec-sector-tag">${escHtml(s)}</span>`)
      .join('');
    const sectorsHtml = sectorTags
      ? `<div class="ec-sectors">${sectorTags}</div>`
      : '';

    return `<div class="event-card">
      <div class="ec-meta">
        <span class="ec-source">${source}</span>
        <span class="ec-time">${time}</span>
        ${confidence ? `<span class="${confClass}">${confidence}</span>` : ''}
      </div>
      <div class="ec-headline">${headlineHtml}</div>
      ${sectorsHtml}
    </div>`;
  }).join('');
}
