// 로그북 공통 로직 테스트: node --test tests/logbook.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logbook/logbook-core.js');

const W = 1126, H = 2000;
const tok = (text, x0, x1, yc, h = 52) => ({ text, x0: x0 / W, y0: (yc - h / 2) / H, x1: x1 / W, y1: (yc + h / 2) / H });
const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi);

// 실제 MCDU 사진(OZ731 RKSI→VVTS)에서 글자 위치를 잰 OCR 결과. 오른쪽이 잘려 VVT / 25NOV2 / 2341 로 읽히는 상황
const photo = () => [
  tok('AOC OOOI STATUS 1/3', 205, 1126, 462, 60),
  tok('FLIGHT ID', 75, 470, 545), tok('ORIG/DEST', 748, 1126, 545),
  tok('OZØ731', 75, 340, 617), tok('RKSI/VVT', 748, 1126, 617),
  tok('RETURN', 120, 385, 688), tok('UTC', 570, 695, 688), tok('DATE', 925, 1095, 688),
  tok('----Z', 80, 295, 762), tok('Ø5Ø9', 527, 697, 762), tok('25NOV2', 840, 1126, 755),
  tok('OUT', 125, 250, 835), tok('OFF', 975, 1095, 828),
  tok('2319Z', 80, 295, 908), tok('2341', 930, 1126, 902),
  tok('IN', 125, 210, 982), tok('←', 395, 440, 970), tok('ON', 1020, 1100, 975),
  tok('Ø5Ø4Z', 80, 295, 1055), tok('Ø453', 930, 1126, 1045),
  tok('BLOCK', 125, 345, 1127), tok('FLIGHT', 845, 1100, 1118),
  tok('Ø545', 85, 255, 1200), tok('Ø512', 935, 1105, 1188),
  tok('RETURN TO', 130, 525, 1268), tok('<AOC MENU', 85, 485, 1335, 64), tok('PRINT*', 890, 1126, 1328, 64),
  tok('PROG', 175, 315, 1665), tok('PERF', 400, 530, 1660), tok('INIT', 640, 740, 1658), tok('DATA', 850, 975, 1655)
];

const merged = () => [
  tok('AOC OOOI STATUS 1/3', 205, 1126, 462, 60),
  tok('FLIGHT ID ORIG/DEST', 75, 1126, 545), tok('0Z0731 RKSI/VVTS', 75, 1126, 617),
  tok('RETURN UTC DATE', 120, 1095, 688), tok('----Z 0509 25NOV26', 80, 1126, 760),
  tok('OUT OFF', 125, 1095, 832), tok('2319Z 2341Z', 80, 1126, 905),
  tok('IN ON', 125, 1100, 978), tok('0504Z 0453Z', 80, 1126, 1050),
  tok('BLOCK FLIGHT', 125, 1100, 1122), tok('0545 0512', 85, 1105, 1194)
];

const ct = L.clock.text;

test('실제 사진 배치 해석', () => {
  const r = L.parseOOOI(photo());
  assert.equal(r.isOOOIPage, true);
  assert.equal(r.flightID, 'OZ731');
  assert.equal(r.origin, 'RKSI');
  assert.equal(r.destination, 'VVTS');
  assert.ok(r.notes.some(n => n.field === 'destination' && n.kind === 'guessed'));
  assert.deepEqual([r.out, r.off, r.on, r.in].map(ct), ['2319', '2341', '0453', '0504']);
  assert.equal(r.block, 345);
  assert.equal(r.flight, 312);
  assert.equal(ct(r.screenUTC), '0509');
  assert.deepEqual([r.screenDay, r.screenMonth, r.screenYear], [25, 11, null]);
  assert.ok(L.checksumsPass(r));
  assert.ok(!r.notes.some(n => n.kind === 'missing' || n.kind === 'mismatch'));
});

test('한 줄로 묶인 OCR 결과', () => {
  const r = L.parseOOOI(merged());
  assert.equal(r.flightID, 'OZ731');
  assert.equal(r.destination, 'VVTS');
  assert.deepEqual([r.out, r.off, r.on, r.in].map(ct), ['2319', '2341', '0453', '0504']);
  assert.equal(r.screenYear, 2026);
  assert.ok(L.checksumsPass(r));
});

