/* 월간 스케줄(MONTHLY SKD) → 로그북 "예정 비행"
 * 스케줄 엑셀 해석은 저장소의 skd-core.js(캘린더 앱과 공용)를 그대로 씀.
 * 비행 전에 편명·구간·STD/STA·역할·기장 이름을 미리 넣어 두고, 비행 후에는 실제 OOOI만 채우면 됨.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logbook-core.js'), require('../skd-core.js'));
  else root.LOGBOOK_SKD = factory(root.LOGBOOK, root.SKD);
})(typeof self !== 'undefined' ? self : this, function (L, SKD) {
  'use strict';

  /**
   * 스케줄의 POSN(그 비행에서 맡은 자리)·RANK(직급) → 로그북 역할.
   * POSN이 C/F면 그대로 따르고, 모르는 코드면 직급으로 추정하고 확인 표시.
   */
  function roleFrom(posn, rank) {
    const p = String(posn || '').toUpperCase().replace(/\s+/g, ''), r = String(rank || '').toUpperCase().replace(/\s+/g, '');
    if (p === 'C') return { fn: 'PIC', sure: true };
    if (p === 'F') return { fn: 'SIC', sure: true };
    if (/^(CAP|CPT|CAPT|PIC)$/.test(r)) return { fn: 'PIC', sure: false };
    if (/^(F\/O|FO|SFO|SIC|COP)$/.test(r)) return { fn: 'SIC', sure: false };
    return { fn: null, sure: false };
  }

  const isPicSeat = c => String(c.posn || '').toUpperCase() === 'C' || (!c.posn && /^CAP/i.test(c.rank || ''));

  /**
   * opts: { airports, existing (지금 기록들), careers, schedTz ('Asia/Seoul' | 'UTC'), now }
   * 반환: { add: [예정 기록], skipped: 이미 있는 비행 수, updated: [시각이 바뀐 예정 기록], month, me, emp }
   */
  function importSchedule(D, opts) {
    opts = opts || {};
    const db = opts.airports || L.airportDB();
    const offset = opts.schedTz === 'UTC' ? 0 : 9 * 60; // 스케줄 시각 기준 (기본: 한국 시간)
    const existing = (opts.existing || []).filter(e => !e.deleted);
    const add = [], updated = [];
    let skipped = 0;
    for (const leg of D.legs) {
      if (!leg.sector || !/\//.test(leg.sector)) continue; // 휴무·대기 등 비행이 아닌 줄
      const [fromIata, toIata] = leg.sector.split('/').map(s => s.trim().toUpperCase());
      const stdWall = SKD.toTime(D.month, leg.date, leg.std);
      const staWall = stdWall != null ? SKD.toTime(D.month, leg.date, leg.sta, stdWall) : null;
      if (stdWall == null) continue;
      const std = stdWall - offset * L.MIN, sta = staWall != null ? staWall - offset * L.MIN : null;
      const flightNumber = /^\d+$/.test(leg.flight) ? 'OZ' + (+leg.flight) : String(leg.flight).toUpperCase().replace(/\s+/g, '');
      const logDate = L.dateIn(std, opts.tz || 'Asia/Seoul');
      const mine = leg.crew.find(c => c.emp === D.emp) || {};
      const role = roleFrom(mine.posn, mine.rank);
      const career = L.careerAt(opts.careers, logDate);
      const fn = role.fn || (career && career.fn) || 'PIC';
      const pic = fn === 'PIC' ? null : leg.crew.find(c => c.emp !== D.emp && isPicSeat(c));
      const o = db.get(fromIata), d = db.get(toIata);
      const crew = leg.crew.filter(c => c.emp !== D.emp).map(c => `${c.name} ${c.rank}${c.posn ? '(' + c.posn + ')' : ''}`).join(', ');

      const same = existing.find(e => e.flightNumber === flightNumber && e.logDate === logDate);
      if (same) {
        if (same.planned && (same.schedOut !== std || same.schedIn !== sta)) {
          updated.push(Object.assign({}, same, { schedOut: std, schedIn: sta, updatedAt: opts.now || Date.now() }));
        } else skipped++;
        continue;
      }
      add.push(L.newEntry({
        planned: true, source: 'schedule', flightNumber, logDate,
        origin: o ? o.icao : fromIata, destination: d ? d.icao : toIata,
        schedOut: std, schedIn: sta,
        fn, roleSure: role.sure, picName: pic ? pic.name : '', crew,
        aircraftType: (career && career.aircraftType) || opts.defaultType || '',
        duty: L.FUNCTIONS[fn].duty
      }));
    }
    return { add, updated, skipped, month: D.month, me: D.me, emp: D.emp };
  }

  /* ===================== CWP Crew Roster (xlsx) ===================== */

  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const CWP_COLS = ['Flight/Activity', 'From', 'STD', 'To', 'STA', 'A/C', 'Acting rank', 'Duty', 'PIC code', 'Crew ID', 'Name', 'Comment', 'Special Duty Code'];

  /** 어떤 스케줄 양식인지: 'cwp' (Crew Roster Report) | 'skd' (MONTHLY SKD) | null */
  function detectFormat(rows) {
    for (const r of rows.slice(0, 15)) {
      const t = r.map(clean);
      if (t.includes('Flight/Activity') && t.includes('STD') && t.some(x => /^PIC code$/i.test(x))) return 'cwp';
      if (t.includes('DATE') && t.includes('STD')) return 'skd';
    }
    return null;
  }

  /**
   * CWP Crew Roster Report 해석.
   * 첫 줄: "이름 | 사번 | 기단 | 직급" , 머리글: Flight/Activity · From · STD · To · STA · A/C · Acting rank · Duty · PIC code · Crew ID · Name …
   * 비행 줄 아래에 같은 비행의 다른 승무원 줄이 이어짐 (페이지가 바뀌면 머리글이 다시 나오고 이어짐)
   * 셀이 합쳐져 있어 값이 머리글 칸보다 오른쪽에 있을 수 있음 → 다음 머리글 칸 전까지에서 값을 찾음
   */
  function parseCwp(rows) {
    let me = '', emp = '', fleet = '', rank = '', head = null;
    for (const r of rows.slice(0, 5)) {
      const t = r.map(clean).find(x => /\|/.test(x));
      if (t) { [me, emp, fleet, rank] = t.split('|').map(x => x.trim()); break; }
    }
    const legs = [];
    let cur = null;
    for (const r of rows) {
      const t = r.map(clean);
      if (t.includes('Flight/Activity')) { // 머리글 (페이지마다 반복)
        head = {};
        CWP_COLS.forEach(name => { const i = t.findIndex(x => x.toLowerCase() === name.toLowerCase()); if (i >= 0) head[name] = i; });
        continue;
      }
      if (!head || !t.some(Boolean)) continue;
      const starts = Object.values(head).sort((a, b) => a - b);
      const get = name => {
        const i = head[name];
        if (i == null) return '';
        const end = starts.find(x => x > i) || t.length;
        for (let j = i; j < end; j++) if (t[j]) return t[j];
        return '';
      };
      const crew = { emp: get('Crew ID'), name: get('Name'), rank: get('Acting rank'), code: get('PIC code'), duty: get('Duty'), special: get('Special Duty Code') };
      const flight = get('Flight/Activity');
      if (flight) {
        cur = { flight, from: get('From'), to: get('To'), std: get('STD'), sta: get('STA'), ac: get('A/C'), comment: get('Comment'), crew: [] };
        legs.push(cur);
      }
      if (cur && (crew.emp || crew.name)) cur.crew.push(crew);
    }
    const first = legs.find(l => /^\d{4}-\d{2}/.test(l.std));
    const month = first ? first.std.slice(0, 4) + first.std.slice(5, 7) : '';
    return { format: 'cwp', me, emp, fleet, rank, month, legs };
  }

  /** "2026-12-01 19:15" (그 공항 현지 시각) → UTC ms */
  function localToUtc(text, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(text || '');
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const off = ms => {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
      const g = k => +p.find(x => x.type === k).value;
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms;
    };
    let utc = wall - off(wall);
    utc = wall - off(utc); // 서머타임 경계 보정
    return utc;
  }

  /** CWP의 PIC code → 역할. P1 기장, F1 부기장, 그 밖(P2·F2 등 교대·추가 승무)은 추정 */
  function roleFromCode(code, rank) {
    const c = String(code || '').toUpperCase().replace(/\s+/g, '');
    if (c === 'P1') return { fn: 'PIC', sure: true };
    if (c === 'F1') return { fn: 'SIC', sure: true };
    if (/^[PF][2-9]$/.test(c)) return { fn: 'RELIEF', sure: false };
    const r = roleFrom('', rank);
    return { fn: r.fn, sure: false };
  }

  const splitFlight = f => {
    const m = /^([A-Z0-9]{2}?)(\d{1,4})([A-Z]?)$/.exec(String(f || '').toUpperCase().replace(/\s+/g, ''));
    return m ? m[1] + (+m[2]) : String(f || '').toUpperCase().replace(/\s+/g, '');
  };

  function importCwp(P, opts) {
    opts = opts || {};
    const db = opts.airports || L.airportDB();
    const existing = (opts.existing || []).filter(e => !e.deleted);
    const add = [], updated = [], other = [];
    let skipped = 0;
    for (const leg of P.legs) {
      const mine = leg.crew.find(c => c.emp === P.emp) || leg.crew[0] || {};
      const duty = String(mine.duty || '').toUpperCase();
      if (duty && duty !== 'FLY') { other.push(`${leg.flight} (${duty})`); continue; } // 편승·대기·교육 등
      const o = db.get(leg.from), d = db.get(leg.to);
      if (!o || !d) { other.push(`${leg.flight} (공항 ${!o ? leg.from : leg.to} 모름)`); continue; }
      const std = localToUtc(leg.std, o.tz), sta = localToUtc(leg.sta, d.tz);
      if (std == null) continue;
      const flightNumber = splitFlight(leg.flight);
      const logDate = L.dateIn(std, opts.tz || 'Asia/Seoul');
      const role = roleFromCode(mine.code, mine.rank);
      const career = L.careerAt(opts.careers, logDate);
      const fn = role.fn || (career && career.fn) || 'PIC';
      const pic = fn === 'PIC' ? null : leg.crew.find(c => c.emp !== P.emp && String(c.code).toUpperCase() === 'P1');
      const acMapped = (opts.aircraft || []).find(t => t.code === String(leg.ac).toUpperCase());
      const crew = leg.crew.filter(c => c.emp !== P.emp).map(c => `${c.name} ${c.rank}${c.code ? '(' + c.code + ')' : ''}`).join(', ');
      const same = existing.find(e => e.flightNumber === flightNumber && e.logDate === logDate);
      if (same) {
        if (same.planned && (same.schedOut !== std || same.schedIn !== sta)) updated.push(Object.assign({}, same, { schedOut: std, schedIn: sta, updatedAt: opts.now || Date.now() }));
        else skipped++;
        continue;
      }
      add.push(L.newEntry({
        planned: true, source: 'schedule', flightNumber, logDate, origin: o.icao, destination: d.icao,
        schedOut: std, schedIn: sta, schedFlight: leg.flight, acCode: leg.ac,
        fn, roleSure: role.sure, picName: pic ? pic.name : '', crew,
        instructing: /INS|IP|TRI|LTC/i.test(mine.special || ''), examining: /EXA|TRE|CHK|EXAM/i.test(mine.special || ''),
        aircraftType: acMapped ? acMapped.code : L.AIRCRAFT_ALIASES[String(leg.ac).toUpperCase()] || (career && career.aircraftType) || opts.defaultType || '',
        duty: L.FUNCTIONS[fn].duty
      }));
    }
    return { format: 'cwp', add, updated, skipped, other, month: P.month, me: P.me, emp: P.emp };
  }

  /** 엑셀 행(sheet_to_json header:1) → 예정 비행. 양식 자동 판별 */
  function importRoster(rows, opts) {
    const fmt = detectFormat(rows);
    if (fmt === 'cwp') return importCwp(parseCwp(rows), opts);
    if (fmt === 'skd') return Object.assign(importSchedule(SKD.parseSkd(rows), opts), { format: 'skd', other: [] });
    throw new Error('알 수 있는 스케줄 양식이 아닙니다 (MONTHLY SKD 또는 Crew Roster Report).');
  }

  /** 스캔한 OOOI와 맞는 예정 비행 찾기: 편명이 같고 OUT이 STD 앞뒤 18시간 안 */
  function matchPlanned(entries, flightNumber, out) {
    const fnum = splitFlight(flightNumber);
    const cands = entries.filter(e => e.planned && !e.deleted && e.schedOut != null);
    const near = e => out == null || Math.abs(e.schedOut - out) < 18 * 3600e3;
    return cands.find(e => splitFlight(e.flightNumber) === fnum && near(e)) ||
      (out != null ? cands.filter(e => Math.abs(e.schedOut - out) < 2 * 3600e3).sort((a, b) => Math.abs(a.schedOut - out) - Math.abs(b.schedOut - out))[0] : null) || null;
  }

  return { roleFrom, roleFromCode, importSchedule, matchPlanned, detectFormat, parseCwp, importCwp, importRoster, localToUtc };
});
