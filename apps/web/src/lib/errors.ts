/**
 * 오류 어댑터 — 설계서 부록 B.3
 *
 * v1.1 은 오류가 한 종류(프로시저 THROW)였다. v2.0 은 **세 종류가 서로 다른 모양**으로
 * 온다. 화면이 보는 형태는 v1.1 과 동일해야 하므로 여기서 하나로 정규화한다.
 *
 *   ① RPC 의 ax_raise   {code:'PT400', message:'한글…', hint:'AX-50464'}
 *   ② 제약 위반          {code:'23505', message:'duplicate key…', details:'Key (…)=…'}
 *   ③ RLS 거부           {code:'42501', message:'new row violates row-level security policy'}
 *
 * ⚠ ②③ 의 영문 원문을 사용자에게 보이지 않는다 — ③은 정책 구조가 새어 나간다.
 */
import {
  CONSTRAINT_MESSAGES,
  PERMISSION_DENIED,
  REFERENCED_MESSAGE,
  UNAUTHENTICATED,
  UNKNOWN_ERROR,
  type AxError,
} from '@ax-bridge/shared-constants';

/** supabase-js 가 주는 오류의 최소 형태 (PostgrestError / AuthError 공통) */
export interface RawError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number;
}

/**
 * 오류 메시지에서 제약 이름을 뽑는다.
 * PostgreSQL 은 `violates ... constraint "ck_bank_one"` 형태로 알려준다.
 */
function extractConstraint(e: RawError): string | null {
  const haystack = `${e.message ?? ''} ${e.details ?? ''}`;
  const m = /constraint "([^"]+)"/.exec(haystack);
  return m?.[1] ?? null;
}

export function toAxError(e: unknown): AxError {
  if (!e || typeof e !== 'object') return UNKNOWN_ERROR;
  const raw = e as RawError;

  // ① RPC — ax_raise 가 hint 에 AX 코드를 실어 보낸다(부록 B.1)
  if (raw.hint?.startsWith('AX-')) {
    return { code: raw.hint, message: raw.message ?? UNKNOWN_ERROR.message };
  }

  // ③ RLS 거부 — 원문 노출 금지
  if (raw.code === '42501') {
    return { ...PERMISSION_DENIED, detail: raw.message ?? undefined };
  }

  // 인증 만료
  if (raw.status === 401 || raw.code === 'PGRST301') {
    return UNAUTHENTICATED;
  }

  // ② 제약 위반 — 제약 이름 → 한글 메시지 사전
  if (raw.code === '23505' || raw.code === '23503' || raw.code === '23514') {
    const name = extractConstraint(raw);
    if (name) {
      const known = CONSTRAINT_MESSAGES[name];
      if (known) return { ...known, detail: raw.message ?? undefined };
    }
    // FK 위반인데 사전에 없다면 대개 "참조 중이라 삭제 불가" 방향이다(§9.9)
    if (raw.code === '23503') {
      return { ...REFERENCED_MESSAGE, detail: raw.message ?? undefined };
    }
    return { ...UNKNOWN_ERROR, detail: raw.message ?? undefined };
  }

  // 컬럼 권한 부족 — 특권 컬럼을 직접 건드리려 한 경우(§5.3 ①)
  if (raw.code === '42501' || /permission denied/i.test(raw.message ?? '')) {
    return { ...PERMISSION_DENIED, detail: raw.message ?? undefined };
  }

  return { ...UNKNOWN_ERROR, detail: raw.message ?? undefined };
}

/** 던지기 좋은 형태 */
export class AxRequestError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(ax: AxError) {
    super(ax.message);
    this.name = 'AxRequestError';
    this.code = ax.code;
    this.detail = ax.detail;
  }
}

/** supabase 응답의 error 를 확인하고, 있으면 정규화해 던진다. */
export function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new AxRequestError(toAxError(res.error));
  return res.data;
}
