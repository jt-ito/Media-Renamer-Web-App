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
    // Prefer English / romaji translations when available. TVDB can return localized
    // names (including Japanese). If the returned `name` is CJK, but an English
    // translation exists, prefer the English/romaji one.
    const cjkRe = /[\u3040-\u30ff\u4e00-\u9fff]/;
    function pickPreferredName(d: any) {
      const settingsLang = (loadSettings().tvdbLanguage || 'en').toString().toLowerCase();
      // try translations in several shapes
      const tr = d.translations;
      // Build a preference list starting with the user's preferred language
  const preferLangs = [settingsLang, 'en', 'eng', 'en-us', 'en-gb', 'romaji', 'ja-latn', 'zh', 'zh-cn', 'zh-tw', 'chi'];
      let preferred: string | undefined;
      if (tr) {
        if (Array.isArray(tr)) {
          for (const p of preferLangs) {
            const found = tr.find((t: any) => (t.language && t.language.toString().toLowerCase().startsWith(p)) || (t.iso_639_3 && t.iso_639_3.toString().toLowerCase() === p));
            if (found && (found.name || found.title || found.translation)) { preferred = found.name || found.title || found.translation; break; }
          }
          if (!preferred) {
            const en = tr.find((t: any) => t.language && t.language.toString().toLowerCase().startsWith('en'));
            if (en) preferred = en.name || en.title || en.translation;
          }
        } else if (typeof tr === 'object') {
          for (const p of preferLangs) {
            if (tr[p]) {
              preferred = (typeof tr[p] === 'string') ? tr[p] : (tr[p].name || tr[p].title || tr[p].translation);
              break;
            }
          }
          if (!preferred) {
            const k = Object.keys(tr || {}).find(k => k.toLowerCase().startsWith('en'));
            if (k) preferred = (typeof tr[k] === 'string') ? tr[k] : (tr[k].name || tr[k].title || tr[k].translation);
          }
        }
      }
      let name = d.name || d.title || preferred || d.slug || '';
      if (cjkRe.test((name || '') + '') && preferred) name = preferred;
      return (name || '').toString();
    }
    const name = pickPreferredName(d);

    // Year extraction: prefer explicit `year` or try from known date fields
    let y: number | undefined;
    if (d.year) y = Number(d.year) || undefined;
    else {
      const dateStr = d.firstAired || d.firstAirTime || d.releaseDate || d.released || '';
      const maybe = (dateStr || '').toString().slice(0,4);
      if (/^\d{4}$/.test(maybe)) y = Number(maybe);
    }
    try { log('debug', `searchTVDB: candidate id=${d.tvdb_id||d.id} name=${d.name||d.title} year=${y}`); } catch {}

    // Infer the returned object type when available. TVDB may include a `type` or `objectType` field.
    let returnedType: MediaType = type; // default to requested type
    const t = (d.type || d.objectType || d.seriesType || '').toString().toLowerCase();
    if (t.includes('movie')) returnedType = 'movie';
    else if (t.includes('series') || t.includes('show') || t.includes('tv')) returnedType = 'series';

    return {
      id,
      name,
      year: y,
      type: returnedType,
      extra: { imdb: d.imdb_id, tmdb: d.tmdb_id }
    } as MatchCandidate;
  });
}

export async function getEpisodeByAiredOrder(seriesId: number, season: number, episode: number) {
  const ep: any = await tvdb(`/series/${seriesId}/episodes/default?page=0&season=${season}`);
  const match = (ep.data?.episodes || []).find((e: any) => e.number === episode || e.airedEpisodeNumber === episode);
  return match;
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
  return js.data || js;
}