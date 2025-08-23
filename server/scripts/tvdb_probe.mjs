import fetch from 'node-fetch';

const key = process.env.TVDB_API_KEY;
if (!key) { console.error('TVDB probe requires TVDB_API_KEY in environment'); process.exit(2); }

async function login() {
  const res = await fetch('https://api4.thetvdb.com/v4/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ apikey: key }) });
  const j = await res.json();
  return j.data?.token;
}

(async ()=>{
  try {
    const token = await login();
    console.log('token ok:', Boolean(token));
    const epId = 10967226;
    const headers = { Authorization: `Bearer ${token}`, 'Accept': 'application/json' };

    for (const path of [
      `/episodes/${epId}/translations`,
      `/episodes/${epId}/translations?language=eng`,
      `/episodes/${epId}`,
      `/episodes/${epId}?language=eng`
    ]) {
      const url = `https://api4.thetvdb.com/v4${path}`;
      const r = await fetch(url, { headers });
      console.log('\nREQUEST:', url);
      console.log('STATUS:', r.status, r.statusText);
      let text;
      try { text = await r.text(); } catch(e){ text = String(e); }
      console.log('BODY:', text.slice(0,2000));
    }
  } catch (e) { console.error(e && e.stack ? e.stack : e); process.exit(2); }
})();
