/* Service worker for a game folder: lets the page open without a network. Network first, so a new deploy always wins when online. */
const V='masa-v1',FONTS=/^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(V).then(c=>c.addAll(['./','manifest.webmanifest','../icons/icon-192.png']).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url),same=u.origin===location.origin;
  if(!same&&!FONTS.test(r.url))return;                 // never touch Supabase, voice, or any other service
  e.respondWith((async()=>{
    const c=await caches.open(V);
    if(!same){const hit=await c.match(r);const net=fetch(r).then(x=>{if(x.ok)c.put(r,x.clone());return x}).catch(()=>hit);return hit||net}
    try{const x=await fetch(r);if(x.ok)c.put(r,x.clone());return x}
    catch(err){const hit=await c.match(r,{ignoreSearch:true});if(hit)return hit;if(r.mode==='navigate'){const home=await c.match('./');if(home)return home}throw err}
  })())});
