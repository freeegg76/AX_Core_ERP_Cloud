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

console.log('\n═══ 7. PARTNER — 지급정책 제약 (CK_term_shape) ═══');
line('EOM 인데 지정일 입력', await api('POST', 'partner_term', admin,
  { company_id: 'DEMO', entity_id: 'D1', term_id: 'BAD1', base_rule: 'EOM', fixed_day: 10, offset_days: 0 }),
  'AX-50203 기대');
line('CURM 인데 가산일수 입력', await api('POST', 'partner_term', admin,
  { company_id: 'DEMO', entity_id: 'D1', term_id: 'BAD2', base_rule: 'CURM', fixed_day: 10, offset_days: 5 }),
  'AX-50203 기대');
line('CURM 지정일 32', await api('POST', 'partner_term', admin,
  { company_id: 'DEMO', entity_id: 'D1', term_id: 'BAD3', base_rule: 'CURM', fixed_day: 32, offset_days: 0 }),
  'AX-50203 기대');

console.log('\n═══ 8. term_condition 은 트리거가 자동 구성한다 (§9.11) ═══');
const made = await api('POST', 'partner_term', admin,
  { company_id: 'DEMO', entity_id: 'D1', term_id: 'EOM30', base_rule: 'EOM', offset_days: 30,
    term_condition: '사용자가-넣은-값' });
console.log(`  정책식 자동 구성                  ${made.status}   실제="${made.body?.[0]?.term_condition}"  (EOM+30 기대 — 사용자 입력은 무시된다)`);

console.log('\n═══ 9. 지급일 계산 — 월말 보정·윤년 (§9.11) ═══');
const due = async (term, base) =>
  (await rpc('ax_partner_term_calc_due', admin, { p_term_id: term, p_base_date: base })).body;

await api('POST', 'partner_term', admin,
  { company_id: 'DEMO', entity_id: 'D1', term_id: 'CURM31', base_rule: 'CURM', fixed_day: 31, offset_days: 0 });

for (const [t, base, expect, desc] of [
  ['EOM15',  '2026-03-10', '2026-04-15', 'EOM+15  3월말(31)+15'],
  // ⚠ EOM 은 클램프하지 않는다 — 월말에 N일을 더한 순수 날짜연산이다.
  //   원본 T-SQL 도 DATEADD(DAY, @offset, EOMONTH(@base)) 였다.
  //   1/31 + 30 = 3/2 이며, 2월말로 잘리지 않는다.
  ['EOM30',  '2026-01-05', '2026-03-02', 'EOM+30  1월말(31)+30 → 클램프 없음'],
  ['CURM25', '2026-02-10', '2026-02-25', 'CurM25  당월 25일'],
  ['CURM31', '2026-02-10', '2026-02-28', 'CurM31  평년 2월 → 28 클램프'],
  ['CURM31', '2028-02-10', '2028-02-29', 'CurM31  윤년 2월 → 29 클램프'],
]) {
  const got = await due(t, base);
  console.log(`  ${desc.padEnd(30)} ${String(got).padEnd(13)} ${got === expect ? '✔' : `✗ ${expect} 기대`}`);
}

console.log('\n═══ 10. 거래처 · 참조 무결성 (§9.9) ═══');
line('거래처 생성', await api('POST', 'partner_vendor', admin,
  { company_id: 'DEMO', entity_id: 'D1', vendor_id: 'VD900', vendor_name: '검증거래처',
    payment_type: 'EOM30', status: true }), '201');
line('참조 중인 정책 삭제', await api('DELETE', 'partner_term?term_id=eq.EOM30', admin), '23503 기대');
line('거래처 삭제', await api('DELETE', 'partner_vendor?vendor_id=eq.VD900', admin), '1건');
line('정책 삭제 (참조 해제 후)', await api('DELETE', 'partner_term?term_id=eq.EOM30', admin), '1건');
line('CURM31 정리', await api('DELETE', 'partner_term?term_id=eq.CURM31', admin), '1건');

console.log('\n═══ 11. SALES — 액티비티 채번 (C5, §9.12) ═══');
await api('POST', 'sales_pipeline', admin,
  { company_id: 'DEMO', entity_id: 'D1', pipeline_id: 'PL900', client_name: '가나상사',
    pipeline_type: '0', stage: '0' });

