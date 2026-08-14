/*==============================================================================
  AX Bridge v2.0 — 08. FINANCE RPC 함수
  설계서 §10.2 (선별 포팅 C4) · §9 핵심 업무 규칙

  공통 규약(설계서 §10.2)
    · SECURITY DEFINER — 컬럼 GRANT 를 넘어 승인·마감 컬럼을 쓰기 위함
    · set search_path = '' — 필수(§19.1 검사 4)
    · 스코프를 파라미터로 받지 않는다. 클레임에서 읽는다 — 받지 않는 것이 검증보다 안전(§5.4)
    · 함수는 그 자체로 원자적이다. BEGIN TRAN / ROLLBACK / XACT_ABORT 가 전부 불필요(§13)
    · 우회 플래그는 set_config(..., true) 트랜잭션 로컬 — 리셋 불필요(C6)
==============================================================================*/

/*----------------------------------------------- 공통 헬퍼 : 마감연도 검증 */
-- v1.1 usp_finance_check_year_open. 전표 관련 RPC 의 첫 문장으로 호출한다(FR-Ledger-16).
create or replace function public.ax_finance_check_year_open(p_target_date date)
returns void
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.finance_closing c
      join public.system_year y
        on y.company_id = c.company_id and y.entity_id = c.entity_id
       and y.company_year_id = c.company_year_id
     where c.company_id = public.auth_company_id()
       and c.entity_id  = public.auth_entity_id()
       and c.closing
       and trunc(y.actual_year)::int = extract(year from p_target_date)::int)
  then
    perform public.ax_raise(50501,
      '회계마감된 연도의 전표는 신규/수정/삭제/승인할 수 없습니다. 조회만 가능합니다.', 409);
  end if;
end $$;

/*============================================================================
  1. ax_finance_ledger_save — v1.1 head_save + detail_save 통합 (§11.4)

  왜 합치는가 — v1.1 은 두 엔드포인트로 나뉘어 있었고 사이에 실패하면
  라인 없는 헤더가 남았다. §13 은 이 둘을 하나의 트랜잭션으로 요구하는데,
  엔드포인트가 둘이면 그 요구를 지킬 수 없다.

  p_head  : {ledger_date, ledger_no(수정 시), ledger_name, ledger_type, employee_id}
  p_lines : [{gl_id, drcr, amount, bank_id, team_id, pod_id, employee_id,
              client_id, vendor_id, dimension1..5, due_date}, ...]
            ⚠ 배열 순서가 곧 line_on 이다(§9.1). 부분 저장 불가 — 항상 전체 집합.
============================================================================*/
create or replace function public.ax_finance_ledger_save(
    p_head  jsonb,
    p_lines jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co   varchar(10) := public.auth_company_id();
  v_en   varchar(10) := public.auth_entity_id();
  v_date date        := (p_head ->> 'ledger_date')::date;
  v_no   numeric(10,2) := nullif(p_head ->> 'ledger_no', '')::numeric(10,2);
  v_bad  record;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '전표 저장');           -- EDITOR
  perform public.ax_finance_check_year_open(v_date);          -- FR-Ledger-16

  if v_date is null then
    perform public.ax_raise(50451, '전표일자는 필수입니다.');
  end if;

  /*---------------------------------------------------- 헤더 : 신규 or 수정 */
  if v_no is null then
    -- 신규. ledger_no 는 BEFORE INSERT 트리거가 채번한다(C5, §9.2).
    insert into public.finance_ledger_head
        (company_id, entity_id, ledger_date, ledger_no, ledger_name, ledger_type,
         employee_id, insert_date, update_date, approval_status)
    values (v_co, v_en, v_date, 0,          -- 0 은 자리표시자. 트리거가 덮어쓴다.
            p_head ->> 'ledger_name',
            coalesce(p_head ->> 'ledger_type', '0'),
            nullif(p_head ->> 'employee_id', ''),
            current_date, current_date, false)
    returning ledger_no into v_no;
  else
    -- 수정. 미승인 전표만 가능하다.
    update public.finance_ledger_head
       set ledger_name = p_head ->> 'ledger_name',
           ledger_type = coalesce(p_head ->> 'ledger_type', ledger_type),
           employee_id = nullif(p_head ->> 'employee_id', ''),
           update_date = current_date
     where company_id = v_co and entity_id = v_en
       and ledger_date = v_date and ledger_no = v_no
       and not approval_status;
    if not found then
      perform public.ax_raise(50452, '미승인 전표가 아니거나 전표가 존재하지 않습니다.', 409);
    end if;
  end if;

  /*------------------------------------------------------------- 라인 검증 */
  -- 설계서 부록 C.1 — OPENJSON … WITH → jsonb_to_recordset
  --   ⚠ WITH ORDINALITY 로 배열 위치를 명시적으로 얻는다. v1.1 의 IDENTITY 테이블변수는
  --     T-SQL 이 순서를 보장하지 않는 성질에 의존했다(§9.1).
  create temp table _lines on commit drop as
  select ord::int as line_on,
         l.gl_id, l.drcr, l.amount, l.bank_id, l.team_id, l.pod_id, l.employee_id,
         l.client_id, l.vendor_id,
         l.dimension1, l.dimension2, l.dimension3, l.dimension4, l.dimension5, l.due_date
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as e(elem, ord)
    cross join lateral jsonb_to_record(e.elem) as l(
         gl_id varchar(10), drcr varchar(10), amount numeric(18,2),
         bank_id varchar(10), team_id varchar(10), pod_id varchar(4), employee_id varchar(10),
         client_id varchar(10), vendor_id varchar(10),
         dimension1 varchar(10), dimension2 varchar(10), dimension3 varchar(10),
         dimension4 varchar(10), dimension5 varchar(10), due_date date);

  -- 50462 : 필수값 + 금액 > 0
  if exists (select 1 from _lines
              where gl_id is null or drcr not in ('1','2') or coalesce(amount, 0) <= 0) then
    perform public.ax_raise(50462, '계정코드/차대구분은 필수이며 금액은 0보다 커야 합니다.');
  end if;

  -- 50463 : 사용중 계정만 (finance_gl 은 status=true 가 사용)
  if exists (select 1 from _lines l
              left join public.finance_gl g
                on g.company_id = v_co and g.entity_id = v_en and g.gl_id = l.gl_id and g.status
             where g.gl_id is null) then
    perform public.ax_raise(50463, '미사용 또는 타 회사 계정이 포함되어 있습니다.');
  end if;

  -- 50464 : 은행/카드 플래그 규칙 (bank_account 는 status=false 가 사용 — 극성 주의)
  if exists (
    select 1 from _lines l
      join public.finance_gl g
        on g.company_id = v_co and g.entity_id = v_en and g.gl_id = l.gl_id
     where (g.bank_id and (l.bank_id is null or not exists (
              select 1 from public.finance_bank_account b
               where b.company_id = v_co and b.entity_id = v_en
                 and b.bank_id = l.bank_id and not b.status)))
        or (not g.bank_id and l.bank_id is not null)) then
    perform public.ax_raise(50464,
      '은행/카드 입력 규칙 위반 라인이 있습니다. (플래그 사용: 사용중 계좌 필수 / 미사용: 입력 불가)');
  end if;

  -- 50465 : 지급/입금일
  if exists (select 1 from _lines l
               join public.finance_gl g
                 on g.company_id = v_co and g.entity_id = v_en and g.gl_id = l.gl_id
              where not g.due_date and l.due_date is not null) then
    perform public.ax_raise(50465, '지급/입금일 미사용 계정 라인에 지급일을 저장할 수 없습니다.');
  end if;

  -- 50466 : 비활성 관리항목에 값 저장 금지
  if exists (
    select 1 from _lines l
      join public.finance_gl g
        on g.company_id = v_co and g.entity_id = v_en and g.gl_id = l.gl_id
     where (not g.team_id     and l.team_id     is not null)
        or (not g.pod_id      and l.pod_id      is not null)
        or (not g.employee_id and l.employee_id is not null)
        or (not g.client_id   and l.client_id   is not null)
        or (not g.vendor_id   and l.vendor_id   is not null)
        or (not g.dimension1  and l.dimension1  is not null)
        or (not g.dimension2  and l.dimension2  is not null)
        or (not g.dimension3  and l.dimension3  is not null)
        or (not g.dimension4  and l.dimension4  is not null)
        or (not g.dimension5  and l.dimension5  is not null)) then
    perform public.ax_raise(50466, '계정과목에서 비활성화된 관리항목에 값을 저장할 수 없습니다.');
  end if;

  /*------------------------------------------------- 전량 DELETE → 순서대로 재INSERT */
  delete from public.finance_ledger_detail
   where company_id = v_co and entity_id = v_en
     and ledger_date = v_date and ledger_no = v_no;

  insert into public.finance_ledger_detail
      (company_id, entity_id, ledger_date, ledger_no, line_on, gl_id, drcr, amount,
       bank_id, team_id, pod_id, employee_id, client_id, vendor_id,
       dimension1, dimension2, dimension3, dimension4, dimension5, due_date)
  select v_co, v_en, v_date, v_no, line_on, gl_id, drcr, amount,
         bank_id, team_id, pod_id, employee_id, client_id, vendor_id,
         dimension1, dimension2, dimension3, dimension4, dimension5, due_date
    from _lines;

  update public.finance_ledger_head set update_date = current_date
   where company_id = v_co and entity_id = v_en
     and ledger_date = v_date and ledger_no = v_no;

  return jsonb_build_object('ledger_date', v_date, 'ledger_no', v_no);
