/* 조종사 전자 로그북 — 화면 */
(function () {
  'use strict';
  const L = window.LOGBOOK, OCR = window.LOGBOOK_OCR, DB = window.LOGBOOK_STORE, DRIVE = window.LOGBOOK_DRIVE, LS = window.LOGBOOK_SKD;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const DAY = L.DAY, MIN = L.MIN;
  window.LOGBOOK_VERSION = '2026.11.25-9'; // sw.js의 VERSION과 같이 올리기

  const DEFAULT_SETTINGS = {
    tz: 'Asia/Seoul', schedTz: 'Asia/Seoul', night: 'civil', instrumentRule: 'flight', ifrRule: 'block', defaultType: 'A321', defaultDuty: 'C',
    carry: { asOf: '' }, airports: [], aircraft: [], careers: [], profile: {}, print: {}, updatedAt: 0
  };
  const ROLES = [['pf', 'PF (이륙·착륙)', true, true], ['pm', 'PM', false, false], ['to', '이륙만', true, false], ['ld', '착륙만', false, true]];

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
  const calcOpts = extra => Object.assign({ airports, tz: S.settings.tz, night: S.settings.night, instrumentRule: S.settings.instrumentRule, ifrRule: S.settings.ifrRule }, extra || {});

  async function saveSettings(patch) {
    Object.assign(S.settings, patch, { updatedAt: Date.now() });
    airports = L.airportDB(S.settings.airports);
    await DB.set('settings', S.settings);
    markDirty();
  }

  /* ===================== 로그북 목록 ===================== */

  function renderLog() {
    const q = S.search.trim().toUpperCase();
    let list = live().sort((a, b) => (a.logDate === b.logDate ? L.eventTime(b) - L.eventTime(a) : a.logDate < b.logDate ? 1 : -1));
    if (q) {
      const qn = q.replace(/\s+/g, '');
      list = list.filter(e => [e.flightNumber, e.registration, e.aircraftType, airports.display(e.origin), airports.display(e.destination), e.origin, e.destination, e.logDate, e.remarks]
        .some(x => String(x || '').toUpperCase().includes(q)) || L.crewNamesOf(e).some(n => n.toUpperCase().replace(/\s+/g, '').includes(qn)));
    }
    const board = $('board');
    const stale = S.entries.filter(e => e.planned && !e.deleted && e.schedOut != null && e.schedOut < Date.now() - 36 * 3600e3);
    const staleHtml = stale.length && !q ? `<div class="banner"><span>기록하지 않은 <b>지난 예정 비행 ${stale.length}건</b>이 있습니다. 비행했으면 눌러서 시각을 넣고, 취소된 비행이면 정리하세요.</span><button class="btn sm" id="clearStale">지난 예정 정리</button></div>` : '';
    const people = q.length >= 2 ? L.crewIndex(S.entries, q).slice(0, 5) : [];
    const ymd = d => d.replace(/-/g, '/');
    const peopleHtml = people.length ? `<div class="banner" style="display:block"><b>함께 탄 사람</b><ul class="list-plain" style="margin:6px 0 0">${people.map(p =>
      `<li><span><b>${esc(p.name)}</b> — 함께 ${p.count}회</span><span class="help mono">${p.count > 1 ? ymd(p.first) + ' ~ ' : ''}${ymd(p.last)}</span></li>`).join('')}</ul></div>` : '';
    if (!list.length) {
      board.innerHTML = peopleHtml + `<p class="empty">${q ? '찾는 기록이 없습니다.' : '아직 기록이 없습니다.<br><b>📅 스케줄 가져오기</b>로 이번 달 비행을 미리 넣어 두거나,<br>비행 후 MCDU의 <b>AOC › OOOI STATUS</b> 화면을 <b>OOOI 화면 찍기</b>로 찍으세요.'}</p>`;
      return;
    }
    const groups = new Map();
    for (const e of list) {
      const k = e.logDate.slice(0, 7) || '날짜 없음';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    let html = '';
    for (const [m, items] of groups) {
      const sum = items.filter(e => !e.isSimulator && !e.planned).reduce((s, e) => s + e.block, 0);
      html += `<div class="month"><span>${esc(m.replace('-', '년 '))}월</span><span class="mono">${L.hmm(sum)}</span></div><ul class="board">`;
      for (const e of items) {
        const title = e.isSimulator ? `SIM · ${esc(e.aircraftType)} ${esc(e.flightNumber)}`
          : `${esc(e.flightNumber || '편명 없음')} <span style="font-weight:600">${esc(airports.display(e.origin))}→${esc(airports.display(e.destination))}</span>`;
        const fnShort = { PIC: 'PIC', SIC: 'F/O', PICUS: 'PICUS', RELIEF: 'Relief', DUAL: 'Dual', OBS: 'OBS' }[L.fnOf(e)];
        const sub = [e.aircraftType && !e.isSimulator ? e.aircraftType : '', e.registration, e.isSimulator ? e.fstdType : fnShort,
          L.instructingOf(e) ? 'IP' : '', e.examining ? '평가' : ''].filter(Boolean).map(esc).join(' · ');
        const badges = e.planned ? [
          '<span class="badge plan">예정</span>',
          e.roleSure === false ? '<span class="badge warn">역할 확인</span>' : ''
        ].join('') : [
          e.takeoffs > 0 ? `<span class="badge">T/O${e.nightTakeoffs ? ' ☾' : ''}${e.takeoffs > 1 ? ' ×' + e.takeoffs : ''}</span>` : '',
          e.landings > 0 ? `<span class="badge">L/D${e.nightLandings ? ' ☾' : ''}${e.landings > 1 ? ' ×' + e.landings : ''}</span>` : '',
          e.hasPhoto ? '<span class="badge" title="스캔 사진 있음">📷</span>' : ''
        ].join('');
        const blk = e.planned
          ? `<span class="blk"><span class="t">${e.schedOut != null ? L.zulu(e.schedOut) + 'Z' : ''}</span><small>STD</small></span>`
          : `<span class="blk"><span class="t">${L.hmm(e.block)}</span>${e.night ? `<small>☾ ${L.hmm(e.night)}</small>` : ''}</span>`;
        html += `<li class="row${e.planned ? ' plan' : ''}" data-id="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(e.logDate)} ${esc(e.flightNumber)} ${e.planned ? '예정 비행 기록하기' : '열기'}">
          <span class="d">${esc(e.logDate.slice(5).replace('-', '/'))}</span>
          <span><span class="ttl">${title}</span><br><span class="sub">${sub}</span></span>
          <span class="badges">${badges}</span>
          ${blk}</li>`;
      }
      html += '</ul>';
    }
    board.innerHTML = peopleHtml + staleHtml + html;
    const cs = $('clearStale');
    if (cs) cs.addEventListener('click', async () => {
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
  $('search').addEventListener('input', ev => { S.search = ev.target.value; renderLog(); });

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

      <h2>저장 · 백업</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">기록은 항상 <b>이 기기에 먼저</b> 저장됩니다. 인터넷이 되면 <b>구글 드라이브</b>의 <span class="mono">${esc(DRIVE.FILE_NAME)}</span> 파일과 자동으로 합쳐집니다. 마지막 동기화: ${esc(lastSync)}</p>
        <div class="actions">
          <button class="btn pri" id="setSync">${DRIVE.signedIn() ? '지금 동기화' : '구글 드라이브 연결'}</button>
          <button class="btn" id="exportShare">iCloud·파일 앱에 백업</button>
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
        <div class="field"><label for="sInst">실계기 (회사 I/T·FAA Actual)</label>${selectHtml('sInst', [['flight', '비행시간(OFF→ON)과 같게'], ['block', '블록시간과 같게'], ['manual', '직접 입력']], st.instrumentRule)}</div>
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
    $('setSync').addEventListener('click', () => sync(true));
    $('exportJson').addEventListener('click', () => downloadFile(backupText(), `logbook-backup-${todayIn(S.settings.tz)}.json`, 'application/json'));
    $('exportShare').addEventListener('click', shareBackup);
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
    const hh = ms => (ms == null ? '' : L.zulu(ms));
    const role = ROLES.find(r => r[2] === e.takeoffs > 0 && r[3] === e.landings > 0);
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
      if (D.lastReg && D.lastReg.type !== c.aircraftType) e.registration = '';
    }
    D.career = c;
  }

  function newFlightDraft() {
    const last = live().filter(e => !e.isSimulator && !e.planned).sort((a, b) => b.createdAt - a.createdAt)[0];
    const e = L.newEntry({ aircraftType: (last && last.aircraftType) || '', registration: (last && last.registration) || '',
      logDate: todayIn(S.settings.tz) });
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
    if (!e.flightNumber.trim()) m.push('편명');
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
    refreshSched();
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

  function planSection() {
    const e = D.e;
    if (!D.fromPlan && !D.isNew && e.schedOut == null) return '';
    if (D.isNew && !D.fromPlan && (D.photo || D.notes.length)) return ''; // 사진으로 스캔한 새 비행
    const sc = D.sched;
    const canPlan = D.fromPlan || D.isNew;
    return `<div class="sec"><h3>스케줄${D.isNew && !D.fromPlan ? ' (선택 — 아직 비행 전이면 예정으로 저장)' : ''}</h3>
      ${e.schedFlight && e.schedFlight !== e.flightNumber ? `<p class="help" style="margin:0 0 6px">스케줄 편명 <span class="mono">${esc(e.schedFlight)}</span></p>` : ''}
      <div class="grid">
        <div class="field"><label>STD 날짜 (UTC)</label><input type="date" id="schedDate" value="${esc(sc.date)}"></div>
        <div class="field"><label>STD (UTC)</label><input id="schedStd" class="mono" inputmode="numeric" maxlength="4" placeholder="HHMM" value="${esc(sc.std)}"></div>
        <div class="field"><label>STA (UTC)</label><input id="schedSta" class="mono" inputmode="numeric" maxlength="4" placeholder="HHMM" value="${esc(sc.sta)}"></div>
      </div>
      <p class="help" id="schedInfo" style="margin:6px 0"></p>
      ${e.acCode ? `<p class="help" style="margin:0 0 6px">스케줄 기종 코드 <span class="mono">${esc(e.acCode)}</span></p>` : ''}
      ${e.crew ? `<p class="help" style="margin:0 0 6px">스케줄 승무원: ${esc(e.crew)}</p>` : ''}
      ${e.roleSure === false ? '<p class="why" style="margin:0 0 6px">스케줄에서 역할을 확실히 읽지 못해 추정했습니다. 아래 역할을 확인하세요.</p>' : ''}
      <div class="actions" style="margin:8px 0 0">
        ${D.fromPlan ? '<label class="btn pri" for="scanInto">📷 OOOI 화면 찍어서 시각 넣기</label>' : ''}
        ${canPlan ? '<button type="button" class="btn" id="savePlan">예정으로 저장</button>' : ''}
      </div>
      ${D.fromPlan ? '<p class="help">당일 바뀐 편명·구간·시각·승무원은 고친 뒤 <b>예정으로 저장</b>하세요. 비행 후에는 OOOI 시각을 넣고 위의 <b>저장</b>을 누르면 기록이 됩니다.</p>' : ''}
    </div>`;
  }

  /** 스케줄 칸(STD 날짜 + STD/STA HHMM) → UTC 시각 */
  function resolveSched() {
    const sc = D.sched, d = /^\d{4}-\d{2}-\d{2}$/.test(sc.date) ? Date.UTC(+sc.date.slice(0, 4), +sc.date.slice(5, 7) - 1, +sc.date.slice(8, 10)) : null;
    const m = v => (/^\d{4}$/.test(v || '') ? L.clock.fromDigits(v) : null);
    const so = d != null && m(sc.std) != null ? d + m(sc.std) * MIN : null;
    let si = null;
    if (so != null && m(sc.sta) != null) { si = Math.floor(so / DAY) * DAY + m(sc.sta) * MIN; if (si < so) si += DAY; }
    return { schedOut: so, schedIn: si };
  }

  function refreshSched() {
    const el = $('schedInfo');
    if (!el) return;
    const r = resolveSched();
    const kst = ms => L.dateIn(ms, 'Asia/Seoul').slice(5).replace('-', '/') + ' ' + new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    el.textContent = r.schedOut == null ? 'STD를 넣으면 예정으로 저장할 수 있습니다.'
      : `한국 시간 STD ${kst(r.schedOut)}${r.schedIn != null ? ` · STA ${kst(r.schedIn)} · 예정 ${L.hmm(Math.round((r.schedIn - r.schedOut) / MIN))}` : ''}`;
  }

  async function savePlanned() {
    const e = D.e, r = resolveSched();
    const miss = [];
    if (!e.flightNumber.trim()) miss.push('편명');
    if (!e.origin || !e.destination) miss.push('출발·도착');
    if (r.schedOut == null) miss.push('STD');
    if (miss.length) return toast('예정으로 저장하려면: ' + miss.join(', '), 4000);
    const t = Object.assign({}, e, {
      planned: true, schedOut: r.schedOut, schedIn: r.schedIn, out: null, off: null, on: null, in: null,
      flightNumber: e.flightNumber.toUpperCase().replace(/\s+/g, ''), logDate: L.dateIn(r.schedOut, S.settings.tz),
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
    const sel = (f, opts) => `<select data-f="${f}">${opts.map(([v, l]) => `<option value="${esc(v)}"${e[f] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const inp = (f, label, ph, cls) => `<div class="field${cls ? ' ' + cls : ''}"><label>${label}</label><input data-f="${f}" value="${esc(e[f])}" placeholder="${esc(ph || '')}" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>`;
    const apt = (f, label) => `<div class="field${flagged(f === 'origin' ? 'origin' : 'destination') ? ' flag' : ''}"><label>${label} <span class="help" data-apt-name="${f}"></span></label><input data-apt="${f}" value="${esc(e[f] ? airports.display(e[f]) : '')}" placeholder="ICN / RKSI" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>`;
    const tm = (k, label) => `<div class="${flagged(k) ? 'flag' : ''}"><label class="help" style="display:block;text-align:center;margin:0 0 4px">${label}</label>
      <input data-t="${k}" value="${esc(D.hhmm[k])}" inputmode="numeric" maxlength="4" placeholder="HHMM" aria-label="${label} (UTC, 4자리)"><span class="when" data-when="${k}"></span></div>`;
    return `${planSection()}${scanSection()}
      <div class="sec"><h3>비행</h3><div class="grid">
        ${inp('flightNumber', '편명', 'OZ731', flagged('flightID') ? 'flag' : '')}
        ${apt('origin', '출발')}${apt('destination', '도착')}
        ${inp('aircraftType', '기종', 'A321')}${inp('registration', '등록부호 (HL)', 'HL8399')}
        ${inp('irregular', 'IRR', '')}
      </div></div>
      <div class="sec"><h3>역할 ${D.career ? `<span class="help">— 경력 단계 "${esc(D.career.title || L.FUNCTIONS[D.career.fn].label)}" 기준</span>` : ''}</h3><div class="grid">
        <div class="field"><label>이 비행에서 나의 역할</label><select id="fnSel">${Object.entries(L.FUNCTIONS).map(([k, v]) => `<option value="${k}"${L.fnOf(e) === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        <div class="field" id="picNameBox"><label>기장 이름 (ICAO 8번 칸)</label><input data-f="picName" value="${esc(e.picName)}" placeholder="HONG GILDONG" autocomplete="off" list="crewNames"></div>
        <div class="field"><label>함께 탄 조종사 (부기장 등, 여럿이면 쉼표)</label><input data-f="copilotName" value="${esc(e.copilotName)}" placeholder="KIM CHULSOO" autocomplete="off" list="crewNames"></div>
        <datalist id="crewNames">${L.crewIndex(S.entries).slice(0, 200).map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
        <div class="field"><label>추가 역할</label>
          <label style="display:inline-flex;gap:6px;align-items:center;margin-right:14px"><input type="checkbox" data-chk="instructing" ${L.instructingOf(e) ? 'checked' : ''} style="width:auto;min-height:0"> 교관 비행 (IP)</label>
          <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-chk="examining" ${e.examining ? 'checked' : ''} style="width:auto;min-height:0"> 심사 비행 (평가관)</label></div>
      </div></div>
      <div class="sec"><h3>OOOI (UTC) — 4자리로 입력, 날짜는 OUT부터 자동</h3>
        <div class="field" style="max-width:220px;margin-bottom:10px"><label>OUT 날짜 (UTC)</label><input type="date" id="outDate" value="${esc(D.outDate)}"></div>
        <div class="oooi">${tm('out', 'OUT (R/O)')}${tm('off', 'OFF')}${tm('on', 'ON')}${tm('in', 'IN (R/I)')}</div>
        <p class="help">로그북 날짜 <b class="mono" id="logDateShow"></b> — OUT 시각의 ${S.settings.tz === 'UTC' ? 'UTC' : '한국'} 날짜</p>
      </div>
      <div class="sec"><h3>T/O · L/D — 내가 한 이착륙</h3>
        <div class="role${D.role ? '' : ' need'}" id="role">${ROLES.map(r => `<button type="button" data-role="${r[0]}" aria-pressed="${D.role === r[0]}">${r[1]}</button>`).join('')}</div>
        ${D.role ? '' : '<p class="why">90일 이착륙 횟수에 들어가므로 꼭 골라 주세요.</p>'}
      </div>
      <div class="sec"><h3>시간</h3><div class="calc">
        <div><label class="help">Block (Duty time)</label><div class="v" id="cBlock"></div></div>
        <div><label class="help">Flight (T/S)</label><div class="v" id="cFlight"></div></div>
        <div class="field"><label>야간 (N/T) <button type="button" class="btn sm" id="nightAuto" hidden>자동</button></label><input id="nightIn" class="mono" inputmode="numeric"></div>
        <div class="field"><label>실계기 (I/T) <button type="button" class="btn sm" id="instAuto" hidden>자동</button></label><input id="instIn" class="mono" inputmode="numeric"></div>
        <div class="field"><label>IFR <button type="button" class="btn sm" id="ifrAuto" hidden>자동</button></label><input id="ifrIn" class="mono" inputmode="numeric"></div>
      </div><p class="help" id="calcHelp"></p></div>
      <div class="sec"><h3>계기 접근 (FAA 6개월 요건)</h3><div class="grid">
        <div class="field"><label>접근 횟수</label><input data-n="approaches" type="number" min="0" max="20" value="${e.approaches || 0}" inputmode="numeric"></div>
        <div class="field"><label>접근 종류</label><input data-f="approachType" value="${esc(e.approachType)}" placeholder="ILS 33L / RNP" autocapitalize="characters"></div>
        <div class="field"><label>체공</label><label style="display:inline-flex;gap:6px;align-items:center;min-height:42px"><input type="checkbox" data-chk="holding" ${e.holding ? 'checked' : ''} style="width:auto;min-height:0"> 체공(Holding) 함</label></div>
      </div></div>
      <div class="sec"><h3>비고</h3><textarea data-f="remarks" rows="2">${esc(e.remarks)}</textarea></div>
      ${D.isNew ? '' : '<div class="actions"><button class="btn danger" id="edDelete">이 기록 삭제</button></div>'}`;
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
    for (const id of ['schedDate', 'schedStd', 'schedSta']) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        if (id !== 'schedDate') el.value = el.value.replace(/\D/g, '').slice(0, 4);
        D.sched[{ schedDate: 'date', schedStd: 'std', schedSta: 'sta' }[id]] = el.value;
        refreshSched();
      });
    }
    if ($('savePlan')) $('savePlan').addEventListener('click', () => savePlanned().catch(err => toast('저장 실패: ' + err.message, 6000)));
    const fnSel = $('fnSel');
    if (fnSel) fnSel.addEventListener('change', () => { e.fn = fnSel.value; D.fnTouched = true; recalcDraft(); refreshComputed(); });
    body.querySelectorAll('[data-chk]').forEach(el => el.addEventListener('change', () => { e[el.dataset.chk] = el.checked; recalcDraft(); refreshComputed(); }));
    const od = $('outDate');
    if (od) od.addEventListener('change', () => { D.outDate = od.value; recalcDraft(); refreshComputed(); });
    body.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => {
      D.role = b.dataset.role;
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
        if (n) n.textContent = a ? a.icao : (e[f] ? '목록에 없음' : '');
      }
      const miss = missingFields(), probs = timeProblems();
      const o = airports.get(e.origin), d = airports.get(e.destination);
      document.querySelectorAll('.oooi > div').forEach(x => x.classList.toggle('bad', probs.length > 0));
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
    if (!e.isSimulator) e.flightNumber = e.flightNumber.toUpperCase().replace(/\s+/g, '');
    if (!e.isSimulator && $('schedStd')) { const rs = resolveSched(); if (rs.schedOut != null) { e.schedOut = rs.schedOut; e.schedIn = rs.schedIn; } }
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

  function renderSync() {
    const dot = $('syncDot'), text = $('syncText'), btn = $('syncBtn');
    const pending = !S.sync.lastSync || S.entries.some(e => (e.updatedAt || 0) > S.sync.lastSync) || (S.settings.updatedAt || 0) > S.sync.lastSync;
    dot.className = 'dot';
    if (S.syncing) { text.textContent = '동기화 중…'; btn.hidden = true; return; }
    btn.hidden = false;
    if (!navigator.onLine) { dot.classList.add('warn'); text.textContent = pending ? '오프라인 · 이 기기에 저장됨' : '오프라인'; btn.hidden = true; }
    else if (!DRIVE.signedIn()) {
      if (S.sync.fileId) dot.classList.add('warn');
      text.textContent = S.sync.fileId ? '드라이브 연결 끊김' : '이 기기에만 저장됨';
      btn.textContent = S.sync.fileId ? '다시 연결' : '구글 드라이브 연결';
    } else if (S.sync.error) { dot.classList.add('bad'); text.textContent = '동기화 실패'; btn.textContent = '다시 시도'; }
    else {
      dot.classList.add(pending ? 'warn' : 'ok');
      text.textContent = pending ? '동기화 대기' : '드라이브와 맞춤 ' + (S.sync.lastSync ? new Date(S.sync.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '');
      btn.textContent = '지금 동기화';
    }
  }

  let syncTimer = 0;
  function markDirty() {
    renderSync();
    clearTimeout(syncTimer);
    if (DRIVE.signedIn() && navigator.onLine) syncTimer = setTimeout(() => sync(false), 1500);
  }

  async function sync(interactive) {
    if (S.syncing) return;
    let changed = false;
    if (!navigator.onLine) { renderSync(); if (interactive) toast('오프라인입니다. 기록은 이 기기에 저장되어 있고, 인터넷이 되면 동기화합니다.'); return; }
    try {
      if (interactive && !DRIVE.signedIn()) {
        await DRIVE.signIn();
        try { localStorage.setItem('logbook.driveConnected', '1'); } catch (e) { /* 무시 */ }
      }
      if (!DRIVE.signedIn()) { renderSync(); return; }
      S.syncing = true; renderSync();
      const id = await DRIVE.findFile(S.sync.fileId);
      if (id) { const m = await applyRemote(L.readBackup(await DRIVE.download(id))); if (m.changed) changed = true; }
      const newId = await DRIVE.upload(id, backupText());
      S.sync = { fileId: newId, lastSync: Date.now(), error: '' };
      await DB.set('sync', S.sync);
      if (interactive) toast('구글 드라이브와 맞췄습니다.');
    } catch (err) {
      S.sync.error = err.message;
      if (interactive || !err.needLogin) toast('동기화 실패: ' + err.message, 7000);
    } finally {
      S.syncing = false;
      // 드라이브에서 받은 변경이 있을 때만 화면을 다시 그림 (입력 중인 칸이 끊기지 않게)
      if (changed) render(); else renderSync();
    }
  }

  $('syncBtn').addEventListener('click', () => sync(true));
  window.addEventListener('online', () => { renderSync(); if (DRIVE.signedIn()) sync(false); });
  window.addEventListener('offline', renderSync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && DRIVE.signedIn()) sync(false); });
  setInterval(() => { if (DRIVE.signedIn() && navigator.onLine && document.visibilityState === 'visible') sync(false); }, 10 * 60000);

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
    } catch (err) {
      toast('저장소를 열 수 없습니다: ' + err.message, 8000);
    }
    render();
    DB.persist();
    if (DRIVE.signedIn() && navigator.onLine) sync(false);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // 글자 인식 엔진을 미리 불러 둠 (첫 스캔이 빨라지고, 오프라인 대비 캐시됨)
    setTimeout(() => OCR.load().catch(() => {}), 1500);
  }

  start();
})();
