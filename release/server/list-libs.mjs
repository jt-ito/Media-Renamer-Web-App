import fetch from 'node-fetch';
(async()=>{
  const r = await fetch('http://localhost:8787/api/libraries');
  console.log(await r.text());
})().catch(e=>console.error(e));
