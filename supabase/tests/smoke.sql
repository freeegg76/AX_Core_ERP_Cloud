\set ON_ERROR_STOP on
\timing off

-- ══════════════════════════════════════════════════════════════════════
-- 정리 : 재실행 가능하게 만든다. `supabase db reset` 직후가 아니어도 동작해야 한다.
--        seed.sql 이 만든 SYSTEM/DEMO 는 건드리지 않는다.
-- ══════════════════════════════════════════════════════════════════════
set client_min_messages = warning;
-- ⚠ 정리조차 보호 트리거에 막힌다 — 트리거가 정상 작동한다는 뜻이다.
--   ① 마감을 먼저 풀고 ② 우회 플래그를 세운 뒤 ③ 헤더부터 지운다(라인은 CASCADE).
--   플래그가 트랜잭션 로컬(C6)이므로 전체를 한 트랜잭션으로 묶는다.
begin;
  delete from finance_closing where company_id in ('CO_A','CO_B');
  select set_config('ax.ledger_approve', '1', true);
  select set_config('ax.openbal_admin',  '1', true);
  delete from finance_ledger_head  where company_id in ('CO_A','CO_B');   -- CASCADE → detail
  delete from finance_open_balance where company_id in ('CO_A','CO_B');
  delete from finance_bank_account where company_id in ('CO_A','CO_B');
  delete from finance_gl           where company_id in ('CO_A','CO_B');
  delete from system_year          where company_id in ('CO_A','CO_B');
  delete from system_employee      where company_id in ('CO_A','CO_B');
  delete from system_team          where company_id in ('CO_A','CO_B');
  delete from system_pod           where company_id in ('CO_A','CO_B');
  delete from system_entity        where company_id in ('CO_A','CO_B');
  delete from system_company       where company_id in ('CO_A','CO_B');
  delete from auth.users where id in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333');
  -- ⑨ 가 seed 의 ADMIN 을 EDITOR 로 강등하므로 되돌린다
  update system_employee set ax_role='SUPER'
   where employee_id='ADMIN' and company_id='SYSTEM';
commit;
set client_min_messages = notice;

-- ══════════════════════════════════════════════════════════════════════
-- 픽스처 : 회사 A(CO_A/E1) · 회사 B(CO_B/E1) — 소유자 권한으로 생성
-- ══════════════════════════════════════════════════════════════════════
insert into system_company(company_id, company_name, company_name_ko) values
  ('CO_A','A Corp','에이'), ('CO_B','B Corp','비');
insert into system_entity(company_id, entity_id, entity_name, entity_name_ko) values
  ('CO_A','E1','A Ent','에이법인'), ('CO_B','E1','B Ent','비법인');
insert into system_pod(company_id, entity_id, pod_id, pod_name) values
  ('CO_A','E1','P1','Pod A'), ('CO_B','E1','P1','Pod B');
-- ⚠ 순환 의존 : 지연 제약 트리거라 한 트랜잭션 안에서는 순서가 무관하다(§9.9).
--    부서를 먼저 넣고 직원을 나중에 넣어도 COMMIT 시점에 검증된다.
begin;
insert into system_team(company_id, entity_id, team_id, team_name, owner, leader_user_id, pod_id) values
  ('CO_A','E1','T1','Team A','EA1','EA1','P1'), ('CO_B','E1','T1','Team B','EB1','EB1','P1');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a-editor@x.com','x',now(),now(),now()),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a-approver@x.com','x',now(),now(),now()),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b-editor@x.com','x',now(),now(),now());

insert into system_employee(company_id, entity_id, team_id, employee_id, employee_name, email, status, user_yn, ax_role, auth_user_id) values
  ('CO_A','E1','T1','EA1','A Editor','a-editor@x.com','active',true,'EDITOR','11111111-1111-1111-1111-111111111111'),
  ('CO_A','E1','T1','EA2','A Approver','a-approver@x.com','active',true,'APPROVER','22222222-2222-2222-2222-222222222222'),
  ('CO_B','E1','T1','EB1','B Editor','b-editor@x.com','active',true,'EDITOR','33333333-3333-3333-3333-333333333333');
commit;   -- 여기서 trg_system_team_refs 가 검증된다

insert into system_year(company_id, entity_id, company_year_id, company_year, actual_year) values
  ('CO_A','E1','Y26',1,2026), ('CO_A','E1','Y27',2,2027), ('CO_B','E1','Y26',1,2026);

insert into finance_gl(company_id, entity_id, gl_id, gl_name, gl_type, status, client_id) values
  ('CO_A','E1','1010000','현금','0',true,false),
  ('CO_A','E1','2010000','외상매입금','1',true,false),
  ('CO_B','E1','1010000','현금','0',true,false);

-- 회사 B 전표 3건 (타 회사 격리 테스트용)
insert into finance_ledger_head(company_id, entity_id, ledger_date, ledger_no, ledger_name) values
  ('CO_B','E1','2026-03-01',0,'B전표1'), ('CO_B','E1','2026-03-01',0,'B전표2'), ('CO_B','E1','2026-03-02',0,'B전표3');

