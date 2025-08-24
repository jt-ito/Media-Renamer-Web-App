// server/src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import fg from 'fast-glob';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { loadLibraries, saveLibraries } from './config.js';
import { getLogs, log } from './logging.js';
import { inferFromPath } from './parse.js';
import { searchTVDB, getEpisodeByAiredOrder, mapAbsoluteToAired, invalidateTVDBToken, getSeries } from './tvdb.js';
import { pickTvdbCandidate as pickTvdbCandidateHelper } from './tvdbHelpers.js';
import { normalizePlansForPreview as normalizePlansForPreviewHelper, ensurePlanYears as ensurePlanYearsHelper, escapeRegex as escapeRegexHelper, normalizePathForCache } from './scan.js';
import { Library, MediaType, RenamePlan, ScanItem } from './types.js';
import { planEpisode, planMovie, applyPlans } from './renamer.js';
import { initApproved, isApproved, markApproved, approvedList, unapproveLast } from './approved.js';
import { loadSettings, saveSettings } from './settings.js';
// ...existing imports...

// ESM-safe __dirname/__filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function registerWeb(app: FastifyInstance) {
  const STATIC_ROOT = process.env.STATIC_ROOT
    ? path.resolve(process.env.STATIC_ROOT)
    : path.resolve(__dirname, '../web/dist'); // adjust to match where dist actually lives

  if (!(app as any)._staticMounted) {
    await app.register(fstatic, { root: STATIC_ROOT, prefix: '/' });
    (app as any)._staticMounted = true;
    app.log.info(`@fastify/static mounted at ${STATIC_ROOT}`);
  }

  if (!(app as any)._rootRegistered) {
    (app as any)._rootRegistered = true;
    app.get('/', async (_req, reply) => reply.sendFile('index.html'));
  }

  if (!(app as any)._spaFallbackRegistered) {
    (app as any)._spaFallbackRegistered = true;
    app.setNotFoundHandler((req, reply) => {
      const accept = String(req.headers.accept || '');
      const isHtml = accept.includes('text/html');
      const isGet = req.method === 'GET';
      const isApi = req.url.startsWith('/api/');
      if (isGet && isHtml && !isApi) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ message: 'Not Found' });
    });
  }
}

