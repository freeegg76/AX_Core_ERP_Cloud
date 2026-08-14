/**
 * 회사 (system_entity) — 설계서 §8.2 · §12.5
 *
 * ⚠ CUD 는 ADMIN(§6.4). ⚠ status 극성 : false = 사용.
 * ⚠ `estabilish_date` 는 원본 DDL 의 오타이나 정본이다. 뷰가 `establish_date` 로
 *   별칭을 주므로 조회는 별칭, 쓰기는 원본 컬럼명을 쓴다(§8.5).
 */
import { Input, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { useCan } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, DateField, HeadDetailLayout, SearchBar, StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';

interface EntityRow {
  company_id: string;
  entity_id: string;
  entity_name: string;
  entity_name_ko: string;
  rep_name: string | null;
  reg_num: string | null;
  biz_num: string | null;
  biz_industry: string | null;
  biz_category: string | null;
  address: string | null;
  establish_date: string | null;
  phone_number: string | null;
  fax_number: string | null;
  status: boolean;
}

export function EntityPage() {
  const canEdit = useCan('ADMIN');

  const crud = useMasterCrud<EntityRow>({
    key: 'system_entity',
    from: 'v_system_entity',
    select:
      'company_id, entity_id, entity_name, entity_name_ko, rep_name, reg_num, biz_num, ' +
      'biz_industry, biz_category, address, establish_date, phone_number, fax_number, status',
    table: 'system_entity',
    orderBy: 'entity_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id }),
    applyFilters: (q, f) =>
      f.keyword ? q.ilike('entity_name_ko', likePattern(String(f.keyword))) : q,
    emptyDraft: () => ({ status: toDbStatus('system_entity', true) }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.entity_id?.trim()) return '회사 코드는 필수입니다.';
      if (!d.entity_name?.trim()) return '회사명(영문)은 필수입니다.';
      if (!d.entity_name_ko?.trim()) return '회사명(한글)은 필수입니다.';
      return null;
    },
    toDbRow: (d) => ({
      // company_id 는 RLS 가 강제하므로 화면이 정하지 않는다.
      // INSERT 시 클레임과 다른 값을 넣으면 WITH CHECK 가 42501 로 거부한다(§5.2).
      company_id: d.company_id,
      entity_id: d.entity_id,
      entity_name: d.entity_name,
      entity_name_ko: d.entity_name_ko,
      rep_name: d.rep_name ?? null,
      reg_num: d.reg_num ?? null,
      biz_num: d.biz_num ?? null,
      biz_industry: d.biz_industry ?? null,
      biz_category: d.biz_category ?? null,
      address: d.address ?? null,
      // ⚠ 쓰기는 원본 컬럼명(오타 포함)이다
      estabilish_date: d.establish_date ?? null,
      phone_number: d.phone_number ?? null,
      fax_number: d.fax_number ?? null,
      status: d.status ?? toDbStatus('system_entity', true),
    }),
  });

  const columns: ColumnsType<EntityRow> = [
    { title: '코드', dataIndex: 'entity_id', width: 110 },
    { title: '회사명', dataIndex: 'entity_name_ko' },
    { title: '사업자번호', dataIndex: 'biz_num', width: 130 },
    {
      title: '상태',
      dataIndex: 'status',
      width: 90,
      render: (v: boolean) => <StatusBadge table="system_entity" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`회사 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input
            placeholder="회사명"
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
          <Table<EntityRow>
            rowKey="entity_id"
            size="small"
            loading={crud.loading}
            columns={columns}
            dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.entity_id === crud.selected?.entity_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="회사 코드" required value={crud.draft.entity_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ entity_id: v })} />
            <TextField label="회사명 (영문)" required value={crud.draft.entity_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ entity_name: v })} />
            <TextField label="회사명 (한글)" required value={crud.draft.entity_name_ko}
              disabled={!crud.editing} onChange={(v) => crud.patch({ entity_name_ko: v })} />
            <TextField label="대표자" value={crud.draft.rep_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ rep_name: v })} />
            <TextField label="사업자번호" value={crud.draft.biz_num}
              disabled={!crud.editing} onChange={(v) => crud.patch({ biz_num: v })} />
            <TextField label="법인번호" value={crud.draft.reg_num}
              disabled={!crud.editing} onChange={(v) => crud.patch({ reg_num: v })} />
            <TextField label="업태" value={crud.draft.biz_industry}
              disabled={!crud.editing} onChange={(v) => crud.patch({ biz_industry: v })} />
            <TextField label="종목" value={crud.draft.biz_category}
              disabled={!crud.editing} onChange={(v) => crud.patch({ biz_category: v })} />
            <TextField label="주소" value={crud.draft.address}
              disabled={!crud.editing} onChange={(v) => crud.patch({ address: v })} />
            <DateField label="설립일" value={crud.draft.establish_date}
              disabled={!crud.editing} onChange={(v) => crud.patch({ establish_date: v })} />
            <TextField label="전화번호" value={crud.draft.phone_number}
              disabled={!crud.editing} onChange={(v) => crud.patch({ phone_number: v })} />
            <ActiveField
              active={isActive('system_entity', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('system_entity', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
