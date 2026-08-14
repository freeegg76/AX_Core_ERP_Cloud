/**
 * 상태 표시 — 설계서 §12.6
 * DB 코드값을 UI 에 직접 쓰지 않고 라벨로 변환한다.
 *
 * ⚠ status 극성은 테이블마다 반대다. 반드시 table 을 넘겨 isActive() 를 경유한다(§10.6).
 */
import { Tag } from 'antd';
import { isActive, isEmployeeActive, EMPLOYEE_STATUS, type StatusTable, type EmployeeStatus } from '@ax-bridge/shared-constants';

export function StatusBadge({ table, status }: { table: StatusTable; status: boolean | null | undefined }) {
  const active = isActive(table, status);
  return <Tag color={active ? 'green' : 'default'}>{active ? '사용' : '미사용'}</Tag>;
}

export function EmployeeStatusBadge({ status }: { status: string | null | undefined }) {
  const label = (status && EMPLOYEE_STATUS[status as EmployeeStatus]) || '-';
  return <Tag color={isEmployeeActive(status) ? 'blue' : 'default'}>{label}</Tag>;
}

export function ApprovalBadge({ approved }: { approved: boolean }) {
  return <Tag color={approved ? 'green' : 'orange'}>{approved ? '승인' : '미승인'}</Tag>;
}

export function ClosingBadge({ closing }: { closing: boolean }) {
  return <Tag color={closing ? 'red' : 'default'}>{closing ? '마감' : '미마감'}</Tag>;
}
