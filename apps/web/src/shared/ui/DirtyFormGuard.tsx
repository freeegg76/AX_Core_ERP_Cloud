/**
 * 미저장 변경 보호 — 설계서 §12.4 (지침 §22, FR-UI-06)
 *
 * 신규/수정 모드에서 다른 Head 행 선택 · 재조회 · 메뉴 이동 · 브라우저 이동 ·
 * 취소 · 회사/그룹 조건 변경 시 Dirty Check → 저장/무시/취소 선택.
 */
import { useCallback, useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { Modal } from 'antd';

export function useDirtyGuard(dirty: boolean) {
  // 라우터 이동 차단
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    Modal.confirm({
      title: '저장하지 않은 변경이 있습니다',
      content: '이동하면 변경 내용이 사라집니다. 계속하시겠습니까?',
      okText: '이동',
      cancelText: '머무르기',
      okButtonProps: { danger: true },
      onOk: () => blocker.proceed?.(),
      onCancel: () => blocker.reset?.(),
    });
  }, [blocker]);

  // 브라우저 닫기·새로고침 차단
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /** 행 선택·재조회처럼 라우팅이 아닌 전환에 쓴다 */
  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (!dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      Modal.confirm({
        title: '저장하지 않은 변경이 있습니다',
        content: '변경 내용을 버리고 계속하시겠습니까?',
        okText: '버리기',
        cancelText: '취소',
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [dirty]);

  return { confirmDiscard };
}
