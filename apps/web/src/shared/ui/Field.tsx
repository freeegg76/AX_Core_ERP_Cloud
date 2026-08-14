/**
 * 상세 폼 필드 — 설계서 §12.1 (공통 UI 재사용, 화면별 중복 구현 금지)
 *
 * 마스터 화면의 Detail 영역은 "라벨 + 입력 + 편집모드 비활성" 이 반복된다.
 * 그 반복을 여기로 모은다.
 */
import { Input, InputNumber, Select, Switch, DatePicker } from 'antd';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';

export function Field({
  label, required, children, hint,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
        {label}
        {required ? <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span> : null}
      </div>
      {children}
      {hint ? <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

export function TextField({
  label, value, onChange, disabled, required, hint, maxLength, placeholder,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <Input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    </Field>
  );
}

export function NumberField({
  label, value, onChange, disabled, required, hint, min, max,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <InputNumber
        style={{ width: '100%' }}
        value={value ?? null}
        onChange={(v) => onChange(v as number | null)}
        disabled={disabled}
        min={min}
        max={max}
        precision={0}
      />
    </Field>
  );
}

export function SelectField<T extends string | number>({
  label, value, onChange, options, disabled, required, hint,
}: {
  label: string;
  value: T | null | undefined;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <Select<T>
        style={{ width: '100%' }}
        value={(value ?? undefined) as T}
        onChange={onChange}
        options={options}
        disabled={disabled}
      />
    </Field>
  );
}

export function DateField({
  label, value, onChange, disabled, required, hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <DatePicker
        style={{ width: '100%' }}
        value={value ? dayjs(value) : null}
        onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : null)}
        disabled={disabled}
      />
    </Field>
  );
}

/**
 * 사용/미사용 스위치.
 * ⚠ 극성 변환은 화면이 아니라 호출부가 isActive/toDbStatus 로 처리한다(§10.6).
 *   여기는 "활성인가?" 라는 의미값만 다룬다.
 */
export function ActiveField({
  label = '사용여부', active, onChange, disabled, onLabel = '사용', offLabel = '미사용', hint,
}: {
  label?: string;
  active: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div>
        <Switch checked={active} onChange={onChange} disabled={disabled} />
        <span style={{ marginLeft: 8 }}>{active ? onLabel : offLabel}</span>
      </div>
    </Field>
  );
}
