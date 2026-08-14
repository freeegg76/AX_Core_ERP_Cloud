/*==============================================================================
  AX Bridge v2.0 — 13b. 표준 GL seed 데이터 결함 보정
  설계서 §7.4 (contra_gl 검증 규칙) · 부록 C.4 (이식과 함께 고치는 원본 결함)

  ⚠ 원천 결함 1건 — `AX_Bridge.xlsx > GL` 시트의 오타

    gl_id 2070000 (감가상각누계액) 의 contra_gl 이 **자기 자신**을 가리킨다.
    설계서 §7.4 는 "자기 자신을 지정할 수 없다(contra_gl <> gl_id)" 를 명시하며,
    v2.0 은 이를 ck_gl_contra_self CHECK 로 DDL 에 올렸다. 따라서 원본 데이터를
    그대로 적재하면 표준 GL 재생성이 실패한다.

  근거 — 03.유형자산 블록의 감가상각누계액은 예외 없이 **바로 위 자산계정**을 가리킨다.

    2040000 구축물          ← 2050000 감가상각누계액
    2060000 기계장치        ← 2070000 감가상각누계액   ⚠ '2070000' 로 잘못 기록됨
    2080000 차량운반구      ← 2090000 감가상각누계액
    2100000 공구와기구      ← 2110000 감가상각누계액

    24개 차감계정 전체가 이 규칙을 따르며, 어긋나는 것은 이 1건뿐이다.
    따라서 올바른 대상은 2060000(기계장치) 이다.

  ※ 원본 `Planning_Docs/07_AX_Bridge_Seed_GL.sql` 은 읽기 전용으로 보존한다.
     이 보정은 이식 시점의 명시적 결정이며, 원천 명세서 수정은 별도 협의 사항이다.
==============================================================================*/

update public.finance_gl_seed
   set contra_gl = '2060000'
 where gl_id = '2070000'
   and contra_gl = '2070000';

-- 보정 후 자기참조가 0건이어야 한다. 남아 있으면 배포를 막는다.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.finance_gl_seed where contra_gl = gl_id;
  if v_n > 0 then
    raise exception '표준 GL seed 에 자기참조 차감계정이 % 건 남아 있습니다 (설계서 §7.4 위반)', v_n;
  end if;

  -- 차감계정이 아닌데 contra_gl 을 가진 행도 없어야 한다(ck_gl_contra_shape)
  select count(*) into v_n from public.finance_gl_seed
   where contra_gl is not null and gl_detail <> '1';
  if v_n > 0 then
    raise exception '차감항목이 아닌데 contra_gl 을 가진 seed 행이 % 건 있습니다', v_n;
  end if;

  -- contra_gl 이 실재하는 계정을 가리켜야 한다
  select count(*) into v_n from public.finance_gl_seed s
   where s.contra_gl is not null
     and not exists (select 1 from public.finance_gl_seed t where t.gl_id = s.contra_gl);
  if v_n > 0 then
    raise exception '존재하지 않는 계정을 가리키는 contra_gl 이 % 건 있습니다', v_n;
  end if;
end $$;
