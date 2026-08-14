/**
 * 로그인 — 설계서 §6.1
 * 이메일 + 비밀번호. 토큰 갱신은 supabase-js 가 자동 처리한다.
 */
import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { toAxError } from '@/lib/errors';

export function LoginPage() {
  const { session, signIn } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const onFinish = async (v: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await signIn(v.email, v.password);
    } catch (e) {
      // 로그인 실패 원인을 세분화하지 않는다 — 계정 존재 여부가 새어 나간다.
      setError(toAxError(e).code === 'AX-40100'
        ? '이메일 또는 비밀번호가 올바르지 않습니다.'
        : '이메일 또는 비밀번호가 올바르지 않습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={4} style={{ textAlign: 'center' }}>AX Bridge</Typography.Title>
        {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} /> : null}
        <Form layout="vertical" onFinish={(v) => void onFinish(v as { email: string; password: string })}>
          <Form.Item name="email" label="이메일" rules={[{ required: true, type: 'email' }]}>
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="비밀번호" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>로그인</Button>
        </Form>
      </Card>
    </div>
  );
}
