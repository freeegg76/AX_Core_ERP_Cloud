/*============================================================================
  ax_finance_openbalance_close 수정 — 설계서 §9.4 · §16.4

  ⚠⚠ **초기이월 확정이 전면 불능이었다.**
     `select sum(...) ... for update` 는 PostgreSQL 에서 금지된다
     ("FOR UPDATE is not allowed with aggregate functions"). 함수 본문은 생성
     시점에 계획되지 않으므로 마이그레이션은 성공했고, **실행해 봐야만** 드러난다.

     v1.1 의 `WITH (UPDLOCK, HOLDLOCK)` 는 집계 쿼리에도 붙일 수 있었다.
     MSSQL 은 잠금 힌트, PG 는 행 잠금 절이라는 차이가 직역에서 사고를 만든 지점이다.

  고침 — **잠금과 집계를 분리한다.**
     ① 대상 행을 먼저 `for update` 로 잠그고(집계 없음)
     ② 잠긴 상태에서 합계를 낸다.
     검증–확정 사이에 다른 트랜잭션이 금액을 바꾸지 못하게 막는다는 원래 의도는 그대로다.

  ⚠ 마이그레이션 파일은 추가만 한다(§16.1). 기존 파일을 고치지 않는다.
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
  v_cnt int;
begin
  perform public.ax_require_scope();
  perform public.ax_require_role(30, '초기이월 확정');       -- APPROVER

  if exists (select 1 from public.finance_closing
              where company_id = v_co and entity_id = v_en
                and company_year_id = p_company_year_id and closing) then
    perform public.ax_raise(50521, '회계마감된 연도의 초기이월은 변경할 수 없습니다.', 409);
  end if;

  -- ① 잠금만. 집계를 섞지 않는다.
  perform 1 from public.finance_open_balance
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id
     for update;

  get diagnostics v_cnt = row_count;
  if v_cnt = 0 then
    perform public.ax_raise(50442, '확정할 초기이월 데이터가 없습니다.', 409);
  end if;

  -- ② 잠긴 행에 대해 집계.
  --    C11 — 부호를 살려 더한다. 마감 자동생성분은 음수일 수 있다(§9.5).
  select coalesce(sum(amount) filter (where drcr = '1'), 0),
         coalesce(sum(amount) filter (where drcr = '2'), 0)
    into v_dr, v_cr
    from public.finance_open_balance
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;

  if v_dr <> v_cr then
    perform public.ax_raise(50441,
      '차변합계와 대변합계가 일치하지 않아 확정할 수 없습니다. 차액: '
      || to_char(v_dr - v_cr, 'FM999,999,999,990.00'));
  end if;

  perform set_config('ax.openbal_admin', '1', true);
  update public.finance_open_balance set closed = true
   where company_id = v_co and entity_id = v_en and company_year_id = p_company_year_id;
end $$;

comment on function public.ax_finance_openbalance_close(varchar) is
  '초기이월 확정 (APPROVER). 잠금과 집계를 분리한다 — FOR UPDATE 는 집계 쿼리에 붙일 수 없다(§16.4)';
