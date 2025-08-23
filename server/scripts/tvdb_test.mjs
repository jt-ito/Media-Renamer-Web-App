// Quick TVDB E2E test script (imports project TVDB client directly)
// Usage: node server/scripts/tvdb_test.mjs

import path from 'path';
const tvdbPath = new URL('../dist/tvdb.js', import.meta.url).pathname;

if (!process.env.TVDB_API_KEY) {
  console.error('TVDB test requires the TVDB_API_KEY environment variable to be set.');
  process.exit(2);
}

(async () => {
  try {
    const tv = await import('../dist/tvdb.js');
    console.log('Using TVDB key from env:', Boolean(process.env.TVDB_API_KEY));
    const query = 'Chuhai Lips Canned Flavor of Married Women';
    console.log('\n--- searchTVDB ---');
    const results = await tv.searchTVDB('series', query, 2025);
    console.log(JSON.stringify(results, null, 2));

    if (Array.isArray(results) && results.length) {
      const first = results[0];
      console.log('\n--- getSeries (first result) ---');
      const s = await tv.getSeries(Number(first.id));
      console.log(JSON.stringify(s, null, 2));

      console.log('\n--- getEpisodeByAiredOrder (S01E01) ---');
      try {
        const ep = await tv.getEpisodeByAiredOrder(Number(first.id), 1, 1);
        console.log(JSON.stringify(ep, null, 2));
      } catch (e) {
        console.error('episode lookup failed', String(e));
      }
    }
  } catch (e) {
    console.error('TVDB test failed:', e && e.stack ? e.stack : String(e));
    process.exit(2);
  }
})();
