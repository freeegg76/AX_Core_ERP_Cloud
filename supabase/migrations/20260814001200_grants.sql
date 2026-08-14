/*==============================================================================
  AX Bridge v2.0 — 12. 권한 (GRANT / REVOKE)
  설계서 §5.3 역할 경계 · §19.1 · §19.3

  RLS 정책은 **행 단위**다. "EDITOR 는 전표를 수정할 수 있지만 approval_status 만은
  못 바꾼다"는 **컬럼 단위** 규칙이라 정책만으로는 표현되지 않는다.
  EDITOR 가 PostgREST 로 PATCH { "approval_status": true } 를 보내면 정책은 통과한다.

  3중 방어(§5.3) 중 ①번이 이 파일이다.
    ① 컬럼 GRANT — authenticated 에서 해당 컬럼의 UPDATE 권한을 뺀다
    ② RPC 가 유일한 통로 (SECURITY DEFINER + 역할 재검사)
    ③ 트리거 — 경로와 무관하게 상태 전이를 지킨다
==============================================================================*/

/*============================================================================
  0. 기본 정리 — 아무것도 주지 않은 상태에서 시작한다.
     Supabase 는 public 스키마에 기본 GRANT 를 걸어두므로 명시적으로 회수한다.
============================================================================*/
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- anon 은 아무것도 할 수 없다. 로그인 전에는 업무 데이터에 접근할 이유가 없다.
grant usage on schema public to anon, authenticated;

/*============================================================================
  1. 테이블 — 기본 CRUD (실제 통제는 RLS 가 한다)
============================================================================*/
grant select, insert, update, delete on
    public.system_company, public.system_entity, public.system_pod,
    public.system_team, public.system_year,
    public.partner_term, public.partner_client, public.partner_vendor,
    public.sales_pipeline, public.sales_pipeline_detail, public.sales_contract,
    public.finance_gl, public.finance_dimension,
    public.finance_bank_account
  to authenticated;

-- DELETE 없음 — 정책도 없다(§9.8)
grant select, insert, update on public.finance_dimension_detail to authenticated;

-- 조회만 (쓰기는 RPC 전용)
grant select on public.finance_closing  to authenticated;
grant select on public.finance_gl_seed  to authenticated;

/*============================================================================
  2. 컬럼 단위 통제 — 여기가 §5.3 의 핵심이다
============================================================================*/

/*--- 2-1. 전표 헤더 : 승인 3종 컬럼의 UPDATE 를 뺀다 */
revoke update on public.finance_ledger_head from authenticated;
grant  update (ledger_name, ledger_type, employee_id, update_date)
    on public.finance_ledger_head to authenticated;
-- approval_status · approver_id · approved_date · ledger_no · ledger_date 는 부여하지 않는다.
--   승인   → ax_finance_ledger_approve() 만
--   채번   → BEFORE INSERT 트리거만 (C5)
grant select, insert, delete on public.finance_ledger_head to authenticated;

/*--- 2-2. 전표 라인 : 전량 RPC 경유가 원칙이나, 정책상 CRUD 는 열어둔다.
        line_on 은 클라이언트가 정할 수 없다. */
revoke update on public.finance_ledger_detail from authenticated;
grant  update (gl_id, drcr, amount, bank_id, team_id, pod_id, employee_id,
               client_id, vendor_id, dimension1, dimension2, dimension3,
               dimension4, dimension5, due_date)
    on public.finance_ledger_detail to authenticated;
grant select, insert, delete on public.finance_ledger_detail to authenticated;

/*--- 2-3. 초기이월 : closed(확정) · source(출처) 는 RPC 만 */
revoke update on public.finance_open_balance from authenticated;
grant  update (amount, bank_id, client_id, vendor_id)
    on public.finance_open_balance to authenticated;
grant select, insert, delete on public.finance_open_balance to authenticated;

/*--- 2-4. 직원 : ax_role(권한 상승) · auth_user_id(계정 탈취) 는 RPC 만 */
revoke update on public.system_employee from authenticated;
grant  update (employee_name, email, english_name, title, title_abbr,
               employment_type, status, departure_date, start_date, timezone,
               phone, birthday, profile_image_url, slack_user_id, slack_handle,
               social_buddy, user_yn, user_id, team_id)
    on public.system_employee to authenticated;
