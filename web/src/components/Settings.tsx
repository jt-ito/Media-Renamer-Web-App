import { useEffect, useMemo, useRef, useState } from 'react';

type SettingsData = {
  libraryPath: string;
  outputPath: string;
  naming: {
    movie: string;
    series: string;
  };
  tvdbKey?: string;
  tvdbLanguage?: string;
  port?: number;
};

const LS_KEY = 'app.settings';

// Defaults you’ve established
const DEFAULT_MOVIE_SCHEME =
  '{title}{year? " (" + year + ")" : ""}/{title}{year? " (" + year + ")" : ""}{ext}';
const DEFAULT_SERIES_SCHEME =
  '{series}/Season {season:02}/{series} - S{season:02}E{episode:02}{title? " - " + title : ""}{ext}';

function loadLocal(): SettingsData | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SettingsData) : null;
  } catch {
    return null;
  }
}

function saveLocal(data: SettingsData) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}

export function Settings() {
  const [initial, setInitial] = useState<SettingsData | null>(null);
  const [libraryPath, setLibraryPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [movieScheme, setMovieScheme] = useState(DEFAULT_MOVIE_SCHEME);
  const [seriesScheme, setSeriesScheme] = useState(DEFAULT_SERIES_SCHEME);
  const [tvdbKey, setTvdbKey] = useState('');
  const [tvdbLanguage, setTvdbLanguage] = useState('en');
  const [showTvdbKey, setShowTvdbKey] = useState(false);
  const [port, setPort] = useState<number | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  // Unapprove UI state
  const [unapproveCount, setUnapproveCount] = useState<number>(10);
  const [unapproveResult, setUnapproveResult] = useState<string | null>(null);


  // Preview / test state
  const [sampleType, setSampleType] = useState<'movie' | 'series'>('movie');
  const [sample, setSample] = useState<any>({
    title: 'The Matrix',
    year: 1999,
    series: 'Friends',
    season: 1,
    episode: 1,
    ext: '.mkv',
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    (async () => {
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = (await res.json()) as Partial<SettingsData>;
  const merged: SettingsData = {
            libraryPath: data.libraryPath ?? '',
            outputPath: data.outputPath ?? '',
            naming: {
              movie: data.naming?.movie ?? DEFAULT_MOVIE_SCHEME,
              series: data.naming?.series ?? DEFAULT_SERIES_SCHEME,
            },
    tvdbKey: data.tvdbKey ?? '',
    // server may store preferred language under tvdbLanguage
    // we'll surface it in the UI as 'tvdbLanguage'
    // default to 'en' when not provided
    tvdbLanguage: (data as any).tvdbLanguage ?? 'en',
            port: data.port
          };
          if (!abort) {
            setInitial(merged);
            setLibraryPath(merged.libraryPath);
            setOutputPath(merged.outputPath);
            setMovieScheme(merged.naming.movie);
            setSeriesScheme(merged.naming.series);
          setTvdbKey(merged.tvdbKey ?? '');
            setTvdbLanguage((merged as any).tvdbLanguage ?? 'en');
            setPort(merged.port as number | undefined);
              }
          saveLocal(merged);
        } else {
          const local = loadLocal();
          const merged: SettingsData =
            local ?? { libraryPath: '', outputPath: '', naming: { movie: DEFAULT_MOVIE_SCHEME, series: DEFAULT_SERIES_SCHEME }, tvdbKey: '', port: undefined };
          if (!abort) {
            setInitial(merged);
            setLibraryPath(merged.libraryPath);
            setOutputPath(merged.outputPath);
            setMovieScheme(merged.naming.movie);
            setSeriesScheme(merged.naming.series);
            setTvdbKey(merged.tvdbKey ?? '');
            setTvdbLanguage((merged as any).tvdbLanguage ?? 'en');
            setPort(merged.port as number | undefined);
          }
        }
      } catch (e: any) {
        const local = loadLocal();
        const merged: SettingsData =
          local ?? { libraryPath: '', outputPath: '', naming: { movie: DEFAULT_MOVIE_SCHEME, series: DEFAULT_SERIES_SCHEME }, tvdbKey: '', port: undefined };
        if (!abort) {
          setInitial(merged);
          setLibraryPath(merged.libraryPath);
          setOutputPath(merged.outputPath);
          setMovieScheme(merged.naming.movie);
          setSeriesScheme(merged.naming.series);
          setTvdbKey(merged.tvdbKey ?? '');
          setPort(merged.port as number | undefined);
          setError(e?.message ?? 'Failed to load settings');
        }
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, []);

  const current: SettingsData = useMemo(
    () => ({
      libraryPath,
      outputPath,
  naming: { movie: movieScheme, series: seriesScheme },
  tvdbKey: tvdbKey,
  // include tvdbLanguage in the payload
  tvdbLanguage: tvdbLanguage,
  port: port,
    }),
  [libraryPath, outputPath, movieScheme, seriesScheme, tvdbKey, tvdbLanguage, port]
  );
  

  const isDirty = useMemo(() => {
    // If initial settings aren't loaded (first load failed or still loading),
    // consider the form dirty when the current values differ from the empty/default state
  if (!initial) {
      const defaults: SettingsData = {
        libraryPath: '',
        outputPath: '',
        naming: { movie: DEFAULT_MOVIE_SCHEME, series: DEFAULT_SERIES_SCHEME },
    tvdbKey: ''
      };
      return (
        defaults.libraryPath !== libraryPath ||
        defaults.outputPath !== outputPath ||
        defaults.naming.movie !== movieScheme ||
        defaults.naming.series !== seriesScheme ||
    (defaults.tvdbKey ?? '') !== (tvdbKey ?? '') ||
    (defaults.port ?? undefined) !== (port ?? undefined)
      );
    }
    return (
      initial.libraryPath !== libraryPath ||
      initial.outputPath !== outputPath ||
      initial.naming.movie !== movieScheme ||
      initial.naming.series !== seriesScheme ||
    (initial.tvdbKey ?? '') !== (tvdbKey ?? '') ||
    (initial.port ?? undefined) !== (port ?? undefined)
    );
  }, [initial, libraryPath, outputPath, movieScheme, seriesScheme, tvdbKey, port]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);

      const js = await res.json().catch(() => null);
      setInitial(current);
      saveLocal(current);
      setStatus('Settings saved');
      // server may indicate restart required when certain settings (like port) changed
      if (js && (js.restartRequired === true || js.restartRequired === false)) {
        setRestartRequired(js.restartRequired === true);
      }
      // After saving settings, ensure there's a library configured for the provided libraryPath
      (async () => {
        try {
          if (!libraryPath || !libraryPath.trim()) return;
          // load existing libraries
          const listRes = await fetch('/api/libraries');
          if (!listRes.ok) return;
          const libs = await listRes.json();
          const exists = Array.isArray(libs) && libs.some((l: any) => (l.inputRoot || l.path || l.libraryPath) === libraryPath || l.inputRoot === libraryPath);
          if (exists) return;

          // create a simple library object from the settings
          // normalize by trimming trailing slashes/backslashes then split on either separator
          const trimmed = libraryPath.replace(/[\\/]+$/g, '');
          const parts = trimmed.split(/[\\/]+/).filter(Boolean);
          const name = parts.length ? parts[parts.length - 1] : 'Library';
          const newLib = {
            id: 'lib-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            name,
            type: 'movie',
            inputRoot: libraryPath,
            outputRoot: outputPath || (libraryPath + (libraryPath.endsWith('\\') ? '' : '\\') + 'output')
          };

          const next = Array.isArray(libs) ? [...libs, newLib] : [newLib];
          await fetch('/api/libraries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
        } catch (e) {
          // ignore; library creation is convenience only
        }
      })();
    } catch (e: any) {
      saveLocal(current);
      setInitial(current);
      setStatus('Saved locally (server unavailable)');
      setError(e?.message ?? 'Failed to save to server');
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(null), 2500);
    }
  };

  const resetDefaults = () => {
    setMovieScheme(DEFAULT_MOVIE_SCHEME);
    setSeriesScheme(DEFAULT_SERIES_SCHEME);
  setTvdbKey('');
  // Clear configured paths when resetting defaults
  setLibraryPath('');
  setOutputPath('');
  };


  // Simple client-side validation for paths (best-effort)
  function validatePath(p: string) {
  // Allow empty paths (the settings form may intentionally leave paths blank).
  // Only validate when a non-empty path is provided.
  if (!p || !p.trim()) return null;
  // Allow both POSIX and Windows-style paths. Reject characters that are never valid in file paths,
  // but allow a single ':' when used as a Windows drive letter (e.g. C:\\path) and allow UNC prefixes \\server\share
  const trimmed = p.trim();
  const isWindowsDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  const isUnc = /^\\\\[^\\]+\\/.test(trimmed);
  // Characters that are invalid in both OSes except colon which is allowed for drive-letter form
  const hasBad = /[<>"|?*]/.test(trimmed) || (trimmed.includes(':') && !isWindowsDrive && !isUnc);
  if (hasBad) return 'Path contains invalid characters: <>:"|?* (colon is allowed for Windows drive letters like C:\\)';
    // length check
    if (p.length > 260) return 'Path is too long';
    return null;
  }

  // Compile template using a sandboxed new Function with provided context.
  // This is a best-effort client-side preview for authors; real rendering is done server-side.
  function renderTemplate(template: string, ctx: Record<string, any>) {
    // Safer replacement: parse tokens and evaluate each expression against the provided context.
    try {
      const keys = Object.keys(ctx);
      const vals = Object.values(ctx);

      // Validate braces are balanced in a simple way
      let open = 0;
      for (let i = 0; i < template.length; i++) {
        if (template[i] === '{') open++;
        else if (template[i] === '}') open--;
        if (open < 0) throw new Error('Template syntax error: unexpected }');
      }
      if (open !== 0) throw new Error('Template syntax error: missing } in template expression');

      // Replace tokens sequentially
      const out = template.replace(/\{([^}]+)\}/g, (_m, inner) => {
        inner = inner.trim();
        // Padding shorthand: name:02
        const padMatch = inner.match(/^(\w+):0?(\d+)$/);
        if (padMatch) {
          const name = padMatch[1];
          const digits = parseInt(padMatch[2], 10);
          const val = ctx[name];
          return String(val ?? '').padStart(digits, '0');
        }

        // Otherwise evaluate the inner expression in the context of the keys
        try {
          // eslint-disable-next-line no-new-func
          const fn = new Function(...keys, 'return (' + inner + ');');
          const res = fn(...vals);
          return res == null ? '' : String(res);
        } catch (e: any) {
          // Surface a friendly error indicating which token failed
          throw new Error('Failed to evaluate {' + inner + '}: ' + (e?.message || 'error'));
        }
      });

      return out;
    } catch (e: any) {
      const msg = (e?.message || 'Template evaluation failed').toString();
      if (msg.includes('missing }')) throw new Error('Template syntax error: missing } in template expression');
      throw new Error(msg);
    }
  }

  function buildContext(type: 'movie' | 'series') {
    // Ensure year is explicitly included in the context
    return {
      title: sample.title,
      year: sample.year || 'Unknown Year', // Fallback if year is missing
      series: sample.series,
      season: sample.season,
      episode: sample.episode,
      ext: sample.ext,
      libraryName: 'My Library',
      libraryType: type === 'movie' ? 'movie' : 'series',
      sourcePath: '/path/to/source',
      inputRoot: '/path/to',
    } as Record<string, any>;
  }

  // Live preview effect
  useEffect(() => {
    let cancelled = false;
    setPreviewError(null);
    (async () => {
      try {
        const ctx = buildContext(sampleType);
        console.log('Context for rendering:', ctx);

        // First try server-side preview
        const serverOut = await serverPreviewSample(ctx);
        if (!cancelled && serverOut) {
          setPreview(serverOut);
          return;
        }

        // If no server or server failed, use client-side plan/finalize for exact match
        if (!cancelled && ctx.series) {
          try {
            const libOutputRoot = outputPath || (libraryPath || '') || '<output_path_placeholder>';
            const libInputRoot = libraryPath || undefined;
            const seriesMatch = { id: (ctx.tvdbId as number) || undefined, name: ctx.series, year: typeof ctx.year === 'number' ? ctx.year : (ctx.year ? Number(ctx.year) : undefined) };
            const plan = planEpisodeClient(ctx.sourcePath || '/path/to', libOutputRoot, libInputRoot, seriesMatch, ctx.season || 1, [ctx.episode || 1], ctx.title || undefined);
            const finalized = finalizePlanClient(plan);
            if (finalized && finalized.to) {
              setPreview(finalized.to);
              return;
            }
          } catch (e) {
            console.debug('client finalize failed', e);
          }
        }

        // Fallback to template rendering
        if (!cancelled) {
          const tpl = sampleType === 'movie' ? movieScheme : seriesScheme;
          const out = renderTemplate(tpl, ctx);
          console.log('Generated preview:', out);
          setPreview(out);
        }
      } catch (e: any) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(e?.message ?? 'Preview failed');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [movieScheme, seriesScheme, sample, sampleType, libraryPath, outputPath]);

  const runTest = () => {
    setPreviewError(null);
    try {
      const ctx = buildContext(sampleType);
      const tpl = sampleType === 'movie' ? movieScheme : seriesScheme;
      const out = renderTemplate(tpl, ctx);
      setPreview(out);
      setPreviewError(null);
    } catch (e: any) {
      setPreview(null);
      setPreviewError(e?.message ?? 'Test failed');
    }
  };

  async function pickFolder(kind: 'lib' | 'out') {
    // Prefer showDirectoryPicker where available (does NOT upload files)
    try {
      const anyWin = window as any;
      if (anyWin && typeof anyWin.showDirectoryPicker === 'function') {
        const handle = await anyWin.showDirectoryPicker();
        const name = handle?.name || '';
        if (kind === 'lib') setLibraryPath(name);
        else setOutputPath(name);
        return;
      }
    } catch (e) {
      // ignore; fall back to prompt
    }

    // Fallback: open a single-file picker so the user can browse to the desired folder
    // We won't upload files; we only infer folder name if possible and then clear the input.
    if (kind === 'lib') filePickerSingleLibRef.current?.click();
    else filePickerSingleOutRef.current?.click();
  }

  const filePickerSingleLibRef = useRef<HTMLInputElement | null>(null);
  const filePickerSingleOutRef = useRef<HTMLInputElement | null>(null);

  function onSingleFilePicked(kind: 'lib' | 'out', files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0] as any;
    const rel = f.webkitRelativePath as string | undefined;
    let inferred = '';
    if (rel && rel.includes('/')) inferred = rel.split('/')[0];
    else inferred = f.name || '';

    // If we couldn't infer a folder, or the inferred value looks like a filename, ask the user to confirm
    const suggested = inferred;
    const value = window.prompt('Confirm folder name or enter full path to save on the server:', suggested) || '';
    if (value) {
      if (kind === 'lib') setLibraryPath(value);
      else setOutputPath(value);
    }

    try {
      if (kind === 'lib' && filePickerSingleLibRef.current) filePickerSingleLibRef.current.value = '';
      if (kind === 'out' && filePickerSingleOutRef.current) filePickerSingleOutRef.current.value = '';
    } catch {}
  }

  useEffect(() => {
    // Simulate fetching TVDB data and updating the sample dynamically
    const fetchTVDBData = async () => {
      try {
        // Simulated TVDB response
        const tvdbData = {
          series: 'Citrus',
          year: 2018,
          season: 1,
          episode: 1,
          title: 'Love Affair!',
          ext: '.mkv',
        };

        // Update the sample with TVDB data
        setSample({
          title: tvdbData.title,
          year: tvdbData.year,
          series: tvdbData.series,
          season: tvdbData.season,
          episode: tvdbData.episode,
          ext: tvdbData.ext,
        });
      } catch (error) {
        console.error('Failed to fetch TVDB data:', error);
      }
    };

    fetchTVDBData();
  }, []);

  async function serverPreviewSample(ctx: Record<string, any>) {
    try {
      // Determine a libraryId to use: fetch libraries and pick the first one
      const libsRes = await fetch('/api/libraries');
      if (!libsRes.ok) throw new Error('Failed to load libraries');
      const libs = await libsRes.json();
      if (!Array.isArray(libs) || libs.length === 0) throw new Error('No libraries configured');
      const libId = libs[0].id;

      // Build a minimal ScanItem to match server expectations
      const item = {
        id: 'preview-sample',
        path: ctx.sourcePath || '/path/to/source',
        ext: ctx.ext || '.mkv',
        size: 0,
        inferred: { title: ctx.title, year: ctx.year, season: ctx.season, episode: ctx.episode }
      };

      const selections = [
        {
          item,
          type: ctx.libraryType === 'movie' ? 'movie' : 'series',
          match: { id: ctx.tvdbId ?? 0, name: ctx.title, year: ctx.year },
          season: ctx.season,
          episodes: [ctx.episode],
          episodeTitle: ctx.title
        }
      ];

      const res = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: libId, selections }) });
      if (!res.ok) throw new Error(`Server preview failed (${res.status})`);
      const js = await res.json();
      const plan = (js.plans && js.plans.length) ? js.plans[0] : null;
      if (!plan) throw new Error('Server preview returned no plans');
      // prefer meta.output then to
      return (plan.meta && plan.meta.output) ? plan.meta.output : plan.to;
    } catch (e: any) {
      console.debug('serverPreviewSample failed', e?.message ?? e);
      return null;
    }
  }

  // --- Client-side port of server finalizePlan / output path logic (best-effort, no fs or TVDB calls) ---
  function sanitizeForFs(s: string) {
    if (!s) return '';
    const str = String(s);
    // remove characters illegal in filenames and collapse whitespace
    const cleaned = str.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '');
    return cleaned.replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  }
  function pad2(n: number) { return String(n).padStart(2, '0'); }

  function clientEpisodeOutput(libOutputRoot: string, libInputRoot: string | undefined, seriesNameRaw: string, seriesYear: number | undefined, seasonNum: number, eps: number[], episodeTitle: string | undefined, ext: string, seriesSchemeLocal?: string) {
    ext = ext ? String(ext) : '';
    if (ext && !ext.startsWith('.')) ext = '.' + ext;
    const seriesName = sanitizeForFs(seriesNameRaw || '');
    let year = seriesYear ? String(seriesYear) : '';
    let debugSource = 'series.year';
    if (!year && seriesName) {
      const m = String(seriesName).match(/\((\d{4})\)/);
      if (m) { year = m[1]; debugSource = 'series.name'; }
    }
    if (!year && libInputRoot) {
      const m = String(libInputRoot).match(/\((\d{4})\)/);
      if (m) { year = m[1]; debugSource = 'lib.inputRoot'; }
    }
    if (!year && libInputRoot) {
      const m = String(libInputRoot).match(/(19|20)\d{2}/);
      if (m) { year = m[0]; debugSource = 'inputRoot-any-4digit'; }
    }
    const seriesFolder = year ? `${seriesName} (${year})` : seriesName;
    const epCode = `S${pad2(seasonNum)}E${eps.map(pad2).join('E')}`;
    const epTitle = episodeTitle ? sanitizeForFs(episodeTitle) : '';
    const folder = [libOutputRoot, seriesFolder, `Season ${pad2(seasonNum)}`].filter(Boolean).join('\\');
    const file = `${seriesFolder} - ${epCode}${epTitle ? ` - ${epTitle}` : ''}${ext}`;
    const finalPath = folder + '\\' + file;
    return { finalPath, year, debugSource };
  }

  function planEpisodeClient(itemPath: string, libOutputRoot: string, libInputRoot: string | undefined, seriesMatch: { id?: number; name: string; year?: number }, season: number, eps: number[], episodeTitle: string | undefined) {
    const ext = itemPath && itemPath.includes('.') ? '.' + itemPath.split('.').pop() : '.mkv';
    const seriesYearNum = seriesMatch.year !== undefined ? Number(seriesMatch.year) : undefined;
    const clientResult = clientEpisodeOutput(libOutputRoot, libInputRoot, seriesMatch.name, seriesYearNum, season, eps, episodeTitle, ext);
    const finalPath = clientResult.finalPath;
    const resultYear = clientResult.year;
    const metadataTitle = finalPath.substring(finalPath.lastIndexOf('\\') + 1, finalPath.lastIndexOf(ext));
    const plan: any = {
      from: itemPath,
      to: finalPath,
      action: 'hardlink',
      dryRun: true,
      meta: { tvdbId: seriesMatch.id, type: 'series', output: finalPath, metadataTitle, year: resultYear ? Number(resultYear) : undefined }
    };
    return plan;
  }

  // Choose best library by matching inputRoot to sample path or settings.libraryPath
  async function getBestLibraryForPath(samplePath?: string) {
    try {
      const res = await fetch('/api/libraries');
      if (!res.ok) return null;
      const libs = await res.json();
      if (!Array.isArray(libs) || !libs.length) return null;
      // Prefer exact inputRoot match to settings.libraryPath
      const candidates = libs.map((l: any) => ({ lib: l, input: String(l.inputRoot || l.path || l.libraryPath || '' ) }));
      const target = (samplePath && String(samplePath)) || (libraryPath && String(libraryPath)) || '';
      // Find longest prefix match
      let best = candidates[0];
      let bestScore = 0;
      for (const c of candidates) {
        if (!c.input) continue;
        const a = c.input.replace(/[\\/]+$/g, '');
        const t = target.replace(/[\\/]+$/g, '');
        if (!t) continue;
        if (t.toLowerCase().startsWith(a.toLowerCase())) {
          const score = a.length;
          if (score > bestScore) { bestScore = score; best = c; }
        }
      }
      return best ? best.lib : libs[0];
    } catch (e) {
      console.debug('getBestLibraryForPath failed', e);
      return null;
    }
  }

  // Client-side movie output using the user-configured movie scheme (best-effort)
  function clientMovieOutput(libOutputRoot: string, titleRaw: string, yearNum: number | undefined, ext: string) {
    ext = ext ? String(ext) : '';
    if (ext && !ext.startsWith('.')) ext = '.' + ext;
    const title = sanitizeForFs(titleRaw || '');
    // Prepare a context for renderTemplate similar to server's applyScheme
    const ctx: Record<string, any> = { title, year: yearNum, ext };
    // Use the movieScheme from client settings (movieScheme variable)
    let rel = '';
    try {
      rel = renderTemplate(movieScheme, ctx);
    } catch (e) {
      // Fallback simple format
      rel = `${title}${yearNum ? ` (${yearNum})` : ''}${ext}`;
    }
    // If template already includes full path segments, keep them; otherwise join
    const joined = (libOutputRoot || '').replace(/[\\/]+$/g, '') + '\\' + rel.replace(/^\\+/, '');
    return joined;
  }

  function planMovieClient(itemPath: string, libOutputRoot: string, libInputRoot: string | undefined, cand: { id?: number; name: string; year?: number }) {
    const ext = itemPath && itemPath.includes('.') ? '.' + itemPath.split('.').pop() : '.mkv';
    const finalPath = clientMovieOutput(libOutputRoot, cand.name, cand.year, ext);
    const metadataTitle = finalPath.substring(finalPath.lastIndexOf('\\') + 1, finalPath.lastIndexOf(ext));
    const plan: any = {
      from: itemPath,
      to: finalPath,
      action: 'hardlink',
      dryRun: true,
      meta: { tvdbId: cand.id, type: 'movie', output: finalPath, metadataTitle, year: cand.year }
    };
    return plan;
  }

  // --- Client-side finalize logic ---
  function finalizePlanClient(plan: any) {
    // Best-effort client-side finalization: ensure metadataTitle, insert year into prefix, and rewrite plan.to
    if (!plan || !plan.meta) return plan;
    const meta = { ...(plan.meta || {}) } as any;

    // Derive metadataTitle if missing
    let metadataTitle = meta.metadataTitle;
    const outPath = String(plan.to || meta.output || '');
    const extMatch = outPath.match(/(\.[^./\\]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    if (!metadataTitle) {
      const base = outPath.split(/[\\/]+/).pop() || '';
      metadataTitle = base.replace(new RegExp(ext.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '$'), '');
    }

    // Try to extract year from metadataTitle if not present
    if (!meta.year) {
      const ymatch = metadataTitle.match(/\((\d{4})\)/);
      if (ymatch) meta.year = Number(ymatch[1]);
    }

    // Series: ensure year is present in the prefix (Series Name (YYYY) - ...)
    if ((meta.type === 'series' || (plan?.meta?.match && plan.meta.match.type === 'series')) && meta.year) {
      const parts = String(metadataTitle).split(' - ');
      const prefix = parts.shift() || '';
      const rest = parts.join(' - ');
      if (!/\(\s*\d{4}\s*\)/.test(prefix)) {
        const newPrefix = `${prefix} (${meta.year})`;
        metadataTitle = rest ? `${newPrefix} - ${rest}` : newPrefix;
      }
    }

    // Movie: append year if missing
    if (meta.type === 'movie' && meta.year) {
      if (!/\(\s*\d{4}\s*\)/.test(metadataTitle)) {
        metadataTitle = `${metadataTitle} (${meta.year})`;
      }
    }

    // Write back meta and rewrite path
    plan.meta = { ...plan.meta, metadataTitle, year: meta.year };
    if (outPath) {
      const dir = outPath.replace(/[^\\/]+$/, '');
      plan.to = dir + metadataTitle + ext;
      plan.meta.output = plan.to;
    }
    return plan;
  }

  return (
  <div className="w-full min-h-screen flex items-center justify-center px-4">
      <main className="w-full max-w-2xl justify-self-center">
        <header className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Paths, naming schemes, and defaults</p>
        </header>

        {loading && <div className="text-center text-muted-foreground mb-6">Loading settings…</div>}
        {error && (
          <div className="border border-red-300/60 bg-red-50 text-red-700 rounded-lg p-3 text-sm text-center mb-6" role="alert">
            {error}
          </div>
        )}

  {/* Paths */}
        <section className="card border rounded-2xl shadow-md p-5 bg-card/80 backdrop-blur mb-5">
          <h2 className="text-lg font-semibold mb-3">Paths</h2>
          <p className="text-sm text-muted mb-3">Paths are resolved on the server where your media lives. You can paste either Linux-style paths (for example <span className="font-mono">/mnt/media/movies</span>) or Windows-style paths (for example <span className="font-mono">C:\\Media\\Movies</span> or network share <span className="font-mono">\\\\server\\share</span>). The server will normalize the path for its host OS.</p>
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="libraryPath" className="block text-sm font-medium mb-1">Library path to scan</label>
              <div className="flex gap-2">
                <input
                  id="libraryPath"
                  className="input w-full"
                  type="text"
                  placeholder="/path/to/library"
                  value={libraryPath}
                  onChange={(e) => setLibraryPath(e.target.value)}
                  spellCheck={false}
                />
                {typeof window !== 'undefined' && (window as any).showDirectoryPicker ? (
                  <button type="button" title="Open a folder picker to choose the library path" className="btn outline" onClick={() => pickFolder('lib')}>Pick folder</button>
                ) : (
                  <>
                    <label htmlFor="lib-directory-picker" title="Fallback: choose a folder and confirm its path" className="btn outline cursor-pointer">Pick folder</label>
                    <input
                      id="lib-directory-picker"
                      ref={filePickerSingleLibRef}
                      type="file"
                      // @ts-ignore
                      webkitdirectory={true as any}
                      directory={undefined as any}
                      style={{ display: 'none' }}
                      onChange={(e) => onSingleFilePicked('lib', e.target.files)}
                    />
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Tip: Folder picking uses the File System Access API in Chromium-based browsers. If your browser doesn't support it, the fallback will open a folder chooser where supported; otherwise paste the folder path.</p>
              {validatePath(libraryPath) && (
                <p className="text-xs text-red-600 mt-1">{validatePath(libraryPath)}</p>
              )}
            </div>
            <div>
              <label htmlFor="outputPath" className="block text-sm font-medium mb-1">Output path for hardlinks</label>
              <div className="flex gap-2">
                <input
                  id="outputPath"
                  className="input w-full"
                  type="text"
                  placeholder="/path/to/output"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  spellCheck={false}
                />
                {typeof window !== 'undefined' && (window as any).showDirectoryPicker ? (
                  <button type="button" title="Open a folder picker to choose the output path" className="btn outline" onClick={() => pickFolder('out')}>Pick folder</button>
                ) : (
                  <>
                    <label htmlFor="out-directory-picker" title="Fallback: choose a folder and confirm its path" className="btn outline cursor-pointer">Pick folder</label>
                    <input
                      id="out-directory-picker"
                      ref={filePickerSingleOutRef}
                      type="file"
                      // @ts-ignore
                      webkitdirectory={true as any}
                      directory={undefined as any}
                      style={{ display: 'none' }}
                      onChange={(e) => onSingleFilePicked('out', e.target.files)}
                    />
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Tip: For best results use Chrome or Edge; Firefox does not support folder inputs in the same way.</p>
              {validatePath(outputPath) && (
                <p className="text-xs text-red-600 mt-1">{validatePath(outputPath)}</p>
              )}
              <div className="mt-3">
                <label htmlFor="serverPort" className="block text-sm font-medium mb-1">Server port (dev only)</label>
                <input id="serverPort" className="input" type="number" value={port ?? ''} onChange={(e) => setPort(e.target.value ? Number(e.target.value) : undefined)} placeholder="e.g. 8787" />
                <p className="text-xs text-muted mt-1">Change requires server restart to take effect. The server will indicate if a restart is required.</p>
              </div>
              <p className="text-xs text-muted mt-1">
                Output mirrors your naming scheme; directories are auto-created and files are hardlinked.
              </p>
            </div>
          </div>
        </section>

        {/* Approvals */}
        <section className="card border rounded-2xl shadow-md p-5 bg-card/80 backdrop-blur mb-5">
          <h2 className="text-lg font-semibold mb-3">Approvals</h2>
          <p className="text-sm text-muted mb-3">Undo recent approvals from the journal. This only removes approval records and does not modify files on disk.</p>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={100} className="input" style={{ width: 120 }} value={unapproveCount} onChange={(e) => setUnapproveCount(Number(e.target.value || 0))} />
            <button className="btn" onClick={async () => {
              try {
                setUnapproveResult(null);
                const res = await fetch('/api/unapprove-last', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: unapproveCount }) });
                if (!res.ok) throw new Error(`Unapprove failed (${res.status})`);
                const js = await res.json();
                setUnapproveResult(`Removed ${js.removed?.length ?? 0} approvals`);
              } catch (e: any) {
                setUnapproveResult(`Error: ${e?.message ?? 'failed'}`);
              }
            }}>Unapprove last</button>
          </div>
          {unapproveResult && <div className="text-sm text-muted mt-2">{unapproveResult}</div>}
        </section>

        {/* Naming */}
        <section className="card border rounded-2xl shadow-md p-5 bg-card/80 backdrop-blur mb-7">
          <h2 className="text-lg font-semibold mb-3">Naming schemes</h2>
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="movieScheme" className="block text-sm font-medium mb-1">Movies</label>
              <div className="flex gap-2">
                <input
                  id="movieScheme"
                  className="input w-full font-mono text-sm"
                  type="text"
                  value={movieScheme}
                  onChange={(e) => setMovieScheme(e.target.value)}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setSampleType('movie'); runTest(); }}
                >
                  Test
                </button>
              </div>
              <p className="text-xs text-muted mt-1 break-all">Default: {DEFAULT_MOVIE_SCHEME}</p>
            </div>
            <div>
              <label htmlFor="seriesScheme" className="block text-sm font-medium mb-1">Series</label>
              <div className="flex gap-2">
                <input
                  id="seriesScheme"
                  className="input w-full font-mono text-sm"
                  type="text"
                  value={seriesScheme}
                  onChange={(e) => setSeriesScheme(e.target.value)}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setSampleType('series'); runTest(); }}
                >
                  Test
                </button>
              </div>
              <p className="text-xs text-muted mt-1 break-all">Default: {DEFAULT_SERIES_SCHEME}</p>
            </div>
            <div>
              <label htmlFor="tvdbApiKey" className="block text-sm font-medium mb-1">TVDB API Key</label>
              <div className="flex gap-2 items-center">
                <input
                  id="tvdbApiKey"
                  className="input w-full font-mono text-sm"
                  type={showTvdbKey ? 'text' : 'password'}
                  value={tvdbKey}
                  onChange={(e) => setTvdbKey(e.target.value)}
                  spellCheck={false}
                  placeholder="(optional)"
                />
                <button type="button" title="Toggle visibility of the TVDB API key" className="btn outline" onClick={() => setShowTvdbKey((s) => !s)}>{showTvdbKey ? 'Hide' : 'Show'}</button>
              </div>
              <p className="text-xs text-muted mt-1">Enter your TVDB API key to enable faster TV metadata lookups. Kept in server settings when you save.</p>
                <div className="text-xs text-muted-foreground mt-1">To replace an existing key: first clear the field and click Save (this disables TVDB), then enter the new key and click Save again to activate it.</div>
            </div>
            <div className="mt-2">
              <label htmlFor="tvdbLanguage" className="block text-sm font-medium mb-1">Preferred TVDB language</label>
              <select id="tvdbLanguage" className="input" value={tvdbLanguage} onChange={(e) => setTvdbLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="romaji">Romaji</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
              </select>
              <p className="text-xs text-muted mt-1">Preferred language to use when choosing TVDB series titles. Default: English.</p>
            </div>
            {/* Preview area */}
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Preview</label>
                  <select value={sampleType} onChange={(e) => setSampleType(e.target.value as any)} className="input text-sm">
                    <option value="movie">Movie</option>
                    <option value="series">Series</option>
                  </select>
                </div>
                <div className="text-xs text-muted">Sample: <span className="font-mono">{sample.title}{sample.ext}</span></div>
              </div>
              {previewError ? (
                <div className="text-sm text-red-600 font-mono">{previewError}</div>
              ) : (
                <div className="text-sm font-mono text-muted-foreground">{preview ?? <span className="text-muted">— no preview —</span>}</div>
              )}
            </div>
            <details className="mt-1 rounded-md border p-3 bg-muted/40">
              <summary className="cursor-pointer text-sm font-medium">Variables you can use</summary>
                            <div className="mt-2 text-sm">
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    <code>{'{title}'}</code>, <code>{'{series}'}</code>, <code>{'{year}'}</code>, <code>{'{season}'}</code>,{' '}
                    <code>{'{episode}'}</code>, <code>{'{ext}'}</code>
                  </li>
                  <li>
                    Zero‑padding:
                    <br />
                    <code>{'{' + 'season' + ':02}'}</code>, <code>{'{' + 'episode' + ':02}'}</code>
                  </li>
                  <li>
                    Conditionals:
                    <br />
                    <code>{'{year? " (" + year + ")" : ""}'}</code>
                  </li>
                  <li>
                    Library context:
                    <br />
                    <code>{'{libraryName}'}</code>, <code>{'{libraryType}'}</code>, <code>{'{sourcePath}'}</code>, <code>{'{inputRoot}'}</code>
                  </li>
                  <li>
                    Concatenation:
                    <br />
                    <code>{'{"Season " + season}'}</code>, <code>{'{"S" + season:02 + "E" + episode:02}'}</code>
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </section>

        {/* Actions box — nudged down ~5px from above section */}
        <div className="flex justify-center" style={{ marginTop: '5px' }}>
          <div className="card border rounded-2xl shadow-md p-5 bg-card/80 backdrop-blur inline-flex items-center">
            <div className="flex flex-wrap items-center gap-3 justify-center">
              <button
                className="btn px-5 py-2"
                title="Save current settings (paths, naming schemes, TVDB key) to the server"
                onClick={save}
                disabled={!isDirty || saving || !!validatePath(libraryPath) || !!validatePath(outputPath)}
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              <button
                className="btn outline px-5 py-2"
                title="Reset naming schemes and TVDB key to defaults"
                onClick={resetDefaults}
                disabled={saving}
              >
                Reset to defaults
              </button>
              {status && <span className="text-sm text-muted" style={{ marginLeft: 6 }}>{status}</span>}
              {restartRequired && <div className="text-sm text-yellow-800 mt-2">Server restart required for some changes (e.g. port) to take effect.</div>}
            </div>
          </div>
        </div>

  {/* Sticky save bar removed; only the static Save button in the actions card remains */}
      </main>
    </div>
  );
}
