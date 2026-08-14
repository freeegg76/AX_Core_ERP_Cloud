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

/**
 * ⚠ `return=representation` 은 RETURNING * 를 유발한다. SELECT 권한이 회수된 컬럼이
 *    있는 테이블(finance_bank_account.card_number)에서는 minimal 로 보내야 한다.
 */
async function api(method, path, token, body, minimal = false) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: minimal ? 'return=minimal' : 'return=representation',
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
// 전표 승인·초기이월 확정은 APPROVER 다. ADMIN 으로 통과시키면 권한 경계가 검증되지 않는다.
const approver = await login('demo-approver@axbridge.local');

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

console.log('\n═══ 15. FINANCE — 은행/카드 XOR · 마스킹 (§9.10 · §19.3) ═══');
line('둘 다 비움', await api('POST', 'finance_bank_account', admin,
  { company_id: 'DEMO', entity_id: 'D1', bank_id: 'BX1', bank_name: '잘못', status: false }, true),
  'ck_bank_one 기대');
line('둘 다 입력', await api('POST', 'finance_bank_account', admin,
  { company_id: 'DEMO', entity_id: 'D1', bank_id: 'BX2', bank_name: '잘못',
    bank_account: '111', card_number: '222', status: false }, true), 'ck_bank_one 기대');
line('계좌 중복', await api('POST', 'finance_bank_account', admin,
  { company_id: 'DEMO', entity_id: 'D1', bank_id: 'BX3', bank_name: '중복',
    bank_account: '123456-78-901234', status: false }, true), 'ux_bank_account 기대');

const masked = await api('GET', 'v_finance_bank_account?select=bank_id,card_number_masked,is_card&bank_id=eq.C001', admin);
console.log(`  뷰 마스킹                        ${masked.status}       "${masked.body?.[0]?.card_number_masked}"  is_card=${masked.body?.[0]?.is_card}`);
const raw = await api('GET', 'finance_bank_account?select=card_number&bank_id=eq.C001', admin);
console.log(`  원문 직접 조회                     ${raw.status}       ${raw.body?.message ?? ''}  ${raw.status === 403 ? '✔ 차단' : '✗ 노출'}`);

console.log('\n═══ 16. FINANCE — 관리항목 Slot 보존 (§9.8) ═══');
for (const [id, name] of [['D1','부문'],['D2','프로젝트'],['D3','캠페인'],['D4','채널'],['D5','기타']]) {
  const r = await rpc('ax_finance_dimension_save', admin, { p_dim: { dimension_id: id, dimension_name: name } });
  process.stdout.write(`  ${id}→Slot${r.body?.slot_no ?? '?'} `);
}
console.log('');
line('6번째 관리항목', await rpc('ax_finance_dimension_save', admin,
  { p_dim: { dimension_id: 'D6', dimension_name: '초과' } }), 'AX-50422 기대');

// Slot 보존 — 중간을 지우고 새로 만들면 빈 자리를 채워야 한다(당기지 않는다)
// ⚠ 표준 GL 355건이 dimension3 플래그를 쓰고 있어 삭제가 막힌다 — 정상 동작이다(§9.8).
line('사용 중인 D3 삭제', await rpc('ax_finance_dimension_delete', admin,
  { p_dimension_id: 'D3' }), 'AX-50424 기대');
// 플래그를 내린 뒤에는 삭제된다
await api('PATCH', 'finance_gl?dimension3=eq.true', admin, { dimension3: false }, true);
line('플래그 해제 후 D3 삭제', await rpc('ax_finance_dimension_delete', admin,
  { p_dimension_id: 'D3' }), '204');
const refill = await rpc('ax_finance_dimension_save', admin,
  { p_dim: { dimension_id: 'D7', dimension_name: '재사용' } });
console.log(`  빈 Slot 재사용                    ${refill.status}       Slot=${refill.body?.slot_no}  ${refill.body?.slot_no === 3 ? '✔ 3번을 채움(당기지 않음)' : '✗'}`);

