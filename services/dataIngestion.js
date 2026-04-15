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

  // ─── Financial News ───────────────────────────────────────────────────────
  { name: 'WSJ Markets',              url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain',                              category: 'financial_news', sectorHints: ['financials', 'rates', 'fx', 'commodities'] },
  { name: 'WSJ US Business',          url: 'https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness',                            category: 'financial_news', sectorHints: ['financials', 'industrials', 'consumer-discretionary', 'technology'] },
  { name: 'MarketWatch Top Stories',  url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',                              category: 'financial_news', sectorHints: ['financials', 'technology', 'rates', 'commodities'] },
  { name: 'MarketWatch Real-Time',    url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',                       category: 'financial_news', sectorHints: ['financials', 'technology', 'rates', 'fx'] },
  { name: 'Barron\'s Online',         url: 'https://feeds.content.dowjones.io/public/rss/RSSBarronsOnline',                           category: 'financial_news', sectorHints: ['financials', 'technology', 'rates', 'real-estate'] },
  { name: 'CNBC Top News',            url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',                                   category: 'financial_news', sectorHints: ['financials', 'technology', 'energy', 'consumer-discretionary'] },
  { name: 'CNBC Finance',             url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',                                    category: 'financial_news', sectorHints: ['financials', 'rates', 'fx'] },
  { name: 'CNBC US Economy',          url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',                                    category: 'macro',          sectorHints: ['financials', 'rates', 'consumer-staples', 'industrials'] },
  { name: 'CNBC Energy',              url: 'https://www.cnbc.com/id/19836768/device/rss/rss.html',                                    category: 'energy',         sectorHints: ['energy', 'utilities', 'materials', 'commodities'] },
  { name: 'CNBC Technology',          url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html',                                    category: 'financial_news', sectorHints: ['technology', 'financials'] },
  { name: 'Yahoo Finance',            url: 'https://finance.yahoo.com/news/rssindex',                                                  category: 'financial_news', sectorHints: ['financials', 'technology', 'energy', 'consumer-discretionary'] },
  { name: 'Seeking Alpha',            url: 'https://seekingalpha.com/feed.xml',                                                        category: 'financial_news', sectorHints: ['financials', 'technology', 'energy', 'real-estate', 'rates'] },
  { name: 'Motley Fool',              url: 'https://www.fool.com/a/feeds/foolwatch?apikey=foolwatch-feed',                             category: 'financial_news', sectorHints: ['technology', 'financials', 'consumer-discretionary', 'health-care'] },
  { name: 'Investing.com',            url: 'https://www.investing.com/rss/news.rss',                                                   category: 'financial_news', sectorHints: ['financials', 'fx', 'rates', 'commodities', 'technology'] },
  { name: 'Investing.com Commodities',url: 'https://www.investing.com/rss/news_11.rss',                                               category: 'financial_news', sectorHints: ['commodities', 'energy', 'materials'] },
  { name: 'Nasdaq Markets',           url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets',                                 category: 'financial_news', sectorHints: ['financials', 'technology', 'rates'] },
  { name: 'Kitco Gold News',          url: 'https://www.kitco.com/news/category/gold/rss',                                             category: 'financial_news', sectorHints: ['commodities', 'materials', 'fx'] },
  { name: 'Kitco Mining',             url: 'https://www.kitco.com/news/category/mining/rss',                                           category: 'financial_news', sectorHints: ['materials', 'commodities', 'energy'] },
  { name: 'OilPrice.com',             url: 'https://oilprice.com/rss/main',                                                            category: 'energy',         sectorHints: ['energy', 'commodities', 'utilities', 'materials'] },
  { name: 'CoinDesk',                 url: 'https://www.coindesk.com/arc/outboundfeeds/rss',                                           category: 'crypto',         sectorHints: ['crypto', 'technology', 'financials'] },
  { name: 'CoinTelegraph',            url: 'https://cointelegraph.com/rss',                                                            category: 'crypto',         sectorHints: ['crypto', 'technology'] },
  { name: 'Decrypt',                  url: 'https://decrypt.co/feed',                                                                  category: 'crypto',         sectorHints: ['crypto', 'technology'] },
  { name: 'The Block',                url: 'https://www.theblock.co/rss.xml',                                                          category: 'crypto',         sectorHints: ['crypto', 'technology', 'financials'] },
  { name: 'GlobeNewswire',            url: 'https://www.globenewswire.com/RssFeed/orgclass/1',                                         category: 'financial_news', sectorHints: ['financials', 'technology', 'energy', 'industrials'] },
  { name: 'GlobeNewswire Earnings',   url: 'https://www.globenewswire.com/RssFeed/subjectcode/13-Earnings+Releases+and+Operating+Results', category: 'financial_news', sectorHints: ['financials', 'technology', 'energy', 'industrials'] },
  { name: 'GlobeNewswire Energy',     url: 'https://www.globenewswire.com/RssFeed/industry/1-Energy',                                 category: 'energy',         sectorHints: ['energy', 'utilities', 'materials'] },
  { name: 'GlobeNewswire Financials', url: 'https://www.globenewswire.com/RssFeed/industry/8000-Financials',                           category: 'financial_news', sectorHints: ['financials', 'rates', 'real-estate'] },
  { name: 'PR Newswire',              url: 'https://www.prnewswire.com/rss/news-releases-list.rss',                                    category: 'financial_news', sectorHints: ['financials', 'technology', 'health-care', 'industrials'] },
  { name: 'PR Newswire Financial',    url: 'https://www.prnewswire.com/rss/financial-services-latest-news-list.rss',                  category: 'financial_news', sectorHints: ['financials', 'rates', 'real-estate'] },
  { name: 'FRED Blog',                url: 'https://fredblog.stlouisfed.org/feed/',                                                    category: 'macro',          sectorHints: ['rates', 'financials', 'commodities', 'fx'] },
  { name: 'Reuters (via Google)',     url: 'https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com&ceid=US:en&hl=en-US&gl=US', category: 'financial_news', sectorHints: ['financials', 'energy', 'technology', 'fx', 'rates', 'commodities'] },

  // ─── Reddit Finance ───────────────────────────────────────────────────────
  { name: 'Reddit: r/SecurityAnalysis',  url: 'https://www.reddit.com/r/SecurityAnalysis/.rss',  category: 'social_finance', sectorHints: ['technology', 'financials', 'consumer-discretionary', 'industrials', 'health-care'] },
  { name: 'Reddit: r/MacroEconomics',    url: 'https://www.reddit.com/r/MacroEconomics/.rss',    category: 'social_finance', sectorHints: ['rates', 'fx', 'commodities', 'industrials'] },
  { name: 'Reddit: r/Economics',         url: 'https://www.reddit.com/r/Economics/.rss',         category: 'social_finance', sectorHints: ['rates', 'fx', 'commodities', 'industrials', 'consumer-staples'] },
  { name: 'Reddit: r/investing',         url: 'https://www.reddit.com/r/investing/.rss',         category: 'social_finance', sectorHints: ['technology', 'financials', 'consumer-discretionary', 'industrials'] },
  { name: 'Reddit: r/ValueInvesting',    url: 'https://www.reddit.com/r/ValueInvesting/.rss',    category: 'social_finance', sectorHints: ['financials', 'industrials', 'consumer-staples', 'health-care', 'energy'] },
  { name: 'Reddit: r/stocks',            url: 'https://www.reddit.com/r/stocks/.rss',            category: 'social_finance', sectorHints: ['technology', 'consumer-discretionary', 'financials', 'industrials'] },
  { name: 'Reddit: r/wallstreetbets',    url: 'https://www.reddit.com/r/wallstreetbets/.rss',    category: 'social_finance', sectorHints: ['technology', 'consumer-discretionary', 'financials'] },
  { name: 'Reddit: r/GlobalMarkets',     url: 'https://www.reddit.com/r/GlobalMarkets/.rss',     category: 'social_finance', sectorHints: ['fx', 'rates', 'commodities', 'financials'] },
  { name: 'Reddit: r/algotrading',       url: 'https://www.reddit.com/r/algotrading/.rss',       category: 'social_finance', sectorHints: ['technology', 'financials'] },
  { name: 'Reddit: r/energy',            url: 'https://www.reddit.com/r/energy/.rss',            category: 'social_finance', sectorHints: ['energy', 'utilities', 'materials'] },
  { name: 'Reddit: r/Bitcoin',           url: 'https://www.reddit.com/r/Bitcoin/.rss',           category: 'social_finance', sectorHints: ['crypto'] },
  { name: 'Reddit: r/CryptoCurrency',    url: 'https://www.reddit.com/r/CryptoCurrency/.rss',    category: 'social_finance', sectorHints: ['crypto'] },
  { name: 'Reddit: r/RealEstate',        url: 'https://www.reddit.com/r/RealEstate/.rss',        category: 'social_finance', sectorHints: ['real-estate', 'financials', 'rates'] },
  { name: 'Reddit: r/bonds',             url: 'https://www.reddit.com/r/bonds/.rss',             category: 'social_finance', sectorHints: ['rates', 'financials'] },
  { name: 'Reddit: r/Commodities',       url: 'https://www.reddit.com/r/Commodities/.rss',       category: 'social_finance', sectorHints: ['commodities', 'energy', 'materials'] },
  { name: 'Reddit: r/Gold',              url: 'https://www.reddit.com/r/Gold/.rss',              category: 'social_finance', sectorHints: ['commodities', 'materials'] },
  { name: 'Reddit: r/finance',           url: 'https://www.reddit.com/r/finance/.rss',           category: 'social_finance', sectorHints: ['financials', 'technology', 'industrials', 'rates'] },
];

// ─── FRED series to watch ─────────────────────────────────────────────────────
const FRED_SERIES = [
  // Yield curve / rates
  { id: 'DGS2',       label: '2Y Treasury Yield',     sectorHints: ['rates', 'financials'],                              threshold: { abs: 0.05  } },
  { id: 'DGS10',      label: '10Y Treasury Yield',    sectorHints: ['rates', 'real-estate', 'utilities'],                threshold: { abs: 0.05  } },
  { id: 'T10Y2Y',     label: '10Y-2Y Spread',         sectorHints: ['rates', 'financials'],                              threshold: { abs: 0.05  } },
  { id: 'T10Y3M',     label: '10Y-3M Spread',         sectorHints: ['rates', 'financials'],                              threshold: { abs: 0.05  } },
  // Inflation
  { id: 'CPIAUCSL',   label: 'CPI YoY',               sectorHints: ['rates', 'consumer-staples', 'consumer-discretionary'], threshold: { abs: 0.1   } },
  { id: 'PCEPILFE',   label: 'Core PCE',              sectorHints: ['rates'],                                            threshold: { abs: 0.1   } },
  // Employment
  { id: 'PAYEMS',     label: 'Nonfarm Payrolls',      sectorHints: ['consumer-discretionary', 'financials'],             threshold: { abs: 50    } },
  { id: 'ICSA',       label: 'Initial Jobless Claims',sectorHints: ['consumer-discretionary'],                           threshold: { abs: 15000 } },
  // Credit spreads
  { id: 'BAMLC0A0CM', label: 'IG OAS',                sectorHints: ['rates', 'credit'],                                  threshold: { abs: 10    } },
  { id: 'BAMLH0A0HYM2', label: 'HY OAS',             sectorHints: ['rates', 'credit', 'financials'],                    threshold: { abs: 20    } },
  // Activity
  { id: 'DCOILWTICO', label: 'WTI Crude',             sectorHints: ['energy', 'energy-commodities'],                     threshold: { abs: 2.0   } },
  { id: 'GOLDAMGBD228NLBM', label: 'Gold Price',      sectorHints: ['commodities', 'metals'],                            threshold: { abs: 20.0  } },

  // TIER 1 — Regime detection
  { id: 'VIXCLS',          label: 'VIX',                    sectorHints: ['rates', 'credit', 'financials'],               threshold: { abs: 2.0  } },
  { id: 'STLFSI4',         label: 'Financial Stress Index',  sectorHints: ['financials', 'credit', 'real-estate'],         threshold: { abs: 0.3  } },
  { id: 'T5YIE',           label: '5Y Breakeven Inflation',  sectorHints: ['rates', 'real-estate', 'utilities'],           threshold: { abs: 0.10 } },
  { id: 'T10YIE',          label: '10Y Breakeven Inflation', sectorHints: ['rates', 'commodities'],                        threshold: { abs: 0.10 } },
  { id: 'BAMLHE00EHYIOAS', label: 'EUR HY OAS',              sectorHints: ['financials', 'fx'],                            threshold: { abs: 30   } },

  // TIER 2 — Activity indicators
  { id: 'NAPM',            label: 'ISM Mfg PMI',             sectorHints: ['industrials', 'materials', 'energy'],          threshold: { abs: 1.5  } },
  { id: 'USSLIND',         label: 'Leading Economic Index',  sectorHints: ['consumer-discretionary', 'industrials'],       threshold: { abs: 0.2  } },
  { id: 'UMCSENT',         label: 'Consumer Sentiment',      sectorHints: ['consumer-discretionary', 'retail'],            threshold: { abs: 3.0  } },
  { id: 'INDPRO',          label: 'Industrial Production',   sectorHints: ['industrials', 'materials'],                    threshold: { abs: 0.5  } },

  // TIER 3 — Sector-specific
  { id: 'DRSFRMACBS',      label: '30Y Mortgage Rate',       sectorHints: ['real-estate', 'construction'],                 threshold: { abs: 0.15 } },
  { id: 'DTWEXBGS',        label: 'USD Trade-Weighted',      sectorHints: ['commodities', 'fx', 'materials'],              threshold: { abs: 1.0  } },
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
  'social_finance': ['reddit', 'wsb', 'wallstreetbets', 'crowdsource', 'retail investor'],
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
    const minChange = series.threshold?.abs ?? 0.001;
    if (Math.abs(change) < minChange) return [];   // no meaningful move
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
