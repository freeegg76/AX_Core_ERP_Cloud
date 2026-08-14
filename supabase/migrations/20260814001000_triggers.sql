/*==============================================================================
  AX Bridge v2.0 — 10. 트리거
  설계서 §10.5

  (a) 보호 11건 — v1.1 10건 이식 + 최후 관리자 보호 신설
  (b) 채번  5건 — C5 신설. pg_advisory_xact_lock 으로 직렬화한다.
  (c) 참조검증  — FK 를 걸 수 없는 참조. 프로시저가 하던 검증을 인계한다(§9.9).

  ⚠ INSTEAD OF 3건은 BEFORE ROW 로 재설계했다 — PostgreSQL 은 뷰에만 INSTEAD OF 를
     허용한다. 차단만 하면 되고 수동 DML 재실행이 사라져 오히려 단순해진다.

  ⚠⚠ 마감연도 검사가 우회 플래그보다 **먼저**여야 한다.
      이 순서는 §9.6 마감해제의 실행 순서를 강제하는 직접적 근거이며,
      순서를 바꿔도 대부분의 테스트는 통과하므로 pgTAP 이 명시적으로 고정한다.

  ⚠ 모든 트리거 함수는 SECURITY DEFINER 다. 두 가지 이유가 있다 —
     ① 호출자 권한과 무관하게 동작해야 한다. 컬럼 GRANT 로 authenticated 에게서
        회수한 컬럼(approval_status 등)을 트리거는 읽어야 한다.
     ② 검증 조회가 RLS 로 필터되면 안 된다. 예컨대 최후 SUPER 검사는 전 테넌트를
        세어야 하는데, 호출자 권한이면 자기 회사만 보여 항상 통과해버린다.
==============================================================================*/

/*============================================================================
  공통 : 마감연도 판정 (트리거 내부용)
  RPC 의 ax_finance_check_year_open 과 달리 스코프를 인자로 받는다 —
  트리거는 NEW/OLD 의 스코프를 써야 하기 때문이다.
============================================================================*/
create or replace function public.ax_is_year_closed(
    p_company_id varchar(10), p_entity_id varchar(10), p_date date)
returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.finance_closing c
      join public.system_year y
        on y.company_id = c.company_id and y.entity_id = c.entity_id
       and y.company_year_id = c.company_year_id
     where c.company_id = p_company_id and c.entity_id = p_entity_id
       and c.closing
       and trunc(y.actual_year)::int = extract(year from p_date)::int)
$$;

create or replace function public.ax_flag(p_key text)
returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$ select coalesce(current_setting(p_key, true), '') = '1' $$;

/*============================================================================
  (a) 보호 트리거
============================================================================*/

/*--- 1. built-in admin 물리삭제 차단 (51001) — v1.1 INSTEAD OF DELETE 재설계 */
create or replace function public.trg_fn_employee_protect_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.employee_id = 'ADMIN' then
    perform public.ax_raise(51001, '기본 관리자(ADMIN) 계정은 삭제할 수 없습니다.', 409);
  end if;
  return old;   -- 그 외 행은 원래 DELETE 가 진행된다
end $$;

create trigger trg_system_employee_protect_admin
  before delete on public.system_employee
  for each row execute function public.trg_fn_employee_protect_admin();

/*--- 2. 최후 활성 SUPER 보호 (51002) — v1.1 미구현 규칙의 구현 (§6.5) */
create or replace function public.trg_fn_employee_keep_one_super()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.ax_role = 'SUPER' and old.user_yn and old.status <> 'inactive')
     and (new.ax_role <> 'SUPER' or not new.user_yn or new.status = 'inactive')
     and (select count(*) from public.system_employee
           where ax_role = 'SUPER' and user_yn and status <> 'inactive') <= 1
  then
    perform public.ax_raise(51002,
      '마지막 활성 최고관리자는 비활성화하거나 권한을 낮출 수 없습니다.', 409);
  end if;
  return new;
end $$;

create trigger trg_system_employee_keep_one_super
  before update on public.system_employee
  for each row execute function public.trg_fn_employee_keep_one_super();

/*--- 3. 수동 편집 감사 스탬프 */
create or replace function public.trg_fn_employee_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 재귀 방지 : 스탬프 자신이 바뀐 경우는 건너뛴다
  if new.last_manual_edit_at is distinct from old.last_manual_edit_at then
    return new;
  end if;
  if (new.employee_name, new.email, new.title, new.status, new.team_id, new.user_yn, new.ax_role)
     is distinct from
     (old.employee_name, old.email, old.title, old.status, old.team_id, old.user_yn, old.ax_role)
  then
    new.last_manual_edit_at := localtimestamp(0);
  end if;
  return new;
