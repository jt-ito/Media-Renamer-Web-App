import { finalizePlan } from './renamer.js';

async function test() {
  const plan = {
    from: 'C:\\tmp\\source.mkv',
    to: 'C:\\media\\My Series\\My Series - S01E01 - Pilot.mkv',
    action: 'hardlink',
    dryRun: true,
    meta: {
  tvdbId: 123,
      type: 'series',
      output: 'C:\\media\\My Series\\My Series - S01E01 - Pilot.mkv',
      metadataTitle: 'My Series - S01E01 - Pilot',
      year: 2018
    }
  };
  const res = await finalizePlan(plan);
  console.log('RESULT:', JSON.stringify({ to: res.to, output: res.meta?.output, metadataTitle: res.meta?.metadataTitle, year: res.meta?.year }, null, 2));
}

test().catch(e => { console.error('ERR', e); process.exit(1); });
