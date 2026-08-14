import { useEffect } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import koKR from 'antd/locale/ko_KR';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { initSession } from '@/lib/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 업무 시스템이라 조용한 백그라운드 갱신보다 명시적 조회가 맞다(§12.2 툴바 흐름)
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 30_000,
    },
  },
});

export function App() {
  useEffect(() => initSession(), []);
  return (
    <ConfigProvider locale={koKR}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
