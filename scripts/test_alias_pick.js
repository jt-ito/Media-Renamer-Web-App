// Lightweight test harness to validate alias scoring logic (plain JS so it runs without project deps)
const cjkRe = /[\u3040-\u30ff\u4e00-\u9fff]/;
function pickBestAlias(aliases) {
  if (!aliases || !aliases.length) return undefined;
  const cand = aliases.map(a => {
    if (!a) return null;
    if (typeof a === 'string') return { name: a, lang: undefined };
    const name = a.name || a.title || a.translation || a.value || a.alias;
    const lang = a.language || a.iso_639_3 || a.lang;
    return { name, lang };
  }).filter(Boolean);
  const filtered = cand.map(c => ({ s: String(c.name || ''), lang: c.lang })).filter(x => x.s && !cjkRe.test(x.s));
  if (!filtered.length) return undefined;
  function score(s) {
    let sc = 0;
    const len = s.length;
    if (/^[\x00-\x7F]*$/.test(s)) sc += 40;
    if (s.includes(':')) sc += 20;
    sc -= Math.abs(len - 30);
    if (/[A-Z][a-z]/.test(s)) sc += 5;
    if (/[“”‘’]/.test(s)) sc -= 5;
    return sc;
  }
  filtered.sort((a, b) => score(b.s) - score(a.s));
  return filtered[0].s;
}

const aliases = [
  "A Married Woman's Lips Taste Like Canned Chūhai",
  "A Married Woman's Lips Taste Like Canned Chuuhai",
  "A Married Woman's Lips Taste of Canned Highball",
  "Married Women's Lips Taste Like A Can of Chuhai",
  "Chuhai Lips Canned Flavor of Married Women",
  "Chuhai Lips: Canned Flavor of Married Women",
  "Chuhai Lips"
];

console.log('aliases input:');
aliases.forEach((a, i) => console.log(`${i+1}: ${a}`));
const picked = pickBestAlias(aliases);
console.log('\npicked:', picked);
