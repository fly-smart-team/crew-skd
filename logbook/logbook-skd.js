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

  /** 스캔한 OOOI와 맞는 예정 비행 찾기: 편명이 같고 OUT이 STD 앞뒤 18시간 안 */
  function matchPlanned(entries, flightNumber, out) {
    const fnum = String(flightNumber || '').toUpperCase();
    const cands = entries.filter(e => e.planned && !e.deleted && e.schedOut != null);
    const near = e => out == null || Math.abs(e.schedOut - out) < 18 * 3600e3;
    return cands.find(e => e.flightNumber === fnum && near(e)) ||
      (out != null ? cands.filter(e => Math.abs(e.schedOut - out) < 2 * 3600e3).sort((a, b) => Math.abs(a.schedOut - out) - Math.abs(b.schedOut - out))[0] : null) || null;
  }

  return { roleFrom, importSchedule, matchPlanned };
});
