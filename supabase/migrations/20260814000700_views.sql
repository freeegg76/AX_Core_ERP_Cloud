/*==============================================================================
  AX Bridge v2.0 — 07. 조회 뷰
  설계서 §10.3 (뷰가 필요한 경우 3가지) · §19.3 (마스킹)

  ⚠⚠ 모든 뷰에 `with (security_invoker = on)` 이 필수다.
      PostgreSQL 의 기본값은 off 이고, 그 경우 뷰가 **소유자 권한으로 실행되어
      RLS 를 통째로 우회**한다. 뷰를 11개 이상 만드는 설계에서 이것이 v2.0
      최대의 보안 사고 경로다. §19.1 의 CI 검사 5번이 전 뷰를 강제한다.

  ⚠ `select *` 금지 — DDL 변경 시 컬럼이 조용히 새어 나간다. §19.1 검사 6번.
==============================================================================*/

/*============================ SYSTEM ========================================*/

-- v1.1 usp_system_entity_get 의 `SELECT *` 대체 + estabilish_date 오타 별칭
create view public.v_system_entity with (security_invoker = on) as
select company_id, entity_id, entity_name, entity_name_ko,
       rep_name, reg_num, biz_num, biz_industry, biz_category, address,
       estabilish_date as establish_date,
       phone_number, fax_number, note, description,
       status,
       not status as is_active          -- 화면이 원시 극성을 만지지 않게 한다(§10.6)
  from public.system_entity;

create view public.v_system_company with (security_invoker = on) as
select company_id, company_name, company_name_ko, note, description,
       status, not status as is_active
  from public.system_company;

-- 자격증명 컬럼이 애초에 없다(C2). last_login 은 auth.users 에서 가져온다.
-- ⚠ auth.users 조인 — security_invoker 뷰라 호출자 권한으로 실행되고,
--   authenticated 는 auth.users 를 읽을 수 없다. 따라서 last_sign_in_at 은
--   SECURITY DEFINER 함수로 우회한다.
create or replace function public.ax_last_sign_in(p_auth_user_id uuid)
returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$ select u.last_sign_in_at from auth.users u where u.id = p_auth_user_id $$;

create view public.v_system_employee with (security_invoker = on) as
select e.company_id, e.entity_id, e.team_id, e.employee_id,
       e.employee_name, e.email, e.english_name, e.title, e.title_abbr,
       e.employment_type, e.status,
       e.departure_date, e.start_date, e.timezone, e.phone, e.birthday,
       e.profile_image_url, e.slack_user_id, e.slack_handle, e.social_buddy,
       e.user_yn, e.user_id, e.ax_role,
       (e.auth_user_id is not null)                as has_account,
       public.ax_last_sign_in(e.auth_user_id)      as last_login,
       e.last_manual_edit_at,
       (e.status <> 'inactive')                    as is_active
  from public.system_employee e;

comment on view public.v_system_employee is
  '직원 조회. 자격증명 컬럼 없음(C2). auth_user_id 원문 대신 has_account 를 노출한다';

/*============================ PARTNER =======================================*/

-- v1.1 usp_partner_client_get 의 `SELECT *` 대체
create view public.v_partner_client with (security_invoker = on) as
select c.company_id, c.entity_id, c.client_id, c.client_name,
       c.collecting_type, t.term_condition as collecting_term_condition,
       c.status, c.status as is_active,        -- ⚠ PARTNER 는 true=사용 (극성 반대)
       c.vat_id, c.nick_name, c.rep_name, c.reg_num,
       c.biz_industry, c.biz_category, c.client_address,
       c.phone_number, c.fax_number,
       c.bank_code, c.bank_branch, c.bank_account, c.bank_holder,
       c.website, c.logo_url, c.industry, c.notes
  from public.partner_client c
  left join public.partner_term t
    on t.company_id = c.company_id and t.entity_id = c.entity_id
   and t.term_id    = c.collecting_type;

