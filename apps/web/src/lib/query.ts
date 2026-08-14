/**
 * PostgREST 조회 헬퍼 — 설계서 §10.1 · §10.3 · §10.4
 *
 * ⚠ 스코프 인자가 없다. RLS 가 처리한다(§5.4). 받지 않는 것이 검증하는 것보다 안전하다.
 */
import { supabase } from './supabase';
import { unwrap } from './errors';

/*----------------------------------------------------------------- 페이징 */

export interface Page {
  /** 1부터 */
  page: number;
  /** 기본 50, 최대 500 (설계서 §11.1) */
  size: number;
}

export const DEFAULT_PAGE: Page = { page: 1, size: 50 };
export const MAX_PAGE_SIZE = 500;

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  size: number;
}

/** PostgREST `.range(from, to)` 로 변환 — C9 */
export function toRange(p: Page): [number, number] {
  const size = Math.min(Math.max(p.size, 1), MAX_PAGE_SIZE);
  const from = (Math.max(p.page, 1) - 1) * size;
  return [from, from + size - 1];
}

/*------------------------------------------------------------ LIKE 이스케이프 */

/**
 * ⚠ 설계서 §10.4 — v1.1 의 모든 `_list` 프로시저가 `ESCAPE` 없이 LIKE 를 써서
 * 사용자가 입력한 `%` · `_` 가 와일드카드로 동작했다.
 *
 * **이 결함은 PostgREST 로 옮겨도 그대로 재현된다** — `.ilike()` 는 값을 이스케이프하지
 * 않는다. 모든 부분일치 검색에 의무 적용한다.
 */
export function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, '\\$1');
}

/** `.ilike()` 에 넣을 `%…%` 패턴 */
export function likePattern(keyword: string): string {
  return `%${escapeLike(keyword)}%`;
}

/*------------------------------------------------------------------ 검색 모드 */

/** F2/Enter Lookup — 설계서 §12.3 · §11.1 */
export type SearchMode = 'E' | 'L';

/*-------------------------------------------------------------------- 실행기 */

type Builder<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>;
};

/**
 * 목록 조회 실행. `{ count: 'exact' }` 로 select 한 빌더를 넘긴다.
 *
 * @example
 *   const q = supabase.from('v_partner_client')
 *     .select('client_id, client_name, is_active', { count: 'exact' })
 *     .ilike('client_name', likePattern(kw))
 *     .order('client_id');
 *   const result = await runPaged(q, page);
 */
export async function runPaged<T>(builder: Builder<T>, p: Page = DEFAULT_PAGE): Promise<Paged<T>> {
  const [from, to] = toRange(p);
  const res = await builder.range(from, to);
  const rows = unwrap({ data: res.data, error: res.error }) ?? [];
  return { rows, total: res.count ?? rows.length, page: p.page, size: p.size };
}

/** 단건 조회. 없으면 null. */
export async function runMaybeSingle<T>(
  builder: PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  const res = await builder;
  return unwrap(res);
}

/** Lookup 팝업용 소량 조회 — 상한을 둔다(설계서 §10.3) */
export const LOOKUP_LIMIT = 100;

export { supabase };
