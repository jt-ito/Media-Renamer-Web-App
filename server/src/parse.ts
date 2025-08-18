import path from 'path';
import { log } from './logging.js';

const YEAR_PAREN = /\((19\d{2}|20\d{2}|21\d{2})\)/;
const YEAR_BARE = /\b(19\d{2}|20\d{2}|21\d{2})\b/;
const SXXEXX_MULTI = /\bS(?<s>\d{1,2})E(?<e1>\d{2})(?:E(?<e2>\d{2}))*\b/i;
const SXXEXX_SINGLE = /\bS(?<s>\d{1,2})E(?<e>\d{2})\b/i;
const XXxYY = /\b(?<s>\d{1,2})x(?<e>\d{2})\b/i;
const E_ONLY = /\bE(?<e>\d{2})\b/i;
const EP_RANGE = /E(?<e1>\d{1,3})-(?<e2>\d{1,3})/i;
const SEASON_WORD = /\bSeason[\s._-]*(?<s>\d{1,2})\b/i;
const EPISODE_WORD = /\bEpisode[\s._-]*(?<e>\d{1,3})\b/i;
const MULTI_RANGE = /\b(?<e1>\d{1,3})-(?<e2>\d{1,3})\b/;
const ABSOLUTE_HINT = /\b(OVA|OAD|NCOP|NCED|SP|Special)\b/i;
const FANSUB_BRACKETS = /\[[^\]]+\]/g;
const CURLY = /\{[^}]+\}/g;
const PAREN_MISC = /\((?!19\d{2}|20\d{2}|21\d{2})[^)]+\)/g;
const EXTENDED_TAGS = /\b(REMUX|REMASTERED|EXTENDED|UNCUT|IMAX|PROPER|REAL|REPACK|INTERNAL)\b/ig;
const RES_TAGS = /\b(480p|720p|1080p|2160p|4K)\b/i;
const CODECS = /\b(x264|x265|h264|HEVC|AVC|AAC|AC3)\b/ig;
const TRAILING_GROUP = /(?:[-_.] ?[A-Za-z0-9]{2,}(?:-[A-Za-z0-9]{2,})?)$/;

