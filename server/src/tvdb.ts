import fetch from 'node-fetch';
import { MediaType, MatchCandidate } from './types.js';
import { log } from './logging.js';
import { loadSettings } from './settings.js';

let token: string | null = null;
let tokenExp = 0;
// Track the last effective API key so we can reset the token if the key changed
let lastKey: string | null = null;

export function invalidateTVDBToken() {
  token = null;
  tokenExp = 0;
  lastKey = null;
}

// ISO-639-3 mappings for common languages we request from TVDB
const ISO3MAP: Record<string,string> = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' };

async function ensureToken() {
  const now = Date.now();
  if (token && now < tokenExp - 60_000) return token;
  // Allow the API key to come from either the environment OR persisted settings
  const settingsKey = loadSettings().tvdbKey;
  const key = process.env.TVDB_API_KEY || settingsKey;
  if (!key) throw new Error('TVDB API key not set');

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
  if (!res.ok) throw new Error(`TVDB login failed: ${res.status}`);
  const data: any = await res.json();
  token = data.data?.token;
  tokenExp = now + 23 * 60 * 60 * 1000;
  try { log('info', 'TVDB token refreshed'); } catch {}
  return token!;
}

async function tvdb(path: string, preferredLang?: string) {
  const t = await ensureToken();
  try { log('debug', `tvdb: GET ${path} lang=${preferredLang||''}`); } catch {}
  const headers: any = { Authorization: `Bearer ${t}` };
  if (preferredLang) headers['Accept-Language'] = preferredLang;
  const res = await fetch(`https://api4.thetvdb.com/v4${path}`, { headers });
  if (!res.ok) {
    try { log('error', `TVDB ${path} failed: ${res.status}`); } catch {}
    throw new Error(`TVDB ${path} failed: ${res.status}`);
  }
  const jsAny: any = await res.json();
  try { log('debug', `tvdb: response for ${path}: ${JSON.stringify(jsAny?.data ? (Array.isArray(jsAny.data) ? (jsAny.data.length ? jsAny.data[0] : jsAny.data) : jsAny.data) : jsAny).slice(0,1000)}`); } catch {}
  const js = jsAny;
  return js;
}

export async function searchTVDB(type: MediaType, query: string, year?: number): Promise<MatchCandidate[]> {
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
  const q = new URLSearchParams({ q: query, type });
  if (year) q.set('year', String(year));
  // Ask TVDB for results in the user's preferred language when possible.
  q.set('language', settingsLang);
  const js: any = await tvdb(`/search?${q}`, settingsLang);
  try { log('debug', `searchTVDB: query=${query} year=${year} results=${(js.data||[]).length}`); } catch {}
  return (js.data || []).map((d: any) => {
    // Determine the TVDB id and a readable name
    const id = Number(d.tvdb_id ?? d.id ?? d.seriesId ?? d.movieId ?? 0) || 0;
    // Prefer English / romaji translations when available. Use the top-level
    // helper `pickPreferredName` to pick and annotate the object.
    const name = pickPreferredName(d);

    // Year extraction: prefer explicit `year` or try from known date fields
    let y: number | undefined;
    if (d.year) y = Number(d.year) || undefined;
    else {
      const dateStr = d.firstAired || d.firstAirTime || d.releaseDate || d.released || '';
      const maybe = (dateStr || '').toString().slice(0,4);
      if (/^\d{4}$/.test(maybe)) y = Number(maybe);
    }
  try { log('debug', `searchTVDB: candidate id=${d.tvdb_id||d.id} name=${name} year=${y}`); } catch {}

    // Infer the returned object type when available. TVDB may include a `type` or `objectType` field.
    let returnedType: MediaType = type; // default to requested type
    const t = (d.type || d.objectType || d.seriesType || '').toString().toLowerCase();
    if (t.includes('movie')) returnedType = 'movie';
    else if (t.includes('series') || t.includes('show') || t.includes('tv')) returnedType = 'series';

    const audit: any = {
  pickedNameSource: (d._pickedNameSource || 'name'),
      translations: Array.isArray(d.translations) ? d.translations.map((t:any)=> ({ language: t.language, name: t.name || t.title || t.translation })) : undefined,
      aliases: d.aliases,
    };
    return {
      id,
      name,
      year: y,
      type: returnedType,
      extra: { imdb: d.imdb_id, tmdb: d.tmdb_id, nameSource: (d._pickedNameSource || 'name'), audit }
    } as MatchCandidate;
  });
}