end $$;

create trigger trg_system_employee_audit
  before update on public.system_employee
  for each row execute function public.trg_fn_employee_audit();

/*--- 4. inactive 전환 시 퇴사일 자동 보완 */
create or replace function public.trg_fn_employee_inactive()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive'
     and new.departure_date is null then
    new.departure_date := current_date;
  end if;
  return new;
end $$;

create trigger trg_system_employee_inactive
  before update on public.system_employee
  for each row execute function public.trg_fn_employee_inactive();

/*--- 5. 파이프라인 일자 관리 */
create or replace function public.trg_fn_pipeline_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_date := coalesce(new.created_date, current_date);
    if new.stage in ('5','6') then new.closed_date := coalesce(new.closed_date, current_date); end if;
    return new;
  end if;

  new.adjusted_date := current_date;
  -- Closed/Canceled 진입 시 종료일 설정, 재오픈 시 해제
  if new.stage in ('5','6') and old.stage not in ('5','6') then
    new.closed_date := coalesce(new.closed_date, current_date);
  elsif new.stage not in ('5','6') and old.stage in ('5','6') then
    new.closed_date := null;
  end if;
  return new;
end $$;

create trigger trg_sales_pipeline_audit
  before insert or update on public.sales_pipeline
  for each row execute function public.trg_fn_pipeline_audit();

/*--- 6. 전표 헤더 보호 (51011 · 51012 · 51052) — v1.1 INSTEAD OF U/D 재설계 */
create or replace function public.trg_fn_ledger_head_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- ⚠⚠ ① 마감연도 검사가 ② 우회 플래그보다 **먼저**다. 순서를 바꾸면
  --      마감연도 잠금을 ax.ledger_approve 로 우회할 수 있게 된다(§10.5).
  if public.ax_is_year_closed(old.company_id, old.entity_id, old.ledger_date) then
    perform public.ax_raise(51052,
      '회계마감된 연도의 전표는 수정·삭제할 수 없습니다.', 409);
  end if;

  -- ② 정상 승인 경로는 통과 (C6 — 트랜잭션 로컬 플래그)
  if public.ax_flag('ax.ledger_approve') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- ③ 승인 전표 보호
  if old.approval_status then
    if tg_op = 'DELETE' then
      perform public.ax_raise(51011, '승인된 전표는 삭제할 수 없습니다.', 409);
    else
      perform public.ax_raise(51012, '승인된 전표는 수정할 수 없습니다.', 409);
    end if;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $$;

create trigger trg_finance_ledger_head_protect
  before update or delete on public.finance_ledger_head
  for each row execute function public.trg_fn_ledger_head_protect();

/*--- 7. 마감연도 전표 신규등록 차단 (51051) */
create or replace function public.trg_fn_ledger_head_closing_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.ax_is_year_closed(new.company_id, new.entity_id, new.ledger_date) then
    perform public.ax_raise(51051, '회계마감된 연도에는 전표를 등록할 수 없습니다.', 409);
  end if;
  return new;
end $$;

create trigger trg_finance_ledger_head_closing_lock
  before insert on public.finance_ledger_head
  for each row execute function public.trg_fn_ledger_head_closing_lock();

/*--- 8. 전표 라인 보호 (51021 · 51053) */
create or replace function public.trg_fn_ledger_detail_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row     record;
  v_approved boolean;
begin
  v_row := case tg_op when 'DELETE' then old else new end;

  -- ⚠ 헤더 CASCADE 삭제 경로 — 헤더가 이미 사라졌으면 헤더 트리거가 통과를
  --   허락한 삭제이므로 라인도 통과시킨다(§10.5 INSTEAD OF 재설계 주석).
  select h.approval_status into v_approved
    from public.finance_ledger_head h
   where h.company_id = v_row.company_id and h.entity_id = v_row.entity_id
     and h.ledger_date = v_row.ledger_date and h.ledger_no = v_row.ledger_no;
  if not found then
    return v_row;
  end if;

  -- ① 마감연도 먼저
  if public.ax_is_year_closed(v_row.company_id, v_row.entity_id, v_row.ledger_date) then
    perform public.ax_raise(51053, '회계마감된 연도의 전표 라인은 변경할 수 없습니다.', 409);
  end if;

  -- ② 승인 전표 라인 변경 차단
  if v_approved then
    perform public.ax_raise(51021, '승인된 전표의 라인은 변경할 수 없습니다.', 409);
  end if;

  return v_row;
