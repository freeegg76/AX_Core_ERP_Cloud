/**
 * 전표 (finance_ledger_head / _detail) — 설계서 §9.1 · §12.5 SCR-FIN-05
 *
 * **3-Layer 구조**
 *   Layer1  전표 헤더 목록 (일자·번호·적요·승인)
 *   Layer2  라인 (계정·차대·금액) + 상단 실시간 차/대 합계·차액
 *   Layer3  선택 라인의 관리항목 12종 — **GL 플래그가 켜진 것만 활성**
 *
 * ⚠⚠ **전표는 Head/Detail 을 그대로 노출하지 않고 하나의 Aggregate 로 다룬다**(지침 §17).
 *   저장은 라인 부분 저장이 아니라 `ax_finance_ledger_save` **한 번의 호출**로
 *   전체 집합을 보낸다. **배열 순서가 곧 `line_on`** 이다(§9.1).
 *
 * ⚠⚠ 계정을 바꿀 때 새 계정이 쓰지 않는 Layer3 값이 남아 있으면
 *   **사용자 확인을 받은 뒤에만** 지운다(UC-Ledger-04 예외). 조용히 버리지 않는다.
 *
 * ⚠ Slot 레이블은 "관리항목1" 이 아니라 **실제 관리항목명**을 쓴다(§9.8 · §12.5).
 *   Slot 번호는 과거 전표의 의미를 보존하는 값이라 이름을 붙여 줘야 사용자가 안다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp, Alert, Button, Card, DatePicker, Input, InputNumber, Select, Space, Table, Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DRCR, LAYER3_LABEL, LEDGER_TYPE, activeFilterValue, type Layer3Flag,
} from '@ax-bridge/shared-constants';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { useCan, useClaims } from '@/lib/session';
import { makeLookup } from '@/shared/hooks';
import {
  AppToolbar, Field, LookupPopup, SearchBar, confirmAction, confirmLayer3Reset,
} from '@/shared/ui';
import {
  approveLedger, deleteLedger, getLedger, previewAccountChange, saveLedger,
  type LedgerLineInput, type LedgerLineRow,
} from '@/lib/rpc';
import {
  CREDIT, DEBIT, Ledger, LedgerError, clearLayer3, conflictsWith, emptyLine, newLineKey,
  type GlFlags, type LedgerLineData,
} from '@/domain/finance/ledger';

/*--------------------------------------------------------------- Layer1 목록 */

interface HeadRow {
  ledger_date: string;
  ledger_no: number;
  ledger_name: string | null;
  ledger_type: string | null;
  approval_status: string | null;
  employee_name: string | null;
  line_count: number | null;
}

/*------------------------------------------------------------------ Lookup */

const searchGl = makeLookup({
  from: 'v_finance_gl', codeCol: 'gl_id', nameCol: 'gl_name',
  activeFilter: { col: 'status', value: activeFilterValue('finance_gl') },
});
const searchBank = makeLookup({
  from: 'v_finance_bank_account', codeCol: 'bank_id', nameCol: 'bank_name',
  activeFilter: { col: 'status', value: activeFilterValue('finance_bank_account') },
});
const searchTeam = makeLookup({
  from: 'system_team', codeCol: 'team_id', nameCol: 'team_name',
  activeFilter: { col: 'status', value: activeFilterValue('system_team') },
});
const searchPod = makeLookup({
  from: 'system_pod', codeCol: 'pod_id', nameCol: 'pod_name',
  activeFilter: { col: 'status', value: activeFilterValue('system_pod') },
});
const searchEmployee = makeLookup({
  from: 'v_system_employee', codeCol: 'employee_id', nameCol: 'employee_name',
});
const searchClient = makeLookup({
  from: 'partner_client', codeCol: 'client_id', nameCol: 'client_name',
  activeFilter: { col: 'status', value: activeFilterValue('partner_client') },
});
const searchVendor = makeLookup({
  from: 'partner_vendor', codeCol: 'vendor_id', nameCol: 'vendor_name',
  activeFilter: { col: 'status', value: activeFilterValue('partner_vendor') },
});