export async function getEpisodeByAiredOrder(seriesId: number, season: number, episode: number) {
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
  const listLang = ISO3MAP[settingsLang] || settingsLang;
  const ep: any = await tvdb(`/series/${seriesId}/episodes/default?page=0&season=${season}&language=${encodeURIComponent(listLang)}`, settingsLang);
  const match = (ep.data?.episodes || []).find((e: any) => e.number === episode || e.airedEpisodeNumber === episode);
  // Deterministic fetch: try the preferred language first (ISO-639-3), then English, then romaji.
  // Prefer translations endpoint with language as path segment, then the episode resource with language
  // query. If a translation is returned, use it and return the episode object.
  try {
    if (match) {
      try { log('debug', `getEpisodeByAiredOrder: found match id=${match.id} number=${match.number} name=${String(match.name||'').slice(0,80)}`); } catch {}
      const prefer = [settingsLang, 'eng', 'romaji'];
      for (const p of prefer) {
        const iso = ISO3MAP[p] || p;
        try { log('debug', `getEpisodeByAiredOrder: trying translation for id=${match.id} langHint=${p} iso=${iso}`); } catch {}
        // Try translations/{iso}
        const tr = await tvdb(`/episodes/${match.id}/translations/${encodeURIComponent(iso)}`, p).catch(()=>null);
        try { log('debug', `getEpisodeByAiredOrder: translations/${iso} response for ${match.id}: ${JSON.stringify(tr?.data || tr).slice(0,500)}`); } catch {}
        if (tr && tr.data) {
          // tr.data may be an object with name/overview or a wrapper
          const maybe = Array.isArray(tr.data.translations) ? tr.data.translations[0] : (tr.data.name || tr.data.title || tr.data.translation ? tr.data : null);
          const name = maybe && (maybe.name || maybe.title || maybe.translation);
          if (name) { match.name = name; try { match._pickedNameSource = 'translation'; } catch {} ; break; }
        }
        // Fallback: request the episode resource with a language hint
        try { log('debug', `getEpisodeByAiredOrder: trying episode resource lang=${p} iso=${iso} for id=${match.id}`); } catch {}
        const epRes = await tvdb(`/episodes/${match.id}?language=${encodeURIComponent(iso)}`, p).catch(()=>null);
        try { log('debug', `getEpisodeByAiredOrder: episode ${match.id} lang=${p} fallback response: ${JSON.stringify(epRes?.data || epRes).slice(0,500)}`); } catch {}
        const got = epRes && (epRes.data || epRes);
        const epName = got && (got.name || got.title || got.translation);
        if (epName) { match.name = epName; try { match._pickedNameSource = 'translation'; } catch {} ; break; }
      }
      // Last resort: try the local helper which checks in-object translations/aliases
      if (!match.name) {
        try { log('debug', `getEpisodeByAiredOrder: no translation found, falling back to ensureEpisodePreferredName for ${match.id}`); } catch {}
        await ensureEpisodePreferredName(match, settingsLang).catch(()=>{});
      }
    }
  } catch (e) { try { log('error', `getEpisodeByAiredOrder: unexpected error: ${String(e)}`); } catch {} }
  return match;
}

export async function mapAbsoluteToAired(seriesId: number, abs: number[]) {
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
  const listLang = ISO3MAP[settingsLang] || settingsLang;
  const js: any = await tvdb(`/series/${seriesId}/episodes/default?page=0&language=${encodeURIComponent(listLang)}`, settingsLang);
  const eps = js.data?.episodes || [];
  return abs.map(a => {
    const m = eps.find((e: any) => e.absoluteNumber === a) || eps.find((e:any)=> e.airedEpisodeNumber === a);
    if (!m) return null;
    try { /* best-effort: prefer translated name for each matched episode */
      // ensure name is preferred language when possible
      ensureEpisodePreferredName(m, settingsLang).catch(()=>{});
    } catch (e) {}
    return m ? { season: m.airedSeason ?? m.seasonNumber, ep: m.airedEpisodeNumber ?? m.number, title: m.name || m.episodeName } : null;
  });
}

