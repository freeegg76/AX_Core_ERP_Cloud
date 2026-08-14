/**
 * 파이프라인 + 액티비티 — 설계서 §7.3 · §12.5
 *
 * 액티비티는 파이프라인 하위 리소스다(§11.2). 한 화면에서 다룬다.
 *
 * ⚠ stage 전환은 **일반 PATCH** 다 — 별도 RPC 가 아니다(§11.3).
 *   전이 허용 여부는 `domain/sales/pipeline` 이 판정하고,
 *   `adjusted_date`/`closed_date` 는 트리거가 관리한다(§7.3).
 *
 * ⚠ `activity_id` 는 BEFORE INSERT 트리거가 채번한다(C5). 클라이언트가 보낸 값은
 *   무시되므로 PostgREST 로 직접 INSERT 해도 안전하다.
 *
 * ⚠ `client_name` 은 비정규화 문자열이다 — partner_client 에 FK 가 없다(원본 설계).
 */
import { useState } from 'react';
import { App as AntApp, Button, Input, Popconfirm, Select, Space, Steps, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_TYPE, PIPELINE_STAGE, PIPELINE_TYPE } from '@ax-bridge/shared-constants';
import { Pipeline, STAGE, isClosedStage, validateAttachedLink, type Stage } from '@/domain/sales/pipeline';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { likePattern } from '@/lib/query';
import { useCan, useClaims } from '@/lib/session';
import { makeLookup, useMasterCrud } from '@/shared/hooks';
import {
  AppToolbar, DateField, Field, HeadDetailLayout, LookupPopup, SearchBar,
  SelectField, TextField,
} from '@/shared/ui';

interface PipelineRow {
  company_id: string;
  entity_id: string;
  pipeline_id: string;
  pipeline_type: string;
  client_name: string | null;
  stage: Stage;
  employee_id: string | null;
  employee_name: string | null;
  note: string | null;
  created_date: string | null;
  adjusted_date: string | null;
  closed_date: string | null;
  contract_id: string | null;
}

interface ActivityRow {
  company_id: string;
  entity_id: string;
  pipeline_id: string;
  activity_id: string;
  created_date: string | null;
  activity_type: string;
  content: string | null;
  incharge: string | null;
  attached: string | null;
}

const searchEmployee = makeLookup({
  from: 'v_system_employee', codeCol: 'employee_id', nameCol: 'employee_name',
});

