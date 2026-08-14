# AX Bridge Cloud

SYSTEM / PARTNER / SALES / FINANCE 4개 도메인 ERP·CRM 업무 시스템의 **클라우드 웹서비스** 구현.

설계 정본은 [`AX_Bridge_시스템_설계서.md`](AX_Bridge_시스템_설계서.md) v2.0 이다.

```
React SPA (Vercel)
   │ supabase-js + JWT
   ▼
Supabase
 ├ PostgREST      조회 — 테이블·뷰 자동 REST
 ├ RPC 함수       쓰기 — 업무 트랜잭션 20건 (pl/pgsql)
 ├ RLS            테넌트·역할 강제 (정책 78건)
 └ Auth (GoTrue)  이메일 로그인 + Custom Access Token Hook
```

**애플리케이션 서버가 없다.** 규칙의 강제 권위는 DB 에 있고, 프론트엔드는 같은 규칙을
사용자 경험을 위해 미리 표현할 뿐이다(설계서 §2.3).

---

## 현재 상태 — Phase 0 완료

| 구성요소 | 수량 | 비고 |
| --- | --- | --- |
| 마이그레이션 | 16개 | `supabase/migrations/` — DDL 정본(C8) |
| 업무 테이블 | 21종 | MSSQL `01`+`08`+`09` 최종 상태를 폴딩 |
| 조회 뷰 | 12개 | 전부 `security_invoker = on` |
| RPC 함수 | 20건 | 프로시저 75건의 선별 포팅(C4) |
| 트리거 | 20개 | 보호 11 · 채번 5 · 참조검증 4 |
| RLS 정책 | 78건 | 전 테이블 `force row level security` |
| 표준 GL seed | 355행 | |

**Phase 1(공통 기반)도 완료**했다.

| 구성요소 | 내용 |
| --- | --- |
| `packages/shared-constants` | status 극성(§10.6) · 코드값 사전 · 오류 사전 |
| `apps/web/src/lib` | supabase · errors 어댑터 · query(Range 페이징·escapeLike) · rpc 20건 래퍼 · session |
| `apps/web/src/shared/ui` | AppToolbar · HeadDetailLayout · LookupPopup · DirtyFormGuard · ConfirmDialog · StatusBadge · SearchBar |
| 화면 | 로그인 · 앱 셸 · 고객사(참조 구현) |
| 테스트 | Vitest 40건 (status 극성 31 · 오류 어댑터 9) |

도메인 화면(Phase 2~6)은 미착수다. 로드맵은 설계서 §16 참조.

---

## 로컬 개발

### 사전 준비물

| 항목 | 버전 |
| --- | --- |
| Docker Desktop | 실행 중이어야 한다 |
| Node.js | 20 이상 |
| pnpm | 9 이상 |

### 기동

```bash
pnpm install
pnpm db:start          # Supabase 로컬 스택 + 개발 계정 시드
cp apps/web/.env.example apps/web/.env
pnpm dev               # http://localhost:5173
```

`db:start` 는 마이그레이션 · `seed.sql`(업무 데이터) · `dev-seed-auth.mjs`(로그인 계정)를
차례로 적용한다. 비밀번호는 모두 `axbridge-dev` 다.

| 계정 | 스코프 | 역할 |
| --- | --- | --- |
| `demo-admin@axbridge.local` | DEMO/D1 | ADMIN ← **업무 데이터는 이 계정으로** |
| `demo-approver@axbridge.local` | DEMO/D1 | APPROVER |
| `demo-editor@axbridge.local` | DEMO/D1 | EDITOR |
| `admin@axbridge.local` | SYSTEM/SYSTEM | SUPER |

> ⚠ `admin` 으로 로그인하면 고객사·계정과목이 **0건**으로 보인다. 고장이 아니라
> **1인 1회사 고정**(C3)이 의도대로 작동하는 것이다 — SYSTEM 조직에는 업무 데이터가 없다.

> ⚠ **로컬에서도 `auth.users` 를 SQL 로 직접 INSERT 하지 않는다.** GoTrue 가 토큰 컬럼을
> NOT NULL string 으로 스캔해 NULL 인 행은 로그인 시 500 이 난다. 설계서 §6.5 가 경고한
> 그대로이며, 그래서 로컬 계정도 Admin API(`dev-seed-auth.mjs`)를 경유한다.

### 주요 명령

```bash
pnpm db:reset          # 마이그레이션 전량 재적용 + seed — 베이스라인 재현 검증
pnpm db:types          # database.types.ts 생성 (수기 편집 금지)
pnpm test              # Vitest 40건
pnpm typecheck         # 전 패키지 tsc --noEmit
pnpm build             # 프로덕션 빌드
```

---

## 검증

`pnpm db:reset` 후 두 가지가 통과해야 한다.

**보안 회귀** — `scripts/check-security.sql` (설계서 §19.1)

RLS 적용 · FORCE RLS · 필수 정책 완비 · anon 실행함수 0 · `search_path` 고정 ·
**전 뷰 `security_invoker`** · `SELECT *` 없음 · 카드번호 원문 차단 · 특권 컬럼 UPDATE 차단 ·
테이블 21종 · seed 355행.

> 5번(`security_invoker`)이 v2.0 최대의 사고 경로다. PostgreSQL 뷰의 기본값은 `off` 이고,
> 그 경우 뷰가 소유자 권한으로 실행되어 **RLS 를 통째로 우회**한다.

**기능 스모크** — `supabase/tests/smoke.sql`

① 채번(일자별 리셋) ② 테넌트 격리 + `WITH CHECK` ③ 컬럼 GRANT ④ RPC 역할검사
⑤ 전표 저장·Layer3 검증 ⑥ 승인·라인보호 ⑦ **마감→해제 왕복** ⑧ 카드 마스킹 ⑨ 최후 관리자 보호.