// Helper: ensure an episode object has a preferred human-friendly name
async function ensureEpisodePreferredName(e: any, settingsLang: string) {
  if (!e) return;
  const prefer = [settingsLang, 'en', 'romaji'];
  // If translations array exists, try to pick one locally first
  if (Array.isArray(e.translations) && e.translations.length) {
    for (const p of prefer) {
      const found = e.translations.find((t: any) => (t.language && String(t.language||'').toLowerCase().startsWith(p)) || (t.iso_639_3 && String(t.iso_639_3||'').toLowerCase() === p));
      if (found && (found.name || found.title || found.translation)) { e.name = found.name || found.title || found.translation; try { e._pickedNameSource = 'translation'; } catch {} ; return; }
    }
  }
  // If server response lists available nameTranslations, ask TVDB translations endpoint
  const nt = e.nameTranslations || e.nameTranslation || null;
  if (nt && Array.isArray(nt)) {
    // Try the translations endpoint first (may fail for some records), then
    // as a fallback request the episode resource with a language hint that
    // TVDB seems to accept (they often use ISO-639-3 codes like 'eng'/'jpn').
    // Try language-specific translations endpoints (e.g. /translations/eng)
    for (const p of prefer) {
  const iso = ISO3MAP[p] || p;
      const trJs: any = await tvdb(`/episodes/${e.id}/translations/${encodeURIComponent(iso)}`, p).catch(()=>null);
      try { log('debug', `ensureEpisodePreferredName: translations/${iso} response for ${e.id}: ${JSON.stringify(trJs?.data || trJs).slice(0,1000)}`); } catch {}
      if (trJs && trJs.data) {
        const list = Array.isArray(trJs.data.translations) ? trJs.data.translations : (Array.isArray(trJs.data) ? trJs.data : (trJs.data ? [trJs.data] : []));
        const found = list.find((t: any) => (t.language && String(t.language||'').toLowerCase().startsWith(p)) || (t.iso_639_3 && String(t.iso_639_3||'').toLowerCase() === p));
        if (found && (found.name || found.title || found.translation)) { e.name = found.name || found.title || found.translation; try { e._pickedNameSource = 'translation'; } catch {} ; return; }
      }
    }
    // Fallback: try fetching the episode with a language query param using
    // common ISO mappings (en->eng, ja->jpn, fr->fra).
    const iso3map: any = { en: 'eng', ja: 'jpn', fr: 'fra', zh: 'zho' };
      for (const p of prefer) {
        const iso = iso3map[p] || p;
        const epJs: any = await tvdb(`/episodes/${e.id}?language=${encodeURIComponent(iso)}`, p).catch(()=>null);
        try { log('debug', `ensureEpisodePreferredName: episode ${e.id} lang=${p} fallback response: ${JSON.stringify(epJs?.data || epJs).slice(0,1000)}`); } catch {}
        if (epJs && (epJs.data || epJs)) {
          const got = (epJs.data && epJs.data.name) ? epJs.data : epJs;
          const name = got.name || got.title || got.translation;
          if (name) { e.name = name; try { e._pickedNameSource = 'translation'; } catch {} ; return; }
        }
      }
  }
}

export async function getSeries(seriesId: number) {
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
  // Request the series resource with the preferred language header/param so
  // TVDB will return localized translations where available.
  const js: any = await tvdb(`/series/${seriesId}?language=${encodeURIComponent(settingsLang)}`, settingsLang);
  try { log('debug', `getSeries: seriesId=${seriesId} keys=${Object.keys(js || {}).join(',')}`); } catch {}
  const d = js.data || js;
  try {
    // If we got a raw TVDB object, pick a preferred name and annotate so callers
    // receive the same preferred/annotated shape as searchTVDB produces.
    if (d) {
      // If TVDB didn't include translations, try to fetch the translations
      // endpoint explicitly (some TVDB responses omit the translations key).
          try {
            if (!d.translations || (Array.isArray(d.translations) && d.translations.length === 0)) {
              const trJs: any = await tvdb(`/series/${seriesId}/translations`, settingsLang).catch(()=>null);
              if (trJs && trJs.data) {
                // merge translations into the object shape our picker expects
                d.translations = trJs.data.translations || trJs.data || d.translations;
              }
            }
          } catch(e) {}

      const picked = pickPreferredName(d);
      // ensure callers that read `name` get the preferred (English/alias)
      // display name rather than the raw localized `name` returned by TVDB.
      try { (d as any).name = picked; } catch {}
      try { (d as any).preferredName = picked; } catch {}
      // `_pickedNameSource` is set by pickPreferredName already.
    }
  } catch (e) {}
  return d;
}