end $$;

create trigger trg_finance_ledger_detail_protect
  before insert or update or delete on public.finance_ledger_detail
  for each row execute function public.trg_fn_ledger_detail_protect();

/*--- 9. 초기이월 보호 (51031 · 51054) */
create or replace function public.trg_fn_open_balance_protect()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_closed_year boolean;
begin
  v_row := case tg_op when 'DELETE' then old else new end;

  -- ⚠⚠ ① 마감연도 검사가 ② 우회 플래그보다 먼저다.
  --    즉 ax.openbal_admin 플래그로는 마감연도 잠금을 우회할 수 없다.
  --    이것이 §9.6 마감해제가 closing=false 를 **먼저** UPDATE 하는 근거다.
  select c.closing into v_closed_year
    from public.finance_closing c
   where c.company_id = v_row.company_id and c.entity_id = v_row.entity_id
     and c.company_year_id = v_row.company_year_id;

  if coalesce(v_closed_year, false) then
    perform public.ax_raise(51054, '회계마감된 연도의 초기이월은 변경할 수 없습니다.', 409);
  end if;

  -- ② 확정/해제 RPC 는 통과
  if public.ax_flag('ax.openbal_admin') then
    return v_row;
  end if;

  -- ③ 확정분 보호
  if tg_op = 'INSERT' then
    if new.closed then
      perform public.ax_raise(51031, '확정된 초기이월은 직접 등록할 수 없습니다.', 409);
    end if;
  elsif old.closed then
    perform public.ax_raise(51031, '확정된 초기이월은 변경할 수 없습니다.', 409);
  end if;

  return v_row;
end $$;

create trigger trg_finance_open_balance_protect
  before insert or update or delete on public.finance_open_balance
  for each row execute function public.trg_fn_open_balance_protect();

/*--- 10. GL 삭제 보호 (51041) — v1.1 INSTEAD OF DELETE 재설계 */
create or replace function public.trg_fn_gl_protect_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 표준 GL 재생성 경로는 통과
  if public.ax_flag('ax.bypass_gl_protect') then
    return old;
  end if;

  if exists (select 1 from public.finance_open_balance ob
              where ob.company_id = old.company_id and ob.entity_id = old.entity_id
                and ob.gl_id = old.gl_id)
     or exists (select 1 from public.finance_ledger_detail d
                 where d.company_id = old.company_id and d.entity_id = old.entity_id
                   and d.gl_id = old.gl_id) then
    perform public.ax_raise(51041,
      '초기이월 또는 전표에서 참조 중인 계정은 삭제할 수 없습니다. 미사용으로 전환하세요.', 409);
  end if;

  -- ⚠ v1.1 대비 보강 — contra_gl 자기참조도 검사한다.
  --   v1.1 은 이 검증이 Application 계층에만 있었다(§7.4).
  if exists (select 1 from public.finance_gl g
              where g.company_id = old.company_id and g.entity_id = old.entity_id
                and g.contra_gl = old.gl_id) then
    perform public.ax_raise(51042,
      '다른 계정의 차감계정으로 참조 중이라 삭제할 수 없습니다.', 409);
  end if;

  return old;
end $$;

create trigger trg_finance_gl_protect_delete
  before delete on public.finance_gl
  for each row execute function public.trg_fn_gl_protect_delete();

/*--- 11. 지급정책 표시식 자동 구성 — v1.1 AFTER + 재귀가드 → BEFORE (재귀 소멸) */
create or replace function public.trg_fn_term_condition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.term_condition := case new.base_rule
    when 'EOM'  then 'EOM+' || coalesce(new.offset_days, 0)::int::text
    else             'CurM' || coalesce(new.fixed_day, 0)::int::text
  end;
  return new;
end $$;

create trigger trg_partner_term_condition
  before insert or update on public.partner_term
  for each row execute function public.trg_fn_term_condition();

/*============================================================================
  (b) 채번 트리거 — C5 (§9.12)

  ⚠ 클라이언트가 보낸 값은 무조건 덮어쓴다. 검증이 아니라 무시이므로 우회 경로가 없다.
     지침 §12 "UI 에서 전표번호를 생성하지 않는다"가 구조적으로 강제된다.
============================================================================*/

