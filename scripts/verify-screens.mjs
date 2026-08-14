import { execSync } from 'node:child_process';

const out = execSync('npx --yes supabase@2.114.0 status -o env', { encoding: 'utf8' });
const g = (k) => new RegExp(`^${k}="?([^"\\n]+)"?$`, 'm').exec(out)?.[1];
const URL_ = g('API_URL'), ANON = g('ANON_KEY');

async function login(email) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'axbridge-dev' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`로그인 실패 ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function api(method, path, token, body) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 110 ? s.slice(0, 110) + '…' : s;
};
/** ⚠ RLS 는 UPDATE/DELETE 에서 조용히 0건이 된다. 상태코드만 보면 성공처럼 보인다. */
const rows = (res) => (Array.isArray(res.body) ? `${res.body.length}건` : '');
const line = (label, res, expect) =>
  console.log(`  ${label.padEnd(32)} ${String(res.status).padEnd(4)} ${rows(res).padEnd(5)} ${expect ? `(${expect})` : ''} ${short(res.body?.hint ?? res.body?.message ?? '')}`);

const admin = await login('demo-admin@axbridge.local');
const editor = await login('demo-editor@axbridge.local');

console.log('\n═══ 1. SYSTEM 마스터 CRUD ═══');
line('Pod 생성 (EDITOR)', await api('POST', 'system_pod', editor,
  { company_id: 'DEMO', entity_id: 'D1', pod_id: 'P2', pod_name: '영업 Pod', status: false }), '201');
line('기수 생성 (EDITOR)', await api('POST', 'system_year', editor,
  { company_id: 'DEMO', entity_id: 'D1', company_year_id: 'Y2028', company_year: 3, actual_year: 2028 }), '201');

console.log('\n═══ 2. 권한 상향 — 그룹 CUD 는 ADMIN (§6.4) ═══');
line('그룹 수정 (EDITOR)', await api('PATCH', 'system_company?company_id=eq.DEMO', editor,
  { company_name_ko: '침입시도' }), '차단 기대');
line('그룹 수정 (ADMIN)', await api('PATCH', 'system_company?company_id=eq.DEMO', admin,
  { company_name_ko: '데모그룹' }), '200');

console.log('\n═══ 3. 부서 순환의존 — 지연 제약 트리거 (§9.9) ═══');
line('없는 오너로 부서 생성', await api('POST', 'system_team', admin,
  { company_id: 'DEMO', entity_id: 'D1', team_id: 'T9', team_name_ko: '테스트',
    owner: 'NOBODY', leader_user_id: 'NOBODY', status: false }), 'AX-50131 기대');
line('실재 오너로 부서 생성', await api('POST', 'system_team', admin,
  { company_id: 'DEMO', entity_id: 'D1', team_id: 'T2', team_name_ko: '영업팀',
    owner: 'D0001', leader_user_id: 'D0001', status: false }), '201');

console.log('\n═══ 4. 직원 — 역할변경 RPC (§10.2 RPC 20) ═══');
const rpc = (fn, token, body) => api('POST', `rpc/${fn}`, token, body);
line('자기 자신 역할변경', await rpc('ax_system_employee_set_role', admin,
  { p_employee_id: 'D0001', p_role: 'SUPER' }), 'AX-40302 기대');
line('상위 역할 부여 시도', await rpc('ax_system_employee_set_role', admin,
  { p_employee_id: 'D0003', p_role: 'SUPER' }), 'AX-40303 기대');
line('정상 역할변경 (→APPROVER)', await rpc('ax_system_employee_set_role', admin,
  { p_employee_id: 'D0003', p_role: 'APPROVER' }), '200');
line('EDITOR 가 역할변경 시도', await rpc('ax_system_employee_set_role', editor,
  { p_employee_id: 'D0002', p_role: 'VIEWER' }), 'AX-40301 기대');

console.log('\n═══ 5. 직원 — ax_role 직접 UPDATE 차단 (컬럼 GRANT §5.3) ═══');
line('PATCH ax_role 직접', await api('PATCH', 'system_employee?employee_id=eq.D0003', admin,
  { ax_role: 'SUPER' }), '42501 기대');

console.log('\n═══ 6. 직원 삭제 RPC — 참조검사 (§10.2 RPC 19) ═══');
line('부서 오너인 직원 삭제', await rpc('ax_system_employee_delete', admin,
  { p_employee_id: 'D0001' }), 'AX-50142 기대');

console.log('\n═══ 7. 정리 ═══');
line('부서 T2 삭제', await api('DELETE', 'system_team?team_id=eq.T2', admin), '204');
line('Pod P2 삭제', await api('DELETE', 'system_pod?pod_id=eq.P2', admin), '204');
line('기수 Y2028 삭제', await api('DELETE', 'system_year?company_year_id=eq.Y2028', admin), '204');
console.log('');
