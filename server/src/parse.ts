import path from 'path';
import { log } from './logging.js';

// This parser uses a modular, score-based approach that generates candidate
// interpretations and ranks them. The goal is high robustness across Windows,
// macOS, Linux filename styles and many real-world release tags.

const YEAR_RE = /(19\d{2}|20\d{2}|21\d{2})/;
const SXXEXX = /\bS(\d{1,2})E(\d{1,3})\b/i;
const SXXEXX_ALL = /\bS(\d{1,2})E(\d{2,3})(?:E(\d{2,3}))*\b/ig;
const XXxYY = /\b(\d{1,2})x(\d{2,3})\b/i;
const EP_RANGE = /\bE(\d{1,3})-(\d{1,3})\b/i;
const E_ONLY = /\bE(\d{1,3})\b/i;
const ABSOLUTE_HINT = /\b(OVA|OAD|SP|Special|SPECIAL|OVA:?)\b/i;

// Noise tokens to remove/ignore
const NOISE_RE_LIST: RegExp[] = [
  /\[[^\]]+\]/g, // [Fansub]
  /\{[^}]+\}/g,
  /\((?!19\d{2}|20\d{2}|21\d{2})[^)]+\)/g, // parenthesis but not years
  /\b(480p|720p|1080p|2160p|4k|4K)\b/ig,
  /\b(x\.?264|x\.?265|h\.?264|h\.?265|hevc|avc|aac2?\.?0?|aac|ac3)\b/ig,
  /\b(BluRay|Blu-ray|BDRip|WEB[-_.]?DL|WEB[-_.]?Rip|WEB|HDTV|DVDRip|HDRip|BRRip|CAM|SCR|TC|TS)\b/ig,
  /\b(UNCENSORED|UNCUT|DUAL|VIDEO|AUDIO|ENG|JPN|JP|OV|SUB|SUBBED|DUBBED|ISO)\b/ig,
  /(?:-|_|\.){1,}/g
];

