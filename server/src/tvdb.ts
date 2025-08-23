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

async function tvdb(path: string) {
  const t = await ensureToken();
  try { log('debug', `tvdb: GET ${path}`); } catch {}
  const res = await fetch(`https://api4.thetvdb.com/v4${path}`, { headers: { Authorization: `Bearer ${t}` } });
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
  const q = new URLSearchParams({ q: query, type });
  if (year) q.set('year', String(year));
  const js: any = await tvdb(`/search?${q}`);
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
  const ep: any = await tvdb(`/series/${seriesId}/episodes/default?page=0&season=${season}`);
  const match = (ep.data?.episodes || []).find((e: any) => e.number === episode || e.airedEpisodeNumber === episode);
  return match;
}

// Pick a preferred episode title (translations -> fallback to name/episodeName)
function pickPreferredEpisodeName(e: any, langOverride?: string) {
  if (!e) return undefined;
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  const rawRequested = (langOverride || settingsLocal.tvdbLanguage || 'en').toString() || 'en';

  // Normalize user-provided language strings into canonical tokens we can match
  function normalizeLang(s: string|undefined|null) {
    if (!s) return '';
    const t = String(s).toLowerCase().trim();
    if (!t) return '';
    // common mappings
    if (t === 'romaji' || t === 'ja-romaji' || t === 'ja-latn') return 'romaji';
    if (t.startsWith('en') || t.includes('english')) return 'en';
    if (t === 'eng') return 'eng';
    if (t.startsWith('ja') || t === 'jpn' || t.includes('japanese')) return 'ja';
    if (t.startsWith('zh') || t.includes('chinese') || t === 'chi') return 'zh';
    // try to return two/three letter ISO-like tokens
    return t;
  }

  const requested = normalizeLang(rawRequested);
  const preferLangs = [requested, 'en', 'eng', 'romaji', 'ja', 'ja-latn', 'zh', 'zh-cn', 'zh-tw'];
  const tr = e.translations || e.translatedNames || e.translationsMap;
  try {
    // Log a short summary for diagnostics
    const summary = {
      id: e.id || e.episodeId || undefined,
      name: e.name || e.episodeName || e.title,
      translations: Array.isArray(tr) ? tr.map((t:any)=> ({ language: t.language, k: t.iso_639_3 })) : (tr ? Object.keys(tr || {}) : undefined)
    };
    try { log('debug', `pickPreferredEpisodeName: summary=${JSON.stringify(summary).slice(0,800)}`); } catch {}
  } catch (e) {}
  let preferred: string | undefined;
  if (tr) {
    // Helper: test whether a translation entry matches a normalized token
    function trMatchesToken(tEntry: any, token: string) {
      if (!tEntry || !token) return false;
      const langField = (tEntry.language || tEntry.lang || '').toString().toLowerCase();
      const iso = (tEntry.iso_639_3 || '').toString().toLowerCase();
      const nameLike = (tEntry.name || tEntry.title || tEntry.translation || '').toString();
      if (!langField && !iso) return false;
      if (token === 'romaji') {
        // Some feeds mark romanized Japanese as 'ja-latn' or similar
        if (langField.includes('romaji') || langField.includes('latn') || iso === 'rom') return true;
      }
      if (iso && iso === token) return true;
      if (langField && (langField === token || langField.startsWith(token) || langField.includes(token))) return true;
      return false;
    }

    if (Array.isArray(tr)) {
      // prefer in order of preferLangs
      for (const p of preferLangs) {
        if (!p) continue;
        const found = tr.find((t: any) => trMatchesToken(t, p));
        if (found && (found.name || found.title || found.translation)) { preferred = found.name || found.title || found.translation; break; }
      }
      if (!preferred) {
        const en = tr.find((t: any) => trMatchesToken(t, 'en'));
        if (en) preferred = en.name || en.title || en.translation;
      }
    } else if (typeof tr === 'object') {
      // object keyed by language tokens
      for (const p of preferLangs) {
        if (!p) continue;
        // direct key match
        const keyMatch = Object.keys(tr || {}).find(k => k.toString().toLowerCase() === p || k.toString().toLowerCase().startsWith(p));
        if (keyMatch) {
          const val = tr[keyMatch];
          preferred = (typeof val === 'string') ? val : (val && (val.name || val.title || val.translation));
          if (preferred) break;
        }
      }
      if (!preferred) {
        const keyEn = Object.keys(tr || {}).find(k => k.toLowerCase().startsWith('en'));
        if (keyEn) preferred = (typeof tr[keyEn] === 'string') ? tr[keyEn] : (tr[keyEn].name || tr[keyEn].title || tr[keyEn].translation);
      }
    }
  }
  // fallback to name/episodeName
  if (!preferred) preferred = e.name || e.episodeName || e.title || undefined;
  try { log('debug', `pickPreferredEpisodeName: picked='${preferred}' for langOverride='${langOverride || ''}'`); } catch {}
  return preferred;
}

