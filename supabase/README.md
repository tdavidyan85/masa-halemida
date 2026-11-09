# מסד הנתונים: משתמשים, קבוצות והרשאות

מיגרציות SQL לפורמט של Supabase, ובדיקות אבטחה ל-RLS. **לא הוחל על שום פרויקט בענן.**

## הרצת הבדיקות (מקומית בלבד)

```bash
cd supabase
npm install
npm test        # מרים PostgreSQL 17 זמני (embedded-postgres), מחיל הכול, מריץ 44 בדיקות ומוחק
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

## כללים שחשוב לדעת כשמחברים את הפורטל

- **אין `select('*')`** על `students` ועל `invitations`: חלק מהעמודות חסומות (תאריך לידה, שם משתמש, hash של הדוא״ל). בוחרים עמודות במפורש.
- **כתיבות רגישות רק דרך RPC:** הצטרפות לקבוצה, הסרת תלמיד, הסכמות ותפקידים. אין להן `insert`/`update` ישיר.
- **חשבונות תלמידים, PIN ונעילה:** נוצרים רק בצד השרת (Edge Function עם service role), שעוד לא נכתב.
- המיגרציות **לא נוגעות** בטבלאות הקיימות (`feedback`, `usage_events`, `tts_usage`) ולא ב-`src/sql/001_packs_ingest.sql`.
