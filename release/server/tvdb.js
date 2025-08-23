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

// Pick a preferred episode title (translations -> fallback to name/episodeName)
function pickPreferredEpisodeName(e, langOverride) {
    if (!e) return undefined;
    const settingsLocal = loadSettings();
    const rawRequested = (langOverride || (settingsLocal && settingsLocal.tvdbLanguage) || 'en').toString() || 'en';
    function normalizeLang(s) {
        if (!s) return '';
        const t = String(s).toLowerCase().trim();
        if (!t) return '';
        if (t === 'romaji' || t === 'ja-romaji' || t === 'ja-latn') return 'romaji';
        if (t.startsWith('en') || t.includes('english')) return 'en';
        if (t === 'eng') return 'eng';
        if (t.startsWith('ja') || t === 'jpn' || t.includes('japanese')) return 'ja';
        if (t.startsWith('zh') || t.includes('chinese') || t === 'chi') return 'zh';
        return t;
    }
    const requested = normalizeLang(rawRequested);
    const preferLangs = [requested, 'en', 'eng', 'romaji', 'ja', 'ja-latn', 'zh', 'zh-cn', 'zh-tw'];
    const tr = e.translations || e.translatedNames || e.translationsMap;
    let preferred;
    if (tr) {
        function trMatchesToken(tEntry, token) {
            if (!tEntry || !token) return false;
            const langField = (tEntry.language || tEntry.lang || '').toString().toLowerCase();
            const iso = (tEntry.iso_639_3 || '').toString().toLowerCase();
            if (token === 'romaji') {
                if (langField.includes('romaji') || langField.includes('latn') || iso === 'rom') return true;
            }
            if (iso && iso === token) return true;
            if (langField && (langField === token || langField.startsWith(token) || langField.includes(token))) return true;
            return false;
        }
        if (Array.isArray(tr)) {
            for (const p of preferLangs) {
                if (!p) continue;
                const found = tr.find((t) => trMatchesToken(t, p));
                if (found && (found.name || found.title || found.translation)) { preferred = found.name || found.title || found.translation; break; }
            }
            if (!preferred) {
                const en = tr.find((t) => trMatchesToken(t, 'en'));
                if (en) preferred = en.name || en.title || en.translation;
            }
        } else if (typeof tr === 'object') {
            for (const p of preferLangs) {
                if (!p) continue;
                const keyMatch = Object.keys(tr || {}).find(k => k.toString().toLowerCase() === p || k.toString().toLowerCase().startsWith(p));
                if (keyMatch) { const val = tr[keyMatch]; preferred = (typeof val === 'string') ? val : (val && (val.name || val.title || val.translation)); if (preferred) break; }
            }
            if (!preferred) {
                const keyEn = Object.keys(tr || {}).find(k => k.toLowerCase().startsWith('en'));
                if (keyEn) preferred = (typeof tr[keyEn] === 'string') ? tr[keyEn] : (tr[keyEn].name || tr[keyEn].title || tr[keyEn].translation);
            }
        }
    }
    if (!preferred) preferred = e.name || e.episodeName || e.title || undefined;
    return preferred;
}

export async function getEpisodePreferredTitle(seriesId, season, episode, lang) {
    const m = await getEpisodeByAiredOrder(seriesId, season, episode);
    if (!m) return null;
    try { log('info', `getEpisodePreferredTitle: series=${seriesId} season=${season} ep=${episode} requestedLang=${lang || ''} rawEpisodeHasTranslations=${!!(m && (m.translations||m.translatedNames||m.translationsMap))}`); } catch {}
    let episodeObj = m;
    if (!(m && (m.translations || m.translatedNames || m.translationsMap))) {
        try {
            const full = await tvdb(`/episodes/${m.id || m.episodeId || m.episode_id}`);
            episodeObj = (full && full.data) ? full.data : full;
            try { log('debug', `getEpisodePreferredTitle: fetched full episode object for id=${m.id||m.episodeId||m.episode_id}`); } catch {}
        } catch (e) { try { log('debug', `getEpisodePreferredTitle: could not fetch full episode object: ${String(e)}`); } catch {} }
    }
    try {
        const hasNameCodes = !!(episodeObj && (episodeObj.nameTranslations || episodeObj.name_translations));
        const hasTranslationEntries = !!(episodeObj && (episodeObj.translations || episodeObj.translatedNames || episodeObj.translationsMap));
        if (hasNameCodes && !hasTranslationEntries && (episodeObj.id || episodeObj.episodeId || episodeObj.episode_id)) {
            try {
                const tid = episodeObj.id || episodeObj.episodeId || episodeObj.episode_id;
                const transRes = await tvdb(`/episodes/${tid}/translations`);
                const transData = transRes && transRes.data ? transRes.data : transRes;
                if (transData) {
                    let arr = [];
                    if (Array.isArray(transData)) arr = transData;
                    else if (transData.translations && Array.isArray(transData.translations)) arr = transData.translations;
                    else if (transData.data && Array.isArray(transData.data)) arr = transData.data;
                    const normalized = arr.map((t) => {
                        const language = (t.language || t.lang || t.iso_639_3 || t.iso || '').toString();
                        const name = (t.name || t.title || t.translation || t.value || (t.data && t.data.name) || null);
                        return { language, name, raw: t };
                    }).filter(Boolean);
                    if (normalized.length) { try { episodeObj.translations = normalized; } catch {} try { log('debug', `getEpisodePreferredTitle: fetched ${normalized.length} translation entries for episode id=${tid}`); } catch {} }
                }
            } catch (e) { try { log('debug', `getEpisodePreferredTitle: translations fetch failed for episode id=${episodeObj.id||episodeObj.episodeId||episodeObj.episode_id}: ${String(e)}`); } catch {} }
        }
    } catch (e) { /* best-effort */ }
    const picked = pickPreferredEpisodeName(episodeObj, lang);
    let source = 'name';
    try { if ((episodeObj.translations || episodeObj.translatedNames || episodeObj.translationsMap) && picked && String(picked) !== String(episodeObj.name)) source = 'translation'; else source = 'name'; } catch {}
    try { log('info', `getEpisodePreferredTitle: chosen='${picked}' source=${source} series=${seriesId} s=${season} e=${episode}`); } catch {}
    return { title: (picked || (episodeObj.name || episodeObj.episodeName || null)), source };
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
