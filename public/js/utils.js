// utils.js — Pure helper functions. No DOM dependencies.

/**
 * Escape HTML special chars. MUST be applied to all external API strings
 * before setting innerHTML.
 */
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate URL — return '' if not http(s) (blocks javascript:, data:, etc.)
 */
export function safeHref(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch {
    return '';
  }
}

/** Relative time: "just now" | "Nm ago" | "Nh ago" | "Nd ago" */
export function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Format score to 1 decimal place */
export function formatScore(s) {
  return Number(s).toFixed(1);
}

/**
 * Continuous background colour interpolation.
 *
 * NEUTRAL  = [17, 24, 32]    (#111820)
 * TAILWIND = [11, 65, 120]   (#0b4178) — score > 50
 * HEADWIND = [107, 26, 26]   (#6b1a1a) — score < 50
 *
 * gamma = 0.7 gives perceptual linearity (mid-range scores show meaningful colour)
 */
export function scoreToBackground(score) {
  const NEUTRAL  = [17, 24, 32];
  const TAILWIND = [11, 65, 120];
  const HEADWIND = [107, 26, 26];

  let from, to, t;
  if (score >= 50) {
    from = NEUTRAL;
    to   = TAILWIND;
    t    = (score - 50) / 50;
  } else {
    from = NEUTRAL;
    to   = HEADWIND;
    t    = (50 - score) / 50;
  }
  const gamma = Math.pow(t, 0.7);
  const r = Math.round(from[0] + (to[0] - from[0]) * gamma);
  const g = Math.round(from[1] + (to[1] - from[1]) * gamma);
  const b = Math.round(from[2] + (to[2] - from[2]) * gamma);
  return `rgb(${r},${g},${b})`;
}

/** Text colour for score display */
export function scoreToTextColor(score) {
  if (score >= 60) return '#90c4ff';
  if (score >= 55) return '#7ab8f5';
  if (score >  45) return '#7a909e';
  if (score >  40) return '#f0a0a0';
  return '#ff8888';
}

/** Bar colour (2px bottom strip) */
export function scoreToBarColor(score) {
  if (score >= 55) return '#2d88ff';
  if (score <= 45) return '#d94040';
  return '#3e5060';
}

/** Direction classification */
export function scoreToDirection(score) {
  if (score >= 56) return 'tailwind';
  if (score <= 44) return 'headwind';
  return 'neutral';
}

/** Intensity classification */
export function scoreToIntensity(score) {
  const d = Math.abs(score - 50);
  if (d >= 22) return 'strong';
  if (d >= 10) return 'moderate';
  return 'mild';
}

/**
 * Sparkline SVG — oldest-to-newest array of scores.
 * Draws polyline with endpoint dot. Neutral dashed line at y=50.
 */
export function sparklineSVG(points, w = 220, h = 40) {
  if (!points || points.length === 0) return `<svg width="${w}" height="${h}"></svg>`;

  const pad = 4;
  const minY = 0, maxY = 100;
  const scaleX = (points.length > 1) ? (w - pad * 2) / (points.length - 1) : 0;
  const scaleY = (h - pad * 2) / (maxY - minY);

  const toX = i => pad + i * scaleX;
  const toY = v => h - pad - (v - minY) * scaleY;

  const pts = points.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const lineColor = last >= 55 ? '#2d88ff' : last <= 45 ? '#d94040' : '#3e5060';
  const neutralY = toY(50).toFixed(1);
  const dotX = toX(points.length - 1).toFixed(1);
  const dotY = toY(last).toFixed(1);

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">` +
    `<line x1="${pad}" y1="${neutralY}" x2="${w - pad}" y2="${neutralY}" stroke="#3e5060" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>` +
    `<polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${dotX}" cy="${dotY}" r="3" fill="${lineColor}"/>` +
    `</svg>`;
}

/**
 * Gauge SVG — semicircle from left (headwind) to right (tailwind).
 * score 0 = full left (red), score 50 = top (gray), score 100 = full right (blue)
 */
export function gaugeSVG(score, size = 72) {
  const cx = size / 2;
  const cy = size / 2 + 4;
  const r  = size / 2 - 6;
  const strokeW = 5;

  // Arc helpers
  function polarToXY(angleDeg) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function describeArc(startDeg, endDeg) {
    const [sx, sy] = polarToXY(startDeg);
    const [ex, ey] = polarToXY(endDeg);
    const large = (endDeg - startDeg > 180) ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  }

  // Semicircle: -90deg (left) to +90deg (right), represented as 180deg to 360deg
  const trackPath  = describeArc(180, 360);
  const fillDeg    = 180 + (score / 100) * 180;
  const fillPath   = describeArc(180, Math.min(fillDeg, 360));
  const fillColor  = score >= 55 ? '#2d88ff' : score <= 45 ? '#d94040' : '#3e5060';

  const [nx, ny]   = polarToXY(fillDeg);

  return `<svg width="${size}" height="${size / 2 + 8}" viewBox="0 0 ${size} ${size / 2 + 8}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${trackPath}" fill="none" stroke="#1a2230" stroke-width="${strokeW}" stroke-linecap="round"/>` +
    `<path d="${fillPath}"  fill="none" stroke="${fillColor}" stroke-width="${strokeW}" stroke-linecap="round"/>` +
    `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="4" fill="${fillColor}"/>` +
    `</svg>`;
}
