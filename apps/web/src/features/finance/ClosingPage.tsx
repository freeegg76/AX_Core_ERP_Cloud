/**
 * 마감관리 (finance_closing) — 설계서 §9.6 · §12.5 SCR-FIN-06
 *
 * ⚠ **표준 6버튼이 아니다.** 조회·마감·취소 구성이며, `AppToolbar` 의 `extra` 주입
 *   구조를 쓴다(§12.2). 신규/수정/삭제 개념이 없다 — 마감은 상태 전이지 레코드 편집이 아니다.
 *
 * ⚠⚠ **순차성**(§9.6)
 *   마감은 `actual_year` **오름차순**으로만 — 2025 를 건너뛰고 2026 을 마감할 수 없다.
 *   해제는 **내림차순**으로만 — 2026 이 마감된 채로 2025 를 해제할 수 없다.
 *   두 방향이 반대라는 점이 이 화면의 유일한 함정이다. 서버(50503/50504)가 강제하지만
 *   화면이 미리 어떤 연도가 가능한지 보여 줘야 사용자가 시행착오를 겪지 않는다.
 *
 * ⚠ 마감은 다음 연도 `finance_open_balance` 에 `source='CLOSING'` 행을 만든다.
 *   그 행은 초기이월 화면에서 확정해제할 수 없다(FR-Close-08). 해제 시 회수된다.
 */
import { useMemo, useState } from 'react';
import { App as AntApp, Alert, Button, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AxRequestError, toAxError } from '@/lib/errors';
import { useCan } from '@/lib/session';
import { AppToolbar, confirmAction } from '@/shared/ui';
import { executeClosing, reopenClosing } from '@/lib/rpc';

interface ClosingRow {
  company_year_id: string;
  company_year: number;
  actual_year: number;
  closing: boolean;
  closing_date: string | null;
}

