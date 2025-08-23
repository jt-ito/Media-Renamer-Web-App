// Quick test harness to validate release tag extraction in renamer
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// reuse the splitReleaseTags logic from renamer but in plain JS here
const cjkRe = /[\u3040-\u30ff\u4e00-\u9fff]/;
function splitReleaseTags(input) {
  if (!input) return { title: '', tags: [] };
  const tokens = String(input).split(/[._\s\-]+/).filter(Boolean);
  const tags = [];
  const knownPatterns = [
    /^(?:2160p|1080p|720p|480p|2160i|1080i)$/i,
    /^(?:web[-_ ]?dl|webrip|web|hdtv|bdrip|bdremux|bluray|blu[-_ ]?ray|dvd[-_ ]?rip|dvdrip)$/i,
    /^(?:x264|x265|h\.264|h264|hevc|avc|av1|xvid)$/i,
    /^(?:aac2\.0|aac|flac|ac3|ddp5\.1|dd5\.1|dd5|dts[-_ ]?hd|dts)$/i,
    /^(?:uncensored|uncut|remux|proper|repack|limited|unrated|extended|director|director's|directors|internal)$/i,
    /^(?:esub|hardsub|softsub|sub|subbed|subs|ass|ssa|srt)$/i,
    /^(?:jpn|jap|jp|eng|english|zho|chi|zh|chs|cht|kor|kr|ita|fra|ger|deu)$/i,
    /^(?:hdr|hdr10|dolbyvision|dv|10bit|8bit)$/i,
    /^(?:1080p60|720p60|60fps|30fps|24fps)$/i,
    /^(?:uncensored|ova|ova\d*|special|ova-special)$/i,
    /^(?:webrip|web-dl|webdl|web)[\w-]*$/i,
  ];
  function isKnownTag(tok) {
    if (!tok) return false;
    for (const r of knownPatterns) if (r.test(tok)) return true;
    if (/^1080p$/i.test(tok)) return true;
    return false;
  }
  let i = tokens.length - 1;
  while (i >= 0) {
    const t = tokens[i];
    if (isKnownTag(t)) { tags.unshift(t); i--; continue; }
    if (i === tokens.length - 1 && /^[A-Za-z0-9][A-Za-z0-9_]{1,40}$/.test(t) && /[A-Z]/.test(t)) { tags.unshift(t); i--; continue; }
    if (/^[A-Za-z]{2,4}$/.test(t) && isKnownTag(t)) { tags.unshift(t); i--; continue; }
    if (tags.length > 0 && /^[A-Za-z0-9]{2,40}$/.test(t)) { tags.unshift(t); i--; continue; }
    break;
  }
  const title = tokens.slice(0, i + 1).join(' ').replace(/\s+/g, ' ').trim();
  return { title, tags };
}

// Sample filename from user
const filename = 'Chuhai.Lips.Canned.Flavor.of.Married.Women.S01E01.The.Flavor.of.My.Strict.Aunts.Lips.1080p.UNCENSORED.OV.WEB-DL.JPN.AAC2.0.H.264.ESub-ToonsHub.mkv';
const base = path.basename(filename, path.extname(filename));
// Assume episodeTitle is parsed out as the trailing portion after SxxExx; simulate that
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
