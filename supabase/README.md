# מסד הנתונים: משתמשים, קבוצות והרשאות

מיגרציות SQL לפורמט של Supabase, ובדיקות אבטחה ל-RLS. **לא הוחל על שום פרויקט בענן.**

## הרצת הבדיקות (מקומית בלבד)

```bash
cd supabase
npm install
npm test        # מרים PostgreSQL 17 זמני (embedded-postgres), מחיל הכול, מריץ 113 בדיקות ומוחק (בדיקות e2e מדולגות)
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
| `…140000_lock_student_auth_identity` | פרטי ההתחברות של תלמיד (סיסמה, דוא״ל, טלפון) קפואים ב-`auth.users` |
| `…20261110100000_assignments_progress` | משימות (טיוטה, פורסם, ארכיון), שאלות ומפתחות תשובה (למורים בלבד), שיעורים, אירועי תרגול (**לא מאומתים**, idempotent), מבחנים שנבדקים בשרת (**מאומתים**), סטטוס לכל תלמיד |
| `…20261110100100_account_deletion_fks` | אפשר למחוק חשבון של מבוגר. הרשומות נשארות, וההפניה לאדם מתנקה |
| `…20261110110000_materials_content` | חומרים בדלי פרטי בנתיב שהשרת קובע, טקסט מחולץ (לבעלים בלבד), נושאים, טיוטות תוכן שדורשות אישור, שיתוף, ומבחן מטיוטה מאושרת |

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

**נבדק מול Supabase מקומי אמיתי** (11.2026: CLI 3.1.0, Auth v2.197.0, Postgres 17.11, Edge Runtime): כל הזרימה עובדת מקצה לקצה.
- **session אמיתי:** Supabase Auth מנפיק session לילד דרך `generateLink` ו-`verifyOtp`. ה-`sub` נכון, ה-refresh עובד, וה-RLS חל עליו.
- **אין דואר:** לא נשלח שום דוא״ל לכתובת של הילד.

**חלופות, אם יום אחד `generateLink` + `verifyOtp` לא יתאים:**
- כניסה עם סיסמה אמיתית של Supabase לתלמידים הבוגרים, שאז עוקפת את הנעילה שלנו.
- ספק זהות חיצוני דרך Third-party Auth של Supabase.

## למידה, תוצאות וחומרים

**שני סוגי עדויות, שלא מתערבבים לעולם:**
- **תרגול:** הדפדפן מדווח עליו מהמנוע. הוא **לא מאומת**, ומוצג תמיד כ"תרגול".
- **ציון:** מבחן שנבדק בשרת מול מפתחות תשובה שתלמיד לא רואה אף פעם.

**יצירת תוכן:**
- **"תבנית":** כללים קבועים, ללא AI.
- **"AI":** הפונקציה `generate-content` דרך מתאם ספקים.
- **בלי `ANTHROPIC_API_KEY`:** הפונקציה עונה 503 ולא מעמידה פנים שיצרה משהו.
- **מה נשלח לספק:** רק הנושאים, אף פעם לא פרטי ילד.
- **אישור:** כל טיוטה ממתינה לאישור הבעלים לפני שילד רואה אותה.

## Supabase מקומי אמיתי (בלי Docker)

במחשב עם 8GB זיכרון אין מקום ל-Docker: Supabase דורש לפחות 7GB לסביבת הקונטיינרים. במקום זה משתמשים ב-**runtime המקומי של ה-CLI** (ניסיוני; macOS 14 ומעלה על Apple silicon, או Linux).
- **צריכה בפועל:** כ-460MB זיכרון ו-1.8GB דיסק ב-`~/.supabase`.
- **CLI:** מותקן כתלות פיתוח (`npx supabase`), בלי התקנה במערכת ובלי הרשאות מנהל.

```bash
cd supabase
npm install
npm run local:start     # מעלה את Supabase ומחיל את המיגרציות. דואר מקומי נשמר ב-Mailpit ולא יוצא החוצה
npm run test:local      # RLS, למידה, חומרים, לוגיקת הפונקציות ו-end-to-end מול השרת המקומי (139 בדיקות)
npm run local:stop
```

**`tests/e2e.test.mjs`** בודק:
- הרשמה עם אימות דוא״ל ושחזור סיסמה, דרך PKCE ו-Mailpit
- אימות טלפון במצב בדיקות (מספרים פיקטיביים עם קוד קבוע, בלי SMS)
- יצירת ילד, אישור מכשיר וכניסה ב-PIN
- נעילה ושחרור, החלפת PIN וביטול מכשיר
- CORS
- הזמנה, הסכמה וביטול הסכמה
- Storage

בלי שרת מקומי הבדיקות האלה **מדולגות** ולא מסומנות כ-"עברו".

### מה נמצא בבדיקות מול Supabase האמיתי ותוקן

1. **ילד יכול היה לקבוע לעצמו סיסמה ב-Auth.** עם ה-session שלו, `updateUser({password})` הצליח. משם אפשר להיכנס ישירות, בלי PIN, בלי מכשיר מאושר ובלי מגבלת ניסיונות. אותו דבר עם שינוי דוא״ל וטלפון.
   **התיקון:** המיגרציה `…140000` מקפיאה את פרטי ההתחברות של חשבון תלמיד (סיסמה, דוא״ל, טלפון) ברמת מסד הנתונים.
2. **"הורה מאומת" בלי אימות.** כש-`auth.sms.enable_confirmations` כבוי, Supabase Auth מאשר טלפון חדש **בלי קוד**.
   **התיקון:** ההגדרה נדלקה ב-`config.toml`, ונוספה בדיקת רגרסיה.

### חובה בכל פרויקט ענן (לבדוק בהגדרות Auth לפני שמחברים)

| הגדרה | ערך | למה |
|---|---|---|
| Confirm email | פעיל | הורה ומורה מאמתים דוא״ל |
| Phone: Enable phone confirmations | **פעיל** (עם ספק SMS אמיתי) | אחרת "הורה מאומת" לא מאומת. בלי טלפון אין הורה מאומת, וגם אין יצירת ילד |
| Site URL / Redirect URLs | רק הדומיין של הפורטל | קישורי אימות ושחזור |
| Edge Function `student-login` | `verify_jwt = false` | לתלמיד עוד אין session. הפונקציה אוכפת את המגבלות בעצמה |
| Edge secrets | `ALLOWED_ORIGINS`, `IP_HASH_SALT` | CORS, וה-hash של הכתובות |

## כללים שחשוב לדעת כשמחברים את הפורטל

- **אין `select('*')`** על `students` ועל `invitations`: חלק מהעמודות חסומות (תאריך לידה, שם משתמש, hash של הדוא״ל). בוחרים עמודות במפורש.
- **כתיבות רגישות רק דרך RPC:** הצטרפות לקבוצה, הסרת תלמיד, הסכמות ותפקידים. אין להן `insert`/`update` ישיר.
- **חשבונות תלמידים, PIN ונעילה:** רק בצד השרת: הפונקציות `manage-student` ו-`student-login` עם service role, והפונקציות `srv_*` במסד הנתונים, שזמינות רק ל-service role.
- המיגרציות **לא נוגעות** בטבלאות הקיימות (`feedback`, `usage_events`, `tts_usage`) ולא ב-`src/sql/001_packs_ingest.sql`.
