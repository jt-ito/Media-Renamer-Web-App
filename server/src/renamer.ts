import fs from 'fs';
import path from 'path';
import { Library, MatchCandidate, RenamePlan, ScanItem, MediaType } from './types.js';
import { loadSettings } from './settings.js';
import { log } from './logging.js';
import { getSeries } from './tvdb.js';

function sanitize(s: string) {
  if (!s) return '';
  // Preserve original characters and capitalization where possible.
  // Only remove characters that are illegal in Windows file names and
  // collapse excessive whitespace. This keeps episode/series titles
  // identical to the source except for filesystem safety.
  const str = String(s);
  // Remove explicitly illegal characters for Windows/most filesystems
  const cleaned = str.replace(/[<>:\"/\\|?*\u0000-\u001F]/g, '');
  // Trim and collapse multiple spaces
  return cleaned.replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
}
function pad2(n: number) { return String(n).padStart(2, '0'); }
function applyScheme(template: string, vars: Record<string, any>) {
  try {
    const keys = Object.keys(vars);
    const vals = Object.values(vars);

    // simple brace balance check
    let open = 0;
    for (let i = 0; i < template.length; i++) {
      if (template[i] === '{') open++;
      else if (template[i] === '}') open--;
      if (open < 0) throw new Error('Template syntax error: unexpected }');
    }
    if (open !== 0) throw new Error('Template syntax error: missing } in template expression');

    const out = template.replace(/\{([^}]+)\}/g, (_m, inner) => {
      inner = inner.trim();
      // padding shorthand: name:02
      const padMatch = inner.match(/^(\w+):0?(\d+)$/);
      if (padMatch) {
        const name = padMatch[1];
        const digits = parseInt(padMatch[2], 10);
        const val = vars[name];
        return String(val ?? '').padStart(digits, '0');
      }
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(...keys, 'return (' + inner + ');');
        const res = fn(...vals);
        return res == null ? '' : String(res);
      } catch (e) {
        // On evaluation error, surface a safe empty string to avoid breaking path generation
        return '';
      }
    });
    return out;
  } catch (e) {
    // Fallback: remove tokens we can't evaluate
    return template.replace(/\{[^}]+\}/g, '');
  }
}

export function movieOutputPath(lib: Library, cand: MatchCandidate, ext: string) {
  // Normalize ext: ensure it's a string and, if present, starts with a dot.
  ext = ext ? String(ext) : '';
  if (ext && !ext.startsWith('.')) ext = '.' + ext;
  const settings = loadSettings();
  const title = sanitize(cand.name);
  const year = cand.year ? String(cand.year) : '';
  // Ensure outputRoot is a concrete string for path operations
  const outputRoot = lib.outputRoot ?? '';
  if (settings.movieScheme) {
    const relNoExt = applyScheme(settings.movieScheme, { title, year });
    return path.join(outputRoot, relNoExt + ext);
  }
  const base = `${title}${year ? ` (${year})` : ''}`;
  return path.join(outputRoot, base, `${base}${ext}`);
}

