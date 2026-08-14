/*==============================================================================
  AX Bridge v2.0 — 보안 회귀 검사
  설계서 §19.1 — CI 가 실행하며, 하나라도 위반이면 실패한다.

  실행 : psql -f scripts/check-security.sql -v ON_ERROR_STOP=1

  이 검사가 사실상 유일한 그물이다 — RLS·정책 약 80건 중 한 줄 누락이
  조용한 데이터 유출이 되기 때문이다.
==============================================================================*/
\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_bad text;
  v_n   int;
  v_fail int := 0;

  -- 화이트리스트 : 쓰기 정책을 의도적으로 두지 않는 테이블 (§11.2)
  c_no_write text[] := array['finance_gl_seed', 'finance_closing'];
  -- DELETE 정책을 의도적으로 두지 않는 테이블 (§9.8)
  c_no_delete text[] := array['finance_gl_seed', 'finance_closing', 'finance_dimension_detail'];
begin
  raise notice '';
  raise notice '═══ AX Bridge 보안 회귀 검사 (설계서 §19.1) ═══';

  /*--- 1. public 의 모든 테이블에 RLS 가 켜져 있는가 */
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise warning '❌ [1] RLS 미적용 테이블: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [1] 전 테이블 RLS 적용';
  end if;

  /*--- 1b. FORCE RLS — 소유자에게도 정책이 적용되는가 */
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and not c.relforcerowsecurity;
  if v_bad is not null then
    raise warning '❌ [1b] FORCE RLS 미적용: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [1b] 전 테이블 FORCE RLS 적용';
  end if;

  /*--- 2. 필수 정책이 있는가 (화이트리스트 제외) */
  select string_agg(t.relname || '(' || t.missing || ')', ', ') into v_bad
    from (
      select c.relname,
             array_to_string(array(
               select cmd from unnest(array['SELECT','INSERT','UPDATE','DELETE']) cmd
                where not exists (select 1 from pg_policies p
                                   where p.schemaname='public' and p.tablename=c.relname
                                     and p.cmd = cmd)
                  and not (cmd <> 'SELECT' and c.relname = any(c_no_write))
                  and not (cmd = 'DELETE'  and c.relname = any(c_no_delete))
             ), '/') as missing
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relkind='r'
    ) t
   where t.missing <> '';
  if v_bad is not null then
    raise warning '❌ [2] 정책 누락: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [2] 필수 정책 완비';
  end if;

  /*--- 3. anon/PUBLIC 이 실행 가능한 함수가 없는가 */
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and (has_function_privilege('anon',   p.oid, 'EXECUTE')
       or has_function_privilege('public', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise warning '❌ [3] anon/PUBLIC 실행 가능 함수: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [3] anon/PUBLIC 실행 가능 함수 없음';
  end if;

  /*--- 4. SECURITY DEFINER 함수에 search_path 가 고정되어 있는가
          없으면 검색경로 하이재킹이 가능하다. */
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prosecdef
     and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false);
  if v_bad is not null then
    raise warning '❌ [4] search_path 미고정 SECURITY DEFINER: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [4] SECURITY DEFINER 전부 search_path 고정';
  end if;

  /*--- 5. ⭐ 모든 뷰에 security_invoker=on 이 있는가 — v2.0 최대의 사고 경로
          기본값 off 는 뷰를 소유자 권한으로 실행해 RLS 를 통째로 우회한다. */
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='v'
     and not coalesce(array_to_string(c.reloptions, ',') like '%security_invoker=on%', false);
  if v_bad is not null then
    raise warning '❌ [5] security_invoker 미적용 뷰: %  ← RLS 우회 위험', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [5] 전 뷰 security_invoker=on';
  end if;

  /*--- 6. 뷰 정의에 SELECT * 가 없는가 — DDL 변경 시 컬럼이 조용히 샌다 */
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='v'
     and pg_get_viewdef(c.oid) ~ 'SELECT\s+\*';
  if v_bad is not null then
    raise warning '❌ [6] SELECT * 사용 뷰: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [6] SELECT * 사용 뷰 없음';
  end if;

  /*--- 7. card_number 원문에 authenticated SELECT 권한이 없는가 (§19.3) */
  if has_column_privilege('authenticated', 'public.finance_bank_account', 'card_number', 'SELECT') then
    raise warning '❌ [7] card_number 원문이 authenticated 에게 노출됨'; v_fail := v_fail + 1;
  else raise notice '✔ [7] card_number 원문 조회 불가';
  end if;

  /*--- 8. 승인·역할 등 특권 컬럼의 UPDATE 권한이 없는가 (§5.3) */
  v_bad := null;
  if has_column_privilege('authenticated','public.finance_ledger_head','approval_status','UPDATE')
    then v_bad := coalesce(v_bad||', ','') || 'ledger_head.approval_status'; end if;
  if has_column_privilege('authenticated','public.finance_ledger_head','approved_date','UPDATE')
    then v_bad := coalesce(v_bad||', ','') || 'ledger_head.approved_date'; end if;
  if has_column_privilege('authenticated','public.system_employee','ax_role','UPDATE')
    then v_bad := coalesce(v_bad||', ','') || 'employee.ax_role'; end if;
  if has_column_privilege('authenticated','public.system_employee','auth_user_id','UPDATE')
    then v_bad := coalesce(v_bad||', ','') || 'employee.auth_user_id'; end if;
  if has_column_privilege('authenticated','public.finance_open_balance','closed','UPDATE')
    then v_bad := coalesce(v_bad||', ','') || 'open_balance.closed'; end if;
  if has_column_privilege('authenticated','public.finance_open_balance','source','UPDATE')
    then v_bad := coalesce(v_bad||', ','') || 'open_balance.source'; end if;
  if v_bad is not null then
    raise warning '❌ [8] 특권 컬럼 UPDATE 노출: %', v_bad; v_fail := v_fail + 1;
  else raise notice '✔ [8] 특권 컬럼 UPDATE 차단';
  end if;

  /*--- 9. 기대 수치 — 설계서 §1 규모 요약표와 일치하는가 */
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r';
  if v_n <> 21 then
    raise warning '❌ [9] 테이블 수 % (21 기대 — 설계서 §1)', v_n; v_fail := v_fail + 1;
  else raise notice '✔ [9] 테이블 21종';
  end if;

  select count(*) into v_n from public.finance_gl_seed;
  if v_n <> 355 then
    raise warning '❌ [10] 표준 GL seed % 행 (355 기대)', v_n; v_fail := v_fail + 1;
  else raise notice '✔ [10] 표준 GL seed 355행';
  end if;

  raise notice '';
  if v_fail > 0 then
    raise exception '보안 회귀 검사 실패 — % 항목 위반', v_fail;
  end if;
  raise notice '═══ 전 항목 통과 ═══';
  raise notice '';
end $$;
