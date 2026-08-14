/*==============================================================================
  AX Bridge v2.0 — 11. RLS 정책
  설계서 §5.2 정책 패턴 · §5.3 역할 경계 · §19.1

  기본형 (모든 업무 테이블 동형)
    SELECT : 스코프 일치 + rank >= 10 (VIEWER)
    INSERT : 스코프 일치 + rank >= 20 (EDITOR)   ← WITH CHECK
    UPDATE : 스코프 일치 + rank >= 20            ← USING + WITH CHECK 양쪽 필수
    DELETE : 스코프 일치 + rank >= 20

  ⚠ UPDATE 의 WITH CHECK 를 빠뜨리면 자기 회사 행의 company_id 를 타 회사로 바꿔
     옮길 수 있다. USING 은 "어떤 행을 고를 수 있나", WITH CHECK 는 "어떤 값으로
     바꿀 수 있나"다.

  ⚠ force row level security — 테이블 소유자에게도 정책을 적용한다.
     이것이 없으면 postgres 롤로 실행되는 경로가 격리를 우회한다.
==============================================================================*/

/*============================================================================
  헬퍼 : 표준 정책 4종을 한 번에 만든다.
  반복 80건을 손으로 쓰면 한 줄 누락이 조용한 데이터 유출이 된다(§19.1).
============================================================================*/
create or replace function public.ax_apply_standard_policies(
    p_table    text,
    p_read_rank  int default 10,
    p_write_rank int default 20)
returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_scope text := 'company_id = public.auth_company_id() and entity_id = public.auth_entity_id()';
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force  row level security', p_table);

  execute format(
    'create policy %I on public.%I for select to authenticated using (%s and public.auth_role_rank() >= %s)',
    'p_' || p_table || '_select', p_table, v_scope, p_read_rank);

  execute format(
    'create policy %I on public.%I for insert to authenticated with check (%s and public.auth_role_rank() >= %s)',
    'p_' || p_table || '_insert', p_table, v_scope, p_write_rank);

  -- USING + WITH CHECK 양쪽. WITH CHECK 에는 역할 조건을 다시 걸지 않는다
  -- (USING 이 이미 통과시킨 행이므로) — 스코프 이탈만 막는다.
  execute format(
    'create policy %I on public.%I for update to authenticated using (%s and public.auth_role_rank() >= %s) with check (%s)',
    'p_' || p_table || '_update', p_table, v_scope, p_write_rank, v_scope);

  execute format(
    'create policy %I on public.%I for delete to authenticated using (%s and public.auth_role_rank() >= %s)',
    'p_' || p_table || '_delete', p_table, v_scope, p_write_rank);
end $$;

/*============================================================================
  SYSTEM
============================================================================*/
-- ⚠ system_company 는 스코프 컬럼이 company_id 하나뿐이다(entity_id 없음).
alter table public.system_company enable row level security;
alter table public.system_company force  row level security;

create policy p_system_company_select on public.system_company
  for select to authenticated
  using (company_id = public.auth_company_id() and public.auth_role_rank() >= 10);

-- ⚠ v1.1 EDITOR → v2.0 ADMIN 상향(§6.4). 테넌트 마스터를 EDITOR 가 지우면
--   그 회사의 전 데이터가 고아가 된다. → §16.3 미해결 이슈 #6 (고객 확인 필요)
create policy p_system_company_insert on public.system_company
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_role_rank() >= 40);
create policy p_system_company_update on public.system_company
  for update to authenticated
  using      (company_id = public.auth_company_id() and public.auth_role_rank() >= 40)
  with check (company_id = public.auth_company_id());
create policy p_system_company_delete on public.system_company
  for delete to authenticated
  using (company_id = public.auth_company_id() and public.auth_role_rank() >= 40);