// Helper: pick a preferred human-friendly name from raw TVDB series/movie object
function pickPreferredName(d: any) {
  const cjkRe = /[\u3040-\u30ff\u4e00-\u9fff]/;
  // Helper: choose the best alias from an array of aliases (objects or strings)
  function pickBestAlias(aliases: any[]): string | undefined {
    if (!aliases || !aliases.length) return undefined;
    const cand = aliases.map(a => {
      if (!a) return null;
      if (typeof a === 'string') return { name: a, lang: undefined };
      const name = a.name || a.title || a.translation || a.value || a.alias;
      const lang = a.language || a.iso_639_3 || a.lang;
      return { name, lang };
    }).filter(Boolean) as Array<{name: any, lang?: any}>;
    const filtered = cand.map(c => ({ s: String(c.name || ''), lang: c.lang })).filter(x => x.s && !cjkRe.test(x.s));
    if (!filtered.length) return undefined;
    function score(s: string) {
      let sc = 0;
      const len = s.length;
      // prefer ASCII-only aliases
      if (/^[\x00-\x7F]*$/.test(s)) sc += 40;
      // prefer aliases containing a colon (often the short English title)
      if (s.includes(':')) sc += 20;
      // prefer reasonable length (around 20-40 chars)
      sc -= Math.abs(len - 30);
      // prefer title-cased tokens (small boost)
      if (/[A-Z][a-z]/.test(s)) sc += 5;
      // penalize excessive punctuation/quote characters
      if (/[“”‘’]/.test(s)) sc -= 5;
      return sc;
    }
    filtered.sort((a, b) => score(b.s) - score(a.s));
    return filtered[0].s;
  }
  // Avoid depending on the exact shape of the exported `Settings` type from
  // `settings.ts` (some branches or CI snapshots may not include
  // `tvdbLanguage`). Cast to a local, explicit shape that makes the
  // optionality clear while keeping strict typing for the rest of this file.
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  const settingsLang = (settingsLocal.tvdbLanguage || 'en').toString().toLowerCase();
  const tr = d.translations;
  const preferLangs = [settingsLang, 'en', 'eng', 'en-us', 'en-gb', 'romaji', 'ja-latn', 'zh', 'zh-cn', 'zh-tw', 'chi'];
  let preferred: string | undefined;
  let pickedSource: string | undefined;
  if (tr) {
    if (Array.isArray(tr)) {
      for (const p of preferLangs) {
        const found = tr.find((t: any) => (t.language && t.language.toString().toLowerCase().startsWith(p)) || (t.iso_639_3 && t.iso_639_3.toString().toLowerCase() === p));
        if (found && (found.name || found.title || found.translation)) { preferred = found.name || found.title || found.translation; pickedSource = 'translation'; break; }
      }
      if (!preferred) {
        const en = tr.find((t: any) => t.language && t.language.toString().toLowerCase().startsWith('en'));
        if (en) { preferred = en.name || en.title || en.translation; pickedSource = 'translation'; }
      }
    } else if (typeof tr === 'object') {
      for (const p of preferLangs) {
        if (tr[p]) {
          preferred = (typeof tr[p] === 'string') ? tr[p] : (tr[p].name || tr[p].title || tr[p].translation);
          pickedSource = 'translation';
          break;
        }
      }
      if (!preferred) {
        const k = Object.keys(tr || {}).find(k => k.toLowerCase().startsWith('en'));
        if (k) { preferred = (typeof tr[k] === 'string') ? tr[k] : (tr[k].name || tr[k].title || tr[k].translation); pickedSource = 'translation'; }
      }
    }
  }
  if (!preferred && d.aliases) {
    const aliases = d.aliases;
    if (Array.isArray(aliases) && aliases.length) {
  // Use the best-scoring alias instead of simply taking the first one.
  const best = pickBestAlias(aliases as any[]);
  if (best) { preferred = best; pickedSource = 'alias'; }
    }
  }
  let name = d.name || d.title || preferred || d.slug || '';
  if (cjkRe.test((name || '') + '') && preferred) {
    name = preferred;
  }
  try { if (pickedSource) (d as any)._pickedNameSource = pickedSource; else (d as any)._pickedNameSource = 'name'; } catch {}
  return (name || '').toString();
}