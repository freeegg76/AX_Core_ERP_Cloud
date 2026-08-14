/**
 * 고객사/거래처 공통 폼 — 설계서 §8.3 · §12.1(중복 구현 금지)
 *
 * `partner_client` 와 `partner_vendor` 는 **완전한 거울 구조**다.
 * 다른 것은 PK 이름(client_id/vendor_id) · 명칭 컬럼 · 지급정책 참조 컬럼
 * (collecting_type / payment_type) 셋뿐이고, 나머지 ~20 컬럼이 동일하다.
 * 그래서 공통 필드를 여기로 모은다.
 */
import { Space } from 'antd';
import { Field, TextField } from '@/shared/ui';

/** 두 테이블이 공유하는 속성 */
export interface PartnerCommon {
  vat_id: string | null;
  nick_name: string | null;
  rep_name: string | null;
  reg_num: string | null;
  biz_industry: string | null;
  biz_category: string | null;
  phone_number: string | null;
  fax_number: string | null;
  bank_code: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  website: string | null;
  industry: string | null;
  notes: string | null;
}

/** 주소 컬럼만 이름이 다르다 (client_address / vendor_address) */
export interface PartnerFieldsProps<T extends PartnerCommon> {
  draft: Partial<T>;
  patch: (v: Partial<T>) => void;
  disabled: boolean;
  address: string | null | undefined;
  onAddressChange: (v: string) => void;
}

export function PartnerFields<T extends PartnerCommon>({
  draft, patch, disabled, address, onAddressChange,
}: PartnerFieldsProps<T>) {
  const set = (k: keyof PartnerCommon) => (v: string) =>
    patch({ [k]: v } as unknown as Partial<T>);

  return (
    <>
      <TextField label="사업자번호" value={draft.vat_id} disabled={disabled}
        hint="숫자와 하이픈만 입력한다"
        onChange={set('vat_id')} />
      <TextField label="약칭" value={draft.nick_name} disabled={disabled} onChange={set('nick_name')} />
      <TextField label="대표자" value={draft.rep_name} disabled={disabled} onChange={set('rep_name')} />
      <TextField label="법인번호" value={draft.reg_num} disabled={disabled} onChange={set('reg_num')} />
      <TextField label="업태" value={draft.biz_industry} disabled={disabled} onChange={set('biz_industry')} />
      <TextField label="종목" value={draft.biz_category} disabled={disabled} onChange={set('biz_category')} />

      <Field label="주소">
        <TextField label="" value={address} disabled={disabled} onChange={onAddressChange} />
      </Field>

      <TextField label="전화번호" value={draft.phone_number} disabled={disabled} onChange={set('phone_number')} />
      <TextField label="팩스번호" value={draft.fax_number} disabled={disabled} onChange={set('fax_number')} />

      <Space.Compact direction="vertical" style={{ width: '100%' }}>
        <TextField label="은행" value={draft.bank_code} disabled={disabled} onChange={set('bank_code')} />
        <TextField label="지점" value={draft.bank_branch} disabled={disabled} onChange={set('bank_branch')} />
        <TextField label="계좌번호" value={draft.bank_account} disabled={disabled} onChange={set('bank_account')} />
        <TextField label="예금주" value={draft.bank_holder} disabled={disabled} onChange={set('bank_holder')} />
      </Space.Compact>

      <TextField label="웹사이트" value={draft.website} disabled={disabled} onChange={set('website')} />
      <TextField label="산업" value={draft.industry} disabled={disabled} onChange={set('industry')} />
      <TextField label="비고" value={draft.notes} disabled={disabled} onChange={set('notes')} />
    </>
  );
}

/** 저장 본문에 공통 컬럼을 채운다. 화면마다 반복하지 않는다. */
export function partnerCommonRow<T extends PartnerCommon>(d: Partial<T>): Record<string, unknown> {
  return {
    vat_id: d.vat_id ?? null,
    nick_name: d.nick_name ?? null,
    rep_name: d.rep_name ?? null,
    reg_num: d.reg_num ?? null,
    biz_industry: d.biz_industry ?? null,
    biz_category: d.biz_category ?? null,
    phone_number: d.phone_number ?? null,
    fax_number: d.fax_number ?? null,
    bank_code: d.bank_code ?? null,
    bank_branch: d.bank_branch ?? null,
    bank_account: d.bank_account ?? null,
    bank_holder: d.bank_holder ?? null,
    website: d.website ?? null,
    industry: d.industry ?? null,
    notes: d.notes ?? null,
  };
}

/**
 * 사업자번호 형식 검증 — 설계서 부록 C.2 #1
 *
 * ⚠ 원본 T-SQL 은 `LIKE '%[^0-9-]%'` 였다. PostgreSQL 의 LIKE 에는 문자 클래스가
 *   없어 직역하면 **모든 입력이 검증을 통과**한다. DB 쪽은 정규식으로 이식했고,
 *   화면은 같은 규칙을 미리 안내한다(§2.3 — 판정만 하는 규칙은 중복 표현해도 좋다).
 */
export function validateVatId(v: string | null | undefined): string | null {
  if (!v) return null;
  return /[^0-9-]/.test(v) ? '사업자번호는 숫자와 하이픈만 입력할 수 있습니다.' : null;
}