test('한 글자 오인식을 검산으로 수정', () => {
  const t = photo(); t.find(x => x.text === '2319Z').text = '2349Z';
  const r = L.parseOOOI(t);
  assert.equal(ct(r.out), '2319');
  assert.ok(r.notes.some(n => n.field === 'out' && n.kind === 'corrected'));
});

test('후보가 여럿이면 고치지 않고 표시', () => {
  const t = photo(); t.find(x => x.text === 'Ø453').text = 'Ø458';
  const r = L.parseOOOI(t);
  const corrected = r.notes.some(n => n.kind === 'corrected'), flagged = r.notes.some(n => n.kind === 'mismatch');
  assert.ok(corrected || flagged);
  if (corrected) assert.equal(ct(r.on), '0453');
});

test('반사로 안 보인 값은 계산', () => {
  const r = L.parseOOOI(photo().filter(x => x.text !== 'Ø453'));
  assert.equal(ct(r.on), '0453');
  assert.ok(r.notes.some(n => n.field === 'on' && n.kind === 'derived'));
  assert.ok(!r.notes.some(n => n.field === 'on' && n.kind === 'missing'));
});

test('BLOCK 값이 없을 때 FLIGHT 값을 가져가지 않음', () => {
  const r = L.parseOOOI(photo().filter(x => x.text !== 'Ø545'));
  assert.equal(r.flight, 312);
  assert.equal(r.block, 345);
});

test('OOOI 화면이 아님', () => {
  assert.equal(L.parseOOOI([tok('PERF TAKE OFF', 100, 900, 400), tok('V1 142', 100, 400, 480)]).isOOOIPage, false);
});

test('값 해석기', () => {
  assert.equal(L.parse.flightID('OZØ731'), 'OZ731');
  assert.equal(L.parse.flightID('0Z0731'), 'OZ731');
  assert.equal(L.parse.flightID('7C1302'), '7C1302');
  assert.equal(ct(L.parse.zulu('Ø5Ø4Z')), '0504');
  assert.equal(ct(L.parse.zulu('23192')), '2319');
  assert.equal(L.parse.zulu('----Z'), null);
  assert.equal(L.parse.zulu('2519Z'), null);
  assert.equal(L.parse.duration('Ø545'), 345);
  assert.deepEqual(L.parse.route('RK5I/VVT5'), ['RKSI', 'VVTS']);
  assert.equal(L.parse.screenDate('25NOV26').year, 2026);
  assert.equal(L.parseHMM('8584:14'), 8584 * 60 + 14);
  assert.equal(L.parseHMM('0575'), null);
  assert.equal(L.hmm(345), '5:45');
});

test('자정을 넘는 날짜 붙이기', () => {
  const r = L.parseOOOI(photo());
  const ref = L.referenceTime(r, utc(2026, 11, 25, 5, 30));
  assert.equal(ref, utc(2026, 11, 25, 5, 9));
  const t = L.resolveTimes(r, ref);
  assert.equal(t.out, utc(2026, 11, 24, 23, 19));
  assert.equal(t.off, utc(2026, 11, 24, 23, 41));
  assert.equal(t.on, utc(2026, 11, 25, 4, 53));
  assert.equal(t.in, utc(2026, 11, 25, 5, 4));
});

test('연도가 잘리면 사진 날짜에 가까운 해', () => {
  const ref = L.referenceTime({ screenDay: 31, screenMonth: 12, screenUTC: 23 * 60 + 50 }, utc(2027, 1, 1, 0, 5));
  assert.equal(ref, utc(2026, 12, 31, 23, 50));
});

test('스캔 → 로그북 기록', () => {
  const r = L.parseOOOI(photo());
  const t = L.resolveTimes(r, L.referenceTime(r, utc(2026, 11, 25, 6, 0)));
  const e = L.recalc(L.newEntry({ flightNumber: r.flightID, origin: r.origin, destination: r.destination, out: t.out, off: t.off, on: t.on, in: t.in }),
    { takeoff: true, landing: true });
  assert.equal(e.logDate, '2026-11-25');
  assert.equal(e.block, 345);
  assert.equal(e.flight, 312);
  assert.equal(e.night, 0);
  assert.equal(e.instrument, 312);
  assert.equal(e.takeoffs, 1);
  assert.equal(e.nightLandings, 0);
});

// 회사 Flight Log 실제 줄과 비교
const flight = (o, d, out, inn, pf = true, extra = {}) =>
  L.recalc(L.newEntry(Object.assign({ origin: L.airportDB().get(o).icao, destination: L.airportDB().get(d).icao, out, in: inn }, extra)),
    { takeoff: pf, landing: pf });

