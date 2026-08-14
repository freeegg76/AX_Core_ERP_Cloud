/*==============================================================================
  AX Bridge v2.0 — 06. FINANCE 도메인 테이블
  설계서 §8.5

  베이스라인에 폴딩된 09_Fix 항목 5건(설계서 §8.1) —
    ① finance_open_balance 복합 PK (원본은 힙)
    ② ck_bank_one — 완전한 XOR (원본 ck_bank_shape 는 "둘 다 NULL" 을 허용)
    ③ ux_bank_account · ux_bank_card · ux_dim_value 부분 유니크
    ④ open_balance.source (MANUAL/CLOSING) — 마감해제의 선결 조건
    ⑤ approved_date → timestamptz(0)
==============================================================================*/

/*------------------------------------------------------- 계정과목 (GL) */
create table public.finance_gl (
    company_id   varchar(10) not null,
    entity_id    varchar(10) not null,
    gl_id        varchar(10) not null,
    gl_name      text,
    -- 0자산 1부채 2자본 3수익 4매출원가 5제조원가 6용역원가 7판매관리비
    -- 8영업외수익 9영업외비용 10법인세등
    gl_type      varchar(50)
        constraint ck_gl_type check (gl_type in ('0','1','2','3','4','5','6','7','8','9','10')),
    gl_category1 text,
    gl_category2 text,
    vat_gl       text,
    -- 0보통 1차감
    gl_detail    varchar(10) default '0'
        constraint ck_gl_detail check (gl_detail in ('0','1')),
    -- 자기참조(차감계정 → 원계정). FK 없음 → trg_finance_gl_refs 가 검증(§7.4 · §9.9)
    contra_gl    varchar(10),
    -- ⚠ true = 사용 (SYSTEM 과 극성 반대)
    status       boolean     not null default true,

    -- 전표 Layer3 입력영역 사용 플래그 12종 (FR-GL-06).
    -- 컬럼명이 FK 컬럼과 같지만 실제로는 boolean 플래그다(설계서 §8.5 설계결정).
    bank_id      boolean not null default false,
    team_id      boolean not null default false,
    pod_id       boolean not null default false,
    employee_id  boolean not null default false,
    client_id    boolean not null default false,
    vendor_id    boolean not null default false,
    dimension1   boolean not null default false,
    dimension2   boolean not null default false,
    dimension3   boolean not null default false,
    dimension4   boolean not null default false,
    dimension5   boolean not null default false,
    due_date     boolean not null default false,

    constraint pk_finance_gl primary key (company_id, entity_id, gl_id),
    constraint fk_gl_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    -- 차감계정일 때만 contra_gl 을 갖고, 자기 자신을 가리킬 수 없다(§7.4)
    constraint ck_gl_contra_shape check (
        (gl_detail = '1') or (contra_gl is null)),
    constraint ck_gl_contra_self check (contra_gl is null or contra_gl <> gl_id)
);

comment on column public.finance_gl.bank_id is
  '전표 Layer3 은행/카드 입력 사용여부 (boolean 플래그, FK 아님). FR-GL-06';

/*------------------------------------------ 표준 GL 원본 (전역, 스코프 없음) */
-- 설계서 §5 원칙의 예외 1건 — 스코프 컬럼이 없다. 전 회사가 공유한다.
-- RLS 는 전역 읽기 허용 + 쓰기 전면 차단(마이그레이션만 갱신).
create table public.finance_gl_seed (
    gl_id        varchar(10) not null primary key,
    gl_name      text,
    gl_type      varchar(50),
    gl_category1 text,
    gl_category2 text,
    vat_gl       text,
    gl_detail    varchar(10),
    contra_gl    varchar(10),
    status       boolean not null default true,
    bank_id      boolean not null default false,
    team_id      boolean not null default false,
    pod_id       boolean not null default false,
    employee_id  boolean not null default false,
    client_id    boolean not null default false,
    vendor_id    boolean not null default false,
    dimension1   boolean not null default false,
    dimension2   boolean not null default false,
    dimension3   boolean not null default false,
    dimension4   boolean not null default false,
    dimension5   boolean not null default false,
    due_date     boolean not null default false
);

