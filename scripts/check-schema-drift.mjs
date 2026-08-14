#!/usr/bin/env node
/**
 * 스키마 드리프트 검사 — 설계서 §18.3
 *
 * `supabase/migrations/` 가 실제 스키마와 일치하는지 단언한다.
 * ⚠ `db diff` 를 **생성**이 아니라 **단언**으로 쓴다 — 출력이 비어야 통과다.
 *
 * ⚠ 파일 크기(`[ -s file ]`)로 판단하면 안 된다. CLI 는 실행 환경에 따라
 *   `{"diff":"\n","message":"Diff complete."}` 같은 **JSON 메타데이터를 stdout 에**
 *   쓰기도 한다. 그러면 차이가 없어도 파일이 비어 있지 않아 항상 실패한다.
 *   여기서는 두 출력 형태를 모두 해석해 **실제 DDL 이 있는지**만 본다.
 */
import { execSync } from 'node:child_process';

/**
 * CI 는 supabase/setup-cli 로 PATH 에 CLI 를 올려 둔다. 그것을 우선 쓰고,
 * 로컬처럼 없을 때만 npx 로 내려받는다 — CI 에서 중복 설치·버전 불일치를 피한다.
 */
function resolveCli() {
  try {
    execSync('supabase --version', { stdio: 'ignore' });
    return 'supabase';
  } catch {
    return 'npx --yes supabase@2.114.0';
  }
}
const CLI = resolveCli();

let raw;
try {
  raw = execSync(`${CLI} db diff --local --schema public`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  console.error('❌ db diff 실행 실패');
  console.error(e.stdout || e.message);
  process.exit(1);
}

/** JSON 출력이면 diff 필드를, 아니면 본문 자체를 SQL 로 본다. */
function extractSql(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      return (JSON.parse(trimmed).diff ?? '').trim();
    } catch {
      /* JSON 이 아니면 아래로 */
    }
  }
  // 로그성 JSON 라인이 섞여 있을 수 있으므로 걷어낸다
  return trimmed
    .split('\n')
    .filter((l) => !l.trim().startsWith('{'))
    .join('\n')
    .trim();
}

const sql = extractSql(raw);

// 주석·빈 줄만 남은 경우도 차이 없음으로 본다
const meaningful = sql
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('--'))
  .join('\n')
  .trim();

if (meaningful) {
  console.error('❌ 마이그레이션에 반영되지 않은 스키마 차이가 있습니다 (§16.1)\n');
  console.error(meaningful);
  console.error('\n   새 마이그레이션 파일을 추가하세요. 기존 파일은 수정하지 않습니다.\n');
  process.exit(1);
}

console.log('✔ 스키마 드리프트 없음 — 마이그레이션이 실제 스키마와 일치합니다');
