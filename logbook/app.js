/* 조종사 전자 로그북 — 화면 */
(function () {
  'use strict';
  const L = window.LOGBOOK, OCR = window.LOGBOOK_OCR, DB = window.LOGBOOK_STORE, DRIVE = window.LOGBOOK_DRIVE;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const DAY = L.DAY, MIN = L.MIN;
  window.LOGBOOK_VERSION = '2026.11.25-3'; // sw.js의 VERSION과 같이 올리기

  const DEFAULT_SETTINGS = {
    tz: 'Asia/Seoul', night: 'civil', instrumentRule: 'flight', defaultType: 'A321', defaultDuty: 'C',
    carry: { total: 0, pic: 0, night: 0, instrument: 0, asOf: '' }, airports: [], updatedAt: 0
  };
  const DUTIES = [['C', 'C · 기장'], ['F', 'F · 부기장'], ['I', 'I · 교관'], ['O', 'O · 옵저버']];
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
  const calcOpts = extra => Object.assign({ airports, tz: S.settings.tz, night: S.settings.night, instrumentRule: S.settings.instrumentRule }, extra || {});

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
      list = list.filter(e => [e.flightNumber, e.registration, e.aircraftType, airports.display(e.origin), airports.display(e.destination), e.origin, e.destination, e.logDate, e.remarks]
        .some(x => String(x || '').toUpperCase().includes(q)));
    }
    const board = $('board');
    if (!list.length) {
      board.innerHTML = `<p class="empty">${q ? '찾는 기록이 없습니다.' : '아직 기록이 없습니다.<br>비행 후 MCDU에서 <b>AOC › OOOI STATUS</b> 화면을 띄우고 위의 <b>OOOI 화면 찍기</b>를 누르세요.'}</p>`;
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
      const sum = items.filter(e => !e.isSimulator).reduce((s, e) => s + e.block, 0);
      html += `<div class="month"><span>${esc(m.replace('-', '년 '))}월</span><span class="mono">${L.hmm(sum)}</span></div><ul class="board">`;
      for (const e of items) {
        const title = e.isSimulator ? `SIM · ${esc(e.aircraftType)} ${esc(e.flightNumber)}`
          : `${esc(e.flightNumber || '편명 없음')} <span style="font-weight:600">${esc(airports.display(e.origin))}→${esc(airports.display(e.destination))}</span>`;
        const sub = [e.aircraftType && !e.isSimulator ? e.aircraftType : '', e.registration, e.duty].filter(Boolean).map(esc).join(' · ');
        const badges = [
          e.takeoffs > 0 ? `<span class="badge">T/O${e.nightTakeoffs ? ' ☾' : ''}${e.takeoffs > 1 ? ' ×' + e.takeoffs : ''}</span>` : '',
          e.landings > 0 ? `<span class="badge">L/D${e.nightLandings ? ' ☾' : ''}${e.landings > 1 ? ' ×' + e.landings : ''}</span>` : '',
          e.hasPhoto ? '<span class="badge" title="스캔 사진 있음">📷</span>' : ''
        ].join('');
        html += `<li class="row" data-id="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(e.logDate)} ${esc(e.flightNumber)} 열기">
          <span class="d">${esc(e.logDate.slice(5).replace('-', '/'))}</span>
          <span><span class="ttl">${title}</span><br><span class="sub">${sub}</span></span>
          <span class="badges">${badges}</span>
          <span class="blk"><span class="t">${L.hmm(e.block)}</span>${e.night ? `<small>☾ ${L.hmm(e.night)}</small>` : ''}</span></li>`;
      }
      html += '</ul>';
    }
    board.innerHTML = html;
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

  function renderSummary() {
    const c = S.settings.carry || {};
    const tot = L.totals(S.entries, c);
    const month = todayIn(S.settings.tz).slice(0, 7);
    const mon = L.totals(S.entries, null, { from: month + '-01', through: month + '-31' });
    const rec = L.recency(S.entries, Date.now());
    const card = (label, v) => `<div class="card"><label>${label}</label><span class="t">${v}</span></div>`;
    const until = rec.validUntil ? new Date(rec.validUntil).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    $('view-sum').innerHTML = `
      <h2>최근 90일 이착륙</h2>
      <div class="rec">
        <span class="state ${rec.isCurrent ? 'ok' : 'warn'}">${rec.isCurrent ? '✓ 요건 충족' : `⚠ 요건 미달 (이륙·착륙 각 ${rec.required}회)`}</span>
        <table><thead><tr><th></th><th>비행</th><th>SIM</th><th>합계</th></tr></thead><tbody>
          <tr><td>Take-off</td><td>${rec.flightTakeoffs}</td><td>${rec.simTakeoffs}</td><td><b>${rec.totalTakeoffs}</b></td></tr>
          <tr><td>Landing</td><td>${rec.flightLandings}</td><td>${rec.simLandings}</td><td><b>${rec.totalLandings}</b></td></tr>
        </tbody></table>
        ${until ? `<p class="help">추가 이착륙이 없으면 <b>${until}</b>까지 유지됩니다.</p>` : ''}
        ${rec.nightTakeoffs + rec.nightLandings ? `<p class="help">그중 야간: 이륙 ${rec.nightTakeoffs} · 착륙 ${rec.nightLandings}</p>` : ''}
      </div>
      <h2>누계 (Flight Summary)</h2>
      <div class="cards">${card('총 비행시간', L.hmm(tot.total))}${card('기장(CAP) 시간', L.hmm(tot.pic))}${card('야간', L.hmm(tot.night))}${card('계기', L.hmm(tot.instrument))}</div>
      ${c.total ? `<p class="help">이월 누계(${esc(c.asOf || '날짜 미지정')}까지) + 이후 앱 기록</p>` : '<p class="help">설정 › 이월 누계에 회사 Flight Summary 숫자를 넣으면 총 시간이 맞춰집니다.</p>'}
      <h2>이번 달 (${esc(month.replace('-', '년 '))}월)</h2>
      <div class="cards">${card('비행시간', L.hmm(mon.total))}${card('편수', mon.flights)}${card('야간', L.hmm(mon.night))}${card('이착륙', mon.takeoffs + ' / ' + mon.landings)}</div>`;
  }

  /* ===================== 설정 ===================== */

  function renderSettings() {
    const st = S.settings, c = st.carry || {};
    const sel = (id, opts, v) => `<select id="${id}">${opts.map(([val, label]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    const lastSync = S.sync.lastSync ? new Date(S.sync.lastSync).toLocaleString('ko-KR') : '아직 안 함';
    $('view-set').innerHTML = `
      <h2>저장 · 백업</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">기록은 항상 <b>이 iPad에 먼저</b> 저장됩니다. 인터넷이 되면 <b>구글 드라이브</b>의 <span class="mono">${esc(DRIVE.FILE_NAME)}</span> 파일과 자동으로 합쳐집니다. 마지막 동기화: ${esc(lastSync)}</p>
        <div class="actions">
          <button class="btn pri" id="setSync">${DRIVE.signedIn() ? '지금 동기화' : '구글 드라이브 연결'}</button>
          <button class="btn" id="exportShare">iCloud·파일 앱에 백업</button>
          <button class="btn" id="exportJson">JSON 백업 받기</button>
          <button class="btn" id="exportCsv">CSV (회사 Flight Log 칸 순서)</button>
          <button class="btn" id="importJson">백업에서 불러오기</button>
        </div>
        <p class="help" id="persistInfo"></p>
      </div>

      <h2>이월 누계</h2>
      <div class="sec">
        <div class="form">
          <div class="field"><label for="cTotal">총 비행시간</label><input id="cTotal" class="mono" inputmode="numeric" value="${L.hmm(c.total || 0)}"></div>
          <div class="field"><label for="cPic">기장(CAP) 시간</label><input id="cPic" class="mono" inputmode="numeric" value="${L.hmm(c.pic || 0)}"></div>
          <div class="field"><label for="cNight">야간</label><input id="cNight" class="mono" inputmode="numeric" value="${L.hmm(c.night || 0)}"></div>
          <div class="field"><label for="cInst">계기</label><input id="cInst" class="mono" inputmode="numeric" value="${L.hmm(c.instrument || 0)}"></div>
          <div class="field"><label for="cAsOf">기준일 (이날까지 포함된 숫자)</label><input id="cAsOf" type="date" value="${esc(c.asOf || '')}"></div>
        </div>
        <p class="help">회사 Flight Log의 Flight Summary 숫자를 <span class="mono">시:분</span>으로 넣으세요 (예 <span class="mono">8584:14</span>). 기준일 다음 날부터의 앱 기록이 더해집니다.</p>
      </div>

      <h2>기본값 · 계산 규칙</h2>
      <div class="sec"><div class="form">
        <div class="field"><label for="sType">기본 기종</label><input id="sType" value="${esc(st.defaultType)}" autocapitalize="characters"></div>
        <div class="field"><label for="sDuty">기본 Duty</label>${sel('sDuty', DUTIES, st.defaultDuty)}</div>
        <div class="field"><label for="sTz">로그북 날짜 기준</label>${sel('sTz', [['Asia/Seoul', '한국 시간 (회사 로그북과 같음)'], ['UTC', 'UTC']], st.tz)}</div>
        <div class="field"><label for="sNight">야간 기준</label>${sel('sNight', [['civil', '시민박명 (태양 고도 −6°)'], ['sunset', '일몰 ~ 일출']], st.night)}</div>
        <div class="field"><label for="sInst">계기 시간</label>${sel('sInst', [['flight', '비행시간(OFF→ON)과 같게'], ['block', '블록시간(OUT→IN)과 같게'], ['manual', '직접 입력']], st.instrumentRule)}</div>
      </div></div>

      <h2>공항</h2>
      <div class="sec">
        <p class="help" style="margin-top:0">한국·일본·중국·동남아 주요 공항 ${L.AIRPORTS.length}곳이 들어 있습니다. 없는 공항은 좌표와 시간대를 넣으면 야간 시간이 계산됩니다.</p>
        <ul class="list-plain">${(st.airports || []).map((a, i) => `<li><span class="mono">${esc(a.icao)} / ${esc(a.iata)} · ${esc(a.lat)}, ${esc(a.lon)} · ${esc(a.tz)}</span><button class="btn sm danger" data-del-apt="${i}">삭제</button></li>`).join('')}</ul>
        <div class="form">
          <div class="field"><label for="aIcao">ICAO</label><input id="aIcao" maxlength="4" autocapitalize="characters" placeholder="RKSI"></div>
          <div class="field"><label for="aIata">IATA</label><input id="aIata" maxlength="3" autocapitalize="characters" placeholder="ICN"></div>
          <div class="field"><label for="aLat">위도</label><input id="aLat" inputmode="decimal" placeholder="37.4602"></div>
          <div class="field"><label for="aLon">경도</label><input id="aLon" inputmode="decimal" placeholder="126.4407"></div>
          <div class="field"><label for="aTz">시간대</label><input id="aTz" placeholder="Asia/Seoul" list="tzList"></div>
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

    const durInput = (id, key) => $(id).addEventListener('change', ev => {
      const v = L.parseHMM(ev.target.value);
      if (v == null) { ev.target.value = L.hmm(S.settings.carry[key] || 0); return toast('시:분 형식으로 넣어 주세요 (예 8584:14)'); }
      ev.target.value = L.hmm(v);
      saveSettings({ carry: Object.assign({}, S.settings.carry, { [key]: v }) });
    });
    durInput('cTotal', 'total'); durInput('cPic', 'pic'); durInput('cNight', 'night'); durInput('cInst', 'instrument');
    $('cAsOf').addEventListener('change', ev => saveSettings({ carry: Object.assign({}, S.settings.carry, { asOf: ev.target.value }) }));
    $('sType').addEventListener('change', ev => saveSettings({ defaultType: ev.target.value.trim().toUpperCase() }));
    $('sDuty').addEventListener('change', ev => saveSettings({ defaultDuty: ev.target.value }));
    $('sTz').addEventListener('change', ev => saveSettings({ tz: ev.target.value }));
    $('sNight').addEventListener('change', ev => saveSettings({ night: ev.target.value }));
    $('sInst').addEventListener('change', ev => saveSettings({ instrumentRule: ev.target.value }));
    $('addApt').addEventListener('click', addAirport);
    $('view-set').querySelectorAll('[data-del-apt]').forEach(b => b.addEventListener('click', async () => {
      const list = (S.settings.airports || []).slice();
      list.splice(+b.dataset.delApt, 1);
      await saveSettings({ airports: list });
      renderSettings();
    }));
    $('setSync').addEventListener('click', () => sync(true));
    $('exportJson').addEventListener('click', () => downloadFile(backupText(), `logbook-backup-${todayIn(S.settings.tz)}.json`, 'application/json'));
    $('exportShare').addEventListener('click', shareBackup);
    $('exportCsv').addEventListener('click', () => downloadFile(L.toCSV(S.entries, airports), `logbook-${todayIn(S.settings.tz)}.csv`, 'text/csv'));
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

  /* ===================== 화면 전환 ===================== */

  function show(view) {
    S.view = view;
    for (const v of ['log', 'sum', 'set']) $('view-' + v).hidden = v !== view;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('title').textContent = { log: '로그북', sum: '요약', set: '설정' }[view];
    render();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  function render() {
    if (S.view === 'log') renderLog();
    else if (S.view === 'sum') renderSummary();
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
      outDate: e.out != null ? utcDate(e.out) : utcDate(Date.now()),
      hhmm: { out: hh(e.out), off: hh(e.off), on: hh(e.on), in: hh(e.in) },
      role: role ? role[0] : null
    }, extra || {});
  }

  function newFlightDraft() {
    const last = live().filter(e => !e.isSimulator).sort((a, b) => b.createdAt - a.createdAt)[0];
    const e = L.newEntry({ aircraftType: (last && last.aircraftType) || S.settings.defaultType, registration: (last && last.registration) || '',
      duty: S.settings.defaultDuty, logDate: todayIn(S.settings.tz) });
    return draftFrom(e, { isNew: true, role: null, hhmm: { out: '', off: '', on: '', in: '' } });
  }

  async function openEntry(id) {
    const e = S.entries.find(x => x.id === id);
    if (!e) return;
    D = draftFrom(e);
    if (e.hasPhoto) {
      const blob = await DB.getPhoto(e.id).catch(() => null);
      if (blob) D.photoUrl = URL.createObjectURL(blob);
    }
    openEditor();
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
    $('edTitle').textContent = e.isSimulator ? '시뮬레이터' : D.isNew ? (D.notes.length || D.photoUrl ? '스캔 결과 확인' : '새 비행') : (e.flightNumber || '비행');
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
          ${!D.isNew && D.photoUrl ? '<button type="button" class="btn sm" id="rescan">사진으로 다시 읽기</button>' : ''}
          ${D.diag ? '<button type="button" class="btn sm" id="copyDiag">인식 결과 복사 (문제 신고용)</button>' : ''}
        </div>
      </div></div></div>`;
  }

  function flightForm() {
    const e = D.e;
    const sel = (f, opts) => `<select data-f="${f}">${opts.map(([v, l]) => `<option value="${esc(v)}"${e[f] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const inp = (f, label, ph, cls) => `<div class="field${cls ? ' ' + cls : ''}"><label>${label}</label><input data-f="${f}" value="${esc(e[f])}" placeholder="${esc(ph || '')}" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>`;
    const apt = (f, label) => `<div class="field${flagged(f === 'origin' ? 'origin' : 'destination') ? ' flag' : ''}"><label>${label} <span class="help" data-apt-name="${f}"></span></label><input data-apt="${f}" value="${esc(e[f] ? airports.display(e[f]) : '')}" placeholder="ICN / RKSI" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>`;
    const tm = (k, label) => `<div class="${flagged(k) ? 'flag' : ''}"><label class="help" style="display:block;text-align:center;margin:0 0 4px">${label}</label>
      <input data-t="${k}" value="${esc(D.hhmm[k])}" inputmode="numeric" maxlength="4" placeholder="HHMM" aria-label="${label} (UTC, 4자리)"><span class="when" data-when="${k}"></span></div>`;
    return `${scanSection()}
      <div class="sec"><h3>비행</h3><div class="grid">
        ${inp('flightNumber', '편명', 'OZ731', flagged('flightID') ? 'flag' : '')}
        ${apt('origin', '출발')}${apt('destination', '도착')}
        ${inp('aircraftType', '기종', 'A321')}${inp('registration', '등록부호 (HL)', 'HL8399')}
        <div class="field"><label>Duty</label>${sel('duty', DUTIES)}</div>
        ${inp('irregular', 'IRR', '')}
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
        <div class="field"><label>계기 (I/T) <button type="button" class="btn sm" id="instAuto" hidden>자동</button></label><input id="instIn" class="mono" inputmode="numeric"></div>
      </div><p class="help" id="calcHelp"></p></div>
      <div class="sec"><h3>비고</h3><textarea data-f="remarks" rows="2">${esc(e.remarks)}</textarea></div>
      ${D.isNew ? '' : '<div class="actions"><button class="btn danger" id="edDelete">이 기록 삭제</button></div>'}`;
  }

  function simForm() {
    const e = D.e;
    const num = (f, label) => `<div class="field"><label>${label}</label><input data-n="${f}" type="number" min="0" max="50" value="${e[f]}" inputmode="numeric"></div>`;
    return `<div class="sec"><h3>시뮬레이터</h3><div class="grid">
        <div class="field"><label>날짜</label><input type="date" data-f="logDate" value="${esc(e.logDate)}"></div>
        <div class="field"><label>기종</label><input data-f="aircraftType" value="${esc(e.aircraftType)}" autocapitalize="characters"></div>
        <div class="field"><label>과목</label><input data-f="flightNumber" value="${esc(e.flightNumber)}" placeholder="Recurrent 등"></div>
        <div class="field"><label>시간</label><input id="simTime" class="mono" inputmode="numeric" value="${L.hmm(e.block)}"></div>
      </div></div>
      <div class="sec"><h3>이착륙</h3><div class="grid">${num('takeoffs', '이륙')}${num('landings', '착륙')}${num('nightTakeoffs', '그중 야간 이륙')}${num('nightLandings', '그중 야간 착륙')}</div></div>
      <div class="sec"><h3>비고</h3><textarea data-f="remarks" rows="2">${esc(e.remarks)}</textarea></div>
      ${D.isNew ? '' : '<div class="actions"><button class="btn danger" id="edDelete">이 기록 삭제</button></div>'}`;
  }

  function bindEditor() {
    const body = $('edBody'), e = D.e;
    body.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => {
      const f = el.dataset.f;
      e[f] = ['flightNumber', 'aircraftType', 'registration', 'irregular'].includes(f) && !e.isSimulator ? el.value.toUpperCase().trim() : el.value;
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
      const ni = $('nightIn'), ii = $('instIn');
      if (document.activeElement !== ni) ni.value = L.hmm(e.night);
      if (document.activeElement !== ii) ii.value = L.hmm(e.instrument);
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
    let target = e;
    if (D.isNew && !e.isSimulator) {
      const dup = live().find(x => x.id !== e.id && !x.isSimulator && x.logDate === e.logDate && x.flightNumber === e.flightNumber);
      if (dup && confirm(`${e.logDate} ${e.flightNumber} 기록이 이미 있습니다.\n\n[확인] 기존 기록을 이 내용으로 업데이트\n[취소] 새 기록으로 따로 추가`)) {
        target = Object.assign({}, e, { id: dup.id, createdAt: dup.createdAt, registration: e.registration || dup.registration, hasPhoto: dup.hasPhoto });
      }
    }
    target.updatedAt = now;
    if (D.photo) {
      await DB.putPhoto(target.id, D.photo).catch(() => {});
      target.hasPhoto = true;
    }
    await DB.putEntry(target);
    const i = S.entries.findIndex(x => x.id === target.id);
    if (i >= 0) S.entries[i] = target; else S.entries.push(target);
    closeEditor();
    render();
    toast(D && D.isNew ? '저장했습니다.' : '고쳤습니다.');
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
    D = draftFrom(L.newEntry({ isSimulator: true, aircraftType: S.settings.defaultType, logDate: todayIn(S.settings.tz), duty: S.settings.defaultDuty }), { isNew: true, role: 'pm' });
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
    Object.assign(D.e, { flightNumber: r.flightID || D.e.flightNumber || '', origin: r.origin || D.e.origin || '', destination: r.destination || D.e.destination || '',
      out: t.out, off: t.off, on: t.on, in: t.in, source: 'scan', scanRaw: r.raw });
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
    if (rs && (rs.updatedAt || 0) > (S.settings.updatedAt || 0)) {
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
    if (!navigator.onLine) { renderSync(); if (interactive) toast('오프라인입니다. 기록은 이 기기에 저장되어 있고, 인터넷이 되면 동기화합니다.'); return; }
    try {
      if (interactive && !DRIVE.signedIn()) {
        await DRIVE.signIn();
        try { localStorage.setItem('logbook.driveConnected', '1'); } catch (e) { /* 무시 */ }
      }
      if (!DRIVE.signedIn()) { renderSync(); return; }
      S.syncing = true; renderSync();
      const id = await DRIVE.findFile(S.sync.fileId);
      if (id) await applyRemote(L.readBackup(await DRIVE.download(id)));
      const newId = await DRIVE.upload(id, backupText());
      S.sync = { fileId: newId, lastSync: Date.now(), error: '' };
      await DB.set('sync', S.sync);
      if (interactive) toast('구글 드라이브와 맞췄습니다.');
    } catch (err) {
      S.sync.error = err.message;
      if (interactive || !err.needLogin) toast('동기화 실패: ' + err.message, 7000);
    } finally {
      S.syncing = false;
      render();
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