function norm(s: string) {
  return s.replace(/[._]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
function stripNoise(s: string) {
  return norm(s)
    .replace(FANSUB_BRACKETS, ' ')
    .replace(CURLY, ' ')
  .replace(PAREN_MISC, ' ')
  .replace(EXTENDED_TAGS, ' ')
  .replace(RES_TAGS, ' ')
  .replace(CODECS, ' ')
  .replace(TRAILING_GROUP, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Remove trailing ranges like "1-12", trailing single numbers, and words like "Complete"/"Full" when they appear
function stripTrailingRangeAndComplete(s: string) {
  let out = s.trim();
  // remove common 'complete' suffixes
  out = out.replace(/\b(?:complete(?: set| series)?|full|collection|complete-boxset)\b[.\s-]*$/i, '').trim();
  // remove trailing season markers like 'Season 1' or 'Season 01'
  out = out.replace(/\bseason\s*\d{1,2}\b$/i, '').trim();
  // remove trailing numeric ranges (e.g. "1-12", "1 to 12") or single trailing number
  out = out.replace(/(?:\b\d{1,3}\s*(?:-|–|—|to)\s*\d{1,3}\b|\b\d{1,3}(?:-\d{1,3})\b|\b\d{1,3}\b)\s*$/i, '').trim();
  return out.replace(/\s{2,}/g, ' ').trim();
}

export type ParsedGuess = {
  kind: 'movie' | 'series';
  title?: string;
  year?: number;
  season?: number;
  episodes?: number[];
  /** First (primary) episode number when a single episode is inferred */
  episode_number?: number;
  /** Example parsed name using Jellyfin/Plex scheme for the primary episode */
  parsedName?: string;
  /** Example Jellyfin-style path (without extension) for the primary episode */
  jellyfinExample?: string;
  /** Episode title when it can be inferred from filename */
  episode_title?: string;
  special?: boolean;
  absolute?: number[];
  confidence: number;
  extra?: any;
};

export function inferFromPath(fullPath: string): ParsedGuess {
  const ext = path.extname(fullPath);
  const base = path.basename(fullPath, ext);
  const dir = path.dirname(fullPath);
  const parent = path.basename(dir);
  const grand = path.basename(path.dirname(dir));

  const baseClean = stripNoise(base);
  const parentClean = stripNoise(parent);
  const grandClean = stripNoise(grand);

  let titleSource = baseClean;
  let confidence = 0;

  const yearBase = baseClean.match(YEAR_PAREN)?.[1] || baseClean.match(YEAR_BARE)?.[1];
  const yearParent = parentClean.match(YEAR_PAREN)?.[1] || parentClean.match(YEAR_BARE)?.[1];
  const year = Number(yearParent || yearBase) || undefined;
  if (year) confidence += 2;

  const parentLooksTitle = !/\b(S\d{1,2}|Season\b|\d{1,2}x\d{2}|S\d{1,2}E\d{2})/i.test(parentClean) &&
                           parentClean.length >= 3 &&
                           (parentClean.match(/\d/g)?.length || 0) <= 4;
  if (parentLooksTitle) { titleSource = parentClean; confidence += 2; }

  const parentIsSeason = /\bSeason\b/i.test(parentClean) || /\bS\d{1,2}\b/i.test(parentClean);
  if (parentIsSeason && grandClean && !/\bSeason\b/i.test(grandClean)) {
    titleSource = grandClean;
    confidence += 1;
  }

  // canonicalize title candidate by stripping trailing ranges/"Complete" annotations
  const rawTitle = titleSource.replace(YEAR_PAREN, '').trim();
  const canonical = stripTrailingRangeAndComplete(rawTitle);
  const title = norm(canonical);

  let season: number | undefined;
  let episodes: number[] | undefined;
  let absolute: number[] | undefined;
  let special = false;

  const multi = baseClean.match(SXXEXX_MULTI);
  // explicit episode ranges like E01-03
  const epRange = baseClean.match(EP_RANGE);
  if (epRange?.groups && epRange.groups.e1 && epRange.groups.e2) {
    const start = Number(epRange.groups.e1);
    const end = Number(epRange.groups.e2);
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      episodes = [];
      for (let i = start; i <= end; i++) episodes.push(i);
      // try to find season context
      const sxx = baseClean.match(SXXEXX_SINGLE) || parentClean.match(SEASON_WORD) || baseClean.match(SEASON_WORD);
      if (sxx?.groups && sxx.groups.s) season = Number(sxx.groups.s);
      confidence += 3;
    }
  }
  if (multi?.groups?.s) {
    season = Number(multi.groups.s);
    const matches = [...baseClean.matchAll(/E(\d{2})/ig)].map(m => Number(m[1]));
    if (matches.length) episodes = matches;
    confidence += 3;
  } else {
    const sxxexx = baseClean.match(SXXEXX_SINGLE);
    const xxyy = baseClean.match(XXxYY);
    const seasonWord = parentClean.match(SEASON_WORD) || baseClean.match(SEASON_WORD);
    const epWord = baseClean.match(EPISODE_WORD);
    const eOnly = baseClean.match(E_ONLY);

    if (sxxexx?.groups) {
      season = Number(sxxexx.groups.s);
      episodes = [Number(sxxexx.groups.e)];
      confidence += 3;
    } else if (xxyy?.groups) {
      season = Number(xxyy.groups.s);
      episodes = [Number(xxyy.groups.e)];
      confidence += 3;
    } else if (seasonWord?.groups && epWord?.groups) {
      season = Number(seasonWord.groups.s);
      episodes = [Number(epWord.groups.e)];
      confidence += 2;
    } else if (seasonWord?.groups && eOnly?.groups) {
      season = Number(seasonWord.groups.s);
      episodes = [Number(eOnly.groups.e)];
      confidence += 2;
    } else {
      const range = baseClean.match(MULTI_RANGE);
      const absNums = range
        ? [Number(range.groups!.e1), Number(range.groups!.e2)]
        : (baseClean.match(/\b(\d{1,3})\b/g) || [])
            .map(Number)
            .filter(n => n <= 300);
      const fansubCue = ABSOLUTE_HINT.test(baseClean) || FANSUB_BRACKETS.test(path.basename(fullPath));
      if (fansubCue && absNums.length) {
        absolute = range ? absNums : [absNums[absNums.length - 1]];
        confidence += 2;
      }
    }
  }

  if (/\b(OVA|OAD|SP|Special|Season 00|S0E)\b/i.test(baseClean) || /\bSeason[\s._-]*0\b/i.test(parentClean)) {
    special = true;
    season = 0;
    confidence += 1;
  }

  const hasEpisode = !!(episodes?.length || absolute?.length || special);
  const kind: 'movie' | 'series' = hasEpisode || parentIsSeason ? 'series' : 'movie';

  const episode_number = (episodes && episodes.length ? episodes[0] : (absolute && absolute.length ? absolute[0] : undefined));
  // If we didn't already populate parsedName/episode_title above (inside try),
  // attempt a lightweight extraction here so callers (and the UI) can see an
  // episode title when present in the filename.
  let episode_title: string | undefined = undefined;
  let parsedNameOut: string | undefined = undefined;
  let jellyfinExampleOut: string | undefined = undefined;
  try {
    // look for patterns like " - Title" after the episode code
    const sxx = baseClean.match(SXXEXX_SINGLE) || baseClean.match(XXxYY);
    if (sxx && sxx.index != null) {
      const after = baseClean.slice(sxx.index + (sxx[0] || '').length).replace(/^[-\s:\t]+/, '').trim();
      if (after) {
        const tit = stripTrailingRangeAndComplete(after);
        if (tit) {
          episode_title = norm(tit);
          const s = season ?? 1;
          const e = episode_number ?? (episodes && episodes[0]) ?? 1;
          const paddedS = String(s).padStart(2, '0');
          const paddedE = String(e).padStart(2, '0');
          const baseSeries = title || parentClean || grandClean || '';
          parsedNameOut = `${baseSeries} - S${paddedS}E${paddedE} - ${episode_title}`;
          jellyfinExampleOut = `${baseSeries}/Season ${paddedS}/${baseSeries} - S${paddedS}E${paddedE} - ${episode_title}`;
        }
      }
    }
  } catch (e) {}

  const result = {
    kind,
    title: title || undefined,
    year,
    season,
    episodes,
    episode_number,
    special,
    absolute,
    confidence,
    episode_title: episode_title,
    parsedName: parsedNameOut,
    jellyfinExample: jellyfinExampleOut
  };
  try { log('debug', `inferFromPath: ${fullPath} -> ${JSON.stringify(result)}`); } catch {}
  return result;
}