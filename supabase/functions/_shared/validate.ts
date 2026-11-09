// Input checks shared by the Edge Functions. Messages are Hebrew because they reach the parent's screen.

export class InputError extends Error {
  status = 400
  constructor(message: string) { super(message); this.name = 'InputError' }
}

export const GRADES = ['גן', 'א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const
export const RELATIONS = ['אמא', 'אבא', 'אפוטרופוס/ית'] as const
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function checkPin(pin: unknown): string {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) throw new InputError('הקוד צריך להיות 6 ספרות')
  if (/^(\d)\1{5}$/.test(pin)) throw new InputError('קוד עם אותה ספרה שש פעמים קל מדי לניחוש')
  const asc = '01234567890', desc = '09876543210'
  if (asc.includes(pin) || desc.includes(pin)) throw new InputError('קוד של ספרות עוקבות קל מדי לניחוש')
  return pin
}

export function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8) throw new InputError('הסיסמה צריכה לפחות 8 תווים')
  if (pw.length > 128) throw new InputError('הסיסמה ארוכה מדי')
  return pw
}

export function checkUsername(u: unknown): string {
  if (typeof u !== 'string' || !/^[a-z0-9._-]{3,32}$/.test(u.trim().toLowerCase())) {
    throw new InputError('שם משתמש: 3–32 אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון')
  }
  return u.trim().toLowerCase()
}

export function checkName(n: unknown): string {
  if (typeof n !== 'string' || n.trim().length < 2 || n.trim().length > 120) throw new InputError('צריך שם מלא (2–120 תווים)')
  return n.trim().replace(/\s+/g, ' ')
}

/** a child of kindergarten to 6th grade: 3–14 years old today */
export function checkBirthDate(d: unknown, today = new Date()): string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) throw new InputError('תאריך לידה לא תקין')
  const age = (today.getTime() - Date.parse(d + 'T00:00:00Z')) / (365.25 * 24 * 3600 * 1000)
  if (age < 3 || age > 14) throw new InputError('תאריך הלידה לא מתאים לגן חובה עד כיתה ו׳')
  return d
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], msg: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new InputError(msg)
  return v as T
}

export function checkUuid(v: unknown, what = 'מזהה'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new InputError(`${what} לא תקין`)
  return v
}
