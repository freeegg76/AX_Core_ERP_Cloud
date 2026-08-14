/**
 * Supabase 클라이언트 — 단일 인스턴스
 * 설계서 §3 · §18.4
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env.example 을 참고하세요.',
  );
}

/**
 * ⚠ 런타임 어서션 — 설계서 §18.4
 *
 * anon 키의 JWT payload 를 디코드해 role 이 'anon' 인지 확인한다.
 * service_role 키를 실수로 Vercel 환경변수에 넣는 사고를 **배포 직후 1초 만에** 검출한다.
 * service_role 은 BYPASSRLS 이므로, 브라우저에 들어가면 테넌트 격리가 통째로 무너진다.
 */
function assertAnonKey(key: string): void {
  try {
    const payloadPart = key.split('.')[1];
    if (!payloadPart) throw new Error('JWT 형식이 아님');
    const payload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: string;
    };
    if (payload.role !== 'anon') {
      throw new Error(
        `치명적: VITE_SUPABASE_ANON_KEY 의 role 이 '${payload.role}' 입니다. ` +
          `anon 키만 사용해야 합니다 (설계서 §19.2).`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('치명적')) throw e;
    throw new Error('VITE_SUPABASE_ANON_KEY 를 해석할 수 없습니다.');
  }
}

assertAnonKey(anonKey);

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // supabase-js 가 만료 전 자동 갱신한다(설계서 §6.1 ②). 애플리케이션 코드 불필요.
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export type { Database };
