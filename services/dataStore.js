/**
 * dataStore.js — In-memory singleton store for MapperLab scores
 *
 * Loaded by server.js as:   import { dataStore } from './services/dataStore.js';
 *
 * Methods consumed by server.js:
 *   dataStore.lastUpdate          — ISO timestamp or null
 *   dataStore.isUpdating()        — boolean
 *   dataStore.getScores()         — raw scores map { id -> { score, sources, lastChanged } }
 *   dataStore.getFormattedScores()— enriched map for heatmap render
 *   dataStore.getScore(id)        — single raw score entry
 *   dataStore.getSources(id)      — array of source strings for that node
 *   dataStore.getTimeline(id)     — array of { timestamp, score, event }
 *   dataStore.getEvents()         — recent event log
 *
 * Additional methods used by updateService.js:
 *   dataStore.setUpdating(bool)
 *   dataStore.applyDelta(id, delta, source, eventText)
 *   dataStore.addEvent(event)
 *   dataStore.setLastUpdate()
 *   dataStore.decay()             — nudge all scores 1% toward 50 (entropy)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── load static config ────────────────────────────────────────────────────
function loadJson(relPath) {
  try {
    return JSON.parse(readFileSync(join(__dirname, relPath), 'utf-8'));
  } catch (e) {
    console.error(`[dataStore] Failed to load ${relPath}:`, e.message);
    return {};
  }
}

const taxonomy    = loadJson('../taxonomy.json');
const impactCfg   = loadJson('../config/impact_matrix.json');
const BASELINE    = impactCfg.baseline_scores_april_2026 || {};

// ─── Map taxonomy IDs → baseline scores ────────────────────────────────────
// taxonomy uses kebab-case; impact_matrix uses snake_case — explicit mapping
const SCORE_MAP = {
  // Sectors (aggregates)
  'technology':            55,
  'financials':            56,
  'industrials':           55,
  'consumer-discretionary':48,
  'consumer-staples':      55,
  'energy':                52,
  'materials':             50,
  'health-care':           52,
  'utilities':             55,
  'real-estate':           45,
  'communications':        56,
  'fx':                    44,
  'rates':                 42,
  'commodities':           58,
  'crypto':                BASELINE.crypto_btc || 72,

  // Technology
  'semiconductors':        BASELINE.semiconductors       || 45,
  'software':              BASELINE.software             || 62,
  'cybersecurity':         BASELINE.cybersecurity        || 65,
  'hardware':              BASELINE.hardware             || 45,

  // Financials
  'banks':                 BASELINE.banks                || 56,
  'insurance':             BASELINE.insurance_pc         || 38,
  'asset-management':      BASELINE.asset_management_alts|| 70,
  'fintech':               BASELINE.fintech              || 58,

  // Industrials
  'aerospace-defense':     BASELINE.aerospace_defense    || 68,
  'transportation':        BASELINE.transportation       || 50,
  'machinery':             BASELINE.machinery            || 52,
  'construction':          BASELINE.construction_homebuilders || 45,

  // Consumer Discretionary
  'autos':                 BASELINE.autos_ev             || 42,
  'retail':                BASELINE.retail               || 48,
  'travel':                BASELINE.travel               || 52,

  // Consumer Staples
  'beverage':              55,
  'food':                  BASELINE.food_staples         || 55,
  'agri-business':         BASELINE.agribusiness         || 48,

  // Energy
  'upstream':              BASELINE.upstream_oil         || 56,
  'services':              BASELINE.oil_services         || 52,
  'refining':              BASELINE.refining             || 50,
  'renewables':            BASELINE.renewables           || 35,

  // Materials
  'metals-mining':         BASELINE.metals_mining_iron_ore || 48,
  'chemicals':             BASELINE.chemicals            || 45,
  'paper':                 50,

  // Health Care
  'pharma':                BASELINE.pharma               || 52,
  'biotech':               BASELINE.biotech              || 55,
  'medical-devices':       BASELINE.medical_devices      || 58,
  'providers':             BASELINE.managed_care         || 45,

  // Utilities
  'electric':              BASELINE.electric_utilities   || 55,
  'water':                 BASELINE.water_utilities      || 56,

  // Real Estate
  'residential':           BASELINE.residential_reits    || 45,
  'commercial':            BASELINE.commercial_reits_office || 32,
  'data-center':           BASELINE.data_center_reits    || 65,

  // Communications
  'media':                 BASELINE.media_streaming      || 60,
  'telecom':               BASELINE.telecom              || 52,

  // FX
  'g10':                   46,
  'em-fx':                 BASELINE.fx_cnh               || 40,

  // Rates
  'ust':                   BASELINE.rates_10y_ust        || 42,
  'bunds':                 48,
  'credit':                BASELINE.rates_credit_hy      || 45,

  // Commodities
  'metals':                BASELINE.gold                 || 72,
  'energy-commodities':    BASELINE.wti                  || 52,
  'agriculture':           BASELINE.agriculture_soybeans || 42,
  'livestock':             50,
  'lumber':                48,

  // Crypto
  'majors':                BASELINE.crypto_btc           || 72,
  'exchanges':             BASELINE.crypto_exchanges     || 60,
};

// ─── Build sector → [industryIds] index from taxonomy ──────────────────────
const SECTOR_INDUSTRIES = {};
const ID_TO_META = {};          // id → { name, sectorId, sectorName, type }

(taxonomy.sectors || []).forEach(sector => {
  SECTOR_INDUSTRIES[sector.id] = [];
  ID_TO_META[sector.id] = {
    name: sector.name,
    sectorId: sector.id,
    sectorName: sector.name,
    type: 'sector',
  };
  (sector.industries || []).forEach(ind => {
    SECTOR_INDUSTRIES[sector.id].push(ind.id);
    ID_TO_META[ind.id] = {
      name: ind.name,
      sectorId: sector.id,
      sectorName: sector.name,
      type: 'industry',
      instruments: ind.instruments || [],
    };
  });
});

// ─── Private in-memory state ────────────────────────────────────────────────
const _state = {
  scores:    {},   // id → { score, sources: string[], lastChanged: ISO }
  timeline:  {},   // id → [{ timestamp, score, event }]
  events:    [],   // global event log (newest first)
  updating:  false,
  lastUpdate: null,
  velocity:  {},   // id → EMA velocity (pts per update cycle)
};

function _clamp(n) { return Math.max(0, Math.min(100, Math.round(n * 10) / 10)); }

function _initScores() {
  Object.keys(SCORE_MAP).forEach(id => {
    _state.scores[id] = {
      score:       SCORE_MAP[id],
      sources:     [],
      lastChanged: new Date().toISOString(),
    };
    _state.timeline[id] = [];
    _state.velocity[id] = 0;
  });
}

_initScores();

// ─── Exported singleton ─────────────────────────────────────────────────────
export const dataStore = {

  get lastUpdate() { return _state.lastUpdate; },

  isUpdating() { return _state.updating; },

  setUpdating(val) { _state.updating = Boolean(val); },

  setLastUpdate() { _state.lastUpdate = new Date().toISOString(); },

  getScores() { return { ..._state.scores }; },

  getScore(id) { return _state.scores[id] || null; },

  getSources(id) {
    return (_state.scores[id]?.sources ?? []).slice(0, 20);
  },

  getVelocity(id) {
    return _state.velocity[id] ?? 0;
  },

  getTimeline(id) {
    return (_state.timeline[id] ?? []).slice(0, 100);
  },

  getEvents() { return _state.events.slice(0, 50); },

  /**
   * getFormattedScores — returns heatmap-ready hierarchy
   * Shape:
   *   {
   *     sectors: [{ id, name, score, direction, industries: [...] }],
   *     updatedAt: ISO,
   *   }
   */
  getFormattedScores() {
    const sectors = (taxonomy.sectors || []).map(sector => {
      const sScore = _state.scores[sector.id];
      const industries = (sector.industries || []).map(ind => {
        const iScore = _state.scores[ind.id];
        return {
          id:          ind.id,
          name:        ind.name,
          score:       iScore?.score ?? 50,
          direction:   _direction(iScore?.score ?? 50),
          intensity:   _intensity(iScore?.score ?? 50),
          velocity:    _state.velocity[ind.id] ?? 0,
          sources:     (iScore?.sources ?? []).slice(0, 5),
          lastChanged: iScore?.lastChanged ?? null,
          instruments: ind.instruments || [],
        };
      });

      // Sector score = mean of its industries
      const mean = industries.length
        ? industries.reduce((s, i) => s + i.score, 0) / industries.length
        : (sScore?.score ?? 50);

      const twCount = industries.filter(i => i.score >= 56).length;
      const hwCount = industries.filter(i => i.score <= 44).length;
      const indCount = industries.length || 1;  // avoid div by zero

      return {
        id:          sector.id,
        name:        sector.name,
        weight:      sector.weight,
        score:       _clamp(mean),
        direction:   _direction(mean),
        intensity:   _intensity(mean),
        velocity:    _state.velocity[sector.id] ?? 0,
        breadth: {
          tw_pct: twCount / indCount,
          hw_pct: hwCount / indCount,
        },
        industries,
      };
    });

    return {
      sectors,
      updatedAt: _state.lastUpdate,
    };
  },

  /**
   * applyDelta — add a scored event to an industry/sector node.
   * delta > 0 = tailwind, delta < 0 = headwind.
   */
  applyDelta(id, delta, source, eventText) {
    if (!_state.scores[id]) return;
    const before = _state.scores[id].score;
    const after  = _clamp(before + delta);
    _state.scores[id].score = after;
    _state.scores[id].lastChanged = new Date().toISOString();

    // Velocity EMA: smooth 7-day-equivalent tracking
    // Alpha = 0.2 gives roughly 7-period EMA
    const prevVelocity = _state.velocity[id] ?? 0;
    _state.velocity[id] = prevVelocity * 0.8 + (after - before) * 0.2;

    // Keep up to 10 unique source strings per node
    const src = source || 'Unknown';
    if (!_state.scores[id].sources.includes(src)) {
      _state.scores[id].sources.unshift(src);
      _state.scores[id].sources = _state.scores[id].sources.slice(0, 10);
    }

    // Timeline entry
    if (!_state.timeline[id]) _state.timeline[id] = [];
    _state.timeline[id].unshift({
      timestamp: new Date().toISOString(),
      score:     after,
      delta,
      event:     eventText || src,
    });
    _state.timeline[id] = _state.timeline[id].slice(0, 100);
  },

  addEvent(event) {
    _state.events.unshift({ ...event, timestamp: new Date().toISOString() });
    _state.events = _state.events.slice(0, 200);
  },

  /**
   * decay — nudge all scores 1.5 % toward 50 (entropy / mean-reversion).
   * Called after each update cycle so stale signals fade naturally.
   */
  decay() {
    Object.keys(_state.scores).forEach(id => {
      const s = _state.scores[id].score;
      if (s === 50) return;
      _state.scores[id].score = _clamp(s + (50 - s) * 0.015);
    });
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────
function _direction(score) {
  if (score >= 56) return 'tailwind';
  if (score <= 44) return 'headwind';
  return 'neutral';
}

function _intensity(score) {
  const dist = Math.abs(score - 50);
  if (dist >= 25) return 'strong';
  if (dist >= 12) return 'moderate';
  return 'mild';
}