grant select, insert, delete on public.system_employee to authenticated;

/*--- 2-5. 은행/카드 : card_number 원문 SELECT 회수 (§19.3)
        조회는 v_finance_bank_account 뷰가 마스킹된 값만 노출한다.
        ⚠ 누락하면 조용히 새는 것이 아니라 시끄럽게 깨진다 — 이것이 개선의 핵심이다. */
revoke select on public.finance_bank_account from authenticated;
grant  select (company_id, entity_id, bank_id, bank_name, bank_account, is_card, status)
    on public.finance_bank_account to authenticated;
-- 등록·수정 시에는 카드번호를 써야 하므로 INSERT/UPDATE 권한은 유지한다.
-- (쓸 수는 있으나 되읽을 수 없다 — write-only 컬럼)

/*--- 2-6. 관리항목 : slot_no 는 RPC 가 할당한다(§9.8) */
revoke update on public.finance_dimension from authenticated;
grant  update (dimension_name, status) on public.finance_dimension to authenticated;
grant select, insert, delete on public.finance_dimension to authenticated;

/*============================================================================
  3. 뷰 — 조회 전용
============================================================================*/
grant select on
    public.v_system_company, public.v_system_entity, public.v_system_employee,
    public.v_partner_client, public.v_partner_vendor,
    public.v_sales_pipeline, public.v_sales_contract,
    public.v_finance_gl, public.v_finance_gl_full,
    public.v_finance_bank_account, public.v_finance_ledger, public.v_finance_closing
  to authenticated;

/*============================================================================
  4. 함수 — RPC 20건만 authenticated 에 부여한다 (§19.1 검사 3)

  ⚠ 기본 회수가 먼저다. PostgreSQL 은 함수 생성 시 PUBLIC 에 EXECUTE 를 주므로,
     명시적으로 빼지 않으면 미인증 호출이 가능해진다.
============================================================================*/
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 클레임 헬퍼 — 정책이 호출하므로 authenticated 에 필요하다.
grant execute on function
    public.auth_claims(), public.auth_company_id(), public.auth_entity_id(),
    public.auth_employee_id(), public.auth_role_rank(), public.auth_role_rank_live(),
    public.ax_mask_card(text), public.ax_safe_int(text), public.ax_escape_like(text),
    public.ax_last_sign_in(uuid), public.ax_bank_card_masked(varchar)
  to authenticated;

-- RPC 20건 (§10.2)
grant execute on function
    public.ax_finance_ledger_save(jsonb, jsonb),
    public.ax_finance_ledger_approve(date, numeric),
    public.ax_finance_ledger_delete(date, numeric),
    public.ax_finance_ledger_get(date, numeric),
    public.ax_finance_ledger_preview_account_change(varchar, jsonb),
    public.ax_finance_openbalance_save(varchar, jsonb),
    public.ax_finance_openbalance_list(varchar, text, varchar, boolean),
    public.ax_finance_openbalance_close(varchar),
    public.ax_finance_openbalance_reopen(varchar),
    public.ax_finance_closing_execute(varchar),
    public.ax_finance_closing_reopen(varchar),
    public.ax_finance_closing_status(varchar),
    public.ax_finance_gl_generate_standard(),
    public.ax_finance_dimension_save(jsonb),
    public.ax_finance_dimension_delete(varchar),
    public.ax_partner_term_calc_due(varchar, date),
    public.ax_sales_contract_link_ledger(varchar, varchar, date, numeric),
    public.ax_sales_pipeline_link_contract(varchar, varchar),
    public.ax_system_employee_delete(varchar),
    public.ax_system_employee_set_role(varchar, varchar)
  to authenticated;

/*============================================================================
  5. 이후 생성될 오브젝트의 기본 권한
     새 테이블이 실수로 열린 채 배포되지 않게 한다. §19.1 검사 1·2 와 짝이다.
============================================================================*/
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