test('ICN-CTS 블록 2:40, 한국 날짜', () => {
  const e = flight('ICN', 'CTS', utc(2026, 10, 31, 23, 2), utc(2026, 11, 1, 1, 42));
  assert.equal(e.block, 160);
  assert.equal(e.logDate, '2026-11-01');
});

test('ICN-SGN 야간 비행', () => {
  const e = flight('ICN', 'SGN', utc(2026, 11, 10, 10, 32), utc(2026, 11, 10, 16, 13));
  assert.equal(e.block, 341);
  assert.ok(e.night >= 335, String(e.night));
  assert.equal(e.nightTakeoffs, 1);
  assert.equal(e.nightLandings, 1);
});

test('TPE-ICN 해질녘', () => {
  const e = flight('TPE', 'ICN', utc(2026, 11, 4, 9, 5), utc(2026, 11, 4, 11, 32));
  assert.equal(e.block, 147);
  assert.ok(e.night >= 95 && e.night <= 130, String(e.night));
  assert.equal(e.nightTakeoffs, 0);
  assert.equal(e.nightLandings, 1);
});

test('이륙만 / 착륙만', () => {
  const e = L.newEntry({ origin: 'RCTP', destination: 'RKSI', out: utc(2026, 11, 4, 9, 5), in: utc(2026, 11, 4, 11, 32) });
  L.recalc(e, { takeoff: true, landing: false });
  assert.deepEqual([e.takeoffs, e.nightTakeoffs, e.landings, e.nightLandings], [1, 0, 0, 0]);
  L.recalc(e, { takeoff: false, landing: true });
  assert.deepEqual([e.takeoffs, e.landings, e.nightLandings], [0, 1, 1]);
});

test('태양 고도', () => {
  assert.ok(Math.abs(L.sunElevation(utc(2026, 6, 21, 3, 35), 37.46, 126.44) - 76) < 1.5);
  assert.ok(L.sunElevation(utc(2026, 6, 21, 15, 35), 37.46, 126.44) < -20);
});

test('90일 이착륙', () => {
  const asOf = utc(2026, 11, 25, 6, 0);
  const recs = [
    flight('ICN', 'CTS', utc(2026, 8, 20, 0, 0), utc(2026, 8, 20, 2, 30)),
    flight('GMP', 'CJU', utc(2026, 11, 14, 1, 6), utc(2026, 11, 14, 2, 20)),
    flight('CJU', 'GMP', utc(2026, 11, 14, 3, 9), utc(2026, 11, 14, 4, 23)),
    flight('GMP', 'KIX', utc(2026, 11, 14, 23, 29), utc(2026, 11, 15, 1, 9), false)
  ];
  let s = L.recency(recs, asOf);
  assert.equal(s.flightTakeoffs, 2);
  assert.equal(s.isCurrent, false);
  assert.equal(s.validUntil, null);
  recs.push(L.newEntry({ logDate: '2026-10-30', isSimulator: true, takeoffs: 3, landings: 3 }));
  recs.push(Object.assign(flight('ICN', 'TPE', utc(2026, 11, 20, 0, 0), utc(2026, 11, 20, 2, 30)), { deleted: true }));
  s = L.recency(recs, asOf);
  assert.equal(s.simLandings, 3);
  assert.equal(s.flightTakeoffs, 2); // 삭제된 기록 제외
  assert.equal(s.isCurrent, true);
  assert.ok(s.validUntil > asOf);
});

test('이월 누계', () => {
  const carry = { total: 8584 * 60 + 14, pic: 1954 * 60 + 12, night: 0, instrument: 0, asOf: '2026-11-21' };
  const old = flight('ICN', 'CSX', utc(2026, 11, 20, 12, 9), utc(2026, 11, 20, 15, 36));
  const neu = flight('ICN', 'SGN', utc(2026, 11, 24, 23, 19), utc(2026, 11, 25, 5, 4));
  const t = L.totals([old, neu], carry);
  assert.equal(t.total, 8584 * 60 + 14 + 345);
  assert.equal(t.pic, 1954 * 60 + 12 + 345);
  assert.equal(t.flights, 1);
  assert.equal(L.totals([old, neu], null, { from: '2026-11-01', through: '2026-11-30' }).total, 207 + 345);
});

