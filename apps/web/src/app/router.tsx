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
    ],
  },
]);
