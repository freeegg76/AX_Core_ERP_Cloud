/**
 * Ledger 도메인 — 설계서 §7.4 · §9.1 · §9.3
 *
 * ⚠ 순수 TypeScript. React·supabase-js·antd 를 import 하지 않는다(§2.1 규칙 1).
 *
 * ⚠ **전표는 Head/Detail 테이블을 그대로 노출하지 않고 하나의 Aggregate 로 다룬다**(지침 §17).
 *   화면은 라인 배열을 직접 주무르지 않고 이 객체를 거친다.
 *
 * 강제 권위는 DB 에 있다(§2.3). 여기는 **사용자에게 규칙을 미리 보여주는** 역할이며,
 * 특히 차대 균형과 Layer3 충돌은 즉시 피드백이 필요해 중복 표현한다.
 */

export const DEBIT = '1';
export const CREDIT = '2';
export type DebitCredit = typeof DEBIT | typeof CREDIT;

/** GL 의 Layer3 사용 플래그 12종 (FR-GL-06) */
export interface GlFlags {
  bank_id: boolean;
  team_id: boolean;
  pod_id: boolean;
  employee_id: boolean;
  client_id: boolean;
  vendor_id: boolean;
  dimension1: boolean;
  dimension2: boolean;
  dimension3: boolean;
  dimension4: boolean;
  dimension5: boolean;
  due_date: boolean;
}

export type Layer3Key = keyof GlFlags;

export const LAYER3_KEYS: readonly Layer3Key[] = [
  'bank_id', 'team_id', 'pod_id', 'employee_id', 'client_id', 'vendor_id',
  'dimension1', 'dimension2', 'dimension3', 'dimension4', 'dimension5', 'due_date',
];

/** 전표 라인. Layer3 값은 전부 선택적이며 GL 플래그가 허용할 때만 채울 수 있다. */
export interface LedgerLineData {
  /** 화면에서만 쓰는 안정 키. line_on 은 저장마다 바뀌므로 추적에 쓰면 안 된다(§9.1). */
  key: string;
  gl_id: string | null;
  gl_name?: string | null;
  drcr: DebitCredit;
  amount: number | null;
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

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/*============================================================================
  LedgerLine — Layer3 충돌 판정
============================================================================*/

/**
 * 새 계정의 플래그로는 허용되지 않는데 값이 남아 있는 항목을 찾는다.
 *
 * ⚠⚠ **이 함수는 값을 지우지 않는다.** 목록만 돌려준다.
 *   사용자 확인 전 무단 폐기 금지가 설계 의도다(§7.4 · UC-Ledger-04 예외).
 *   화면이 확인을 받은 뒤 clearLayer3() 를 호출한다.
 */
export function conflictsWith(line: LedgerLineData, flags: GlFlags): Layer3Key[] {
  return LAYER3_KEYS.filter((k) => !flags[k] && line[k] != null && line[k] !== '');
}

/** 확인을 받은 뒤에만 호출한다. 원본을 바꾸지 않고 새 객체를 돌려준다. */
export function clearLayer3(line: LedgerLineData, keys: readonly Layer3Key[]): LedgerLineData {
  const next: LedgerLineData = { ...line };
  for (const k of keys) next[k] = null;
  return next;
}

/** 플래그가 켜져 있는데 값이 비어 있는 필수 항목 — 은행/카드만 필수다(50464) */
export function missingRequired(line: LedgerLineData, flags: GlFlags): Layer3Key[] {
  return flags.bank_id && !line.bank_id ? ['bank_id'] : [];
}

/*============================================================================
  Ledger Aggregate
============================================================================*/

export interface LedgerTotals {
  debit: number;
  credit: number;
  /** 차변 − 대변. 0 이어야 승인할 수 있다(FR-Ledger-10). */
  difference: number;
  balanced: boolean;
}

export class Ledger {
  constructor(
    readonly ledgerDate: string,
    readonly ledgerNo: number | null,
    private _lines: LedgerLineData[],
    readonly approved: boolean = false,
    /** 해당 연도가 회계마감 상태인가 */
    readonly yearClosed: boolean = false,
  ) {}

  get lines(): readonly LedgerLineData[] {
    return this._lines;
  }

  /** 실시간 차대 합계 — Layer2 상단에 표시한다(§12.5) */
  get totals(): LedgerTotals {
    let debit = 0;
    let credit = 0;
    for (const l of this._lines) {
      const amt = l.amount ?? 0;
      if (l.drcr === DEBIT) debit += amt;
      else credit += amt;
    }
    const difference = debit - credit;
    return { debit, credit, difference, balanced: difference === 0 && this._lines.length > 0 };
  }

  /** 편집 가능 여부 — 마감연도 검사가 승인여부 검사보다 **먼저**다(§15.1) */
  assertEditable(): void {
    if (this.yearClosed) {
      throw new LedgerError('회계마감된 연도의 전표는 수정할 수 없습니다.');
    }
    if (this.approved) {
      throw new LedgerError('승인된 전표는 수정할 수 없습니다. 먼저 승인을 해제하세요.');
    }
  }

  /**
   * 승인 가능 여부 — 미승인 + 라인 존재 + 차대균형(§7.4).
   * ⚠ 마감 검사를 승인여부 검사보다 먼저 한다. 두 조건이 겹칠 때 어떤 메시지가
   *   나가는지가 사용자 안내의 정확성을 좌우한다(§15.1).
   */
  assertApprovable(): void {
    if (this.yearClosed) {
      throw new LedgerError('회계마감된 연도의 전표는 승인할 수 없습니다.');
    }
    if (this.approved) {
      throw new LedgerError('이미 승인된 전표입니다.');
    }
    if (this._lines.length === 0) {
      throw new LedgerError('전표 라인이 없어 승인할 수 없습니다.');
    }
    const t = this.totals;
    if (!t.balanced) {
      throw new LedgerError(
        `차변합계와 대변합계가 일치하지 않습니다. 차액: ${t.difference.toLocaleString()}`,
      );
    }
  }

  get canApprove(): boolean {
    try {
      this.assertApprovable();
      return true;
    } catch {
      return false;
    }
  }

  /** 저장 전 최소 검증 — 서버(50462)가 최종 판정하지만 왕복을 줄인다 */
  validateForSave(): string | null {
    if (this._lines.length === 0) return '전표 라인을 1건 이상 입력하세요.';
    for (const [i, l] of this._lines.entries()) {
      if (!l.gl_id) return `${i + 1}번 라인의 계정과목을 선택하세요.`;
      if (l.drcr !== DEBIT && l.drcr !== CREDIT) return `${i + 1}번 라인의 차대구분이 올바르지 않습니다.`;
      if ((l.amount ?? 0) <= 0) return `${i + 1}번 라인의 금액은 0보다 커야 합니다.`;
    }
    return null;
  }

  /**
   * 저장용 배열. **순서가 곧 line_on 이다**(§9.1).
   * 화면 키(key)와 표시용 필드(gl_name)는 제외한다.
   */
  toSavePayload(): Array<Omit<LedgerLineData, 'key' | 'gl_name'>> {
    return this._lines.map(({ key: _key, gl_name: _n, ...rest }) => rest);
  }
}

/** 라인 키 생성 — line_on 은 저장마다 바뀌므로 클라이언트 임시 키로 추적한다(§9.1) */
let seq = 0;
export function newLineKey(): string {
  seq += 1;
  return `L${seq}`;
}

export function emptyLine(): LedgerLineData {
  return { key: newLineKey(), gl_id: null, drcr: DEBIT, amount: null };
}