test('백업·합치기', () => {
  const a = flight('ICN', 'CTS', utc(2026, 10, 31, 23, 2), utc(2026, 11, 1, 1, 42));
  const b = L.readBackup(JSON.stringify(L.makeBackup([a], { total: 100 })));
  assert.equal(b.entries[0].id, a.id);
  assert.equal(b.carryForward.total, 100);
  assert.throws(() => L.readBackup('{"x":1}'));
  const edited = Object.assign({}, a, { remarks: '고침', updatedAt: a.updatedAt + 1000 });
  const gone = Object.assign({}, a, { deleted: true, updatedAt: a.updatedAt - 1000 });
  const m = L.mergeEntries([a], [edited, L.newEntry({ logDate: '2026-11-02' })]);
  assert.equal(m.added, 1); assert.equal(m.updated, 1);
  assert.equal(m.merged.find(e => e.id === a.id).remarks, '고침');
  assert.equal(L.mergeEntries([a], [gone]).updated, 0); // 오래된 삭제는 무시
});

test('회사 양식 CSV', () => {
  const e = flight('ICN', 'CTS', utc(2026, 10, 31, 23, 2), utc(2026, 11, 1, 1, 42), true,
    { off: utc(2026, 10, 31, 23, 20), on: utc(2026, 11, 1, 1, 27), flightNumber: 'OZ174', registration: 'HL8399', aircraftType: 'A321', remarks: 'a, b' });
  L.recalc(e, {});
  const row = L.toCSV([e]).split('\r\n')[1];
  assert.ok(row.startsWith('2026/11/01,A321,HL8399,OZ174,ICN-CTS,,C,10/31 23:02,11/01 01:42,2:40,2:07,'), row);
  assert.ok(row.endsWith(',*,*,2320,0127,,"a, b"'), row);
});

// 실제 MCDU 사진을 Tesseract.js로 읽은 결과 (빗금 0, Z, 화면 테두리 잡티 등으로 여러 글자가 틀림)
const real = name => require('./fixtures/' + name);
const four = r => [r.out, r.off, r.on, r.in].map(ct).concat([r.block, r.flight]);

test('실제 OCR 결과: 오독을 검산으로 모두 복원', () => {
  const r = L.parseOOOI(real('oooi-tesseract-oz731.json'));
  assert.equal(r.flightID, 'OZ731');
  assert.deepEqual([r.origin, r.destination], ['RKSI', 'VVTS']);
  assert.deepEqual(four(r), ['2319', '2341', '0453', '0504', 345, 312]);
  assert.equal(r.confident, true);
  assert.ok(r.notes.some(n => n.field === 'out' && n.kind === 'corrected'));
  assert.ok(!r.notes.some(n => n.kind === 'mismatch'));
});

test('실제 OCR 결과: 기울어진 사진 여러 번 읽은 것 합치기', () => {
  const sets = real('oooi-tesseract-oz731-tilted.json');
  assert.ok(Array.isArray(sets[0]) && sets.length >= 2);
  const first = L.parseOOOI(sets[0]);
  assert.equal(first.confident, false); // 한 번만 읽어서는 부족
  const r = L.parseOOOI(sets);
  assert.deepEqual(four(r), ['2319', '2341', '0453', '0504', 345, 312]);
});

test('사진 기울기 추정', () => {
  const sets = real('oooi-tesseract-oz731-tilted.json');
  const skew = L.estimateSkew(sets[0], 1126 / 2000);
  assert.ok(Math.abs(skew) > 2 && Math.abs(skew) < 6, String(skew));
});

test('화면 UTC를 못 읽었으면 촬영 시각 사용 (자정 직후 촬영)', () => {
  const r = { screenDay: 26, screenMonth: 11, screenYear: 2026, screenUTC: null };
  const shot = utc(2026, 11, 26, 0, 5);
  assert.equal(L.referenceTime(r, shot, true), shot);
  const t = L.resolveTimes({ out: 18 * 60, off: 18 * 60 + 15, on: 23 * 60 + 40, in: 23 * 60 + 50 }, shot);
  assert.equal(t.in, utc(2026, 11, 25, 23, 50));
  assert.equal(L.referenceTime(r, utc(2026, 12, 20, 0, 0), true), utc(2026, 11, 26, 23, 59)); // 촬영 시각이 동떨어지면 화면 날짜
});

