/**
 * dataIngestion.js — Fetches live macro/policy events from real public feeds
 *
 * Sources (from config/sources.json):
 *   - Central bank RSS feeds (Fed, ECB, BoE, BoJ, SNB, RBA, BoC, BIS)
 *   - FRED API (economic indicators — key yield/inflation/employment series)
 *   - EIA API (oil/gas prices & inventories)
 *   - Federal Register API (recent significant rules)
 *   - USDA WASDE calendar
 *
 * Returns: IngestedEvent[]
 *   { id, source, category, headline, url, timestamp, sectorHints: string[] }
 */

import axios from 'axios';
import RSSParser from 'rss-parser';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── config ──────────────────────────────────────────────────────────────────
let sourcesCfg = {};
try {
  sourcesCfg = JSON.parse(readFileSync(join(__dirname, '../config/sources.json'), 'utf-8'));
} catch (e) {
  console.warn('[ingestion] sources.json not found, using built-in fallbacks');
}

const FRED_KEY = process.env.FRED_API_KEY || '';
const EIA_KEY  = process.env.EIA_API_KEY  || '';

// How old an item can be and still be ingested (48 h)
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

const rssParser = new RSSParser({ timeout: 8000, headers: { 'User-Agent': 'MapperLab/1.0' } });

// ─── Central bank RSS endpoints ───────────────────────────────────────────────
const CB_FEEDS = [
  { name: 'Federal Reserve',    url: 'https://www.federalreserve.gov/feeds/press_all.xml',                   category: 'monetary_policy', sectorHints: ['rates', 'financials', 'real-estate'] },
  { name: 'European Central Bank', url: 'https://www.ecb.europa.eu/rss/press.html',                         category: 'monetary_policy', sectorHints: ['rates', 'fx', 'financials'] },
  { name: 'Bank of England',    url: 'https://www.bankofengland.co.uk/rss/press_releases',                  category: 'monetary_policy', sectorHints: ['rates', 'fx'] },
  { name: 'Bank of Japan',      url: 'https://www.boj.or.jp/en/rss/release.xml',                            category: 'monetary_policy', sectorHints: ['rates', 'fx'] },
  { name: 'BIS',                url: 'https://www.bis.org/doclist/all_speeches.rss',                        category: 'monetary_policy', sectorHints: ['rates', 'financials'] },
  { name: 'RBA',                url: 'https://www.rba.gov.au/rss/rss-cb-speeches.xml',                     category: 'monetary_policy', sectorHints: ['rates', 'fx'] },
  { name: 'IMF News',           url: 'https://www.imf.org/en/News/RSS',                                    category: 'macro',           sectorHints: ['fx', 'rates', 'commodities'] },
  { name: 'EIA Weekly',         url: 'https://www.eia.gov/rss/press_releases.xml',                         category: 'energy',          sectorHints: ['energy', 'commodities'] },
  { name: 'USDA News',          url: 'https://www.usda.gov/rss/latest-releases.xml',                       category: 'agriculture',     sectorHints: ['agriculture', 'agri-business'] },
  { name: 'Federal Register',   url: 'https://federalregister.gov/api/v1/articles.rss?per_page=20&order=newest&significant=1', category: 'regulatory', sectorHints: [] },
  { name: 'SEC News',           url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=20&output=atom', category: 'regulatory', sectorHints: ['financials'] },
];

// ─── FRED series to watch ─────────────────────────────────────────────────────
const FRED_SERIES = [
  // Yield curve / rates
  { id: 'DGS2',       label: '2Y Treasury Yield',     sectorHints: ['rates', 'financials'] },
  { id: 'DGS10',      label: '10Y Treasury Yield',    sectorHints: ['rates', 'real-estate', 'utilities'] },
  { id: 'T10Y2Y',     label: '10Y-2Y Spread',         sectorHints: ['rates', 'financials'] },
  { id: 'T10Y3M',     label: '10Y-3M Spread',         sectorHints: ['rates', 'financials'] },
  // Inflation
  { id: 'CPIAUCSL',   label: 'CPI YoY',               sectorHints: ['rates', 'consumer-staples', 'consumer-discretionary'] },
  { id: 'PCEPILFE',   label: 'Core PCE',              sectorHints: ['rates'] },
  // Employment
  { id: 'PAYEMS',     label: 'Nonfarm Payrolls',      sectorHints: ['consumer-discretionary', 'financials'] },
  { id: 'ICSA',       label: 'Initial Jobless Claims',sectorHints: ['consumer-discretionary'] },
  // Credit spreads
  { id: 'BAMLC0A0CM', label: 'IG OAS',                sectorHints: ['rates', 'credit'] },
  { id: 'BAMLH0A0HYM2', label: 'HY OAS',             sectorHints: ['rates', 'credit', 'financials'] },
  // Activity
  { id: 'DCOILWTICO', label: 'WTI Crude',             sectorHints: ['energy', 'energy-commodities'] },
  { id: 'GOLDAMGBD228NLBM', label: 'Gold Price',      sectorHints: ['commodities', 'metals'] },
];

// ─── EIA series ───────────────────────────────────────────────────────────────
const EIA_SERIES = [
  { id: 'PET.RWTC.W',           label: 'WTI Spot Price',        sectorHints: ['energy', 'energy-commodities'] },
  { id: 'PET.WCESTUS1.W',       label: 'US Crude Inventories',  sectorHints: ['energy', 'upstream'] },
  { id: 'NG.RNGWHHD.D',         label: 'Henry Hub Nat Gas',     sectorHints: ['energy', 'upstream'] },
  { id: 'NG.NW2_EPG0_SWO_R48_BCF.W', label: 'Nat Gas Storage', sectorHints: ['energy', 'upstream'] },
];

// ─── Keyword-to-sector hints ──────────────────────────────────────────────────
const SECTOR_KEYWORDS = {
  'technology':     ['semiconductor', 'chip', 'software', 'ai ', 'artificial intelligence', 'cyber', 'cloud', 'tech '],
  'financials':     ['bank', 'fed ', 'federal reserve', 'rate hike', 'interest rate', 'credit', 'lending', 'capital'],
  'energy':         ['oil', 'wti', 'brent', 'crude', 'gas ', 'natural gas', 'opec', 'refin', 'pipeline', 'lng'],
  'materials':      ['copper', 'iron ore', 'steel', 'aluminum', 'chemical', 'mining'],
  'health-care':    ['fda ', 'drug', 'pharma', 'biotech', 'clinical', 'approval', 'medicare', 'medicaid'],
  'consumer-discretionary': ['tariff', 'consumer', 'retail', 'auto', 'ev ', 'travel'],
  'consumer-staples':       ['food ', 'agriculture', 'wheat', 'corn', 'soybean', 'usda'],
  'commodities':    ['gold', 'silver', 'commodity', 'futures', 'metals', 'wheat', 'corn'],
  'crypto':         ['bitcoin', 'btc', 'ethereum', 'crypto', 'digital asset', 'stablecoin', 'defi'],
  'fx':             ['dollar', 'euro', 'yen', 'yuan', 'currency', 'exchange rate', 'forex'],
  'rates':          ['treasury', 'yield', 'bond', 'inflation', 'cpi', 'pce', 'rate'],
  'real-estate':    ['housing', 'mortgage', 'reit', 'real estate', 'construction'],
  'industrials':    ['defense', 'aerospace', 'industrial', 'manufacturing', 'transport'],
  'utilities':      ['electric', 'utility', 'power grid', 'renewable', 'solar', 'wind'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isRecent(dateStr) {
  try {
    return Date.now() - new Date(dateStr).getTime() < MAX_AGE_MS;
  } catch { return true; }
}

function guessHints(text, explicit = []) {
  const lower = (text || '').toLowerCase();
  const hints = new Set(explicit);
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw))) hints.add(sector);
  }
  return [...hints];
}

