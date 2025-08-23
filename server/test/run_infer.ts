import { inferFromPath } from '../src/parse.js';

const sample = 'Chuhai.Lips.Canned.Flavor.of.Married.Women.S01E01.The.Flavor.of.My.Strict.Aunts.Lips.1080p.UNCENSORED.OV.WEB-DL.DUAL.VIDEO.DUAL.AUDIO.AAC2.0.H.264-ToonsHub.mkv';

console.log(JSON.stringify(inferFromPath(sample), null, 2));