/** RPC 가 주는 플래그 이름(f_bank …)을 도메인 키로 옮긴다 */
function toFlags(r: Pick<LedgerLineRow,
  'f_bank' | 'f_team' | 'f_pod' | 'f_employee' | 'f_client' | 'f_vendor' |
  'f_dim1' | 'f_dim2' | 'f_dim3' | 'f_dim4' | 'f_dim5' | 'f_due'>): GlFlags {
  return {
    bank_id: r.f_bank, team_id: r.f_team, pod_id: r.f_pod, employee_id: r.f_employee,
    client_id: r.f_client, vendor_id: r.f_vendor,
    dimension1: r.f_dim1, dimension2: r.f_dim2, dimension3: r.f_dim3,
    dimension4: r.f_dim4, dimension5: r.f_dim5, due_date: r.f_due,
  };
}

const NO_FLAGS: GlFlags = {
  bank_id: false, team_id: false, pod_id: false, employee_id: false,
  client_id: false, vendor_id: false, dimension1: false, dimension2: false,
  dimension3: false, dimension4: false, dimension5: false, due_date: false,
};

const won = (n: number) => n.toLocaleString('ko-KR');

/*============================================================================
  화면
============================================================================*/

export function LedgerPage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const claims = useClaims();
  const canEdit = useCan('EDITOR');
  const canApprove = useCan('APPROVER');

  /* 조회조건 */
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));

  /* 선택 · 편집 상태 */
  const [selected, setSelected] = useState<{ date: string; no: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [head, setHead] = useState<{ date: string; name: string; type: string }>({
    date: dayjs().format('YYYY-MM-DD'), name: '', type: '0',
  });
  const [lines, setLines] = useState<LedgerLineData[]>([]);
  const [flagsByKey, setFlagsByKey] = useState<Record<string, GlFlags>>({});
  const [activeLine, setActiveLine] = useState<string | null>(null);

  /*---------------------------------------------------------- Layer1 조회 */
  const list = useQuery({
    queryKey: ['ledger_list', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_finance_ledger')
        .select('ledger_date, ledger_no, ledger_name, ledger_type, approval_status, employee_name, line_count')
        .gte('ledger_date', from)
        .lte('ledger_date', to)
        .order('ledger_date')
        .order('ledger_no');
      if (error) throw new AxRequestError(toAxError(error));
      return (data ?? []) as unknown as HeadRow[];
    },
  });

  /**
   * 마감된 연도 집합 — ⚠ 전표일자의 **역년**을 `actual_year` 와 맞춘다.
   *   `ax_finance_check_year_open` 이 `trunc(actual_year)::int = extract(year from ...)`
   *   로 판정하므로 화면도 같은 규칙이어야 안내가 어긋나지 않는다(§9.6).
   */
  const closedYears = useQuery({
    queryKey: ['closed_years'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_finance_closing')
        .select('actual_year, closing')
        .eq('closing', true);
      if (error) throw new AxRequestError(toAxError(error));
      return new Set((data ?? []).map((r) => Math.trunc(Number(r.actual_year))));
    },
  });

  /*---------------------------------------- 관리항목 Slot 레이블 (§12.5) */
  const dims = useQuery({
    queryKey: ['dimension_slots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_dimension')
        .select('dimension_id, dimension_name, slot_no')
        .order('slot_no');
      if (error) throw new AxRequestError(toAxError(error));
      return (data ?? []) as Array<{ dimension_id: string; dimension_name: string | null; slot_no: number }>;
    },
  });

  /** Slot 번호 → 실제 관리항목명. 미정의 Slot 은 기본 레이블로 남긴다. */
  const slotLabel = useCallback(
    (slot: 1 | 2 | 3 | 4 | 5): string => {
      const d = dims.data?.find((x) => x.slot_no === slot);
      return d?.dimension_name ?? LAYER3_LABEL[`dimension${slot}` as Layer3Flag];
    },
    [dims.data],
  );

  /** 선택된 Slot 의 상세값 목록 — 관리항목 값은 Lookup 이 아니라 Select 다 */
  const dimValues = useQuery({
    queryKey: ['dimension_values'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_dimension_detail')
        .select('dimension_id, line_no, dimension_value')
        .order('line_no');
      if (error) throw new AxRequestError(toAxError(error));
      return (data ?? []) as Array<{ dimension_id: string; line_no: number; dimension_value: string | null }>;
    },
  });

  const slotOptions = useCallback(
    (slot: 1 | 2 | 3 | 4 | 5) => {
      const d = dims.data?.find((x) => x.slot_no === slot);
      if (!d) return [];
      return (dimValues.data ?? [])
        .filter((v) => v.dimension_id === d.dimension_id)
        .map((v) => ({ value: v.dimension_value ?? '', label: v.dimension_value ?? '' }));
    },
    [dims.data, dimValues.data],
  );

  /*------------------------------------------------------- Layer2 상세 조회 */
  const detail = useQuery({
    queryKey: ['ledger_detail', selected?.date, selected?.no],
    enabled: !!selected,
    queryFn: () => getLedger(selected!.date, selected!.no),
  });

  /** 서버 응답 → 편집 상태. 편집 중에는 덮어쓰지 않는다. */
  useEffect(() => {
    if (editing || !detail.data) return;
    const h = detail.data.head as Record<string, unknown>;
    setHead({
      date: String(h.ledger_date ?? ''),
      name: (h.ledger_name as string) ?? '',
      type: (h.ledger_type as string) ?? '0',
    });
    const fk: Record<string, GlFlags> = {};
    const next = detail.data.lines.map((l) => {
      const key = newLineKey();
      fk[key] = toFlags(l);
      return {
        key, gl_id: l.gl_id, gl_name: l.gl_name, drcr: l.drcr, amount: l.amount,
        bank_id: l.bank_id ?? null, team_id: l.team_id ?? null, pod_id: l.pod_id ?? null,
        employee_id: l.employee_id ?? null, client_id: l.client_id ?? null,
        vendor_id: l.vendor_id ?? null,
        dimension1: l.dimension1 ?? null, dimension2: l.dimension2 ?? null,
        dimension3: l.dimension3 ?? null, dimension4: l.dimension4 ?? null,
        dimension5: l.dimension5 ?? null, due_date: l.due_date ?? null,
      } satisfies LedgerLineData;
    });
    setLines(next);
    setFlagsByKey(fk);
    setActiveLine(next[0]?.key ?? null);
  }, [detail.data, editing]);

  const headRow = detail.data?.head as Record<string, unknown> | undefined;
  const approved = String(headRow?.approval_status ?? '0') === '1';

  const yearClosed = head.date
    ? (closedYears.data?.has(dayjs(head.date).year()) ?? false)
    : false;

  /** 도메인 집합체 — 합계·승인 판정은 전부 여기서 나온다 */
  const ledger = useMemo(
    () => new Ledger(head.date, selected?.no ?? null, lines, approved, yearClosed),
    [head.date, selected?.no, lines, approved, yearClosed],
  );
  const totals = ledger.totals;

  /*----------------------------------------------------------------- 변이 */

  const save = useMutation({
    mutationFn: () => {
      const invalid = ledger.validateForSave();
      if (invalid) throw new LedgerError(invalid);
      return saveLedger(
        {
          ledger_date: head.date,
          ...(selected ? { ledger_no: selected.no } : {}),
          ledger_name: head.name,
          ledger_type: head.type,
          ...(claims?.employee_id ? { employee_id: claims.employee_id } : {}),
        },
        // ⚠ 순서가 곧 line_on. 도메인이 화면 전용 필드를 걷어낸 배열을 준다.
        ledger.toSavePayload() as LedgerLineInput[],
      );
    },
    onSuccess: (r) => {
      message.success(`${r.ledger_date} ${r.ledger_no}번 전표를 저장했습니다.`);
      setEditing(false);
      setSelected({ date: r.ledger_date, no: r.ledger_no });
      void qc.invalidateQueries({ queryKey: ['ledger_list'] });
      void qc.invalidateQueries({ queryKey: ['ledger_detail'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const approve = useMutation({
    mutationFn: () => {
      ledger.assertApprovable();          // 서버 왕복 전에 화면이 먼저 안내한다
      return approveLedger(selected!.date, selected!.no);
    },
    onSuccess: () => {
      message.success('전표를 승인했습니다.');
      void qc.invalidateQueries({ queryKey: ['ledger_list'] });
      void qc.invalidateQueries({ queryKey: ['ledger_detail'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const remove = useMutation({
    mutationFn: () => deleteLedger(selected!.date, selected!.no),
    onSuccess: () => {
      message.success('전표를 삭제했습니다.');
      setSelected(null);
      setLines([]);
      void qc.invalidateQueries({ queryKey: ['ledger_list'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  /*------------------------------------------------ 계정 변경 (UC-Ledger-04) */

  /**
   * ⚠⚠ 무단 폐기 금지. 서버 미리보기로 새 계정의 플래그와 충돌 목록을 받고,
   *   충돌이 있으면 **확인을 받은 뒤에만** 값을 지운다(§7.4 · §12.5).
   */
  const changeAccount = useCallback(
    async (key: string, glId: string, glName: string) => {
      const line = lines.find((l) => l.key === key);
      if (!line) return;
      try {
        const preview = await previewAccountChange(glId, {
          gl_id: line.gl_id ?? glId, drcr: line.drcr, amount: line.amount ?? 0,
          bank_id: line.bank_id, team_id: line.team_id, pod_id: line.pod_id,
          employee_id: line.employee_id, client_id: line.client_id, vendor_id: line.vendor_id,
          dimension1: line.dimension1, dimension2: line.dimension2, dimension3: line.dimension3,
          dimension4: line.dimension4, dimension5: line.dimension5, due_date: line.due_date,
        });
        const flags = preview.flags as unknown as GlFlags;
        // 서버 목록과 도메인 판정을 합집합으로 쓴다 — 어느 쪽도 놓치지 않는다
        const conflicts = Array.from(
          new Set([...(preview.conflicts ?? []), ...conflictsWith(line, flags)]),
        );

        if (conflicts.length > 0) {
          const okToClear = await confirmLayer3Reset(
            conflicts.map((c) => LAYER3_LABEL[c as Layer3Flag] ?? c),
          );
          if (!okToClear) return;   // ← 확인하지 않으면 계정 변경 자체를 취소한다
        }

        setFlagsByKey((m) => ({ ...m, [key]: flags }));
        setLines((ls) =>
          ls.map((l) =>
            l.key === key
              ? { ...clearLayer3(l, conflicts as never[]), gl_id: glId, gl_name: glName }
              : l,
          ),
        );
      } catch (e) {
        message.error(toAxError(e).message);
      }
    },
    [lines, message],
  );

  /*--------------------------------------------------------------- 편집 도구 */

  const patch = (key: string, v: Partial<LedgerLineData>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...v } : l)));

  const startCreate = () => {
    setSelected(null);
    setHead({ date: dayjs().format('YYYY-MM-DD'), name: '', type: '0' });
    const a = emptyLine();
    const b = { ...emptyLine(), drcr: CREDIT as typeof CREDIT };
    setLines([a, b]);
    setFlagsByKey({ [a.key]: NO_FLAGS, [b.key]: NO_FLAGS });
    setActiveLine(a.key);
    setEditing(true);
  };

  const addLine = () => {
    const l = emptyLine();
    // 차액이 남아 있으면 반대편 차대구분과 차액을 미리 채운다 — 반복 입력을 줄인다
    if (totals.difference !== 0) {
      l.drcr = totals.difference > 0 ? CREDIT : DEBIT;
      l.amount = Math.abs(totals.difference);
    }
    setLines((ls) => [...ls, l]);
    setFlagsByKey((m) => ({ ...m, [l.key]: NO_FLAGS }));
    setActiveLine(l.key);
  };

  /*-------------------------------------------------------------- Layer2 열 */

  const lineColumns: ColumnsType<LedgerLineData> = [
    { title: '#', width: 44, render: (_v, _r, i) => i + 1 },
    {
      title: '계정과목', width: 240,
      render: (_, r) =>
        editing ? (
          <LookupPopup
            search={searchGl} value={r.gl_id ?? ''} displayName={r.gl_name ?? ''}
            onSelect={(g) => void changeAccount(r.key, g.code, g.name)}
          />
        ) : (
          <span>{r.gl_id} {r.gl_name}</span>
        ),
    },
    {
      title: '차대', dataIndex: 'drcr', width: 96,
      render: (v: typeof DEBIT | typeof CREDIT, r) =>
        editing ? (
          <Select value={v} style={{ width: 80 }}
            onChange={(nv) => patch(r.key, { drcr: nv })}
            options={Object.entries(DRCR).map(([value, label]) => ({ value, label }))} />
        ) : (
          <Tag color={v === DEBIT ? 'blue' : 'red'}>{DRCR[v]}</Tag>
        ),
    },
    {
      title: '금액', dataIndex: 'amount', width: 170, align: 'right',
      render: (v: number | null, r) =>
        editing ? (
          <InputNumber
            style={{ width: '100%' }} value={v} min={0} precision={0}
            formatter={(x) => `${x}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(x) => Number((x ?? '').replace(/,/g, ''))}
            onChange={(nv) => patch(r.key, { amount: nv as number | null })}
          />
        ) : (
          won(v ?? 0)
        ),
    },
    {
      title: '', width: 60,
      render: (_, r) =>
        editing ? (
          <Button size="small" danger
            onClick={() => {
              setLines((ls) => ls.filter((l) => l.key !== r.key));
              if (activeLine === r.key) setActiveLine(null);
            }}>제거</Button>
        ) : null,
    },
  ];

  /*----------------------------------------------------------- Layer3 렌더 */

  const current = lines.find((l) => l.key === activeLine) ?? null;
  const currentFlags = (current && flagsByKey[current.key]) || NO_FLAGS;
  const anyFlagOn = Object.values(currentFlags).some(Boolean);

  const lookupField = (
    key: Layer3Flag,
    search: ReturnType<typeof makeLookup>,
    label: string,
  ) =>
    currentFlags[key] ? (
      <Field key={key} label={label} required={key === 'bank_id'}>
        <LookupPopup
          search={search} value={(current?.[key] as string) ?? ''}
          disabled={!editing}
          onSelect={(it) => current && patch(current.key, { [key]: it.code })}
        />
      </Field>
    ) : null;

  const slotField = (slot: 1 | 2 | 3 | 4 | 5) => {
    const key = `dimension${slot}` as Layer3Flag;
    if (!currentFlags[key]) return null;
    const opts = slotOptions(slot);
    return (
      <Field key={key} label={slotLabel(slot)}
        hint={opts.length === 0 ? '이 Slot 에 등록된 상세값이 없습니다 (관리항목 화면에서 등록)' : undefined}>
        <Select
          style={{ width: '100%' }} allowClear disabled={!editing}
          value={(current?.[key] as string) ?? undefined}
          options={opts}
          onChange={(v) => current && patch(current.key, { [key]: v ?? null })}
        />
      </Field>
    );
  };

  /*=========================================================== 렌더 */

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <SearchBar
        loading={list.isFetching}
        onSearch={() => void qc.invalidateQueries({ queryKey: ['ledger_list'] })}
      >
        <Field label="">
          <DatePicker.RangePicker
            value={[dayjs(from), dayjs(to)]}
            onChange={(v) => {
              if (v?.[0] && v[1]) { setFrom(v[0].format('YYYY-MM-DD')); setTo(v[1].format('YYYY-MM-DD')); }
            }}
          />
        </Field>
      </SearchBar>

      <AppToolbar
        mode={editing ? (selected ? 'edit' : 'create') : 'view'}
        canEdit={canEdit}
        saving={save.isPending}
        onSearch={() => void qc.invalidateQueries({ queryKey: ['ledger_list'] })}
        onCreate={startCreate}
        onEdit={() => {
          if (!selected) return void message.info('수정할 전표를 선택하세요.');
          try {
            ledger.assertEditable();
          } catch (e) {
            return void message.warning((e as Error).message);
          }
          setEditing(true);
        }}
        onSave={() => save.mutate()}
        onDelete={() => {
          if (!selected) return void message.info('삭제할 전표를 선택하세요.');
          void confirmAction({
            title: '전표를 삭제하시겠습니까?',
            content: '승인된 전표와 마감연도의 전표는 삭제할 수 없습니다.',
            okText: '삭제', danger: true,
          }).then((ok) => ok && remove.mutate());
        }}
        onCancel={() => {
          setEditing(false);
          void qc.invalidateQueries({ queryKey: ['ledger_detail'] });
        }}
        extra={
          <Button type="primary" ghost
            disabled={!canApprove || !selected || editing || !ledger.canApprove}
            loading={approve.isPending}
            onClick={() => approve.mutate()}>
            승인
          </Button>
        }
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/*---------------------------------------------------------- Layer1 */}
        <Card size="small" title="전표 목록" style={{ width: 380, flexShrink: 0 }}>
          <Table<HeadRow>
            rowKey={(r) => `${r.ledger_date}-${r.ledger_no}`}
            size="small" loading={list.isLoading}
            dataSource={list.data ?? []}
            pagination={{ pageSize: 15, size: 'small' }}
            onRow={(r) => ({
              onClick: () => {
                if (editing) return void message.warning('편집 중에는 다른 전표를 선택할 수 없습니다.');
                setSelected({ date: r.ledger_date, no: r.ledger_no });
              },
            })}
            rowClassName={(r) =>
              selected && r.ledger_date === selected.date && r.ledger_no === selected.no
                ? 'ant-table-row-selected' : ''}
            columns={[
              { title: '일자', dataIndex: 'ledger_date', width: 110 },
              { title: '번호', dataIndex: 'ledger_no', width: 64 },
              { title: '적요', dataIndex: 'ledger_name', ellipsis: true },
              { title: '라인', dataIndex: 'line_count', width: 56, align: 'right' },
              {
                title: '승인', dataIndex: 'approval_status', width: 64,
                render: (v: string | null) =>
                  String(v) === '1'
                    ? <Tag color="green">승인</Tag>
                    : <Tag>미승인</Tag>,
              },
            ]}
          />
        </Card>

        {/*------------------------------------------------------ Layer2 · 3 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected && !editing ? (
            <Alert type="info" showIcon message="전표를 선택하거나 [신규]로 새 전표를 작성하세요" />
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {/* ⚠ 마감 안내가 승인 안내보다 앞선다 — 둘 다 걸리면 마감이 근본 원인이다(§15.1) */}
              {yearClosed ? (
                <Alert type="error" showIcon
                  message={`${dayjs(head.date).year()}년은 회계마감되었습니다`}
                  description="마감연도의 전표는 조회만 가능합니다. 마감관리에서 해제해야 수정할 수 있습니다(50501)." />
              ) : approved ? (
                <Alert type="success" showIcon
                  message="승인된 전표입니다"
                  description="수정·삭제하려면 먼저 승인을 해제해야 합니다(APPROVER)." />
              ) : null}

              <Card size="small" title="전표 정보">
                <Space wrap align="start">
                  <Field label="전표일자" required>
                    <DatePicker
                      value={head.date ? dayjs(head.date) : null} disabled={!editing}
                      onChange={(d) => setHead((h) => ({ ...h, date: d ? d.format('YYYY-MM-DD') : '' }))} />
                  </Field>
                  <Field label="전표번호" hint="저장 시 자동 채번됩니다(C5)">
                    <Input value={selected ? String(selected.no) : '(자동)'} disabled style={{ width: 120 }} />
                  </Field>
                  <Field label="전표구분">
                    <Select style={{ width: 140 }} value={head.type} disabled={!editing}
                      onChange={(v) => setHead((h) => ({ ...h, type: v }))}
                      options={Object.entries(LEDGER_TYPE).map(([value, label]) => ({ value, label }))} />
                  </Field>
                  <Field label="적요">
                    <Input style={{ width: 320 }} value={head.name} disabled={!editing} maxLength={100}
                      onChange={(e) => setHead((h) => ({ ...h, name: e.target.value }))} />
                  </Field>
                </Space>
              </Card>

              {/* ⚠ 실시간 차/대 합계와 차액 — Layer2 상단(§12.5) */}
              <Card size="small">
                <Space size="large">
                  <span>차변 <b>{won(totals.debit)}</b></span>
                  <span>대변 <b>{won(totals.credit)}</b></span>
                  <span style={{ color: totals.difference === 0 ? '#389e0d' : '#cf1322', fontWeight: 600 }}>
                    차액 {won(totals.difference)}
                  </span>
                  {totals.balanced
                    ? <Tag color="green">차대 일치</Tag>
                    : <Tag color="red">차대 불일치 — 승인 불가</Tag>}
                </Space>
              </Card>

              <Card size="small" title="라인 (Layer 2)"
                extra={editing ? <Button size="small" onClick={addLine}>라인 추가</Button> : null}>
                <Table<LedgerLineData>
                  rowKey="key" size="small" pagination={false}
                  columns={lineColumns} dataSource={lines}
                  onRow={(r) => ({ onClick: () => setActiveLine(r.key) })}
                  rowClassName={(r) => (r.key === activeLine ? 'ant-table-row-selected' : '')}
                />
              </Card>

              <Card size="small" title="관리항목 (Layer 3)">
                {!current ? (
                  <Alert type="info" showIcon message="라인을 선택하면 해당 계정의 관리항목이 표시됩니다" />
                ) : !current.gl_id ? (
                  <Alert type="info" showIcon message="계정과목을 먼저 선택하세요" />
                ) : !anyFlagOn ? (
                  <Alert type="info" showIcon
                    message="이 계정은 관리항목을 사용하지 않습니다"
                    description="계정과목 화면에서 사용할 관리항목을 지정할 수 있습니다(FR-GL-06)." />
                ) : (
                  <Space wrap align="start" size="large">
                    {lookupField('bank_id', searchBank, LAYER3_LABEL.bank_id)}
                    {lookupField('team_id', searchTeam, LAYER3_LABEL.team_id)}
                    {lookupField('pod_id', searchPod, LAYER3_LABEL.pod_id)}
                    {lookupField('employee_id', searchEmployee, LAYER3_LABEL.employee_id)}
                    {lookupField('client_id', searchClient, LAYER3_LABEL.client_id)}
                    {lookupField('vendor_id', searchVendor, LAYER3_LABEL.vendor_id)}
                    {slotField(1)}{slotField(2)}{slotField(3)}{slotField(4)}{slotField(5)}
                    {currentFlags.due_date ? (
                      <Field label={LAYER3_LABEL.due_date}>
                        <DatePicker
                          disabled={!editing}
                          value={current.due_date ? dayjs(current.due_date) : null}
                          onChange={(d) => patch(current.key, { due_date: d ? d.format('YYYY-MM-DD') : null })} />
                      </Field>
                    ) : null}
                  </Space>
                )}
              </Card>
            </Space>
          )}
        </div>
      </div>
    </Space>
  );
}