function makeId(source, title) {
  return `${source}:${title}`.replace(/\s+/g, '_').slice(0, 80);
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchRSS(feed) {
  try {
    const parsed = await rssParser.parseURL(feed.url);
    const events = [];
    for (const item of (parsed.items || []).slice(0, 15)) {
      if (!isRecent(item.pubDate || item.isoDate)) continue;
      events.push({
        id:          makeId(feed.name, item.title || ''),
        source:      feed.name,
        category:    feed.category,
        headline:    (item.title || '').trim(),
        summary:     (item.contentSnippet || item.summary || '').slice(0, 300),
        url:         item.link || feed.url,
        timestamp:   item.pubDate || item.isoDate || new Date().toISOString(),
        sectorHints: guessHints((item.title || '') + ' ' + (item.contentSnippet || ''), feed.sectorHints),
      });
    }
    return events;
  } catch (e) {
    console.warn(`[ingestion] RSS ${feed.name}: ${e.message}`);
    return [];
  }
}

async function fetchFredSeries(series) {
  if (!FRED_KEY) return [];   // skip silently — no key provided
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=2`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const obs = (data.observations || []).filter(o => o.value !== '.');
    if (obs.length < 2) return [];
    const latest = parseFloat(obs[0].value);
    const prev   = parseFloat(obs[1].value);
    const change = latest - prev;
    if (Math.abs(change) < 0.001) return [];   // no meaningful move
    return [{
      id:          `FRED:${series.id}:${obs[0].date}`,
      source:      'FRED',
      category:    'economic_data',
      headline:    `${series.label}: ${latest.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)})`,
      summary:     `Latest: ${obs[0].date}. Previous: ${obs[1].date} = ${prev.toFixed(2)}`,
      url:         `https://fred.stlouisfed.org/series/${series.id}`,
      timestamp:   new Date(obs[0].date).toISOString(),
      sectorHints: series.sectorHints,
      value:       latest,
      change,
    }];
  } catch (e) {
    console.warn(`[ingestion] FRED ${series.id}: ${e.message}`);
    return [];
  }
}

