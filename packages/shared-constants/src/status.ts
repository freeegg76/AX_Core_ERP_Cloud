/**
 * status 극성 — 설계서 §10.6 · 부록 A
 *
 * ⚠⚠ v2.0 최대의 잔존 위험이다.
 *
 * 같은 이름의 `status` 컬럼이 테이블마다 반대 의미다.
 *
 *   활성 = false : system_company · system_entity · system_pod · system_team
 *                  · finance_bank_account
 *   활성 = true  : partner_term · partner_client · partner_vendor
 *                  · finance_gl · finance_gl_seed · finance_dimension
 *
 * v1.1 에서는 서버 Mapper 가 이 차이를 숨겼다. **v2.0 은 PostgREST 가 원시 boolean 을
 * 그대로 브라우저에 돌려준다.** 틀려도 예외가 나지 않고 조용히 동작한다 —
 * 비활성 거래처가 목록에 보이거나, 활성 회사가 사라진다.
 *
 * 그래서 이 모듈이 **유일한 접근 수단**이다. `row.status === true` 같은 직접 비교는
 * 린트로 금지한다(eslint no-restricted-syntax).
 */

/** boolean `status` 컬럼을 가진 테이블. 이 목록 밖은 타입 오류가 된다. */
export const ACTIVE_WHEN_FALSE = [
  'system_company',
  'system_entity',
  'system_pod',
  'system_team',
  'finance_bank_account',
] as const;

export const ACTIVE_WHEN_TRUE = [
  'partner_term',
  'partner_client',
  'partner_vendor',
  'finance_gl',
  'finance_gl_seed',
  'finance_dimension',
] as const;

export type ActiveWhenFalseTable = (typeof ACTIVE_WHEN_FALSE)[number];
export type ActiveWhenTrueTable = (typeof ACTIVE_WHEN_TRUE)[number];

/** boolean status 를 가진 11개 테이블 */
export type StatusTable = ActiveWhenFalseTable | ActiveWhenTrueTable;

const TRUE_SET: ReadonlySet<string> = new Set(ACTIVE_WHEN_TRUE);
const FALSE_SET: ReadonlySet<string> = new Set(ACTIVE_WHEN_FALSE);

/**
 * DB 의 raw boolean 을 "활성인가?" 로 해석한다.
 *
 * @example
 *   isActive('system_company', row.status)   // false → true  (0=사용)
 *   isActive('partner_client', row.status)   // true  → true  (1=사용)
 */
export function isActive(table: StatusTable, dbStatus: boolean | null | undefined): boolean {
  if (dbStatus === null || dbStatus === undefined) return false;
  if (TRUE_SET.has(table)) return dbStatus === true;
  if (FALSE_SET.has(table)) return dbStatus === false;
  // 등록되지 않은 테이블 — 조용히 틀리느니 시끄럽게 깨진다.
  throw new Error(
    `[status] '${table}' 의 극성이 등록되지 않았습니다. ` +
      `packages/shared-constants/src/status.ts 의 ACTIVE_WHEN_TRUE / ACTIVE_WHEN_FALSE 에 추가하세요.`,
  );
}

/** 화면의 "활성" 값을 DB 에 저장할 raw boolean 으로 되돌린다. */
export function toDbStatus(table: StatusTable, active: boolean): boolean {
  if (TRUE_SET.has(table)) return active;
  if (FALSE_SET.has(table)) return !active;
  throw new Error(
    `[status] '${table}' 의 극성이 등록되지 않았습니다. ` +
      `packages/shared-constants/src/status.ts 에 추가하세요.`,
  );
}

/**
 * PostgREST 필터에 쓸 값. `active_only=true`(설계서 §11.1) 대응.
 *
 * @example
 *   supabase.from('partner_client').select().eq('status', activeFilterValue('partner_client'))
 */
export function activeFilterValue(table: StatusTable): boolean {
  return toDbStatus(table, true);
}

/*----------------------------------------------------------------------------
  문자열 status — boolean 과 별개 체계다.
----------------------------------------------------------------------------*/

/** `system_employee.status` — CK_emp_status 6종 */
export const EMPLOYEE_STATUS = {
  planned: '입사예정',
  probation: '수습',
  active: '재직',
  on_leave: '휴직',
  leaving_soon: '퇴사예정',
  inactive: '퇴사',
} as const;

export type EmployeeStatus = keyof typeof EMPLOYEE_STATUS;

/** 퇴사(inactive)만 비활성으로 본다 — 휴직·퇴사예정은 재직 중이다. */
export function isEmployeeActive(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== 'inactive';
}

/** `sales_contract.status` — 0 Active / 1 Inactive / 2 Suspend */
export const CONTRACT_STATUS = {
  '0': 'Active',
  '1': 'Inactive',
  '2': 'Suspend',
} as const;

export type ContractStatus = keyof typeof CONTRACT_STATUS;
