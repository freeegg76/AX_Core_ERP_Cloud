/**
 * 마스터 CRUD 공통 훅 — 설계서 §12.1(중복 구현 금지) · §12.2(공통 화면 흐름)
 *
 *   조회조건 입력 → 조회 → Head Grid → 행 선택 → Detail 표시
 *   → 신규/수정 → 검증 → 저장 → Head 재조회 + 선택 유지
 *
 * 마스터 화면 대부분이 이 흐름을 그대로 쓴다. 화면별로 다른 것은
 * ① 어디서 읽는가(뷰/테이블) ② 어떤 컬럼인가 ③ PK 를 어떻게 만드는가 뿐이다.
 *
 * ⚠ 스코프 인자가 없다 — RLS 가 처리한다(§5.4).
 * ⚠ 삭제는 PostgREST DELETE 가 기본이고, 참조검사가 필요하면 RPC 를 주입한다(C4).
 */
import { useCallback, useMemo, useState } from 'react';
import { App as AntApp } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, type Database } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { PERMISSION_DENIED } from '@ax-bridge/shared-constants';
import { DEFAULT_PAGE, runPaged, type Page, type Paged } from '@/lib/query';
import { useDirtyGuard } from '@/shared/ui';
import type { EditMode } from '@/shared/ui';

/** 복합 PK 를 PostgREST 필터로 바꾸기 위한 키 조각 */
export type PkFilter = Record<string, string | number>;

/**
 * 릴레이션 이름은 생성 타입에서 온다 — 오타를 컴파일이 잡는다.
 * `supabase gen types typescript` 산출물과 어긋나면 빌드가 깨진다(§10.1).
 */
export type TableName = keyof Database['public']['Tables'];
export type ViewName = keyof Database['public']['Views'];
export type RelationName = TableName | ViewName;

/**
 * supabase-js 의 `.from()` 은 테이블용/뷰용 오버로드가 분리되어 있어 union 을
 * 그대로 받지 못한다. **호출부의 이름 검증(RelationName)은 유지**하고 내부에서만
 * 좁힌다 — 타입 안전을 버리는 게 아니라 오버로드 해석만 우회하는 것이다.
 */
const rel = (name: RelationName) =>
  (supabase.from as unknown as (r: string) => ReturnType<typeof supabase.from>)(name);

export interface MasterCrudOptions<TRow> {
  /** react-query 키 접두 */
  key: string;
  /** 조회 대상 — 뷰 우선(§10.3) */
  from: RelationName;
  /** SELECT 컬럼 목록. ⚠ `*` 금지 */
  select: string;
  /** 쓰기 대상 테이블 (뷰로 읽고 테이블에 쓴다) */
  table: TableName;
  /** 행 → PK 필터. 복합 PK 를 다루기 위해 화면이 정의한다 */
  pk: (row: TRow) => PkFilter;
  /** 정렬 컬럼 */
  orderBy: string;
  /** 조회조건 → 빌더 변형 */
  applyFilters?: (q: any, filters: Record<string, unknown>) => any;
  /** 저장 직전 변환. 화면 draft → DB 행 (status 극성 변환 등) */
  toDbRow: (draft: Partial<TRow>, mode: EditMode) => Record<string, unknown>;
  /** 저장 전 검증. 메시지를 반환하면 저장을 중단한다 */
  validate?: (draft: Partial<TRow>, mode: EditMode) => string | null;
  /** 삭제를 RPC 로 해야 하는 경우(참조검사 등) */
  deleteVia?: (row: TRow) => Promise<void>;
  /** 신규 모드 초기값 */
  emptyDraft?: () => Partial<TRow>;
}

export interface MasterCrud<TRow> {
  mode: EditMode;
  editing: boolean;
  rows: TRow[];
  total: number;
  loading: boolean;
  fetching: boolean;
  selected: TRow | null;
  draft: Partial<TRow>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<TRow>>>;
  patch: (v: Partial<TRow>) => void;
  page: Page;
  setPage: (p: Page) => void;
  filters: Record<string, unknown>;
  setFilters: (f: Record<string, unknown>) => void;
  /** 조회조건을 실제 질의에 반영한다(툴바 "조회") */
  runSearch: () => void;
  selectRow: (row: TRow) => Promise<void>;
  startCreate: () => void;
  startEdit: () => void;
  cancel: () => void;
  save: () => void;
  remove: () => void;
  saving: boolean;
  dirty: boolean;
}

