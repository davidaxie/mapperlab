/**
 * updateService.js — Orchestrates the full data pipeline
 *
 * Exported functions consumed by server.js:
 *   initialize()     — first-run: load data + score on startup
 *   performUpdate()  — incremental: fetch + score + apply deltas + decay
 *
 * Pipeline per cycle:
 *   ingestData() → analyzeEvents() → dataStore.applyDelta() × n → dataStore.decay()
 */

import { ingestData }    from './dataIngestion.js';
import { analyzeEvents } from './aiAnalysis.js';
import { dataStore }     from './dataStore.js';

// Track event IDs already applied to avoid double-counting on overlapping windows
const _appliedIds = new Set();
const MAX_APPLIED = 2000;   // keep memory bounded

/**
 * runPipeline — core logic, shared by initialize() and performUpdate()
 */
async function runPipeline(label = 'update') {
  if (dataStore.isUpdating()) {
    console.log(`[updateService] ${label} skipped — already running`);
    return;
  }

  dataStore.setUpdating(true);
  const t0 = Date.now();
  console.log(`[updateService] ${label} started`);

  try {
    // 1. Ingest
    const events = await ingestData();
    const fresh  = events.filter(e => !_appliedIds.has(e.id));

    if (fresh.length === 0) {
      console.log('[updateService] No new events — skipping AI analysis');
      dataStore.decay();
      dataStore.setLastUpdate();
      return;
    }

    console.log(`[updateService] ${fresh.length} new events → AI analysis`);

    // 2. AI analysis
    const scored = await analyzeEvents(fresh);

    // 3. Apply deltas to store
    let appliedCount = 0;
    for (const se of scored) {
      for (const [sectorId, delta] of Object.entries(se.sectorDeltas || {})) {
        if (typeof delta === 'number' && !isNaN(delta)) {
          dataStore.applyDelta(sectorId, delta, se.source, se.headline);
          appliedCount++;
        }
      }

      // Record in event log
      dataStore.addEvent({
        id:         se.id,
        source:     se.source,
        headline:   se.headline,
        url:        se.url,
        timestamp:  se.timestamp,
        confidence: se.confidence,
        reasoning:  se.reasoning,
        sectors:    Object.keys(se.sectorDeltas || {}),
      });

      // Mark as applied
      _appliedIds.add(se.id);
    }

    // Prune _appliedIds to avoid unbounded growth
    if (_appliedIds.size > MAX_APPLIED) {
      const arr = [..._appliedIds];
      arr.splice(0, arr.length - MAX_APPLIED);
      _appliedIds.clear();
      arr.forEach(id => _appliedIds.add(id));
    }

    // 4. Entropy decay — nudge all scores 1.5% toward neutral
    dataStore.decay();

    // 5. Stamp last update time
    dataStore.setLastUpdate();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[updateService] ${label} done: ${fresh.length} events → ${appliedCount} delta applications in ${elapsed}s`);

  } catch (err) {
    console.error(`[updateService] ${label} error:`, err.message);
    throw err;
  } finally {
    dataStore.setUpdating(false);
  }
}

/**
 * initialize — called once at server startup.
 * Runs the full pipeline immediately.
 */
export async function initialize() {
  console.log('[updateService] Initializing MapperLab data...');
  await runPipeline('initialize');
  console.log('[updateService] Initialization complete');
}

/**
 * performUpdate — called by cron jobs (every 2h / 4h).
 */
export async function performUpdate() {
  await runPipeline('scheduled-update');
}
