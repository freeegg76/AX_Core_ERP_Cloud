/*==============================================================================
  AX Bridge v2.0 — 04. PARTNER 도메인 테이블
  설계서 §8.3

  ⚠ status 극성이 SYSTEM 과 **반대**다 — 이 파일의 3개 테이블은 전부 **true = 사용**.
     설계서 부록 A · §10.6.
  ⚠ collecting_type / payment_type 은 varchar(10) 이다. 원본 프로시저 파라미터가
     varchar(50) 이라 무성 절단 위험이 있었다 → 부록 C.4 에서 이식 시 바로잡는다.
==============================================================================*/

/*-------------------------------------------------- 지급/수금 정책 (term) */
create table public.partner_term (
    company_id     varchar(10)  not null,
    entity_id      varchar(10)  not null,
    term_id        varchar(10)  not null,
    -- 표시용 정책식(EOM+15 / CurM25). BEFORE 트리거가 자동 구성한다(§9.11).
    term_condition varchar(20)  not null default '-',
    base_rule      varchar(10)  not null
        constraint ck_term_rule check (base_rule in ('EOM','CURM')),
    fixed_day      numeric(2,0),
    offset_days    numeric(3,0) not null default 0,
    -- ⚠ true = 사용 (SYSTEM 과 극성 반대)
    status         boolean      not null default true,
    constraint pk_partner_term primary key (company_id, entity_id, term_id),
    constraint fk_term_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint ck_term_shape check (
        (base_rule = 'EOM'  and fixed_day is null and offset_days >= 0) or
        (base_rule = 'CURM' and fixed_day between 1 and 31 and offset_days = 0))
);

comment on column public.partner_term.status is 'true=사용 / false=미사용 (⚠ SYSTEM 과 극성 반대)';

/*------------------------------------------------------------ 고객사 (client) */
create table public.partner_client (
    company_id      varchar(10) not null,
    entity_id       varchar(10) not null,
    client_id       varchar(10) not null,
    client_name     text        not null,
    -- partner_term.term_id 참조. 길이 일치 필수(FK).
    collecting_type varchar(10),
    status          boolean     not null default true,
    vat_id          varchar(20),
    nick_name       text,
    rep_name        text,
    reg_num         varchar(50),
    biz_industry    text,
    biz_category    text,
    client_address  text,
    phone_number    varchar(20),
    fax_number      varchar(20),
    bank_code       text,
    bank_branch     text,
    bank_account    varchar(50),
    bank_holder     text,
    website         text,
    logo_url        text,
    industry        text,
    notes           text,
    -- 단일통화 전제(§1) — 사용하는 FR 이 0건이다. 참고 속성으로만 보존한다.
    default_billing_currency varchar(10),
    constraint pk_partner_client primary key (company_id, entity_id, client_id),
    constraint fk_client_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint fk_client_term foreign key (company_id, entity_id, collecting_type)
        references public.partner_term(company_id, entity_id, term_id) on delete restrict
);

/*------------------------------------------------------------ 거래처 (vendor) */
create table public.partner_vendor (
    company_id      varchar(10) not null,
    entity_id       varchar(10) not null,
    vendor_id       varchar(10) not null,
    vendor_name     text        not null,
    payment_type    varchar(10),
    status          boolean     not null default true,
    vat_id          varchar(20),
    nick_name       text,
    rep_name        text,
    reg_num         varchar(50),
    biz_industry    text,
    biz_category    text,
    vendor_address  text,
    phone_number    varchar(20),
    fax_number      varchar(20),
    bank_code       text,
    bank_branch     text,
    bank_account    varchar(50),
    bank_holder     text,
    website         text,
    logo_url        text,
    industry        text,
    notes           text,
    default_billing_currency varchar(10),
    constraint pk_partner_vendor primary key (company_id, entity_id, vendor_id),
    constraint fk_vendor_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint fk_vendor_term foreign key (company_id, entity_id, payment_type)
        references public.partner_term(company_id, entity_id, term_id) on delete restrict
);
