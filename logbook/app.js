/* 조종사 전자 로그북 — 화면 */
(function () {
  'use strict';
  const L = window.LOGBOOK, OCR = window.LOGBOOK_OCR, DB = window.LOGBOOK_STORE, DRIVE = window.LOGBOOK_DRIVE, LS = window.LOGBOOK_SKD, ICLOUD = window.LOGBOOK_ICLOUD;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const DAY = L.DAY, MIN = L.MIN;
  window.LOGBOOK_VERSION = '2026.11.27-4'; // sw.js의 VERSION과 같이 올리기

  const DEFAULT_SETTINGS = {
    tz: 'Asia/Seoul', schedTz: 'Asia/Seoul', night: 'civil', instrumentRule: 'flight2', ifrRule: 'block', defaultType: 'A321', defaultDuty: 'C',
    airline: 'KE', regPrefix: 'HL',
    carry: { asOf: '' }, airports: [], aircraft: [], careers: [], profile: {}, print: {}, savedFilters: [], updatedAt: 0
  };
  // [키, 이름, 이륙, 착륙, 그때 정할 역할(fn)] — CRZ·Observer는 이착륙 없이 역할도 바뀜
  const ROLES = [['pf', 'PF (이륙·착륙)', true, true], ['pm', 'PM', false, false], ['to', '이륙만', true, false], ['ld', '착륙만', false, true],
    ['crz', 'CRZ (순항 교대)', false, false, 'RELIEF'], ['obs', 'Observer', false, false, 'OBS']];
  const APPROACH_TYPES = ['ILS', 'RNP', 'LOC', 'VOR', 'RNP AR', 'VISUAL'];

  const S = { entries: [], settings: Object.assign({}, DEFAULT_SETTINGS), view: 'log', search: '', sync: {}, syncing: false };
  let airports = L.airportDB();

  /* ===================== 공통 ===================== */

  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), ms || 3200);
  }
  function busy(on, text) {
    $('busy').classList.toggle('on', !!on);
    if (text) $('busyText').textContent = text;
  }
  const live = () => S.entries.filter(e => !e.deleted);
  const todayIn = tz => L.dateIn(Date.now(), tz);
  const utcDate = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
  const whenText = ms => { const d = new Date(ms); return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`; };
  /** "731" → "KE731", "ke 731" → "KE731" */
  const normFlight = v => {
    const t = String(v || '').toUpperCase().replace(/\s+/g, '');
    return /^\d{1,4}[A-Z]?$/.test(t) ? (S.settings.airline || '') + t : t;
  };
  /** "8399" → "HL8399", "hl-8399" → "HL8399" */
  const normReg = v => {
    const t = String(v || '').toUpperCase().replace(/[\s-]+/g, '');
    const pre = (S.settings.regPrefix || '').toUpperCase();
    return /^\d{3,5}[A-Z]?$/.test(t) && pre ? pre + t : t === pre ? '' : t;
  };
  const calcOpts = extra => Object.assign({ airports, tz: S.settings.tz, night: S.settings.night, instrumentRule: S.settings.instrumentRule, ifrRule: S.settings.ifrRule }, extra || {});

  async function saveSettings(patch) {
    Object.assign(S.settings, patch, { updatedAt: Date.now() });
    airports = L.airportDB(S.settings.airports);
    await DB.set('settings', S.settings);
    markDirty();
  }

  /* ===================== 로그북 목록 ===================== */

  /* ---------- 목록 보기 상태 (탭·정렬·필터) — 이 기기에 기억 ---------- */
  const LV_KEY = 'logbook.view';
  const LV = (() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(LV_KEY) || 'null'); } catch (e) { /* 무시 */ }
    return Object.assign({ tab: null, sort: { up: 'asc', rec: 'desc', all: 'desc' }, filter: Object.assign({}, L.FILTER_DEFAULT), open: false, showStale: false }, v || {});
  })();
  const saveLV = () => { try { localStorage.setItem(LV_KEY, JSON.stringify(LV)); } catch (e) { /* 무시 */ } };
  const TABS = [['up', '오늘·예정'], ['rec', '기록'], ['all', '전체']];
  const PERIODS = [['', '전체 기간'], ['thisMonth', '이번 달'], ['lastMonth', '지난달'], ['90d', '최근 90일'], ['thisYear', '올해'], ['custom', '직접 지정']];
  const FN_FILTER = [['', '모든 역할'], ['PIC', '기장 (PIC)'], ['SIC', '부기장 (SIC)'], ['PICUS', 'PICUS'], ['RELIEF', '순항 교대'], ['DUAL', '교육 받음'], ['instr', '교관 비행 (IP)'], ['exam', '심사 비행 (평가관)']];
  const filterCount = f => Object.keys(L.FILTER_DEFAULT).filter(k => !['from', 'to'].includes(k) && f[k] && f[k] !== L.FILTER_DEFAULT[k]).length;

  function renderLog() {
    if (!LV.tab) LV.tab = S.entries.some(e => e.planned && !e.deleted) ? 'up' : 'rec';
    renderLogTools();
    renderBoard();
  }

  function renderLogTools() {
    const f = LV.filter, n = filterCount(f), sort = LV.sort[LV.tab] || 'desc';
    const types = [...new Set(S.entries.filter(e => !e.deleted && e.aircraftType).map(e => e.aircraftType.toUpperCase()))].sort();
    const saved = S.settings.savedFilters || [];
    const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
    $('logTools').innerHTML = `
      <div class="lv-bar">
        <div class="lv-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-pressed="${LV.tab === k}">${l}</button>`).join('')}</div>
        <button type="button" class="btn sm" id="sortBtn" title="정렬 바꾸기">${sort === 'asc' ? '↑ 오름차순' : '↓ 내림차순'}</button>
        <button type="button" class="btn sm${n ? ' pri' : ''}" id="filterBtn" aria-expanded="${LV.open}">필터${n ? ' ' + n : ''}</button>
      </div>
      ${saved.length ? `<div class="chips">${saved.map(x => `<span class="chip"><button type="button" class="chip-go" data-sf="${esc(x.id)}">${esc(x.name)}</button><button type="button" class="chip-x" data-sfdel="${esc(x.id)}" aria-label="${esc(x.name)} 지우기">×</button></span>`).join('')}</div>` : ''}
      <div class="sec" id="filterPanel"${LV.open ? '' : ' hidden'}>
        <div class="form">
          <div class="field"><label for="fPeriod">기간</label><select id="fPeriod">${opt(PERIODS, f.period)}</select></div>
          <div class="field" id="fCustom"${f.period === 'custom' ? '' : ' hidden'}><label>시작 ~ 종료</label><div style="display:flex;gap:6px"><input type="date" id="fFrom" value="${esc(f.from)}"><input type="date" id="fTo" value="${esc(f.to)}"></div></div>
          <div class="field"><label for="fKind">종류</label><select id="fKind">${opt([['', '비행 + 시뮬레이터'], ['flight', '비행만'], ['sim', '시뮬레이터만']], f.kind)}</select></div>
          <div class="field"><label for="fFn">역할</label><select id="fFn">${opt(FN_FILTER, f.fn)}</select></div>
          <div class="field"><label for="fType">기종</label><select id="fType">${opt([['', '모든 기종']].concat(types.map(t => [t, t])), f.type)}</select></div>
          <div class="field"><label for="fApt">공항 (출발 또는 도착)</label><input id="fApt" value="${esc(f.apt)}" placeholder="ICN / RKSI" autocapitalize="characters" autocomplete="off"></div>
          <div class="field"><label for="fReg">등록부호</label><input id="fReg" value="${esc(f.reg)}" placeholder="HL8399" autocapitalize="characters" autocomplete="off"></div>
          <div class="field"><label>그 밖에</label>
            <label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" id="fNight" ${f.night ? 'checked' : ''} style="width:auto;min-height:0"> 야간 비행만</label>
            <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="fPhoto" ${f.photo ? 'checked' : ''} style="width:auto;min-height:0"> 사진 있는 것만</label></div>
        </div>
        <div class="actions" style="margin:10px 0 0">
          <button type="button" class="btn" id="fReset">초기화</button>
          <button type="button" class="btn" id="fSave">이 필터 저장</button>
        </div>
        <p class="help">필터 저장: 지금 탭·정렬·필터를 이름 붙여 저장해 두고, 위의 버튼으로 다시 불러옵니다. 다른 기기와도 동기화됩니다.</p>
      </div>`;

    const T = $('logTools');
    T.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { LV.tab = b.dataset.tab; saveLV(); renderLog(); }));
    $('sortBtn').addEventListener('click', () => { LV.sort[LV.tab] = (LV.sort[LV.tab] || 'desc') === 'asc' ? 'desc' : 'asc'; saveLV(); renderLog(); });
    $('filterBtn').addEventListener('click', () => { LV.open = !LV.open; saveLV(); $('filterPanel').hidden = !LV.open; $('filterBtn').setAttribute('aria-expanded', LV.open); });
    const set = (k, v) => {
      LV.filter[k] = v; saveLV(); renderBoard();
      const c = filterCount(LV.filter), fb = $('filterBtn');
      fb.textContent = '필터' + (c ? ' ' + c : ''); fb.classList.toggle('pri', c > 0);
    };
    $('fPeriod').addEventListener('change', ev => { $('fCustom').hidden = ev.target.value !== 'custom'; set('period', ev.target.value); });
    $('fFrom').addEventListener('change', ev => set('from', ev.target.value));
    $('fTo').addEventListener('change', ev => set('to', ev.target.value));
    $('fKind').addEventListener('change', ev => set('kind', ev.target.value));
    $('fFn').addEventListener('change', ev => set('fn', ev.target.value));
    $('fType').addEventListener('change', ev => set('type', ev.target.value));
    $('fApt').addEventListener('input', ev => set('apt', ev.target.value.trim()));
    $('fReg').addEventListener('input', ev => set('reg', ev.target.value.trim()));
    $('fNight').addEventListener('change', ev => set('night', ev.target.checked));
    $('fPhoto').addEventListener('change', ev => set('photo', ev.target.checked));
    $('fReset').addEventListener('click', resetFilter);
    $('fSave').addEventListener('click', async () => {
      const name = (prompt('저장할 이름 (예: 올해 기장 비행)', '') || '').trim();
      if (!name) return;
      const list = (S.settings.savedFilters || []).filter(x => x.name !== name);
      list.push({ id: 'f' + Date.now().toString(36), name, tab: LV.tab, sort: LV.sort[LV.tab], filter: Object.assign({}, LV.filter) });
      await saveSettings({ savedFilters: list });
      toast(`"${name}" 필터를 저장했습니다.`);
      renderLogTools();
    });
    T.querySelectorAll('[data-sf]').forEach(b => b.addEventListener('click', () => {
      const x = (S.settings.savedFilters || []).find(y => y.id === b.dataset.sf);
      if (!x) return;
      LV.tab = x.tab || 'rec'; LV.sort[LV.tab] = x.sort || LV.sort[LV.tab];
      LV.filter = Object.assign({}, L.FILTER_DEFAULT, x.filter);
      saveLV(); renderLog();
      toast(`"${x.name}" 필터를 불러왔습니다.`);
    }));
    T.querySelectorAll('[data-sfdel]').forEach(b => b.addEventListener('click', async () => {
      const x = (S.settings.savedFilters || []).find(y => y.id === b.dataset.sfdel);
      if (!x || !confirm(`저장한 필터 "${x.name}"를 지울까요?`)) return;
      await saveSettings({ savedFilters: (S.settings.savedFilters || []).filter(y => y.id !== x.id) });
      renderLogTools();
    }));
  }

  function resetFilter() {
    LV.filter = Object.assign({}, L.FILTER_DEFAULT);
    S.search = ''; $('search').value = '';
    saveLV(); renderLog();
  }

  /** 한 줄 */
  function rowHtml(e, today) {
    const title = e.isSimulator ? `SIM · ${esc(e.aircraftType)} ${esc(e.flightNumber)}`
      : `${esc(e.flightNumber || '편명 없음')} <span style="font-weight:600">${esc(airports.display(e.origin))}→${esc(airports.display(e.destination))}</span>`;
    const sub = [e.aircraftType && !e.isSimulator ? e.aircraftType : '', e.registration, e.isSimulator ? e.fstdType : '',
      e.isSimulator ? '' : L.crewNamesOf(e).slice(0, 2).join(', ')].filter(Boolean).map(esc).join(' · ');
    const dutyBadge = e.isSimulator ? '' : `<span class="badge duty" title="Duty">${esc({ PIC: 'PIC', SIC: 'F/O', PICUS: 'PICUS', RELIEF: 'CRZ', DUAL: 'Dual', OBS: 'OBS' }[L.fnOf(e)])}</span>` +
      (L.instructingOf(e) ? '<span class="badge duty">IP</span>' : '') + (e.examining ? '<span class="badge duty">평가</span>' : '');
    const badges = dutyBadge + (e.planned ? [
      '<span class="badge plan">예정</span>',
      e.roleSure === false ? '<span class="badge warn">역할 확인</span>' : ''
    ].join('') : [
      e.takeoffs > 0 ? `<span class="badge">T/O${e.nightTakeoffs ? ' ☾' : ''}${e.takeoffs > 1 ? ' ×' + e.takeoffs : ''}</span>` : '',
      e.landings > 0 ? `<span class="badge">L/D${e.nightLandings ? ' ☾' : ''}${e.landings > 1 ? ' ×' + e.landings : ''}</span>` : '',
      e.hasPhoto ? '<span class="badge" title="스캔 사진 있음">📷</span>' : ''
    ].join(''));
    const blk = e.planned
      ? `<span class="blk"><span class="t">${e.schedOut != null && !e.schedNoTime ? L.zulu(e.schedOut) + 'Z' : '—'}</span><small>STD</small></span>`
      : `<span class="blk"><span class="t">${L.hmm(e.block)}</span>${e.night ? `<small>☾ ${L.hmm(e.night)}</small>` : ''}</span>`;
    const isToday = e.logDate === today;
    return `<li class="row${e.planned ? ' plan' : ''}${isToday ? ' today' : ''}" data-id="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(e.logDate)} ${esc(e.flightNumber)} ${e.planned ? '예정 비행 기록하기' : '열기'}">
      <span class="d">${isToday ? '오늘' : esc(e.logDate.slice(5).replace('-', '/'))}</span>
      <span><span class="ttl">${title}</span><br><span class="sub">${sub}</span></span>
      <span class="badges">${badges}</span>
      ${blk}</li>`;
  }

  function renderBoard() {
    const board = $('board');
    const today = todayIn(S.settings.tz);
    const v = L.logView(S.entries, { tab: LV.tab, sort: LV.sort[LV.tab] || 'desc', filter: LV.filter, query: S.search, today, display: c => airports.display(c) });
    const q = S.search.trim();
    const filtering = L.filterActive(LV.filter) || q;

    // 검색어로 찾은 함께 탄 사람
    const people = q.length >= 2 ? L.crewIndex(S.entries, q).slice(0, 5) : [];
    const ymd = d => d.replace(/-/g, '/');
    const peopleHtml = people.length ? `<div class="banner" style="display:block"><b>함께 탄 사람</b><ul class="list-plain" style="margin:6px 0 0">${people.map(p =>
      `<li><span><b>${esc(p.name)}</b> — 함께 ${p.count}회</span><span class="help mono">${p.count > 1 ? ymd(p.first) + ' ~ ' : ''}${ymd(p.last)}</span></li>`).join('')}</ul></div>` : '';

    // 필터 결과 요약
    const t = v.totals;
    const sumHtml = filtering ? `<div class="banner"><span><b>필터 적용 중</b> · 비행 ${t.flights}편 ${L.hmm(t.block)}${t.sims ? ` · 시뮬레이터 ${t.sims}` : ''}${t.planned ? ` · 예정 ${t.planned}편` : ''}</span><button class="btn sm" id="clearFilter">초기화</button></div>` : '';

    // 오늘·예정 탭: 기록 안 한 지난 비행
    let staleHtml = '';
    if (LV.tab === 'up' && v.stale.length) {
      staleHtml = `<div class="banner" style="display:block">
        <button type="button" class="btn sm" id="toggleStale" aria-expanded="${LV.showStale}">${LV.showStale ? '▾' : '▸'} 아직 기록 안 한 지난 비행 ${v.stale.length}건</button>
        <span class="help"> 비행했으면 눌러서 시각을 넣고, 취소된 비행이면 정리하세요.</span>
        ${LV.showStale ? `<ul class="board" style="margin-top:8px">${v.stale.map(e => rowHtml(e, today)).join('')}</ul><div class="actions" style="margin:8px 0 0"><button class="btn sm" id="clearStale">지난 예정 정리</button></div>` : ''}
      </div>`;
    }

    if (!v.items.length) {
      const empty = filtering ? '조건에 맞는 기록이 없습니다.'
        : LV.tab === 'up' ? '오늘과 앞으로 예정된 비행이 없습니다.<br><b>📅 스케줄 가져오기</b>로 비행을 미리 넣어 두거나, 비행 후 <b>OOOI 화면 찍기</b>를 하세요.'
          : LV.tab === 'rec' ? '저장한 기록이 없습니다.<br>비행 후 MCDU의 <b>AOC › OOOI STATUS</b> 화면을 <b>OOOI 화면 찍기</b>로 찍으세요.'
            : '아직 기록이 없습니다.';
      board.innerHTML = peopleHtml + sumHtml + staleHtml + `<p class="empty">${empty}</p>`;
    } else {
      // 달별로 묶어 그대로 순서 유지. 전체 탭은 '오늘' 위치에 구분선
      const months = [];
      v.items.forEach((e, i) => {
        const k = e.logDate.slice(0, 7) || '날짜 없음';
        let g = months[months.length - 1];
        if (!g || g.k !== k) { g = { k, parts: [[]] }; months.push(g); }
        if (i === v.todayIndex && g.parts[g.parts.length - 1].length) g.parts.push([]);
        if (i === v.todayIndex) g.todayAt = g.parts.length - 1;
        g.parts[g.parts.length - 1].push(e);
      });
      let html = '';
      for (const g of months) {
        const items = g.parts.flat();
        const done = items.filter(e => !e.isSimulator && !e.planned), plan = items.filter(e => e.planned);
        const planMin = plan.reduce((a, e) => a + (e.schedOut != null && e.schedIn != null ? Math.round((e.schedIn - e.schedOut) / MIN) : 0), 0);
        const right = [done.length ? L.hmm(done.reduce((a, e) => a + e.block, 0)) : '', plan.length ? `예정 ${plan.length}편 · ${L.hmm(planMin)}` : ''].filter(Boolean).join(' · ') || L.hmm(0);
        html += `<div class="month"><span>${esc(g.k.replace('-', '년 '))}월</span><span class="mono">${right}</span></div>`;
        g.parts.forEach((part, pi) => {
          if (pi === g.todayAt) html += `<div class="today-line"><span>오늘 ${esc(today.slice(5).replace('-', '/'))}</span></div>`;
          if (part.length) html += `<ul class="board">${part.map(e => rowHtml(e, today)).join('')}</ul>`;
        });
      }
      board.innerHTML = peopleHtml + sumHtml + staleHtml + html;
    }

    if ($('clearFilter')) $('clearFilter').addEventListener('click', resetFilter);
    if ($('toggleStale')) $('toggleStale').addEventListener('click', () => { LV.showStale = !LV.showStale; saveLV(); renderBoard(); });
    const cs = $('clearStale');
    if (cs) cs.addEventListener('click', async () => {
      const stale = v.stale;
      if (!confirm(`지난 예정 비행 ${stale.length}건을 지울까요?\n(실제로 비행한 것은 먼저 눌러서 기록해 두세요)`)) return;
      const now = Date.now(), gone = stale.map(e => Object.assign({}, e, { deleted: true, updatedAt: now }));
      await DB.putEntries(gone);
      gone.forEach(g => { const i = S.entries.findIndex(x => x.id === g.id); if (i >= 0) S.entries[i] = g; });
      render(true); markDirty();
    });
  }

  $('board').addEventListener('click', ev => {
    const row = ev.target.closest('.row');
    if (row) openEntry(row.dataset.id);
  });
  $('board').addEventListener('keydown', ev => {
    const row = ev.target.closest('.row');
    if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openEntry(row.dataset.id); }
  });
  $('search').addEventListener('input', ev => { S.search = ev.target.value; renderBoard(); });

  /* ===================== 요약 ===================== */

  const ctx = () => ({ airports, aircraft: S.settings.aircraft });
  const fmtDate = ms => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  function renderSummary() {
    const st = S.settings, c = st.carry || {};
    const tot = L.totalsFull(S.entries, c, null, ctx());
    const month = todayIn(st.tz).slice(0, 7);
    const mon = L.totalsFull(S.entries, null, { from: month + '-01', through: month + '-31' }, ctx());
    const rec = L.recency(S.entries, Date.now());
    const faa = L.faaCurrency(S.entries, Date.now(), ctx());
    const career = L.careerAt(st.careers, todayIn(st.tz));
    const crewTop = L.crewIndex(S.entries).slice(0, 10);
    const card = (label, v) => `<div class="card"><label>${label}</label><span class="t">${v}</span></div>`;
    const state = (ok, okText, badText) => `<span class="state ${ok ? 'ok' : 'warn'}">${ok ? '✓ ' + okText : '⚠ ' + badText}</span>`;
    const timeCards = L.TOTAL_FIELDS.filter(([k, , kind]) => kind === 'time' && (tot[k] || ['total', 'pic', 'sic', 'night', 'ifr'].includes(k)))
      .map(([k, label]) => card(label, L.hmm(tot[k]))).join('');
    const countCards = L.TOTAL_FIELDS.filter(([, , kind]) => kind === 'count').map(([k, label]) => card(label, tot[k])).join('');

    $('view-sum').innerHTML = `
      ${st.profile && st.profile.name ? `<p class="help" style="margin-top:0"><b>${esc(st.profile.name)}</b>${career ? ` · 현재 ${esc(career.title || L.FUNCTIONS[career.fn].label)}${career.aircraftType ? ' · ' + esc(career.aircraftType) : ''}` : ''}</p>` : ''}
      <h2>최근 비행 요건</h2>
      <div class="cards">
        <div class="rec">
          <b>ICAO · 회사 — 90일 이착륙</b><br>${state(rec.isCurrent, '충족', `미달 (각 ${rec.required}회)`)}
          <table><thead><tr><th></th><th>비행</th><th>SIM</th><th>합계</th></tr></thead><tbody>
            <tr><td>이륙</td><td>${rec.flightTakeoffs}</td><td>${rec.simTakeoffs}</td><td><b>${rec.totalTakeoffs}</b></td></tr>
            <tr><td>착륙</td><td>${rec.flightLandings}</td><td>${rec.simLandings}</td><td><b>${rec.totalLandings}</b></td></tr>
          </tbody></table>
          ${rec.validUntil ? `<p class="help">추가 이착륙이 없으면 <b>${fmtDate(rec.validUntil)}</b>까지</p>` : ''}
        </div>
        <div class="rec">
          <b>FAA — 야간 90일</b><br>${state(faa.night.isCurrent, '충족', '미달 (이륙·완전 정지 착륙 각 3회)')}
          <p class="help">일몰 1시간 후 ~ 일출 1시간 전 기준<br>이륙 ${faa.night.takeoffs} · 착륙 ${faa.night.landings}</p>
          ${faa.night.validUntil ? `<p class="help"><b>${fmtDate(faa.night.validUntil)}</b>까지</p>` : ''}
        </div>
        <div class="rec">
          <b>FAA — 계기 6개월</b><br>${state(faa.instrument.isCurrent, '충족', '미달 (접근 6회·체공)')}
          <p class="help">계기 접근 ${faa.instrument.approaches}회 · 체공 ${faa.instrument.holding}회</p>
          ${faa.instrument.validUntil ? `<p class="help"><b>${fmtDate(faa.instrument.validUntil)}</b>까지</p>` : ''}
        </div>
      </div>
      <h2>누계</h2>
      <div class="cards">${timeCards}</div>
      <div class="cards" style="margin-top:10px">${countCards}</div>
      <p class="help">${c.asOf ? `이월 누계(${esc(c.asOf)}까지) + 그 뒤 앱 기록. ` : ''}설정 › 이월 누계에서 바꿀 수 있습니다.</p>
      ${crewTop.length ? `<h2>자주 함께 탄 조종사</h2>
      <ul class="list-plain">${crewTop.map(p => `<li><button class="btn sm" data-crew="${esc(p.name)}">${esc(p.name)}</button><span class="help mono">${p.count}회 · 마지막 ${esc(p.last.replace(/-/g, '/'))}</span></li>`).join('')}</ul>
      <p class="help">이름을 누르면 함께 탄 비행만 보여 줍니다. 로그북 탭 검색창에 이름을 넣어도 됩니다.</p>` : ''}
      <h2>이번 달 (${esc(month.replace('-', '년 '))}월)</h2>
      <div class="cards">${card('비행시간', L.hmm(mon.total))}${card('편수', mon.flights)}${card('기장', L.hmm(mon.pic))}${card('야간', L.hmm(mon.night))}${card('이착륙', mon.takeoffs + ' / ' + mon.landings)}</div>`;
  }

  $('view-sum').addEventListener('click', ev => {
    const b = ev.target.closest('[data-crew]');
    if (!b) return;
    S.search = b.dataset.crew;
    $('search').value = S.search;
    LV.tab = 'rec'; saveLV();
    show('log');
  });

  /* ===================== 설정 ===================== */

  const FN_OPTIONS = () => Object.entries(L.FUNCTIONS).map(([k, v]) => [k, v.label]);
  const selectHtml = (id, opts, v, attrs) => `<select id="${id}" ${attrs || ''}>${opts.map(([val, label]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;

  function renderSettings() {
    const st = S.settings, c = st.carry || {}, pf = st.profile || {};
    const lastSync = S.sync.lastSync ? new Date(S.sync.lastSync).toLocaleString('ko-KR') : '아직 안 함';
    const careers = (st.careers || []).slice().sort((a, b) => (a.from < b.from ? 1 : -1));
    const field = (id, label, value, extra) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${esc(value || '')}" ${extra || ''}></div>`;

    $('view-set').innerHTML = `
      <h2>조종사 정보</h2>
      <div class="sec">
        <div class="form">
          ${field('pName', '이름', pf.name, 'autocomplete="name"')}
          ${field('pNameEn', '영문 이름 (출력용)', pf.nameEn, 'autocapitalize="characters" placeholder="LEE JAESUNG"')}
          ${field('pLicense', '자격증명 종류·번호', pf.license, 'placeholder="ATPL(A) 12-3456"')}
          ${field('pEmployer', '소속', pf.employer)}
          ${field('pEmpNo', '사번', pf.empNo)}
          ${field('pNation', '국적', pf.nationality, 'placeholder="KOR"')}
        </div>
        <p class="help">출력물 머리말에 들어갑니다. 이 기기와 구글 드라이브 파일에만 저장됩니다.</p>
      </div>

      <h2>경력 단계</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">부기장으로 시작한 날, 기장이 된 날, 교관·평가관이 된 날처럼 <b>바뀐 날짜마다 한 줄</b>씩 넣으세요. 새 비행을 입력하면 그 날짜에 맞는 역할이 자동으로 정해집니다.</p>
        <ul class="list-plain">${careers.map(p => `<li><span><b class="mono">${esc(p.from)}</b>부터 · ${esc(p.title || L.FUNCTIONS[p.fn].label)} · ${esc(L.FUNCTIONS[p.fn].label)}${p.aircraftType ? ' · ' + esc(p.aircraftType) : ''}${p.employer ? ' · ' + esc(p.employer) : ''}${p.instructor ? ' · 교관' : ''}${p.examiner ? ' · 평가관' : ''}</span>
          <button class="btn sm danger" data-del-career="${esc(p.from)}">삭제</button></li>`).join('') || '<li><span class="help">아직 없습니다. 예) 2014-03-01 부기장 A320 / 2020-07-01 기장 A321</span></li>'}</ul>
        <div class="form">
          ${field('cFrom', '시작일', '', 'type="date"')}
          ${field('cTitle', '직책 이름', '', 'placeholder="부기장 / 기장 / 교관 기장"')}
          <div class="field"><label for="cFn">기본 역할</label>${selectHtml('cFn', FN_OPTIONS(), 'SIC')}</div>
          ${field('cType', '기종', '', 'autocapitalize="characters" placeholder="A321"')}
          ${field('cEmployer', '소속', pf.employer)}
          <div class="field"><label>자격</label>
            <label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" id="cInstr" style="width:auto;min-height:0"> 교관(IP)</label>
            <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="cExam" style="width:auto;min-height:0"> 평가관</label></div>
        </div>
        <div class="actions"><button class="btn" id="addCareer">경력 단계 추가</button></div>
      </div>

      <h2>이월 누계 (앱 쓰기 전까지의 기록)</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">회사 로그북이나 이전 로그북의 누계를 넣으세요. 시간은 <span class="mono">시:분</span> (예 <span class="mono">8584:14</span>). 모르는 항목은 0으로 두면 됩니다.</p>
        <div class="form">
          ${L.TOTAL_FIELDS.map(([k, label, kind]) => `<div class="field"><label for="carry-${k}">${label}</label><input id="carry-${k}" data-carry="${k}" data-kind="${kind}" class="mono" inputmode="numeric" value="${kind === 'time' ? L.hmm(c[k] || 0) : (c[k] || 0)}"></div>`).join('')}
          <div class="field"><label for="cAsOf">기준일 (이날까지 포함된 숫자)</label><input id="cAsOf" type="date" value="${esc(c.asOf || '')}"></div>
        </div>
        <p class="help">기준일 다음 날부터의 앱 기록이 더해집니다. 출력할 때 첫 페이지의 "이전 페이지까지"에 들어갑니다.</p>
      </div>

      <h2 id="syncSec">동기화 · 백업</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">기록은 항상 <b>이 기기에 먼저</b> 저장되고, 인터넷이 되면 <b>연결된 곳 모두</b>와 자동으로 합쳐집니다. 기기마다 원하는 곳만 연결하세요 (예: 개인 폰은 구글+iCloud, 회사 iPad는 iCloud만). 마지막 동기화: <span id="lastSyncText">${esc(lastSync)}</span></p>
        <h3 style="font-size:15px;margin:12px 0 6px">구글 드라이브 (개인 계정) — <span id="gStatus" class="help"></span></h3>
        <p class="help" style="margin:0 0 6px">내 드라이브의 <span class="mono">${esc(DRIVE.FILE_NAME)}</span> 파일 하나만 읽고 씁니다. 회사(워크스페이스) 계정 대신 개인 계정으로 로그인하세요.</p>
        <div class="actions" style="margin:6px 0 14px"><button class="btn pri" id="setSync">${DRIVE.signedIn() ? '지금 동기화' : '구글 드라이브 연결'}</button></div>
        <h3 style="font-size:15px;margin:12px 0 6px">iCloud Drive 파일 (무료) — <span id="idStatus" class="help"></span></h3>
        <p class="help" style="margin:0 0 6px">회사 iPad처럼 구글을 쓰지 않는 기기용. 파일 앱의 iCloud Drive에 <span class="mono">${esc(IDRIVE_FILE)}</span> 하나를 두고 맞춥니다.
          <b>①</b>로 그 파일을 골라 합치고, <b>②</b>로 공유 → "파일에 저장" → 같은 위치를 골라 <b>대치(덮어쓰기)</b>하세요. 처음에는 ②만 하면 됩니다.</p>
        <div class="actions" style="margin:6px 0 14px">
          <button class="btn" id="idLoad">① iCloud Drive에서 불러와 합치기</button>
          <button class="btn pri" id="idSave">② iCloud Drive에 저장</button>
        </div>
        <input type="file" id="idFile" accept="application/json,.json" hidden>
        <details style="margin:10px 0"${ICLOUD.configured() ? ' open' : ''}><summary class="help" style="cursor:pointer">고급: iCloud 자동 동기화 (Apple 개발자 계정 필요) — <span id="ckStatus"></span></summary>
        ${ICLOUD.configured() ? `
          <p class="help" style="margin:0 0 6px">내 iCloud의 비공개 영역에만 저장됩니다. 한 번 로그인하면 유지됩니다.</p>
          <div id="ck-sign-in" style="min-height:44px;margin:6px 0"></div><div id="ck-sign-out" style="margin:6px 0"></div>
          ${ICLOUD.config().source === 'device' ? '<button class="btn sm" id="ckReset">이 기기의 iCloud 설정 지우기</button>' : ''}` : `
          <p class="help" style="margin:0 0 6px">자동 동기화를 켜려면 Apple 개발자 계정(연 $99)으로 만든 <b>CloudKit 컨테이너 ID</b>와 <b>API 토큰</b>이 필요합니다 (저장소 docs/icloud-setup.md). 받은 값을 넣으세요.</p>
          <div class="form">
            ${field('ckContainer', '컨테이너 ID', '', 'placeholder="iCloud.com.example.pilotlogbook" autocapitalize="off" spellcheck="false"')}
            ${field('ckToken', 'API 토큰', '', 'autocapitalize="off" spellcheck="false" autocomplete="off"')}
            <div class="field"><label for="ckEnv">환경</label>${selectHtml('ckEnv', [['production', 'production (실사용)'], ['development', 'development (시험)']], 'production')}</div>
          </div>
          <div class="actions" style="margin:6px 0"><button class="btn" id="ckSave">iCloud 설정 저장</button></div>`}
        </details>
        <h3 style="font-size:15px;margin:16px 0 6px">파일 백업</h3>
        <div class="actions">
          <button class="btn" id="exportJson">JSON 백업 받기</button>
          <button class="btn" id="importJson">백업에서 불러오기</button>
        </div>
        <p class="help" id="persistInfo"></p>
      </div>

      <h2>계산 규칙 · 기본값</h2>
      <div class="sec"><div class="form">
        ${field('sType', '기본 기종 (경력 단계에 없을 때)', st.defaultType, 'autocapitalize="characters"')}
        <div class="field"><label for="sTz">회사 양식 날짜 기준</label>${selectHtml('sTz', [['Asia/Seoul', '한국 시간'], ['UTC', 'UTC']], st.tz)}</div>
        <div class="field"><label for="sSched">MONTHLY SKD의 STD·STA 시각 기준 (Crew Roster는 자동으로 현지 시각)</label>${selectHtml('sSched', [['Asia/Seoul', '한국 시간'], ['UTC', 'UTC']], st.schedTz || 'Asia/Seoul')}</div>
        <div class="field"><label for="sNight">야간 시간 기준</label>${selectHtml('sNight', [['civil', '시민박명 (ICAO·FAA 기록 기준)'], ['sunset', '일몰 ~ 일출']], st.night)}</div>
        <div class="field"><label for="sIfr">IFR 시간 (ICAO 10번 칸)</label>${selectHtml('sIfr', [['block', '블록시간과 같게'], ['flight', '비행시간(OFF→ON)과 같게'], ['manual', '직접 입력']], st.ifrRule)}</div>
        <div class="field"><label for="sInst">실계기 (회사 I/T·FAA Actual)</label>${selectHtml('sInst', [['flight2', '비행시간 − 2분 (회사 로그북과 같음)'], ['flight', '비행시간(OFF→ON)과 같게'], ['block', '블록시간과 같게'], ['manual', '직접 입력']], st.instrumentRule)}</div>
        ${field('sAirline', 'FLIGHT ID 기본 앞자리 (항공사 코드)', st.airline, 'autocapitalize="characters" maxlength="3" placeholder="KE"')}
        ${field('sRegPre', '등록부호 기본 앞자리', st.regPrefix, 'autocapitalize="characters" maxlength="3" placeholder="HL"')}
      </div></div>

      <h2>기종</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">에어버스·보잉 등 주요 기종 ${L.AIRCRAFT_TYPES.length}개는 다인 조종·다발·터빈(AMEL)으로 들어 있습니다. 다른 기종은 여기서 추가하세요.</p>
        <ul class="list-plain">${(st.aircraft || []).map((t, i) => `<li><span class="mono">${esc(t.code)} · ${esc(t.name)} · ${t.mp ? '다인' : '1인'} · ${t.me ? '다발' : '단발'} · ${esc(t.cls)}${t.turbine ? ' · 터빈' : ''}</span><button class="btn sm danger" data-del-ac="${i}">삭제</button></li>`).join('')}</ul>
        <div class="form">
          ${field('tCode', '기종 코드 (회사 코드도 가능: 32A, 3QR…)', '', 'autocapitalize="characters" placeholder="C172 / 32A"')}
          ${field('tName', '제작사·모델 (출력용)', '', 'placeholder="Cessna 172S"')}
          <div class="field"><label for="tCls">종류·등급</label>${selectHtml('tCls', [['AMEL', 'AMEL (육상 다발)'], ['ASEL', 'ASEL (육상 단발)'], ['AMES', 'AMES'], ['ASES', 'ASES'], ['RH', '헬리콥터']], 'AMEL')}</div>
          <div class="field"><label>특성</label>
            <label style="display:inline-flex;gap:6px;align-items:center;margin-right:12px"><input type="checkbox" id="tMp" checked style="width:auto;min-height:0"> 다인 조종</label>
            <label style="display:inline-flex;gap:6px;align-items:center;margin-right:12px"><input type="checkbox" id="tMe" checked style="width:auto;min-height:0"> 다발</label>
            <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="tTurb" checked style="width:auto;min-height:0"> 터빈</label></div>
        </div>
        <div class="actions"><button class="btn" id="addAc">기종 추가</button></div>
      </div>

      <h2>공항</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">한국·일본·중국·동남아 주요 공항 ${L.AIRPORTS.length}곳이 들어 있습니다. 없는 공항은 좌표와 시간대를 넣으면 야간 시간이 계산됩니다.</p>
        <ul class="list-plain">${(st.airports || []).map((a, i) => `<li><span class="mono">${esc(a.icao)} / ${esc(a.iata)} · ${esc(a.lat)}, ${esc(a.lon)} · ${esc(a.tz)}</span><button class="btn sm danger" data-del-apt="${i}">삭제</button></li>`).join('')}</ul>
        <div class="form">
          ${field('aIcao', 'ICAO', '', 'maxlength="4" autocapitalize="characters" placeholder="RKSI"')}
          ${field('aIata', 'IATA', '', 'maxlength="3" autocapitalize="characters" placeholder="ICN"')}
          ${field('aLat', '위도', '', 'inputmode="decimal" placeholder="37.4602"')}
          ${field('aLon', '경도', '', 'inputmode="decimal" placeholder="126.4407"')}
          ${field('aTz', '시간대', '', 'placeholder="Asia/Seoul" list="tzList"')}
        </div>
        <datalist id="tzList">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map(z => `<option value="${esc(z)}">`).join('')}</datalist>
        <div class="actions"><button class="btn" id="addApt">공항 추가</button></div>
      </div>
      <p class="help">기록 ${live().length}건 · 앱 버전 ${esc(window.LOGBOOK_VERSION || '')}</p>`;

    DB.persist().then(ok => {
      const el = $('persistInfo');
      if (el) el.textContent = ok ? '이 기기의 저장 공간은 보호 상태입니다 (브라우저가 임의로 지우지 않음).'
        : '저장 공간 보호가 꺼져 있습니다. 홈 화면에 추가해서 쓰고, 가끔 백업해 두세요.';
    });

    // 조종사 정보
    for (const [id, key] of [['pName', 'name'], ['pNameEn', 'nameEn'], ['pLicense', 'license'], ['pEmployer', 'employer'], ['pEmpNo', 'empNo'], ['pNation', 'nationality']]) {
      $(id).addEventListener('change', ev => saveSettings({ profile: Object.assign({}, S.settings.profile, { [key]: ev.target.value.trim() }) }));
    }
    // 경력 단계
    $('addCareer').addEventListener('click', async () => {
      const from = $('cFrom').value;
      if (!from) return toast('시작일을 넣어 주세요.');
      const p = { from, title: $('cTitle').value.trim(), fn: $('cFn').value, aircraftType: $('cType').value.trim().toUpperCase(),
        employer: $('cEmployer').value.trim(), instructor: $('cInstr').checked, examiner: $('cExam').checked };
      await saveSettings({ careers: (S.settings.careers || []).filter(x => x.from !== from).concat(p) });
      toast('경력 단계를 추가했습니다. 이 날짜 이후 새 기록에 적용됩니다.');
      renderSettings();
    });
    $('view-set').querySelectorAll('[data-del-career]').forEach(b => b.addEventListener('click', async () => {
      await saveSettings({ careers: (S.settings.careers || []).filter(x => x.from !== b.dataset.delCareer) });
      renderSettings();
    }));
    // 이월 누계
    $('view-set').querySelectorAll('[data-carry]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.carry, isTime = el.dataset.kind === 'time';
      const v = isTime ? L.parseHMM(el.value) : (/^\d+$/.test(el.value.trim()) ? +el.value.trim() : null);
      if (v == null) { el.value = isTime ? L.hmm(S.settings.carry[k] || 0) : (S.settings.carry[k] || 0); return toast(isTime ? '시:분 형식으로 넣어 주세요 (예 8584:14)' : '숫자로 넣어 주세요'); }
      el.value = isTime ? L.hmm(v) : v;
      saveSettings({ carry: Object.assign({}, S.settings.carry, { [k]: v }) });
    }));
    $('cAsOf').addEventListener('change', ev => saveSettings({ carry: Object.assign({}, S.settings.carry, { asOf: ev.target.value }) }));
    // 규칙
    $('sType').addEventListener('change', ev => saveSettings({ defaultType: ev.target.value.trim().toUpperCase() }));
    $('sTz').addEventListener('change', ev => saveSettings({ tz: ev.target.value }));
    $('sNight').addEventListener('change', ev => saveSettings({ night: ev.target.value }));
    $('sSched').addEventListener('change', ev => saveSettings({ schedTz: ev.target.value }));
    $('sIfr').addEventListener('change', ev => saveSettings({ ifrRule: ev.target.value }));
    $('sInst').addEventListener('change', ev => saveSettings({ instrumentRule: ev.target.value }));
    $('sAirline').addEventListener('change', ev => saveSettings({ airline: ev.target.value.trim().toUpperCase() }));
    $('sRegPre').addEventListener('change', ev => saveSettings({ regPrefix: ev.target.value.trim().toUpperCase() }));
    // 기종
    $('addAc').addEventListener('click', async () => {
      const code = $('tCode').value.trim().toUpperCase().replace(/\s+/g, '');
      if (!code) return toast('기종 코드를 넣어 주세요.');
      const t = { code, name: $('tName').value.trim() || code, cls: $('tCls').value, mp: $('tMp').checked, me: $('tMe').checked, turbine: $('tTurb').checked };
      await saveSettings({ aircraft: (S.settings.aircraft || []).filter(x => x.code !== code).concat(t) });
      renderSettings();
    });
    $('view-set').querySelectorAll('[data-del-ac]').forEach(b => b.addEventListener('click', async () => {
      const list = (S.settings.aircraft || []).slice(); list.splice(+b.dataset.delAc, 1);
      await saveSettings({ aircraft: list }); renderSettings();
    }));
    // 공항
    $('addApt').addEventListener('click', addAirport);
    $('view-set').querySelectorAll('[data-del-apt]').forEach(b => b.addEventListener('click', async () => {
      const list = (S.settings.airports || []).slice();
      list.splice(+b.dataset.delApt, 1);
      await saveSettings({ airports: list });
      renderSettings();
    }));
    // 백업
    $('setSync').addEventListener('click', () => sync(true, true));
    refreshSyncStatus();
    if (ICLOUD.configured()) startICloud(); // 로그인 안 돼 있으면 #ck-sign-in 에 Apple 로그인 버튼이 그려짐
    if ($('ckSave')) $('ckSave').addEventListener('click', () => {
      const c = { containerIdentifier: $('ckContainer').value.trim(), apiToken: $('ckToken').value.trim(), environment: $('ckEnv').value };
      if (!/^iCloud\./.test(c.containerIdentifier) || !c.apiToken) return toast('컨테이너 ID(iCloud.로 시작)와 API 토큰을 넣어 주세요.');
      ICLOUD.saveDeviceConfig(c);
      toast('iCloud 설정을 저장했습니다. Apple 버튼으로 로그인하세요.');
      renderSettings();
    });
    if ($('ckReset')) $('ckReset').addEventListener('click', () => { if (confirm('이 기기의 iCloud 설정을 지울까요? (iCloud에 저장된 기록은 그대로)')) { ICLOUD.saveDeviceConfig(null); renderSettings(); } });
    $('exportJson').addEventListener('click', () => downloadFile(backupText(), `logbook-backup-${todayIn(S.settings.tz)}.json`, 'application/json'));
    $('idLoad').addEventListener('click', () => $('idFile').click());
    $('idSave').addEventListener('click', saveToIcloudDrive);
    $('idFile').addEventListener('change', loadFromIcloudDrive);
    $('importJson').addEventListener('click', () => $('importFile').click());
  }

  async function addAirport() {
    const icao = $('aIcao').value.trim().toUpperCase(), iata = $('aIata').value.trim().toUpperCase();
    const lat = parseFloat($('aLat').value), lon = parseFloat($('aLon').value), tz = $('aTz').value.trim();
    if (!/^[A-Z]{4}$/.test(icao)) return toast('ICAO는 영문 4자입니다.');
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return toast('위도·경도를 확인해 주세요.');
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { return toast('시간대 이름을 확인해 주세요 (예 Asia/Seoul).'); }
    const list = (S.settings.airports || []).filter(a => a.icao !== icao);
    list.push({ icao, iata, lat, lon, tz });
    await saveSettings({ airports: list });
    toast(`${icao} 추가됨`);
    renderSettings();
  }

  /* ===================== 출력 (ICAO · FAA · 회사 양식) ===================== */

  function renderPrint() {
    const st = S.settings, po = Object.assign({ format: 'icao', rowsPerPage: 15, from: '', through: '' }, st.print || {});
    const fmtOpts = Object.entries(L.FORMATS).map(([k, f]) => [k, f.name]);
    $('view-print').innerHTML = `
      <div class="sec no-print">
        <div class="form">
          <div class="field"><label for="prFmt">양식</label>${selectHtml('prFmt', fmtOpts, po.format)}</div>
          <div class="field"><label for="prFrom">시작일 (비우면 처음부터)</label><input type="date" id="prFrom" value="${esc(po.from)}"></div>
          <div class="field"><label for="prTo">종료일 (비우면 오늘까지)</label><input type="date" id="prTo" value="${esc(po.through)}"></div>
          <div class="field"><label for="prRows">페이지당 줄 수</label>${selectHtml('prRows', [['10', '10'], ['12', '12'], ['15', '15'], ['18', '18'], ['20', '20']], String(po.rowsPerPage))}</div>
        </div>
        <p class="help" id="prInfo"></p>
        <div class="actions">
          <button class="btn pri" id="prPrint">인쇄 / PDF로 저장</button>
          <button class="btn" id="prCsv">CSV (엑셀)</button>
        </div>
        <p class="help">PDF로 저장: 인쇄 화면에서 프린터를 <b>PDF로 저장</b>으로 고르세요. 용지는 A4 가로로 맞춰집니다. 시작일 이전 기록과 이월 누계는 첫 페이지의 "이전 페이지까지"에 들어갑니다.</p>
      </div>
      <div id="prPages" class="print-area"></div>`;
    const save = patch => saveSettings({ print: Object.assign({}, S.settings.print, patch) }).then(drawPrint);
    $('prFmt').addEventListener('change', ev => save({ format: ev.target.value }));
    $('prFrom').addEventListener('change', ev => save({ from: ev.target.value }));
    $('prTo').addEventListener('change', ev => save({ through: ev.target.value }));
    $('prRows').addEventListener('change', ev => save({ rowsPerPage: +ev.target.value }));
    $('prPrint').addEventListener('click', () => { drawPrint(); window.print(); });
    $('prCsv').addEventListener('click', () => {
      const p = currentPrintOpts();
      downloadFile(L.formatCSV(S.entries, p), `logbook-${p.format}-${todayIn(st.tz)}.csv`, 'text/csv');
    });
    drawPrint();
  }

  function currentPrintOpts() {
    const po = Object.assign({ format: 'icao', rowsPerPage: 15, from: '', through: '' }, S.settings.print || {});
    return { format: po.format, rowsPerPage: po.rowsPerPage, from: po.from || null, through: po.through || null,
      carry: S.settings.carry, airports, aircraft: S.settings.aircraft };
  }

  function drawPrint() {
    const opts = currentPrintOpts();
    const log = L.buildLog(S.entries, opts);
    const fmt = log.format, cols = log.cols, pf = S.settings.profile || {};
    $('prInfo').textContent = `${fmt.name} · ${log.rowCount}건 · ${log.pages.length}페이지 · ${fmt.note}`;
    // 머리글 두 줄: group이 같은 칸끼리 묶음
    const groups = [];
    cols.forEach(c => { const g = c.group || ''; const last = groups[groups.length - 1]; if (last && last.g === g && g) last.n++; else groups.push({ g, n: 1, c }); });
    const head1 = groups.map(g => g.g && (g.n > 1 || !/^\d+$/.test(g.g)) ? `<th colspan="${g.n}">${esc(g.g)}</th>` : `<th rowspan="2">${esc(g.g ? g.g + ' ' : '')}${esc(g.c.label)}</th>`).join('');
    const head2 = groups.filter(g => g.g && (g.n > 1 || !/^\d+$/.test(g.g))).map(g => cols.filter(c => (c.group || '') === g.g).map(c => `<th>${esc(c.label)}</th>`).join('')).join('');
    const firstSum = cols.findIndex(c => c.sum || c.kind === 'mark');
    const totalRow = (label, vals) => `<tr class="sum"><td colspan="${firstSum}">${label}</td>${cols.slice(firstSum).map(c => `<td>${c.sum ? esc(L.cellText(c, vals[c.key], fmt, false)) : ''}</td>`).join('')}</tr>`;
    const who = [pf.nameEn || pf.name, pf.license, pf.employer].filter(Boolean).map(esc).join(' · ');
    $('prPages').innerHTML = log.pages.map((p, i) => `
      <section class="lb-page">
        <header><b>PILOT LOGBOOK</b><span>${who}</span><span>${esc(fmt.name)} · Page ${i + 1} / ${log.pages.length}</span></header>
        <table class="lb fmt-${esc(opts.format)}">
          <thead><tr>${head1}</tr>${head2 ? `<tr>${head2}</tr>` : ''}</thead>
          <tbody>${p.rows.map(r => `<tr>${cols.map((c, j) => `<td class="${c.kind}">${esc(L.cellText(c, r.cells[j], fmt))}</td>`).join('')}</tr>`).join('')}
            ${Array.from({ length: Math.max(0, opts.rowsPerPage - p.rows.length) }, () => `<tr class="blank">${cols.map(() => '<td></td>').join('')}</tr>`).join('')}</tbody>
          <tfoot>${totalRow('TOTAL THIS PAGE / 이 페이지 합계', p.pageTotal)}${totalRow('TOTAL FROM PREVIOUS PAGES / 이전 페이지까지', p.broughtForward)}${totalRow('TOTAL TIME / 누계', p.total)}</tfoot>
        </table>
        <footer><span>I certify that the entries in this log are true. / 위 기록이 사실임을 확인합니다.</span><span>Signature / 서명 ____________________</span></footer>
      </section>`).join('');
  }

  /* ===================== 화면 전환 ===================== */

  function show(view) {
    S.view = view;
    for (const v of ['log', 'sum', 'print', 'set']) $('view-' + v).hidden = v !== view;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('title').textContent = { log: '로그북', sum: '요약', print: '출력', set: '설정' }[view];
    render(true);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  document.addEventListener('focusout', () => setTimeout(() => {
    if (S.renderPending && !typingIn(document.activeElement)) render();
  }, 400));

  const typingIn = el => !!el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'file';

  /** 현재 화면 다시 그리기. 그 화면에서 입력 중이면 입력이 끊기지 않게 미뤘다가 입력을 마치면 그림 */
  function render(force) {
    const view = $('view-' + S.view), a = document.activeElement;
    if (!force && view && view.contains(a) && typingIn(a)) { S.renderPending = true; renderSync(); return; }
    S.renderPending = false;
    if (S.view === 'log') renderLog();
    else if (S.view === 'sum') renderSummary();
    else if (S.view === 'print') renderPrint();
    else renderSettings();
    renderSync();
  }

  /* ===================== 편집 ===================== */

  // 편집 중인 값. times는 OUT 날짜 + 네 시각(HHMM) — 날짜는 OUT부터 앞으로 자동
  let D = null;

  function draftFrom(entry, extra) {
    const e = Object.assign({}, entry);
    if (!e.isSimulator) {
      if (!e.registration) e.registration = S.settings.regPrefix || '';
      if (!e.flightNumber) e.flightNumber = S.settings.airline || '';
      if (!e.approachType && !e.approaches) { e.approaches = 1; e.approachType = 'ILS'; }
    }
    const hh = ms => (ms == null ? '' : L.zulu(ms));
    const f = L.fnOf(e);
    const role = f === 'RELIEF' ? ROLES[4] : f === 'OBS' ? ROLES[5] : ROLES.find(r => !r[4] && r[2] === e.takeoffs > 0 && r[3] === e.landings > 0);
    return Object.assign({
      e, isNew: false, notes: [], photo: null, photoUrl: null, screen: null, diag: null,
      sched: { date: e.schedOut != null ? utcDate(e.schedOut) : '', std: e.schedOut != null ? L.zulu(e.schedOut) : '', sta: e.schedIn != null ? L.zulu(e.schedIn) : '' },
      outDate: e.out != null ? utcDate(e.out) : utcDate(Date.now()),
      hhmm: { out: hh(e.out), off: hh(e.off), on: hh(e.on), in: hh(e.in) },
      role: role ? role[0] : null
    }, extra || {});
  }

  /** 그 날짜의 경력 단계로 역할·기종 기본값 채우기 (사용자가 직접 고친 뒤에는 안 바꿈) */
  function applyCareer(date) {
    if (!D || D.fnTouched) return;
    const c = L.careerAt(S.settings.careers, date);
    const e = D.e;
    e.fn = c ? c.fn : (S.settings.defaultDuty === 'F' ? 'SIC' : 'PIC');
    // 기종: 직접 고치지 않았으면 그 날짜 경력 단계의 기종. 등록부호는 기종이 같을 때만 지난 기록 것을 씀
    if (c && c.aircraftType && !D.typeTouched && e.aircraftType !== c.aircraftType) {
      e.aircraftType = c.aircraftType;
      if (D.lastReg && D.lastReg.type !== c.aircraftType) e.registration = S.settings.regPrefix || '';
    }
    D.career = c;
  }

  function newFlightDraft() {
    const last = live().filter(e => !e.isSimulator && !e.planned).sort((a, b) => b.createdAt - a.createdAt)[0];
    const e = L.newEntry({ aircraftType: (last && last.aircraftType) || '', registration: (last && last.registration) || S.settings.regPrefix || '',
      flightNumber: S.settings.airline || '', logDate: todayIn(S.settings.tz), approaches: 1, approachType: 'ILS' });
    D = draftFrom(e, { isNew: true, role: null, hhmm: { out: '', off: '', on: '', in: '' }, lastReg: last ? { type: last.aircraftType, reg: last.registration } : null });
    if (!D.e.aircraftType) D.e.aircraftType = S.settings.defaultType;
    applyCareer(D.e.logDate);
    return D;
  }

  async function openEntry(id) {
    const e = S.entries.find(x => x.id === id);
    if (!e) return;
    D = e.planned ? planDraft(e) : draftFrom(e);
    if (e.hasPhoto) {
      const blob = await DB.getPhoto(e.id).catch(() => null);
      if (blob) D.photoUrl = URL.createObjectURL(blob);
    }
    openEditor();
  }

  /** 예정 비행 → 기록할 초안 (역할·기장 이름은 스케줄 것을 유지) */
  function planDraft(e) {
    if (!e.approachType) e = Object.assign({}, e, { approaches: e.approaches || 1, approachType: 'ILS' });
    return draftFrom(e, { fromPlan: true, fnTouched: true, outDate: e.schedOut != null ? utcDate(e.schedOut) : utcDate(Date.now()), role: null });
  }

  /** OUT 날짜와 HHMM 네 개 → UTC 시각들 (OFF·ON·IN은 바로 앞 시각 이후 가장 가까운 시점) */
  function resolveDraftTimes() {
    const out = {}, m = k => L.clock.fromDigits((D.hhmm[k] || '').replace(/\D/g, '').padStart(4, '0').slice(-4));
    const valid = k => /^\d{3,4}$/.test((D.hhmm[k] || '').replace(/\D/g, '')) && m(k) != null;
    let prev = null;
    const base = /^\d{4}-\d{2}-\d{2}$/.test(D.outDate) ? Date.UTC(+D.outDate.slice(0, 4), +D.outDate.slice(5, 7) - 1, +D.outDate.slice(8, 10)) : null;
    for (const k of ['out', 'off', 'on', 'in']) {
      if (!valid(k)) { out[k] = null; continue; }
      if (prev == null) {
        if (base == null) { out[k] = null; continue; }
        out[k] = base + m(k) * MIN;
        if (k !== 'out') { /* OUT이 비면 첫 시각을 OUT 날짜에 둠 */ }
      } else {
        let t = Math.floor(prev / DAY) * DAY + m(k) * MIN;
        if (t < prev) t += DAY;
        out[k] = t;
      }
      prev = out[k];
    }
    return out;
  }

  function recalcDraft() {
    const e = D.e;
    if (e.isSimulator) return;
    const t = resolveDraftTimes();
    e.out = t.out; e.off = t.off; e.on = t.on; e.in = t.in;
    if (D.isNew && e.out != null) applyCareer(L.dateIn(e.out, S.settings.tz));
    const r = ROLES.find(x => x[0] === D.role);
    L.recalc(e, calcOpts(r ? { takeoff: r[2], landing: r[3] } : {}));
  }

  function missingFields() {
    const e = D.e, m = [];
    if (e.isSimulator) { if (!e.logDate) m.push('날짜'); return m; }
    if (!/\d/.test(e.flightNumber)) m.push('편명');
    if (!e.origin || !e.destination) m.push('출발·도착');
    if (e.out == null || e.in == null) m.push('OUT·IN 시각');
    if (!D.role) m.push('T/O·L/D');
    return m;
  }

  const flagged = f => D.notes.some(n => n.field === f && n.kind !== 'derived');

  /** 저장 전에 시각이 상식적인지 (오독으로 하루가 밀리는 경우 등) */
  function timeProblems() {
    const e = D.e, p = [];
    if (e.isSimulator) return p;
    const mins = (a, b) => (a != null && b != null ? Math.round((b - a) / MIN) : null);
    const blk = mins(e.out, e.in), tout = mins(e.out, e.off), tin = mins(e.on, e.in), flt = mins(e.off, e.on);
    if (blk != null && blk > 20 * 60) p.push(`Block이 ${L.hmm(blk)}입니다 (20시간 초과)`);
    if (tout != null && tout > 150) p.push(`OUT→OFF 지상 이동이 ${L.hmm(tout)}입니다`);
    if (tin != null && tin > 150) p.push(`ON→IN 지상 이동이 ${L.hmm(tin)}입니다`);
    if (blk != null && flt != null && flt > blk) p.push('Flight가 Block보다 깁니다');
    if (D.screen && D.screen.block != null && blk != null && blk !== D.screen.block) p.push(`화면의 BLOCK ${L.hmm(D.screen.block)}와 다릅니다 (지금 ${L.hmm(blk)})`);
    if (D.screen && D.screen.flight != null && flt != null && flt !== D.screen.flight) p.push(`화면의 FLIGHT ${L.hmm(D.screen.flight)}와 다릅니다 (지금 ${L.hmm(flt)})`);
    return p;
  }

  function openEditor() {
    const e = D.e;
    $('edTitle').textContent = e.isSimulator ? '시뮬레이터' : D.fromPlan ? '예정 비행 기록하기' : D.isNew ? (D.notes.length || D.photoUrl ? '스캔 결과 확인' : '새 비행') : (e.flightNumber || '비행');
    const body = $('edBody');
    if (e.isSimulator) body.innerHTML = simForm();
    else body.innerHTML = flightForm();
    bindEditor();
    refreshComputed();
    const dlg = $('ed');
    if (!dlg.open) dlg.showModal();
    body.scrollTop = 0;
  }

  function scanSection() {
    if (!D.notes.length && !D.photoUrl) return '';
    const problems = D.notes.filter(n => ['missing', 'mismatch', 'unknownAirport'].includes(n.kind));
    return `<div class="sec"><h3>스캔 결과</h3><div class="scan-top">
      ${D.photoUrl ? `<img src="${D.photoUrl}" alt="스캔한 OOOI 화면" id="edPhoto">` : ''}
      <div>
        ${D.notes.length ? `<p style="margin:0 0 6px;font-weight:700;color:var(${problems.length ? '--warn' : '--ok'})">${problems.length ? '⚠ 확인이 필요한 값이 있습니다' : '✓ BLOCK·FLIGHT 검산 통과'}</p>` : ''}
        <ul class="notes">${D.notes.map(n => `<li class="${esc(n.kind)}">${esc(n.message)}</li>`).join('')}</ul>
        ${!D.notes.length && D.e.scanRaw ? `<p class="help">스캔으로 입력한 기록입니다.</p>` : ''}
        ${D.isNew ? '<p class="help">사진과 아래 값을 한 번 비교한 뒤 저장하세요.</p>' : ''}
        <div class="actions" style="margin:8px 0 0">
          ${D.e.hasPhoto && !D.photo ? '<button type="button" class="btn sm" id="rescan">사진으로 다시 읽기</button>' : ''}
          ${D.diag ? '<button type="button" class="btn sm" id="copyDiag">인식 결과 복사 (문제 신고용)</button>' : ''}
        </div>
      </div></div></div>`;
  }

  async function savePlanned() {
    const e = D.e;
    // 예정 시각: 스케줄에서 온 STD, 없으면 입력한 OUT, 그것도 없으면 OUT 날짜
    const od = /^\d{4}-\d{2}-\d{2}$/.test(D.outDate) ? Date.UTC(+D.outDate.slice(0, 4), +D.outDate.slice(5, 7) - 1, +D.outDate.slice(8, 10)) : null;
    const t0 = resolveDraftTimes();
    const r = { schedOut: e.schedOut != null ? e.schedOut : t0.out != null ? t0.out : od, schedIn: e.schedIn != null ? e.schedIn : t0.in };
    const miss = [];
    e.flightNumber = normFlight(e.flightNumber); e.registration = normReg(e.registration);
    if (!/\d/.test(e.flightNumber)) miss.push('편명');
    if (!e.origin || !e.destination) miss.push('출발·도착');
    if (r.schedOut == null) miss.push('날짜');
    if (miss.length) return toast('예정으로 저장하려면: ' + miss.join(', '), 4000);
    const t = Object.assign({}, e, {
      planned: true, schedOut: r.schedOut, schedIn: r.schedIn, out: null, off: null, on: null, in: null,
      schedNoTime: e.schedOut == null && t0.out == null, // 날짜만 넣은 예정 비행
      flightNumber: e.flightNumber, logDate: L.dateIn(r.schedOut, S.settings.tz),
      // 앱에서 고친 스케줄 예정 비행은 다음 스케줄 가져오기 때 "취소"로 잘못 지우지 않도록 표시
      source: e.source === 'schedule' ? 'schedule-edited' : (e.source === 'scan' ? 'manual' : e.source || 'manual'),
      updatedAt: Date.now()
    });
    if (D.isNew) t.createdAt = Date.now();
    await DB.putEntry(t);
    const i = S.entries.findIndex(x => x.id === t.id);
    if (i >= 0) S.entries[i] = t; else S.entries.push(t);
    closeEditor();
    render(true);
    toast('예정 비행으로 저장했습니다.');
    markDirty();
  }

  function flightForm() {
    const e = D.e;
    const box = (cls, label, inner, right) => `<div class="m-cell${right ? ' r' : ''}${cls ? ' ' + cls : ''}"><span class="m-lab">${label}</span>${inner}</div>`;
    const txt = (f, ph, w) => `<input class="m-in" data-f="${f}" value="${esc(e[f])}" placeholder="${esc(ph)}" autocapitalize="characters" autocomplete="off" spellcheck="false"${w ? ` style="width:${w}"` : ''}>`;
    const apt = f => `<input class="m-in m-apt${flagged(f) ? ' flag' : ''}" data-apt="${f}" value="${esc(e[f] ? airports.display(e[f]) : '')}" placeholder="${f === 'origin' ? 'ICN' : 'SGN'}" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${f === 'origin' ? '출발' : '도착'}">`;
    const tm = (k, right) => box('m-t' + (flagged(k) ? ' flag' : ''), k.toUpperCase() + (k === 'out' ? ' (R/O)' : k === 'in' ? ' (R/I)' : ''),
      `<input class="m-in m-time" data-t="${k}" value="${esc(D.hhmm[k])}" inputmode="numeric" maxlength="4" placeholder="----" aria-label="${k.toUpperCase()} (UTC 4자리)"><span class="m-z">Z</span><span class="when" data-when="${k}"></span>`, right);
    const nOpt = [0, 1, 2, 3, 4, 5].map(n => `<option value="${n}"${(e.approaches || 0) === n ? ' selected' : ''}>${n}</option>`).join('');
    const tOpt = APPROACH_TYPES.map(t => `<option${(e.approachType || 'ILS').toUpperCase() === t ? ' selected' : ''}>${t}</option>`).join('');
    return `${scanSection()}
      <div class="mcdu" role="group" aria-label="OOOI 입력">
        <div class="m-title">AOC OOOI STATUS <span>UTC</span></div>
        <div class="m-grid">
          ${box(flagged('flightID') ? 'flag' : '', 'FLIGHT ID', txt('flightNumber', (S.settings.airline || '') + '731'))}
          ${box('', 'ORIG/DEST', `<span class="m-od">${apt('origin')}<b>/</b>${apt('destination')}</span><span class="m-sub"><span data-apt-name="origin"></span><span data-apt-name="destination"></span></span>`, true)}
          ${box('', 'A/C', txt('aircraftType', 'A321'))}
          ${box('', 'REG', txt('registration', (S.settings.regPrefix || '') + '8399'), true)}
          ${box('', 'DATE (OUT)', `<input class="m-in m-date" type="date" id="outDate" value="${esc(D.outDate)}">`)}
          ${box('', 'LOG DATE', `<span class="m-val" id="logDateShow"></span>`, true)}
          ${tm('out')}${tm('off', true)}
          ${tm('in')}${tm('on', true)}
          ${box('', 'BLOCK', `<span class="m-val" id="cBlock"></span>`)}
          ${box('', 'FLIGHT', `<span class="m-val" id="cFlight"></span>`, true)}
        </div>
        <div class="m-foot">
          <label class="m-key" for="scanInto">📷 화면 찍어 채우기</label>
          <span class="m-hint">시각은 4자리 UTC. 날짜는 OUT부터 자동</span>
        </div>
      </div>
      <div class="sec"><h3>T/O · L/D — 내가 한 이착륙</h3>
        <div class="role${D.role ? '' : ' need'}" id="role">${ROLES.map(r => `<button type="button" data-role="${r[0]}" aria-pressed="${D.role === r[0]}">${r[1]}</button>`).join('')}</div>
        ${D.role ? '' : '<p class="why">90일 이착륙 횟수에 들어가므로 꼭 골라 주세요.</p>'}
        <p class="help" style="margin-bottom:0">CRZ: 순항 교대 조종사 — ICAO 양식은 Co-pilot, FAA 양식은 SIC 칸에 들어갑니다. Observer: 기록만 남고 비행시간·누계에는 들어가지 않습니다.</p>
      </div>
      <div class="sec"><h3>Duty ${D.career ? `<span class="help">— 경력 단계 "${esc(D.career.title || L.FUNCTIONS[D.career.fn].label)}" 기준</span>` : ''}</h3><div class="grid">
        <div class="field"><label>Duty (이 비행에서 나의 역할)</label><select id="fnSel">${Object.entries(L.FUNCTIONS).map(([k, v]) => `<option value="${k}"${L.fnOf(e) === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        <div class="field" id="picNameBox"><label>기장 이름 (ICAO 8번 칸)</label><input data-f="picName" value="${esc(e.picName)}" placeholder="HONG GILDONG" autocomplete="off" list="crewNames"></div>
        <div class="field"><label>함께 탄 조종사 (여럿이면 쉼표)</label><input data-f="copilotName" value="${esc(e.copilotName)}" placeholder="KIM CHULSOO" autocomplete="off" list="crewNames"></div>
        <datalist id="crewNames">${L.crewIndex(S.entries).slice(0, 200).map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
        <div class="field"><label>추가 역할</label>
          <label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" data-chk="instructing" ${L.instructingOf(e) ? 'checked' : ''} style="width:auto;min-height:0"> 교관 비행 (IP)</label>
          <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-chk="examining" ${e.examining ? 'checked' : ''} style="width:auto;min-height:0"> 심사 비행 (평가관)</label></div>
      </div></div>
      <div class="sec"><h3>계기 접근</h3><div class="grid">
        <div class="field"><label for="apCount">접근 횟수</label><select id="apCount">${nOpt}</select></div>
        <div class="field"><label for="apType">접근 종류</label><select id="apType">${tOpt}</select></div>
        <div class="field"><label>체공</label><label style="display:inline-flex;gap:6px;align-items:center;min-height:42px"><input type="checkbox" data-chk="holding" ${e.holding ? 'checked' : ''} style="width:auto;min-height:0"> 체공(Holding) 함</label></div>
      </div><p class="help" style="margin-bottom:0">VISUAL은 계기 접근이 아니라서 FAA 계기 6개월 요건과 계기 접근 누계에 세지 않습니다.</p></div>
      <div class="sec"><h3>시간</h3><div class="calc">
        <div class="field"><label>야간 (N/T) <button type="button" class="btn sm" id="nightAuto" hidden>자동</button></label><input id="nightIn" class="mono" inputmode="numeric"></div>
        <div class="field"><label>실계기 (I/T) <button type="button" class="btn sm" id="instAuto" hidden>자동</button></label><input id="instIn" class="mono" inputmode="numeric"></div>
        <div class="field"><label>IFR <button type="button" class="btn sm" id="ifrAuto" hidden>자동</button></label><input id="ifrIn" class="mono" inputmode="numeric"></div>
      </div><p class="help" id="calcHelp"></p></div>
      <div class="sec"><h3>IRR · 비고</h3><div class="grid">
        <div class="field"><label>IRR</label><input data-f="irregular" value="${esc(e.irregular)}" autocapitalize="characters" autocomplete="off"></div>
      </div><textarea data-f="remarks" rows="2" style="margin-top:8px" placeholder="비고">${esc(e.remarks)}</textarea></div>
      <div class="actions">
        ${D.fromPlan || D.isNew ? '<button type="button" class="btn" id="savePlan">예정으로 저장 (비행 전)</button>' : ''}
        ${D.isNew ? '' : `<button class="btn danger" id="edDelete">${e.planned ? '이 예정 비행 삭제' : '이 기록 삭제'}</button>`}
      </div>`;
  }

  function simForm() {
    const e = D.e;
    const num = (f, label) => `<div class="field"><label>${label}</label><input data-n="${f}" type="number" min="0" max="50" value="${e[f]}" inputmode="numeric"></div>`;
    return `<div class="sec"><h3>시뮬레이터</h3><div class="grid">
        <div class="field"><label>날짜</label><input type="date" data-f="logDate" value="${esc(e.logDate)}"></div>
        <div class="field"><label>기종</label><input data-f="aircraftType" value="${esc(e.aircraftType)}" autocapitalize="characters"></div>
        <div class="field"><label>장치 종류</label><select data-f="fstdType">${['FFS', 'FTD', 'FNPT', 'ATD', '기타'].map(v => `<option${(e.fstdType || 'FFS') === v ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>과목</label><input data-f="flightNumber" value="${esc(e.flightNumber)}" placeholder="Recurrent 등"></div>
        <div class="field"><label>시간</label><input id="simTime" class="mono" inputmode="numeric" value="${L.hmm(e.block)}"></div>
      </div></div>
      <div class="sec"><h3>이착륙 · 접근</h3><div class="grid">${num('takeoffs', '이륙')}${num('landings', '착륙')}${num('nightTakeoffs', '그중 야간 이륙')}${num('nightLandings', '그중 야간 착륙')}${num('approaches', '계기 접근')}
        <div class="field"><label>체공</label><label style="display:inline-flex;gap:6px;align-items:center;min-height:42px"><input type="checkbox" data-chk="holding" ${e.holding ? 'checked' : ''} style="width:auto;min-height:0"> 체공 함</label></div></div></div>
      <div class="sec"><h3>비고</h3><textarea data-f="remarks" rows="2">${esc(e.remarks)}</textarea></div>
      ${D.isNew ? '' : '<div class="actions"><button class="btn danger" id="edDelete">이 기록 삭제</button></div>'}`;
  }

  function bindEditor() {
    const body = $('edBody'), e = D.e;
    body.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => {
      const f = el.dataset.f;
      e[f] = ['flightNumber', 'aircraftType', 'registration', 'irregular'].includes(f) && !e.isSimulator ? el.value.toUpperCase().trim() : el.value;
      if (f === 'aircraftType') D.typeTouched = true;
      if (f === 'flightNumber' || f === 'logDate') refreshComputed();
    }));
    body.querySelectorAll('[data-n]').forEach(el => el.addEventListener('input', () => { e[el.dataset.n] = Math.max(0, parseInt(el.value, 10) || 0); }));
    body.querySelectorAll('[data-apt]').forEach(el => el.addEventListener('change', () => {
      const code = el.value.trim().toUpperCase(), a = airports.get(code);
      e[el.dataset.apt] = a ? a.icao : code;
      el.value = a ? (a.iata || a.icao) : code;
      recalcDraft(); refreshComputed();
    }));
    body.querySelectorAll('[data-t]').forEach(el => el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '').slice(0, 4);
      D.hhmm[el.dataset.t] = el.value;
      recalcDraft(); refreshComputed();
      if (el.value.length === 4) { // 다음 칸으로
        const order = ['out', 'off', 'on', 'in'], i = order.indexOf(el.dataset.t);
        if (i < 3) body.querySelector(`[data-t="${order[i + 1]}"]`).focus();
      }
    }));
    if ($('apCount')) $('apCount').addEventListener('change', ev => { e.approaches = +ev.target.value; });
    if ($('apType')) $('apType').addEventListener('change', ev => { e.approachType = ev.target.value; });
    if ($('savePlan')) $('savePlan').addEventListener('click', () => savePlanned().catch(err => toast('저장 실패: ' + err.message, 6000)));
    const fnSel = $('fnSel');
    if (fnSel) fnSel.addEventListener('change', () => {
      e.fn = fnSel.value; D.fnTouched = true;
      const auto = e.fn === 'RELIEF' ? 'crz' : e.fn === 'OBS' ? 'obs' : (['crz', 'obs'].includes(D.role) ? null : D.role);
      if (auto !== D.role) { D.role = auto; body.querySelectorAll('[data-role]').forEach(x => x.setAttribute('aria-pressed', x.dataset.role === auto)); }
      recalcDraft(); refreshComputed();
    });
    body.querySelectorAll('[data-chk]').forEach(el => el.addEventListener('change', () => { e[el.dataset.chk] = el.checked; recalcDraft(); refreshComputed(); }));
    const od = $('outDate');
    if (od) od.addEventListener('change', () => { D.outDate = od.value; recalcDraft(); refreshComputed(); });
    body.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => {
      D.role = b.dataset.role;
      const r = ROLES.find(x => x[0] === D.role);
      if (r[4]) e.fn = r[4]; // CRZ → 순항 교대, Observer → 옵저버
      else if (['RELIEF', 'OBS'].includes(L.fnOf(e))) { const c = L.careerAt(S.settings.careers, e.logDate || todayIn(S.settings.tz)); e.fn = c ? c.fn : 'PIC'; }
      D.fnTouched = true;
      if ($('fnSel')) $('fnSel').value = L.fnOf(e);
      body.querySelectorAll('[data-role]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('role').classList.remove('need');
      const why = body.querySelector('.why'); if (why) why.remove();
      recalcDraft(); refreshComputed();
    }));
    const durField = (id, key, manualKey, autoBtn) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const v = L.parseHMM(el.value);
        if (v == null) { el.value = L.hmm(e[key]); return; }
        e[key] = v; e[manualKey] = true; refreshComputed();
      });
      $(autoBtn).addEventListener('click', () => { e[manualKey] = false; recalcDraft(); refreshComputed(); });
    };
    durField('nightIn', 'night', 'nightManual', 'nightAuto');
    durField('instIn', 'instrument', 'instrumentManual', 'instAuto');
    durField('ifrIn', 'ifr', 'ifrManual', 'ifrAuto');
    const simTime = $('simTime');
    if (simTime) simTime.addEventListener('change', () => { const v = L.parseHMM(simTime.value); if (v != null) e.block = v; simTime.value = L.hmm(e.block); });
    const del = $('edDelete');
    if (del) del.addEventListener('click', deleteDraft);
    if ($('rescan')) $('rescan').addEventListener('click', rescanSaved);
    if ($('copyDiag')) $('copyDiag').addEventListener('click', copyDiag);
    const ph = $('edPhoto');
    if (ph) ph.addEventListener('click', () => { $('photoBig').src = D.photoUrl; $('photoDlg').showModal(); });
  }

  function refreshComputed() {
    const e = D.e;
    if (!e.isSimulator) {
      for (const k of ['out', 'off', 'on', 'in']) {
        const w = document.querySelector(`[data-when="${k}"]`);
        if (w) w.textContent = e[k] != null ? whenText(e[k]) : '';
      }
      $('logDateShow').textContent = e.logDate ? e.logDate.replace(/-/g, '/') : '—';
      $('cBlock').textContent = e.out != null && e.in != null ? L.hmm(e.block) : '—';
      $('cFlight').textContent = e.off != null && e.on != null ? L.hmm(e.flight) : '—';
      const ni = $('nightIn'), ii = $('instIn'), fi = $('ifrIn');
      if (document.activeElement !== ni) ni.value = L.hmm(e.night);
      if (document.activeElement !== ii) ii.value = L.hmm(e.instrument);
      if (document.activeElement !== fi) fi.value = L.hmm(e.ifr != null ? e.ifr : e.block);
      $('ifrAuto').hidden = !e.ifrManual;
      $('picNameBox').hidden = L.fnOf(e) === 'PIC' || L.fnOf(e) === 'OBS';
      for (const f of ['aircraftType', 'registration']) {
        const el = document.querySelector(`[data-f="${f}"]`);
        if (el && document.activeElement !== el && el.value !== (e[f] || '')) el.value = e[f] || '';
      }
      if ($('fnSel').value !== L.fnOf(e)) $('fnSel').value = L.fnOf(e);
      $('nightAuto').hidden = !e.nightManual;
      $('instAuto').hidden = !e.instrumentManual;
      for (const f of ['origin', 'destination']) {
        const n = document.querySelector(`[data-apt-name="${f}"]`), a = airports.get(e[f]);
        if (n) n.textContent = a ? (f === 'origin' ? a.icao + '/' : a.icao) : (e[f] ? '목록에 없음' : '');
      }
      const miss = missingFields(), probs = timeProblems();
      const o = airports.get(e.origin), d = airports.get(e.destination);
      document.querySelectorAll('.mcdu .m-t').forEach(x => x.classList.toggle('bad', probs.length > 0));
      $('calcHelp').textContent = miss.length ? '저장하려면: ' + miss.join(', ')
        : probs.length ? '⚠ 시각을 확인하세요: ' + probs.join(' · ')
        : (!o || !d) ? '공항 좌표가 없어 야간 시간을 계산하지 못했습니다. 설정 › 공항에서 추가하거나 직접 입력하세요.'
          : `야간은 ${S.settings.night === 'sunset' ? '일몰~일출' : '시민박명(−6°)'} 기준으로 항로를 따라 1분 단위로 계산합니다. 직접 고치면 그 값이 유지됩니다.`;
      $('calcHelp').style.color = probs.length ? 'var(--bad)' : miss.length ? 'var(--warn)' : '';
    }
    $('edSave').disabled = missingFields().length > 0;
  }

  async function saveDraft() {
    recalcDraft();
    if (missingFields().length) return;
    const e = D.e, now = Date.now();
    const probs = timeProblems();
    if (probs.length && !confirm('시각이 이상합니다:\n\n• ' + probs.join('\n• ') + '\n\n그래도 저장할까요?')) return;
    if (!e.isSimulator) { e.flightNumber = normFlight(e.flightNumber); e.registration = normReg(e.registration); }
    let target = e;
    if (D.isNew && !e.isSimulator) {
      const dup = live().find(x => x.id !== e.id && !x.isSimulator && x.logDate === e.logDate && x.flightNumber === e.flightNumber);
      if (dup && confirm(`${e.logDate} ${e.flightNumber} 기록이 이미 있습니다.\n\n[확인] 기존 기록을 이 내용으로 업데이트\n[취소] 새 기록으로 따로 추가`)) {
        target = Object.assign({}, e, { id: dup.id, createdAt: dup.createdAt, registration: e.registration || dup.registration, hasPhoto: dup.hasPhoto });
      }
    }
    target.updatedAt = now;
    target.planned = false;
    if (D.photo) {
      await DB.putPhoto(target.id, D.photo).catch(() => {});
      target.hasPhoto = true;
    }
    await DB.putEntry(target);
    const i = S.entries.findIndex(x => x.id === target.id);
    if (i >= 0) S.entries[i] = target; else S.entries.push(target);
    closeEditor();
    render();
    toast(D && (D.isNew || D.fromPlan) ? '저장했습니다.' : '고쳤습니다.');
    markDirty();
  }

  async function deleteDraft() {
    if (!confirm('이 기록을 삭제할까요?')) return;
    const e = Object.assign({}, D.e, { deleted: true, updatedAt: Date.now() }); // 다른 기기에도 삭제가 전달되도록 표시만 남김
    await DB.putEntry(e);
    await DB.deletePhoto(e.id).catch(() => {});
    const i = S.entries.findIndex(x => x.id === e.id);
    if (i >= 0) S.entries[i] = e;
    closeEditor();
    render();
    toast('삭제했습니다.');
    markDirty();
  }

  function closeEditor() {
    const dlg = $('ed');
    if (dlg.open) dlg.close();
  }
  $('ed').addEventListener('close', () => { if (D && D.photoUrl) URL.revokeObjectURL(D.photoUrl); });
  $('edCancel').addEventListener('click', () => {
    if (D && D.isNew && D.notes.length && !confirm('스캔한 내용을 저장하지 않고 닫을까요?')) return;
    closeEditor();
  });
  $('edSave').addEventListener('click', () => saveDraft().catch(err => toast('저장 실패: ' + err.message, 6000)));
  $('photoClose').addEventListener('click', () => $('photoDlg').close());
  $('addManual').addEventListener('click', () => { D = newFlightDraft(); openEditor(); });
  $('addSim').addEventListener('click', () => {
    const c = L.careerAt(S.settings.careers, todayIn(S.settings.tz));
    D = draftFrom(L.newEntry({ isSimulator: true, aircraftType: (c && c.aircraftType) || S.settings.defaultType, logDate: todayIn(S.settings.tz), fstdType: 'FFS', fn: c ? c.fn : 'PIC' }), { isNew: true, role: 'pm' });
    openEditor();
  });

  /* ===================== 스캔 ===================== */

  async function shrinkPhoto(file) {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      URL.revokeObjectURL(url);
      const s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.72));
    } catch (e) { return null; }
  }

  /** 사진 → 화면 값 → 편집 초안에 반영. captured: 촬영 시각(ms) 또는 null */
  async function runScan(blob, captured, reliable) {
    const res = await OCR.scan(blob, { airports, onStep: t => busy(true, t) });
    const r = res.reading;
    if (!r.isOOOIPage && r.out == null) return null;
    const ref = L.referenceTime(r, captured || Date.now(), !!reliable);
    const t = L.resolveTimes(r, ref);
    if (D.fromPlan) {
      // 스케줄에서 온 편명·구간을 믿고, 화면과 다르면 알려 줌
      const diff = [];
      if (r.flightID && r.flightID !== D.e.flightNumber) diff.push(`편명 ${r.flightID}`);
      if (r.origin && r.origin !== D.e.origin) diff.push(`출발 ${r.origin}`);
      if (r.destination && r.destination !== D.e.destination) diff.push(`도착 ${r.destination}`);
      Object.assign(D.e, { out: t.out, off: t.off, on: t.on, in: t.in, source: 'schedule+scan', scanRaw: r.raw });
      if (diff.length) r.notes.push({ field: 'flightID', kind: 'mismatch', message: `화면 값(${diff.join(', ')})이 스케줄과 다릅니다. 스케줄 값을 유지했습니다.` });
    } else {
      Object.assign(D.e, { flightNumber: r.flightID || D.e.flightNumber || '', origin: r.origin || D.e.origin || '', destination: r.destination || D.e.destination || '',
        out: t.out, off: t.off, on: t.on, in: t.in, source: 'scan', scanRaw: r.raw });
    }
    D.outDate = t.out != null ? utcDate(t.out) : D.outDate;
    D.hhmm = { out: t.out != null ? L.zulu(t.out) : '', off: t.off != null ? L.zulu(t.off) : '', on: t.on != null ? L.zulu(t.on) : '', in: t.in != null ? L.zulu(t.in) : '' };
    D.notes = r.notes;
    D.screen = { block: r.block, flight: r.flight };
    D.diag = { app: window.LOGBOOK_VERSION, ua: navigator.userAgent, passes: res.passes, confident: r.confident, raw: r.raw, notes: r.notes.map(n => n.kind + ': ' + n.message), sets: res.sets };
    recalcDraft();
    return r;
  }

  $('scanFile').addEventListener('change', async ev => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    busy(true, '사진 준비 중…');
    try {
      const exif = await OCR.captureTime(file);
      const fresh = Math.abs(Date.now() - (file.lastModified || 0)) < 10 * 60000;
      const captured = exif || (fresh ? file.lastModified : null);
      D = newFlightDraft();
      const r = await runScan(file, captured, !!captured);
      if (!r) {
        busy(false);
        toast('AOC OOOI STATUS 화면을 찾지 못했습니다. 화면이 잘 보이게 다시 찍어 주세요.', 6000);
        return;
      }
      // 스케줄에서 가져온 예정 비행이 있으면 거기에 시각을 채움 (역할·기장 이름·승무원 유지)
      const plan = LS.matchPlanned(S.entries, D.e.flightNumber, D.e.out);
      if (plan) {
        const scanned = D;
        D = planDraft(plan);
        Object.assign(D, { notes: scanned.notes, screen: scanned.screen, diag: scanned.diag, outDate: scanned.outDate, hhmm: scanned.hhmm });
        Object.assign(D.e, { source: 'schedule+scan', scanRaw: scanned.e.scanRaw });
        if (scanned.e.flightNumber && scanned.e.flightNumber !== plan.flightNumber) D.notes.push({ field: 'flightID', kind: 'mismatch', message: `화면 편명 ${scanned.e.flightNumber} → 스케줄의 ${plan.flightNumber} 예정 비행에 넣었습니다. 맞는지 확인하세요.` });
        recalcDraft();
        toast(`${plan.logDate.slice(5).replace('-', '/')} ${plan.flightNumber} 예정 비행에 연결했습니다.`, 4000);
      }
      D.photo = await shrinkPhoto(file);
      if (D.photo) D.photoUrl = URL.createObjectURL(D.photo);
      busy(false);
      openEditor();
    } catch (err) {
      busy(false);
      toast('글자 인식 실패: ' + (err && err.message || err), 7000);
    }
  });

  $('scanInto').addEventListener('change', async ev => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file || !D) return;
    busy(true, '사진 준비 중…');
    try {
      const exif = await OCR.captureTime(file);
      const fresh = Math.abs(Date.now() - (file.lastModified || 0)) < 10 * 60000;
      const captured = exif || (fresh ? file.lastModified : null) || (D.e.schedIn != null ? D.e.schedIn + 3600e3 : null);
      const r = await runScan(file, captured, true);
      if (!r) { busy(false); return toast('OOOI 화면을 찾지 못했습니다. 다시 찍어 주세요.', 5000); }
      D.photo = await shrinkPhoto(file);
      if (D.photo) D.photoUrl = URL.createObjectURL(D.photo);
      busy(false);
      openEditor();
    } catch (err) {
      busy(false);
      toast('글자 인식 실패: ' + (err && err.message || err), 7000);
    }
  });

  /** 저장된 사진으로 다시 읽기 (기존 기록 고칠 때) */
  async function rescanSaved() {
    try {
      const blob = await DB.getPhoto(D.e.id);
      if (!blob) return toast('이 기록에는 사진이 없습니다.');
      busy(true, '다시 읽는 중…');
      const anchor = D.e.in != null ? D.e.in + 3 * 3600e3 : Date.now();
      const r = await runScan(blob, anchor, true);
      busy(false);
      if (!r) return toast('OOOI 화면을 찾지 못했습니다.');
      openEditor();
      toast('다시 읽었습니다. 값을 확인하고 저장하세요.');
    } catch (err) {
      busy(false);
      toast('다시 읽기 실패: ' + err.message, 6000);
    }
  }

  async function copyDiag() {
    const text = JSON.stringify(D.diag);
    try { await navigator.clipboard.writeText(text); toast('인식 결과를 복사했습니다. 대화창에 붙여 넣어 보내 주세요.', 5000); }
    catch (e) { downloadFile(text, 'ocr-result.json', 'application/json'); toast('인식 결과 파일을 내려받았습니다.'); }
  }

  /* ===================== 월간 스케줄 가져오기 ===================== */

  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = () => rej(new Error(src + '를 불러오지 못했습니다.'));
      document.head.appendChild(el);
    });
  }

  $('skdFile').addEventListener('change', async ev => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    busy(true, '스케줄 읽는 중…');
    try {
      if (!window.XLSX) await loadScript('vendor/xlsx/xlsx.full.min.js');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const r = LS.importRoster(rows, { airports, existing: S.entries, careers: S.settings.careers, tz: S.settings.tz,
        schedTz: S.settings.schedTz, defaultType: S.settings.defaultType, aircraft: S.settings.aircraft });
      const D0 = { emp: r.emp, me: r.me, month: r.month || '' };
      busy(false);
      const pf = S.settings.profile || {};
      if (pf.empNo && D0.emp && pf.empNo !== D0.emp && !confirm(`스케줄의 사번(${D0.emp})이 조종사 정보의 사번(${pf.empNo})과 다릅니다. 그래도 가져올까요?`)) return;
      const unsure = r.add.filter(e => !e.roleSure).length;
      const ym = D0.month ? `${D0.month.slice(0, 4)}년 ${+D0.month.slice(4)}월` : '';
      const fmtName = r.format === 'cwp' ? 'Crew Roster' : 'MONTHLY SKD';
      if (!r.add.length && !r.updated.length) {
        if (r.cancelled.length) { await askCancelled(r.cancelled); return; }
        return toast(`${ym} ${fmtName}: 새로 넣을 비행이 없습니다 (이미 있음 ${r.skipped}건).`, 5000);
      }
      const codes = [...new Set(r.add.map(e => e.acCode).filter(c => c && !L.AIRCRAFT_ALIASES[c] && !(S.settings.aircraft || []).some(t => t.code === c)))];
      const msg = `${ym} 스케줄 · ${fmtName} (${D0.me || D0.emp})\n\n• 새 예정 비행 ${r.add.length}건\n• 시각이 바뀐 예정 비행 ${r.updated.length}건\n• 이미 있음 ${r.skipped}건` +
        (r.other && r.other.length ? `\n• 비행이 아닌 일정 ${r.other.length}건은 건너뜀 (${r.other.slice(0, 4).join(', ')}${r.other.length > 4 ? ' …' : ''})` : '') +
        (r.format === 'cwp' ? '\n\nSTD·STA는 각 공항 현지 시각으로 읽었습니다.' : '') +
        (unsure ? `\n\n역할을 확실히 못 읽어 추정한 비행 ${unsure}건은 "역할 확인"으로 표시됩니다.` : '') +
        (codes.length ? `\n\n회사 기종 코드 ${codes.join(', ')}는 경력 단계의 기종으로 넣습니다. 코드별로 기종을 정하려면 설정 › 기종에 그 코드를 추가하세요.` : '') + '\n\n넣을까요?';
      if (!confirm(msg)) return;
      const list = r.add.concat(r.updated);
      await DB.putEntries(list);
      for (const e of list) { const i = S.entries.findIndex(x => x.id === e.id); if (i >= 0) S.entries[i] = e; else S.entries.push(e); }
      if (!pf.empNo && D0.emp) await saveSettings({ profile: Object.assign({}, pf, { empNo: D0.emp, name: pf.name || D0.me }) });
      LV.tab = 'up'; saveLV(); // 가져온 예정 비행이 바로 보이게
      render(true);
      toast(`예정 비행 ${r.add.length}건을 넣었습니다. 비행 후 눌러서 시각만 넣으면 됩니다.`, 5000);
      markDirty();
      if (r.cancelled.length) await askCancelled(r.cancelled);
    } catch (err) {
      busy(false);
      toast('스케줄을 읽지 못했습니다: ' + err.message, 7000);
    }
  });

  /** 새 스케줄에 없는 예정 비행 → 취소로 보고 지울지 묻기 */
  async function askCancelled(list) {
    const lines = list.slice(0, 10).map(e => `• ${e.logDate.slice(5).replace('-', '/')} ${e.flightNumber} ${airports.display(e.origin)}→${airports.display(e.destination)}`).join('\n');
    if (!confirm(`새 스케줄에 없는 예정 비행이 ${list.length}건 있습니다 (취소되거나 바뀐 것으로 보입니다).\n\n${lines}${list.length > 10 ? '\n…' : ''}\n\n지울까요?\n(앱에서 직접 고치거나 추가한 예정 비행은 그대로 둡니다)`)) return;
    const now = Date.now(), gone = list.map(e => Object.assign({}, e, { deleted: true, updatedAt: now }));
    await DB.putEntries(gone);
    gone.forEach(g => { const i = S.entries.findIndex(x => x.id === g.id); if (i >= 0) S.entries[i] = g; });
    render(true);
    toast(`취소된 예정 비행 ${gone.length}건을 지웠습니다.`);
    markDirty();
  }

  /* ===================== 백업·불러오기 ===================== */

  function backupText() {
    const b = L.makeBackup(S.entries, S.settings.carry);
    b.settings = S.settings;
    return JSON.stringify(b, null, 1);
  }

  function downloadFile(text, name, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- iCloud Drive 파일 (무료, 수동) ---------- */

  const IDRIVE_FILE = 'pilot-logbook.json';
  const idriveChanges = () => (S.sync.idriveSavedAt ? S.entries.filter(e => (e.updatedAt || 0) > S.sync.idriveSavedAt).length +
    ((S.settings.updatedAt || 0) > S.sync.idriveSavedAt ? 1 : 0) : null);

  /** ① iCloud Drive의 로그북 파일을 골라 이 기기 기록과 합침 */
  async function loadFromIcloudDrive(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      const m = await applyRemote(L.readBackup(await f.text()));
      S.sync = Object.assign({}, S.sync, { idriveLoadedAt: Date.now() });
      await DB.set('sync', S.sync);
      render(true);
      toast(`iCloud Drive 파일과 합쳤습니다 (추가 ${m.added}건, 갱신 ${m.updated}건). 이제 ② iCloud Drive에 저장을 눌러 파일을 덮어쓰세요.`, 7000);
      const b = $('idSave'); if (b) { b.scrollIntoView({ block: 'center' }); b.focus(); }
    } catch (err) {
      toast('불러오기 실패: ' + err.message, 6000);
    }
  }

  /** ② 합친 결과를 같은 이름의 파일로 공유 → "파일에 저장" → iCloud Drive에서 대치 */
  async function saveToIcloudDrive() {
    const text = backupText();
    const file = new File([text], IDRIVE_FILE, { type: 'application/json' });
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '조종사 로그북' }); shared = true; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (!shared) downloadFile(text, IDRIVE_FILE, 'application/json');
    S.sync = Object.assign({}, S.sync, { idriveSavedAt: Date.now() });
    await DB.set('sync', S.sync);
    renderSync();
    if (S.view === 'set') refreshSyncStatus();
    toast(shared ? '"파일에 저장" → iCloud Drive에서 같은 파일을 대치하면 끝입니다.' : '파일을 내려받았습니다. 파일 앱에서 iCloud Drive의 같은 파일에 덮어쓰세요.', 6000);
  }

  async function shareBackup() {
    const name = `logbook-backup-${todayIn(S.settings.tz)}.json`;
    const file = new File([backupText()], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '로그북 백업' }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    downloadFile(backupText(), name, 'application/json');
    toast('백업 파일을 내려받았습니다. 파일 앱에서 iCloud Drive로 옮겨 두세요.');
  }

  async function applyRemote(backup, label) {
    const m = L.mergeEntries(S.entries, backup.entries || []);
    const before = new Map(S.entries.map(e => [e.id, e.updatedAt]));
    const changed = m.merged.filter(e => before.get(e.id) !== e.updatedAt);
    // 사진 표시는 기기마다 다르므로 이 기기 값 유지
    const photos = new Set((await DB.photoKeys().catch(() => [])) || []);
    changed.forEach(e => { e.hasPhoto = photos.has(e.id); });
    if (changed.length) await DB.putEntries(changed);
    S.entries = m.merged;
    S.entries.forEach(e => { if (photos.has(e.id)) e.hasPhoto = true; });
    const rs = backup.settings;
    m.changed = changed.length;
    if (rs && (rs.updatedAt || 0) > (S.settings.updatedAt || 0)) {
      m.changed++;
      S.settings = Object.assign({}, DEFAULT_SETTINGS, rs);
      airports = L.airportDB(S.settings.airports);
      await DB.set('settings', S.settings);
    } else if (!rs && backup.carryForward && !(S.settings.carry && S.settings.carry.total)) {
      S.settings.carry = Object.assign({}, DEFAULT_SETTINGS.carry, backup.carryForward);
      await DB.set('settings', S.settings);
    }
    if (label) toast(`${label}: 추가 ${m.added}건, 갱신 ${m.updated}건`, 5000);
    return m;
  }

  $('importFile').addEventListener('change', async ev => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      await applyRemote(L.readBackup(await f.text()), '불러오기');
      render();
      markDirty();
    } catch (err) {
      toast('불러오기 실패: ' + err.message, 6000);
    }
  });

  /* ===================== 구글 드라이브 동기화 ===================== */

  const linked = () => [DRIVE.signedIn() && 'google', ICLOUD.signedIn() && 'icloud'].filter(Boolean);
  const anyLinked = () => linked().length > 0;
  const TARGET_NAME = { google: '구글', icloud: 'iCloud' };
  /** "구글과" / "iCloud와" / "구글·iCloud와" — 마지막 이름에 맞는 조사 */
  const withJosa = on => on.map(t => TARGET_NAME[t]).join('·') + (on[on.length - 1] === 'google' ? '과' : '와');

  function renderSync() {
    const dot = $('syncDot'), text = $('syncText'), btn = $('syncBtn');
    const pending = !S.sync.lastSync || S.entries.some(e => (e.updatedAt || 0) > S.sync.lastSync) || (S.settings.updatedAt || 0) > S.sync.lastSync;
    const on = linked(), names = on.map(t => TARGET_NAME[t]).join('·');
    dot.className = 'dot';
    if (S.syncing) { text.textContent = '동기화 중…'; btn.hidden = true; return; }
    btn.hidden = false;
    if (!navigator.onLine) { dot.classList.add('warn'); text.textContent = pending ? '오프라인 · 이 기기에 저장됨' : '오프라인'; btn.hidden = true; }
    else if (!on.length && S.sync.idriveSavedAt != null) {
      const n = idriveChanges();
      dot.classList.add(n ? 'warn' : 'ok');
      text.textContent = n ? `iCloud 파일에 저장 필요 (${n}건)` : 'iCloud 파일과 맞춤';
      btn.textContent = 'iCloud 파일 맞추기';
    } else if (!on.length) {
      const was = S.sync.fileId || S.sync.icloud;
      if (was) dot.classList.add('warn');
      text.textContent = was ? '동기화 연결 끊김' : '이 기기에만 저장됨';
      btn.textContent = S.sync.fileId && !ICLOUD.configured() ? '다시 연결' : '동기화 연결';
    } else if (S.sync.error) { dot.classList.add('bad'); text.textContent = '동기화 일부 실패'; btn.textContent = '다시 시도'; }
    else {
      dot.classList.add(pending ? 'warn' : 'ok');
      text.textContent = pending ? `${names} 동기화 대기` : `${withJosa(on)} 맞춤 ` + (S.sync.lastSync ? new Date(S.sync.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');
      btn.textContent = '지금 동기화';
    }
  }

  let syncTimer = 0;
  function markDirty() {
    renderSync();
    clearTimeout(syncTimer);
    if (anyLinked() && navigator.onLine) syncTimer = setTimeout(() => sync(false), 1500);
  }

  /**
   * 연결된 모든 곳(구글 드라이브, iCloud)에서 받아 이 기기 기록과 합친 뒤, 합친 결과를 모두에 올림.
   * 폰이 구글·iCloud 둘 다, 회사 iPad가 iCloud만 연결돼 있어도 결국 모두 같아짐.
   * connectGoogle: 구글 로그인 창을 띄움 (버튼을 눌렀을 때만)
   */
  async function sync(interactive, connectGoogle) {
    if (S.syncing) return;
    let changed = false;
    if (!navigator.onLine) { renderSync(); if (interactive) toast('오프라인입니다. 기록은 이 기기에 저장되어 있고, 인터넷이 되면 동기화합니다.'); return; }
    const errors = [];
    try {
      if (connectGoogle && !DRIVE.signedIn()) {
        await DRIVE.signIn();
        try { localStorage.setItem('logbook.driveConnected', '1'); } catch (e) { /* 무시 */ }
      }
      const on = linked();
      if (!on.length) { renderSync(); return; }
      S.syncing = true; renderSync();
      const merge = async text => { const m = await applyRemote(L.readBackup(text)); if (m.changed) changed = true; };

      // 1) 받아서 합치기
      let gId = null, ckTag = null;
      const ok = {};
      if (on.includes('google')) {
        try { gId = await DRIVE.findFile(S.sync.fileId); if (gId) await merge(await DRIVE.download(gId)); ok.google = true; }
        catch (e) { errors.push('구글: ' + e.message); }
      }
      if (on.includes('icloud')) {
        try { const d = await ICLOUD.download(); if (d) { await merge(d.text); ckTag = d.tag; } ok.icloud = true; }
        catch (e) { errors.push('iCloud: ' + e.message); }
      }
      // 2) 합친 결과 올리기
      if (ok.google) {
        try { S.sync.fileId = await DRIVE.upload(gId, backupText()); } catch (e) { errors.push('구글: ' + e.message); }
      }
      if (ok.icloud) {
        try {
          try { await ICLOUD.upload(backupText(), ckTag); }
          catch (e) {
            if (!/CONFLICT|OPLOCK/i.test(e.code || e.message)) throw e;
            const d = await ICLOUD.download(); // 그 사이 다른 기기가 올렸음 → 다시 합치고 올림
            if (d) await merge(d.text);
            await ICLOUD.upload(backupText(), d && d.tag);
          }
          S.sync.icloud = true;
        } catch (e) { errors.push('iCloud: ' + e.message); }
      }
      S.sync = Object.assign({}, S.sync, { lastSync: errors.length ? S.sync.lastSync : Date.now(), error: errors.join(' / ') });
      await DB.set('sync', S.sync);
      if (errors.length) toast('동기화 실패 — ' + errors.join(' / '), 8000);
      else if (interactive) toast(withJosa(on) + ' 맞췄습니다.');
    } catch (err) {
      S.sync.error = err.message;
      if (interactive || !err.needLogin) toast('동기화 실패: ' + err.message, 7000);
    } finally {
      S.syncing = false;
      // 받은 변경이 있을 때만 화면을 다시 그림 (입력 중인 칸이 끊기지 않게)
      if (changed) render(); else { renderSync(); if (S.view === 'set') refreshSyncStatus(); }
    }
  }

  $('syncBtn').addEventListener('click', () => {
    if (anyLinked()) return sync(true);
    if (S.sync.fileId && !ICLOUD.configured()) return sync(true, true); // 구글만 쓰던 경우: 바로 다시 연결
    show('set');
    setTimeout(() => { const el = $('syncSec'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  });
  window.addEventListener('online', () => { renderSync(); if (anyLinked()) sync(false); else startICloud(); });
  window.addEventListener('offline', renderSync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && anyLinked()) sync(false); });
  setInterval(() => { if (anyLinked() && navigator.onLine && document.visibilityState === 'visible') sync(false); }, 10 * 60000);

  /* ---------- iCloud ---------- */

  function startICloud() {
    if (!ICLOUD.configured() || !navigator.onLine) return Promise.resolve(null);
    return ICLOUD.setUp().catch(err => { S.icloudError = err.message; if (S.view === 'set') refreshSyncStatus(); return null; });
  }
  ICLOUD.onChange(signed => {
    S.icloudError = '';
    renderSync();
    if (S.view === 'set') refreshSyncStatus();
    if (signed) sync(false);
  });

  /** 설정 화면의 동기화 상태 글자만 바꿈 (입력 중인 칸이 끊기지 않게 전체를 다시 그리지 않음) */
  function refreshSyncStatus() {
    const g = $('gStatus'), c = $('ckStatus'), gb = $('setSync');
    if (g) g.textContent = DRIVE.signedIn() ? '연결됨' : (S.sync.fileId ? '연결 끊김 (1시간마다 다시 연결 필요)' : '연결 안 됨');
    if (gb) gb.textContent = DRIVE.signedIn() ? '지금 동기화' : '구글 드라이브 연결';
    if (c) c.textContent = !ICLOUD.configured() ? '설정 필요' : S.icloudError ? '오류: ' + S.icloudError : ICLOUD.signedIn() ? '연결됨 (로그인 유지)' : '아래 Apple 버튼으로 로그인하세요';
    const id = $('idStatus');
    if (id) {
      const n = idriveChanges();
      id.textContent = S.sync.idriveSavedAt == null ? '아직 저장 안 함' :
        `마지막 저장 ${new Date(S.sync.idriveSavedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` + (n ? ` · 그 뒤 바뀐 기록 ${n}건` : ' · 최신');
    }
    const ls = $('lastSyncText');
    if (ls) ls.textContent = S.sync.lastSync ? new Date(S.sync.lastSync).toLocaleString('ko-KR') : '아직 안 함';
  }

  /* ===================== 시작 ===================== */

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEvt = ev; const b = $('installNow'); if (b) b.hidden = false; });

  function installHint() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('installText').innerHTML = ios
      ? 'Safari 공유 버튼 → <b>홈 화면에 추가</b>로 설치하면 비행기 모드에서도 열리고, 기록이 지워지지 않게 보호됩니다.'
      : '브라우저 메뉴(⋮) → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>로 설치하면 비행기 모드에서도 열리고, 기록이 지워지지 않게 보호됩니다.';
    $('installNow').addEventListener('click', async () => {
      if (!installEvt) return;
      installEvt.prompt();
      await installEvt.userChoice.catch(() => {});
      installEvt = null; $('installNow').hidden = true;
    });
    let closed = false;
    try { closed = localStorage.getItem('logbook.installHintClosed') === '1'; } catch (e) { /* 무시 */ }
    $('installHint').hidden = standalone || closed;
    $('installClose').addEventListener('click', () => {
      $('installHint').hidden = true;
      try { localStorage.setItem('logbook.installHintClosed', '1'); } catch (e) { /* 무시 */ }
    });
  }

  async function start() {
    installHint();
    try {
      const [entries, settings, sync] = await Promise.all([DB.allEntries(), DB.get('settings'), DB.get('sync')]);
      S.entries = entries || [];
      S.settings = Object.assign({}, DEFAULT_SETTINGS, settings || {});
      S.settings.carry = Object.assign({}, DEFAULT_SETTINGS.carry, S.settings.carry || {});
      S.sync = sync || {};
      airports = L.airportDB(S.settings.airports);
      if (!S.settings.instr2 && (!settings || !settings.instrumentRule || settings.instrumentRule === 'flight')) {
        S.settings.instrumentRule = 'flight2'; S.settings.instr2 = true; DB.set('settings', S.settings);
      }
    } catch (err) {
      toast('저장소를 열 수 없습니다: ' + err.message, 8000);
    }
    render();
    DB.persist();
    if (DRIVE.signedIn() && navigator.onLine) sync(false);
    startICloud(); // 로그인돼 있으면 onChange → 자동 동기화
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // 글자 인식 엔진을 미리 불러 둠 (첫 스캔이 빨라지고, 오프라인 대비 캐시됨)
    setTimeout(() => OCR.load().catch(() => {}), 1500);
  }

  start();
})();
