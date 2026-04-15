# MapperLab Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the basic dark grid with a world-class financial heatmap UI — continuous
colour gradients, proportional cells, live ticker, filter rail, sparkline sidebar,
proper ES module architecture.

**Architecture:** Vanilla HTML/CSS/JS with ES modules. Three zones: filter rail | heatmap
canvas | sliding detail panel. Each zone has its own JS module under public/js/.
The backend adds one new GET /api/events endpoint.

**Tech Stack:** Vanilla ES Modules · CSS Grid/Custom Properties · Inline SVG (sparklines,
gauge) · Existing Express/Node backend · Google Fonts (Space Grotesk + JetBrains Mono)

**Parallel Execution Guide:**
  Wave 1 (parallel): Task 1 + Task 2
  Wave 2 (parallel, after Task 2): Task 3 + Task 4 + Task 5
  Wave 3 (parallel, after Wave 2): Task 6 + Task 7 + Task 8 + Task 9
  Wave 4 (sequential): Task 10 -> Task 11

---

## File Map

  server.js              Modify: add GET /api/events route (6 lines)
  public/index.html      Rewrite: HTML shell with ticker, 3-col layout
  public/styles.css      Rewrite: full design system
  public/js/utils.js     Create: colour math, XSS helpers, SVG helpers
  public/js/api.js       Create: all fetch() calls
  public/js/heatmap.js   Create: grid render + score transitions
  public/js/sidebar.js   Create: detail panel with gauge + sparkline
  public/js/events.js    Create: ticker tape + event card feed
  public/js/filters.js   Create: filter rail state + sector toggles
  public/js/app.js       Create: main orchestrator, refresh loop

---

## Task 1 — Backend: Add GET /api/events

Files: Modify server.js (after line 74, before /api/sources route)

- [ ] Step 1.1: Find insertion point
  RUN: grep -n 'api/sources' /tmp/mapperlab/server.js
  EXPECT: ~line 75

- [ ] Step 1.2: Insert route into server.js after the /api/score/:id handler:

  app.get('/api/events', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const events = dataStore.getEvents().slice(0, limit);
      res.json(events);
    } catch (error) {
      console.error('Error getting events:', error);
      res.status(500).json({ error: 'Failed to get events' });
    }
  });

- [ ] Step 1.3: Restart and verify
  RUN: pkill -f "node server.js"; cd /tmp/mapperlab && PORT=3001 node server.js &
  RUN: sleep 6 && curl -s http://localhost:3001/api/events | python3 -c \
    "import json,sys; d=json.load(sys.stdin); print('list, len=', len(d))"
  EXPECT: "list, len= 4" (or similar count)

- [ ] Step 1.4: Commit
  git add server.js
  git commit -m "feat: add GET /api/events endpoint"

---

## Task 2 — HTML Shell

Files: Rewrite public/index.html

DOM IDs contract (all JS modules address these IDs — do NOT change them):
  #ticker-track       ticker tape scrolling area
  #heatmap            heatmap render target
  #filter-rail        filter sidebar container
  #filter-direction   direction radio group
  #filter-sort        sort radio group
  #search-input       text search input
  #sector-toggles     sector checkbox container
  #top-movers         top movers list
  #summary-bar        TW/neutral/HW counts
  #detail-panel       sliding detail panel
  #dp-sector-tag      sector name in panel header
  #dp-title           industry name in panel header
  #dp-close           close button
  #dp-score-zone      gauge + score number
  #dp-sparkline       sparkline SVG container
  #dp-timeline        score history list
  #dp-sources         source attribution list
  #dp-instruments     instruments tag list
  #events-feed        event card grid
  #events-count       event count label
  #refresh-btn        manual update trigger
  #live-dot           status indicator dot
  #live-label         status text
  #last-update-label  last update timestamp
  #stat-nodes         node count chip
  #stat-events        event count chip

Layout structure:
  .ticker-wrap        [sticky top ticker tape, 28px]
  .header             [sticky header: brand | legend | controls]
  .app-shell          [flex row: filter-rail + heatmap-main + detail-panel]
    .filter-rail      [200px wide, scrollable]
    .heatmap-main     [flex:1, contains .summary-bar + .heatmap-canvas]
    .detail-panel     [320px, slides in/out via .hidden class toggle]
  .events-section     [bottom panel: event cards]
  .footer

