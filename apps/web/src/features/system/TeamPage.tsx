/**
 * 부서 (system_team) — 설계서 §8.2 · §9.9
 *
 * ⚠⚠ 순환 의존 — owner/leader 는 직원을 가리키고, 직원은 부서를 가리킨다.
 *   FK 를 걸 수 없어 v1.1 은 프로시저가 검증했고, **신규 회사를 만들 방법이 없었다**.
 *   v2.0 은 지연 제약 트리거(deferrable initially deferred)로 COMMIT 시점에 검증하므로
 *   한 트랜잭션 안에서는 순서가 무관하다(§16.4 #1).
 *
 *   다만 화면에서 부서를 단독 저장할 때는 **직원이 이미 있어야 한다.**
 *   그래서 Lookup 이 비어 있으면 그 사실을 사용자에게 알린다.
 */
import { Input, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { useClaims, useCan } from '@/lib/session';
import { makeLookup, useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, Field, HeadDetailLayout, LookupPopup, SearchBar,
  StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';
import { activeFilterValue } from '@ax-bridge/shared-constants';

interface TeamRow {
  company_id: string;
  entity_id: string;
  team_id: string;
  team_name: string | null;
  team_name_ko: string | null;
  owner: string;
  leader_user_id: string;
  pod_id: string | null;
  note: string | null;
  status: boolean;
}

const searchEmployee = makeLookup({
  from: 'v_system_employee',
  codeCol: 'employee_id',
  nameCol: 'employee_name',
});

const searchPod = makeLookup({
  from: 'system_pod',
  codeCol: 'pod_id',
  nameCol: 'pod_name',
  activeFilter: { col: 'status', value: activeFilterValue('system_pod') },
});

export function TeamPage() {
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const crud = useMasterCrud<TeamRow>({
    key: 'system_team',
    from: 'system_team',
    select: 'company_id, entity_id, team_id, team_name, team_name_ko, owner, leader_user_id, pod_id, note, status',
    table: 'system_team',
    orderBy: 'team_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, team_id: r.team_id }),
    applyFilters: (q, f) => (f.keyword ? q.ilike('team_name_ko', likePattern(String(f.keyword))) : q),
    emptyDraft: () => ({
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      status: toDbStatus('system_team', true),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.team_id?.trim()) return '부서 코드는 필수입니다.';
      if (!d.team_name_ko?.trim()) return '부서명(한글)은 필수입니다.';
      // 트리거(50131/50132)가 최종 검증하지만, 여기서 먼저 안내한다(§2.3)
      if (!d.owner?.trim()) return '오너는 필수입니다. 직원을 먼저 등록하세요.';
      if (!d.leader_user_id?.trim()) return '리더는 필수입니다. 직원을 먼저 등록하세요.';
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      team_id: d.team_id,
      team_name: d.team_name ?? d.team_name_ko,
      team_name_ko: d.team_name_ko,
      owner: d.owner,
      leader_user_id: d.leader_user_id,
      pod_id: d.pod_id ?? null,
      note: d.note ?? null,
      status: d.status ?? toDbStatus('system_team', true),
    }),
  });

  const columns: ColumnsType<TeamRow> = [
    { title: '코드', dataIndex: 'team_id', width: 110 },
    { title: '부서명', dataIndex: 'team_name_ko' },
    { title: 'Pod', dataIndex: 'pod_id', width: 80 },
    { title: '오너', dataIndex: 'owner', width: 100 },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="system_team" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`부서 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input
            placeholder="부서명"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 200 }} allowClear
          />
        </SearchBar>
      }
      head={
        <>
          <AppToolbar
            mode={crud.mode} canEdit={canEdit} saving={crud.saving}
            onSearch={crud.runSearch} onCreate={crud.startCreate} onEdit={crud.startEdit}
            onSave={crud.save} onDelete={crud.remove} onCancel={crud.cancel}
          />
          <Table<TeamRow>
            rowKey="team_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.team_id === crud.selected?.team_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="부서 코드" required value={crud.draft.team_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ team_id: v })} />
            <TextField label="부서명 (한글)" required value={crud.draft.team_name_ko}
              disabled={!crud.editing} onChange={(v) => crud.patch({ team_name_ko: v })} />
            <TextField label="부서명 (영문)" value={crud.draft.team_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ team_name: v })} />

            <Field label="Pod">
              <LookupPopup
                search={searchPod}
                value={crud.draft.pod_id ?? ''}
                disabled={!crud.editing}
                onSelect={(p) => crud.patch({ pod_id: p.code })}
              />
            </Field>

            <Field label="오너" required
              hint="직원이 먼저 등록되어야 한다 — 부서↔직원 순환 의존(§9.9)">
              <LookupPopup
                search={searchEmployee}
                value={crud.draft.owner ?? ''}
                disabled={!crud.editing}
                onSelect={(e) => crud.patch({ owner: e.code })}
              />
            </Field>

            <Field label="리더" required>
              <LookupPopup
                search={searchEmployee}
                value={crud.draft.leader_user_id ?? ''}
                disabled={!crud.editing}
                onSelect={(e) => crud.patch({ leader_user_id: e.code })}
              />
            </Field>

            <TextField label="비고" value={crud.draft.note}
              disabled={!crud.editing} onChange={(v) => crud.patch({ note: v })} />
            <ActiveField
              active={isActive('system_team', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('system_team', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
