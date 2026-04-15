/**
 * aiAnalysis.js — Converts ingested events → sector score deltas
 *
 * Strategy:
 *   1. If ANTHROPIC_API_KEY is set: batch events to Claude Haiku with a structured prompt.
 *   2. Fallback (no API key): keyword-based scoring using impact_matrix.json signals.
 *
 * Returns: ScoredEvent[]
 *   { id, source, headline, sectorDeltas: { [taxonomyId]: number }, confidence }
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── config ───────────────────────────────────────────────────────────────────
let impactMatrix = {};
let sourcesCfg   = {};
try {
  impactMatrix = JSON.parse(readFileSync(join(__dirname, '../config/impact_matrix.json'), 'utf-8'));
  sourcesCfg   = JSON.parse(readFileSync(join(__dirname, '../config/sources.json'),      'utf-8'));
} catch (e) {
  console.warn('[aiAnalysis] Config load warning:', e.message);
}

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL   = 'claude-haiku-4-5-20251001';
const BATCH_SIZE     = 8;   // slightly smaller batch for Haiku

// ─── keyword signals from sources.json / impact_matrix ───────────────────────
const TAILWIND_KEYWORDS = [
  ...(sourcesCfg?.keyword_signals?.tailwind || []),
  'rate cut', 'easing', 'stimulus', 'qe', 'quantitative easing',
  'strong earnings', 'beat expectations', 'approved', 'approval granted',
  'gdp growth', 'jobs added', 'unemployment falls', 'inflation cooling',
  'trade deal', 'ceasefire', 'stability',
];

const HEADWIND_KEYWORDS = [
  ...(sourcesCfg?.keyword_signals?.headwind || []),
  'rate hike', 'tightening', 'sanctions', 'tariff', 'export control',
  'miss expectations', 'below forecast', 'recession', 'layoffs', 'job cuts',
  'inflation surges', 'supply chain', 'disruption', 'warning', 'ban',
  'investigation', 'antitrust', 'regulatory action', 'downgrade',
  'geopolitical', 'conflict', 'tensions',
];

// Known event phrases → impact_matrix policy event IDs
const POLICY_PHRASE_MAP = [
  { phrases: ['rate hike', 'raises rates', 'rate increase'],   event: 'FED_RATE_HIKE_25BPS' },
  { phrases: ['rate cut', 'cuts rates', 'rate decrease'],      event: 'FED_RATE_CUT_25BPS' },
  { phrases: ['quantitative easing', 'qe', 'asset purchases'], event: 'FED_QE_ANNOUNCEMENT' },
  { phrases: ['qt', 'quantitative tightening', 'balance sheet reduction'], event: 'FED_QT_ACCELERATION' },
  { phrases: ['opec cut', 'opec+ cut', 'production cut'],      event: 'OPEC_SUPPLY_CUT' },
  { phrases: ['opec increase', 'opec+ increase', 'production increase'], event: 'OPEC_SUPPLY_INCREASE' },
  { phrases: ['china stimulus', 'pboc', 'fiscal package'],     event: 'CHINA_FISCAL_STIMULUS_LARGE' },
  { phrases: ['china tariff', 'tariff on china', 'trade war'], event: 'CHINA_TARIFF_ESCALATION' },
  { phrases: ['taiwan', 'strait of taiwan', 'tsmc'],           event: 'TAIWAN_STRAIT_ESCALATION' },
  { phrases: ['hormuz', 'strait of hormuz'],                   event: 'STRAIT_OF_HORMUZ_DISRUPTION' },
  { phrases: ['ira rollback', 'clean energy credit'],          event: 'IRA_TAX_CREDIT_ROLLBACK' },
  { phrases: ['crypto regulation', 'sec crypto', 'bitcoin etf'], event: 'CRYPTO_REGULATORY_CLARITY' },
  { phrases: ['export control', 'entity list', 'bis rule'],    event: 'EXPORT_CONTROL_SEMICONDUCTOR' },
];

// ─── Keyword-based fallback scorer ───────────────────────────────────────────
/**
 * scoreEventKeywords — returns { [taxonomyId]: delta } using simple keyword logic.
 * Positive = tailwind, negative = headwind.
 */
function scoreEventKeywords(event) {
  const text    = ((event.headline || '') + ' ' + (event.summary || '')).toLowerCase();
  const deltas  = {};
  const hints   = event.sectorHints || [];

  // 1. Check if it matches a known policy event
  for (const { phrases, event: policyEventId } of POLICY_PHRASE_MAP) {
    if (phrases.some(p => text.includes(p))) {
      const impacts = (impactMatrix.policy_events || []).find(e => e.event_id === policyEventId);
      if (impacts?.sector_deltas) {
        for (const [sector, delta] of Object.entries(impacts.sector_deltas)) {
          deltas[sector] = (deltas[sector] || 0) + delta;
        }
        deltas._confidence = impacts.confidence || 'medium';
        return deltas;
      }
    }
  }

  // 2. Generic tailwind/headwind keyword scoring
  const isTailwind = TAILWIND_KEYWORDS.some(kw => text.includes(kw));
  const isHeadwind = HEADWIND_KEYWORDS.some(kw => text.includes(kw));
  if (!isTailwind && !isHeadwind) return {};

  const baseDir = isTailwind ? 1 : -1;
  const baseMag = isTailwind && isHeadwind ? 1.5 : 3; // mixed signal → smaller move

  // Apply to each hinted sector with small magnitude
  for (const sector of hints) {
    deltas[sector] = parseFloat((baseDir * baseMag * (0.8 + Math.random() * 0.4)).toFixed(1));
  }

  return deltas;
}

