// Improved test harness mirroring renamer's regex-driven extractor
const path = require('path');

function splitReleaseTags(input) {
  if (!input) return { title: '', tags: [] };
  let tail = String(input);
  const tags = [];
  const push = (t) => { if (!t) return; const v = String(t).trim(); if (v) tags.push(v); };

  const patterns = [
    { re: /(ESub|Hardsub|Softsub|Sub|Subbed)[\-_. ]*([A-Za-z0-9][A-Za-z0-9_\-]{1,60})?/ig, norm: (m) => m[2] ? [m[1].toUpperCase() === 'ESUB' ? 'ESub' : m[1], m[2]] : (m[1].toUpperCase() === 'ESUB' ? 'ESub' : m[1]) },
    { re: /\bAAC2(?:\.0)?\b/ig, norm: () => 'AAC2.0' },
    { re: /\bH\.?264\b/ig, norm: () => 'H.264' },
    { re: /\b(2160p|4k|1080p|720p|480p)\b/ig, norm: (m) => m[1].toLowerCase() },
    { re: /\bWEB[-_. ]?DL\b/ig, norm: () => 'WEB-DL' },
    { re: /\bWEB[-_. ]?RIP\b/ig, norm: () => 'WEB-RIP' },
    { re: /\b(BLURAY|BDRIP|BDREMUX|HDTV)\b/ig, norm: (m) => m[1].toUpperCase() },
    { re: /\b(DTS(?:-HD)?|DDP5\.1|AC3|FLAC)\b/ig, norm: (m) => m[1].toUpperCase() },
    { re: /\b(UNCENSORED|UNCUT|REPACK|PROPER|LIMITED|UNRATED|EXTENDED|REMASTER)\b/ig, norm: (m) => m[1].toLowerCase() },
    { re: /\b(ESUB|HARDSUB|SOFTSUB|ASS|SSA|SRT|SUB|SUBBED|SUBS)\b/ig, norm: (m) => m[1].toUpperCase() },
    { re: /\b(JPN|JAP|JP|ENG|EN|KOR|ZH|CHS|CHT|ITA|FRA|GER)\b/ig, norm: (m) => m[1].toUpperCase() },
    { re: /\b(1080p60|720p60|60fps|30fps|24fps|HDR10|DOLBYVISION|HDR)\b/ig, norm: (m) => m[1].toUpperCase() },
  ];

  for (const p of patterns) {
    let m;
    while ((m = p.re.exec(tail)) !== null) {
      const out = p.norm(m);
      if (Array.isArray(out)) out.forEach(x => push(String(x)));
      else push(String(out));
      const idx = typeof m.index === 'number' ? m.index : 0;
      tail = tail.slice(0, idx) + tail.slice(idx + m[0].length);
      p.re.lastIndex = 0;
    }
  }

  const trailingGroup = tail.match(/(?:[\s._-]+)([A-Za-z][A-Za-z0-9_\-]{2,60})\s*$/);
  if (trailingGroup) {
    const g = trailingGroup[1];
    if (/^[A-Z0-9][A-Za-z0-9_-]*$/.test(g) && (/[A-Z]/.test(g) || g.length <= 6 || /^[A-Z0-9]{2,6}$/.test(g))) {
      push(g);
      tail = tail.slice(0, trailingGroup.index);
    }
  }

  let cleaned = tail.replace(/[._\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\b\d{1,4}\b/g, '').replace(/\s+/g, ' ').trim();

  const normalizedTags = Array.from(new Set(tags));
  return { title: cleaned, tags: normalizedTags };
}

const filename = 'Chuhai.Lips.Canned.Flavor.of.Married.Women.S01E01.The.Flavor.of.My.Strict.Aunts.Lips.1080p.UNCENSORED.OV.WEB-DL.JPN.AAC2.0.H.264.ESub-ToonsHub.mkv';
const base = path.basename(filename, path.extname(filename));
const parts = base.split(/S\d{2}E\d{2}/i);
const epTitleRaw = parts.length > 1 ? parts[1].replace(/^\.?/, '') : '';
console.log('raw episode title token from filename:', epTitleRaw);
const { title, tags } = splitReleaseTags(epTitleRaw);
console.log('\nextracted title:', title);
console.log('extracted tags:', tags);
const tagSuffix = (tags && tags.length) ? ' ' + tags.map(t => `[${t}]`).join('') : '';
const seriesName = 'Chuhai Lips Canned Flavor of Married Women (2025)';
const epCode = 'S01E01';
const file = `${seriesName} - ${epCode}${title ? ` - ${title}` : ''}${tagSuffix}.mkv`;
console.log('\nfinal file:', file);
