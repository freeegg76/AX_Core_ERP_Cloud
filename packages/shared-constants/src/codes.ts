/**
 * 코드값 사전 — 설계서 부록 A
 *
 * DB 코드값을 UI 에 직접 쓰지 않고 Enum/라벨로 변환한다(지침 §16).
 * v1.1 은 서버 Mapper 가 변환해 내려줬으나, v2.0 은 PostgREST 가 원시값을
 * 그대로 내려주므로 이 사전이 프론트엔드의 유일한 변환 지점이다.
 */

/** 권한 서열 — 설계서 §6.4. 정책은 부등호로 비교한다(auth_role_rank). */
export const ROLE_RANK = {
  VIEWER: 10,
  EDITOR: 20,
  APPROVER: 30,
  ADMIN: 40,
  SUPER: 50,
} as const;

export type AxRole = keyof typeof ROLE_RANK;

export const ROLE_LABEL: Record<AxRole, string> = {
  VIEWER: '조회',
  EDITOR: '편집',
  APPROVER: '승인',
  ADMIN: '관리자',
  SUPER: '최고관리자',
};

export function hasRole(current: AxRole | null | undefined, required: AxRole): boolean {
  if (!current) return false;
  return ROLE_RANK[current] >= ROLE_RANK[required];
}

/*------------------------------------------------------------------ FINANCE */

/** 차변/대변 */
export const DRCR = { '1': '차변', '2': '대변' } as const;
export type Drcr = keyof typeof DRCR;

/** 계정 구분 — gl_type 0~10 */
export const GL_TYPE = {
  '0': '자산',
  '1': '부채',
  '2': '자본',
  '3': '수익',
  '4': '매출원가',
  '5': '제조원가',
  '6': '용역원가',
  '7': '판매관리비',
  '8': '영업외수익',
  '9': '영업외비용',
  '10': '법인세등',
} as const;
export type GlType = keyof typeof GL_TYPE;

/** 이월 대상 계정 구분 — 설계서 §9.5. 자산·부채·자본만 이월된다. */
export const CARRY_FORWARD_GL_TYPES: readonly GlType[] = ['0', '1', '2'];

/** 보통계정 / 차감항목 */
export const GL_DETAIL = { '0': '보통계정', '1': '차감항목' } as const;

/** 전표 구분 */
export const LEDGER_TYPE = {
  '0': '일반',
  '1': '매입',
  '2': '매출',
  '3': '결산',
} as const;
export type LedgerType = keyof typeof LEDGER_TYPE;

/** 초기이월 출처 — 설계서 §9.6. 마감해제 시 회수 대상 식별에 쓴다. */
export const OPEN_BALANCE_SOURCE = {
  MANUAL: '수기',
  CLOSING: '연도마감 자동생성',
} as const;

/** GL 의 Layer3 플래그 12종. 전표 화면이 입력영역 활성/비활성을 판단하는 근거. */
export const LAYER3_FLAGS = [
  'bank_id',
  'team_id',
  'pod_id',
  'employee_id',
  'client_id',
  'vendor_id',
  'dimension1',
  'dimension2',
  'dimension3',
  'dimension4',
  'dimension5',
  'due_date',
] as const;
export type Layer3Flag = (typeof LAYER3_FLAGS)[number];

export const LAYER3_LABEL: Record<Layer3Flag, string> = {
  bank_id: '은행/카드',
  team_id: '부서',
  pod_id: 'Pod',
  employee_id: '직원',
  client_id: '고객사',
  vendor_id: '거래처',
  dimension1: '관리항목1',
  dimension2: '관리항목2',
  dimension3: '관리항목3',
  dimension4: '관리항목4',
  dimension5: '관리항목5',
  due_date: '지급/입금일',
};

/*-------------------------------------------------------------------- SALES */

export const PIPELINE_TYPE = {
  '0': '대행',
  '1': '사입',
  '2': '리테일',
  '3': '마케팅',
  '4': '기타',
} as const;

export const PIPELINE_STAGE = {
  '0': 'Lead',
  '1': 'Qualified Lead',
  '2': 'Suggest',
  '3': 'Meeting',
  '4': 'Nego',
  '5': 'Closed',
  '6': 'Canceled',
} as const;
export type PipelineStage = keyof typeof PIPELINE_STAGE;

/** stage 5/6 = 종료. 트리거가 closed_date 를 관리한다(설계서 §10.5). */
export const CLOSED_STAGES: readonly PipelineStage[] = ['5', '6'];

export const ACTIVITY_TYPE = {
  '0': '메일',
  '1': '전화',
  '2': '미팅',
  '3': '기타',
} as const;

/*------------------------------------------------------------------ PARTNER */

export const TERM_BASE_RULE = { EOM: '월말기준', CURM: '당월기준' } as const;
export type TermBaseRule = keyof typeof TERM_BASE_RULE;
