/**
 * 은행/카드 (finance_bank_account) — 설계서 §9.10 · §19.3
 *
 * ⚠ 계좌 XOR 카드 — 정확히 하나만 입력한다(`ck_bank_one`).
 *   v1.1 의 `CK_bank_shape` 는 "둘 다 NOT NULL 금지" 뿐이라 **둘 다 NULL 인 행이
 *   합법**이었고, "둘 중 하나 필수"는 프로시저 검증에만 있었다. v2.0 은 완전한 XOR 이다.
 *
 * ⚠⚠ **카드번호는 조회할 수 없다.** `card_number` 원문은 `authenticated` 에게
 *   SELECT 권한이 없고, 뷰가 마스킹된 값만 노출한다(§19.3).
 *   쓸 수는 있으나 되읽을 수 없는 write-only 컬럼이므로, **수정 시 다시 입력**해야 한다.
 *   누락하면 조용히 새는 것이 아니라 시끄럽게 깨진다 — 그것이 이 설계의 핵심이다.
 *
 * ⚠ status 극성 : `false = 사용` (PARTNER/GL 과 반대, §10.6)
 */
import { Alert, Input, Radio, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { activeFilterValue, isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { useCan, useClaims } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, Field, HeadDetailLayout, SearchBar, StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';

interface BankRow {
  company_id: string;
  entity_id: string;
  bank_id: string;
  bank_name: string | null;
  bank_account: string | null;
  /** 마스킹된 값. 원문은 조회 경로가 없다. */
  card_number_masked: string | null;
  is_card: boolean;
  status: boolean;
}

/** 폼에서만 쓰는 입력값 — 저장 시 계좌/카드 중 하나로 보낸다 */
interface BankDraft extends BankRow {
  _kind: 'account' | 'card';
  _cardInput: string;
}

export function BankAccountPage() {
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const crud = useMasterCrud<BankDraft>({
    key: 'finance_bank_account',
    from: 'v_finance_bank_account',
    select: 'company_id, entity_id, bank_id, bank_name, bank_account, card_number_masked, is_card, status',
    table: 'finance_bank_account',
    orderBy: 'bank_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, bank_id: r.bank_id }),
    applyFilters: (q, f) => {
      let out = q;
      if (f.keyword) out = out.ilike('bank_name', likePattern(String(f.keyword)));
      if (f.activeOnly) out = out.eq('status', activeFilterValue('finance_bank_account'));
      if (f.kind === 'card') out = out.eq('is_card', true);
      if (f.kind === 'account') out = out.eq('is_card', false);
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id, entity_id: claims?.entity_id,
      _kind: 'account', _cardInput: '',
      status: toDbStatus('finance_bank_account', true),
    } as Partial<BankDraft>),
    validate: (d, mode) => {
      if (mode === 'create' && !d.bank_id?.trim()) return '코드는 필수입니다.';
      if (!d.bank_name?.trim()) return '명칭은 필수입니다.';
      // ck_bank_one 을 화면이 먼저 안내한다(§2.3)
      if (d._kind === 'account') {
        if (!d.bank_account?.trim()) return '계좌번호는 필수입니다.';
      } else {
        // ⚠ 수정 시 카드번호를 다시 입력해야 한다 — 원문을 되읽을 수 없기 때문이다
        if (!d._cardInput?.trim()) {
          return mode === 'create'
            ? '카드번호는 필수입니다.'
            : '카드번호는 조회할 수 없으므로 수정 시 다시 입력해야 합니다.';
        }
      }
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id, entity_id: d.entity_id,
      bank_id: d.bank_id, bank_name: d.bank_name,
      // 정확히 하나만 채운다 — 반대편은 반드시 null 이어야 한다(ck_bank_one)
      bank_account: d._kind === 'account' ? d.bank_account : null,
      card_number: d._kind === 'card' ? (d._cardInput ?? '').trim() : null,
      status: d.status ?? toDbStatus('finance_bank_account', true),
    }),
  });

  const d = crud.draft;
  const isCard = d._kind === 'card';

  const columns: ColumnsType<BankDraft> = [
    { title: '코드', dataIndex: 'bank_id', width: 100 },
    { title: '명칭', dataIndex: 'bank_name' },
    {
      title: '구분', dataIndex: 'is_card', width: 80,
      render: (v: boolean) => <Tag color={v ? 'purple' : 'blue'}>{v ? '카드' : '계좌'}</Tag>,
    },
    {
      title: '번호', width: 180,
      render: (_, r) => (r.is_card ? r.card_number_masked : r.bank_account),
    },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="finance_bank_account" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`은행/카드 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch}
          onReset={() => crud.setFilters({ activeOnly: true })}>
          <Input placeholder="명칭"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 180 }} allowClear />
          <Select
            value={crud.filters.kind ?? ''} style={{ width: 110 }}
            onChange={(v) => crud.setFilters({ ...crud.filters, kind: v || undefined })}
            options={[
              { value: '', label: '전체' },
              { value: 'account', label: '계좌' },
              { value: 'card', label: '카드' },
            ]}
          />
          <Select
            value={Boolean(crud.filters.activeOnly)} style={{ width: 120 }}
            onChange={(v) => crud.setFilters({ ...crud.filters, activeOnly: v })}
            options={[{ value: true, label: '사용중만' }, { value: false, label: '전체' }]}
          />
        </SearchBar>
      }
      head={
        <>
          <AppToolbar
            mode={crud.mode} canEdit={canEdit} saving={crud.saving}
            onSearch={crud.runSearch}
            onCreate={crud.startCreate}
            onEdit={() => {
              // 카드는 원문을 되읽을 수 없으므로 수정 진입 시 입력칸을 비운다
              crud.patch({
                _kind: crud.selected?.is_card ? 'card' : 'account',
                _cardInput: '',
              } as Partial<BankDraft>);
              crud.startEdit();
            }}
            onSave={crud.save} onDelete={crud.remove} onCancel={crud.cancel}
          />
          <Table<BankDraft>
            rowKey="bank_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.bank_id === crud.selected?.bank_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({
              onClick: () =>
                void crud.selectRow({
                  ...r, _kind: r.is_card ? 'card' : 'account', _cardInput: '',
                }),
            })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="코드" required value={d.bank_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ bank_id: v })} />
            <TextField label="명칭" required value={d.bank_name}
              disabled={!crud.editing} onChange={(v) => crud.patch({ bank_name: v })} />

            <Field label="구분" required
              hint="계좌와 카드 중 정확히 하나만 등록한다 (ck_bank_one, FR-Bank-05)">
              <Radio.Group
                value={d._kind ?? 'account'}
                disabled={!crud.editing}
                onChange={(e) =>
                  crud.patch({
                    _kind: e.target.value,
                    bank_account: e.target.value === 'account' ? d.bank_account : null,
                    _cardInput: '',
                  } as Partial<BankDraft>)
                }
                options={[
                  { value: 'account', label: '계좌' },
                  { value: 'card', label: '카드' },
                ]}
                optionType="button"
              />
            </Field>

            {isCard ? (
              <>
                {crud.selected ? (
                  <Field label="등록된 카드번호">
                    <Input value={crud.selected.card_number_masked ?? '-'} disabled />
                  </Field>
                ) : null}
                <TextField
                  label={crud.mode === 'edit' ? '카드번호 (재입력)' : '카드번호'}
                  required
                  value={d._cardInput}
                  disabled={!crud.editing}
                  hint="원문은 조회할 수 없다. 수정 시 전체를 다시 입력해야 한다(§19.3)."
                  onChange={(v) => crud.patch({ _cardInput: v } as Partial<BankDraft>)}
                />
                {crud.mode === 'edit' ? (
                  <Alert type="warning" showIcon
                    message="카드번호를 다시 입력해야 저장됩니다"
                    description="보안상 원문을 되읽을 수 없어(write-only) 수정 시 전체를 재입력합니다." />
                ) : null}
              </>
            ) : (
              <TextField label="계좌번호" required value={d.bank_account}
                disabled={!crud.editing}
                hint="회사 내 중복 등록은 ux_bank_account 가 막는다"
                onChange={(v) => crud.patch({ bank_account: v })} />
            )}

            <ActiveField
              active={isActive('finance_bank_account', d.status)}
              disabled={!crud.editing}
              hint="⚠ 이 테이블은 false = 사용이다 (PARTNER/GL 과 극성 반대)"
              onChange={(v) => crud.patch({ status: toDbStatus('finance_bank_account', v) })}
            />
          </Space>
        ) : null
      }
    />
  );
}
