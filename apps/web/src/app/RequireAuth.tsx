import { Navigate } from 'react-router-dom';
import { Result, Spin } from 'antd';
import { useSession } from '@/lib/session';

/**
 * 세션 가드 — 설계서 §6.1
 *
 * ⚠ 세션은 있는데 클레임이 없는 경우를 별도로 다룬다.
 *   Access Token Hook 이 클레임을 넣지 않았다는 뜻이고(프로필 없음·비활성),
 *   그 상태로는 RLS 가 전부 거부하므로 빈 화면만 보게 된다(§6.2).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, claims, ready } = useSession();

  if (!ready) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
  }
  if (!session) return <Navigate to="/login" replace />;

  if (!claims) {
    return (
      <Result
        status="warning"
        title="사용 권한이 설정되지 않았습니다"
        subTitle="직원 프로필이 없거나 비활성 상태입니다. 관리자에게 문의하세요."
      />
    );
  }
  return <>{children}</>;
}