create view public.v_partner_vendor with (security_invoker = on) as
select v.company_id, v.entity_id, v.vendor_id, v.vendor_name,
       v.payment_type, t.term_condition as payment_term_condition,
       v.status, v.status as is_active,
       v.vat_id, v.nick_name, v.rep_name, v.reg_num,
       v.biz_industry, v.biz_category, v.vendor_address,
       v.phone_number, v.fax_number,
       v.bank_code, v.bank_branch, v.bank_account, v.bank_holder,
       v.website, v.logo_url, v.industry, v.notes
  from public.partner_vendor v
  left join public.partner_term t
    on t.company_id = v.company_id and t.entity_id = v.entity_id
   and t.term_id    = v.payment_type;

/*============================ SALES =========================================*/

-- v1.1 usp_sales_pipeline_get 의 `SELECT *` 대체 + 담당자명 조인
create view public.v_sales_pipeline with (security_invoker = on) as
select p.company_id, p.entity_id, p.pipeline_id,
       p.pipeline_type, p.client_name, p.stage,
       p.employee_id, e.employee_name,
       p.note, p.created_date, p.adjusted_date, p.closed_date,
       p.contract_id,
       (p.stage in ('5','6')) as is_closed
  from public.sales_pipeline p
  left join public.system_employee e
    on e.company_id = p.company_id and e.entity_id = p.entity_id
   and e.employee_id = p.employee_id;

create view public.v_sales_contract with (security_invoker = on) as
select c.company_id, c.entity_id, c.contract_id, c.contract_type,
       c.client_id, cl.client_name,
       c.pipeline_id, c.start_date, c.end_date, c.status,
       c.contract_amount, c.ledger_date, c.ledger_no, c.closed_date,
       (c.ledger_date is not null) as has_ledger
  from public.sales_contract c
  left join public.partner_client cl
    on cl.company_id = c.company_id and cl.entity_id = c.entity_id
   and cl.client_id  = c.client_id;

/*============================ FINANCE =======================================*/

-- v1.1 usp_finance_gl_get 의 `g.*` 대체.
-- ⚠ 목록용이다. Slot 명칭이 필요하면 v_finance_gl_full 을 쓴다.
create view public.v_finance_gl with (security_invoker = on) as
select company_id, entity_id, gl_id, gl_name, gl_type,
       gl_category1, gl_category2, vat_gl, gl_detail, contra_gl,
       status, status as is_active,      -- ⚠ finance_gl 은 true=사용
       bank_id, team_id, pod_id, employee_id, client_id, vendor_id,
       dimension1, dimension2, dimension3, dimension4, dimension5, due_date
  from public.finance_gl;

-- 설계서 §10.3 뷰 필요 사유 ③ 조인 —
--   v1.1 usp_finance_gl_get 이 finance_dimension 을 slot 1~5 로 5회 조인해
--   관리항목 명칭을 붙이던 일을 대신한다.
create view public.v_finance_gl_full with (security_invoker = on) as
select g.*,
       d1.dimension_name as dimension1_name,
       d2.dimension_name as dimension2_name,
       d3.dimension_name as dimension3_name,
       d4.dimension_name as dimension4_name,
       d5.dimension_name as dimension5_name
  from public.v_finance_gl g
  left join public.finance_dimension d1
    on d1.company_id = g.company_id and d1.entity_id = g.entity_id and d1.slot_no = 1
  left join public.finance_dimension d2
    on d2.company_id = g.company_id and d2.entity_id = g.entity_id and d2.slot_no = 2
  left join public.finance_dimension d3
    on d3.company_id = g.company_id and d3.entity_id = g.entity_id and d3.slot_no = 3
  left join public.finance_dimension d4
    on d4.company_id = g.company_id and d4.entity_id = g.entity_id and d4.slot_no = 4
  left join public.finance_dimension d5
    on d5.company_id = g.company_id and d5.entity_id = g.entity_id and d5.slot_no = 5;

