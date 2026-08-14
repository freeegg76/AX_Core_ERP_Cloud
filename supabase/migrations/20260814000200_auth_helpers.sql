/*==============================================================================
  AX Bridge v2.0 — 02. 인증·오류 헬퍼
  설계서 §5.1(클레임 헬퍼) · §6.2(Access Token Hook) · 부록 B(오류코드)

  ⚠ 이 파일의 모든 함수는 `set search_path = ''` 를 갖는다.
     없으면 사용자가 만든 스키마를 검색경로에 끼워 넣어 함수 이름을 가로챌 수 있다.
     §19.1 의 CI 검사 4번이 이를 강제한다.

  ⚠ 식별자 대소문자 — 원본 MSSQL DDL 은 `Team_id` · `employee_Id` · `DRCR` 처럼
     대소문자가 섞여 있다. PostgreSQL 은 따옴표 없는 식별자를 소문자로 접으므로
     v2.0 은 **전부 소문자로 정규화**한다. 이로써 설계서 §9.1 이 경고한
     "JSON 키 한 글자가 어긋나면 값이 조용히 NULL 이 된다"는 위험 종류가 소멸한다.
==============================================================================*/

/*------------------------------------------------------------------ 오류 발생 */
-- 설계서 부록 B.1 — SQLSTATE 는 HTTP 상태 제어에 쓰고, AX 코드는 hint 에 싣는다.
--   PostgREST 는 SQLSTATE 가 'PT' 로 시작하면 뒤 3자리를 HTTP 상태로 해석한다.
--   T-SQL 의 `THROW 50464, N'…', 1` 이 `ax_raise(50464, '…')` 와 1:1 대응한다.
create or replace function public.ax_raise(
    p_code int,
    p_msg  text,
    p_http int default 400
) returns void
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  raise exception using
    errcode = 'PT' || lpad(p_http::text, 3, '0'),
    message = p_msg,
    hint    = 'AX-' || p_code::text;
end $$;

comment on function public.ax_raise(int, text, int) is
  '업무 오류 발생. SQLSTATE=PT<http> 로 상태를 제어하고 hint 에 AX-<코드> 를 실어 보낸다. 설계서 부록 B.1';

/*----------------------------------------------------------- 안전한 정수 변환 */
-- 설계서 부록 C.2 #3 — T-SQL TRY_CONVERT(int, x) 대응물.
--   `x::int` 로 직역하면 비숫자 값에서 예외가 나 마감 전체가 실패한다.
create or replace function public.ax_safe_int(p_text text)
returns int
  language sql
  immutable
  set search_path = ''
as $$ select case when p_text ~ '^-?\d+$' then p_text::int end $$;

/*---------------------------------------------------------- 카드번호 마스킹 */
-- 설계서 §9.10 · §19.3 — 뒤 4자리만 노출한다.
create or replace function public.ax_mask_card(p_card text)
returns text
  language sql
  immutable
  set search_path = ''
as $$
  select case
           when p_card is null then null
           when length(p_card) <= 4 then repeat('*', length(p_card))
           else repeat('*', length(p_card) - 4) || right(p_card, 4)
         end
$$;

/*------------------------------------------------------- LIKE 이스케이프 */
-- 설계서 §10.4 — v1.1 의 모든 _list 프로시저가 ESCAPE 없이 LIKE 를 써서
--   사용자가 입력한 % · _ 가 와일드카드로 동작했다. 프론트(lib/query.ts)가
--   1차 방어하지만, RPC 내부 검색에도 동일 규칙이 필요하다.
create or replace function public.ax_escape_like(p_text text)
returns text
  language sql
  immutable
  set search_path = ''
as $$ select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') $$;

/*============================================================================
  JWT 클레임 헬퍼 — 설계서 §5.1

  STABLE 이므로 플래너가 질의당 1회만 평가하고 인덱스 조건으로 밀어넣을 수 있다.
  ⚠ 클레임이 없거나 잘못된 토큰이면 NULL / 0 을 반환한다 → 모든 정책이 거부된다.
     기본값이 "거부" 여야 한다. 반대로 짰다가는 토큰 파싱 실패가 전권 부여가 된다.
============================================================================*/

create or replace function public.auth_claims()
returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  select coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb,
           '{}'::jsonb)
$$;

create or replace function public.auth_company_id()
returns varchar(10)
  language sql
  stable
  set search_path = ''
as $$ select nullif(public.auth_claims() ->> 'company_id', '')::varchar(10) $$;

create or replace function public.auth_entity_id()
returns varchar(10)
  language sql
  stable
  set search_path = ''
as $$ select nullif(public.auth_claims() ->> 'entity_id', '')::varchar(10) $$;

create or replace function public.auth_employee_id()
returns varchar(10)
  language sql
  stable
  set search_path = ''
as $$ select nullif(public.auth_claims() ->> 'employee_id', '')::varchar(10) $$;

-- 역할을 서열 정수로 — 정책에서 부등호 비교가 가능해진다.
-- 설계서 §6.4 : VIEWER 10 < EDITOR 20 < APPROVER 30 < ADMIN 40 < SUPER 50
create or replace function public.auth_role_rank()
returns int
  language sql
  stable
  set search_path = ''
as $$
  select case public.auth_claims() ->> 'ax_role'
           when 'SUPER'    then 50
           when 'ADMIN'    then 40
           when 'APPROVER' then 30
           when 'EDITOR'   then 20
           when 'VIEWER'   then 10
           else 0
         end
$$;

-- ⚠ system_employee 를 참조하는 헬퍼(auth_role_rank_live · ax_require_role)와
--   Access Token Hook 은 테이블 생성 이후여야 하므로 20260814000650 에 있다.
--   `language sql` 함수는 생성 시점에 본문이 검증되므로 여기 둘 수 없다.
