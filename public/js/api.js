// api.js — All network calls for MapperLab.
// No other module fetches directly — everything goes through here.

/**
 * Internal GET helper. Throws an Error on non-OK HTTP status.
 * @param {string} path - e.g. '/api/heatmap'
 * @returns {Promise<any>} Parsed JSON
 */
async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

/**
 * Fetch the heatmap data.
 * @returns {Promise<{sectors: Array, updatedAt: string|null}>}
 */
export async function fetchHeatmap() {
  return get('/api/heatmap');
}

/**
 * Fetch server status.
 * @returns {Promise<{status: string, lastUpdate: string|null, updating: boolean, scoresCount: number, eventsCount: number}>}
 */
export async function fetchStatus() {
  return get('/api/status');
}

/**
 * Fetch recent events.
 * @param {number} n - Max events to return (default 50)
 * @returns {Promise<Array>}
 */
export async function fetchEvents(n = 50) {
  return get(`/api/events?limit=${n}`);
}

/**
 * Fetch score timeline for an industry/sector.
 * @param {string} id - Industry or sector ID
 * @returns {Promise<Array<{timestamp: string, score: number, delta: number, event: string}>>}
 */
export async function fetchTimeline(id) {
  return get(`/api/timeline/${encodeURIComponent(id)}`);
}

/**
 * Fetch source attributions for an industry/sector.
 * @param {string} id - Industry or sector ID
 * @returns {Promise<string[]>}
 */
export async function fetchSources(id) {
  return get(`/api/sources/${encodeURIComponent(id)}`);
}

/**
 * Trigger a manual data update.
 * @returns {Promise<{status: string, message: string}>}
 */
export async function triggerUpdate() {
  const res = await fetch('/api/update', { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for /api/update`);
  return res.json();
}

/**
 * Poll /api/status until updating === false or maxPolls reached.
 * @param {number} interval - Milliseconds between polls (default 3000)
 * @param {number} maxPolls - Maximum poll attempts (default 30)
 * @returns {Promise<Object>} Final status object
 */
export async function pollUntilDone(interval = 3000, maxPolls = 30) {
  return new Promise((resolve, reject) => {
    let polls = 0;
    const timer = setInterval(async () => {
      polls++;
      try {
        const status = await fetchStatus();
        if (!status.updating || polls >= maxPolls) {
          clearInterval(timer);
          resolve(status);
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, interval);
  });
}
