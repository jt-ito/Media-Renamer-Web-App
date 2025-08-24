// server/src/tvdbHelpers.ts
import { MediaType } from './types.js';

export function pickTvdbCandidate(parsedName: string | undefined, inferredYear: number | undefined, results: any[]): any | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  const clean = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const pn = clean(parsedName || '');
  for (const r of results) {
    try {
      const cn = clean(r.name || r.title || '');
      if (!cn) continue;
      if (pn && (cn.includes(pn) || pn.includes(cn))) return r;
      if (inferredYear && r.year && Number(r.year) === Number(inferredYear)) return r;
      const pTokens = pn ? pn.split(' ') : [];
      const cTokens = cn.split(' ');
      const common = pTokens.filter(t => t && cTokens.includes(t));
      if (pTokens.length && common.length >= Math.min(3, Math.max(1, Math.floor(pTokens.length / 2)))) return r;
    } catch (e) { /* ignore per-candidate errors */ }
  }
  return null;
}