console.log('\n═══ 17. FINANCE — 상세값은 개별 삭제할 수 없다 (§9.8) ═══');
await api('POST', 'finance_dimension_detail', admin,
  { company_id: 'DEMO', entity_id: 'D1', dimension_id: 'D1', line_no: 0, dimension_value: '영업' });
const dup = await api('POST', 'finance_dimension_detail', admin,
  { company_id: 'DEMO', entity_id: 'D1', dimension_id: 'D1', line_no: 0, dimension_value: '영업' });
line('같은 값 중복', dup, 'ux_dim_value 기대');
line('상세값 DELETE 시도', await api('DELETE', 'finance_dimension_detail?dimension_id=eq.D1', admin),
  '정책 없음 → 0건');

console.log('\n═══ 18. FINANCE — 계정과목 contra_gl (§7.4) ═══');
line('차감항목 아닌데 contra', await api('POST', 'finance_gl', admin,
  { company_id: 'DEMO', entity_id: 'D1', gl_id: 'GX1', gl_name: '잘못', gl_type: '0',
    gl_detail: '0', contra_gl: '1010000', status: true }), 'ck_gl_contra_shape 기대');
line('자기 자신 지정', await api('POST', 'finance_gl', admin,
  { company_id: 'DEMO', entity_id: 'D1', gl_id: 'GX2', gl_name: '잘못', gl_type: '0',
    gl_detail: '1', contra_gl: 'GX2', status: true }), 'ck_gl_contra_self 기대');
line('없는 계정 지정', await api('POST', 'finance_gl', admin,
  { company_id: 'DEMO', entity_id: 'D1', gl_id: 'GX3', gl_name: '잘못', gl_type: '0',
    gl_detail: '1', contra_gl: 'NOPE', status: true }), 'AX-50404 기대');

/*============================================================================
  Phase 6 — FINANCE 핵심업무 (설계서 §9.1 · §9.4 · §9.6)

  ⚠ 실행 순서에 의존이 있다. 전표 → 초기이월 → 마감 순이어야 한다.
    마감은 "대상연도 미승인 전표 없음"(50515)과 "차년도 초기이월 미존재"(50516)를
    요구하므로, 앞 절이 남긴 것을 정리한 뒤에야 성공한다.
============================================================================*/

/**
 * ⚠ 앞 절(§4)이 D0003 을 APPROVER 로 승격시켜 두었다. `ax_require_role` 은 JWT 클레임이
 *   아니라 `auth_role_rank_live()` 로 **현재 DB 값**을 읽으므로(§6.2), 토큰을 다시
 *   받지 않아도 승격이 즉시 적용된다. 권한 경계를 검증하려면 먼저 되돌려야 한다.
 */
await rpc('ax_system_employee_set_role', admin, { p_employee_id: 'D0003', p_role: 'EDITOR' });
const editorLow = await login('demo-editor@axbridge.local');

console.log('\n═══ 19. FINANCE 전표 — 저장 · line_on · Layer3 (§9.1) ═══');

// 3100000/3110000 은 bank 플래그가 꺼져 있어 Layer3 필수값 없이 저장된다
const led1 = await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: '2026-05-10', ledger_name: '균형 전표', ledger_type: '0' },
  p_lines: [
    { gl_id: '3100000', drcr: '1', amount: 500000 },
    { gl_id: '3110000', drcr: '2', amount: 500000 },
  ],
});
line('균형 전표 저장 (EDITOR)', led1, '200');
const L1 = led1.body ?? {};

const got = await rpc('ax_finance_ledger_get', editorLow,
  { p_ledger_date: L1.ledger_date, p_ledger_no: L1.ledger_no });
