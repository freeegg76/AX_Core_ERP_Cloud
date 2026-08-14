/**
 * 계정과목 (finance_gl) — 설계서 §12.5 · §7.4 · §9.7
 *
 * **2-Frame** — 좌 Head(계정구분·코드·명칭 3열) / 우 Detail(전체 + Layer3 플래그 12종)
 *
 * ⚠ Layer3 플래그 12종은 **컬럼명이 FK 컬럼과 같지만 boolean 플래그**다(§8.5 설계결정).
 *   `finance_gl.bank_id = true` → 전표에서 은행/카드 선택 활성, `false` → 입력·저장 금지.
 *   전표 화면이 이 플래그로 입력영역을 켜고 끈다(FR-GL-06).
 *
 * ⚠ Slot 1~5 의 레이블은 **실제 관리항목명**을 쓴다(§12.5). 미등록 Slot 은 비활성.
 *   v_finance_gl_full 이 dimension1_name~5_name 을 조인해 준다(§10.3).
 *
 * ⚠ contra_gl 은 `gl_detail='1'`(차감항목)일 때만 입력하고 자기 자신을 지정할 수 없다(§7.4).
 *   ck_gl_contra_shape · ck_gl_contra_self · trg_finance_gl_refs 가 DB 에서 강제한다.
 */
import { App as AntApp, Button, Checkbox, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GL_DETAIL, GL_TYPE, LAYER3_LABEL, activeFilterValue, isActive, toDbStatus,
  type GlType, type Layer3Flag,
} from '@ax-bridge/shared-constants';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { likePattern } from '@/lib/query';
import { useCan, useClaims } from '@/lib/session';
import { makeLookup, useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, Field, LookupPopup, SearchBar, SelectField,
  StatusBadge, TextField, TwoFrameLayout, confirmAction,
} from '@/shared/ui';
import { generateStandardGl } from '@/lib/rpc';

/** Layer3 플래그 12종 — 앞 7종은 고정 항목, 뒤 5종은 관리항목 Slot */
const FIXED_FLAGS: Layer3Flag[] = [
  'bank_id', 'team_id', 'pod_id', 'employee_id', 'client_id', 'vendor_id', 'due_date',
];
const SLOT_FLAGS: Layer3Flag[] = ['dimension1', 'dimension2', 'dimension3', 'dimension4', 'dimension5'];

interface GlRow extends Record<Layer3Flag, boolean> {
  company_id: string;
  entity_id: string;
  gl_id: string;
  gl_name: string | null;
  gl_type: GlType | null;
  gl_category1: string | null;
  gl_category2: string | null;
  vat_gl: string | null;
  gl_detail: string | null;
  contra_gl: string | null;
  status: boolean;
  dimension1_name: string | null;
  dimension2_name: string | null;
  dimension3_name: string | null;
  dimension4_name: string | null;
  dimension5_name: string | null;
}

const searchGl = makeLookup({
  from: 'v_finance_gl', codeCol: 'gl_id', nameCol: 'gl_name',
  activeFilter: { col: 'status', value: activeFilterValue('finance_gl') },
});

