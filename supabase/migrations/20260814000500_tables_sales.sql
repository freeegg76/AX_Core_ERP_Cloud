/*==============================================================================
  AX Bridge v2.0 — 05. SALES 도메인 테이블
  설계서 §8.4

  ⚠ 열거형 CHECK 신설 — v1.1 은 pipeline_type · stage · type · contract_type ·
     contract status 를 프로시저 검증에만 의존했다. v2.0 은 PostgREST 로 테이블에
     직접 INSERT 할 수 있으므로 검증 주체가 사라진다 → DDL 로 승격한다(§8.1).
==============================================================================*/

/*--------------------------------------------------------- 파이프라인 */
create table public.sales_pipeline (
    company_id    varchar(10) not null,
    entity_id     varchar(10) not null,
    pipeline_id   varchar(10) not null,
    -- 0대행 1사입 2리테일 3마케팅 4기타
    pipeline_type varchar(40) default '0'
        constraint ck_pipe_type check (pipeline_type in ('0','1','2','3','4')),
    -- 비정규화 문자열. partner_client 에 FK 가 없다(원본 설계).
    client_name   text,
    -- 0Lead 1QualifiedLead 2Suggest 3Meeting 4Nego 5Closed 6Canceled
    stage         varchar(40) default '0'
        constraint ck_pipe_stage check (stage in ('0','1','2','3','4','5','6')),
    employee_id   varchar(10),
    note          text,
    -- created/adjusted/closed_date 는 트리거가 관리한다(§10.5)
    created_date  date,
    adjusted_date date,
    closed_date   date,
    -- sales_contract 의 PK 가 (contract_id, contract_type) 복합이라 FK 를 걸 수 없다.
    -- → trg_sales_pipeline_refs 가 검증한다(§9.9).
    contract_id   varchar(20),
    constraint pk_sales_pipeline primary key (company_id, entity_id, pipeline_id),
    constraint fk_pipe_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint fk_pipe_emp foreign key (company_id, entity_id, employee_id)
        references public.system_employee(company_id, entity_id, employee_id) on delete restrict
);

/*----------------------------------------------- 고객 액티비티 (pipeline_detail) */
create table public.sales_pipeline_detail (
    company_id   varchar(10) not null,
    entity_id    varchar(10) not null,
    pipeline_id  varchar(10) not null,
    -- 'ACT' + 타임스탬프. BEFORE INSERT 트리거가 채번한다(C5, §9.12).
    -- 클라이언트가 보낸 값은 무조건 덮어쓴다.
    activity_id  varchar(20) not null,
    created_date date,
    -- 원본은 [type] 예약어. v2.0 은 activity_type 으로 개명한다.
    -- 0메일 1전화 2미팅 3기타
    activity_type varchar(30) not null default '0'
        constraint ck_act_type check (activity_type in ('0','1','2','3')),
    content      text,
    incharge     text,
    -- 설계서 §7.3 — 파일 업로드가 아니라 URL/링크 문자열이다.
    attached     varchar(250),
    constraint pk_sales_pipeline_detail primary key (company_id, entity_id, pipeline_id, activity_id),
    constraint fk_act_pipe foreign key (company_id, entity_id, pipeline_id)
        references public.sales_pipeline(company_id, entity_id, pipeline_id) on delete cascade
);

comment on column public.sales_pipeline_detail.activity_id is
  'BEFORE INSERT 트리거가 채번한다. 클라이언트 전송값은 무시된다 (C5, §9.12)';

/*--------------------------------------------------------------- 계약 (contract) */
create table public.sales_contract (
    company_id      varchar(10)   not null,
    entity_id       varchar(10)   not null,
    client_id       varchar(10)   not null,
    contract_id     varchar(20)   not null,
    contract_type   varchar(5)    not null default '0'
        constraint ck_ct_type check (contract_type in ('0','1','2','3','4','5')),
    pipeline_id     varchar(10),
    start_date      date          not null,
    end_date        date          not null,
    -- 0 Active 1 Inactive 2 Suspend
    status          varchar(10)   not null default '0'
        constraint ck_ct_status check (status in ('0','1','2')),
    contract_amount numeric(18,2),
    -- 전표 연결(선택). 둘 다 입력이거나 둘 다 NULL (FR-Contract-08).
    ledger_date     date,
    ledger_no       numeric(10,2),
    closed_date     date,
    constraint pk_sales_contract primary key (company_id, entity_id, contract_id, contract_type),
    constraint fk_ct_client foreign key (company_id, entity_id, client_id)
        references public.partner_client(company_id, entity_id, client_id) on delete restrict,
    constraint ck_ct_dates check (start_date <= end_date),
    constraint ck_ct_ledger check (
        (ledger_date is null and ledger_no is null) or
        (ledger_date is not null and ledger_no is not null))
);