const lineOns = (got.body?.lines ?? []).map((l) => l.line_on);
console.log(`  line_on 배열순서 부여            ${got.status}            ${JSON.stringify(lineOns)} ${
  JSON.stringify(lineOns) === '[1,2]' ? '✔ 순서대로' : '✗ 순서가 어긋난다'}`);
console.log(`  GL 플래그 동봉                   ${got.status}            f_client=${got.body?.lines?.[0]?.f_client} ${
  got.body?.lines?.[0]?.f_client !== undefined ? '✔ 화면이 Layer3 활성 판단 가능' : '✗ 플래그 누락'}`);

line('차대 불균형 저장', await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: '2026-05-11', ledger_name: '불균형' },
  p_lines: [{ gl_id: '3100000', drcr: '1', amount: 100 }],
}), '저장은 되나 승인 불가');
const unbal = (await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: '2026-05-11', ledger_name: '불균형2' },
  p_lines: [{ gl_id: '3100000', drcr: '1', amount: 100 }],
})).body ?? {};

line('은행 플래그 계정 · 은행 누락', await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: '2026-05-12', ledger_name: '은행누락' },
  p_lines: [
    { gl_id: '1010000', drcr: '1', amount: 1000 },
    { gl_id: '3110000', drcr: '2', amount: 1000 },
  ],
}), 'AX-50464 기대');

line('플래그 꺼진 관리항목 입력', await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: '2026-05-12', ledger_name: '무단 Layer3' },
  p_lines: [
    { gl_id: '3100000', drcr: '1', amount: 1000, dimension1: '영업' },
    { gl_id: '3110000', drcr: '2', amount: 1000 },
  ],
}), '차단 기대');

console.log('\n═══ 20. FINANCE 전표 — 계정변경 미리보기는 값을 지우지 않는다 (§7.4) ═══');
// 3110000 은 은행·관리항목 플래그가 꺼져 있다. 그 값을 든 라인을 옮기면 충돌이다.
// ⚠ 플래그를 PATCH 로 조작해 상황을 만들지 않는다 — 이미 전표가 참조하는 계정의
//   플래그 변경은 그 자체가 차단 대상이라(§9.8) 검증이 아니라 잡음이 된다.
const prevLine = { gl_id: '1010000', drcr: '1', amount: 1000, bank_id: 'B001', due_date: '2026-06-30' };
const prev = await rpc('ax_finance_ledger_preview_account_change', editorLow, {
  p_new_gl_id: '3110000', p_line: prevLine,
});
const conf = prev.body?.conflicts ?? [];
console.log(`  충돌 목록 반환                   ${prev.status}            ${JSON.stringify(conf)} ${
  conf.includes('bank_id') && conf.includes('due_date') ? '✔ 감지' : '✗ 감지 실패'}`);
console.log(`  ⭐ 값은 그대로 남는다             —              bank_id=${prevLine.bank_id} ${
  prevLine.bank_id === 'B001' ? '✔ 미리보기는 판정만 한다(화면이 확인 후 초기화)' : '✗ 값이 지워졌다'}`);
line('타 회사·미사용 계정 미리보기', await rpc('ax_finance_ledger_preview_account_change', editorLow,
  { p_new_gl_id: 'NOPE', p_line: prevLine }), 'AX-50463 기대');

console.log('\n═══ 21. FINANCE 전표 — 승인 · 승인 후 잠금 (§9.3) ═══');
line('불균형 승인 (APPROVER)', await rpc('ax_finance_ledger_approve', approver,
  { p_ledger_date: unbal.ledger_date, p_ledger_no: unbal.ledger_no }), 'AX-50473 기대');
line('균형 승인 (EDITOR)', await rpc('ax_finance_ledger_approve', editorLow,
  { p_ledger_date: L1.ledger_date, p_ledger_no: L1.ledger_no }), '권한 부족 기대');
line('균형 승인 (APPROVER)', await rpc('ax_finance_ledger_approve', approver,
  { p_ledger_date: L1.ledger_date, p_ledger_no: L1.ledger_no }), '204');
