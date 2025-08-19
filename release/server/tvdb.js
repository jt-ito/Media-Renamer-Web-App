import fetch from 'node-fetch';
import { log } from './logging.js';
import { loadSettings } from './settings.js';
let token = null;
let tokenExp = 0;
// Track the last effective API key so we can reset the token if the key changed
let lastKey = null;
export function invalidateTVDBToken() {
    token = null;
    tokenExp = 0;
    lastKey = null;
}
async function ensureToken() {
    const now = Date.now();
    if (token && now < tokenExp - 60000)
        return token;
    // Allow the API key to come from either the environment OR persisted settings
    const settingsKey = loadSettings().tvdbKey;
    const key = process.env.TVDB_API_KEY || settingsKey;
    if (!key)
        throw new Error('TVDB API key not set');
    // If the effective key changed since we last fetched a token, reset the token cache
    if (lastKey !== key) {
        token = null;
        tokenExp = 0;
        lastKey = key;
    }
    const res = await fetch('https://api4.thetvdb.com/v4/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apikey: key })
    });
    if (!res.ok)
        throw new Error(`TVDB login failed: ${res.status}`);
    const data = await res.json();
    token = data.data?.token;
    tokenExp = now + 23 * 60 * 60 * 1000;
    try {
        log('info', 'TVDB token refreshed');
    }
    catch { }
    return token;
}
async function tvdb(path) {
    const t = await ensureToken();
    try {
        log('debug', `tvdb: GET ${path}`);
    }
    catch { }
    const res = await fetch(`https://api4.thetvdb.com/v4${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
        try {
            log('error', `TVDB ${path} failed: ${res.status}`);
        }
        catch { }
        throw new Error(`TVDB ${path} failed: ${res.status}`);
    }
    const jsAny = await res.json();
    try {
        log('debug', `tvdb: response for ${path}: ${JSON.stringify(jsAny?.data ? (Array.isArray(jsAny.data) ? (jsAny.data.length ? jsAny.data[0] : jsAny.data) : jsAny.data) : jsAny).slice(0, 1000)}`);
    }
    catch { }
    const js = jsAny;
    return js;
}
export async function searchTVDB(type, query, year) {
    const q = new URLSearchParams({ q: query, type });
    if (year)
        q.set('year', String(year));
    const js = await tvdb(`/search?${q}`);
    try {
        log('debug', `searchTVDB: query=${query} year=${year} results=${(js.data || []).length}`);
    }
    catch { }
    return (js.data || []).map((d) => {
        // Determine the TVDB id and a readable name
        const id = Number(d.tvdb_id ?? d.id ?? d.seriesId ?? d.movieId ?? 0) || 0;
        const name = d.name || d.title || d.translations?.name || d.slug || '';
        // Year extraction: prefer explicit `year` or try from known date fields
        let y;
        if (d.year)
            y = Number(d.year) || undefined;
        else {
            const dateStr = d.firstAired || d.firstAirTime || d.releaseDate || d.released || '';
            const maybe = (dateStr || '').toString().slice(0, 4);
            if (/^\d{4}$/.test(maybe))
                y = Number(maybe);
        }
        try {
            log('debug', `searchTVDB: candidate id=${d.tvdb_id || d.id} name=${d.name || d.title} year=${y}`);
        }
        catch { }
        // Infer the returned object type when available. TVDB may include a `type` or `objectType` field.
        let returnedType = type; // default to requested type
        const t = (d.type || d.objectType || d.seriesType || '').toString().toLowerCase();
        if (t.includes('movie'))
            returnedType = 'movie';
        else if (t.includes('series') || t.includes('show') || t.includes('tv'))
            returnedType = 'series';
        return {
            id,
            name,
            year: y,
            type: returnedType,
            extra: { imdb: d.imdb_id, tmdb: d.tmdb_id }
        };
    });
}
export async function getEpisodeByAiredOrder(seriesId, season, episode) {
    const ep = await tvdb(`/series/${seriesId}/episodes/default?page=0&season=${season}`);
    const match = (ep.data?.episodes || []).find((e) => e.number === episode || e.airedEpisodeNumber === episode);
    return match;
}
export async function mapAbsoluteToAired(seriesId, abs) {
    const js = await tvdb(`/series/${seriesId}/episodes/default?page=0`);
    const eps = js.data?.episodes || [];
    return abs.map(a => {
        const m = eps.find((e) => e.absoluteNumber === a) || eps.find((e) => e.airedEpisodeNumber === a);
        return m ? { season: m.airedSeason ?? m.seasonNumber, ep: m.airedEpisodeNumber ?? m.number, title: m.name || m.episodeName } : null;
    });
}
export async function getSeries(seriesId) {
    const js = await tvdb(`/series/${seriesId}`);
    try {
        log('debug', `getSeries: seriesId=${seriesId} keys=${Object.keys(js || {}).join(',')}`);
    }
    catch { }
    return js.data || js;
}
