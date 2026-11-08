// npm test: run every test script from src/ against the built pages in deploy/; fail if any one fails.
const {spawnSync}=require('child_process');const fs=require('fs');const path=require('path');
const SRC=path.join(__dirname,'..');
const TESTS=[
  ['tp1.js','English pack: validator, question fuzz, exams, sheets'],
  ['tfb.js','Feedback button'],
  ['tu1.js','Home screen, tabs, parents\' gate'],
  ['tus.js','Anonymous usage counts'],
  ['ttts.js','Cloud voice and device fallback'],
  ['tboard.js','Interaction mechanics: sort, match, order, tap, colour cells'],
  ['tpack.js','Photo-pack play page'],
  ['tscan.js','Photo scan page (parent)'],
  ['tread.js','Reading options for accessibility'],
];
if(!['index.min.html','english.min.html'].every(f=>fs.existsSync(path.join(SRC,'deploy',f)))){
  console.log('✗ deploy/ is missing – run `npm run build` first');process.exit(1)}
const rows=[];
for(const [file,what] of TESTS){
  console.log(`\n===== ${file} – ${what}`);const t0=Date.now();
  const r=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:SRC,stdio:'inherit',timeout:180000});
  const ok=r.status===0;rows.push([file,ok,r.error?'timeout/error':`exit ${r.status}`,((Date.now()-t0)/1000).toFixed(1)+'s']);
}
console.log('\n===== summary');
for(const [f,ok,st,s] of rows)console.log(`${ok?'✓':'✗'} ${f.padEnd(8)} ${st.padEnd(14)} ${s}`);
const bad=rows.filter(r=>!r[1]).length;
console.log(bad?`\n✗ ${bad} of ${rows.length} test files failed`:`\n✓ all ${rows.length} test files passed`);
process.exit(bad?1:0);
