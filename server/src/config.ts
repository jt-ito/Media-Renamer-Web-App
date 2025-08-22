import fs from 'fs';
import path from 'path';
import { Library } from './types.js';

const CONFIG_PATH = process.env.CONFIG_PATH || '/app/config/config.json';

export function loadLibraries(): Library[] {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Library[];
    // Normalize stored paths for the host OS. Accept both Windows and Linux
    // style paths submitted from the UI and try sensible fallbacks when the
    // configured path doesn't exist on the current host.
    function normalizeForHost(p?: string) {
      if (!p) return p;
      let s = String(p).trim();
      // Replace Windows backslashes with forward slashes and collapse repeats
      s = s.replace(/\\+/g, '/');
      s = s.replace(/\/\/+/, '/');
      s = s.replace(/\/\/+/, '/');
      // Collapse multiple forward slashes
      s = s.replace(/\/\/+/, '/');
      s = s.replace(/\/\/+/, '/');
      s = s.replace(/\/\/+/, '/');
      // Build candidate list
      const candidates: string[] = [s];
      const m = s.match(/^([A-Za-z]):\/(.*)$/);
      if (m && process.platform !== 'win32') {
        const drive = m[1].toLowerCase();
        const rest = m[2] || '';
        candidates.push(`/mnt/${drive}/${rest}`);
      }
      const unc = s.match(/^\/\/(.+)$/);
      if (unc && process.platform !== 'win32') {
        candidates.push(s.replace(/^\/+/, '/'));
      }

      for (const c of candidates) {
        try {
          const resolved = path.resolve(c);
          if (fs.existsSync(resolved)) return resolved;
        } catch (e) { /* ignore */ }
      }

      return path.resolve(s);
    }

    const normalized = raw.map(l => ({
      ...l,
      inputRoot: l.inputRoot ? normalizeForHost(l.inputRoot) : l.inputRoot,
      outputRoot: (l as any).outputRoot ? normalizeForHost((l as any).outputRoot) : (l as any).outputRoot,
    }));
    // Deduplicate by type+inputRoot+outputRoot, keeping the first occurrence
    const seen = new Set<string>();
    const unique: Library[] = [];
    for (const l of normalized) {
      const key = `${l.type || ''}|${l.inputRoot || ''}|${(l as any).outputRoot || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(l);
      }
    }
    return unique;
  } catch {
    return [];
  }
}

export function saveLibraries(libs: Library[]) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  // Ensure we save normalized absolute paths
  const normalized = libs.map(l => ({
    ...l,
    inputRoot: l.inputRoot ? path.resolve(l.inputRoot) : l.inputRoot,
    outputRoot: (l as any).outputRoot ? path.resolve((l as any).outputRoot) : (l as any).outputRoot,
  }));
  // Deduplicate before saving (keep first occurrence)
  const seen = new Set<string>();
  const unique: Library[] = [];
  for (const l of normalized) {
    const key = `${l.type || ''}|${l.inputRoot || ''}|${(l as any).outputRoot || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(l);
    }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(unique, null, 2));
}