comment on table public.finance_gl_seed is
  '전역 표준 계정과목 원본 355행. 스코프 컬럼 없음 — 설계서 §5 예외. 갱신은 마이그레이션만';

/*------------------------------------------------------ 관리항목 (dimension) */
create table public.finance_dimension (
    company_id     varchar(10) not null,
    entity_id      varchar(10) not null,
    dimension_id   varchar(10) not null,
    dimension_name text,
    -- Slot 1~5 영속 매핑. 재정렬·재매핑 금지(§9.8).
    -- 할당은 ax_finance_dimension_save() 가 advisory lock 하에 수행한다(C5).
    slot_no        smallint    not null
        constraint ck_dim_slot check (slot_no between 1 and 5),
    status         boolean     not null default true,
    constraint pk_finance_dimension primary key (company_id, entity_id, dimension_id),
    constraint fk_dim_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint uq_dim_slot unique (company_id, entity_id, slot_no)
);

create table public.finance_dimension_detail (
    company_id      varchar(10)   not null,
    entity_id       varchar(10)   not null,
    dimension_id    varchar(10)   not null,
    -- BEFORE INSERT 트리거가 채번(C5, §9.12)
    line_no         numeric(10,2) not null,
    dimension_value text,
    constraint pk_finance_dimension_detail
        primary key (company_id, entity_id, dimension_id, line_no),
    constraint fk_dimd_dim foreign key (company_id, entity_id, dimension_id)
        references public.finance_dimension(company_id, entity_id, dimension_id) on delete cascade
);

-- 09_Fix ③ — 동일 관리항목 내 값 중복 금지 (FR-Dim-09)
create unique index ux_dim_value on public.finance_dimension_detail
    (company_id, entity_id, dimension_id, dimension_value)
    where dimension_value is not null;

/*----------------------------------------------------- 은행/카드 (bank_account) */
create table public.finance_bank_account (
    company_id   varchar(10) not null,
    entity_id    varchar(10) not null,
    bank_id      varchar(10) not null,
    bank_name    text,
    bank_account varchar(50),
    card_number  varchar(50),
    -- 카드 여부는 원문 없이 알 수 있어야 한다. 원문 컬럼은 SELECT 권한이 회수되므로
    -- 뷰가 `card_number is not null` 조차 평가할 수 없기 때문이다(§19.3).
    is_card      boolean generated always as (card_number is not null) stored,
    -- ⚠ false = 사용 (PARTNER/GL 과 극성 반대)
    status       boolean     not null default false,
    constraint pk_finance_bank_account primary key (company_id, entity_id, bank_id),
    constraint fk_bank_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    -- 09_Fix ② — 완전한 XOR. 원본 ck_bank_shape 는 "둘 다 NOT NULL 금지" 뿐이라
    --            둘 다 NULL 인 행이 합법이었다(FR-Bank-05).
    constraint ck_bank_one check (
        (bank_account is not null and card_number is null) or
        (bank_account is null     and card_number is not null))
);

-- 09_Fix ③ — 회사 내 계좌·카드번호 중복 금지 (FR-Bank-03/04)
create unique index ux_bank_account on public.finance_bank_account
    (company_id, entity_id, bank_account) where bank_account is not null;
create unique index ux_bank_card on public.finance_bank_account
    (company_id, entity_id, card_number) where card_number is not null;

comment on column public.finance_bank_account.card_number is
  '원문. authenticated 에게 SELECT 권한이 없다 — 조회는 v_finance_bank_account 경유 (§19.3)';