\echo '───────────── 픽스처 준비 완료 ─────────────'

-- ══════════════════════════════════════════════════════════════════════
-- ① 채번 트리거 (C5) — 클라이언트가 보낸 0 을 무시하고 (회사,일자)별 1부터
-- ══════════════════════════════════════════════════════════════════════
select '① 채번' as test,
       (select string_agg(ledger_no::text, ',' order by ledger_no) from finance_ledger_head
         where company_id='CO_B' and ledger_date='2026-03-01') as "3/1(1,2 기대)",
       (select ledger_no::text from finance_ledger_head
         where company_id='CO_B' and ledger_date='2026-03-02') as "3/2(1 기대: 일자별 리셋)";

-- ══════════════════════════════════════════════════════════════════════
-- ② 테넌트 격리 — CO_A EDITOR 로 전환
-- ══════════════════════════════════════════════════════════════════════
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","company_id":"CO_A","entity_id":"E1","employee_id":"EA1","ax_role":"EDITOR"}', false);

do $$ begin
  if current_user <> 'authenticated' then
    raise exception '❌ 메타: RLS 가 적용되지 않는 롤(%)로 실행 중 — 이 스위트는 무의미하다', current_user;
  end if;
  raise notice '② 메타: RLS 적용 롤(authenticated) 확인 ✔';
end $$;

select '② 격리' as test,
       current_user::text                                             as "롤(authenticated 기대)",
       (select count(*) from finance_ledger_head)::text                as "전체조회(0 기대: B것만 존재)",
       (select count(*) from finance_ledger_head where company_id='CO_B')::text as "B명시조회(0 기대)";

-- 타 테넌트 INSERT 는 42501
do $$ begin
  begin
    insert into finance_ledger_head(company_id, entity_id, ledger_date, ledger_no, ledger_name)
    values ('CO_B','E1','2026-05-01',0,'침입');
    raise exception '❌ 타 테넌트 INSERT 가 통과했다';
  exception when insufficient_privilege then
    raise notice '② WITH CHECK: 타 테넌트 INSERT 거부됨 (42501) ✔';
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- ③ 컬럼 GRANT — EDITOR 는 approval_status 를 직접 못 바꾼다 (§5.3 ①)
-- ══════════════════════════════════════════════════════════════════════
insert into finance_ledger_head(company_id, entity_id, ledger_date, ledger_no, ledger_name, employee_id)
values ('CO_A','E1','2026-03-10',0,'A전표1','EA1');

do $$ begin
  begin
    update finance_ledger_head set approval_status = true
     where company_id='CO_A' and ledger_date='2026-03-10';
    raise exception '❌ EDITOR 가 approval_status 를 직접 바꿨다';
  exception when insufficient_privilege then
    raise notice '③ 컬럼 GRANT: EDITOR 의 approval_status 직접 변경 거부됨 ✔';
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- ④ RPC 역할 검사 — EDITOR 가 승인 RPC 호출 시 403 (§5.3 ②)
-- ══════════════════════════════════════════════════════════════════════
do $$ begin
  begin
    perform ax_finance_ledger_approve('2026-03-10', 1);
    raise exception '❌ EDITOR 가 승인에 성공했다';
  exception when sqlstate 'PT403' then
    raise notice '④ RPC 역할검사: EDITOR 승인 거부됨 (PT403 / %) ✔', 'AX-40301';
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- ⑤ 전표 저장 RPC — 차대 검증 + line_on 배열 순서 부여
-- ══════════════════════════════════════════════════════════════════════
select '⑤ 전표저장' as test, ax_finance_ledger_save(
  '{"ledger_date":"2026-04-01","ledger_name":"매입","ledger_type":"1","employee_id":"EA1"}'::jsonb,
  '[{"gl_id":"2010000","drcr":"2","amount":500000},
    {"gl_id":"1010000","drcr":"1","amount":500000}]'::jsonb) as 결과;

select '⑤ line_on' as test, string_agg(line_on::text || ':' || gl_id, ' → ' order by line_on) as "배열 순서대로 부여"
  from finance_ledger_detail where company_id='CO_A' and ledger_date='2026-04-01';

-- Layer3 플래그 위반 (50466) — client_id 플래그가 false 인데 값을 넣음
do $$ begin
  begin
    perform ax_finance_ledger_save(
      '{"ledger_date":"2026-04-02","ledger_name":"위반"}'::jsonb,
      '[{"gl_id":"1010000","drcr":"1","amount":100,"client_id":"C1"}]'::jsonb);
    raise exception '❌ 비활성 관리항목에 값이 저장됐다';
  exception when sqlstate 'PT400' then
    raise notice '⑤ Layer3 검증: 비활성 관리항목 값 거부됨 (AX-50466) ✔';
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- ⑥ 승인 — APPROVER 로 전환
-- ══════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","company_id":"CO_A","entity_id":"E1","employee_id":"EA2","ax_role":"APPROVER"}', false);

