/**
 * Ledger 도메인 단위 테스트 — 설계서 §15.4
 *
 * 설계서가 "회귀하면 조용히 틀릴 수 있는 규칙"으로 지목한 두 가지를 여기서 고정한다.
 *   ① conflictsWith() 는 값을 **지우지 않는다**
 *   ② approve 판정은 **마감 검사를 승인여부 검사보다 먼저** 한다
 */
import { describe, expect, it } from 'vitest';
import {
  CREDIT, DEBIT, Ledger, LedgerError, clearLayer3, conflictsWith,
  emptyLine, missingRequired, newLineKey,
  type GlFlags, type LedgerLineData,
} from '../ledger';

const allOff: GlFlags = {
  bank_id: false, team_id: false, pod_id: false, employee_id: false,
  client_id: false, vendor_id: false, dimension1: false, dimension2: false,
  dimension3: false, dimension4: false, dimension5: false, due_date: false,
};
const allOn: GlFlags = Object.fromEntries(
  Object.keys(allOff).map((k) => [k, true]),
) as unknown as GlFlags;

const line = (over: Partial<LedgerLineData> = {}): LedgerLineData => ({
  key: newLineKey(), gl_id: '1010000', drcr: DEBIT, amount: 1000, ...over,
});

describe('Layer3 충돌 판정 (UC-Ledger-04, §7.4)', () => {
  it('플래그가 꺼진 항목에 값이 남아 있으면 충돌로 잡는다', () => {
    const l = line({ client_id: 'CL001', due_date: '2026-03-31' });
    expect(conflictsWith(l, allOff).sort()).toEqual(['client_id', 'due_date']);
  });

  it('플래그가 켜져 있으면 충돌이 아니다', () => {
    const l = line({ client_id: 'CL001', due_date: '2026-03-31' });
    expect(conflictsWith(l, allOn)).toEqual([]);
  });

  it('빈 문자열도 값 없음으로 본다', () => {
    expect(conflictsWith(line({ client_id: '' }), allOff)).toEqual([]);
  });

  /*--- ⭐ 설계서가 지목한 회귀 지점 ① ---*/
  it('⭐ conflictsWith 는 값을 지우지 않는다 — 무단 폐기 금지(§7.4)', () => {
    const l = line({ client_id: 'CL001', dimension1: 'A' });
    const before = { ...l };
    conflictsWith(l, allOff);
    // 판정만 했을 뿐 원본이 그대로여야 한다
    expect(l).toEqual(before);
    expect(l.client_id).toBe('CL001');
  });

  it('clearLayer3 는 확인 후에만 호출되며 원본을 바꾸지 않는다', () => {
    const l = line({ client_id: 'CL001', dimension1: 'A' });
    const cleared = clearLayer3(l, ['client_id']);
    expect(cleared.client_id).toBeNull();
    expect(cleared.dimension1).toBe('A');   // 지정하지 않은 것은 유지
    expect(l.client_id).toBe('CL001');      // 원본 불변
  });

  it('은행 플래그가 켜졌는데 값이 없으면 필수 누락이다 (50464)', () => {
    expect(missingRequired(line(), { ...allOff, bank_id: true })).toEqual(['bank_id']);
    expect(missingRequired(line({ bank_id: 'B001' }), { ...allOff, bank_id: true })).toEqual([]);
    expect(missingRequired(line(), allOff)).toEqual([]);
  });
});

describe('차대 균형 (FR-Ledger-10, §12.5)', () => {
  it('실시간 합계와 차액을 계산한다', () => {
    const l = new Ledger('2026-04-01', 1, [
      line({ drcr: DEBIT, amount: 500000 }),
      line({ drcr: CREDIT, amount: 300000 }),
    ]);
    expect(l.totals).toMatchObject({ debit: 500000, credit: 300000, difference: 200000, balanced: false });
  });

  it('차변 = 대변이면 균형이다', () => {
    const l = new Ledger('2026-04-01', 1, [
      line({ drcr: DEBIT, amount: 500000 }),
      line({ drcr: CREDIT, amount: 500000 }),
    ]);
    expect(l.totals.balanced).toBe(true);
  });

  it('라인이 없으면 균형으로 보지 않는다 — 빈 전표 승인 방지', () => {
    expect(new Ledger('2026-04-01', 1, []).totals.balanced).toBe(false);
  });

  it('금액이 null 인 라인은 0 으로 센다', () => {
    const l = new Ledger('2026-04-01', 1, [line({ amount: null })]);
    expect(l.totals.debit).toBe(0);
  });
});