/*------------------------------------------------------ 초기이월 (open_balance) */
create table public.finance_open_balance (
    company_id      varchar(10)   not null,
    entity_id       varchar(10)   not null,
    company_year_id varchar(10)   not null,
    gl_id           varchar(10)   not null,
    -- 1차변 2대변
    drcr            varchar(10)   not null
        constraint ck_ob_drcr check (drcr in ('1','2')),
    bank_id         varchar(10),
    client_id       varchar(10),
    vendor_id       varchar(10),
    -- C11 — 마감 이월은 음수를 허용한다. `>= 0` CHECK 를 추가하지 않는다(§9.5).
    --        수기 입력 경로는 RPC 가 음수를 거부한다(50433).
    amount          numeric(18,2) not null default 0,
    closed          boolean       not null default false,
    -- 09_Fix ④ — 마감해제(C12)의 선결 조건. 어떤 행이 자동생성분인지 식별한다(§9.6).
    source          varchar(10)   not null default 'MANUAL'
        constraint ck_ob_source check (source in ('MANUAL','CLOSING')),

    -- NULL 을 포함한 유일성을 PK 로 표현하기 위한 저장 계산열.
    -- PostgreSQL 은 STORED 계산열의 PK 포함을 허용하므로 원본의 힙 상태가 해소된다.
    bank_key        varchar(10) generated always as (coalesce(bank_id,   '-')) stored,
    client_key      varchar(10) generated always as (coalesce(client_id, '-')) stored,
    vendor_key      varchar(10) generated always as (coalesce(vendor_id, '-')) stored,

    -- 09_Fix ① — 원본은 PK 가 없는 힙 테이블이었다.
    constraint pk_finance_open_balance primary key
        (company_id, entity_id, company_year_id, gl_id, drcr, bank_key, client_key, vendor_key),
    constraint fk_ob_year foreign key (company_id, entity_id, company_year_id)
        references public.system_year(company_id, entity_id, company_year_id) on delete restrict,
    constraint fk_ob_gl foreign key (company_id, entity_id, gl_id)
        references public.finance_gl(company_id, entity_id, gl_id) on delete restrict,
    constraint fk_ob_bank foreign key (company_id, entity_id, bank_id)
        references public.finance_bank_account(company_id, entity_id, bank_id) on delete restrict
);

comment on column public.finance_open_balance.source is
  'MANUAL=수기 / CLOSING=연도마감 자동생성. 마감해제 시 회수 대상 식별에 쓴다 (§9.6)';
comment on column public.finance_open_balance.amount is
  '자동생성분은 음수가 될 수 있다(C11). 합계 집계 시 부호를 살려 계산할 것 — §9.5';

/*--------------------------------------------------------- 전표 (ledger_head) */
create table public.finance_ledger_head (
    company_id      varchar(10)   not null,
    entity_id       varchar(10)   not null,
    ledger_date     date          not null,
    -- BEFORE INSERT 트리거가 (회사, 회사, 일자) 범위로 채번(C5, §9.2).
    -- 클라이언트 전송값은 무조건 덮어쓴다 → 지침 §12 "UI 전표번호 생성 금지"가 구조적으로 강제된다.
    ledger_no       numeric(10,2) not null,
    ledger_name     text,
    -- 0일반 1매입 2매출 3결산
    ledger_type     varchar(10) default '0'
        constraint ck_lh_type check (ledger_type in ('0','1','2','3')),
    -- employee_id / approver_id 에 FK 가 없다 → trg_finance_ledger_head_refs 가 검증(§9.9)
    employee_id     varchar(10),
    approver_id     varchar(10),
    insert_date     date,
    update_date     date,
    -- 09_Fix ⑤ — 승인은 감사 대상 행위이므로 일 단위로 부족하다.
    --   업무일자인 insert/update_date 는 date 를 유지한다(§8.1).
    approved_date   timestamptz(0),
    approval_status boolean       not null default false,
    constraint pk_finance_ledger_head primary key (company_id, entity_id, ledger_date, ledger_no),
    constraint fk_lh_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict
);