test('공항 코드 한 글자 오독 수정', () => {
  const t = photo(); t.find(x => x.text === 'RKSI/VVT').text = 'RKST/VYTS';
  const r = L.parseOOOI(t);
  assert.deepEqual([r.origin, r.destination], ['RKSI', 'VVTS']);
});

/* ===== 조종사 역할·경력·양식 ===== */

const fl = (o, d, out, inn, extra) => L.recalc(L.newEntry(Object.assign({ origin: o, destination: d, out, in: inn, aircraftType: 'A321', registration: 'HL8399' }, extra)),
  { takeoff: true, landing: true });

test('예전 Duty 코드에서 역할 읽기', () => {
  assert.equal(L.fnOf({ duty: 'C' }), 'PIC');
  assert.equal(L.fnOf({ duty: 'F' }), 'SIC');
  assert.equal(L.fnOf({ duty: 'I' }), 'PIC');
  assert.equal(L.instructingOf({ duty: 'I' }), true);
  assert.equal(L.fnOf({ fn: 'PICUS', duty: 'F' }), 'PICUS');
});

test('역할별 시간과 회사 Duty 코드', () => {
  const e = fl('RKSI', 'RJCC', utc(2026, 10, 31, 23, 2), utc(2026, 11, 1, 1, 42), { fn: 'PIC', instructing: true });
  assert.deepEqual(L.functionTime(e), { pic: 160, picus: 0, sic: 0, relief: 0, dual: 0, instructor: 160, examiner: 0 });
  assert.equal(e.duty, 'C');
  const f = fl('RKSI', 'RJCC', utc(2026, 10, 31, 23, 2), utc(2026, 11, 1, 1, 42), { fn: 'SIC' });
  assert.equal(f.duty, 'F');
  assert.equal(f.ifr, 160); // IFR 기본 = 블록
});

test('경력 단계', () => {
  const periods = [{ from: '2012-03-01', fn: 'SIC', title: '부기장' }, { from: '2019-07-01', fn: 'PIC', title: '기장' }, { from: '2023-01-15', fn: 'PIC', title: '교관', instructor: true }];
  assert.equal(L.careerAt(periods, '2015-05-05').title, '부기장');
  assert.equal(L.careerAt(periods, '2019-07-01').title, '기장');
  assert.equal(L.careerAt(periods, '2026-11-25').instructor, true);
  assert.equal(L.careerAt(periods, '2010-01-01'), null);
});

test('FAA 야간 (일몰 1시간 후)', () => {
  const icn = L.airportDB().get('RKSI');
  const s = L.sunTimes(utc(2026, 11, 10, 9, 0), icn.lat, icn.lon); // 18:00 KST
  assert.equal(s.up, false);
  const setKst = new Date(s.set + 9 * 3600e3).toISOString().slice(11, 16);
  assert.ok(setKst >= '17:15' && setKst <= '17:35', setKst);
  assert.equal(L.isFaaNight(s.set + 30 * 60000, icn), false);
  assert.equal(L.isFaaNight(s.set + 70 * 60000, icn), true);
  assert.equal(L.isFaaNight(utc(2026, 11, 10, 3, 0), icn), false); // 정오
});

test('누계: 이월 + 역할별', () => {
  const carry = { total: 600000, pic: 100000, sic: 400000, instructor: 5000, landingsDay: 900, asOf: '2026-11-21' };
  const a = fl('RKSI', 'VVTS', utc(2026, 11, 24, 23, 19), utc(2026, 11, 25, 5, 4), { fn: 'PIC', instructing: true, approaches: 1, holding: true });
  const b = fl('RKSI', 'RJCC', utc(2026, 11, 20, 0, 0), utc(2026, 11, 20, 2, 0), { fn: 'PIC' }); // 이월 기준일 이전
  const t = L.totalsFull([a, b], carry);
  assert.equal(t.total, 600000 + 345);
  assert.equal(t.pic, 100000 + 345);
  assert.equal(t.sic, 400000);
  assert.equal(t.instructor, 5000 + 345);
  assert.equal(t.multiPilot, 345);
  assert.equal(t.xc, 345);
  assert.equal(t.landingsDay, 901);
  assert.equal(t.approaches, 1);
});

