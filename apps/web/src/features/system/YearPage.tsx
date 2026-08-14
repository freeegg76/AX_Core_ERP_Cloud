/**
 * 회사 기수 (system_year) — 설계서 §8.2 · C10
 *
 * ⚠ `company_year` · `actual_year` 는 정수 의미인데 DB 타입이 numeric(10,2) 다(C10).
 *   PostgREST 는 numeric 을 JSON 숫자로 돌려주므로 v1.1 의 Prisma Decimal→문자열
 *   문제는 없지만, **경계에서 정수로 정규화하고 소수부가 있으면 거부**한다.
 *   소수부가 있다는 것은 데이터 오염이므로 조용히 반올림하지 않는다(§8.1).
 *
 * ⚠ 기수는 마감·초기이월의 기준이다. 삭제 시 FK RESTRICT 가 참조를 지킨다(§9.9).
 */
import { Input, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCan, useClaims } from '@/lib/session';
import { useMasterCrud } from '@/shared/hooks';
import {
  AppToolbar, HeadDetailLayout, NumberField, SearchBar, TextField,
} from '@/shared/ui';
import { likePattern } from '@/lib/query';

interface YearRow {
  company_id: string;
  entity_id: string;
  company_year_id: string;
  company_year: number;
  actual_year: number;
}

/** C10 — 경계에서 정수 정규화. 소수부가 있으면 데이터 오염이므로 null 을 돌려준다. */
function toInt(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number.isInteger(v) ? v : null;
}

export function YearPage() {
  const canEdit = useCan('EDITOR');
  const claims = useClaims();

  const crud = useMasterCrud<YearRow>({
    key: 'system_year',
    from: 'system_year',
    select: 'company_id, entity_id, company_year_id, company_year, actual_year',
    table: 'system_year',
    orderBy: 'actual_year',
    pk: (r) => ({
      company_id: r.company_id, entity_id: r.entity_id, company_year_id: r.company_year_id,
    }),
    applyFilters: (q, f) =>
      f.keyword ? q.ilike('company_year_id', likePattern(String(f.keyword))) : q,
    emptyDraft: () => ({
      company_id: claims?.company_id,
      entity_id: claims?.entity_id,
      company_year: 1,
      actual_year: new Date().getFullYear(),
    }),
    validate: (d, mode) => {
      if (mode === 'create' && !d.company_year_id?.trim()) return '기수 코드는 필수입니다.';
      const cy = toInt(d.company_year);
      const ay = toInt(d.actual_year);
      if (cy === null || cy < 1) return '기수는 1 이상의 정수여야 합니다.';
      if (ay === null || ay < 1000 || ay > 9999) return '회계연도는 1000~9999 사이의 정수여야 합니다.';
      return null;
    },
    toDbRow: (d) => ({
      company_id: d.company_id,
      entity_id: d.entity_id,
      company_year_id: d.company_year_id,
      company_year: toInt(d.company_year),
      actual_year: toInt(d.actual_year),
    }),
  });

  const columns: ColumnsType<YearRow> = [
    { title: '기수 코드', dataIndex: 'company_year_id', width: 130 },
    // 표시도 정수로 — numeric(10,2) 원본이 "1.00" 으로 보이지 않게 한다
    { title: '기수', dataIndex: 'company_year', width: 90, render: (v: number) => Math.trunc(v) },
    { title: '회계연도', dataIndex: 'actual_year', width: 110, render: (v: number) => Math.trunc(v) },
  ];

  return (
    <HeadDetailLayout
      headTitle={`회사 기수 (${crud.total})`}
      search={
        <SearchBar loading={crud.fetching} onSearch={crud.runSearch} onReset={() => crud.setFilters({})}>
          <Input
            placeholder="기수 코드"
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
          <Table<YearRow>
            rowKey="company_year_id" size="small" loading={crud.loading}
            columns={columns} dataSource={crud.rows}
            pagination={{
              current: crud.page.page, pageSize: crud.page.size, total: crud.total,
              size: 'small', showSizeChanger: true,
              onChange: (p, s) => crud.setPage({ page: p, size: s }),
            }}
            rowClassName={(r) =>
              r.company_year_id === crud.selected?.company_year_id ? 'ant-table-row-selected' : ''
            }
            onRow={(r) => ({ onClick: () => void crud.selectRow(r) })}
          />
        </>
      }
      detail={
        crud.selected || crud.editing ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <TextField label="기수 코드" required value={crud.draft.company_year_id}
              disabled={crud.mode !== 'create'} maxLength={10}
              onChange={(v) => crud.patch({ company_year_id: v })} />
            <NumberField label="기수" required min={1}
              value={crud.draft.company_year !== undefined ? Math.trunc(crud.draft.company_year) : null}
              disabled={!crud.editing}
              onChange={(v) => crud.patch({ company_year: v ?? undefined })} />
            <NumberField label="회계연도" required min={1000} max={9999}
              value={crud.draft.actual_year !== undefined ? Math.trunc(crud.draft.actual_year) : null}
              disabled={!crud.editing}
              hint="마감·초기이월의 기준이다. 차년도 기수가 없으면 연도 마감을 실행할 수 없다(§9.5)."
              onChange={(v) => crud.patch({ actual_year: v ?? undefined })} />
          </Space>
        ) : null
      }
    />
  );
}
