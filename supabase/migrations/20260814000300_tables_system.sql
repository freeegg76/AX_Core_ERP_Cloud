/*==============================================================================
  AX Bridge v2.0 — 03. SYSTEM 도메인 테이블
  설계서 §8.2 · 이식 대조표는 부록 C

  베이스라인 원칙(C8) — MSSQL 원본 01 + 08 + 09 의 **최종 상태**를 옮긴다.
  원본의 중첩 관계(08 이 05/06 을 덮고 09 가 다시 덮는 구조)를 재현하지 않는다.

  ⚠ 식별자는 전부 소문자다. 원본의 `Team_id` · `employee_Id` 는 `team_id` · `employee_id`.
  ⚠ status 극성이 테이블마다 반대다 — 이 파일의 5개 테이블은 전부 **false = 사용**.
     설계서 부록 A · §10.6 참조.
==============================================================================*/

/*------------------------------------------------------------ 그룹 (company) */
create table public.system_company (
    company_id      varchar(10)  not null,
    company_name    text         not null,
    company_name_ko text         not null,
    note            text,
    description     text,
    -- 원본 bit DEFAULT(0). false = 사용, true = 미사용
    status          boolean      not null default false,
    constraint pk_system_company primary key (company_id)
);

comment on table  public.system_company        is '그룹 마스터. 멀티테넌시의 최상위 스코프';
comment on column public.system_company.status is 'false=사용 / true=미사용 (⚠ 극성 주의, 설계서 부록 A)';

/*------------------------------------------------------------- 회사 (entity) */
create table public.system_entity (
    company_id      varchar(10)  not null,
    entity_id       varchar(10)  not null,
    entity_name     text         not null,
    entity_name_ko  text         not null,
    rep_name        text,
    reg_num         varchar(20),
    biz_num         varchar(20),
    biz_industry    text,
    biz_category    text,
    address         text,
    -- 원본 컬럼명 estabilish_date 는 오타이나 정본이다. 뷰에서 establish_date 로 별칭을 준다(§8.5).
    estabilish_date date,
    phone_number    varchar(30),
    fax_number      varchar(30),
    note            text,
    description     text,
    status          boolean      not null default false,
    constraint pk_system_entity primary key (company_id, entity_id),
    constraint fk_entity_company foreign key (company_id)
        references public.system_company(company_id) on delete restrict
);

/*----------------------------------------------------------------------- Pod */
create table public.system_pod (
    company_id varchar(10) not null,
    entity_id  varchar(10) not null,
    pod_id     varchar(4)  not null,
    pod_name   text        not null,
    status     boolean     not null default false,
    constraint pk_system_pod primary key (company_id, entity_id, pod_id),
    constraint fk_pod_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict
);

/*----------------------------------------------------------- 부서 (team) */
create table public.system_team (
    company_id     varchar(10) not null,
    entity_id      varchar(10) not null,
    team_id        varchar(10) not null,
    team_name      text,
    team_name_ko   text,
    -- system_employee.employee_id 를 가리키지만 순환 의존으로 FK 를 걸 수 없다.
    -- v1.1 은 프로시저가 검증했다. v2.0 은 트리거가 인계한다(§9.9 · 마이그레이션 10).
    owner          varchar(20) not null,
    leader_user_id varchar(20) not null,
    note           text,
    status         boolean     not null default false,
    pod_id         varchar(4),
    constraint pk_system_team primary key (company_id, entity_id, team_id),
    constraint fk_team_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint fk_team_pod foreign key (company_id, entity_id, pod_id)
        references public.system_pod(company_id, entity_id, pod_id) on delete restrict
);

comment on column public.system_team.owner is
  'system_employee.employee_id 참조. 순환 의존으로 FK 미적용 → trg_system_team_refs 가 검증 (§9.9)';

/*------------------------------------------------------------ 직원 (employee) */
-- v1.1 대비 변경(C2, 설계서 §6.1):
--   삭제 : user_pass(자격증명은 auth.users 소관) · last_login(auth.users.last_sign_in_at)
--   신설 : auth_user_id(uuid) · ax_role
--   변경 : email → citext NOT NULL UNIQUE (로그인 식별자)
create table public.system_employee (
    company_id          varchar(10) not null,
    entity_id           varchar(10) not null,
    team_id             varchar(10) not null,
    employee_id         varchar(10) not null,
    employee_name       text        not null,
    -- 로그인 식별자. citext 라 Kim@x.com 과 kim@x.com 이 같은 계정이 된다(§6.1).
    email               extensions.citext not null,
    english_name        text,
    title               text,
    title_abbr          text,
    employment_type     text,
    status              varchar(20)
        constraint ck_emp_status check (status in
            ('planned','probation','active','on_leave','leaving_soon','inactive')),
    departure_date      date,
    start_date          date,
    timezone            varchar(40),
    phone               varchar(20),
    birthday            date,
    profile_image_url   text,
    slack_user_id       varchar(200),
    slack_handle        varchar(200),
    social_buddy        text,
    -- 계정 활성 스위치. false 면 auth.users.banned_until 도 함께 설정한다(§6.1).
    user_yn             boolean     not null default false,
    -- 표시용 사번. 로그인에는 쓰이지 않는다.
    user_id             varchar(20),
    -- 설계서 §6.3 — 역할은 DB 에 있어야 RLS 가 읽을 수 있다.
    ax_role             varchar(10) not null default 'VIEWER'
        constraint ck_emp_role check (ax_role in ('VIEWER','EDITOR','APPROVER','ADMIN','SUPER')),
    auth_user_id        uuid unique
        constraint fk_emp_auth_user references auth.users(id) on delete restrict,
    last_manual_edit_at timestamptz(0),
    constraint pk_system_employee primary key (company_id, entity_id, employee_id),
    constraint fk_emp_team foreign key (company_id, entity_id, team_id)
        references public.system_team(company_id, entity_id, team_id) on delete restrict,
    -- 이메일은 전역 유일 (auth.users 와 1:1)
    constraint uq_employee_email unique (email)
);

-- 사번은 전역 유일(원본 FR-Emp-06 의 user_id 유일성을 승계)
create unique index ux_system_employee_user_id
    on public.system_employee(user_id) where user_id is not null;

comment on column public.system_employee.email        is '로그인 식별자. auth.users.email 과 일치해야 한다 (§6.1)';
comment on column public.system_employee.auth_user_id is 'Supabase Auth 계정 연결. NULL 이면 로그인 불가 (§6.5)';
comment on column public.system_employee.ax_role      is 'VIEWER<EDITOR<APPROVER<ADMIN<SUPER. 변경은 ax_system_employee_set_role() 만 (§6.3)';

/*------------------------------------------------------------ 회사 기수 (year) */
create table public.system_year (
    company_id      varchar(10)   not null,
    entity_id       varchar(10)   not null,
    company_year_id varchar(10)   not null,
    -- C10 — 정수 의미이나 numeric(10,2) 를 유지한다. 경계에서 정규화(§8.1).
    company_year    numeric(10,2) not null,
    actual_year     numeric(10,2) not null,
    constraint pk_system_year primary key (company_id, entity_id, company_year_id),
    constraint fk_year_entity foreign key (company_id, entity_id)
        references public.system_entity(company_id, entity_id) on delete restrict,
    constraint uq_year_actual unique (company_id, entity_id, actual_year, company_year)
);