-- 설계서 §19.3 — 마스킹.
--
-- ⚠ security_invoker 뷰와 컬럼 권한 회수는 충돌한다 —
--    뷰가 호출자 권한으로 실행되므로, card_number 의 SELECT 를 회수하면
--    **뷰 자신도 그 컬럼을 읽지 못한다.** `public.ax_mask_card(card_number)` 를
--    뷰 안에서 직접 부를 수 없다는 뜻이다.
--
--    해결 : 마스킹된 값만 돌려주는 SECURITY DEFINER 함수를 경유한다.
--    함수가 원문을 읽되 밖으로는 마스킹 결과만 내보낸다. 스코프는 함수가 직접
--    클레임으로 건다 — 마스킹된 뒤 4자리도 타 회사에 노출되면 안 되기 때문이다.
create or replace function public.ax_bank_card_masked(p_bank_id varchar(10))
returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.ax_mask_card(b.card_number)
    from public.finance_bank_account b
   where b.company_id = public.auth_company_id()
     and b.entity_id  = public.auth_entity_id()
     and b.bank_id    = p_bank_id
$$;

create view public.v_finance_bank_account with (security_invoker = on) as
select company_id, entity_id, bank_id, bank_name,
       bank_account,
       public.ax_bank_card_masked(bank_id) as card_number_masked,
       is_card,                            -- 저장 계산열. 원문 없이 카드 여부만 알려준다.
       status,
       not status as is_active             -- ⚠ bank_account 는 false=사용
  from public.finance_bank_account;

comment on view public.v_finance_bank_account is
  '카드번호는 뒤 4자리만. 원문 조회 경로는 존재하지 않는다 (§19.3)';

-- 전표 목록. 상세(헤더+라인)는 ax_finance_ledger_get() RPC 가 담당한다(§10.2).
create view public.v_finance_ledger with (security_invoker = on) as
select h.company_id, h.entity_id, h.ledger_date, h.ledger_no,
       h.ledger_name, h.ledger_type,
       h.employee_id, e.employee_name,
       h.approver_id, a.employee_name as approver_name,
       h.insert_date, h.update_date, h.approved_date, h.approval_status,
       (select count(*) from public.finance_ledger_detail d
         where d.company_id = h.company_id and d.entity_id = h.entity_id
           and d.ledger_date = h.ledger_date and d.ledger_no = h.ledger_no) as line_count,
       (select coalesce(sum(d.amount) filter (where d.drcr = '1'), 0)
          from public.finance_ledger_detail d
         where d.company_id = h.company_id and d.entity_id = h.entity_id
           and d.ledger_date = h.ledger_date and d.ledger_no = h.ledger_no) as debit_total,
       (select coalesce(sum(d.amount) filter (where d.drcr = '2'), 0)
          from public.finance_ledger_detail d
         where d.company_id = h.company_id and d.entity_id = h.entity_id
           and d.ledger_date = h.ledger_date and d.ledger_no = h.ledger_no) as credit_total
  from public.finance_ledger_head h
  left join public.system_employee e
    on e.company_id = h.company_id and e.entity_id = h.entity_id and e.employee_id = h.employee_id
  left join public.system_employee a
    on a.company_id = h.company_id and a.entity_id = h.entity_id and a.employee_id = h.approver_id;

-- 마감현황. v1.1 usp_finance_closing_list 대체.
--   ⚠ finance_closing 에 행이 없으면 미마감이므로 system_year 기준 LEFT JOIN 이다.
create view public.v_finance_closing with (security_invoker = on) as
select y.company_id, y.entity_id, y.company_year_id,
       y.company_year, y.actual_year,
       coalesce(c.closing, false) as closing,
       c.closing_date
  from public.system_year y
  left join public.finance_closing c
    on c.company_id = y.company_id and c.entity_id = y.entity_id
   and c.company_year_id = y.company_year_id;

comment on view public.v_finance_closing is
  'system_year 기준 LEFT JOIN — finance_closing 에 행이 없으면 미마감(false)이다 (§8.5)';
