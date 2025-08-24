import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { VariableSizeList as List } from 'react-window';
import debug from '../lib/debug';

type Library = {
  id: string;
  name: string;
  path: string;
};

type DashboardProps = {
  buttons: { base: string };
};

export default function ScanManager({ buttons }: DashboardProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanningLib, setScanningLib] = useState<string | null>(null);
  const [scanItems, setScanItems] = useState<Record<string, any[]>>({});
  const [scanLoading, setScanLoading] = useState(false);
  const [scanOffset, setScanOffset] = useState(0);
  const [scanProgress, setScanProgress] = useState<Record<string, { total: number; done: number; start: number }>>({});
  const [openLibPanels, setOpenLibPanels] = useState<Record<string, boolean>>({});
  const [searchResults, setSearchResults] = useState<Record<string, any[]>>({});
  const [previewPlans, setPreviewPlans] = useState<Record<string, any[]>>({});
  const [initialPrefetchingMap, setInitialPrefetchingMap] = useState<Record<string, boolean>>({});
  const [hydratedMap, setHydratedMap] = useState<Record<string, boolean>>({});
  const hydratedMapRef = useRef(hydratedMap);
  const [tvdbInputs, setTvdbInputs] = useState<Record<string, { id?: number | string; type: 'movie'|'series' }>>({});
  const [rescaningMap, setRescaningMap] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [scanningAll, setScanningAll] = useState(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [tvdbKey, setTvdbKey] = useState<string | null>(null);
  const [fetchingEpisodeMap, setFetchingEpisodeMap] = useState<Record<string, boolean>>({});
  const [scanningMap, setScanningMap] = useState<Record<string, boolean>>({});
  const [previewingMap, setPreviewingMap] = useState<Record<string, boolean>>({});
  const [previewSkippedMap, setPreviewSkippedMap] = useState<Record<string, boolean>>({});
  const [bulkSaved, setBulkSaved] = useState(false);
  const [showBulkResults, setShowBulkResults] = useState(false);
  const [bulkResults, setBulkResults] = useState<Record<string, any[]>>({});
  const [approved, setApproved] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState('');

  // --- Background scanning queue (visible-first, rate-limited) ---
  type ScanQueueItem = { libId: string; itemId: string; silent?: boolean };
  const scanQueueRef = useRef<ScanQueueItem[]>([]);
  const scanQueuedSetRef = useRef(new Set<string>());
  const isProcessingRef = useRef(false);
  const scanItemsRef = useRef(scanItems);
  // per-library metadata for large libs and background scanning state
  const libraryMetaRef = useRef<Record<string, { large?: boolean; total?: number; nextOffset?: number; bgRunning?: boolean; hideWhileScanning?: boolean }>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const shownLibrariesRef = useRef<typeof shownLibraries | null>(null as any);
  // Web Worker for heavy scanning tasks
  const workerRef = useRef<Worker | null>(null);
  const pendingWorkerRequests = useRef(new Map<string, { resolve: (v:any)=>void, reject:(e:any)=>void }>());
  // avoid duplicating immediate fetches for the same visible item
  const inProgressImmediateRef = useRef(new Set<string>());
  // inflight request dedupe: map dedupeKey -> Promise resolving to updatedItem|null
  const inflightRequestsRef = useRef(new Map<string, Promise<any>>());
  // short-lived in-memory response cache to avoid repeated requests across quick navigations
  const responseCacheRef = useRef(new Map<string, { ts: number; value: any }>());
  const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  // keep track of which items are currently visible in the viewport
  const visibleSetRef = useRef(new Set<string>());
  // pending updates for items that were fetched while visible — apply when they leave view
  const pendingUpdatesRef = useRef(new Map<string, any>());
  // set of normalized paths that have already been scanned (to avoid repeats)
  const scannedPathsRef = useRef(new Set<string>());
  // last user activity timestamp (manual scan, scroll, etc.)
  const lastActivityRef = useRef<number>(Date.now());
  // prevent concurrent idle workers
  const idleWorkerRef = useRef(false);
  // map of normalized path -> updated item (persisted immediately when discovered)
  const scannedUpdatesRef = useRef(new Map<string, any>());
  // delay between queued fetches to keep within API limits (ms)
  const RATE_DELAY_MS = 1500; // ~40 requests/min
  const IDLE_THRESHOLD_MS = 60_000; // start idle scan after 60s of inactivity
  // virtualization threshold: switch to react-window when list length exceeds this
  const LIST_VIRTUALIZE_THRESHOLD = 80;
  // initial prefetch tuning (bigger prefetch and slightly longer timeout)
  const PREFETCH_COUNT = 6;
  const PREFETCH_TIMEOUT_MS = 8000;
  // treat very large libraries specially to avoid loading many items into memory/DOM
  const LARGE_LIBRARY_THRESHOLD = 2000; // library size above which we consider it "large"
  const INITIAL_WINDOW = 200; // initial number of items to keep in client state for large libs
  const PREFETCH_BATCH_SIZE = 200; // background batch size when scanning large libs
  const IDLE_BATCH_DELAY_MS = 400; // delay between background batches to avoid hogging
  // per-library virtualization state (size map + list ref) kept in a top-level ref
  const virtualListStateRef = useRef<Record<string, { sizeMap: Record<number, number>; listRef: { current: any } }>>({});

  useEffect(() => { scanItemsRef.current = scanItems; }, [scanItems]);
  useEffect(() => { hydratedMapRef.current = hydratedMap; }, [hydratedMap]);

  // Restore persisted scan state when Dashboard mounts so results survive navigation
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('dashboard.scanItems');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, any[]>;
        if (parsed && typeof parsed === 'object') setScanItems(parsed);
      }
    } catch (e) {}
    try {
      const raw2 = sessionStorage.getItem('dashboard.scannedUpdates');
      if (raw2) {
        const parsed2 = JSON.parse(raw2) as Record<string, any>;
        if (parsed2 && typeof parsed2 === 'object') scannedUpdatesRef.current = new Map(Object.entries(parsed2));
      }
    } catch (e) {}
    try {
      const raw3 = sessionStorage.getItem('dashboard.scannedPaths');
      if (raw3) {
        const parsed3 = JSON.parse(raw3) as string[];
        if (Array.isArray(parsed3)) scannedPathsRef.current = new Set(parsed3.map(normalizePath));
      }
    } catch (e) {}
    try {
      const raw4 = sessionStorage.getItem('dashboard.libraryMeta');
      if (raw4) {
        const parsed4 = JSON.parse(raw4) as Record<string, any>;
        if (parsed4 && typeof parsed4 === 'object') libraryMetaRef.current = parsed4;
      }
    } catch (e) {}
  }, []);

  // ...existing code...

  // Persist helpers: throttle writes to sessionStorage to avoid thrash
  const persistScanState = useCallback((libId?: string) => {
    try {
      // persist visible scanItems for the current libraries
      try { sessionStorage.setItem('dashboard.scanItems', JSON.stringify(scanItemsRef.current || {})); } catch {}
      // persist scannedUpdates map
      try { sessionStorage.setItem('dashboard.scannedUpdates', JSON.stringify(Object.fromEntries(Array.from(scannedUpdatesRef.current.entries())))); } catch {}
      try { sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(Array.from(scannedPathsRef.current || []))); } catch {}
      try { sessionStorage.setItem('dashboard.libraryMeta', JSON.stringify(libraryMetaRef.current || {})); } catch {}
    } catch (e) {}
  }, []);

  // Persist a specific library's items immediately (useful right after computing accumulatedItems)
  const persistScanItemsNow = useCallback((libId: string, items: any[]) => {
    try {
      const cur = scanItemsRef.current || {};
      const merged = { ...cur, [libId]: items };
      // update the ref so later uses see the new items immediately
      try { scanItemsRef.current = merged; } catch (e) {}
      try { sessionStorage.setItem('dashboard.scanItems', JSON.stringify(merged)); } catch (e) {}
    } catch (e) {}
  }, []);

  // expose a simple background scan manager on window so scans survive Dashboard unmounts
  useEffect(() => {
    try {
      const win = window as any;
      if (!win.__mediaRenamerBackgroundScan) {
        win.__mediaRenamerBackgroundScan = {
          enqueue: (libId: string, itemId: string, silent?: boolean) => {
            // push into local refs so processing loop will pick it up
            scanQueueRef.current.push({ libId, itemId, silent });
            scanQueuedSetRef.current.add(`${libId}::${itemId}`);
            // ensure processing loop runs
            if (!isProcessingRef.current) {
              // kick off processing
              (async () => {
                isProcessingRef.current = true;
                try {
                  while (scanQueueRef.current.length) {
                    const next = scanQueueRef.current.shift()!;
                    const keyLocal = `${next.libId}::${next.itemId}`;
                    const libs = scanItemsRef.current || {};
                    const items = libs[next.libId] || [];
                    const item = items.find((it: any) => String(it.id) === String(next.itemId));
                    if (item) {
                      try {
                        const libObj = (shownLibrariesRef.current || []).find((l:any) => l.id === next.libId) as any;
                        if (libObj) await fetchEpisodeTitleIfNeededClient(libObj, item, { silent: !!next.silent });
                        else await fetchEpisodeTitleIfNeededClient({ id: next.libId } as any, item, { silent: !!next.silent });
                      } catch (e) {}
                    }
                    scanQueuedSetRef.current.delete(keyLocal);
                    await new Promise(r => setTimeout(r, RATE_DELAY_MS));
                    // persist periodically
                    persistScanState();
                  }
                } finally { isProcessingRef.current = false; }
              })();
            }
          },
          persist: persistScanState
        };
      }
      return () => { /* leave manager on window so it survives unmount */ };
    } catch (e) { return; }
  }, [persistScanState]);

  // Initialize worker
  useEffect(() => {
    try {
      // Create worker from module file (Vite supports new URL import)
      const w = new Worker(new URL('../workers/scanWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = w;
      w.addEventListener('message', (ev: MessageEvent) => {
        const msg = ev.data || {};
        const { requestId, type } = msg;
        const pending = pendingWorkerRequests.current.get(requestId as string);
        if (pending) {
          if (type === 'fetchEpisodeTitleResult') {
            pending.resolve(msg.updatedItem || null);
          } else {
            pending.reject(msg.error || 'worker error');
          }
          pendingWorkerRequests.current.delete(requestId as string);
        }
        // Best-effort: update tvdbInputs when worker returns a tvdb id for an item
        try {
          if (type === 'fetchEpisodeTitleResult' && msg.updatedItem && msg.updatedItem.__tvdb) {
            const up = msg.updatedItem;
            const key = up.id;
            const tv = up.__tvdb;
            if (key && tv && tv.id) {
              setTvdbInputs(m => ({ ...m, [key]: { id: tv.id, type: tv.type || 'series' } }));
            }
          }
        } catch (e) { /* ignore */ }
      });
      return () => { try { w.terminate(); } catch {} };
    } catch (e) { /* worker failed, will use main-thread fallback */ }
  }, []);

  const enqueueScan = useCallback((libId: string, itemId: string, front = false, silent = false) => {
  // update last activity (user triggered)
  try { lastActivityRef.current = Date.now(); } catch {}
  const key = `${libId}::${itemId}`;
  // find item path and skip if already scanned (unless forced)
  const libs = scanItemsRef.current || {};
  const items = libs[libId] || [];
  const it = items.find((x: any) => String(x.id) === String(itemId));
  const maybePath = it?.path ? normalizePath(it.path) : null;
  // Check multiple sources so we don't rescan things that were saved earlier
  if (maybePath) {
    if (scannedPathsRef.current.has(maybePath)) return;
    if (scannedUpdatesRef.current && scannedUpdatesRef.current.has(maybePath)) return;
    try {
      const raw = sessionStorage.getItem('dashboard.scannedPaths');
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr) && arr.map(normalizePath).includes(maybePath)) return;
      }
    } catch {}
  }
  if (scanQueuedSetRef.current.has(key)) return;
  scanQueuedSetRef.current.add(key);
  const entry = { libId, itemId, silent } as ScanQueueItem;
    if (front) scanQueueRef.current.unshift(entry);
    else scanQueueRef.current.push(entry);
    // kick processing
    void (async function processQueue() {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      try {
        while (scanQueueRef.current.length) {
          const next = scanQueueRef.current.shift()!;
          const keyLocal = `${next.libId}::${next.itemId}`;
          // locate lib and item from latest state
      const libs = scanItemsRef.current || {};
      const items = libs[next.libId] || [];
          const item = items.find((it: any) => String(it.id) === String(next.itemId));
          if (item) {
              try {
              // find lib object from shownLibraries (best-effort)
        const libObj = (shownLibrariesRef.current || []).find((l:any) => l.id === next.libId) as any;
              if (libObj) {
                await fetchEpisodeTitleIfNeededClient(libObj, item, { silent: !!next.silent });
              } else {
                // fallback: construct minimal lib object
                await fetchEpisodeTitleIfNeededClient({ id: next.libId } as any, item, { silent: !!next.silent });
              }
            } catch (e) {
              // ignore per-item errors
            }
          }
          // drop from queued set and pause
          scanQueuedSetRef.current.delete(keyLocal);
          await new Promise(r => setTimeout(r, RATE_DELAY_MS));
        }
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [fetchEpisodeTitleIfNeededClient]);

  // Observe visible items and enqueue them at front of queue when they appear
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(entries => {
      for (const e of entries) {
        try {
          const el = e.target as HTMLElement;
          const itemId = el.getAttribute('data-item-id');
          const libId = el.getAttribute('data-lib-id');
          if (!itemId || !libId) continue;
          const key = `${libId}::${itemId}`;
          if (e.isIntersecting) {
            // mark visible and prioritize scanning (silent so UI fetching indicator is not shown)
            visibleSetRef.current.add(key);
            // mark as hydrated so the full UI is rendered for this item
            try {
              setHydratedMap(m => ({ ...m, [key]: true }));
            } catch (e) {}
            // Try to perform an immediate, silent fetch for visible items so they hit the API right away.
            try {
              const libs = scanItemsRef.current || {};
              const items = libs[libId] || [];
              const it = items.find((x: any) => String(x.id) === String(itemId));
                      if (it) {
                const norm = it.path ? normalizePath(it.path) : null;
                if (norm && scannedPathsRef.current.has(norm)) {
                  // already scanned
                } else if (!inProgressImmediateRef.current.has(key)) {
                  inProgressImmediateRef.current.add(key);
                  // call fetch immediately (silent); do not enqueue to avoid duplicates
                  (async () => {
                    try {
                      const libObj = (shownLibrariesRef.current || []).find((l:any) => l.id === libId) as any || { id: libId };
                      // update last activity timestamp
                      try { lastActivityRef.current = Date.now(); } catch {}
                      await fetchEpisodeTitleIfNeededClient(libObj, it, { silent: true });
                    } catch (e) {
                      // ignore
                    } finally {
                      inProgressImmediateRef.current.delete(key);
                    }
                  })();
                }
                } else {
                // fallback to enqueue when we don't have the item object available yet
                enqueueScan(libId, itemId, true, true);
              }
            } catch (e) {
              // fallback to enqueue on any error
              enqueueScan(libId, itemId, true, true);
            }
          } else {
            // left view: remove from visible set and, if we have a pending update, apply it now
            visibleSetRef.current.delete(key);
            if (pendingUpdatesRef.current.has(key)) {
              const updatedItem = pendingUpdatesRef.current.get(key);
              pendingUpdatesRef.current.delete(key);
              try {
                setScanItems(s => ({ ...s, [libId]: (s[libId] || []).map((it: any) => String(it.id) === String(itemId) ? updatedItem : it) }));
                try {
                  const p = updatedItem?.path ? normalizePath(updatedItem.path) : null;
                  if (p) {
                          scannedUpdatesRef.current.set(p, updatedItem);
                          scannedPathsRef.current.add(p);
                          sessionStorage.setItem('dashboard.scannedUpdates', JSON.stringify(Object.fromEntries(Array.from(scannedUpdatesRef.current.entries()))));
                          sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(Array.from(scannedPathsRef.current)));
                          try { persistScannedUpdatesToServer().catch(()=>{}); } catch(e){}
                        }
                } catch (e) {}
              } catch (err) { /* swallow UI apply errors */ }
            }
          }
        } catch (err) {}
      }
    }, { root: null, rootMargin: '400px', threshold: 0.01 });

    // Observe current items in DOM
    try {
      const els = document.querySelectorAll('[data-item-id]');
      els.forEach(el => observerRef.current?.observe(el));
    } catch (e) {}

    // Re-observe on DOM mutations (new items inserted)
    const mo = new MutationObserver(() => {
      try { const els = document.querySelectorAll('[data-item-id]'); els.forEach(el => observerRef.current?.observe(el)); } catch {}
    });
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}
    return () => { try { observerRef.current?.disconnect(); } catch {} try { mo.disconnect(); } catch {} };
  }, [enqueueScan]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/libraries');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setLibraries(data);
        } else {
          throw new Error('Invalid data format');
        }
      } catch (e: any) {
        setError(e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    load();
    // load settings to read tvdb key and restore saved bulk results
    (async () => {
      try {
        const r = await fetch('/api/settings');
        if (r.ok) {
          const js = await r.json();
          setTvdbKey(js.tvdbKey ?? null);
        }
      } catch {}
      try {
        const raw = localStorage.getItem('bulkScanResults');
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, any[]>;
          setBulkResults(parsed || {});
          setBulkSaved(Object.keys(parsed || {}).length > 0);
        }
      } catch {}
      try {
        // Try server-backed scan cache first
        const r = await fetch('/api/scan-cache');
        if (r.ok) {
          const js = await r.json();
          // Merge server cache with any existing sessionStorage state so
          // transient items discovered by the client but not yet flushed to
          // the server are preserved when returning from Settings.
          const serverMap = (js && typeof js === 'object') ? js as Record<string, any[]> : {};
          let sessionMap: Record<string, any[]> = {};
          try {
            const rawScan = sessionStorage.getItem('dashboard.scanItems');
            if (rawScan) sessionMap = JSON.parse(rawScan) as Record<string, any[]>;
          } catch (e) { sessionMap = {}; }

          // Merge logic: server entries take precedence, but avoid restoring
          // items for libraries that are currently running in background so we
          // don't reveal partially-scanned items. We still include session-only
          // libraries when the server doesn't know about them and they aren't
          // actively scanning.
          const merged: Record<string, any[]> = {};
          const meta = libraryMetaRef.current || {};
          // Prefer server-provided entries when available and not actively scanning
          for (const k of Object.keys(serverMap || {})) {
            try { if (meta[k] && meta[k].bgRunning) continue; } catch (e) {}
            merged[k] = serverMap[k] || [];
          }
          // Add any session-only entries that the server lacks (unless scanning)
          for (const k of Object.keys(sessionMap || {})) {
            if (merged[k]) continue;
            try { if (meta[k] && meta[k].bgRunning) continue; } catch (e) {}
            merged[k] = sessionMap[k] || [];
          }

          // If merged has content, restore it to state
          if (Object.keys(merged).length) setScanItems(merged);
        } else {
          // server returned non-OK; fallback to sessionStorage
          try {
            const rawScan = sessionStorage.getItem('dashboard.scanItems');
            if (rawScan) {
              const parsed = JSON.parse(rawScan) as Record<string, any[]>;
              setScanItems(parsed || {});
            }
          } catch {}
        }
      } catch (e) {
        // fallback to sessionStorage when server call fails
        try {
          const rawScan = sessionStorage.getItem('dashboard.scanItems');
          if (rawScan) {
            const parsed = JSON.parse(rawScan) as Record<string, any[]>;
            setScanItems(parsed || {});
          }
        } catch {}
      }
      try {
        const a = await fetch('/api/approved');
        if (a.ok) {
          const js = await a.json();
          const map: Record<string, any> = {};
          (js || []).forEach((it: any) => map[it.hash || it.original] = it);
          setApproved(map);
        }
      } catch {}
    })();
  }, []);

  // Persist scanItems to sessionStorage so navigating away (to Settings) doesn't lose results
  useEffect(() => {
    // Debounced persistence to server and sessionStorage. Cancels/restarts
    // when scanItems changes rapidly to avoid network storms.
    let cancelled = false;
    const id = setTimeout(() => {
      (async () => {
        try {
          await fetch('/api/scan-cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scanItems || {}) });
        } catch (e) {
          // ignore transient network errors; sessionStorage still writes below
        }
        try {
          sessionStorage.setItem('dashboard.scanItems', JSON.stringify(scanItems || {}));
        } catch (e) { /* ignore */ }
      })();
    }, 500);
    return () => { cancelled = true; clearTimeout(id); };
  }, [scanItems]);

  // (previewVersion removed) previewPlans changes are applied directly to state

  // Auto-apply preview stored on window.__lastPreviewPlans to matching scan items.
  // This helps when the manual snippet or Debug button stores the preview on window but
  // the Dashboard needs to map that result to the correct item id in its state.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyWindowPreview = () => {
      try {
        const wp = (window as any).__lastPreviewPlans;
        if (!Array.isArray(wp) || wp.length === 0) return;
        // For each plan, try to find the matching scan item by path and apply the plans to that item id
        const matches: Record<string, any[]> = {};
        for (const plan of wp) {
          const from = String(plan.from || plan.item?.path || '');
          if (!from) continue;
          // search in current scanItems map
          for (const libId of Object.keys(scanItems || {})) {
            const items = (scanItems as any)[libId] || [];
            for (const it of items) {
              if (!it || !it.path) continue;
              // normalize simple path comparisons (case-insensitive on Windows-like)
              const a = String(it.path).replace(/\\/g, '/').toLowerCase();
              const b = String(from).replace(/\\/g, '/').toLowerCase();
              if (a === b || b.startsWith(a) || a.startsWith(b)) {
                matches[it.id] = matches[it.id] || [];
                matches[it.id].push(plan);
                break;
              }
            }
          }
        }
        // If we found matches, update previewPlans state for each matched item id
        const keys = Object.keys(matches);
        if (keys.length) {
          setPreviewPlans(prev => {
            const next = { ...prev } as Record<string, any[]>;
            for (const id of keys) next[id] = matches[id];
            return next;
          });
        }
      } catch (e) {
        // best-effort
        console.debug('applyWindowPreview failed', e);
      }
    };

    // Immediately attempt to apply if window already has the preview
    try { applyWindowPreview(); } catch (e) {}

    // Install a property setter so future assignments to window.__lastPreviewPlans auto-apply
    try {
      const desc = Object.getOwnPropertyDescriptor(window as any, '__lastPreviewPlans');
      let current = (window as any).__lastPreviewPlans;
      Object.defineProperty(window as any, '__lastPreviewPlans', {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(v) { current = v; try { applyWindowPreview(); } catch (e) {} }
      });
      return () => {
        // restore previous descriptor if it existed
        try {
          if (desc) Object.defineProperty(window as any, '__lastPreviewPlans', desc as any);
          else delete (window as any).__lastPreviewPlans;
        } catch (e) {}
      };
    } catch (e) {
      // ignore defineProperty failures
      return undefined;
    }
  }, [scanItems]);

  // Helpers for cross-platform path handling
  const normalizePath = (p: string) => {
    if (!p) return '';
    return String(p).replace(/\\+/g, '/');
  };
  const splitPath = (p: string) => normalizePath(p).split('/').filter(Boolean);

  // Deduplicate libraries by normalized input path to avoid showing duplicates
  const shownLibraries = useMemo(() => {
    const m = new Map<string, any>();
      const normalize = (p: string | undefined) => {
      if (!p) return '';
      let s = String(p).trim();
      // convert backslashes to forward slashes
        s = s.replace(/\\+/g, '/');
      // collapse multiple slashes
      s = s.replace(/\/+/g, '/');
      // trim trailing separators
      s = s.replace(/\/+$|\/+$/g, '');
      // lowercase for case-insensitive comparison
      s = s.toLowerCase();
      return s;
    };
    for (const lib of libraries) {
      const key = normalize((lib as any).inputRoot || (lib as any).path || (lib as any).libraryPath);
      if (!m.has(key)) m.set(key, lib);
    }
    return Array.from(m.values());
  }, [libraries]);

  // Sync ref for shownLibraries used by the background scanner
  useEffect(() => { try { shownLibrariesRef.current = shownLibraries as any; } catch {} }, [shownLibraries]);

  // Initialize scannedPathsRef from sessionStorage or current scanItems
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('dashboard.scannedPaths');
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        scannedPathsRef.current = new Set((arr || []).map(normalizePath));
      }
    } catch {}
  }, []);

  // Initialize scannedUpdatesRef from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('dashboard.scannedUpdates');
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, any>;
        const m = new Map<string, any>();
        for (const k of Object.keys(obj || {})) m.set(normalizePath(k), obj[k]);
        scannedUpdatesRef.current = m;
      }
    } catch {}
  }, []);

  // Helper: persist scannedUpdatesRef merged into scanItems to server-backed cache
  const persistScannedUpdatesToServer = useCallback(async () => {
    try {
      // build a merged snapshot of current scanItems with scannedUpdates applied
      const libs = scanItemsRef.current || {};
      const merged: Record<string, any[]> = {};
      for (const libId of Object.keys(libs)) {
        merged[libId] = (libs[libId] || []).map(it => {
          try {
            const p = it?.path ? normalizePath(it.path) : null;
            if (p && scannedUpdatesRef.current.has(p)) return scannedUpdatesRef.current.get(p);
          } catch (e) {}
          return it;
        });
      }
      // also include any updates for libraries not yet present
      for (const [p, upd] of Array.from(scannedUpdatesRef.current.entries())) {
        try {
          const libId = String(upd?.libraryId || upd?.libId || upd?.lib || '');
          if (!libId) continue;
          merged[libId] = merged[libId] || [];
          // ensure the updated item is present or replace by path
          const exists = merged[libId].some(it => normalizePath(it.path) === p);
          if (!exists) merged[libId].push(upd);
        } catch (e) {}
      }
      // POST merged map to server scan-cache
      try {
        await fetch('/api/scan-cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) });
      } catch (e) { /* best-effort */ }
    } catch (e) {}
  }, []);

  // Ensure scan state is persisted when component unmounts (e.g., navigating to Settings)
  useEffect(() => {
    return () => {
      try { persistScanState(); } catch {}
      try { persistScannedUpdatesToServer().catch(() => {}); } catch {}
    };
  }, [persistScanState, persistScannedUpdatesToServer]);

  // Keep scannedPathsRef in sync with scanItems and persist to sessionStorage
  // Do not mark all scanItems as scanned. Only persist paths when an actual scanned update
  // is recorded (see fetchEpisodeTitleIfNeeded which writes scannedUpdates/scannedPaths).
  // This prevents un-renamed items from being treated as scanned.
  useEffect(() => {
    try {
      // Persist current scannedPaths (which should only contain paths added by fetchEpisodeTitleIfNeeded)
      try { sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(Array.from(scannedPathsRef.current))); } catch {}
    } catch (e) {}
  }, [/* intentionally run when scanItems changes to flush current scannedPaths */ scanItems]);

  // When scanItems change, if we have persisted scannedUpdates, merge them into state so UI shows saved titles
  useEffect(() => {
    try {
      if (!scanItems) return;
      const updates = scannedUpdatesRef.current;
      if (!updates || updates.size === 0) return;
      let applied = false;
      const next: Record<string, any[]> = {};
      for (const libId of Object.keys(scanItems || {})) {
        const items = (scanItems as any)[libId] || [];
        next[libId] = items.map((it: any) => {
          const p = it?.path ? normalizePath(it.path) : null;
          if (p && updates.has(p)) { applied = true; return updates.get(p); }
          return it;
        });
      }
      if (applied) setScanItems(next);
    } catch (e) {}
  }, [scanItems]);

  // Idle scanner: when the user has been inactive for IDLE_THRESHOLD_MS, slowly walk unscanned items and enqueue them
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const idleFor = Date.now() - (lastActivityRef.current || 0);
        if (idleFor < IDLE_THRESHOLD_MS) return; // not idle yet
        if (idleWorkerRef.current) return; // already running
        idleWorkerRef.current = true;
        try {
          // Build a list of candidate items across libraries. For very large
          // libraries, prefer server-backed background scanning to avoid loading
          // the entire item list into memory/DOM.
          const libs = scanItemsRef.current || {};
          for (const libId of Object.keys(libs)) {
            if (stopped) break;
            const meta = libraryMetaRef.current[libId] || {};
            if (meta.large) {
              // kick off a background scan worker for large libraries if not running
              if (!meta.bgRunning) {
                (async () => {
                  libraryMetaRef.current[libId] = { ...meta, bgRunning: true };
                  try {
                    // background batches fetch more items from server as needed
                    while (!stopped) {
                      // ask server for the next batch for this library
                      const offset = libraryMetaRef.current[libId].nextOffset || 0;
                      try {
                        const res = await fetch(`/api/scan?offset=${offset}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: libId, limit: PREFETCH_BATCH_SIZE }) });
                        if (!res.ok) break;
                        const js = await res.json();
                        const items = js.items || [];
                        // merge only a small window into client state so UI remains responsive
                        // but if a full scan was explicitly started and hideWhileScanning is set,
                        // avoid revealing partial results until the full scan completes.
                        setScanItems(s => {
                          const cur = s[libId] || [];
                          const meta = libraryMetaRef.current[libId] || {} as any;
                          // If hideWhileScanning or bgRunning (still in progress), keep current state
                          if (meta.hideWhileScanning || meta.bgRunning) {
                            return s;
                          }
                          const window = cur.concat(items).slice(0, INITIAL_WINDOW);
                          return { ...s, [libId]: window };
                        });
                        // enqueue silent scans for the returned items
                        for (const it of items) {
                          try {
                            if (!it || !it.path) continue;
                            const p = normalizePath(it.path);
                            if (scannedPathsRef.current.has(p) || (scannedUpdatesRef.current && scannedUpdatesRef.current.has(p))) continue;
                            enqueueScan(libId, it.id, false, true);
                          } catch (e) {}
                        }
                        // update nextOffset from server if provided
                        if (typeof js.nextOffset === 'number') libraryMetaRef.current[libId].nextOffset = js.nextOffset;
                        if (!items.length || (js.nextOffset == null && items.length < PREFETCH_BATCH_SIZE)) break;
                      } catch (e) { break; }
                      // be polite between batches
                      await new Promise(r => setTimeout(r, IDLE_BATCH_DELAY_MS));
                    }
                  } finally {
                    libraryMetaRef.current[libId] = { ...libraryMetaRef.current[libId], bgRunning: false };
                  }
                })();
              }
            } else {
              const items = libs[libId] || [];
              for (const it of items) {
                if (stopped) break;
                try {
                  const path = it?.path ? normalizePath(it.path) : null;
                  const key = `${libId}::${it.id}`;
                  if (!path) continue;
                  if (scannedPathsRef.current.has(path) || (scannedUpdatesRef.current && scannedUpdatesRef.current.has(path))) continue;
                  // Enqueue without front prioritization; idle worker should be quiet (silent)
                  enqueueScan(libId, it.id, false, true);
                  // yield a tick to avoid hogging CPU/network; no global rate limit per request
                  await new Promise(r => setTimeout(r, 250));
                } catch (e) {}
              }
            }
          }
        } finally { idleWorkerRef.current = false; }
      } catch (e) {}
    };
    const int = setInterval(tick, 5000);
    // also run once immediately to check
    void tick();
    return () => { stopped = true; clearInterval(int); };
  }, []);

  async function scanLibrary(lib: Library) {
  setScanningLib(lib.id);
  setScanningMap(m => ({ ...m, [lib.id]: true }));
  // hide items until scan completes
  libraryMetaRef.current[lib.id] = { ...(libraryMetaRef.current[lib.id] || {}), hideWhileScanning: true };
  setScanItems(s => ({ ...s, [lib.id]: [] }));
    setScanOffset(0);
    setScanLoading(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryId: lib.id }),
      });
      if (!res.ok) throw new Error(`Scan failed (${res.status})`);
      const data = await res.json();
      const items = data.items || [];
      // If server reports a very large library, only keep a small initial window
      // in client state and mark the library for background scanning.
      const totalReported = data.total ?? (items.length || 0);
      // initialize progress and mark background running
      setScanProgress(p => ({ ...p, [lib.id]: { total: totalReported, done: 0, start: Date.now() } }));
      libraryMetaRef.current[lib.id] = { ...(libraryMetaRef.current[lib.id] || {}), bgRunning: true };
      // Stream pages and process items silently. We will reveal results when finished.
      const CONCURRENCY = 5;
      const PAGE_LIMIT = PREFETCH_BATCH_SIZE;
      let accumulatedItems: any[] = [];
      // process a single page of items with concurrency
      const processPage = async (pageItems: any[]) => {
        // abort early if user cancelled
        if (!libraryMetaRef.current[lib.id] || !libraryMetaRef.current[lib.id].bgRunning) return;
        accumulatedItems = accumulatedItems.concat(pageItems);
        let idx = 0;
        const pool: Promise<void>[] = [];
        const startTime = Date.now();
    const spawn = () => {
          while (pool.length < CONCURRENCY && idx < pageItems.length) {
            const it = pageItems[idx++];
            // check for cancellation between tasks
            if (!libraryMetaRef.current[lib.id] || !libraryMetaRef.current[lib.id].bgRunning) break;
            const p = (async () => {
              try {
                await fetchEpisodeTitleIfNeededClient(lib, it, { silent: true });
              } catch (e) {}
              // update progress
              setScanProgress(p => {
                try {
                  const prev = p[lib.id] || { total: totalReported, done: 0, start: Date.now() };
                  return { ...p, [lib.id]: { ...prev, done: prev.done + 1 } };
                } catch (e) { return p; }
              });
      // persist progress occasionally
      try { persistScanState(lib.id); } catch (e) {}
            })();
            // remove from pool when done
            pool.push(p.then(() => { const i = pool.indexOf(p); if (i >= 0) pool.splice(i, 1); }));
          }
        };
        spawn();
        // wait until all spawned tasks finish
        await Promise.all(pool);
      };

      // include first page immediately
      let nextOffset = data.nextOffset ?? (items.length || 0);
      // process first page
      await processPage(items);
      // fetch remaining pages sequentially and process
      while (nextOffset != null && nextOffset < (totalReported || Infinity)) {
        // respect cancellation
        if (!libraryMetaRef.current[lib.id] || !libraryMetaRef.current[lib.id].bgRunning) break;
        try {
          const pageRes = await fetch(`/api/scan?offset=${nextOffset}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: lib.id, limit: PAGE_LIMIT }) });
          if (!pageRes.ok) break;
          const pageJs = await pageRes.json();
          const pageItems = pageJs.items || [];
          await processPage(pageItems);
          nextOffset = pageJs.nextOffset ?? (nextOffset + (pageItems.length || 0));
        } catch (e) { break; }
      }
  // scanning finished: reveal items (accumulated) and persist
  // update ref and sessionStorage immediately so navigating away and back restores items
  try { persistScanItemsNow(lib.id, accumulatedItems); } catch (e) {}
  setScanItems(s => ({ ...s, [lib.id]: accumulatedItems }));
  // reveal items now that scan finished
  try { delete libraryMetaRef.current[lib.id].hideWhileScanning; } catch (e) {}
  try { persistScanState(lib.id); } catch (e) {}
      if (totalReported > LARGE_LIBRARY_THRESHOLD) {
        libraryMetaRef.current[lib.id] = { large: true, total: totalReported, nextOffset: data.nextOffset ?? items.length };
        // keep metadata; items already set after full scan
      } else {
        libraryMetaRef.current[lib.id] = { large: false, total: totalReported, nextOffset: data.nextOffset ?? items.length };
      }
  // clear progress
  setScanProgress(p => { const c = { ...p }; delete c[lib.id]; return c; });
  try { persistScanState(lib.id); } catch (e) {}
      // If the library is large, skip eager auto-preview to avoid hammering the client/network.
      const AUTO_PREVIEW_LIMIT = 30;
      try {
        if ((items.length || 0) > AUTO_PREVIEW_LIMIT) {
          // mark that we skipped auto-preview for this library so UI can offer a throttled preview action
          setPreviewSkippedMap(m => ({ ...m, [lib.id]: true }));
          debug('scanLibrary: skipped eager auto-preview for large library', lib.id, items.length);
        } else {
          // run sequentially to avoid hammering TVDB/server
          for (const it of items) {
            try {
              const updated = await fetchEpisodeTitleIfNeededClient(lib, it);
              await autoPreview(lib, updated || it);
            } catch (e) {
              // best-effort per item
            }
          }
        }
      } catch (err) { debug('scanLibrary auto-preview error', err); }
      setScanOffset(data.nextOffset ?? (data.items?.length ?? 0));
      setOpenLibPanels(p => ({ ...p, [lib.id]: true }));
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed');
    } finally {
      // Persist discovered scanned updates to server cache and sessionStorage
      try {
        // Build a libId-keyed payload from scannedUpdates so server stores entries
        // under the proper library id instead of a generic 'items' key.
        const updates = Array.from(scannedUpdatesRef.current.values() || []);
        if (updates.length) {
          const payload: Record<string, any[]> = {};
          for (const u of updates) {
            try {
              const libId = String(u?.libraryId || u?.libId || u?.library || '__unassigned');
              payload[libId] = payload[libId] || [];
              payload[libId].push(u);
            } catch (e) { /* ignore per-item */ }
          }
          try {
            await fetch('/api/scan-cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            setBulkSaved(true);
          } catch (e) { /* ignore network persist failure */ }
        }
      } catch (e) { /* ignore */ }
      try {
        const paths = Array.from(scannedPathsRef.current || []);
        sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(paths));
      } catch (e) { /* ignore sessionStorage errors */ }
      setScanLoading(false);
      setScanningMap(m => { const c = { ...m }; delete c[lib.id]; return c; });
    }
  }

  async function loadMore(lib: Library) {
    setScanLoading(true);
    try {
      const res = await fetch(`/api/scan?offset=${scanOffset}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryId: lib.id }),
      });
      if (!res.ok) throw new Error(`Scan failed (${res.status})`);
      const data = await res.json();
      setScanItems(s => {
        const cur = s[lib.id] || [];
        const meta = libraryMetaRef.current[lib.id] || {} as any;
        // If full-scan hide flag is set or a background scan is still running,
        // avoid revealing partial items until the scan completes
        if (meta.hideWhileScanning || meta.bgRunning) return s;
        const merged = [...cur, ...(data.items || [])];
        if (meta.large) return { ...s, [lib.id]: merged.slice(0, INITIAL_WINDOW) };
        return { ...s, [lib.id]: merged };
      });
      try {
        const items = data.items || [];
        for (const it of items) {
          try {
            const updated = await fetchEpisodeTitleIfNeededClient(lib, it);
            await autoPreview(lib, updated || it);
          } catch (e) {}
        }
      } catch {}
      setScanOffset(data.nextOffset ?? scanOffset + (data.items?.length ?? 0));
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  }

  async function searchTVDBFor(item: any) {
  console.debug('searchTVDBFor called', item?.id || item?.path);
    const key = item.id;
    // allow the server to decide whether a TVDB key is configured
    setSearchResults(r => ({ ...r, [key]: [{ loading: true }] }));
    try {
      const title = item.inferred?.title || '';
      const year = item.inferred?.year;
      // Try series first, then movie
      for (const t of ['series', 'movie'] as Array<'series'|'movie'>) {
        const url = `/api/search?type=${encodeURIComponent(t)}&q=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const js = await res.json();
        const results = js.data || js || [];
        if (Array.isArray(results) && results.length) {
          setSearchResults(r => ({ ...r, [key]: results }));
          // populate tvdb input with the top hit and prefer the result's returned type when available
          const top = results[0] || {} as any;
          setTvdbInputs(m => ({ ...m, [key]: { id: top.id, type: (top.type ?? t) } }));
          return;
        }
      }
      // nothing found
      setSearchResults(r => ({ ...r, [key]: [{ error: 'No matches found on TVDB' }] }));
    } catch (e: any) {
      setSearchResults(r => ({ ...r, [key]: [{ error: e?.message ?? 'Search failed' }] }));
    }
  }

  async function rescanItem(lib: Library, item: any) {
  console.debug('rescanItem called', lib.id, item.id);
    const key = item.id;
    setRescaningMap(m => ({ ...m, [key]: true }));
    try {
    const res = await fetch('/api/guessit-parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: item.path }) });
    if (!res.ok) throw new Error(`Rescan failed (${res.status})`);
    const js = await res.json();
  const inferred = js.inferred || item.inferred;
      // merge back into scanItems
  setScanItems(s => ({ ...s, [lib.id]: (s[lib.id] || []).map((it: any) => it.id === key ? { ...it, inferred } : it) }));
  // fetch episode title if we can
  fetchEpisodeTitleIfNeededClient(lib, { ...item, inferred }).catch(() => {});
      // If guessit provided a concrete series id, populate the TVDB input so the user
      // doesn't need to manually enter it.
  // No external guessit extras available; tvdbInputs will be populated from auto-preview or manual search
      // After rescanning, attempt an auto-preview so the Dashboard shows the server's canonical path (including year)
      try {
        await autoPreview(lib, { ...item, inferred });
      } catch (e) {
        console.debug('autoPreview after rescan failed', e);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Rescan failed');
    } finally {
      setRescaningMap(m => ({ ...m, [key]: false }));
    }
  }

  async function fetchEpisodeTitleIfNeededClient(lib: Library, item: any, opts?: { silent?: boolean }) {
    const key = item.id;
    if (!item?.inferred) return;
    const inf = item.inferred;
    const ep = inf.episode_number ?? (inf.episodes && inf.episodes[0]) ?? (inf.absolute && inf.absolute[0]);
  if (ep == null) return null;
  debug('fetchEpisodeTitleIfNeeded called', lib.id, key, 'ep=', ep);
    // avoid duplicate fetches
    const silent = !!(opts && opts.silent);
    if (!silent) setFetchingEpisodeMap(m => ({ ...m, [key]: true }));
  try {
    const seriesName = inf.title || (inf.parsedName ? String(inf.parsedName).split(' - ')[0] : '');
    if (!seriesName) return;
    const season = inf.season ?? 1;
    const dedupeKey = `series:${seriesName.toLowerCase()}::s:${season}::e:${ep}`;

    // attempt to reuse a short-lived cached response
    let ej: any = null;
    try {
      const cached = responseCacheRef.current.get(dedupeKey);
      if (cached && (Date.now() - cached.ts) < RESPONSE_CACHE_TTL_MS) {
        debug('response cache hit for', dedupeKey);
        ej = cached.value;
      }
    } catch (e) { /* ignore cache errors */ }

    if (!ej) {
      // Try worker offload first when available
      const w = workerRef.current;
      if (w) {
        try {
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
          const p = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => { pendingWorkerRequests.current.delete(requestId); reject(new Error('worker timeout')); }, 10000);
            pendingWorkerRequests.current.set(requestId, {
              resolve: (v:any) => { clearTimeout(timer); resolve(v); },
              reject: (e:any) => { clearTimeout(timer); reject(e); }
            });
          });
          w.postMessage({ requestId, type: 'fetchEpisodeTitle', lib, item });
          const res = await p.catch((e) => { debug('worker failed', e); return null; });
          if (res && res.inferred) {
            // worker returned updatedItem
            ej = { title: res.inferred?.episode_title || null, _workerUpdatedItem: res };
            // cache raw worker response shape for dedupe key (store minimal)
            try { responseCacheRef.current.set(dedupeKey, { ts: Date.now(), value: { title: ej.title } }); } catch(e){}
          }
        } catch (e) {
          debug('worker offload error', e);
        }
      }

      if (!ej) {
        // If an inflight identical request exists, await it instead of issuing another
        let promise = inflightRequestsRef.current.get(dedupeKey) as Promise<any> | undefined;
        if (!promise) {
          promise = (async () => {
            debug('looking up series on server for', seriesName);
            // search TVDB for series id
            const sres = await fetch(`/api/search?type=series&q=${encodeURIComponent(seriesName)}`);
            if (!sres.ok) return null;
            const sjs = await sres.json();
            const results = sjs.data || sjs || [];
            if (!Array.isArray(results) || !results.length) return null;
            // populate tvdb input with discovered series id
            try {
              const top = results[0];
              if (top && top.id) setTvdbInputs(m => ({ ...m, [key]: { ...(m[key]||{ type: 'series' }), id: top.id, type: top.type || 'series' } }));
            } catch {}
            const seriesId = results[0].id;
            debug('fetching episode title for seriesId', seriesId, 'season', season, 'episode', ep);
            const eres = await fetch(`/api/episode-title?seriesId=${encodeURIComponent(String(seriesId))}&season=${encodeURIComponent(String(season))}&episode=${encodeURIComponent(String(ep))}`);
            if (!eres.ok) return null;
            const r = await eres.json();
            // cache response
            try { responseCacheRef.current.set(dedupeKey, { ts: Date.now(), value: r }); } catch (e) {}
            return r;
          })();
          inflightRequestsRef.current.set(dedupeKey, promise);
          // ensure we clean up inflight entry when done
          promise.finally(() => { try { inflightRequestsRef.current.delete(dedupeKey); } catch {} });
        } else {
          debug('awaiting inflight request for', dedupeKey);
        }

        ej = await promise;
      }
    }
    if (!ej) return;
    const title = ej.title || null;
  if (title) {
        // merge back into item inferred
        const newInferred = { ...inf, episode_title: title };
        // update parsedName if desired
        const paddedS = String(season).padStart(2, '0');
        const paddedE = String(ep).padStart(2, '0');
  const base = inf.title || (inf.parsedName ? String(inf.parsedName).split(' - ')[0] : '');
        newInferred.parsedName = `${base} - S${paddedS}E${paddedE} - ${title}`;
        newInferred.jellyfinExample = `${base}/Season ${paddedS}/${base} - S${paddedS}E${paddedE} - ${title}`;
        // write back — defer applying UI updates if item is currently visible to avoid flicker
        const updatedItem = { ...item, inferred: newInferred };
        const globalKey = `${lib.id}::${key}`;
        const normPath = item?.path ? normalizePath(item.path) : null;
        if (silent) {
          // For silent scans, persist the update but do not apply UI changes or show fetching indicators
          if (normPath) {
            scannedUpdatesRef.current.set(normPath, updatedItem);
            scannedPathsRef.current.add(normPath);
            try { sessionStorage.setItem('dashboard.scannedUpdates', JSON.stringify(Object.fromEntries(Array.from(scannedUpdatesRef.current.entries())))); } catch {}
            try { sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(Array.from(scannedPathsRef.current))); } catch {}
            try { persistScannedUpdatesToServer().catch(()=>{}); } catch(e){}
          }
        } else {
          if (visibleSetRef.current.has(globalKey)) {
            // keep in-memory pending update; will be applied when item leaves view
            pendingUpdatesRef.current.set(globalKey, updatedItem);
            if (normPath) {
              scannedUpdatesRef.current.set(normPath, updatedItem);
              scannedPathsRef.current.add(normPath);
              try { sessionStorage.setItem('dashboard.scannedUpdates', JSON.stringify(Object.fromEntries(Array.from(scannedUpdatesRef.current.entries())))); } catch {}
              try { sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(Array.from(scannedPathsRef.current))); } catch {}
              try { persistScannedUpdatesToServer().catch(()=>{}); } catch(e){}
            }
          } else {
            setScanItems(s => ({ ...s, [lib.id]: (s[lib.id] || []).map((it: any) => it.id === key ? updatedItem : it) }));
            if (normPath) {
              scannedUpdatesRef.current.set(normPath, updatedItem);
              scannedPathsRef.current.add(normPath);
              try { sessionStorage.setItem('dashboard.scannedUpdates', JSON.stringify(Object.fromEntries(Array.from(scannedUpdatesRef.current.entries())))); } catch {}
              try { sessionStorage.setItem('dashboard.scannedPaths', JSON.stringify(Array.from(scannedPathsRef.current))); } catch {}
            }
          }
        }
        return updatedItem;
      }
    } catch (err) {
    debug('fetchEpisodeTitleIfNeeded error', err);
    } finally {
      if (!silent) setFetchingEpisodeMap(m => { const c = { ...m }; delete c[key]; return c; });
    }
    return null;
  }

  async function approveItem(lib: Library, item: any) {
  debug('approveItem called', lib.id, item.id);
    const key = item.id;
    try {
      // Build a match candidate from manual input if present, otherwise try to auto-preview
      const tv = tvdbInputs[key];
      let selections: any[] = [];
      if (tv && tv.id) {
        const type = tv.type || (item.inferred?.kind || 'movie');
        if (type === 'movie') {
          selections = [{ item, type: 'movie', match: { id: Number(tv.id), name: item.inferred?.title || item.path, year: item.inferred?.year } }];
        } else {
          const season = item.inferred?.season ?? 1;
          const episodes = item.inferred?.episodes && item.inferred.episodes.length ? item.inferred.episodes : (item.inferred?.absolute && item.inferred.absolute.length ? item.inferred.absolute : [1]);
          const episodeTitle = item.inferred?.episode_title ?? undefined;
          selections = [{ item, type: 'series', match: { id: Number(tv.id), name: item.inferred?.title || item.path, year: item.inferred?.year }, season, episodes, episodeTitle }];
        }
      } else {
        // Attempt auto-preview server-side which uses local heuristics
        const res = await fetch('/api/auto-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: lib.id, item }) });
        if (!res.ok) throw new Error(`Auto-preview failed (${res.status})`);
        const js = await res.json();
        if (!(js.plans && js.plans.length)) {
          setError('No confident auto-match found; provide a TVDB ID or run a manual search');
          return;
        }
        // apply returned plans directly
        const renameRes = await fetch('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plans: js.plans, libraryId: lib.id }) });
        if (!renameRes.ok) throw new Error(`Approve failed (${renameRes.status})`);
        const rr = await renameRes.json();
        setScanItems(s => ({ ...s, [lib.id]: (s[lib.id] || []).filter((it: any) => it.id !== key) }));
        return;
      }

      // If we have selections built from manual input, call preview then rename
      const preRes = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: lib.id, selections }) });
      if (!preRes.ok) throw new Error(`Preview failed (${preRes.status})`);
      const preJs = await preRes.json();
      const plans = preJs.plans || [];
      if (!plans.length) {
        setError('Preview did not return plans');
        return;
      }
      const renameRes = await fetch('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plans, libraryId: lib.id }) });
      if (!renameRes.ok) throw new Error(`Approve failed (${renameRes.status})`);
      const rr = await renameRes.json();
      // remove item from list after apply
      setScanItems(s => ({ ...s, [lib.id]: (s[lib.id] || []).filter((it: any) => it.id !== key) }));
    } catch (e: any) {
      setError(e?.message ?? 'Approve failed');
    }
  }

  async function massApproveSelected() {
    try {
      setApplying(true);
      // Iterate libraries and selected items within each
      for (const lib of libraries) {
        const items = (scanItems[lib.id] || []);
        for (const it of items) {
          if (!it) continue;
          if (!selectedItems[it.id]) continue;
          // call approveItem for each selected item and wait for it to complete
          try {
            // eslint-disable-next-line no-await-in-loop
            await approveItem(lib, it);
          } catch (e) {
            debug('mass approve error for', it.path, e);
          }
        }
      }
    } finally {
      setApplying(false);
      setSelectedItems({});
      setSelectMode(false);
    }
  }

  async function previewMatch(lib: Library, item: any, match: any, type: 'movie' | 'series') {
  debug('previewMatch called', lib.id, item.id, match?.id, type);
    // Ask server to build rename plans
    try {
      // Ensure match.year is present when available from inferred data so the
      // server can include the year in the planned path. Populate from
      // item.inferred.year if match.year is missing.
      if (match && !match.year && item?.inferred?.year) {
        match = { ...match, year: item.inferred.year };
      }
      const selection: any = { item, type, match };
      if (type === 'series') {
        const season = item.inferred?.season ?? 1;
        const episodes = item.inferred?.episodes && item.inferred.episodes.length ? item.inferred.episodes : (item.inferred?.absolute && item.inferred.absolute.length ? item.inferred.absolute : [1]);
        const episodeTitle = item.inferred?.episode_title ?? undefined;
        selection.season = season;
        selection.episodes = episodes;
        selection.episodeTitle = episodeTitle;
      }
      const body = { libraryId: lib.id, selections: [selection] };
      const res = await fetch('/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
  const js = await res.json();
  setPreviewPlans(p => ({ ...p, [item.id]: js.plans || [] }));
  // Best-effort: enrich the plans so the UI shows series year and metadataTitle like final output
  try { enrichPreviewPlansForItem(item.id, js.plans || []); } catch (e) { /* ignore */ }
  // If the preview returned plans with a TVDB id, populate the TVDB input
      try {
        const plan = (js.plans && js.plans[0]) || null;
        const key = item.id;
        if (plan && plan.meta && plan.meta.tvdbId) {
          setTvdbInputs(m => ({ ...m, [key]: { ...(m[key]||{}), id: plan.meta.tvdbId, type: plan.meta.type || type } }));
        }
      } catch {}
    } catch (e: any) {
      setError(e?.message ?? 'Preview failed');
    }
  }

  async function autoPreview(lib: Library, item: any) {
  console.debug('autoPreview called', lib.id, item.id);
    try {
      const res = await fetch('/api/auto-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: lib.id, item })
      });
      if (!res.ok) throw new Error(`Auto preview failed (${res.status})`);
      const js = await res.json();
      if (js.plans && js.plans.length) {
        setPreviewPlans(p => ({ ...p, [item.id]: js.plans }));
        try { enrichPreviewPlansForItem(item.id, js.plans); } catch (e) { /* ignore */ }
        // Populate TVDB input from the auto-preview plans (useful when server auto-matches a series)
        try {
          const plan = js.plans[0];
          if (plan && plan.meta && plan.meta.tvdbId) {
            setTvdbInputs(m => ({ ...m, [item.id]: { ...(m[item.id]||{}), id: plan.meta.tvdbId, type: plan.meta.type || 'series' } }));
          }
        } catch {}
      } else {
        setError('No confident auto-match found');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Auto preview failed');
    }
  }

  // Throttled preview for large libraries: runs sequentially with a small delay between items
  async function previewAllThrottled(lib: Library) {
    const items = (scanItems[lib.id] || []);
    setPreviewingMap(m => ({ ...m, [lib.id]: true }));
    try {
      for (const it of items) {
        try {
          // small delay to avoid hammering APIs
          await new Promise(r => setTimeout(r, 200));
          await fetchEpisodeTitleIfNeededClient(lib, it).catch(() => {});
          await autoPreview(lib, it).catch(() => {});
        } catch (e) {
          // continue
        }
      }
      // clear skipped flag
      setPreviewSkippedMap(m => { const c = { ...m }; delete c[lib.id]; return c; });
    } finally {
      setPreviewingMap(m => { const c = { ...m }; delete c[lib.id]; return c; });
    }
  }

  async function applyPlans(lib: Library, itemId: string) {
    const plans = previewPlans[itemId];
    if (!plans || plans.length === 0) return;
    setApplying(true);
    try {
      const res = await fetch('/api/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plans, libraryId: lib.id })
      });
      if (!res.ok) throw new Error(`Rename failed (${res.status})`);
      const js = await res.json();
      // remove applied items from that library's list
      setScanItems(s => ({ ...s, [lib.id]: (s[lib.id] || []).filter((it: any) => it.id !== itemId) }));
      setPreviewPlans(p => { const c = { ...p }; delete c[itemId]; return c; });
    } catch (e: any) {
      setError(e?.message ?? 'Rename failed');
    } finally {
      setApplying(false);
    }
  }

  // Enrich preview plans with TVDB year when missing so UI shows final output year
  async function enrichPreviewPlansForItem(itemId: string, plans: any[]) {
    try {
      if (!plans || !plans.length) return;
      const updated = [...plans];
      let changed = false;
      for (let i = 0; i < updated.length; i++) {
        const plan = updated[i];
        try {
          const isSeries = (plan?.meta?.type === 'series') || (plan?.meta?.match && plan.meta.match.type === 'series');
          if (!isSeries) continue;
          let year = plan?.meta?.year;
          if (!year) {
            // Try to extract from output path
            const outStr = plan?.meta?.output || plan?.to || '';
            const m = String(outStr).match(/\((\d{4})\)/);
            if (m) year = Number(m[1]);
          }
          if (!year) {
            // Try to search TVDB by series name
            const seriesName = plan?.meta?.match?.name || plan?.meta?.metadataTitle || '';
            if (seriesName) {
              const res = await fetch(`/api/search?type=series&q=${encodeURIComponent(seriesName)}`);
              if (res.ok) {
                const js = await res.json();
                const results = js.data || js || [];
                if (Array.isArray(results) && results.length) {
                  const top = results[0];
                  if (top && top.year) year = Number(top.year);
                  // fallback: some responses use 'first_air_time' or 'firstAired'
                  if (!year && top.first_air_time) {
                    const y = String(top.first_air_time).slice(0,4);
                    if (/^\d{4}$/.test(y)) year = Number(y);
                  }
                }
              }
            }
          }

          if (year) {
            // update meta.year and metadataTitle to include year after prefix
            plan.meta = plan.meta || {};
            plan.meta.year = Number(year);
            let metaTitle = plan.meta.metadataTitle || '';
            if (!metaTitle && (plan.meta.output || plan.to)) {
              const out = plan.meta.output || plan.to || '';
              metaTitle = out.split(/[\\/]+/).pop()?.replace(/\.[^.]+$/, '') || '';
            }
            if (metaTitle) {
              const yearStr = String(year);
              const parts = String(metaTitle).split(' - ');
              const prefix = parts.shift() || '';
              const rest = parts.join(' - ');
              const prefixYearRegex = new RegExp(`\\(\\s*${yearStr}\\s*\\)`);
              let newPrefix = prefix;
              if (!prefixYearRegex.test(prefix)) {
                newPrefix = `${prefix} (${yearStr})`;
              }
              plan.meta.metadataTitle = rest ? `${newPrefix} - ${rest}` : newPrefix;
              // Update meta.output to reflect metadataTitle in filename
              const out = plan.meta.output || plan.to || '';
              if (out) {
                try {
                  const extMatch = out.match(/(\.[^./\\]+)$/);
                  const ext = extMatch ? extMatch[1] : '';
                  const dir = out.replace(/[^\\/]+$/, '');
                  plan.meta.output = dir + (plan.meta.metadataTitle || '') + ext;
                } catch (e) {}
              }
            }
            updated[i] = plan;
            changed = true;
          }
        } catch (e) { /* best-effort for each plan */ }
      }
      if (changed) setPreviewPlans(p => ({ ...p, [itemId]: updated }));
    } catch (e) {
      // ignore enrichment failures
    }
  }

  // Render a single library card (extracted to avoid duplicating markup)
  const renderLibraryCard = (lib: Library) => {
    // Determine items to show for this library; apply search filter when present
    const allItems = (scanItems[lib.id] || []);
    const q = (searchQuery || '').trim().toLowerCase();
    const itemsToShow = q ? allItems.filter((item: any) => {
      try {
        const hay = [item.path, item.inferred?.parsedName, item.inferred?.title, item.inferred?.episode_title, (previewPlans[item.id] && previewPlans[item.id][0] && previewPlans[item.id][0].meta && previewPlans[item.id][0].meta.metadataTitle) || ''].join(' ').toLowerCase();
        return hay.indexOf(q) !== -1;
      } catch (e) { return false; }
    }) : allItems;

    return (
      <div className="card p-4">
          <div className="flex justify-between items-center" style={{ minHeight: 64 }}>
          <div>
            <div className="font-semibold">{lib.name}</div>
            <div className="text-xs text-muted break-all">{(lib as any).inputRoot || (lib as any).path || (lib as any).libraryPath}</div>
          </div>
          <div>
            <button className={buttons.base} onClick={() => scanLibrary(lib)} disabled={!!scanningMap[lib.id]}>Scan</button>
            {/* Show scanning overlay/progress when a full scan is running */}
            {scanProgress[lib.id] && (
              (() => {
                const p = scanProgress[lib.id];
                const done = p.done || 0;
                const total = p.total || 0;
                const elapsed = Math.max(1, Date.now() - p.start);
                const rate = done / (elapsed / 1000); // items/sec
                const remaining = Math.max(0, total - done);
                const etaSec = rate > 0 ? Math.round(remaining / rate) : null;
                return (
                  <div className="inline-block ml-4 p-2 bg-card/80 rounded shadow-sm text-sm">
                    <div className="flex items-center gap-2"> 
                      <div className="font-medium">Scanning</div>
                      <span className="loader-wave"><span className="b"/><span className="b"/><span className="b"/><span className="b"/></span>
                    </div>
                    <div className="mt-1">{done}/{total}</div>
                    <div className="text-xs text-muted">{etaSec !== null ? `ETA ${Math.round(etaSec)}s` : 'Estimating…'}</div>
                    <div className="mt-2">
                      <button className={buttons.base + ' mr-2'} onClick={() => {
                        // cancel scanning for this lib: clear progress and stop background metadata
                        setScanProgress(s => { const c = { ...s }; delete c[lib.id]; return c; });
                        libraryMetaRef.current[lib.id] = { ...(libraryMetaRef.current[lib.id] || {}), bgRunning: false };
                        setScanningMap(m => ({ ...m, [lib.id]: false }));
                        try { persistScanState(lib.id); } catch (e) {}
                      }}>Cancel</button>
                    </div>
                  </div>
                );
              })()
            )}
            {initialPrefetchingMap[lib.id] && <span className="ml-2 text-sm text-muted">Prefetching…</span>}
            {previewSkippedMap[lib.id] && (
              <button className={buttons.base} onClick={() => previewAllThrottled(lib)} disabled={!!previewingMap[lib.id]}>Preview all (throttled)</button>
            )}
            <button className={buttons.base + ' ml-2'} onClick={async () => {
              try {
                const res = await fetch(`/api/libraries/${encodeURIComponent(lib.id)}`, { method: 'DELETE' });
                if (!res.ok) throw new Error(`Delete failed (${res.status})`);
                const js = await res.json();
                setLibraries(Array.isArray(js.libraries) ? js.libraries : (await (await fetch('/api/libraries')).json()));
              } catch (e: any) { setError(e?.message ?? 'Delete failed'); }
            }} title="Remove library">🗑️ Remove</button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {libraryMetaRef.current[lib.id]?.hideWhileScanning ? (
            <div className="text-sm text-muted">Scanning library… results will appear when complete.</div>
          ) : itemsToShow.length === 0 ? (
            <div className="text-sm text-muted">No scanned items{q ? ' match your search' : ''}.</div>
          ) : (
            (() => {
              // Use a top-level per-library virtualization state to avoid hooks inside render
              const vsKey = String(lib.id);
              if (!virtualListStateRef.current[vsKey]) {
                virtualListStateRef.current[vsKey] = { sizeMap: {}, listRef: { current: null } } as any;
              }
              const vstate = virtualListStateRef.current[vsKey];
              const getSize = (index: number) => vstate.sizeMap[index] || 120;
              const setSize = (index: number, size: number) => {
                try {
                  // Normalize size to integer and ignore tiny fluctuations
                  const normalized = Math.ceil(size || 0);
                  const prev = vstate.sizeMap[index] || 0;
                  if (Math.abs(prev - normalized) <= 2) return;
                  vstate.sizeMap[index] = normalized;
                  // Use the `forceUpdate` flag as false to let react-window batch
                  // internal changes and avoid triggering an immediate heavy reflow.
                  try { vstate.listRef.current?.resetAfterIndex(index, false); } catch (e) {}
                } catch (e) { /* ignore measurement errors */ }
              };

              const itemCount = itemsToShow.length;
              const Row = ({ index, style }: { index: number; style: any }) => {
                const item = itemsToShow[index];
                const mapKey = `${lib.id}::${item.id}`;
                const hydrated = !!hydratedMap[mapKey];
                // ref callback to measure element height without hooks (react-window render-prop)
                // Debounce ResizeObserver notifications to avoid frequent calls which
                // cause react-window to reset rows and produce hover/click jitter.
                const refCallback = (el: HTMLDivElement | null) => {
                  try {
                    // Clear previous observer and timer if present
                    try {
                      const prev = (el as any)?.__mr_ro;
                      if (prev) try { prev.disconnect(); } catch {}
                    } catch {}

                    if (el === null) return;

                    const measure = () => {
                      try { setSize(index, Math.ceil(el.getBoundingClientRect().height)); } catch (e) {}
                    };

                    // Initial immediate measurement
                    measure();

                    try {
                      if ((window as any).ResizeObserver) {
                        const ro = new (window as any).ResizeObserver(() => {
                          try {
                            // debounce per-element using a timer stored on the DOM node
                            try { clearTimeout((el as any).__mr_to); } catch {}
                            (el as any).__mr_to = setTimeout(() => measure(), 140);
                          } catch (e) { /* ignore RO callback errors */ }
                        });
                        (el as any).__mr_ro = ro;
                        ro.observe(el);
                      }
                    } catch (e) { /* ignore RO errors */ }
                  } catch (e) { /* ignore measure errors */ }
                };

                if (libraryMetaRef.current[lib.id] && libraryMetaRef.current[lib.id].hideWhileScanning) {
                  return (
                    <div style={style} key={item.id}>
                      <div ref={refCallback} className="p-2 text-sm text-muted">Scanning… results will appear when the scan completes.</div>
                    </div>
                  );
                }

                return (
                  <div style={style} key={item.id} data-item-id={item.id} data-lib-id={lib.id}>
                    <div ref={refCallback} className="scan-item">
                      {!hydrated ? (
                        <div className="font-mono break-all">{item.path}</div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="text-xl">{(tvdbInputs[item.id]?.type || item.inferred?.kind) === 'movie' ? '🎬' : '📺'}</div>
                          <div className="flex-1">
                            <div className="font-mono break-all">{item.path}</div>
                            <div className="text-sm text-muted">{item.inferred?.parsedName || item.inferred?.title || ''}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button className={buttons.base} onClick={() => rescanItem(lib, item)}>🔄</button>
                            <button className={buttons.base} onClick={() => autoPreview(lib, item)}>🤖</button>
                            <button className={buttons.base} onClick={() => searchTVDBFor(item)}>🔍</button>
                            <input className="input text-sm" style={{ width: 110 }} placeholder="TVDB" value={tvdbInputs[item.id]?.id ?? ''} onChange={e => setTvdbInputs(m => ({ ...m, [item.id]: { ...(m[item.id]||{type: item.inferred?.kind||'series'}), id: e.target.value } }))} />
                            <button className={buttons.base} onClick={() => approveItem(lib, item)}>✅</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <List ref={(vstate.listRef as any)} height={Math.min(1200, itemCount * 120)} itemCount={itemCount} itemSize={getSize} width={'100%'}>
                  {Row}
                </List>
              );
            })()
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <button title="Toggle select mode for items" className={buttons.base} onClick={() => setSelectMode(s => { const next = !s; if (!next) setSelectedItems({}); return next; })}>
            {selectMode ? 'Exit select' : 'Select'}
          </button>
          {selectMode && (
            <button className={buttons.base} onClick={async () => await massApproveSelected()} disabled={!Object.values(selectedItems).some(Boolean) || applying}>
              Mass approve
            </button>
          )}
          <button title="Scan all configured libraries sequentially" className={buttons.base} onClick={async () => {
            if (libraries.length === 0) { setError('No libraries configured. Add one in Settings.'); return; }
            setError(null); setScanningAll(true);
            try {
              // Use the same streaming/hidden-until-complete scan flow for each library
              for (const lib of libraries) {
                try {
                  await scanLibrary(lib);
                } catch (e: any) {
                  // Continue to next library but record summary
                  debug('scan all: library scan failed', lib.id, e);
                  setScanSummary((e?.message) ?? `Scan failed for ${lib.name}`);
                }
              }
            } catch (e: any) {
              setScanSummary((e?.message) ?? 'Scan failed');
            } finally { setScanningAll(false); setTimeout(() => setScanSummary(null), 4000); }
          }} disabled={scanningAll || loading || libraries.length === 0}>
            {scanningAll ? (<span className="loader-wave"><span className="b"/><span className="b"/><span className="b"/><span className="b"/></span>) : 'Scan all libraries'}
          </button>
          <button title="Show or hide previously saved bulk scan results" className={buttons.base} onClick={() => setShowBulkResults(s => !s)} disabled={!bulkSaved}>
            {showBulkResults ? 'Hide bulk results' : 'View bulk results'}
          </button>
          <button title="Clear cached scans" className={buttons.base + ' ml-2'} onClick={async () => {
            try {
              await fetch('/api/scan-cache', { method: 'DELETE' });
            } catch {}
            try { sessionStorage.removeItem('dashboard.scanItems'); } catch {}
            setScanItems({});
          }}>
            Clear cached scans
          </button>
        </div>
      </div>

      <div className="mt-3">
        <input className="input" placeholder="Search scanned items (filename, title...)" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
      </div>

      {loading && <p className="text-muted">Loading libraries…</p>}
      {error && <p className="text-red-500">Error: {error}</p>}

      {!loading && !error && libraries.length > 0 && (
        <div className="space-y-4">
          {shownLibraries.map(lib => (
            selectMode ? (
              <div key={lib.id} style={{ position: 'relative', marginBottom: 12 }}>
                <div style={{ marginLeft: 56 }}>
                  {renderLibraryCard(lib)}
                </div>
              </div>
            ) : (
              <div key={lib.id}>
                {renderLibraryCard(lib)}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
