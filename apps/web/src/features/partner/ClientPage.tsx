/**
 * 고객사 (partner_client) — 설계서 §12.2
 *
 * Phase 1 에서 전 계층 연결을 증명한 참조 구현이었고, Phase 2 에서 공통 훅
 * `useMasterCrud` 로 옮겼다 — 화면별 중복 구현 금지(§12.1).
 *
 * ⚠ status 극성 : PARTNER 계열은 **true = 사용** (SYSTEM 과 반대, §10.6)
 */
import { Input, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { activeFilterValue, isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { useCan, useClaims } from '@/lib/session';
import { makeLookup, useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, Field, HeadDetailLayout, LookupPopup, SearchBar,
  StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';
import { PartnerFields, partnerCommonRow, validateVatId, type PartnerCommon } from './PartnerFields';

interface ClientRow extends PartnerCommon {
  company_id: string;
  entity_id: string;
  client_id: string;
  client_name: string;
  collecting_type: string | null;
  collecting_term_condition: string | null;
  client_address: string | null;
  status: boolean;
}

const searchTerm = makeLookup({
  from: 'partner_term',
  codeCol: 'term_id',
  nameCol: 'term_condition',
  activeFilter: { col: 'status', value: activeFilterValue('partner_term') },
});

export function ClientPage() {
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const crud = useMasterCrud<ClientRow>({
    key: 'partner_client',
    from: 'v_partner_client',
    select:
      'company_id, entity_id, client_id, client_name, collecting_type, ' +
      'collecting_term_condition, status, vat_id, nick_name, rep_name, reg_num, ' +
      'biz_industry, biz_category, client_address, phone_number, fax_number, ' +
      'bank_code, bank_branch, bank_account, bank_holder, website, industry, notes',
    table: 'partner_client',
    orderBy: 'client_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, client_id: r.client_id }),
    applyFilters: (q, f) => {
      let out = q;
      // ⚠ escapeLike 의무 — .ilike() 는 이스케이프하지 않는다(§10.4)
      if (f.keyword) out = out.ilike('client_name', likePattern(String(f.keyword)));
      // ⚠ 극성 리터럴 금지 — activeFilterValue 경유(§10.6)
      if (f.activeOnly) out = out.eq('status', activeFilterValue('partner_client'));
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      status: toDbStatus('partner_client', true),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.client_id?.trim()) return '고객사 코드는 필수입니다.';
      if (!d.client_name?.trim()) return '고객사명은 필수입니다.';
      return validateVatId(d.vat_id);
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      client_id: d.client_id,
      client_name: d.client_name,
      collecting_type: d.collecting_type ?? null,
      client_address: d.client_address ?? null,
      status: d.status ?? toDbStatus('partner_client', true),
      ...partnerCommonRow(d),
    }),
  });

  const columns: ColumnsType<ClientRow> = [
    { title: '코드', dataIndex: 'client_id', width: 120 },
    { title: '고객사명', dataIndex: 'client_name' },
    { title: '지급정책', dataIndex: 'collecting_term_condition', width: 120 },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="partner_client" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`고객사 (${crud.total})`}
      search={
        <SearchBar
          loading={crud.fetching}
          onSearch={crud.runSearch}
          onReset={() => crud.setFilters({ activeOnly: true })}
        >
          {/* 그룹/회사 조건이 없다 — 1인 1회사 고정(C3). RLS 가 스코프를 건다. */}
          <Input
            placeholder="고객사명"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 200 }} allowClear
          />
          <Select
            value={Boolean(crud.filters.activeOnly)}
            onChange={(v) => crud.setFilters({ ...crud.filters, activeOnly: v })}
            style={{ width: 120 }}
            options={[{ value: true, label: '사용중만' }, { value: false, label: '전체' }]}
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
          <Table<ClientRow>
            rowKey="client_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.client_id === crud.selected?.client_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="고객사 코드" required value={crud.draft.client_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ client_id: v })} />
            <TextField label="고객사명" required value={crud.draft.client_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ client_name: v })} />

            <Field label="지급정책 (F2 목록 · Enter 검색)">
              <LookupPopup
                search={searchTerm}
                value={crud.draft.collecting_type ?? ''}
                displayName={crud.draft.collecting_term_condition ?? ''}
                disabled={!crud.editing}
                onSelect={(t) =>
                  crud.patch({ collecting_type: t.code, collecting_term_condition: t.name })
                }
              />
            </Field>

            <PartnerFields<ClientRow>
              draft={crud.draft}
              patch={crud.patch}
              disabled={!crud.editing}
              address={crud.draft.client_address}
              onAddressChange={(v) => crud.patch({ client_address: v })}
            />
            <ActiveField
              active={isActive('partner_client', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('partner_client', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
