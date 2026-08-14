/**
 * 직원 (system_employee) — 설계서 §12.5 · §6.1 · §6.3
 *
 * Detail 은 2개 탭이다 — 항목이 많아 탭 분리가 필수다(§12.5).
 *   기본정보(인사) / 계정정보(user_yn · user_id(사번) · email(로그인ID) · ax_role · 마지막 로그인)
 *
 * ⚠⚠ **비밀번호 입력란이 없다.** 자격증명은 Supabase Auth 소관이며(C2),
 *    `system_employee.user_pass` 컬럼 자체가 존재하지 않는다.
 *    초기 발급·재설정은 초대/재설정 메일로 처리한다(§6.1).
 *
 * ⚠ 역할 변경과 삭제는 **RPC 전용**이다.
 *    · ax_role 은 컬럼 GRANT 로 UPDATE 가 막혀 있다(권한 상승 방지, §5.3)
 *    · 삭제는 5개 테이블 참조검사가 필요하다(§10.2 RPC 19)
 */
import { useState } from 'react';
import { App as AntApp, Input, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EMPLOYEE_STATUS, ROLE_LABEL, ROLE_RANK, activeFilterValue,
  type AxRole, type EmployeeStatus,
} from '@ax-bridge/shared-constants';
import { useCan, useClaims } from '@/lib/session';
import { makeLookup, useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, DateField, EmployeeStatusBadge, Field, HeadDetailLayout,
  LookupPopup, SearchBar, SelectField, TextField, confirmAction,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';
import { deleteEmployee, setEmployeeRole } from '@/lib/rpc';
import { toAxError } from '@/lib/errors';

interface EmployeeRow {
  company_id: string;
  entity_id: string;
  team_id: string;
  employee_id: string;
  employee_name: string;
  email: string;
  english_name: string | null;
  title: string | null;
  employment_type: string | null;
  status: string | null;
  start_date: string | null;
  departure_date: string | null;
  phone: string | null;
  birthday: string | null;
  user_yn: boolean;
  user_id: string | null;
  ax_role: AxRole;
  has_account: boolean;
  last_login: string | null;
}

const searchTeam = makeLookup({
  from: 'system_team',
  codeCol: 'team_id',
  nameCol: 'team_name_ko',
  activeFilter: { col: 'status', value: activeFilterValue('system_team') },
});

export function EmployeePage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');
  const canAdmin = useCan('ADMIN');
  const claims = useClaims();
  const [tab, setTab] = useState('basic');

  const crud = useMasterCrud<EmployeeRow>({
    key: 'system_employee',
    from: 'v_system_employee',
    select:
      'company_id, entity_id, team_id, employee_id, employee_name, email, english_name, ' +
      'title, employment_type, status, start_date, departure_date, phone, birthday, ' +
      'user_yn, user_id, ax_role, has_account, last_login',
    table: 'system_employee',
    orderBy: 'employee_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, employee_id: r.employee_id }),
    applyFilters: (q, f) => {
      let out = q;
      if (f.keyword) out = out.ilike('employee_name', likePattern(String(f.keyword)));
      if (f.activeOnly) out = out.neq('status', 'inactive');
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      status: 'active',
      user_yn: false,
      ax_role: 'VIEWER' as AxRole,
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.employee_id?.trim()) return '사번은 필수입니다.';
      if (!d.employee_name?.trim()) return '이름은 필수입니다.';
      if (!d.email?.trim()) return '이메일은 필수입니다. 로그인 식별자로 쓰입니다.';
      if (!d.team_id?.trim()) return '부서는 필수입니다.';
      return null;
    },
    // ⚠ ax_role · auth_user_id 를 보내지 않는다 — 컬럼 GRANT 가 막고 있고,
    //   보내면 42501 로 거부된다. 역할 변경은 아래 changeRole RPC 가 담당한다.
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      team_id: d.team_id,
      employee_id: d.employee_id,
      employee_name: d.employee_name,
      email: d.email,
      english_name: d.english_name ?? null,
      title: d.title ?? null,
      employment_type: d.employment_type ?? null,
      status: d.status ?? 'active',
      start_date: d.start_date ?? null,
      departure_date: d.departure_date ?? null,
      phone: d.phone ?? null,
      birthday: d.birthday ?? null,
      user_yn: d.user_yn ?? false,
      user_id: d.user_id ?? null,
    }),
    // 5개 테이블 참조검사가 필요하므로 RPC 로 삭제한다(§10.2)
    deleteVia: async (row) => {
      await deleteEmployee(row.employee_id);
    },
  });

  /** 역할 변경 — ADMIN 전용 RPC. 자기 자신·상위 역할은 서버가 거부한다(§10.2 RPC 20) */
  const changeRole = useMutation({
    mutationFn: (role: AxRole) => setEmployeeRole(crud.selected!.employee_id, role),
    onSuccess: () => {
      message.success('권한을 변경했습니다.');
      void qc.invalidateQueries({ queryKey: ['system_employee'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const columns: ColumnsType<EmployeeRow> = [
    { title: '사번', dataIndex: 'employee_id', width: 100 },
    { title: '이름', dataIndex: 'employee_name', width: 110 },
    { title: '부서', dataIndex: 'team_id', width: 90 },
    {
      title: '재직상태', dataIndex: 'status', width: 100,
      render: (v: string) => <EmployeeStatusBadge status={v} />,
    },
    {
      title: '권한', dataIndex: 'ax_role', width: 90,
      render: (v: AxRole) => <Tag color="blue">{ROLE_LABEL[v]}</Tag>,
    },
    {
      title: '계정', dataIndex: 'has_account', width: 80,
      render: (v: boolean) => (v ? <Tag color="green">연결</Tag> : <Tag>미연결</Tag>),
    },
  ];

  const d = crud.draft;
  const isSelf = crud.selected?.employee_id === claims?.employee_id;

  return (
    <HeadDetailLayout
      headTitle={`직원 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input
            placeholder="이름"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 180 }} allowClear
          />
        </SearchBar>
      }
      head={
        <>
          <AppToolbar
            mode={crud.mode} canEdit={canEdit} saving={crud.saving}
            onSearch={crud.runSearch} onCreate={crud.startCreate} onEdit={crud.startEdit}
            onSave={crud.save} onCancel={crud.cancel}
            onDelete={() => {
              void confirmAction({
                title: `${crud.selected?.employee_name} 직원을 삭제하시겠습니까?`,
                content: '부서 오너/리더·파이프라인·전표에 연결되어 있으면 삭제할 수 없습니다.',
                okText: '삭제', danger: true,
              }).then((ok) => ok && crud.remove());
            }}
          />
          <Table<EmployeeRow>
            rowKey="employee_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.employee_id === crud.selected?.employee_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'basic',
                label: '기본정보',
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <TextField label="사번" required value={d.employee_id}
                      // 사번은 수정모드에서 읽기전용(§12.5)
                      disabled={crud.mode !== 'create'} maxLength={10}
                      onChange={(v) => crud.patch({ employee_id: v })} />
                    <TextField label="이름" required value={d.employee_name}
                      disabled={!crud.editing} onChange={(v) => crud.patch({ employee_name: v })} />
                    <TextField label="영문명" value={d.english_name}
                      disabled={!crud.editing} onChange={(v) => crud.patch({ english_name: v })} />

                    <Field label="부서" required
                      hint="조직 이동 시 새 부서 조합의 유효성을 서버가 재검증한다">
                      <LookupPopup
                        search={searchTeam}
                        value={d.team_id ?? ''}
                        disabled={!crud.editing}
                        onSelect={(t) => crud.patch({ team_id: t.code })}
                      />
                    </Field>

                    <TextField label="직위" value={d.title}
                      disabled={!crud.editing} onChange={(v) => crud.patch({ title: v })} />
                    <SelectField<EmployeeStatus>
                      label="재직상태"
                      value={(d.status ?? 'active') as EmployeeStatus}
                      disabled={!crud.editing}
                      onChange={(v) => crud.patch({ status: v })}
                      options={Object.entries(EMPLOYEE_STATUS).map(([value, label]) => ({
                        value: value as EmployeeStatus, label,
                      }))}
                    />
                    <DateField label="입사일" value={d.start_date}
                      disabled={!crud.editing} onChange={(v) => crud.patch({ start_date: v })} />
                    <DateField label="퇴사일" value={d.departure_date}
                      disabled={!crud.editing}
                      hint="퇴사 전환 시 미입력이면 트리거가 당일로 자동 보완한다"
                      onChange={(v) => crud.patch({ departure_date: v })} />
                    <TextField label="연락처" value={d.phone}
                      disabled={!crud.editing} onChange={(v) => crud.patch({ phone: v })} />
                  </Space>
                ),
              },
              {
                key: 'account',
                label: '계정정보',
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <TextField label="이메일 (로그인 ID)" required value={d.email}
                      disabled={!crud.editing}
                      hint="Supabase Auth 계정과 일치해야 한다. 대소문자를 구분하지 않는다(citext)."
                      onChange={(v) => crud.patch({ email: v })} />
                    <TextField label="사용자 ID (표시용 사번)" value={d.user_id}
                      disabled={!crud.editing}
                      hint="로그인에는 쓰이지 않는다"
                      onChange={(v) => crud.patch({ user_id: v })} />
                    <ActiveField
                      label="계정 활성"
                      active={d.user_yn ?? false}
                      disabled={!crud.editing}
                      onLabel="활성" offLabel="비활성"
                      hint="비활성 시 로그인이 차단된다"
                      onChange={(v) => crud.patch({ user_yn: v })}
                    />

                    <Field label="로그인 계정 연결">
                      {crud.selected?.has_account
                        ? <Tag color="green">연결됨</Tag>
                        : <Tag>미연결 — 관리자가 초대 메일을 발송해야 한다</Tag>}
                    </Field>

                    <Field label="마지막 로그인">
                      <Input value={crud.selected?.last_login ?? '-'} disabled />
                    </Field>

                    {/* ⚠ 역할은 일반 저장에 포함되지 않는다 — 컬럼 GRANT 로 막혀 있고
                        전용 RPC 가 자기 자신·상위 역할 부여를 거부한다(§5.3 · §10.2) */}
                    <Field label="권한"
                      hint={
                        isSelf
                          ? '자기 자신의 권한은 변경할 수 없다 (권한 상승 방지)'
                          : '변경은 즉시 적용된다. 자신보다 높은 역할은 부여할 수 없다.'
                      }>
                      <SelectField<AxRole>
                        label=""
                        value={crud.selected?.ax_role ?? 'VIEWER'}
                        disabled={!canAdmin || !crud.selected || isSelf || crud.editing}
                        onChange={(v) => changeRole.mutate(v)}
                        options={(Object.keys(ROLE_RANK) as AxRole[]).map((r) => ({
                          value: r, label: ROLE_LABEL[r],
                        }))}
                      />
                    </Field>

                    {/* 설계서 §12.5 — 비밀번호·해시는 어느 탭에도 표시하지 않는다 */}
                    <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                      비밀번호는 이 화면에서 다루지 않는다. 자격증명은 Supabase Auth 가 관리하며
                      초기 발급·재설정은 메일로 처리한다 (설계서 §6.1).
                    </div>
                  </Space>
                ),
              },
            ]}
          />
        ) : null
      }
    />
  );
}
