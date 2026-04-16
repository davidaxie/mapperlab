// landing.js - MapperLab landing page interactions
// No external dependencies. Vanilla ES module.

// ---- Escape helper (defense-in-depth for innerHTML) -------------------------
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Nav: blur on scroll ----------------------------------------------------
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

// ---- Scroll Reveal via IntersectionObserver ---------------------------------
// IntersectionObserver is more performant than scroll listeners:
// it fires only when the element crosses the viewport threshold.
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ---- Counter Animation ------------------------------------------------------
function animateCounter(el, target, duration = 1200) {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = parseInt(entry.target.dataset.count, 10);
        if (!isNaN(target)) animateCounter(entry.target, target);
        counterObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.5 }
);
document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

// ---- Score helpers (light cream theme) --------------------------------------
// Text colors on light backgrounds — dark navy for bullish, dark red for bearish
function scoreColor(s) {
  if (s >= 60) return '#0d2347';
  if (s >= 55) return '#163a72';
  if (s >  45) return '#5a6878';
  if (s >  40) return '#8b3030';
  return '#7c1e1e';
}
// Bar fill colors — dark navy (bullish), dark red (bearish), mid-gray (neutral)
function scoreBarColor(s) {
  if (s >= 55) return '#163a72';
  if (s <= 45) return '#9b2626';
  return '#c8c1b5';
}
function scoreLabel(s) {
  if (s >= 56) return '&#9650; Bullish';
  if (s <= 44) return '&#9660; Bearish';
  return '&#9679; Neutral';
}
// Center-anchored bar: left+width based on deviation from 50
function centerBar(s, color) {
  const pct = s.toFixed(1);
  if (s >= 50) {
    const w = ((s - 50) * 2).toFixed(1);
    return `left:50%;width:${w}%;background:${color}`;
  }
  const w = ((50 - s) * 2).toFixed(1);
  return `left:${pct}%;width:${w}%;background:${color}`;
}
// Interpolate background color (cream neutral <-> tinted tw/hw) for industry cards
function scoreBg(s) {
  // neutral = cream white; bullish = pale blue-navy; bearish = pale rose
  const n  = [237, 233, 225]; // #ede9e1 cream
  const tw = [214, 224, 243]; // pale navy-blue tint
  const hw = [243, 220, 220]; // pale rose tint
  const [from, to, t] = s >= 50
    ? [n, tw, (s - 50) / 50]
    : [n, hw, (50 - s) / 50];
  const g = Math.pow(t, 0.65);
  const lerp = (a, b) => Math.round(a + (b - a) * g);
  return `rgb(${lerp(from[0],to[0])},${lerp(from[1],to[1])},${lerp(from[2],to[2])})`;
}

// ---- Mini Heatmap (hero) - top 6 sectors ------------------------------------
async function loadMiniHeatmap() {
  const container = document.getElementById('mini-heatmap');
  if (!container) return;

  let sectors;
  try {
    const res = await fetch('/api/heatmap');
    if (!res.ok) throw new Error('api unavailable');
    const data = await res.json();
    sectors = (data.sectors ?? []).slice(0, 6);
  } catch {
    // Fallback placeholder data when server unreachable
    sectors = [
      { name: 'Technology',   score: 50.8 },
      { name: 'Financials',   score: 55.9 },
      { name: 'Energy',       score: 52.5 },
      { name: 'Crypto',       score: 72.0 },
      { name: 'Real Estate',  score: 45.0 },
      { name: 'Health Care',  score: 52.0 },
    ];
  }

  // Build rows using only numeric scores and esc()-wrapped names
  const html = sectors.map(sec => {
    const s = Number(sec.score ?? 50);
    const bc = scoreBarColor(s);
    const tc = scoreColor(s);
    return `<div class="mini-sector">
      <span class="mini-sector-name">${esc(sec.name)}</span>
      <div class="mini-sector-bar-wrap">
        <div class="mini-sector-bar-fill" style="${centerBar(s, bc)}"></div>
      </div>
      <span class="mini-sector-score" style="color:${bc}">${s.toFixed(1)}</span>
      <span class="mini-sector-dir" style="color:${tc}">${scoreLabel(s)}</span>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

// ---- Full Preview Heatmap - all sectors + industries ------------------------
async function loadFullPreview() {
  const container = document.getElementById('full-preview-heatmap');
  if (!container) return;

  let sectors;
  try {
    const res = await fetch('/api/heatmap');
    if (!res.ok) throw new Error('api unavailable');
    const data = await res.json();
    sectors = data.sectors ?? [];
  } catch {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:#5a6878;font-size:0.85rem">
      Live data loads when the server is running.
      <br><a href="/app.html" style="color:#0d2347;text-decoration:none;font-weight:600">Launch App</a>
    </div>`;
    return;
  }

  const html = sectors.map(sec => {
    const ss = Number(sec.score ?? 50);
    const sbc = scoreBarColor(ss);
    const stc = scoreColor(ss);

    const cards = (sec.industries ?? []).map(ind => {
      const is = Number(ind.score ?? 50);
      const ibc = scoreBarColor(is);
      const itc = scoreColor(is);
      return `<div style="background:${scoreBg(is)};border-left:3px solid ${ibc};border-radius:5px;padding:8px 10px;min-width:120px;flex:1">
        <div style="font-size:0.68rem;color:#5a6878;margin-bottom:4px">${esc(ind.name)}</div>
        <div style="font-size:1rem;font-weight:700;font-family:'JetBrains Mono',monospace;color:${itc}">${is.toFixed(1)}</div>
        <div style="font-size:0.62rem;font-weight:600;color:${itc};margin-top:2px">${scoreLabel(is)}</div>
      </div>`;
    }).join('');

    return `<div style="margin-bottom:8px;background:#f8f6f1;border-radius:6px;overflow:hidden;border:1px solid #ddd8ce">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#ede9e1;border-bottom:1px solid #ddd8ce">
        <span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5a6878;width:160px;flex-shrink:0">${esc(sec.name)}</span>
        <div style="flex:1;height:5px;background:#d8d3c9;border-radius:3px;position:relative;overflow:hidden">
          <div style="position:absolute;height:100%;top:0;border-radius:3px;${centerBar(ss, sbc)}"></div>
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;color:${stc};width:36px;text-align:right">${ss.toFixed(1)}</span>
        <span style="font-size:0.65rem;font-weight:600;color:${stc};width:80px;text-align:right">${scoreLabel(ss)}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px">${cards}</div>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

// ---- Boot -------------------------------------------------------------------
loadMiniHeatmap();
loadFullPreview();
