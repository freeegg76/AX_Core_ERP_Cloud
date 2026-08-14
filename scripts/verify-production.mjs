#!/usr/bin/env node
/**
 * 운영 환경 검증 — 설계서 §19.1 · §6.2
 *
 * 셋업이 끝난 뒤 **운영 프로젝트가 설계대로 되어 있는지** 확인한다.
 * 마이그레이션이 적용됐다고 해서 보안 자세가 맞는다는 보장은 없다 —
 * Auth Hook 미등록, anon 키 오투입, RLS 우회는 배포 성공 후에도 가능하다.
 *
 * 실행 :
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   [ADMIN_EMAIL=... ADMIN_PASSWORD=...] \
 *   node scripts/verify-production.mjs
 *
 * ⚠ service_role 키를 쓰지 않는다. 여기서 확인하려는 것은 **일반 사용자가 보는 상태**다.
 *   service_role 은 BYPASSRLS 라 그 키로는 RLS 가 작동하는지 알 수 없다.
 */

const URL_ = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const ANON = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!URL_ || !ANON) {
  console.error('❌ SUPABASE_URL / SUPABASE_ANON_KEY 가 필요합니다.');
  console.error('   대시보드 Settings → API 에서 Project URL 과 anon(public) 키를 가져오세요.');
  process.exit(1);
}

let failed = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch { return null; }
}

const rest = (path, token = ANON, extra = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...extra },
  });

console.log(`\n운영 환경 검증 — ${URL_}\n`);

/*──────────────────────────────────── 1. 키 확인 */
console.log('1. 키');
const anonClaims = decodeJwt(ANON);
if (anonClaims?.role === 'anon') ok('anon 키가 맞다');
else bad(`키의 role 이 '${anonClaims?.role}' 이다 — anon 키여야 한다 (§19.2)`);

/*──────────────────────────────────── 2. 스키마 적용 여부 */
console.log('\n2. 스키마');
const seed = await rest('finance_gl_seed?select=gl_id&limit=1');
if (seed.status === 401 || seed.status === 200) {
  ok(`PostgREST 응답 (HTTP ${seed.status})`);
} else {
  bad(`PostgREST 이상 응답 ${seed.status} — 마이그레이션이 적용되지 않았을 수 있다`);
}

/*──────────────────────────────────── 3. 미인증 접근 차단 */
console.log('\n3. 미인증 접근 (RLS 기본값 = 거부)');
for (const rel of ['system_employee', 'finance_ledger_head', 'partner_client']) {
  const r = await rest(`${rel}?select=*&limit=1`);
  const body = await r.text();
  if (r.status === 401) ok(`${rel} — 401 (anon 차단)`);
  else if (r.status === 200 && body.trim() === '[]') ok(`${rel} — 0건 (RLS 필터)`);
  else bad(`${rel} — HTTP ${r.status}, 응답 ${body.slice(0, 80)} ← 데이터가 새고 있을 수 있다`);
}

/*──────────────────────────────────── 4. 카드번호 원문 차단 */
console.log('\n4. 카드번호 마스킹 (§19.3)');
const card = await rest('finance_bank_account?select=card_number&limit=1');
if (card.status === 401 || card.status === 403) ok(`원문 컬럼 접근 차단 (HTTP ${card.status})`);
else if (card.status === 200 && (await card.clone().text()).trim() === '[]') {
  ok('0건 — RLS 로 걸러짐 (인증 후 재확인 권장)');
} else bad(`card_number 가 조회된다 (HTTP ${card.status}) — 컬럼 GRANT 를 확인하라`);

/*──────────────────────────────────── 5. Auth Hook (로그인 필요) */
console.log('\n5. Access Token Hook (§6.2)');
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.log('  – ADMIN_EMAIL / ADMIN_PASSWORD 미지정 — 건너뜀');
  console.log('    부트스트랩 후 이 검사를 꼭 한 번 돌리세요. 훅이 등록되지 않으면');
  console.log('    모든 사용자의 권한이 0 이 되어 화면이 텅 빈 채로 뜹니다.');
} else {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) {
    bad(`로그인 실패 — ${j.error_code ?? j.msg ?? r.status}`);
    if (j.error_code === 'email_provider_disabled') {
      console.log('    → config.toml 의 [auth.email].enable_signup 이 true 인지 확인하세요.');
      console.log('      (provider 스위치이며, 자가가입 차단은 [auth].enable_signup 소관입니다)');
    }
  } else {
    const c = decodeJwt(j.access_token);
    const need = ['company_id', 'entity_id', 'employee_id', 'ax_role'];
    const missing = need.filter((k) => !c?.[k]);
    if (missing.length) {
      bad(`클레임 누락: ${missing.join(', ')}`);
      console.log('    → Auth Hook 미등록이거나 직원 프로필이 없습니다.');
      console.log('      `supabase config push` 실행 여부와 system_employee.auth_user_id 연결을 확인하세요.');
    } else {
      ok(`클레임 주입됨 — ${c.company_id}/${c.entity_id} · ${c.ax_role}`);
    }

    // 인증 상태에서 다시 한 번: 카드 원문은 여전히 막혀야 한다
    const card2 = await rest('finance_bank_account?select=card_number&limit=1', j.access_token);
    if (card2.status === 403) ok('인증 후에도 card_number 원문 차단');
    else if (card2.status === 200 && (await card2.text()).trim() === '[]') ok('은행/카드 데이터 없음 — 등록 후 재확인');
    else bad(`인증 후 card_number 가 조회된다 (HTTP ${card2.status}) — §19.3 위반`);

    // 뷰는 마스킹된 값을 준다
    const view = await rest('v_finance_bank_account?select=card_number_masked&limit=1', j.access_token);
    if (view.ok) ok('마스킹 뷰 접근 가능');
    else bad(`v_finance_bank_account 접근 실패 (HTTP ${view.status})`);
  }
}

console.log('');
if (failed) {
  console.error(`❌ ${failed}건 실패 — 운영 반영 전에 해결하세요.\n`);
  // ⚠ process.exit() 를 쓰지 않는다. 열린 fetch 커넥션이 남은 상태에서 즉시 종료하면
  //    Windows 의 libuv 가 죽고(UV_HANDLE_CLOSING assertion) **종료코드가 127 로 뒤바뀐다.**
  //    CI 가 종료코드로 판단하므로 exitCode 만 세우고 이벤트 루프가 자연히 끝나게 둔다.
  process.exitCode = 1;
} else {
  console.log('✔ 운영 환경 검증 통과\n');
  console.log('  DB 레벨 검사(테이블 21 · 정책 78 · security_invoker)는 배포 워크플로가');
  console.log('  scripts/check-security.sql 로 이미 수행합니다.\n');
}