async function bootstrap() {
  const app = Fastify({ logger: false });

  // Normalize year inputs (string/number) into a safe number or undefined
  function parseYear(y: any): number | undefined {
    if (y == null) return undefined;
    // avoid literal strings like 'undefined' or empty
    if (typeof y === 'string' && (!y.trim() || y.trim().toLowerCase() === 'undefined')) return undefined;
    const n = Number(y);
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
  }

  // Static + root + SPA fallback
  await registerWeb(app);

  // Optional CORS (idempotent)
  if (process.env.ENABLE_CORS === '1' && !(app as any)._corsRegistered) {
    await app.register(cors, { origin: true });
    (app as any)._corsRegistered = true;
    app.log?.info?.('CORS enabled');
  }

  // Approvals registry
  initApproved();

  // Ensure default config and settings files exist on first run. This creates
  // `/app/config/config.json` and `/app/config/settings.json` (or the paths
  // configured via CONFIG_PATH/SETTINGS_PATH) so the UI and API have a
  // persistent place to read/write from when running in Docker.
  try {
    try {
      const existingLibs = loadLibraries();
      // saveLibraries will create the directory and file if missing
      saveLibraries(existingLibs || []);
      app.log?.info?.('Ensured config/config.json exists');
    } catch (e) {
      app.log?.warn?.(`Could not ensure libraries config: ${String(e)}`);
    }
    try {
      const existingSettings = loadSettings();
      // saveSettings will create the directory and file if missing
      saveSettings(existingSettings || {} as any);
      app.log?.info?.('Ensured config/settings.json exists');
    } catch (e) {
      app.log?.warn?.(`Could not ensure settings config: ${String(e)}`);
    }
  } catch (e) {
    // best-effort, do not fail startup
  }

  // Post-startup housekeeping: remove accidental library named 'Tor' if present
  try {
    try {
      const libs = loadLibraries();
      const filtered = (Array.isArray(libs) ? libs.filter(l => String(l.name || '').trim() !== 'Tor') : libs) || [];
      if (Array.isArray(libs) && filtered.length !== libs.length) {
        saveLibraries(filtered as any);
        log('info', 'Removed accidental library named Tor on startup');
      }
    } catch (e) { /* ignore */ }
  } catch (e) {}

  // Attempt to create symlinks from any configured libraries on startup so the
  // container-host visible mount points are present before the UI/scan runs.
  try {
    try {
      const libs = loadLibraries();
        if (Array.isArray(libs) && libs.length) {
          // symlink creation intentionally removed per user request
        }
    } catch (e) { log('warn', `Startup symlink creation failed: ${String(e)}`); }
  } catch (e) {}

  // guessit support removed; rely on builtin parsing

  const idFromPath = (p: string) => crypto.createHash('sha1').update(p).digest('hex');

  /**
   * Update MR_INPUT_PATH and MR_OUTPUT_PATH in the docker-compose env file.
   * Uses MR_COMPOSE_ENV_FILE env var if set, otherwise falls back to _containers/docker-compose.env
   * This is best-effort: it updates or appends the two variables with the first values found.
   */
  function updateComposeEnvFromLibs(inputRoots: string[], outputRoots: string[]) {
    try {
      // Prefer a saved settings value if present (UI can set this via settings)
      const settings = loadSettings();
      const envFileFromSettings = (settings && (settings as any).composeEnvFile) ? String((settings as any).composeEnvFile) : undefined;
      const envFile = envFileFromSettings || process.env.MR_COMPOSE_ENV_FILE || path.resolve(__dirname, '..', '..', '_containers', 'docker-compose.env');
      if (!fs.existsSync(envFile)) throw new Error(`compose env file not found: ${envFile}`);

      const content = fs.readFileSync(envFile, 'utf8');
      const lines = content.split(/\r?\n/);
      const newLines: string[] = [];
      const setVar = (name: string, value: string | undefined) => `${name}=${value ?? ''}`;

      const wantInput = inputRoots.length ? inputRoots[0] : '';
      const wantOutput = outputRoots.length ? outputRoots[0] : '';

      let foundInput = false;
      let foundOutput = false;
      for (const ln of lines) {
        if (/^MR_INPUT_PATH\s*=/.test(ln)) { foundInput = true; newLines.push(setVar('MR_INPUT_PATH', wantInput)); continue; }
        if (/^MR_OUTPUT_PATH\s*=/.test(ln)) { foundOutput = true; newLines.push(setVar('MR_OUTPUT_PATH', wantOutput)); continue; }
        newLines.push(ln);
      }
      if (!foundInput) newLines.push(setVar('MR_INPUT_PATH', wantInput));
      if (!foundOutput) newLines.push(setVar('MR_OUTPUT_PATH', wantOutput));

      fs.writeFileSync(envFile, newLines.join(os.EOL), 'utf8');
      log('info', `Updated compose env file ${envFile} with MR_INPUT_PATH/MR_OUTPUT_PATH`);
    } catch (e) {
      log('warn', `updateComposeEnvFromLibs failed: ${String(e)}`);
    }
  }

  // symlink helper removed per user request

  // When a file is approved, also try to find sibling files in the same
  // directory that look like the same series/season/episode but differ only
  // by an appended episode title (for example: "Citrus - S01E01" vs "Citrus - S01E01 - love affair!?")
  const escapeRegex = escapeRegexHelper;
  function markSiblingApprovals(original: string, size: number, tvdbId: number, type: 'movie'|'series') {
    try {
      const dir = path.dirname(original);
      const base = path.basename(original);
      const inferred = inferFromPath(original);
      if (!inferred || inferred.kind !== 'series' || inferred.season == null) return;
      const season = inferred.season;
      const episode = (inferred.episodes && inferred.episodes[0]) || inferred.episode_number || (inferred.absolute && inferred.absolute[0]);
      if (episode == null) return;
      // Build a loose regex that matches filenames starting with the same series
      // and the same SxxEyy code, ignoring trailing " - title" differences.
      const titleRoot = inferred.title || '';
      const paddedS = String(season).padStart(2, '0');
      const paddedE = String(episode).padStart(2, '0');
      const escTitle = escapeRegex(titleRoot);
      const re = new RegExp(`^\\s*${escTitle}\\s*-\\s*S${paddedS}E${paddedE}(?:\\b|\\s|\\-).*$`, 'i');
      // Scan directory for matching files
      const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      for (const f of files) {
        try {
          const full = path.join(dir, f);
          if (full === original) continue;
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          if (isApproved(full, st.size)) continue;
          const nameNoExt = path.basename(f, path.extname(f));
          if (re.test(nameNoExt)) {
            markApproved(full, st.size, tvdbId, type, '');
            log('info', `AUTO_APPROVE_SIBLING | tvdbId=${tvdbId} | type=${type} | source="${full}" matched to "${original}"`);
          }
        } catch (e) { /* ignore per-file errors */ }
      }
    } catch (e) {
      // best-effort only
    }
  }

  // Choose a TVDB candidate conservatively: prefer candidates that clearly
  // match the parsed/local title or share the same year or have reasonable
  // token overlap. This avoids adopting unrelated results whose names are
  // superficially similar (e.g. generic titles returned by search).
  const pickTvdbCandidate = pickTvdbCandidateHelper;

  // Normalize plans for preview responses: call the canonical finalizer
  // used during apply so preview paths exactly match the real output.
  const normalizePlansForPreview = normalizePlansForPreviewHelper;

  // Ensure any plan missing a year attempts a TVDB fetch when a tvdbId is present.
  const ensurePlanYears = ensurePlanYearsHelper;

  // API routes
  // Health endpoint for production readiness checks
  app.get('/health', async () => {
    return { status: 'ok', uptime: process.uptime(), now: Date.now() };
  });

  // Graceful shutdown on signals
  process.on('SIGINT', async () => {
    try { app.log?.info?.('SIGINT received, closing server'); } catch {}
    try { await app.close(); } catch {}
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    try { app.log?.info?.('SIGTERM received, closing server'); } catch {}
    try { await app.close(); } catch {}
    process.exit(0);
  });

  app.get('/api/libraries', async () => {
    try {
      const libs = loadLibraries();
      log('info', `Returned ${libs.length} libraries`);
      return libs;
    } catch (e: any) {
      log('error', `Failed to load libraries: ${e?.message ?? String(e)}`);
      throw e;
    }
  });

  app.post('/api/libraries', async (req, reply) => {
    try {
      const body = req.body as Library[];
      saveLibraries(body);
      log('info', `Libraries saved: ${body.map(b => `${b.name}(${b.type})`).join(', ')}`);
      // After saving libraries, update MR_INPUT_PATH / MR_OUTPUT_PATH in compose env
      // After saving libraries, create host-visible symlinks for input/output
      try {
        if (Array.isArray(body) && body.length) {
          const inputRoots = Array.from(new Set(body.map(b => String(b.inputRoot || '').trim()).filter(Boolean)));
          const outputRoots = Array.from(new Set(body.map(b => String((b as any).outputRoot || '').trim()).filter(Boolean)));
          try {
            // symlink creation intentionally removed per user request
          } catch (e) { log('warn', `skipped symlink creation: ${String(e)}`); }
        }
      } catch (e) { log('warn', `Failed to create symlinks after saving libraries: ${String(e)}`); }

      reply.send({ ok: true });
    } catch (e: any) {
      log('error', `Failed to save libraries: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Failed to save libraries' });
    }
  });

  // Delete a library by id
  app.delete('/api/libraries/:id', async (req, reply) => {
    try {
      const params = req.params as any;
      const id = String(params.id || '');
      const libs = loadLibraries();
      const next = (Array.isArray(libs) ? libs.filter(l => l.id !== id) : libs) || [];
      saveLibraries(next as any);
      log('info', `Library deleted: ${id}`);
      return { ok: true, libraries: next };
    } catch (e: any) {
      log('error', `Failed to delete library: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Failed to delete library' });
    }
  });

  // ...no apply-mounts endpoint (host-only override approach preferred)

  app.get('/api/approved', async () => approvedList());

  app.post('/api/scan', async (req, reply) => {
    try {
      const { libraryId } = req.body as { libraryId: string };
    const q = (req.query as any) || {};
    const offset = Math.max(0, Number(q.offset ?? 0));
    const limit = Math.min(500, Math.max(10, Number(q.limit ?? 100)));

    const libs = loadLibraries();
    const lib = libs.find(l => l.id === libraryId);
    if (!lib) {
      log('warn', `Scan requested for unknown library ${libraryId}`);
      reply.status(404).send({ error: 'Library not found' });
      return;
    }

    // Ensure the configured library path exists on this host before scanning.
    try {
      if (!lib.inputRoot || !fs.existsSync(lib.inputRoot)) {
        // Best-effort: try common alternative mount locations inside the container
        // (for example, host path /mnt/sda1/Foo might be mounted at /media/Foo inside
        // the container). If we find a candidate that exists, use it instead.
        const orig = String(lib.inputRoot || '');
        const candidates: string[] = [];
        // Map /mnt/<device>/rest -> /media/rest
        const m = orig.match(/^\/mnt\/[^\/]+\/(.*)$/);
        if (m && m[1]) candidates.push('/media/' + m[1]);
        // If the original is /media/... but not present, try searching /media for
        // a suffix match (e.g., /media/<label>/rest)
        const suffix = orig.replace(/^\/+/, '');
        if (suffix) {
          // build incremental suffix candidates: try shorter suffixes first
          const parts = suffix.split('/');
          for (let i = 1; i <= parts.length; i++) {
            candidates.push('/' + parts.slice(parts.length - i).join('/'));
          }
        }
        // De-duplicate candidates
        const seen = new Set<string>();
        let found: string | undefined;
        for (const c of candidates) {
          if (!c) continue;
          const resolved = path.resolve(c);
          if (seen.has(resolved)) continue;
          seen.add(resolved);
          try {
            if (fs.existsSync(resolved)) { found = resolved; break; }
          } catch (e) { /* ignore */ }
        }
        // If not found yet, try searching under /media for a matching suffix.
        if (!found) {
          try {
            const lastPart = orig.split('/').filter(Boolean).pop() || '';
            if (lastPart && fs.existsSync('/media')) {
              const entries = fs.readdirSync('/media');
              for (const ent of entries) {
                try {
                  const cand = path.join('/media', ent, lastPart);
                  if (fs.existsSync(cand)) { found = path.resolve(cand); break; }
                  // Also try matching deeper suffix of the original path
                  const rest = orig.replace(/^\/+/, '').split('/');
                  for (let i = 1; i <= rest.length && !found; i++) {
                    const suffix2 = rest.slice(rest.length - i).join('/');
                    const cand2 = path.join('/media', ent, suffix2);
                    if (fs.existsSync(cand2)) { found = path.resolve(cand2); break; }
                  }
                } catch (e) { /* ignore per-entry */ }
              }
            }
          } catch (e) { /* ignore */ }
        }
        if (found) {
          log('info', `Scan: original library path ${lib.inputRoot} not found; using candidate ${found}`);
          // mutate lib for this request so scanning continues
          (lib as any).inputRoot = found;
        } else {
          log('error', `Scan failed: library path does not exist or is inaccessible: ${lib.inputRoot}`);
          reply.status(400).send({ error: 'Library path does not exist or is inaccessible on the server. Check that the host path is mounted into the container and permissions allow reading.' });
          return;
        }
      }
    } catch (e: any) {
      log('error', `Scan failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Scan failed' });
      return;
    }

    const patterns = ['**/*.mkv', '**/*.mp4', '**/*.avi', '**/*.mov', '**/*.m4v'];
    const files = await fg(patterns, { cwd: lib.inputRoot, absolute: true, suppressErrors: true });

    const candidates: { path: string; size: number }[] = [];
    for (const f of files) {
      const st = fs.statSync(f);
      if (!st.isFile()) continue;
      if (isApproved(f, st.size)) continue;
      // Normalize path separators to forward slashes for consistent UI behavior
      let normalizedPath = f.replace(/\\+/g, '/');
      // If the configured library was mounted at /media inside the container,
      // allow mapping common host mount prefixes (like /mnt/sda1) to /media for UI clarity.
      try {
        const inRoot = lib.inputRoot || '';
        if (inRoot.startsWith('/media') && normalizedPath.match(/^\/mnt\/[a-z0-9]+\//)) {
          // map /mnt/sdXY/<rest> -> /media/<rest> when the container exposes /media
          const parts = normalizedPath.split('/').slice(3); // remove ['', 'mnt', 'sda1'] -> rest
          normalizedPath = '/media/' + parts.join('/');
        }
      } catch (e) { /* best-effort */ }
      candidates.push({ path: normalizedPath, size: st.size });
    }

  const slice = candidates.slice(offset, offset + limit);
  // Use local inference heuristic
    const items: ScanItem[] = await Promise.all(
      slice.map(async ({ path: f, size }) => {
        const ext = path.extname(f);
        let inferred = inferFromPath(f);
        try {
          // Use local inference only (external GuessIt removed)
          inferred = { ...inferred, confidence: Math.max(inferred.confidence || 0, 6) };
        } catch (e) {
          // ignore
        }
        return { id: idFromPath(f), path: f, size, ext, libraryId, inferred };
      })
    );

    // Apply any cached scan results from server-side scan-cache so we don't re-scan items
    try {
      const SCAN_CACHE_PATH = process.env.SCAN_CACHE_PATH || path.resolve(__dirname, '..', 'config', 'scan-cache.json');
      if (fs.existsSync(SCAN_CACHE_PATH)) {
        try {
          const raw = fs.readFileSync(SCAN_CACHE_PATH, 'utf8') || '{}';
          const parsed = JSON.parse(raw || '{}') || {};
          const libCache = parsed[lib.id] || [];
          if (Array.isArray(libCache) && libCache.length) {
            const byPath = new Map<string, any>();
            for (const it of libCache) {
              try { byPath.set(String(it.path || '').replace(/\\+/g, '/'), it); } catch (e) {}
            }
            // Replace items with cached entries when paths match
            for (let i = 0; i < items.length; i++) {
              try {
                const p = String(items[i].path || '').replace(/\\+/g, '/');
                if (byPath.has(p)) items[i] = byPath.get(p);
              } catch (e) {}
            }
          }
        } catch (e) { /* ignore parse errors */ }
      }
    } catch (e) { /* best-effort */ }

    return {
      items,
      total: candidates.length,
      nextOffset: offset + items.length,
      hasMore: offset + items.length < candidates.length
    };
    } catch (e: any) {
      log('error', `Scan failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Scan failed' });
    }
  });

  app.get('/api/search', async (req) => {
    const q = (req.query as any);
    const type = q.type as MediaType;
    const query = q.q as string;
    const year = q.year ? Number(q.year) : undefined;
    const settings = loadSettings();
    const key = process.env.TVDB_API_KEY || settings.tvdbKey;
    if (!key) {
      // No API key configured; return empty result with a warning so frontend can skip calling TVDB.
      return { data: [], warning: 'TVDB API key not configured' };
    }
    const data = await searchTVDB(type, query, year);
    return { data };
  });

  // Parsing endpoint: returns local heuristic inference for a given path
  app.post('/api/guessit-parse', async (req, reply) => {
    try {
      const { path: p } = req.body as { path: string };
      if (!p) return reply.status(400).send({ error: 'missing path' });
      const inferred = inferFromPath(p);
      return { inferred };
    } catch (e: any) {
      const inferred = inferFromPath((req.body as any)?.path || '');
      return { inferred, error: e?.message ?? 'parse failed' };
    }
  });

  app.get('/api/episode-title', async (req) => {
    const q = (req.query as any);
    const sId = Number(q.seriesId);
    const season = Number(q.season);
    const ep = Number(q.episode);
    const data = await getEpisodeByAiredOrder(sId, season, ep);
    return { title: (data as any)?.name || (data as any)?.episodeName || null };
  });

  app.get('/api/map-absolute', async (req) => {
    const q = (req.query as any);
    const sId = Number(q.seriesId);
    const abs = String(q.abs || '').split(',').map((n: string) => Number(n)).filter(Boolean);
    const data = await mapAbsoluteToAired(sId, abs);
    return { data };
  });

  app.post('/api/preview', async (req, reply) => {
    try {
      const { libraryId, selections } = req.body as {
      libraryId: string;
      selections: Array<{
        item: ScanItem;
        type: MediaType;
        match: { id: number; name: string; year?: number };
        season?: number;
        episodes?: number[];
        episodeTitle?: string;
      }>;
    };

  const libs = loadLibraries();
  const lib = libs.find(l => l.id === libraryId)!;

    // If the client didn't include an episodeTitle, try fetching it from TVDB so
    // planned filenames include the title shown in the UI.
    async function fetchEpisodeTitleIfNeeded(seriesId: number | undefined, season?: number, eps?: number[] | undefined) {
      if (!seriesId) return null;
      const ep = eps && eps.length ? eps[0] : 1;
      try {
        // First, try to look up by the provided season/episode (aired order)
        const data = await getEpisodeByAiredOrder(Number(seriesId), Number(season ?? 1), Number(ep));
        if (data) return (data as any)?.name || (data as any)?.episodeName || null;
        // If not found, maybe the provided episode number was an absolute number.
        // Ask TVDB to map absolute->aired and use the mapped result if available.
        try {
          const mapped = await mapAbsoluteToAired(Number(seriesId), eps && eps.length ? eps : [ep]);
          if (Array.isArray(mapped) && mapped.length && mapped[0]) {
            return mapped[0].title || null;
          }
        } catch (e) {
          // ignore mapping errors
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    const plans: RenamePlan[] = await Promise.all(selections.map(async sel => {
      if (sel.type === 'movie') {
        // Build match candidate and prefer provided year
  let match = { id: sel.match.id, name: sel.match.name, year: parseYear(sel.match.year), type: 'movie' } as any;
        if (!match.year && sel.match.year) match.year = sel.match.year;
        // If the client didn't provide a concrete TVDB id, try a search.
        if (!match.id) {
          try {
            const results = await searchTVDB('movie', sel.match.name, sel.match.year);
            const selc = pickTvdbCandidate(sel.match.name, sel.match.year, results);
            if (selc) match = selc;
          } catch (e) {}
        }
        // If we have a TVDB id, fetch canonical info (name/year) so preview shows
        // the TVDB-updated metadata instead of only the local parsed values.
        if (match.id) {
          try {
            const s = await getSeries(Number(match.id));
            if (s) {
              // Prefer TVDB's canonical name when available
              if (s.name) match.name = s.name;
              const maybe = s?.firstAired || s?.firstAiredAt || s?.releaseDate || s?.released || s?.firstAiredDate
                || (s?.attributes && (s.attributes.firstAired || s.attributes.firstAiredAt || s.attributes.releaseDate || s.attributes.released || s.attributes.firstAiredDate))
                || (s?.data && (s.data.firstAired || s.data.firstAiredAt || s.data.releaseDate || s.data.released || s.data.firstAiredDate));
              const y = maybe ? String(maybe).slice(0,4) : undefined;
              if (y && /^\d{4}$/.test(y)) match.year = Number(y);
            }
          } catch (e) {}
        }
        try { log('debug', `preview: planning movie for ${sel.item.path} with match=${JSON.stringify(match)}`); } catch {}
  // Ensure item has an ext when previewing (clients may send only path)
  // Ensure extension is a safe string (avoid literal 'undefined' showing up)
  sel.item.ext = sel.item.ext ? String(sel.item.ext) : path.extname(sel.item.path) || '';
  if (sel.item.ext && !sel.item.ext.startsWith('.')) sel.item.ext = '.' + sel.item.ext;
  try { log('debug', `preview: item.ext='${sel.item.ext}' path='${sel.item.path}'`); } catch {}
  let pm = planMovie(sel.item, lib, match as any);
        try { log('debug', `preview: planned movie to=${pm.to}`); } catch {}
        // Ensure plan meta has a concrete year before finalizing so finalizePlan
        // can insert the year into metadataTitle/output when possible.
        try {
          if (pm && pm.meta && !pm.meta.year && match.year) pm.meta.year = parseYear(match.year);
        } catch (e) {}
        // Finalize movie plan so preview reflects the same canonicalization
        // (unique path, metadataTitle and year derivation) as apply.
        try {
          const { finalizePlan } = await import('./renamer.js');
          await finalizePlan(pm);
        } catch (e) {}
        if (pm && pm.meta && !pm.meta.year && pm.meta.output) {
          const m = String(pm.meta.output).match(/\((\d{4})\)/);
          if (m) pm.meta.year = Number(m[1]);
        }
        return pm;
      }

      // SERIES
      const season = sel.season ?? 1;
      const eps = sel.episodes && sel.episodes.length ? sel.episodes : [1];
      // episode title: prefer selection -> inferred -> TVDB -> local parse
      let title: string | undefined = sel.episodeTitle;
      if (!title && sel.item && (sel.item.inferred as any)) {
        const infAny = sel.item.inferred as any;
        if (infAny.episode_title) title = infAny.episode_title;
      }
      if (!title) title = await fetchEpisodeTitleIfNeeded(sel.match.id, season, eps);
      if (!title) {
        try {
          const local = inferFromPath(sel.item.path);
          if (local && (local as any).episode_title) title = (local as any).episode_title;
        } catch (e) {}
      }

  let match = { id: sel.match.id, name: sel.match.name, year: parseYear(sel.match.year), type: 'series' } as any;
      if (!match.id) {
        if (!match.year && sel.match.year) match.year = sel.match.year;
        try {
          const results = await searchTVDB('series', sel.match.name, sel.match.year);
          const selc = pickTvdbCandidate(sel.match.name, sel.match.year, results);
          if (selc) {
            match = selc;
            if (!match.year) match.year = sel.match.year ?? undefined;
          }
        } catch (e) {}
      }
      if (!match.year && match.id) {
        try {
          const s = await getSeries(Number(match.id));
          const maybe = s?.firstAired || s?.firstAiredAt || s?.releaseDate || s?.released || s?.firstAiredDate
            || (s?.attributes && (s.attributes.firstAired || s.attributes.firstAiredAt || s.attributes.releaseDate || s.attributes.released || s.attributes.firstAiredDate))
            || (s?.data && (s.data.firstAired || s.data.firstAiredAt || s.data.releaseDate || s.data.released || s.data.firstAiredDate));
          const y = maybe ? String(maybe).slice(0,4) : undefined;
          if (y && /^\d{4}$/.test(y)) match.year = Number(y);
        } catch (e) {}
      }

      // Also prefer TVDB's canonical series name when we have an id
      if (match.id) {
        try {
          const s2 = await getSeries(Number(match.id));
          if (s2 && s2.name) match.name = s2.name;
        } catch (e) {}
      }
      if (!match.year) match.year = sel.match?.year ?? undefined;

      try { log('debug', `preview: planning episode for ${sel.item.path} with match=${JSON.stringify(match)} season=${season} eps=${eps.join(',')} title=${title}`); } catch {}
  sel.item.ext = sel.item.ext ? String(sel.item.ext) : path.extname(sel.item.path) || '';
  if (sel.item.ext && !sel.item.ext.startsWith('.')) sel.item.ext = '.' + sel.item.ext;
  try { log('debug', `preview: item.ext='${sel.item.ext}' path='${sel.item.path}' season=${season} eps=${eps.join(',')}`); } catch {}
  const pe = planEpisode(sel.item, lib, match as any, season, eps, title);
      try { log('debug', `preview: planned episode to=${pe.to}`); } catch {}
      try { 
        // Ensure year present on plan meta before finalization so finalizePlan
        // can insert it into metadataTitle/output.
        if (pe && pe.meta && !pe.meta.year && match.year) pe.meta.year = parseYear(match.year);
      } catch (e) {}
      try { const { finalizePlan } = await import('./renamer.js'); await finalizePlan(pe); } catch (e) {}
  if (pe && pe.meta && !pe.meta.year && pe.meta.output) {
        const m = String(pe.meta.output).match(/\((\d{4})\)/);
        if (m) pe.meta.year = Number(m[1]);
      }
      return pe;
    }));
  // Normalize all plans for preview so metadataTitle/output include inserted year
  try {
    await ensurePlanYears(plans as any);
    await normalizePlansForPreview(plans as any);
  } catch (e) {}

  return { plans };
    } catch (e: any) {
      log('error', `Preview failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Preview failed' });
    }
  });

  // Auto-preview using local parsing heuristics (no TVDB lookup).
  app.post('/api/auto-preview', async (req, reply) => {
  
    try {
      const { libraryId, item, minConfidence = 3 } = req.body as any;
      const libs = loadLibraries();
      const lib = libs.find(l => l.id === libraryId);
      if (!lib) {
        log('warn', `Auto-preview requested for unknown library ${libraryId}`);
        reply.status(404).send({ error: 'Library not found' });
        return;
      }

  // Prefer any inference the client already attached (from scan/guessit) so
  // we don't lose guessed episode titles. Fall back to local inference when
  // no client-provided inferred object exists.
  const inferred = item?.inferred ?? inferFromPath(item.path);
    // require a minimal confidence to auto-generate plans
    if (!inferred || inferred.confidence < Number(minConfidence)) {
      return { plans: [], inferred };
    }

    // Build a fake MatchCandidate from inferred data
    if (inferred.kind === 'movie' && inferred.title) {
  let cand: any = { id: 0, name: inferred.title, year: parseYear(inferred.year), type: 'movie' };
      try {
        const results = await searchTVDB('movie', inferred.title || '', inferred.year);
        if (Array.isArray(results) && results.length) cand = results[0];
  // preserve inferred year if TVDB result lacks it
  if (!cand.year && inferred.year) cand.year = inferred.year;
      } catch (e) {}
  // If we have a TVDB id, fetch canonical info so preview reflects TVDB metadata
  if (cand.id) {
    try {
      const s = await getSeries(Number(cand.id));
      if (s && s.name) cand.name = s.name;
      const maybe = s?.firstAired || s?.firstAiredAt || s?.releaseDate || s?.released || s?.firstAiredDate
        || (s?.attributes && (s.attributes.firstAired || s.attributes.firstAiredAt || s.attributes.releaseDate || s.attributes.released || s.attributes.firstAiredDate))
        || (s?.data && (s.data.firstAired || s.data.firstAiredAt || s.data.releaseDate || s.data.released || s.data.firstAiredDate));
      const y = maybe ? String(maybe).slice(0,4) : undefined;
      if (y && /^\d{4}$/.test(y)) cand.year = Number(y);
    } catch (e) {}
  }
  if (!item.ext) item.ext = path.extname(item.path) || '';
  try { log('debug', `auto-preview movie: item.ext='${item.ext}' path='${item.path}'`); } catch {}
  const plan = planMovie(item, lib, cand);
  try {
    // Ensure plan meta has the candidate year before finalization
    if (plan && plan.meta && !plan.meta.year && cand && cand.year) plan.meta.year = parseYear(cand.year);
    const { finalizePlan } = await import('./renamer.js');
    await finalizePlan(plan);
  } catch (e) {}
  try { await ensurePlanYears([plan]); } catch (e) {}
  await normalizePlansForPreview([plan]);
  return { plans: [plan], inferred };
    }

    if (inferred.kind === 'series' && inferred.title) {
  let cand: any = { id: 0, name: inferred.title, year: parseYear(inferred.year), type: 'series' };
  const season = inferred.season ?? 1;
      const eps = inferred.episodes && inferred.episodes.length ? inferred.episodes : (inferred.absolute && inferred.absolute.length ? inferred.absolute : [1]);
      // Prefer any episode title already present on the inferred object.
      // If not present, we'll rely on TVDB lookups when a concrete series id is known.
      let title: string | undefined = undefined;
      const infAny = inferred as any;
      if (infAny?.episode_title) {
        title = infAny.episode_title;
      }
      try {
        const results = await searchTVDB('series', inferred.title || '', inferred.year);
        if (Array.isArray(results) && results.length) cand = results[0];
        // preserve inferred year if TVDB result lacks it
        if (!cand.year && inferred.year) cand.year = inferred.year;
      } catch (e) {}
  // If TVDB provided an id, fetch canonical series info to enrich name/year
  if (cand.id) {
    try {
      const s = await getSeries(Number(cand.id));
      if (s && s.name) cand.name = s.name;
      const maybe = s?.firstAired || s?.firstAiredAt || s?.releaseDate || s?.released || s?.firstAiredDate
        || (s?.attributes && (s.attributes.firstAired || s.attributes.firstAiredAt || s.attributes.releaseDate || s.attributes.released || s.attributes.firstAiredDate))
        || (s?.data && (s.data.firstAired || s.data.firstAiredAt || s.data.releaseDate || s.data.released || s.data.firstAiredDate));
      const y = maybe ? String(maybe).slice(0,4) : undefined;
      if (y && /^\d{4}$/.test(y)) cand.year = Number(y);
    } catch (e) {}
  }
  try { if (!item.ext) item.ext = path.extname(item.path) || ''; log('debug', `auto-preview episode: item.ext='${item.ext}' path='${item.path}' season=${season} eps=${eps.join(',')}`); } catch {}
  const plan = planEpisode(item, lib, cand, season as number, eps as number[], title);
  try {
  // Ensure plan meta has the candidate year before finalization
  if (plan && plan.meta && !plan.meta.year && cand && cand.year) plan.meta.year = parseYear(cand.year);
  const { finalizePlan } = await import('./renamer.js');
  await finalizePlan(plan);
  } catch (e) {}
  await normalizePlansForPreview([plan]);
  return { plans: [plan], inferred };
    }

  try { await ensurePlanYears([]); } catch (e) {}
  await normalizePlansForPreview([]);
  return { plans: [], inferred };
    } catch (e: any) {
      log('error', `Auto preview failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Auto preview failed' });
    }
  });

  app.post('/api/rename', async (req, reply) => {
    try {
      const { plans, libraryId } = req.body as { plans: RenamePlan[]; libraryId: string };
      const lib = loadLibraries().find(l => l.id === libraryId)!;
      plans.forEach(p => (p.dryRun = false));
      const { results } = applyPlans(plans, !!lib.allowCopyFallback);
      for (const p of plans) {
        try {
          const st = fs.statSync(p.from);
          markApproved(p.from, st.size, p.meta.tvdbId, p.meta.type, p.to);
          // Also try to auto-mark sibling metadata files that represent the same ep
          try { markSiblingApprovals(p.from, st.size, p.meta.tvdbId, p.meta.type); } catch (e) {}
          log('info', `APPROVED | tvdbId=${p.meta.tvdbId} | type=${p.meta.type} | output="${p.to}" | source="${p.from}"`);
        } catch (e: any) {
          log('warn', `Approval mark failed for ${p.from}: ${(e as Error).message}`);
        }
      }
      reply.send({ ok: true, count: results.length });
    } catch (e: any) {
      log('error', `Rename failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Rename failed' });
    }
  });

  // Approve manually (persist TVDB id and type for a file without performing rename)
  app.post('/api/approve-manual', async (req, reply) => {
    try {
      const { libraryId, path: filePath, tvdbId, type } = req.body as { libraryId: string; path: string; tvdbId: number; type: 'movie'|'series' };
      if (!filePath) return reply.status(400).send({ error: 'missing path' });
      const libs = loadLibraries();
      const lib = libs.find(l => l.id === libraryId);
      // get size
      const st = fs.statSync(filePath);
  // output is left blank as no rename performed
  markApproved(filePath, st.size, Number(tvdbId) || 0, type, '');
  try { markSiblingApprovals(filePath, st.size, Number(tvdbId) || 0, type); } catch (e) {}
  log('info', `MANUAL_APPROVE | tvdbId=${tvdbId} | type=${type} | source="${filePath}"`);
      return { ok: true };
    } catch (e: any) {
      log('error', `Manual approve failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Manual approve failed' });
    }
  });

  // Remove last N approved entries (undo)
  app.post('/api/unapprove-last', async (req, reply) => {
    try {
      const { n } = req.body as { n?: number };
      const count = Math.max(0, Number(n ?? 10));
      // call into approved module
      const removed = unapproveLast(count);
      log('info', `UNAPPROVE_LAST | removed=${removed.length}`);
      return { removed };
    } catch (e: any) {
      log('error', `Unapprove last failed: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Unapprove failed' });
    }
  });

  app.get('/api/settings', async () => {
    try {
      const s = loadSettings();
      log('info', 'Settings fetched');
      return s;
    } catch (e: any) {
      log('error', `Failed to load settings: ${e?.message ?? String(e)}`);
      return {};
    }
  });

  app.post('/api/settings', async (req, reply) => {
    try {
      const body = req.body as any;
      const current = loadSettings();
  const next = { ...current, ...body };
      // Determine the previous (effective) key and the new key. Treat empty/null as "no key".
      const prevKey = (process.env.TVDB_API_KEY && String(process.env.TVDB_API_KEY)) || (current.tvdbKey && String(current.tvdbKey)) || '';
      const newKey = next.tvdbKey != null ? String(next.tvdbKey) : '';

  // Persist merged settings first (we want saves to always persist)
  const prevSettings = loadSettings();
  saveSettings(next);

  // If the user set a composeEnvFile in settings, activate it in the running process
  try {
    const prevCompose = (prevSettings && (prevSettings as any).composeEnvFile) ? String((prevSettings as any).composeEnvFile) : '';
    const newCompose = (next && (next as any).composeEnvFile) ? String((next as any).composeEnvFile) : '';
    if (newCompose && newCompose !== prevCompose) {
      process.env.MR_COMPOSE_ENV_FILE = newCompose;
      log('info', `Activated compose env file from settings: ${newCompose}`);
    }
  } catch (e) { /* ignore */ }

  // guessit removed; nothing to apply

      // If the user cleared the key, immediately remove the active env var and invalidate token.
      if (!newKey && prevKey) {
        delete process.env.TVDB_API_KEY;
        invalidateTVDBToken();
        log('info', 'TVDB API key removed by user');
      } else if (newKey) {
        // If there was already a non-empty previous key, require the user to explicitly
        // delete it first before activating a new value. This prevents accidental
        // switching and matches the requested delete-then-enter workflow.
        if (prevKey) {
          // Do not activate the new key yet; inform via logs. The new key is stored in settings
          // but won't be used until the user clears the key and saves (delete + save), then
          // re-enters and saves.
          log('info', 'New TVDB API key saved to settings but not activated because an existing key is present; clear the key and save to activate.');
        } else {
          // No previous key -> activate new key immediately
          process.env.TVDB_API_KEY = newKey;
          invalidateTVDBToken();
          log('info', 'TVDB API key activated');
        }
      }
  log('info', 'Settings saved');
  // If port changed in settings, inform caller that restart is required
  const prevPort = prevSettings.port || Number(process.env.PORT || 0);
  const newPort = next.port || Number(process.env.PORT || 0);
  const restartRequired = prevPort !== newPort;
  reply.send({ ok: true, restartRequired });
    } catch (e: any) {
      log('error', `Failed to save settings: ${e?.message ?? String(e)}`);
      reply.status(500).send({ error: 'Failed to save settings' });
    }
  });

  // SSE logs
  app.get('/api/logs/stream', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    let cursor = 0;
    const tick = () => {
      const entries = getLogs();
      if (cursor < entries.length) {
        for (let i = cursor; i < entries.length; i++) {
          reply.raw.write(`event: log\ndata: ${JSON.stringify(entries[i])}\n\n`);
        }
        cursor = entries.length;
      }
    };
    const timer = setInterval(tick, 1000);
    req.raw.on('close', () => clearInterval(timer));
  });

  // Plain logs fetch (non-stream) used by UI
  app.get('/api/logs', async () => {
    try {
      return getLogs();
    } catch (e) {
      return [];
    }
  });

  // Get/set runtime log level for UI control
  app.get('/api/loglevel', async () => {
    try {
      const { getLogLevel } = await import('./logging.js');
      return { level: getLogLevel() };
    } catch (e) { return { level: 'info' }; }
  });
  app.post('/api/loglevel', async (req, reply) => {
    try {
      const body = req.body as { level?: string };
      const lvl = (body && String(body.level || '').toLowerCase()) as any;
    if (!['info','warn','error','debug'].includes(lvl)) return reply.status(400).send({ error: 'invalid level' });
    const { setLogLevel } = await import('./logging.js');
    setLogLevel(lvl);
    return { ok: true, level: lvl };
    } catch (e) { reply.status(500).send({ error: 'failed' }); }
  });

  // Scan-cache file endpoints: persist scan results to disk so the UI can
  // restore them across navigation and server restarts. Path may be overridden
  // with SCAN_CACHE_PATH env var (useful for Docker setups).
  const SCAN_CACHE_PATH = process.env.SCAN_CACHE_PATH || path.resolve(__dirname, '..', 'config', 'scan-cache.json');

  app.get('/api/scan-cache', async () => {
    try {
      if (!fs.existsSync(SCAN_CACHE_PATH)) return {};
      const raw = fs.readFileSync(SCAN_CACHE_PATH, 'utf8') || '{}';
      try { return JSON.parse(raw); } catch { return {}; }
    } catch (e) {
      return {};
    }
  });

  // POST merges incoming scanned items into existing cache (by normalized path)
  app.post('/api/scan-cache', async (req, reply) => {
    try {
      const incoming: any = req.body || {};
      fs.mkdirSync(path.dirname(SCAN_CACHE_PATH), { recursive: true });
      let existing: Record<string, any> = {};
      try {
        if (fs.existsSync(SCAN_CACHE_PATH)) {
          const raw = fs.readFileSync(SCAN_CACHE_PATH, 'utf8') || '{}';
          existing = JSON.parse(raw) || {};
        }
      } catch (e) { existing = {}; }

  const normalize = (p: string) => normalizePathForCache(String(p || ''));

      // If incoming is a map of libId->items (most common), merge per-library
      for (const libId of Object.keys(incoming || {})) {
        const arr = incoming[libId];
        if (!Array.isArray(arr)) continue;
        existing[libId] = existing[libId] || [];
        const byPath = new Map<string, any>();
        for (const it of existing[libId]) {
          try { byPath.set(normalize(it.path), it); } catch (e) {}
        }
        for (const it of arr) {
          try {
            const np = normalize(it.path);
            byPath.set(np, it);
          } catch (e) {}
        }
        existing[libId] = Array.from(byPath.values());
      }

      // Also accept a flat map of path->item (e.g., scannedUpdates) and merge
      if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        // check if keys look like normalized paths (contain / or \)
        const keys = Object.keys(incoming);
        const looksLikePathMap = keys.length && keys.every(k => typeof k === 'string' && (k.indexOf('/') !== -1 || k.indexOf('\\') !== -1));
        if (looksLikePathMap) {
          // merge each item into its declared lib if present, otherwise into '__unassigned'
          for (const k of keys) {
            try {
              const it = incoming[k];
              const np = normalize(k);
              const libId = String(it?.libraryId || it?.libId || it?.library || '__unassigned');
              existing[libId] = existing[libId] || [];
              const idx = existing[libId].findIndex((x:any) => normalize(x.path) === np);
              if (idx >= 0) existing[libId][idx] = it;
              else existing[libId].push(it);
            } catch (e) {}
          }
        }
      }

      fs.writeFileSync(SCAN_CACHE_PATH, JSON.stringify(existing || {}, null, 2), 'utf8');
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(500).send({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/scan-cache', async () => {
    try {
      if (fs.existsSync(SCAN_CACHE_PATH)) fs.unlinkSync(SCAN_CACHE_PATH);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Effective port: environment overrides persisted settings; otherwise use settings.port if set
  const persistedSettings = loadSettings();
  const envPort = Number(process.env.PORT || 0);
  const port = envPort || Number(persistedSettings.port || 0) || 8080;
  try { log('info', `Effective port: ${port} (envPort=${envPort || 'none'}, settings.port=${persistedSettings.port || 'none'})`); } catch {}
  app
    .listen({ port, host: '0.0.0.0' })
    .then(() => {
  log('info', `Server listening on ${port}`);
  try { console.info(`Server listening on ${port}`); } catch (e) { }
    })
    .catch(err => {
      app.log.error(err);
      process.exit(1);
    });
}

bootstrap().catch(err => {
  try { log('error', String(err)); } catch {}
  process.exit(1);
});