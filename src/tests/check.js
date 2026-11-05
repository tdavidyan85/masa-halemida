// Tiny assertion helper for the Playwright scripts: every check is counted, a failed one is printed,
// and done() sets a non-zero exit code if anything failed (so `npm test` can tell).
const fails=[];let count=0;const blocked=new Set();
function check(cond,msg){count++;if(!cond){fails.push(msg);console.log('  ✗ FAIL: '+msg)}return !!cond}
// Keep the tests off the network: any request a test does not fake itself (Google Fonts, wa.me, …) is blocked,
// so a slow or missing outside service can never fail or slow a test. Page routes (the fakes) win over this context route.
async function offline(target){const ctx=target.context?target.context():target;
  await ctx.route(u=>!/^(file|data|blob|about):$/.test(u.protocol),r=>{blocked.add(new URL(r.request().url()).host);return r.abort('blockedbyclient')})}
function done(name){
  if(blocked.size)console.log('  (blocked outside requests: '+[...blocked].join(', ')+')');
  if(fails.length){console.log(`✗ ${name}: ${fails.length} of ${count} checks failed`);process.exitCode=1}
  else console.log(`✓ ${name}: all ${count} checks passed`);
}
// a crash anywhere in a test is a failure too
process.on('unhandledRejection',e=>{console.log('✗ crashed: '+(e&&e.stack||e));process.exit(1)});
module.exports={check,done,offline};
