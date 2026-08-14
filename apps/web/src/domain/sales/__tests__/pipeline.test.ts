/**
 * Pipeline 도메인 단위 테스트 — 설계서 §15(테스트 계층 3: 프론트 유닛)
 *
 * 테스트명에 FR ID 를 포함해 추적성을 확보한다(§14).
 * ⚠ 이 테스트는 DB 없이 실행된다 — 순수 TS 도메인이기 때문이다.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHED_MAX_LENGTH,
  Pipeline,
  PipelineStageError,
  STAGE,
  isClosedStage,
  validateAttachedLink,
  type Stage,
} from '../pipeline';

// ⚠ 기본값을 그대로 두면 TS 가 stage 를 리터럴 "0" 으로 좁혀 다른 단계를 못 넣는다.
const make = (stage: Stage = STAGE.LEAD, clientName: string | null = '가나상사') =>
  new Pipeline('P001', stage, clientName);

describe('Pipeline stage 전이 (FR-Pipe-07, §7.3)', () => {
  it('FR-Pipe-07: 진행 단계를 앞으로 옮긴다', () => {
    const p = make();
    p.moveToQualifiedLead();
    expect(p.stage).toBe(STAGE.QUALIFIED_LEAD);
    p.moveToMeeting();
    expect(p.stage).toBe(STAGE.MEETING);
    expect(p.isClosed).toBe(false);
  });

  it('FR-Pipe-07: close() 는 Closed(5) 로 보낸다 — closed_date 는 트리거가 기록', () => {
    const p = make(STAGE.NEGO);
    p.close();
    expect(p.stage).toBe(STAGE.CLOSED);
    expect(p.isClosed).toBe(true);
  });

  it('FR-Pipe-07: cancel() 은 Canceled(6) 로 보낸다', () => {
    const p = make(STAGE.SUGGEST);
    p.cancel();
    expect(p.stage).toBe(STAGE.CANCELED);
    expect(p.isClosed).toBe(true);
  });

  it('FR-Pipe-07: reopen() 은 종료를 해제한다 — 트리거가 closed_date 를 NULL 로', () => {
    const p = make(STAGE.CLOSED);
    p.reopen();
    expect(p.stage).toBe(STAGE.NEGO);
    expect(p.isClosed).toBe(false);
  });

  /*--- 아래 4건이 "속성 직접 대입 금지" 가 실제로 막아주는 것들이다 ---*/

  it('종료 상태에서는 단계를 바로 바꿀 수 없다 — 재오픈이 먼저다', () => {
    const p = make(STAGE.CLOSED);
    expect(() => p.moveToMeeting()).toThrow(PipelineStageError);
    expect(p.stage).toBe(STAGE.CLOSED); // 실패해도 상태가 오염되지 않는다
  });

  it('moveTo 로 종료 상태에 갈 수 없다 — close()/cancel() 을 써야 한다', () => {
    const p = make(STAGE.NEGO);
    expect(() => p.moveTo(STAGE.CLOSED)).toThrow(/close\(\) 또는 cancel\(\)/);
  });

  it('취소된 것을 성사로 바꿀 수 없다', () => {
    const p = make(STAGE.CANCELED);
    expect(() => p.close()).toThrow(/재오픈/);
  });

  it('성사된 것을 취소로 바꿀 수 없다', () => {
    const p = make(STAGE.CLOSED);
    expect(() => p.cancel()).toThrow(/재오픈/);
  });

  it('종료되지 않은 것은 재오픈할 수 없다', () => {
    expect(() => make(STAGE.MEETING).reopen()).toThrow(/종료되지 않은/);
  });

  it('isClosedStage — 5/6 만 종료다', () => {
    expect(isClosedStage(STAGE.CLOSED)).toBe(true);
    expect(isClosedStage(STAGE.CANCELED)).toBe(true);
    expect(isClosedStage(STAGE.NEGO)).toBe(false);
    expect(isClosedStage(STAGE.LEAD)).toBe(false);
  });
});

describe('계약 연결 검증 (FR-Pipe-08)', () => {
  it('FR-Pipe-08: 고객사명이 다르면 연결할 수 없다', () => {
    expect(make(STAGE.NEGO, '가나상사').canLinkContract('다라물산')).toBe(false);
  });

  it('FR-Pipe-08: 고객사명이 같으면 연결할 수 있다', () => {
    expect(make(STAGE.NEGO, '가나상사').canLinkContract('가나상사')).toBe(true);
  });

  it('공백 차이는 무시한다', () => {
    expect(make(STAGE.NEGO, ' 가나상사 ').canLinkContract('가나상사')).toBe(true);
  });

  it('한쪽이 비어 있으면 검증하지 않는다', () => {
    expect(make(STAGE.NEGO, null).canLinkContract('가나상사')).toBe(true);
    expect(make(STAGE.NEGO, '가나상사').canLinkContract(null)).toBe(true);
  });
});

describe('Activity 첨부 링크 (FR-Act-06, §7.3)', () => {
  it('FR-Act-06: http/https 링크를 허용한다', () => {
    expect(validateAttachedLink('https://example.com/a.pdf')).toBeNull();
    expect(validateAttachedLink('http://example.com')).toBeNull();
  });

  it('FR-Act-06: 선택 항목이므로 빈 값은 통과한다', () => {
    expect(validateAttachedLink(null)).toBeNull();
    expect(validateAttachedLink(undefined)).toBeNull();
    expect(validateAttachedLink('')).toBeNull();
    expect(validateAttachedLink('   ')).toBeNull();
  });

  it('FR-Act-06: 스킴 허용목록 밖은 거부한다', () => {
    // ⚠ javascript: 는 XSS 경로가 된다 — 이 검증이 막는 실질적 위험이다
    expect(validateAttachedLink('javascript:alert(1)')).toMatch(/http 또는 https/);
    expect(validateAttachedLink('file:///etc/passwd')).toMatch(/http 또는 https/);
    expect(validateAttachedLink('ftp://example.com')).toMatch(/http 또는 https/);
  });

  it('FR-Act-06: 공백을 포함할 수 없다', () => {
    expect(validateAttachedLink('https://example.com/a b.pdf')).toMatch(/공백/);
  });

  it(`FR-Act-06: ${ATTACHED_MAX_LENGTH}자를 넘을 수 없다`, () => {
    const long = 'https://example.com/' + 'a'.repeat(ATTACHED_MAX_LENGTH);
    expect(validateAttachedLink(long)).toMatch(/250자/);
  });

  it('URL 형식이 아니면 거부한다', () => {
    expect(validateAttachedLink('그냥문자열')).toMatch(/형식이 올바르지 않/);
  });
});
