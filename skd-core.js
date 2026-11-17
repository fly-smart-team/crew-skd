/* crew-skd core: MONTHLY SKD 엑셀 행 → 캘린더 일정. 브라우저(window.SKD)와 Node(require) 양쪽에서 사용. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const p2 = n => String(n).padStart(2, '0');

  /** rows: sheet_to_json(header:1) 결과 */
  function parseSkd(rows) {
    let emp = '', month = '';
    rows.forEach(r => r.forEach((c, i) => {
      const s = norm(c);
      const next = () => { for (let j = i + 1; j < r.length; j++) { const v = norm(r[j]); if (v) return v; } return ''; };
      if (/^EMPL\s*:/i.test(s) && !emp) emp = next();
      if (/^MONTH\s*:/i.test(s) && !month) month = next();
    }));
    if (!/^\d{6}$/.test(month)) throw new Error('MONTH(YYYYMM)를 찾지 못했습니다');
    const h = rows.findIndex(r => { const n = r.map(norm); return n.includes('DATE') && n.includes('STD'); });
    if (h < 0) throw new Error('헤더(DATE/STD)를 찾지 못했습니다');
    const hdr = rows[h].map(norm), col = n => hdr.indexOf(n);
    const C = { date: col('DATE'), fl: col('FLIGHT'), show: col('SHOW UP'), sec: col('SECTOR'), std: col('STD'), sta: col('STA'),
      emp: col('EMPL'), name: col('NAME'), rank: col('RANK'), posn: col('POSN') };
    const g = (r, k) => C[k] < 0 ? '' : norm(r[C[k]]);
    const legs = []; let cur = null;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r.some(c => norm(c))) continue;
      const p = { emp: g(r, 'emp'), name: g(r, 'name'), rank: g(r, 'rank'), posn: g(r, 'posn') };
      if (g(r, 'fl')) {
        cur = { date: g(r, 'date'), flight: g(r, 'fl'), show: g(r, 'show'), sector: g(r, 'sec'), std: g(r, 'std'), sta: g(r, 'sta'), crew: [p] };
        legs.push(cur);
      } else if (cur && g(r, 'date') === cur.date && !g(r, 'std')) {
        cur.crew.push(p);
      } else if (g(r, 'date')) {
        const skip = [C.date, C.emp, C.name, C.rank, C.posn];
        const txt = r.map(norm).filter((v, j) => v && !skip.includes(j)).join(' ');
        cur = { date: g(r, 'date'), flight: txt || '근무', show: '', sector: '', std: g(r, 'std'), sta: g(r, 'sta'), crew: [p] };
        legs.push(cur);
      }
    }
    const mine = emp ? legs.filter(l => l.crew.some(c => c.emp === emp)) : legs;
    const me = (legs.flatMap(l => l.crew).find(c => c.emp === emp) || {}).name || '';
    return { emp, month, me, legs: mine };
  }

  /** "12/01(화)" + "01 19:15" → 현지 벽시계 시각을 UTC 필드에 담은 ms */
  function toTime(month, date, spec, refMs) {
    const Y = +month.slice(0, 4), M = +month.slice(4, 6);
    const dm = /(\d{1,2})\/(\d{1,2})/.exec(date);
    let m = dm ? +dm[1] : M;
    const y = Y + (dm && +dm[1] < M - 6 ? 1 : 0);
    const baseDay = dm ? +dm[2] : 1;
    const t = /(?:(\d{1,2})\s+)?(\d{1,2}):(\d{2})/.exec(spec || '');
    if (!t) return null;
    const day = t[1] ? +t[1] : baseDay;
    if (t[1] && +t[1] < baseDay - 15) m += 1;
    let ms = Date.UTC(y, m - 1, day, +t[2], +t[3]);
    if (refMs != null && ms < refMs) ms += DAY;
    return ms;
  }

  const iso = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00`; };
  const hm = ms => { const d = new Date(ms); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
  const dlabel = ms => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${'일월화수목금토'[d.getUTCDay()]})`; };
  const fno = f => /^\d+$/.test(f) ? 'OZ' + f : f;
  const dur = m => `${Math.floor(m / 60)}:${p2(Math.round(m % 60))}`;

  function legTimes(l, month) {
    const std = toTime(month, l.date, l.std);
    const sta = std != null ? toTime(month, l.date, l.sta, std) : null;
    let show = l.show ? toTime(month, l.date, l.show) : null;
    if (show != null && std != null && show > std) show -= DAY;
    return { std, sta, show };
  }

  /** opts.group: 'leg' | 'day', opts.start: 'std' | 'show' */
  function buildItems(D, opts) {
    const o = Object.assign({ group: 'leg', start: 'std' }, opts);
    if (!D) return [];
    const legs = D.legs.map(l => Object.assign({}, l, legTimes(l, D.month)));
    const others = l => l.crew.filter(c => c.emp !== D.emp).map(c => `${c.name} ${c.rank}`).join(', ');
    let groups;
    if (o.group === 'day') {
      const m = new Map();
      legs.forEach(l => { if (!m.has(l.date)) m.set(l.date, []); m.get(l.date).push(l); });
      groups = [...m.values()];
    } else groups = legs.map(l => [l]);
    return groups.map(gp => {
      const a = gp[0], z = gp[gp.length - 1], fl = gp.filter(l => l.sector);
      const chain = fl.length ? [fl[0].sector.split('/')[0], ...fl.map(l => l.sector.split('/')[1] || '')].join('–') : '';
      const title = fl.length ? `${fno(fl[0].flight)}${fl.slice(1).map(l => '·' + l.flight).join('')} ${chain}` : a.flight;
      const start = (o.start === 'show' && a.show != null) ? a.show : a.std, end = z.sta;
      const block = gp.reduce((s, l) => s + (l.std != null && l.sta != null ? (l.sta - l.std) / 60000 : 0), 0);
      const lines = gp.map(l => l.sector
        ? `${fno(l.flight)} ${l.sector.replace('/', '→')}  STD ${l.std != null ? hm(l.std) : '-'} / STA ${l.sta != null ? hm(l.sta) : '-'}${l.show ? '  쇼업 ' + l.show : ''}`
        : l.flight);
      const crew = [...new Set(gp.map(others).filter(Boolean))].join(' / ');
      const day = a.std != null ? a.std : toTime(D.month, a.date, '00:00');
      const dd = new Date(day);
      const tag = `skd:${D.emp}:${dd.getUTCFullYear()}${p2(dd.getUTCMonth() + 1)}${p2(dd.getUTCDate())}:${gp.map(l => l.flight).join('-').replace(/\s+/g, '')}`;
      const desc = [...lines, block ? `BLOCK ${dur(block)}` : '', crew ? `승무원: ${crew}` : ''].filter(Boolean).join('\n') + `\n\n[${tag}]`;
      return { tag, title, start, end, allDay: start == null || end == null, day, desc, crew,
        loc: fl.length ? fl[0].sector.split('/')[0] : '', block, on: true };
    });
  }

  function gLink(it) {
    const f = ms => iso(ms).replace(/[-:]/g, '').slice(0, 15);
    const dates = it.allDay ? `${f(it.day).slice(0, 8)}/${f(it.day + DAY).slice(0, 8)}` : `${f(it.start)}/${f(it.end)}`;
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(it.title) + '&dates=' + dates +
      '&ctz=Asia/Seoul&details=' + encodeURIComponent(it.desc) + '&location=' + encodeURIComponent(it.loc);
  }

  /** KST(UTC+9, 서머타임 없음) 기준 .ics */
  function toIcs(items, nowMs) {
    const u = ms => { const d = new Date(ms - 9 * 3600000); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`; };
    const e = s => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    const ymd = ms => iso(ms).slice(0, 10).replace(/-/g, '');
    const now = new Date(nowMs == null ? Date.now() : nowMs);
    const stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}00Z`;
    const ev = items.map(it => ['BEGIN:VEVENT', `UID:${it.tag}@crew-skd`, `DTSTAMP:${stamp}`,
      it.allDay ? `DTSTART;VALUE=DATE:${ymd(it.day)}` : `DTSTART:${u(it.start)}`,
      it.allDay ? `DTEND;VALUE=DATE:${ymd(it.day + DAY)}` : `DTEND:${u(it.end)}`,
      `SUMMARY:${e(it.title)}`, `LOCATION:${e(it.loc)}`, `DESCRIPTION:${e(it.desc)}`, 'END:VEVENT'].join('\r\n'));
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//crew-skd//KO', ...ev, 'END:VCALENDAR'].join('\r\n');
  }

  /** Google Calendar API events.insert 본문 */
  function toGoogleEvent(it) {
    const tz = 'Asia/Seoul';
    const t = it.allDay
      ? { start: { date: iso(it.day).slice(0, 10) }, end: { date: iso(it.day + DAY).slice(0, 10) } }
      : { start: { dateTime: iso(it.start), timeZone: tz }, end: { dateTime: iso(it.end), timeZone: tz } };
    return Object.assign({ summary: it.title, description: it.desc, location: it.loc,
      extendedProperties: { private: { skd: it.tag } } }, t);
  }

  const api = { parseSkd, toTime, buildItems, gLink, toIcs, toGoogleEvent, iso, hm, dlabel, dur, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SKD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
