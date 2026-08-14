/*==============================================================================
  AX Bridge v2.0 — 01. 확장
  설계서 §3 Database

  Supabase 는 확장을 `extensions` 스키마에 설치하는 것을 권장한다.
  public 에 설치하면 사용자 테이블과 이름이 충돌할 수 있고, search_path 를 비운
  SECURITY DEFINER 함수(§19.1 검사 4)에서 스키마를 명시해야 하므로 위치가 고정되어야 한다.
==============================================================================*/

create schema if not exists extensions;

-- gen_random_uuid() · digest() — 설계서 부록 C.3
create extension if not exists pgcrypto with schema extensions;

-- 대소문자 무시 이메일 — 설계서 §6.1
--   varchar 로 두면 Kim@x.com 과 kim@x.com 이 별개 계정이 되어
--   동일인에게 두 개의 권한 경로가 생긴다.
create extension if not exists citext with schema extensions;

-- 부분일치 검색 인덱스 — 설계서 §10.3 Lookup 팝업
create extension if not exists pg_trgm with schema extensions;

-- pgTAP 은 테스트 전용이므로 로컬·CI 에서만 설치된다(§15.1).
-- 운영 프로젝트에 올리지 않기 위해 여기서 create 하지 않는다.

grant usage on schema extensions to authenticated, anon, service_role;
