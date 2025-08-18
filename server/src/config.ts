import fs from 'fs';
import path from 'path';
import { Library } from './types.js';

const CONFIG_PATH = process.env.CONFIG_PATH || '/app/config/config.json';

export function loadLibraries(): Library[] {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Library[];
    // Normalize stored paths for the host OS
    const normalized = raw.map(l => ({
      ...l,
      inputRoot: l.inputRoot ? path.resolve(l.inputRoot) : l.inputRoot,
      outputRoot: (l as any).outputRoot ? path.resolve((l as any).outputRoot) : (l as any).outputRoot,
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