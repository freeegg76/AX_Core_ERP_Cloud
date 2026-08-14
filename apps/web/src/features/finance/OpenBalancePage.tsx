/**
 * 초기이월 (finance_open_balance) — 설계서 §9.4 · §12.5
 *
 * ⚠⚠ **금액 0 입력은 "0으로 저장"이 아니라 행 삭제다**(§9.4).
 *   서버는 `amount > 0` 행만 재적재하므로 0원 행은 조용히 사라진다.
 *   화면이 이 동작을 사용자에게 **드러내야** 한다 — 안 그러면 값이 사라진 것처럼 보인다.
 *
 * ⚠ 합계는 **부호를 살려** 계산한다(C11). 연도마감 자동생성분은 음수일 수 있고,
 *   DRCR 별 단순 SUM 만 하면 음수 행이 합계를 왜곡한다(§9.5).
 *   음수 행은 화면에 명시 표시한다 — 숨기거나 절대값으로 바꾸지 않는다.
 *
 * ⚠ 확정(closed)은 APPROVER, 확정해제는 ADMIN 이다. 둘 다 RPC 전용이며
 *   `closed` 컬럼은 UPDATE 권한이 없다(§5.3).
 */
import { useMemo, useState } from 'react';
import { App as AntApp, Alert, Button, InputNumber, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DRCR, OPEN_BALANCE_SOURCE, activeFilterValue } from '@ax-bridge/shared-constants';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { makeLookup } from '@/shared/hooks';
import { AppToolbar, Field, LookupPopup, SearchBar, confirmAction } from '@/shared/ui';
import {
  closeOpenBalance, listOpenBalance, reopenOpenBalance, saveOpenBalance,
  type OpenBalanceRowInput,
} from '@/lib/rpc';

interface Row {
  key: string;
  gl_id: string;
  gl_name: string | null;
  drcr: '1' | '2';
  bank_id: string | null;
  bank_name: string | null;
  client_id: string | null;
  client_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number | null;
  closed: boolean;
  source: string | null;
}

const searchGl = makeLookup({
  from: 'v_finance_gl', codeCol: 'gl_id', nameCol: 'gl_name',
  activeFilter: { col: 'status', value: activeFilterValue('finance_gl') },
});

let seq = 0;
const nextKey = () => `OB${(seq += 1)}`;

const won = (n: number) => n.toLocaleString('ko-KR');

