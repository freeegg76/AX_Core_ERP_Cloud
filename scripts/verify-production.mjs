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
 *   SUPABASE_ANON_KEY=sb_publishable_... (또는 구형 eyJ...) \
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
  console.error('   대시보드 Settings → API 에서 Project URL 과 anon(publishable) 키를 가져오세요.');
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

/**
 * 키 종류 판별 — Supabase 는 키 형식을 두 가지 운용한다(§19.2).
 *   구형 : JWT. 페이로드의 role 이 anon | service_role
 *   신형 : 불투명 문자열. sb_publishable_… | sb_secret_…
 * 신형은 디코드할 수 없으므로 **접두어가 유일한 단서**다. JWT 파싱만 하면
 * 신형 anon 키를 "role 미상"으로 오판해 정상 셋업을 실패로 보고한다.
 */
function classifyKey(key) {
  if (key.startsWith('sb_publishable_')) return 'anon';
  if (key.startsWith('sb_secret_')) return 'service_role';
  const c = decodeJwt(key);
  return c?.role ?? null;
}

const rest = (path, token = ANON, extra = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...extra },
  });

console.log(`\n운영 환경 검증 — ${URL_}\n`);

/*──────────────────────────────────── 1. 키 확인 */
console.log('1. 키');
const role = classifyKey(ANON);
if (role === 'anon') ok('anon(publishable) 키가 맞다');
else if (role === 'service_role') {
  bad('service_role(secret) 키가 들어왔다 — 이 키로는 RLS 검증이 불가능하다 (§19.1)');
  console.log('    service_role 은 BYPASSRLS 라 무엇이든 통과한다. anon 키로 다시 실행하세요.');
} else bad(`키 종류를 판별할 수 없다 ('${role}') — anon 키여야 한다 (§19.2)`);

/*──────────────────────────────────── 2. 스키마 적용 여부
 * ⚠ HTTP 상태만 보면 안 된다. "테이블이 없다"(PGRST205/404)와
 *   "테이블은 있는데 권한이 없다"(42501/401)는 **정반대 결론**인데
 *   둘 다 성공이 아닌 응답이라 뭉뚱그리면 미배포를 정상으로 읽는다.
 */
console.log('\n2. 스키마');
/** rel 에 `?` 가 있으면 질의를 그대로 쓰고, 없으면 기본 질의를 붙인다. */
async function probe(rel) {
  const r = await rest(rel.includes('?') ? rel : `${rel}?select=*&limit=1`);
  let body; try { body = JSON.parse(await r.text()); } catch { body = {}; }
  return { status: r.status, code: body?.code, message: body?.message, body };
}
const seed = await probe('finance_gl_seed');
if (seed.code === 'PGRST205' || seed.status === 404) {
  bad('테이블이 존재하지 않는다 — 마이그레이션이 적용되지 않았다 (§18.3)');
  console.log('    GitHub Actions 의 deploy-db 워크플로가 성공했는지 확인하세요.');
} else if (seed.code === '42501' || seed.status === 200) {
  ok(`테이블 해석됨 — 마이그레이션 적용 확인 (${seed.code ?? `HTTP ${seed.status}`})`);
} else if (seed.message?.includes('API key')) {
  bad(`키가 거부되었다 — ${seed.message}`);
} else {
  bad(`판정 불가: HTTP ${seed.status} ${seed.code ?? ''} ${seed.message ?? ''}`);
}

/*──────────────────────────────────── 3. 미인증 접근 차단
 * ⚠ 맨 401 을 "RLS 가 막았다"로 읽으면 안 된다. **잘못된 키도 401** 이다.
 *   키가 틀려서 전부 막히는 상태를 "보안이 잘 되어 있다"로 오독하면,
 *   정작 키를 고친 뒤에 실제로 새는지를 아무도 확인하지 않게 된다.
 */
console.log('\n3. 미인증 접근 (RLS 기본값 = 거부)');
for (const rel of ['system_employee', 'finance_ledger_head', 'partner_client']) {
  const r = await probe(rel);
  if (r.code === '42501') ok(`${rel} — 42501 (anon 에 GRANT 없음)`);
  else if (r.status === 200 && Array.isArray(r.body) && r.body.length === 0) ok(`${rel} — 0건 (RLS 필터)`);
  else if (r.message?.includes('API key')) bad(`${rel} — 키 거부(${r.message}). 차단이 아니라 키 문제다`);
  else bad(`${rel} — HTTP ${r.status} ${r.code ?? ''} ${JSON.stringify(r.body).slice(0, 80)} ← 데이터가 새고 있을 수 있다`);
}

/*──────────────────────────────────── 4. 카드번호 원문 차단 */
console.log('\n4. 카드번호 마스킹 (§19.3)');
const card = await probe('finance_bank_account?select=card_number&limit=1');
if (card.code === '42501' || card.status === 403) ok(`원문 컬럼 접근 차단 (${card.code ?? card.status})`);
else if (card.status === 200 && Array.isArray(card.body) && card.body.length === 0) {
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
    // ⚠ PostgREST 는 같은 42501 을 미인증이면 401, 인증이면 403 으로 매핑한다.
    //   상태코드만 비교하면 인증 후 검사가 조용히 빗나간다 — code 로 판정한다.
    const card2 = await rest('finance_bank_account?select=card_number&limit=1', j.access_token);
    let c2; try { c2 = JSON.parse(await card2.text()); } catch { c2 = {}; }
    if (c2?.code === '42501') ok('인증 후에도 card_number 원문 차단 (42501)');
    else if (card2.status === 200 && Array.isArray(c2) && c2.length === 0) ok('은행/카드 데이터 없음 — 등록 후 재확인');
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