end $$;

/*============================================================================
  2. ax_finance_ledger_approve — APPROVER (§9.3)
============================================================================*/
create or replace function public.ax_finance_ledger_approve(
    p_ledger_date date,
    p_ledger_no   numeric(10,2)
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_dr numeric(18,2);
  v_cr numeric(18,2);
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(30, '전표 승인');           -- APPROVER
  perform public.ax_finance_check_year_open(p_ledger_date);

  -- 대상 확보 + 잠금. v1.1 의 WITH (UPDLOCK) 대응(부록 C.1)
  perform 1 from public.finance_ledger_head
   where company_id = v_co and entity_id = v_en
     and ledger_date = p_ledger_date and ledger_no = p_ledger_no
     and not approval_status
   for update;
  if not found then
    perform public.ax_raise(50471, '승인 대상 미승인 전표가 없습니다.', 404);
  end if;

  if not exists (select 1 from public.finance_ledger_detail
                  where company_id = v_co and entity_id = v_en
                    and ledger_date = p_ledger_date and ledger_no = p_ledger_no) then
    perform public.ax_raise(50472, '전표 라인이 없어 승인할 수 없습니다.');
  end if;

  select coalesce(sum(amount) filter (where drcr = '1'), 0),
         coalesce(sum(amount) filter (where drcr = '2'), 0)
    into v_dr, v_cr
    from public.finance_ledger_detail
   where company_id = v_co and entity_id = v_en
     and ledger_date = p_ledger_date and ledger_no = p_ledger_no;

  if v_dr <> v_cr then
    perform public.ax_raise(50473,
      '차변합계와 대변합계가 일치하지 않습니다. 차액: ' || to_char(v_dr - v_cr, 'FM999,999,999,990.00'));
  end if;

  -- C6 — 트랜잭션 로컬. 리셋 불필요, 예외 경로에서 누출 불가.
  perform set_config('ax.ledger_approve', '1', true);

  update public.finance_ledger_head
     set approval_status = true,
         approver_id     = public.auth_employee_id(),
         approved_date   = now()
   where company_id = v_co and entity_id = v_en
     and ledger_date = p_ledger_date and ledger_no = p_ledger_no;
end $$;

/*============================================================================
  3. ax_finance_ledger_delete — EDITOR
============================================================================*/
create or replace function public.ax_finance_ledger_delete(
    p_ledger_date date,
    p_ledger_no   numeric(10,2)
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
  perform public.ax_require_role(20, '전표 삭제');
  perform public.ax_finance_check_year_open(p_ledger_date);

  perform 1 from public.finance_ledger_head
   where company_id = v_co and entity_id = v_en
     and ledger_date = p_ledger_date and ledger_no = p_ledger_no
     and not approval_status
   for update;
  if not found then
    perform public.ax_raise(50474, '미승인 전표만 삭제할 수 있습니다.', 409);
  end if;

  if exists (select 1 from public.sales_contract
              where company_id = v_co and entity_id = v_en
                and ledger_date = p_ledger_date and ledger_no = p_ledger_no) then
    perform public.ax_raise(50475, '계약에 연결된 전표는 삭제할 수 없습니다.', 409);
  end if;

  -- 라인은 FK ON DELETE CASCADE 가 처리한다(§10.5).
  delete from public.finance_ledger_head
   where company_id = v_co and entity_id = v_en
     and ledger_date = p_ledger_date and ledger_no = p_ledger_no;
end $$;

/*============================================================================
  4. ax_finance_ledger_get — v1.1 의 2결과셋을 jsonb 하나로 (§10.2)
============================================================================*/
create or replace function public.ax_finance_ledger_get(
    p_ledger_date date,
    p_ledger_no   numeric(10,2)
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_co   varchar(10) := public.auth_company_id();
  v_en   varchar(10) := public.auth_entity_id();
  v_head jsonb;
  v_lines jsonb;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(10, '전표 조회');            -- VIEWER

  select to_jsonb(h) into v_head
    from public.v_finance_ledger h
   where h.company_id = v_co and h.entity_id = v_en
     and h.ledger_date = p_ledger_date and h.ledger_no = p_ledger_no;

  if v_head is null then
    perform public.ax_raise(50451, '전표를 찾을 수 없습니다.', 404);
  end if;

  -- 라인 + 계정명/은행명 + GL 플래그 12종 (화면이 Layer3 활성/비활성을 판단하는 근거)
  select coalesce(jsonb_agg(x order by x.line_on), '[]'::jsonb) into v_lines
    from (
      select d.line_on, d.gl_id, g.gl_name, d.drcr, d.amount,
             d.bank_id, b.bank_name,
             d.team_id, d.pod_id, d.employee_id, d.client_id, d.vendor_id,
             d.dimension1, d.dimension2, d.dimension3, d.dimension4, d.dimension5,
             d.due_date,
             g.bank_id     as f_bank,   g.team_id    as f_team,
             g.pod_id      as f_pod,    g.employee_id as f_employee,
             g.client_id   as f_client, g.vendor_id  as f_vendor,
             g.dimension1  as f_dim1,   g.dimension2 as f_dim2,
             g.dimension3  as f_dim3,   g.dimension4 as f_dim4,
             g.dimension5  as f_dim5,   g.due_date   as f_due
        from public.finance_ledger_detail d
        join public.finance_gl g
          on g.company_id = d.company_id and g.entity_id = d.entity_id and g.gl_id = d.gl_id
        left join public.finance_bank_account b
          on b.company_id = d.company_id and b.entity_id = d.entity_id and b.bank_id = d.bank_id
       where d.company_id = v_co and d.entity_id = v_en
         and d.ledger_date = p_ledger_date and d.ledger_no = p_ledger_no
    ) x;

  return jsonb_build_object('head', v_head, 'lines', v_lines);
end $$;

/*============================================================================
  5. ax_finance_ledger_preview_account_change — UC-Ledger-04 예외 (신설)

  계정을 바꾸면 플래그가 사용→미사용이 되어 버려질 Layer3 값이 생긴다.
  ⚠ 값을 자동으로 지우지 않고 **목록만 돌려준다.** 사용자 확인 전 무단 폐기 금지가
     설계 의도다(§7.4). 화면이 확인을 받은 뒤 정리된 라인으로 저장한다.
============================================================================*/
create or replace function public.ax_finance_ledger_preview_account_change(
    p_new_gl_id varchar(10),
    p_line      jsonb
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_g record;
  v_conflicts text[] := '{}';
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '계정 변경 미리보기');

  select * into v_g from public.finance_gl
   where company_id = public.auth_company_id()
     and entity_id  = public.auth_entity_id()
     and gl_id = p_new_gl_id and status;
  if not found then
    perform public.ax_raise(50463, '미사용 또는 타 회사 계정입니다.', 404);
  end if;

  if not v_g.bank_id     and p_line ->> 'bank_id'     is not null then v_conflicts := v_conflicts || 'bank_id';     end if;
  if not v_g.team_id     and p_line ->> 'team_id'     is not null then v_conflicts := v_conflicts || 'team_id';     end if;
  if not v_g.pod_id      and p_line ->> 'pod_id'      is not null then v_conflicts := v_conflicts || 'pod_id';      end if;
  if not v_g.employee_id and p_line ->> 'employee_id' is not null then v_conflicts := v_conflicts || 'employee_id'; end if;
  if not v_g.client_id   and p_line ->> 'client_id'   is not null then v_conflicts := v_conflicts || 'client_id';   end if;
  if not v_g.vendor_id   and p_line ->> 'vendor_id'   is not null then v_conflicts := v_conflicts || 'vendor_id';   end if;
  if not v_g.dimension1  and p_line ->> 'dimension1'  is not null then v_conflicts := v_conflicts || 'dimension1';  end if;
  if not v_g.dimension2  and p_line ->> 'dimension2'  is not null then v_conflicts := v_conflicts || 'dimension2';  end if;
  if not v_g.dimension3  and p_line ->> 'dimension3'  is not null then v_conflicts := v_conflicts || 'dimension3';  end if;
  if not v_g.dimension4  and p_line ->> 'dimension4'  is not null then v_conflicts := v_conflicts || 'dimension4';  end if;
  if not v_g.dimension5  and p_line ->> 'dimension5'  is not null then v_conflicts := v_conflicts || 'dimension5';  end if;
  if not v_g.due_date    and p_line ->> 'due_date'    is not null then v_conflicts := v_conflicts || 'due_date';    end if;

  return jsonb_build_object(
    'gl_id',     p_new_gl_id,
    'conflicts', to_jsonb(v_conflicts),   -- 비어 있지 않으면 화면이 사용자 확인을 받는다
    'flags',     jsonb_build_object(
        'bank_id', v_g.bank_id, 'team_id', v_g.team_id, 'pod_id', v_g.pod_id,
        'employee_id', v_g.employee_id, 'client_id', v_g.client_id, 'vendor_id', v_g.vendor_id,
        'dimension1', v_g.dimension1, 'dimension2', v_g.dimension2, 'dimension3', v_g.dimension3,
        'dimension4', v_g.dimension4, 'dimension5', v_g.dimension5, 'due_date', v_g.due_date));
end $$;

/*============================================================================
  6. ax_finance_openbalance_save — jsonb 일괄 (§9.4)

  ⚠ 저장 시맨틱 — 화면이 사용자에게 드러내야 한다.
     · closed=false 행만 DELETE 후 재INSERT
     · amount > 0 행만 INSERT → **0원 입력은 "0으로 저장"이 아니라 행 삭제**다
============================================================================*/
create or replace function public.ax_finance_openbalance_save(
    p_company_year_id varchar(10),
    p_rows            jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_yy int;
  v_saved int;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '초기이월 저장');

  select trunc(actual_year)::int into v_yy
    from public.system_year
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;
  if v_yy is null then
    perform public.ax_raise(50431, '등록되지 않은 회사 기수입니다. 회사 기수 등록 후 진행하세요.', 404);
  end if;

  if exists (select 1 from public.finance_closing
              where company_id = v_co and entity_id = v_en
                and company_year_id = p_company_year_id and closing) then
    perform public.ax_raise(50521, '회계마감된 연도의 초기이월은 변경할 수 없습니다.', 409);
  end if;

  if exists (select 1 from public.finance_open_balance
              where company_id = v_co and entity_id = v_en
                and company_year_id = p_company_year_id and closed) then
    perform public.ax_raise(50432, '확정된 초기이월이 존재합니다. 확정해제 후 수정하세요.', 409);
  end if;

  create temp table _rows on commit drop as
  select r.gl_id, r.drcr, r.bank_id, r.client_id, r.vendor_id, r.amount
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e(elem)
    cross join lateral jsonb_to_record(e.elem) as r(
        gl_id varchar(10), drcr varchar(10), bank_id varchar(10),
        client_id varchar(10), vendor_id varchar(10), amount numeric(18,2));

  if exists (select 1 from _rows where drcr not in ('1','2') or amount < 0) then
    perform public.ax_raise(50433, '차대구분(1/2) 또는 금액(0 이상)이 유효하지 않은 행이 있습니다.');
  end if;

  if exists (select 1 from _rows r
              left join public.finance_gl g
                on g.company_id = v_co and g.entity_id = v_en and g.gl_id = r.gl_id and g.status
             where g.gl_id is null) then
    perform public.ax_raise(50434, '사용중이 아닌 계정코드가 포함되어 있습니다.');
  end if;

  -- 은행/카드는 status=false 가 사용 (극성 주의)
  if exists (select 1 from _rows r where r.bank_id is not null and not exists (
               select 1 from public.finance_bank_account
                where company_id = v_co and entity_id = v_en
                  and bank_id = r.bank_id and not status)) then
    perform public.ax_raise(50522, '유효하지 않거나 미사용인 은행/카드가 포함되어 있습니다.');
  end if;

  if exists (select 1 from _rows r where r.client_id is not null and not exists (
               select 1 from public.partner_client
                where company_id = v_co and entity_id = v_en
                  and client_id = r.client_id and status)) then
    perform public.ax_raise(50435, '유효하지 않은 고객사가 포함되어 있습니다.');
  end if;

  if exists (select 1 from _rows r where r.vendor_id is not null and not exists (
               select 1 from public.partner_vendor
                where company_id = v_co and entity_id = v_en
                  and vendor_id = r.vendor_id and status)) then
    perform public.ax_raise(50436, '유효하지 않은 거래처가 포함되어 있습니다.');
  end if;

  if exists (select 1 from _rows
              group by gl_id, drcr, coalesce(bank_id,'-'), coalesce(client_id,'-'), coalesce(vendor_id,'-')
             having count(*) > 1) then
    perform public.ax_raise(50437,
      '동일 계정/차대/은행·카드/고객사/거래처 조합이 중복된 행이 있습니다.', 409);
  end if;

  delete from public.finance_open_balance
   where company_id = v_co and entity_id = v_en
     and company_year_id = p_company_year_id and not closed;

  insert into public.finance_open_balance
      (company_id, entity_id, company_year_id, gl_id, drcr,
       bank_id, client_id, vendor_id, amount, closed, source)
  select v_co, v_en, p_company_year_id, gl_id, drcr,
         bank_id, client_id, vendor_id, amount, false, 'MANUAL'
    from _rows where amount > 0;

  get diagnostics v_saved = row_count;   -- ⚠ INSERT 직후에 읽는다(부록 C.3)
  return jsonb_build_object('saved', v_saved);
end $$;

/*============================================================================
  7. ax_finance_openbalance_list — v1.1 의 2결과셋을 jsonb 하나로
============================================================================*/
create or replace function public.ax_finance_openbalance_list(
    p_company_year_id varchar(10),
    p_gl_keyword      text default null,
    p_drcr            varchar(10) default null,
    p_closed          boolean default null
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_rows jsonb;
  v_tot  jsonb;
  v_kw   text := case when p_gl_keyword is null then null
                      else '%' || public.ax_escape_like(p_gl_keyword) || '%' end;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(10, '초기이월 조회');

  select coalesce(jsonb_agg(x order by x.gl_id, x.drcr, x.bank_key, x.client_key, x.vendor_key),
                  '[]'::jsonb)
    into v_rows
    from (
      select g.gl_id, g.gl_name, ob.drcr,
             ob.bank_id, ba.bank_name,
             ob.client_id, pc.client_name,
             ob.vendor_id, pv.vendor_name,
             ob.amount, ob.closed, ob.source,
             coalesce(ob.bank_key,'-')   as bank_key,
             coalesce(ob.client_key,'-') as client_key,
             coalesce(ob.vendor_key,'-') as vendor_key
        from public.finance_gl g
        left join public.finance_open_balance ob
          on ob.company_id = g.company_id and ob.entity_id = g.entity_id
         and ob.gl_id = g.gl_id and ob.company_year_id = p_company_year_id
        left join public.finance_bank_account ba
          on ba.company_id = g.company_id and ba.entity_id = g.entity_id and ba.bank_id = ob.bank_id
        left join public.partner_client pc
          on pc.company_id = g.company_id and pc.entity_id = g.entity_id and pc.client_id = ob.client_id
        left join public.partner_vendor pv
          on pv.company_id = g.company_id and pv.entity_id = g.entity_id and pv.vendor_id = ob.vendor_id
       where g.company_id = v_co and g.entity_id = v_en and g.status
         and (p_drcr   is null or ob.drcr = p_drcr)
         and (p_closed is null or ob.closed = p_closed)
         and (v_kw is null or g.gl_id like v_kw escape '\' or g.gl_name like v_kw escape '\')
    ) x;

  -- C11 — 부호를 살려 계산한다. DRCR 별 단순 SUM 은 음수 행이 합계를 왜곡한다(§9.5).
  select jsonb_build_object(
           'debit_total',  coalesce(sum(amount) filter (where drcr = '1'), 0),
           'credit_total', coalesce(sum(amount) filter (where drcr = '2'), 0),
           'difference',   coalesce(sum(case when drcr = '1' then amount else -amount end), 0))
    into v_tot
    from public.finance_open_balance
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;

  return jsonb_build_object('rows', v_rows, 'totals', v_tot);
end $$;

/*============================================================================
  8. ax_finance_openbalance_close — APPROVER (§9.4)
============================================================================*/
create or replace function public.ax_finance_openbalance_close(
    p_company_year_id varchar(10)
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_dr numeric(18,2);
  v_cr numeric(18,2);
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(30, '초기이월 확정');       -- APPROVER

  if exists (select 1 from public.finance_closing
              where company_id = v_co and entity_id = v_en
                and company_year_id = p_company_year_id and closing) then
    perform public.ax_raise(50521, '회계마감된 연도의 초기이월은 변경할 수 없습니다.', 409);
  end if;

  select coalesce(sum(amount) filter (where drcr = '1'), 0),
         coalesce(sum(amount) filter (where drcr = '2'), 0)
    into v_dr, v_cr
    from public.finance_open_balance
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id
     for update;

  if v_dr <> v_cr then
    perform public.ax_raise(50441,
      '차변합계와 대변합계가 일치하지 않아 확정할 수 없습니다. 차액: '
      || to_char(v_dr - v_cr, 'FM999,999,999,990.00'));
  end if;

  perform set_config('ax.openbal_admin', '1', true);
  update public.finance_open_balance set closed = true
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;
end $$;

/*============================================================================
  9. ax_finance_openbalance_reopen — ADMIN (§9.4)
============================================================================*/
create or replace function public.ax_finance_openbalance_reopen(
    p_company_year_id varchar(10)
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_yy int;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(40, '초기이월 확정해제');   -- ADMIN

  select trunc(actual_year)::int into v_yy
    from public.system_year
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;
  if v_yy is null then
    perform public.ax_raise(50442, '대상 기수가 없습니다.', 404);
  end if;

  if exists (select 1 from public.finance_closing
              where company_id = v_co and entity_id = v_en
                and company_year_id = p_company_year_id and closing) then
    perform public.ax_raise(50523, '회계마감된 연도의 초기이월은 확정해제할 수 없습니다.', 409);
  end if;

  -- 전년도가 회계마감이면 본 연도 초기이월은 자동생성분 → 해제 불가(FR-Close-08)
  if exists (
    select 1 from public.finance_closing c
      join public.system_year p
        on p.company_id = c.company_id and p.entity_id = c.entity_id
       and p.company_year_id = c.company_year_id
     where c.company_id = v_co and c.entity_id = v_en and c.closing
       and trunc(p.actual_year)::int = v_yy - 1) then
    perform public.ax_raise(50524, '연도마감으로 자동 생성된 초기이월은 확정해제할 수 없습니다.', 409);
  end if;

  perform set_config('ax.openbal_admin', '1', true);
  update public.finance_open_balance set closed = false
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;
end $$;

/*============================================================================
  10. ax_finance_closing_execute — ADMIN (§9.5)

  이월 계산 : 자산(0) = 전년이월 + 당해차변 − 당해대변 → DRCR=1
              부채(1)·자본(2) = 전년이월 + 당해대변 − 당해차변 → DRCR=2
              집계 단위 = gl_id + bank_id + client_id + vendor_id
              잔액계산은 승인 전표만. 잔액 0 조합은 미생성.
============================================================================*/
create or replace function public.ax_finance_closing_execute(
    p_company_year_id varchar(10)
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co       varchar(10) := public.auth_company_id();
  v_en       varchar(10) := public.auth_entity_id();
  v_yy       int;
  v_next_id  varchar(10);
  v_open_cnt int;
  v_carried  int;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(40, '연도 회계마감');       -- ADMIN

  -- [검증1] 대상 기수 존재
  select trunc(actual_year)::int into v_yy
    from public.system_year
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id
     for update;
  if v_yy is null then
    perform public.ax_raise(50511, '대상 기수가 존재하지 않습니다.', 404);
  end if;

  -- [검증2] 재마감 불가
  if exists (select 1 from public.finance_closing
              where company_id = v_co and entity_id = v_en
                and company_year_id = p_company_year_id and closing) then
    perform public.ax_raise(50512, '이미 마감된 연도입니다. 재마감할 수 없습니다.', 409);
  end if;

  -- [검증3] 선행연도 마감 완료 (이른 연도부터 순차)
  if exists (
    select 1 from public.system_year p
      left join public.finance_closing pc
        on pc.company_id = p.company_id and pc.entity_id = p.entity_id
       and pc.company_year_id = p.company_year_id
     where p.company_id = v_co and p.entity_id = v_en
       and trunc(p.actual_year)::int < v_yy
       and not coalesce(pc.closing, false)) then
    perform public.ax_raise(50513, '선행연도가 미마감 상태입니다. 이른 연도부터 순차로 마감하세요.', 409);
  end if;

  -- [검증4] 차년도 기수 존재
  select company_year_id into v_next_id
    from public.system_year
   where company_id = v_co and entity_id = v_en
     and trunc(actual_year)::int = v_yy + 1;
  if v_next_id is null then
    perform public.ax_raise(50514,
      '차년도 기수가 등록되어 있지 않습니다. 차년도 기수 등록 후 실행하세요.', 409);
  end if;

  -- [검증5] 대상연도 미승인 전표 없음
  select count(*) into v_open_cnt
    from public.finance_ledger_head
   where company_id = v_co and entity_id = v_en
     and extract(year from ledger_date)::int = v_yy
     and not approval_status;
  if v_open_cnt > 0 then
    perform public.ax_raise(50515,
      v_yy::text || '년에 미승인 전표 ' || v_open_cnt::text
      || '건이 존재하여 마감할 수 없습니다. 승인 또는 정리 후 다시 실행하세요.', 409);
  end if;

  -- [검증6] 차년도 초기이월 미존재
  if exists (select 1 from public.finance_open_balance
              where company_id = v_co and entity_id = v_en and company_year_id = v_next_id) then
    perform public.ax_raise(50516,
      '차년도에 초기이월 데이터가 이미 존재합니다. 기존 데이터 확인/정리 후 다시 실행하세요.', 409);
  end if;

  -- [산출] 4-CTE 이월 계산. 자동생성분이므로 closed=true · source='CLOSING'.
  -- ⚠ 트리거 우회 플래그가 필요하다 — INSERT 되는 행이 closed=true 이기 때문.
  perform set_config('ax.openbal_admin', '1', true);

  with gl as (
    select gl_id, public.ax_safe_int(gl_type) as t
      from public.finance_gl
     where company_id = v_co and entity_id = v_en
       and public.ax_safe_int(gl_type) between 0 and 2
  ),
  prior as (
    select ob.gl_id, ob.bank_key, ob.client_key, ob.vendor_key,
           sum(case when ob.drcr = '1' then ob.amount else -ob.amount end) as net_dr
      from public.finance_open_balance ob
      join gl on gl.gl_id = ob.gl_id
     where ob.company_id = v_co and ob.entity_id = v_en
       and ob.company_year_id = p_company_year_id
     group by ob.gl_id, ob.bank_key, ob.client_key, ob.vendor_key
  ),
  cur as (
    select d.gl_id,
           coalesce(d.bank_id,   '-') as bank_key,
           coalesce(d.client_id, '-') as client_key,
           coalesce(d.vendor_id, '-') as vendor_key,
           sum(case when d.drcr = '1' then d.amount else -d.amount end) as net_dr
      from public.finance_ledger_detail d
      join public.finance_ledger_head h
        on h.company_id = d.company_id and h.entity_id = d.entity_id
       and h.ledger_date = d.ledger_date and h.ledger_no = d.ledger_no
      join gl on gl.gl_id = d.gl_id
     where d.company_id = v_co and d.entity_id = v_en
       and extract(year from d.ledger_date)::int = v_yy
       and h.approval_status
     group by d.gl_id, coalesce(d.bank_id,'-'), coalesce(d.client_id,'-'), coalesce(d.vendor_id,'-')
  ),
  merged as (
    select coalesce(p.gl_id,      c.gl_id)      as gl_id,
           coalesce(p.bank_key,   c.bank_key)   as bank_key,
           coalesce(p.client_key, c.client_key) as client_key,
           coalesce(p.vendor_key, c.vendor_key) as vendor_key,
           coalesce(p.net_dr, 0) + coalesce(c.net_dr, 0) as net_dr
      from prior p
      full outer join cur c
        on c.gl_id = p.gl_id and c.bank_key = p.bank_key
       and c.client_key = p.client_key and c.vendor_key = p.vendor_key
  )
  insert into public.finance_open_balance
      (company_id, entity_id, company_year_id, gl_id, drcr,
       bank_id, client_id, vendor_id, amount, closed, source)
  select v_co, v_en, v_next_id, m.gl_id,
         case when g.t = 0 then '1' else '2' end,
         nullif(m.bank_key,'-'), nullif(m.client_key,'-'), nullif(m.vendor_key,'-'),
         case when g.t = 0 then m.net_dr else -m.net_dr end,   -- C11 : 음수 허용
         true, 'CLOSING'
    from merged m
    join gl g on g.gl_id = m.gl_id
   where case when g.t = 0 then m.net_dr else -m.net_dr end <> 0;

  get diagnostics v_carried = row_count;   -- ⚠ INSERT 직후

  -- [확정] MERGE → INSERT ON CONFLICT (부록 C.1)
  insert into public.finance_closing (company_id, entity_id, company_year_id, closing, closing_date)
  values (v_co, v_en, p_company_year_id, true, current_date)
  on conflict (company_id, entity_id, company_year_id)
  do update set closing = true, closing_date = current_date;

  return jsonb_build_object(
    'closed_year_id', p_company_year_id,
    'next_year_id',   v_next_id,
    'carried_rows',   v_carried);
end $$;

/*============================================================================
  11. ax_finance_closing_reopen — ADMIN (C12, §9.6)

  ⚠ 실행 순서 — ① closing=false 를 **먼저** UPDATE 한 뒤 ② 플래그 설정 ③ 회수.
     v1.1 대비 ④ 플래그 리셋과 "단일 커넥션" 제약이 사라진다(C6).
============================================================================*/
create or replace function public.ax_finance_closing_reopen(
    p_company_year_id varchar(10)
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co        varchar(10) := public.auth_company_id();
  v_en        varchar(10) := public.auth_entity_id();
  v_yy        int;
  v_next_id   varchar(10);
  v_next_cnt  int;
  v_removed   int := 0;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(40, '연도 회계마감 해제');  -- ADMIN

  -- [검증1] 대상 기수 존재
  select trunc(actual_year)::int into v_yy
    from public.system_year
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id
     for update;
  if v_yy is null then
    perform public.ax_raise(50531, '대상 기수가 존재하지 않습니다.', 404);
  end if;

  -- [검증2] 마감 상태여야 해제 가능
  if not exists (select 1 from public.finance_closing
                  where company_id = v_co and entity_id = v_en
                    and company_year_id = p_company_year_id and closing
                    for update) then
    perform public.ax_raise(50532, '마감되지 않은 연도입니다. 해제할 대상이 없습니다.', 409);
  end if;

  -- [검증3] 후행 연도가 마감이면 불가 — 해제는 내림차순 순차
  if exists (
    select 1 from public.system_year n
      join public.finance_closing nc
        on nc.company_id = n.company_id and nc.entity_id = n.entity_id
       and nc.company_year_id = n.company_year_id
     where n.company_id = v_co and n.entity_id = v_en
       and trunc(n.actual_year)::int > v_yy and nc.closing) then
    perform public.ax_raise(50533, '후행 연도가 마감된 상태입니다. 늦은 연도부터 순차로 해제하세요.', 409);
  end if;

  select company_year_id into v_next_id
    from public.system_year
   where company_id = v_co and entity_id = v_en
     and trunc(actual_year)::int = v_yy + 1;

  if v_next_id is not null then
    -- [검증4] 차년도 수기 입력분 유실 방지
    if exists (select 1 from public.finance_open_balance
                where company_id = v_co and entity_id = v_en
                  and company_year_id = v_next_id and source = 'MANUAL') then
      perform public.ax_raise(50534,
        '차년도 초기이월에 수기 입력분이 존재하여 해제할 수 없습니다. 해당 데이터를 먼저 정리하세요.', 409);
    end if;

    -- [검증5] 차년도 전표 존재 시 불가
    select count(*) into v_next_cnt
      from public.finance_ledger_head
     where company_id = v_co and entity_id = v_en
       and extract(year from ledger_date)::int = v_yy + 1;
    if v_next_cnt > 0 then
      perform public.ax_raise(50535,
        (v_yy + 1)::text || '년에 전표 ' || v_next_cnt::text
        || '건이 존재하여 마감을 해제할 수 없습니다. 차년도 전표를 먼저 정리하세요.', 409);
    end if;
  end if;

  -- ① 마감 해제 (선행) — 이 시점에 대상연도의 잠금이 풀린다
  update public.finance_closing
     set closing = false, closing_date = null
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;

  -- ②③ 차년도 자동생성분 회수. closed=true 보호(51031)를 통과하려면 플래그가 필요하다.
  if v_next_id is not null then
    perform set_config('ax.openbal_admin', '1', true);
    delete from public.finance_open_balance
     where company_id = v_co and entity_id = v_en
       and company_year_id = v_next_id and source = 'CLOSING';
    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object(
    'reopened_year_id', p_company_year_id,
    'next_year_id',     v_next_id,
    'removed_rows',     v_removed);
end $$;

/*============================================================================
  12. ax_finance_closing_status
============================================================================*/
create or replace function public.ax_finance_closing_status(
    p_company_year_id varchar(10)
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare v_row jsonb;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(10, '마감현황 조회');

  select to_jsonb(c) into v_row
    from public.v_finance_closing c
   where c.company_id = public.auth_company_id()
     and c.entity_id  = public.auth_entity_id()
     and c.company_year_id = p_company_year_id;

  if v_row is null then
    perform public.ax_raise(50511, '대상 기수가 존재하지 않습니다.', 404);
  end if;
  return v_row;
end $$;

/*============================================================================
  13. ax_finance_gl_generate_standard — ADMIN (§9.7)
============================================================================*/
create or replace function public.ax_finance_gl_generate_standard()
returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_seed_cnt int;
  v_inserted int;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(40, '표준 계정과목 재생성');  -- ADMIN

  -- 전표가 1건이라도 있으면 불가. FOR UPDATE 로 검증–실행 사이의 등록을 막는다.
  if exists (select 1 from public.finance_ledger_head
              where company_id = v_co and entity_id = v_en
                for update) then
    perform public.ax_raise(50411,
      '전표가 존재하는 회사는 계정과목을 재생성할 수 없습니다.', 409);
  end if;

  select count(*) into v_seed_cnt from public.finance_gl_seed;
  if v_seed_cnt = 0 then
    perform public.ax_raise(50412, '표준 계정과목 원본(seed)이 비어 있습니다.', 409);
  end if;

  -- 참조보호 트리거를 통과한다(§10.5)
  perform set_config('ax.bypass_gl_protect', '1', true);
  delete from public.finance_gl where company_id = v_co and entity_id = v_en;

  insert into public.finance_gl
      (company_id, entity_id, gl_id, gl_name, gl_type, gl_category1, gl_category2,
       vat_gl, gl_detail, contra_gl, status,
       bank_id, team_id, pod_id, employee_id, client_id, vendor_id,
       dimension1, dimension2, dimension3, dimension4, dimension5, due_date)
  select v_co, v_en, s.gl_id, s.gl_name, s.gl_type, s.gl_category1, s.gl_category2,
         s.vat_gl, s.gl_detail, s.contra_gl, s.status,
         s.bank_id, s.team_id, s.pod_id, s.employee_id, s.client_id, s.vendor_id,
         s.dimension1, s.dimension2, s.dimension3, s.dimension4, s.dimension5, s.due_date
    from public.finance_gl_seed s;

  -- ⚠ v1.1 결함 해소 — @@ROWCOUNT 를 COMMIT 이후에 읽어 항상 무의미했다(부록 C.4).
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('inserted_count', v_inserted);
end $$;

/*============================================================================
  14~15. 관리항목 — slot 할당(C5) · 2단 DELETE
============================================================================*/
create or replace function public.ax_finance_dimension_save(
    p_dim jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co   varchar(10) := public.auth_company_id();
  v_en   varchar(10) := public.auth_entity_id();
  v_id   varchar(10) := p_dim ->> 'dimension_id';
  v_slot smallint;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '관리항목 저장');

  if v_id is null or v_id = '' then
    perform public.ax_raise(50421, '관리항목 코드는 필수입니다.');
  end if;

  if exists (select 1 from public.finance_dimension
              where company_id = v_co and entity_id = v_en and dimension_id = v_id) then
    -- 수정 — slot_no 는 변경 불가(§9.8)
    update public.finance_dimension
       set dimension_name = p_dim ->> 'dimension_name',
           status = coalesce((p_dim ->> 'status')::boolean, status)
     where company_id = v_co and entity_id = v_en and dimension_id = v_id
    returning slot_no into v_slot;
  else
    -- 신규 — 미사용 최소 Slot 을 할당한다. 회사 단위로 직렬화(C5).
    perform pg_advisory_xact_lock(hashtext('ax_dim_slot|' || v_co || '|' || v_en));

    select min(s) into v_slot
      from generate_series(1, 5) as s
     where not exists (select 1 from public.finance_dimension
                        where company_id = v_co and entity_id = v_en and slot_no = s);
    if v_slot is null then
      perform public.ax_raise(50422, '관리항목은 회사당 최대 5개까지 등록할 수 있습니다.', 409);
    end if;

    insert into public.finance_dimension
        (company_id, entity_id, dimension_id, dimension_name, slot_no, status)
    values (v_co, v_en, v_id, p_dim ->> 'dimension_name', v_slot,
            coalesce((p_dim ->> 'status')::boolean, true));
  end if;

  return jsonb_build_object('dimension_id', v_id, 'slot_no', v_slot);
end $$;

create or replace function public.ax_finance_dimension_delete(
    p_dimension_id varchar(10)
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_co varchar(10) := public.auth_company_id();
  v_en varchar(10) := public.auth_entity_id();
  v_slot smallint;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(20, '관리항목 삭제');

  select slot_no into v_slot from public.finance_dimension
   where company_id = v_co and entity_id = v_en and dimension_id = p_dimension_id;
  if v_slot is null then
    perform public.ax_raise(50423, '대상 관리항목이 없습니다.', 404);
  end if;

  -- 해당 Slot 이 GL 플래그로 사용 중이거나 전표 라인에 값이 있으면 차단(§9.8)
  if exists (select 1 from public.finance_gl g
              where g.company_id = v_co and g.entity_id = v_en
                and case v_slot when 1 then g.dimension1 when 2 then g.dimension2
                                when 3 then g.dimension3 when 4 then g.dimension4
                                else g.dimension5 end) then
    perform public.ax_raise(50424,
      '계정과목에서 사용 중인 관리항목은 삭제할 수 없습니다. 먼저 계정과목의 사용 설정을 해제하세요.', 409);
  end if;

  if exists (select 1 from public.finance_ledger_detail d
              where d.company_id = v_co and d.entity_id = v_en
                and case v_slot when 1 then d.dimension1 when 2 then d.dimension2
                                when 3 then d.dimension3 when 4 then d.dimension4
                                else d.dimension5 end is not null) then
    perform public.ax_raise(50425, '전표에서 사용 중인 관리항목은 삭제할 수 없습니다.', 409);
  end if;

  -- ⚠ v1.1 결함 해소 — 2단 DELETE 를 트랜잭션 없이 실행해 고아행이 남을 수 있었다.
  --   v2.0 은 함수가 원자적이고, 상세값은 FK ON DELETE CASCADE 가 처리한다.
  delete from public.finance_dimension
   where company_id = v_co and entity_id = v_en and dimension_id = p_dimension_id;
end $$;
