#!/usr/bin/env node
/**
 * AX Bridge — 초기 관리자 부트스트랩 (설계서 §6.5 ② 단계)
 *
 * 마이그레이션 14 가 SYSTEM 조직(company·entity·pod·team)을 만들어 두었다.
 * 이 스크립트는 Admin API 로 auth.users 를 만들고 ax_bootstrap_admin() 으로
 * system_employee 에 연결한다.
 *
 * ⚠ service_role 키를 쓰는 유일한 스크립트다. 절대 브라우저 번들에 들어가지 않는다.
 * ⚠ 멱등하다 — 이미 있으면 연결만 갱신한다.
 *
 * 실행: SUPABASE_URL=... SERVICE_ROLE_KEY=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/bootstrap-admin.mjs
 */

const { SUPABASE_URL, SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD })) {
  if (!v) {
    console.error(`❌ 환경변수 ${k} 가 없습니다.`);
    process.exit(1);
  }
}

const base = SUPABASE_URL.replace(/\/+$/, '');
const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

/** 이미 존재하는 계정을 이메일로 찾는다(멱등성). */
async function findUser(email) {
  const res = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!res.ok) throw new Error(`사용자 조회 실패 ${res.status}: ${await res.text()}`);
  const { users = [] } = await res.json();
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) ?? null;
}

async function createUser(email, password) {
  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    // email_confirm: 확인 메일 없이 즉시 로그인 가능하게 한다.
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`계정 생성 실패 ${res.status}: ${await res.text()}`);
  return res.json();
}

/** 마이그레이션 14 의 SECURITY DEFINER 함수. service_role 만 실행할 수 있다. */
async function linkProfile(authUserId, email) {
  const res = await fetch(`${base}/rest/v1/rpc/ax_bootstrap_admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_auth_user_id: authUserId, p_email: email }),
  });
  if (!res.ok) throw new Error(`프로필 연결 실패 ${res.status}: ${await res.text()}`);
  return res.json();
}

const existing = await findUser(ADMIN_EMAIL);
let user = existing;

if (existing) {
  console.log(`ℹ 이미 존재하는 계정입니다 — 프로필 연결만 갱신합니다 (${ADMIN_EMAIL})`);
} else {
  user = await createUser(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`✔ auth.users 생성 (${ADMIN_EMAIL})`);
}

const result = await linkProfile(user.id, ADMIN_EMAIL);
console.log(`✔ system_employee 연결 — ${JSON.stringify(result)}`);
console.log('');
console.log('  최초 로그인 후 반드시 비밀번호를 변경하세요.');