> RLS 테스트는 거짓으로 통과하기 쉽다. 픽스처가 비어 있으면 "0건 조회"가 격리를 증명하지
> 않고, `postgres` 롤로 실행되면 RLS 자체가 적용되지 않는다. 그래서 스모크는 상단에
> **존재 증명과 롤 확인(메타 테스트)** 을 의무화한다(설계서 §15.3).

---

## 디렉터리

```
supabase/
├─ config.toml          로컬 스택 + Auth Hook 등록 (버전관리 대상)
├─ migrations/          ★ DDL 정본. 추가만 하고 기존 파일은 수정하지 않는다(§16.1)
├─ tests/smoke.sql      기능 스모크
└─ seed.sql             로컬 전용. 운영에는 적용되지 않는다
scripts/
├─ check-security.sql   보안 회귀 (CI 가 실행)
├─ bootstrap-admin.mjs  초기 관리자 (운영)
└─ dev-seed-auth.mjs    로컬 개발 계정
apps/web/                React SPA
├─ src/lib/             supabase · errors · query · rpc · session · database.types
├─ src/shared/ui/       공통 컴포넌트 7종
├─ src/features/        도메인 화면
└─ src/app/             셸 · 라우터 · 가드
packages/shared-constants/ status 극성 · 코드값 · 오류 사전
.github/workflows/
├─ ci.yml               PR: 재현·보안·기능·드리프트·시크릿·마이그레이션 불변성
├─ deploy-db.yml        main: db push → config push → 프론트 승격
└─ bootstrap.yml        수동: 초기 관리자 생성
Planning_Docs/          MSSQL 원본 산출물 — 읽기 전용 이식 소스 (git 제외)
```

---

## 배포 (설계서 §18)

| 환경 | Supabase | 프론트 |
| --- | --- | --- |
| local | CLI(Docker) | `pnpm --filter web dev` |
| staging | 별도 프로젝트 | Vercel Preview |
| production | 프로덕션 프로젝트 | Vercel Production |

`main` 병합 시 `deploy-db.yml` 이 `supabase db push` → `config push` 순으로 적용한 뒤
**성공했을 때만** Vercel deploy hook 으로 프론트를 승격한다. 프론트가 먼저 뜨면
아직 없는 RPC 를 호출하기 때문이다(배포 스큐, §18.3).

> ⚠ **롤백이 없다.** `supabase db push` 에는 down 마이그레이션 관행이 없고, 복구 경로는
> ① 전진 수정 마이그레이션 ② PITR 뿐이다. 그래서 CI 의 전체 재현 검증이 사실상의
> 롤백 대비이며, 파괴적 변경은 `production` 환경 수동 승인을 거친다.

### 시크릿

| 위치 | 값 |
| --- | --- |
| Vercel | `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` — **이 둘뿐이다** |
| GitHub Secrets | `SUPABASE_ACCESS_TOKEN` · `SUPABASE_PROJECT_ID` · `SUPABASE_DB_PASSWORD` · `VERCEL_DEPLOY_HOOK` |
| GitHub Env `bootstrap` | `BOOTSTRAP_ADMIN_EMAIL` · `BOOTSTRAP_ADMIN_PASSWORD` · `SUPABASE_SERVICE_ROLE_KEY` |

`anon` 키는 공개 정보이며 번들에 들어가는 것이 정상이다. 보안은 키가 아니라 RLS 가 제공한다.
**`service_role` 키는 브라우저·프론트 레포 어디에도 두지 않으며**, CI 의 grep 가드가 강제한다.

---

## 이식 중 발견한 원본 결함

설계서 부록 C.4 에 더해, 구현 과정에서 실제로 확인된 것들이다.

| 결함 | 조치 |
| --- | --- |
| 부서↔직원 **순환 의존으로 신규 회사 생성 불가** — v1.1 은 SYSTEM 조직에만 예외를 뒀다 | 지연 제약 트리거(`deferrable initially deferred`)로 COMMIT 시점 검증 |
| `contra_gl` 검증이 BEFORE ROW 라 **표준 GL 재생성이 항상 실패** (355행 중 24행이 자기 테이블 참조) | 동일하게 지연 제약으로 전환 |
| 표준 GL seed `2070000 감가상각누계액` 의 `contra_gl` 이 **자기 자신**을 가리킴 (원천 xlsx 오타) | `2060000 기계장치` 로 보정 — `20260814001350_seed_gl_fix.sql` |
| `security_invoker` 뷰와 컬럼 권한 회수의 충돌 — 뷰가 마스킹 대상 컬럼을 읽지 못함 | `SECURITY DEFINER` 함수 경유 + `is_card` 저장 계산열 |
| `[auth.email].enable_signup=false` 가 **이메일 provider 자체를 끈다** — 자가가입 차단 의도였으나 로그인이 422 로 막혔다. 자가가입은 상위 `[auth].enable_signup` 소관이다 | `config.toml` 주석으로 두 스위치의 차이를 명시 |
| `service_role` 에 DML 권한이 없어 부트스트랩이 실패 — 플랫폼 기본값에 의존했다 | `20260814001500_grants_service_role.sql` 로 명시 부여 |

---

## 참고

- 설계 정본 — [`AX_Bridge_시스템_설계서.md`](AX_Bridge_시스템_설계서.md)
- 업무 요구 정본 — `AX_Bridge.xlsx` (FR 180 · UC 135), 화면기획서 4종
- 이식 소스 — `Planning_Docs/01~09_*.sql` (읽기 전용)
- 미해결 결정 6건 — 설계서 §16.3
