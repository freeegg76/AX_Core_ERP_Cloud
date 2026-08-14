/**
 * 오류 어댑터 — 설계서 §15.4 · 부록 B.3
 *
 * 오류가 브라우저에 도달하는 경로는 세 가지이며 서로 다른 모양이다.
 * 화면이 보는 형태는 하나여야 한다.
 */
import { describe, expect, it } from 'vitest';
import { toAxError } from '../errors';

describe('오류 어댑터 (부록 B.3)', () => {
  it('① RPC ax_raise — hint 에서 AX 코드를 뽑고 한글 메시지를 그대로 쓴다', () => {
    const e = toAxError({
      code: 'PT400',
      message: '계정과목에서 비활성화된 관리항목에 값을 저장할 수 없습니다.',
      hint: 'AX-50466',
    });
    expect(e.code).toBe('AX-50466');
    expect(e.message).toBe('계정과목에서 비활성화된 관리항목에 값을 저장할 수 없습니다.');
  });

  it('① 403 계열도 hint 로 식별된다', () => {
    const e = toAxError({ code: 'PT403', message: '전표 승인 권한이 없습니다.', hint: 'AX-40301' });
    expect(e.code).toBe('AX-40301');
    expect(e.message).toContain('승인 권한');
  });

  it('② 유니크 위반 — 제약 이름을 한글 메시지로 바꾼다', () => {
    const e = toAxError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "ux_bank_card"',
      details: 'Key (company_id, entity_id, card_number)=(...) already exists.',
    });
    expect(e.code).toBe('AX-50483');
    expect(e.message).toBe('이미 등록된 카드번호입니다.');
    // 영문 원문은 detail 에만 남고 message 에는 없다
    expect(e.message).not.toMatch(/duplicate key/);
  });

  it('② CHECK 위반 — 계좌/카드 XOR', () => {
    const e = toAxError({
      code: '23514',
      message: 'new row for relation "finance_bank_account" violates check constraint "ck_bank_one"',
    });
    expect(e.code).toBe('AX-50484');
    expect(e.message).toContain('정확히 하나만');
  });

  it('② FK 위반 — 사전에 없으면 "참조 중이라 삭제 불가" 로 떨어진다 (§9.9)', () => {
    const e = toAxError({
      code: '23503',
      message: 'update or delete on table "partner_client" violates foreign key constraint "fk_unknown_xyz" on table "sales_contract"',
    });
    expect(e.code).toBe('AX-50000');
    expect(e.message).toContain('참조 중');
  });

  it('③ RLS 거부 — 정책 구조가 새어 나가지 않는다', () => {
    const e = toAxError({
      code: '42501',
      message: 'new row violates row-level security policy for table "finance_ledger_head"',
    });
    expect(e.code).toBe('AX-40300');
    expect(e.message).toBe('권한이 없습니다.');
    // ⚠ 원문에 테이블명·정책명이 들어 있으므로 message 로 노출하면 안 된다
    expect(e.message).not.toMatch(/row-level security|finance_ledger_head/);
  });

  it('인증 만료는 재로그인을 안내한다', () => {
    expect(toAxError({ status: 401, message: 'JWT expired' }).code).toBe('AX-40100');
    expect(toAxError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe('AX-40100');
  });

  it('미상 오류는 일반 메시지로 떨어지되 원문을 detail 에 남긴다', () => {
    const e = toAxError({ code: 'XX999', message: 'something odd' });
    expect(e.code).toBe('AX-UNKNOWN');
    expect(e.message).not.toContain('something odd');
    expect(e.detail).toBe('something odd');
  });

  it('오류가 아닌 값도 안전하게 처리한다', () => {
    expect(toAxError(null).code).toBe('AX-UNKNOWN');
    expect(toAxError(undefined).code).toBe('AX-UNKNOWN');
    expect(toAxError('문자열').code).toBe('AX-UNKNOWN');
  });
});