test('FAA 최근 비행 요건', () => {
  const asOf = utc(2026, 11, 25, 12, 0);
  const list = [];
  for (let i = 0; i < 6; i++) list.push(fl('RKSI', 'RJCC', utc(2026, 9, 1 + i, 0, 0), utc(2026, 9, 1 + i, 2, 0), { approaches: 1, holding: i === 0 }));
  // 야간 착륙 3회 (KST 밤 11시 착륙)
  for (let i = 0; i < 3; i++) list.push(fl('RJCC', 'RKSI', utc(2026, 11, 10 + i, 11, 30), utc(2026, 11, 10 + i, 14, 0)));
  const c = L.faaCurrency(list, asOf);
  assert.equal(c.night.landings, 3);
  assert.equal(c.night.isCurrent, true);
  assert.equal(c.instrument.approaches, 6);
  assert.equal(c.instrument.isCurrent, true);
  assert.equal(new Date(c.instrument.validUntil).toISOString().slice(0, 10), '2027-03-31');
});

test('ICAO 양식: 칸 값, 페이지 합계, 이월', () => {
  const carry = { total: 100 * 60, pic: 40 * 60, sic: 60 * 60, multiPilot: 100 * 60, landingsDay: 10, asOf: '2026-10-31' };
  const list = [
    fl('RKSI', 'RJCC', utc(2026, 11, 1, 0, 0), utc(2026, 11, 1, 2, 0), { fn: 'PIC' }),
    fl('RJCC', 'RKSI', utc(2026, 11, 1, 3, 0), utc(2026, 11, 1, 5, 30), { fn: 'SIC', picName: 'KIM' }),
    fl('RKSI', 'VVTS', utc(2026, 11, 24, 23, 19), utc(2026, 11, 25, 5, 4), { fn: 'PIC' }),
    L.newEntry({ logDate: '2026-11-10', isSimulator: true, aircraftType: 'A320', fstdType: 'FFS', block: 240, takeoffs: 2, landings: 2 })
  ];
  const log = L.buildLog(list, { format: 'icao', carry, rowsPerPage: 2 });
  assert.equal(log.rowCount, 4);
  assert.equal(log.pages.length, 2);
  const col = k => log.cols.findIndex(c => c.key === k);
  const r0 = log.pages[0].rows[0].cells;
  assert.equal(r0[col('date')], '01/11/26');
  assert.equal(r0[col('depPlace')], 'RKSI');
  assert.equal(r0[col('depTime')], '00:00');
  assert.equal(r0[col('acType')], 'Airbus A321');
  assert.equal(r0[col('picName')], 'SELF');
  assert.equal(log.pages[0].rows[1].cells[col('picName')], 'KIM');
  assert.equal(log.pages[0].broughtForward.total, 6000);
  assert.equal(log.pages[0].pageTotal.total, 270);
  assert.equal(log.pages[1].broughtForward.total, 6270);
  assert.equal(log.pages[1].total.total, 6270 + 345);
  assert.equal(log.pages[1].total.fnPic, 2400 + 120 + 345);
  assert.equal(log.pages[1].total.fnCop, 3600 + 150);
  assert.equal(log.pages[1].total.fstdTime, 240);
  assert.equal(log.pages[1].rows[0].cells[col('fstdType')], 'A320 FFS');
  // 기간 지정: 시작 전 기록은 이월에 들어감
  const nov24 = L.buildLog(list, { format: 'icao', carry, from: '2026-11-20' });
  assert.equal(nov24.rowCount, 1);
  assert.equal(nov24.pages[0].broughtForward.total, 6000 + 270);
});

test('FAA 양식: 10진수 시간과 SIC 합산', () => {
  const list = [fl('RKSI', 'RJCC', utc(2026, 11, 1, 0, 0), utc(2026, 11, 1, 2, 20), { fn: 'PICUS', approaches: 1, approachType: 'ILS 01R' })];
  const log = L.buildLog(list, { format: 'faa' });
  const cols = log.cols, cells = log.pages[0].rows[0].cells;
  const v = k => L.cellText(cols.find(c => c.key === k), cells[cols.findIndex(c => c.key === k)], log.format);
  assert.equal(v('sic'), '2.3');
  assert.equal(v('pic'), '');
  assert.equal(v('cat'), 'AMEL');
  assert.ok(v('remarks').includes('PICUS') && v('remarks').includes('ILS 01R'));
  const csv = L.formatCSV(list, { format: 'faa' });
  assert.ok(csv.split('\r\n')[0].includes('Total duration of flight'));
});
