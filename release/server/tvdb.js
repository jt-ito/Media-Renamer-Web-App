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
async function tvdb(path, preferredLang) {
    const t = await ensureToken();
    try {
        log('debug', `tvdb: GET ${path} lang=${preferredLang||''}`);
    }
    catch { }
    const headers = { Authorization: `Bearer ${t}` };
    if (preferredLang) headers['Accept-Language'] = preferredLang;
    const res = await fetch(`https://api4.thetvdb.com/v4${path}`, { headers });
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
    const settingsLocal = loadSettings();
    const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
    const q = new URLSearchParams({ q: query, type });
    if (year)
        q.set('year', String(year));
    q.set('language', settingsLang);
    const js = await tvdb(`/search?${q}`, settingsLang);
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
    const settingsLocal = loadSettings();
    const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
    const iso3map = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' };
    const listLang = iso3map[settingsLang] || settingsLang;
    const ep = await tvdb(`/series/${seriesId}/episodes/default?page=0&season=${season}&language=${encodeURIComponent(listLang)}`, settingsLang);
    const match = (ep.data?.episodes || []).find((e) => e.number === episode || e.airedEpisodeNumber === episode);
        try {
            if (match) {
                const prefer = [settingsLang, 'eng', 'romaji'];
                for (const p of prefer) {
                    const iso = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' }[p] || p;
                    const tr = await tvdb(`/episodes/${match.id}/translations/${encodeURIComponent(iso)}`, p).catch(()=>null);
                    if (tr && tr.data) {
                        const maybe = Array.isArray(tr.data.translations) ? tr.data.translations[0] : (tr.data.name || tr.data.title || tr.data.translation ? tr.data : null);
                        const name = maybe && (maybe.name || maybe.title || maybe.translation);
                        if (name) { match.name = name; try { match._pickedNameSource = 'translation'; } catch {} ; break; }
                    }
                    const epRes = await tvdb(`/episodes/${match.id}?language=${encodeURIComponent(iso)}`, p).catch(()=>null);
                    const got = epRes && (epRes.data || epRes);
                    const epName = got && (got.name || got.title || got.translation);
                    if (epName) { match.name = epName; try { match._pickedNameSource = 'translation'; } catch {} ; break; }
                }
                if (!match.name) await ensureEpisodePreferredName(match, settingsLang).catch(()=>{});
            }
        } catch (e) {}
    return match;
}
export async function mapAbsoluteToAired(seriesId, abs) {
    const settingsLocal = loadSettings();
    const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
    const iso3map = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' };
    const listLang = iso3map[settingsLang] || settingsLang;
    const js = await tvdb(`/series/${seriesId}/episodes/default?page=0&language=${encodeURIComponent(listLang)}`, settingsLang);
    const eps = js.data?.episodes || [];
    return abs.map(a => {
        const m = eps.find((e) => e.absoluteNumber === a) || eps.find((e) => e.airedEpisodeNumber === a);
        return m ? { season: m.airedSeason ?? m.seasonNumber, ep: m.airedEpisodeNumber ?? m.number, title: m.name || m.episodeName } : null;
    });
}
async function ensureEpisodePreferredName(e, settingsLang) {
    if (!e) return;
    const prefer = [settingsLang, 'en', 'romaji'];
    if (Array.isArray(e.translations) && e.translations.length) {
        for (const p of prefer) {
            const found = e.translations.find((t) => (t.language && t.language.toString().toLowerCase().startsWith(p)) || (t.iso_639_3 && t.iso_639_3.toString().toLowerCase() === p));
            if (found && (found.name || found.title || found.translation)) { e.name = found.name || found.title || found.translation; try { e._pickedNameSource = 'translation'; } catch {} ; return; }
        }
    }
        const nt = e.nameTranslations || e.nameTranslation || null;
        if (nt && Array.isArray(nt)) {
                        for (const p of prefer) {
                            const iso = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' }[p] || p;
                            const trJs = await tvdb(`/episodes/${e.id}/translations/${encodeURIComponent(iso)}`, p).catch(()=>null);
                            try { log('debug', `ensureEpisodePreferredName: translations/${iso} response for ${e.id}: ${JSON.stringify(trJs?.data || trJs).slice(0,1000)}`); } catch {}
                            if (trJs && trJs.data) {
                            const list = Array.isArray(trJs.data.translations) ? trJs.data.translations : (Array.isArray(trJs.data) ? trJs.data : (trJs.data ? [trJs.data] : []));
                            const found = list.find((t) => (t.language && String(t.language||'').toLowerCase().startsWith(p)) || (t.iso_639_3 && String(t.iso_639_3||'').toLowerCase() === p));
                                if (found && (found.name || found.title || found.translation)) { e.name = found.name || found.title || found.translation; try { e._pickedNameSource = 'translation'; } catch {} ; return; }
                            }
                        }
                        for (const p of prefer) {
                            const iso = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' }[p] || p;
                            const epJs = await tvdb(`/episodes/${e.id}?language=${encodeURIComponent(iso)}`, p).catch(()=>null);
                            try { log('debug', `ensureEpisodePreferredName: episode ${e.id} lang=${p} fallback response: ${JSON.stringify(epJs?.data || epJs).slice(0,1000)}`); } catch {}
                            if (epJs && (epJs.data || epJs)) {
                                const got = (epJs.data && epJs.data.name) ? epJs.data : epJs;
                                const name = got.name || got.title || got.translation;
                                if (name) { e.name = name; try { e._pickedNameSource = 'translation'; } catch {} ; return; }
                            }
                        }
        }
}
export async function getSeries(seriesId) {
    const settingsLocal = loadSettings();
    const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
    const js = await tvdb(`/series/${seriesId}?language=${encodeURIComponent(settingsLang)}`, settingsLang);
    try {
        log('debug', `getSeries: seriesId=${seriesId} keys=${Object.keys(js || {}).join(',')}`);
    }
    catch { }
    const d = js.data || js;
    try {
        if (d) {
            try {
                if (!d.translations || (Array.isArray(d.translations) && d.translations.length === 0)) {
                      const trJs = await tvdb(`/series/${seriesId}/translations`, settingsLang).catch(() => null);
                    if (trJs && trJs.data) {
                        d.translations = trJs.data.translations || trJs.data || d.translations;
                    }
                }
            }
            catch (e) { }
            // ensure callers get the preferred name
            try {
                const pickPreferredName = (function (d) {
                    const cjkRe = /[\u3040-\u30ff\u4e00-\u9fff]/;
                    const tr = d.translations;
                    const preferLangs = [settingsLang, 'en', 'eng', 'en-us', 'en-gb', 'romaji', 'ja-latn', 'zh', 'zh-cn', 'zh-tw', 'chi'];
                    let preferred;
                    let pickedSource;
                    if (tr) {
                        if (Array.isArray(tr)) {
                            for (const p of preferLangs) {
                                const found = tr.find((t) => (t.language && t.language.toString().toLowerCase().startsWith(p)) || (t.iso_639_3 && t.iso_639_3.toString().toLowerCase() === p));
                                if (found && (found.name || found.title || found.translation)) { preferred = found.name || found.title || found.translation; pickedSource = 'translation'; break; }
                            }
                            if (!preferred) {
                                const en = tr.find((t) => t.language && t.language.toString().toLowerCase().startsWith('en'));
                                if (en) { preferred = en.name || en.title || en.translation; pickedSource = 'translation'; }
                            }
                        }
                    }
                    if (!preferred && d.aliases) {
                        const aliases = d.aliases;
                        if (Array.isArray(aliases) && aliases.length) {
                            const nonCjk = aliases.find(s => !cjkRe.test((s || '').toString()));
                            if (nonCjk) { preferred = nonCjk; pickedSource = 'alias'; }
                        }
                    }
                    let name = d.name || d.title || preferred || d.slug || '';
                    if (cjkRe.test((name || '') + '') && preferred) {
                        name = preferred;
                    }
                    try { if (pickedSource) d._pickedNameSource = pickedSource; else d._pickedNameSource = 'name'; } catch { }
                    return (name || '').toString();
                })(d);
                d.name = pickPreferredName;
            }
            catch (e) { }
        }
    }
    catch (e) { }
    return d;
}
