/*============================================================================
  ax_finance_ledger_preview_account_change 수정 — 설계서 §7.4 · §16.4

  ⚠⚠ **충돌이 있을 때만 터졌다.**
     `v_conflicts := v_conflicts || 'bank_id'` 에서 `'bank_id'` 는 타입 미지정
     리터럴이라 PostgreSQL 이 `anyarray || anyarray` 로 해석하고 `text[]` 로
     캐스팅을 시도한다 → `malformed array literal: "bank_id"` (SQLSTATE 22P02).

     충돌이 없으면 어느 분기도 타지 않으므로 **정상 응답이 나온다.** 즉
     "잘 도는 것처럼 보이다가 정확히 필요한 순간에만 실패"한다. UC-Ledger-04 의
     확인 대화상자가 영영 뜨지 않고, 사용자는 계정 변경 자체가 안 되는 것으로 본다.

  고침 — `array_append()` 를 쓴다. 요소 추가라는 의도가 타입으로 고정되어
     같은 실수가 재발할 수 없다.

  ⚠ 동작 계약은 그대로다 — **값을 지우지 않고 목록만 돌려준다.**
     지우는 것은 화면이 사용자 확인을 받은 뒤 할 일이다(§12.5).
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
  v_g         record;
  v_conflicts text[] := '{}';
  v_key       text;
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

  /*
    12개 분기를 손으로 늘어놓는 대신 (키, 플래그) 쌍을 순회한다.
    플래그가 꺼졌는데 값이 있으면 충돌이다. 빈 문자열도 값 없음으로 본다 —
    화면(도메인 conflictsWith)과 판정이 어긋나면 확인 대화상자가 헛돈다.
  */
  foreach v_key in array array[
    'bank_id', 'team_id', 'pod_id', 'employee_id', 'client_id', 'vendor_id',
    'dimension1', 'dimension2', 'dimension3', 'dimension4', 'dimension5', 'due_date'
  ] loop
    if not (case v_key
              when 'bank_id'     then v_g.bank_id
              when 'team_id'     then v_g.team_id
              when 'pod_id'      then v_g.pod_id
              when 'employee_id' then v_g.employee_id
              when 'client_id'   then v_g.client_id
              when 'vendor_id'   then v_g.vendor_id
              when 'dimension1'  then v_g.dimension1
              when 'dimension2'  then v_g.dimension2
              when 'dimension3'  then v_g.dimension3
              when 'dimension4'  then v_g.dimension4
              when 'dimension5'  then v_g.dimension5
              when 'due_date'    then v_g.due_date
            end)
       and coalesce(p_line ->> v_key, '') <> ''
    then
      v_conflicts := array_append(v_conflicts, v_key);   -- ⚠ `|| 'literal'` 금지
    end if;
  end loop;

  return jsonb_build_object(
    'gl_id',     p_new_gl_id,
    'conflicts', to_jsonb(v_conflicts),   -- 비어 있지 않으면 화면이 사용자 확인을 받는다
    'flags',     jsonb_build_object(
        'bank_id', v_g.bank_id, 'team_id', v_g.team_id, 'pod_id', v_g.pod_id,
        'employee_id', v_g.employee_id, 'client_id', v_g.client_id, 'vendor_id', v_g.vendor_id,
        'dimension1', v_g.dimension1, 'dimension2', v_g.dimension2, 'dimension3', v_g.dimension3,
        'dimension4', v_g.dimension4, 'dimension5', v_g.dimension5, 'due_date', v_g.due_date));
end $$;

comment on function public.ax_finance_ledger_preview_account_change(varchar, jsonb) is
  '계정 변경 미리보기. ⚠ 값을 지우지 않고 충돌 목록만 돌려준다 — 폐기는 화면이 확인을 받은 뒤(§7.4)';
