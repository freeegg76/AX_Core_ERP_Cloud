# AX Bridge 시스템 설계서

> **문서 목적** — SYSTEM / PARTNER / SALES / FINANCE 4개 도메인으로 구성된 내부 ERP/CRM 성격 업무 시스템 _AX Bridge_ 를 **클라우드 웹서비스**로 구현하기 위한 단일 통합 설계서.
> React + TypeScript + Vite 프론트엔드와 **Supabase**(PostgreSQL · PostgREST · Auth · Row Level Security) 백엔드 위에서 **서버리스 + DDD-lite** 로 구현하고, **GitHub + Vercel** 로 배포한다.
>
> **근거 문서**
>
> - `AX_Bridge_MSSQL_Development_Guideline.md` (개발 지침 33개 절) — **업무 규칙·명명·타입 기준은 유효**하나 MSSQL/NestJS 실행 수단 서술은 본 설계서 v2.0 이 대체한다
> - `AX_Bridge.xlsx` — 테이블 명세서 / FR(기능요구) / UC(유스케이스) — **정본, 스택 전환과 무관하게 불변**
> - `AX_Bridge_DB_API_명세서.xlsx` v3.0 — 저장 프로시저 75건 · 트리거 10건 · API 94건 (업무 로직 정본)
> - `01~09_*.sql` — MSSQL 원본 산출물. **v2.0 에서는 PostgreSQL 이식의 소스**이며 더 이상 실행 대상이 아니다
> - 화면기획서 4종 (SYSTEM / PARTNER / SALES / FINANCE v3.0)
>
> **버전 기준** — DB/API 명세 v3.0 (FINANCE 화면기획서 v3.0 = 10차 개정, 마감관리·연도이월·초기이월 bank_id 반영). Supabase 프로젝트 스키마 `public`.
>
> **설계서 버전** — **v2.0 (2026-08-14) — Supabase + GitHub 웹서비스 전환**.
> v1.1(MSSQL·NestJS·Prisma 온프레미스 설치형)을 전면 개정했다. 업무 도메인(FR 180건 · UC 135건)은 그대로 두고 **실행 모델만 교체**한다: 애플리케이션 서버가 사라지고 그 자리를 PostgREST · RLS · pl/pgsql 함수가 대신한다. 확정 설계결정은 **C1~C12**([§2.4](#24-상위-설계-결정-c1c12))다.
>
> **v1.1 대비 주요 변경** — ① 백엔드 NestJS·Prisma·node-mssql **전량 제거**(C1) ② 인증을 Supabase Auth 로 이관(C2) ③ 테넌트 격리를 애플리케이션 약속에서 **RLS 강제**로 승격(C3) ④ 저장 프로시저 75건을 **선별 포팅**(C4) ⑤ 배포·인프라·보안 장([§18](#18-배포--인프라) · [§19](#19-보안)) 신설 ⑥ MSSQL 결함수정 부록(구 부록 C)은 베이스라인 DDL 에 흡수하고 폐기.

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [아키텍처 원칙](#2-아키텍처-원칙)
3. [기술 스택](#3-기술-스택)
4. [프로젝트 구조](#4-프로젝트-구조)
5. [멀티테넌시와 RLS](#5-멀티테넌시와-rls)
6. [인증 · 권한 · 부트스트랩](#6-인증--권한--부트스트랩)
7. [도메인 모델](#7-도메인-모델)
8. [데이터 모델](#8-데이터-모델)
9. [핵심 업무 규칙](#9-핵심-업무-규칙)
10. [DB 오브젝트 ↔ 애플리케이션 계층 매핑 전략](#10-db-오브젝트--애플리케이션-계층-매핑-전략)
11. [API 설계](#11-api-설계)
12. [프론트엔드 설계](#12-프론트엔드-설계)
13. [트랜잭션 규칙](#13-트랜잭션-규칙-지침-24)
14. [요구사항 추적 매트릭스](#14-요구사항-추적-매트릭스)
15. [테스트 전략](#15-테스트-전략-지침-26)
16. [구현 로드맵](#16-구현-로드맵-지침-2730--vertical-slice)
17. [Definition of Done](#17-definition-of-done)
18. [배포 · 인프라](#18-배포--인프라)
19. [보안](#19-보안)
20. [부록 A. 코드값 사전](#부록-a-코드값-사전)
21. [부록 B. 오류코드 체계](#부록-b-오류코드-체계)
22. [부록 C. MSSQL → PostgreSQL 이식 대조표](#부록-c-mssql--postgresql-이식-대조표)

---

## 1. 시스템 개요

AX Bridge는 그룹/회사 단위로 조직·거래처·영업·회계를 통합 관리하는 내부 업무 시스템이다. 4개 도메인이 강하게 연결되어 있어 초기에는 마이크로서비스로 분리하지 않고 **모듈러 모놀리스**로 구현하되, 도메인 경계는 코드 수준에서 명확히 유지한다.

| 도메인      | 책임                           | 주요 메뉴                                                                               |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| **SYSTEM**  | 조직 기준정보 · 인증/권한 기초 | 그룹, 회사, Pod, 부서, 직원, 회사 기수, 초기 Admin                                      |
| **PARTNER** | 거래 상대 · 지급/수금 정책     | 고객사, 거래처, 지급정책(Payment Term)                                                  |
| **SALES**   | 영업 파이프라인 · 활동 · 계약  | 파이프라인, 고객 액티비티, 계약                                                         |
| **FINANCE** | 회계 기준정보 · 전표 · 마감    | 계정과목(GL), 관리항목(Dimension), 은행/카드, 초기이월, 전표(Ledger), 마감관리(Closing) |

**규모 요약** — 업무 규모(테이블·FR·UC)는 v1.1 과 동일하고, **실행 수단만 바뀐다.**

| 항목            | v1.1 (MSSQL·NestJS)                    | **v2.0 (Supabase)**                            | 근거                                                                                     |
| --------------- | -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 업무 테이블     | 20종 (+ `finance_GL_seed` = 21종)      | **21종 — 불변**                                | `01` 20 + `08` `finance_closing` 1. 명세서(xlsx)는 `finance_GL_seed` 를 다루지 않아 20종 |
| 쓰기 실행 단위  | 저장 프로시저 **75건**                 | **RPC 함수 20건** (+ PostgREST 직결 52 · 폐기 3) | 선별 포팅(C4) — [§10.2](#102-rpc-함수-계층-c4) · 처분 대조는 [부록 C.5](#c5-이식-완료-판정--프로시저-75건의-처분-대조) |
| 트리거          | 10건                                   | **16건 +** (보호 11 · 채번 5 · 참조검증 대상별) | 프로시저가 하던 검증을 인계 — [§10.5](#105-트리거-db-계층-최후-방어선)                   |
| API             | REST 엔드포인트 **94건**               | **PostgREST 자동 리소스 + RPC 20건**            | API 는 설계 대상이 아니라 스키마의 파생물 — [§11](#11-api-설계)                          |
| 접근 제어       | 애플리케이션 `CompanyScope` + Role 가드 | **RLS 정책 약 80건 + 컬럼 GRANT**              | DB 강제(C3) — [§5](#5-멀티테넌시와-rls)                                                  |
| FR              | **180건**                              | **180건 — 불변**                               | COMMON 7 · SYSTEM 55 · PARTNER 24 · SALES 25 · FINANCE 69 (마감해제 `FR-Close-12` 포함)  |
| UC              | **135건**                              | **135건 — 불변**                               | 20개 접두어. 최다 UC-Ledger 13건                                                         |

> **단일통화 전제** — `partner_client`/`partner_vendor` 에 `default_billing_currency varchar(10)` 컬럼이 있으나 이를 사용하는 FR은 **0건**이고, `finance_ledger_detail`·`sales_contract` 에 통화 컬럼이 없다. 따라서 **다통화·환산은 본 설계 범위 외**로 하고 모든 금액을 단일 통화(원화)로 취급한다. 해당 컬럼은 거래처 참고 속성으로만 보존한다.

**도메인 간 의존 방향** (하위 → 상위 참조):

```
SYSTEM  (company / entity / pod / team / employee / year)
   ▲              ▲                    ▲
PARTNER        SALES               FINANCE
(client/vendor) (pipeline/         (GL·dimension·bank·
   ▲            activity/contract)  open_balance·ledger·closing)
   └──────────── FINANCE 전표 라인이 PARTNER/SALES/SYSTEM 코드를 참조
```

FINANCE 전표(`finance_ledger_detail`)는 SYSTEM(Team/Pod/직원), PARTNER(고객사/거래처), FINANCE(계정/은행·카드/관리항목)를 모두 참조하는 최말단 트랜잭션 데이터다.

---

## 2. 아키텍처 원칙

### 2.1 계층 의존성

애플리케이션 서버가 없으므로 Clean Architecture 의 4계층은 **브라우저와 DB 두 곳에 나뉘어 배치**된다. 계층 이름과 의존 방향은 유지되지만, Infrastructure 는 이제 ORM 이 아니라 `supabase-js` + PostgREST 이고, Domain 규칙은 **양쪽에 각각 표현**된다([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)).

```
[ 브라우저 — apps/web ]
Presentation   (React 화면 / 폼 / 그리드)
      ↓
Application    (feature 훅 · TanStack Query · Command/Query 조합)
      ↓
Domain         (domain/ — 순수 TS Entity · VO · Enum · Policy. 프레임워크 비의존)
      ↓
Infrastructure (lib/ — supabase-js · PostgREST 질의 · RPC 래퍼 · 오류 어댑터)
      │
      │  HTTPS + JWT
      ▼
[ Supabase — supabase/ ]
Gateway        (PostgREST — 테이블·뷰 자동 REST, RPC 라우팅)
      ↓
Authorization  (RLS 정책 · 컬럼 GRANT — 테넌트·역할 강제)  ← 우회 불가
      ↓
Domain(DB)     (pl/pgsql RPC 함수 — 업무 트랜잭션 · 불변식 검증)
      ↓
Integrity      (PK/FK/CHECK/유니크 · 트리거 — 최후 방어선)
```

**불변 규칙 (v2.0 개정)**

1. `domain/` 계층은 React / supabase-js / PostgREST 어떤 것에도 의존하지 않는다. 순수 TypeScript 다.
2. React 컴포넌트에서 `supabase.from(...)` · `supabase.rpc(...)` 를 **직접** 호출하지 않는다. 반드시 `lib/` 의 질의·RPC 래퍼와 feature 훅을 거친다.
3. 업무 규칙의 **강제 권위는 DB** 다. 프론트엔드 검증은 사용자 경험을 위한 선행 안내이며, 그것만으로 규칙이 지켜졌다고 보지 않는다.
4. 저장/승인/마감/삭제 등 다단계 업무는 **RPC 함수 1건 = 트랜잭션 1건**으로 실행한다([§13](#13-트랜잭션-규칙-지침-24)).
5. 복잡한 조회는 Domain 복원 없이 Read 타입으로 반환할 수 있다(CQRS-lite).
6. 4개 도메인의 경계를 유지한다. 도메인 간 참조는 공유 식별자 또는 명시적 RPC 호출로만 한다.
7. **모든 업무 테이블에 RLS 를 켠다.** 정책이 없는 테이블은 배포하지 않는다([§19.1](#191-rls-가-유일한-권위)).
8. 공통 UI 패턴을 재사용하고 화면별 중복 구현을 금지한다.
9. FR/UC ID 를 코드·테스트에서 추적 가능하게 남긴다.
10. 임의의 범용 CRUD 프레임워크 · Generic Repository · Event Bus · Microservice 를 도입하지 않는다.
11. **`service_role` 키를 브라우저에 두지 않는다.** 프론트엔드는 `anon` 키만 사용하며, RLS 를 우회하는 경로를 애플리케이션 코드에 만들지 않는다.

### 2.2 한 줄 원칙

> **DB 테이블 중심이 아니라 업무 도메인 중심으로 설계하되, 회사 범위·승인·마감·전표번호 같은 핵심 규칙은 애플리케이션의 약속이 아니라 DB가 강제하는 사실로 만든다.**
>
> — 개발지침 §33 「한 줄 아키텍처 원칙」의 v2.0 개정

v1.1 은 "MSSQL/Prisma를 Infrastructure에 격리하고 규칙은 Domain/Application이 관리한다"였다. 서버가 사라진 v2.0 에서 그 문장을 그대로 두면 **강제 지점이 없어진다** — 브라우저 코드는 사용자가 우회할 수 있기 때문이다. 따라서 권위를 DB 로 옮긴다.

### 2.3 업무 규칙의 3중 배치 (핵심 설계 결정)

납품물에는 완결된 **저장 프로시저 75건 + 트리거 10건** 이 있고, 서버가 없어진 v2.0 에서 이 로직은 갈 곳이 필요하다. 관심사별 소유 위치를 다음과 같이 정한다.

| 관심사                                                                     | 소유 위치                                                          | 우회 가능성           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------- |
| **테넌트 격리** (`company_id`/`entity_id`)                                 | **RLS 정책** — JWT 클레임에서 읽는다                               | 불가                  |
| **역할 권한** (VIEWER/EDITOR/APPROVER/ADMIN)                               | **RLS 정책 + 컬럼 단위 `GRANT`** + RPC 내부 재검사                 | 불가                  |
| **다단계 업무 트랜잭션** (전표 저장·승인·초기이월 확정·연도마감·GL 재생성) | **RPC 함수** (`SECURITY DEFINER`, 원자적)                          | 불가 (직접 DML 차단)  |
| **구조 무결성** (PK·FK·유니크·XOR·열거값)                                  | **제약조건**                                                       | 불가                  |
| **상태 잠금** (마감연도·승인전표 보호), **채번**                           | **트리거**                                                         | 불가                  |
| **입력 안내·즉시 피드백** (차대 균형 표시, 필수값, Slot 충돌 경고)         | 프론트엔드 `domain/` (Entity·Policy)                               | 가능 — **보조 수단**  |

**핵심 전환** — v1.1 에서 규칙의 "1차 권위"는 Domain Entity 였고 프로시저는 실행 수단이었다. v2.0 에서는 **강제 권위가 DB 로 이동**하고, 프론트엔드 `domain/` 은 같은 규칙을 **사용자 경험을 위해 미리 표현**하는 역할을 맡는다. 두 곳에 규칙이 존재하므로 다음 원칙이 따라온다.

> **⚠ 규칙 이중화의 함정과 그 처리** — 같은 규칙을 TS 와 pl/pgsql 양쪽에 쓰면 둘이 갈라진다. v1.1 §15.1 이 이미 경고했던 문제다("미리보기와 저장이 갈리면 안 된다").
>
> - **계산 결과가 저장값을 결정하는 규칙**(지급일 계산, 마감 이월액, 전표번호)은 **SQL 에만 둔다.** 미리보기도 RPC 를 호출한다. 대가는 라운드트립 1회이며, 등가성 버그를 원천 제거하는 값으로 싸다.
> - **판정만 하는 규칙**(차대 균형 여부, 필수 입력, GL 플래그별 Layer-3 활성화)은 프론트에 중복 표현해도 좋다. 갈라져도 DB 가 최종 거부하므로 데이터가 오염되지 않고, 사용자는 즉시 피드백을 얻는다.
> - 어느 쪽이든 **DB 가 거부한 경우의 오류 메시지가 정본**이다. 프론트 검증은 그 메시지를 앞당겨 보여줄 뿐이다.

정상 경로가 트리거를 통과하는 방식은 v1.1 의 `SESSION_CONTEXT` 플래그에서 **트랜잭션 로컬 설정**(`set_config('ax.*', '1', true)`)으로 바뀐다. 이는 커넥션이 아니라 트랜잭션에 묶이므로, v1.1 §10.2 가 요구했던 "반드시 단일 커넥션에서 실행" 제약이 **소멸**한다(C6, [§10.5](#105-트리거-db-계층-최후-방어선)).

### 2.4 상위 설계 결정 (C1~C12)

v1.1 의 D1~D8 은 MSSQL·Prisma 전제이므로 폐기하고 다음으로 대체한다. 승계된 항목은 「구 D#」에 표기했다. 이하 각 절은 이 표를 참조한다.

| #       | 결정                              | 요지                                                                                                                                                  | 상세                                                    |
| ------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **C1**  | 실행 모델 = **Supabase 네이티브** | 조회는 PostgREST 직결, 쓰기·업무행위는 RPC. NestJS·Prisma·node-mssql 전량 제거 (구 D1 폐기)                                                            | [§10](#10-db-오브젝트--애플리케이션-계층-매핑-전략)     |
| **C2**  | 인증 = **Supabase Auth**          | `auth.users` 가 자격증명 정본. `system_employee.user_pass` 컬럼 삭제, `usp_auth_*` 3건 폐기. **이메일 로그인**                                        | [§6](#6-인증--권한--부트스트랩)                         |
| **C3**  | 테넌시 = **RLS**                  | `(company_id, entity_id)` 를 JWT 클레임에서 읽는 STABLE 헬퍼로 정책화. 애플리케이션 `CompanyScope` 는 **표시용 컨텍스트**로 격하. **1인 1회사 고정**  | [§5](#5-멀티테넌시와-rls)                               |
| **C4**  | 프로시저 **선별 포팅**            | 75건 중 진짜 업무 트랜잭션 **20건만 RPC 함수**. 나머지는 PostgREST + 뷰 + 제약 + 트리거로 대체                                                        | [§10.2](#102-rpc-함수-계층-c4)                          |
| **C5**  | 채번을 **BEFORE 트리거로 이관**   | `ledger_no`·`line_on`·`line_no`·`activity_id`·`slot_no` 를 `pg_advisory_xact_lock` 기반 트리거로 옮겨, 해당 테이블을 PostgREST 로 직접 쓸 수 있게 한다 | [§9.12](#912-식별자-자동생성-규칙)                      |
| **C6**  | 우회 플래그 = **트랜잭션 로컬**   | `SESSION_CONTEXT` 3종 → `set_config('ax.*','1',true)`. **커넥션 고정 요구·CATCH 리셋 소멸**                                                            | [§10.5](#105-트리거-db-계층-최후-방어선)                |
| **C7**  | 오류코드 **무손실 이전**          | `THROW 50xxx` → `ax_raise()` 헬퍼. SQLSTATE `PT4xx` 로 HTTP 상태를 제어하고 **AX 코드는 `hint` 에 실어** 브라우저까지 보존                            | [부록 B](#부록-b-오류코드-체계)                         |
| **C8**  | DDL 정본 = **마이그레이션**       | `01`+`08`+`09` 를 폴딩한 베이스라인을 `supabase/migrations/` 에 둔다. Prisma·`db/` 이중관리 폐기 (구 D3 대체)                                          | [§16.1](#161-마이그레이션-정책-c8)                      |
| **C9**  | 페이징 = **PostgREST Range**      | `.range(from,to)` + `count:'exact'`. "82개 프로시저에 페이징 0건" 문제 자연 소멸 (구 D2 대체)                                                          | [§10.3](#103-조회-경로와-페이징-c9)                     |
| **C10** | 정수형 컬럼 타입 **DB 유지**      | `numeric(10,2)` 유지, 경계에서 `number` 정규화 (구 D6 승계)                                                                                            | [§8.1](#81-데이터-타입-기준-지침-8-9)                   |
| **C11** | 마감 이월 **음수 허용**           | `amount >= 0` CHECK 미추가 (구 D7 승계)                                                                                                               | [§9.5](#95-연도-회계마감-이월-계산-fr-close-0510)       |
| **C12** | **연도 회계마감 해제** 유지       | `ax_finance_closing_reopen()` RPC + ADMIN 전용 (구 D4 승계)                                                                                            | [§9.6](#96-연도-회계마감-해제-c12)                      |

> **구 D5·D8 의 처분** — D5(09_fix 범위 = 버그+무결성만)는 `09` 라는 파일이 사라졌으므로 소멸한다. 다만 그 결론인 "**단순 열거형 8종은 CHECK 대신 Domain Enum + 함수 검증에 위임**"은 유지한다. D8(`approved_date` 만 정밀도 상향)은 [§8.1](#81-데이터-타입-기준-지침-8-9) 의 타입 기준표에 흡수했다 — `timestamptz(0)`.

---

## 3. 기술 스택

### Frontend

React · TypeScript · Vite · **Ant Design 5**(Table = Head/Detail 그리드) · TanStack Query · React Hook Form · **Zod**(스키마 검증) · Zustand · **`@supabase/supabase-js`** · Vitest · Playwright

> **⚠ v1.1 정정** — v1.1 §3 은 AG Grid 를 명시했으나 실제 구현과 개발지침은 **Ant Design Table** 이다. v2.0 은 Ant Design 으로 통일한다([§12](#12-프론트엔드-설계)).

### Backend (서버리스)

**Supabase** — **PostgREST**(테이블·뷰 자동 REST, 조회) · **pl/pgsql RPC 함수**(쓰기·업무행위) · **Row Level Security**(테넌트·권한 강제) · **Supabase Auth**(GoTrue — 이메일/비밀번호, JWT 발급·갱신)

> **C1** — 별도 애플리케이션 서버를 두지 않는다. **NestJS · Prisma · node-mssql · Passport · Argon2id · Swagger 는 전량 제거**된다. 조회는 브라우저가 PostgREST 를 직접 호출하고, 쓰기는 RPC 함수를 호출한다. 근거와 구조는 [§10](#10-db-오브젝트--애플리케이션-계층-매핑-전략) 참조.

### Database

**PostgreSQL 15+** (Supabase 관리형) · 스키마 `public` · 확장 `pgcrypto`(UUID·해시) · `pg_trgm`(부분일치 검색 인덱스) · `pgtap`(정책·함수 테스트) · 마이그레이션 정본 `supabase/migrations/`([§16.1](#161-마이그레이션-정책-c8))

### Platform / Tooling

**GitHub** `freeegg76/AX_Core_ERP_Cloud` · **GitHub Actions**(PR 검증 · main 병합 시 `supabase db push`) · **Vercel**(프론트엔드 자동배포) · **Supabase CLI**(로컬 개발 — Docker) · pnpm · ESLint · Prettier · VS Code · Claude

> **향후 확장(현 범위 밖)** — Supabase **Storage**(사업활동 첨부를 URL 문자열에서 실제 파일업로드로 격상), **Realtime**(전표 승인·마감 상태 실시간 반영), **Edge Functions**(외부연동·예약작업)는 대응 FR 이 아직 없으므로 v2.0 범위에서 제외한다. 도입 시 §18·§19 에 버킷 정책·런타임 절을 추가한다.

---

## 4. 프로젝트 구조

### 4.1 최상위 (레포 `AX_Core_ERP_Cloud`)

애플리케이션 서버가 없으므로 모노레포의 `apps/api` 가 사라지고, 그 자리를 **`supabase/` 디렉터리가 대신한다.** 이곳이 백엔드의 전부다.

```text
ax-bridge-cloud/
├─ apps/
│  └─ web/                      # React 프론트엔드 (유일한 앱)
├─ packages/
│  ├─ shared-constants/         # 코드값 사전, status 극성표, 오류코드 카탈로그
│  └─ eslint-config/
├─ supabase/                    # ★ 백엔드 전부 — DDL 정본 (C8)
│  ├─ config.toml               # 로컬 스택 설정 (Supabase CLI)
│  ├─ migrations/               # 타임스탬프 마이그레이션 (§16.1)
│  ├─ functions/                # (예약) Edge Functions — v2.0 미사용
│  ├─ tests/                    # pgTAP — RLS 정책 · RPC 함수 · 트리거 (§15)
│  └─ seed.sql                  # 로컬 개발 시드 (표준 GL 355행 + 부트스트랩)
├─ .github/workflows/           # ci.yml (PR 검증) · deploy.yml (db push)
├─ docs/spec/{system,partner,sales,finance}/ · erd/
├─ pnpm-workspace.yaml · vercel.json
├─ CLAUDE.md · README.md
```

> **`db/` 와 `prisma/` 는 존재하지 않는다** — v1.1 의 `db/01~09/*.sql` + `prisma/schema.prisma` 이중관리를 폐기하고 `supabase/migrations/` 단일 정본으로 통합했다(C8). 타입은 `supabase gen types typescript` 로 DB 에서 생성한다.
> MSSQL 원본 `01~09_*.sql` 은 이식 소스로서 `Planning_Docs/` 에 **읽기 전용 보존**한다.

### 4.2 백엔드 (`supabase/migrations`)

마이그레이션은 **역할별로 파일을 분리**한다. 실행 순서는 파일명 타임스탬프가 강제하므로 v1.1 처럼 "실행 순서를 반드시 지킨다"는 운영 규약이 필요 없다.

```text
supabase/migrations/                     ← 구현 결과와 일치 (16개)
├─ 20260814000100_extensions.sql       # pgcrypto · citext · pg_trgm
├─ 20260814000200_auth_helpers.sql     # ax_raise() · auth_company_id() · auth_role_rank() …
├─ 20260814000300_tables_system.sql    # 업무 테이블 DDL — 01+08+09 폴딩 베이스라인
├─ 20260814000400_tables_partner.sql
├─ 20260814000500_tables_sales.sql
├─ 20260814000600_tables_finance.sql
├─ 20260814000650_auth_hook.sql        # ★ Access Token Hook · auth_role_rank_live() (아래 ⚠)
├─ 20260814000700_views.sql            # 마스킹·조인 조회 뷰 (§10.3)
├─ 20260814000800_functions_finance.sql# RPC 함수 13건 (§10.2)
├─ 20260814000900_functions_misc.sql   # RPC 함수 7건
├─ 20260814001000_triggers.sql         # 채번(C5) · 보호(마감·승인) · 참조검증 (§10.5)
├─ 20260814001100_policies.sql         # RLS 정책 전량 78건 (§5)
├─ 20260814001200_grants.sql           # 컬럼 단위 GRANT (승인·마감 컬럼 차단, §5.3)
├─ 20260814001300_seed_gl.sql          # 표준 GL 355행 — 기계 변환, 수기 편집 금지
├─ 20260814001350_seed_gl_fix.sql      # ★ seed 데이터 결함 1건 보정 (아래 ⚠)
└─ 20260814001400_bootstrap.sql        # SYSTEM 조직 + ax_bootstrap_admin() (§6.5)
```

> **⚠ `000650_auth_hook.sql` 이 별도인 이유** — `auth_role_rank_live()` · `ax_access_token_hook()` 은
> `system_employee` 를 참조한다. `language sql` 함수는 **생성 시점에 본문이 검증**되므로
> 테이블보다 먼저 만들 수 없다. 순수 클레임 헬퍼(`000200`)와 테이블 의존 헬퍼를 분리한다.
>
> **⚠ `001350_seed_gl_fix.sql` 이 별도인 이유** — `001300` 은 원본에서 **기계 변환**한 산출물이라
> 수기 편집 대상이 아니다. 원천 데이터 결함(`2070000` 의 `contra_gl` 자기참조)의 보정은
> 감사 가능하도록 별도 파일로 분리한다. 근거는 파일 주석에 있다.

### 4.3 프론트엔드 (`apps/web/src`)

도메인 규칙(Entity/VO/Policy)은 서버가 사라졌으므로 **프론트엔드로 이동**한다. DB 는 같은 규칙을 제약·RLS·트리거·RPC 로 독립 강제한다([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)).

```text
app/         router/ providers/ layout/
domain/                        # ★ 신설 — 프레임워크 비의존 순수 TS (구 apps/api/src/modules/*/domain)
├─ system/  partner/  sales/  finance/
│           entities/ value-objects/ enums/ policies/
lib/
├─ supabase.ts                 # createClient(anon key) — 단일 인스턴스
├─ rpc.ts                      # RPC 함수 타입드 래퍼 (§10.2)
├─ query.ts                    # PostgREST 조회 헬퍼 — 필터·정렬·Range 페이징 (§10.3)
├─ errors.ts                   # SQLSTATE 50xxx/51xxx → AX-50xxx 어댑터 (부록 B)
└─ database.types.ts           # supabase gen types typescript 산출물 (수기 편집 금지)
features/
├─ system/  {company, entity, team, pod, employee, year}
├─ partner/ {client, vendor, term}
├─ sales/   {pipeline, activity, contract}
└─ finance/ {gl, dimension, ledger, open-balance, bank-account, closing}
shared/
├─ ui/      AppToolbar/ SearchBar/ HeadDetailLayout/ LookupPopup/
│           DirtyFormGuard/ ConfirmDialog/ StatusBadge/
├─ hooks/  constants/  utils/
```

---

## 5. 멀티테넌시와 RLS

업무 테이블은 원칙적으로 `(company_id, entity_id, …)` 복합키를 갖는다. `company_id` = 그룹, `entity_id` = 회사로 해석한다.

**v1.1 → v2.0 의 결정적 변화** — v1.1 에서 테넌트 격리는 **애플리케이션의 약속**이었다. 프로시저의 첫 두 파라미터에 서버가 올바른 값을 넣어주기로 한 것이고, 그 약속을 어기는 코드 한 줄이면 격리가 무너졌다. v2.0 에서는 **RLS 가 DB 차원에서 강제**한다(C3). 클라이언트가 어떤 값을 보내든 다른 회사의 행에는 도달할 수 없다.

> **원칙의 예외 1건 (DDL 실측)**
>
> - **`finance_GL_seed`** — 스코프 컬럼이 아예 없다. PK는 `(gl_id)` 단독이며 전 회사가 공유하는 **전역 표준 GL 원본**이다. 표준 GL 재생성 RPC 가 `company_id`/`entity_id` 를 세션 컨텍스트 값으로 치환하며 복제한다. RLS 는 **전역 읽기 허용 + 쓰기 전면 차단**(마이그레이션만 갱신)으로 건다.
>
> `finance_open_balance` 의 PK 부재(v1.1 의 예외 2건 중 하나)는 v2.0 베이스라인 DDL 에서 해소된다 — `(company_id, entity_id, company_year_id, gl_id, DRCR, bank_key, client_key, vendor_key)` 복합 PK. `*_key` 는 `GENERATED ALWAYS AS (COALESCE(x,'-')) STORED` 계산열이며 PostgreSQL 은 저장 계산열의 PK 포함을 허용한다([§8.1](#81-데이터-타입-기준-지침-8-9)).

### 5.1 클레임과 헬퍼 함수

**1인 1회사 고정**(C3) — 직원은 정확히 하나의 `(company_id, entity_id)` 에 속한다. 회사 전환 UI 는 없다. 스코프는 로그인 시점에 결정되어 JWT 에 고정 주입된다([§6.1](#61-인증-흐름)).

정책이 매번 JWT 를 파싱하지 않도록 `STABLE` 헬퍼로 감싼다. `STABLE` 이므로 플래너가 질의당 1회만 평가하고, 인덱스 조건으로 밀어넣을 수 있다.

```sql
-- 20260814000200_auth_helpers.sql
create or replace function public.auth_company_id() returns varchar(10)
  language sql stable
  set search_path = ''
as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'company_id', '')::varchar(10) $$;

create or replace function public.auth_entity_id() returns varchar(10)  -- 동일 패턴
  language sql stable set search_path = ''
as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'entity_id', '')::varchar(10) $$;

create or replace function public.auth_employee_id() returns varchar(10) -- 동일 패턴 ('employee_id')
  language sql stable set search_path = '' as $$ ... $$;

-- 역할을 서열 정수로 — 정책에서 부등호 비교가 가능해진다
create or replace function public.auth_role_rank() returns int
  language sql stable
  set search_path = ''
as $$ select case current_setting('request.jwt.claims', true)::jsonb ->> 'ax_role'
         when 'SUPER' then 50 when 'ADMIN' then 40 when 'APPROVER' then 30
         when 'EDITOR' then 20 when 'VIEWER' then 10 else 0 end $$;
```

> **⚠ `set search_path = ''`** — `SECURITY DEFINER` 함수와 정책이 참조하는 모든 함수에 필수다. 없으면 사용자가 만든 스키마를 검색경로에 끼워 넣어 함수 이름을 가로챌 수 있다. [§19.1](#191-rls-가-유일한-권위) 의 CI 검사가 이를 강제한다.
>
> **⚠ `role = 0` 의 의미** — 클레임이 없거나 잘못된 토큰이면 `auth_role_rank()` 가 `0` 을 반환하고 모든 정책이 실패한다. **기본값이 거부**여야 한다. 반대로 짰다가는 토큰 파싱 실패가 전권 부여가 된다.

### 5.2 정책 패턴

모든 업무 테이블은 동일한 3층 패턴을 따른다. **읽기는 VIEWER 이상, 쓰기는 EDITOR 이상**이 기본이고, 승인·마감처럼 상위 역할이 필요한 행위는 정책이 아니라 컬럼 GRANT + RPC 로 막는다([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법)).

```sql
-- 20260814001100_policies.sql — partner_client 예시 (모든 업무 테이블 동형)
alter table public.partner_client enable row level security;
alter table public.partner_client force row level security;   -- 소유자에게도 적용

create policy p_client_select on public.partner_client for select to authenticated
  using ( company_id = public.auth_company_id()
      and entity_id  = public.auth_entity_id()
      and public.auth_role_rank() >= 10 );

create policy p_client_insert on public.partner_client for insert to authenticated
  with check ( company_id = public.auth_company_id()
           and entity_id  = public.auth_entity_id()
           and public.auth_role_rank() >= 20 );

create policy p_client_update on public.partner_client for update to authenticated
  using      ( company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
               and public.auth_role_rank() >= 20 )
  with check ( company_id = public.auth_company_id() and entity_id = public.auth_entity_id() );
  --           ^ USING 은 "어떤 행을 고를 수 있나", WITH CHECK 는 "어떤 값으로 바꿀 수 있나".
  --             WITH CHECK 를 빠뜨리면 자기 회사 행의 company_id 를 타 회사로 바꿔 옮길 수 있다.

create policy p_client_delete on public.partner_client for delete to authenticated
  using ( company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
          and public.auth_role_rank() >= 20 );
```

특수 사례:

| 테이블 | 정책 |
| ------ | ---- |
| `finance_GL_seed` | SELECT 는 `authenticated` 전원 허용(스코프 컬럼 없음). INSERT/UPDATE/DELETE 정책 **없음** → 마이그레이션(소유자)만 갱신 |
| `system_company` · `system_entity` | 조회는 자기 그룹/회사만. **CUD 는 ADMIN(40) 이상** — 테넌트 마스터를 EDITOR 가 만지지 않게 상향한다([§11.2](#112-리소스-카탈로그) 권한표에 반영) |
| `system_employee` | 조회 시 자격증명 컬럼 없음(이미 삭제). **본인 행 UPDATE 는 VIEWER 도 일부 컬럼 허용**(연락처 등) — 컬럼 GRANT 로 구분 |
| `finance_ledger_head`/`_detail` | 정책은 위 기본형. 승인·마감 잠금은 **트리거**가 담당([§10.5](#105-트리거-db-계층-최후-방어선)) — 상태 전이 규칙은 행 단위 정책으로 표현하기 부적절하다 |

### 5.3 역할 경계 — 승인·마감을 PostgREST 로 우회할 수 없게 하는 법

RLS 정책은 **행 단위**다. "EDITOR 는 전표를 수정할 수 있지만 `approval_status` 만은 못 바꾼다"는 **컬럼 단위** 규칙이라 정책만으로는 표현되지 않는다. EDITOR 가 PostgREST 로 `PATCH /finance_ledger_head?...  {"approval_status": true}` 를 보내면 정책은 통과한다.

**3중 방어**로 막는다.

1. **컬럼 GRANT** — `authenticated` 롤에서 해당 컬럼의 UPDATE 권한을 아예 뺀다. PostgREST 는 `authenticated` 로 실행하므로 요청이 권한 오류로 거부된다.

   ```sql
   -- 20260814001200_grants.sql
   revoke update on public.finance_ledger_head from authenticated;
   grant  update (ledger_name, ledger_type, employee_Id, update_date)
       on public.finance_ledger_head to authenticated;
   -- approval_status · approver_Id · approved_date 는 부여하지 않는다 → 승인은 RPC 로만 가능
   revoke update (closed) on public.finance_open_balance from authenticated;   -- 초기이월 확정도 동일
   revoke select (card_number) on public.finance_bank_account from authenticated; -- 원문 노출 차단(§9.10)
   ```

2. **RPC 가 유일한 통로** — `ax_finance_ledger_approve()` 는 `SECURITY DEFINER` 라 GRANT 를 넘어 컬럼을 쓸 수 있고, 함수 첫머리에서 `auth_role_rank() >= 30`(APPROVER)을 재검사한다.

3. **트리거** — 어떤 경로로든 승인 전표가 수정되면 차단한다([§10.5](#105-트리거-db-계층-최후-방어선)).

> **왜 3중인가** — ①만 있으면 `SECURITY DEFINER` 함수 하나를 잘못 만들었을 때 뚫린다. ②만 있으면 GRANT 실수로 뚫린다. ③은 경로와 무관하게 상태 전이를 지킨다. 세 층이 서로 다른 실수를 잡는다.

### 5.4 필수 규칙 (지침 §7, FR-Bank-08)

- **`company_id`/`entity_id` 를 클라이언트 입력으로 신뢰하지 않는다.** RLS 가 JWT 클레임과 대조하므로 위조된 값은 0건을 반환하거나 `42501` 로 거부된다. RPC 함수는 아예 **스코프를 파라미터로 받지 않고** 헬퍼로 직접 읽는다 — 받지 않는 것이 검증하는 것보다 안전하다.
- 조회 뷰는 반드시 **`WITH (security_invoker = on)`** 으로 만든다. PostgreSQL 의 기본값은 `off` 이며, 그 경우 뷰가 **소유자 권한으로 실행되어 RLS 를 통째로 우회**한다. v2.0 은 마스킹·조인 목적으로 뷰를 11개 이상 만들므로 이것은 추상적 위험이 아니라 실질적 사고 경로다([§19.1](#191-rls-가-유일한-권위) CI 검사 항목).
- 다른 회사의 FK 를 연결하려는 시도는 **FK 자체가 복합키에 `company_id`/`entity_id` 를 포함**하므로 구조적으로 불가능하다. 스코프 컬럼이 빠진 FK 를 만들지 않는다.
- 표준 GL 재생성 등 대상 지정 기능도 대상 회사를 파라미터로 받지 않고 클레임에서 고정한다(FR-GL-11).
- **RLS 가 켜지지 않았거나 정책이 없는 테이블은 배포 불가.** CI 가 카탈로그를 조회해 차단한다([§19.1](#191-rls-가-유일한-권위)).

---

## 6. 인증 · 권한 · 부트스트랩

### 6.1 인증 흐름

인증은 **Supabase Auth(GoTrue)** 가 전담한다(C2). 자격증명은 `auth.users` 에 있고, `system_employee` 는 **업무 프로필**만 갖는다. 두 테이블은 `auth_user_id uuid` 로 1:1 연결된다.

**로그인 식별자는 이메일**이다(확정). 기존 `user_id varchar(20)` 는 화면 표시용 사번으로 잔존하되 로그인에는 쓰이지 않는다. 이로써 비밀번호 재설정 메일·매직링크·향후 소셜 로그인을 Supabase 표준 기능으로 그대로 얻는다.

```
① 로그인
   supabase.auth.signInWithPassword({ email, password })
     → GoTrue 가 auth.users 에서 bcrypt 검증
     → Custom Access Token Hook 발화 (아래 6.2)
     → JWT 발급   Access 1시간(기본) / Refresh 자동 회전
        claim = { sub(uuid), email, role:'authenticated',
                  company_id, entity_id, employee_id, user_id, ax_role }
② 갱신     supabase-js 가 만료 전 자동 refresh. 애플리케이션 코드 불필요
③ 비밀번호 변경(본인)   supabase.auth.updateUser({ password })
④ 비밀번호 재설정       supabase.auth.resetPasswordForEmail(email)   ← v1.1 에 없던 기능
⑤ 로그아웃              supabase.auth.signOut()
```

**폐기되는 것** — `usp_auth_get_credential` · `usp_auth_update_last_login` · `usp_auth_change_password` 3건, Passport/JWT 전략, Argon2id 해시 코드, Access 30분/Refresh 14일 자체 관리, `!LOCKED!<random>` 로그인 불가 해시 트릭.

**`system_employee` 스키마 변경**

| 컬럼 | v1.1 | v2.0 |
| ---- | ---- | ---- |
| `user_pass varchar(255) NOT NULL` | Argon2id 해시 | **삭제** — 자격증명은 `auth.users` 소관 |
| `email varchar(40) NULL` | 참고 속성 | **`citext NOT NULL UNIQUE`** — 로그인 식별자 (전역 유일) |
| `user_id varchar(20) NULL` | 로그인 ID (부분 유니크) | 표시용 사번. 부분 유니크 인덱스 유지 |
| `user_yn bit` | 로그인 가능 여부 | **유지** — 계정 활성 스위치. `false` 면 `auth.users.banned_until` 을 함께 설정 |
| `last_login datetime2(0)` | 프로시저가 갱신 | **뷰로 대체** — `auth.users.last_sign_in_at` 을 조회 뷰에서 노출 |
| — | — | **`auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT`** 신설 |

> **⚠ `citext`** — 이메일은 대소문자를 구분하지 않아야 한다. `varchar` 로 두면 `Kim@x.com` 과 `kim@x.com` 이 별개 계정이 되어 **동일인에게 두 개의 권한 경로**가 생긴다. `citext` 확장을 켜고 컬럼 타입을 바꾼다. 길이도 40 → 255 로 넓힌다(RFC 상한).

**비밀번호 정책 (FR-Emp-04/05, FR-Admin-03) — v2.0 개정**

- 해시 저장·검증·회전은 **전부 Supabase Auth 소관**이다. 애플리케이션은 평문 비밀번호를 저장하지도, 해시를 조회하지도 않는다. 규칙이 코드에서 사라지고 플랫폼 보장이 된다.
- 최소 길이·복잡도·유출 비밀번호 차단(HaveIBeenPwned 연동)은 Supabase 대시보드 Auth 설정으로 구성하고, 그 설정을 `supabase/config.toml` 에 커밋해 버전관리한다.
- **`user_yn=false` 계정은 로그인 불가** — `auth.users.banned_until` 을 원거리 미래로 설정한다. 직원 저장 RPC 가 두 상태를 함께 뒤집어 불일치를 막는다.
- 로그·조회화면·API 응답 어디에도 카드번호 전체값을 포함하지 않는다([§9.10](#910-은행카드-fr-bank)).

### 6.2 클레임 주입 — Custom Access Token Hook

RLS 정책 전체가 JWT 클레임에 의존하므로, **토큰 발급 시점에 스코프와 역할이 정확히 들어가야 한다.** Supabase 의 Auth Hook 이 이 일을 한다 — GoTrue 가 액세스 토큰을 만들 때마다 이 함수를 호출한다.

```sql
-- 20260814000200_auth_helpers.sql
create or replace function public.ax_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare v_claims jsonb; v_emp record;
begin
  select e.company_id, e.entity_id, e."employee_Id" as employee_id, e.user_id, e.ax_role
    into v_emp
    from public.system_employee e
   where e.auth_user_id = (event ->> 'user_id')::uuid
     and e.user_yn = true
     and e.status <> 'inactive';

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_emp is null then
    -- 프로필이 없거나 비활성 → 권한 클레임을 넣지 않는다.
    -- auth_role_rank() 가 0 을 반환하므로 모든 정책이 거부된다 (기본값=거부).
    return jsonb_set(event, '{claims}', v_claims);
  end if;

  v_claims := v_claims || jsonb_build_object(
    'company_id',  v_emp.company_id,  'entity_id',   v_emp.entity_id,
    'employee_id', v_emp.employee_id, 'user_id',     v_emp.user_id,
    'ax_role',     v_emp.ax_role);

  return jsonb_set(event, '{claims}', v_claims);
end $$;

grant execute on function public.ax_access_token_hook to supabase_auth_admin;
revoke execute on function public.ax_access_token_hook from authenticated, anon, public;
```

`supabase/config.toml` 에 훅을 등록하고, `supabase config push` 로 배포한다([§18.3](#183-cicd)).

> **⚠ 클레임 지연(staleness)** — 권한을 강등해도 **이미 발급된 액세스 토큰은 만료까지 유효**하다(기본 1시간). 3단으로 대응한다.
>
> 1. 액세스 토큰 수명을 **15분**으로 줄인다(`config.toml`). 갱신은 supabase-js 가 자동 처리하므로 사용자 체감은 없다.
> 2. 즉시 차단이 필요한 강등(퇴사·계정정지)은 `auth.users.banned_until` 설정 + **세션 무효화**를 함께 수행한다 — 리프레시가 실패하며 다음 갱신에서 끊긴다.
> 3. **되돌릴 수 없는 행위**(승인·마감·GL 재생성)를 수행하는 RPC 는 클레임을 믿지 않고 `system_employee` 를 **직접 재조회**해 역할을 확인한다. 조회 비용보다 오발 비용이 크다.
>
> 그럼에도 최대 15분의 잔여 특권 창은 남는다. 이는 JWT 기반 인증의 구조적 성질이며, 위 3번이 가장 중요한 실질 방어다.

### 6.3 역할(Role) 저장 위치

v1.1 에서 역할은 **DB 에 존재하지 않고** 애플리케이션 상수에만 있었다. RLS 가 역할을 읽어야 하므로 v2.0 은 이를 DB 로 내린다.

- `system_employee.ax_role varchar(10) NOT NULL DEFAULT 'VIEWER'`
  `CHECK (ax_role IN ('VIEWER','EDITOR','APPROVER','ADMIN','SUPER'))`
- 별도 권한 테이블은 만들지 않는다. 역할은 **단일 서열**이며 조합되지 않는다([§6.4](#64-권한role-계층-fr-ui-07)).
- `ax_role` 컬럼의 UPDATE 권한은 `authenticated` 에서 회수하고, ADMIN 전용 RPC `ax_system_employee_set_role()` 로만 변경한다. **자기 자신의 역할은 올릴 수 없다**(권한 상승 방지).

### 6.4 권한(Role) 계층 (FR-UI-07)

```
VIEWER (조회) < EDITOR (등록/수정/삭제) < APPROVER (전표 승인·초기이월 확정)
             < ADMIN < SUPER (admin)
   10             20                        30                    40      50
        ↑ auth_role_rank() 가 반환하는 서열값. 정책은 부등호로 비교한다 (§5.1)
```

**ADMIN 전용 행위 5종** — "마감해제"라는 한 단어에 **성질이 다른 두 기능**이 섞여 있어 다음과 같이 분리한다.

| 행위                                                   | RPC 함수                                                                                | 강제 지점                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **초기이월 확정해제** (`open_balance.closed` → false)  | `ax_finance_openbalance_reopen()`                                                       | 함수 내 역할 재조회 + `closed` 컬럼 GRANT 회수 |
| **연도 회계마감 해제** (`finance_closing.closing` → false) | `ax_finance_closing_reopen()` — **C12**, [§9.6](#96-연도-회계마감-해제-c12)          | 동일                                          |
| 연도 회계마감 실행                                     | `ax_finance_closing_execute()`                                                          | 동일                                          |
| 표준 GL 재생성                                         | `ax_finance_gl_generate_standard()`                                                     | 동일 + `ax.bypass_gl_protect` 플래그          |
| 비밀번호 초기화 · 직원 삭제 · 역할 변경                | Supabase Admin API(Edge Function) · `ax_system_employee_delete()` · `ax_system_employee_set_role()` | 동일                                 |

- 조회전용 사용자의 편집 시도는 **RLS 가 거부**한다 — PostgREST 는 `42501` 을 HTTP 403 으로 돌려준다(FR-UI-02·FR-UI-07).
- **계층 밖 3건** — 로그인·토큰갱신은 GoTrue 엔드포인트(공개), 비밀번호 변경은 **로그인 사용자 본인**(Role 무관). 셋 다 애플리케이션 API 가 아니다.
- 리소스별 최소 권한은 [§11.2](#112-리소스-카탈로그) 표에 명시.

> **⚠ v1.1 권한 분포에서 바뀌는 것 1건** — v1.1 은 `system_company`·`system_entity` 의 CUD 를 EDITOR 로 두었다(실측 분포 EDITOR 53건에 포함). 그러나 이는 **테넌트 자체를 정의하는 마스터**이고, RLS 의 스코프 기준이 되는 행이다. EDITOR 가 회사를 지우거나 코드를 바꾸면 그 회사의 전 데이터가 고아가 된다. v2.0 은 이 10건을 **ADMIN 으로 상향**한다. 최종 분포는 [§11.2](#112-리소스-카탈로그) 참조.

### 6.5 초기 Admin 부트스트랩 (FR-Admin-01~06)

`system_employee` 는 그룹/회사/Team 이 NOT NULL 이므로 조직 마스터와 인증 사이에 **순환 의존**이 발생한다. 게다가 v2.0 에서는 `auth.users` 행도 함께 있어야 한다. 순서를 다음과 같이 고정한다.

```
① 마이그레이션 20260814001400_bootstrap.sql
     SYSTEM 조직 4행 삽입 (company · entity · pod · team)
     ─ 전부 WHERE NOT EXISTS 가드 (멱등)
     ─ system_team 을 직원보다 먼저 넣을 수 있다: owner/leader 에 FK 가 없다
②  GitHub Actions `bootstrap.yml`  (수동 실행 · environment 승인 필요)
     Supabase Admin API 로 auth.users 생성
       email = ${BOOTSTRAP_ADMIN_EMAIL}, password = ${BOOTSTRAP_ADMIN_PASSWORD}
       email_confirm = true
     → 반환된 uuid 로 system_employee 삽입
       employee_Id='ADMIN', ax_role='SUPER', user_yn=true, auth_user_id=<uuid>
```

> **왜 마이그레이션에서 `auth.users` 를 직접 INSERT 하지 않는가** — GoTrue 의 비밀번호 해시 형식·`identities` 테이블 연결·이메일 확인 상태는 내부 구현이며 버전에 따라 바뀐다. SQL 로 직접 넣은 계정은 조용히 로그인 불가가 되거나, 나중에 GoTrue 업그레이드에서 깨진다. **반드시 Admin API 를 경유**한다.
>
> 초기 비밀번호는 **시드에 하드코딩하지 않는다.** `BOOTSTRAP_ADMIN_PASSWORD` 를 GitHub Environment 시크릿으로 주입하고, 최초 로그인 시 변경을 강제한다. v1.1 의 `{ARGON2ID_HASH_OF_admin__SET_BY_INSTALLER}` 치환자 방식은 폐기한다.

**built-in admin 보호 (2중)**

- **물리 삭제 차단** — `trg_system_employee_protect_admin` 이 `employee_Id='ADMIN'` 행의 DELETE 를 거부한다(`51001`). v1.1 의 INSTEAD OF DELETE 는 PostgreSQL 에서 **BEFORE DELETE ROW 트리거**로 재작성된다([§10.5](#105-트리거-db-계층-최후-방어선)).
- **최후 관리자 잠금 차단 — v1.1 의 ⚠ 미구현 규칙을 v2.0 에서 구현한다.** v1.1 은 "활성 최고관리자 1명 유지"를 애플리케이션 숙제로 남겨 두었고, 그 결과 `admin` 행을 `status='inactive'` 나 `user_yn=false` 로 바꾸면 **아무도 로그인할 수 없는 상태**가 만들어질 수 있었다. 서버가 사라진 v2.0 에서 이 규칙을 프론트에 두면 우회 가능하므로, **트리거로 DB 에 내린다.**

  ```sql
  create or replace function public.trg_fn_employee_keep_one_super() returns trigger
  language plpgsql security definer set search_path = '' as $$
  begin
    if (old.ax_role = 'SUPER' and old.user_yn and old.status <> 'inactive')
       and (new.ax_role <> 'SUPER' or not new.user_yn or new.status = 'inactive')
       and (select count(*) from public.system_employee
             where ax_role = 'SUPER' and user_yn and status <> 'inactive') <= 1
    then
      perform public.ax_raise(51002, '마지막 활성 최고관리자는 비활성화하거나 권한을 낮출 수 없습니다.');
    end if;
    return new;
  end $$;
  ```

  `51002` 는 신규 오류코드다([부록 B](#부록-b-오류코드-체계)).

**시드 값** (`20260814001400_bootstrap.sql`, 전부 `WHERE NOT EXISTS` 가드)

| 테이블            | 값                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `system_company`  | `SYSTEM` / `System` / `시스템` / status `false`(활성 — [부록 A](#부록-a-코드값-사전) 극성 주의)                |
| `system_entity`   | `SYSTEM`·`SYSTEM` / `System` / `시스템` / status `false`                                                       |
| `system_pod`      | `SYS` / `System Pod`                                                                                           |
| `system_team`     | `SYS` / `System` / owner=`ADMIN` · leader=`ADMIN` ← **직원 행보다 먼저 삽입**(owner/leader에 FK가 없어서 가능) |
| `system_employee` | `ADMIN` / `Built-in Admin` / status `active` / `user_yn=true` / `ax_role='SUPER'` / `email`·`auth_user_id` 는 ② 단계에서 채움 |

---

## 7. 도메인 모델

각 도메인의 Aggregate·Entity·Value Object·Policy를 정의한다. 상태 코드는 DB 코드값(`true`/`false`, 문자열)을 그대로 노출하지 않고 Enum으로 변환하며(지침 §16), 변환은 Mapper가 담당한다.

> **v2.0 에서 이 계층은 브라우저에 있다** — 서버가 사라졌으므로 `domain/` 은 `apps/web/src/domain/` 으로 이동한다([§4.3](#43-프론트엔드-appswebsrc)). 프레임워크 비의존 순수 TypeScript 라는 성질은 그대로다. **역할도 바뀐다** — v1.1 에서 이 계층은 규칙의 1차 권위였으나, v2.0 에서는 **DB 가 강제하는 규칙을 사용자에게 미리 표현**하는 역할이다([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)). 아래 정의 자체는 v1.1 과 동일하다.

### 7.1 SYSTEM

```text
Company (그룹)
Entity (회사)  ── Company
Pod            ── Entity
Team (부서)    ── Entity, Pod, (owner/leader: Employee)
Employee       ── Team ; UserAccount(내포) 로 인증정보 분리
FiscalYear (회사 기수) ── Entity
```

**인증 관련 분리 (지침 §5)** — `EmployeeService` 하나에 몰아넣지 않고 다음으로 분리:
`Employee` · `UserAccount` · `Role` · `Permission` · `AuthenticationService` · `PasswordHasher`.

Employee 재직상태(Enum):

```typescript
enum EmploymentStatus {
  Planned,
  Probation,
  Active,
  OnLeave,
  LeavingSoon,
  Inactive,
}
```

- `Inactive` 는 인증 차단(FR-Emp-07). Inactive 전환 시 퇴사일 미입력이면 트리거가 당일로 보완.

### 7.2 PARTNER

```text
Client (고객사)  ── Entity, PaymentTerm(collecting_type)
Vendor (거래처)  ── Entity, PaymentTerm(payment_type)
PaymentTerm (지급/수금정책)
```

**지급정책은 단순 값이 아니라 전략(Strategy)으로 모델링한다 (지침 §5).**

```typescript
export interface PaymentTermStrategy {
  calculate(baseDate: Date): Date; // 기준일 → 지급/입금일
}
// EOM+N  : 기준월 말일 + offset_days
export class EomPaymentTermStrategy implements PaymentTermStrategy {
  /* base_rule='EOM' */
}
// CurM DD: 기준월 DD일 (월말 초과 시 월말 보정)
export class CurrentMonthPaymentTermStrategy implements PaymentTermStrategy {
  /* base_rule='CURM' */
}
```

- 표시용 정책식 `term_condition` 은 트리거 `trg_partner_term_condition` 이 `EOM+{offset_days}` / `CurM{fixed_day}` 로 자동 구성한다(FR-Term-05).
- 정책 변경은 **변경 이후 신규 계산분에만** 적용하고 이미 확정된 지급일을 자동 재계산하지 않는다(FR-Term-07).

### 7.3 SALES

```text
Pipeline (파이프라인)  ── Entity, Employee(담당자), Client(client_name 문자열), Contract(연결)
  └─ Activity[] (sales_pipeline_detail)
Contract (계약)        ── Entity, Client, Pipeline(선택), Ledger(선택 연결)
```

**Stage 전환은 단순 속성 대입을 금지한다 (지침 §5).**

```typescript
// 금지: pipeline.stage = '5';
// 권장: 의미 있는 메서드 — 내부에서 날짜/검증/상태를 함께 처리
pipeline.moveToMeeting();
pipeline.moveToNegotiation();
pipeline.close(); // stage=Closed(5) → closed_date 기록
pipeline.cancel(); // stage=Canceled(6) → closed_date 기록
pipeline.reopen(); // closed_date 해제
```

Stage(Enum): `Lead(0) · QualifiedLead(1) · Suggest(2) · Meeting(3) · Nego(4) · Closed(5) · Canceled(6)` (FR-Pipe-07).

- 수정 시 `adjusted_date`, Closed/Canceled 진입 시 `closed_date` 를 트리거 `trg_sales_pipeline_audit` 가 관리. 재오픈 시 트리거가 `closed_date` 를 NULL로 해제한다.
- 계약 연결 시 파이프라인 `client_name` 과 계약 고객사명 일치 검증(FR-Pipe-08).
- **위 메서드는 Domain 표현일 뿐 별도 RPC 가 아니다.** stage 전환은 모두 `sales_pipeline` 의 일반 PATCH 로 수행되고, `adjusted_date`/`closed_date` 는 트리거가 관리한다([§11.3](#113-업무-행위-지침-23) 참조).

**Activity 첨부 (FR-Act-06)** — `attached` 는 **파일 업로드가 아니라 URL/링크 문자열 필드**(`varchar(250)`)다. 업로드·스토리지 요구는 FR에 없다.

- `Activity` VO 로 링크 형식을 검증한다: 스킴 허용목록(`http`/`https`), 길이 250자 이내, 공백 문자 불허. 검증 실패 시 저장 거부.
- `activity_id` 는 BEFORE INSERT 트리거가 자동 채번한다(C5) — [§9.12](#912-식별자-자동생성-규칙) 참조.

### 7.4 FINANCE

FINANCE는 CRUD 중심으로 설계하지 않는다. 특히 **전표는 Head/Detail 테이블을 그대로 노출하지 않고 하나의 Aggregate(Ledger)로 다룬다** (지침 §17).

```text
GL (계정과목)            ── Entity ; Layer3 사용플래그 12종 내포
Dimension (관리항목)     ── Entity ; Slot 1~5 영속 매핑 ; DimensionValue[]
BankAccount (은행/카드)  ── Entity ; 계좌 XOR 카드
OpenBalance (초기이월)   ── FiscalYear ; GL/은행·카드/고객사/거래처 조합
Ledger (전표) [Aggregate Root]
  ├─ LedgerId (company_id, entity_id, ledger_date, ledger_no)
  ├─ ApprovalStatus
  └─ LedgerLine[]
       ├─ LineNo / Account(GL) / DebitCredit / Money(amount)
       └─ Layer3: bank/team/pod/employee/client/vendor/dimension1~5/due_date
Closing (연도 회계마감)  ── FiscalYear
```

**전표 Aggregate 권장 폴더 (지침 §5 — FINANCE 도메인 구성):**

```text
finance/ledger/domain/
├─ entities/       ledger.ts · ledger-line.ts
├─ value-objects/  money.ts · ledger-number.ts · debit-credit.ts
├─ policies/       ledger-approval.policy.ts · ledger-balance.policy.ts · ledger-delete.policy.ts
└─ repositories/   ledger.repository.ts
```

Enum 예:

```typescript
enum ApprovalStatus {
  Pending = "PENDING",
  Approved = "APPROVED",
} // DB bit 0/1
enum DebitCredit {
  Debit = "1",
  Credit = "2",
}
type DimensionSlot = 1 | 2 | 3 | 4 | 5;
```

Entity가 현재 상태에서 허용되지 않는 행위를 거부한다:

```typescript
ledger.approve(approverId);   // 미승인 + 라인 존재 + 차대균형일 때만
ledger.changeLine(...);       // 승인/마감연도면 거부
ledger.deleteLine(...);
ledger.changeLineAccount(lineNo, newGl);  // ↓ Layer3 재검증을 내부에서 수행
```

**Layer3 값 재검증 (UC-Ledger-04 예외 — 필수 규칙)**
라인의 `gl_id` 를 변경하면 새 계정의 플래그 12종이 이전 계정과 달라질 수 있다. 플래그가 `true→false` 로 바뀐 항목의 기존 값을 그대로 남기면 RPC 검증(50464~50466)에서 저장이 거부된다. 따라서:

```typescript
// Ledger Aggregate 내부
changeLineAccount(lineNo: LineNo, newGl: GlFlags): Layer3Diff {
  const line = this.lineOf(lineNo);
  const invalid = line.valuesNotAllowedBy(newGl);   // 플래그 N이 된 항목의 잔존값
  return { invalid };            // 화면이 사용자 확인을 받은 뒤 clear() 호출
}
```

- 화면은 `invalid` 가 비어 있지 않으면 **사용자 확인 후 해당 값을 초기화**한다(무단 폐기 금지). 서버측 판정은 RPC `ax_finance_ledger_preview_account_change` 가 담당한다([§11.4](#114-대표-rpc-매핑-발췌)).
- Slot 필드는 플래그뿐 아니라 **해당 Slot의 `finance_dimension_detail` 상세값 범위**도 함께 재검증한다.
- 프론트엔드 동작은 [§12.5](#125-도메인별-화면-구조) 전표 행 참조.

**GL 자기참조(`contra_gl`) 검증 규칙**
`finance_GL.contra_gl` 은 동일 회사 계정을 가리키는 **자기참조 컬럼**이다(차감계정, 예: 대손충당금 → 외상매출금). DDL에 자기참조 FK가 없다.

- `gl_detail = '1'`(차감항목)일 때만 입력한다.
- **자기 자신을 지정할 수 없다** (`contra_gl <> gl_id`).
- 동일 회사(`company_id`+`entity_id`) 범위의 **사용중 계정만** 선택 가능.
- **삭제 시 `contra_gl` 참조도 검증 대상에 포함한다** — 어떤 계정이 다른 계정의 `contra_gl` 로 참조되고 있으면 삭제를 차단하고 미사용 전환을 안내한다.

> **⚠ v2.0 에서 강제 지점이 바뀐다** — v1.1 은 이 4개 규칙 전부를 Domain/Application 검증에만 의존했고, `trg_finance_gl_protect_delete` 는 `finance_open_balance`/`finance_ledger_detail` 참조만 검사했다. **v2.0 은 PostgREST 로 `finance_GL` 을 직접 쓸 수 있으므로 애플리케이션 검증만으로는 우회된다.** 따라서 위 4건을 **BEFORE INSERT/UPDATE 트리거와 `trg_finance_gl_protect_delete` 확장으로 DB 에 내린다**([§9.9](#99-참조-무결성과-soft-disabledelete-지침-20) "FK 가 없는 참조 4종").

---

## 8. 데이터 모델

### 8.1 데이터 타입 기준 (지침 §8, §9)

타입 기준을 **PostgreSQL 로 이관**한다. 의미는 v1.1 과 동일하고 표기만 바뀐다.

| 종류                               | v1.1 (T-SQL)          | **v2.0 (PostgreSQL)**             | 예                                                           |
| ---------------------------------- | --------------------- | --------------------------------- | ------------------------------------------------------------ |
| 업무 코드(영문/숫자)               | `VARCHAR(10~20)`      | `varchar(10~20)`                  | company_id, gl_id, client_id                                 |
| 사용자 표시 문자열(한글/이름/설명) | `NVARCHAR(50~1000)`   | **`text`** 또는 `varchar(n)`      | company_name_ko, gl_name, note                               |
| 대소문자 무시 식별자               | —                     | **`citext`**                      | `system_employee.email` ([§6.1](#61-인증-흐름))              |
| Boolean                            | `BIT`                 | **`boolean`**                     | status, approval_status, closed, user_yn                     |
| 금액                               | `NUMERIC(18,2)`       | `numeric(18,2)` — **float 금지**  | amount, contract_amount                                      |
| 날짜(업무일자)                     | `DATE`                | `date`                            | ledger_date, due_date, start_date, insert_date, closing_date |
| 일시(감사)                         | `DATETIME2(0)`        | **`timestamptz(0)`**              | last_manual_edit_at, **approved_date**                       |
| 인증 연결                          | —                     | **`uuid`**                        | `system_employee.auth_user_id` → `auth.users(id)`            |
| 계산 컬럼                          | `AS … PERSISTED`      | **`GENERATED ALWAYS AS (…) STORED`** | `bank_key`/`client_key`/`vendor_key`                       |
| JSON 파라미터                      | `NVARCHAR(MAX)`       | **`jsonb`**                       | RPC 의 `p_lines`, `p_rows`                                   |

> **⚠ `nvarchar` → `text`** — PostgreSQL 은 `text` 가 기본 유니코드이므로 `nvarchar`/`varchar` 구분이 사라진다. v1.1 §10.4 가 경고한 "`NVARCHAR`/`VARCHAR` 암시적 형변환으로 인한 인덱스 미사용" 문제도 함께 소멸한다. 다만 **업무 코드 컬럼은 `varchar(n)` 길이 제약을 유지**한다 — FK 대상과 길이가 일치해야 하고, 명세서상 코드 체계를 강제하기 때문이다.
>
> **⚠ `timestamptz` 선택** — `timestamp` 가 아니라 **`timestamptz`** 를 쓴다. 웹서비스는 브라우저 타임존이 서버와 다를 수 있고, `timestamp` 는 그 정보를 버려 "승인 시각이 9시간 어긋나는" 사고를 만든다. v1.1 은 단일 설치 전제라 문제되지 않았지만 v2.0 에서는 문제가 된다. DB 세션 타임존은 UTC 로 고정하고 표시 시점에 변환한다.

**명세 vs 지침 vs DDL 의 3중 편차** — 상충 시 **DDL 이 정본**이다. 테이블 명세서(xlsx) 값으로 되돌리지 말 것.

| 항목             | 지침 §8·§9·§11                           | 테이블 명세서(xlsx) | **DDL (정본)**      | 본 설계서                                                                                                                                        |
| ---------------- | ---------------------------------------- | ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| PK 전략          | 기술 PK(`uuid`) + 업무 UNIQUE            | 복합 업무 PK        | **복합 업무 PK**    | DDL 채택. RLS 정책·FK·RPC 시그니처가 전부 이 키에 의존. 향후 **신규** 테이블은 지침 전략 우선 검토                                               |
| 한글 표시 문자열 | `NVARCHAR`                               | `varchar`           | **`nvarchar`**      | **`text`** 로 이관 (구분 자체가 소멸)                                                                                                            |
| 금액             | `DECIMAL(19,2)`                          | `numeric(10,2)`     | **`numeric(18,2)`** | DDL 채택. xlsx의 `(10,2)` 는 최대 99,999,999.99 로 원화 업무에 부족 — **DDL이 이미 18로 상향**했다                                               |
| `ledger_no`      | `INT`                                    | `numeric(10,2)`     | **`numeric(10,2)`** | **C10** — DB 유지, 경계에서 변환 (아래)                                                                                                          |

> **C10 · 정수형 Decimal 정책** — `ledger_no`·`line_on`·`line_no`·`company_year`·`actual_year` 는 정수 의미인데 `numeric(10,2)` 로 선언되어 있다. PK/FK/유니크 인덱스와 RPC 시그니처가 전부 이 타입에 묶여 있으므로 **DB 타입은 변경하지 않는다.** 대신:
>
> - **PostgREST 는 `numeric` 을 JSON 숫자로 직렬화**하므로 v1.1 의 Prisma `Decimal` → 문자열 문제는 발생하지 않는다. 다만 큰 값에서 정밀도 손실 가능성이 있어 `database.types.ts` 는 이를 `number` 로 타이핑한다.
> - **Mapper 경계에서 정수로 정규화**하고, 소수부가 있는 값을 만나면 예외를 던진다(데이터 오염 탐지). Domain VO(`LedgerNumber`, `LineNo`)가 이 검사를 소유한다.
>
> **구 D8 · 감사 일시 정밀도 (v2.0 흡수)** — `finance_ledger_head.insert_date`/`update_date` 와 `closed_date`·`closing_date` 는 **업무일자이므로 `date` 를 유지**한다. **승인 시각은 감사 대상 행위**이므로 `approved_date` 만 `timestamptz(0)` 으로 상향한다. 초 단위 행위 이력은 `ax_audit_log`([§19.4](#194-감사-로깅))가 담당한다.

> **CHECK 제약과 열거형 (구 D5 결론 승계)** — DDL 에 CHECK 는 `CK_ld_drcr`/`CK_ob_drcr`(DRCR), `CK_emp_status`(재직상태 6종), `CK_term_rule`+`CK_term_shape`(EOM/CURM 정합), `CK_dim_slot`(1~5), `CK_ct_dates`+`CK_ct_ledger`(계약)만 있고, `gl_type(0~10)`·`gl_detail`·`pipeline_type(0~4)`·`stage(0~6)`·activity `type(0~3)`·`contract_type(0~5)`·contract `status(0~2)`·`ledger_type(0~3)` 8종은 프로시저 검증에만 의존했다.
>
> **v2.0 에서는 이 8종에 CHECK 를 추가한다.** 이유가 바뀌었다 — v1.1 에서는 프로시저가 유일한 쓰기 경로여서 검증이 보장되었지만, v2.0 은 **PostgREST 로 테이블에 직접 INSERT 할 수 있으므로 검증 주체가 사라진다.** CHECK 가 없으면 `stage: 99` 인 파이프라인이 저장된다. 프론트 Enum 은 보조 수단일 뿐이다([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)).
>
> [§17 DoD](#17-definition-of-done) 의 "DB Constraint 이중 방어" 항목은 이제 **무결성 제약 + 열거형 CHECK 양쪽**을 뜻한다.

**베이스라인에 반영 완료된 v1.1 부록 C 항목** — v1.1 은 원본 SQL 의 결함을 `09_AX_Bridge_Fix.sql` 로 분리 관리했다. v2.0 은 이식 과정에서 **베이스라인 DDL 에 직접 반영**하므로 별도 수정 스크립트가 없다(C8). 반영된 5건:

| 항목 | v1.1 상태 | v2.0 베이스라인 |
| ---- | --------- | --------------- |
| `finance_open_balance` PK 부재(힙) | `09` 에서 PK 추가 | `(company_id, entity_id, company_year_id, gl_id, DRCR, bank_key, client_key, vendor_key)` 복합 PK **내장** |
| `finance_bank_account` 계좌/카드 XOR | `01` 의 `CK_bank_shape` 가 "둘 다 NULL"을 허용하는 결함 → `09` 에서 `CK_bank_one` 로 교체 | **`CK_bank_one`(정확히 하나만 NOT NULL)** 내장 |
| 관리항목 값 중복 | `09` 에서 `UX_dim_value` 부분 유니크 추가 | **부분 유니크 인덱스 내장** |
| 마감 이월 출처 구분 | `09` 에서 `source` 컬럼 + CHECK 추가 | **`source varchar(10) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','CLOSING'))`** 내장 |
| `approved_date` 정밀도 | `09` 에서 `datetime2(0)` 상향 | **`timestamptz(0)`** 내장 |
| `partner_client.collecting_type` FK 길이 불일치 | `01` 을 직접 수정(배포 차단 결함) | **`varchar(10)`** — FK 대상과 일치 |

이식 시 **MSSQL 원본을 그대로 옮기지 않고 위 최종 상태를 옮긴다.** 원본 `01~09` 의 중첩 관계(`08` 이 `05`/`06` 을 덮어쓰고, `09` 가 다시 일부를 덮어씀)를 재현하지 않는다 — 최종 상태만이 정본이다([부록 C](#부록-c-mssql--postgresql-이식-대조표)).

### 8.2 SYSTEM 테이블

| 테이블            | PK                              | 주요 컬럼                                                            | 비고                                                          |
| ----------------- | ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `system_company`  | (company_id)                    | company_name, company_name_ko, status                                | 그룹. status 0:사용 1:미사용                                  |
| `system_entity`   | (company_id, entity_id)         | 회사명, 대표자, 사업자/법인번호, 주소, 설립일…                       | FK→company                                                    |
| `system_pod`      | (company_id, entity_id, pod_id) | pod_name, status                                                     | pod_id varchar(4)                                             |
| `system_team`     | (…, Team_id)                    | team_name(\_ko), owner, leader_user_id, pod_id                       | owner/leader = employee (순환참조로 FK 미적용 → **트리거 검증**) |
| `system_employee` | (…, employee_Id)                | 인사정보, status(CHECK 6종), user_yn, user_id, **email**, **auth_user_id**, **ax_role** | ⚠ **v2.0 변경** — `user_pass`·`last_login` 삭제, `email citext NOT NULL UNIQUE`(로그인 ID)·`auth_user_id uuid UNIQUE →auth.users`·`ax_role`(CHECK 5종) 신설. `user_id` 는 표시용 사번, 전역 UNIQUE(WHERE NOT NULL) 유지 ([§6.1](#61-인증-흐름)) |
| `system_year`     | (…, company_year_id)            | company_year, actual_year                                            | UNIQUE(…, actual_year, company_year)                          |

### 8.3 PARTNER 테이블

| 테이블           | PK             | 주요 컬럼                                                           | 제약                                                      |
| ---------------- | -------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| `partner_term`   | (…, term_id)   | base_rule(EOM/CURM), fixed_day, offset_days, term_condition, status | CHECK: EOM→fixed_day NULL, CURM→fixed_day 1~31 & offset=0 |
| `partner_client` | (…, client_id) | client_name, collecting_type(→term), 사업자·은행·연락정보           | FK→entity, term                                           |
| `partner_vendor` | (…, vendor_id) | vendor_name, payment_type(→term), 상동                              | FK→entity, term                                           |

status: 1=Y(active/사용), 0=N(pending).

### 8.4 SALES 테이블

| 테이블                  | PK                              | 주요 컬럼                                                                                                               | 비고                                                    |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `sales_pipeline`        | (…, pipeline_id)                | pipeline_type(0~4), client_name, stage(0~6), employee_Id, created/adjusted/closed_date, contract_id                     | FK→entity, employee                                     |
| `sales_pipeline_detail` | (…, pipeline_id, activity_id)   | type(0~3), content, incharge, attached                                                                                  | 액티비티                                                |
| `sales_contract`        | (…, contract_id, contract_type) | client_id, pipeline_id, start/end_date, status(0~2), contract_amount, **ledger_date/ledger_no(NULL 허용)**, closed_date | CHECK: start≤end; ledger_date/no 둘 다 NULL or 둘 다 값 |

> **설계 결정** — `sales_contract` 의 `ledger_date/ledger_no` "PK" 원본 표기는 **선택적 전표 연결**로 해석하여 NULL 허용, PK 미포함, CHECK 제약으로 동시성 보장(FR-Contract-08). nullable 업무 FK를 PK에 포함하지 않는다는 지침 §10과 일치.

### 8.5 FINANCE 테이블

| 테이블                     | PK                                       | 주요 컬럼                                                                                                       | 비고                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `finance_GL`               | (…, gl_id)                               | gl_name, gl_type(0~10), gl_category1/2, vat_gl, gl_detail(0/1), contra_gl, status + **Layer3 플래그 12종(BIT)** | 플래그: bank_id, Team_id, pod_id, employee_Id, client_id, vendor_id, dimension1~5, due_date                                                                                                                  |
| `finance_GL_seed`          | (gl_id)                                  | 상동(스코프 없음)                                                                                               | 표준 GL 원본, 설치 시 적재·보존(FR-GL-11)                                                                                                                                                                    |
| `finance_dimension`        | (…, dimension_id)                        | dimension_name, **slot_no(1~5)**, status                                                                        | UNIQUE(…, slot_no); CHECK 1~5                                                                                                                                                                                |
| `finance_dimension_detail` | (…, dimension_id, line_no)               | dimension_value                                                                                                 | 동일 항목 내 값 중복 금지                                                                                                                                                                                    |
| `finance_bank_account`     | (…, bank_id)                             | bank_name, bank_account, card_number, status(false:사용)                                                        | `CK_bank_one` — 계좌·카드 **정확히 하나만** NOT NULL. `card_number` 는 `authenticated` SELECT 권한 회수, 뷰가 마스킹([§10.3](#103-조회-경로와-페이징-c9))                                                    |
| `finance_open_balance`     | (…, company_year_id, gl_id, DRCR, bank_key, client_key, vendor_key) | company_year_id, gl_id, DRCR(1/2), **bank_id**, client_id, vendor_id, amount, closed, **source** | NULL 을 포함한 유일성은 `GENERATED ALWAYS AS (COALESCE(col,'-')) STORED` 계산컬럼 3종으로 표현. **PostgreSQL 은 저장 계산컬럼의 PK 포함을 허용**하므로 v1.1 의 힙 상태가 해소된다 |
| `finance_ledger_head`      | (…, ledger_date, ledger_no)              | ledger_name, ledger_type(0~3), employee_Id, approver_Id, insert/update/approved_date, approval_status           | UNIQUE=PK. `employee_Id`/`approver_Id` 에 **FK 없음**(→ 트리거 검증). `insert/update_date` 는 `date`, **`approved_date` 만 `timestamptz(0)`**. `approval_status`·`approver_Id`·`approved_date` 는 UPDATE 권한 회수 |
| `finance_ledger_detail`    | (…, ledger_date, ledger_no, **line_on**) | gl_id, DRCR, amount, Layer3 실제값(bank/Team/pod/employee/client/vendor/dimension1~5/due_date)                  | FK→head(**ON DELETE CASCADE**), GL, bank **만**. Team/pod/employee/client/vendor/dimension1~5 는 **FK 없음**(→ 트리거 검증). `amount` 는 **NULL 허용** — `> 0` 검증은 RPC/Domain 전담                        |
| `finance_closing`          | (…, company_year_id)                     | closing(boolean), closing_date                                                                                  | v3.0 신설. 행 없으면 미마감 간주. **쓰기 정책 없음** — RPC 전용(아래 ⚠)                                                                                                                                      |

> **컬럼명 `line_on` vs `line_no`** — `finance_ledger_detail` 의 라인번호 컬럼은 **`line_on`**(명세서 원본의 오기로 추정되나 DDL·PK가 모두 이 이름을 쓴다), `finance_dimension_detail` 은 **`line_no`** 다. 두 이름이 공존하므로 산문·코드·타입 매핑에서 혼용하지 않는다. 프론트엔드는 각각 `lineOn` / `lineNo` 로 매핑한다.

> **⚠ `finance_closing.closing` 의 DEFAULT 는 `true`** 다. "행이 없으면 미마감" 시맨틱과 결합되어 있어, `closing` 컬럼을 생략한 bare INSERT 는 **해당 연도를 즉시 마감 처리한다.** v1.1 에서는 프로시저가 유일한 쓰기 경로라 사고가 막혔지만, **v2.0 에서는 PostgREST 로 직접 INSERT 가 가능하므로 실제 위험이 된다.** 따라서 `finance_closing` 은 `authenticated` 에게 **INSERT/UPDATE/DELETE 정책을 부여하지 않고**, RPC(`ax_finance_closing_execute`/`_reopen`)만 쓰기를 수행한다([§11.2](#112-리소스-카탈로그)).

> **`estabilish_date`** (`system_entity`) 는 DDL의 오타이나 정본이므로 그대로 사용하고, 조회 뷰에서 `establish_date` 로 별칭을 준다.

> **설계 결정 (finance_GL Layer3 플래그)** — 원본 명세에서 `bank_id`~`due_date` 를 "PK"로 표기한 것은 오기로 판단하고, **전표 Layer3 입력영역 사용여부를 제어하는 Boolean 플래그**로 구현한다(FR-GL-06). `finance_GL.bank_id=true` → 전표에서 은행/카드 선택 활성, `false` → 입력·저장 금지.

> **설계 결정 (Dimension Slot)** — 원본 테이블에 slot 컬럼이 없어 `slot_no` 를 보완 신설(FR-Dim-05). 최초 등록 순서로 사용된 적 없는 최소 Slot을 부여하고 **재정렬·재매핑하지 않는다**. `finance_GL.dimension1~5`, `finance_ledger_detail.dimension1~5` 가 Slot 1~5와 1:1 대응.

### 8.6 ERD 요지

```
company ─1:N─ entity ─1:N─┬─ pod ─1:N─ team ─1:N─ employee
                          ├─ year ─1:N─ open_balance / closing
                          ├─ (partner) term ─1:N─ client / vendor
                          ├─ (sales) pipeline ─1:N─ pipeline_detail ; contract
                          └─ (finance) GL ; dimension ─1:N─ dimension_detail ; bank_account
                                        ledger_head ─1:N─ ledger_detail
                                          └─ 참조: GL, bank, team, pod, employee, client, vendor, dimension_value
```

---

## 9. 핵심 업무 규칙

각 규칙은 **DB 가 강제**하고(제약·RLS·트리거·RPC), 프론트엔드 `domain/` 이 같은 규칙을 미리 표현해 사용자 경험을 만든다([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)). 업무 내용은 v1.1 과 **완전히 동일**하며, 실행 수단만 바뀐다.

### 9.1 전표 저장 검증 (하나의 트랜잭션, 지침 §17·§24)

전표 저장 시 다음을 **단일 업무 트랜잭션**으로 검증한다:
Head 필수값 · Line 필수값 · 계정 사용 여부 · 관리항목 활성 여부(GL 플래그) · 차변/대변 · 금액(>0) · 지급/입금일(due_date 플래그) · 은행/카드 사용 여부 · **차변 합계 = 대변 합계**(승인 시) · 승인/마감 상태에 따른 수정 제한.

- **RPC `ax_finance_ledger_save(p_head jsonb, p_lines jsonb)`** — v1.1 의 `usp_finance_ledger_head_save` + `usp_finance_ledger_detail_save` 를 **하나로 합쳤다.** 두 호출로 나뉘어 있으면 사이에 실패했을 때 라인 없는 헤더가 남아 §13 의 단일 트랜잭션 요구를 지킬 수 없기 때문이다([§11.4](#114-대표-rpc-매핑-발췌)).
- 승인은 별도 RPC `ax_finance_ledger_approve()` — 승인은 저장과 다른 시점의 다른 행위이고 요구 권한도 다르다(APPROVER).

> **⚠ `line_on` 은 매 저장마다 1부터 재부여된다 — `p_lines` 배열 순서가 의미를 갖는다.**
> 라인은 `jsonb_array_elements(p_lines) WITH ORDINALITY` 로 읽고 그 서수를 그대로 `line_on` 으로 쓴다. 즉 **기존 라인 전체 DELETE → 배열 순서대로 재INSERT** 다. 결과:
>
> - 클라이언트가 보낸 배열 순서가 곧 화면상 라인 순서이자 저장된 `line_on` 이다. **부분 저장(단일 라인 PATCH)은 불가능**하며 항상 전체 라인 집합을 보내야 한다.
> - `line_on` 을 외부에서 참조·기억하면 안 된다(저장마다 바뀔 수 있음). Layer3 편집 화면의 "선택 라인"은 `line_on` 이 아니라 클라이언트측 임시 키로 추적한다.
> - Aggregate `Ledger` 가 라인 순서를 소유하고, RPC 래퍼는 `Ledger.lines` 순서대로 직렬화한다.
>
> **v1.1 대비 개선** — v1.1 은 `IDENTITY(1,1)` 테이블 변수의 삽입 순번에 의존했고, 이는 **T-SQL 이 보장하지 않는 성질**이었다(옵티마이저가 순서를 바꿀 수 있다). `WITH ORDINALITY` 는 **JSON 배열의 위치를 명시적으로 반환**하므로 순서가 결정적이다.

> **⚠ JSON 키 이름 — 한 글자도 틀리면 값이 조용히 NULL 이 된다.** v1.1 의 `OPENJSON … WITH` 스키마는 `Team_id`·`employee_Id` 처럼 대소문자가 섞인 컬럼명을 그대로 썼고, 프론트의 `linesToJson()` 이 이를 정확히 맞춰야 했다. `jsonb_to_recordset` 도 **동일하게 대소문자를 구분**한다. 이 위험은 v2.0 에서도 그대로이므로, RPC 래퍼가 `database.types.ts` 의 생성 타입을 쓰도록 강제해 타입 검사로 잡는다.

### 9.2 전표번호 생성 (지침 §12)

**회사/일자별 순번**으로 관리한다. v2.0 에서 채번은 **BEFORE INSERT 트리거**로 이동한다(C5).

```sql
-- trg_fn_ledger_head_number() 의 핵심 (전문은 §10.5)
perform pg_advisory_xact_lock(hashtext(new.company_id||'|'||new.entity_id||'|'||new.ledger_date::text));
new.ledger_no := coalesce((select max(ledger_no) from public.finance_ledger_head
                            where company_id = new.company_id and entity_id = new.entity_id
                              and ledger_date = new.ledger_date), 0) + 1;
```

- **채번 범위는 `(company_id, entity_id, ledger_date)`** — 회사별로 **매일 1번부터 다시 시작**한다.
- **클라이언트가 보낸 값은 무조건 덮어쓴다.** 지침 §12 의 "UI 에서 전표번호를 생성하지 않는다" 금지가 이로써 구조적으로 강제된다 — 검증이 아니라 무시이므로 우회 경로가 없다.
- **동시성** — v1.1 의 `WITH (UPDLOCK, HOLDLOCK)` 에 해당하는 것이 `pg_advisory_xact_lock` 이다. PostgreSQL 의 기본 격리수준(READ COMMITTED)에서 `MAX()+1` 은 잠금 없이는 **반드시 경합**하므로, 이 잠금은 선택이 아니라 필수다. 잠금은 트랜잭션 종료 시 자동 해제된다.
- 생성된 번호는 RPC 가 `jsonb {ledger_date, ledger_no}` 로 반환한다. v1.1 의 `OUTPUT` 파라미터 바인딩 문제가 소멸한다([§10.2](#102-rpc-함수-계층-c4)).

### 9.3 승인 정책 (지침 §18)

`LedgerApprovalPolicy` / `LedgerModificationPolicy` / `LedgerDeletePolicy` 또는 Entity 메서드가 프론트엔드에서 사용자 안내를 담당하고, **강제는 DB 3층**이 한다.

- 승인 완료(`approval_status = true`) 전표는 일반 수정/삭제 불가.
- **① 컬럼 GRANT** — `approval_status`·`approver_Id`·`approved_date` 는 `authenticated` 에게 UPDATE 권한이 없다. PostgREST 로는 승인 상태를 건드릴 수 없다([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법)).
- **② RPC** — `ax_finance_ledger_approve()` 가 `SECURITY DEFINER` 로 실행하며 APPROVER 권한을 재검사한다.
- **③ 트리거** — `trg_finance_ledger_head_protect`(BEFORE U/D), `trg_finance_ledger_detail_protect`(BEFORE I/U/D)가 승인분 변경을 차단한다. 정상 승인 경로는 `current_setting('ax.ledger_approve', true) = '1'` 로 통과한다(C6).

### 9.4 초기이월 "확정"(closed) vs 연도 "회계마감"(closing) — v3.0 핵심 구분

| 개념         | 컬럼                          | 의미                                               | RPC                                                          |
| ------------ | ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| **확정**     | `finance_open_balance.closed` | 초기이월 입력 자체의 잠금(차대 균형 검증 후)       | `ax_finance_openbalance_close()`(APPROVER) / `_reopen()`(ADMIN) |
| **회계마감** | `finance_closing.closing`     | 연도 단위 회계 마감. 마감 시 차년도 이월 자동 생성 | `ax_finance_closing_execute()`(ADMIN)                        |

- 연도마감으로 자동 생성된 차년도 초기이월은 `closed = true` · `source = 'CLOSING'` 으로 저장하여 보호한다(FR-Close-08).
- 확정해제 불가 조건: ① 해당 연도 회계마감(`closing = true`) ② 연도마감 자동생성분(전년도가 회계마감된 연도의 초기이월).

**초기이월 일괄 저장(`ax_finance_openbalance_save`)의 저장 시맨틱 — 화면 동작에 직접 영향**

`p_rows jsonb`(`gl_id`, `DRCR`, `bank_id`, `client_id`, `vendor_id`, `amount`)를 `jsonb_to_recordset` 으로 읽어 처리한다.

1. **`closed = false`(미확정) 행만 DELETE** 후 재INSERT 한다. 확정 행과 연도마감 자동생성분은 손대지 않는다.
2. **`amount > 0` 행만 INSERT** 된다 — **0원 행은 조용히 소실**된다. 따라서 사용자가 기존 금액을 0으로 지우고 저장하면 그 행은 "0원으로 저장"이 아니라 **삭제**된다. 화면은 이 동작을 사용자에게 드러내야 한다(0 입력 = 행 제거).
3. `amount < 0` 은 거부(`50433`). 중복 조합 검사는 `gl_id`+`DRCR`+`bank_key`+`client_key`+`vendor_key` 5-way 로 수행되며, v2.0 에서는 이 조합이 **PK 이므로 DB 가 직접 강제**한다([§8.1](#81-데이터-타입-기준-지침-8-9)).
4. 확정(`close`) 시 차대 균형을 `SELECT … FOR UPDATE` 하에 검증하고 불일치면 차액을 담은 메시지로 거부(`50441`). **미확정 저장은 불일치를 허용**한다(FR-OpenBal-06, UC-OpenBal-04).

### 9.5 연도 회계마감 이월 계산 (FR-Close-05~10)

`ax_finance_closing_execute()` 는 1개 연도 단위로 처리한다(복수 선택 시 화면이 `actual_year` 오름차순 순차 호출). 단일 트랜잭션이며 실패 시 전체 롤백된다.

- **선행검증 6종**: 대상 기수 존재 · 재마감 불가 · 선행연도 마감 완료 · 차년도 기수 존재 · 대상연도 미승인 전표 0건 · 차년도 초기이월 미존재.
- **이월 대상**: `gl_type` 0(자산)·1(부채)·2(자본)만. 3~10(수익/원가/비용/법인세)은 제외.
- **집계 단위**: `gl_id + bank_id + client_id + vendor_id`.
- **계산**: 자산 = (전년 이월 + 당해 차변 − 당해 대변) → 차변(DRCR=1) 이월. 부채·자본 = (전년 이월 + 당해 대변 − 당해 차변) → 대변(DRCR=2) 이월. **잔액계산은 승인 전표만.** 잔액 0 조합은 미생성.
- **집계 단위에 포함되지 않는 항목**: `Team_id`·`pod_id`·`employee_Id`·`dimension1~5` 는 이월되지 않는다. 즉 부서별/관리항목별 이월 잔액은 존재하지 않으며, 차년도에는 `gl_id`+`bank_id`+`client_id`+`vendor_id` 수준으로만 승계된다.
- **구현 이식 3건** — ① 4-CTE 산출식(`gl`/`prior`/`cur`/`merged`)의 `FULL OUTER JOIN` 은 PostgreSQL 에서 동일하게 동작한다. ② `MERGE dbo.finance_closing` → **`INSERT … ON CONFLICT (company_id, entity_id, company_year_id) DO UPDATE`**(PK 가 이미 존재한다). ③ `TRY_CONVERT(int, gl_type)` 은 PostgreSQL 에 대응물이 없으므로 헬퍼 `ax_safe_int(text)` 를 만들거나 `CASE WHEN gl_type ~ '^\d+$' THEN gl_type::int END` 로 쓴다.
- 마감 완료 연도의 전표·초기이월은 조회만 가능(FR-Close-11, FR-Ledger-16). 공통 헬퍼 `ax_finance_check_year_open()` 이 전표 관련 RPC 의 **첫 문장으로** 호출되고, **트리거 4건**이 우회 DML 을 차단한다.

> **C11 · 이월 금액의 음수 허용** — 산출 잔액이 `<> 0` 인 조합만 INSERT 하며 **부호를 그대로 저장**한다. 즉 자산 계정이 대변 초과이면 `DRCR=1` 행에 **음수 금액**이 들어간다(`finance_open_balance.amount` 에 `>= 0` CHECK 가 없어 허용됨). 수기 입력 경로는 음수를 거부(`50433`)하므로 **자동생성분만의 예외**다.
>
> 이 동작을 유지하되(`amount >= 0` CHECK 를 **추가하지 않는다**), 다음을 보정한다:
>
> - **차/대변 합계 집계는 부호를 살려 계산한다** — `SUM(CASE WHEN DRCR='1' THEN amount ELSE -amount END)` 형태로 순액을 구해 차액을 판정한다. `DRCR` 별로 단순 `SUM(amount)` 만 하면 음수 행이 합계를 왜곡한다.
> - **화면은 음수 행을 명시적으로 표시**한다(색상·괄호 표기). 숨기거나 절대값으로 바꾸지 않는다.
> - Domain `Money` VO 는 초기이월 컨텍스트에서 음수를 허용하고, 전표 라인 컨텍스트에서는 `> 0` 을 강제한다(서로 다른 불변식).

### 9.6 연도 회계마감 해제 (C12)

원본 산출물에는 **회계마감을 되돌리는 경로가 없었다**(재마감 불가, 마감연도는 조회만). C12 에 따라 유지한다.

**선결 조건 — 출처 구분 컬럼**
`finance_open_balance` 에 행의 출처 구분이 없으면 해제 시 무엇을 회수해야 하는지 알 수 없다. FR-Close-09 도 _"출처 구분 컬럼이 없어 자동 덮어쓰기를 하지 않습니다"_ 라고 명시한다. **`source varchar(10) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','CLOSING'))`** 를 베이스라인 DDL 에 포함하고([§8.1](#81-데이터-타입-기준-지침-8-9)), `ax_finance_closing_execute()` 가 자동생성 행에 `'CLOSING'` 을 기록한다. 이로써 FR-Close-09 가 근거로 든 제약도 해소된다.

**`ax_finance_closing_reopen(p_company_year_id)`** — ADMIN, 단일 트랜잭션

선행검증 (오류코드 **50531~50535**):

| 코드  | 검증                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| 50531 | 대상 기수가 존재하지 않음                                                                                       |
| 50532 | 대상 연도가 마감 상태가 아님 — 해제할 것이 없음                                                                 |
| 50533 | **후행 연도가 이미 마감되어 있음** — 마감이 `actual_year` 오름차순 순차이므로 **해제는 내림차순 순차**여야 한다 |
| 50534 | 차년도 초기이월에 `source='MANUAL'` 행이 존재 — 수기 입력분 유실 방지                                           |
| 50535 | 차년도에 전표가 존재 — 이월 잔액이 이미 사용됨                                                                  |

**실행 순서**

```
① finance_closing SET closing = false, closing_date = NULL
② perform set_config('ax.openbal_admin', '1', true);
③ DELETE finance_open_balance WHERE 차년도 AND source = 'CLOSING'
   ─ 리셋 불필요: 트랜잭션 종료 시 자동 소멸 (C6)
```

**v1.1 대비 단순화 3건** — ④ 플래그 리셋 문장, CATCH 에서의 리셋 재실행, "반드시 단일 커넥션" 제약이 **전부 사라진다.** `set_config(..., true)` 가 트랜잭션 로컬이기 때문이다(C6, [§10.5](#105-트리거-db-계층-최후-방어선)).

**트리거 상호작용 — 정확한 관계**

- 회수 대상은 **차년도** 초기이월 행이다. 검증 3(50533)이 후행 연도의 미마감을 보장하므로 `trg_finance_open_balance_protect` 의 **마감연도 잠금(51054)은 애초에 발생하지 않는다.**
- 그러나 대상 행은 `closed = true` 이므로 **확정분 보호(51031)를 통과하려면 `ax.openbal_admin` 플래그가 반드시 필요하다.** 이것이 ②가 존재하는 이유다.
- ①을 먼저 두는 것은 **트리거가 현재 강제하는 제약이 아니라 의도된 순서**다. 향후 대상연도 자신의 이월까지 손대는 확장이 생기면(그 연도는 아직 마감이므로 51054 가 발동한다) 비로소 순서가 강제된다. **이 순서를 pgTAP 회귀 테스트로 고정**한다 — 순서를 바꿔도 지금은 통과하기 때문이다.
- 호출: `POST /rest/v1/rpc/ax_finance_closing_reopen` (ADMIN)
- `closing = false` 가 되면 `trg_finance_ledger_head_closing_lock`·`_head_protect`·`_detail_protect` 의 마감연도 조건이 자동으로 풀린다. **별도 트리거 추가는 불필요하다.**

> **⚠ 한계 — 해제해도 승인 전표는 여전히 편집할 수 없다 (승인취소 기능 부재)**
> 마감 해제는 *마감연도 잠금*만 푼다. 그 연도의 전표는 대부분 승인 상태인데, **원본 산출물에는 승인취소 경로가 없다** — 전체 75건 중 승인 관련은 `usp_finance_ledger_approve` 하나뿐이었고, v2.0 의 RPC 20건에도 승인취소는 없다. 따라서 해제 후에도:
>
> - `ax_finance_ledger_save()` 로 수정 시도 → **`50452`** (미승인 전표만 수정 가능)
> - PostgREST 직접 PATCH → **`51012`** (트리거)
>
> 즉 마감 해제의 실질 효과는 **① 차년도 자동생성 이월 회수 ② 해당 연도에 신규 전표 등록 가능** 두 가지이고, **기존 승인 전표의 정정은 불가능**하다. 개발지침 §14 는 Command 목록에 「승인취소」를 포함하지만 구현체가 없다.
>
> 승인 전표 정정까지 필요하면 `ax_finance_ledger_unapprove()`(APPROVER/ADMIN, `ax.ledger_approve` 플래그로 `approval_status=false`·`approver_Id`/`approved_date` NULL 복원, 마감연도 차단)를 추가 설계해야 한다. **v2.0 범위에는 포함하지 않는다** → [§16.3 미해결 이슈](#163-미해결-이슈).

### 9.7 표준 계정과목(GL) 재생성 (FR-GL-11~14)

- 대상 = **JWT 클레임의 회사로 고정**(파라미터로 받지 않는다, [§5.4](#54-필수-규칙-지침-7-fr-bank-08)).
- 전표가 1건이라도 있으면 실행 불가(승인여부·타입 무관). 화면 비활성 + 함수 내 재검증. 존재 확인은 `SELECT … FOR UPDATE` 하에 수행되어 검증–실행 사이의 전표 등록을 막는다.
- 절차(단일 트랜잭션): 전표 존재 최종확인 → 기존 GL 전체 삭제(`ax.bypass_gl_protect` 플래그로 참조보호 트리거 통과) → `finance_GL_seed` 일괄 INSERT(company/entity 만 클레임값 치환). 실패 시 전체 롤백.
- **`finance_GL_seed` 는 전역 테이블**(스코프 컬럼 없음, 355행). RLS 는 전역 읽기 허용 + 쓰기 차단이며, 갱신은 마이그레이션만 가능하다([§5.2](#52-정책-패턴)).
- **v1.1 반환값 결함 해소** — v1.1 은 `inserted_count` 를 `@@ROWCOUNT` 로 `COMMIT` **이후에** 읽어 항상 무의미한 값이었다. v2.0 은 `GET DIAGNOSTICS v_count = ROW_COUNT;` 를 INSERT **직후에** 읽는다. PostgreSQL 도 같은 함정이 있으므로(다음 문장이 값을 덮는다) 위치를 지킨다.

> **⚠ 미해결 — seed 개정 시 기존 테넌트와의 괴리** — 표준 GL 이 개정되면 새 마이그레이션이 `finance_GL_seed` 를 갱신하지만, **이미 `ax_finance_gl_generate_standard()` 를 실행한 회사의 `finance_GL` 은 옛 내용 그대로**다. 재생성은 전표가 없어야만 가능하므로 운영 중인 회사는 갱신 경로가 없다. v1.1 은 단일 설치라 문제가 드러나지 않았으나 **멀티테넌트 웹서비스에서는 실제 문제**가 된다. `seed_version` 컬럼과 재동기 절차가 필요하며 v2.0 범위 밖이다 → [§16.3 미해결 이슈](#163-미해결-이슈).

### 9.8 관리항목 Slot 보존 (지침 §19)

Slot 1~5는 과거 전표 데이터 의미를 보존해야 하므로 재정렬·재매핑·의미 변경·표시순서 불일치 금지. 회사당 최대 5개.

- Slot 부여는 **미사용 최소 번호**이며 `slot_no` 는 수정 불가. 중간 Slot 이 비어도 후속 Slot 을 당기지 않는다. 할당은 `ax_finance_dimension_save()` 가 `pg_advisory_xact_lock` 하에 수행한다(C5).
- **관리항목 상세값에 DELETE 경로가 없다** — 등록/수정만 존재한다. 개별 값 회수는 관리항목 전체 삭제(`ax_finance_dimension_delete()`)로만 가능하고, 그조차 GL 플래그나 전표 참조가 있으면 차단된다. 따라서 **오타 상세값은 수정으로 정정**하는 것이 유일한 경로다. 화면은 이를 전제로 안내한다.
- **⚠ v2.0 에서 새로 필요한 방어** — v1.1 은 DELETE 프로시저가 없다는 사실만으로 삭제가 막혔다. **v2.0 에서는 PostgREST 가 모든 테이블에 DELETE 를 자동 제공**하므로, `finance_dimension_detail` 에 **DELETE 정책을 부여하지 않아** 명시적으로 막는다([§11.2](#112-리소스-카탈로그)). "경로가 없어서 막힌다"에서 "정책이 없어서 막힌다"로 근거가 바뀐다.

### 9.9 참조 무결성과 Soft Disable/Delete (지침 §20)

참조 데이터가 있는 Master 는 물리 삭제 대신 **비활성화 우선**. 참조 중이면 삭제 차단 + 비활성 전환 안내. 비활성 데이터는 신규 선택 Popup 에서 제외하되 기존 조회/참조는 유지한다.

**강제 수단이 바뀐다** — v1.1 은 `_delete` 프로시저의 `IF EXISTS(참조) THROW; DELETE;` 2단 패턴이었고, 두 문장 사이에 참조가 생기면 고아가 남는 경합 결함이 있었다. v2.0 은 **FK `ON DELETE RESTRICT`** 로 원자적으로 강제한다. 오류는 `23503` 으로 오고 어댑터가 한글 메시지로 바꾼다([부록 B](#부록-b-오류코드-체계)).

> **⚠ FK 가 없는 참조 4종은 트리거로 내린다** — `system_team.owner`/`leader_user_id`(순환 의존), `finance_GL.contra_gl`(자기참조), `sales_pipeline.contract_id`(복합키 불일치), `finance_ledger_detail` 의 Layer-3 컬럼(`Team_id`·`pod_id`·`employee_Id`·`client_id`·`vendor_id`·`dimension1~5`). v1.1 은 이들을 프로시저가 검사했다. 프로시저가 사라지므로 **검사도 함께 사라지지 않도록 트리거로 옮긴다**([§10.2](#102-rpc-함수-계층-c4) 예외 항목).

- 적용 대상: 그룹/회사/조직, 고객사/거래처/지급정책, 계정과목, 관리항목, 은행/카드.

> **⚠ `status` 극성이 도메인별로 반대다** — 코드에서 `status` 를 직접 비교하면 안 되는 이유다.
>
> | 활성 값          | 테이블                                                                                     |
> | ---------------- | ------------------------------------------------------------------------------------------ |
> | **`status = 0`** | `system_company`, `system_entity`, `system_pod`, `system_team`, `finance_bank_account`     |
> | **`status = 1`** | `partner_term`, `partner_client`, `partner_vendor`, `finance_GL`, `finance_dimension`      |
> | 문자열           | `system_employee.status` — `varchar(20)`, `'active'`/`'inactive'` 등 6종 (`CK_emp_status`) |
>
> v1.1 은 프로시저의 `@active_only bit` 파라미터가 이 차이를 감췄다. **v2.0 은 PostgREST 가 `status` 를 그대로 브라우저에 돌려주므로 프론트엔드가 매번 정확히 기억해야 한다.** 이것이 v2.0 최대의 잔존 위험이며 별도 방어 규약을 둔다 → [§10.6](#106-status-극성--v20-최대의-잔존-위험).

### 9.10 은행/카드 (FR-Bank)

- 계좌(bank_account) XOR 카드(card_number) — 동시 입력 금지, **둘 중 하나 필수**.
  - v1.1 의 `CK_bank_shape` 는 "둘 다 NOT NULL 금지"만 표현해 **둘 다 NULL 인 행이 합법**이었고, "둘 중 하나 필수"는 프로시저 검증에만 있었다. v2.0 베이스라인은 **`CK_bank_one`**(정확히 하나만 NOT NULL)로 완전한 XOR 을 DDL 에 넣는다([§8.1](#81-데이터-타입-기준-지침-8-9)).
- 회사 내 계좌/카드번호 중복 금지. 식별키(`bank_id`) 수정 불가.
  - v1.1 은 유니크 인덱스가 없었다. v2.0 베이스라인은 **부분 유니크 인덱스 `UX_bank_account` · `UX_bank_card`** 를 포함한다.
- 카드번호는 목록/응답에서 **뒤 4자리만** 노출(마스킹).
  - **v2.0 은 마스킹을 권한으로 강제한다** — `card_number` 원문 컬럼의 SELECT 권한을 `authenticated` 에서 회수하고, 뷰 `v_finance_bank_account` 가 `mask_card(card_number)` 만 노출한다([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법)). v1.1 에서 "마스킹 누락이 가장 쉬운 사고 지점"이었던 것이 **누락하면 조회 자체가 실패**하는 구조로 바뀐다.
- `status` — **false=사용 / true=미사용**([부록 A](#부록-a-코드값-사전) 극성 주의). 전표 참조 시 삭제 불가(FK RESTRICT).

### 9.11 지급정책 계산과 전표 지급/입금일 (FR-Term-06, FR-Ledger-11)

- **EOM+N**: 기준월 말일 + `offset_days` → `(date_trunc('month', p_base) + interval '1 month - 1 day')::date + p_offset`
- **CurM DD**: 기준월 DD일, DD 가 월말 초과 시 월말로 보정 → `make_date(...)` + 월말 클램프
- 표시용 정책식 `term_condition` 은 **BEFORE 트리거**가 `EOM+{offset_days}` / `CurM{fixed_day}` 로 자동 구성한다. v1.1 은 AFTER 트리거 + `TRIGGER_NESTLEVEL()` 재귀 가드였으나, **BEFORE 로 바꾸면 `NEW.term_condition` 에 직접 대입하므로 재귀 자체가 발생하지 않는다**([§10.5](#105-트리거-db-계층-최후-방어선)).
- `ax_partner_term_calc_due(p_term_id, p_base_date) → date` — v1.1 의 "OUTPUT 파라미터 + 1행 결과셋 동시 반환"이 **스칼라 반환 하나로 정리**된다.

> **⚠ 계산은 SQL 에만 둔다** — v1.1 §15.1 은 *"지급정책의 월말 보정과 윤년 처리는 프로시저와 같은 결과여야 한다(미리보기와 저장이 갈리면 안 된다)"* 고 경고하면서, 등가성 검증을 통합 테스트의 몫으로 남겨 두었다. **v2.0 은 이 위험을 설계에서 제거한다** — 프론트엔드는 계산을 재구현하지 않고 **미리보기도 `ax_partner_term_calc_due` RPC 를 호출**한다. 대가는 라운드트립 1회이고, 얻는 것은 등가성 버그의 원천 차단이다([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정) "계산 결과가 저장값을 결정하는 규칙은 SQL 에만 둔다").

**전표 라인 `due_date` 의 산출 경로 (FR-Ledger-11, UC-Ledger-07)** — 지급정책은 미리보기용이 아니라 **전표 라인 값의 원천**이다.

1. 라인의 계정과목이 `due_date` 플래그 = `true` 일 때만 입력영역이 활성화된다. `false` 면 값을 저장하지 않는다(`50466`).
2. **원천 거래에 지급정책이 연결되어 있으면** — 고객사의 `collecting_type` 또는 거래처의 `payment_type` → `partner_term` 규칙(EOM+N / CurM DD)으로 **자동 계산**한다. 계산 주체는 `ax_partner_term_calc_due` 하나다.
3. **정책이 연결되지 않은 경우** — 권한 있는 사용자가 직접 입력한다.
4. 정책 변경은 **변경 이후 신규 계산분에만** 적용되고, 이미 저장된 `due_date` 를 자동 재계산하지 않는다(FR-Term-07).

### 9.12 식별자 자동생성 규칙

시퀀스·`IDENTITY` 를 쓰지 않고 **BEFORE INSERT 트리거가 채번**한다(C5). v1.1 은 프로시저가 채번했으므로 프로시저를 우회하면 채번이 되지 않았지만, v2.0 은 **어떤 경로로 INSERT 해도 트리거가 발화**하므로 PostgREST 직접 쓰기가 안전해진다.

| 대상 | 방식 | v1.1 잠금 | **v2.0 잠금** | 비고 |
| ---- | ---- | --------- | ------------- | ---- |
| `finance_ledger_head.ledger_no` | `MAX+1`, 범위 = 회사+일자 | `UPDLOCK, HOLDLOCK` | `pg_advisory_xact_lock` | [§9.2](#92-전표번호-생성-지침-12) |
| `finance_dimension_detail.line_no` | `MAX+1`, 범위 = dimension_id | `UPDLOCK, HOLDLOCK` | `pg_advisory_xact_lock` | **PostgREST 직접 INSERT 가능** |
| `finance_dimension.slot_no` | 미사용 최소 Slot(1~5) | `UPDLOCK, HOLDLOCK` | `pg_advisory_xact_lock` | [§9.8](#98-관리항목-slot-보존-지침-19) |
| `finance_ledger_detail.line_on` | JSON 배열 순서 재부여 | 없음(전량 재적재) | `WITH ORDINALITY` | [§9.1](#91-전표-저장-검증-하나의-트랜잭션-지침-1724) |
| `sales_pipeline_detail.activity_id` | `'ACT' + 타임스탬프` | **없음** | `pg_advisory_xact_lock` + 시퀀스 부가 | **⚠ 아래** |

> **⚠ `activity_id` 채번의 v1.1 결함과 그 해소** — `'ACT'+FORMAT(SYSDATETIME(),'yyMMddHHmmssff')` 는 **1/100초 해상도이고 잠금이 없었다.** 동일 100분의 1초에 두 요청이 들어오면 같은 ID 가 생성되고 후속 `EXISTS` 검사에서 `50323` 으로 실패했다(데이터 오염은 없으나 무의미한 오류가 노출된다).
> v2.0 은 어드바이저리 잠금 하에 **충돌 시 2자리 시퀀스를 부가**하는 재시도 루프(최대 99회)로 해결한다. 프론트엔드의 재시도 처리가 불필요해진다.

> **⚠ 클라이언트가 보낸 채번 값은 전부 무시된다** — 5종 모두 트리거가 `NEW.<컬럼>` 을 무조건 덮어쓴다. 검증이 아니라 무시이므로 우회 경로가 없다([§10.5](#105-트리거-db-계층-최후-방어선)).

---

## 10. DB 오브젝트 ↔ 애플리케이션 계층 매핑 전략

### 10.1 데이터 접근 규칙 (지침 §13, §25)

애플리케이션 서버가 없으므로 Repository 인터페이스 계층도 없다. 대신 **접근 경로를 두 갈래로 고정**하고, 각 갈래의 규칙을 명시한다.

| 경로 | 대상 | 구현 |
| ---- | ---- | ---- |
| **조회** | 목록·상세·Lookup·집계 | PostgREST — 테이블 또는 뷰. `lib/query.ts` 헬퍼 경유 ([§10.3](#103-조회-경로와-페이징-c9)) |
| **쓰기** | 단순 CRUD | PostgREST — 테이블 직접 INSERT/PATCH/DELETE. RLS·제약·트리거가 규칙을 강제 |
| **쓰기** | 다단계 업무 트랜잭션 | RPC 함수 — `lib/rpc.ts` 타입드 래퍼 경유 ([§10.2](#102-rpc-함수-계층-c4)) |

**불변 규칙**

- React 컴포넌트에서 `supabase.from()` / `supabase.rpc()` 를 직접 부르지 않는다. `lib/` 래퍼와 feature 훅을 거친다([§2.1](#21-계층-의존성) 규칙 2).
- DB 행 타입(`database.types.ts`)을 도메인 Entity 로 직접 쓰지 않는다. **Mapper 를 둔다** — `status` 극성 반전([부록 A](#부록-a-코드값-사전))과 `numeric` → `number` 정규화(C10)가 이 경계에서 일어난다.
- `database.types.ts` 는 `supabase gen types typescript` 산출물이며 **수기 편집 금지**다. DDL 과 어긋나면 CI 가 차단한다([§18.3](#183-cicd)).

```typescript
// lib/query.ts — 조회 헬퍼. 스코프 인자가 없다는 점이 핵심이다(RLS 가 처리).
export async function listClients(cond: ClientSearchCondition, page: Page) {
  const { data, count, error } = await supabase
    .from("v_partner_client")                       // 뷰 — 컬럼 명시 + 마스킹 적용
    .select("client_id, client_name, status, collecting_type", { count: "exact" })
    .ilike("client_name", `%${escapeLike(cond.keyword)}%`)   // ⚠ §10.4 이스케이프
    .order("client_id")
    .range(page.from, page.to);                     // C9 — Range 헤더 페이징
  if (error) throw toAxError(error);                // 부록 B 어댑터
  return { rows: data.map(toClient), total: count };
}
```

### 10.2 RPC 함수 계층 (C4)

v1.1 은 프로시저 75건 전부를 실행 대상으로 삼았다. v2.0 은 **진짜 트랜잭션만 남긴다**(C4). 판별 기준은 하나다 — **여러 문장이 원자적으로 실행되어야 하는가, 아니면 한 행을 쓰는 것이 전부인가.**

**남기는 것 — RPC 함수 20건**

| # | 함수 | 대체하는 프로시저 | 반환 | 최소 역할 | 플래그 |
|---|------|------------------|------|-----------|--------|
| 1 | `ax_finance_ledger_save(p_head jsonb, p_lines jsonb)` | `usp_finance_ledger_head_save` + `_detail_save` **통합** | `jsonb {ledger_date, ledger_no}` | EDITOR | — |
| 2 | `ax_finance_ledger_approve(p_date date, p_no numeric)` | `usp_finance_ledger_approve` | `void` | APPROVER | `ax.ledger_approve` |
| 3 | `ax_finance_ledger_delete(p_date date, p_no numeric)` | `usp_finance_ledger_delete` | `void` | EDITOR | — |
| 4 | `ax_finance_ledger_get(p_date date, p_no numeric)` | `usp_finance_ledger_get` (2결과셋) | `jsonb {head, lines[]}` | VIEWER | — |
| 5 | `ax_finance_ledger_preview_account_change(...)` | 신설 (v1.1 D 항목) | `jsonb {conflicts[]}` | EDITOR | — |
| 6 | `ax_finance_openbalance_save(p_year_id, p_rows jsonb)` | `usp_finance_openbalance_save` | `jsonb {saved}` | EDITOR | — |
| 7 | `ax_finance_openbalance_list(p_year_id)` | `usp_finance_openbalance_list` (2결과셋) | `jsonb {rows[], totals}` | VIEWER | — |
| 8 | `ax_finance_openbalance_close(p_year_id)` | `usp_finance_openbalance_close` | `void` | APPROVER | `ax.openbal_admin` |
| 9 | `ax_finance_openbalance_reopen(p_year_id)` | `usp_finance_openbalance_reopen` | `void` | ADMIN | `ax.openbal_admin` |
| 10 | `ax_finance_closing_execute(p_year_id)` | `usp_finance_closing_execute` | `jsonb {closed_year_id, next_year_id, carried_rows}` | ADMIN | `ax.openbal_admin` |
| 11 | `ax_finance_closing_reopen(p_year_id)` | `usp_finance_closing_reopen` (C12) | `jsonb {reopened_year_id, removed_rows}` | ADMIN | `ax.openbal_admin` |
| 12 | `ax_finance_closing_status(p_year_id)` | `usp_finance_closing_list` 상세분 | `jsonb` | VIEWER | — |
| 13 | `ax_finance_gl_generate_standard()` | `usp_finance_gl_generate_standard` | `jsonb {inserted_count}` | ADMIN | `ax.bypass_gl_protect` |
| 14 | `ax_finance_dimension_save(p_dim jsonb)` | `usp_finance_dimension_save` (slot 할당 포함) | `jsonb {dimension_id, slot_no}` | EDITOR | — |
| 15 | `ax_finance_dimension_delete(p_dim_id)` | `usp_finance_dimension_delete` (2단 DELETE — v1.1 결함 수정분) | `void` | EDITOR | — |
| 16 | `ax_partner_term_calc_due(p_term_id, p_base_date)` | `usp_partner_term_calc_due` | `date` | VIEWER | — |
| 17 | `ax_sales_contract_link_ledger(...)` | `usp_sales_contract_link_ledger` | `void` | EDITOR | — |
| 18 | `ax_sales_pipeline_link_contract(...)` | `usp_sales_pipeline_link_contract` | `void` | EDITOR | — |
| 19 | `ax_system_employee_delete(p_employee_id)` | `usp_system_employee_delete` (5개 테이블 참조검사) | `void` | ADMIN | — |
| 20 | `ax_system_employee_set_role(p_employee_id, p_role)` | 신설 (역할이 DB 로 내려온 결과, [§6.3](#63-역할role-저장-위치)) | `void` | ADMIN | — |

**폐기하는 것 — 55건과 그 대체물**

| 폐기 프로시저 군 | 건수 | 대체 |
| ---------------- | ---- | ---- |
| `usp_auth_*` | 3 | **Supabase Auth**(C2) — `signInWithPassword` · 자동 refresh · `updateUser` |
| `usp_*_list` (전 도메인) | 21 | **PostgREST 필터 + `Range` 페이징**(C9). 검색·정렬·활성필터가 전부 질의 파라미터로 표현된다 |
| `usp_*_get` (단순 조회) | 9 | **PostgREST 단건 조회 또는 뷰**. `SELECT *` 6건은 컬럼 명시 뷰로 대체([§10.3](#103-조회-경로와-페이징-c9)) |
| `usp_*_save` (단순 마스터) | 14 | **PostgREST INSERT/PATCH**. 코드 불변성은 컬럼 GRANT, 참조 유효성은 FK, 열거값은 CHECK, 채번은 BEFORE 트리거(C5)가 각각 담당 |
| `usp_*_delete` (참조검사 후 단일 DELETE) | 8 | **FK `ON DELETE RESTRICT`** — 참조가 있으면 DB 가 `23503` 으로 거부한다. v1.1 의 "guard-EXISTS 후 DELETE"는 경합에서 안전하지 않았고, FK 는 안전하다 |
| **소계** | **55** | |

> **왜 `_delete` 를 FK 로 바꾸는 것이 개선인가** — v1.1 의 패턴은 `IF EXISTS(참조) THROW; DELETE;` 였다. 두 문장 사이에 다른 트랜잭션이 참조를 만들면 **고아 참조가 생긴다**. FK 제약은 같은 검사를 원자적으로 수행한다. 대가는 오류 메시지 품질인데, `23503` 을 잡아 한글 메시지로 바꾸는 어댑터([부록 B](#부록-b-오류코드-체계))로 회복한다.
>
> **⚠ 예외 — `system_team.owner`/`leader_user_id`, `finance_GL.contra_gl`, `sales_pipeline.contract_id`, `finance_ledger_detail` 의 Layer-3 컬럼**에는 원래부터 FK 가 없다(순환 의존 또는 복합키 불일치). 이들의 참조 검사는 **트리거로 내린다** — 프로시저가 사라져도 검사는 남아야 한다.

**함수 작성 규약**

```sql
-- 20260814000800_functions_finance.sql
create or replace function public.ax_finance_ledger_approve(p_date date, p_no numeric)
returns void
language plpgsql
security definer                       -- 컬럼 GRANT 를 넘어 approval_status 를 쓰기 위함
set search_path = ''                   -- 필수 (§19.1)
as $$
declare v_rank int;
begin
  -- ① 역할 재조회 — 클레임을 믿지 않는다 (§6.2 staleness 3번)
  select public.auth_role_rank_live() into v_rank;
  if v_rank < 30 then
    perform public.ax_raise(40301, '전표 승인 권한이 없습니다.');
  end if;

  -- ② 대상 확보 — 스코프는 파라미터가 아니라 클레임에서 (§5.4)
  perform 1 from public.finance_ledger_head
   where company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
     and ledger_date = p_date and ledger_no = p_no
   for update;
  if not found then perform public.ax_raise(50451, '전표를 찾을 수 없습니다.'); end if;

  -- ③ 업무 검증 (차대 균형 등) … 생략

  -- ④ 트리거 우회 플래그 — 트랜잭션 로컬 (C6)
  perform set_config('ax.ledger_approve', '1', true);
  update public.finance_ledger_head
     set approval_status = true, approver_Id = public.auth_employee_id(),
         approved_date  = localtimestamp(0)
   where company_id = public.auth_company_id() and entity_id = public.auth_entity_id()
     and ledger_date = p_date and ledger_no = p_no;
  -- 플래그 리셋 불필요: 트랜잭션이 끝나면 자동 소멸한다 (C6)
end $$;

revoke execute on function public.ax_finance_ledger_approve(date, numeric) from public, anon;
grant  execute on function public.ax_finance_ledger_approve(date, numeric) to authenticated;
```

> **v1.1 대비 사라진 제약 3건**
>
> 1. **`SECURITY DEFINER` 함수는 자체 트랜잭션을 열지 않는다** — PostgreSQL 함수는 호출자 트랜잭션 안에서 원자적으로 실행된다. `BEGIN TRAN`/`COMMIT`/`ROLLBACK`/`XACT_ABORT`/`@@TRANCOUNT` 가 전부 불필요하다. 예외가 나면 문장 전체가 자동 롤백된다.
> 2. **커넥션 고정 요구 소멸** — 플래그가 트랜잭션 로컬(C6)이므로 커넥션 풀에서 어떤 커넥션을 잡든 무관하다. v1.1 §10.2 의 "반드시 단일 커넥션에서 실행"이 사라진다.
> 3. **`CATCH` 에서의 플래그 리셋 불필요** — 트랜잭션 종료 시 자동 소멸하므로 누출이 원천 불가능하다. v1.1 은 성공·실패 양쪽 경로에서 리셋을 반복해야 했다.
>
> **새로 생기는 제약 1건** — pl/pgsql 함수는 **`ROLLBACK` 을 호출할 수 없다.** 부분 롤백이 필요하면 `BEGIN … EXCEPTION WHEN … END` 블록(내부적으로 세이브포인트)을 쓴다. 다만 v2.0 의 RPC 는 모두 전부-성공/전부-실패이므로 실제로 필요한 곳이 없다.

**OUTPUT 파라미터·다중 결과셋의 처분** — v1.1 §10.2 가 "Prisma 로 불가능"하다고 지목했던 두 문제는 반환 타입을 `jsonb` 로 통일해 소멸시킨다.

| v1.1 문제 | v2.0 처분 |
| --------- | --------- |
| `usp_finance_ledger_head_save.@ledger_no` OUTPUT | 채번이 BEFORE 트리거로 이동(C5). 함수 1 이 `jsonb` 로 반환 |
| `usp_finance_dimension_detail_save.@line_no` OUTPUT | BEFORE 트리거 채번(C5) → **PostgREST 직접 INSERT 가능**. 함수 불필요 |
| `usp_sales_activity_save.@activity_id` OUTPUT | 동일 — BEFORE 트리거 채번 → PostgREST 직접 INSERT |
| `usp_partner_term_calc_due` OUTPUT + 결과셋 | 함수 16 이 `date` 를 스칼라 반환 |
| `usp_finance_ledger_get` 2결과셋 | 함수 4 가 `jsonb {head, lines[]}` 반환 |
| `usp_finance_openbalance_list` 2결과셋 | 함수 7 이 `jsonb {rows[], totals}` 반환 |

### 10.3 조회 경로와 페이징 (C9)

v1.1 D2 는 **"82개 프로시저 전체에 페이징이 0건"**이라는 간극을 애플리케이션 Query Service 로 메웠다. PostgREST 는 이를 프로토콜 수준에서 해결한다.

```typescript
supabase.from("v_finance_ledger").select("*", { count: "exact" }).range(0, 49)
// → Range: 0-49        응답: Content-Range: 0-49/1234
```

| 용도 | 구현 | 페이징 |
| ---- | ---- | ------ |
| Head Grid · 검색 목록 | PostgREST 테이블/뷰 + `.eq/.ilike/.in/.order` | `.range()` + `count:'exact'` |
| F2/Enter Lookup 팝업 | 동일. `search_mode=E` → `.eq()`, `L` → `.ilike()` | `.limit(100)` 상한 |
| 상세 조회 | `.single()` 또는 뷰 | — |
| 전표 상세 · 초기이월 목록 | RPC(함수 4·7) — 헤더/라인, 행/합계를 한 왕복으로 | — |

**뷰가 필요한 경우 3가지**

1. **마스킹** — `v_finance_bank_account` 는 `card_number` 원문 대신 `mask_card(card_number)` 를 노출한다. 원문 컬럼은 `authenticated` 에서 SELECT 권한을 회수한다([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법)).
2. **`SELECT *` 대체** — v1.1 이 지적한 6건(`entity_get`·`client_get`·`vendor_get`·`pipeline_get`·`gl_get`·`ledger_get` 헤더)은 컬럼을 명시한 뷰로 만든다. DDL 변경 시 조용히 컬럼이 새는 것을 막는다.
3. **조인** — `v_finance_gl_full` 은 `finance_dimension` 을 slot 1~5 로 5회 조인해 관리항목 명칭을 붙인다(`usp_finance_gl_get` 이 하던 일).

> **⚠ 뷰는 반드시 `WITH (security_invoker = on)`** — 기본값 `off` 는 뷰를 소유자 권한으로 실행해 **RLS 를 통째로 우회**한다. 뷰를 11개 이상 만드는 설계에서 이것이 v2.0 최대의 보안 사고 경로다. [§19.1](#191-rls-가-유일한-권위) 의 CI 검사가 전 뷰를 대상으로 이 옵션을 강제한다.

**조회 경로로 반드시 함께 이관해야 하는 규칙 4종** — v1.1 이 "D2 전환 시 최다 누락 지점"으로 지목한 목록이며, v2.0 에서도 그대로 유효하다. 다만 처리 주체가 바뀐다.

| 규칙 | v1.1 (Query Service 책임) | v2.0 |
| ---- | ------------------------- | ---- |
| `company_id`+`entity_id` 스코프 | 개발자가 WHERE 에 직접 | **RLS 가 자동** — 누락이 구조적으로 불가능 |
| `status` 극성 | 개발자가 테이블별로 기억 | **여전히 개발자 책임** — `packages/shared-constants` 의 `isActive(table, v)` 를 강제 |
| 카드번호 마스킹 | 개발자가 SELECT 절에서 | **컬럼 GRANT 회수 + 뷰** — 누락 시 조회 자체가 실패 |
| `user_pass` 제외 | 개발자가 컬럼 열거에서 | **컬럼이 삭제됨**(C2) — 문제 자체가 소멸 |

즉 4종 중 3종은 구조적으로 해결되고, **`status` 극성만 사람이 지켜야 할 규칙으로 남는다**([§10.6](#106-status-극성--v20-최대의-잔존-위험) 참조).

### 10.4 직접 SQL 규칙 (지침 §15)

복잡 집계·성능상 뷰가 부적절한 경우에 한해 RPC 함수 안에서 SQL 을 직접 작성한다. PostgreSQL 로 오면서 v1.1 의 T-SQL 주의사항 대부분이 무효가 되지만, 두 가지가 새로 생기고 하나가 남는다.

- **남는 것 — `LIKE`/`ILIKE` 이스케이프.** v1.1 의 모든 `_list` 프로시저는 `LIKE '%'+@keyword+'%'` 를 `ESCAPE` 없이 썼고, 사용자가 입력한 `%`·`_` 가 와일드카드로 동작했다. **이 결함은 PostgREST 로 옮겨도 그대로 재현된다** — `.ilike()` 는 값을 이스케이프하지 않는다. `lib/query.ts` 의 `escapeLike()` 를 **모든 부분일치 검색에 의무 적용**한다.
- **새로 생기는 것 ① — 문자열 정규식.** T-SQL 의 `LIKE '%[^0-9-]%'` 는 문자 클래스지만 PostgreSQL 의 `LIKE` 에는 문자 클래스가 없다. **직역하면 조용히 오작동**한다(리터럴 `[^0-9-]` 를 찾게 됨). `~ '[^0-9-]'` 정규식 연산자로 옮긴다. 해당 위치는 사업자번호 검증 2곳이다.
- **새로 생기는 것 ② — `SELECT … INTO` 의 무결과 처리.** T-SQL 의 `SELECT @v = col FROM …` 은 행이 없으면 `@v` 를 **그대로 둔다**. pl/pgsql 의 `SELECT … INTO` 는 **NULL 로 만든다**. 이식 대상 8개 지점은 모두 `IF @v IS NULL THROW` 형태라 결과적으로 안전하지만, 각 지점을 개별 확인한다.

### 10.5 트리거 (DB 계층 최후 방어선)

v1.1 의 10건에서 **16건 + 참조검증분**으로 늘어난다. 늘어난 이유는 하나다 — **v1.1 은 프로시저가 유일한 쓰기 경로여서 프로시저 안의 검증으로 충분했지만, v2.0 은 PostgREST 직접 쓰기가 가능하므로 그 검증이 트리거로 내려와야 한다.**

| 분류 | 건수 | 내역 |
| ---- | ---- | ---- |
| (a) 보호 트리거 | **11** | v1.1 10건 이식 + **최후 관리자 보호** 신설([§6.5](#65-초기-admin-부트스트랩-fr-admin-0106)) |
| (b) 채번 트리거 | **5** | C5 신설 — `ledger_no`·`line_on`·`line_no`·`slot_no`·`activity_id` |
| (c) 참조검증 트리거 | 대상별 | FK 를 걸 수 없는 참조 4종([§9.9](#99-참조-무결성과-soft-disabledelete-지침-20))과 `contra_gl` 규칙([§7.4](#74-finance)). 프로시저가 하던 검증을 인계받는다 |

**(a) 보호 트리거 — v1.1 10건의 이식**

| 트리거 | 대상 | v1.1 시점 | **v2.0 시점** | 방어 내용 | 오류코드 |
| ------ | ---- | --------- | ------------- | --------- | -------- |
| `trg_system_employee_protect_admin` | employee | INSTEAD OF DELETE | **BEFORE DELETE ROW** | built-in admin 물리삭제 차단 | 51001 |
| `trg_system_employee_keep_one_super` | employee | — (미구현) | **BEFORE UPDATE ROW** | 마지막 활성 SUPER 의 비활성화·강등 차단 | **51002 신규** |
| `trg_system_employee_audit` | employee | AFTER UPDATE | AFTER UPDATE STATEMENT | 수동 편집 시 `last_manual_edit_at` 기록 | — |
| `trg_system_employee_inactive` | employee | AFTER UPDATE | **BEFORE UPDATE ROW** | `inactive` 전환 시 퇴사일 자동 보완 | — |
| `trg_sales_pipeline_audit` | pipeline | AFTER UPDATE | **BEFORE UPDATE ROW** | `adjusted_date` 갱신, stage 5/6 진입 시 `closed_date` 설정·재오픈 시 해제 | — |
| `trg_finance_ledger_head_protect` | ledger_head | INSTEAD OF U/D | **BEFORE UPDATE OR DELETE ROW** | **[마감연도]** + 승인 전표 헤더 보호 | 51011 · 51012 · **51052** |
| `trg_finance_ledger_detail_protect` | ledger_detail | AFTER I/U/D | BEFORE I/U/D ROW | **[마감연도]** + 승인 전표 라인 변경 차단 | 51021 · **51053** |
| `trg_finance_open_balance_protect` | open_balance | AFTER I/U/D | BEFORE I/U/D ROW | **[마감연도]** 전면 잠금 + 확정분 보호 | 51031 · **51054** |
| `trg_finance_gl_protect_delete` | GL | INSTEAD OF DELETE | **BEFORE DELETE ROW** | 초기이월/전표 참조 계정 삭제 차단 | 51041 |
| `trg_finance_ledger_head_closing_lock` | ledger_head | AFTER INSERT | BEFORE INSERT ROW | **[마감연도]** 전표 신규 등록 차단 | **51051** |
| `trg_partner_term_condition` | term | AFTER I/U | **BEFORE I/U ROW** | 표시용 정책식 자동 구성(`EOM+{offset}` / `CurM{day}`) | — |

**[마감연도] 표시 = v3.0 마감연도 잠금 로직. 4건이다** (설계상 중요: 3건이 아니다).

> **INSTEAD OF 3건의 재설계** — PostgreSQL 은 **뷰에만** `INSTEAD OF` 를 허용한다. 테이블에는 쓸 수 없으므로 셋 다 `BEFORE … ROW` 로 바꾼다. 의미가 달라지는 지점을 정확히 짚는다.
>
> - `trg_system_employee_protect_admin` — v1.1 은 INSTEAD OF 라 "admin 이면 THROW, 아니면 **직접 DELETE 수행**"이었다. BEFORE 트리거는 **차단만 하면 되고**(`RAISE`), 나머지 행은 `RETURN OLD` 로 원래 DELETE 가 진행된다. 수동 재실행 코드가 사라져 오히려 단순해진다.
> - `trg_finance_ledger_head_protect` — v1.1 은 "미승인 전표 삭제 시 라인을 연쇄삭제"를 트리거 안에서 직접 했다. v2.0 은 **FK 에 `ON DELETE CASCADE`** 를 걸어 DB 가 처리한다. 단, **CASCADE 는 헤더 BEFORE 트리거 이후에 실행**되므로 라인 보호 트리거가 나중에 발화한다 — 헤더가 이미 통과를 허락한 삭제이므로 라인 트리거도 통과해야 한다. 라인 트리거의 마감·승인 검사가 헤더와 동일 조건이라 자연히 성립하지만, **이 순서 의존은 코드에 드러나지 않으므로 pgTAP 회귀 테스트로 고정**한다([§15](#15-테스트-전략-지침-26)).
> - `trg_finance_gl_protect_delete` — INSTEAD OF 의 수동 DELETE 재실행이 사라지고 `RAISE` + `RETURN OLD` 만 남는다.
>
> **`inserted`/`deleted` 의사테이블** — 문장 트리거는 `REFERENCING NEW TABLE AS inserted OLD TABLE AS deleted` 로 거의 그대로 옮겨진다(PG 10+). 행 트리거는 `NEW`/`OLD` 를 쓴다. `UPDATE(col)` 함수는 **`NEW.col IS DISTINCT FROM OLD.col`** 로, `TRIGGER_NESTLEVEL()` 재귀 가드는 **BEFORE 트리거로 바꾸면서 재귀 자체가 사라져** 불필요해진다(`trg_partner_term_condition`).

> **⚠ 마감연도 잠금이 우회 플래그보다 우선한다 — 이 순서는 v2.0 에서도 반드시 보존한다.**
>
> ```
> trg_finance_open_balance_protect:
>   ① finance_closing.closing = true 검사 → 51054     ← 먼저
>   ② if current_setting('ax.openbal_admin', true) = '1' then return new; end if;   ← 나중
>   ③ closed = true 행 보호 → 51031
> ```
>
> 즉 **`ax.openbal_admin` 플래그로는 마감연도 잠금을 우회할 수 없다.** `trg_finance_ledger_head_protect` 도 동일하게 마감연도 검사가 `ax.ledger_approve` 면제보다 앞선다.
>
> 이 우선순위는 의도된 설계이며, [§9.6 회계마감 해제](#96-연도-회계마감-해제-c12)의 실행 순서(`closing = false` 를 **먼저** UPDATE)가 강제되는 직접적 근거다. **pgTAP 회귀 테스트로 순서를 고정**한다 — 두 문장의 위치를 바꿔도 대부분의 테스트는 통과하고 마감해제만 조용히 깨지기 때문이다.

**(b) 채번 트리거 — C5 신설 5건**

v1.1 은 채번을 프로시저 안에서 `WITH (UPDLOCK, HOLDLOCK)` + `MAX()+1` 로 했다. PostgreSQL 의 기본 격리수준(READ COMMITTED)에서 `MAX()+1` 은 **경합한다.** 채번을 BEFORE INSERT 트리거로 내리고 어드바이저리 잠금으로 직렬화하면, ① 경합이 사라지고 ② 해당 테이블을 **PostgREST 로 직접 INSERT 할 수 있게 되어** 프로시저 3건이 통째로 불필요해진다.

| 트리거 | 대상 | 채번 대상 | 잠금 키 |
| ------ | ---- | --------- | ------- |
| `trg_finance_ledger_head_number` | ledger_head | `ledger_no` = `MAX+1` | `(company, entity, ledger_date)` |
| `trg_finance_ledger_detail_lineno` | ledger_detail | `line_on` = 배열 순서 | 전표 헤더 잠금에 종속 |
| `trg_finance_dimension_detail_lineno` | dimension_detail | `line_no` = `MAX+1` | `(company, entity, dimension_id)` |
| `trg_finance_dimension_slot` | dimension | `slot_no` = 1~5 중 최소 미사용 | `(company, entity)` |
| `trg_sales_activity_id` | pipeline_detail | `activity_id` = `'ACT'+타임스탬프` | `(company, entity, pipeline_id)` |

```sql
create or replace function public.trg_fn_ledger_head_number() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 트랜잭션 종료 시 자동 해제. 같은 (회사, 일자)만 직렬화된다.
  perform pg_advisory_xact_lock(hashtext(new.company_id || '|' || new.entity_id
                                         || '|' || new.ledger_date::text));
  new.ledger_no := coalesce((select max(ledger_no) from public.finance_ledger_head
                              where company_id = new.company_id and entity_id = new.entity_id
                                and ledger_date = new.ledger_date), 0) + 1;
  return new;
end $$;
```

> **⚠ 클라이언트가 보낸 채번 값은 무시한다** — 트리거가 `new.ledger_no` 를 **무조건 덮어쓴다.** 받아서 검증하는 것이 아니라 받지 않는 것이 안전하다([§5.4](#54-필수-규칙-지침-7-fr-bank-08) 와 같은 원칙). v1.1 의 "UI 에서 전표번호를 생성하지 않는다"(지침 §12) 금지가 이로써 **구조적으로 강제**된다.
>
> **⚠ `hashtext` 해시 충돌** — 무관한 (회사, 일자) 조합이 같은 잠금을 잡아 직렬화될 수 있다. **정확성 손실은 없고 처리량만 손해**다. 대량 입력일에 측정한다.
>
> **⚠ `activity_id` 의 v1.1 결함** — `'ACT'+FORMAT(SYSDATETIME(),'yyMMddHHmmssff')` 는 1/100초 해상도이고 잠금이 없어 동시 생성 시 충돌한다. v2.0 은 어드바이저리 잠금 + 충돌 시 2자리 시퀀스 부가로 해결한다.

**(c) 우회 플래그 3종 — 커넥션에서 트랜잭션으로 (C6)**

| v1.1 키 (`SESSION_CONTEXT`) | **v2.0 키 (`set_config`)** | 설정 주체 | 읽는 트리거 |
| --------------------------- | -------------------------- | --------- | ----------- |
| `ax_ledger_approve` | `ax.ledger_approve` | `ax_finance_ledger_approve()` | `trg_finance_ledger_head_protect` |
| `ax_openbal_admin` | `ax.openbal_admin` | `ax_finance_openbalance_close/_reopen()`, `ax_finance_closing_execute/_reopen()` | `trg_finance_open_balance_protect` |
| `ax_bypass_gl_protect` | `ax.bypass_gl_protect` | `ax_finance_gl_generate_standard()` | `trg_finance_gl_protect_delete` |

```sql
perform set_config('ax.ledger_approve', '1', true);   -- ← 3번째 인자 true = 트랜잭션 로컬
...
if coalesce(current_setting('ax.ledger_approve', true), '') = '1' then return new; end if;
```

`set_config(..., true)` 는 **트랜잭션이 끝나면 자동 소멸**한다. 따라서 ① 리셋 코드가 불필요하고 ② 예외 경로에서 플래그가 누출될 수 없으며 ③ 커넥션 풀에서 커넥션이 갈려도 무관하다. v1.1 이 안고 있던 세 가지 위험이 한꺼번에 사라진다.

> `current_setting` 의 2번째 인자 `true` 는 **미설정 시 오류 대신 NULL 반환**이다. 이것을 빠뜨리면 플래그를 설정하지 않은 정상 경로에서 `42704` 오류가 난다.

### 10.6 `status` 극성 — v2.0 최대의 잔존 위험

같은 이름의 `status` 컬럼이 **테이블마다 반대 의미**다.

```
활성 = false(0) : system_company · system_entity · system_pod · system_team · finance_bank_account
활성 = true(1)  : partner_term · partner_client · partner_vendor · finance_GL · finance_dimension
```

v1.1 에서는 Mapper 가 이것을 숨겼다. **v2.0 에서는 PostgREST 가 `status: false` 를 그대로 브라우저에 돌려준다.** 프론트엔드 코드가 매번 정확히 기억해야 하고, 틀려도 조용히 동작한다 — 비활성 거래처가 목록에 보이거나, 활성 회사가 사라진다.

**방어**

- `packages/shared-constants` 의 `ACTIVE_WHEN_ZERO` / `ACTIVE_WHEN_ONE` 집합과 `isActive(table, v)` / `toDbStatus(table, active)` 를 **유일한 접근 수단**으로 강제한다. `status` 를 직접 비교하는 코드는 린트로 금지한다.
- Vitest 커버리지 임계를 이 모듈에 한해 **100%** 로 둔다. 21개 테이블 각각에 최소 2케이스.
- 조회 뷰에 `is_active boolean` 계산 컬럼을 함께 노출해, 화면이 원시 `status` 를 만지지 않아도 되게 한다.

> **⚠ 신규 구축인 지금이 정규화할 유일한 기회다** — 이관할 운영 데이터가 없으므로(결정 8), 전 테이블을 `is_active boolean NOT NULL DEFAULT true` 로 통일하면 이 위험 **종류 자체가 소멸**한다. 대가는 `AX_Bridge.xlsx` 테이블 명세서·화면기획서 4종과의 컬럼명 이탈이며, **명세 정본을 바꾸는 결정이므로 고객 승인 사항**이다. 승인 전까지는 위 3중 방어를 적용한다. → [§16.3 미해결 이슈](#163-미해결-이슈)

---

## 11. API 설계

v1.1 은 "94개 REST 엔드포인트"를 직접 설계했다. v2.0 에서 **API 는 설계 대상이 아니라 스키마의 파생물**이다 — PostgREST 가 테이블·뷰·함수로부터 자동 생성한다. 따라서 이 절은 엔드포인트 목록이 아니라 **리소스와 권한의 카탈로그**다.

### 11.1 공통 정책

- **Base URL** — `https://<project-ref>.supabase.co/rest/v1` (조회·CRUD) / `.../rest/v1/rpc` (RPC) / `.../auth/v1` (인증). 프론트엔드는 `supabase-js` 를 쓰므로 경로를 직접 다루지 않는다.
- **인증** — `Authorization: Bearer {access_token}` + `apikey: {anon_key}`. supabase-js 가 자동 부착하고 만료 전 자동 갱신한다.
- **테넌트 격리** — **RLS**(C3). 클라이언트가 `company_id` 를 보내든 말든 결과가 같다. v1.1 의 `X-Company-Id`/`X-Entity-Id` 헤더 주입은 사라진다.
- **공통 쿼리 파라미터**

  | v1.1 | v2.0 |
  | ---- | ---- |
  | `search_mode=E` (Enter, 정확일치) | `?col=eq.값` / `.eq()` |
  | `search_mode=L` (F2, 부분일치) | `?col=ilike.*값*` / `.ilike()` — **`escapeLike()` 의무**([§10.4](#104-직접-sql-규칙-지침-15)) |
  | `active_only=true` | `?status=eq.<활성값>` — **테이블별 극성 주의**([§10.6](#106-status-극성--v20-최대의-잔존-위험)) |
  | `page`/`size` (기본 1/50, 최대 500) | `Range: 0-49` 헤더 / `.range(from,to)` + `count:'exact'` → `Content-Range: 0-49/1234` (C9) |
  | `sort` | `?order=col.asc` / `.order()` |

- **응답 포맷** — PostgREST 응답 형태는 고정이며 `{success, data, error}` 봉투를 서버가 씌워줄 수 없다. **`lib/` 어댑터가 클라이언트에서 재구성**한다([부록 B](#부록-b-오류코드-체계)). 화면 코드가 보는 모양은 v1.1 과 동일하다.
- **HTTP 상태** — 200 조회 · 201 등록(`Prefer: return=representation`) · 204 수정/삭제 · 400 검증 · 401 미인증 · 403 권한없음(RLS `42501`) · 404 대상없음 · 409 중복/참조충돌(`23505`/`23503`) · 429 Rate Limit · 500 서버오류. RPC 오류의 상태 제어는 `ax_raise()` 가 담당한다([부록 B](#부록-b-오류코드-체계)).
- **Rate Limit** — v1.1 의 "사용자당 120 req/min"은 NestJS `ThrottlerGuard` 로 구현되었다. **서버가 없으므로 그 정밀도를 유지할 수 없다.** Supabase 플랫폼 한도 + Vercel/Cloudflare WAF 의 IP 단위 제한으로 대체하고, 사용자 단위 제어는 **의도적으로 포기**한다([§19.5](#195-rate-limit)).
- **감사 로깅** — v1.1 은 NestJS 인터셉터가 담당했다. **이것이 v2.0 의 가장 큰 기능 후퇴 지점**이며, DB 트리거 기반 `ax_audit_log` 로 이관한다([§19.4](#194-감사-로깅)). v1.1 의 지적 — *"`approved_date` 를 제외한 업무일자가 일 단위이므로(D8), 초 단위 행위 이력은 이 로그가 유일한 근거다"* — 는 v2.0 에서도 그대로 유효하다.

### 11.2 리소스 카탈로그

**AUTH** — 애플리케이션 리소스가 아니다. GoTrue 엔드포인트를 supabase-js 로 호출한다([§6.1](#61-인증-흐름)). v1.1 의 `/auth/login`·`/auth/refresh`·`/auth/password` 3건은 폐기.

표기: **R** = 조회 최소역할, **W** = 등록/수정/삭제 최소역할. `viewer`=10 · `editor`=20 · `approver`=30 · `admin`=40.

**SYSTEM**

| 리소스 (PostgREST) | R | W | 비고 |
| ------------------ | - | - | ---- |
| `system_company` / `v_system_company` | VIEWER | **ADMIN** | ⚠ v1.1 EDITOR → **ADMIN 상향**([§6.4](#64-권한role-계층-fr-ui-07)) |
| `system_entity` / `v_system_entity` | VIEWER | **ADMIN** | ⚠ 동일. `v_` 뷰가 `SELECT *` 를 대체 |
| `system_pod` | VIEWER | EDITOR | |
| `system_team` | VIEWER | EDITOR | owner/leader 유효성은 트리거([§10.2](#102-rpc-함수-계층-c4) 예외 항목) |
| `v_system_employee` | VIEWER | EDITOR | 자격증명 컬럼 없음. `last_login` 은 `auth.users` 조인 |
| `system_year` | VIEWER | EDITOR | |
| **RPC** `ax_system_employee_delete` · `ax_system_employee_set_role` | — | ADMIN | |

> **v1.1 의 "상세 GET 이 6개 중 3개에만 있다"는 제약이 소멸한다** — `pods`·`teams`·`years` 에 `usp_*_get` 이 없어 상세 조회가 불가능했으나, PostgREST 는 모든 테이블에 단건 조회를 자동 제공한다.

**PARTNER**

| 리소스 | R | W | 비고 |
| ------ | - | - | ---- |
| `partner_term` | VIEWER | EDITOR | `term_condition` 은 BEFORE 트리거가 자동 구성 |
| `v_partner_client` · `v_partner_vendor` | VIEWER | EDITOR | 뷰가 `SELECT *` 대체 |
| **RPC** `ax_partner_term_calc_due` | VIEWER | — | 지급일 미리보기. **저장 경로와 같은 함수를 쓴다**([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)) |

**SALES**

| 리소스 | R | W | 비고 |
| ------ | - | - | ---- |
| `v_sales_pipeline` | VIEWER | EDITOR | stage 전환도 일반 PATCH. `adjusted_date`/`closed_date` 는 트리거 |
| `sales_pipeline_detail` | VIEWER | EDITOR | **`activity_id` 는 BEFORE 트리거 채번**(C5) → 직접 INSERT 가능 |
| `sales_contract` | VIEWER | EDITOR | 복합 PK `(contract_id, contract_type)` → `?contract_id=eq.X&contract_type=eq.Y` |
| **RPC** `ax_sales_pipeline_link_contract` · `ax_sales_contract_link_ledger` | — | EDITOR | 연결/해제는 양쪽 테이블을 함께 바꾸므로 RPC |

> **경로 설계 문제가 소멸한다** — v1.1 은 복합 PK 때문에 `PUT /sales/contracts/{contractId}/{contractType}` 처럼 경로에 두 세그먼트를 넣어야 했다. PostgREST 는 필터로 표현하므로 경로 설계 자체가 필요 없다.

**FINANCE**

| 리소스 | R | W | 비고 |
| ------ | - | - | ---- |
| `v_finance_gl` · `v_finance_gl_full` | VIEWER | EDITOR | `_full` 은 dimension slot 1~5 조인 |
| `finance_GL_seed` | VIEWER | — | 전역 읽기전용. 마이그레이션만 갱신([§5.2](#52-정책-패턴)) |
| `finance_dimension_detail` | VIEWER | EDITOR | **`line_no` BEFORE 트리거 채번**(C5). **DELETE 불가**([§9.8](#98-관리항목-slot-보존-지침-19)) |
| `v_finance_bank_account` | VIEWER | EDITOR | **`card_number` 마스킹 필수**. 원문 컬럼은 SELECT 권한 회수([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법)) |
| `v_finance_ledger` | VIEWER | EDITOR | 목록. `approval_status` 등 UPDATE 권한 없음 |
| `finance_open_balance` | VIEWER | EDITOR | `closed` 컬럼 UPDATE 권한 없음 |
| `finance_closing` | VIEWER | — | 쓰기는 RPC 전용 |
| **RPC** (13건) | | | [§10.2](#102-rpc-함수-계층-c4) 표의 1~15 |

### 11.3 업무 행위 (지침 §23)

지침 §23 은 "단순 CRUD URL 대신 업무 행위를 명시"할 것을 요구한다. v2.0 에서 이 요구는 **RPC 함수 이름**이 충족한다 — 행위가 URL 이 아니라 함수명으로 표현된다.

```
POST /rest/v1/rpc/ax_finance_ledger_approve            APPROVER
POST /rest/v1/rpc/ax_finance_openbalance_close         APPROVER
POST /rest/v1/rpc/ax_finance_openbalance_reopen        ADMIN
POST /rest/v1/rpc/ax_finance_closing_execute           ADMIN
POST /rest/v1/rpc/ax_finance_closing_reopen            ADMIN      # C12
POST /rest/v1/rpc/ax_finance_gl_generate_standard      ADMIN
POST /rest/v1/rpc/ax_sales_pipeline_link_contract      EDITOR
POST /rest/v1/rpc/ax_sales_contract_link_ledger        EDITOR
```

> **파이프라인 stage 전환은 RPC 가 아니다** — 지침 §23 예시에 `close`/`cancel`/`reopen` 이 나오지만 실제 명세에는 없다. stage 전환은 `sales_pipeline` 의 일반 PATCH 로 수행되고, `adjusted_date`/`closed_date` 는 트리거가 관리한다.
> [§7.3](#73-sales)의 `pipeline.close()`·`cancel()`·`reopen()` 은 **프론트엔드 Domain 메서드로 유지**한다(속성 직접 대입 금지). 훅이 이 메서드를 호출한 뒤 단일 PATCH 로 영속화한다.

### 11.4 대표 RPC 매핑 (발췌)

| RPC 함수 | 대체하는 프로시저 | 권한 | FR |
| -------- | ----------------- | ---- | -- |
| `ax_finance_ledger_save` | `usp_finance_ledger_head_save` + `_detail_save` **통합** | EDITOR | FR-Ledger-04~09/15/16 |
| `ax_finance_ledger_approve` | `usp_finance_ledger_approve` | APPROVER | FR-Ledger-10/13/16 |
| `ax_finance_closing_execute` | `usp_finance_closing_execute` | ADMIN | FR-Close-02~10 |
| **`ax_finance_closing_reopen`** | `usp_finance_closing_reopen` (C12) | ADMIN | [§9.6](#96-연도-회계마감-해제-c12) · FR-Close-12 |
| `ax_finance_gl_generate_standard` | `usp_finance_gl_generate_standard` | ADMIN | FR-GL-11~14 |
| `ax_finance_openbalance_close` | `usp_finance_openbalance_close` | APPROVER | FR-OpenBal-07 |
| `ax_finance_openbalance_reopen` | `usp_finance_openbalance_reopen` | ADMIN | FR-OpenBal-08 |
| `ax_finance_ledger_preview_account_change` | 없음 — 신설 | EDITOR | UC-Ledger-04 예외 |

> **왜 head/detail 저장을 하나로 합치는가** — v1.1 은 두 엔드포인트(`POST /finance/ledgers` + `PUT …/lines`)로 나뉘어 있었고, 사이에 실패하면 **라인 없는 헤더가 남았다.** [§13](#13-트랜잭션-규칙-지침-24) 은 이 둘을 "하나의 트랜잭션"으로 요구하는데, 엔드포인트가 둘이면 그 요구를 지킬 수 없다. v2.0 은 `ax_finance_ledger_save(p_head, p_lines)` 하나로 합쳐 **설계 의도와 구현을 일치**시킨다.

**FR/UC ↔ 리소스 ↔ RPC 의 전체 매핑**은 `AX_Bridge_DB_API_명세서.xlsx` v3.0 을 업무 정본으로 참조하되, **실행 수단 열(프로시저·API 경로)은 본 절이 정본**이다.

> **v1.1 대비 신설 2건** — 둘 다 v1.1 에서 이미 결정된 항목이며 v2.0 에서 그대로 승계한다.
>
> | RPC | 근거 |
> |---|---|
> | `ax_finance_closing_reopen` | C12 — 원본에 마감을 되돌리는 경로가 없었다([§9.6](#96-연도-회계마감-해제-c12)) |
> | `ax_finance_ledger_preview_account_change` | UC-Ledger-04 예외 — 계정을 바꾸면 플래그가 `Y→N` 이 되어 버려질 Layer3 값이 생긴다. **값을 자동으로 지우지 않고 목록만 돌려주므로** 화면이 사용자 확인을 받은 뒤 정리된 라인으로 저장한다 |

---

## 12. 프론트엔드 설계

### 12.1 공통 UI 컴포넌트 (지침 §6 — 화면별 중복 구현 금지)

`<AppToolbar />` · `<SearchBar />` · `<HeadDetailLayout />` · `<LookupPopup />` · `<DirtyFormGuard />` · `<ConfirmDialog />` · `<StatusBadge />`

### 12.2 공통 화면 흐름 (FR-UI-01~07)

```
조회조건 입력 → 조회 → Head Grid → 행 선택 → Detail 표시
→ 신규/수정 → 검증 → 저장 트랜잭션 → Head 재조회 + 선택 유지
```

- **툴바 기본 순서**: 조회 → 신규 → 수정 → 저장 → 삭제 → 취소 (FR-UI-02). 승인 등 메뉴 고유 기능은 기본 버튼 뒤에 구분 배치. 조회 상태에서는 조회/신규만 활성, 저장/취소는 편집모드에서 활성.
- **조회조건바 순서**: 그룹 → 회사 → 메뉴별 주요조건 → 상태. 조회조건 초기화 제공(FR-UI-03). 상위조건 변경 시 하위조건·선택값 초기화.
- 조회전용 사용자는 편집 버튼 비활성(FR-UI-02·FR-UI-07).
- **툴바 예외 화면** — 마감관리(SCR-FIN-06)는 표준 6버튼이 아니라 **조회 · 마감 · 취소** 구성이다. `<AppToolbar />` 는 버튼 집합을 주입받는 구조여야 한다.

### 12.3 공통 Lookup Popup (F2/Enter, 지침 §21, FR-UI-04)

```
F2     → 조건 범위 목록 팝업
Enter  → Exact 검색 → 1건이면 즉시 선택 → 미일치/다건이면 Like 팝업
```

- 상위 그룹/회사 조건이 필요한 Lookup은 상위조건이 없으면 팝업을 열지 않고 선행 선택을 안내한다.
- 선택 후 코드+명칭을 함께 내부 보관.

> **v1.1 의 `@search_mode` 불균일 문제가 소멸한다** — v1.1 은 프로시저마다 검색 지원이 갈렸다: `_list` 14건만 `@search_mode` 를 정상 지원했고, `usp_sales_contract_list`·`usp_finance_openbalance_list` 는 무조건 `LIKE '%…%'`, `usp_system_year_list`·`usp_sales_activity_list`·`usp_finance_closing_list` 는 키워드 검색 자체가 없었다. 화면마다 예외 분기가 필요했다.
>
> **PostgREST 는 모든 리소스에 동일한 필터 문법을 제공**하므로 이 불균일이 구조적으로 사라진다. `search_mode=E` → `.eq()`, `L` → `.ilike()` 를 `lib/query.ts` 가 균일하게 적용하고, 프론트엔드는 화면별 예외 분기를 갖지 않는다.
>
> **⚠ 입력값의 `%`·`_` 이스케이프는 여전히 필요하다** — `.ilike()` 는 값을 이스케이프하지 않으므로 v1.1 의 결함이 그대로 재현된다. `escapeLike()` 의무 적용([§10.4](#104-직접-sql-규칙-지침-15)).

### 12.4 미저장 변경 보호 (지침 §22, FR-UI-06)

신규/수정 모드에서 다른 Head 행 선택·재조회·메뉴 이동·브라우저 이동·취소·회사/그룹 조건 변경 시 `<DirtyFormGuard />` 로 Dirty Check → 저장/무시/취소 선택.

### 12.5 도메인별 화면 구조

| 화면             | 구조                                                                                                                                                                  | 특이사항                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYSTEM 각 마스터 | 조회조건바 + Head/Detail                                                                                                                                              | 그룹→회사→(부서) 종속 선택                                                                                                                                                                                                                |
| **직원등록**     | 조회조건바 + Head/Detail, **Detail 은 2개 탭**                                                                                                                        | **기본정보(인사)** / **계정정보**(`user_yn`·`user_id`(사번)·**`email`(로그인 ID)**·`ax_role`·마지막 로그인). 항목이 많아 탭 분리가 필수. 사번은 수정모드에서 읽기전용. 조직 이동 시 새 그룹·회사·부서 조합 유효성 검증. **비밀번호 입력란이 없다** — 초기 발급·재설정은 Supabase Auth 초대/재설정 메일로 처리한다(C2, [§6.1](#61-인증-흐름)) |
| 계정과목(GL)     | **2-Frame**: 좌 Head(계정구분·gl_id·gl_name 3열) / 우 Detail(전체 + Layer3 플래그 **7종 + 관리항목 1~5 = 12종** + Slot1~5 실제 관리항목명)                            | 「계정과목 생성」 버튼(전표 존재 시 비활성). `contra_gl` 은 `gl_detail=차감항목` 일 때 F2/Enter 로 동일 회사 사용중 계정 선택, 자기 자신 제외([§7.4](#74-finance))                                                                        |
| 관리항목         | Head(Slot·코드·명·상태) / Detail(상세값 목록)                                                                                                                         | 최대 5개, Slot 표시. 미등록 Slot 행은 `3~5 — (미등록)` 로 표시. **상세값 개별 삭제 UI를 두지 않는다**([§9.8](#98-관리항목-slot-보존-지침-19))                                                                                             |
| 초기이월         | 조회조건(기수 필수) + 입력 그리드 + 하단 차/대변 합계                                                                                                                 | bank_id·고객사·거래처 보조잔액, 확정/확정해제. **금액 0 입력 = 행 삭제**임을 명시([§9.4](#94-초기이월-확정closed-vs-연도-회계마감closing--v30-핵심-구분)). 합계는 부호를 살려 계산하고 음수 행을 명시 표시(C11)                           |
| **전표(Ledger)** | **3-Layer**: Layer1 헤더 목록 / Layer2 라인(라인번호·계정·차대·금액·고객사) **+ 상단에 DRCR별 합계·차액 실시간 표시** / Layer3 관리항목(계정 플래그 기반 활성/비활성) | 아래 상세                                                                                                                                                                                                                                 |
| 마감관리         | 기수·연도별 마감현황 그리드 + **조회·마감·취소** 툴바                                                                                                                 | 미마감만 체크 가능, `actual_year` 오름차순 순차 마감. 선행연도 미마감이면 후행 체크 제한. **마감 해제는 내림차순 순차**(C12, [§9.6](#96-연도-회계마감-해제-c12))                                                                          |

**전표 화면 상세**

- **Layer2 차대변 합계** — 라인 그리드 상단에 차변합계 · 대변합계 · **차액**을 실시간 표시한다. 승인은 차액 0 일 때만 가능하며, 불일치 시 세 값을 모두 담은 안내를 띄운다(FR-Ledger-10).
- **계정 선택 시 플래그 즉시 로드** — `gl_id` 확정 즉시 해당 계정의 플래그 12종을 로드해 Layer3 입력영역을 활성/비활성한다. Slot 필드의 **레이블은 실제 관리항목명**을 쓰고, 해당 Slot의 상세값만 선택 가능하다. 미등록 Slot·플래그 `false` 는 비활성. 플래그와 Slot 명칭은 뷰 `v_finance_gl_full` 한 번의 조회로 함께 얻는다([§10.3](#103-조회-경로와-페이징-c9)).
- **계정 변경 시 기존 Layer3 값 재검증 (UC-Ledger-04 예외)** — 플래그가 `true→false` 로 바뀐 항목에 값이 남아 있으면 **저장이 DB 에서 거부된다**(`50464~50466`). 따라서 계정 변경 시점에 `<ConfirmDialog />` 로 _"선택한 계정에서 사용하지 않는 관리항목 값이 있습니다. 초기화하시겠습니까?"_ 를 확인받고 초기화한다. **사용자 확인 없이 값을 버리지 않는다.** 도메인 계약은 [§7.4](#74-finance), 판정 RPC 는 [§11.4](#114-대표-rpc-매핑-발췌) 참조.
- **지급/입금일** — 계정의 `due_date` 플래그가 `true` 인 라인만 활성. 원천거래에 지급정책이 연결되어 있으면 **`ax_partner_term_calc_due` RPC 로 계산한 값**을 채우고, 없으면 권한자가 직접 입력한다. **프론트엔드는 이 계산을 재구현하지 않는다**([§9.11](#911-지급정책-계산과-전표-지급입금일-fr-term-06-fr-ledger-11)).
- **은행/카드** — 플래그가 `true` 이면 동일 회사의 **사용중** 항목만 선택 가능하고, 카드번호는 **마스킹된 값만 조회된다**(원문 컬럼에 SELECT 권한이 없다, [§9.10](#910-은행카드-fr-bank)).
- **라인 순서가 저장 결과를 결정한다** — `line_on` 은 저장 시 배열 순서대로 재부여되므로([§9.1](#91-전표-저장-검증-하나의-트랜잭션-지침-1724)), 그리드의 행 순서를 그대로 전송한다. 선택 상태는 `line_on` 이 아니라 클라이언트 임시 키로 추적한다.
- **저장은 한 번의 RPC 호출**이다 — `ax_finance_ledger_save(head, lines)`. v1.1 처럼 헤더 저장 → 라인 저장 2단계로 나누지 않는다([§11.4](#114-대표-rpc-매핑-발췌)).
- **마감연도** — `ax_finance_closing_status` RPC 로 진입 시 마감 여부를 확인해 신규/수정/삭제/승인 버튼을 일괄 비활성화한다. **DB 도 동일 조건을 독립 강제**하므로(트리거 4건) 화면 비활성화는 안내일 뿐이다(FR-Ledger-16).

### 12.6 상태 코드 표시

DB 코드값을 UI 에 직접 쓰지 않고 Enum/라벨로 변환(`<StatusBadge />`). 예: `approval_status`(boolean) → "미승인/승인", `stage`(0~6) → 라벨.

> **⚠ v2.0 에서 이 규칙의 중요도가 올라간다** — v1.1 은 서버 Mapper 가 코드값을 Enum 으로 바꿔서 내려주었으므로 화면이 원시값을 볼 일이 적었다. **v2.0 은 PostgREST 가 원시값을 그대로 내려준다.** 특히 `status` 는 테이블마다 극성이 반대이므로, `packages/shared-constants` 의 `isActive(table, v)` 를 거치지 않은 직접 비교를 **린트로 금지**한다([§10.6](#106-status-극성--v20-최대의-잔존-위험)).

---

## 13. 트랜잭션 규칙 (지침 §24)

다음은 반드시 **하나의 DB 트랜잭션**으로 처리하고 부분 성공을 허용하지 않는다:

- Head + Detail 저장 (전표 라인 일괄 재적재)
- 전표번호 생성 + 전표 저장
- 승인 상태 변경 + 승인자/승인일 저장
- 초기이월 확정 / 확정해제
- 연도 회계마감(선행검증 → 이월산출 → 차년도 INSERT → closing 기록)
- **연도 회계마감 해제**(선행검증 → `closing = false` → 자동생성 이월 회수) — C12, [§9.6](#96-연도-회계마감-해제-c12)
- 표준 GL 재생성 (기존 삭제 + seed 일괄 INSERT)
- 여러 테이블을 함께 수정하는 업무

**v2.0 의 트랜잭션 모델 — 규약에서 언어 보장으로**

v1.1 은 프로시저 75건 각각이 `SET XACT_ABORT ON` + `BEGIN TRAN` + `TRY/CATCH` + `ROLLBACK` + `THROW` 를 **직접 작성**해야 했고, 실제로 27건만 그렇게 되어 있었으며 17건이 예외였다(그중 `usp_finance_dimension_delete` 1건은 고아행을 만드는 실제 결함).

**PostgreSQL 함수는 그 자체가 원자적이다.** 함수 본문 중 어디서든 예외가 나면 함수 호출 전체가 자동 롤백된다. 따라서:

| v1.1 요소 | v2.0 |
| --------- | ---- |
| `SET XACT_ABORT ON` | **불필요** — 기본 동작 |
| `BEGIN TRAN` / `COMMIT` | **불필요** — 호출자 트랜잭션에 참여 |
| `BEGIN TRY … CATCH … ROLLBACK … THROW` | **불필요** — 예외가 자동 전파·롤백 |
| `IF @@TRANCOUNT > 0 ROLLBACK` | **작성 불가** — pl/pgsql 은 `ROLLBACK` 을 호출할 수 없다 |
| "여러 프로시저를 하나의 외부 트랜잭션으로 묶지 않는다" | **제약 소멸** — 함수를 중첩 호출해도 안전하다 |
| "`SESSION_CONTEXT` 를 쓰는 4건은 단일 커넥션 필수" | **제약 소멸** — 플래그가 트랜잭션 로컬(C6) |
| `usp_finance_dimension_delete` 의 2단 DELETE 결함 | **소멸** — 함수가 원자적이므로 고아행이 생길 수 없다 |

즉 v1.1 이 **규약으로 지켜야 했던 것**의 대부분이 v2.0 에서 **언어가 보장**한다. 이 절의 분량이 줄어드는 것은 규칙이 느슨해져서가 아니라 강제 수단이 바뀌었기 때문이다.

**남는 규칙 3건**

1. **부분 롤백이 필요하면 `BEGIN … EXCEPTION WHEN … END` 블록**을 쓴다(내부적으로 세이브포인트). v2.0 의 RPC 20건은 모두 전부-성공/전부-실패이므로 실제 사용처는 없다. 예외 블록을 남용하면 성능이 나빠지고 오류를 삼킬 위험이 있으므로 **필요할 때만** 쓴다.
2. **여러 RPC 를 하나의 업무로 묶지 않는다.** PostgREST 는 요청 1건 = 트랜잭션 1건이며 클라이언트가 여러 호출을 하나의 트랜잭션으로 묶을 수 없다. 원자성이 필요하면 **RPC 를 합친다** — `ax_finance_ledger_save` 가 head/detail 저장을 합친 이유가 이것이다([§11.4](#114-대표-rpc-매핑-발췌)).
3. **PostgREST 로 하는 단순 CRUD 는 문장 1건 = 트랜잭션 1건**이다. 두 테이블을 함께 바꿔야 하면 CRUD 가 아니라 RPC 로 만든다.

---

## 14. 요구사항 추적 매트릭스

FR/UC ID는 코드·테스트·주석에서 추적 가능해야 한다(지침 §26). 도메인별 요약:

전체 **FR 179건 · UC 135건**(원본 실측). [§1](#1-시스템-개요) 의 180건은 여기에 마감해제 `FR-Close-12`(C12 신설)를 더한 값이다 — 아래 표는 원본 분포를 보인다. **FR/UC 는 스택 전환과 무관하게 불변**이며, 바뀐 것은 「대표」열의 실행 수단뿐이다.

| 도메인   | FR (건) | UC (건) | FR 접두어                                                     | 대표 리소스 / RPC            |
| -------- | ------- | ------- | ------------------------------------------------------------- | ---------------------------- |
| COMMON   | **7**   | **5**   | FR-UI-01~07                                                   | 공통 UI · [§11.1](#111-공통-정책) 정책 |
| SYSTEM   | **55**  | **50**  | Comp 9 · Entity 9 · Dept 8 · Pod 7 · Emp 9 · Year 7 · Admin 6 | `system_*` 테이블/뷰 + Supabase Auth |
| PARTNER  | **24**  | **18**  | Client 8 · Vendor 8 · Term 8                                  | `v_partner_*` + `ax_partner_term_calc_due` |
| SALES    | **25**  | **21**  | Pipe 9 · Act 7 · Contract 9                                   | `v_sales_*` + `ax_sales_*_link_*` |
| FINANCE  | **68**  | **41**  | GL 14 · Dim 10 · Bank 8 · OpenBal 9 · Ledger 16 · Close 11    | `v_finance_*` + `ax_finance_*` RPC 13건 |
| **합계** | **179** | **135** | 20개 접두어                                                   | PostgREST 리소스 + **RPC 20건** |

FINANCE가 FR의 38%를 차지하고 UC-Ledger가 단일 접두어 최다(13건)이므로, [§16 로드맵](#16-구현-로드맵-지침-2730--vertical-slice)에서 FINANCE 핵심업무에 가장 큰 비중을 배분한다.

**추적 예시** (테스트명에 ID 포함):

```typescript
describe("LedgerApprovalPolicy", () => {
  it("FR-Ledger-13: 승인된 전표는 일반 수정할 수 없다", () => {
    /* ... */
  });
  it("FR-Ledger-10: 차변합계 ≠ 대변합계면 승인 거부", () => {
    /* ... */
  });
});
describe("Pipeline", () => {
  it("FR-Pipe-07: Closed 전환 시 closedDate를 기록한다", () => {
    /* ... */
  });
});
describe("ClosingService", () => {
  it("FR-Close-04: 미승인 전표가 있으면 마감 불가", () => {
    /* ... */
  });
  it("FR-Close-06: 자산계정 이월잔액 = 전년이월 + 차변 − 대변", () => {
    /* ... */
  });
});
```

전체 FR ↔ UC ↔ 리소스/RPC ↔ 트리거 매핑은 `AX_Bridge_DB_API_명세서.xlsx`(업무 로직 정본) 및 `AX_Bridge.xlsx`(FR/UC 시트)를 참조하되, **실행 수단 열은 [§10.2](#102-rpc-함수-계층-c4)·[§11.2](#112-리소스-카탈로그)가 정본**이다.

---

## 15. 테스트 전략 (지침 §26)

규칙의 강제 지점이 애플리케이션에서 DB 로 옮겨갔으므로([§2.3](#23-업무-규칙의-3중-배치-핵심-설계-결정)) **테스트의 무게중심도 DB 로 옮긴다.** v1.1 의 5계층 중 1·3·4 의 대부분이 **pgTAP 한 곳으로 수렴**하고, NestJS 가 사라지면서 2계층(Application Service)은 존재 이유가 없어진다.

| # | 계층 | 도구 | v1.1 대응 | 대상 |
| - | ---- | ---- | --------- | ---- |
| 1 | **스키마·RLS·트리거·RPC** | **pgTAP** (`supabase test db`) | 1 + 3 + 4 의 대부분 | 아래 15.1 |
| 2 | **채번 동시성** | Node + `pg` 다중 커넥션 | 3 의 "동시성 잠금" | 아래 15.2 |
| 3 | 프론트 유닛 | Vitest | 1 의 순수 계산 일부 | `domain/` · `lib/` · `shared-constants` |
| 4 | UI E2E | Playwright | 5 | Head/Detail 흐름, F2/Enter Lookup, DirtyGuard, 전표 3-Layer, 마감 순차 실행 |
| 5 | **보안 회귀** | 카탈로그 조회 SQL | (없음 — 신설) | 아래 [§19.1](#191-rls-가-유일한-권위) |

각 테스트명에 FR/UC ID 를 포함하여 추적성을 확보한다.

### 15.1 pgTAP 구성

```text
supabase/tests/
├─ 00_schema.sql      has_table×21 · has_pk · col_type_is · 복합 PK 컬럼 순서 · 부분 유니크 인덱스
├─ 10_rls_tenant.sql  회사 격리 (아래 15.3)
├─ 20_rls_roles.sql   VIEWER 쓰기 거부 · EDITOR 승인 거부 · APPROVER 마감 거부
├─ 30_grants.sql      컬럼 GRANT 매트릭스 (§5.3) 전량
├─ 40_triggers.sql    51001·51002·51011·51012·51021·51031·51041·51051~54
│                     + ⭐ 마감연도 검사가 우회 플래그보다 먼저인지 (§10.5 순서 회귀)
│                     + ⭐ 헤더 CASCADE 삭제 시 라인 트리거 통과 (§10.5 INSTEAD OF 재설계)
├─ 50_rpc_finance.sql closing_execute → reopen 왕복의 source='CLOSING' 회수 · 차대 균형
├─ 60_numbering.sql   slot 1~5 소진 후 50421 · 클라이언트가 보낸 채번값이 무시되는지 (C5)
├─ 70_errors.sql      RPC 실패경로별 SQLSTATE + hint(AX-xxxxx) (부록 B)
└─ 80_polarity.sql    21개 테이블 status 극성 (§10.6)
```

⭐ 표시 2건은 **순서를 바꿔도 대부분의 테스트가 통과하는** 종류의 규칙이다. 회귀하면 조용히 틀리므로 명시적으로 고정한다.

### 15.2 채번 동시성 — pgTAP 으로는 불가능

pgTAP 은 단일 세션이므로 어드바이저리 잠금을 검증할 수 없다. `tools/concurrency-test.mjs` 가 N=20 커넥션으로 동시에 다음을 단언한다.

- 같은 `(company_id, entity_id, ledger_date)` 에 전표 20건 동시 생성 → `count(distinct ledger_no) = 20` 이고 `max = 20`
- 같은 회사에 관리항목 6개 동시 생성 → 성공 5건 + `AX-50421` 1건
- 같은 파이프라인에 액티비티 50개 동시 생성 → `count(distinct activity_id) = 50` (v1.1 결함의 회귀 방지, [§9.12](#912-식별자-자동생성-규칙))

### 15.3 "회사 A 가 회사 B 의 행을 못 읽는다" 를 실제로 증명하는 법

RLS 테스트는 **거짓으로 통과하기 쉽다.** 두 가지 방식으로 거짓말한다.

1. **픽스처가 비어 있으면** "0건 조회"가 격리를 증명하지 않는다 — 애초에 데이터가 없었을 뿐이다.
2. **`postgres` 롤로 실행되면** RLS 가 적용되지 않는다. `service_role` 은 `BYPASSRLS` 이므로 그 커넥션을 쓰면 전부 통과한다.

따라서 **모든 RLS 테스트 파일 상단에 ①존재 증명과 ②롤 확인을 의무화**한다.

```sql
begin;
select plan(6);

-- ① 존재 증명 — 이게 없으면 아래 is_empty 가 아무것도 증명하지 못한다
select is( (select count(*)::int from public.finance_ledger_head where company_id='CO_B'), 3,
           'fixture: CO_B 전표 3건이 실재한다' );

-- ② 컨텍스트 전환 — 실제 JWT 클레임을 흉내낸다
select ax_test.as_user('{"sub":"…","role":"authenticated","company_id":"CO_A",
                         "entity_id":"E1","employee_id":"E0001","ax_role":"EDITOR"}'::jsonb);

-- ③ 메타 테스트 — RLS 가 적용되는 롤인가
select is( current_user, 'authenticated', 'meta: RLS 가 적용되는 롤로 실행 중' );

-- ④ 읽기 격리
select is_empty( $$ select 1 from public.finance_ledger_head where company_id='CO_B' $$,
                 'RLS: CO_A 사용자는 CO_B 전표를 0건 본다' );

-- ⑤ 쓰기 격리 — WITH CHECK (§5.2)
select throws_ok(
  $$ insert into public.finance_ledger_head(company_id, entity_id, ledger_date, ledger_name)
     values ('CO_B','E1',current_date,'침입') $$,
  '42501', null, 'RLS: 타 테넌트 INSERT 는 42501' );

-- ⑥ RPC 우회 차단 — 함수가 company_id 파라미터를 아예 받지 않는다 (§5.4)
select throws_ok( $$ select public.ax_finance_ledger_approve('2026-01-01'::date, 1) $$,
                  'PT404', null, 'RPC: CO_B 전표는 CO_A 컨텍스트에서 조회조차 되지 않는다' );

select * from finish();
rollback;
```

### 15.4 Vitest 의 중점 2건

- **`status` 극성** — `isActive(table, v)` 를 21개 테이블 각각 최소 2케이스로 검증하고, 이 모듈에 한해 **커버리지 임계 100%** 를 건다. v2.0 최대의 잔존 위험이기 때문이다([§10.6](#106-status-극성--v20-최대의-잔존-위험)).
- **오류 어댑터** — `toAxError()` 를 오류 형태 3종(RPC `ax_raise`, PostgREST 제약위반, RLS 거부) 전부에 대해 테이블 구동으로 검증한다([부록 B](#부록-b-오류코드-체계)).

> **v1.1 에서 이월되는 "조용히 틀릴 수 있는 규칙" 4건** — 강제 지점이 바뀌었으므로 검증 위치도 함께 옮긴다.
>
> | 규칙 | v1.1 검증 위치 | **v2.0 검증 위치** |
> | ---- | -------------- | ------------------ |
> | `LedgerLine.conflictsWith()` 가 값을 **지우지 않는다**([§7.4](#74-finance)) | Domain Unit | Vitest + pgTAP(`ax_finance_ledger_preview_account_change`) |
> | `Ledger.approve()` 가 **마감 검사를 승인 검사보다 먼저** 한다 | Domain Unit | pgTAP `50_rpc_finance.sql` — 메시지 정확성이 사용자 안내를 좌우한다 |
> | JSON 키의 대소문자(`Team_id`·`employee_Id`)가 한 글자라도 어긋나면 값이 조용히 NULL | (미검증) | **타입 검사** — RPC 래퍼가 `database.types.ts` 를 쓰므로 컴파일이 잡는다([§9.1](#91-전표-저장-검증-하나의-트랜잭션-지침-1724)) |
> | 지급정책 미리보기와 저장이 **같은 결과**여야 한다 | (미검증 — 통합테스트 숙제로 남음) | **문제 자체가 소멸** — 미리보기도 같은 RPC 를 호출한다([§9.11](#911-지급정책-계산과-전표-지급입금일-fr-term-06-fr-ledger-11)) |

---

## 16. 구현 로드맵 (지침 §27·§30 — Vertical Slice)

한 번에 전체 도메인을 맡기지 않고 **화면 단위 Vertical Slice** 로 진행한다. 각 슬라이스는 다음 순서로 만든다.

```
DDL/타입 확인 → RLS 정책 + GRANT → (필요 시) RPC 함수 · 트리거
→ pgTAP (정책·함수·트리거) → 타입 생성(supabase gen types)
→ domain/ Entity·VO·Policy → lib/ 질의·RPC 래퍼 → feature 훅 → React 화면
→ Vitest → Playwright E2E
```

**v1.1 대비 순서 변화** — v1.1 은 "Prisma Model → Domain → Repository → Controller → 화면"이었다. v2.0 은 **RLS 정책과 pgTAP 이 화면보다 먼저** 온다. 규칙의 강제 지점이 DB 이므로, 정책이 없는 상태로 화면을 만들면 검증되지 않은 경로가 열린 채 개발이 진행된다. 범위 밖 기능은 구현하지 않는다.

```
Phase 0  Bootstrap        : Supabase 프로젝트(local/staging/prod) · 베이스라인 마이그레이션
                            (21 테이블 + 제약 + 인덱스) · auth 헬퍼 · ax_raise · RLS 정책 전량
                            · Supabase Auth + Access Token Hook · admin 부트스트랩
                            · GitHub 레포 + Actions + Vercel 연결 (§18)
Phase 1  공통 UI          : AppToolbar · HeadDetailLayout · LookupPopup · DirtyFormGuard · StatusBadge
                            + lib/{supabase, query, rpc, errors} · shared-constants(status 극성)
Phase 2  SYSTEM           : 그룹 → 회사 → Pod/부서 → 직원(계정 연동) → 회사 기수
Phase 3  PARTNER          : 지급정책(+ calc_due RPC) → 고객사 → 거래처
Phase 4  SALES            : 파이프라인 → 액티비티(채번 트리거) → 계약(link RPC)
Phase 5  FINANCE 기준정보 : 계정과목(GL, 표준 재생성 RPC) → 관리항목(Slot 트리거) → 은행/카드(마스킹 뷰)
Phase 6  FINANCE 핵심업무 : 초기이월 → 전표(3-Layer, 저장·승인 RPC) → 마감관리(마감·해제 RPC)
Phase 7  통합             : E2E · 보안 회귀(§19.1) · 감사 로깅(§19.4) · 성능
```

의존성상 SYSTEM(조직·기수)이 선행되어야 PARTNER/SALES/FINANCE 가 성립하며, FINANCE 기준정보(GL·Dimension·Bank)가 전표보다, 전표·초기이월이 마감보다 선행된다. FR 179건 중 FINANCE 가 68건(38%)이므로 Phase 5~6 에 가장 큰 비중을 배분한다.

> **⚠ Phase 0 은 하나의 PR 로 랜딩한다** — 21 테이블 + 정책 약 80건 + 함수 약 40건 + 트리거 16건 + seed 355행으로 PR 이 크다. 계층별 파일 분리([§4.2](#42-백엔드-supabasemigrations))로 리뷰 단위를 나누되, **DB 가 반쯤 만들어진 상태로 남지 않도록 분할 머지하지 않는다.** 리뷰 부담과 원자성의 트레이드오프에서 원자성을 택한다.

### 16.1 마이그레이션 정책 (C8)

**DDL 정본은 `supabase/migrations/*.sql` 하나다.** v1.1 의 `db/01~09` + `prisma/schema.prisma` 이중관리를 폐기한다.

| 항목 | 규칙 |
| ---- | ---- |
| 실행 순서 | **파일명 타임스탬프가 강제**한다. v1.1 처럼 "순서를 반드시 지킨다"는 운영 규약이 필요 없다 |
| 베이스라인 | MSSQL `01`+`08`+`09` 의 **최종 상태**를 폴딩한다. 원본의 중첩 관계(`08` 이 `05`/`06` 을 덮고 `09` 가 다시 덮는 구조)를 재현하지 않는다([§8.1](#81-데이터-타입-기준-지침-8-9)) |
| 적용 | `supabase db push` — **미적용 마이그레이션만** 순서대로 실행. main 병합 시 GitHub Actions 가 수행([§18.3](#183-cicd)) |
| 멱등성 | 개별 파일의 멱등성은 **불필요**하다. `supabase_migrations.schema_migrations` 가 적용 여부를 추적하므로 재실행되지 않는다. v1.1 의 `WHERE NOT EXISTS` 가드 관행은 **시드에만** 유지한다(로컬 `db reset` 반복 실행 때문) |
| 스키마 변경 | **새 마이그레이션 파일을 추가**한다. 기존 파일을 수정하지 않는다 — 이미 적용된 환경에 반영되지 않아 환경 간 스키마가 갈라진다. CI 가 기존 파일 수정을 차단한다([§18.3](#183-cicd)) |
| 롤백 | **없다.** `supabase db push` 에 down 마이그레이션 관행이 없다. 잘못된 마이그레이션은 **전진 수정** 또는 PITR 복구다([§18.5](#185-백업--복구)) |
| 파괴적 변경 | `drop column` / `drop table` 은 `production` 환경 **수동 승인** 필수. 모든 마이그레이션은 CI 의 `db reset` 전체 재현으로 사전 검증한다 |
| 타입 생성 | `supabase gen types typescript` → `apps/web/src/lib/database.types.ts`. **수기 편집 금지**, CI 가 드리프트를 검사한다 |

**시드 2종의 처분**

| 시드 | v1.1 | v2.0 |
| ---- | ---- | ---- |
| 표준 GL 355행 | `07` 이 `TRUNCATE` 후 적재 — **재실행 시 전량 교체**되어 커스터마이즈분이 소실 | `20260814001300_seed_gl.sql` 마이그레이션. `TRUNCATE` 대신 `INSERT … ON CONFLICT (gl_id) DO UPDATE` 로 갱신 |
| SYSTEM 조직 + admin | `01` 말미의 `WHERE NOT EXISTS` 가드 시드 | `20260814001400_bootstrap.sql`(조직) + **`bootstrap.yml` Actions**(auth.users, [§6.5](#65-초기-admin-부트스트랩-fr-admin-0106)) |

`supabase/seed.sql` 은 **로컬 개발 전용**이다(`supabase db reset` 시 자동 적용). 테스트 픽스처와 샘플 데이터를 담고, 운영에는 절대 적용되지 않는다.

### 16.2 작업 착수 체크리스트 (지침 §28)

**한 슬라이스를 시작하기 전에** 아래 12항목을 문서화한다. 하나라도 비어 있으면 착수하지 않는다. ⑦·⑩ 은 v2.0 에서 의미가 바뀌었다.

- [ ] ① 대상 도메인 (SYSTEM / PARTNER / SALES / FINANCE)
- [ ] ② 화면 ID (`SCR-SYS-01` … `SCR-FIN-06`)
- [ ] ③ 관련 FR ID 전체
- [ ] ④ 관련 UC ID 전체 (**정상 흐름 + 예외 흐름**)
- [ ] ⑤ 사용 테이블 / 뷰
- [ ] ⑥ PK / FK 구조 (**복합 업무 PK 확인**, FK 부재 항목은 **트리거 검증**으로 대체됨을 확인 — [§9.9](#99-참조-무결성과-soft-disabledelete-지침-20))
- [ ] ⑦ **RLS 정책 4종(SELECT/INSERT/UPDATE/DELETE) + 컬럼 GRANT 작성 및 pgTAP 테스트** (구 "CompanyScope 적용 지점")
- [ ] ⑧ 삭제 / 비활성 정책 (**`status` 극성 확인** — [§10.6](#106-status-극성--v20-최대의-잔존-위험))
- [ ] ⑨ 상태 코드 → Domain Enum 매핑
- [ ] ⑩ **원자성 경계** — PostgREST 단문으로 충분한가, RPC 로 묶어야 하는가([§13](#13-트랜잭션-규칙-지침-24))
- [ ] ⑪ 사용할 공통 UI 컴포넌트
- [ ] ⑫ 기존 구현과의 중복 여부

**명세 충돌 시 규약 (지침 §28)** — 임의로 결정하지 않고 코드에 다음 주석을 남기고 본 설계서에 이슈로 등록한다.

```typescript
// TODO(명세확인): FR-XXX-nn 과 SCR-XXX-nn 화면기획서가 상충.
//   화면: …  /  FR: …  /  잠정 채택: …  /  근거: …
```

정본 우선순위는 문서 말미의 「본 설계서의 정본 관계」를 따른다.

### 16.3 미해결 이슈

v2.0 범위 밖이나 **의사결정이 필요한 항목**을 명시한다. 구현 중 마주치면 임의로 결정하지 않고 이 목록에 추가한다.

| # | 이슈 | 근거 절 | 성격 |
| - | ---- | ------- | ---- |
| 1 | **`status` 극성 정규화 여부** — 전 테이블 `is_active boolean` 통일 시 위험 종류가 소멸하나, 명세서·화면기획서와 컬럼명이 이탈한다. 이관할 운영 데이터가 없는 지금이 유일한 기회 | [§10.6](#106-status-극성--v20-최대의-잔존-위험) | **고객 승인 사항** |
| 2 | **승인취소(`unapprove`) 기능 부재** — 마감 해제 후에도 승인 전표를 정정할 수 없다. 개발지침 §14 는 Command 목록에 포함하나 구현체가 없다 | [§9.6](#96-연도-회계마감-해제-c12) | 기능 추가 요청 |
| 3 | **표준 GL seed 개정 시 기존 테넌트 재동기 절차** — `seed_version` 컬럼과 갱신 경로가 없다. 단일 설치였던 v1.1 과 달리 멀티테넌트에서는 실제 문제가 된다 | [§9.7](#97-표준-계정과목gl-재생성-fr-gl-1114) | 설계 필요 |
| 4 | **Preview 환경의 DB 분리** — Vercel Preview 가 프로덕션 DB 를 가리키면 안 된다. Supabase Branching(유료) vs 별도 staging 프로젝트 | [§18.1](#181-환경-구성) | 비용·운영 결정 |
| 5 | **Rate Limit 정밀도 손실** — "사용자당 120 req/min"을 서버 없이 유지할 수 없다 | [§19.5](#195-rate-limit) | 요구 완화 승인 |
| 6 | **`system_company`/`system_entity` CUD 권한 상향** — v1.1 의 EDITOR → ADMIN 으로 바꾸었다. 기존 권한 분포를 변경하는 결정 | [§6.4](#64-권한role-계층-fr-ui-07) | **고객 확인 필요** |
| 7 | **표준 GL seed 데이터 결함** — `2070000 감가상각누계액` 의 `contra_gl` 이 자기 자신을 가리킨다. 03.유형자산 블록의 나머지 24건은 예외 없이 "바로 위 자산계정"을 가리키므로 `2060000 기계장치` 로 보정했다. **원천 `AX_Bridge.xlsx > GL` 시트 수정이 필요하다** | [부록 C.4](#c4-이식과-함께-고치는-원본-결함) | **원천 수정 협의** |

### 16.4 구현 중 확정된 사항 (Phase 0)

설계 단계에서 예견하지 못했고 **실제로 실행해 보아야 드러난** 것들이다. 해당 절에 반영을 마쳤다.

| # | 사항 | 반영 위치 |
| - | ---- | --------- |
| 1 | **부서↔직원 순환 의존으로 신규 회사를 만들 수 없었다.** v1.1 은 SYSTEM 조직에만 예외를 둬 우회했고, 결과적으로 신규 회사 생성 경로가 없었다(`usp_system_team_save` 의 50131/50132 가 동일하게 막는다). → **지연 제약 트리거**(`deferrable initially deferred`)로 COMMIT 시점 검증으로 전환해 순환을 실제로 푼다 | [§9.9](#99-참조-무결성과-soft-disabledelete-지침-20) · 마이그레이션 10 |
| 2 | **`contra_gl` 검증이 BEFORE ROW 면 표준 GL 재생성이 항상 실패한다.** 355행을 한 번의 `INSERT…SELECT` 로 적재하는데 24행이 같은 테이블의 다른 행을 참조하기 때문이다. → 동일하게 지연 제약으로 전환 | [§7.4](#74-finance) · 마이그레이션 10 |
| 3 | **`security_invoker` 뷰와 컬럼 권한 회수는 충돌한다.** 뷰가 호출자 권한으로 실행되므로 `card_number` SELECT 를 회수하면 **뷰 자신도 그 컬럼을 읽지 못한다.** → 마스킹 값만 돌려주는 `SECURITY DEFINER` 함수(`ax_bank_card_masked`) 경유 + `is_card` 저장 계산열 | [§19.3](#193-카드번호-마스킹) · 마이그레이션 07 |
| 4 | **트리거 함수는 `SECURITY DEFINER` 여야 한다.** ① 컬럼 GRANT 로 회수한 컬럼을 트리거는 읽어야 하고 ② 검증 조회가 RLS 로 필터되면 안 된다(최후 SUPER 검사는 전 테넌트를 세어야 하는데 호출자 권한이면 자기 회사만 보여 항상 통과한다) | [§10.5](#105-트리거-db-계층-최후-방어선) |
| 5 | **`numeric` 컬럼에 `ax_safe_int(text)` 를 쓰면 안 된다.** `actual_year` 는 `numeric(10,2)` 라 `'2026.00'` 이 되어 정규식 `^-?\d+$` 이 거부한다. 원본 `CONVERT(int, …)` 는 절삭이므로 **`trunc(x)::int`** 가 정확한 대응이다. 마감 관련 11개소 | [부록 C.3](#c3-기계적-치환) |
| 6 | **식별자를 전부 소문자로 정규화**했다. 원본의 `Team_id`·`employee_Id`·`DRCR` 은 PostgreSQL 에서 따옴표 없이는 소문자로 접히며, 따옴표를 붙이면 모든 질의가 오염된다. 부수 효과로 [§9.1](#91-전표-저장-검증-하나의-트랜잭션-지침-1724) 이 경고한 "JSON 키 대소문자 불일치로 값이 조용히 NULL" 위험이 **소멸**한다 | 마이그레이션 02 헤더 |
| 7 | `sales_pipeline_detail.[type]` → **`activity_type`** 개명. `type` 은 원본에서도 대괄호로 감싸야 했던 예약어다 | 마이그레이션 05 |

### 16.5 실행으로만 드러난 결함 (Phase 6)

Phase 6 에서 RPC 를 **실제 호출해 본 뒤에야** 드러난 것들이다. 셋 다 마이그레이션 적용·타입검사·빌드를 모두 통과했다 — pl/pgsql 함수 본문은 생성 시점에 계획되지 않으므로, `CREATE FUNCTION` 성공은 그 함수가 동작한다는 증거가 **아니다**.

| # | 결함 | 왜 조용했나 | 고침 |
| - | ---- | ----------- | ---- |
| 1 | **초기이월 확정이 전면 불능이었다.** `ax_finance_openbalance_close` 가 `select sum(…) … for update` 를 썼다. PostgreSQL 은 집계 쿼리에 `FOR UPDATE` 를 허용하지 않는다 | MSSQL 의 `WITH (UPDLOCK, HOLDLOCK)` 은 **잠금 힌트**라 집계에도 붙는다. PG 의 `FOR UPDATE` 는 **행 잠금 절**이다. 직역이 성립하지 않는 지점 | **잠금과 집계를 분리** — 먼저 `perform 1 … for update`, 그 다음 집계. 마이그레이션 16 |
| 2 | **계정 변경 미리보기가 충돌이 있을 때만 터졌다.** `v_conflicts := v_conflicts \|\| 'bank_id'` 에서 타입 미지정 리터럴이 `text[]` 로 캐스팅되어 `22P02 malformed array literal` | 충돌이 없으면 어느 분기도 타지 않아 **정상 응답**이 나온다. "잘 도는 것처럼 보이다가 정확히 필요한 순간에만" 실패한다. [UC-Ledger-04](#74-finance) 의 확인 대화상자가 영영 뜨지 않는다 | `array_append()` 로 교체. 요소 추가라는 의도를 타입이 고정한다. 마이그레이션 17 |
| 3 | **`ax_require_role` 은 JWT 클레임이 아니라 `auth_role_rank_live()` 로 현재 DB 값을 읽는다.** 역할을 바꾸면 재로그인 없이 즉시 적용된다 | 의도된 설계지만([§6.2](#62-클레임-주입--custom-access-token-hook)) RLS 정책은 클레임 기반이라 **둘이 갈릴 수 있다.** 권한 경계 테스트가 이 차이로 조용히 무력화된다 | 결함 아님 — 검증 스크립트가 토큰 발급 시점의 역할을 가정하지 않도록 고쳤다 |

> **⚠ 여기서 얻을 교훈** — Phase 0~5 에서도 반복된 패턴이다. **DDL 이 적용됐다는 사실은 그 코드가 동작한다는 증거가 아니다.** `scripts/verify-screens.mjs` 가 모든 RPC 를 실제로 한 번씩 호출하는 이유가 이것이며, 새 RPC 를 추가하면 반드시 여기에도 한 줄을 더한다([§15](#15-테스트-전략-지침-26)).

---

## 17. Definition of Done

하나의 기능은 다음을 모두 충족해야 완료로 본다(지침 §32):

- [ ] 관련 FR 구현 완료
- [ ] 관련 UC 정상/예외 흐름 구현 완료
- [ ] **RLS 정책 4종 작성 + 타 회사 격리 pgTAP 통과**(존재 증명·롤 확인 포함 — [§15.3](#153-회사-a-가-회사-b-의-행을-못-읽는다-를-실제로-증명하는-법))
- [ ] **컬럼 GRANT 검토** — 승인·마감·역할·카드번호 등 상위 권한 컬럼이 `authenticated` 에 열려 있지 않음([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법))
- [ ] 프론트 Domain Validation 적용 (UI-only 검증에 의존하지 않음 — DB 강제와 병행)
- [ ] DB Constraint / 트리거 방어 적용 — **무결성 제약(FK·유니크·XOR) + 열거형 CHECK 양쪽**([§8.1](#81-데이터-타입-기준-지침-8-9))
- [ ] 원자성 경계 검토 (PostgREST 단문 vs RPC — [§13](#13-트랜잭션-규칙-지침-24))
- [ ] **`supabase.from()`/`.rpc()` 직접 호출 없음** — `lib/` 래퍼와 feature 훅 경유([§2.1](#21-계층-의존성) 규칙 2)
- [ ] **뷰에 `WITH (security_invoker = on)` 적용** · `SELECT *` 없음([§10.3](#103-조회-경로와-페이징-c9))
- [ ] **조회 경로에 마스킹·`status` 극성이 함께 이관되었는지 확인**([§10.3](#103-조회-경로와-페이징-c9) · [§10.6](#106-status-극성--v20-최대의-잔존-위험))
- [ ] `supabase gen types typescript` 재생성 및 커밋 (수기 편집 없음)
- [ ] pgTAP / Vitest / 주요 Playwright E2E 통과
- [ ] 공통 UI 사용 (중복 구현 없음)
- [ ] Error Message(한글, `AX-` 코드) 처리 — [부록 B](#부록-b-오류코드-체계)
- [ ] 권한 처리 (Role 별 403)
- [ ] 미저장 변경 보호(DirtyGuard)
- [ ] 코드 포맷/린트 통과
- [ ] FR/UC ID 추적 가능

**금지사항 재확인 (지침 §29, v2.0 개정)** — 컴포넌트에서 `supabase` 직접 호출, React 에서 SQL/DB 개념 처리, `domain/` 의 프레임워크 의존, **`service_role` 키를 프론트엔드에 노출**, **RLS 없는 테이블 배포**, **`security_invoker` 없는 뷰**, **`search_path` 없는 `SECURITY DEFINER` 함수**, 중복 Lookup/Toolbar, UI-only 규칙 검증, ID 만으로 타 회사 조회, 금액 float, `status` 리터럴 직접 비교, nullable 업무 FK 의 PK 포함, **클라이언트에서 전표번호 생성**, FR/UC 근거 없는 규칙 추가, 불필요한 대규모 리팩터링/Generic Repository/Event Bus/Microservice 도입.

---

## 18. 배포 · 인프라

v1.1 에는 이 장이 **없었다** — 온프레미스 설치형이라 배포가 "설치 문서"의 몫이었고, SQL Server TCP 활성화·`sqlcmd` 실행 같은 절차가 README 에 있었다. 웹서비스 전환의 핵심이 이 장이므로 신설한다.

### 18.1 환경 구성

| 환경 | Supabase | 프론트엔드 | 용도 |
| ---- | -------- | ---------- | ---- |
| **local** | Supabase CLI (Docker) — Postgres · PostgREST · GoTrue · Studio | `pnpm --filter web dev` | 개발·pgTAP 실행 |
| **staging** | 별도 Supabase 프로젝트 | Vercel Preview | PR 검증·수용 테스트 |
| **production** | 프로덕션 Supabase 프로젝트 | Vercel Production | 운영 |

```bash
supabase start        # 로컬 스택 기동 (마이그레이션 전량 + seed.sql 자동 적용)
supabase db reset     # 마이그레이션 재적용 — 베이스라인이 처음부터 재현되는지 검증
supabase test db      # pgTAP (§15.1)
pnpm --filter web dev
```

로컬 anon 키는 모든 설치에서 동일한 고정값이므로 **비밀이 아니다.** `.env.example` 에 커밋한다.

> **⚠ 미결 — Preview 환경의 DB 분리**([§16.3](#163-미해결-이슈) #4). Vercel Preview 가 프로덕션 DB 를 가리키면 안 된다. Supabase Branching(유료, PR 별 DB 자동 생성) 과 별도 staging 프로젝트 중 선택이 필요하다. staging 을 택하면 마이그레이션이 두 곳에 적용되는 순서 관리가 추가된다.

### 18.2 GitHub 레포 구조

레포: **`freeegg76/AX_Core_ERP_Cloud`** (신규). 기존 `freeegg76/AX_Core_ERP`(MSSQL·NestJS)는 온프레미스판으로 보존한다.

- `main` — 보호 브랜치. 프로덕션과 1:1. 직접 push 금지, PR 필수.
- `feat/<slice>` — [§16](#16-구현-로드맵-지침-2730--vertical-slice) 의 Vertical Slice 단위.
- 마이그레이션 파일은 **추가만** 한다. 기존 파일 수정·삭제는 CI 가 차단한다([§16.1](#161-마이그레이션-정책-c8)).

### 18.3 CI/CD

**PR 검증 (`.github/workflows/ci.yml`)**

```yaml
- supabase start                     # 마이그레이션 전량 + seed 적용 — 베이스라인 재현 검증
- supabase test db                   # pgTAP (§15.1)
- node tools/concurrency-test.mjs    # 채번 동시성 (§15.2)
- psql -f tools/check-security.sql -v ON_ERROR_STOP=1   # 보안 회귀 (§19.1)
- supabase gen types typescript --local > /tmp/db.ts
  && diff -u apps/web/src/lib/database.types.ts /tmp/db.ts   # 타입 드리프트
- git diff --diff-filter=MD --name-only origin/main...HEAD -- supabase/migrations/ | wc -l  # 0 이어야 함
- pnpm lint && pnpm test             # ESLint + Vitest
- '! grep -rniE "service_role" apps/web packages'          # ⭐ 하드 가드 (§19.2)
```

**배포 (`.github/workflows/deploy.yml`, main push)**

```yaml
environment: production              # 수동 승인 게이트
- supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_ID }}
- supabase db push                   # 미적용 마이그레이션만 순서대로
- supabase config push               # Auth Hook 등록 등 (§6.2)
- curl -X POST "${{ secrets.VERCEL_DEPLOY_HOOK }}"   # ⭐ DB 성공 후에만 프론트 승격
```

> **⚠ 배포 스큐 — 마지막 줄이 대응책이다.** Vercel 의 GitHub 자동배포와 `db push` 가 **병렬로 실행되면 프론트가 먼저 뜨고 아직 없는 RPC 를 호출한다.** Vercel 자동 Git 배포를 `vercel.json` 의 `ignoreCommand` 로 끄고, **DB 마이그레이션 성공 후 deploy hook 으로만 프로덕션을 승격**한다.
>
> 그럼에도 순서 보장은 완전하지 않으므로 **모든 DB 변경은 가산적(additive)** 이어야 한다. RPC 제거·컬럼 삭제는 그것을 호출하지 않는 프론트가 배포된 **이후 별도 릴리스**에서만 한다.

### 18.4 시크릿 관리

| 위치 | 값 | 규칙 |
| ---- | -- | ---- |
| Vercel (Production/Preview) | `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` | **이 둘뿐이다.** `VITE_` 접두 변수는 Vite 가 번들에 인라인하므로 **여기 들어간 것은 전부 공개**다 |
| GitHub Secrets | `SUPABASE_ACCESS_TOKEN` · `SUPABASE_PROJECT_ID` · `SUPABASE_DB_PASSWORD` · `VERCEL_DEPLOY_HOOK` | service_role 키 없음 |
| GitHub Environment `bootstrap` | `BOOTSTRAP_ADMIN_EMAIL` · `BOOTSTRAP_ADMIN_PASSWORD` · `SUPABASE_SERVICE_ROLE_KEY` | `bootstrap.yml` 전용([§6.5](#65-초기-admin-부트스트랩-fr-admin-0106)). **프론트 빌드 잡과 같은 job 에 두지 않는다** |

**런타임 어서션** — `lib/supabase.ts` 부팅 시 anon 키의 JWT payload 를 디코드해 `role === 'anon'` 이 아니면 즉시 throw 한다. service_role 키를 실수로 Vercel 변수에 넣는 사고를 **배포 직후 1초 만에** 검출한다.

### 18.5 백업 · 복구

- **자동 백업** — Supabase 플랜별 일일 백업. **PITR**(Point-in-Time Recovery)은 유료 플랜에서 활성화한다.
- **롤백이 없다는 사실을 전제로 운영한다** — `supabase db push` 에는 down 마이그레이션 관행이 없다([§16.1](#161-마이그레이션-정책-c8)). 잘못된 마이그레이션의 복구 경로는 **① 전진 수정 마이그레이션 ② PITR** 두 가지뿐이다.
- 따라서 **CI 의 `supabase db reset` 전체 재현**이 사실상의 롤백 대비다 — 베이스라인부터 처음까지 재현되지 않는 마이그레이션은 머지되지 않는다.
- 파괴적 문장(`drop column`/`drop table`)은 `production` 환경 **수동 승인** 필수.

### 18.6 관측

| 대상 | 수단 |
| ---- | ---- |
| API 요청·오류 | Supabase Logs (PostgREST · GoTrue · Postgres) |
| 느린 질의 | `pg_stat_statements` — v1.1 에는 성능 관측 수단이 아예 없었다 |
| 업무 행위 이력 | **`ax_audit_log`**([§19.4](#194-감사-로깅)) |
| 함수 오류 상세 | **`ax_error_log`** — `ax_raise()` 가 함수명·인자 요약·`request_id` 를 기록([부록 B.5](#b5-관측--plpgsql-의-약점-보완)) |
| 프론트 | Vercel Analytics · 브라우저 오류 수집 |

> **⚠ pl/pgsql 의 관측성은 NestJS 보다 나쁘다** — 스택트레이스도 APM 연동도 없고 SQLSTATE + 메시지가 전부다. `ax_error_log` 가 이 격차를 메우는 유일한 수단이므로 **Phase 0 에서 함께 만든다.** 나중에 붙이면 정작 문제가 생겼을 때 이력이 없다.

### 18.7 비용

| 항목 | 무료 티어 | 유료 전환 시점 |
| ---- | --------- | -------------- |
| Supabase | DB 500MB · 대역 5GB/월 · MAU 50,000 | **PITR·브랜칭이 필요해지는 시점**이 실질 기준이다. 용량보다 이쪽이 먼저 온다 |
| Vercel | Hobby (개인·비상업) | **업무 시스템은 상업적 이용**이므로 Pro 필요 |
| GitHub Actions | 퍼블릭 무제한 / 프라이빗 2,000분·월 | 마이그레이션 배포는 짧아 초과 가능성 낮음 |

v1.1 의 온프레미스 대비 **서버·라이선스·설치 인건비가 사라지고 구독료로 대체**된다. 사용자 규모별 상세 추정은 계약 단계에서 산출한다.

---

## 19. 보안

v1.1 의 보안 규칙은 §6(인증)·§9.10(마스킹)·§11.1(감사) 등에 흩어져 있었다. 강제 지점이 DB 로 옮겨간 v2.0 에서는 **하나의 장으로 모아 CI 검사 항목과 1:1 대응**시킨다.

### 19.1 RLS 가 유일한 권위

**원칙 — 애플리케이션 코드에 RLS 우회 경로를 만들지 않는다.** `service_role` 은 `BYPASSRLS` 이므로, 그 키를 쓰는 코드가 하나라도 있으면 테넌트 격리 전체가 그 코드의 정확성에 의존하게 된다. v2.0 에서 `service_role` 의 유일한 사용처는 **부트스트랩 Actions**([§6.5](#65-초기-admin-부트스트랩-fr-admin-0106))다.

**`tools/check-security.sql` — CI 가 카탈로그를 조회해 위반 시 실패**

| # | 검사 | 잡아내는 사고 |
| - | ---- | ------------- |
| 1 | `public` 의 모든 테이블에 `relrowsecurity = true` | RLS 를 켜지 않은 테이블 배포 |
| 2 | 모든 테이블에 SELECT/INSERT/UPDATE/DELETE 정책이 각각 1건 이상 (`finance_GL_seed`·`finance_closing`·`finance_dimension_detail` 은 화이트리스트) | 정책 누락 = 조용한 전면 차단 또는 전면 개방 |
| 3 | `public` 함수에 `PUBLIC`/`anon` EXECUTE 권한 없음. RPC 20건만 `authenticated` 에 부여 | 미인증 호출 가능한 함수 |
| 4 | 모든 `prosecdef = true` 함수의 `proconfig` 에 `search_path=` 포함 | **검색경로 하이재킹** |
| 5 | **모든 뷰의 `reloptions` 에 `security_invoker=true`** | ⭐ **v2.0 최대의 사고 경로** — 아래 |
| 6 | 어떤 뷰 정의에도 `SELECT *` 없음 (`pg_get_viewdef` 정규식) | DDL 변경 시 컬럼 유출 |
| 7 | `finance_bank_account.card_number` 에 `authenticated` SELECT 권한 없음 | 카드번호 원문 노출 |

> **⚠ #5 를 별도로 강조하는 이유** — PostgreSQL 의 뷰는 기본값이 `security_invoker = off` 이고, 그 경우 **뷰가 소유자 권한으로 실행되어 RLS 를 통째로 우회**한다. `create view v_x as select …` 를 무심코 쓰면 그 뷰는 모든 회사의 데이터를 반환한다. v2.0 은 마스킹·`SELECT *` 대체·조인 목적으로 **뷰를 11개 이상** 만들므로 이것은 이론적 위험이 아니라 실질적 사고 경로다.

**RLS·정책 모델은 v2.0 에서 완전히 새로 쓰는 보안 코드다.** v1.1 의 권한 분포(EDITOR 53 / VIEWER 29 / ADMIN 6 / APPROVER 2)는 애플리케이션 상수 한 파일에 있었고, 이것이 정책 약 80건 + GRANT 수십 건으로 재구현된다. **한 줄 누락이 조용한 데이터 유출**이 되므로, 위 카탈로그 검사가 사실상 유일한 그물이다.

### 19.2 키 취급 규칙

- **`anon` 키는 공개 정보다.** 브라우저 번들에 들어가는 것이 정상이며 숨길 필요가 없다. 보안은 키가 아니라 RLS 가 제공한다.
- **`service_role` 키는 브라우저·프론트 레포 어디에도 두지 않는다.** CI 의 `grep` 하드 가드가 강제한다([§18.3](#183-cicd)).
- Supabase JWT Secret 회전 시 모든 세션이 무효화된다 — 계획된 시각에 수행한다.

### 19.3 카드번호 마스킹

v1.1 은 "조회 프로시저가 마스킹된 값만 반환한다"는 **관행**이었고, Query Service 전환 시 "마스킹 누락이 가장 쉬운 사고 지점"으로 지목되었다. v2.0 은 이를 **권한으로 강제**한다.

```sql
revoke select (card_number) on public.finance_bank_account from authenticated;
create view public.v_finance_bank_account with (security_invoker = on) as
  select bank_id, bank_name, bank_account,
         case when card_number is null then null
              else repeat('*', length(card_number) - 4) || right(card_number, 4) end as card_number_masked,
         status
    from public.finance_bank_account;
```

원문 컬럼을 조회하려는 질의는 **권한 오류로 실패**한다. 누락하면 조용히 새는 것이 아니라 시끄럽게 깨진다 — 이것이 개선의 핵심이다.

### 19.4 감사 로깅

**v1.1 대비 가장 큰 기능 후퇴 지점이며, 그만큼 신중히 대체한다.**

v1.1 §11.1 은 *"모든 쓰기 요청의 user_id·IP·경로·결과코드 기록"* 을 NestJS 인터셉터로 구현했고, 다음과 같이 그 중요성을 명시했다 — *"`approved_date` 를 제외한 업무일자가 일 단위이므로, 초 단위 행위 이력은 이 로그가 유일한 근거다."* **PostgREST 는 이것을 제공하지 않는다.**

**대체 — `ax_audit_log` 테이블 + 쓰기 테이블 전체에 AFTER 트리거**

| 항목 | 취득 방법 |
| ---- | --------- |
| 사용자 | `auth_employee_id()` · `auth.uid()` |
| 회사 스코프 | `auth_company_id()` · `auth_entity_id()` |
| 대상 | `TG_TABLE_NAME` · `TG_OP` · 행 PK |
| 변경 내용 | `to_jsonb(OLD)` / `to_jsonb(NEW)` — **`user_pass` 는 컬럼 자체가 없고**, `card_number` 는 마스킹 후 저장 |
| IP | `current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'` |
| 시각 | `clock_timestamp()` — **초 단위 이력의 유일한 근거** |

보존기간은 감사 요건에 맞춰 설정하고, 파티셔닝 또는 주기적 아카이빙으로 테이블 비대화를 막는다.

> **⚠ 이 항목은 Phase 0 에서 만든다.** 나중에 붙이면 그 사이 기간의 이력이 영구히 없다.

### 19.5 Rate Limit

v1.1 은 NestJS `ThrottlerGuard` 로 **사용자당 120 req/min + `Retry-After`** 를 구현했다. **서버가 없는 v2.0 은 이 정밀도를 유지할 수 없다.**

| 계층 | 수단 | 정밀도 |
| ---- | ---- | ------ |
| Supabase 플랫폼 | 프로젝트 단위 요청 한도 | 프로젝트 |
| Vercel / Cloudflare WAF | IP 단위 제한 | IP |
| GoTrue | 로그인·비밀번호 재설정 시도 제한 | 이메일·IP |

**사용자 단위 제어는 의도적으로 포기한다.** 이것은 명시적 요구 완화이며 고객 승인이 필요하다 → [§16.3](#163-미해결-이슈) #5. 남용이 실제 문제가 되면 `ax_audit_log` 기반 사후 탐지 + 계정 정지로 대응한다.

---

## 부록 A. 코드값 사전

> **⚠ `status` 극성이 도메인별로 반대다.** 코드에서 리터럴을 직접 비교하지 말고 `isActive(table, v)` 를 경유한다 — [§10.6](#106-status-극성--v20-최대의-잔존-위험).
> v1.1 은 서버 Mapper 가 이 차이를 숨겼으나, **v2.0 은 PostgREST 가 원시 boolean 을 그대로 브라우저에 돌려준다.** 이 표의 중요도가 올라간다.

| 항목                                     | 코드                                                    | 의미                                                                                      |
| ---------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| status (company/entity/pod/team/bank)    | `false` / `true`                                        | **`false`:사용** / `true`:미사용                                                          |
| status (term/client/vendor/GL/dimension) | `true` / `false`                                        | **`true`:사용** / `false`:미사용                                                          |
| user_yn                                  | `true` / `false`                                        | 사용자 계정 활성 / 비활성 (`auth.users.banned_until` 과 연동 — [§6.1](#61-인증-흐름))     |
| ax_role                                  | VIEWER / EDITOR / APPROVER / ADMIN / SUPER              | 권한 서열 10/20/30/40/50 ([§6.4](#64-권한role-계층-fr-ui-07)) — **v2.0 신설**             |
| employee status                          | planned/probation/active/on_leave/leaving_soon/inactive | 재직상태 6종                                                                              |
| partner_term base_rule                   | EOM / CURM                                              | 월말기준 / 당월기준                                                                       |
| pipeline_type                            | 0~4                                                     | 대행/사입/리테일/마케팅/기타                                                              |
| pipeline stage                           | 0~6                                                     | Lead/QualifiedLead/Suggest/Meeting/Nego/Closed/Canceled                                   |
| activity type                            | 0~3                                                     | 메일/전화/미팅/기타                                                                       |
| contract_type                            | 0~5                                                     | 계약 유형                                                                                 |
| contract status                          | 0~2                                                     | Active/Inactive/Suspend                                                                   |
| gl_type                                  | 0~10                                                    | 자산/부채/자본/수익/매출원가/제조원가/용역원가/판매관리비/영업외수익/영업외비용/법인세 등 |
| gl_detail                                | 0 / 1                                                   | 보통계정 / 차감항목                                                                       |
| vat_gl                                   | 매입부가가치세 / 매출부가가치세 / NULL                  | 부가세 구분                                                                               |
| DRCR                                     | 1 / 2                                                   | 차변 / 대변                                                                               |
| ledger_type                              | 0~3                                                     | 일반/매입/매출/결산                                                                       |
| approval_status                          | `false` / `true`                                        | 미승인 / 승인                                                                             |
| open_balance.closed                      | `false` / `true`                                        | 미확정 / 확정                                                                             |
| open_balance.source                      | MANUAL / CLOSING                                        | 수기 입력 / 연도마감 자동생성 ([§9.6](#96-연도-회계마감-해제-c12))                        |
| closing.closing                          | `false` / `true`                                        | 미마감 / 회계마감 (행 없으면 미마감)                                                      |
| Dimension slot_no                        | 1~5                                                     | 관리항목 Slot                                                                             |

> **문자열 코드값(`pipeline_type`·`stage`·`gl_type` 등)은 v2.0 에서 CHECK 제약을 갖는다** — v1.1 은 프로시저 검증에만 의존했으나, PostgREST 직접 쓰기가 가능해졌으므로 DB 가 강제해야 한다([§8.1](#81-데이터-타입-기준-지침-8-9)).

## 부록 B. 오류코드 체계

번호 체계는 `50` + 도메인 숫자 + `xx` 이고, 오브젝트별로 10 단위 서브블록(`x01`, `x11`, `x21`…)을 쓴다.

| 범위        | 계층                                  | 실제 사용 코드                                                                                                                                                                                                         |
| ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50001·50002 | AUTH                                  | **2건뿐**, 둘 다 `usp_auth_change_password`(빈 해시 / 대상 없음·`user_yn=0`). `usp_auth_get_credential`·`_update_last_login` 은 THROW 하지 않는다                                                                      |
| 501xx       | SYSTEM (프로시저)                     | company 50101~03 · entity 50111~14 · pod 50121~23 · team 50131~36 · employee 50141~47 · year 50151~56                                                                                                                  |
| 502xx       | PARTNER                               | term 50201~06 · client 50211~15 · vendor 50221~25                                                                                                                                                                      |
| 503xx       | SALES                                 | pipeline 50301~06 · link/delete 50311~15 · activity 50321~24 · contract 50331~37 · link_ledger/delete 50341~45                                                                                                         |
| 504xx       | FINANCE (프로시저)                    | GL 50401~07 · generate_standard 50411~12 · dimension 50421~28 · openbalance_save 50431~37 · close/reopen 50441~43 · ledger_head 50451~52 · ledger_detail 50461~66 · approve 50471~73 · delete 50474~75 · bank 50481~87 |
| 505xx       | FINANCE v3 (마감·초기이월)            | check_year_open **50501** · closing_execute 50511~16 · openbalance v3 50521~24 · **closing_reopen 50531~35 (D4 신설)**                                                                                                 |
| 51xxx       | 트리거 (DB 계층 이중 방어)            | 51001 · 51011 · 51012 · 51021 · 51031 · 51041 · **51051~51054**(v3 마감 잠금)                                                                                                                                          |
| 59xxx       | **마이그레이션 스크립트 전용** (`09`) | 59001 (제약 추가 전 기존 데이터 위반 검사). 런타임에 발생하지 않으므로 `AX-` 매핑 대상이 아니다                                                                                                                        |

**⚠ 매핑 테이블 작성 시 주의할 3가지**

1. **`50443` 은 v3 이후 사문화되었다.** `05` 의 `usp_finance_openbalance_reopen` 에 있던 코드로, `08` 의 교체본에서 제거되고 **50523 / 50524** 로 대체되었다. 살아 있는 코드로 등록하면 안 된다.
2. **`50521` 이 두 곳에서 중복 사용된다** — 초기이월 저장과 확정. 전체에서 유일한 비고유 코드다. HTTP 상태·사용자 안내를 코드만으로 분기하면 오작동하므로, **v2.0 이식 시 확정 경로를 `50525` 로 분리**한다(오류코드 사전 개정 → [§16.3](#163-미해결-이슈)). 분리 전까지는 호출 컨텍스트와 함께 해석한다.
3. **v3 에서 메시지가 바뀐 코드가 있다** — 「마감 → 확정」 용어 분리에 따라 50432·50441·51031 의 문구가 변경되었다. **`08` 의 문구가 정본**이다.

`50000` 은 주석에만 등장하고 실제 코드로는 쓰이지 않는다. **v2.0 신설 코드 2건** — `51002`(마지막 활성 SUPER 보호, [§6.5](#65-초기-admin-부트스트랩-fr-admin-0106))와 `403xx` 대역(RPC 내 역할 검사 거부, 아래).

### B.1 SQLSTATE 로의 이전 (C7)

문제는 이것이다 — **PostgREST 응답은 `50464` 라는 숫자를 자동으로 실어주지 않는다.** T-SQL 의 `THROW 50464` 는 드라이버 오류 객체의 `number` 필드에 그대로 들어왔지만, PostgreSQL 예외가 브라우저까지 가는 경로는 SQLSTATE·message·detail·hint 네 개뿐이다.

**해결 — SQLSTATE 는 HTTP 상태 제어에 쓰고, AX 코드는 `hint` 에 싣는다.**

PostgREST 는 SQLSTATE 가 `PT` 로 시작하면 **뒤 3자리를 HTTP 상태 코드로 해석**한다. 이 성질을 이용해 헬퍼 하나로 통일한다.

```sql
-- 20260814000200_auth_helpers.sql
create or replace function public.ax_raise(p_code int, p_msg text, p_http int default 400)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'PT' || lpad(p_http::text, 3, '0'),   -- HTTP 상태 제어 (PT400/PT403/PT404/PT409)
    message = p_msg,                                 -- 한글 메시지 (v1.1 문구 그대로)
    hint    = 'AX-' || p_code::text;                 -- AX-50464 — 코드 보존
end $$;
```

호출부는 v1.1 의 `THROW 50464, N'…', 1` 과 거의 1:1 대응한다.

```sql
perform public.ax_raise(50464, '선택한 계정에서 사용하지 않는 관리항목 값이 있습니다.');
perform public.ax_raise(40301, '전표 승인 권한이 없습니다.', 403);
```

### B.2 HTTP 상태 매핑

| AX 대역 | 성격 | HTTP | 비고 |
| ------- | ---- | ---- | ---- |
| 50xxx (검증 실패) | 업무 규칙 위반 | **400** | 기본값 |
| 40xxx (**v2.0 신설**) | RPC 내 역할 검사 거부 | **403** | RLS 가 잡지 못하는 컬럼·행위 단위 거부([§5.3](#53-역할-경계--승인마감을-postgrest-로-우회할-수-없게-하는-법)) |
| 대상 없음 계열(50451·50531 등) | 조회 실패 | **404** | `ax_raise(…, 404)` |
| 중복·참조 충돌 | 유니크/FK 위반 | **409** | 아래 B.3 |
| 51xxx (트리거) | 상태 잠금 위반 | **409** | 승인·마감분 보호는 "충돌"이 정확한 의미다 |

### B.3 어댑터가 처리해야 하는 오류 형태 3종

v1.1 은 오류가 한 종류(프로시저 THROW)였다. **v2.0 은 세 종류가 서로 다른 모양으로 온다** — `lib/errors.ts` 의 `toAxError()` 가 이를 하나로 정규화한다.

| # | 발생원 | supabase-js 가 주는 것 | 어댑터 처리 |
| - | ------ | ---------------------- | ----------- |
| ① | RPC 의 `ax_raise` | `{code:'PT400', message:'한글…', hint:'AX-50464'}` | `hint` 에서 AX 코드 추출, `message` 그대로 표시 |
| ② | 제약 위반 (PostgREST 직접 쓰기) | `{code:'23505'/'23503'/'23514', message:'duplicate key…', details:'Key (…)=…'}` | **영문 원문을 사용자에게 보이지 않는다.** 제약명 → 한글 메시지 사전으로 변환 |
| ③ | RLS 거부 | `{code:'42501', message:'new row violates row-level security policy'}` | "권한이 없습니다" 로 일괄 변환. **원문 노출 금지** — 정책 구조가 새어 나간다 |

②의 사전이 v2.0 에서 새로 필요한 작업이다. 제약명이 곧 메시지 키가 되므로 **제약 이름을 의미 있게 짓는다**(`CK_bank_one`, `UX_dim_value`, `FK_ld_gl` …).

```typescript
// lib/errors.ts
export function toAxError(e: PostgrestError): AxError {
  if (e.hint?.startsWith("AX-"))  return { code: e.hint, message: e.message };        // ①
  if (e.code === "42501")         return { code: "AX-40300", message: "권한이 없습니다." }; // ③
  const known = CONSTRAINT_MESSAGES[extractConstraint(e)];                             // ②
  if (known)                      return known;
  return { code: `AX-${e.code}`, message: "처리 중 오류가 발생했습니다." };            // 원문 미노출
}
```

화면은 여기서 나온 `{code, message}` 를 v1.1 과 동일한 형태로 소비한다 — **UI 코드 관점에서는 오류 처리가 바뀌지 않는다.**

### B.4 재시도 분류

`50323`(activity_id 중복)은 v1.1 에서 채번 경합으로 발생해 재시도 대상이었다. **v2.0 은 어드바이저리 잠금 + 시퀀스 부가로 채번을 해결하므로 이 재시도가 불필요**하다([§9.12](#912-식별자-자동생성-규칙)). 그 외 어떤 코드도 자동 재시도하지 않는다.

### B.5 관측 — pl/pgsql 의 약점 보완

**PostgreSQL 함수는 NestJS 보다 디버깅이 나쁘다.** 스택트레이스가 없고 SQLSTATE + 메시지가 전부다. 이를 보완하기 위해 `ax_raise()` 를 확장해 **예외 발생 시 `ax_error_log` 에 함수명·인자 요약·`request_id`(요청 헤더에서)를 함께 기록**한다. 사용자 문의를 받았을 때 재현 없이 원인을 짚을 수 있는 유일한 수단이다([§18.6](#186-관측)).

---

## 부록 C. MSSQL → PostgreSQL 이식 대조표

v1.1 의 부록 C 는 `09_AX_Bridge_Fix.sql` 스펙이었다. **v2.0 에서 그 파일은 존재하지 않는다** — 수정 대상이던 결함은 전부 베이스라인 DDL 에 반영되었고(C8, [§8.1](#81-데이터-타입-기준-지침-8-9)), 그 절의 역할은 끝났다.

이 부록은 그 자리를 **이식 대조표**로 대체한다. `Planning_Docs/01~09_*.sql` 을 PostgreSQL 로 옮길 때 **직역하면 조용히 틀리는 지점**을 모아 둔 것이며, 구현 시 이 표를 체크리스트로 쓴다.

> **좋은 소식부터** — 원본에 **동적 SQL·`sp_executesql`·`FOR JSON PATH`·연결서버·테이블값 매개변수·CLR·`IDENTITY` 테이블 컬럼·시퀀스·`TOP`·`ROWVERSION`·임시 테이블·파티셔닝이 하나도 없다.** 전형적인 T-SQL 포팅보다 표면적이 좁다.

### C.1 구조적 재설계가 필요한 것 (직역 불가)

| 구성 | 원본 | v2.0 | 근거 절 |
| ---- | ---- | ---- | ------- |
| `INSTEAD OF` 트리거 3건 | 테이블에 부착 | **PostgreSQL 은 뷰에만 허용** → `BEFORE … ROW` 로 재작성. 수동 DML 재실행 코드가 사라진다 | [§10.5](#105-트리거-db-계층-최후-방어선) |
| 라인 연쇄삭제 | 헤더 트리거가 직접 DELETE | **FK `ON DELETE CASCADE`**. 단, CASCADE 는 헤더 BEFORE 트리거 **이후**에 실행된다 — 순서 의존을 pgTAP 으로 고정 | [§10.5](#105-트리거-db-계층-최후-방어선) |
| 결과셋 반환 프로시저 | ~40건, 그중 2건은 **2개 결과셋** | `SETOF`/`TABLE` 또는 **`jsonb` 단일 반환**. 다중 결과셋 2건은 `{head, lines}` / `{rows, totals}` | [§10.2](#102-rpc-함수-계층-c4) |
| `BEGIN TRAN`/`COMMIT`/`ROLLBACK` (41개소) | 프로시저가 직접 관리 | **삭제.** 함수가 이미 원자적이며 `ROLLBACK` 을 호출할 수 없다 | [§13](#13-트랜잭션-규칙-지침-24) |
| `SESSION_CONTEXT` (3 플래그, 68개소) | 커넥션 상태 | **`set_config('ax.*','1',true)`** — 트랜잭션 로컬. 리셋·커넥션 고정 불필요 | [§10.5](#105-트리거-db-계층-최후-방어선) |
| `WITH (UPDLOCK, HOLDLOCK)` (35개소) | 채번·검증 직렬화 | **`pg_advisory_xact_lock()`** 또는 `SELECT … FOR UPDATE`. **없으면 `MAX()+1` 이 반드시 경합한다** | [§9.12](#912-식별자-자동생성-규칙) |
| `OPENJSON(@j) WITH (…)` | JSON 일괄 파라미터 | **`jsonb_to_recordset(p::jsonb) AS x(…)`**. 파라미터 타입 `nvarchar(max)` → `jsonb` | [§9.1](#91-전표-저장-검증-하나의-트랜잭션-지침-1724) |
| `DECLARE @t TABLE (rn int IDENTITY(1,1), …)` | 라인 순번 부여 | **`jsonb_array_elements(…) WITH ORDINALITY`** — 순서가 결정적이 되어 오히려 개선 | [§9.1](#91-전표-저장-검증-하나의-트랜잭션-지침-1724) |
| `OUTPUT` 파라미터 4건 | InOut 양방향 | **`jsonb` 반환** 또는 BEFORE 트리거 채번으로 소멸 | [§10.2](#102-rpc-함수-계층-c4) |
| `MERGE dbo.finance_closing` | 마감 기록 | **`INSERT … ON CONFLICT (…) DO UPDATE`** | [§9.5](#95-연도-회계마감-이월-계산-fr-close-0510) |
| `THROW 50xxx, N'…', 1` (240개소) | 오류 발생 | **`ax_raise(50xxx, '…')`** — SQLSTATE `PT4xx` + `hint` | [부록 B](#부록-b-오류코드-체계) |
| `UPDATE t SET … FROM t JOIN inserted i` | T-SQL 전용 조인 문법 | **`UPDATE t SET … FROM inserted i WHERE t.pk = i.pk`** — 대상 테이블을 FROM 에 다시 쓰지 않는다 | — |
| `UPDATE(col)` (트리거 15개소) | 컬럼 변경 감지 | **`NEW.col IS DISTINCT FROM OLD.col`** 또는 `UPDATE OF col` 절 | [§10.5](#105-트리거-db-계층-최후-방어선) |
| `TRIGGER_NESTLEVEL()` 재귀 가드 | `trg_partner_term_condition` | **BEFORE 트리거로 바꾸면 재귀 자체가 없다** — 가드 삭제 | [§9.11](#911-지급정책-계산과-전표-지급입금일-fr-term-06-fr-ledger-11) |
| `USE`·`GO`·`dbo.`·`CREATE DATABASE` | 배치 구분·스키마 | 삭제. Supabase 는 단일 DB, 스키마 `public` | [§16.1](#161-마이그레이션-정책-c8) |
| `sys.objects`/`OBJECT_ID()` 멱등 가드 | `08`/`09` 재실행 대비 | **불필요** — 마이그레이션 추적 테이블이 대신한다 | [§16.1](#161-마이그레이션-정책-c8) |

### C.2 ⚠ 직역하면 **조용히 틀리는** 3건

이 셋은 문법 오류를 내지 않고 **잘못된 결과를 반환**한다. 이식에서 가장 위험한 항목이다.

| # | 원본 | 직역 시 증상 | 올바른 이식 |
| - | ---- | ------------ | ----------- |
| 1 | `IF @vat_id LIKE '%[^0-9-]%'` (사업자번호 검증 2개소) | PostgreSQL `LIKE` 에는 **문자 클래스가 없다.** 리터럴 `[^0-9-]` 를 찾게 되어 **모든 입력이 검증을 통과**한다 | `IF p_vat_id ~ '[^0-9-]'` (정규식 연산자) |
| 2 | `SELECT @v = col FROM …` 에서 행이 없을 때 (8개소) | T-SQL 은 `@v` 를 **그대로 둔다**, pl/pgsql `SELECT … INTO` 는 **NULL 로 만든다.** 이전 반복의 값이 남는 로직이었다면 동작이 달라진다 | 8개소 모두 `IF @v IS NULL THROW` 형태라 결과적으로 안전하나 **개별 확인 필수** |
| 3 | `TRY_CONVERT(int, gl_type)` (5개소) | PostgreSQL 에 대응물이 없다. `gl_type::int` 로 직역하면 비숫자 값에서 **예외가 나서 마감 전체가 실패**한다 | `ax_safe_int(text)` 헬퍼 또는 `CASE WHEN x ~ '^\d+$' THEN x::int END` |

### C.3 기계적 치환

| T-SQL | PostgreSQL |
| ----- | ---------- |
| `GETDATE()` · `CONVERT(date, GETDATE())` | `CURRENT_DATE` / `now()` |
| `SYSDATETIME()` | `localtimestamp(0)` / `now()` |
| `ISNULL(a,b)` | `COALESCE(a,b)` |
| `CONVERT(t, x)` | `CAST(x AS t)` / `x::t` |
| `CONVERT(varchar(64), HASHBYTES('SHA2_256', …), 2)` | `encode(digest(…, 'sha256'), 'hex')` (pgcrypto) |
| `NEWID()` | `gen_random_uuid()` |
| `EOMONTH(d)` | `(date_trunc('month', d) + interval '1 month - 1 day')::date` |
| `DATEFROMPARTS(y,m,d)` | `make_date(y,m,d)` |
| `DATEADD(DAY, n, d)` | `d + n` |
| `YEAR(d)` · `MONTH(d)` · `DAY(d)` | `EXTRACT(YEAR FROM d)::int` 등 |
| `FORMAT(x,'N2')` | `to_char(x, 'FM999,999,990.00')` |
| `LEN` · `LTRIM/RTRIM` · `RIGHT` · `REPLICATE` | `length` · `btrim` · `right` · `repeat` |
| `'%' + @x + '%'` | `'%' \|\| x \|\| '%'` (NULL 전파 동일) |
| `@@ROWCOUNT` | `GET DIAGNOSTICS v = ROW_COUNT;` — **직후에 읽는다**(v1.1 의 `inserted_count` 결함과 같은 함정) |
| `nvarchar` · `N'…'` | `text` — `N` 접두 삭제 |
| `bit` | `boolean` — **극성 반전 주의**([§10.6](#106-status-극성--v20-최대의-잔존-위험)) |
| `tinyint` | `smallint` |
| `datetime2(0)` | `timestamptz(0)` |
| `AS ISNULL(x,'-') PERSISTED` | `GENERATED ALWAYS AS (COALESCE(x,'-')) STORED` |
| 필터 인덱스 `WHERE col IS NOT NULL` | 부분 유니크 인덱스 (문법 동일) |
| `CREATE OR ALTER PROCEDURE` | `CREATE OR REPLACE FUNCTION` — **반환 타입이 바뀌면 `DROP` 선행 필요** |
| `TRUNCATE TABLE` | 동일 (단, seed 는 `ON CONFLICT DO UPDATE` 로 대체 — [§16.1](#161-마이그레이션-정책-c8)) |

### C.4 이식과 함께 고치는 원본 결함

원본을 그대로 옮기지 않고 **이식 시점에 바로잡는** 항목이다. v1.1 이 `09_AX_Bridge_Fix.sql` 로 처리했거나 미해결로 남겼던 것들이다.

| 결함 | 원본 상태 | v2.0 |
| ---- | --------- | ---- |
| `partner_client.collecting_type` / `partner_vendor.payment_type` 길이 | 컬럼 `varchar(10)` 인데 저장 프로시저 파라미터는 `varchar(50)` — 무성 절단·FK 실패 위험 | RPC 파라미터를 `varchar(10)` 으로 일치 |
| `finance_open_balance` PK 부재 | 힙 테이블, 유일성은 인덱스로만 | **복합 PK 내장**([§8.1](#81-데이터-타입-기준-지침-8-9)) |
| `CK_bank_shape` 불완전 XOR | 둘 다 NULL 인 행이 합법 | **`CK_bank_one`** — 정확히 하나 |
| 계좌·카드번호 중복 | 유니크 제약 없음 | 부분 유니크 인덱스 2건 |
| 관리항목 값 중복 | 제약 없음 | `UX_dim_value` 부분 유니크 |
| `usp_finance_dimension_delete` | 2단 DELETE 를 트랜잭션 없이 실행 → 고아행 | **함수 원자성으로 소멸**([§13](#13-트랜잭션-규칙-지침-24)) |
| `usp_finance_gl_generate_standard.inserted_count` | `@@ROWCOUNT` 를 `COMMIT` 이후에 읽어 무의미 | `GET DIAGNOSTICS` 를 INSERT 직후에 |
| `activity_id` 채번 | 1/100초 해상도 + 잠금 없음 | 어드바이저리 잠금 + 시퀀스 부가([§9.12](#912-식별자-자동생성-규칙)) |
| `_delete` 의 guard-EXISTS 경합 | 검사와 삭제 사이에 참조가 생길 수 있음 | **FK `ON DELETE RESTRICT`**([§9.9](#99-참조-무결성과-soft-disabledelete-지침-20)) |
| `_list` 의 `LIKE` 이스케이프 누락 | 사용자 입력 `%`·`_` 가 와일드카드로 동작 | `escapeLike()` 의무 적용 — **자동으로 고쳐지지 않으므로 주의**([§10.4](#104-직접-sql-규칙-지침-15)) |
| 열거형 CHECK 8종 부재 | 프로시저 검증에만 의존 | **CHECK 추가** — PostgREST 직접 쓰기 때문([§8.1](#81-데이터-타입-기준-지침-8-9)) |
| FK 없는 참조 4종 | 프로시저 검증에만 의존 | **트리거로 이관**([§9.9](#99-참조-무결성과-soft-disabledelete-지침-20)) |
| `system_employee` 최후 관리자 보호 | **미구현** — admin 을 비활성화하면 아무도 로그인 못 함 | **트리거 `51002` 신설**([§6.5](#65-초기-admin-부트스트랩-fr-admin-0106)) |

### C.5 이식 완료 판정 — 프로시저 75건의 처분 대조

이식이 끝났다는 것은 **원본 프로시저 75건 각각이 다음 셋 중 하나로 명시적으로 처분되었다**는 뜻이다. 하나라도 누락되면 기능이 소실된다.

| 처분 | 건수 | 확인 방법 |
| ---- | ---- | --------- |
| ① RPC 함수로 포팅 | **20** | [§10.2](#102-rpc-함수-계층-c4) 표에 이름과 시그니처가 있다 |
| ② PostgREST 리소스·뷰·트리거·제약으로 대체 | **52** | [§11.2](#112-리소스-카탈로그) 카탈로그에 대응 리소스가 있고, 프로시저가 하던 검증이 제약·트리거로 옮겨졌다 |
| ③ 폐기 (대체물 없음) | **3** | `usp_auth_*` — Supabase Auth 가 대신한다([§6.1](#61-인증-흐름)) |

**표준 GL seed 의 실측 특성 (구현 시 주의)** — 자산(`gl_type=0`)·자본(`2`) 계정 중 **Layer3 플래그가 전혀 없는 계정은 존재하지 않는다.** 최소 조합조차 자산은 `bank_id`+`client_id`+`vendor_id` 3종, 자본은 `client_id`+`vendor_id` 2종이 필수다. 따라서 **전표를 입력하려면 은행/카드·고객사·거래처 마스터가 반드시 선행 등록**되어야 한다. [§16 로드맵](#16-구현-로드맵-지침-2730--vertical-slice)의 Phase 5(기준정보) → Phase 6(전표) 순서가 선택이 아니라 **필수 제약**임을 뜻한다.

**v1.1 이 원본 SQL 로 실증한 사실 2건 (v2.0 에서도 유효)**

1. **이월 집계는 보조키 조합별로 분리된다** — 초기이월(보조키 NULL)과 전표(bank·client·vendor 지정)가 같은 계정이어도 `gl_id + bank_key + client_key + vendor_key` 가 달라 **별개 행으로 이월**된다. [§9.5](#95-연도-회계마감-이월-계산-fr-close-0510) 의 집계 단위 서술대로 동작한다.
2. **마감연도 잠금(51054)은 "행 자신의 기수"를 기준으로 판정한다** — 차년도 이월 행을 UPDATE 하면 51054 가 아니라 **51031**(확정분 보호)이 발동한다. 차년도는 마감 상태가 아니기 때문이다. [§9.6](#96-연도-회계마감-해제-c12) 의 트리거 상호작용 분석과 일치한다.

---

> **본 설계서의 정본 관계 (v2.0)** — 정본을 **업무 축**과 **실행 축**으로 분리한다.
>
> | 축 | 정본 | 비고 |
> | -- | ---- | ---- |
> | **업무 규칙 · 화면 요구** | `AX_Bridge.xlsx`(FR/UC) · 화면기획서 4종 | 스택 전환과 무관하게 **불변** |
> | **업무 로직 상세** (검증 순서·계산식·오류 문구) | `AX_Bridge_DB_API_명세서.xlsx` v3.0 · `Planning_Docs/01~09_*.sql` | **읽기 전용 이식 소스.** 실행 대상이 아니다 |
> | **실행 수단** (스키마·RLS·RPC·트리거·API·배포) | **본 설계서 v2.0** | v1.1 및 `AX_Bridge_MSSQL_Development_Guideline.md` 의 MSSQL/NestJS 서술을 **대체**한다 |
> | **DDL** | `supabase/migrations/*.sql` (C8) | 구현 시작 후에는 코드가 문서를 앞선다 |
>
> 개발지침(`AX_Bridge_MSSQL_Development_Guideline.md`)의 **업무 규칙·명명·타입 기준·금지사항은 유효**하되, 실행 수단 조항(§13·§15·§24·§31 등 NestJS/Prisma/프로시저 전제)은 본 설계서가 우선한다.
>
> **본 설계서가 원본 산출물을 상회하는 항목** — 원본을 직접 대조해 확인한 사실이다.
>
> - 수량(테이블 21 · FR 179 · UC 135) — `AX_Bridge_DB_API_명세서.xlsx` 변경이력의 "테이블 21종"(v1.0 시점)과 설계서 초판의 "22종"은 모두 부정확했다.
> - [부록 C.4](#c4-이식과-함께-고치는-원본-결함) 의 결함 목록 — 이식 시점에 바로잡는다.
> - 오류코드 50443 사문화 · 50521 중복 — `AX_Bridge_DB_API_명세서.xlsx` 개요 시트는 505xx 대역 자체를 누락하고 있다.
> - 마감연도 잠금이 우회 플래그보다 **우선**한다는 사실 — `08` 의 트리거 구현이 근거이며, v2.0 에서도 이 순서를 보존한다([§10.5](#105-트리거-db-계층-최후-방어선)).
> - 자산·자본 계정에 Layer3 플래그 없는 것이 하나도 없다는 사실 — Phase 5 → Phase 6 순서가 필수 제약임을 뜻한다([부록 C.5](#c5-이식-완료-판정--프로시저-75건의-처분-대조)).
