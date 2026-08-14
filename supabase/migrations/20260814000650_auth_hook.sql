/*==============================================================================
  AX Bridge v2.0 — 06b. 테이블 의존 인증 헬퍼 + Access Token Hook
  설계서 §6.2 · §6.3

  ⚠ 왜 20260814000200 이 아니라 여기인가 —
     이 파일의 함수들은 public.system_employee 를 참조한다. `language sql` 함수는
     생성 시점에 본문이 검증되므로 테이블보다 먼저 만들 수 없다.
     설계서 §4.2 의 레이아웃에 이 파일을 추가로 명시한다.
==============================================================================*/

/*------------------------------------------------- 실시간 역할 재조회 (§6.2) */
-- 클레임 staleness 대응 3번 —
--   되돌릴 수 없는 행위(승인·마감·GL 재생성)를 수행하는 RPC 는 클레임을 믿지 않고
--   DB 를 직접 재조회한다. 액세스 토큰 수명이 15분이라 그 사이 강등이 반영되지 않기 때문이다.
--   조회 비용보다 오발 비용이 크다.
create or replace function public.auth_role_rank_live()
returns int
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select case e.ax_role
              when 'SUPER'    then 50
              when 'ADMIN'    then 40
              when 'APPROVER' then 30
              when 'EDITOR'   then 20
              when 'VIEWER'   then 10
              else 0
            end
       from public.system_employee e
      where e.auth_user_id = auth.uid()
        and e.user_yn
        and e.status <> 'inactive'),
    0)
$$;

comment on function public.auth_role_rank_live() is
  '클레임이 아니라 DB 를 재조회한 현재 역할. 승인·마감 등 되돌릴 수 없는 행위에서만 쓴다. 설계서 §6.2';

-- 최소 역할 확인 + 미달 시 403. RPC 첫 문장에서 호출한다.
create or replace function public.ax_require_role(p_min_rank int, p_action text)
returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if public.auth_role_rank_live() < p_min_rank then
    perform public.ax_raise(40301, p_action || ' 권한이 없습니다.', 403);
  end if;
end $$;

-- 스코프가 클레임에 없으면 어떤 RPC 도 진행하면 안 된다.
-- (훅이 클레임을 넣지 않은 상태 = 프로필 없음 또는 비활성)
create or replace function public.ax_require_scope()
returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if public.auth_company_id() is null or public.auth_entity_id() is null then
    perform public.ax_raise(40101, '인증 정보가 유효하지 않습니다. 다시 로그인해 주세요.', 401);
  end if;
end $$;

/*============================================================================
  Custom Access Token Hook — 설계서 §6.2

  GoTrue 가 액세스 토큰을 만들 때마다 호출한다. RLS 정책 전체가 여기서 넣는
  클레임에 의존하므로, 이 훅이 등록되지 않으면 시스템 전체가 거부 상태가 된다.
  등록은 supabase/config.toml 의 [auth.hook.custom_access_token] 이 담당한다.
============================================================================*/
create or replace function public.ax_access_token_hook(event jsonb)
returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_claims jsonb;
  v_emp    record;
begin
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  select e.company_id, e.entity_id, e.employee_id, e.user_id, e.ax_role
    into v_emp
    from public.system_employee e
   where e.auth_user_id = (event ->> 'user_id')::uuid
     and e.user_yn
     and e.status <> 'inactive';

  -- 프로필이 없거나 비활성 → 권한 클레임을 넣지 않는다.
  -- auth_role_rank() 가 0 을 반환하므로 모든 정책이 거부된다 (기본값 = 거부).
  if not found then
    return jsonb_set(event, '{claims}', v_claims);
  end if;

  v_claims := v_claims || jsonb_build_object(
    'company_id',  v_emp.company_id,
    'entity_id',   v_emp.entity_id,
    'employee_id', v_emp.employee_id,
    'user_id',     v_emp.user_id,
    'ax_role',     v_emp.ax_role);

  return jsonb_set(event, '{claims}', v_claims);
end $$;

/*---------------------------------------------------------------- 훅 권한 */
-- 훅은 GoTrue(supabase_auth_admin)만 실행할 수 있어야 한다.
grant  usage   on schema public                        to supabase_auth_admin;
grant  execute on function public.ax_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.ax_access_token_hook(jsonb) from authenticated, anon, public;

-- SECURITY DEFINER 함수라도 소유자가 테이블을 읽을 수 있어야 한다.
-- (마이그레이션 소유자 = postgres 이므로 이미 가능하지만, 훅 호출 롤에도 명시한다)
grant select on table public.system_employee to supabase_auth_admin;

-- 훅이 RLS 에 막히지 않도록 전용 정책을 둔다.
-- (SECURITY DEFINER 는 RLS 를 우회하지 않는다 — 소유자가 BYPASSRLS 여야 우회된다)
alter table public.system_employee enable row level security;
create policy p_employee_auth_hook on public.system_employee
    for select to supabase_auth_admin
    using (true);