export function OpenBalancePage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');
  const canApprove = useCan('APPROVER');
  const canAdmin = useCan('ADMIN');

  const [yearId, setYearId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Row[]>([]);

  /** 기수 목록 — 조회조건에 기수가 **필수**다(§12.5) */
  const years = useQuery({
    queryKey: ['system_year_options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_year').select('company_year_id, actual_year').order('actual_year');
      if (error) throw new AxRequestError(toAxError(error));
      return data ?? [];
    },
  });

  const list = useQuery({
    queryKey: ['open_balance', yearId],
    enabled: !!yearId,
    queryFn: () => listOpenBalance(yearId!),
  });

  /** 서버가 준 rows → 화면 행. 값이 있는 행만 편집 대상으로 만든다. */
  const rows = useMemo<Row[]>(() => {
    const src = (list.data?.rows ?? []) as Array<Record<string, unknown>>;
    return src
      .filter((r) => r.drcr != null) // 좌측 조인이라 이월 없는 계정도 온다
      .map((r) => ({
        key: nextKey(),
        gl_id: String(r.gl_id), gl_name: (r.gl_name as string) ?? null,
        drcr: r.drcr as '1' | '2',
        bank_id: (r.bank_id as string) ?? null, bank_name: (r.bank_name as string) ?? null,
        client_id: (r.client_id as string) ?? null, client_name: (r.client_name as string) ?? null,
        vendor_id: (r.vendor_id as string) ?? null, vendor_name: (r.vendor_name as string) ?? null,
        amount: (r.amount as number) ?? null,
        closed: Boolean(r.closed), source: (r.source as string) ?? null,
      }));
  }, [list.data]);

  const shown = editing ? draft : rows;
  const totals = list.data?.totals;
  const anyClosed = rows.some((r) => r.closed);
  const hasNegative = shown.some((r) => (r.amount ?? 0) < 0);
  const zeroRows = editing ? draft.filter((r) => (r.amount ?? 0) === 0).length : 0;

  const save = useMutation({
    mutationFn: () => {
      const payload: OpenBalanceRowInput[] = draft
        .filter((r) => r.gl_id)
        .map((r) => ({
          gl_id: r.gl_id, drcr: r.drcr,
          bank_id: r.bank_id, client_id: r.client_id, vendor_id: r.vendor_id,
          amount: r.amount ?? 0,
        }));
      return saveOpenBalance(yearId!, payload);
    },
    onSuccess: (r) => {
      message.success(`${r.saved}건을 저장했습니다.`);
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['open_balance'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const close = useMutation({
    mutationFn: () => closeOpenBalance(yearId!),
    onSuccess: () => {
      message.success('초기이월을 확정했습니다.');
      void qc.invalidateQueries({ queryKey: ['open_balance'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const reopen = useMutation({
    mutationFn: () => reopenOpenBalance(yearId!),
    onSuccess: () => {
      message.success('확정을 해제했습니다.');
      void qc.invalidateQueries({ queryKey: ['open_balance'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const patch = (key: string, v: Partial<Row>) =>
    setDraft((d) => d.map((r) => (r.key === key ? { ...r, ...v } : r)));

  const columns: ColumnsType<Row> = [
    {
      title: '계정', width: 220,
      render: (_, r) =>
        editing ? (
          <LookupPopup
            search={searchGl} value={r.gl_id}
            displayName={r.gl_name ?? ''}
            onSelect={(g) => patch(r.key, { gl_id: g.code, gl_name: g.name })}
          />
        ) : (
          <span>{r.gl_id} {r.gl_name}</span>
        ),
    },
    {
      title: '차대', dataIndex: 'drcr', width: 100,
      render: (v: '1' | '2', r) =>
        editing ? (
          <Select value={v} style={{ width: 80 }}
            onChange={(nv) => patch(r.key, { drcr: nv })}
            options={Object.entries(DRCR).map(([value, label]) => ({ value, label }))} />
        ) : (
          <Tag color={v === '1' ? 'blue' : 'red'}>{DRCR[v]}</Tag>
        ),
    },
    { title: '은행/카드', dataIndex: 'bank_name', width: 120 },
    { title: '고객사', dataIndex: 'client_name', width: 120 },
    { title: '거래처', dataIndex: 'vendor_name', width: 120 },
    {
      title: '금액', dataIndex: 'amount', width: 160, align: 'right',
      render: (v: number | null, r) =>
        editing ? (
          <InputNumber
            style={{ width: '100%' }} value={v} precision={0}
            formatter={(x) => `${x}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(x) => Number((x ?? '').replace(/,/g, ''))}
            onChange={(nv) => patch(r.key, { amount: nv as number | null })}
          />
        ) : (
          // ⚠ 음수를 절대값으로 바꾸거나 숨기지 않는다(C11)
          <span style={{ color: (v ?? 0) < 0 ? '#cf1322' : undefined }}>
            {v == null ? '-' : won(v)}
          </span>
        ),
    },
    {
      title: '출처', dataIndex: 'source', width: 110,
      render: (v: string | null) =>
        v === 'CLOSING'
          ? <Tooltip title="연도마감이 자동 생성한 행. 확정해제할 수 없다(FR-Close-08)">
              <Tag color="purple">{OPEN_BALANCE_SOURCE.CLOSING}</Tag>
            </Tooltip>
          : <Tag>{OPEN_BALANCE_SOURCE.MANUAL}</Tag>,
    },
    {
      title: '', width: 60,
      render: (_, r) =>
        editing ? (
          <Button size="small" danger
            onClick={() => setDraft((d) => d.filter((x) => x.key !== r.key))}>제거</Button>
        ) : null,
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <SearchBar
        loading={list.isFetching}
        onSearch={() => void qc.invalidateQueries({ queryKey: ['open_balance'] })}
      >
        <Field label="">
          <Select
            style={{ width: 220 }} placeholder="기수를 선택하세요 (필수)"
            value={yearId} onChange={(v) => { setYearId(v); setEditing(false); }}
            options={(years.data ?? []).map((y) => ({
              value: y.company_year_id,
              label: `${y.company_year_id} — ${Math.trunc(Number(y.actual_year))}년`,
            }))}
          />
        </Field>
      </SearchBar>

      {!yearId ? (
        <Alert type="info" showIcon message="기수를 먼저 선택하세요" />
      ) : (
        <>
          <AppToolbar
            mode={editing ? 'edit' : 'view'}
            canEdit={canEdit && !anyClosed}
            saving={save.isPending}
            onSearch={() => void qc.invalidateQueries({ queryKey: ['open_balance'] })}
            onEdit={() => { setDraft(rows); setEditing(true); }}
            onSave={() => save.mutate()}
            onCancel={() => { setEditing(false); setDraft([]); }}
            onCreate={() => {
              setDraft((d) => [
                ...(editing ? d : rows),
                { key: nextKey(), gl_id: '', gl_name: null, drcr: '1', bank_id: null,
                  bank_name: null, client_id: null, client_name: null, vendor_id: null,
                  vendor_name: null, amount: null, closed: false, source: 'MANUAL' },
              ]);
              setEditing(true);
            }}
            extra={
              <Space>
                <Tooltip title={anyClosed ? '이미 확정되어 있습니다' : '차대변이 일치해야 확정할 수 있습니다'}>
                  <Button type="primary" disabled={!canApprove || anyClosed || editing}
                    loading={close.isPending}
                    onClick={() => void confirmAction({
                      title: '초기이월을 확정하시겠습니까?',
                      content: '확정 후에는 일반 수정이 불가능하며, 해제는 관리자만 할 수 있습니다.',
                      okText: '확정',
                    }).then((ok) => ok && close.mutate())}>
                    확정
                  </Button>
                </Tooltip>
                <Button danger disabled={!canAdmin || !anyClosed || editing}
                  loading={reopen.isPending}
                  onClick={() => void confirmAction({
                    title: '확정을 해제하시겠습니까?',
                    content: '회계마감된 연도이거나 연도마감 자동생성분이면 해제할 수 없습니다.',
                    okText: '확정해제', danger: true,
                  }).then((ok) => ok && reopen.mutate())}>
                  확정해제
                </Button>
              </Space>
            }
          />

          {/* ⚠ 0원 시맨틱을 반드시 드러낸다(§9.4) */}
          {editing ? (
            <Alert
              type="warning" showIcon
              message="금액을 0으로 두면 저장 시 그 행이 삭제됩니다"
              description={
                zeroRows > 0
                  ? `현재 0원인 행이 ${zeroRows}건 있습니다. 저장하면 사라집니다.`
                  : '"0으로 저장"이 아니라 행 제거입니다 (설계서 §9.4).'
              }
            />
          ) : null}

          {anyClosed ? (
            <Alert type="info" showIcon
              message="확정된 초기이월입니다"
              description="수정하려면 관리자가 확정을 해제해야 합니다. 연도마감 자동생성분은 해제할 수 없습니다(FR-Close-08)." />
          ) : null}

          {hasNegative ? (
            <Alert type="info" showIcon
              message="음수 이월이 있습니다"
              description="연도마감이 산출한 잔액은 음수일 수 있습니다. 합계는 부호를 살려 계산합니다(설계서 C11)." />
          ) : null}

          <Table<Row>
            rowKey="key" size="small" loading={list.isLoading}
            columns={columns} dataSource={shown}
            pagination={{ pageSize: 20, size: 'small' }}
            summary={() =>
              totals ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={5}>
                      <b>합계</b>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <div>차변 {won(totals.debit_total)}</div>
                      <div>대변 {won(totals.credit_total)}</div>
                      <div style={{ color: totals.difference === 0 ? '#389e0d' : '#cf1322', fontWeight: 600 }}>
                        차액 {won(totals.difference)}
                      </div>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} colSpan={2} />
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
        </>
      )}
    </Space>
  );
}
