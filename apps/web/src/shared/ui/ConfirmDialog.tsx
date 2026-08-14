/** 확인 대화상자 — 설계서 §12.5 (계정 변경 시 Layer3 값 초기화 확인 등) */
import { Modal } from 'antd';

export function confirmAction(opts: {
  title: string;
  content?: React.ReactNode;
  okText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: opts.title,
      content: opts.content,
      okText: opts.okText ?? '확인',
      cancelText: '취소',
      okButtonProps: opts.danger ? { danger: true } : undefined,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * 계정 변경 시 버려질 Layer3 값 확인 — UC-Ledger-04 예외
 * ⚠ 사용자 확인 없이 값을 버리지 않는다(§7.4 · §12.5).
 */
export function confirmLayer3Reset(conflictLabels: string[]): Promise<boolean> {
  return confirmAction({
    title: '사용하지 않는 관리항목 값이 있습니다',
    content: (
      <div>
        <p>선택한 계정에서 사용하지 않는 항목입니다. 초기화하시겠습니까?</p>
        <ul>{conflictLabels.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
    ),
    okText: '초기화',
    danger: true,
  });
}
