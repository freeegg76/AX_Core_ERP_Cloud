import { Layout, Menu, Space, Tag, Typography, Button } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { ROLE_LABEL } from '@ax-bridge/shared-constants';

/** 설계서 §4.3 features 구조에 맞춘 메뉴. Phase 2~6 에서 항목이 채워진다. */
const MENU = [
  { key: '/partner/clients', label: '고객사' },
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