Script tag (must be type=module):
  <script type="module" src="js/app.js"></script>

- [ ] Step 2.1: Write new index.html following the structure + IDs above.
  All radio inputs use name="direction" and name="sort" for getFilterState() to work.
  The filter-direction group contains labels with data-value and class="filter-radio".

- [ ] Step 2.2: Verify
  RUN: curl -s http://localhost:3001/ | grep -c 'id='
  EXPECT: >= 20

- [ ] Step 2.3: Commit
  git add public/index.html
  git commit -m "feat: redesign HTML shell with ticker, filter rail, detail panel"

---

## Task 3 — CSS Design System

Files: Rewrite public/styles.css

Design tokens (CSS custom properties on :root):
  --bg          #080c10     page background
  --surface     #0d1117     cards, header, sidebar
  --surface-2   #131920     secondary surfaces
  --surface-3   #1a2230     tertiary, tags
  --border      #21292f     primary borders
  --border-2    #2a3540     hover/focus borders
  --text        #dce8f0     primary text
  --text-muted  #7a909e     secondary text
  --text-dim    #3e5060     labels, timestamps
  --accent      #2d88ff     tailwind accent / interactive
  --accent-dim  #1a4a8a     accent muted
  --tw-color    #90c4ff     tailwind score text
  --hw-color    #ff8888     headwind score text
  --cell-neutral #111820   zero-delta cell
  --font        'Space Grotesk', system-ui, sans-serif
  --mono        'JetBrains Mono', monospace
  --transition-color  background-color 600ms ease, color 300ms ease

Key layout rules:
  .app-shell: display:flex (NOT grid — detail panel slides in/out)
  .filter-rail: width:200px; flex-shrink:0; overflow-y:auto
  .heatmap-main: flex:1; overflow-y:auto; min-width:0
  .detail-panel: width:320px; flex-shrink:0; transition:transform 0.22s ease
  .detail-panel.hidden: transform:translateX(100%); width:0; border:none; pointer-events:none

Industry cell rules:
  .industry-cell: background:var(--cell-bg); color via --cell-text CSS vars
  Cell colour is set by JS via: cell.style.setProperty('--cell-bg', 'rgb(r,g,b)')
  The CSS reads: background: var(--cell-bg, var(--cell-neutral))
  Transition: background-color 600ms ease (smooth score updates)
  .industry-cell.score-changed: animation: score-pulse 600ms ease-out

Ticker:
  .ticker-inner: animation: ticker-scroll 60s linear infinite
  @keyframes ticker-scroll: translateX(0) to translateX(-100%)
  Content is doubled (items x2) to create seamless loop

Score bar (2px bottom strip on each cell):
  .cell-score-bar: position:absolute; bottom:0; left:0; right:0; height:2px
  .cell-score-bar-fill: width:{score}%; background-color:{barColor}; transition:600ms

Responsive breakpoints:
  <= 900px: .filter-rail display:none; .header-legend display:none
  <= 640px: .detail-panel position:fixed; width:100%; z-index:300

- [ ] Step 3.1: Write new styles.css implementing all tokens, layout, and component styles above.
  Every class referenced in index.html and the JS modules must exist in styles.css.
  Classes used by JS modules: .sector-row, .sector-row-header, .industries-wrap,
  .industry-cell, .cell-name, .cell-score, .cell-footer, .cell-dir, .cell-delta,
  .cell-score-bar, .cell-score-bar-fill, .score-changed, .sector-row.collapsed,
  .filter-radio.active, .sector-toggle, .sector-toggle.dimmed, .mover-row,
  .mover-tw, .mover-hw, .summary-pill, .pill-tw, .pill-neutral, .pill-hw,
  .ticker-inner, .ticker-item, .live-dot, .live-dot.green, .live-dot.yellow,
  .loading-state, .loading-spinner, .dp-gauge-wrap, .dp-score-number,
  .dp-score-dir, .dp-timeline, .tl-score, .tl-event, .tl-time, .dp-sources,
  .dp-instruments, .instrument-tag, .event-card, .ec-meta, .ec-source,
  .ec-time, .ec-confidence.high, .ec-headline, .ec-sectors, .ec-sector-tag