export function episodeOutputPath(
  lib: Library,
  series: MatchCandidate,
  season: number,
  eps: number[],
  episodeTitle: string | undefined,
  ext: string
) {
  // Normalize ext: ensure it's a string and, if present, starts with a dot.
  ext = ext ? String(ext) : '';
  if (ext && !ext.startsWith('.')) ext = '.' + ext;
  const settings = loadSettings();
  const chooseDisplayName = (s: MatchCandidate) => {
    const cjkRe = /[\u3040-\u30ff\u4e00-\u9fff]/;
    try {
      const audit = (s as any)?.extra?.audit;
      // 1) if server already picked a translation/alias, use it
      const picked = (s as any)?.extra?.nameSource || (s as any)?._pickedNameSource;
      if (picked && (picked === 'translation' || picked === 'alias')) return String(s.name || '');

      // 2) try audit translations (array)
      if (audit?.translations && Array.isArray(audit.translations)) {
        const en = audit.translations.find((t:any)=> t && String(t.language||'').toLowerCase().startsWith('en'));
        if (en && (en.name || en.title)) return String(en.name || en.title || en.translation || '');
      }

      // 3) try aliases (object entries)
      if (audit?.aliases && Array.isArray(audit.aliases) && audit.aliases.length) {
        const firstObj = audit.aliases[0];
        if (typeof firstObj === 'object') {
          const prefer = ['en','eng','en-us','en-gb','romaji'];
          for (const p of prefer) {
            const found = (audit.aliases as any[]).find((a:any)=> a && (String(a.language||'').toLowerCase().startsWith(p) || String(a.iso_639_3||'').toLowerCase()===p));
            if (found && (found.name || found.title)) return String(found.name || found.title || found.translation || '');
          }
        } else {
          // aliases are strings: prefer the first non-CJK alias
          const nonCjk = (audit.aliases as string[]).find((x:any)=> !cjkRe.test(String(x||'')));
          if (nonCjk) return String(nonCjk);
        }
      }

      // 4) fallback: prefer slug or original name unless it's CJK and no translation found
  const name = String(s.name || (s as any).slug || '');
      if (cjkRe.test(name)) {
        // if name is CJK but we couldn't find non-CJK translations/aliases, still return slug if present
  if ((s as any).slug) return String((s as any).slug);
      }
      return name;
  } catch (e) { return String(s.name || (s as any).slug || ''); }
  };
  const rawDisplayName = chooseDisplayName(series);
  const seriesName = sanitize(rawDisplayName || series.name || '');
  let year = series.year ? String(series.year) : '';
  let debugSource = 'series.year';
  log('debug', `[episodeOutputPath] INPUTS: series.name='${series.name}', series.year='${series.year}', lib.inputRoot='${lib.inputRoot}', lib.outputRoot='${lib.outputRoot}'`);
  if (!year && series.name) {
    const m = String(series.name).match(/\((\d{4})\)/);
    log('debug', `[episodeOutputPath] Trying to extract year from series.name: match=${m}`);
    if (m) { year = m[1]; debugSource = 'series.name'; }
  }
  const inputRoot = lib.inputRoot ?? '';
  if (!year && lib && inputRoot) {
    const m = String(inputRoot).match(/\((\d{4})\)/);
    log('debug', `[episodeOutputPath] Trying to extract year from lib.inputRoot: match=${m}`);
    if (m) { year = m[1]; debugSource = 'lib.inputRoot'; }
  }
  // FINAL fallback: extract any 4-digit year from the full input path (folder or file)
  if (!year && lib && inputRoot) {
    const m = String(inputRoot).match(/(19|20)\d{2}/);
    log('debug', `[episodeOutputPath] FINAL fallback: any 4-digit year from inputRoot: match=${m}`);
    if (m) { year = m[0]; debugSource = 'inputRoot-any-4digit'; }
  }
  const seriesFolder = year ? `${seriesName} (${year})` : seriesName;
  const epCode = `S${pad2(season)}E${eps.map(pad2).join('E')}`;
  const epTitle = episodeTitle ? sanitize(episodeTitle) : '';
  const outputRoot = lib.outputRoot ?? '';
  const folder = path.join(outputRoot, seriesFolder, `Season ${pad2(season)}`);
  const file = `${seriesFolder} - ${epCode}${epTitle ? ` - ${epTitle}` : ''}${ext}`;
  const finalPath = path.join(folder, file);
  log('debug', `[episodeOutputPath] RESULT: year='${year}' (source=${debugSource}), finalPath='${finalPath}'`);
  return finalPath;
}

export function planMovie(item: ScanItem, lib: Library, cand: MatchCandidate): RenamePlan {
  const to = movieOutputPath(lib, cand, item.ext);
  try { log('debug', `planMovie: ${item.path} -> ${to} (tvdb=${cand.id})`); } catch {}
  const metadataTitle = path.basename(to, path.extname(to));
  return { from: item.path, to, action: lib.linkMode || 'hardlink', dryRun: true, meta: { tvdbId: cand.id, type: 'movie', output: to, metadataTitle, year: cand.year } };
}

