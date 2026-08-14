#!/usr/bin/env node
/**
 * service_role 키 노출 검사 — 설계서 §19.2 · §18.4
 *
 * ⚠ 이전 구현(`grep -rniE 'service_role'`)은 **양쪽으로 틀렸다.**
 *
 *   거짓 양성 : "service_role 키를 넣지 말라"는 **경고 주석**에 걸려 CI 가 실패했다.
 *   거짓 음성 : 진짜 키는 `eyJhbGci...` 형태의 JWT 라서 원문에 `service_role`
 *              문자열이 **없다**. 정작 막아야 할 것을 못 잡았다.
 *
 * 그래서 문자열이 아니라 **실체**를 본다.
 *   ① JWT 를 찾아 payload 를 디코드하고 role 을 확인한다 (진짜 키 탐지)
 *   ② service_role 계열 환경변수 참조를 찾는다 (키를 주입할 통로 차단)
 *   ③ 빌드 산출물(dist)도 같은 기준으로 검사한다 (실제로 배포되는 것)
 *
 * 주석이나 문서에서 `service_role` 을 **설명하는 것은 막지 않는다** — 그것은 위험이 아니다.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const SCAN_ROOTS = ['apps', 'packages'];
const BUILD_DIRS = ['apps/web/dist'];
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css',
  '.env', '.example', '.yml', '.yaml', '.toml', '.md', '.txt', '',
]);

/** JWT 세 조각. 실제 키는 이 형태로만 존재한다. */
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/** 키를 주입할 수 있는 환경변수 이름. 프론트엔드에서 참조 자체가 금지다. */
const ENV_RE = /\b(SUPABASE_)?SERVICE_ROLE(_KEY)?\b/;

const failures = [];

function decodeJwtRole(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function scanFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // 바이너리 등
  }

  // ① 실제 JWT — payload 의 role 을 본다
  for (const token of text.match(JWT_RE) ?? []) {
    const role = decodeJwtRole(token);
    if (role && role !== 'anon' && role !== 'authenticated') {
      failures.push(`${path}: role='${role}' 인 JWT 가 포함되어 있습니다 (${token.slice(0, 24)}…)`);
    }
  }

  // ② 환경변수 참조 — 주석은 제외한다(설명은 위험이 아니다)
  text.split('\n').forEach((line, i) => {
    const stripped = line.replace(/^\s*(\/\/|#|\*|--).*$/, '');
    if (ENV_RE.test(stripped)) {
      failures.push(`${path}:${i + 1}: service_role 환경변수를 참조합니다 — ${line.trim()}`);
    }
  });
}

/** git 추적 파일만 본다 — node_modules 등 비추적 산출물은 대상이 아니다. */
function trackedFiles() {
  const out = execSync(`git ls-files ${SCAN_ROOTS.join(' ')}`, { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => TEXT_EXT.has(extname(f)));
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

console.log('service_role 노출 검사 (설계서 §19.2)');

const src = trackedFiles();
src.forEach(scanFile);
console.log(`  소스 ${src.length}개 파일 검사`);

// ③ 빌드 산출물 — 실제로 브라우저에 배포되는 것
const built = BUILD_DIRS.flatMap(walk).filter((f) => TEXT_EXT.has(extname(f)));
if (built.length) {
  built.forEach(scanFile);
  console.log(`  빌드 산출물 ${built.length}개 파일 검사`);
} else {
  console.log('  빌드 산출물 없음 — 소스만 검사했습니다 (pnpm build 후 재실행 권장)');
}

if (failures.length) {
  console.error('\n❌ service_role 노출 위험:\n');
  for (const f of failures) console.error(`   ${f}`);
  console.error('\n   service_role 은 BYPASSRLS 입니다. 브라우저에 들어가면 테넌트 격리가 통째로 무너집니다.');
  console.error('   프론트엔드는 anon 키만 사용합니다 (설계서 §19.2).\n');
  process.exit(1);
}

console.log('✔ service_role 키·환경변수 참조 없음\n');
