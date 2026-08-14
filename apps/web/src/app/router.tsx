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
import { ClientListPage } from '@/features/partner/ClientListPage';

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
      // Phase 3 — PARTNER (진행 중)
      { path: 'partner/clients', element: <ClientListPage /> },
    ],
  },
]);
