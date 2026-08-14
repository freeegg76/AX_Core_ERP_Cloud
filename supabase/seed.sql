/*==============================================================================
  AX Bridge v2.0 — 로컬 개발 시드
  설계서 §16.1 — 이 파일은 **로컬 전용**이다. `supabase db reset` 이 자동 적용하며
  운영에는 절대 적용되지 않는다(`supabase db push` 는 migrations 만 실행한다).

  목적 — 로컬에서 즉시 로그인해 화면을 띄울 수 있는 상태를 만든다.
  운영의 admin 부트스트랩은 .github/workflows/bootstrap.yml 이 Admin API 로 수행한다(§6.5).

  로그인 : admin@axbridge.local / axbridge-dev
==============================================================================*/

-- ⚠⚠ auth.users 를 SQL 로 직접 INSERT 하지 않는다 — 로컬에서도 마찬가지다.
--
--   설계서 §6.5 가 경고한 그대로다. GoTrue 는 confirmation_token 등 토큰 컬럼을
--   NOT NULL string 으로 스캔하므로, NULL 로 남은 행은 로그인 시
--   "converting NULL to string is unsupported" 500 을 낸다. 컬럼을 하나씩 ''
--   로 채우는 우회는 GoTrue 버전이 바뀔 때마다 다시 깨진다.
--
--   로컬 개발 계정은 Admin API 로 만든다:
--       pnpm db:seed:auth      (scripts/dev-seed-auth.mjs)
--   `pnpm db:start` / `pnpm db:reset` 이 이어서 자동 실행한다.
--
--   이 파일은 **업무 데이터만** 담는다.

/*------------------------------------------------------------------------------
  샘플 회사 — 화면 개발용. 표준 GL 355행을 실제로 적재한 상태를 만든다.
------------------------------------------------------------------------------*/
insert into public.system_company (company_id, company_name, company_name_ko) values
    ('DEMO', 'Demo Group', '데모그룹')
on conflict do nothing;

insert into public.system_entity (company_id, entity_id, entity_name, entity_name_ko) values
    ('DEMO', 'D1', 'Demo Corp', '데모법인')
on conflict do nothing;

insert into public.system_pod (company_id, entity_id, pod_id, pod_name) values
    ('DEMO', 'D1', 'P1', '개발 Pod')
on conflict do nothing;

-- 순환 의존 : 지연 제약 트리거라 한 트랜잭션 안에서는 순서가 무관하다(§9.9)
begin;
insert into public.system_team (company_id, entity_id, team_id, team_name, team_name_ko,
                                owner, leader_user_id, pod_id) values
    ('DEMO', 'D1', 'T1', 'Dev Team', '개발팀', 'D0001', 'D0001', 'P1')
on conflict do nothing;

insert into public.system_employee (company_id, entity_id, team_id, employee_id,
        employee_name, email, status, user_yn, user_id, ax_role) values
    ('DEMO','D1','T1','D0001','데모 관리자','demo-admin@axbridge.local','active',false,'demo-admin','ADMIN'),
    ('DEMO','D1','T1','D0002','데모 승인자','demo-approver@axbridge.local','active',false,'demo-approver','APPROVER'),
    ('DEMO','D1','T1','D0003','데모 편집자','demo-editor@axbridge.local','active',false,'demo-editor','EDITOR')
on conflict do nothing;
commit;

-- 기수 2개 (마감→차년도 이월 시나리오를 로컬에서 재현할 수 있게)
insert into public.system_year (company_id, entity_id, company_year_id, company_year, actual_year) values
    ('DEMO','D1','Y2026', 1, 2026),
    ('DEMO','D1','Y2027', 2, 2027)
on conflict do nothing;

-- 표준 GL 을 DEMO 회사에 적재 (ax_finance_gl_generate_standard 와 동일 결과)
insert into public.finance_gl
    (company_id, entity_id, gl_id, gl_name, gl_type, gl_category1, gl_category2,
     vat_gl, gl_detail, contra_gl, status,
     bank_id, team_id, pod_id, employee_id, client_id, vendor_id,
     dimension1, dimension2, dimension3, dimension4, dimension5, due_date)
select 'DEMO','D1', s.gl_id, s.gl_name, s.gl_type, s.gl_category1, s.gl_category2,
       s.vat_gl, s.gl_detail, s.contra_gl, s.status,
       s.bank_id, s.team_id, s.pod_id, s.employee_id, s.client_id, s.vendor_id,
       s.dimension1, s.dimension2, s.dimension3, s.dimension4, s.dimension5, s.due_date
  from public.finance_gl_seed s
on conflict do nothing;

insert into public.finance_bank_account (company_id, entity_id, bank_id, bank_name, bank_account) values
    ('DEMO','D1','B001','국민은행 주계좌','123456-78-901234')
on conflict do nothing;
insert into public.finance_bank_account (company_id, entity_id, bank_id, bank_name, card_number) values
    ('DEMO','D1','C001','법인카드','1234567812345678')
on conflict do nothing;

insert into public.partner_term (company_id, entity_id, term_id, base_rule, offset_days) values
    ('DEMO','D1','EOM15','EOM', 15)
on conflict do nothing;
insert into public.partner_term (company_id, entity_id, term_id, base_rule, fixed_day, offset_days) values
    ('DEMO','D1','CURM25','CURM', 25, 0)
on conflict do nothing;

insert into public.partner_client (company_id, entity_id, client_id, client_name, collecting_type) values
    ('DEMO','D1','CL001','가나상사','EOM15'),
    ('DEMO','D1','CL002','다라물산','CURM25')
on conflict do nothing;

insert into public.partner_vendor (company_id, entity_id, vendor_id, vendor_name, payment_type) values
    ('DEMO','D1','VD001','마바공업','EOM15')
on conflict do nothing;

-- ⚠ psql 메타명령(\echo)은 Supabase CLI 배치 실행이 지원하지 않는다. RAISE NOTICE 를 쓴다.
do $$
begin
  raise notice '';
  raise notice '  로컬 시드 완료 — 로그인: admin@axbridge.local / axbridge-dev';
  raise notice '  ⚠ ADMIN 은 SYSTEM/SYSTEM 소속이라 DEMO 회사 데이터는 보이지 않는다(1인 1회사 고정, C3).';
  raise notice '    DEMO 데이터를 보려면 DEMO 직원에 auth 계정을 연결하고 그 계정으로 로그인한다.';
  raise notice '';
end $$;
