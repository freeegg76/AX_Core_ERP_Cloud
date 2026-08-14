/**
 * 고객사 — 설계서 §12.2 공통 화면 흐름의 참조 구현
 *
 * Phase 1 의 목적은 이 화면 자체가 아니라 **전 계층이 실제로 연결됨을 증명**하는 것이다.
 *   조회   : PostgREST 뷰 + Range 페이징(C9) + escapeLike(§10.4)
 *   쓰기   : PostgREST 테이블 직접 INSERT/PATCH (단순 CRUD 는 RPC 가 아니다, C4)
 *   권한   : useCan 으로 버튼 제어 — 강제는 RLS 가 한다(§2.3)
 *   극성   : isActive/toDbStatus 경유 — 직접 비교 금지(§10.6)
 *   오류   : toAxError 로 정규화 — 영문 원문 미노출(부록 B.3)
 *   보호   : DirtyGuard(§12.4) · Lookup(§12.3)
 */
import { useCallback, useMemo, useState } from 'react';
import { App as AntApp, Input, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activeFilterValue, isActive, toDbStatus } from '@ax-bridge/shared-constants';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { DEFAULT_PAGE, likePattern, runPaged, type Page, type SearchMode } from '@/lib/query';
import { useCan } from '@/lib/session';
import {
  AppToolbar, HeadDetailLayout, LookupPopup, SearchBar, StatusBadge,
  useDirtyGuard, type EditMode,
} from '@/shared/ui';

interface ClientRow {
  client_id: string;
  client_name: string;
  collecting_type: string | null;
  collecting_term_condition: string | null;
  status: boolean;
  vat_id: string | null;
  phone_number: string | null;
}

interface TermItem {
  code: string;
  name: string;
}

/*------------------------------------------------------------------ 데이터 */

async function fetchClients(keyword: string, activeOnly: boolean, page: Page) {
  let q = supabase
    .from('v_partner_client')
    // ⚠ SELECT * 금지 — 컬럼을 명시한다(§19.1 검사 6과 같은 취지)
    .select(
      'client_id, client_name, collecting_type, collecting_term_condition, status, vat_id, phone_number',
      { count: 'exact' },
    );

  if (keyword.trim()) {
    // ⚠ escapeLike 의무 — .ilike() 는 값을 이스케이프하지 않는다(§10.4)
    q = q.ilike('client_name', likePattern(keyword.trim()));
  }
  if (activeOnly) {
    // ⚠ 극성이 테이블마다 반대다. 리터럴 대신 activeFilterValue 를 쓴다(§10.6)
    q = q.eq('status', activeFilterValue('partner_client'));
  }
  return runPaged<ClientRow>(q.order('client_id') as never, page);
}

async function searchTerms(keyword: string, mode: SearchMode): Promise<TermItem[]> {
  let q = supabase
    .from('partner_term')
    .select('term_id, term_condition')
    .eq('status', activeFilterValue('partner_term'));
  if (keyword) {
    q = mode === 'E' ? q.eq('term_id', keyword) : q.ilike('term_id', likePattern(keyword));
  }
  const { data, error } = await q.order('term_id').limit(100);
  if (error) throw new AxRequestError(toAxError(error));
  return (data ?? []).map((r) => ({ code: r.term_id, name: r.term_condition ?? '' }));
}

/*------------------------------------------------------------------- 화면 */

