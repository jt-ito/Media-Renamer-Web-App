// Simulate finalizePlan behaviour: replace episode title portion with TVDB-provided title if available
const path = require('path');
function simulateFinalize(metaTitle, tvdbTitle) {
  const ext = '.mkv';
  const metaPrefix = metaTitle.split(' - ')[0] || '';
  const codePart = metaTitle.split(' - ').find(x=>/^S\d{2}E\d{2}/i.test(x)) || '';
  const seriesBase = metaPrefix.replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim();
  let newMeta = metaTitle;
  if (tvdbTitle && codePart) {
    newMeta = `${metaPrefix} - ${codePart} - ${tvdbTitle}`;
  }
  const finalPath = path.join('output', metaPrefix, newMeta + ext);
  return { newMeta, finalPath };
}

const metaTitle = 'Chuhai Lips Canned Flavor of Married Women (2025) - S01E01 - The Flavor of My Strict Aunts Lips ESub ToonsHub';
const tvdbTitle = 'The Flavor of My Strict Aunt\'s Lips';
const res = simulateFinalize(metaTitle, tvdbTitle);
console.log(res);
