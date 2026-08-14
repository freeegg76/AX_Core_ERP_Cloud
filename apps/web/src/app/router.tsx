import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from '@/features/auth/LoginPage';
import { CompanyPage } from '@/features/system/CompanyPage';
import { EntityPage } from '@/features/system/EntityPage';
import { PodPage } from '@/features/system/PodPage';
import { TeamPage } from '@/features/system/TeamPage';
import { EmployeePage } from '@/features/system/EmployeePage';
import { YearPage } from '@/features/system/YearPage';
import { TermPage } from '@/features/partner/TermPage';
import { ClientPage } from '@/features/partner/ClientPage';
import { VendorPage } from '@/features/partner/VendorPage';
import { PipelinePage } from '@/features/sales/PipelinePage';
import { ContractPage } from '@/features/sales/ContractPage';
import { GlPage } from '@/features/finance/GlPage';
import { DimensionPage } from '@/features/finance/DimensionPage';
import { BankAccountPage } from '@/features/finance/BankAccountPage';
import { OpenBalancePage } from '@/features/finance/OpenBalancePage';
import { LedgerPage } from '@/features/finance/LedgerPage';
import { ClosingPage } from '@/features/finance/ClosingPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/system/employees" replace /> },
      // Phase 2 — SYSTEM (설계서 §16 : 그룹 → 회사 → Pod/부서 → 직원 → 기수)
      { path: 'system/companies', element: <CompanyPage /> },
      { path: 'system/entities', element: <EntityPage /> },
      { path: 'system/pods', element: <PodPage /> },
      { path: 'system/teams', element: <TeamPage /> },
      { path: 'system/employees', element: <EmployeePage /> },
      { path: 'system/years', element: <YearPage /> },
      // Phase 3 — PARTNER (설계서 §16 : 지급정책 → 고객사 → 거래처)
      { path: 'partner/terms', element: <TermPage /> },
      { path: 'partner/clients', element: <ClientPage /> },
      { path: 'partner/vendors', element: <VendorPage /> },
      // Phase 4 — SALES (설계서 §16 : 파이프라인 → 액티비티 → 계약)
      { path: 'sales/pipelines', element: <PipelinePage /> },
      { path: 'sales/contracts', element: <ContractPage /> },
      // Phase 5 — FINANCE 기준정보 (설계서 §16 : 계정과목 → 관리항목 → 은행/카드)
      { path: 'finance/gl', element: <GlPage /> },
      { path: 'finance/dimensions', element: <DimensionPage /> },
      { path: 'finance/bank-accounts', element: <BankAccountPage /> },
      // Phase 6 — FINANCE 핵심업무 (설계서 §16 : 초기이월 → 전표 → 마감)
      { path: 'finance/open-balances', element: <OpenBalancePage /> },
      { path: 'finance/ledgers', element: <LedgerPage /> },
      { path: 'finance/closing', element: <ClosingPage /> },
    ],
  },
]);