export function ClientListPage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('EDITOR');

  const [keyword, setKeyword] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState<Page>(DEFAULT_PAGE);
  const [applied, setApplied] = useState({ keyword: '', activeOnly: true });

  const [mode, setMode] = useState<EditMode>('view');
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [draft, setDraft] = useState<Partial<ClientRow>>({});

  const dirty = mode !== 'view';
  const { confirmDiscard } = useDirtyGuard(dirty);

  const list = useQuery({
    queryKey: ['clients', applied, page],
    queryFn: () => fetchClients(applied.keyword, applied.activeOnly, page),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        client_id: draft.client_id!,
        client_name: draft.client_name!,
        collecting_type: draft.collecting_type ?? null,
        vat_id: draft.vat_id ?? null,
        phone_number: draft.phone_number ?? null,
        // ⚠ 화면의 "사용" → DB raw boolean. 극성 변환은 여기서 한 번만(§10.6)
        status: toDbStatus('partner_client', draft.status ?? true),
      };
      const res =
        mode === 'create'
          ? await supabase.from('partner_client').insert(body as never)
          : await supabase
              .from('partner_client')
              .update(body as never)
              .eq('client_id', draft.client_id!);
      if (res.error) throw new AxRequestError(toAxError(res.error));
    },
    onSuccess: () => {
      message.success('저장했습니다.');
      setMode('view');
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
    // 화면은 AX 코드와 한글 메시지만 본다 — 영문 원문은 노출하지 않는다(부록 B.3)
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('partner_client').delete().eq('client_id', id);
      if (error) throw new AxRequestError(toAxError(error));
    },
    onSuccess: () => {
      message.success('삭제했습니다.');
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
    // 참조 중이면 FK RESTRICT 가 23503 을 던지고, 어댑터가 안내 문구로 바꾼다(§9.9)
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const selectRow = useCallback(
    async (row: ClientRow) => {
      if (!(await confirmDiscard())) return;
      setMode('view');
      setSelected(row);
      setDraft(row);
    },
    [confirmDiscard],
  );

  const columns = useMemo<ColumnsType<ClientRow>>(
    () => [
      { title: '코드', dataIndex: 'client_id', width: 120 },
      { title: '고객사명', dataIndex: 'client_name' },
      { title: '지급정책', dataIndex: 'collecting_term_condition', width: 120 },
      {
        title: '상태',
        dataIndex: 'status',
        width: 90,
        // ⚠ row.status === true 로 비교하지 않는다 — 테이블마다 극성이 반대다
        render: (v: boolean) => <StatusBadge table="partner_client" status={v} />,
      },
    ],
    [],
  );

  const editing = mode !== 'view';

  return (
    <HeadDetailLayout
      headTitle={`고객사 (${list.data?.total ?? 0})`}
      detailTitle="상세"
      search={
        <SearchBar
          loading={list.isFetching}
          onSearch={() => {
            setPage(DEFAULT_PAGE);
            setApplied({ keyword, activeOnly });
          }}
          onReset={() => {
            setKeyword('');
            setActiveOnly(true);
          }}
        >
          {/* 그룹/회사 조건이 없다 — 1인 1회사 고정(C3). RLS 가 스코프를 건다. */}
          <Input
            placeholder="고객사명"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            value={activeOnly}
            onChange={setActiveOnly}
            style={{ width: 120 }}
            options={[
              { value: true, label: '사용중만' },
              { value: false, label: '전체' },
            ]}
          />
        </SearchBar>
      }
      head={
        <>
          <AppToolbar
            mode={mode}
            canEdit={canEdit}
            saving={save.isPending}
            onSearch={() => setApplied({ keyword, activeOnly })}
            onCreate={() => {
              setMode('create');
              setDraft({ status: true });
              setSelected(null);
            }}
            onEdit={() => selected && setMode('edit')}
            onSave={() => save.mutate()}
            onDelete={() => selected && remove.mutate(selected.client_id)}
            onCancel={() => {
              setMode('view');
              setDraft(selected ?? {});
            }}
          />
          <Table<ClientRow>
            rowKey="client_id"
            size="small"
            loading={list.isLoading}
            columns={columns}
            dataSource={list.data?.rows ?? []}
            pagination={{
              current: page.page,
              pageSize: page.size,
              total: list.data?.total ?? 0,
              showSizeChanger: true,
              size: 'small',
              onChange: (p, s) => setPage({ page: p, size: s }),
            }}
            rowClassName={(r) => (r.client_id === selected?.client_id ? 'ant-table-row-selected' : '')}
            onRow={(r) => ({ onClick: () => void selectRow(r) })}
          />
        </>
      }
      detail={
        selected || editing ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <label>
              코드
              <Input
                value={draft.client_id ?? ''}
                // 코드는 수정모드에서 읽기전용 — 식별키 불변(§12.5)
                disabled={mode !== 'create'}
                onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))}
              />
            </label>
            <label>
              고객사명
              <Input
                value={draft.client_name ?? ''}
                disabled={!editing}
                onChange={(e) => setDraft((d) => ({ ...d, client_name: e.target.value }))}
              />
            </label>
            <label>
              지급정책 (F2 목록 · Enter 검색)
              <LookupPopup<TermItem>
                search={searchTerms}
                value={draft.collecting_type ?? ''}
                displayName={draft.collecting_term_condition ?? ''}
                disabled={!editing}
                onSelect={(t) =>
                  setDraft((d) => ({
                    ...d,
                    collecting_type: t.code,
                    collecting_term_condition: t.name,
                  }))
                }
              />
            </label>
            <label>
              사업자번호
              <Input
                value={draft.vat_id ?? ''}
                disabled={!editing}
                onChange={(e) => setDraft((d) => ({ ...d, vat_id: e.target.value }))}
              />
            </label>
            <label>
              상태
              <Select
                value={isActive('partner_client', draft.status)}
                disabled={!editing}
                style={{ width: '100%' }}
                onChange={(v: boolean) =>
                  setDraft((d) => ({ ...d, status: toDbStatus('partner_client', v) }))
                }
                options={[
                  { value: true, label: '사용' },
                  { value: false, label: '미사용' },
                ]}
              />
            </label>
          </Space>
        ) : null
      }
    />
  );
}