export async function getEpisodePreferredTitle(seriesId: number, season: number, episode: number, lang?: string) {
  const m = await getEpisodeByAiredOrder(seriesId, season, episode);
  if (!m) return null;
  try { log('info', `getEpisodePreferredTitle: series=${seriesId} season=${season} ep=${episode} requestedLang=${lang || ''} rawEpisodeHasTranslations=${!!(m && (m.translations||m.translatedNames||m.translationsMap))}`); } catch {}

  // If the lightweight episode object doesn't include translations, request full episode details
  let episodeObj = m;
  if (!(m && (m.translations || m.translatedNames || m.translationsMap))) {
    try {
      const full = await tvdb(`/episodes/${m.id || m.episodeId || m.episode_id}`);
      episodeObj = (full && full.data) ? full.data : full;
      try { log('debug', `getEpisodePreferredTitle: fetched full episode object for id=${m.id||m.episodeId||m.episode_id}`); } catch {}
    } catch (e) {
      try { log('debug', `getEpisodePreferredTitle: could not fetch full episode object: ${String(e)}`); } catch {}
    }
  }

  // Some TVDB responses provide only `nameTranslations` (array of language codes)
  // on the episode object but not the actual translated strings. If we see
  // language codes but no translation entries, attempt to fetch the
  // translations endpoint for this episode so we can choose the requested
  // language string (for example: 'eng'/'en' or 'romaji').
  try {
    const hasNameCodes = !!(episodeObj && (episodeObj.nameTranslations || episodeObj.name_translations));
    const hasTranslationEntries = !!(episodeObj && (episodeObj.translations || episodeObj.translatedNames || episodeObj.translationsMap));
    if (hasNameCodes && !hasTranslationEntries && (episodeObj.id || episodeObj.episodeId || episodeObj.episode_id)) {
      try {
        const tid = episodeObj.id || episodeObj.episodeId || episodeObj.episode_id;
        const transRes = await tvdb(`/episodes/${tid}/translations`);
        const transData = transRes && transRes.data ? transRes.data : transRes;
        if (transData) {
          // Normalize into an array of { language, name/title/translation }
          let arr: any[] = [];
          if (Array.isArray(transData)) arr = transData;
          else if (transData.translations && Array.isArray(transData.translations)) arr = transData.translations;
          else if (transData.data && Array.isArray(transData.data)) arr = transData.data;
          // Map common shapes to a normalized translations array
          const normalized = arr.map((t: any) => {
            const language = (t.language || t.lang || t.iso_639_3 || t.iso || '').toString();
            const name = (t.name || t.title || t.translation || t.value || (t.data && t.data.name) || null);
            return { language, name, raw: t };
          }).filter(Boolean);
          if (normalized.length) {
            try { episodeObj.translations = normalized; } catch {}
            try { log('debug', `getEpisodePreferredTitle: fetched ${normalized.length} translation entries for episode id=${tid}`); } catch {}
          }
        }
      } catch (e) {
        try { log('debug', `getEpisodePreferredTitle: translations fetch failed for episode id=${episodeObj.id||episodeObj.episodeId||episodeObj.episode_id}: ${String(e)}`); } catch {}
      }
    }
  } catch (e) { /* best-effort */ }

  const picked = pickPreferredEpisodeName(episodeObj, lang);
  // determine source for diagnostics
  let source = 'name';
  try {
    if ((episodeObj.translations || episodeObj.translatedNames || episodeObj.translationsMap) && picked && String(picked) !== String(episodeObj.name)) source = 'translation';
    else source = 'name';
  } catch {}
  try { log('info', `getEpisodePreferredTitle: chosen='${picked}' source=${source} series=${seriesId} s=${season} e=${episode}`); } catch {}
  return { title: (picked || (episodeObj.name || episodeObj.episodeName || null)), source };
}

export async function mapAbsoluteToAired(seriesId: number, abs: number[]) {
  const js: any = await tvdb(`/series/${seriesId}/episodes/default?page=0`);
  const eps = js.data?.episodes || [];
  return abs.map(a => {
    const m = eps.find((e: any) => e.absoluteNumber === a) || eps.find((e:any)=> e.airedEpisodeNumber === a);
    return m ? { season: m.airedSeason ?? m.seasonNumber, ep: m.airedEpisodeNumber ?? m.number, title: m.name || m.episodeName } : null;
  });
}

export async function getSeries(seriesId: number) {
  const js: any = await tvdb(`/series/${seriesId}`);
  try { log('debug', `getSeries: seriesId=${seriesId} keys=${Object.keys(js || {}).join(',')}`); } catch {}
  const d = js.data || js;
  try {
    // If we got a raw TVDB object, pick a preferred name and annotate so callers
    // receive the same preferred/annotated shape as searchTVDB produces.
    if (d) {
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
  // `settings.ts`. Normalize the preferred language and build a prefer-list.
  const settingsLocal = loadSettings() as { tvdbLanguage?: string };
  function normalizeLang(s: string|undefined|null) {
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
  const settingsLang = normalizeLang(settingsLocal.tvdbLanguage || 'en');
  const tr = d.translations;
  const preferLangs = [settingsLang, 'en', 'eng', 'romaji', 'ja', 'ja-latn', 'zh', 'zh-cn', 'zh-tw'];
  let preferred: string | undefined;
  let pickedSource: string | undefined;
  if (tr) {
    if (Array.isArray(tr)) {
      function trMatchesToken(tEntry: any, token: string) {
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
      for (const p of preferLangs) {
        if (!p) continue;
        const found = tr.find((t: any) => trMatchesToken(t, p));
        if (found && (found.name || found.title || found.translation)) { preferred = found.name || found.title || found.translation; pickedSource = 'translation'; break; }
      }
      if (!preferred) {
        const en = tr.find((t: any) => trMatchesToken(t, 'en'));
        if (en) { preferred = en.name || en.title || en.translation; pickedSource = 'translation'; }
      }
    } else if (typeof tr === 'object') {
      for (const p of preferLangs) {
        if (!p) continue;
        const keyMatch = Object.keys(tr || {}).find(k => k.toString().toLowerCase() === p || k.toString().toLowerCase().startsWith(p));
        if (keyMatch) {
          const val = tr[keyMatch];
          preferred = (typeof val === 'string') ? val : (val && (val.name || val.title || val.translation));
          if (preferred) { pickedSource = 'translation'; break; }
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