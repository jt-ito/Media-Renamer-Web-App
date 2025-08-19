import fetch from 'node-fetch';

async function run() {
  const body = {
    libraryId: 'lib-meetyydx-250ont',
    selections: [{
      item: { id: 'fake', path: 'C:\\tmp\\My Series - S01E01.mkv', ext: '.mkv', inferred: { title: 'My Series', season:1, episodes:[1] } },
      type: 'series',
      match: { id: 123, name: 'My Series', year: 2018 },
      season: 1,
      episodes: [1],
      episodeTitle: 'Pilot'
    }]
  };
  const res = await fetch('http://localhost:8787/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const js = await res.json();
  console.log(JSON.stringify(js, null, 2));
}
run().catch(e => console.error(e));
