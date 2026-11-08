# the play page for photo-made packs (loaded by id from the `ingest` function):  python3 build_packpage.py   (needs deploy/index.html from build.py)
s=open('deploy/index.html').read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)>=1,a[:70];s=s.replace(a,b)
rep("const SUBJECT='math',SUBJECT_NAME='חשבון';",
    "const SUBJECT='p'+((new URLSearchParams(location.search).get('pack')||'x').replace(/[^A-Za-z0-9]/g,'').slice(0,8));let SUBJECT_NAME='תרגול';")
rep('<span class="subj">חשבון</span>','<span class="subj">תרגול</span>')
rep('משחק תרגול בחשבון לכיתה ה׳','משחק תרגול עם הקראה')
rep('masa-halemida/math/','masa-halemida/pack/')
# privacy: the pack id is part of a private link - never send it to the anonymous usage counts or the feedback table
rep("subject:String(SUBJECT).slice(0,20)","subject:'pack'")
rep("body:JSON.stringify({subject:SUBJECT,","body:JSON.stringify({subject:'pack',")
boot=open('packpage-boot.js').read()
rep('/*SUBJECT-PACK*/\nstartApp();',boot)
# the pack link must not be indexed or shown in link previews
rep('<head>','<head>\n<meta name="robots" content="noindex,nofollow">')
open('deploy/pack.html','w').write(s);print('ok',len(s.encode()))
