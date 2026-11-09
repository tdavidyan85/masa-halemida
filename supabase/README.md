# מסד הנתונים: משתמשים, קבוצות והרשאות

מיגרציות SQL לפורמט של Supabase, ובדיקות אבטחה ל-RLS. **לא הוחל על שום פרויקט בענן.**

## הרצת הבדיקות (מקומית בלבד)

```bash
cd supabase
npm install
npm test        # מרים PostgreSQL 17 זמני (embedded-postgres), מחיל הכול, מריץ 75 בדיקות ומוחק
```

אין צורך ב-Docker או ב-Supabase CLI. הבדיקות רצות על שרת PostgreSQL אמיתי, אבל **לא על Supabase עצמו**:
`tests/shim/supabase_shim.sql` משחזר רק את החלקים ש-Supabase מספק ושהמיגרציות נשענות עליהם:
- התפקידים `anon`, `authenticated` ו-`service_role`
- `auth.users` ו-`auth.uid()` מתוך `request.jwt.claims`
- `storage.objects`
- הרשאות ברירת המחדל של Supabase, שנותנות ל-anon ול-authenticated הכול על כל טבלה חדשה. כך הבדיקות מוכיחות שה-RLS הוא שעוצר, כמו בייצור.

**לפני ייצור צריך להריץ את אותן מיגרציות גם על Supabase מקומי** (`supabase start`, דורש Docker), כדי לוודא את ההתנהגות של ה-Auth וה-Storage האמיתיים.

## מה יש כאן

| מיגרציה | תוכן |
|---|---|
| `…120000_identity` | `profiles`, `user_roles`, סכמת `app`, פרופיל אוטומטי בהרשמה (רק שם; **תפקיד אף פעם לא מגיע מהמשתמש**) |
| `…120100_students_guardians` | `students`, `student_credentials` (ללא גישת API), `guardianships` |
| `…120200_groups` | `groups`, `group_teachers` (בעלים יחיד), `group_members` |
| `…120300_consents_invitations` | `consents`, `invitations` (רק hash של הדוא״ל), ביטול הסכמה מוציא מהקבוצה |
| `…120400_materials_audit` | `learning_materials`, `audit_log` (הוספה בלבד, בלי שמות) |
| `…120500_rls_helpers` | פונקציות `app.*` שעונות true/false על המשתמש המחובר |
| `…120600_rls_policies` | RLS לכל טבלה, הרשאות עד רמת העמודה |
| `…120700_rpc` | `request_role`, `admin_set_role`, `admin_set_profile_status`, `create_invitation`, `respond_invitation`, `remove_member`, `grant_consent`, `revoke_consent` |
| `…120800_avatars_storage` | דלי `avatars` פרטי ומדיניות לתמונות פרופיל (בלי תמונות) |
| `…130000_student_auth` | הורה מאומת, `student_devices`, `login_attempts`, `enroll_device`/`revoke_device`/`release_student_lock`, פונקציות `srv_*` לשרת בלבד |
| `…130100_invited_group_visibility` | הורה מוזמן רואה את הקבוצה שאליה הוזמן, אבל לא את התלמידים שבה |

## התחברות תלמידים וחשבונות ילדים (`functions/`)

**עיקרון:** ה-session תמיד מגיע מ-Supabase Auth. אנחנו לא מנפיקים טוקן או JWT בעצמנו.

**יצירת חשבון (`manage-student`):**
- רק הורה מאומת יכול ליצור חשבון לילד. "מאומת" = דוא״ל ו**טלפון** מאומתים, שניהם דרך OTP של Supabase Auth.
- לילד נוצר משתמש Auth עם כתובת `.invalid` שלא מקבלת דואר, וסיסמה אקראית שנזרקת מיד.
- ה-PIN או הסיסמה שהילד יודע נשמרים כ-hash (PBKDF2-SHA256, 600 אלף סבבים) ב-`student_credentials`.

**כניסה (`student-login`):**
1. בודקת חסימה לפי כתובת: עד 30 ניסיונות ב-15 דקות.
2. בודקת נעילה של החשבון: 5 טעויות = 15 דקות, 10 = רק הורה משחרר.
3. כניסה ב-PIN מותרת רק ממכשיר שהורה אישר.
4. מאמתת את ה-hash.
5. רק אחרי כל זה מבקשת מ-Supabase Auth session רגיל, דרך `auth.admin.generateLink` ואז `auth.verifyOtp`.

| נבדק | לא נבדק עדיין (דורש Supabase אמיתי, `supabase start`) |
|---|---|
| כל הלוגיקה והמגבלות: 30 בדיקות, חלקן מול ה-PostgreSQL המקומי עם פונקציות ה-SQL האמיתיות | השלב `generateLink` + `verifyOtp` עצמו |
| | `verify_jwt` |
| | CORS |
| | משתני הסביבה |
| | זמני הריצה של PBKDF2 בתוך Edge Functions |
| | אימות הטלפון (דורש ספק SMS) |

**חלופות, אם `generateLink` + `verifyOtp` לא יתאים בבדיקה:**
- כניסה עם סיסמה אמיתית של Supabase לתלמידים הבוגרים, שאז עוקפת את הנעילה שלנו.
- ספק זהות חיצוני דרך Third-party Auth של Supabase.

## כללים שחשוב לדעת כשמחברים את הפורטל

- **אין `select('*')`** על `students` ועל `invitations`: חלק מהעמודות חסומות (תאריך לידה, שם משתמש, hash של הדוא״ל). בוחרים עמודות במפורש.
- **כתיבות רגישות רק דרך RPC:** הצטרפות לקבוצה, הסרת תלמיד, הסכמות ותפקידים. אין להן `insert`/`update` ישיר.
- **חשבונות תלמידים, PIN ונעילה:** רק בצד השרת: הפונקציות `manage-student` ו-`student-login` עם service role, והפונקציות `srv_*` במסד הנתונים, שזמינות רק ל-service role.
- המיגרציות **לא נוגעות** בטבלאות הקיימות (`feedback`, `usage_events`, `tts_usage`) ולא ב-`src/sql/001_packs_ingest.sql`.
