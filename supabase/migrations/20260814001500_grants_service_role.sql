/*==============================================================================
  AX Bridge v2.0 — 15. service_role 권한 명시
  설계서 §18.4 · §19.2

  마이그레이션 12 는 anon/authenticated 만 다뤘고, service_role 은 플랫폼 기본값에
  맡겨 두었다. 그러나 실제로는 DML 권한이 부여되지 않아
  부트스트랩(§6.5)이 "permission denied for table system_employee" 로 실패한다.

  **플랫폼 기본값에 의존하지 않고 명시한다.** 부트스트랩은 시스템을 처음 사용 가능한
  상태로 만드는 유일한 경로이므로, 조용히 깨지면 복구 수단이 없다.

  ⚠ service_role 은 BYPASSRLS 다. 이 키를 쓰는 곳은 딱 둘뿐이다 —
     ① bootstrap.yml (초기 관리자)  ② scripts/dev-seed-auth.mjs (로컬 개발)
     프론트엔드에는 절대 들어가지 않으며 CI 의 grep 가드가 강제한다(§19.2).

  ⚠ 기존 마이그레이션(12)을 고치지 않고 새 파일로 추가한다 — §16.1 의
     "마이그레이션은 추가만 한다" 규칙을 스스로 지킨다.
==============================================================================*/

grant usage on schema public to service_role;

grant select, insert, update, delete
   on all tables in schema public
   to service_role;

grant usage, select on all sequences in schema public to service_role;

-- 이후 추가될 테이블에도 동일하게 적용한다.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

/*----------------------------------------------------------------------------
  ⚠ RLS 는 별개다. service_role 은 BYPASSRLS 속성을 가지므로 정책을 우회한다.
     즉 이 GRANT 는 "정책을 뚫는" 것이 아니라 "테이블에 접근할 수 있게" 하는 것이다.
     정책 우회는 롤 속성에서 이미 성립한다 — 그래서 이 키의 사용처를 둘로 못박는다.
----------------------------------------------------------------------------*/
