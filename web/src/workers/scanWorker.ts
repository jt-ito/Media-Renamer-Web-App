// Worker: performs heavy network calls for scanning so main thread stays responsive
self.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  const { requestId, type, lib, item } = msg;
  try {
    if (type === 'fetchEpisodeTitle') {
      const inf = item?.inferred;
      if (!inf) {
        self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null });
        return;
      }
      const ep = inf.episode_number ?? (inf.episodes && inf.episodes[0]) ?? (inf.absolute && inf.absolute[0]);
      if (ep == null) {
        self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null });
        return;
      }
      const seriesName = inf.title || (inf.parsedName ? String(inf.parsedName).split(' - ')[0] : '');
      if (!seriesName) {
        self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null });
        return;
      }
      // search TVDB for series id
      try {
        const sres = await fetch(`/api/search?type=series&q=${encodeURIComponent(seriesName)}`);
        if (!sres.ok) { self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null }); return; }
        const sjs = await sres.json();
        const results = sjs.data || sjs || [];
        if (!Array.isArray(results) || !results.length) { self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null }); return; }
  const top = results[0];
  const seriesId = top.id;
  const topType = top.type || 'series';
        const season = inf.season ?? 1;
        const eres = await fetch(`/api/episode-title?seriesId=${encodeURIComponent(String(seriesId))}&season=${encodeURIComponent(String(season))}&episode=${encodeURIComponent(String(ep))}`);
        if (!eres.ok) { self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null }); return; }
        const ej = await eres.json();
        const title = ej.title || null;
        if (!title) { self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null }); return; }
        // Build updated inferred structure
        const newInferred = { ...inf, episode_title: title };
        const paddedS = String(season).padStart(2, '0');
        const paddedE = String(ep).padStart(2, '0');
        const base = inf.title || (inf.parsedName ? String(inf.parsedName).split(' - ')[0] : '');
        newInferred.parsedName = `${base} - S${paddedS}E${paddedE} - ${title}`;
        newInferred.jellyfinExample = `${base}/Season ${paddedS}/${base} - S${paddedS}E${paddedE} - ${title}`;
  const updatedItem = { ...item, inferred: newInferred, __tvdb: { id: seriesId, type: topType } };
  self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem });
        return;
      } catch (e) {
        self.postMessage({ requestId, type: 'fetchEpisodeTitleResult', updatedItem: null, error: String(e) });
        return;
      }
    }
    // unknown type
    self.postMessage({ requestId, type: 'error', error: 'unknown message type' });
  } catch (err) {
    try { self.postMessage({ requestId, type: 'error', error: String(err) }); } catch(e){}
  }
});
