/* The play page for packs made from photos: /pack/?pack=<id> (child, approved packs) and ?pack=<id>&t=<edit token> (parent preview of a draft).
   Replaces the embedded pack of build_pack.py with a fetch from our `ingest` function. */
window.TTS_NS='p'; /* own voice-cache folder on the server: a family's worksheet text never mixes with the shared cache */
(function(){
  const q=new URLSearchParams(location.search),id=q.get('pack')||'',tok=q.get('t')||'';
  const API='https://gwfacvvmlrkmfkstqpkb.supabase.co/functions/v1/ingest';
  const box=m=>{const a=document.getElementById('app');a.innerHTML='<div style="font-family:Arial,sans-serif;direction:rtl;text-align:center;max-width:480px;margin:40px auto;padding:24px;border:3px solid #1b2a4a;border-radius:20px;background:#fff;color:#1b2a4a"><div style="font-size:64px">🦉</div><p style="font-size:20px;line-height:1.6">'+m+'</p></div>'};
  if(!/^[A-Za-z0-9_-]{10,60}$/.test(id)){box('הקישור לא תקין. בקשו מההורה או מהמורה קישור חדש.');return}
  const pre=id.replace(/[^A-Za-z0-9]/g,'').slice(0,6)+'_';
  /* skill and topic ids from the model ("s1","t1") repeat from pack to pack: prefix them so progress of one pack never mixes with another */
  function ns(P){const sk={};(P.topics||[]).forEach(t=>{t.id=pre+t.id;(t.skills||[]).forEach(s=>{sk[s.id]=pre+s.id;s.id=pre+s.id})});
    (P.exams||[]).forEach(e=>{(e.fixed||[]).forEach(f=>{f.skill=sk[f.skill]||f.skill});(e.sections||[]).forEach(s=>{s.skill=sk[s.skill]||s.skill})});return P}
  fetch(tok?API+'?a=get&id='+id+'&t='+encodeURIComponent(tok):API+'?a=pack&id='+id)
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.json()})
    .then(j=>{const P=ns(j.pack);let errs=[];try{errs=validatePack(JSON.parse(JSON.stringify(P)))}catch(e){errs=['validator: '+e.message]}
      if(errs.length&&!tok){box('היחידה הזאת עוד לא מוכנה לתרגול. בקשו מההורה לבדוק אותה שוב.');return}
      if(P.subject&&P.subject.name)SUBJECT_NAME=P.subject.name;
      loadPack(P);startApp();
      if(tok){const b=document.createElement('div');b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99;background:#fff3c4;border-bottom:3px solid #1b2a4a;text-align:center;font:bold 16px Arial;padding:6px;direction:rtl';
        b.textContent=(j.status=='approved'?'✅ מאושר':'👀 תצוגה מקדימה (טיוטה)')+(errs.length?' · יש '+errs.length+' בעיות בחבילה: '+errs.slice(0,3).join(' | '):'');document.body.appendChild(b)}})
    .catch(e=>box(e&&/^(404|403)$/.test(e.message)?'לא מצאנו את היחידה הזאת. בקשו קישור חדש.':'לא הצלחנו לטעון את היחידה. נסו שוב בעוד רגע.'));
})();
