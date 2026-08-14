/*==============================================================================
  AX Bridge v2.0 — 14. 부트스트랩 (SYSTEM 조직)
  설계서 §6.5

  순환 의존 — system_employee 는 그룹/회사/Team 이 NOT NULL 이므로 조직 마스터와
  인증 사이에 순환이 생긴다. 게다가 v2.0 은 auth.users 행도 있어야 한다.

  순서
    ① 이 마이그레이션      : SYSTEM 조직 4행 (company · entity · pod · team)
    ② bootstrap.yml Actions : Admin API 로 auth.users 생성 → system_employee 삽입

  ⚠ 왜 auth.users 를 SQL 로 직접 INSERT 하지 않는가 —
     GoTrue 의 비밀번호 해시 형식·identities 연결·이메일 확인 상태는 내부 구현이며
     버전에 따라 바뀐다. SQL 로 넣은 계정은 조용히 로그인 불가가 되거나 업그레이드에서
     깨진다. 반드시 Admin API 를 경유한다.

  ⚠ 전부 WHERE NOT EXISTS 가드다. 마이그레이션 추적 테이블이 재실행을 막지만,
     로컬 `supabase db reset` 반복과 seed.sql 병용을 위해 멱등하게 둔다(§16.1).
==============================================================================*/

insert into public.system_company (company_id, company_name, company_name_ko, status)
select 'SYSTEM', 'System', '시스템', false
where not exists (select 1 from public.system_company where company_id = 'SYSTEM');

insert into public.system_entity (company_id, entity_id, entity_name, entity_name_ko, status)
select 'SYSTEM', 'SYSTEM', 'System', '시스템', false
where not exists (select 1 from public.system_entity
                   where company_id = 'SYSTEM' and entity_id = 'SYSTEM');

insert into public.system_pod (company_id, entity_id, pod_id, pod_name, status)
select 'SYSTEM', 'SYSTEM', 'SYS', 'System Pod', false
where not exists (select 1 from public.system_pod
                   where company_id = 'SYSTEM' and entity_id = 'SYSTEM' and pod_id = 'SYS');

-- ⚠ 직원 행보다 먼저 삽입한다. owner/leader 에 FK 가 없어서 가능하고,
--   trg_system_team_refs 는 SYSTEM/SYSTEM 을 예외로 둔다(마이그레이션 10).
insert into public.system_team
    (company_id, entity_id, team_id, team_name, team_name_ko, owner, leader_user_id, status)
select 'SYSTEM', 'SYSTEM', 'SYS', 'System', '시스템', 'ADMIN', 'ADMIN', false
where not exists (select 1 from public.system_team
                   where company_id = 'SYSTEM' and entity_id = 'SYSTEM' and team_id = 'SYS');

/*============================================================================
  ② 단계용 헬퍼 — bootstrap.yml 이 호출한다.

  Admin API 가 만든 auth.users 의 uuid 를 받아 system_employee 를 연결한다.
  SECURITY DEFINER + service_role 전용이며, authenticated 에는 권한을 주지 않는다.
============================================================================*/
create or replace function public.ax_bootstrap_admin(
    p_auth_user_id uuid,
    p_email        text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare v_existing varchar(10);
begin
  select employee_id into v_existing
    from public.system_employee
   where company_id = 'SYSTEM' and entity_id = 'SYSTEM' and employee_id = 'ADMIN';

  if v_existing is not null then
    -- 이미 있으면 계정 연결만 갱신한다(재실행 안전)
    update public.system_employee
       set auth_user_id = p_auth_user_id,
           email        = p_email::extensions.citext,
           user_yn      = true,
           status       = 'active',
           ax_role      = 'SUPER'
     where company_id = 'SYSTEM' and entity_id = 'SYSTEM' and employee_id = 'ADMIN';
    return jsonb_build_object('created', false, 'linked', true);
  end if;

  insert into public.system_employee
      (company_id, entity_id, team_id, employee_id, employee_name,
       email, status, user_yn, user_id, ax_role, auth_user_id)
  values ('SYSTEM', 'SYSTEM', 'SYS', 'ADMIN', 'Built-in Admin',
          p_email::extensions.citext, 'active', true, 'admin', 'SUPER', p_auth_user_id);

  return jsonb_build_object('created', true, 'linked', true);
end $$;

revoke all    on function public.ax_bootstrap_admin(uuid, text) from public, anon, authenticated;
grant  execute on function public.ax_bootstrap_admin(uuid, text) to service_role;

comment on function public.ax_bootstrap_admin(uuid, text) is
  '부트스트랩 전용. service_role 만 실행 가능하며 bootstrap.yml 이 호출한다 (§6.5)';