/*--- 12. 전표번호 : (회사, 회사, 일자) 범위 MAX+1 */
create or replace function public.trg_fn_ledger_head_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- READ COMMITTED 에서 MAX()+1 은 잠금 없이는 반드시 경합한다.
  perform pg_advisory_xact_lock(
    hashtext('ax_ledger_no|' || new.company_id || '|' || new.entity_id
             || '|' || new.ledger_date::text));
  new.ledger_no := coalesce(
    (select max(ledger_no) from public.finance_ledger_head
      where company_id = new.company_id and entity_id = new.entity_id
        and ledger_date = new.ledger_date), 0) + 1;
  return new;
end $$;

create trigger trg_finance_ledger_head_number
  before insert on public.finance_ledger_head
  for each row execute function public.trg_fn_ledger_head_number();

/*--- 13. 관리항목 상세 라인번호 */
create or replace function public.trg_fn_dimension_detail_lineno()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(
    hashtext('ax_dim_line|' || new.company_id || '|' || new.entity_id
             || '|' || new.dimension_id));
  new.line_no := coalesce(
    (select max(line_no) from public.finance_dimension_detail
      where company_id = new.company_id and entity_id = new.entity_id
        and dimension_id = new.dimension_id), 0) + 1;
  return new;
end $$;

create trigger trg_finance_dimension_detail_lineno
  before insert on public.finance_dimension_detail
  for each row execute function public.trg_fn_dimension_detail_lineno();

/*--- 14. 액티비티 ID : 'ACT' + 타임스탬프 + 충돌 시 시퀀스 부가
         ⚠ v1.1 결함 해소 — 1/100초 해상도 + 잠금 없음이라 동시 생성 시 충돌했다. */
create or replace function public.trg_fn_activity_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_base text;
  v_try  text;
  i      int := 0;
begin
  perform pg_advisory_xact_lock(
    hashtext('ax_activity|' || new.company_id || '|' || new.entity_id
             || '|' || new.pipeline_id));

  v_base := 'ACT' || to_char(clock_timestamp(), 'YYMMDDHH24MISS');
  loop
    v_try := case when i = 0 then v_base else v_base || lpad(i::text, 2, '0') end;
    exit when not exists (
      select 1 from public.sales_pipeline_detail
       where company_id = new.company_id and entity_id = new.entity_id
         and pipeline_id = new.pipeline_id and activity_id = v_try);
    i := i + 1;
    if i > 99 then
      perform public.ax_raise(50323, '액티비티 ID 생성에 실패했습니다. 잠시 후 다시 시도하세요.', 409);
    end if;
  end loop;

  new.activity_id  := v_try;
  new.created_date := coalesce(new.created_date, current_date);
  return new;
end $$;

create trigger trg_sales_activity_id
  before insert on public.sales_pipeline_detail
  for each row execute function public.trg_fn_activity_id();

-- 15. finance_dimension.slot_no 는 ax_finance_dimension_save() 가 advisory lock 하에
--     할당한다(마이그레이션 08). PostgREST 직접 INSERT 는 정책으로 막는다(§11.2).
-- 16. finance_ledger_detail.line_on 은 ax_finance_ledger_save() 가
--     WITH ORDINALITY 로 부여한다(§9.1). 배열 순서가 곧 line_on 이다.

/*============================================================================
  (c) 참조검증 트리거 — FK 를 걸 수 없는 참조 (§9.9)
  v1.1 은 프로시저가 검사했다. 프로시저가 사라지므로 검사도 함께 사라지지 않도록 옮긴다.
============================================================================*/

/*--- 17. system_team.owner / leader_user_id (순환 의존으로 FK 불가)

  ⚠ 순환 의존을 실제로 푸는 방법 — **지연 제약 트리거(DEFERRABLE INITIALLY DEFERRED)**

  system_employee 는 team_id 가 NOT NULL 이고, system_team 은 owner/leader 가
  실재 직원이어야 한다. 어느 쪽을 먼저 넣어도 막힌다.

  v1.1 은 이 문제를 **SYSTEM 조직에만** 예외를 둬서 우회했고, 결과적으로
  **신규 회사를 만들 방법이 없었다**(usp_system_team_save 의 50131/50132 가 동일하게 막는다).
  v2.0 은 검사를 COMMIT 시점으로 미뤄서 한 트랜잭션 안에 부서+직원을 함께 넣으면
  순서와 무관하게 성립하도록 한다. 검증은 그대로 유지되면서 순환만 풀린다.
*/
create or replace function public.trg_fn_team_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 부트스트랩 예외 : SYSTEM 조직의 ADMIN 은 별도 단계(bootstrap.yml)에서 생성된다(§6.5).
  if new.company_id = 'SYSTEM' and new.entity_id = 'SYSTEM' then
    return null;
  end if;
  if not exists (select 1 from public.system_employee
                  where company_id = new.company_id and entity_id = new.entity_id
                    and employee_id = new.owner) then
    perform public.ax_raise(50131, '오너로 지정한 직원이 같은 회사에 없습니다.');
  end if;
  if not exists (select 1 from public.system_employee
                  where company_id = new.company_id and entity_id = new.entity_id
                    and employee_id = new.leader_user_id) then
    perform public.ax_raise(50132, '리더로 지정한 직원이 같은 회사에 없습니다.');
  end if;
  return null;
