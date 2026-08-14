/**
 * 관리항목 (finance_dimension + _detail) — 설계서 §9.8 · §12.5
 *
 * ⚠ Slot 1~5 는 **과거 전표 데이터의 의미를 보존**한다. 재정렬·재매핑·의미 변경 금지.
 *   Slot 은 미사용 최소 번호가 자동 부여되며 **수정할 수 없다.** 중간 Slot 이 비어도
 *   후속 Slot 을 당기지 않는다. 할당은 `ax_finance_dimension_save` RPC 가
 *   advisory lock 하에 수행한다(C5).
 *
 * ⚠⚠ **상세값 개별 삭제 UI 를 두지 않는다**(§9.8).
 *   v1.1 은 DELETE 프로시저가 없다는 사실만으로 삭제가 막혔다. v2.0 은 PostgREST 가
 *   모든 테이블에 DELETE 를 자동 제공하므로 **DELETE 정책을 부여하지 않아** 막는다.
 *   오타 상세값은 **수정으로 정정**하는 것이 유일한 경로다 — 화면이 이를 전제로 안내한다.
 */
import { useState } from 'react';
import { App as AntApp, Alert, Button, Input, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  ActiveField, AppToolbar, Field, HeadDetailLayout, StatusBadge, TextField, confirmAction,
} from '@/shared/ui';
import { deleteDimension, saveDimension } from '@/lib/rpc';

interface DimensionRow {
  company_id: string;
  entity_id: string;
  dimension_id: string;
  dimension_name: string | null;
  slot_no: number;
  status: boolean;
}

interface DetailRow {
  company_id: string;
  entity_id: string;
  dimension_id: string;
  line_no: number;
  dimension_value: string | null;
}

