/**
 * 지급/수금 정책 (partner_term) — 설계서 §8.3 · §9.11
 *
 * 규칙 (CK_term_shape 가 DB 에서 강제한다)
 *   EOM  : 기준월 말일 + offset_days   → fixed_day 는 NULL, offset_days >= 0
 *   CURM : 기준월 fixed_day 일          → fixed_day 1~31, offset_days = 0
 *
 * ⚠ `term_condition`(표시용 정책식)은 **BEFORE 트리거가 자동 구성**한다.
 *   화면이 입력하지 않으며, 입력해도 덮어써진다(§9.11).
 *
 * ⚠⚠ 지급일 미리보기는 `ax_partner_term_calc_due` **RPC 를 호출**한다.
 *   프론트엔드는 이 계산을 재구현하지 않는다 — v1.1 §15.1 이 경고한
 *   "미리보기와 저장이 갈린다"를 설계에서 제거한 것이다(§9.11 · §2.3).
 *   월말 보정과 윤년 처리가 저장 경로와 100% 같음이 구조적으로 보장된다.
 */
import { useState } from 'react';
import { App as AntApp, Alert, Button, DatePicker, Input, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { TERM_BASE_RULE, isActive, toDbStatus, type TermBaseRule } from '@ax-bridge/shared-constants';
import { useCan, useClaims } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, Field, HeadDetailLayout, NumberField, SearchBar,
  SelectField, StatusBadge, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';
import { calcDueDate } from '@/lib/rpc';
import { toAxError } from '@/lib/errors';

interface TermRow {
  company_id: string;
  entity_id: string;
  term_id: string;
  term_condition: string;
  base_rule: TermBaseRule;
  fixed_day: number | null;
  offset_days: number;
  status: boolean;
}

export function TermPage() {
  const { message } = AntApp.useApp();
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const [baseDate, setBaseDate] = useState(dayjs());
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const crud = useMasterCrud<TermRow>({
    key: 'partner_term',
    from: 'partner_term',
    select: 'company_id, entity_id, term_id, term_condition, base_rule, fixed_day, offset_days, status',
    table: 'partner_term',
    orderBy: 'term_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, term_id: r.term_id }),
    applyFilters: (q, f) => (f.keyword ? q.ilike('term_id', likePattern(String(f.keyword))) : q),
    emptyDraft: () => ({
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      base_rule: 'EOM' as TermBaseRule,
      offset_days: 0,
      fixed_day: null,
      status: toDbStatus('partner_term', true),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.term_id?.trim()) return '정책 코드는 필수입니다.';
      // CK_term_shape 가 최종 강제하지만, 화면이 먼저 안내한다(§2.3)
      if (d.base_rule === 'EOM') {
        if (d.fixed_day !== null && d.fixed_day !== undefined)
          return '월말기준(EOM)에는 지정일을 입력할 수 없습니다.';
        if ((d.offset_days ?? 0) < 0) return '가산일수는 0 이상이어야 합니다.';
      } else {
        const fd = d.fixed_day;
        if (fd === null || fd === undefined) return '당월기준(CURM)에는 지정일이 필요합니다.';
        if (fd < 1 || fd > 31) return '지정일은 1~31 사이여야 합니다.';
        if ((d.offset_days ?? 0) !== 0) return '당월기준(CURM)에는 가산일수를 쓸 수 없습니다.';
      }
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      term_id: d.term_id,
      // ⚠ term_condition 은 보내지 않는다 — 트리거가 자동 구성한다(§9.11)
      base_rule: d.base_rule,
      fixed_day: d.base_rule === 'CURM' ? d.fixed_day : null,
      offset_days: d.base_rule === 'EOM' ? (d.offset_days ?? 0) : 0,
      status: d.status ?? toDbStatus('partner_term', true),
    }),
  });

  const isEom = crud.draft.base_rule === 'EOM';

  /** 지급일 미리보기 — 저장 경로와 **같은 함수**를 부른다(§9.11) */
  const runPreview = async () => {
    if (!crud.selected) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const due = await calcDueDate(crud.selected.term_id, baseDate.format('YYYY-MM-DD'));
      setPreview(due);
    } catch (e) {
      message.error(toAxError(e).message);
    } finally {
      setPreviewing(false);
    }
  };

  const columns: ColumnsType<TermRow> = [
    { title: '코드', dataIndex: 'term_id', width: 110 },
    {
      title: '정책식', dataIndex: 'term_condition', width: 120,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '기준', dataIndex: 'base_rule', width: 100,
      render: (v: TermBaseRule) => TERM_BASE_RULE[v],
    },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="partner_term" status={v} />,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`지급/수금 정책 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input
            placeholder="정책 코드"
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
            onSave={crud.save} onDelete={crud.remove} onCancel={crud.cancel}
          />
          <Table<TermRow>
            rowKey="term_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.term_id === crud.selected?.term_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({
              onClick: () => {
                setPreview(null);
                void crud.selectRow(r);
              },
            })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="정책 코드" required value={crud.draft.term_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ term_id: v })} />

            <Field label="정책식 (자동 구성)"
              hint="BEFORE 트리거가 base_rule·지정일·가산일수로 자동 생성한다. 직접 입력하지 않는다.">
              <Input value={crud.draft.term_condition ?? '-'} disabled />
            </Field>

            <SelectField<TermBaseRule>
              label="기준규칙" required
              value={crud.draft.base_rule ?? 'EOM'}
              disabled={!crud.editing}
              onChange={(v) =>
                // 규칙을 바꾸면 반대편 값을 즉시 정리한다 — CK_term_shape 위반 방지
                crud.patch(
                  v === 'EOM'
                    ? { base_rule: v, fixed_day: null }
                    : { base_rule: v, offset_days: 0 },
                )
              }
              options={Object.entries(TERM_BASE_RULE).map(([value, label]) => ({
                value: value as TermBaseRule, label,
              }))}
            />

            {isEom ? (
              <NumberField label="가산일수 (EOM+N)" min={0}
                value={crud.draft.offset_days ?? 0}
                disabled={!crud.editing}
                hint="기준월 말일에서 며칠 뒤인가. 예: 15 → EOM+15"
                onChange={(v) => crud.patch({ offset_days: v ?? 0 })} />
            ) : (
              <NumberField label="지정일 (CurM DD)" min={1} max={31}
                value={crud.draft.fixed_day ?? null}
                disabled={!crud.editing}
                hint="월말을 초과하면 월말로 보정된다. 예: 31 → 2월은 28/29일"
                onChange={(v) => crud.patch({ fixed_day: v })} />
            )}

            <ActiveField
              active={isActive('partner_term', crud.draft.status)}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ status: toDbStatus('partner_term', v) })}
            />

            {/* ── 지급일 미리보기 ─────────────────────────────────────────── */}
            {crud.selected && !crud.editing ? (
              <Field label="지급일 미리보기"
                hint="저장 경로와 동일한 서버 함수를 호출한다. 미리보기와 실제 저장값이 갈릴 수 없다.">
                <Space>
                  <DatePicker
                    value={baseDate}
                    onChange={(d) => {
                      if (d) setBaseDate(d);
                      setPreview(null);
                    }}
                    allowClear={false}
                  />
                  <Button onClick={() => void runPreview()} loading={previewing}>계산</Button>
                  {preview ? <Tag color="blue">{preview}</Tag> : null}
                </Space>
              </Field>
            ) : null}

            {crud.editing ? (
              <Alert
                type="info"
                showIcon
                message="정책 변경은 이후 신규 계산분에만 적용된다"
                description="이미 저장된 전표의 지급/입금일은 자동으로 재계산되지 않는다 (FR-Term-07)."
              />
            ) : null}
          </Space>
        ) : null
      }
    />
  );
}