/*------------------------------------------------------- 전표 라인 (ledger_detail) */
create table public.finance_ledger_detail (
    company_id  varchar(10)   not null,
    entity_id   varchar(10)   not null,
    ledger_date date          not null,
    ledger_no   numeric(10,2) not null,
    -- ⚠ 원본 컬럼명이 line_on 이다(dimension_detail 은 line_no). 혼용 금지(§8.5).
    --   저장 시 배열 순서대로 재부여된다(§9.1).
    line_on     numeric(10,2) not null,
    gl_id       varchar(10)   not null,
    drcr        varchar(10)
        constraint ck_ld_drcr check (drcr in ('1','2')),
    -- NULL 허용. `> 0` 검증은 RPC/Domain 전담(§8.5).
    amount      numeric(18,2),
    -- Layer3 실제값. bank/gl/head 만 FK 가 있다.
    -- team/pod/employee/client/vendor/dimension1~5 는 FK 없음 → 트리거 검증(§9.9)
    bank_id     varchar(10),
    team_id     varchar(10),
    pod_id      varchar(4),
    employee_id varchar(10),
    client_id   varchar(10),
    vendor_id   varchar(10),
    dimension1  varchar(10),
    dimension2  varchar(10),
    dimension3  varchar(10),
    dimension4  varchar(10),
    dimension5  varchar(10),
    due_date    date,
    constraint pk_finance_ledger_detail
        primary key (company_id, entity_id, ledger_date, ledger_no, line_on),
    -- 설계서 §10.5 — v1.1 은 헤더 트리거가 라인을 직접 연쇄삭제했다.
    --   v2.0 은 DB 가 처리한다. CASCADE 는 헤더 BEFORE 트리거 이후에 실행된다.
    constraint fk_ld_head foreign key (company_id, entity_id, ledger_date, ledger_no)
        references public.finance_ledger_head(company_id, entity_id, ledger_date, ledger_no)
        on delete cascade,
    constraint fk_ld_gl foreign key (company_id, entity_id, gl_id)
        references public.finance_gl(company_id, entity_id, gl_id) on delete restrict,
    constraint fk_ld_bank foreign key (company_id, entity_id, bank_id)
        references public.finance_bank_account(company_id, entity_id, bank_id) on delete restrict
);

/*------------------------------------------------------- 마감관리 (closing) */
create table public.finance_closing (
    company_id      varchar(10) not null,
    entity_id       varchar(10) not null,
    company_year_id varchar(10) not null,
    -- ⚠ DEFAULT true — "행이 없으면 미마감" 시맨틱과 결합되어 있다.
    --   컬럼을 생략한 bare INSERT 는 해당 연도를 즉시 마감 처리한다.
    --   v2.0 은 이 테이블에 쓰기 정책을 부여하지 않아 RPC 만 쓰게 한다(§8.5 · §11.2).
    closing         boolean     not null default true,
    closing_date    date,
    constraint pk_finance_closing primary key (company_id, entity_id, company_year_id),
    constraint fk_closing_year foreign key (company_id, entity_id, company_year_id)
        references public.system_year(company_id, entity_id, company_year_id) on delete restrict
);

comment on table public.finance_closing is
  '행이 없으면 미마감. closing DEFAULT 가 true 이므로 직접 INSERT 금지 — RPC 전용 (§8.5)';

/*============================================================================
  성능 인덱스
  원본에는 비유니크 인덱스가 하나도 없었고, 모든 스코프 조회가 PK 접두에 의존했다.
  RLS 가 company_id/entity_id 조건을 모든 질의에 주입하므로 PK 접두 활용은 유지되지만,
  자주 쓰는 보조 경로에는 인덱스를 둔다.
============================================================================*/
create index ix_ledger_head_scope_date on public.finance_ledger_head
    (company_id, entity_id, ledger_date desc);
create index ix_ledger_detail_gl on public.finance_ledger_detail
    (company_id, entity_id, gl_id);
create index ix_open_balance_year on public.finance_open_balance
    (company_id, entity_id, company_year_id);
create index ix_employee_auth_user on public.system_employee (auth_user_id)
    where auth_user_id is not null;

-- Lookup 팝업의 부분일치 검색 (§10.3)
create index ix_client_name_trgm on public.partner_client
    using gin (client_name extensions.gin_trgm_ops);
create index ix_vendor_name_trgm on public.partner_vendor
    using gin (vendor_name extensions.gin_trgm_ops);
create index ix_gl_name_trgm on public.finance_gl
    using gin (gl_name extensions.gin_trgm_ops);
