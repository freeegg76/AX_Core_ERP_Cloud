/*==============================================================================
  AX Bridge v2.0 — 09. PARTNER · SALES · SYSTEM RPC 함수
  설계서 §10.2 (RPC 16~20)
==============================================================================*/

/*============================================================================
  16. ax_partner_term_calc_due — 지급일 계산 (§9.11)

  ⚠ 이 함수가 **유일한 계산 주체**다. 프론트엔드는 재구현하지 않고 미리보기도
     이 RPC 를 호출한다. v1.1 §15.1 이 경고한 "미리보기와 저장이 갈린다"를
     설계에서 제거하기 위함이다(§2.3).

  EOM+N  : 기준월 말일 + offset_days
  CurM DD: 기준월 DD일, DD 가 월말 초과 시 월말로 보정
============================================================================*/
create or replace function public.ax_partner_term_calc_due(
    p_term_id   varchar(10),
    p_base_date date
) returns date
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_rule   varchar(10);
  v_fixed  numeric(2,0);
  v_offset numeric(3,0);
  v_eom    date;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(10, '지급일 계산');

  select base_rule, fixed_day, offset_days
    into v_rule, v_fixed, v_offset
    from public.partner_term
   where company_id = public.auth_company_id()
     and entity_id  = public.auth_entity_id()
     and term_id    = p_term_id;

  if v_rule is null then
    perform public.ax_raise(50206, '존재하지 않는 지급정책입니다.', 404);
  end if;

  -- 부록 C.3 — EOMONTH(d)
  v_eom := (date_trunc('month', p_base_date) + interval '1 month - 1 day')::date;

  if v_rule = 'EOM' then
    return v_eom + v_offset::int;                       -- DATEADD(DAY, n, d) → d + n
  else
    -- 월말 초과 시 클램프 (2월 31일 → 2월 말일). 윤년도 date_trunc 가 정확히 처리한다.
    return case
             when v_fixed > extract(day from v_eom)::int then v_eom
             else make_date(extract(year  from p_base_date)::int,
                            extract(month from p_base_date)::int,
                            v_fixed::int)
           end;
  end if;
end $$;

comment on function public.ax_partner_term_calc_due(varchar, date) is
  '지급일 계산의 유일한 주체. 미리보기도 이 함수를 호출한다 — 등가성 버그 원천 차단 (§9.11)';

/*============================================================================
  17. ax_sales_contract_link_ledger — 계약 ↔ 전표 연결/해제

  ⚠ 부록 C.1 — v1.1 은 T-SQL 에 boolean 타입이 없어 `(a IS NULL) <> (b IS NULL)`
     을 쓸 수 없었고(Msg 102), 두 절로 펼쳐 쓰는 우회가 필요했다.
     PostgreSQL 에서는 그 우회가 통째로 사라진다.
============================================================================*/
create or replace function public.ax_sales_contract_link_ledger(
    p_contract_id   varchar(20),
    p_contract_type varchar(5),
    p_ledger_date   date default null,
    p_ledger_no     numeric(10,2) default null
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '계약-전표 연결');

  -- 둘 다 입력이거나 둘 다 NULL 이어야 한다(FR-Contract-08).
  -- PostgreSQL 은 boolean 을 직접 비교할 수 있다.
  if (p_ledger_date is null) <> (p_ledger_no is null) then
    perform public.ax_raise(50341, '전표일자와 전표번호는 함께 입력하거나 함께 비워야 합니다.');
  end if;

  if not exists (select 1 from public.sales_contract
                  where company_id = v_co and entity_id = v_en
                    and contract_id = p_contract_id and contract_type = p_contract_type
                    for update) then
    perform public.ax_raise(50342, '대상 계약이 없습니다.', 404);
  end if;

  -- 연결 대상 전표가 같은 회사에 실재해야 한다
  if p_ledger_date is not null
     and not exists (select 1 from public.finance_ledger_head
                      where company_id = v_co and entity_id = v_en
                        and ledger_date = p_ledger_date and ledger_no = p_ledger_no) then
    perform public.ax_raise(50343, '연결하려는 전표가 존재하지 않습니다.', 404);
  end if;

  update public.sales_contract
     set ledger_date = p_ledger_date, ledger_no = p_ledger_no
   where company_id = v_co and entity_id = v_en
     and contract_id = p_contract_id and contract_type = p_contract_type;
end $$;