export function GlPage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');
  const canAdmin = useCan('ADMIN');
  const claims = useClaims();

  const crud = useMasterCrud<GlRow>({
    key: 'finance_gl',
    from: 'v_finance_gl_full',
    select:
      'company_id, entity_id, gl_id, gl_name, gl_type, gl_category1, gl_category2, vat_gl, ' +
      'gl_detail, contra_gl, status, bank_id, team_id, pod_id, employee_id, client_id, ' +
      'vendor_id, dimension1, dimension2, dimension3, dimension4, dimension5, due_date, ' +
      'dimension1_name, dimension2_name, dimension3_name, dimension4_name, dimension5_name',
    table: 'finance_gl',
    orderBy: 'gl_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, gl_id: r.gl_id }),
    applyFilters: (q, f) => {
      let out = q;
      if (f.keyword) {
        const kw = likePattern(String(f.keyword));
        out = out.or(`gl_id.ilike.${kw},gl_name.ilike.${kw}`);
      }
      if (f.glType) out = out.eq('gl_type', f.glType);
      if (f.activeOnly) out = out.eq('status', activeFilterValue('finance_gl'));
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id, entity_id: claims?.entity_id,
      gl_detail: '0', status: toDbStatus('finance_gl', true),
      ...Object.fromEntries([...FIXED_FLAGS, ...SLOT_FLAGS].map((f) => [f, false])),
    } as Partial<GlRow>),
    validate: (d, mode) => {
      if (mode === 'create' && !d.gl_id?.trim()) return '계정코드는 필수입니다.';
      if (!d.gl_name?.trim()) return '계정명은 필수입니다.';
      if (!d.gl_type) return '계정구분은 필수입니다.';
      // ck_gl_contra_shape / ck_gl_contra_self 를 화면이 먼저 안내한다(§2.3)
      if (d.gl_detail !== '1' && d.contra_gl) {
        return '차감항목이 아닌 계정에는 차감 대상을 지정할 수 없습니다.';
      }
      if (d.contra_gl && d.contra_gl === d.gl_id) {
        return '차감계정은 자기 자신을 지정할 수 없습니다.';
      }
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id, entity_id: d.entity_id,
      gl_id: d.gl_id, gl_name: d.gl_name, gl_type: d.gl_type,
      gl_category1: d.gl_category1 ?? null,
      gl_category2: d.gl_category2 ?? null,
      vat_gl: d.vat_gl ?? null,
      gl_detail: d.gl_detail ?? '0',
      // 차감항목이 아니면 contra_gl 을 비운다 — 제약 위반 예방
      contra_gl: d.gl_detail === '1' ? (d.contra_gl ?? null) : null,
      status: d.status ?? toDbStatus('finance_gl', true),
      ...Object.fromEntries([...FIXED_FLAGS, ...SLOT_FLAGS].map((f) => [f, d[f] ?? false])),
    }),
  });

  /** 전표가 1건이라도 있으면 표준 GL 재생성이 불가능하다(§9.7) */
  const ledgerCount = useQuery({
    queryKey: ['ledger_exists'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('finance_ledger_head').select('ledger_no', { count: 'exact', head: true });
      if (error) throw new AxRequestError(toAxError(error));
      return count ?? 0;
    },
  });

  const generate = useMutation({
    mutationFn: generateStandardGl,
    onSuccess: (r) => {
      message.success(`표준 계정과목 ${r.inserted_count}건을 생성했습니다.`);
      void qc.invalidateQueries({ queryKey: ['finance_gl'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const d = crud.draft;
  const isContra = d.gl_detail === '1';
  const slotName = (i: number) =>
    (d[`dimension${i}_name` as keyof GlRow] as string | null) ?? null;

  /** 좌 프레임 — 계정구분·코드·명칭 3열(§12.5) */
  const columns: ColumnsType<GlRow> = [
    {
      title: '구분', dataIndex: 'gl_type', width: 90,
      render: (v: GlType | null) => (v ? GL_TYPE[v] : '-'),
    },
    { title: '코드', dataIndex: 'gl_id', width: 100 },
    { title: '계정명', dataIndex: 'gl_name', ellipsis: true },
  ];

  const flagCheckbox = (f: Layer3Flag, label: string, disabled = false) => (
    <Checkbox
      key={f}
      checked={Boolean(d[f])}
      disabled={!crud.editing || disabled}
      onChange={(e) => crud.patch({ [f]: e.target.checked } as Partial<GlRow>)}
    >
      {label}
    </Checkbox>
  );

  return (
    <Space direction="vertical" style={{ width: '100%', height: '100%' }} size="small">
      <SearchBar loading={crud.fetching} onSearch={crud.runSearch}
        onReset={() => crud.setFilters({ activeOnly: true })}>
        <Input placeholder="계정코드 / 계정명"
          value={String(crud.filters.keyword ?? '')}
          onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
          style={{ width: 200 }} allowClear />
        <Select
          value={crud.filters.glType ?? ''} style={{ width: 140 }}
          onChange={(v) => crud.setFilters({ ...crud.filters, glType: v || undefined })}
          options={[{ value: '', label: '전체 구분' },
            ...Object.entries(GL_TYPE).map(([value, label]) => ({ value, label }))]}
        />
        <Select
          value={Boolean(crud.filters.activeOnly)} style={{ width: 120 }}
          onChange={(v) => crud.setFilters({ ...crud.filters, activeOnly: v })}
          options={[{ value: true, label: '사용중만' }, { value: false, label: '전체' }]}
        />
      </SearchBar>

      <AppToolbar
        mode={crud.mode} canEdit={canEdit} saving={crud.saving}
        onSearch={crud.runSearch} onCreate={crud.startCreate} onEdit={crud.startEdit}
        onSave={crud.save} onDelete={crud.remove} onCancel={crud.cancel}
        extra={
          // 설계서 §12.5 — 「계정과목 생성」. 전표가 있으면 비활성(§9.7)
          <Tooltip title={
            !canAdmin ? '관리자 권한이 필요합니다'
              : (ledgerCount.data ?? 0) > 0
                ? `전표 ${ledgerCount.data}건이 존재해 재생성할 수 없습니다`
                : '표준 계정과목 355건으로 전면 교체합니다'
          }>
            <Button
              danger
              loading={generate.isPending}
              disabled={!canAdmin || (ledgerCount.data ?? 0) > 0 || crud.editing}
              onClick={() => {
                void confirmAction({
                  title: '표준 계정과목을 재생성하시겠습니까?',
                  content: '기존 계정과목이 전부 삭제되고 표준 355건으로 교체됩니다. 되돌릴 수 없습니다.',
                  okText: '재생성', danger: true,
                }).then((ok) => ok && generate.mutate());
              }}
            >
              계정과목 생성
            </Button>
          </Tooltip>
        }
      />

      <TwoFrameLayout
        left={
          <Table<GlRow>
            rowKey="gl_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.gl_id === crud.selected?.gl_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        }
        right={
          crud.selected || crud.editing ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <TextField label="계정코드" required value={d.gl_id}
                disabled={crud.mode !== 'create'} maxLength={10}
                onChange={(v) => crud.patch({ gl_id: v })} />
              <TextField label="계정명" required value={d.gl_name}
                disabled={!crud.editing} onChange={(v) => crud.patch({ gl_name: v })} />
              <SelectField<GlType>
                label="계정구분" required value={d.gl_type ?? undefined}
                disabled={!crud.editing}
                onChange={(v) => crud.patch({ gl_type: v })}
                options={Object.entries(GL_TYPE).map(([value, label]) => ({
                  value: value as GlType, label,
                }))}
              />
              <TextField label="분류1" value={d.gl_category1}
                disabled={!crud.editing} onChange={(v) => crud.patch({ gl_category1: v })} />
              <TextField label="분류2" value={d.gl_category2}
                disabled={!crud.editing} onChange={(v) => crud.patch({ gl_category2: v })} />
              <TextField label="부가세 구분" value={d.vat_gl}
                disabled={!crud.editing} onChange={(v) => crud.patch({ vat_gl: v })} />

              <SelectField
                label="계정 상세구분" value={d.gl_detail ?? '0'}
                disabled={!crud.editing}
                onChange={(v) =>
                  // 차감항목이 아니게 되면 contra_gl 을 즉시 비운다 — 제약 위반 예방
                  crud.patch(v === '1' ? { gl_detail: v } : { gl_detail: v, contra_gl: null })
                }
                options={Object.entries(GL_DETAIL).map(([value, label]) => ({ value, label }))}
              />

              <Field label="차감 대상 계정 (contra)"
                hint="차감항목일 때만 입력한다. 자기 자신은 지정할 수 없고, 동일 회사의 사용중 계정만 가능하다.">
                <LookupPopup
                  search={searchGl}
                  value={d.contra_gl ?? ''}
                  disabled={!crud.editing || !isContra}
                  onSelect={(g) => {
                    if (g.code === d.gl_id) {
                      message.error('차감계정은 자기 자신을 지정할 수 없습니다.');
                      return;
                    }
                    crud.patch({ contra_gl: g.code });
                  }}
                />
              </Field>

              <ActiveField
                active={isActive('finance_gl', d.status)}
                disabled={!crud.editing}
                onChange={(v) => crud.patch({ status: toDbStatus('finance_gl', v) })}
              />

              {/* ── Layer3 입력영역 사용 플래그 12종 (FR-GL-06) ─────────── */}
              <Field label="전표 Layer3 입력영역 사용여부"
                hint="여기서 켠 항목만 전표 화면에서 입력할 수 있다. 끄면 값을 저장할 수 없다(AX-50466).">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space wrap>
                    {FIXED_FLAGS.map((f) => flagCheckbox(f, LAYER3_LABEL[f]))}
                  </Space>
                  <div style={{ borderTop: '1px dashed #eee', paddingTop: 8 }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                      관리항목 Slot — 레이블은 실제 등록된 관리항목명이다
                    </div>
                    <Space wrap>
                      {SLOT_FLAGS.map((f, i) => {
                        const name = slotName(i + 1);
                        return (
                          <Tooltip key={f} title={name ? undefined : '미등록 Slot 입니다. 관리항목을 먼저 등록하세요.'}>
                            <span>
                              {flagCheckbox(f, name ?? `Slot${i + 1} — (미등록)`, !name)}
                            </span>
                          </Tooltip>
                        );
                      })}
                    </Space>
                  </div>
                </Space>
              </Field>

              {crud.selected ? (
                <Field label="상태">
                  <StatusBadge table="finance_gl" status={crud.selected.status} />
                  {crud.selected.contra_gl ? (
                    <Tag style={{ marginLeft: 8 }}>차감 → {crud.selected.contra_gl}</Tag>
                  ) : null}
                </Field>
              ) : null}
            </Space>
          ) : null
        }
      />
    </Space>
  );
}
