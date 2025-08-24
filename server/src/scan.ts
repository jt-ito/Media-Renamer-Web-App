// server/src/scan.ts
import fs from 'fs';
import path from 'path';
import { getSeries } from './tvdb.js';

export function normalizePathForCache(p: string) {
  return String(p || '').replace(/\\+/g, '/');
}

export async function ensurePlanYears(plans: any[]) {
  try {
    for (const p of plans) {
      try {
        if (!p || !p.meta) continue;
        if (p.meta.type === 'series' && !p.meta.year && p.meta.tvdbId) {
          try {
            const s = await getSeries(Number(p.meta.tvdbId));
            const maybe = s?.firstAired || s?.firstAiredAt || s?.releaseDate || s?.released || s?.firstAiredDate
              || (s?.attributes && (s.attributes.firstAired || s.attributes.firstAiredAt || s.attributes.releaseDate || s.attributes.released || s.attributes.firstAiredDate))
              || (s?.data && (s.data.firstAired || s.data.firstAiredAt || s.data.releaseDate || s.data.released || s.data.firstAiredDate));
            const y = maybe ? String(maybe).slice(0,4) : undefined;
            if (y && /^\d{4}$/.test(y)) p.meta.year = Number(y);
          } catch (e) { /* ignore per-plan */ }
        }
      } catch (e) { /* per-plan best-effort */ }
    }
  } catch (e) {}
  return plans;
}

export async function normalizePlansForPreview(plans: any[]) {
  try {
    const { finalizePlan } = await import('./renamer.js');
    for (const p of plans) {
      try {
        if (!p) continue;
        try { await finalizePlan(p); } catch (e) {}
      } catch (e) { /* per-plan best-effort */ }
    }
  } catch (e) { /* ignore normalize errors */ }
  return plans;
}

export function escapeRegex(s: string) {
  return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}