export function PipelinePage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');
  const claims = useClaims();
  const [act, setAct] = useState<Partial<ActivityRow>>({});

  const crud = useMasterCrud<PipelineRow>({
    key: 'sales_pipeline',
    from: 'v_sales_pipeline',
    select:
      'company_id, entity_id, pipeline_id, pipeline_type, client_name, stage, ' +
      'employee_id, employee_name, note, created_date, adjusted_date, closed_date, contract_id',
    table: 'sales_pipeline',
    orderBy: 'pipeline_id',
    pk: (r) => ({ company_id: r.company_id, entity_id: r.entity_id, pipeline_id: r.pipeline_id }),
    applyFilters: (q, f) => {
      let out = q;
      if (f.keyword) out = out.ilike('client_name', likePattern(String(f.keyword)));
      if (f.stage) out = out.eq('stage', f.stage);
      if (f.openOnly) out = out.not('stage', 'in', '("5","6")');
      return out;
    },
    emptyDraft: () => ({
      company_id: claims?.company_id, entity_id: claims?.entity_id,
      pipeline_type: '0', stage: STAGE.LEAD,
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.pipeline_id?.trim()) return '파이프라인 코드는 필수입니다.';
      if (!d.client_name?.trim()) return '고객사명은 필수입니다.';
      return null;
    },
    // created/adjusted/closed_date 를 보내지 않는다 — 트리거가 관리한다(§7.3)
    toDbRow: (d) => ({
      company_id: d.company_id, entity_id: d.entity_id,
      pipeline_id: d.pipeline_id,
      pipeline_type: d.pipeline_type ?? '0',
      client_name: d.client_name,
      stage: d.stage ?? STAGE.LEAD,
      employee_id: d.employee_id ?? null,
      note: d.note ?? null,
    }),
  });

  const sel = crud.selected;

  /*------------------------------------------------------------ 액티비티 */
  const activities = useQuery({
    queryKey: ['sales_activity', sel?.pipeline_id],
    enabled: !!sel,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_pipeline_detail')
        .select('company_id, entity_id, pipeline_id, activity_id, created_date, activity_type, content, incharge, attached')
        .eq('pipeline_id', sel!.pipeline_id)
        .order('activity_id', { ascending: false });
      if (error) throw new AxRequestError(toAxError(error));
      return (data ?? []) as ActivityRow[];
    },
  });

  const saveActivity = useMutation({
    mutationFn: async () => {
      const linkError = validateAttachedLink(act.attached);
      if (linkError) throw new AxRequestError({ code: 'AX-50322', message: linkError });
      if (!act.content?.trim()) {
        throw new AxRequestError({ code: 'AX-50322', message: '활동 내용은 필수입니다.' });
      }
      const body = {
        company_id: sel!.company_id, entity_id: sel!.entity_id,
        pipeline_id: sel!.pipeline_id,
        activity_type: act.activity_type ?? '0',
        content: act.content,
        incharge: act.incharge ?? null,
        attached: act.attached?.trim() ? act.attached.trim() : null,
      };
      if (act.activity_id) {
        const { data, error } = await supabase
          .from('sales_pipeline_detail').update(body as never)
          .eq('pipeline_id', sel!.pipeline_id).eq('activity_id', act.activity_id).select();
        if (error) throw new AxRequestError(toAxError(error));
        if (!data?.length) throw new AxRequestError({ code: 'AX-40300', message: '권한이 없습니다.' });
      } else {
        // activity_id 를 넣지 않는다 — 트리거가 채번한다(C5)
        const { error } = await supabase.from('sales_pipeline_detail').insert(body as never);
        if (error) throw new AxRequestError(toAxError(error));
      }
    },
    onSuccess: () => {
      message.success('활동을 저장했습니다.');
      setAct({});
      void qc.invalidateQueries({ queryKey: ['sales_activity'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const deleteActivity = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('sales_pipeline_detail').delete()
        .eq('pipeline_id', sel!.pipeline_id).eq('activity_id', id).select();
      if (error) throw new AxRequestError(toAxError(error));
      if (!data?.length) throw new AxRequestError({ code: 'AX-40300', message: '권한이 없습니다.' });
    },
    onSuccess: () => {
      message.success('활동을 삭제했습니다.');
      void qc.invalidateQueries({ queryKey: ['sales_activity'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  /*------------------------------------------------- stage 전환 (도메인 경유) */
  const changeStage = useMutation({
    mutationFn: async (action: 'close' | 'cancel' | 'reopen' | Stage) => {
      // ⚠ 속성 직접 대입 금지(§7.3) — 도메인이 전이 허용 여부를 판정한다
      const p = new Pipeline(sel!.pipeline_id, sel!.stage, sel!.client_name);
      if (action === 'close') p.close();
      else if (action === 'cancel') p.cancel();
      else if (action === 'reopen') p.reopen();
      else p.moveTo(action);

      // 결과 stage 만 일반 PATCH 로 보낸다. 날짜는 트리거가 채운다.
      const { data, error } = await supabase
        .from('sales_pipeline').update({ stage: p.stage } as never)
        .eq('pipeline_id', sel!.pipeline_id).select();
      if (error) throw new AxRequestError(toAxError(error));
      if (!data?.length) throw new AxRequestError({ code: 'AX-40300', message: '권한이 없습니다.' });
    },
    onSuccess: () => {
      message.success('단계를 변경했습니다.');
      void qc.invalidateQueries({ queryKey: ['sales_pipeline'] });
    },
    // 도메인 예외(PipelineStageError)도 여기로 온다 — 사용자에게 이유를 그대로 보여준다
    onError: (e: unknown) =>
      message.error(e instanceof Error && e.name === 'PipelineStageError'
        ? e.message : toAxError(e).message),
  });

  const columns: ColumnsType<PipelineRow> = [
    { title: '코드', dataIndex: 'pipeline_id', width: 110 },
    { title: '고객사', dataIndex: 'client_name' },
    {
      title: '단계', dataIndex: 'stage', width: 130,
      render: (v: Stage) => (
        <Tag color={isClosedStage(v) ? (v === STAGE.CLOSED ? 'green' : 'default') : 'blue'}>
          {PIPELINE_STAGE[v]}
        </Tag>
      ),
    },
    { title: '담당자', dataIndex: 'employee_name', width: 100 },
  ];

  const activityColumns: ColumnsType<ActivityRow> = [
    { title: '일자', dataIndex: 'created_date', width: 100 },
    {
      title: '구분', dataIndex: 'activity_type', width: 70,
      render: (v: keyof typeof ACTIVITY_TYPE) => ACTIVITY_TYPE[v],
    },
    { title: '내용', dataIndex: 'content', ellipsis: true },
    {
      title: '첨부', dataIndex: 'attached', width: 70,
      render: (v: string | null) =>
        // rel="noreferrer" — 외부 링크로 referrer 가 새지 않게 한다
        v ? <a href={v} target="_blank" rel="noreferrer noopener">열기</a> : null,
    },
    {
      title: '', width: 90,
      render: (_, r) => canEdit ? (
        <Space size={4}>
          <Button size="small" onClick={() => setAct(r)}>수정</Button>
          <Popconfirm title="삭제하시겠습니까?" onConfirm={() => deleteActivity.mutate(r.activity_id)}>
            <Button size="small" danger>삭제</Button>
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  const closed = sel ? isClosedStage(sel.stage) : false;

  return (
    <HeadDetailLayout
      headTitle={`파이프라인 (${crud.total})`}
      detailTitle="상세 · 활동"
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch}
          onReset={() => crud.setFilters({ openOnly: true })}>
          <Input placeholder="고객사명"
            value={String(crud.filters.keyword ?? '')}
            onChange={(e) => crud.setFilters({ ...crud.filters, keyword: e.target.value })}
            style={{ width: 180 }} allowClear />
          <Select
            value={Boolean(crud.filters.openOnly)}
            onChange={(v) => crud.setFilters({ ...crud.filters, openOnly: v })}
            style={{ width: 130 }}
            options={[{ value: true, label: '진행중만' }, { value: false, label: '전체' }]}
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
          <Table<PipelineRow>
            rowKey="pipeline_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.pipeline_id === crud.selected?.pipeline_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => { setAct({}); void crud.selectRow(r); } })}
          />
        </>
      }
      detail={
        sel || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <TextField label="파이프라인 코드" required value={crud.draft.pipeline_id}
                disabled={crud.mode !== 'create'} maxLength={10}
                onChange={(v) => crud.patch({ pipeline_id: v })} />
              <TextField label="고객사명" required value={crud.draft.client_name}
                disabled={!crud.editing}
                hint="비정규화 문자열이다 — 고객사 마스터에 FK 가 없다(원본 설계)"
                onChange={(v) => crud.patch({ client_name: v })} />
              <SelectField
                label="유형" value={crud.draft.pipeline_type ?? '0'}
                disabled={!crud.editing}
                onChange={(v) => crud.patch({ pipeline_type: v })}
                options={Object.entries(PIPELINE_TYPE).map(([value, label]) => ({ value, label }))}
              />
              <Field label="담당자">
                <LookupPopup search={searchEmployee}
                  value={crud.draft.employee_id ?? ''}
                  displayName={crud.draft.employee_name ?? ''}
                  disabled={!crud.editing}
                  onSelect={(e) => crud.patch({ employee_id: e.code, employee_name: e.name })} />
              </Field>
              <TextField label="비고" value={crud.draft.note}
                disabled={!crud.editing} onChange={(v) => crud.patch({ note: v })} />
              <DateField label="등록일" value={crud.draft.created_date} disabled
                hint="등록·수정·종료일은 트리거가 관리한다 — 화면이 정하지 않는다(§7.3)" onChange={() => {}} />
              <DateField label="종료일" value={crud.draft.closed_date} disabled onChange={() => {}} />
            </div>

            {/* ── 단계 전환 — 도메인 메서드 경유(§7.3) ─────────────────── */}
            {sel && !crud.editing ? (
              <div>
                <Steps
                  size="small" current={new Pipeline(sel.pipeline_id, sel.stage).progressIndex}
                  status={closed ? (sel.stage === STAGE.CLOSED ? 'finish' : 'error') : 'process'}
                  items={[
                    { title: 'Lead' }, { title: 'Qualified' }, { title: 'Suggest' },
                    { title: 'Meeting' }, { title: 'Nego' },
                  ]}
                  style={{ marginBottom: 12 }}
                />
                <Space wrap>
                  {closed ? (
                    <Button onClick={() => changeStage.mutate('reopen')} disabled={!canEdit}>
                      재오픈
                    </Button>
                  ) : (
                    <>
                      <Select<Stage>
                        value={sel.stage} style={{ width: 150 }} disabled={!canEdit}
                        onChange={(v) => changeStage.mutate(v)}
                        options={(['0', '1', '2', '3', '4'] as Stage[]).map((s) => ({
                          value: s, label: PIPELINE_STAGE[s],
                        }))}
                      />
                      <Button type="primary" onClick={() => changeStage.mutate('close')} disabled={!canEdit}>
                        성사 종료
                      </Button>
                      <Button danger onClick={() => changeStage.mutate('cancel')} disabled={!canEdit}>
                        취소
                      </Button>
                    </>
                  )}
                </Space>
              </div>
            ) : null}

            {/* ── 액티비티 ────────────────────────────────────────────── */}
            {sel && !crud.editing ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  활동 ({activities.data?.length ?? 0})
                </div>
                {canEdit ? (
                  <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
                    <Select
                      value={act.activity_type ?? '0'} style={{ width: 100 }}
                      onChange={(v) => setAct((a) => ({ ...a, activity_type: v }))}
                      options={Object.entries(ACTIVITY_TYPE).map(([value, label]) => ({ value, label }))}
                    />
                    <Input placeholder="활동 내용" value={act.content ?? ''}
                      onChange={(e) => setAct((a) => ({ ...a, content: e.target.value }))} />
                    <Input placeholder="담당" style={{ width: 110 }} value={act.incharge ?? ''}
                      onChange={(e) => setAct((a) => ({ ...a, incharge: e.target.value }))} />
                    <Input placeholder="첨부 링크 (http/https)" style={{ width: 200 }}
                      value={act.attached ?? ''}
                      onChange={(e) => setAct((a) => ({ ...a, attached: e.target.value }))} />
                    <Button type="primary" loading={saveActivity.isPending}
                      onClick={() => saveActivity.mutate()}>
                      {act.activity_id ? '수정' : '추가'}
                    </Button>
                    {act.activity_id ? <Button onClick={() => setAct({})}>취소</Button> : null}
                  </Space.Compact>
                ) : null}
                <Table<ActivityRow>
                  rowKey="activity_id" size="small" loading={activities.isLoading}
                  columns={activityColumns} dataSource={activities.data ?? []}
                  pagination={{ pageSize: 5, size: 'small' }}
                />
              </div>
            ) : null}
          </Space>
        ) : null
      }
    />
  );
}