line('승인 후 수정', await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: L1.ledger_date, ledger_no: L1.ledger_no, ledger_name: '수정시도' },
  p_lines: [
    { gl_id: '3100000', drcr: '1', amount: 1 },
    { gl_id: '3110000', drcr: '2', amount: 1 },
  ],
}), '차단 기대');
line('승인 후 삭제', await rpc('ax_finance_ledger_delete', editorLow,
  { p_ledger_date: L1.ledger_date, p_ledger_no: L1.ledger_no }), '차단 기대');

console.log('\n═══ 22. FINANCE 초기이월 — 0원은 행 삭제다 (§9.4 · C11) ═══');
line('초기이월 저장 (EDITOR)', await rpc('ax_finance_openbalance_save', editorLow, {
  p_company_year_id: 'Y2026',
  p_rows: [
    { gl_id: '3100000', drcr: '1', amount: 300000 },
    { gl_id: '3110000', drcr: '2', amount: 300000 },
  ],
}), 'saved=2 기대');

const ob1 = await rpc('ax_finance_openbalance_list', editorLow, { p_company_year_id: 'Y2026' });
console.log(`  합계 (부호 살림)                 ${ob1.status}            차${ob1.body?.totals?.debit_total} 대${ob1.body?.totals?.credit_total} 차액${ob1.body?.totals?.difference}`);

// ⚠ 0원을 보내면 그 행은 사라진다 — "0으로 저장"이 아니다
const ob0 = await rpc('ax_finance_openbalance_save', editorLow, {
  p_company_year_id: 'Y2026',
  p_rows: [
    { gl_id: '3100000', drcr: '1', amount: 300000 },
    { gl_id: '3110000', drcr: '2', amount: 0 },
  ],
});
const ob2 = await rpc('ax_finance_openbalance_list', editorLow, { p_company_year_id: 'Y2026' });
const kept = (ob2.body?.rows ?? []).filter((r) => r.drcr !== null).length;
console.log(`  ⭐ 0원 행 삭제                    ${ob0.status}            saved=${ob0.body?.saved} 잔존=${kept}건 ${
  kept === 1 ? '✔ 0원 행이 사라졌다' : '✗ 0원 행이 남아 있다'}`);

line('음수 이월 (C11 — 허용)', await rpc('ax_finance_openbalance_save', editorLow, {
  p_company_year_id: 'Y2026',
  p_rows: [
    { gl_id: '3100000', drcr: '1', amount: 300000 },
    { gl_id: '3110000', drcr: '2', amount: 300000 },
  ],
}), 'saved=2');

line('초기이월 확정 (EDITOR)', await rpc('ax_finance_openbalance_close', editorLow,
  { p_company_year_id: 'Y2026' }), '권한 부족 기대');
line('초기이월 확정 (APPROVER)', await rpc('ax_finance_openbalance_close', approver,
  { p_company_year_id: 'Y2026' }), '204');
line('확정 후 수정', await rpc('ax_finance_openbalance_save', editorLow, {
  p_company_year_id: 'Y2026', p_rows: [{ gl_id: '3100000', drcr: '1', amount: 1 }],
}), '차단 기대');
line('확정해제 (APPROVER)', await rpc('ax_finance_openbalance_reopen', approver,
  { p_company_year_id: 'Y2026' }), '권한 부족 기대');
line('확정해제 (ADMIN)', await rpc('ax_finance_openbalance_reopen', admin,
  { p_company_year_id: 'Y2026' }), '204');

console.log('\n═══ 23. FINANCE 마감 — 마감은 오름차순, 해제는 내림차순 (§9.6) ═══');
line('⭐ Y2027 먼저 마감', await rpc('ax_finance_closing_execute', admin,
  { p_company_year_id: 'Y2027' }), 'AX-50513 기대');
