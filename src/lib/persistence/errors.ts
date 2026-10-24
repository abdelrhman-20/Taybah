// One error model for every admin write. Stores throw PersistenceError so
// UI code can show an accurate, actionable Arabic message and decide whether
// the draft is still safe to resubmit (conflict -> reload first).

export type PersistenceErrorCode =
  | 'unconfigured' // no Supabase env baked into this build
  | 'not_initialized' // catalog not yet migrated to the database
  | 'unauthorized' // not signed in / not in public.admins / session expired
  | 'conflict' // someone else changed the record since it was loaded
  | 'not_found' // the record no longer exists
  | 'exists' // insert of an id that already exists
  | 'duplicate_slug'
  | 'invalid' // server rejected the payload
  | 'schema_missing' // migration not applied
  | 'verify_failed' // write reported success but read-back disagrees
  | 'network'
  | 'unknown';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  // Safe diagnostics only: PostgREST code/message, never credentials.
  readonly detail: string;

  constructor(code: PersistenceErrorCode, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'PersistenceError';
    this.code = code;
    this.detail = detail;
  }
}

interface PostgrestLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function classifyError(error: PostgrestLike | unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const e = (error ?? {}) as PostgrestLike;
  const code = e.code ?? '';
  const message = e.message ?? (error instanceof Error ? error.message : String(error ?? ''));
  const detail = [code, message, e.details].filter(Boolean).join(' · ').slice(0, 300);

  if (code === 'CF001') return new PersistenceError('conflict', e.details ?? '');
  if (code === 'CF002') return new PersistenceError('not_found', e.details ?? '');
  if (code === 'CF003') return new PersistenceError('exists', e.details ?? '');
  if (code === 'CF004') return new PersistenceError('duplicate_slug', e.details ?? '');
  if (code === '22023') return new PersistenceError('invalid', e.details ?? message);
  if (code === '42501' || /permission denied|forbidden|row-level security/i.test(message)) {
    return new PersistenceError('unauthorized', detail);
  }
  if (code === 'PGRST301' || /jwt (expired|invalid)|not authenticated/i.test(message)) {
    return new PersistenceError('unauthorized', detail);
  }
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') {
    return new PersistenceError('schema_missing', detail);
  }
  if (/failed to fetch|network|timed? ?out|abort|load failed/i.test(message)) {
    return new PersistenceError('network', detail);
  }
  return new PersistenceError('unknown', detail);
}

// Arabic, user-facing. Technical detail goes to console only.
export function describePersistenceError(e: unknown): string {
  const err = classifyError(e);
  switch (err.code) {
    case 'unconfigured':
      return 'الاتصال بقاعدة البيانات غير مُعدّ في هذا الإصدار — لم يُحفظ شيء.';
    case 'not_initialized':
      return 'لم يتم ترحيل الكتالوج إلى قاعدة البيانات بعد. أكمل «النسخ الاحتياطي والترحيل» أولًا — لم يُحفظ شيء.';
    case 'unauthorized':
      return 'ليست لديك صلاحية الحفظ — سجّل الدخول بحساب مسؤول ثم أعد المحاولة. لم يُحفظ شيء.';
    case 'conflict':
      return 'تم تعديل هذا السجل من مكان آخر بعد فتحه. أعد تحميل الصفحة لرؤية آخر نسخة ثم أعد التعديل — لم يُحفظ شيء.';
    case 'not_found':
      return 'هذا السجل لم يعد موجودًا (ربما حُذف من مكان آخر). لم يُحفظ شيء.';
    case 'exists':
      return 'يوجد سجل بنفس المعرّف بالفعل. لم يُحفظ شيء.';
    case 'duplicate_slug':
      return 'الرابط (slug) مستخدم بالفعل في سجل آخر — غيّره ثم أعد المحاولة.';
    case 'invalid':
      return 'رفض الخادم البيانات المُرسلة. تحقق من الحقول ثم أعد المحاولة.';
    case 'schema_missing':
      return 'جداول قاعدة البيانات غير مكتملة (ترحيل ناقص) — تواصل مع مسؤول النظام. لم يُحفظ شيء.';
    case 'verify_failed':
      return 'تعذّر التحقق من الحفظ على الخادم. أعد تحميل الصفحة للتأكد من آخر نسخة محفوظة.';
    case 'network':
      return 'تعذّر الاتصال بالخادم — تحقق من الإنترنت وأعد المحاولة. لم يُحفظ شيء.';
    default:
      return 'تعذّر الحفظ على الخادم — أعد المحاولة. إن تكرر الخطأ تواصل مع مسؤول النظام.';
  }
}

export async function withTimeout<T>(promise: PromiseLike<T>, ms = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PersistenceError('network', 'timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
