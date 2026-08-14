/**
 * Head/Detail 레이아웃 — 설계서 §12.2
 *
 * 조회조건 입력 → 조회 → Head Grid → 행 선택 → Detail 표시
 * → 신규/수정 → 검증 → 저장 → Head 재조회 + 선택 유지
 */
import { Card } from 'antd';
import type { ReactNode } from 'react';

export function HeadDetailLayout({
  search, head, detail, headTitle = '목록', detailTitle = '상세',
}: {
  search?: ReactNode;
  head: ReactNode;
  detail?: ReactNode;
  headTitle?: string;
  detailTitle?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {search ? <Card size="small">{search}</Card> : null}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        <Card size="small" title={headTitle} style={{ flex: detail ? '0 0 45%' : 1, overflow: 'auto' }}>
          {head}
        </Card>
        {detail ? (
          <Card size="small" title={detailTitle} style={{ flex: 1, overflow: 'auto' }}>
            {detail}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** 계정과목 화면의 2-Frame — 좌 Head 3열 / 우 Detail (§12.5) */
export function TwoFrameLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, height: '100%', minHeight: 0 }}>
      <Card size="small" style={{ flex: '0 0 38%', overflow: 'auto' }}>{left}</Card>
      <Card size="small" style={{ flex: 1, overflow: 'auto' }}>{right}</Card>
    </div>
  );
}
