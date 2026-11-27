/* 조종사 전자 로그북 공통 로직 (브라우저 / Node 공용)
 * - ACARS "AOC OOOI STATUS" 화면 OCR 결과 해석 + BLOCK/FLIGHT 검산
 * - OOOI 시각에 날짜 붙이기 (자정 넘김)
 * - 블록/비행/야간/계기 시간, 90일 이착륙, 누계
 * - JSON 백업, 회사 Flight Log 칸 순서 CSV
 *
 * 시각은 모두 UTC 밀리초(Date.getTime())로 다룹니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LOGBOOK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60000, DAY = 86400000;
  const pad2 = n => (n < 10 ? '0' : '') + n;

  /* ===================== 시간 값 ===================== */

  /** 하루 안의 분 (0~1439) ↔ "HHMM" */
  const clock = {
    fromDigits(d) {
      if (!/^\d{4}$/.test(d)) return null;
      const h = +d.slice(0, 2), m = +d.slice(2);
      return h < 24 && m < 60 ? h * 60 + m : null;
    },
    text: m => pad2(Math.floor(m / 60)) + pad2(m % 60),
    diff: (a, b) => (((b - a) % 1440) + 1440) % 1440,
    add: (a, n) => (((a + n) % 1440) + 1440) % 1440
  };

  /** 345 → "5:45" */
  const hmm = m => { m = Math.max(0, Math.round(m || 0)); return Math.floor(m / 60) + ':' + pad2(m % 60); };

  /** "5:45" "05:45" "0545" "545" "8584:14" → 분 */
  function parseHMM(s) {
    s = String(s || '').trim();
    if (!s) return null;
    let m = /^(\d+):(\d{1,2})$/.exec(s);
    if (m) return +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
    m = /^(\d{3,4})$/.exec(s);
    if (m) { const v = +m[1]; return v % 100 < 60 ? Math.floor(v / 100) * 60 + v % 100 : null; }
    return null;
  }

  /** 시간대별 날짜 문자열 "yyyy-MM-dd" */
  function dateIn(ms, tz) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms));
    const g = t => p.find(x => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }

  /** "2026-11-25" → 그날 정오 UTC 근처 (정렬·90일 계산용, 시간대 오차 무시 가능) */
  const dateNoon = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 3) : null; };

  /** UTC "MM/dd HH:mm" (회사 R/O·R/I 형식) */
  const companyStamp = ms => { const d = new Date(ms); return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
  const zulu = ms => { const d = new Date(ms); return pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()); };

  /* ===================== 공항 ===================== */

  const KST = 'Asia/Seoul', JST = 'Asia/Tokyo', CST = 'Asia/Shanghai', ICT = 'Asia/Ho_Chi_Minh', THA = 'Asia/Bangkok', PHT = 'Asia/Manila', TWN = 'Asia/Taipei';
  // [ICAO, IATA, 위도, 경도, 시간대] — 야간 계산용이라 소수 둘째 자리면 충분
  const AIRPORTS = [
    ['RKSI', 'ICN', 37.4602, 126.4407, KST], ['RKSS', 'GMP', 37.5583, 126.7906, KST], ['RKPC', 'CJU', 33.5113, 126.4930, KST],
    ['RKPK', 'PUS', 35.1795, 128.9382, KST], ['RKJJ', 'KWJ', 35.1264, 126.8089, KST], ['RKTU', 'CJJ', 36.7166, 127.4991, KST],
    ['RKTN', 'TAE', 35.8941, 128.6589, KST], ['RKPU', 'USN', 35.5935, 129.3518, KST], ['RKJY', 'RSU', 34.8423, 127.6169, KST],
    ['RKJB', 'MWX', 34.9914, 126.3828, KST], ['RKNY', 'YNY', 38.0613, 128.6692, KST], ['RKTH', 'KPO', 35.9879, 129.4204, KST],
    ['RKPS', 'HIN', 35.0886, 128.0703, KST], ['RKNW', 'WJU', 37.4381, 127.9604, KST],
    ['RJCC', 'CTS', 42.7752, 141.6923, JST], ['RJCH', 'HKD', 41.7700, 140.8219, JST], ['RJBB', 'KIX', 34.4320, 135.2304, JST],
    ['RJBE', 'UKB', 34.6328, 135.2239, JST], ['RJAA', 'NRT', 35.7720, 140.3929, JST], ['RJTT', 'HND', 35.5494, 139.7798, JST],
    ['RJGG', 'NGO', 34.8584, 136.8054, JST], ['RJFF', 'FUK', 33.5859, 130.4511, JST], ['ROAH', 'OKA', 26.1958, 127.6459, JST],
    ['RJSS', 'SDJ', 38.1397, 140.9170, JST], ['RJSN', 'KIJ', 37.9559, 139.1206, JST], ['RJOT', 'TAK', 34.2142, 134.0156, JST],
    ['RJOB', 'OKJ', 34.7569, 133.8553, JST], ['RJOA', 'HIJ', 34.4361, 132.9194, JST], ['RJOM', 'MYJ', 33.8272, 132.6997, JST],
    ['RJNK', 'KMQ', 36.3946, 136.4065, JST], ['RJNS', 'FSZ', 34.7960, 138.1894, JST], ['RJFK', 'KOJ', 31.8034, 130.7194, JST],
    ['RJFM', 'KMI', 31.8772, 131.4486, JST], ['RJFT', 'KMJ', 32.8373, 130.8551, JST], ['RJFU', 'NGS', 32.9169, 129.9136, JST],
    ['ZBAA', 'PEK', 40.0801, 116.5846, CST], ['ZBAD', 'PKX', 39.5098, 116.4105, CST], ['ZSPD', 'PVG', 31.1443, 121.8083, CST],
    ['ZSSS', 'SHA', 31.1979, 121.3363, CST], ['ZGGG', 'CAN', 23.3924, 113.2988, CST], ['ZGSZ', 'SZX', 22.6393, 113.8107, CST],
    ['ZSQD', 'TAO', 36.3617, 120.0881, CST], ['ZSYT', 'YNT', 37.6572, 120.9872, CST], ['ZSWH', 'WEH', 37.1871, 122.2290, CST],
    ['ZYTL', 'DLC', 38.9657, 121.5386, CST], ['ZYTX', 'SHE', 41.6398, 123.4834, CST], ['ZYCC', 'CGQ', 43.9962, 125.6850, CST],
    ['ZYHB', 'HRB', 45.6234, 126.2503, CST], ['ZYYJ', 'YNJ', 42.8828, 129.4513, CST], ['ZSNJ', 'NKG', 31.7420, 118.8620, CST],
    ['ZSHC', 'HGH', 30.2295, 120.4344, CST], ['ZUUU', 'CTU', 30.5785, 103.9471, CST], ['ZUTF', 'TFU', 30.3125, 104.4442, CST],
    ['ZGHA', 'CSX', 28.1892, 113.2200, CST], ['ZLXY', 'XIY', 34.4471, 108.7516, CST], ['ZUCK', 'CKG', 29.7192, 106.6417, CST],
    ['ZHHH', 'WUH', 30.7838, 114.2081, CST], ['ZJSY', 'SYX', 18.3029, 109.4122, CST],
    ['VHHH', 'HKG', 22.3080, 113.9185, 'Asia/Hong_Kong'], ['VMMC', 'MFM', 22.1496, 113.5916, 'Asia/Macau'],
    ['RCTP', 'TPE', 25.0777, 121.2328, TWN], ['RCSS', 'TSA', 25.0694, 121.5525, TWN], ['RCKH', 'KHH', 22.5771, 120.3500, TWN],
    ['VVTS', 'SGN', 10.8188, 106.6519, ICT], ['VVNB', 'HAN', 21.2212, 105.8072, ICT], ['VVDN', 'DAD', 16.0439, 108.1994, ICT],
    ['VVCR', 'CXR', 11.9982, 109.2194, ICT], ['VVPQ', 'PQC', 10.1698, 103.9931, ICT],
    ['VTBS', 'BKK', 13.6900, 100.7501, THA], ['VTBD', 'DMK', 13.9126, 100.6067, THA], ['VTSP', 'HKT', 8.1132, 98.3169, THA],
    ['VTCC', 'CNX', 18.7668, 98.9626, THA], ['RPLL', 'MNL', 14.5086, 121.0198, PHT], ['RPVM', 'CEB', 10.3075, 123.9794, PHT],
    ['RPLC', 'CRK', 15.1860, 120.5603, PHT], ['WSSS', 'SIN', 1.3644, 103.9915, 'Asia/Singapore'],
    ['WMKK', 'KUL', 2.7456, 101.7099, 'Asia/Kuala_Lumpur'], ['WBKK', 'BKI', 5.9372, 116.0510, 'Asia/Kuching'],
    ['WIII', 'CGK', -6.1256, 106.6559, 'Asia/Jakarta'], ['WADD', 'DPS', -8.7482, 115.1672, 'Asia/Makassar'],
    ['VLVT', 'VTE', 17.9883, 102.5633, 'Asia/Vientiane'], ['ZMCK', 'ULN', 47.6469, 106.8195, 'Asia/Ulaanbaatar'],
    ['PGUM', 'GUM', 13.4834, 144.7960, 'Pacific/Guam'], ['PGSN', 'SPN', 15.1190, 145.7290, 'Pacific/Saipan'],
    ['UHWW', 'VVO', 43.3990, 132.1480, 'Asia/Vladivostok'], ['UHHH', 'KHV', 48.5280, 135.1883, 'Asia/Vladivostok'],
    ['UAAA', 'ALA', 43.3521, 77.0405, 'Asia/Almaty'], ['UTTT', 'TAS', 41.2579, 69.2812, 'Asia/Tashkent'],
    ['VIDP', 'DEL', 28.5562, 77.1000, 'Asia/Kolkata']
  ].map(([icao, iata, lat, lon, tz]) => ({ icao, iata, lat, lon, tz }));

  /** 공항 목록. extra(직접 추가한 공항)가 기본값을 덮어씀 */
  function airportDB(extra) {
    const byICAO = new Map(), byIATA = new Map();
    for (const a of AIRPORTS.concat(extra || [])) {
      const x = { icao: String(a.icao).toUpperCase(), iata: String(a.iata || '').toUpperCase(), lat: +a.lat, lon: +a.lon, tz: a.tz || 'UTC' };
      byICAO.set(x.icao, x);
      if (x.iata) byIATA.set(x.iata, x);
    }
    return {
      get(code) { const c = String(code || '').trim().toUpperCase(); return byICAO.get(c) || byIATA.get(c) || null; },
      prefix(p) { p = String(p || '').toUpperCase(); return p ? [...byICAO.values()].filter(a => a.icao.startsWith(p)) : []; },
      display(icao) { const a = this.get(icao); return a ? (a.iata || a.icao) : (icao || ''); },
      all: () => [...byICAO.values()].sort((a, b) => a.icao.localeCompare(b.icao)),
      size: byICAO.size
    };
  }

  /* ===================== OCR 글자 보정 ===================== */

  const TO_DIGIT = { O: '0', o: '0', 'Ø': '0', 'ø': '0', D: '0', Q: '0', '°': '0', I: '1', l: '1', '|': '1', i: '1', '!': '1', ']': '1', '[': '1',
    Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', T: '7', A: '4', g: '9', q: '9' };
  const TO_LETTER = { '0': 'O', 'Ø': 'O', 'ø': 'O', '1': 'I', '|': 'I', '5': 'S', '8': 'B', '6': 'G', '2': 'Z' };

  /** 숫자 칸: 숫자처럼 보이는 글자를 숫자로. 숫자가 아닌 게 남으면 null */
  function digits(s) {
    let out = '';
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') out += ch;
      else if (TO_DIGIT[ch]) out += TO_DIGIT[ch];
      else return null;
    }
    return out;
  }
  /** 영문 칸: 대문자로, 글자처럼 보이는 숫자를 글자로. A-Z 외가 남으면 null */
  function letters(s) {
    let out = '';
    for (const ch of s) {
      const c = TO_LETTER[ch] || ch.toUpperCase();
      if (!/^[A-Z]$/.test(c)) return null;
      out += c;
    }
    return out;
  }
  function labelKey(s) {
    let out = '';
    for (const ch of s) { const c = TO_LETTER[ch] || ch.toUpperCase(); if (/^[A-Z]$/.test(c)) out += c; }
    return out;
  }
  function editDistance(a, b) {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  /* ===================== 값 해석기 ===================== */

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const nosp = s => String(s).replace(/\s+/g, '');

  const parse = {
    /** "2319Z" "Ø5Ø4Z" "2341" → 분 */
    zulu(raw) {
      let s = nosp(raw);
      if (s.length === 5 && /[Zz2]$/.test(s)) s = s.slice(0, 4);
      if (s.length !== 4) return null;
      const d = digits(s);
      return d == null ? null : clock.fromDigits(d);
    },
    /** 화면 UTC "Ø5Ø9" */
    clock(raw) {
      const s = nosp(raw);
      if (s.length !== 4) return null;
      const d = digits(s);
      return d == null ? null : clock.fromDigits(d);
    },
    /** "Ø545" → 345 */
    duration(raw) {
      const s = nosp(raw).replace(':', '');
      if (s.length !== 4) return null;
      const d = digits(s);
      if (d == null || +d % 100 >= 60) return null;
      return Math.floor(+d / 100) * 60 + (+d % 100);
    },
    /** "OZØ731" → "OZ731" */
    flightID(raw) {
      const s = [...nosp(raw)];
      if (s.length < 3 || s.length > 7) return null;
      const isZero = c => c === '0' || c === 'Ø' || c === 'ø';
      const isLetter = c => /[A-Za-z]/.test(c);
      let prefix = '';
      for (let i = 0; i < 2; i++) {
        const ch = s[i], other = s[1 - i];
        if (isZero(ch) && isLetter(other)) prefix += 'O';
        else { const u = ch.toUpperCase(); if (!/^[A-Z0-9]$/.test(u)) return null; prefix += u; }
      }
      if (!/[A-Z]/.test(prefix)) {
        // "OZ"를 "02"로 읽은 경우: 항공사 코드는 대개 영문이므로 글자로 되돌림
        const asLetters = letters(prefix);
        if (!asLetters) return null;
        prefix = asLetters;
      }
      let rest = s.slice(2).join(''), suffix = '';
      const last = rest.slice(-1);
      if (/[A-Za-z]/.test(last) && !'OoIlSZBDQ'.includes(last)) { suffix = last.toUpperCase(); rest = rest.slice(0, -1); }
      if (rest.length < 1 || rest.length > 4) return null;
      const d = digits(rest);
      return d == null ? null : prefix + (+d) + suffix;
    },
    /** "RKSI/VVTS" → ["RKSI","VVTS"], 잘린 "RKSI/VVT" → ["RKSI","VVT"] */
    route(raw) {
      const parts = nosp(raw).split('/');
      if (parts.length !== 2) return null;
      const a = letters(parts[0]), b = letters(parts[1]);
      return a && a.length === 4 && b != null && b.length <= 4 ? [a, b] : null;
    },
    /** "25NOV26" → {day:25, month:11, year:2026}, 잘린 "25NOV2" → year null */
    screenDate(raw) {
      const s = [...nosp(raw)];
      if (s.length < 5) return null;
      const dd = digits(s.slice(0, 2).join('')), mon = letters(s.slice(2, 5).join(''));
      if (dd == null || !mon || +dd < 1 || +dd > 31) return null;
      let mi = MONTHS.indexOf(mon);
      if (mi < 0) mi = MONTHS.findIndex(m => editDistance(m, mon) <= 1);
      if (mi < 0) return null;
      let year = null;
      if (s.length >= 7) { const yy = digits(s.slice(5, 7).join('')); if (yy != null) year = 2000 + +yy; }
      return { day: +dd, month: mi + 1, year };
    },
    dashes: raw => /-/.test(raw) && /^[-–—_Zz\s]+$/.test(raw)
  };

  /* ===================== OOOI 화면 해석 ===================== */

  const FIELD_LABEL = { flightID: '편명', origin: '출발', destination: '도착', out: 'OUT', off: 'OFF', on: 'ON', in: 'IN', block: 'BLOCK', flight: 'FLIGHT' };
  const TIME_FIELDS = ['out', 'off', 'on', 'in', 'block', 'flight'];
  const note = (field, kind, message) => ({ field, kind, message });

  /**
   * OCR 결과 → 단어. tokens: [{text, x0, y0, x1, y1}] (이미지 기준 0~1, 왼쪽 위 원점)
   * 한 덩어리에 여러 단어가 있으면(“OUT OFF”) 고정폭 글꼴이라 보고 글자 수 비례로 위치를 나눔
   */
  function toWords(tokens) {
    const words = [];
    for (const t of tokens) {
      const chars = [...String(t.text || '')];
      if (!chars.length) continue;
      const cw = (t.x1 - t.x0) / chars.length, midY = (t.y0 + t.y1) / 2, h = t.y1 - t.y0;
      let start = -1;
      for (let i = 0; i <= chars.length; i++) {
        const sp = i === chars.length || /\s/.test(chars[i]);
        if (!sp && start < 0) start = i;
        if (sp && start >= 0) {
          words.push({ text: chars.slice(start, i).join(''), x0: t.x0 + cw * start, x1: t.x0 + cw * i, midY, h });
          start = -1;
        }
      }
    }
    return words;
  }

  const charW = w => (w.x1 - w.x0) / Math.max([...w.text].length, 1);
  const cxOf = w => (w.x0 + w.x1) / 2;
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  /** 같은 줄에서 바로 오른쪽 단어 (사진이 기울어도 되도록 높이 차이를 조금 허용) */
  function rightNeighbor(words, w, maxGapChars) {
    let best = null;
    for (const o of words) {
      if (o === w || o.x0 < w.x1 - charW(w) * 0.5) continue;
      if (Math.abs(o.midY - w.midY) > Math.max(w.h, o.h) * 0.6) continue;
      const gap = o.x0 - w.x1;
      if (gap > charW(w) * maxGapChars) continue;
      if (!best || o.x0 < best.x0) best = o;
    }
    return best;
  }

  /** OCR이 한 단어를 여러 조각으로 낸 경우(“2 3 1 9Z”, “RKSI/” “VVTS”) 붙이기 */
  function mergeFragments(words) {
    const ws = words.map(w => Object.assign({}, w)).sort((a, b) => a.x0 - b.x0);
    let changed = true;
    while (changed) {
      changed = false;
      for (const w of ws) {
        if (w.gone) continue;
        const n = rightNeighbor(ws.filter(o => !o.gone), w, 1.2);
        if (!n || isLabelWord(w.text) || isLabelWord(n.text)) continue;
        const gap = n.x0 - w.x1;
        const slash = w.text.endsWith('/') || n.text.startsWith('/');
        if (slash || gap < Math.min(charW(w), charW(n)) * 0.5) {
          w.text += n.text; w.x1 = n.x1; w.midY = (w.midY + n.midY) / 2; w.h = Math.max(w.h, n.h);
          n.gone = true; changed = true;
        }
      }
    }
    return ws.filter(w => !w.gone);
  }

  const LABEL_WORDS = ['OUT', 'OFF', 'ON', 'IN', 'UTC', 'DATE', 'ID', 'TO', 'FLIGHT', 'BLOCK', 'RETURN', 'ORIG', 'DEST', 'ORIGDEST', 'STATUS', 'OOOI', 'AOC', 'MENU', 'PRINT'];
  function isLabelWord(text) {
    const k = labelKey(text);
    if (!k || k.length !== [...text].length && !/\//.test(text)) return false;
    return LABEL_WORDS.some(t => k === t || (t.length >= 5 && editDistance(k, t) <= 1));
  }

  /** 라벨 찾기 */
  function findLabels(words) {
    const labels = [];
    let header = false;
    const used = new Set();
    const fuzzy = (k, t) => k === t || (t.length >= 5 && editDistance(k, t) <= 1);
    const simple = { OUT: 'out', OFF: 'off', ON: 'on', IN: 'in', UTC: 'utc', DATE: 'date' };
    const flights = [];
    for (const w of words) {
      if (used.has(w)) continue;
      const k = labelKey(w.text);
      const next = rightNeighbor(words, w, 3);
      const nk = next ? next.text.toUpperCase() : '';
      if (fuzzy(k, 'STATUS') || k === 'OOOI') { header = true; continue; }
      if (/^FL[I]?GHT[I][DO]$/.test(k)) { // "FLIGHTID"처럼 붙어서 읽힘
        flights.push({ w, isID: true, span: [w.x0, w.x1] });
        continue;
      }
      if (fuzzy(k, 'FLIGHT')) {
        // "FLIGHT ID" — OCR이 ID를 10, 1D, lD 등으로 읽기도 함
        const isID = next && /^[I1l|][D0O]$/i.test(next.text.trim());
        if (isID) used.add(next);
        flights.push({ w, isID, span: isID ? [w.x0, next.x1] : [w.x0, w.x1] });
        continue;
      }
      if (fuzzy(k, 'RETURN')) {
        if (nk === 'TO' || /RETURNTO/.test(k)) continue; // "RETURN TO <AOC MENU"
        labels.push({ kind: 'return', w, cx: cxOf(w) });
        continue;
      }
      if (k === 'RETURNTO') continue;
      if (fuzzy(k, 'ORIGDEST') || k === 'ORIG') {
        let x1 = w.x1;
        if (k === 'ORIG' && next && labelKey(next.text) === 'DEST') { x1 = next.x1; used.add(next); }
        labels.push({ kind: 'route', w, cx: (w.x0 + x1) / 2 });
        continue;
      }
      if (fuzzy(k, 'BLOCK')) { labels.push({ kind: 'block', w, cx: cxOf(w) }); continue; }
      if (simple[k] && [...w.text].length === k.length) labels.push({ kind: simple[k], w, cx: cxOf(w) });
    }
    // FLIGHT 라벨이 둘이면 위쪽이 FLIGHT ID
    flights.sort((a, b) => a.w.midY - b.w.midY);
    flights.forEach((f, i) => {
      const kind = f.isID || (flights.length === 2 && i === 0) ? 'flightID' : 'flight';
      labels.push({ kind, w: f.w, cx: (f.span[0] + f.span[1]) / 2 });
    });
    return { labels, header };
  }

  /* ---------- 칸별 후보값 (OCR 오독 보정) ---------- */

  // MCDU의 빗금 0(Ø)은 8·9·6으로 자주 읽힘 → 0으로 바꾸는 비용을 낮게
  const CONFUSABLE = { 0: '869', 1: '74', 2: '730', 3: '895', 4: '19', 5: '638', 6: '580', 7: '12', 8: '03695', 9: '8034' };
  const subCost = (from, to) => (to === '0' ? ('896'.includes(from) ? 0.5 : 0.75) : 1);
  const MAX_CAND_COST = 3;

  /** 4자리 숫자 후보 (앞에 붙은 잡티, 뒤의 Z, 빠진 맨앞 0 처리) */
  function fourDigitBases(raw, zSuffix) {
    const s = nosp(raw).replace(/[.,:;'`]/g, '');
    const bases = [];
    const n = s.length;
    const trailCost = tail => !tail.length ? 0 : (zSuffix && tail.length === 1 && /[Zz27]/.test(tail)) ? 0 : tail.length;
    for (let st = 0; st + 4 <= n; st++) {
      const core = digits(s.slice(st, st + 4));
      if (core != null) bases.push({ core, cost: st + trailCost(s.slice(st + 4)) });
    }
    // 맨앞 0(Ø)이 빠진 경우: "5042" → 0504 (+Z를 2로 읽음), "P4533" → 0453
    for (let st = 0; st + 3 <= n; st++) {
      const core = digits('0' + s.slice(st, st + 3));
      const tail = s.slice(st + 3);
      if (core != null) bases.push({ core, cost: 1 + st + (tail.length ? trailCost(tail) : 0.5) });
    }
    return bases.filter(b => b.cost <= MAX_CAND_COST);
  }

  function variants(core, cost, out) {
    const add = (d, c) => { if (c <= MAX_CAND_COST && (!out.has(d) || out.get(d) > c)) out.set(d, c); };
    add(core, cost);
    const ch = [...core];
    for (let i = 0; i < 4; i++) {
      for (const a of CONFUSABLE[ch[i]] || '') {
        const c1 = cost + subCost(ch[i], a);
        const s1 = ch.slice(); s1[i] = a;
        add(s1.join(''), c1);
        for (let j = i + 1; j < 4; j++) {
          for (const b of CONFUSABLE[ch[j]] || '') {
            const s2 = s1.slice(); s2[j] = b;
            add(s2.join(''), c1 + subCost(ch[j], b));
          }
        }
      }
    }
  }

  /** 칸 글자 → Map(값 → 비용). time=시각(분), dur=시간(분) */
  function candidates(kind, raw) {
    const strings = new Map();
    for (const b of fourDigitBases(raw, kind === 'time')) variants(b.core, b.cost, strings);
    const vals = new Map();
    for (const [d, c] of strings) {
      const v = kind === 'time' ? clock.fromDigits(d) : (+d % 100 < 60 ? Math.floor(+d / 100) * 60 + (+d % 100) : null);
      if (v != null && (!vals.has(v) || vals.get(v) > c)) vals.set(v, c);
    }
    return vals;
  }

  /** 비용 0(그대로 읽은) 값 */
  const plainValue = cand => { for (const [v, c] of cand) if (c === 0) return v; return null; };

  function accepts(kind, text) {
    switch (kind) {
      case 'flightID': return parse.flightID(text) != null;
      case 'route': return parse.route(text) != null;
      case 'return': return parse.dashes(text) || /^-+[Z27]?$/i.test(nosp(text)) || candidates('time', text).size > 0;
      case 'utc': return candidates('time', text).size > 0;
      case 'date': return parse.screenDate(text) != null;
      case 'out': case 'off': case 'on': case 'in': return candidates('time', text).size > 0;
      case 'block': case 'flight': return candidates('dur', text).size > 0;
    }
    return false;
  }

  /** 라벨마다 바로 아래(기울기 허용) 값을 짝지음. 단어 하나는 라벨 하나에만 */
  function pairLabels(labels, words) {
    const triples = [];
    for (const l of labels) {
      const lh = l.w.h;
      for (const w of words) {
        if (w === l.w) continue;
        const dy = w.midY - l.w.midY;
        if (dy < lh * 0.45 || dy > lh * 2.8) continue;
        const dx = Math.abs(cxOf(w) - l.cx);
        const span = Math.max(l.w.x1 - l.w.x0, w.x1 - w.x0, 0.12);
        if (dx > span) continue;
        if (!accepts(l.kind, w.text)) continue;
        triples.push({ l, w, score: dx + Math.abs(dy - lh * 1.4) * 0.5 });
      }
    }
    triples.sort((a, b) => a.score - b.score);
    const found = {}, usedW = new Set(), usedL = new Set();
    for (const t of triples) {
      if (usedL.has(t.l) || usedW.has(t.w) || found[t.l.kind]) continue;
      found[t.l.kind] = t.w.text;
      usedL.add(t.l); usedW.add(t.w);
    }
    return found;
  }

  /**
   * OCR 토큰 → OOOI 화면 값
   * 반환: { isOOOIPage, flightID, origin, destination, screenDay, screenMonth, screenYear, screenUTC,
   *        out, off, on, in (하루 중 분), block, flight (분), raw: {칸: OCR 글자}, notes: [{field, kind, message}] }
   */
  function parseOOOI(tokens, opts) {
    opts = opts || {};
    const db = opts.airports || airportDB();
    const r = { isOOOIPage: false, flightID: null, origin: null, destination: null, screenDay: null, screenMonth: null, screenYear: null,
      screenUTC: null, out: null, off: null, on: null, in: null, block: null, flight: null, raw: {}, notes: [], confident: false };

    // 여러 번 읽은 결과(배율·기울기 보정을 달리한 OCR)를 한꺼번에 받을 수 있음
    const sets = Array.isArray(tokens[0]) ? tokens : [tokens];
    const texts = {}; // 칸 → 읽은 글자들
    for (const set of sets) {
      const words = mergeFragments(toWords(set));
      const { labels, header } = findLabels(words);
      if (header) r.isOOOIPage = true;
      const found = pairLabels(labels, words);
      if (TIME_FIELDS.filter(k => found[k]).length >= 3) r.isOOOIPage = true;
      for (const k in found) (texts[k] = texts[k] || []).push(found[k]);
    }
    for (const k in texts) r.raw[k] = texts[k].join(' / ');

    const vote = (k, fn) => {
      const counts = new Map();
      for (const t of texts[k] || []) { const v = fn(t); if (v != null) { const key = JSON.stringify(v); counts.set(key, (counts.get(key) || 0) + 1); } }
      let best = null, n = 0;
      for (const [key, c] of counts) if (c > n) { n = c; best = JSON.parse(key); }
      return best;
    };
    r.flightID = vote('flightID', parse.flightID);
    const d = vote('date', t => { const x = parse.screenDate(t); return x && [x.day, x.month, x.year]; });
    if (d) { r.screenDay = d[0]; r.screenMonth = d[1]; r.screenYear = d[2]; }
    r.screenUTC = vote('utc', t => plainValue(candidates('time', t)));
    // 노선: 두 공항이 목록에 있는 읽기를 우선
    const routes = (texts.route || []).map(parse.route).filter(Boolean);
    routes.sort((a, b) => [b[0], b[1]].filter(c => db.get(c)).length - [a[0], a[1]].filter(c => db.get(c)).length);
    if (routes.length) {
      r.origin = resolveAirport(routes[0][0], 'origin', db, r.notes);
      r.destination = resolveAirport(routes[0][1], 'destination', db, r.notes);
    }
    for (const f of ['flightID', 'origin', 'destination']) {
      if (r[f] == null) r.notes.push(note(f, 'missing', `${FIELD_LABEL[f]}을(를) 읽지 못했습니다`));
    }

    // 시각: 모든 읽기의 후보를 합쳐서 검산으로 고름
    const cand = {};
    for (const k of TIME_FIELDS) {
      if (!texts[k]) { cand[k] = null; continue; }
      const m = new Map();
      for (const t of texts[k]) for (const [v, c] of candidates(k === 'block' || k === 'flight' ? 'dur' : 'time', t)) if (!m.has(v) || m.get(v) > c) m.set(v, c);
      cand[k] = m.size ? m : null;
    }
    r.raw = Object.assign({}, r.raw);
    const sol = solveTimes(r, cand);

    // 화면 UTC는 IN 이후여야 함 (오독이면 버리고 사진 촬영 시각을 씀)
    if (r.screenUTC != null && r.in != null && clock.diff(r.in, r.screenUTC) > 720) r.screenUTC = null;
    r.confident = !!sol && sol.c <= 3 && !r.notes.some(n => n.kind === 'mismatch' || n.kind === 'missing');
    return r;
  }

  /**
   * 사진 기울기(도) 추정: 같은 줄에 있어야 하는 라벨 쌍(OUT–OFF, IN–ON, BLOCK–FLIGHT, RETURN–DATE)으로 계산.
   * aspect = 이미지 가로/세로. 못 구하면 0
   */
  function estimateSkew(tokens, aspect) {
    const words = toWords(tokens);
    const find = key => words.filter(w => labelKey(w.text) === key);
    const pairs = [['OUT', 'OFF'], ['IN', 'ON'], ['BLOCK', 'FLIGHT'], ['RETURN', 'DATE'], ['UTC', 'DATE']];
    const angles = [];
    for (const [a, b] of pairs) {
      for (const wa of find(a)) for (const wb of find(b)) {
        const dx = (cxOf(wb) - cxOf(wa)) * aspect, dy = wb.midY - wa.midY;
        if (dx <= 0.2 * aspect) continue;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (Math.abs(ang) < 15) angles.push(ang);
      }
    }
    return angles.length ? median(angles) : 0;
  }

  // OCR이 서로 헷갈리는 글자 쌍
  const LOOKALIKE = new Set(['IT', 'IL', 'IJ', 'VY', 'VW', 'VU', 'OD', 'OQ', 'OC', 'EF', 'CG', 'BE', 'BR', 'PR', 'KX', 'MN', 'HN', 'SZ']
    .flatMap(p => [p, p[1] + p[0]]));

  function resolveAirport(code, field, db, notes) {
    if (code.length === 4 && !db.get(code)) {
      // 한 글자 오독(RKST→RKSI, VYTS→VVTS): 목록에서 하나로 정해지면 고침
      let near = db.all().filter(a => editDistance(a.icao, code) === 1);
      if (near.length > 1) near = near.filter(a => [...a.icao].some((ch, i) => ch !== code[i] && LOOKALIKE.has(ch + code[i])));
      if (near.length === 1) {
        notes.push(note(field, 'corrected', `${FIELD_LABEL[field]} ${code} → ${near[0].icao} (공항 목록으로 수정)`));
        return near[0].icao;
      }
    }
    if (code.length === 4) {
      if (!db.get(code)) notes.push(note(field, 'unknownAirport', `${code}는 공항 목록에 없습니다. 야간 시간을 계산하려면 설정에서 추가하세요`));
      return code;
    }
    const c = code.length >= 2 ? db.prefix(code) : [];
    if (c.length === 1) {
      notes.push(note(field, 'guessed', `${code}… 가 잘려 ${c[0].icao}로 추정했습니다`));
      return c[0].icao;
    }
    return null;
  }

  /* ---------- BLOCK / FLIGHT 검산으로 가장 그럴듯한 조합 고르기 ---------- */

  const MAX_TAXI = 150, MISSING_COST = 2.5, KEEP = 600;

  /** (시작, 끝, 걸린 시간) 세 칸에서 서로 맞는 조합 목록 */
  function pairCombos(S, E, D) {
    const out = [];
    const push = (s, e, d, c) => out.push({ s, e, d, c });
    if (S && E) {
      for (const [s, cs] of S) for (const [e, ce] of E) {
        const d = clock.diff(s, e);
        if (D) { if (D.has(d)) push(s, e, d, cs + ce + D.get(d)); }
        else push(s, e, d, cs + ce + MISSING_COST);
      }
    } else if (S && D) {
      for (const [s, cs] of S) for (const [d, cd] of D) push(s, clock.add(s, d), d, cs + cd + MISSING_COST);
    } else if (E && D) {
      for (const [e, ce] of E) for (const [d, cd] of D) push(clock.add(e, -d), e, d, ce + cd + MISSING_COST);
    }
    return out.sort((a, b) => a.c - b.c).slice(0, KEEP);
  }

  function solveTimes(r, cand) {
    const B = pairCombos(cand.out, cand.in, cand.block);
    const F = pairCombos(cand.off, cand.on, cand.flight);
    const sols = [];
    for (const b of B) for (const f of F) {
      if (b.d === 0 || f.d === 0 || f.d > b.d) continue;
      if (clock.diff(b.s, f.s) > MAX_TAXI || clock.diff(f.e, b.e) > MAX_TAXI) continue;
      sols.push({ out: b.s, in: b.e, block: b.d, off: f.s, on: f.e, flight: f.d, c: b.c + f.c });
    }
    sols.sort((a, b) => a.c - b.c);

    const missing = k => !cand[k];
    if (!sols.length) {
      // 맞는 조합이 없음: 읽은 그대로(가장 싼 후보) 넣고 표시
      for (const k of TIME_FIELDS) {
        let best = null, bc = Infinity;
        if (cand[k]) for (const [v, c] of cand[k]) if (c < bc) { bc = c; best = v; }
        r[k] = best;
        if (best == null) r.notes.push(note(k, 'missing', `${FIELD_LABEL[k]}을(를) 읽지 못했습니다`));
      }
      const v = r;
      if (TIME_FIELDS.every(k => v[k] != null)) {
        if (clock.diff(v.out, v.in) !== v.block) r.notes.push(note('block', 'mismatch', `IN−OUT(${hmm(clock.diff(v.out, v.in))}) ≠ BLOCK(${hmm(v.block)}). 사진과 비교해 주세요`));
        if (clock.diff(v.off, v.on) !== v.flight) r.notes.push(note('flight', 'mismatch', `ON−OFF(${hmm(clock.diff(v.off, v.on))}) ≠ FLIGHT(${hmm(v.flight)}). 사진과 비교해 주세요`));
        if (!r.notes.some(n => n.kind === 'mismatch')) r.notes.push(note('out', 'mismatch', '지상 이동 시간이 비정상적으로 깁니다. 시각을 확인해 주세요'));
      }
      return null;
    }

    const best = sols[0];
    const rival = sols.find(s => s.c - best.c < 0.5 && TIME_FIELDS.some(k => s[k] !== best[k]));
    const shaky = best.c > 5; // 고친 곳이 너무 많으면 믿기 어려움
    for (const k of TIME_FIELDS) {
      r[k] = best[k];
      const shown = k === 'block' || k === 'flight' ? (m => clock.text(m)) : clock.text;
      if (missing(k)) {
        r.notes.push(note(k, 'derived', `${FIELD_LABEL[k]}은 다른 값으로 계산했습니다 (${shown(best[k])})`));
      } else if (rival && rival[k] !== best[k]) {
        r.notes.push(note(k, 'mismatch', `${FIELD_LABEL[k]}이 ${shown(best[k])}인지 ${shown(rival[k])}인지 애매합니다. 사진과 비교해 주세요`));
      } else if (plainValue(cand[k]) !== best[k]) {
        r.notes.push(shaky
          ? note(k, 'mismatch', `${FIELD_LABEL[k]}: 읽은 글자 “${r.raw[k]}”가 불확실합니다 (${shown(best[k])}로 추정). 사진과 비교해 주세요`)
          : note(k, 'corrected', `${FIELD_LABEL[k]}: 읽은 글자 “${r.raw[k]}” → ${shown(best[k])} (BLOCK/FLIGHT 검산)`));
      }
    }
    return best;
  }

  function checksumsPass(v) {
    if (TIME_FIELDS.some(k => v[k] == null)) return false;
    return clock.diff(v.out, v.in) === v.block && clock.diff(v.off, v.on) === v.flight &&
      clock.diff(v.out, v.off) <= MAX_TAXI && clock.diff(v.on, v.in) <= MAX_TAXI && v.flight <= v.block;
  }

  /* ===================== 날짜 붙이기 ===================== */

  /**
   * MCDU의 DATE는 사진 찍을 때의 UTC 날짜. 화면 DATE+UTC로 기준 시각을 만들고, 없으면 fallback(사진 촬영 시각/지금)
   */
  function referenceTime(r, fallback, fallbackIsCaptureTime) {
    if (r.screenDay == null || r.screenMonth == null) return fallback;
    const fy = new Date(fallback).getUTCFullYear();
    const years = r.screenYear ? [r.screenYear] : [fy - 1, fy, fy + 1];
    const t = r.screenUTC == null ? 23 * 60 + 59 : r.screenUTC;
    const c = years.map(y => Date.UTC(y, r.screenMonth - 1, r.screenDay, 0, t));
    const best = c.reduce((a, b) => (Math.abs(a - fallback) <= Math.abs(b - fallback) ? a : b));
    // 화면 UTC를 못 읽었으면: 촬영 시각이 화면 날짜와 맞을 때는 촬영 시각이 더 정확 (자정 직후 촬영 등)
    if (r.screenUTC == null && fallbackIsCaptureTime && Math.abs(best - fallback) < 1.5 * DAY) return fallback;
    return best;
  }

  /** IN부터 거꾸로: 각 시각을 "다음 시각 이전의 가장 가까운 순간"으로 */
  function resolveTimes(r, reference) {
    let bound = reference;
    const out = {};
    for (const k of ['in', 'on', 'off', 'out']) {
      if (r[k] == null) { out[k] = null; continue; }
      const sod = Math.floor(bound / DAY) * DAY + r[k] * MIN;
      out[k] = sod <= bound ? sod : sod - DAY;
      bound = out[k];
    }
    return out;
  }

  /* ===================== 태양·야간 ===================== */

  const RAD = Math.PI / 180;
  const NIGHT = { civil: -6, sunset: -0.833 };

  /** NOAA 계산식: 태양 고도(도) */
  function sunElevation(ms, lat, lon) {
    const jd = ms / DAY + 2440587.5, t = (jd - 2451545) / 36525;
    const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
    const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * t;
    const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
    const y = Math.tan(eps * RAD / 2) ** 2;
    const eqTime = 4 / RAD * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD) + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
      - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD));
    const utcMin = (((ms % DAY) + DAY) % DAY) / MIN;
    const trueSolar = (((utcMin + eqTime + 4 * lon) % 1440) + 1440) % 1440;
    const ha = trueSolar / 4 - 180;
    const cz = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha * RAD);
    return 90 - Math.acos(Math.min(1, Math.max(-1, cz))) / RAD;
  }

  function greatCircle(a, b, f) {
    const [la1, lo1, la2, lo2] = [a.lat * RAD, a.lon * RAD, b.lat * RAD, b.lon * RAD];
    const d = Math.acos(Math.min(1, Math.max(-1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(lo2 - lo1))));
    if (d < 1e-9) return { lat: a.lat, lon: a.lon };
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, lon: Math.atan2(y, x) / RAD };
  }

  /** 블록 시간 중 야간 분: OFF 전엔 출발 공항, ON 뒤엔 도착 공항, 사이는 대권 항로 위치 */
  function nightTime(times, origin, dest, definition) {
    const thr = NIGHT[definition] != null ? NIGHT[definition] : NIGHT.civil;
    const off = times.off != null ? times.off : times.out, on = times.on != null ? times.on : times.in;
    const total = Math.round((times.in - times.out) / MIN);
    const dark = (ms, p) => sunElevation(ms, p.lat, p.lon) < thr;
    let night = 0;
    for (let i = 0; i < total; i++) {
      const ms = times.out + i * MIN + 30000;
      const p = ms <= off ? origin : ms >= on ? dest : greatCircle(origin, dest, (ms - off) / (on - off));
      if (dark(ms, p)) night++;
    }
    return { minutes: night, takeoffNight: dark(off, origin), landingNight: dark(on, dest) };
  }

  /* ===================== 로그북 기록 ===================== */

  const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

  /**
   * 로그북 한 줄 (회사 Flight Log 칸과 대응)
   * Date=logDate, A/C=aircraftType, HL=registration, FLT NO=flightNumber, Route=origin/destination(ICAO),
   * IRR=irregular, Duty=duty(C/F/I/O), R/O=out, R/I=in, Duty time=block, T/S=flight, N/T=night, I/T=instrument, T/O, L/D
   */
  function newEntry(fields) {
    const now = Date.now();
    return Object.assign({
      id: uuid(), logDate: '', aircraftType: '', registration: '', flightNumber: '', origin: '', destination: '',
      irregular: '', duty: 'C', out: null, off: null, on: null, in: null,
      block: 0, flight: 0, night: 0, instrument: 0, takeoffs: 0, landings: 0, nightTakeoffs: 0, nightLandings: 0,
      nightManual: false, instrumentManual: false, isSimulator: false, remarks: '', source: 'manual',
      fn: 'PIC', instructing: false, examining: false, picName: '', ifr: 0, ifrManual: false, simInst: 0,
      approaches: 0, approachType: '', holding: false, fstdType: '',
      planned: false, schedOut: null, schedIn: null, crew: '', crewList: [], copilotName: '',
      createdAt: now, updatedAt: now, deleted: false
    }, fields || {});
  }

  /**
   * 시각·공항으로 날짜/블록/비행/야간/계기 재계산.
   * opts: { airports, tz('Asia/Seoul'), night('civil'|'sunset'), instrumentRule('flight'|'block'|'manual'), takeoff, landing }
   * takeoff/landing이 true/false면 이착륙 횟수를 정하고, undefined면 기존 값 유지
   */
  function recalc(e, opts) {
    opts = opts || {};
    if (e.isSimulator) return e;
    const db = opts.airports || airportDB();
    if (e.out != null) e.logDate = dateIn(e.out, opts.tz || 'Asia/Seoul');
    if (e.out != null && e.in != null) e.block = Math.max(0, Math.round((e.in - e.out) / MIN));
    if (e.off != null && e.on != null) e.flight = Math.max(0, Math.round((e.on - e.off) / MIN));
    let n = null;
    const o = db.get(e.origin), d = db.get(e.destination);
    if (e.out != null && e.in != null && o && d) n = nightTime(e, o, d, opts.night || 'civil');
    if (n && !e.nightManual) e.night = n.minutes;
    if (!e.instrumentManual) {
      const rule = opts.instrumentRule || 'flight';
      if (rule === 'flight') e.instrument = e.flight;
      else if (rule === 'block') e.instrument = e.block;
    }
    if (!e.ifrManual) {
      const rule = opts.ifrRule || 'block';
      if (rule === 'block') e.ifr = e.block;
      else if (rule === 'flight') e.ifr = e.flight;
    }
    if (e.fn && FUNCTIONS[e.fn]) e.duty = e.instructing && e.fn === 'PIC' ? (opts.instructorDuty || 'C') : FUNCTIONS[e.fn].duty;
    if (opts.takeoff !== undefined) { e.takeoffs = opts.takeoff ? 1 : 0; e.nightTakeoffs = opts.takeoff && n && n.takeoffNight ? 1 : 0; }
    if (opts.landing !== undefined) { e.landings = opts.landing ? 1 : 0; e.nightLandings = opts.landing && n && n.landingNight ? 1 : 0; }
    return e;
  }

  const eventTime = e => (e.out != null ? e.out : e.schedOut != null ? e.schedOut : dateNoon(e.logDate) || e.createdAt);
  // 누계·요건·출력에 넣는 기록: 지운 것과 아직 비행하지 않은 예정 비행(스케줄에서 가져온 것) 제외
  const live = list => list.filter(e => !e.deleted && !e.planned);

  /* ===================== 누계·90일 ===================== */

  /**
   * carry: {total, pic, night, instrument (분), asOf: 'yyyy-MM-dd'} — asOf 이후 기록만 더함
   * range: {from, through} 이 있으면 그 기간만 (carry 무시)
   */
  function totals(entries, carry, range) {
    const t = { flights: 0, total: 0, pic: 0, night: 0, instrument: 0, takeoffs: 0, landings: 0, sims: 0 };
    const useCarry = carry && !range;
    if (useCarry) { t.total = carry.total || 0; t.pic = carry.pic || 0; t.night = carry.night || 0; t.instrument = carry.instrument || 0; }
    for (const e of live(entries)) {
      if (useCarry && carry.asOf && e.logDate <= carry.asOf) continue;
      if (range && range.from && e.logDate < range.from) continue;
      if (range && range.through && e.logDate > range.through) continue;
      if (e.isSimulator) { t.sims++; continue; }
      t.flights++; t.total += e.block; if (e.duty === 'C') t.pic += e.block;
      t.night += e.night; t.instrument += e.instrument; t.takeoffs += e.takeoffs; t.landings += e.landings;
    }
    return t;
  }

  function recency(entries, asOf, windowDays, required) {
    windowDays = windowDays || 90; required = required || 3;
    const win = windowDays * DAY, start = asOf - win;
    const s = { flightTakeoffs: 0, flightLandings: 0, simTakeoffs: 0, simLandings: 0, nightTakeoffs: 0, nightLandings: 0, required, validUntil: null };
    const to = [], ld = [];
    for (const e of live(entries)) {
      const d = eventTime(e);
      if (!(d > start && d <= asOf)) continue;
      if (e.isSimulator) { s.simTakeoffs += e.takeoffs; s.simLandings += e.landings; }
      else { s.flightTakeoffs += e.takeoffs; s.flightLandings += e.landings; s.nightTakeoffs += e.nightTakeoffs; s.nightLandings += e.nightLandings; }
      for (let i = 0; i < e.takeoffs; i++) to.push(d);
      for (let i = 0; i < e.landings; i++) ld.push(d);
    }
    to.sort((a, b) => b - a); ld.sort((a, b) => b - a);
    s.totalTakeoffs = s.flightTakeoffs + s.simTakeoffs;
    s.totalLandings = s.flightLandings + s.simLandings;
    s.isCurrent = s.totalTakeoffs >= required && s.totalLandings >= required;
    if (to.length >= required && ld.length >= required) s.validUntil = Math.min(to[required - 1], ld[required - 1]) + win;
    return s;
  }

  /* ===================== 조종사 역할·경력 단계·기종 ===================== */

  /** 비행에서의 역할 (ICAO/EASA·FAA 공통으로 나눌 수 있게) */
  const FUNCTIONS = {
    PIC: { label: '기장 (PIC)', duty: 'C' },
    SIC: { label: '부기장 (Co-pilot / SIC)', duty: 'F' },
    PICUS: { label: '감독받는 기장 (PICUS)', duty: 'F' },
    RELIEF: { label: '순항 교대 조종사 (Cruise relief)', duty: 'F' },
    DUAL: { label: '교육 받음 (Dual)', duty: 'T' },
    OBS: { label: '옵저버 (시간 미산입)', duty: 'O' }
  };

  /** 예전 기록(회사 Duty 코드만 있는 것)도 역할로 읽기 */
  function fnOf(e) {
    if (e.fn && FUNCTIONS[e.fn]) return e.fn;
    return { C: 'PIC', F: 'SIC', I: 'PIC', O: 'OBS', T: 'DUAL' }[e.duty] || 'PIC';
  }
  const instructingOf = e => (e.instructing != null ? !!e.instructing : e.duty === 'I');

  /** 역할별 시간(분). 기준은 총 비행시간(블록) */
  function functionTime(e) {
    const t = { pic: 0, picus: 0, sic: 0, relief: 0, dual: 0, instructor: 0, examiner: 0 };
    if (e.isSimulator) return t;
    const b = e.block || 0, f = fnOf(e);
    if (f === 'PIC') t.pic = b; else if (f === 'PICUS') t.picus = b; else if (f === 'SIC') t.sic = b;
    else if (f === 'RELIEF') t.relief = b; else if (f === 'DUAL') t.dual = b;
    if (instructingOf(e)) t.instructor = b;
    if (e.examining) t.examiner = b;
    return t;
  }

  /**
   * 경력 단계: [{from:'2014-03-01', title:'부기장', fn:'SIC', aircraftType:'A320', employer:'', instructor:false, examiner:false}]
   * 비행 날짜에 해당하는(가장 최근에 시작한) 단계
   */
  function careerAt(periods, date) {
    let best = null;
    for (const p of periods || []) if (p.from && p.from <= date && (!best || p.from > best.from)) best = p;
    return best;
  }

  /** 기종 정보: 다인 조종(mp), 다발(me), 등급(cls), 터빈 */
  const AIRCRAFT_TYPES = [
    ['A319', 'Airbus A319'], ['A320', 'Airbus A320'], ['A321', 'Airbus A321'], ['A20N', 'Airbus A320neo'], ['A21N', 'Airbus A321neo'],
    ['A330', 'Airbus A330'], ['A332', 'Airbus A330-200'], ['A333', 'Airbus A330-300'], ['A339', 'Airbus A330-900'],
    ['A350', 'Airbus A350'], ['A359', 'Airbus A350-900'], ['A35K', 'Airbus A350-1000'], ['A380', 'Airbus A380'], ['A388', 'Airbus A380-800'],
    ['B737', 'Boeing 737'], ['B738', 'Boeing 737-800'], ['B38M', 'Boeing 737 MAX 8'], ['B744', 'Boeing 747-400'], ['B748', 'Boeing 747-8'],
    ['B763', 'Boeing 767-300'], ['B772', 'Boeing 777-200'], ['B77W', 'Boeing 777-300ER'], ['B77L', 'Boeing 777F'], ['B787', 'Boeing 787'],
    ['B788', 'Boeing 787-8'], ['B789', 'Boeing 787-9'], ['B78X', 'Boeing 787-10'], ['AT76', 'ATR 72-600'], ['DH8D', 'Dash 8 Q400'], ['CRJ9', 'CRJ900'], ['E190', 'Embraer 190']
  ].map(([code, name]) => ({ code, name, mp: true, me: true, cls: 'AMEL', turbine: true }));

  /** 항공사 스케줄의 내부 기종 코드 → 기종 (설정 › 기종에서 따로 정하면 그쪽이 우선) */
  const AIRCRAFT_ALIASES = { '32A': 'A321', '2QA': 'A321', '2QB': 'A321', '3QR': 'A321', '3QP': 'A321', '31P': 'A321' };

  function aircraftInfo(code, custom) {
    const c = String(code || '').toUpperCase().replace(/\s+/g, '');
    const list = (custom || []).concat(AIRCRAFT_TYPES);
    if (!list.some(t => t.code === c) && AIRCRAFT_ALIASES[c]) return aircraftInfo(AIRCRAFT_ALIASES[c], custom);
    return list.find(t => t.code === c) || list.find(t => c && c.startsWith(t.code)) ||
      { code: c, name: c, mp: true, me: true, cls: 'AMEL', turbine: true, guessed: true };
  }

  /* ---------- 거리·FAA 야간 ---------- */

  function distanceNm(a, b) {
    const [la1, lo1, la2, lo2] = [a.lat * RAD, a.lon * RAD, b.lat * RAD, b.lon * RAD];
    const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
    return Math.acos(Math.min(1, Math.max(-1, c))) * 3440.065;
  }

  /** 해 진 시각(직전)과 뜨는 시각(다음) — 태양 고도 −0.833° 기준, 1분 단위 */
  function sunTimes(ms, lat, lon) {
    const up = t => sunElevation(t, lat, lon) > -0.833;
    if (up(ms)) return { up: true };
    let set = null, rise = null;
    for (let t = ms; t > ms - DAY; t -= 5 * MIN) if (up(t)) { set = t; break; }
    if (set != null) { while (up(set + MIN)) set += MIN; set += MIN; }
    for (let t = ms; t < ms + DAY; t += 5 * MIN) if (up(t)) { rise = t; break; }
    if (rise != null) { while (up(rise - MIN)) rise -= MIN; }
    return { up: false, set, rise };
  }

  /** FAA 야간 이착륙 요건(61.57(b))용 야간: 일몰 1시간 후 ~ 일출 1시간 전 */
  function isFaaNight(ms, apt) {
    if (ms == null || !apt) return false;
    const s = sunTimes(ms, apt.lat, apt.lon);
    if (s.up) return false;
    return (s.set == null || ms >= s.set + 60 * MIN) && (s.rise == null || ms <= s.rise - 60 * MIN);
  }

  /** 계기 접근 횟수 (VISUAL은 계기 접근이 아니므로 0) */
  const instApproaches = e => (String(e.approachType || '').toUpperCase() === 'VISUAL' ? 0 : (e.approaches || 0));

  /** 출력·누계에 쓰는 한 비행의 파생 값 */
  function derived(e, ctx) {
    ctx = ctx || {};
    const db = ctx.airports || airportDB();
    const ac = aircraftInfo(e.aircraftType, ctx.aircraft);
    const ft = functionTime(e);
    const o = db.get(e.origin), d = db.get(e.destination);
    const b = e.isSimulator ? 0 : (e.block || 0);
    const xc = !e.isSimulator && o && d && distanceNm(o, d) > 50 ? b : 0;
    const faaNightTo = !e.isSimulator && e.takeoffs > 0 && isFaaNight(e.off != null ? e.off : e.out, o) ? e.takeoffs : 0;
    const faaNightLdg = !e.isSimulator && e.landings > 0 && isFaaNight(e.on != null ? e.on : e.in, d) ? e.landings : 0;
    return {
      ac, ft, xc, faaNightTo, faaNightLdg,
      total: b,
      multiPilot: ac.mp ? b : 0, singleSE: !ac.mp && !ac.me ? b : 0, singleME: !ac.mp && ac.me ? b : 0,
      ifr: e.isSimulator ? 0 : (e.ifr != null ? e.ifr : b),
      fstd: e.isSimulator ? (e.block || 0) : 0,
      dayLdg: e.isSimulator ? 0 : Math.max(0, (e.landings || 0) - (e.nightLandings || 0)),
      nightLdg: e.isSimulator ? 0 : (e.nightLandings || 0)
    };
  }

  /* ---------- 누계 (이월 포함) ---------- */

  /** 누계 항목. 이월 누계 입력과 요약 화면이 같은 목록을 씀 */
  const TOTAL_FIELDS = [
    ['total', '총 비행시간', 'time'], ['pic', '기장 (PIC)', 'time'], ['picus', 'PICUS', 'time'], ['sic', '부기장 (Co-pilot/SIC)', 'time'],
    ['relief', '순항 교대', 'time'], ['dual', '교육 받음 (Dual)', 'time'], ['instructor', '교관 (IP)', 'time'], ['examiner', '평가관', 'time'],
    ['multiPilot', '다인 조종 (Multi-pilot)', 'time'], ['night', '야간', 'time'], ['ifr', 'IFR', 'time'], ['instrument', '실계기', 'time'],
    ['simInst', '모의계기', 'time'], ['xc', '야외 (Cross-country)', 'time'], ['fstd', '시뮬레이터 (FSTD)', 'time'],
    ['landingsDay', '주간 착륙', 'count'], ['landingsNight', '야간 착륙', 'count'], ['approaches', '계기 접근', 'count']
  ];

  /**
   * 누계. carry = 이월 누계 {total, pic, ..., asOf}: asOf 다음 날부터의 기록만 더함
   * range = {from, through}가 있으면 그 기간만 (이월 무시)
   */
  function totalsFull(entries, carry, range, ctx) {
    const t = { flights: 0, sims: 0, takeoffs: 0, landings: 0 };
    TOTAL_FIELDS.forEach(([k]) => { t[k] = 0; });
    const useCarry = carry && !range;
    if (useCarry) TOTAL_FIELDS.forEach(([k]) => { t[k] = +carry[k] || 0; });
    for (const e of live(entries)) {
      if (useCarry && carry.asOf && e.logDate <= carry.asOf) continue;
      if (range && range.from && e.logDate < range.from) continue;
      if (range && range.through && e.logDate > range.through) continue;
      addEntry(t, e, ctx);
    }
    return t;
  }

  function addEntry(t, e, ctx) {
    const x = derived(e, ctx);
    if (e.isSimulator) { t.sims++; t.fstd += x.fstd; return; }
    if (fnOf(e) === 'OBS') return;
    t.flights++;
    t.total += x.total; t.multiPilot += x.multiPilot;
    for (const k of ['pic', 'picus', 'sic', 'relief', 'dual', 'instructor', 'examiner']) t[k] += x.ft[k];
    t.night += e.night || 0; t.ifr += x.ifr; t.instrument += e.instrument || 0; t.simInst += e.simInst || 0; t.xc += x.xc;
    t.landingsDay += x.dayLdg; t.landingsNight += x.nightLdg; t.approaches += instApproaches(e);
    t.takeoffs += e.takeoffs || 0; t.landings += e.landings || 0;
  }

  /* ---------- FAA 최근 비행 요건 ---------- */

  /** FAA 61.57: 야간 90일(이륙 3·완전 정지 착륙 3, 일몰 1시간 후~일출 1시간 전), 계기 6개월(접근 6·체공) */
  function faaCurrency(entries, asOf, ctx) {
    const win = 90 * DAY, start = asOf - win;
    const night = { takeoffs: 0, landings: 0, validUntil: null };
    const to = [], ld = [];
    const asOfD = new Date(asOf);
    const monthStart = Date.UTC(asOfD.getUTCFullYear(), asOfD.getUTCMonth() - 6, 1);
    const inst = { approaches: 0, holding: 0, validUntil: null, from: monthStart };
    const apps = [], holds = [];
    for (const e of live(entries)) {
      const d = eventTime(e);
      if (d > asOf) continue;
      const x = derived(e, ctx);
      const nto = e.isSimulator ? (e.nightTakeoffs || 0) : x.faaNightTo, nld = e.isSimulator ? (e.nightLandings || 0) : x.faaNightLdg;
      if (d > start) { night.takeoffs += nto; night.landings += nld; }
      for (let i = 0; i < nto; i++) to.push(d);
      for (let i = 0; i < nld; i++) ld.push(d);
      if (d >= monthStart) { inst.approaches += instApproaches(e); if (e.holding) inst.holding++; }
      for (let i = 0; i < instApproaches(e); i++) apps.push(d);
      if (e.holding) holds.push(d);
    }
    to.sort((a, b) => b - a); ld.sort((a, b) => b - a); apps.sort((a, b) => b - a); holds.sort((a, b) => b - a);
    night.isCurrent = night.takeoffs >= 3 && night.landings >= 3;
    if (to.length >= 3 && ld.length >= 3) night.validUntil = Math.min(to[2], ld[2]) + win;
    inst.isCurrent = inst.approaches >= 6 && inst.holding >= 1;
    if (apps.length >= 6 && holds.length) {
      const lim = new Date(Math.min(apps[5], holds[0]));
      inst.validUntil = Date.UTC(lim.getUTCFullYear(), lim.getUTCMonth() + 7, 0); // 6개월 뒤 그 달 말일
    }
    return { night, instrument: inst };
  }

  /* ---------- 출력 양식 (ICAO/EASA · FAA · 회사) ---------- */

  const ddmmyy = ms => { const d = new Date(ms); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`; };
  const ymd = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
  const hhmmColon = ms => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };

  /**
   * 양식별 칸 정의. kind: text | time(분) | count. group: 머리글 위 줄. sum: 페이지 합계를 낼 칸의 누계 키
   * row(e, x, ctx) → 그 칸 값
   */
  const FORMATS = {
    icao: {
      name: 'ICAO / EASA (AMC1 FCL.050)',
      note: '시각 UTC · 시간 시:분 · 날짜 일/월/연',
      cols: [
        { key: 'date', group: '1', label: 'Date (dd/mm/yy)', kind: 'text', row: (e) => e.isSimulator ? '' : ddmmyy(e.out) }, // 시뮬레이터는 12번 칸에만
        { key: 'depPlace', group: '2 Departure', label: 'Place', kind: 'text', row: (e) => e.isSimulator ? '' : e.origin },
        { key: 'depTime', group: '2 Departure', label: 'Time', kind: 'text', row: (e) => e.isSimulator || e.out == null ? '' : hhmmColon(e.out) },
        { key: 'arrPlace', group: '3 Arrival', label: 'Place', kind: 'text', row: (e) => e.isSimulator ? '' : e.destination },
        { key: 'arrTime', group: '3 Arrival', label: 'Time', kind: 'text', row: (e) => e.isSimulator || e.in == null ? '' : hhmmColon(e.in) },
        { key: 'acType', group: '4 Aircraft', label: 'Make, model, variant', kind: 'text', row: (e, x) => e.isSimulator ? '' : x.ac.name },
        { key: 'acReg', group: '4 Aircraft', label: 'Registration', kind: 'text', row: (e) => e.isSimulator ? '' : e.registration },
        { key: 'spSE', group: '5 Single-pilot time', label: 'SE', kind: 'time', sum: 'singleSE', row: (e, x) => x.singleSE },
        { key: 'spME', group: '5 Single-pilot time', label: 'ME', kind: 'time', sum: 'singleME', row: (e, x) => x.singleME },
        { key: 'mp', group: '6', label: 'Multi-pilot time', kind: 'time', sum: 'multiPilot', row: (e, x) => x.multiPilot },
        { key: 'total', group: '7', label: 'Total time of flight', kind: 'time', sum: 'total', row: (e, x) => x.total },
        { key: 'picName', group: '8', label: 'Name PIC', kind: 'text', row: (e) => e.isSimulator ? '' : (fnOf(e) === 'PIC' ? 'SELF' : e.picName || '') },
        { key: 'ldgDay', group: '9 Landings', label: 'Day', kind: 'count', sum: 'landingsDay', row: (e, x) => x.dayLdg },
        { key: 'ldgNight', group: '9 Landings', label: 'Night', kind: 'count', sum: 'landingsNight', row: (e, x) => x.nightLdg },
        { key: 'night', group: '10 Operational condition time', label: 'Night', kind: 'time', sum: 'night', row: (e) => e.isSimulator ? 0 : e.night || 0 },
        { key: 'ifr', group: '10 Operational condition time', label: 'IFR', kind: 'time', sum: 'ifr', row: (e, x) => x.ifr },
        { key: 'fnPic', group: '11 Pilot function time', label: 'PIC', kind: 'time', sum: ['pic', 'picus'], row: (e, x) => x.ft.pic + x.ft.picus },
        { key: 'fnCop', group: '11 Pilot function time', label: 'Co-pilot', kind: 'time', sum: ['sic', 'relief'], row: (e, x) => x.ft.sic + x.ft.relief },
        { key: 'fnDual', group: '11 Pilot function time', label: 'Dual', kind: 'time', sum: 'dual', row: (e, x) => x.ft.dual },
        { key: 'fnInstr', group: '11 Pilot function time', label: 'Instructor', kind: 'time', sum: 'instructor', row: (e, x) => x.ft.instructor },
        { key: 'fstdDate', group: '12 FSTD session', label: 'Date', kind: 'text', row: (e) => e.isSimulator ? ddmmyy(dateNoon(e.logDate)) : '' },
        { key: 'fstdType', group: '12 FSTD session', label: 'Type', kind: 'text', row: (e) => e.isSimulator ? [e.aircraftType, e.fstdType].filter(Boolean).join(' ') : '' },
        { key: 'fstdTime', group: '12 FSTD session', label: 'Total time of session', kind: 'time', sum: 'fstd', row: (e, x) => x.fstd },
        { key: 'remarks', group: '13', label: 'Remarks and endorsements', kind: 'text', row: (e) => remarksFor(e, 'icao') }
      ]
    },
    faa: {
      name: 'FAA (14 CFR 61.51)',
      note: '시간은 10진수(시간) · 날짜 연-월-일(UTC)',
      decimal: true,
      cols: [
        { key: 'date', label: 'Date', kind: 'text', row: (e) => e.isSimulator ? e.logDate : ymd(e.out) },
        { key: 'type', group: 'Aircraft', label: 'Make & Model', kind: 'text', row: (e, x) => e.isSimulator ? (e.aircraftType + ' FSTD') : x.ac.name },
        { key: 'ident', group: 'Aircraft', label: 'Ident', kind: 'text', row: (e) => e.isSimulator ? (e.fstdType || 'FSTD') : e.registration },
        { key: 'from', group: 'Route', label: 'From', kind: 'text', row: (e) => e.isSimulator ? '' : e.origin },
        { key: 'to', group: 'Route', label: 'To', kind: 'text', row: (e) => e.isSimulator ? '' : e.destination },
        { key: 'remarks', label: 'Remarks, procedures, maneuvers', kind: 'text', row: (e) => remarksFor(e, 'faa') },
        { key: 'app', label: 'Inst. App.', kind: 'count', sum: 'approaches', row: (e) => instApproaches(e) },
        { key: 'ldgDay', group: 'Landings', label: 'Day', kind: 'count', sum: 'landingsDay', row: (e, x) => x.dayLdg },
        { key: 'ldgNight', group: 'Landings', label: 'Night', kind: 'count', sum: 'landingsNight', row: (e, x) => x.nightLdg },
        { key: 'cat', label: 'Category & Class', kind: 'text', row: (e, x) => e.isSimulator ? '' : x.ac.cls },
        { key: 'me', label: 'Multi-engine', kind: 'time', sum: 'multiEngine', row: (e, x) => e.isSimulator || !x.ac.me ? 0 : x.total },
        { key: 'turbine', label: 'Turbine', kind: 'time', sum: 'turbine', row: (e, x) => e.isSimulator || !x.ac.turbine ? 0 : x.total },
        { key: 'xc', label: 'Cross-country', kind: 'time', sum: 'xc', row: (e, x) => x.xc },
        { key: 'night', label: 'Night', kind: 'time', sum: 'night', row: (e) => e.isSimulator ? 0 : e.night || 0 },
        { key: 'actual', group: 'Instrument', label: 'Actual', kind: 'time', sum: 'instrument', row: (e) => e.isSimulator ? 0 : e.instrument || 0 },
        { key: 'simInst', group: 'Instrument', label: 'Simulated', kind: 'time', sum: 'simInst', row: (e) => e.isSimulator ? 0 : e.simInst || 0 },
        { key: 'fstd', label: 'FFS / FTD', kind: 'time', sum: 'fstd', row: (e, x) => x.fstd },
        { key: 'dual', label: 'Dual received', kind: 'time', sum: 'dual', row: (e, x) => x.ft.dual },
        { key: 'pic', label: 'PIC', kind: 'time', sum: 'pic', row: (e, x) => x.ft.pic },
        { key: 'sic', label: 'SIC', kind: 'time', sum: ['sic', 'picus', 'relief'], row: (e, x) => x.ft.sic + x.ft.picus + x.ft.relief },
        { key: 'cfi', label: 'As flight instructor', kind: 'time', sum: 'instructor', row: (e, x) => x.ft.instructor },
        { key: 'total', label: 'Total duration of flight', kind: 'time', sum: 'total', row: (e, x) => x.total }
      ]
    },
    company: {
      name: '회사 Flight Log',
      note: '날짜는 설정한 기준 시간대, R/O·R/I는 UTC',
      cols: [
        { key: 'date', label: 'Date', kind: 'text', row: (e) => (e.logDate || '').replace(/-/g, '/') },
        { key: 'ac', label: 'A/C', kind: 'text', row: (e) => e.aircraftType },
        { key: 'hl', label: 'HL', kind: 'text', row: (e) => e.registration },
        { key: 'flt', label: 'FLT NO', kind: 'text', row: (e) => e.flightNumber },
        { key: 'route', label: 'Route', kind: 'text', row: (e, x, ctx) => e.isSimulator ? 'SIM' : `${ctx.airports.display(e.origin)}-${ctx.airports.display(e.destination)}` },
        { key: 'irr', label: 'IRR', kind: 'text', row: (e) => e.irregular || '' },
        { key: 'duty', label: 'Duty', kind: 'text', row: (e) => e.duty || '' },
        { key: 'ro', label: 'R/O', kind: 'text', row: (e) => e.out != null ? companyStamp(e.out) : '' },
        { key: 'ri', label: 'R/I', kind: 'text', row: (e) => e.in != null ? companyStamp(e.in) : '' },
        { key: 'block', label: 'Duty time', kind: 'time', sum: 'total', row: (e, x) => x.total },
        { key: 'ts', label: 'T/S', kind: 'time', sum: 'airborne', row: (e) => e.isSimulator ? 0 : e.flight || 0 },
        { key: 'nt', label: 'N/T', kind: 'time', sum: 'night', row: (e) => e.isSimulator ? 0 : e.night || 0 },
        { key: 'it', label: 'I/T', kind: 'time', sum: 'instrument', row: (e) => e.isSimulator ? 0 : e.instrument || 0 },
        { key: 'to', label: 'T/O', kind: 'mark', row: (e) => e.takeoffs > 0 ? '*' : '' },
        { key: 'ld', label: 'L/D', kind: 'mark', row: (e) => e.landings > 0 ? '*' : '' }
      ]
    }
  };

  function remarksFor(e, fmt) {
    const parts = [];
    if (e.isSimulator) parts.push(e.flightNumber || 'FSTD');
    else if (e.flightNumber) parts.push(e.flightNumber);
    const f = fnOf(e);
    if (f === 'PICUS') parts.push('PICUS');
    if (f === 'RELIEF') parts.push('Cruise relief');
    if (instructingOf(e)) parts.push(fmt === 'faa' ? 'Instructing' : 'Instructor');
    if (e.examining) parts.push('Examiner');
    if (e.approaches && e.approachType) parts.push((e.approaches > 1 ? e.approaches + '× ' : '') + e.approachType);
    if (e.holding) parts.push('Hold');
    if (f !== 'PIC' && fmt === 'faa' && e.picName) parts.push('PIC ' + e.picName);
    if (e.remarks) parts.push(e.remarks);
    return parts.join(' · ');
  }

  /**
   * 양식 표 만들기.
   * opts: { format, airports, aircraft, carry, from, through, rowsPerPage }
   * 반환: { format, pages: [{rows, pageTotal, broughtForward, total}], cols }
   * broughtForward 첫 페이지 = 이월 누계 + 출력 시작일 이전 기록
   */
  function buildLog(entries, opts) {
    const fmt = FORMATS[opts.format || 'icao'];
    const ctx = { airports: opts.airports || airportDB(), aircraft: opts.aircraft };
    const all = live(entries).filter(e => fnOf(e) !== 'OBS').sort((a, b) => eventTime(a) - eventTime(b));
    const inRange = e => (!opts.from || e.logDate >= opts.from) && (!opts.through || e.logDate <= opts.through);
    const sums = fmt.cols.filter(c => c.sum);
    const zero = () => Object.fromEntries(sums.map(c => [c.key, 0]));
    const addRow = (acc, e, x) => { for (const c of sums) acc[c.key] += +c.row(e, x, ctx) || 0; };

    // 이월: 이월 누계(기준일까지) + 기준일 이후 ~ 출력 시작 전 기록
    const carry = opts.carry || {};
    const bf = zero();
    // 다발·터빈 누계는 따로 넣지 않았으면 총 시간과 같다고 봄 (대형 항공사 조종사)
    const carryVal = k => (k === 'multiEngine' || k === 'turbine') && carry[k] == null ? +carry.total || 0 : +carry[k] || 0;
    for (const c of sums) bf[c.key] = (Array.isArray(c.sum) ? c.sum : [c.sum]).reduce((a, k) => a + carryVal(k), 0);
    const rows = [];
    for (const e of all) {
      if (carry.asOf && e.logDate <= carry.asOf) continue;
      const x = derived(e, ctx);
      if (opts.from && e.logDate < opts.from) { addRow(bf, e, x); continue; }
      if (!inRange(e)) continue;
      rows.push({ e, cells: fmt.cols.map(c => c.row(e, x, ctx)), x });
    }
    const per = Math.max(1, opts.rowsPerPage || 15);
    const pages = [];
    let running = Object.assign({}, bf);
    for (let i = 0; i < Math.max(rows.length, 1); i += per) {
      const chunk = rows.slice(i, i + per);
      const pageTotal = zero();
      chunk.forEach(r => addRow(pageTotal, r.e, r.x));
      const broughtForward = running;
      const total = Object.fromEntries(Object.keys(pageTotal).map(k => [k, broughtForward[k] + pageTotal[k]]));
      pages.push({ rows: chunk, pageTotal, broughtForward, total });
      running = total;
    }
    return { format: fmt, pages, cols: fmt.cols, rowCount: rows.length };
  }

  /** 칸 값을 글자로: 시간은 시:분(또는 FAA 10진수), 0은 빈칸 */
  function cellText(col, v, fmt, blankZero) {
    if (col.kind === 'time') {
      if (!v && blankZero !== false) return '';
      return fmt && fmt.decimal ? (Math.round(v / 6) / 10).toFixed(1) : hmm(v);
    }
    if (col.kind === 'count') return v ? String(v) : (blankZero === false ? '0' : '');
    return v == null ? '' : String(v);
  }

  function formatCSV(entries, opts) {
    const log = buildLog(entries, Object.assign({}, opts, { rowsPerPage: 1e9 }));
    const esc = s => { s = String(s == null ? '' : s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = log.cols.map(c => (c.group && !/^\d+$/.test(c.group) ? c.group + ' - ' : '') + c.label);
    const lines = [head.map(esc).join(',')];
    for (const p of log.pages) for (const r of p.rows) lines.push(log.cols.map((c, i) => esc(cellText(c, r.cells[i], log.format))).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* ===================== 함께 탄 사람 ===================== */

  const RANK_RE = /\s+(CAP|CPT|CAPT|F\/O|FO|SFO|SIC|PIC)(\([^)]*\))?$/i;

  /** 한 비행에서 함께 탄 사람 이름들 (기장 이름, 함께 탄 조종사, 스케줄 승무원) */
  function crewNamesOf(e) {
    const names = [];
    const key = n => n.toUpperCase().replace(/\s+/g, '');
    const push = (n, fromCrewText) => {
      n = String(n || '').trim();
      // 스케줄 승무원 글자("김부기 F/O(F)")에서만 직급을 뗌
      if (fromCrewText) n = n.replace(RANK_RE, '').replace(/\([^)]*\)$/, '').trim();
      if (n && n.toUpperCase() !== 'SELF' && !names.some(x => key(x) === key(n))) names.push(n);
    };
    push(e.picName);
    String(e.copilotName || '').split(/[,/·]/).forEach(n => push(n));
    if (names.length) return names; // 기장·함께 탄 조종사 칸이 있으면 그것만 (당일 바뀐 사람을 반영)
    if (Array.isArray(e.crewList) && e.crewList.length) e.crewList.forEach(c => push(c.name));
    else String(e.crew || '').split(',').forEach(n => push(n, true));
    return names;
  }

  /**
   * 함께 탄 사람 목록: [{name, count, first, last, ids}] (많이 탄 순)
   * query가 있으면 이름에 그 글자가 든 사람만 (대소문자·띄어쓰기 무시)
   */
  function crewIndex(entries, query) {
    const q = String(query || '').toUpperCase().replace(/\s+/g, '');
    const map = new Map();
    for (const e of live(entries)) {
      if (e.isSimulator) continue;
      for (const n of crewNamesOf(e)) {
        if (q && !n.toUpperCase().replace(/\s+/g, '').includes(q)) continue;
        const k = n.toUpperCase().replace(/\s+/g, '');
        const x = map.get(k) || { name: n, count: 0, first: e.logDate, last: e.logDate, ids: [] };
        x.count++; x.ids.push(e.id);
        if (e.logDate < x.first) x.first = e.logDate;
        if (e.logDate > x.last) x.last = e.logDate;
        map.set(k, x);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1));
  }

  /* ===================== 로그북 목록 보기 (탭·필터·정렬) ===================== */

  const shiftDay = (d, n) => { const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * DAY; return new Date(t).toISOString().slice(0, 10); };

  /** 기간 필터 → [시작일, 종료일] (로그북 날짜 기준, 'yyyy-MM-dd') */
  function periodRange(period, today, from, to) {
    const y = today.slice(0, 4), m = +today.slice(5, 7);
    const monthEnd = (yy, mm) => `${yy}-${pad2(mm)}-${pad2(new Date(Date.UTC(+yy, mm, 0)).getUTCDate())}`;
    switch (period) {
      case 'thisMonth': return [today.slice(0, 7) + '-01', monthEnd(y, m)];
      case 'lastMonth': { const yy = m === 1 ? +y - 1 : +y, mm = m === 1 ? 12 : m - 1; return [`${yy}-${pad2(mm)}-01`, monthEnd(yy, mm)]; }
      case '90d': return [shiftDay(today, -89), today];
      case 'thisYear': return [`${y}-01-01`, `${y}-12-31`];
      case 'custom': return [from || '0000-01-01', to || '9999-12-31'];
      default: return null;
    }
  }

  const FILTER_DEFAULT = { period: '', from: '', to: '', kind: '', fn: '', type: '', apt: '', reg: '', night: false, photo: false };
  const filterActive = f => !!f && Object.keys(FILTER_DEFAULT).some(k => f[k] && f[k] !== FILTER_DEFAULT[k]);

  /** 필터 조건에 맞는지 */
  function matchFilter(e, f, today, display) {
    if (!f) return true;
    const r = periodRange(f.period, today, f.from, f.to);
    if (r && (e.logDate < r[0] || e.logDate > r[1])) return false;
    if (f.kind === 'flight' && e.isSimulator) return false;
    if (f.kind === 'sim' && !e.isSimulator) return false;
    if (f.fn === 'instr' && !instructingOf(e)) return false;
    if (f.fn === 'exam' && !e.examining) return false;
    if (f.fn && FUNCTIONS[f.fn] && (e.isSimulator || fnOf(e) !== f.fn)) return false;
    if (f.type && String(e.aircraftType || '').toUpperCase() !== String(f.type).toUpperCase()) return false;
    if (f.apt) {
      const q = String(f.apt).toUpperCase().trim();
      const codes = [e.origin, e.destination, display ? display(e.origin) : '', display ? display(e.destination) : ''].map(x => String(x || '').toUpperCase());
      if (!codes.some(c => c === q || (q.length >= 2 && c.startsWith(q)))) return false;
    }
    if (f.reg && !String(e.registration || '').toUpperCase().replace(/[\s-]/g, '').includes(String(f.reg).toUpperCase().replace(/[\s-]/g, ''))) return false;
    if (f.night && !(e.night > 0 || e.nightTakeoffs > 0 || e.nightLandings > 0)) return false;
    if (f.photo && !e.hasPhoto) return false;
    return true;
  }

  /** 검색어: 편명·HL·기종·공항·날짜·비고·함께 탄 사람 */
  function matchQuery(e, query, display) {
    const q = String(query || '').trim().toUpperCase();
    if (!q) return true;
    const qn = q.replace(/\s+/g, '');
    return [e.flightNumber, e.registration, e.aircraftType, display ? display(e.origin) : '', display ? display(e.destination) : '', e.origin, e.destination, e.logDate, e.remarks]
      .some(x => String(x || '').toUpperCase().includes(q)) || crewNamesOf(e).some(n => n.toUpperCase().replace(/\s+/g, '').includes(qn));
  }

  /**
   * 로그북 목록.
   * opts: { tab: 'up'(오늘·예정) | 'rec'(기록) | 'all', sort: 'asc' | 'desc', filter, query, today ('yyyy-MM-dd'), now (ms), display }
   * 반환: { items, stale (오늘·예정 탭의 '기록 안 한 지난 비행'), todayIndex (전체 탭에서 '오늘' 구분선 넣을 위치, 없으면 -1), totals }
   */
  function logView(entries, opts) {
    const o = Object.assign({ tab: 'up', sort: 'asc', now: Date.now() }, opts);
    if (!o.display) { const db = airportDB(); o.display = c => db.display(c); }
    const today = o.today || dateIn(o.now, 'Asia/Seoul');
    const staleBefore = o.now - 36 * 3600e3;
    const isStale = e => e.planned && e.logDate < today && (e.schedOut == null || e.schedOut < staleBefore);
    let list = entries.filter(e => !e.deleted);
    let stale = [];
    if (o.tab === 'up') {
      stale = list.filter(isStale);
      list = list.filter(e => (e.planned && !isStale(e)) || (!e.planned && e.logDate === today));
    } else if (o.tab === 'rec') list = list.filter(e => !e.planned);
    const keep = e => matchFilter(e, o.filter, today, o.display) && matchQuery(e, o.query, o.display);
    list = list.filter(keep);
    stale = stale.filter(keep);
    const dir = o.sort === 'desc' ? -1 : 1;
    const cmp = (a, b) => (a.logDate === b.logDate ? eventTime(a) - eventTime(b) : a.logDate < b.logDate ? -1 : 1) * dir;
    list.sort(cmp);
    stale.sort((a, b) => eventTime(b) - eventTime(a));
    let todayIndex = -1;
    if (o.tab === 'all') todayIndex = list.findIndex(e => (dir > 0 ? e.logDate >= today : e.logDate <= today));
    const t = { flights: 0, sims: 0, block: 0, planned: 0, plannedBlock: 0 };
    for (const e of list) {
      if (e.planned) { t.planned++; if (e.schedOut != null && e.schedIn != null) t.plannedBlock += Math.round((e.schedIn - e.schedOut) / MIN); }
      else if (e.isSimulator) t.sims++;
      else { t.flights++; t.block += e.block || 0; }
    }
    return { items: list, stale, todayIndex, totals: t, today };
  }

  /* ===================== 백업·동기화·CSV ===================== */

  const BACKUP_FORMAT = 'pilot-logbook-backup';

  function makeBackup(entries, carry) {
    return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), carryForward: carry || null, entries };
  }

  function readBackup(text) {
    const b = typeof text === 'string' ? JSON.parse(text) : text;
    if (!b || b.format !== BACKUP_FORMAT || !Array.isArray(b.entries)) throw new Error('로그북 백업 파일이 아닙니다.');
    return b;
  }

  /**
   * 두 기기 기록 합치기: 같은 id면 updatedAt이 늦은 쪽. 삭제도 deleted 표시로 전파.
   * 반환: { merged, added, updated } (local 기준으로 바뀐 것 개수)
   */
  function mergeEntries(local, remote) {
    const map = new Map(local.map(e => [e.id, e]));
    let added = 0, updated = 0;
    for (const r of remote) {
      const cur = map.get(r.id);
      if (!cur) { map.set(r.id, r); added++; }
      else if ((r.updatedAt || 0) > (cur.updatedAt || 0)) { map.set(r.id, r); updated++; }
    }
    return { merged: [...map.values()], added, updated };
  }

  const CSV_HEADER = ['Date', 'A/C', 'HL', 'FLT NO', 'Route', 'IRR', 'Duty', 'R/O', 'R/I', 'Block', 'T/S', 'N/T', 'I/T', 'T/O', 'L/D', 'OFF', 'ON', 'SIM', 'Remarks'];

  function toCSV(entries, db) {
    db = db || airportDB();
    const esc = s => { s = String(s == null ? '' : s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [CSV_HEADER.join(',')];
    const sorted = live(entries).sort((a, b) => (a.logDate === b.logDate ? eventTime(a) - eventTime(b) : a.logDate < b.logDate ? -1 : 1));
    for (const e of sorted) {
      const route = e.origin || e.destination ? `${db.display(e.origin)}-${db.display(e.destination)}` : '';
      rows.push([e.logDate.replace(/-/g, '/'), e.aircraftType, e.registration, e.flightNumber, route, e.irregular, e.duty,
        e.out != null ? companyStamp(e.out) : '', e.in != null ? companyStamp(e.in) : '',
        hmm(e.block), hmm(e.flight), hmm(e.night), hmm(e.instrument), e.takeoffs > 0 ? '*' : '', e.landings > 0 ? '*' : '',
        e.off != null ? zulu(e.off) : '', e.on != null ? zulu(e.on) : '', e.isSimulator ? 'Y' : '', e.remarks].map(esc).join(','));
    }
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  return {
    MIN, DAY, clock, hmm, parseHMM, dateIn, dateNoon, companyStamp, zulu,
    AIRPORTS, airportDB, parse, toWords, candidates, parseOOOI, estimateSkew, checksumsPass,
    referenceTime, resolveTimes, sunElevation, nightTime, newEntry, recalc, eventTime, live,
    totals, recency, makeBackup, readBackup, mergeEntries, toCSV, FIELD_LABEL,
    FUNCTIONS, fnOf, instructingOf, functionTime, careerAt, AIRCRAFT_TYPES, AIRCRAFT_ALIASES, aircraftInfo, distanceNm, sunTimes, isFaaNight,
    instApproaches, crewNamesOf, crewIndex, periodRange, FILTER_DEFAULT, filterActive, matchFilter, matchQuery, logView, derived, TOTAL_FIELDS, totalsFull, faaCurrency, FORMATS, buildLog, cellText, formatCSV
  };
});