- [ ] Step 3.2: Verify CSS loads
  RUN: curl -s http://localhost:3001/styles.css | head -1
  EXPECT: /* line starting with reset or :root

- [ ] Step 3.3: Commit
  git add public/styles.css
  git commit -m "feat: complete CSS design system with continuous colour tokens"

---

## Task 4 — JS Utilities Module

Files: Create public/js/utils.js (also mkdir -p public/js)

NOTE: All functions in this file are pure (no DOM side effects).
NOTE: innerHTML used in other modules ALWAYS passes external data through escHtml() first.

Function signatures and behaviour:

  escHtml(str) -> string
    Replace &, <, >, ", ' with HTML entities.
    MUST be called on every string from the API (headlines, source names, URLs).

  safeHref(url) -> string
    Parse URL, return '' if protocol is not http: or https:.
    Blocks javascript:, data:, and malformed URLs.

  relTime(iso) -> string
    "just now" | "Nm ago" | "Nh ago" | "Nd ago"

  formatScore(s) -> string
    Number(s).toFixed(1)

  scoreToBackground(score) -> "rgb(r,g,b)"
    Lerp between:
      NEUTRAL  = [17, 24, 32]   (#111820)
      TAILWIND = [11, 65, 120]  (#0b4178) when score > 50
      HEADWIND = [107, 26, 26]  (#6b1a1a) when score < 50
    t = Math.pow((distance from 50) / 50, 0.7)  -- gamma 0.7 for perceptual linearity

  scoreToTextColor(score) -> hex string
    >= 60 -> '#90c4ff' (bright blue)
    55-59 -> '#7ab8f5' (medium blue)
    46-54 -> '#7a909e' (neutral gray)
    41-45 -> '#f0a0a0' (medium red)
    <= 40 -> '#ff8888' (bright red)

  scoreToBarColor(score) -> hex string
    >= 55 -> '#2d88ff'
    <= 45 -> '#d94040'
    else  -> '#3e5060'

  scoreToDirection(score) -> 'tailwind' | 'neutral' | 'headwind'
    >= 56 -> tailwind
    <= 44 -> headwind
    else  -> neutral

  scoreToIntensity(score) -> 'strong' | 'moderate' | 'mild'
    |score - 50| >= 22 -> strong
    |score - 50| >= 10 -> moderate
    else               -> mild

  sparklineSVG(points, w=220, h=40) -> SVG string (safe — no external data)
    points: number[] oldest-to-newest
    Draws polyline + neutral dashed line at y=50 + endpoint dot
    lineColor: #2d88ff if last >= 55, #d94040 if last <= 45, else #3e5060

  gaugeSVG(score, size=72) -> SVG string (safe — no external data)
    Semicircle arc from left(-180deg) to right(0deg)
    score 0=left red, score 50=top gray, score 100=right blue
    Draws track arc + filled portion + needle dot

- [ ] Step 4.1: mkdir -p /tmp/mapperlab/public/js

- [ ] Step 4.2: Write utils.js implementing all functions above.

- [ ] Step 4.3: Verify
  RUN: node --input-type=module --eval "
    import { scoreToBackground, scoreToDirection, sparklineSVG } from '/tmp/mapperlab/public/js/utils.js';
    console.log(scoreToBackground(72));   // expect rgb ~57,108,165
    console.log(scoreToDirection(72));    // expect tailwind
    console.log(scoreToBackground(32));   // expect rgb ~72,22,22
    console.log(sparklineSVG([45,50,55,60]).slice(0,5));  // expect '<svg '
  "
  EXPECT: values as noted above (no error)

- [ ] Step 4.4: Commit
  git add public/js/utils.js
  git commit -m "feat: utils.js with continuous colour math, SVG sparkline and gauge"

---

## Task 5 — JS API Client

Files: Create public/js/api.js

All fetch() calls in one place. Nothing else in the app touches the network directly.

  async get(path) -> parsed JSON (throws Error on non-OK HTTP)

  fetchHeatmap()         -> GET /api/heatmap      -> { sectors, updatedAt }
  fetchStatus()          -> GET /api/status       -> { status, lastUpdate, updating, scoresCount, eventsCount }
  fetchEvents(n=50)      -> GET /api/events?limit=n -> event[]
  fetchTimeline(id)      -> GET /api/timeline/:id -> { timestamp, score, delta, event }[]
  fetchSources(id)       -> GET /api/sources/:id  -> string[]
  triggerUpdate()        -> POST /api/update      -> { status, message }

  pollUntilDone(interval=3000, maxPolls=30) -> Promise<statusObject>
    Polls fetchStatus() on interval until status.updating === false or maxPolls reached.
    Resolves with the final status object. Rejects if fetch fails.

- [ ] Step 5.1: Write api.js implementing all functions above.
  Use encodeURIComponent() on id params in fetchTimeline and fetchSources.

- [ ] Step 5.2: Verify
  RUN: node --input-type=module --eval "
    const res = await fetch('http://localhost:3001/api/status');
    const s = await res.json();
    console.log('ok:', s.status === 'running', 'nodes:', s.scoresCount);
  "
  EXPECT: "ok: true nodes: 63"

- [ ] Step 5.3: Commit
  git add public/js/api.js
  git commit -m "feat: api.js client module with all endpoint wrappers"

---

## Task 6 — Heatmap Rendering Module

Files: Create public/js/heatmap.js

Imports: utils.js (escHtml, formatScore, scoreToBackground, scoreToTextColor,
         scoreToBarColor, scoreToDirection, scoreToIntensity)

Exports:
  renderHeatmap(container, data, options)
    Builds full DOM from data. Attaches click listeners via event delegation.
    Dispatches CustomEvent 'cell-click' with detail {id, name, sector, score, instruments}.
    options: { filter: { direction, sort, search, sectors: Set<id> } }
    
    Filter logic:
      - If filter.sectors has items, skip sectors not in the set
      - If filter.direction != 'all', skip industries where scoreToDirection(score) != filter.direction
      - If filter.search, skip industries where name.toLowerCase() does not include search
    
    Sort logic (applied to sector rows after filter):
      'sector'     -> default taxonomy order (no sort)
      'score-desc' -> highest sector.score first
      'score-asc'  -> lowest sector.score first

    Sector row HTML structure (MUST match CSS class names from Task 3):
      .sector-row[data-id]
        .sector-row-header (click toggles .collapsed on .sector-row)
          .sector-row-name
          .sector-row-bar > .sector-row-bar-fill (width=score%, bg=barColor)
          .sector-row-score (color=textColor)
          .sector-row-dir (class: dir-tw|dir-hw|dir-neutral)
          .sector-collapse-icon
        .industries-wrap
          .industry-cell x N (see below)

    Industry cell HTML structure:
      .industry-cell[data-id][data-label][data-sector][data-score][data-instruments]
                    [role=button][tabindex=0][aria-label]
                    [style="--cell-bg:rgb(...); --cell-text:#..."]
        .cell-name
        .cell-score
        .cell-footer
          .cell-dir
          .cell-delta (empty initially)
        .cell-score-bar > .cell-score-bar-fill[style="width:N%; background-color:..."]

    XSS: all text from taxonomy (names, ids) goes through escHtml().
    data-instruments attribute: JSON.stringify(array) passed through escHtml().

  applyTransitions(container, newData)
    Updates existing cells IN PLACE (no re-render). For each industry in newData:
      1. querySelector('.industry-cell[data-id="X"]')
      2. Update --cell-bg, --cell-text CSS custom properties
      3. Update .cell-score textContent
      4. Update .cell-dir textContent
      5. Update .cell-delta textContent ("+N.N" if |delta| >= 0.3, class pos/neg)
      6. Update .cell-score-bar-fill width and backgroundColor
      7. If |delta| >= 1.0: remove + add 'score-changed' class (with offsetWidth reflow)
    Returns count of cells that had significant change (>= 1.0 delta).

  Module-private: _prevScores object stores { [id]: score } snapshot for delta calc.
  _snapshotScores(sectors) updates _prevScores after each render/transition.

- [ ] Step 6.1: Write heatmap.js per spec above. All external data through escHtml().

- [ ] Step 6.2: Verify
  RUN: node --input-type=module --eval "
    import { renderHeatmap, applyTransitions } from '/tmp/mapperlab/public/js/heatmap.js';
    console.log(typeof renderHeatmap, typeof applyTransitions);
  "
  EXPECT: "function function"

- [ ] Step 6.3: Commit
  git add public/js/heatmap.js
  git commit -m "feat: heatmap.js with proportional grid, continuous colour, delta animations"

---

## Task 7 — Sidebar Detail Panel

Files: Create public/js/sidebar.js

Imports: utils.js (escHtml, relTime, formatScore, scoreToTextColor, scoreToDirection,
         scoreToIntensity, sparklineSVG, gaugeSVG)
         api.js (fetchTimeline, fetchSources)

Exports:
  initSidebar(panel)
    Attaches close button (#dp-close) click listener -> closeSidebar(panel)
    Attaches document keydown listener: Escape -> closeSidebar if panel not hidden

  closeSidebar(panel)
    panel.classList.add('hidden')

  openSidebar(panel, detail, industry)
    detail: { id, name, sector, score, instruments: string[] }
    industry: optional — full industry object from lastHeatmap for live score

    Steps:
    1. panel.classList.remove('hidden')
    2. Set #dp-sector-tag textContent = detail.sector
       Set #dp-title textContent = detail.name
    3. Render score zone (#dp-score-zone):
         gaugeSVG(score, 72) + score number + direction + intensity
         Use scoreToTextColor for number colour, dir-tw/dir-hw/dir-neutral class
    4. Render instruments (#dp-instruments):
         Map detail.instruments -> .instrument-tag spans (escHtml each)
    5. Set #dp-timeline to "Loading..." placeholder
       Set #dp-sources to "Loading..." placeholder
    6. Await Promise.all([fetchTimeline(id), fetchSources(id)])
    7. Render timeline (#dp-timeline, #dp-sparkline):
         sparklineSVG: reverse timeline to get oldest-first points
         timeline rows: .tl-score | .tl-event (escHtml) | .tl-time (relTime)
    8. Render sources (#dp-sources):
         li items, each through escHtml()

  NOTE on XSS:
    - detail.sector and detail.name come from taxonomy (trusted but still escHtml)
    - timeline event text is from RSS feeds -> MUST use escHtml
    - source strings are from RSS feed names -> MUST use escHtml
    - SVG from gaugeSVG/sparklineSVG is internal -> safe to set directly
    - Score/direction are computed numbers/enum strings -> safe

- [ ] Step 7.1: Write sidebar.js per spec above.

- [ ] Step 7.2: Verify
  RUN: node --input-type=module --eval "
    import { initSidebar, openSidebar, closeSidebar } from '/tmp/mapperlab/public/js/sidebar.js';
    console.log(typeof initSidebar, typeof openSidebar, typeof closeSidebar);
  "
  EXPECT: "function function function"

- [ ] Step 7.3: Commit
  git add public/js/sidebar.js
  git commit -m "feat: sidebar.js with arc gauge, sparkline, timeline, sources"

---

## Task 8 — Event Feed & Ticker

Files: Create public/js/events.js

Imports: utils.js (escHtml, safeHref, relTime)

Exports:
  renderTicker(trackEl, events)
    If no events: set placeholder text
    Otherwise: build .ticker-inner span with items doubled (for seamless CSS loop)
    Each item: .ticker-item > .ti-source span + headline text (both escHtml)
    Prepend .ticker-inner to trackEl (replacing previous content)

  renderEventCards(feedEl, events, countEl)
    If countEl provided: set textContent to "${events.length} events" or ""
    If no events: set feedEl to placeholder message
    Otherwise: render .event-card items (up to 40):
      .event-card
        .ec-meta > .ec-source (escHtml) | .ec-time (relTime) | .ec-confidence (escHtml, class "high" if val==="high")
        .ec-headline > <a href=safeHref target=_blank rel=noopener> or plain text (escHtml)
        .ec-sectors (optional) > .ec-sector-tag spans for ev.sectors[] (escHtml each, max 4)

  NOTE on XSS:
    ev.source -> escHtml
    ev.headline -> escHtml
    ev.url -> safeHref (validates protocol before using in href)
    ev.confidence -> escHtml
    ev.sectors[] -> escHtml each
    ev.timestamp -> relTime (internal format function, safe)

- [ ] Step 8.1: Write events.js per spec above.

- [ ] Step 8.2: Verify
  RUN: node --input-type=module --eval "
    import { renderTicker, renderEventCards } from '/tmp/mapperlab/public/js/events.js';
    console.log(typeof renderTicker, typeof renderEventCards);
  "
  EXPECT: "function function"

- [ ] Step 8.3: Commit
  git add public/js/events.js
  git commit -m "feat: events.js ticker tape and event card feed"

---

## Task 9 — Filter Panel Module

Files: Create public/js/filters.js

Imports: utils.js (escHtml)

Exports:
  initFilters(rail, sectors, onChange)
    rail: HTMLElement (.filter-rail)
    sectors: array from heatmap API
    onChange: function(filterState) -- called on every user interaction

    Steps:
    1. Build sector toggle checkboxes in #sector-toggles
       Each: label.sector-toggle > input[type=checkbox name=sector-toggle value=sector.id checked] + sector.name text
       On change: toggle label.dimmed class, call onChange(getFilterState(rail))
    2. Bind direction filter (#filter-direction radio inputs):
       On change: remove .active from all siblings, add to clicked label, call onChange
    3. Bind sort filter (#filter-sort radio inputs): same pattern
    4. Bind search input (#search-input): debounce 200ms, call onChange

  getFilterState(rail) -> { direction, sort, search, sectors: Set<id> }
    direction: value of checked input[name=direction] (default 'all')
    sort:      value of checked input[name=sort] (default 'sector')
    search:    #search-input value, trimmed, lowercased
    sectors:   Set of sector IDs where the checkbox is UNCHECKED (these are filtered OUT)
    Note: empty Set means "show all sectors" (all checked)

  renderTopMovers(moversEl, sectors)
    Collect all industries from all sectors
    Sort by |score - 50| descending (highest deviation first)
    Render top 5 as .mover-row > .mover-name (escHtml, truncated) + .mover-score (class mover-tw if >=50, mover-hw if <50)

  renderSummaryBar(barEl, sectors)
    Count industries: tw (score>=56), neutral (45-55), hw (score<=44)
    Render 3 .summary-pill spans: .pill-tw / .pill-neutral / .pill-hw
    Each contains .pill-count span + label text

- [ ] Step 9.1: Write filters.js per spec above. Use textContent for sector names in toggles (not innerHTML).

- [ ] Step 9.2: Verify
  RUN: node --input-type=module --eval "
    import { initFilters, getFilterState, renderTopMovers, renderSummaryBar } from '/tmp/mapperlab/public/js/filters.js';
    console.log(typeof initFilters, typeof getFilterState, typeof renderTopMovers, typeof renderSummaryBar);
  "
  EXPECT: "function function function function"

- [ ] Step 9.3: Commit
  git add public/js/filters.js
  git commit -m "feat: filters.js sector toggles, direction/sort filter, top movers, summary bar"

---

## Task 10 — Main Orchestrator

Files: Create public/js/app.js

Imports: api.js, heatmap.js, sidebar.js, events.js, filters.js

Module-level state:
  lastHeatmap  = null    (last /api/heatmap response)
  filterState  = { direction:'all', sort:'sector', search:'', sectors: new Set() }
  isFetching   = false
  filtersReady = false   (true after initFilters called once)

DOM elements to grab at module load:
  heatmapEl, detailPanel, filterRail, tickerTrack, eventsFeed,
  eventsCount, summaryBar, topMovers, refreshBtn, liveDot,
  liveLabel, lastUpdateEl, statNodes, statEvents

setLive(state, label):
  liveDot.className = 'live-dot ' + state   ('green'|'yellow'|'gray'|'red')
  liveLabel.textContent = label

rerenderWithFilters():
  if !lastHeatmap return
  renderHeatmap(heatmapEl, lastHeatmap, { filter: filterState, sort: filterState.sort })
  re-attach cell-click listener on heatmapEl

onCellClick(e):
  Extract { id, name, sector, score, instruments } from e.detail
  Find full industry object by id in lastHeatmap.sectors[].industries[]
  Call openSidebar(detailPanel, detail, industry)

refresh() -- the main loop function:
  Guard: if isFetching return; set isFetching=true; setLive('yellow','Refreshing...')
  Await Promise.all([fetchHeatmap(), fetchStatus(), fetchEvents(50)])
  On first render (!lastHeatmap):
    renderHeatmap(heatmapEl, heatmap, { filter: filterState })
    addEventListener('cell-click', onCellClick) on heatmapEl
    If !filtersReady: initFilters(filterRail, sectors, newState => { filterState=newState; rerenderWithFilters(); })
    Set filtersReady = true
  On subsequent renders:
    applyTransitions(heatmapEl, heatmap)
  Set lastHeatmap = heatmap
  Call renderTicker(tickerTrack, events)
  Call renderEventCards(eventsFeed, events, eventsCount)
  Call renderTopMovers(topMovers, sectors)
  Call renderSummaryBar(summaryBar, sectors)
  Update lastUpdateEl, statNodes, statEvents textContent (use textContent not innerHTML)
  Update live indicator based on status.updating and status.lastUpdate
  Finally: isFetching=false

refreshBtn click handler:
  Set refreshBtn.disabled=true; setLive('yellow','Starting update...')
  Await triggerUpdate()
  If response.status === 'updating': set label, re-enable btn, return
  Await pollUntilDone(3000, 30)
  Await refresh()
  Finally: refreshBtn.disabled=false

Sidebar init:
  initSidebar(detailPanel)

Boot:
  refresh()
  setInterval(refresh, 2 * 60 * 1000)

- [ ] Step 10.1: Write app.js per spec above.

- [ ] Step 10.2: Verify JS files all accessible:
  RUN: for f in utils.js api.js heatmap.js sidebar.js events.js filters.js app.js; do
         CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/js/$f)
         echo "$f: HTTP $CODE"
       done
  EXPECT: all 200

- [ ] Step 10.3: Commit
  git add public/js/app.js
  git commit -m "feat: app.js orchestrator with refresh loop, transitions, filter integration"

---

## Task 11 — Integration Test & Push

Files: No edits. Smoke test only.

- [ ] Step 11.1: Full smoke test
  RUN:
    STATUS=$(curl -s http://localhost:3001/api/status)
    SECTORS=$(curl -s http://localhost:3001/api/heatmap | python3 -c \
      'import json,sys; d=json.load(sys.stdin); print(len(d["sectors"]))')
    EVENTS=$(curl -s http://localhost:3001/api/events | python3 -c \
      'import json,sys; d=json.load(sys.stdin); print(type(d).__name__, len(d))')
    HTML=$(curl -s http://localhost:3001/)
    echo "sectors: $SECTORS (expect 15)"
    echo "events: $EVENTS (expect list N)"
    echo "module tag: $(echo $HTML | grep -c 'type=\"module\"') (expect 1)"
    echo "app.js ref: $(echo $HTML | grep -c 'js/app.js') (expect 1)"

  EXPECT:
    sectors: 15
    events: list N   (N >= 0)
    module tag: 1
    app.js ref: 1

- [ ] Step 11.2: Push
  RUN: cd /tmp/mapperlab && git log --oneline -12 && git push origin main
  EXPECT: ~11 commits listed, push succeeds

---

## Design Reference

Colour interpolation formula (implement in scoreToBackground):
  NEUTRAL  = [17, 24, 32]    rgb(17,24,32)   = #111820
  TAILWIND = [11, 65, 120]   rgb(11,65,120)  = #0b4178
  HEADWIND = [107, 26, 26]   rgb(107,26,26)  = #6b1a1a

  if score >= 50:
    t = (score - 50) / 50
    gamma = Math.pow(t, 0.7)
    lerp NEUTRAL -> TAILWIND by gamma
  else:
    t = (50 - score) / 50
    gamma = Math.pow(t, 0.7)
    lerp NEUTRAL -> HEADWIND by gamma

This gamma=0.7 means mid-range scores (55-65) show meaningful colour signal rather
than looking identical to neutral. At score=72 you get approximately rgb(57,108,165).
