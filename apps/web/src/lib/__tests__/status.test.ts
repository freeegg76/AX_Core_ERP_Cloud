/**
 * status 극성 — 설계서 §15.4
 *
 * ⚠ 이 모듈에 한해 커버리지 100% 를 강제한다. v2.0 최대의 잔존 위험이고,
 *   틀려도 예외가 나지 않고 **조용히** 동작하기 때문이다(§10.6).
 *
 * 테이블당 최소 2케이스(활성/비활성)를 강제한다.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WHEN_FALSE,
  ACTIVE_WHEN_TRUE,
  activeFilterValue,
  CONTRACT_STATUS,
  EMPLOYEE_STATUS,
  isActive,
  isEmployeeActive,
  toDbStatus,
  type StatusTable,
} from '@ax-bridge/shared-constants';

describe('status 극성 (§10.6)', () => {
  describe('활성 = false 인 테이블 — SYSTEM 계열 + 은행/카드', () => {
    it.each(ACTIVE_WHEN_FALSE)('%s: false=활성 / true=비활성', (table) => {
      expect(isActive(table, false)).toBe(true);
      expect(isActive(table, true)).toBe(false);
    });

    it.each(ACTIVE_WHEN_FALSE)('%s: toDbStatus 가 반전한다', (table) => {
      expect(toDbStatus(table, true)).toBe(false);
      expect(toDbStatus(table, false)).toBe(true);
    });
  });

  describe('활성 = true 인 테이블 — PARTNER 계열 + GL/관리항목', () => {
    it.each(ACTIVE_WHEN_TRUE)('%s: true=활성 / false=비활성', (table) => {
      expect(isActive(table, true)).toBe(true);
      expect(isActive(table, false)).toBe(false);
    });

    it.each(ACTIVE_WHEN_TRUE)('%s: toDbStatus 가 그대로다', (table) => {
      expect(toDbStatus(table, true)).toBe(true);
      expect(toDbStatus(table, false)).toBe(false);
    });
  });

  it('⚠ 두 집합의 극성이 실제로 반대인지 — 이 테스트가 회귀의 핵심이다', () => {
    // 같은 raw 값 true 가 한쪽에서는 활성, 다른 쪽에서는 비활성이어야 한다.
    expect(isActive('partner_client', true)).toBe(true);
    expect(isActive('system_company', true)).toBe(false);
    expect(isActive('finance_gl', true)).toBe(true);
    expect(isActive('finance_bank_account', true)).toBe(false);
  });

  it('두 집합이 겹치지 않는다', () => {
    const overlap = ACTIVE_WHEN_TRUE.filter((t) => (ACTIVE_WHEN_FALSE as readonly string[]).includes(t));
    expect(overlap).toEqual([]);
  });

  it('null/undefined 는 비활성으로 본다', () => {
    expect(isActive('partner_client', null)).toBe(false);
    expect(isActive('partner_client', undefined)).toBe(false);
    expect(isActive('system_company', null)).toBe(false);
  });

  it('등록되지 않은 테이블은 조용히 틀리지 않고 던진다', () => {
    expect(() => isActive('finance_ledger_head' as StatusTable, true)).toThrow(/극성이 등록되지 않/);
    expect(() => toDbStatus('finance_ledger_head' as StatusTable, true)).toThrow(/극성이 등록되지 않/);
  });

  it('activeFilterValue — PostgREST .eq() 에 넣을 값', () => {
    expect(activeFilterValue('partner_client')).toBe(true);
    expect(activeFilterValue('system_company')).toBe(false);
  });

  it('boolean status 를 가진 테이블은 11종이다', () => {
    expect(ACTIVE_WHEN_FALSE.length + ACTIVE_WHEN_TRUE.length).toBe(11);
  });
});

describe('문자열 status — boolean 과 별개 체계', () => {
  it('직원: inactive 만 비활성이다 (휴직·퇴사예정은 재직 중)', () => {
    expect(isEmployeeActive('active')).toBe(true);
    expect(isEmployeeActive('on_leave')).toBe(true);
    expect(isEmployeeActive('leaving_soon')).toBe(true);
    expect(isEmployeeActive('probation')).toBe(true);
    expect(isEmployeeActive('planned')).toBe(true);
    expect(isEmployeeActive('inactive')).toBe(false);
    expect(isEmployeeActive(null)).toBe(false);
    expect(isEmployeeActive(undefined)).toBe(false);
  });

  it('직원 상태는 CK_emp_status 의 6종과 일치한다', () => {
    expect(Object.keys(EMPLOYEE_STATUS)).toEqual([
      'planned', 'probation', 'active', 'on_leave', 'leaving_soon', 'inactive',
    ]);
  });

  it('계약 상태는 0/1/2 세 종이다', () => {
    expect(Object.keys(CONTRACT_STATUS)).toEqual(['0', '1', '2']);
  });
});
