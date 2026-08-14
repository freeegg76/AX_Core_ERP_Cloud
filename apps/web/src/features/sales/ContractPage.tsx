/**
 * 계약 (sales_contract) — 설계서 §8.4 · §11.2
 *
 * ⚠ PK 가 `(contract_id, contract_type)` **복합키**다. v1.1 은 이 때문에 경로에
 *   두 세그먼트를 넣어야 했으나(`PUT /sales/contracts/{id}/{type}`), PostgREST 는
 *   필터로 표현하므로 경로 설계 문제가 소멸한다(§11.2).
 *
 * ⚠ 전표 연결/해제는 **RPC 전용**이다(`ax_sales_contract_link_ledger`).
 *   두 컬럼(ledger_date/ledger_no)을 함께 바꿔야 하고 전표 실재 확인이 필요하다.
 *   CK_ct_ledger 가 "둘 다 입력 or 둘 다 NULL"을 DB 에서 강제한다(FR-Contract-08).
 */
import { App as AntApp, Button, DatePicker, Input, InputNumber, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_STATUS, activeFilterValue, type ContractStatus } from '@ax-bridge/shared-constants';
import { useCan, useClaims } from '@/lib/session';
import { makeLookup, useMasterCrud } from '@/shared/hooks';
import {
  AppToolbar, DateField, Field, HeadDetailLayout, LookupPopup, NumberField,
  SearchBar, SelectField, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';
import { linkContractLedger } from '@/lib/rpc';
import { toAxError } from '@/lib/errors';

const CONTRACT_TYPE = {
  '0': '표준', '1': '위탁', '2': '용역', '3': '유지보수', '4': '라이선스', '5': '기타',
} as const;

interface ContractRow {
  company_id: string;
  entity_id: string;
  contract_id: string;
  contract_type: string;
  client_id: string;
  client_name: string | null;
  pipeline_id: string | null;
  start_date: string;
  end_date: string;
  status: ContractStatus;
  contract_amount: number | null;
  ledger_date: string | null;
  ledger_no: number | null;
  has_ledger: boolean;
  closed_date: string | null;
}

const searchClient = makeLookup({
  from: 'v_partner_client', codeCol: 'client_id', nameCol: 'client_name',
  activeFilter: { col: 'status', value: activeFilterValue('partner_client') },
});

export function ContractPage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const [ledgerDate, setLedgerDate] = useState<dayjs.Dayjs | null>(null);
  const [ledgerNo, setLedgerNo] = useState<number | null>(null);

  const crud = useMasterCrud<ContractRow>({
    key: 'sales_contract',
    from: 'v_sales_contract',
    select:
      'company_id, entity_id, contract_id, contract_type, client_id, client_name, ' +
      'pipeline_id, start_date, end_date, status, contract_amount, ledger_date, ' +
      'ledger_no, has_ledger, closed_date',
    table: 'sales_contract',
    orderBy: 'contract_id',
    // ⚠ 복합 PK — 두 컬럼을 모두 필터에 넣어야 한다
    pk: (r) => ({
      company_id: r.company_id, entity_id: r.entity_id,
      contract_id: r.contract_id, contract_type: r.contract_type,
    }),
    applyFilters: (q, f) => {
      let out = q;
      if (f.keyword) out = out.ilike('client_name', likePattern(String(f.keyword)));
      if (f.status) out = out.eq('status', f.status);
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id, entity_id: claims?.entity_id,
      contract_type: '0', status: '0' as ContractStatus,
      start_date: dayjs().format('YYYY-MM-DD'),
      end_date: dayjs().add(1, 'year').format('YYYY-MM-DD'),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.contract_id?.trim()) return '계약번호는 필수입니다.';
      if (!d.client_id?.trim()) return '고객사는 필수입니다.';
      if (!d.start_date || !d.end_date) return '계약 시작일과 종료일은 필수입니다.';
      // CK_ct_dates 가 최종 강제하지만 화면이 먼저 안내한다(§2.3)
      if (dayjs(d.end_date).isBefore(dayjs(d.start_date))) {
        return '계약 종료일은 시작일보다 빠를 수 없습니다.';
      }
      return null;
    },
    // ⚠ ledger_date/ledger_no 를 보내지 않는다 — 전표 연결은 RPC 전용이다
    toDbRow: (d) => ({
      company_id: d.company_id, entity_id: d.entity_id,
      contract_id: d.contract_id,
      contract_type: d.contract_type ?? '0',
      client_id: d.client_id,
      pipeline_id: d.pipeline_id ?? null,
      start_date: d.start_date,
      end_date: d.end_date,
      status: d.status ?? '0',
      contract_amount: d.contract_amount ?? null,
      closed_date: d.closed_date ?? null,
    }),
  });

  const sel = crud.selected;

  /** 전표 연결/해제 — RPC. 인자를 비우면 해제된다. */
  const linkLedger = useMutation({
    mutationFn: (unlink: boolean) =>
      linkContractLedger(
        sel!.contract_id, sel!.contract_type,
        unlink ? undefined : (ledgerDate?.format('YYYY-MM-DD') ?? undefined),
        unlink ? undefined : (ledgerNo ?? undefined),
      ),
    onSuccess: (_d, unlink) => {
      message.success(unlink ? '전표 연결을 해제했습니다.' : '전표를 연결했습니다.');
      setLedgerDate(null);
      setLedgerNo(null);
      void qc.invalidateQueries({ queryKey: ['sales_contract'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const columns: ColumnsType<ContractRow> = [
    { title: '계약번호', dataIndex: 'contract_id', width: 130 },
    {
      title: '구분', dataIndex: 'contract_type', width: 90,
      render: (v: keyof typeof CONTRACT_TYPE) => CONTRACT_TYPE[v],
    },
    { title: '고객사', dataIndex: 'client_name' },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: ContractStatus) => (
        <Tag color={v === '0' ? 'green' : v === '2' ? 'orange' : 'default'}>
          {CONTRACT_STATUS[v]}
        </Tag>
      ),
    },
    {
      title: '전표', dataIndex: 'has_ledger', width: 70,
      render: (v: boolean) => (v ? <Tag color="blue">연결</Tag> : null),
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`계약 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input placeholder="고객사명"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 180 }} allowClear />
          <Select
            value={crud.filters.status ?? ''} style={{ width: 130 }}
            onChange={(v) => crud.setFilters({ ...crud.filters, status: v || undefined })}
            options={[{ value: '', label: '전체 상태' },
              ...Object.entries(CONTRACT_STATUS).map(([value, label]) => ({ value, label }))]}
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
          <Table<ContractRow>
            // ⚠ 복합 PK 라 rowKey 도 두 컬럼을 합쳐야 한다
            rowKey={(r) => `${r.contract_id}|${r.contract_type}`}
            size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) =>
              r.contract_id === sel?.contract_id && r.contract_type === sel?.contract_type
                ? 'ant-table-row-selected' : ''
            }
            onRow={(r) => ({ onClick: () => { setLedgerDate(null); setLedgerNo(null); void crud.selectRow(r); } })}
          />
        </>
      }
      detail={
        sel || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <TextField label="계약번호" required value={crud.draft.contract_id}
                disabled={crud.mode !== 'create'} maxLength={20}
                onChange={(v) => crud.patch({ contract_id: v })} />
              <SelectField
                label="계약구분" required value={crud.draft.contract_type ?? '0'}
                // 복합 PK 의 일부이므로 수정모드에서 변경 불가
                disabled={crud.mode !== 'create'}
                hint="계약번호와 함께 PK 를 이룬다 — 수정할 수 없다"
                onChange={(v) => crud.patch({ contract_type: v })}
                options={Object.entries(CONTRACT_TYPE).map(([value, label]) => ({ value, label }))}
              />
              <Field label="고객사" required>
                <LookupPopup search={searchClient}
                  value={crud.draft.client_id ?? ''}
                  displayName={crud.draft.client_name ?? ''}
                  disabled={!crud.editing}
                  onSelect={(c) => crud.patch({ client_id: c.code, client_name: c.name })} />
              </Field>
              <DateField label="시작일" required value={crud.draft.start_date}
                disabled={!crud.editing} onChange={(v) => crud.patch({ start_date: v ?? undefined })} />
              <DateField label="종료일" required value={crud.draft.end_date}
                disabled={!crud.editing} onChange={(v) => crud.patch({ end_date: v ?? undefined })} />
              <SelectField<ContractStatus>
                label="상태" value={crud.draft.status ?? '0'}
                disabled={!crud.editing}
                onChange={(v) => crud.patch({ status: v })}
                options={Object.entries(CONTRACT_STATUS).map(([value, label]) => ({
                  value: value as ContractStatus, label,
                }))}
              />
              <NumberField label="계약금액" value={crud.draft.contract_amount ?? null}
                disabled={!crud.editing}
                onChange={(v) => crud.patch({ contract_amount: v })} />
            </div>

            {/* ── 전표 연결 — RPC 전용 ─────────────────────────────────── */}
            {sel && !crud.editing ? (
              <Field label="전표 연결"
                hint="전표일자와 전표번호는 함께 입력하거나 함께 비운다 (CK_ct_ledger, FR-Contract-08)">
                {sel.has_ledger ? (
                  <Space>
                    <Tag color="blue">{sel.ledger_date} / {sel.ledger_no}</Tag>
                    <Button danger size="small" disabled={!canEdit}
                      loading={linkLedger.isPending}
                      onClick={() => linkLedger.mutate(true)}>
                      연결 해제
                    </Button>
                  </Space>
                ) : (
                  <Space>
                    <DatePicker value={ledgerDate} onChange={setLedgerDate} placeholder="전표일자" />
                    <InputNumber value={ledgerNo} onChange={(v) => setLedgerNo(v as number | null)}
                      placeholder="전표번호" precision={0} style={{ width: 120 }} />
                    <Button type="primary" size="small" disabled={!canEdit}
                      loading={linkLedger.isPending}
                      onClick={() => linkLedger.mutate(false)}>
                      연결
                    </Button>
                  </Space>
                )}
              </Field>
            ) : null}
          </Space>
        ) : null
      }
    />
  );
}