export function useMasterCrud<TRow extends object>(
  opts: MasterCrudOptions<TRow>,
): MasterCrud<TRow> {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();

  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [applied, setApplied] = useState<Record<string, unknown>>({});
  const [page, setPage] = useState<Page>(DEFAULT_PAGE);
  const [mode, setMode] = useState<EditMode>('view');
  const [selected, setSelected] = useState<TRow | null>(null);
  const [draft, setDraft] = useState<Partial<TRow>>({});

  const dirty = mode !== 'view';
  const { confirmDiscard } = useDirtyGuard(dirty);

  const list = useQuery<Paged<TRow>>({
    queryKey: [opts.key, applied, page],
    queryFn: () => {
      let q = rel(opts.from).select(opts.select, { count: 'exact' });
      if (opts.applyFilters) q = opts.applyFilters(q, applied);
      return runPaged<TRow>(q.order(opts.orderBy) as never, page);
    },
  });

  const invalidate = useCallback(
    () => void qc.invalidateQueries({ queryKey: [opts.key] }),
    [qc, opts.key],
  );

  const save = useMutation({
    mutationFn: async () => {
      const err = opts.validate?.(draft, mode);
      if (err) throw new AxRequestError({ code: 'AX-VALIDATION', message: err });

      const body = opts.toDbRow(draft, mode);
      if (mode === 'create') {
        const { error } = await rel(opts.table).insert(body as never);
        if (error) throw new AxRequestError(toAxError(error));
        return;
      }
      const pkFilter = opts.pk(draft as TRow);
      const pkCols = Object.keys(pkFilter).join(',');
      let q = rel(opts.table).update(body as never);
      for (const [k, v] of Object.entries(pkFilter)) q = q.eq(k, v);
      // ⚠⚠ RLS 는 UPDATE/DELETE 에서 **조용히 0건**이 된다 — INSERT 처럼 42501 을
      //    던지지 않고 정책이 행을 걸러낼 뿐이다. 그대로 두면 권한 없는 사용자가
      //    "저장했습니다" 를 보고 아무것도 바뀌지 않는다.
      //    `.select()` 로 영향 행을 되받아 0건이면 권한 오류로 처리한다.
      //
      // ⚠ 되받을 컬럼을 **PK 로 한정**한다. 인자 없는 `.select()` 는 RETURNING * 가 되어
      //    SELECT 권한이 회수된 컬럼(예: finance_bank_account.card_number, §19.3)에서
      //    "permission denied for table" 로 실패한다. 행 수만 세면 되므로 PK 로 충분하다.
      const { data, error } = await q.select(pkCols);
      if (error) throw new AxRequestError(toAxError(error));
      if (!data || data.length === 0) throw new AxRequestError(PERMISSION_DENIED);
    },
    onSuccess: () => {
      message.success('저장했습니다.');
      setMode('view');
      // Head 재조회 + 선택 유지(§12.2)
      setSelected((s) => ({ ...(s ?? {}), ...draft }) as TRow);
      invalidate();
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      if (opts.deleteVia) return opts.deleteVia(selected);
      let q = rel(opts.table).delete();
      for (const [k, v] of Object.entries(opts.pk(selected))) q = q.eq(k, v);
      // UPDATE 와 같은 이유로 영향 행을 확인한다(위 주석 참조). 컬럼도 PK 로 한정한다.
      const { data, error } = await q.select(Object.keys(opts.pk(selected)).join(','));
      if (error) throw new AxRequestError(toAxError(error));
      if (!data || data.length === 0) throw new AxRequestError(PERMISSION_DENIED);
    },
    onSuccess: () => {
      message.success('삭제했습니다.');
      setSelected(null);
      setDraft({});
      invalidate();
    },
    // 참조 중이면 FK RESTRICT 가 23503 을 던지고 어댑터가 안내 문구로 바꾼다(§9.9)
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const selectRow = useCallback(
    async (row: TRow) => {
      if (!(await confirmDiscard())) return;
      setMode('view');
      setSelected(row);
      setDraft(row);
    },
    [confirmDiscard],
  );

  return useMemo<MasterCrud<TRow>>(
    () => ({
      mode,
      editing: mode !== 'view',
      rows: list.data?.rows ?? [],
      total: list.data?.total ?? 0,
      loading: list.isLoading,
      fetching: list.isFetching,
      selected,
      draft,
      setDraft,
      patch: (v) => setDraft((d) => ({ ...d, ...v })),
      page,
      setPage,
      filters,
      setFilters,
      runSearch: () => {
        setPage(DEFAULT_PAGE);
        setApplied(filters);
      },
      selectRow,
      startCreate: () => {
        setMode('create');
        setSelected(null);
        setDraft(opts.emptyDraft?.() ?? {});
      },
      startEdit: () => selected && setMode('edit'),
      cancel: () => {
        setMode('view');
        setDraft(selected ?? {});
      },
      save: () => save.mutate(),
      remove: () => remove.mutate(),
      saving: save.isPending,
      dirty,
    }),
    [mode, list.data, list.isLoading, list.isFetching, selected, draft, page, filters,
     selectRow, save, remove, dirty, opts],
  );
}
