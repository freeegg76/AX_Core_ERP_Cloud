/**
 * 공통 툴바 — 설계서 §12.2
 *
 * 기본 순서 : 조회 → 신규 → 수정 → 저장 → 삭제 → 취소 (FR-UI-02)
 * 조회 상태에서는 조회/신규만 활성, 저장/취소는 편집모드에서 활성.
 *
 * ⚠ 마감관리(SCR-FIN-06)는 표준 6버튼이 아니라 조회·마감·취소 구성이다.
 *   그래서 버튼 집합을 주입받는 구조여야 한다(§12.2).
 */
import { Button, Space } from 'antd';
import type { ReactNode } from 'react';

export type EditMode = 'view' | 'create' | 'edit';

export interface ToolbarProps {
  mode: EditMode;
  canEdit?: boolean;
  onSearch?: () => void;
  onCreate?: () => void;
  onEdit?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  /** 메뉴 고유 기능. 기본 버튼 **뒤에** 배치된다(§12.2) */
  extra?: ReactNode;
}

export function AppToolbar({
  mode, canEdit = true, onSearch, onCreate, onEdit, onSave, onDelete, onCancel, saving, extra,
}: ToolbarProps) {
  const editing = mode !== 'view';
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Button onClick={onSearch} disabled={editing}>조회</Button>
      <Button onClick={onCreate} disabled={editing || !canEdit}>신규</Button>
      <Button onClick={onEdit} disabled={editing || !canEdit}>수정</Button>
      <Button type="primary" onClick={onSave} disabled={!editing || !canEdit} loading={saving}>저장</Button>
      <Button danger onClick={onDelete} disabled={editing || !canEdit}>삭제</Button>
      <Button onClick={onCancel} disabled={!editing}>취소</Button>
      {extra ? <span style={{ borderLeft: '1px solid #eee', paddingLeft: 12 }}>{extra}</span> : null}
    </Space>
  );
}