/*============================================================================
  18. ax_sales_pipeline_link_contract — 파이프라인 ↔ 계약 연결/해제
============================================================================*/
create or replace function public.ax_sales_pipeline_link_contract(
    p_pipeline_id varchar(10),
    p_contract_id varchar(20) default null
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '파이프라인-계약 연결');

  if not exists (select 1 from public.sales_pipeline
                  where company_id = v_co and entity_id = v_en
                    and pipeline_id = p_pipeline_id
                    for update) then
    perform public.ax_raise(50311, '대상 파이프라인이 없습니다.', 404);
  end if;

  -- sales_contract 의 PK 가 (contract_id, contract_type) 복합이라 FK 를 걸 수 없다.
  -- 검증을 여기서 수행한다(§9.9).
  if p_contract_id is not null
     and not exists (select 1 from public.sales_contract
                      where company_id = v_co and entity_id = v_en
                        and contract_id = p_contract_id) then
    perform public.ax_raise(50312, '연결하려는 계약이 존재하지 않습니다.', 404);
  end if;

  update public.sales_pipeline
     set contract_id = p_contract_id
   where company_id = v_co and entity_id = v_en and pipeline_id = p_pipeline_id;
end $$;

/*============================================================================
  19. ax_system_employee_delete — ADMIN

  v1.1 usp_system_employee_delete 의 5개 테이블 참조검사를 승계한다.
  ⚠ FK 로 대체할 수 없는 참조가 섞여 있어 함수로 남긴다 —
     system_team.owner / leader_user_id 는 FK 가 없다(순환 의존).
============================================================================*/
create or replace function public.ax_system_employee_delete(
    p_employee_id varchar(10)
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_auth uuid;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(40, '직원 삭제');           -- ADMIN

  select auth_user_id into v_auth from public.system_employee
   where company_id = v_co and entity_id = v_en and employee_id = p_employee_id;
  if not found then
    perform public.ax_raise(50147, '대상 직원이 없습니다.', 404);
  end if;

  -- built-in admin 물리삭제는 트리거(51001)가 차단하지만, 여기서 먼저 안내한다.
  if p_employee_id = 'ADMIN' then
    perform public.ax_raise(50141, '기본 관리자 계정은 삭제할 수 없습니다.', 409);
  end if;

  if exists (select 1 from public.system_team
              where company_id = v_co and entity_id = v_en
                and (owner = p_employee_id or leader_user_id = p_employee_id)) then
    perform public.ax_raise(50142, '부서의 오너/리더로 지정된 직원은 삭제할 수 없습니다.', 409);
  end if;

  if exists (select 1 from public.sales_pipeline
              where company_id = v_co and entity_id = v_en and employee_id = p_employee_id) then
    perform public.ax_raise(50143, '파이프라인에 연결된 직원은 삭제할 수 없습니다.', 409);
  end if;

  if exists (select 1 from public.finance_ledger_head
              where company_id = v_co and entity_id = v_en
                and (employee_id = p_employee_id or approver_id = p_employee_id)) then
    perform public.ax_raise(50144, '전표에 연결된 직원은 삭제할 수 없습니다.', 409);
  end if;

  if exists (select 1 from public.finance_ledger_detail
              where company_id = v_co and entity_id = v_en and employee_id = p_employee_id) then
    perform public.ax_raise(50145, '전표 라인에 연결된 직원은 삭제할 수 없습니다.', 409);
  end if;

  delete from public.system_employee
   where company_id = v_co and entity_id = v_en and employee_id = p_employee_id;

  -- auth.users 는 남는다. 계정 회수는 Edge Function/Admin API 의 몫이며,
  -- FK ON DELETE RESTRICT 가 잘못된 연쇄삭제를 막는다(§6.1).
end $$;

/*============================================================================
  20. ax_system_employee_set_role — ADMIN (§6.3)

  ⚠ 자기 자신의 역할은 올릴 수 없다 — 권한 상승 방지.
============================================================================*/
create or replace function public.ax_system_employee_set_role(
    p_employee_id varchar(10),
    p_role        varchar(10)
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co   varchar(10) := public.auth_company_id();
  v_en   varchar(10) := public.auth_entity_id();
  v_me   varchar(10) := public.auth_employee_id();
  v_mine int := public.auth_role_rank_live();
  v_new  int;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(40, '역할 변경');           -- ADMIN

  v_new := case p_role
             when 'SUPER' then 50 when 'ADMIN' then 40 when 'APPROVER' then 30
             when 'EDITOR' then 20 when 'VIEWER' then 10 else 0 end;
  if v_new = 0 then
    perform public.ax_raise(50146, '유효하지 않은 역할입니다.');
  end if;

  -- 권한 상승 방지 : 자기 자신은 못 바꾸고, 자기보다 높은 역할은 부여할 수 없다.
  if p_employee_id = v_me then
    perform public.ax_raise(40302, '자기 자신의 역할은 변경할 수 없습니다.', 403);
  end if;
  if v_new > v_mine then
    perform public.ax_raise(40303, '자신보다 높은 역할은 부여할 수 없습니다.', 403);
  end if;

  update public.system_employee
     set ax_role = p_role
   where company_id = v_co and entity_id = v_en and employee_id = p_employee_id;
  if not found then
    perform public.ax_raise(50147, '대상 직원이 없습니다.', 404);
  end if;
  -- 마지막 활성 SUPER 보호는 트리거(51002)가 담당한다(§6.5).
end $$;
