/**
 * 조회조건바 — 설계서 §12.2
 * 순서 : 그룹 → 회사 → 메뉴별 주요조건 → 상태. 초기화 제공(FR-UI-03).
 *
 * ⚠ 그룹/회사는 조건이 아니다 — 1인 1회사 고정(C3)이라 JWT 클레임에서 온다.
 *   v1.1 의 "상위조건 변경 시 하위조건 초기화" 로직이 통째로 불필요해진다.
 */
import { Button, Space } from 'antd';
import type { ReactNode } from 'react';

export function SearchBar({
  children, onSearch, onReset, loading,
}: {
  children: ReactNode;
  onSearch: () => void;
  onReset?: () => void;
  loading?: boolean;
}) {
  return (
    <Space wrap>
      {children}
      <Button type="primary" onClick={onSearch} loading={loading}>조회</Button>
      {onReset ? <Button onClick={onReset}>초기화</Button> : null}
    </Space>
  );
}
