import sys
BASE=sys.argv[1] if len(sys.argv)>1 else 'https://tdavidyan85.github.io/masa-halemida/'
URL=BASE+'math/'
s=open('math-journey.html').read()
# hide the "save at Claude" section outside claude.ai
i=s.index('    <h3 style="margin-top:18px">שמירה אצל Claude</h3>')
j=s.index('</label>',s.index('id="sSync"',i))+len('</label>')
s=s[:i]+'    ${window.claude?`'+s[i:j].replace('`','\\`')+'`:\'\'}'+s[j:]
s=s.replace("$('#sSync').onchange=e=>{ST.settings.sync=e.target.checked;save()};","if($('#sSync'))$('#sSync').onchange=e=>{ST.settings.sync=e.target.checked;save()};")
s=s.replace('<p>מעלים מבחן לדוגמה חדש לשיחה עם Claude, והשאלות החדשות מתווספות לכאן. הקישור לא משתנה.</p>','<p>ההתקדמות נשמרת בדפדפן הזה בלבד.</p>')
# static fallback: visible when the viewer does not run JavaScript (e.g. WhatsApp preview on a phone)
fallback=f'''<div id="nojs" style="font-family:Arial,sans-serif;direction:rtl;text-align:center;max-width:480px;margin:40px auto;padding:24px;border:3px solid #1b2a4a;border-radius:20px;background:#fff;color:#1b2a4a">
<div style="font-size:64px">🦉</div><h1 style="margin:8px 0;font-size:30px">מסע הלמידה</h1>
<p style="font-size:19px;line-height:1.6">משחק תרגול בחשבון לכיתה ה׳, עם הקראה בקול.</p>
<p style="font-size:19px;line-height:1.6">התצוגה המקדימה של וואטסאפ לא מריצה משחקים. לחצו כאן כדי לפתוח אותו בדפדפן:</p>
<p><a href="{URL}" style="display:inline-block;background:#ff7a1a;color:#fff;font-size:24px;padding:12px 28px;border-radius:16px;text-decoration:none;border:3px solid #1b2a4a">לפתוח את המשחק ▶</a></p>
<p style="font-size:16px;color:#5b6b8a">{URL.replace("https://","")}</p></div>
<script>document.getElementById('nojs').remove()</script>'''
s=s.replace('<div id="app" dir="rtl">',fallback+'\n<div id="app" dir="rtl">',1)
head='<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta property="og:title" content="מסע הלמידה">\n<meta property="og:description" content="משחק תרגול בחשבון לכיתה ה׳, עם הקראה בקול">\n<meta property="og:image" content="https://tdavidyan85.github.io/masa-halemida/og.png">\n<meta property="og:url" content="https://tdavidyan85.github.io/masa-halemida/math/">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="description" content="משחק תרגול בחשבון לכיתה ה׳, עם הקראה בקול. בלי הרשמה.">\n<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%A6%89%3C/text%3E%3C/svg%3E">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n<noscript><style>#app{display:none}</style></noscript>\n</head>\n<body>\n'
foot='<footer style="text-align:center;padding:10px 16px 26px;font-family:Arial,sans-serif;font-size:15px"><a href="../about.html" style="color:#5b6b8a">להורים ולמורים · פרטיות</a></footer>'
out=head+s+foot+'\n</body>\n</html>\n'
import os
os.makedirs('deploy',exist_ok=True)
open('deploy/index.html','w').write(out)
# root chooser with the shared owl drawing
src=open('math-journey.html').read()
i=src.index('const SHOP=[');j=src.index('\n}\n',src.index('function owlSVG('))+3
root=open('root.html').read().replace('/*OWL*/',src[i:j])
open('deploy/root.html','w').write(root)
os.makedirs('standalone',exist_ok=True);open('standalone/מסע-הלמידה.html','w').write(out)
print('ok',len(out.encode()))
