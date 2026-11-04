# קוד המקור של מסע הלמידה

האתר עצמו (התיקיות `math/` ו-`english/` בשורש) הוא תוצר בנייה. כאן נמצא המקור.

| קובץ | מה הוא |
|---|---|
| `math-journey.html` | המנוע כולו: מסכים, שאלות, הקראה, מבחנים, דפי עבודה, משוב ומדידה |
| `pack-engine.js` | קריאת חבילות תוכן (masa-pack/1) – מסונכרן לתוך המנוע ב-`sync_engine.py` |
| `packs/*.json` | חבילות תוכן (למשל אנגלית – כינויי גוף) |
| `studio.js`, `build_studio.py` | הסטודיו להורים (רץ כ-Artifact בתוך Claude) |
| `tts-function.ts` | השרת של הקול האנושי (Supabase Edge Function בשם `tts`) |
| `tests/` | בדיקות Playwright |

## בנייה ופרסום

```bash
npm install            # פעם אחת
npm run build          # בונה ל-deploy/
npm run publish-site   # בונה ומעתיק ל-math/ ו-english/ בשורש
git add -A && git commit -m "..." && git push   # GitHub Pages מעלה תוך דקה-שתיים
```

דרוש Python 3 ו-Node 18+.

## שירותים חיצוניים
- **Supabase** (פרויקט `gwfacvvmlrkmfkstqpkb`): טבלאות `feedback`, `usage_events` (אנונימי), `tts_usage`; פונקציה `tts`; דלי `tts`.
  המפתח שבקוד הוא המפתח הציבורי (publishable) – הוא מאפשר רק הוספת שורות.
- **Azure Speech**: המפתח נשמר רק בסודות של הפונקציה (`AZURE_SPEECH_KEY`), לעולם לא בקוד.
