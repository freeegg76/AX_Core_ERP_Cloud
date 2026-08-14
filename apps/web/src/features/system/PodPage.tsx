/**
 * Pod (system_pod) — 설계서 §8.2
 *
 * ⚠ v1.1 은 `usp_system_pod_get` 이 없어 **상세 조회 자체가 불가능**했다(§11.2).
 *   PostgREST 는 모든 테이블에 단건 조회를 자동 제공하므로 그 제약이 소멸한다.
 * ⚠ pod_id 는 varchar(4) 다.
 */
import { Input, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { useClaims, useCan } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, HeadDetailLayout, SearchBar, StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';

interface PodRow {
  company_id: string;
  entity_id: string;
  pod_id: string;
  pod_name: string;
  status: boolean;
}

export function PodPage() {
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const crud = useMasterCrud<PodRow>({
    key: 'system_pod',
    from: 'system_pod',
    select: 'company_id, entity_id, pod_id, pod_name, status',
    table: 'system_pod',
    orderBy: 'pod_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, pod_id: r.pod_id }),
    applyFilters: (q, f) => (f.keyword ? q.ilike('pod_name', likePattern(String(f.keyword))) : q),
    emptyDraft: () => ({
      // 스코프는 클레임에서 채운다. RLS 의 WITH CHECK 가 다른 값을 거부한다(§5.2).
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      status: toDbStatus('system_pod', true),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.pod_id?.trim()) return 'Pod 코드는 필수입니다.';
      if (d.pod_id && d.pod_id.length > 4) return 'Pod 코드는 4자 이내입니다.';
      if (!d.pod_name?.trim()) return 'Pod 명은 필수입니다.';
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      pod_id: d.pod_id,
      pod_name: d.pod_name,
      status: d.status ?? toDbStatus('system_pod', true),
    }),
  });

  const columns: ColumnsType<PodRow> = [
    { title: '코드', dataIndex: 'pod_id', width: 100 },
    { title: 'Pod 명', dataIndex: 'pod_name' },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="system_pod" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`Pod (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input
            placeholder="Pod 명"
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
          <Table<PodRow>
            rowKey="pod_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.pod_id === crud.selected?.pod_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="Pod 코드" required value={crud.draft.pod_id}
              disabled={crud.mode !== 'create'} maxLength={4}
              hint="4자 이내"
              onChange={(v) => crud.patch({ pod_id: v })} />
            <TextField label="Pod 명" required value={crud.draft.pod_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ pod_name: v })} />
            <ActiveField
              active={isActive('system_pod', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('system_pod', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