export function ClosingPage() {
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const canAdmin = useCan('ADMIN');
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['closing_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_finance_closing')
        .select('company_year_id, company_year, actual_year, closing, closing_date')
        .order('actual_year');
      if (error) throw new AxRequestError(toAxError(error));
      // C10 — numeric(10,2) 이 문자열로 올 수 있다. 경계에서 number 로 정규화한다(§8.1).
      return (data ?? []).map((r) => ({
        company_year_id: String(r.company_year_id),
        company_year: Math.trunc(Number(r.company_year)),
        actual_year: Math.trunc(Number(r.actual_year)),
        closing: Boolean(r.closing),
        closing_date: (r.closing_date as string | null) ?? null,
      })) as ClosingRow[];
    },
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);

  /**
   * 마감 가능 연도 = 미마감 중 **가장 오래된** 연도 하나뿐이다(오름차순 순차).
   * 해제 가능 연도 = 마감된 것 중 **가장 최근** 연도 하나뿐이다(내림차순 순차).
   */
  const closable = useMemo(() => rows.find((r) => !r.closing)?.company_year_id ?? null, [rows]);
  const reopenable = useMemo(() => {
    const closed = rows.filter((r) => r.closing);
    return closed.length ? closed[closed.length - 1]!.company_year_id : null;
  }, [rows]);

  const target = rows.find((r) => r.company_year_id === selected) ?? null;

  const doClose = useMutation({
    mutationFn: () => executeClosing(selected!),
    onSuccess: (r) => {
      message.success(
        `${r.closed_year_id} 를 마감했습니다. ${r.next_year_id} 초기이월 ${r.carried_rows}건 생성.`,
      );
      void qc.invalidateQueries({ queryKey: ['closing_list'] });
      void qc.invalidateQueries({ queryKey: ['open_balance'] });
      void qc.invalidateQueries({ queryKey: ['closed_years'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const doReopen = useMutation({
    mutationFn: () => reopenClosing(selected!),
    onSuccess: (r) => {
      message.success(
        r.next_year_id
          ? `${r.reopened_year_id} 마감을 해제했습니다. ${r.next_year_id} 자동생성 이월 ${r.removed_rows}건 회수.`
          : `${r.reopened_year_id} 마감을 해제했습니다.`,
      );
      void qc.invalidateQueries({ queryKey: ['closing_list'] });
      void qc.invalidateQueries({ queryKey: ['open_balance'] });
      void qc.invalidateQueries({ queryKey: ['closed_years'] });
    },
    onError: (e: unknown) => message.error(toAxError(e).message),
  });

  const columns: ColumnsType<ClosingRow> = [
    { title: '기수 ID', dataIndex: 'company_year_id', width: 120 },
    { title: '기수', dataIndex: 'company_year', width: 80, align: 'right',
      render: (v: number) => `제 ${v} 기` },
    { title: '회계연도', dataIndex: 'actual_year', width: 100, align: 'right' },
    {
      title: '마감상태', dataIndex: 'closing', width: 110,
      render: (v: boolean) => (v ? <Tag color="red">마감</Tag> : <Tag color="green">미마감</Tag>),
    },
    { title: '마감일시', dataIndex: 'closing_date', width: 180,
      render: (v: string | null) => v ?? '-' },
    {
      title: '가능한 조작', width: 160,
      render: (_, r) =>
        r.company_year_id === closable ? <Tag color="blue">마감 가능</Tag>
          : r.company_year_id === reopenable ? <Tag color="orange">해제 가능</Tag>
            : <span style={{ color: '#bbb' }}>—</span>,
    },
  ];

  const selectedIsClosable = !!target && target.company_year_id === closable;
  const selectedIsReopenable = !!target && target.company_year_id === reopenable;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {/* ⚠ 표준 6버튼이 아니다 — 조회 + 전용 버튼만 노출한다(§12.2 · §12.5) */}
      <AppToolbar
        mode="view"
        canEdit={canAdmin}
        onSearch={() => void qc.invalidateQueries({ queryKey: ['closing_list'] })}
        extra={
          <Space>
            <Tooltip
              title={
                !canAdmin ? '관리자만 마감할 수 있습니다'
                  : !target ? '마감할 기수를 선택하세요'
                    : !selectedIsClosable ? '가장 오래된 미마감 연도부터 순서대로 마감해야 합니다(50513)'
                      : '선택한 기수를 마감합니다'
              }
            >
              <Button type="primary" loading={doClose.isPending}
                disabled={!canAdmin || !selectedIsClosable}
                onClick={() => void confirmAction({
                  title: `${target?.actual_year}년(${target?.company_year_id})을 마감하시겠습니까?`,
                  content: (
                    <div>
                      <p>마감 후 해당 연도의 전표는 조회만 가능해지며, 다음 기수의 초기이월이 자동 생성됩니다.</p>
                      <p style={{ color: '#8c8c8c', fontSize: 12 }}>
                        다음 중 하나라도 걸리면 마감되지 않습니다 — 차년도 기수 미등록(50514) ·
                        대상연도 미승인 전표 존재(50515) · 차년도 초기이월 기존재(50516).
                      </p>
                    </div>
                  ),
                  okText: '마감',
                }).then((ok) => ok && doClose.mutate())}>
                마감
              </Button>
            </Tooltip>

            <Tooltip
              title={
                !canAdmin ? '관리자만 해제할 수 있습니다'
                  : !target ? '해제할 기수를 선택하세요'
                    : !selectedIsReopenable ? '가장 최근 마감 연도부터 역순으로 해제해야 합니다(50533)'
                      : '선택한 기수의 마감을 해제합니다'
              }
            >
              <Button danger loading={doReopen.isPending}
                disabled={!canAdmin || !selectedIsReopenable}
                onClick={() => void confirmAction({
                  title: `${target?.actual_year}년(${target?.company_year_id}) 마감을 해제하시겠습니까?`,
                  content: (
                    <div>
                      <p>다음 기수의 자동생성 초기이월(source=CLOSING)이 회수됩니다.</p>
                      <p style={{ color: '#8c8c8c', fontSize: 12 }}>
                        차년도에 <b>수기 입력분</b>이 있거나(50534) <b>전표가 존재</b>하면 해제되지 않습니다 —
                        회수 과정에서 그 데이터가 유실될 수 있기 때문입니다.
                      </p>
                    </div>
                  ),
                  okText: '마감해제', danger: true,
                }).then((ok) => ok && doReopen.mutate())}>
                마감해제
              </Button>
            </Tooltip>
          </Space>
        }
      />

      <Alert
        type="info" showIcon
        message="마감은 오름차순, 해제는 내림차순으로만 가능합니다"
        description={
          <>
            연도를 건너뛴 마감·해제는 이월 잔액을 어긋나게 하므로 금지됩니다(설계서 §9.6).
            {closable ? <> 지금 마감 가능한 기수는 <b>{closable}</b> 입니다.</> : ' 마감할 미마감 기수가 없습니다.'}
            {reopenable ? <> 해제 가능한 기수는 <b>{reopenable}</b> 입니다.</> : null}
          </>
        }
      />

      {!canAdmin ? (
        <Alert type="warning" showIcon
          message="조회 전용"
          description="마감·해제는 ADMIN 권한이 필요합니다(C12)." />
      ) : null}

      <Table<ClosingRow>
        rowKey="company_year_id" size="small" loading={list.isLoading}
        columns={columns} dataSource={rows} pagination={false}
        onRow={(r) => ({ onClick: () => setSelected(r.company_year_id) })}
        rowClassName={(r) => (r.company_year_id === selected ? 'ant-table-row-selected' : '')}
      />
    </Space>
  );
}