describe('승인 판정 (§7.4 · §9.3)', () => {
  const balanced = () => [
    line({ drcr: DEBIT, amount: 100 }),
    line({ drcr: CREDIT, amount: 100 }),
  ];

  it('미승인 + 라인 존재 + 균형이면 승인 가능', () => {
    expect(new Ledger('2026-04-01', 1, balanced()).canApprove).toBe(true);
  });

  it('라인이 없으면 거부', () => {
    expect(() => new Ledger('2026-04-01', 1, []).assertApprovable()).toThrow(/라인이 없어/);
  });

  it('불균형이면 차액을 담아 거부한다', () => {
    const l = new Ledger('2026-04-01', 1, [line({ drcr: DEBIT, amount: 100 })]);
    expect(() => l.assertApprovable()).toThrow(/차액/);
  });

  it('이미 승인된 전표는 거부', () => {
    const l = new Ledger('2026-04-01', 1, balanced(), true);
    expect(() => l.assertApprovable()).toThrow(/이미 승인/);
  });

  /*--- ⭐ 설계서가 지목한 회귀 지점 ② ---*/
  it('⭐ 마감 검사가 승인여부 검사보다 먼저다 (§15.1)', () => {
    // 승인됨 + 마감연도 — 둘 다 걸리는 상황에서 마감 메시지가 나와야 한다
    const l = new Ledger('2026-04-01', 1, balanced(), true, true);
    expect(() => l.assertApprovable()).toThrow(/회계마감/);
    expect(() => l.assertApprovable()).not.toThrow(/이미 승인/);
  });

  it('⭐ 수정 판정도 마감이 먼저다', () => {
    const l = new Ledger('2026-04-01', 1, balanced(), true, true);
    expect(() => l.assertEditable()).toThrow(/회계마감/);
  });

  it('마감 아닌 승인 전표는 승인 메시지가 나온다', () => {
    const l = new Ledger('2026-04-01', 1, balanced(), true, false);
    expect(() => l.assertEditable()).toThrow(/승인된 전표/);
  });
});

describe('저장 페이로드 (§9.1)', () => {
  it('⭐ 배열 순서가 곧 line_on 이다 — 순서를 보존한다', () => {
    const l = new Ledger('2026-04-01', null, [
      line({ gl_id: '2010000', drcr: CREDIT, amount: 500000 }),
      line({ gl_id: '1010000', drcr: DEBIT, amount: 500000 }),
    ]);
    const payload = l.toSavePayload();
    expect(payload.map((p) => p.gl_id)).toEqual(['2010000', '1010000']);
  });

  it('화면 전용 필드(key·gl_name)는 서버로 보내지 않는다', () => {
    const l = new Ledger('2026-04-01', null, [line({ gl_name: '현금' })]);
    const [first] = l.toSavePayload();
    expect(first).not.toHaveProperty('key');
    expect(first).not.toHaveProperty('gl_name');
    expect(first).toHaveProperty('gl_id');
  });

  it('저장 전 검증 — 계정 미선택·0원을 잡는다', () => {
    expect(new Ledger('2026-04-01', null, []).validateForSave()).toMatch(/1건 이상/);
    expect(new Ledger('2026-04-01', null, [line({ gl_id: null })]).validateForSave()).toMatch(/계정과목/);
    expect(new Ledger('2026-04-01', null, [line({ amount: 0 })]).validateForSave()).toMatch(/0보다 커야/);
    expect(new Ledger('2026-04-01', null, [line()]).validateForSave()).toBeNull();
  });
});

describe('라인 키 (§9.1)', () => {
  it('⭐ line_on 이 아니라 클라이언트 임시 키로 추적한다', () => {
    // line_on 은 저장마다 재부여되므로 외부에서 참조·기억하면 안 된다
    const a = emptyLine();
    const b = emptyLine();
    expect(a.key).not.toBe(b.key);
  });
});

describe('LedgerError', () => {
  it('도메인 예외는 이름으로 식별할 수 있다 — 화면이 서버 오류와 구분한다', () => {
    try {
      new Ledger('2026-04-01', 1, []).assertApprovable();
    } catch (e) {
      expect(e).toBeInstanceOf(LedgerError);
      expect((e as Error).name).toBe('LedgerError');
    }
  });
});
