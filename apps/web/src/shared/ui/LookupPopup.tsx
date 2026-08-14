/**
 * 공통 Lookup Popup — 설계서 §12.3 (지침 §21, FR-UI-04)
 *
 *   F2     → 조건 범위 목록 팝업
 *   Enter  → Exact 검색 → 1건이면 즉시 선택 → 미일치/다건이면 Like 팝업
 *
 * v1.1 은 프로시저마다 `@search_mode` 지원이 갈려 화면별 예외 분기가 필요했다.
 * PostgREST 는 모든 리소스에 동일한 필터 문법을 제공하므로 그 불균일이 소멸한다(§12.3).
 *
 * ⚠ 입력값의 `%`·`_` 이스케이프는 여전히 필요하다 — `.ilike()` 는 이스케이프하지 않는다.
 *   escapeLike() 를 lib/query 에서 의무 적용한다(§10.4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Modal, Table } from 'antd';
import type { InputRef } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SearchMode } from '@/lib/query';

export interface LookupItem {
  code: string;
  name: string;
}

export interface LookupPopupProps<T extends LookupItem> {
  /** 검색 실행. mode='E' 는 정확일치, 'L' 은 부분일치 */
  search: (keyword: string, mode: SearchMode) => Promise<T[]>;
  onSelect: (item: T) => void;
  value?: string;
  /** 표시용 명칭. 선택 후 코드+명칭을 함께 보관한다(§12.3) */
  displayName?: string;
  placeholder?: string;
  disabled?: boolean;
  columns?: ColumnsType<T>;
  title?: string;
  /**
   * 상위 조건이 없으면 팝업을 열지 않고 안내한다(§12.3).
   * 예: 회사를 고르지 않은 상태에서 부서 Lookup
   */
  requires?: { ok: boolean; message: string };
}

export function LookupPopup<T extends LookupItem>({
  search, onSelect, value, displayName, placeholder, disabled, columns, title = '조회', requires,
}: LookupPopupProps<T>) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<InputRef>(null);

  const guard = useCallback((): boolean => {
    if (requires && !requires.ok) {
      Modal.info({ title: '선행 조건 필요', content: requires.message });
      return false;
    }
    return true;
  }, [requires]);

  const openPopup = useCallback(
    async (kw: string) => {
      if (!guard()) return;
      setLoading(true);
      try {
        setRows(await search(kw, 'L'));
        setOpen(true);
      } finally {
        setLoading(false);
      }
    },
    [guard, search],
  );

  /** Enter → Exact. 1건이면 즉시 선택, 아니면 Like 팝업 */
  const handleEnter = useCallback(async () => {
    if (!guard()) return;
    const kw = keyword.trim();
    if (!kw) return void openPopup('');
    setLoading(true);
    try {
      const exact = await search(kw, 'E');
      if (exact.length === 1 && exact[0]) {
        onSelect(exact[0]);
        setKeyword('');
        return;
      }
      setRows(await search(kw, 'L'));
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [guard, keyword, onSelect, openPopup, search]);

  /** F2 → 범위 목록 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        void openPopup('');
      }
    },
    [openPopup],
  );

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const cols: ColumnsType<T> = columns ?? [
    { title: '코드', dataIndex: 'code', width: 140 },
    { title: '명칭', dataIndex: 'name' },
  ];

  return (
    <>
      <Input
        ref={inputRef}
        value={keyword || (displayName ? `${value ?? ''} ${displayName}`.trim() : (value ?? ''))}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={() => void handleEnter()}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'F2 목록 · Enter 검색'}
        disabled={disabled}
        allowClear
      />
      <Modal
        title={title}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Input.Search
          placeholder="검색어"
          onSearch={(kw) => void openPopup(kw)}
          style={{ marginBottom: 8 }}
          allowClear
        />
        <Table<T>
          rowKey="code"
          size="small"
          loading={loading}
          columns={cols}
          dataSource={rows}
          pagination={{ pageSize: 10, size: 'small' }}
          onRow={(r) => ({
            onDoubleClick: () => {
              onSelect(r);
              setKeyword('');
              setOpen(false);
            },
          })}
        />
      </Modal>
    </>
  );
}
