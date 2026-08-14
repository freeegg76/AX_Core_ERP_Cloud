/**
 * RPC 타입드 래퍼 — 설계서 §10.2 (RPC 20건)
 *
 * ⚠ 컴포넌트에서 `supabase.rpc()` 를 직접 부르지 않는다(§2.1 규칙 2).
 *   여기를 거쳐야 ① 오류가 AX 형태로 정규화되고 ② 인자 이름 오타를 타입이 잡는다.
 *
 * ⚠ 스코프(company_id/entity_id)를 넘기지 않는다. RPC 가 클레임에서 직접 읽는다(§5.4).
 */
import { supabase } from './supabase';
import { unwrap } from './errors';
import type { Layer3Flag } from '@ax-bridge/shared-constants';

/*--------------------------------------------------------------------- 타입 */

export interface LedgerHeadInput {
  ledger_date: string;
  /** 수정 시에만. 신규는 생략 — 트리거가 채번한다(C5) */
  ledger_no?: number;
  ledger_name?: string;
  ledger_type?: string;
  employee_id?: string;
}

/** ⚠ 배열 순서가 곧 line_on 이다(§9.1). 부분 저장 불가 — 항상 전체 집합을 보낸다. */
export interface LedgerLineInput {
  gl_id: string;
  drcr: '1' | '2';
  amount: number;
  bank_id?: string | null;
  team_id?: string | null;
  pod_id?: string | null;
  employee_id?: string | null;
  client_id?: string | null;
  vendor_id?: string | null;
  dimension1?: string | null;
  dimension2?: string | null;
  dimension3?: string | null;
  dimension4?: string | null;
  dimension5?: string | null;
  due_date?: string | null;
}

export interface LedgerSaved {
  ledger_date: string;
  ledger_no: number;
}

export interface LedgerLineRow extends LedgerLineInput {
  line_on: number;
  gl_name: string | null;
  bank_name: string | null;
  /** GL 플래그 12종 — 화면이 Layer3 활성/비활성을 판단하는 근거 */
  f_bank: boolean;
  f_team: boolean;
  f_pod: boolean;
  f_employee: boolean;
  f_client: boolean;
  f_vendor: boolean;
  f_dim1: boolean;
  f_dim2: boolean;
  f_dim3: boolean;
  f_dim4: boolean;
  f_dim5: boolean;
  f_due: boolean;
}

export interface LedgerDetail {
  head: Record<string, unknown>;
  lines: LedgerLineRow[];
}

export interface OpenBalanceRowInput {
  gl_id: string;
  drcr: '1' | '2';
  bank_id?: string | null;
  client_id?: string | null;
  vendor_id?: string | null;
  amount: number;
}

export interface OpenBalanceList {
  rows: Array<Record<string, unknown>>;
  totals: { debit_total: number; credit_total: number; difference: number };
}

export interface ClosingExecuted {
  closed_year_id: string;
  next_year_id: string;
  carried_rows: number;
}

export interface ClosingReopened {
  reopened_year_id: string;
  next_year_id: string | null;
  removed_rows: number;
}

export interface AccountChangePreview {
  gl_id: string;
  /** 비어 있지 않으면 화면이 사용자 확인을 받는다 — 무단 폐기 금지(§7.4) */
  conflicts: Layer3Flag[];
  flags: Record<Layer3Flag, boolean>;
}

/*------------------------------------------------------------------- 실행기 */

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // supabase-js 의 rpc 는 생성 타입에 묶여 있으나, 우리 함수 시그니처는 여기서 관리한다.
  const res = await (supabase.rpc as unknown as (
    f: string,
    a: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>)(fn, args);
  return unwrap(res) as T;
}

/*=============================================================== FINANCE (13) */

/** 1. 전표 저장 — v1.1 의 head_save + detail_save 통합(§11.4) */
export const saveLedger = (head: LedgerHeadInput, lines: LedgerLineInput[]) =>
  call<LedgerSaved>('ax_finance_ledger_save', { p_head: head, p_lines: lines });

/** 2. 전표 승인 — APPROVER */
export const approveLedger = (ledgerDate: string, ledgerNo: number) =>
  call<null>('ax_finance_ledger_approve', { p_ledger_date: ledgerDate, p_ledger_no: ledgerNo });

/** 3. 전표 삭제 — EDITOR, 미승인만 */
export const deleteLedger = (ledgerDate: string, ledgerNo: number) =>
  call<null>('ax_finance_ledger_delete', { p_ledger_date: ledgerDate, p_ledger_no: ledgerNo });

/** 4. 전표 상세 — 헤더 + 라인 + GL 플래그를 한 왕복으로 */
export const getLedger = (ledgerDate: string, ledgerNo: number) =>
  call<LedgerDetail>('ax_finance_ledger_get', { p_ledger_date: ledgerDate, p_ledger_no: ledgerNo });

