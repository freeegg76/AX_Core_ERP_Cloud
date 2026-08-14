#!/usr/bin/env node
/**
 * 로컬 개발 계정 시드 — 설계서 §6.5 · §18.1
 *
 * ⚠ 왜 seed.sql 이 아니라 스크립트인가 —
 *   GoTrue 는 confirmation_token 등 토큰 컬럼을 NOT NULL string 으로 스캔한다.
 *   SQL 로 직접 INSERT 한 행은 그 컬럼이 NULL 이라 로그인 시 500 이 난다
 *   ("converting NULL to string is unsupported"). 컬럼을 ''로 채우는 우회는
 *   GoTrue 버전이 바뀔 때마다 다시 깨진다 — 설계서 §6.5 가 경고한 그대로다.
 *   **로컬에서도 Admin API 를 경유한다.**
 *
 * 실행 : pnpm db:seed:auth   (db:start / db:reset 이 이어서 자동 호출한다)
 */

import { execSync } from 'node:child_process';

/** `supabase status -o env` 에서 로컬 URL·키를 읽는다. */
function localEnv() {
  const out = execSync('npx --yes supabase@2.114.0 status -o env', { encoding: 'utf8' });
  const get = (k) => {
    const m = new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(out);
    return m?.[1];
  };
  return { url: get('API_URL'), serviceKey: get('SERVICE_ROLE_KEY') };
}

const { url, serviceKey } = localEnv();
if (!url || !serviceKey) {
  console.error('❌ 로컬 스택이 기동되지 않았습니다. `pnpm db:start` 를 먼저 실행하세요.');
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

const PASSWORD = 'axbridge-dev';

/** 로컬 개발용 계정. 운영에는 존재하지 않는다. */
const ACCOUNTS = [
  { email: 'admin@axbridge.local', link: { kind: 'bootstrap' } },
  { email: 'demo-admin@axbridge.local', link: { kind: 'employee', company: 'DEMO', entity: 'D1', id: 'D0001' } },
  { email: 'demo-approver@axbridge.local', link: { kind: 'employee', company: 'DEMO', entity: 'D1', id: 'D0002' } },
  { email: 'demo-editor@axbridge.local', link: { kind: 'employee', company: 'DEMO', entity: 'D1', id: 'D0003' } },
];

async function findUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!res.ok) throw new Error(`사용자 조회 실패 ${res.status}: ${await res.text()}`);
  const { users = [] } = await res.json();
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) ?? null;
}

async function upsertUser(email) {
  const existing = await findUser(email);
  if (existing) return existing;
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`계정 생성 실패(${email}) ${res.status}: ${await res.text()}`);
  return res.json();
}

/** service_role 로 PostgREST 를 호출해 직원 프로필에 계정을 연결한다. */
async function linkEmployee(authUserId, email, link) {
  if (link.kind === 'bootstrap') {
    const res = await fetch(`${url}/rest/v1/rpc/ax_bootstrap_admin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_auth_user_id: authUserId, p_email: email }),
    });
    if (!res.ok) throw new Error(`부트스트랩 연결 실패 ${res.status}: ${await res.text()}`);
    return;
  }
  const res = await fetch(
    `${url}/rest/v1/system_employee?company_id=eq.${link.company}&entity_id=eq.${link.entity}&employee_id=eq.${link.id}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ auth_user_id: authUserId, email, user_yn: true }),
    },
  );
  if (!res.ok) throw new Error(`직원 연결 실패(${link.id}) ${res.status}: ${await res.text()}`);
}

for (const acc of ACCOUNTS) {
  const user = await upsertUser(acc.email);
  await linkEmployee(user.id, acc.email, acc.link);
  console.log(`  ✔ ${acc.email}`);
}

console.log('');
console.log(`  로컬 개발 계정 준비 완료 (비밀번호: ${PASSWORD})`);
console.log('    admin@axbridge.local        SYSTEM/SYSTEM · SUPER');
console.log('    demo-admin@axbridge.local   DEMO/D1 · ADMIN     ← 업무 데이터는 이 계정으로');
console.log('    demo-approver@axbridge.local DEMO/D1 · APPROVER');
console.log('    demo-editor@axbridge.local  DEMO/D1 · EDITOR');
console.log('');
console.log('  ⚠ 1인 1회사 고정(C3) — admin 은 SYSTEM 소속이라 DEMO 데이터가 보이지 않는다.');
console.log('');