// ⚠ activity_id 를 일부러 보낸다 — 트리거가 무시하고 자체 채번해야 한다
const a1 = await api('POST', 'sales_pipeline_detail', admin,
  { company_id: 'DEMO', entity_id: 'D1', pipeline_id: 'PL900',
    activity_id: '클라이언트가-정한-값', activity_type: '2', content: '킥오프 미팅' });
const a2 = await api('POST', 'sales_pipeline_detail', admin,
  { company_id: 'DEMO', entity_id: 'D1', pipeline_id: 'PL900',
    activity_type: '1', content: '후속 통화' });
const id1 = a1.body?.[0]?.activity_id, id2 = a2.body?.[0]?.activity_id;
console.log(`  클라이언트 전송값 무시            ${a1.status}   실제="${id1}"  ${String(id1).startsWith('ACT') ? '✔' : '✗'}`);
console.log(`  동시 생성 시 고유성              ${a2.status}   실제="${id2}"  ${id1 !== id2 ? '✔ (서로 다름)' : '✗ 충돌'}`);

console.log('\n═══ 12. SALES — stage 트리거가 일자를 관리한다 (§7.3) ═══');
const st = async (stage) =>
  (await api('PATCH', 'sales_pipeline?pipeline_id=eq.PL900', admin, { stage })).body?.[0];
let r = await st('3');
console.log(`  진행 단계 변경 → adjusted_date  ${r?.adjusted_date ? '기록됨 ✔' : '없음 ✗'}  closed_date=${r?.closed_date ?? 'null'}`);
r = await st('5');
console.log(`  Closed(5) 진입 → closed_date   ${r?.closed_date ? '기록됨 ✔' : '없음 ✗'}`);
r = await st('4');
console.log(`  재오픈(4) → closed_date 해제    ${r?.closed_date === null ? '해제됨 ✔' : `남음 ✗ (${r?.closed_date})`}`);

console.log('\n═══ 13. SALES — 계약 제약 · 전표 연결 RPC ═══');
line('종료일 < 시작일', await api('POST', 'sales_contract', admin,
  { company_id: 'DEMO', entity_id: 'D1', contract_id: 'CT900', contract_type: '0',
    client_id: 'CL001', start_date: '2026-12-31', end_date: '2026-01-01', status: '0' }),
  'ck_ct_dates 기대');
line('계약 생성', await api('POST', 'sales_contract', admin,
  { company_id: 'DEMO', entity_id: 'D1', contract_id: 'CT900', contract_type: '0',
    client_id: 'CL001', start_date: '2026-01-01', end_date: '2026-12-31', status: '0' }), '201');
line('전표번호만 직접 PATCH', await api('PATCH',
  'sales_contract?contract_id=eq.CT900&contract_type=eq.0', admin, { ledger_no: 1 }),
  'ck_ct_ledger 기대');
line('없는 전표 연결 RPC', await rpc('ax_sales_contract_link_ledger', admin,
  { p_contract_id: 'CT900', p_contract_type: '0', p_ledger_date: '2026-05-01', p_ledger_no: 99 }),
  'AX-50343 기대');
line('한쪽만 넘긴 연결 RPC', await rpc('ax_sales_contract_link_ledger', admin,
  { p_contract_id: 'CT900', p_contract_type: '0', p_ledger_date: '2026-05-01' }),
  'AX-50341 기대');

console.log('\n═══ 14. SALES 정리 ═══');
line('계약 삭제', await api('DELETE', 'sales_contract?contract_id=eq.CT900', admin), '1건');
line('파이프라인 삭제', await api('DELETE', 'sales_pipeline?pipeline_id=eq.PL900', admin), '1건 (활동 CASCADE)');

console.log('\n═══ 15. 정리 ═══');
line('부서 T2 삭제', await api('DELETE', 'system_team?team_id=eq.T2', admin), '204');
line('Pod P2 삭제', await api('DELETE', 'system_pod?pod_id=eq.P2', admin), '204');
line('기수 Y2028 삭제', await api('DELETE', 'system_year?company_year_id=eq.Y2028', admin), '204');
console.log('');