/** 5. 계정 변경 미리보기 — ⚠ 값을 지우지 않고 목록만 돌려준다(§7.4) */
export const previewAccountChange = (newGlId: string, line: LedgerLineInput) =>
  call<AccountChangePreview>('ax_finance_ledger_preview_account_change', {
    p_new_gl_id: newGlId,
    p_line: line,
  });

/** 6. 초기이월 저장 — ⚠ 0원 입력은 "0으로 저장"이 아니라 **행 삭제**다(§9.4) */
export const saveOpenBalance = (companyYearId: string, rows: OpenBalanceRowInput[]) =>
  call<{ saved: number }>('ax_finance_openbalance_save', {
    p_company_year_id: companyYearId,
    p_rows: rows,
  });

/** 7. 초기이월 조회 — 행 + 합계를 한 왕복으로 */
export const listOpenBalance = (
  companyYearId: string,
  opts: { keyword?: string; drcr?: '1' | '2'; closed?: boolean } = {},
) =>
  call<OpenBalanceList>('ax_finance_openbalance_list', {
    p_company_year_id: companyYearId,
    p_gl_keyword: opts.keyword ?? null,
    p_drcr: opts.drcr ?? null,
    p_closed: opts.closed ?? null,
  });

/** 8. 초기이월 확정 — APPROVER */
export const closeOpenBalance = (companyYearId: string) =>
  call<null>('ax_finance_openbalance_close', { p_company_year_id: companyYearId });

/** 9. 초기이월 확정해제 — ADMIN */
export const reopenOpenBalance = (companyYearId: string) =>
  call<null>('ax_finance_openbalance_reopen', { p_company_year_id: companyYearId });

/** 10. 연도 회계마감 — ADMIN. actual_year 오름차순 순차 */
export const executeClosing = (companyYearId: string) =>
  call<ClosingExecuted>('ax_finance_closing_execute', { p_company_year_id: companyYearId });

/** 11. 연도 회계마감 해제 — ADMIN, C12. ⚠ 해제는 내림차순 순차 */
export const reopenClosing = (companyYearId: string) =>
  call<ClosingReopened>('ax_finance_closing_reopen', { p_company_year_id: companyYearId });

/** 12. 마감 현황 */
export const getClosingStatus = (companyYearId: string) =>
  call<Record<string, unknown>>('ax_finance_closing_status', { p_company_year_id: companyYearId });

/** 13. 표준 계정과목 재생성 — ADMIN. 전표가 1건이라도 있으면 불가 */
export const generateStandardGl = () =>
  call<{ inserted_count: number }>('ax_finance_gl_generate_standard');

/** 14. 관리항목 저장 — Slot 은 서버가 할당한다(§9.8) */
export const saveDimension = (dim: {
  dimension_id: string;
  dimension_name?: string;
  status?: boolean;
}) => call<{ dimension_id: string; slot_no: number }>('ax_finance_dimension_save', { p_dim: dim });

/** 15. 관리항목 삭제 */
export const deleteDimension = (dimensionId: string) =>
  call<null>('ax_finance_dimension_delete', { p_dimension_id: dimensionId });

/*============================================================ PARTNER · SALES */

/**
 * 16. 지급일 계산
 * ⚠ 프론트엔드는 이 계산을 재구현하지 않는다. 미리보기도 이 함수를 호출한다.
 *    v1.1 §15.1 이 경고한 "미리보기와 저장이 갈린다"를 설계에서 제거한 것이다(§9.11).
 */
export const calcDueDate = (termId: string, baseDate: string) =>
  call<string>('ax_partner_term_calc_due', { p_term_id: termId, p_base_date: baseDate });

/** 17. 계약 ↔ 전표 연결/해제. 둘 다 생략하면 해제 */
export const linkContractLedger = (
  contractId: string,
  contractType: string,
  ledgerDate?: string,
  ledgerNo?: number,
) =>
  call<null>('ax_sales_contract_link_ledger', {
    p_contract_id: contractId,
    p_contract_type: contractType,
    p_ledger_date: ledgerDate ?? null,
    p_ledger_no: ledgerNo ?? null,
  });

/** 18. 파이프라인 ↔ 계약 연결/해제 */
export const linkPipelineContract = (pipelineId: string, contractId?: string) =>
  call<null>('ax_sales_pipeline_link_contract', {
    p_pipeline_id: pipelineId,
    p_contract_id: contractId ?? null,
  });

/*==================================================================== SYSTEM */

/** 19. 직원 삭제 — ADMIN. 5개 테이블 참조검사 */
export const deleteEmployee = (employeeId: string) =>
  call<null>('ax_system_employee_delete', { p_employee_id: employeeId });

/** 20. 역할 변경 — ADMIN. ⚠ 자기 자신은 못 바꾸고, 자기보다 높은 역할은 부여 불가 */
export const setEmployeeRole = (employeeId: string, role: string) =>
  call<null>('ax_system_employee_set_role', { p_employee_id: employeeId, p_role: role });