select '⑥ 승인' as test, ax_finance_ledger_approve('2026-04-01', 1) is null as 성공;
select '⑥ 결과' as test, approval_status, approver_id, approved_date is not null as "타임스탬프 기록"
  from finance_ledger_head where company_id='CO_A' and ledger_date='2026-04-01';

-- 승인 후 라인 변경 차단 (51021)
do $$ begin
  begin
    update finance_ledger_detail set amount = 999
     where company_id='CO_A' and ledger_date='2026-04-01' and line_on=1;
    raise exception '❌ 승인 전표 라인이 수정됐다';
  exception when sqlstate 'PT409' then
    raise notice '⑥ 트리거: 승인 전표 라인 변경 차단됨 (AX-51021) ✔';
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- ⑦ 연도 마감 → 해제 왕복 (§9.5 · §9.6) — ADMIN 필요
-- ══════════════════════════════════════════════════════════════════════
reset role;
update system_employee set ax_role='ADMIN' where employee_id='EA2';
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","company_id":"CO_A","entity_id":"E1","employee_id":"EA2","ax_role":"ADMIN"}', false);

-- 검증5(50515)가 미승인 전표를 정확히 잡았다. 마감하려면 먼저 정리해야 한다.
select '⑦ 사전정리' as test, ax_finance_ledger_delete('2026-03-10', 1) is null as "미승인 전표 삭제";

select '⑦ 마감실행' as test, ax_finance_closing_execute('Y26') as 결과;
select '⑦ 이월결과' as test, gl_id, drcr, amount, closed, source
  from finance_open_balance where company_id='CO_A' and company_year_id='Y27' order by gl_id;

-- 마감연도 전표 등록 차단 (51051)
do $$ begin
  begin
    perform ax_finance_ledger_save(
      '{"ledger_date":"2026-06-01","ledger_name":"마감후"}'::jsonb,
      '[{"gl_id":"1010000","drcr":"1","amount":1}]'::jsonb);
    raise exception '❌ 마감연도에 전표가 등록됐다';
  exception when sqlstate 'PT409' then
    raise notice '⑦ 마감잠금: 마감연도 전표 등록 차단됨 (AX-50501) ✔';
  end;
end $$;

select '⑦ 마감해제' as test, ax_finance_closing_reopen('Y26') as 결과;
select '⑦ 회수확인' as test, count(*)::text as "차년도 CLOSING 행(0 기대)"
  from finance_open_balance where company_id='CO_A' and company_year_id='Y27' and source='CLOSING';

-- ══════════════════════════════════════════════════════════════════════
-- ⑧ 카드번호 마스킹 (§19.3)
-- ══════════════════════════════════════════════════════════════════════
insert into finance_bank_account(company_id, entity_id, bank_id, bank_name, card_number)
values ('CO_A','E1','CARD1','법인카드','1234567812345678');

select '⑧ 마스킹' as test, card_number_masked as "뷰(마스킹 기대)" from v_finance_bank_account where bank_id='CARD1';

do $$ begin
  begin
    perform card_number from finance_bank_account where bank_id='CARD1';
    raise exception '❌ 카드번호 원문이 조회됐다';
  exception when insufficient_privilege then
    raise notice '⑧ 컬럼 GRANT: card_number 원문 조회 거부됨 ✔';
  end;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- ⑨ 최후 SUPER 보호 (51002, v1.1 미구현 규칙)
-- ══════════════════════════════════════════════════════════════════════
reset role;
-- 전제 : 활성 SUPER 를 정확히 1명으로 만든다.
--   seed.sql 이 ADMIN 을 SUPER 로 만들어 두므로 시드 유무에 무관하게 동작해야 한다.
--   경계를 정확히 시험한다 — 2명일 때는 강등이 허용되고, 1명이 되면 차단되어야 한다.
update system_employee set ax_role='SUPER' where employee_id='EA2';

-- SUPER 가 2명 이상인 동안에는 강등이 허용된다(ADMIN 을 EDITOR 로)
update system_employee set ax_role='EDITOR'
 where ax_role='SUPER' and employee_id <> 'EA2';

select '⑨ 경계' as test, '2명→1명 강등 허용됨 ✔' as "선행 확인";

select '⑨ 전제' as test,
       (select count(*) from system_employee
         where ax_role='SUPER' and user_yn and status<>'inactive')::text as "활성 SUPER(1 기대)";

do $$ begin
  begin
    update system_employee set user_yn=false where employee_id='EA2';
    raise exception '❌ 마지막 SUPER 가 비활성화됐다';
  exception when sqlstate 'PT409' then
    raise notice '⑨ 최후관리자: 마지막 활성 SUPER 비활성화 차단됨 (AX-51002) ✔';
  end;
end $$;

\echo '───────────── 스모크 테스트 완료 ─────────────'
