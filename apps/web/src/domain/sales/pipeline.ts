/**
 * Pipeline 도메인 — 설계서 §7.3 · §2.1(도메인 계층)
 *
 * ⚠ 이 파일은 **프레임워크에 의존하지 않는 순수 TypeScript** 다.
 *   React · supabase-js · antd 를 import 하지 않는다(§2.1 규칙 1).
 *
 * ⚠ **Stage 전환은 단순 속성 대입을 금지한다**(지침 §5, §7.3).
 *     금지 : pipeline.stage = '5'
 *     권장 : pipeline.close()  — 의미 있는 메서드가 전이 규칙을 함께 담는다
 *
 * ⚠ 이 메서드들은 **Domain 표현일 뿐 별도 RPC 가 아니다.** stage 전환은
 *   `sales_pipeline` 의 일반 PATCH 로 수행되고, `adjusted_date`/`closed_date` 는
 *   트리거 `trg_sales_pipeline_audit` 가 관리한다(§11.3).
 *   즉 이 계층은 **어떤 전이가 허용되는가**만 정하고, 날짜는 DB 가 채운다.
 */

export const STAGE = {
  LEAD: '0',
  QUALIFIED_LEAD: '1',
  SUGGEST: '2',
  MEETING: '3',
  NEGO: '4',
  CLOSED: '5',
  CANCELED: '6',
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

/** 종료 상태. 트리거가 closed_date 를 채우고, 재오픈 시 NULL 로 해제한다. */
export const CLOSED_STAGES: readonly Stage[] = [STAGE.CLOSED, STAGE.CANCELED];

export function isClosedStage(stage: Stage): boolean {
  return CLOSED_STAGES.includes(stage);
}

/** 진행 단계의 순서 — 되돌리기(후퇴)를 허용할지 판단하는 근거 */
const PROGRESS_ORDER: readonly Stage[] = [
  STAGE.LEAD, STAGE.QUALIFIED_LEAD, STAGE.SUGGEST, STAGE.MEETING, STAGE.NEGO,
];

export class PipelineStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineStageError';
  }
}

/**
 * 파이프라인 Aggregate.
 *
 * 화면은 이 객체를 통해서만 stage 를 바꾸고, 결과 `stage` 값을 PATCH 로 보낸다.
 * DB 는 같은 규칙을 CHECK(`ck_pipe_stage`)와 트리거로 독립 강제한다(§2.3 3중 배치).
 */
export class Pipeline {
  constructor(
    readonly pipelineId: string,
    private _stage: Stage,
    readonly clientName: string | null = null,
    readonly contractId: string | null = null,
  ) {}

  get stage(): Stage {
    return this._stage;
  }

  get isClosed(): boolean {
    return isClosedStage(this._stage);
  }

  /** 진행 단계를 앞으로 옮긴다. 종료 상태에서는 재오픈이 먼저다. */
  moveTo(next: Stage): void {
    if (this.isClosed && !isClosedStage(next)) {
      throw new PipelineStageError(
        '종료된 파이프라인입니다. 먼저 재오픈한 뒤 단계를 변경하세요.',
      );
    }
    if (isClosedStage(next)) {
      throw new PipelineStageError(
        '종료 처리는 close() 또는 cancel() 을 사용하세요.',
      );
    }
    this._stage = next;
  }

  moveToQualifiedLead(): void { this.moveTo(STAGE.QUALIFIED_LEAD); }
  moveToSuggest(): void { this.moveTo(STAGE.SUGGEST); }
  moveToMeeting(): void { this.moveTo(STAGE.MEETING); }
  moveToNegotiation(): void { this.moveTo(STAGE.NEGO); }

  /** 성사 종료 — 트리거가 closed_date 를 기록한다 */
  close(): void {
    if (this._stage === STAGE.CANCELED) {
      throw new PipelineStageError('취소된 파이프라인은 성사 처리할 수 없습니다. 먼저 재오픈하세요.');
    }
    this._stage = STAGE.CLOSED;
  }

  /** 취소 종료 — 트리거가 closed_date 를 기록한다 */
  cancel(): void {
    if (this._stage === STAGE.CLOSED) {
      throw new PipelineStageError('성사된 파이프라인은 취소할 수 없습니다. 먼저 재오픈하세요.');
    }
    this._stage = STAGE.CANCELED;
  }

  /**
   * 재오픈 — 트리거가 closed_date 를 NULL 로 해제한다.
   * 되돌아갈 단계는 협상(Nego)으로 둔다. 종료 직전 단계를 DB 가 기억하지 않기 때문이다.
   */
  reopen(): void {
    if (!this.isClosed) {
      throw new PipelineStageError('종료되지 않은 파이프라인입니다.');
    }
    this._stage = STAGE.NEGO;
  }

  /**
   * 계약 연결 검증 — 파이프라인 `client_name` 과 계약 고객사명이 일치해야 한다(FR-Pipe-08).
   * 서버는 trg_sales_pipeline_refs 가 계약 실재만 검사하므로, 이름 일치는 여기가 1차다.
   */
  canLinkContract(contractClientName: string | null): boolean {
    if (!this.clientName || !contractClientName) return true;
    return this.clientName.trim() === contractClientName.trim();
  }

  /** 진행률 표시용 (0~4 단계만 의미가 있다) */
  get progressIndex(): number {
    return PROGRESS_ORDER.indexOf(this._stage);
  }
}

/*============================================================================
  Activity VO — 설계서 §7.3 (FR-Act-06)

  ⚠ `attached` 는 **파일 업로드가 아니라 URL/링크 문자열**이다(varchar(250)).
    업로드·스토리지 요구는 FR 에 없다 — Storage 는 v2.0 범위 밖(§3).
============================================================================*/

const ALLOWED_SCHEMES = ['http:', 'https:'] as const;
export const ATTACHED_MAX_LENGTH = 250;

/**
 * 첨부 링크 검증. 규칙 3가지 — 스킴 허용목록 · 250자 이내 · 공백 불허.
 * 통과하면 null, 실패하면 사용자 메시지를 반환한다.
 */
export function validateAttachedLink(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') return null; // 선택 항목

  if (value.length > ATTACHED_MAX_LENGTH) {
    return `첨부 링크는 ${ATTACHED_MAX_LENGTH}자 이내여야 합니다.`;
  }
  if (/\s/.test(value)) {
    return '첨부 링크에 공백을 포함할 수 없습니다.';
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '첨부 링크 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작해야 합니다.';
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol as (typeof ALLOWED_SCHEMES)[number])) {
    return 'http 또는 https 링크만 사용할 수 있습니다.';
  }
  return null;
}
