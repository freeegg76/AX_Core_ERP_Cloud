/**
 * 오류코드 체계 — 설계서 부록 B
 *
 * 대역
 *   40xxx  RPC 내 역할 검사 거부 (v2.0 신설)      → HTTP 403
 *   50xxx  업무 규칙 위반                          → HTTP 400 (일부 404/409)
 *   51xxx  트리거 — 상태 잠금 위반                 → HTTP 409
 *
 * 오류가 브라우저에 도달하는 경로는 세 가지이며 **서로 다른 모양**이다(부록 B.3).
 *   ① RPC 의 ax_raise      {code:'PT400', message:'한글…', hint:'AX-50464'}
 *   ② 제약 위반            {code:'23505'|'23503'|'23514', message:'영문 원문', details:'…'}
 *   ③ RLS 거부             {code:'42501', message:'new row violates row-level security policy'}
 *
 * ②③ 의 영문 원문은 **사용자에게 노출하지 않는다** — ③은 정책 구조가 새어 나간다.
 */

export interface AxError {
  /** `AX-50464` 형태. 미상이면 `AX-UNKNOWN`. */
  code: string;
  /** 사용자에게 보여줄 한글 메시지 */
  message: string;
  /** 개발자용 원문. 화면에 표시하지 않는다. */
  detail?: string;
}

/**
 * 제약 이름 → 한글 메시지 (부록 B.3 ②)
 *
 * ⚠ 제약 이름이 곧 메시지 키다. 그래서 DDL 의 제약 이름을 의미 있게 짓는다.
 *   새 제약을 추가하면 여기에도 등록한다 — 없으면 일반 메시지로 떨어진다.
 */