async function fetchEIASeries(series) {
  if (!EIA_KEY) return [];
  // EIA API v2 format
  const [route, freq] = series.id.split('.');
  const url = `https://api.eia.gov/v2/seriesid/${series.id}?api_key=${EIA_KEY}&data[]=value&sort[0][column]=period&sort[0][direction]=desc&length=2`;
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const rows = data?.response?.data || [];
    if (rows.length < 2) return [];
    const latest = parseFloat(rows[0].value);
    const prev   = parseFloat(rows[1].value);
    const change = latest - prev;
    if (Math.abs(change) < 0.01) return [];
    return [{
      id:          `EIA:${series.id}:${rows[0].period}`,
      source:      'EIA',
      category:    'energy',
      headline:    `${series.label}: ${latest.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)})`,
      summary:     `Period: ${rows[0].period}`,
      url:         `https://www.eia.gov`,
      timestamp:   new Date().toISOString(),
      sectorHints: series.sectorHints,
      value:       latest,
      change,
    }];
  } catch (e) {
    console.warn(`[ingestion] EIA ${series.id}: ${e.message}`);
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * ingestData() — fetches all sources concurrently, deduplicates by id.
 * Returns IngestedEvent[] sorted newest first.
 */
export async function ingestData() {
  console.log('[ingestion] Starting parallel fetch...');

  const [rssResults, fredResults, eiaResults] = await Promise.allSettled([
    // All RSS feeds in parallel
    Promise.all(CB_FEEDS.map(f => fetchRSS(f))),
    // FRED series
    Promise.all(FRED_SERIES.map(s => fetchFredSeries(s))),
    // EIA series
    Promise.all(EIA_SERIES.map(s => fetchEIASeries(s))),
  ]);

  const allEvents = [];

  for (const result of [rssResults, fredResults, eiaResults]) {
    if (result.status === 'fulfilled') {
      result.value.flat().forEach(e => allEvents.push(e));
    }
  }

  // Deduplicate by id, sort newest first
  const seen = new Set();
  const unique = allEvents.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  unique.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  console.log(`[ingestion] Collected ${unique.length} events from ${CB_FEEDS.length} feeds + FRED + EIA`);
  return unique;
}
