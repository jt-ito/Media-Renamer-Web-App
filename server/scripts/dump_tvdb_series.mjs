#!/usr/bin/env node
/*
  Usage: node server/scripts/dump_tvdb_series.mjs <seriesId>
  Requires TVDB API key via config/settings.json tvdbKey or TVDB_API_KEY env var.
*/
import { tvdb } from '../src/tvdb.js';

async function main() {
  const id = Number(process.argv[2]);
  if (!id) {
    console.error('Usage: node server/scripts/dump_tvdb_series.mjs <seriesId>');
    process.exit(2);
  }
  try {
    const js = await tvdb(`/series/${id}`);
    console.log(JSON.stringify(js, null, 2));
  } catch (e) {
    console.error('Error fetching series:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