export const CONSTRAINT_MESSAGES: Record<string, AxError> = {
  /*--- 유니크 (23505) ---*/
  pk_system_company: { code: 'AX-50101', message: '이미 존재하는 그룹 코드입니다.' },
  pk_system_entity: { code: 'AX-50111', message: '이미 존재하는 회사 코드입니다.' },
  pk_system_pod: { code: 'AX-50121', message: '이미 존재하는 Pod 코드입니다.' },
  pk_system_team: { code: 'AX-50131', message: '이미 존재하는 부서 코드입니다.' },
  pk_system_employee: { code: 'AX-50141', message: '이미 존재하는 사번입니다.' },
  uq_employee_email: { code: 'AX-50148', message: '이미 사용 중인 이메일입니다.' },
  ux_system_employee_user_id: { code: 'AX-50149', message: '이미 사용 중인 사용자 ID 입니다.' },
  pk_system_year: { code: 'AX-50151', message: '이미 존재하는 기수 코드입니다.' },
  uq_year_actual: { code: 'AX-50152', message: '이미 등록된 회계연도입니다.' },
  pk_partner_term: { code: 'AX-50201', message: '이미 존재하는 지급정책 코드입니다.' },
  pk_partner_client: { code: 'AX-50211', message: '이미 존재하는 고객사 코드입니다.' },
  pk_partner_vendor: { code: 'AX-50221', message: '이미 존재하는 거래처 코드입니다.' },
  pk_sales_pipeline: { code: 'AX-50301', message: '이미 존재하는 파이프라인 코드입니다.' },
  pk_sales_contract: { code: 'AX-50331', message: '이미 존재하는 계약입니다.' },
  pk_finance_gl: { code: 'AX-50401', message: '이미 존재하는 계정과목 코드입니다.' },
  pk_finance_dimension: { code: 'AX-50421', message: '이미 존재하는 관리항목 코드입니다.' },
  uq_dim_slot: { code: 'AX-50426', message: '해당 Slot 은 이미 사용 중입니다.' },
  ux_dim_value: { code: 'AX-50427', message: '같은 관리항목 안에 중복된 값이 있습니다.' },
  pk_finance_bank_account: { code: 'AX-50481', message: '이미 존재하는 은행/카드 코드입니다.' },
  ux_bank_account: { code: 'AX-50482', message: '이미 등록된 계좌번호입니다.' },
  ux_bank_card: { code: 'AX-50483', message: '이미 등록된 카드번호입니다.' },
  pk_finance_open_balance: {
    code: 'AX-50437',
    message: '동일 계정/차대/은행·카드/고객사/거래처 조합이 이미 존재합니다.',
  },
  pk_finance_ledger_head: { code: 'AX-50453', message: '이미 존재하는 전표입니다.' },

  /*--- CHECK (23514) ---*/
  ck_emp_status: { code: 'AX-50143', message: '유효하지 않은 재직상태입니다.' },
  ck_emp_role: { code: 'AX-50146', message: '유효하지 않은 권한입니다.' },
  ck_term_rule: { code: 'AX-50202', message: '기준규칙은 EOM 또는 CURM 이어야 합니다.' },
  ck_term_shape: {
    code: 'AX-50203',
    message: '월말기준은 지정일을 비우고, 당월기준은 지정일(1~31)만 입력합니다.',
  },
  ck_dim_slot: { code: 'AX-50422', message: '관리항목 Slot 은 1~5 만 가능합니다.' },
  ck_bank_one: {
    code: 'AX-50484',
    message: '계좌번호와 카드번호 중 정확히 하나만 입력해야 합니다.',
  },
  ck_ct_dates: { code: 'AX-50332', message: '계약 종료일은 시작일보다 빠를 수 없습니다.' },
  ck_ct_ledger: {
    code: 'AX-50333',
    message: '전표일자와 전표번호는 함께 입력하거나 함께 비워야 합니다.',
  },
  ck_ob_drcr: { code: 'AX-50433', message: '차대구분은 1(차변) 또는 2(대변)이어야 합니다.' },
  ck_ld_drcr: { code: 'AX-50462', message: '차대구분은 1(차변) 또는 2(대변)이어야 합니다.' },
  ck_ob_source: { code: 'AX-50438', message: '유효하지 않은 초기이월 출처입니다.' },
  ck_gl_type: { code: 'AX-50402', message: '유효하지 않은 계정 구분입니다.' },
  ck_gl_detail: { code: 'AX-50403', message: '유효하지 않은 계정 상세구분입니다.' },
  ck_gl_contra_self: { code: 'AX-50404', message: '차감계정은 자기 자신을 지정할 수 없습니다.' },
  ck_gl_contra_shape: {
    code: 'AX-50405',
    message: '차감항목이 아닌 계정에는 차감 대상을 지정할 수 없습니다.',
  },
  ck_pipe_type: { code: 'AX-50302', message: '유효하지 않은 파이프라인 구분입니다.' },
  ck_pipe_stage: { code: 'AX-50303', message: '유효하지 않은 단계입니다.' },
  ck_act_type: { code: 'AX-50321', message: '유효하지 않은 활동 구분입니다.' },
  ck_ct_type: { code: 'AX-50334', message: '유효하지 않은 계약 구분입니다.' },
  ck_ct_status: { code: 'AX-50335', message: '유효하지 않은 계약 상태입니다.' },
  ck_lh_type: { code: 'AX-50454', message: '유효하지 않은 전표 구분입니다.' },

  /*--- FK (23503) — ON DELETE RESTRICT 가 참조를 지킨다(§9.9) ---*/
  fk_entity_company: { code: 'AX-50112', message: '존재하지 않는 그룹입니다.' },
  fk_pod_entity: { code: 'AX-50122', message: '존재하지 않는 회사입니다.' },
  fk_team_pod: { code: 'AX-50133', message: '존재하지 않거나 사용할 수 없는 Pod 입니다.' },
  fk_emp_team: { code: 'AX-50142', message: '존재하지 않는 부서입니다.' },
  fk_client_term: { code: 'AX-50212', message: '존재하지 않는 지급정책입니다.' },
  fk_vendor_term: { code: 'AX-50222', message: '존재하지 않는 지급정책입니다.' },
  fk_ct_client: { code: 'AX-50336', message: '존재하지 않는 고객사입니다.' },
  fk_pipe_emp: { code: 'AX-50304', message: '존재하지 않는 직원입니다.' },
  fk_ld_gl: { code: 'AX-50463', message: '존재하지 않는 계정과목입니다.' },
  fk_ld_bank: { code: 'AX-50464', message: '존재하지 않는 은행/카드입니다.' },
  fk_ob_gl: { code: 'AX-50434', message: '존재하지 않는 계정과목입니다.' },
  fk_ob_year: { code: 'AX-50431', message: '존재하지 않는 회사 기수입니다.' },
  fk_ob_bank: { code: 'AX-50522', message: '존재하지 않는 은행/카드입니다.' },
  fk_closing_year: { code: 'AX-50511', message: '존재하지 않는 회사 기수입니다.' },
  fk_emp_auth_user: { code: 'AX-50150', message: '연결된 로그인 계정이 존재하지 않습니다.' },
};

/** 참조 무결성 위반(23503)이 삭제 방향일 때의 일반 메시지 — §9.9 */
export const REFERENCED_MESSAGE: AxError = {
  code: 'AX-50000',
  message: '다른 데이터에서 참조 중이라 삭제할 수 없습니다. 미사용으로 전환하세요.',
};

export const PERMISSION_DENIED: AxError = {
  code: 'AX-40300',
  message: '권한이 없습니다.',
};

export const UNAUTHENTICATED: AxError = {
  code: 'AX-40100',
  message: '인증이 만료되었습니다. 다시 로그인해 주세요.',
};

export const UNKNOWN_ERROR: AxError = {
  code: 'AX-UNKNOWN',
  message: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};