export function planEpisode(
  item: ScanItem,
  lib: Library,
  series: MatchCandidate,
  season: number,
  eps: number[],
  episodeTitle: string | undefined
): RenamePlan {
  const to = episodeOutputPath(lib, series, season, eps, episodeTitle, item.ext);
  try { log('debug', `planEpisode: ${item.path} -> ${to} (series=${series.id} s=${season} e=${eps.join(',')})`); } catch {}
  const metadataTitle = path.basename(to, path.extname(to));
  // If year is missing in meta, try to extract from the output path (folder name)
  let metaYear = series.year;
  if (!metaYear) {
    const m = String(to).match(/\((\d{4})\)/);
    if (m) metaYear = Number(m[1]);
  }
  const plan = { from: item.path, to, action: lib.linkMode || 'hardlink', dryRun: true, meta: { tvdbId: series.id, type: 'series' as MediaType, output: to, metadataTitle, year: metaYear } };
  try {
    log('debug', `[planEpisode] meta.year='${plan.meta.year}', output='${plan.meta.output}', metadataTitle='${plan.meta.metadataTitle}'`);
  } catch (e) {}
  return plan;
}

function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}
function uniquePath(p: string) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let i = 2;
  while (true) {
    const cand = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(cand)) return cand;
    i++;
  }
}

export function applyPlans(plans: RenamePlan[], allowCopyFallback: boolean): { results: { from: string; to: string }[] } {
  const results: { from: string; to: string }[] = [];
  const journal: { from: string; to: string; action: 'rename' | 'hardlink'; created?: boolean }[] = [];
  try {
    for (const p of plans) {
  try { log('info', `applyPlans - processing: ${p.from} -> ${p.to} (action=${p.action})`); } catch {}
      if (p.dryRun) continue;
      ensureDir(p.to);
      let target = uniquePath(p.to);
      // Update the plan to reflect the actual path we'll create. This ensures
      // that recorded approvals and metadataTitle match the real filename in
      // case uniquePath added a suffix to avoid collisions.
      try {
        p.to = target;
        if (p.meta) {
          p.meta.output = target;
          try { p.meta.metadataTitle = path.basename(target, path.extname(target)); } catch {}
          // Ensure meta.year is set from the resolved metadataTitle when possible
          try {
            if (!p.meta.year && p.meta.metadataTitle) {
              const mt = String(p.meta.metadataTitle);
              const m = mt.match(/\((\d{4})\)/);
              if (m) p.meta.year = Number(m[1]);
            }
          } catch (e) { /* best-effort */ }
        }
      } catch (e) {}

      if (p.action === 'hardlink') {
        try {
          fs.linkSync(p.from, target);
          journal.push({ from: p.from, to: target, action: 'hardlink', created: true });
          results.push({ from: p.from, to: target });
        } catch (e: any) {
          if (e.code === 'EXDEV' && allowCopyFallback) {
            fs.copyFileSync(p.from, target);
            journal.push({ from: p.from, to: target, action: 'hardlink', created: true });
            results.push({ from: p.from, to: target });
          } else {
            try { log('error', `link failed for ${p.from} -> ${target}: ${e?.message ?? String(e)}`); } catch {}
            if (allowCopyFallback) {
              try { fs.copyFileSync(p.from, target); journal.push({ from: p.from, to: target, action: 'hardlink', created: true }); results.push({ from: p.from, to: target }); continue; } catch (ee) { /* fall through */ }
            }
            throw e;
          }
        }
      } else {
        fs.renameSync(p.from, target);
        journal.push({ from: p.from, to: target, action: 'rename' });
        results.push({ from: p.from, to: target });
      }
    }
  } catch (e) {
    for (const j of journal.reverse()) {
      if (j.action === 'hardlink' && j.created) {
        try { fs.unlinkSync(j.to); } catch {}
      } else if (j.action === 'rename') {
        try { fs.renameSync(j.to, j.from); } catch {}
      }
    }
    throw e;
  }
  return { results };
}

