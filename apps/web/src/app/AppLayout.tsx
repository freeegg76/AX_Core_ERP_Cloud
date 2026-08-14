import { Layout, Menu, Space, Tag, Typography, Button } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { ROLE_LABEL } from '@ax-bridge/shared-constants';

/**
 * 메뉴 — 설계서 §16 로드맵 순서를 그대로 따른다.
 * 의존성상 SYSTEM(조직·기수)이 선행되어야 PARTNER/SALES/FINANCE 가 성립한다.
 */
const MENU = [
  {
    key: 'system',
    label: 'SYSTEM',
    children: [
      { key: '/system/companies', label: '그룹' },
      { key: '/system/entities', label: '회사' },
      { key: '/system/pods', label: 'Pod' },
      { key: '/system/teams', label: '부서' },
      { key: '/system/employees', label: '직원' },
      { key: '/system/years', label: '회사 기수' },
    ],
  },
  {
    key: 'partner',
    label: 'PARTNER',
    children: [
      { key: '/partner/terms', label: '지급정책' },
      { key: '/partner/clients', label: '고객사' },
      { key: '/partner/vendors', label: '거래처' },
    ],
  },
  {
    key: 'sales',
    label: 'SALES',
    children: [
      { key: '/sales/pipelines', label: '파이프라인' },
      { key: '/sales/contracts', label: '계약' },
    ],
  },
];

export function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { claims, signOut } = useSession();

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 24, paddingInline: 16 }}>
        <Typography.Text strong style={{ color: '#fff', fontSize: 16 }}>AX Bridge</Typography.Text>
        <Menu
          theme="dark" mode="horizontal" style={{ flex: 1, minWidth: 0 }}
          selectedKeys={[loc.pathname]} items={MENU}
          onClick={(e) => nav(e.key)}
        />
        <Space>
          {/* 1인 1회사 고정(C3) — 회사 전환 UI 가 없다. 클레임을 표시만 한다. */}
          <Tag>{claims?.company_id}/{claims?.entity_id}</Tag>
          <Tag color="blue">{claims ? ROLE_LABEL[claims.ax_role] : '-'}</Tag>
          <Button size="small" onClick={() => void signOut()}>로그아웃</Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 16, overflow: 'auto' }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