export function DimensionPage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');
  const [newValue, setNewValue] = useState('');
  const [editing, setEditing] = useState<{ line_no: number; value: string } | null>(null);

  const crud = useMasterCrud<DimensionRow>({
    key: 'finance_dimension',
    from: 'finance_dimension',
    select: 'company_id, entity_id, dimension_id, dimension_name, slot_no, status',
    table: 'finance_dimension',
    orderBy: 'slot_no',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, dimension_id: r.dimension_id }),
    // ⚠ 저장·삭제 모두 RPC 다 — Slot 할당과 참조검사가 필요하다(§10.2 RPC 14·15)
    toDbRow: () => ({}),
    deleteVia: async (row) => {
      await deleteDimension(row.dimension_id);
    },
  });

  /** 신규/수정 모두 RPC 경유 — Slot 은 서버가 정한다 */
  const save = useMutation({
    mutationFn: () =>
      saveDimension({
        dimension_id: crud.draft.dimension_id!,
        dimension_name: crud.draft.dimension_name ?? undefined,
        status: crud.draft.status ?? toDbStatus('finance_dimension', true),
      }),
    onSuccess: (r) => {
      message.success(`저장했습니다. (Slot ${r.slot_no})`);
      crud.cancel();
      void qc.invalidateQueries({ queryKey: ['finance_dimension'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const sel = crud.selected;

  /*---------------------------------------------------------------- 상세값 */
  const details = useQuery({
    queryKey: ['dimension_detail', sel?.dimension_id],
    enabled: !!sel,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_dimension_detail')
        .select('company_id, entity_id, dimension_id, line_no, dimension_value')
        .eq('dimension_id', sel!.dimension_id)
        .order('line_no');
      if (error) throw new AxRequestError(toAxError(error));
      return (data ?? []) as DetailRow[];
    },
  });

  const addValue = useMutation({
    mutationFn: async () => {
      if (!newValue.trim()) throw new AxRequestError({ code: 'AX-50427', message: '값을 입력하세요.' });
      // line_no 를 보내지 않는다 — BEFORE INSERT 트리거가 채번한다(C5)
      const { error } = await supabase.from('finance_dimension_detail').insert({
        company_id: sel!.company_id, entity_id: sel!.entity_id,
        dimension_id: sel!.dimension_id, line_no: 0,
        dimension_value: newValue.trim(),
      } as never);
      if (error) throw new AxRequestError(toAxError(error));
    },
    onSuccess: () => {
      message.success('값을 추가했습니다.');
      setNewValue('');
      void qc.invalidateQueries({ queryKey: ['dimension_detail'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const updateValue = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('finance_dimension_detail')
        .update({ dimension_value: editing!.value.trim() } as never)
        .eq('dimension_id', sel!.dimension_id).eq('line_no', editing!.line_no).select();
      if (error) throw new AxRequestError(toAxError(error));
      if (!data?.length) throw new AxRequestError({ code: 'AX-40300', message: '권한이 없습니다.' });
    },
    onSuccess: () => {
      message.success('값을 수정했습니다.');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['dimension_detail'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const columns: ColumnsType<DimensionRow> = [
    { title: 'Slot', dataIndex: 'slot_no', width: 70, render: (v: number) => <Tag>{v}</Tag> },
    { title: '코드', dataIndex: 'dimension_id', width: 110 },
    { title: '관리항목명', dataIndex: 'dimension_name' },
    {
      title: '상태', dataIndex: 'status', width: 90,
      render: (v: boolean) => <StatusBadge table="finance_dimension" status={v} />,
    },
  ];

  /** 미등록 Slot 을 `3 — (미등록)` 으로 보여준다(§12.5) */
  const usedSlots = new Set(crud.rows.map((r) => r.slot_no));
  const emptySlots = [1, 2, 3, 4, 5].filter((s) => !usedSlots.has(s));

  const detailColumns: ColumnsType<DetailRow> = [
    { title: 'No', dataIndex: 'line_no', width: 60, render: (v: number) => Math.trunc(v) },
    {
      title: '값', dataIndex: 'dimension_value',
      render: (v: string, r) =>
        editing?.line_no === r.line_no ? (
          <Space.Compact style={{ width: '100%' }}>
            <Input value={editing.value} autoFocus
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onPressEnter={() => updateValue.mutate()} />
            <Button type="primary" onClick={() => updateValue.mutate()}>확인</Button>
            <Button onClick={() => setEditing(null)}>취소</Button>
          </Space.Compact>
        ) : (
          <span>{v}</span>
        ),
    },
    {
      title: '', width: 70,
      // ⚠ 삭제 버튼이 없다 — 의도적이다(§9.8). 수정만 제공한다.
      render: (_, r) => canEdit && editing?.line_no !== r.line_no ? (
        <Button size="small" onClick={() => setEditing({ line_no: r.line_no, value: r.dimension_value ?? '' })}>
          수정
        </Button>
      ) : null,
    },
  ];

  return (
    <HeadDetailLayout
      headTitle={`관리항목 (${crud.total}/5)`}
      detailTitle="상세값"
      head={
        <>
          <AppToolbar
            mode={crud.mode} canEdit={canEdit} saving={save.isPending}
            onSearch={crud.runSearch}
            onCreate={crud.startCreate} onEdit={crud.startEdit}
            onSave={() => save.mutate()}
            onCancel={crud.cancel}
            onDelete={() => {
              void confirmAction({
                title: `${sel?.dimension_name} 관리항목을 삭제하시겠습니까?`,
                content: '계정과목에서 사용 중이거나 전표에 값이 있으면 삭제할 수 없습니다. 상세값도 함께 삭제됩니다.',
                okText: '삭제', danger: true,
              }).then((ok) => ok && crud.remove());
            }}
          />
          <Table<DimensionRow>
            rowKey="dimension_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={false}
            rowClassName={(r) => (r.dimension_id === sel?.dimension_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => { setEditing(null); void crud.selectRow(r); } })}
          />
          {emptySlots.length ? (
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              미등록 Slot : {emptySlots.map((s) => `${s} — (미등록)`).join(' · ')}
            </div>
          ) : null}
        </>
      }
      detail={
        sel || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <TextField label="관리항목 코드" required value={crud.draft.dimension_id}
                disabled={crud.mode !== 'create'} maxLength={10}
                onChange={(v) => crud.patch({ dimension_id: v })} />
              <TextField label="관리항목명" value={crud.draft.dimension_name}
                disabled={!crud.editing} onChange={(v) => crud.patch({ dimension_name: v })} />
              <Field label="Slot"
                hint="미사용 최소 번호가 자동 부여된다. 과거 전표의 의미를 보존하므로 변경할 수 없다(§9.8).">
                <Input value={sel ? String(sel.slot_no) : '(저장 시 자동 부여)'} disabled />
              </Field>
              <ActiveField
                active={isActive('finance_dimension', crud.draft.status)}
                disabled={!crud.editing}
                onChange={(v) => crud.patch({ status: toDbStatus('finance_dimension', v) })}
              />
            </div>

            {sel && !crud.editing ? (
              <div>
                <Alert
                  type="info" showIcon style={{ marginBottom: 8 }}
                  message="상세값은 개별 삭제할 수 없습니다"
                  description="과거 전표가 참조하는 값이 사라지지 않도록 삭제 경로를 두지 않았습니다. 오타는 수정으로 정정하세요 (설계서 §9.8)."
                />
                {canEdit ? (
                  <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
                    <Input placeholder="새 상세값" value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onPressEnter={() => addValue.mutate()} />
                    <Button type="primary" loading={addValue.isPending}
                      onClick={() => addValue.mutate()}>추가</Button>
                  </Space.Compact>
                ) : null}
                <Table<DetailRow>
                  rowKey="line_no" size="small" loading={details.isLoading}
                  columns={detailColumns} dataSource={details.data ?? []}
                  pagination={{ pageSize: 10, size: 'small' }}
                />
              </div>
            ) : null}
          </Space>
        ) : null
      }
    />
  );
}