// ─── Anthropic Claude batch scorer ───────────────────────────────────────────
const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

const TAXONOMY_IDS = [
  'technology','semiconductors','software','cybersecurity','hardware',
  'financials','banks','insurance','asset-management','fintech',
  'industrials','aerospace-defense','transportation','machinery','construction',
  'consumer-discretionary','autos','retail','travel',
  'consumer-staples','beverage','food','agri-business',
  'energy','upstream','services','refining','renewables',
  'materials','metals-mining','chemicals','paper',
  'health-care','pharma','biotech','medical-devices','providers',
  'utilities','electric','water',
  'real-estate','residential','commercial','data-center',
  'communications','media','telecom',
  'fx','g10','em-fx',
  'rates','ust','bunds','credit',
  'commodities','metals','energy-commodities','agriculture','livestock',
  'crypto','majors','exchanges',
];

const SYSTEM_PROMPT = `You are a macro analyst assistant for a financial heatmap application.

Given a list of recent macro/policy news events, return a JSON array of scored events.
For each event, identify which taxonomy nodes are affected and by how much on a delta scale of -15 to +15 (0 = no effect).
Positive = tailwind (good for that sector), Negative = headwind (bad for it).
Be conservative — most events affect 2-6 nodes.
Only score nodes that are clearly and directly affected.

Taxonomy node IDs you can use:
${TAXONOMY_IDS.join(', ')}

Return ONLY valid JSON — no markdown, no explanation, no code fences.
Just a raw JSON array:
[
  {
    "id": "<event_id>",
    "deltas": { "<taxonomy_id>": <number>, ... },
    "confidence": "high|medium|low",
    "reasoning": "<10-20 word explanation>"
  }
]`;

async function scoreWithClaude(events) {
  if (!anthropic) return null;
  const payload = events.map(e => ({
    id:       e.id,
    source:   e.source,
    category: e.category,
    headline: e.headline,
    summary:  (e.summary || '').slice(0, 150),
  }));

  try {
    const resp = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 1024,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role:    'user',
          content: JSON.stringify({ events: payload }),
        },
      ],
    });

    const raw = resp.content[0]?.text || '{}';

    // Claude sometimes wraps JSON in markdown fences — strip them
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try extracting first JSON array or object from the text
      const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        console.warn('[aiAnalysis] Claude returned non-JSON:', raw.slice(0, 200));
        return null;
      }
    }

    return Array.isArray(parsed) ? parsed : (parsed.events || parsed.scored_events || []);
  } catch (e) {
    console.warn('[aiAnalysis] Claude call failed:', e.message);
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * analyzeEvents(events) — scores ingested events → sector deltas.
 * Returns ScoredEvent[]:
 *   { id, source, headline, timestamp, sectorDeltas: {...}, confidence }
 */
export async function analyzeEvents(events) {
  if (!events || events.length === 0) return [];

  const results = [];

  if (anthropic) {
    // Batch into chunks of BATCH_SIZE
    const chunks = [];
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      chunks.push(events.slice(i, i + BATCH_SIZE));
    }

    const batchResults = await Promise.all(chunks.map(chunk => scoreWithClaude(chunk)));
    const claudeScores = batchResults.flat().filter(Boolean);

    // Build id → claudeScore map
    const claudeMap = {};
    for (const s of claudeScores) {
      if (s?.id) claudeMap[s.id] = s;
    }

    for (const event of events) {
      const claude = claudeMap[event.id];
      if (claude?.deltas && Object.keys(claude.deltas).length > 0) {
        results.push({
          id:           event.id,
          source:       event.source,
          headline:     event.headline,
          timestamp:    event.timestamp,
          url:          event.url,
          sectorDeltas: claude.deltas,
          confidence:   claude.confidence || 'medium',
          reasoning:    claude.reasoning  || '',
        });
      } else {
        // Claude returned nothing for this event — fall back to keywords
        const raw = scoreEventKeywords(event);
        if (Object.keys(raw).length > 0) {
          const confidence = raw._confidence || 'low';
          const { _confidence, ...sectorDeltas } = raw;
          if (Object.keys(sectorDeltas).length > 0) {
            results.push({
              id:           event.id,
              source:       event.source,
              headline:     event.headline,
              timestamp:    event.timestamp,
              url:          event.url,
              sectorDeltas,
              confidence,
              reasoning:    'keyword fallback',
            });
          }
        }
      }
    }
  } else {
    // No Anthropic key — use keyword scoring for all events
    console.log('[aiAnalysis] No ANTHROPIC_API_KEY — using keyword fallback');
    for (const event of events) {
      const raw = scoreEventKeywords(event);
      if (Object.keys(raw).length > 0) {
        const confidence = raw._confidence || 'low';
        const { _confidence, ...sectorDeltas } = raw;
        if (Object.keys(sectorDeltas).length > 0) {
          results.push({
            id:           event.id,
            source:       event.source,
            headline:     event.headline,
            timestamp:    event.timestamp,
            url:          event.url,
            sectorDeltas,
            confidence,
            reasoning:    'keyword fallback',
          });
        }
      }
    }
  }

  console.log(`[aiAnalysis] Scored ${results.length}/${events.length} events with deltas`);
  return results;
}
