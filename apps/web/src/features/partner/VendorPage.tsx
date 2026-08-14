/**
 * 거래처 (partner_vendor) — 설계서 §8.3
 *
 * `partner_client` 의 거울 구조다. 다른 것은 PK·명칭·지급정책 참조 컬럼
 * (payment_type ↔ collecting_type) 셋뿐이며, 나머지는 PartnerFields 가 공유한다(§12.1).
 *
 * ⚠ status 극성 : PARTNER 계열은 **true = 사용** (SYSTEM 과 반대, §10.6)
 * ⚠ payment_type 은 varchar(10) 이다. 원본 프로시저 파라미터가 varchar(50) 이라
 *   무성 절단 위험이 있었고, 이식 시 바로잡았다(부록 C.4).
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

interface VendorRow extends PartnerCommon {
  company_id: string;
  entity_id: string;
  vendor_id: string;
  vendor_name: string;
  payment_type: string | null;
  payment_term_condition: string | null;
  vendor_address: string | null;
  status: boolean;
}

const searchTerm = makeLookup({
  from: 'partner_term',
  codeCol: 'term_id',
  nameCol: 'term_condition',
  activeFilter: { col: 'status', value: activeFilterValue('partner_term') },
});

export function VendorPage() {
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const crud = useMasterCrud<VendorRow>({
    key: 'partner_vendor',
    from: 'v_partner_vendor',
    select:
      'company_id, entity_id, vendor_id, vendor_name, payment_type, payment_term_condition, ' +
      'status, vat_id, nick_name, rep_name, reg_num, biz_industry, biz_category, ' +
      'vendor_address, phone_number, fax_number, bank_code, bank_branch, bank_account, ' +
      'bank_holder, website, industry, notes',
    table: 'partner_vendor',
    orderBy: 'vendor_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, vendor_id: r.vendor_id }),
    applyFilters: (q, f) => {
      let out = q;
      if (f.keyword) out = out.ilike('vendor_name', likePattern(String(f.keyword)));
      if (f.activeOnly) out = out.eq('status', activeFilterValue('partner_vendor'));
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      status: toDbStatus('partner_vendor', true),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.vendor_id?.trim()) return '거래처 코드는 필수입니다.';
      if (!d.vendor_name?.trim()) return '거래처명은 필수입니다.';
      return validateVatId(d.vat_id);
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      vendor_id: d.vendor_id,
      vendor_name: d.vendor_name,
      payment_type: d.payment_type ?? null,
      vendor_address: d.vendor_address ?? null,
      status: d.status ?? toDbStatus('partner_vendor', true),
      ...partnerCommonRow(d),
    }),
  });

  const columns: ColumnsType<VendorRow> = [
    { title: '코드', dataIndex: 'vendor_id', width: 120 },
    { title: '거래처명', dataIndex: 'vendor_name' },
    { title: '지급정책', dataIndex: 'payment_term_condition', width: 120 },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="partner_vendor" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`거래처 (${crud.total})`}
      search={
        <SearchBar
          loading={crud.fetching}
          onSearch={crud.runSearch}
          onReset={() => crud.setFilters({ activeOnly: true })}
        >
          <Input
            placeholder="거래처명"
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
          <Table<VendorRow>
            rowKey="vendor_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.vendor_id === crud.selected?.vendor_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="거래처 코드" required value={crud.draft.vendor_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ vendor_id: v })} />
            <TextField label="거래처명" required value={crud.draft.vendor_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ vendor_name: v })} />

            <Field label="지급정책 (F2 목록 · Enter 검색)">
              <LookupPopup
                search={searchTerm}
                value={crud.draft.payment_type ?? ''}
                displayName={crud.draft.payment_term_condition ?? ''}
                disabled={!crud.editing}
                onSelect={(t) =>
                  crud.patch({ payment_type: t.code, payment_term_condition: t.name })
                }
              />
            </Field>

            <PartnerFields<VendorRow>
              draft={crud.draft}
              patch={crud.patch}
              disabled={!crud.editing}
              address={crud.draft.vendor_address}
              onAddressChange={(v) => crud.patch({ vendor_address: v })}
            />

            <ActiveField
              active={isActive('partner_vendor', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('partner_vendor', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
