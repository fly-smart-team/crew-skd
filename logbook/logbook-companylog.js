/* 회사 Flight Log 출력물(사진) → 로그북 기록
 * OCR한 줄 글자를 해석하고, 검산(Duty time = R/I − R/O, T/S ≤ Duty time, 앞뒤 구간 이어짐)으로 오독을 바로잡습니다.
 * 칸: Date · A/C · HL · FLT NO · Route · IRR · Duty · R/O · R/I · Duty time · T/S · N/T · I/T · T/O · L/D
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logbook-core.js'));
  else root.LOGBOOK_COMPANY = factory(root.LOGBOOK);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const MIN = 60000, DAY = 86400000;
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const DIGIT = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', S: '5', s: '5', B: '8', '&': '8', G: '6' };

  /* ---------- 숫자 덩어리 → 후보 ---------- */

  /** "0142" "01:42" "0&55"(→0855) "06:224"(한 자리 더 읽힘) → [{v: 분, cost}] */
  function clockCands(raw) {
    const d = [...String(raw || '')].map(c => (c >= '0' && c <= '9' ? c : DIGIT[c] || '')).join('');
    const out = new Map();
    const add = (s, c) => { if (s.length !== 4) return; const h = +s.slice(0, 2), m = +s.slice(2); if (h < 24 && m < 60) { const v = h * 60 + m; if (!out.has(v) || out.get(v) > c) out.set(v, c); } };
    if (d.length === 4) add(d, 0);
    if (d.length === 3) add('0' + d, 1);
    if (d.length === 5) for (let i = 0; i < 5; i++) add(d.slice(0, i) + d.slice(i + 1), 1); // 한 글자 더 읽힘
    return [...out].map(([v, cost]) => ({ v, cost }));
  }

  /** 시간 칸 4개(Duty time, T/S, N/T, I/T)가 붙어서 읽힌 숫자열 → 가능한 나눔 [{vals:[분×4], cost}] */
  function splitDurations(digits) {
    const res = [];
    const rec = (i, acc, cost) => {
      if (acc.length === 4) { if (i === digits.length) res.push({ vals: acc, cost }); else if (digits.length - i <= 1) res.push({ vals: acc, cost: cost + 1 }); return; }
      for (const len of [3, 4]) {
        const s = digits.slice(i, i + len);
        if (s.length < len) continue;
        const h = +s.slice(0, len - 2), m = +s.slice(len - 2);
        if (m >= 60 || h > 23) continue;
        rec(i + len, acc.concat(h * 60 + m), cost + (len === 4 && s[0] === '0' ? 0.2 : 0));
      }
    };
    rec(0, [], 0);
    return res;
  }

  /* ---------- 한 줄 해석 ---------- */

  const ROW_RE = /^\W*(20\d\d)\W?(\d\d)\W?(\d\d)\W+([AB]\W?\d{3}[A-Z]?)?\W*(\d{4})\W+(\d{1,4}[A-Z]?)\W+([A-Z0-9]{2,4})\W{0,2}([A-Z0-9]{2,4})\W+(?:([A-Z0-9]{1,4})\W+)??([CFIOT¢©])\b\W*(.*)$/i;

  /**
   * 회사 로그 한 줄 → 기록 후보.
   * stars: T/O·L/D 표시 { takeoff, landing } (글자 위치로 알아낸 것, 없으면 줄 끝 '*' 개수로 추정)
   */
  function parseRow(text, opts) {
    opts = opts || {};
    const db = opts.airports || L.airportDB();
    const clean = String(text).replace(/[[\]{}()|'"`,;]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = ROW_RE.exec(clean);
    if (!m) return null;
    const issues = [];
    const [, Y, Mo, Dd, ac, hl, flt, o1, d1, irr, duty, rest0] = m;
    const logDate = `${Y}-${Mo}-${Dd}`;
    const fixApt = code => {
      const c = code.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I');
      if (c.length === 3 && db.get(c)) return c;
      // 한 글자 오독(CWU→CJU), 한 글자 빠짐(CM→CJU), 한 글자 더(KWJI→KWJ)
      const cands = db.all().map(a => a.iata).filter(x => x && x.length === 3 && editDistance(x, c) <= 1);
      return { unsure: c, cands };
    };
    let origin = fixApt(o1), destination = fixApt(d1);

    // 나머지: "10/31 23:02 11/01 01:42 2:40 2:07 0:00 2:05 * *"
    let rest = rest0;
    const starPart = (rest.match(/[*x+°•=]+[\s*x+°•=]*$/) || [''])[0];
    const nStars = (starPart.match(/[*x+°•]/g) || []).length;
    rest = rest.slice(0, rest.length - starPart.length);
    const toks = rest.replace(/[^0-9/:&OoDQIlSB]/g, ' ').trim();
    const slash = [...toks.matchAll(/(\d\d)\/(\d\d)/g)];
    let ro = null, ri = null, block = null, ts = null, nt = null, it = null;
    if (slash.length >= 2) {
      const roMonth = +slash[0][1], roDay = +slash[0][2], riMonth = +slash[1][1], riDay = +slash[1][2];
      const roTimeRaw = toks.slice(slash[0].index + 5, slash[1].index).replace(/\D/g, '');
      const after = toks.slice(slash[1].index + 5).replace(/[^0-9]/g, '');
      const year = +Y;
      const mk = (mon, day, mins) => {
        let y = year;
        if (mon === 12 && +Mo === 1) y--; else if (mon === 1 && +Mo === 12) y++;
        return Date.UTC(y, mon - 1, day) + mins * MIN;
      };
      // R/I 시각(앞 4~5자리) + 시간 4칸 — 검산으로 가장 그럴듯한 조합
      let best = null;
      for (const a of clockCands(roTimeRaw)) {
        for (const riLen of [4, 5, 3]) {
          for (const b of clockCands(after.slice(0, riLen))) {
            const out = mk(roMonth, roDay, a.v), inn = mk(riMonth, riDay, b.v);
            const blk = Math.round((inn - out) / MIN);
            if (blk <= 0 || blk > 20 * 60) continue;
            for (const sp of splitDurations(after.slice(riLen))) {
              const [dt, t, n, i2] = sp.vals;
              let cost = a.cost + b.cost + sp.cost + (riLen === 4 ? 0 : 1);
              if (dt !== blk) cost += 5;
              if (t > dt) cost += 5;
              if (n > dt) cost += 3;
              if (i2 > dt) cost += 3;
              if (t && i2 !== Math.max(0, t - 2) && i2 !== t) cost += 0.5;
              if (!best || cost < best.cost) best = { cost, out, inn, blk, dt, t, n, i2 };
            }
          }
        }
      }
      if (best) {
        ro = best.out; ri = best.inn; block = best.blk; ts = best.t; nt = best.n; it = best.i2;
        if (best.dt !== best.blk) issues.push(`Duty time ${L.hmm(best.dt)} ≠ R/I−R/O ${L.hmm(best.blk)}`);
        if (best.cost >= 3) issues.push('시간 칸 판독이 불확실합니다');
      } else issues.push('R/O·R/I·시간 칸을 읽지 못했습니다');
    } else issues.push('R/O·R/I를 읽지 못했습니다');

    const stars = opts.stars || (nStars >= 2 ? { takeoff: true, landing: true } : nStars === 1 ? { takeoff: true, landing: false, unsure: true } : { takeoff: false, landing: false });
    if (stars.unsure) issues.push('T/O·L/D 표시 위치가 불확실합니다');
    return {
      logDate, aircraftType: (ac || '').replace(/\W/g, '').toUpperCase(), registration: 'HL' + hl, flightNumber: flt.toUpperCase(),
      origin, destination, irregular: irr && !/^[CFIOT]$/i.test(irr) ? irr : '', duty: /[¢©]/.test(duty) ? 'C' : duty.toUpperCase(),
      out: ro, in: ri, block, flight: ts, night: nt, instrument: it, takeoff: !!stars.takeoff, landing: !!stars.landing, issues, text: clean
    };
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return dp[b.length];
  }

  /**
   * 못 읽은 공항 고르기: ① 후보가 하나면 그것 ② 앞뒤 구간(앞 도착 = 다음 출발)과 맞는 것
   * ③ 반대쪽 공항과의 거리로 계산한 예상 비행시간이 실제 Duty time과 가장 가까운 것
   */
  function fixRouteChain(rows, db) {
    db = db || L.airportDB();
    const label = f => (f === 'origin' ? '출발' : '도착');
    const expected = (a, b) => { const A = db.get(a), B = db.get(b); return A && B ? L.distanceNm(A, B) / 420 * 60 + 25 : null; };
    for (let pass = 0; pass < 2; pass++) {
      rows.forEach((r, i) => {
        for (const f of ['origin', 'destination']) {
          const u = r[f];
          if (!u || typeof u !== 'object') continue;
          const nb = f === 'origin' ? (i > 0 ? rows[i - 1].destination : null) : (i + 1 < rows.length ? rows[i + 1].origin : null);
          const other = f === 'origin' ? r.destination : r.origin;
          let pick = null, why = '';
          if (typeof nb === 'string' && (u.cands.includes(nb) || editDistance(nb, u.unsure) <= 2) && (u.cands.length === 0 || u.cands.includes(nb))) { pick = nb; why = '앞뒤 구간'; }
          else if (u.cands.length === 1) { pick = u.cands[0]; why = '공항 목록'; }
          else if (u.cands.length > 1 && typeof other === 'string' && r.block) {
            const sc = u.cands.map(c => ({ c, d: Math.abs((f === 'origin' ? expected(c, other) : expected(other, c)) - r.block) })).filter(x => !isNaN(x.d)).sort((a, b) => a.d - b.d);
            if (sc.length && (sc.length === 1 || sc[1].d - sc[0].d > 30)) { pick = sc[0].c; why = '비행시간으로 판단'; }
          }
          if (pick) { r[f] = pick; if (pick !== u.unsure) r.issues.push(`${label(f)} ${u.unsure} → ${pick} (${why})`); }
          else if (pass === 1) { r[f] = u.unsure; r.issues.push(`${label(f)} ${u.unsure}를 확인하세요`); }
        }
      });
    }
    return rows;
  }

  /* ---------- 전체 ---------- */

  /**
   * OCR 줄들 → { rows, summary }.
   * lines: [{ text, words?: [{text, x0, x1}] }] (words가 있으면 T/O·L/D 칸 위치로 별표를 판단)
   */
  function parseCompanyLog(lines, opts) {
    opts = opts || {};
    const L2 = lines.map(l => (typeof l === 'string' ? { text: l } : l));
    const isRowText = t => /^\W*20\d\d\W?\d\d\W?\d\d/.test(t);
    const isStar = w => /^[*x+°•]+\W*$/.test(String(w.text).trim());
    const cx = w => (w.x0 + w.x1) / 2;
    // 기록 줄마다 마지막 숫자 칸 뒤의 별표 위치
    const starXs = L2.map(l => {
      if (!isRowText(l.text) || !l.words) return null;
      let lastNum = -1;
      l.words.forEach((w, i) => { if (/\d/.test(w.text)) lastNum = i; });
      return l.words.slice(lastNum + 1).filter(isStar).map(cx);
    });
    // T/O·L/D 칸 위치: 표 머리글(같은 줄에 Route·FLT)이 있으면 그것, 없으면 별표 위치를 둘로 나눔
    let toX = null, ldX = null;
    for (const l of L2) {
      if (!/ROUTE|FLT/i.test(l.text)) continue;
      for (const w of l.words || []) {
        const t = String(w.text).toUpperCase();
        if (/^T\W?[O0]$/.test(t)) toX = cx(w);
        if (/^L\W?D$/.test(t)) ldX = cx(w);
      }
    }
    let split = null;
    if (toX != null && ldX != null) split = (toX + ldX) / 2;
    else {
      const xs = starXs.flat().filter(x => x != null).sort((a, b) => a - b);
      let gap = 0, at = null;
      for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > gap) { gap = xs[i] - xs[i - 1]; at = (xs[i] + xs[i - 1]) / 2; }
      if (xs.length >= 2 && gap > 0.015) split = at;
    }
    // L/D 칸이 사진 오른쪽 가장자리에 걸려 있으면 별표를 놓쳤을 수 있음
    const edge = starXs.flat().filter(x => x != null);
    const cutOff = split != null && toX == null && edge.length && Math.max(...edge) > 0.985;
    const rows = [];
    L2.forEach((l, i) => {
      let stars = null;
      if (starXs[i] && split != null) {
        stars = { takeoff: starXs[i].some(x => x < split), landing: starXs[i].some(x => x >= split) };
      }
      const r = parseRow(l.text, Object.assign({}, opts, { stars }));
      if (r) { if (cutOff) r.edge = true; rows.push(r); }
    });
    fixRouteChain(rows, opts.airports);
    rows.forEach(r => { r.ok = !r.issues.some(x => /읽지 못|불확실|확인하세요|≠/.test(x)); });

    // Flight Summary: Total FLT · A320 flight · A320 CAP · CAP flight · Night · Instrument (· FLT in this month)
    const summary = {};
    const all = L2.map(l => l.text).join('\n');
    const fixDigits = t => t.replace(/(\d)([OoDQIlSsBZ&G])(?=\d)/g, (m0, a, c) => a + (DIGIT[c] || DIGIT[c.toUpperCase()] || c));
    const sumLine = L2.map(l => fixDigits(fixDigits(l.text))).find(t => (t.match(/\d{2,5}\s*[:.]\s*\d\d/g) || []).length >= 5 && !/20\d\d[/.-]\d\d[/.-]\d\d/.test(t));
    if (sumLine) {
      const nums = sumLine.match(/\d{1,5}\s*[:.]\s*\d\d/g).map(x => L.parseHMM(x.replace(/\s+/g, '').replace('.', ':')));
      [summary.total, summary.typeTotal, summary.typePic, summary.pic, summary.night, summary.instrument, summary.month] = nums;
    }
    // 최근 1년 Check 현황 (Date · Course · SIM/RTE · Note) 과 T/O & L/D 훈련 (Date · Course · Note)
    const checks = [], training = [];
    for (const l of L2) {
      const t = String(l.text).replace(/[[\]{}|]/g, ' ').replace(/\s+/g, ' ').trim();
      const m = /^\W*(20\d\d)[/.-](\d\d)[/.-](\d\d)\s+(.+)$/.exec(t);
      if (!m || ROW_RE.test(t)) continue;
      const date = `${m[1]}-${m[2]}-${m[3]}`;
      let rest = m[4].replace(/^[^A-Za-z0-9]+/, '');
      if (/[T7]\W?[O0]\s*&\s*L\W?D/i.test(rest)) {
        const note = /SIMULATOR\s*TRAIN\w*/i.test(rest) ? 'SIMULATOR TRAINING' : (rest.split(/[T7]\W?[O0]\s*&\s*L\W?D/i)[1] || '').trim();
        training.push({ date, course: 'T/O & L/D', note });
        continue;
      }
      if (/AFLIS/i.test(rest)) continue;
      const kind = ((/\b(SIM|RTE|FFS|LOE)\b/i.exec(rest) || [])[1] || '').toUpperCase();
      const note = (/\b(SBE|PASS|FAIL)\b/i.exec(rest) || [])[1] || '';
      const course = rest.replace(/\b(SIM|RTE)\b/gi, '').replace(/\b(SBE|PASS|FAIL)\b/i, '').replace(/[;:]+|\s(oo|o|=)\s/g, ' ')
        .replace(/CAT\W?[I1l|][\/I1l|]*/i, 'CAT-I/II/III').replace(/(^|\s)(\d(?:st|nd|rd|th)\s+half\))/i, '$1($2').replace(/\s+/g, ' ').trim();
      if (course.length >= 3) checks.push({ date, course, kind: kind || (/RTE/i.test(course) ? 'RTE' : 'SIM'), note: note.toUpperCase() });
    }
    const based = /AFLIS\D{0,120}(20\d\d)\W(\d\d)\W(\d\d)/i.exec(all);
    if (based) summary.asOf = `${based[1]}-${based[2]}-${based[3]}`;
    return { rows, summary, checks, training, edgeWarning: !!cutOff };
  }

  /** 해석한 줄 → 로그북 기록 */
  function rowToEntry(r, opts) {
    const db = (opts && opts.airports) || L.airportDB();
    const o = db.get(r.origin), d = db.get(r.destination);
    const fn = { C: 'PIC', F: 'SIC', I: 'PIC', O: 'OBS', T: 'DUAL' }[r.duty] || 'PIC';
    const e = L.newEntry({
      logDate: r.logDate, aircraftType: r.aircraftType, registration: r.registration,
      flightNumber: /^\d/.test(r.flightNumber) ? ((opts && opts.airline) || '') + r.flightNumber : r.flightNumber,
      origin: o ? o.icao : r.origin, destination: d ? d.icao : r.destination, irregular: r.irregular,
      fn, instructing: r.duty === 'I', duty: r.duty, out: r.out, in: r.in,
      block: r.block || 0, flight: r.flight || 0, night: r.night || 0, instrument: r.instrument || 0,
      nightManual: true, instrumentManual: true, takeoffs: r.takeoff ? 1 : 0, landings: r.landing ? 1 : 0,
      approaches: 0, approachType: '', source: 'companylog'
    });
    // 야간 이착륙 구분은 회사 로그에 없으므로 태양 위치로 계산
    L.recalc(e, Object.assign({}, opts, { takeoff: r.takeoff, landing: r.landing }));
    e.block = r.block || e.block; e.flight = r.flight || 0; e.night = r.night || 0; e.instrument = r.instrument || 0;
    return e;
  }

  /**
   * Flight Summary 누계에서 이 표의 비행을 뺀 값 = 이 표 첫날 전날까지의 이월 누계
   */
  function carryFromSummary(summary, rows) {
    if (!summary || summary.total == null || !rows.length) return null;
    const first = rows.map(r => r.logDate).sort()[0];
    const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const picRows = rows.filter(r => r.duty === 'C' || r.duty === 'I').reduce((a, r) => a + (r.block || 0), 0);
    const prev = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10)) - DAY).toISOString().slice(0, 10);
    const total = summary.total - sum('block');
    const famRows = rows.filter(r => L.typeFamily(r.aircraftType) === 'A320');
    const famPic = famRows.filter(r => r.duty === 'C' || r.duty === 'I').reduce((a, r) => a + (r.block || 0), 0);
    return {
      total, multiPilot: total, pic: summary.pic != null ? summary.pic - picRows : 0,
      typeName: 'A320',
      typeTotal: summary.typeTotal != null ? summary.typeTotal - famRows.reduce((a, r) => a + (r.block || 0), 0) : 0,
      typePic: summary.typePic != null ? summary.typePic - famPic : 0,
      night: summary.night != null ? summary.night - sum('night') : 0,
      instrument: summary.instrument != null ? summary.instrument - sum('instrument') : 0,
      asOf: prev
    };
  }

  return { clockCands, splitDurations, parseRow, parseCompanyLog, rowToEntry, carryFromSummary };
});
