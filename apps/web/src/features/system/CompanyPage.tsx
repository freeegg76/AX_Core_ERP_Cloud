/**
 * 그룹 (system_company) — 설계서 §8.2 · §12.5
 *
 * ⚠ CUD 는 ADMIN 이다(§6.4). v1.1 은 EDITOR 였으나, 테넌트 마스터를 EDITOR 가
 *   지우면 그 회사의 전 데이터가 고아가 되므로 상향했다 — §16.3 #6 (고객 확인 필요).
 * ⚠ status 극성 : SYSTEM 계열은 false = 사용 (§10.6)
 */
import { Input, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { useCan } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, HeadDetailLayout, SearchBar, StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';

interface CompanyRow {
  company_id: string;
  company_name: string;
  company_name_ko: string;
  note: string | null;
  description: string | null;
  status: boolean;
}

export function CompanyPage() {
  const canEdit = useCan('ADMIN');

  const crud = useMasterCrud<CompanyRow>({
    key: 'system_company',
    from: 'v_system_company',
    select: 'company_id, company_name, company_name_ko, note, description, status',
    table: 'system_company',
    orderBy: 'company_id',
    pk: (r) => ({ company_id: r.company_id }),
    applyFilters: (q, f) =>
      f.keyword ? q.ilike('company_name_ko', likePattern(String(f.keyword))) : q,
    emptyDraft: () => ({ status: toDbStatus('system_company', true) }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.company_id?.trim()) return '그룹 코드는 필수입니다.';
      if (!d.company_name?.trim()) return '그룹명(영문)은 필수입니다.';
      if (!d.company_name_ko?.trim()) return '그룹명(한글)은 필수입니다.';
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      company_name: d.company_name,
      company_name_ko: d.company_name_ko,
      note: d.note ?? null,
      description: d.description ?? null,
      status: d.status ?? toDbStatus('system_company', true),
    }),
  });

  const columns: ColumnsType<CompanyRow> = [
    { title: '코드', dataIndex: 'company_id', width: 120 },
    { title: '그룹명', dataIndex: 'company_name_ko' },
    {
      title: '상태',
      dataIndex: 'status',
      width: 90,
      render: (v: boolean) => <StatusBadge table="system_company" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`그룹 (${crud.total})`}
      search={
        <SearchBar
          loading={crud.fetching}
          onSearch={crud.runSearch}
          onReset={() => crud.setFilters({})}
        >
          <Input
            placeholder="그룹명"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 200 }}
            allowClear
          />
        </SearchBar>
      }
      head={
        <>
          <AppToolbar
            mode={crud.mode}
            canEdit={canEdit}
            saving={crud.saving}
            onSearch={crud.runSearch}
            onCreate={crud.startCreate}
            onEdit={crud.startEdit}
            onSave={crud.save}
            onDelete={crud.remove}
            onCancel={crud.cancel}
          />
          <Table<CompanyRow>
            rowKey="company_id"
            size="small"
            loading={crud.loading}
            columns={columns}
            dataSource={crud.rows}
            pagination={{
              current: crud.page.page,
              pageSize: crud.page.size,
              total: crud.total,
              size: 'small',
              showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) =>
              r.company_id === crud.selected?.company_id ? 'ant-table-row-selected' : ''
            }
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField
              label="그룹 코드"
              required
              value={crud.draft.company_id}
              // 식별키는 수정모드에서 읽기전용(§12.5)
              disabled={crud.mode !== 'create'}
              maxLength={10}
              onChange={(v) => crud.patch({ company_id: v })}
            />
            <TextField
              label="그룹명 (영문)"
              required
              value={crud.draft.company_name}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ company_name: v })}
            />
            <TextField
              label="그룹명 (한글)"
              required
              value={crud.draft.company_name_ko}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ company_name_ko: v })}
            />
            <TextField
              label="비고"
              value={crud.draft.note}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ note: v })}
            />
            <ActiveField
              active={isActive('system_company', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('system_company', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
