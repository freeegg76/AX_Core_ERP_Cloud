/**
 * Lookup 검색 함수 생성기 — 설계서 §12.3
 *
 * F2/Enter 규약의 검색 로직은 리소스마다 컬럼만 다르고 형태가 같다.
 * ⚠ escapeLike 의무 적용(§10.4) — .ilike() 는 이스케이프하지 않는다.
 */
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { likePattern, LOOKUP_LIMIT, type SearchMode } from '@/lib/query';
import type { LookupItem } from '@/shared/ui';
import type { RelationName } from './useMasterCrud';

export interface LookupSource {
  /** 조회 대상 (뷰 우선) */
  from: RelationName;
  /** 코드 컬럼 */
  codeCol: string;
  /** 명칭 컬럼 */
  nameCol: string;
  /** 활성만 필터할 때 쓸 { col, value } */
  activeFilter?: { col: string; value: boolean };
}

/** LookupPopup 의 search prop 으로 넘길 함수를 만든다. */
export function makeLookup(src: LookupSource) {
  return async (keyword: string, mode: SearchMode): Promise<LookupItem[]> => {
    // 컬럼을 런타임에 조립하므로 생성 타입의 컬럼 파서를 통과할 수 없다.
    // 결과를 Record 로 좁혀 다룬다 — 릴레이션 이름은 RelationName 이 이미 검증했다.
    let q = (supabase.from as unknown as (r: string) => any)(src.from)
      .select(`${src.codeCol}, ${src.nameCol}`) as any;
    if (src.activeFilter) q = q.eq(src.activeFilter.col, src.activeFilter.value);
    if (keyword) {
      q = mode === 'E'
        ? q.eq(src.codeCol, keyword)
        : q.or(`${src.codeCol}.ilike.${likePattern(keyword)},${src.nameCol}.ilike.${likePattern(keyword)}`);
    }
    const { data, error } = (await q.order(src.codeCol).limit(LOOKUP_LIMIT)) as {
      data: Array<Record<string, unknown>> | null;
      error: unknown;
    };
    if (error) throw new AxRequestError(toAxError(error));
    return (data ?? []).map((r: Record<string, unknown>) => ({
      code: String(r[src.codeCol] ?? ''),
      name: String(r[src.nameCol] ?? ''),
    }));
  };
}
