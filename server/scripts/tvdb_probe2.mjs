import fetch from 'node-fetch';
const key = process.env.TVDB_API_KEY;
if (!key) { console.error('TVDB probe requires TVDB_API_KEY in environment'); process.exit(2); }
async function login(){ const r=await fetch('https://api4.thetvdb.com/v4/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({apikey:key})}); return (await r.json()).data?.token; }
(async()=>{
  const token = await login();
  const ep = 10967226;
  const headers = { Authorization: `Bearer ${token}` };
  const variants = [
    `/episodes/${ep}/translations`,
    `/episodes/${ep}/translations?language=eng`,
    `/episodes/${ep}/translations/eng`,
    `/episodes/${ep}/translations/eng?language=eng`,
    `/translations/episodes/${ep}`,
    `/translations/episodes/${ep}?language=eng`,
    `/translations/${ep}`,
    `/translations/${ep}?language=eng`,
    `/episodes/${ep}`,
    `/episodes/${ep}?language=eng`,
  ];
  for (const p of variants) {
    try {
      const url = `https://api4.thetvdb.com/v4${p}`;
      const res = await fetch(url, { headers });
      const text = await res.text();
      console.log('\nPATH:', p, 'STATUS', res.status);
      console.log(text.slice(0,1200));
    } catch (e) { console.error('error', e); }
  }
})();
