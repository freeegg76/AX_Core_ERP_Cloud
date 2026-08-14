/**
 * 세션 · 클레임 — 설계서 §6.1 · §6.2
 *
 * 액세스 토큰의 클레임이 곧 권한이다. RLS 정책 전체가 이 값에 의존하므로,
 * 화면은 같은 값을 읽어 버튼 활성/비활성을 결정한다.
 *
 * ⚠ 화면의 판단은 **안내**일 뿐이다. 강제는 DB 가 한다(§2.3). 버튼을 숨겨도
 *   RLS·GRANT·트리거가 독립적으로 막는다.
 */
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { hasRole, type AxRole } from '@ax-bridge/shared-constants';

/** Access Token Hook 이 주입하는 클레임(§6.2) */
export interface AxClaims {
  company_id: string;
  entity_id: string;
  employee_id: string;
  /** 표시용 사번 */
  user_id: string | null;
  ax_role: AxRole;
}

function decodeClaims(session: Session | null): AxClaims | null {
  if (!session?.access_token) return null;
  try {
    const part = session.access_token.split('.')[1];
    if (!part) return null;
    const p = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Partial<AxClaims>;
    // 훅이 클레임을 넣지 않았다면(프로필 없음·비활성) 권한 없음으로 다룬다.
    // 기본값이 "거부" 여야 한다 — §5.1 과 같은 원칙.
    if (!p.company_id || !p.entity_id || !p.ax_role) return null;
    return {
      company_id: p.company_id,
      entity_id: p.entity_id,
      employee_id: p.employee_id ?? '',
      user_id: p.user_id ?? null,
      ax_role: p.ax_role,
    };
  } catch {
    return null;
  }
}

interface SessionState {
  session: Session | null;
  claims: AxClaims | null;
  /** 초기 세션 복원이 끝났는가. false 동안은 라우팅을 보류한다. */
  ready: boolean;
  setSession: (s: Session | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  session: null,
  claims: null,
  ready: false,

  setSession: (s) => set({ session: s, claims: decodeClaims(s), ready: true }),

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    set({ session: data.session, claims: decodeClaims(data.session), ready: true });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, claims: null, ready: true });
  },
}));

/** 앱 부팅 시 1회. 세션 복원 + 갱신 구독. */
export function initSession(): () => void {
  void supabase.auth.getSession().then(({ data }) => {
    useSession.getState().setSession(data.session);
  });
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    useSession.getState().setSession(session);
  });
  return () => sub.subscription.unsubscribe();
}

/*----------------------------------------------------------------- 권한 헬퍼 */

/** 화면 버튼 활성 판단용. 강제는 DB 가 한다. */
export function useCan(required: AxRole): boolean {
  const claims = useSession((s) => s.claims);
  return hasRole(claims?.ax_role, required);
}

export function useClaims(): AxClaims | null {
  return useSession((s) => s.claims);
}