end $$;

create constraint trigger trg_system_team_refs
  after insert or update on public.system_team
  deferrable initially deferred
  for each row execute function public.trg_fn_team_refs();

/*--- 18. finance_gl.contra_gl 자기참조 (§7.4)

  ⚠ **지연 제약 트리거여야 한다.** contra_gl 은 같은 테이블의 다른 행을 가리키므로,
     BEFORE ROW 로 두면 벌크 적재에서 "아직 삽입되지 않은 행"을 참조해 실패한다.

     이것은 시드만의 문제가 아니다 — ax_finance_gl_generate_standard() 가
     표준 GL 355행을 한 번의 INSERT…SELECT 로 적재하며, 그중 24행이 contra_gl 을
     갖는다(대손충당금 → 외상매출금 등). BEFORE 트리거면 **표준 GL 재생성이
     항상 실패**한다. 검사를 COMMIT 시점으로 미뤄야 자기참조 집합이 완성된 뒤 검증된다.
*/
create or replace function public.trg_fn_gl_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.contra_gl is not null then
    if not exists (select 1 from public.finance_gl
                    where company_id = new.company_id and entity_id = new.entity_id
                      and gl_id = new.contra_gl and status) then
      perform public.ax_raise(50404,
        '차감 대상 계정이 같은 회사에 없거나 사용중이 아닙니다.');
    end if;
  end if;
  return null;
end $$;

create constraint trigger trg_finance_gl_refs
  after insert or update on public.finance_gl
  deferrable initially deferred
  for each row execute function public.trg_fn_gl_refs();

/*--- 19. finance_ledger_detail Layer3 참조 (FK 없는 5종 + dimension 값 범위) */
create or replace function public.trg_fn_ledger_detail_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.team_id is not null and not exists (
      select 1 from public.system_team
       where company_id = new.company_id and entity_id = new.entity_id and team_id = new.team_id) then
    perform public.ax_raise(50467, '전표 라인의 부서가 유효하지 않습니다.');
  end if;
  if new.pod_id is not null and not exists (
      select 1 from public.system_pod
       where company_id = new.company_id and entity_id = new.entity_id and pod_id = new.pod_id) then
    perform public.ax_raise(50467, '전표 라인의 Pod 가 유효하지 않습니다.');
  end if;
  if new.employee_id is not null and not exists (
      select 1 from public.system_employee
       where company_id = new.company_id and entity_id = new.entity_id and employee_id = new.employee_id) then
    perform public.ax_raise(50467, '전표 라인의 직원이 유효하지 않습니다.');
  end if;
  if new.client_id is not null and not exists (
      select 1 from public.partner_client
       where company_id = new.company_id and entity_id = new.entity_id and client_id = new.client_id) then
    perform public.ax_raise(50467, '전표 라인의 고객사가 유효하지 않습니다.');
  end if;
  if new.vendor_id is not null and not exists (
      select 1 from public.partner_vendor
       where company_id = new.company_id and entity_id = new.entity_id and vendor_id = new.vendor_id) then
    perform public.ax_raise(50467, '전표 라인의 거래처가 유효하지 않습니다.');
  end if;
  return new;
end $$;

create trigger trg_finance_ledger_detail_refs
  before insert or update on public.finance_ledger_detail
  for each row execute function public.trg_fn_ledger_detail_refs();

/*--- 20. sales_pipeline.contract_id (복합 PK 불일치로 FK 불가) */
create or replace function public.trg_fn_pipeline_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.contract_id is not null and not exists (
      select 1 from public.sales_contract
       where company_id = new.company_id and entity_id = new.entity_id
         and contract_id = new.contract_id) then
    perform public.ax_raise(50313, '연결하려는 계약이 존재하지 않습니다.');
  end if;
  return new;
end $$;

create trigger trg_sales_pipeline_refs
  before insert or update on public.sales_pipeline
  for each row execute function public.trg_fn_pipeline_refs();
