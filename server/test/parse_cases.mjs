import { inferFromPath } from './run_infer.js';

const cases = [
  {
    name: 'Single episode SxxExx',
    input: 'Show.Name.S02E05.Title.1080p.WEB-DL.mkv',
    expect: { kind: 'series', season: 2, episode_number: 5 }
  },
  {
    name: 'Multi episode range E01-03',
    input: 'Show.Name.E01-03.1080p.mkv',
    expect: { kind: 'series', episodes: [1,2,3] }
  },
  {
    name: 'Absolute episode with OVA hint',
    input: 'Show.Name.OVA.05.1080p.mkv',
    expect: { kind: 'series', absolute: [5] }
  },
  {
    name: 'Movie detection',
    input: 'Some.Movie.Title.2019.1080p.mkv',
  expect: { kind: 'movie', titlePrefix: 'Some Movie Title' }
  }
];

let failed = 0;
for (const c of cases) {
  const out = inferFromPath(c.input);
  const ok = Object.keys(c.expect).every(k => {
    const v = c.expect[k];
  if (Array.isArray(v)) return JSON.stringify(out[k]) === JSON.stringify(v);
  if (k === 'titlePrefix') return typeof out.title === 'string' && out.title.startsWith(v);
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return out[k] === v;
    return true;
  });
  if (!ok) {
    console.error('FAIL:', c.name, '\n input:', c.input, '\n got:', out, '\n expect:', c.expect);
    failed++;
  } else {
    console.log('PASS:', c.name);
  }
}
process.exit(failed > 0 ? 1 : 0);
