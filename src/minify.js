const esbuild=require('esbuild');const fs=require('fs');
const src=process.argv[2]||'deploy/index.html',dst=process.argv[3]||'deploy/index.min.html';let h=fs.readFileSync(src,'utf8');
h=h.replace(/<style>([\s\S]*?)<\/style>/g,(m,c)=>'<style>'+esbuild.transformSync(c,{loader:'css',minify:true}).code.trim()+'</style>');
h=h.replace(/<script>([\s\S]*?)<\/script>/g,(m,c)=>'<script>'+esbuild.transformSync(c,{loader:'js',minify:true,charset:'utf8'}).code.trim()+'</script>');
h=h.replace(/\n\s+/g,'\n');
fs.writeFileSync(dst,h);console.log(h.length, Buffer.byteLength(h));