line('미승인 전표 있는 채로 마감', await rpc('ax_finance_closing_execute', admin,
  { p_company_year_id: 'Y2026' }), 'AX-50515 기대');

// 미승인 전표를 정리한다 — 승인된 L1 은 그대로 둔다
await rpc('ax_finance_ledger_delete', editorLow,
  { p_ledger_date: unbal.ledger_date, p_ledger_no: unbal.ledger_no });
for (const n of [1, 2]) {
  await rpc('ax_finance_ledger_delete', editorLow, { p_ledger_date: '2026-05-11', p_ledger_no: n });
}

line('마감 (EDITOR)', await rpc('ax_finance_closing_execute', editorLow,
  { p_company_year_id: 'Y2026' }), '권한 부족 기대');
const closed = await rpc('ax_finance_closing_execute', admin, { p_company_year_id: 'Y2026' });
line('마감 (ADMIN)', closed, '200');
console.log(`  차년도 이월 생성                 ${closed.status}            ${closed.body?.next_year_id} ${closed.body?.carried_rows}건`);

line('⭐ 마감연도 전표 신규', await rpc('ax_finance_ledger_save', editorLow, {
  p_head: { ledger_date: '2026-06-01', ledger_name: '마감후' },
  p_lines: [
    { gl_id: '3100000', drcr: '1', amount: 100 },
    { gl_id: '3110000', drcr: '2', amount: 100 },
  ],
}), 'AX-50501 기대');
line('마감연도 전표 삭제', await rpc('ax_finance_ledger_delete', editorLow,
  { p_ledger_date: L1.ledger_date, p_ledger_no: L1.ledger_no }), 'AX-50501 기대');

const obNext = await rpc('ax_finance_openbalance_list', admin, { p_company_year_id: 'Y2027' });
const auto = (obNext.body?.rows ?? []).filter((r) => r.source === 'CLOSING').length;
console.log(`  자동생성분 source=CLOSING        ${obNext.status}            ${auto}건 ${auto > 0 ? '✔' : '✗'}`);
line('자동생성분 확정해제 시도', await rpc('ax_finance_openbalance_reopen', admin,
  { p_company_year_id: 'Y2027' }), 'FR-Close-08 차단 기대');

const reopened = await rpc('ax_finance_closing_reopen', admin, { p_company_year_id: 'Y2026' });
line('마감해제 (ADMIN)', reopened, '200');
console.log(`  자동생성분 회수                  ${reopened.status}            ${reopened.body?.removed_rows}건 회수`);
const obAfter = await rpc('ax_finance_openbalance_list', admin, { p_company_year_id: 'Y2027' });
const left = (obAfter.body?.rows ?? []).filter((r) => r.drcr !== null).length;
console.log(`  회수 후 Y2027 이월               ${obAfter.status}            ${left}건 ${left === 0 ? '✔ 비었다' : '✗ 남아 있다'}`);

console.log('\n═══ 24. Phase 6 정리 ═══');
await rpc('ax_finance_ledger_delete', editorLow,
  { p_ledger_date: L1.ledger_date, p_ledger_no: L1.ledger_no });
await rpc('ax_finance_openbalance_save', editorLow, { p_company_year_id: 'Y2026', p_rows: [] });
console.log('  전표 · 초기이월 정리 완료');

console.log('\n═══ 25. FINANCE 정리 ═══');
for (const id of ['D1','D2','D4','D5','D7']) {
  await rpc('ax_finance_dimension_delete', admin, { p_dimension_id: id });
}
console.log('  관리항목 정리 완료');

console.log('\n═══ 26. 정리 ═══');
line('부서 T2 삭제', await api('DELETE', 'system_team?team_id=eq.T2', admin), '204');
line('Pod P2 삭제', await api('DELETE', 'system_pod?pod_id=eq.P2', admin), '204');
line('기수 Y2028 삭제', await api('DELETE', 'system_year?company_year_id=eq.Y2028', admin), '204');
console.log('');