function normalizeSeparators(s: string) {
  return s.replace(/[._]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function stripNoise(s: string) {
  if (!s) return '';
  let out = s;
  for (const r of NOISE_RE_LIST) out = out.replace(r, ' ');
  out = out.replace(/[-_.]+$/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return out;
}

function pickTitleCandidate(full: string, parent: string, grand: string) {
  // Prefer the file name before the first episode marker as title, else parent, else grand
  const cleaned = normalizeSeparators(stripNoise(full));
  const markers = [SXXEXX, XXxYY, /\bEpisode\b/i, EP_RANGE, E_ONLY];
  let idx = -1;
  for (const m of markers) {
    const r = cleaned.search(m);
    if (r >= 0 && (idx < 0 || r < idx)) idx = r;
  }
  if (idx >= 0) {
    const cand = cleaned.slice(0, idx).trim();
    if (cand.length >= 2) return cand;
  }
  // fallback to cleaned filename without extension
  if (cleaned.length >= 3) return cleaned;
  // parent folder heuristics
  const p = normalizeSeparators(stripNoise(parent));
  if (p && p.length >= 3 && !/^season\b/i.test(p) && (p.match(/\d/g)||[]).length < 6) return p;
  const g = normalizeSeparators(stripNoise(grand));
  if (g && g.length >= 3) return g;
  return '';
}

export type ParsedGuess = {
  kind: 'movie' | 'series';
  title?: string;
  year?: number;
  season?: number;
  episodes?: number[];
  episode_number?: number;
  parsedName?: string;
  jellyfinExample?: string;
  episode_title?: string;
  special?: boolean;
  absolute?: number[];
  confidence: number; // 0..100
  extra?: any;
};

function scoreAndNormalize(result: ParsedGuess) {
  // normalize confidence to 0..100
  result.confidence = Math.max(0, Math.min(100, Math.round(result.confidence)));
  return result;
}

function makeParsedName(baseSeries: string, s: number|undefined, e: number|undefined, epTitle?: string) {
  const ss = String((s||1)).padStart(2,'0');
  const ee = String((e||1)).padStart(2,'0');
  if (epTitle) return `${baseSeries} - S${ss}E${ee} - ${epTitle}`;
  return `${baseSeries} - S${ss}E${ee}`;
}

export function inferFromPath(fullPath: string): ParsedGuess {
  const ext = path.extname(fullPath || '');
  const base = path.basename(fullPath || '', ext || '');
  const dir = path.dirname(fullPath || '');
  const parent = path.basename(dir || '');
  const grand = path.basename(path.dirname(dir || ''));

  const baseStripped = stripNoise(base);
  const parentStripped = stripNoise(parent);
  const grandStripped = stripNoise(grand);

  const titleCand = pickTitleCandidate(base, parent, grand);

  // year detection (prefer parent folder year, then filename)
  let year: number|undefined;
  const yearFromParent = (parentStripped.match(YEAR_RE)||[])[0];
  const yearFromBase = (baseStripped.match(YEAR_RE)||[])[0];
  if (yearFromParent) year = Number(yearFromParent);
  else if (yearFromBase) year = Number(yearFromBase);

  // episode detection
  let season: number|undefined;
  let episodes: number[]|undefined;
  let absolute: number[]|undefined;
  let special = false;

  // SxxExx patterns (may be multiple episodes)
  const sMatch = base.match(SXXEXX_ALL);
  if (sMatch) {
    // collect all SxxExx occurrences
    const all = [...base.matchAll(SXXEXX_ALL)];
    if (all.length) {
      // prefer first for season
      const first = all[0];
      if (first[1]) season = Number(first[1]);
      const eps:number[] = [];
      for (const a of all) {
        // capture E.. occurrences after the Sxx
        const after = a[0];
        const es = [...after.matchAll(/E(\d{2,3})/ig)].map(m=>Number(m[1]));
        for (const e of es) if (!isNaN(e)) eps.push(e);
      }
      if (eps.length) episodes = eps;
    }
  }

  // explicit E-range (E01-03)
  const range = base.match(EP_RANGE);
  if (range && range[1] && range[2]) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (!isNaN(start) && !isNaN(end) && end>=start) {
      episodes = episodes || [];
      for (let i=start;i<=end;i++) episodes.push(i);
    }
  }

  // XxYy style
  const xy = base.match(XXxYY);
  if (xy && xy[1] && xy[2]) {
    season = season || Number(xy[1]);
    episodes = episodes || [Number(xy[2])];
  }

  // fallback single SxxEyy
  const sxx = base.match(SXXEXX);
  if (sxx && sxx[1] && sxx[2]) {
    season = season || Number(sxx[1]);
    episodes = episodes || [Number(sxx[2])];
  }

  // E-only
  if (!episodes) {
    const eonly = base.match(E_ONLY);
    if (eonly && eonly[1]) episodes = [Number(eonly[1])];
  }

  // absolute/OVA hints
  const absNums = (base.match(/\b(\d{1,3})\b/g)||[]).map(n=>Number(n)).filter(n=>!isNaN(n) && n>0 && n<1000);
  if ((ABSOLUTE_HINT.test(base) || ABSOLUTE_HINT.test(parent) || absNums.length>0) && !episodes) {
    // treat last detected number as absolute episode if plausible
    if (absNums.length) absolute = [absNums[absNums.length-1]];
  }

  if (/(OVA|OAD|SP|Special)\b/i.test(base) || /Season[\s._-]*0\b/i.test(parent)) {
    special = true;
    season = 0;
  }

  const hasEpisode = !!(episodes && episodes.length) || !!(absolute && absolute.length) || special;
  const kind: 'movie'|'series' = hasEpisode || /^season\b/i.test(parentStripped) ? 'series' : 'movie';

  // episode title extraction (text after episode code)
  let episode_title: string|undefined;
  if (hasEpisode) {
    const markerPos = base.search(/S\d{1,2}E\d{2,3}|\bE\d{1,3}\b|\bEpisode\b/i);
    if (markerPos>=0) {
      const after = normalizeSeparators(stripNoise(base.slice(markerPos + (base.match(/S\d{1,2}E\d{2,3}|\bE\d{1,3}\b|\bEpisode\b/i)?.[0]||'').length)));
      if (after) {
        const cleaned = after.replace(/^[\-:\s]+/, '').replace(/[\-_.\s:;]+$/g,'').trim();
        if (cleaned) episode_title = cleaned;
      }
    }
  }

  // Compute confidence score using simple heuristics
  let confidence = 10;
  if (kind==='series') confidence += 30;
  if (hasEpisode && episodes && episodes.length) confidence += 30;
  if (season!==undefined) confidence += 10;
  if (absolute && absolute.length) confidence += 8;
  if (special) confidence += 5;
  if (year) confidence += 5;
  if (titleCand && titleCand.length>0) confidence += 8;
  if (!titleCand || titleCand.length<2) confidence -= 5;

  const baseSeries = (titleCand || parentStripped || grandStripped || '').trim();
  const episode_number = episodes && episodes.length ? episodes[0] : (absolute && absolute.length ? absolute[0] : undefined);

  const parsedName = hasEpisode ? makeParsedName(baseSeries, season, episode_number, episode_title) : undefined;
  const jellyfinExample = hasEpisode && baseSeries ? `${baseSeries}/Season ${String((season||1)).padStart(2,'0')}/${parsedName}` : undefined;

  const result: ParsedGuess = scoreAndNormalize({
    kind,
    title: baseSeries || undefined,
    year: year || undefined,
    season: season===undefined?undefined:season,
    episodes: episodes || undefined,
    episode_number: episode_number===undefined?undefined:episode_number,
    parsedName: parsedName || undefined,
    jellyfinExample: jellyfinExample || undefined,
    episode_title: episode_title || undefined,
    special: special || undefined,
    absolute: absolute || undefined,
    confidence,
    extra: { rawBase: base, parent, grand }
  });

  try { log('debug', `inferFromPath: ${fullPath} -> ${JSON.stringify(result)}`); } catch {}
  return result;
}