// For preview: compute a collision-free path and update plan metadata so the
// preview matches what will be created when the plan is applied. This mirrors
// the behavior in applyPlans but is safe to call during dry-run preview.
export async function finalizePlan(p: RenamePlan) {
  try {
    const target = uniquePath(p.to);
    p.to = target;
    if (p.meta) {
      p.meta.output = target;
      try { p.meta.metadataTitle = path.basename(target, path.extname(target)); } catch {}
      // Ensure a year is present in meta when possible so previews can display it.
      try {
        if (!p.meta.year) {
          // try to extract any "(YYYY)" anywhere in the metadataTitle (not just trailing)
          const mt = String(p.meta.metadataTitle || '');
          const m = mt.match(/\((\d{4})\)/);
          if (m) {
            p.meta.year = Number(m[1]);
          // If still missing and we have a TVDB id, attempt to fetch series/movie info
          } else if (p.meta.tvdbId) {
            try {
              const s = await getSeries(Number(p.meta.tvdbId));
              const maybe = s?.firstAired || s?.firstAiredAt || s?.releaseDate || s?.released || s?.firstAiredDate
                || (s?.attributes && (s.attributes.firstAired || s.attributes.firstAiredAt || s.attributes.releaseDate || s.attributes.released || s.attributes.firstAiredDate))
                || (s?.data && (s.data.firstAired || s.data.firstAiredAt || s.data.releaseDate || s.data.released || s.data.firstAiredDate));
              const y = maybe ? String(maybe).slice(0,4) : undefined;
              if (y && /^\d{4}$/.test(y)) p.meta.year = Number(y);
            } catch (e) {
              // ignore tvdb fetch errors
            }
          }
        }
      } catch (e) {
        // best-effort only; don't fail finalization on parse errors
      }
      // If this is a series plan and we have a year, ensure the metadataTitle
      // includes the year after the series name (e.g. "Series (2018) - S01E01 - Title").
      try {
        const year = p.meta.year;
        if (year && p.meta.type === 'series' && p.meta.metadataTitle) {
          const mt = String(p.meta.metadataTitle);
          const yearStr = String(year);
          // Only insert the year into the prefix if the prefix doesn't already
          // contain the year. This avoids double-inserting when the generated
          // metadataTitle already includes the year earlier in the string.
          const parts = mt.split(' - ');
          const prefix = parts.shift() || '';
          const rest = parts.join(' - ');
          const prefixYearRegex = new RegExp(`\\(\\s*${yearStr}\\s*\\)`);
          let newPrefix = prefix;
          if (!prefixYearRegex.test(prefix)) {
            newPrefix = `${prefix} (${yearStr})`;
          }
          p.meta.metadataTitle = rest ? `${newPrefix} - ${rest}` : newPrefix;
        }
      } catch (e) {
        // ignore formatting errors
      }
      // Ensure the plan's path/output also reflect the inserted year when possible.
      // Stronger approach: always prefer the server's computed metadataTitle as the
      // final filename and try to update the series folder to include the year
      // when a matching segment is found. This keeps preview `p.to` in sync with
      // `p.meta.metadataTitle` and with what applyPlans will create.
      try {
        if (p.meta && p.meta.type === 'series' && p.meta.metadataTitle && p.to) {
          const metaTitle = String(p.meta.metadataTitle);
          const metaPrefix = metaTitle.split(' - ')[0] || '';
          const seriesBase = metaPrefix.replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim();

          const ext = path.extname(String(p.to));
          // Update filename to metadataTitle + ext
          try {
            const dir = path.dirname(String(p.to));
            // attempt to insert year into series folder segment if present
            const segs = dir.split(/[\\/]+/);
            if (seriesBase) {
              for (let i = 0; i < segs.length; i++) {
                try {
                  const segBase = segs[i].replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim();
                  if (segBase && (segBase.toLowerCase() === seriesBase.toLowerCase() || segBase.toLowerCase().startsWith(seriesBase.toLowerCase()))) {
                    segs[i] = metaPrefix;
                    break;
                  }
                } catch (e) { /* per-segment best-effort */ }
              }
            }
            const newDir = segs.join(path.sep);
            const newPath = path.join(newDir, metaTitle + ext);
            p.to = newPath;
            if (p.meta) p.meta.output = newPath;
          } catch (e) {
            // If anything goes wrong, at minimum ensure filename matches metadataTitle
            try {
              const baseDir = path.dirname(String(p.to));
              const fallback = path.join(baseDir, metaTitle + path.extname(String(p.to)));
              p.to = fallback;
              if (p.meta) p.meta.output = fallback;
            } catch (ee) { /* swallow */ }
          }
        }
      } catch (e) { /* best-effort */ }
    }
  } catch (e) {}
  return p;
}