select public.ax_apply_standard_policies('system_entity',   10, 40);  -- ⚠ ADMIN 상향
select public.ax_apply_standard_policies('system_pod',      10, 20);
select public.ax_apply_standard_policies('system_team',     10, 20);
select public.ax_apply_standard_policies('system_employee', 10, 20);
select public.ax_apply_standard_policies('system_year',     10, 20);

/*============================================================================
  PARTNER
============================================================================*/
select public.ax_apply_standard_policies('partner_term',   10, 20);
select public.ax_apply_standard_policies('partner_client', 10, 20);
select public.ax_apply_standard_policies('partner_vendor', 10, 20);

/*============================================================================
  SALES
============================================================================*/
select public.ax_apply_standard_policies('sales_pipeline',        10, 20);
select public.ax_apply_standard_policies('sales_pipeline_detail', 10, 20);
select public.ax_apply_standard_policies('sales_contract',        10, 20);

/*============================================================================
  FINANCE
============================================================================*/
select public.ax_apply_standard_policies('finance_gl',           10, 20);
select public.ax_apply_standard_policies('finance_bank_account', 10, 20);
select public.ax_apply_standard_policies('finance_ledger_head',  10, 20);
select public.ax_apply_standard_policies('finance_ledger_detail',10, 20);
select public.ax_apply_standard_policies('finance_open_balance', 10, 20);
select public.ax_apply_standard_policies('finance_dimension',    10, 20);

/*--- finance_dimension_detail — ⚠ DELETE 정책을 두지 않는다 (§9.8)
      v1.1 은 DELETE 프로시저가 없다는 사실만으로 삭제가 막혔다.
      v2.0 은 PostgREST 가 모든 테이블에 DELETE 를 자동 제공하므로
      "경로가 없어서 막힌다" → "정책이 없어서 막힌다" 로 근거가 바뀐다. */
alter table public.finance_dimension_detail enable row level security;
alter table public.finance_dimension_detail force  row level security;

create policy p_dimension_detail_select on public.finance_dimension_detail
  for select to authenticated
  using (company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
         and public.auth_role_rank() >= 10);
create policy p_dimension_detail_insert on public.finance_dimension_detail
  for insert to authenticated
  with check (company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
              and public.auth_role_rank() >= 20);
create policy p_dimension_detail_update on public.finance_dimension_detail
  for update to authenticated
  using      (company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
              and public.auth_role_rank() >= 20)
  with check (company_id = public.auth_company_id() and entity_id = public.auth_entity_id());
-- DELETE 정책 없음 — 의도적이다. 관리항목 전체 삭제(RPC)로만 회수된다.

/*--- finance_closing — ⚠ 쓰기 정책 없음 (§8.5 · §11.2)
      closing DEFAULT 가 true 라서 컬럼을 생략한 bare INSERT 가 해당 연도를
      즉시 마감 처리한다. RPC(SECURITY DEFINER)만 쓰게 한다. */
alter table public.finance_closing enable row level security;
alter table public.finance_closing force  row level security;

create policy p_finance_closing_select on public.finance_closing
  for select to authenticated
  using (company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
         and public.auth_role_rank() >= 10);
-- INSERT/UPDATE/DELETE 정책 없음 — 의도적이다.

/*--- finance_gl_seed — 전역 읽기 전용 (§5 예외 1건)
      스코프 컬럼이 없다. 갱신은 마이그레이션(소유자)만 가능하다. */
alter table public.finance_gl_seed enable row level security;
alter table public.finance_gl_seed force  row level security;

create policy p_gl_seed_select on public.finance_gl_seed
  for select to authenticated
  using (public.auth_role_rank() >= 10);
-- 쓰기 정책 없음 — 의도적이다.

/*============================================================================
  헬퍼 함수 정리
  ax_apply_standard_policies 는 마이그레이션 전용이다. 남겨두면 authenticated 가
  호출해 임의 테이블에 정책을 만들 수 있다(§19.1 검사 3).
============================================================================*/
drop function public.ax_apply_standard_policies(text, int, int);
