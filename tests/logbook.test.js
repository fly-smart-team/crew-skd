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

/* ===== 월간 스케줄 → 예정 비행 ===== */
const XLSX = require('xlsx');
const SKD = require('../skd-core.js');
const LS = require('../logbook/logbook-skd.js');
const skdRows = () => XLSX.utils.sheet_to_json(XLSX.readFile(require('path').join(__dirname, 'fixtures', 'sample.xls')).Sheets['sheet 1'], { header: 1, raw: false, defval: '' });

test('스케줄 → 예정 비행 (기장 입장)', () => {
  const D = SKD.parseSkd(skdRows());
  const r = LS.importSchedule(D, { careers: [{ from: '2020-01-01', fn: 'PIC', aircraftType: 'A321' }] });
  assert.equal(r.add.length, 6);
  const a = r.add[0];
  assert.equal(a.planned, true);
  assert.equal(a.flightNumber, 'OZ8236');
  assert.deepEqual([a.origin, a.destination], ['RKPC', 'RKTU']);
  assert.equal(a.schedOut, utc(2026, 12, 1, 10, 15)); // 19:15 KST
  assert.equal(a.schedIn, utc(2026, 12, 1, 11, 25));
  assert.equal(a.logDate, '2026-12-01');
  assert.equal(a.fn, 'PIC');
  assert.equal(a.roleSure, true);
  assert.equal(a.picName, '');
  assert.equal(a.aircraftType, 'A321');
  assert.ok(a.crew.includes('김부기 F/O'));
  const last = r.add[5]; // 12/31 23:30 → 01/01 00:40 KST
  assert.equal(last.schedIn, utc(2026, 12, 31, 15, 40));
  // 예정 비행은 누계·출력에 안 들어감
  assert.equal(L.totalsFull(r.add).flights, 0);
  assert.equal(L.buildLog(r.add, { format: 'icao' }).rowCount, 0);
  // 다시 가져오면 중복 안 됨
  const again = LS.importSchedule(D, { existing: r.add });
  assert.equal(again.add.length, 0);
  assert.equal(again.skipped, 6);
});

test('스케줄 → 예정 비행 (부기장 입장: 기장 이름 자동)', () => {
  const D = Object.assign({}, SKD.parseSkd(skdRows()));
  D.emp = '100002';
  D.legs = D.legs.filter(l => l.crew.some(c => c.emp === '100002'));
  const r = LS.importSchedule(D, {});
  assert.equal(r.add.length, 5);
  assert.equal(r.add[0].fn, 'SIC');
  assert.equal(r.add[0].picName, '홍길동');
  assert.equal(r.add[0].duty, 'F');
});

test('직급으로 역할 추정', () => {
  assert.deepEqual(LS.roleFrom('', 'CAP'), { fn: 'PIC', sure: false });
  assert.deepEqual(LS.roleFrom('F', 'CAP'), { fn: 'SIC', sure: true });
  assert.deepEqual(LS.roleFrom('X', 'TRAINEE'), { fn: null, sure: false });
});

test('스캔과 예정 비행 연결', () => {
  const D = SKD.parseSkd(skdRows());
  const planned = LS.importSchedule(D, {}).add;
  const m = LS.matchPlanned(planned, 'OZ8237', utc(2026, 12, 1, 11, 58));
  assert.equal(m.flightNumber, 'OZ8237');
  assert.equal(LS.matchPlanned(planned, 'OZ8237', utc(2026, 12, 5, 11, 58)), null);
  // 편명을 못 읽었으면 시각이 가장 가까운 예정 비행
  assert.equal(LS.matchPlanned(planned, '', utc(2026, 12, 2, 9, 45)).flightNumber, 'OZ8149');
});

/* ===== Crew Roster Report (xlsx) — 가상 승무원 데이터, 실제와 같은 칸 배치 ===== */
function cwpRows(meCode = 'P1', meId = '9000001') {
  const blank = () => Array(20).fill('');
  const r = cells => { const a = blank(); for (const [i, v] of Object.entries(cells)) a[i] = v; return a; };
  const head = r({ 1: 'Flight/Activity ', 2: 'From', 3: 'STD', 4: 'To', 5: 'STA', 6: 'A/C', 7: 'Acting rank', 8: 'Duty', 10: 'PIC code', 11: 'Crew ID', 12: 'Name', 14: 'Comment', 16: 'Special Duty Code' });
  const leg = (fl, from, std, to, sta, ac, code, id, name, rank) => r({ 1: fl, 2: from, 3: std, 4: to, 5: sta, 6: ac, 7: rank, 8: 'FLY', 10: code, 11: id, 13: name });
  const crew = (code, id, name, rank, duty = 'FLY') => r({ 7: rank, 8: duty, 10: code, 11: id, 13: name });
  const other = meCode === 'P1' ? ['F1', '9000002', 'KIM FO', 'FO'] : ['P1', '9000003', 'PARK CAP', 'CAP'];
  return [
    r({ 1: 'HONG GILDONG  | 9000001  | 32S  | CAP ', 9: 'FLY 10:00 TVL 00:00 DO 10' }),
    head,
    leg('KE333Z', 'ICN', '2026-12-08 12:50', 'PEK', '2026-12-08 14:10', '32A', meCode, meId, 'HONG GILDONG', meCode === 'P1' ? 'CAP' : 'FO'),
    crew(...other),
    leg('KE358Z', 'CAN', '2026-12-16 01:15', 'ICN', '2026-12-16 05:40', '2QB', meCode, meId, 'HONG GILDONG', meCode === 'P1' ? 'CAP' : 'FO'),
    head, // 페이지가 바뀌어 머리글이 다시 나오고, 앞 비행의 승무원이 이어짐
    crew(...other),
    r({ 1: 'SBY', 2: 'ICN', 3: '2026-12-20 08:00', 4: 'ICN', 5: '2026-12-20 16:00', 7: 'CAP', 8: 'SBY', 11: meId, 13: 'HONG GILDONG' })
  ];
}

test('Crew Roster: 양식 판별과 현지 시각 → UTC', () => {
  assert.equal(LS.detectFormat(cwpRows()), 'cwp');
  assert.equal(LS.detectFormat(skdRows()), 'skd');
  const r = LS.importRoster(cwpRows(), { careers: [{ from: '2020-01-01', fn: 'PIC', aircraftType: 'A321' }] });
  assert.equal(r.format, 'cwp');
  assert.equal(r.emp, '9000001');
  assert.equal(r.add.length, 2);
  assert.deepEqual(r.other, ['SBY (SBY)']);
  const [a, b] = r.add;
  assert.equal(a.flightNumber, 'KE333');
  assert.deepEqual([a.origin, a.destination], ['RKSI', 'ZBAA']);
  assert.equal(a.schedOut, utc(2026, 12, 8, 3, 50));   // 12:50 KST
  assert.equal(a.schedIn, utc(2026, 12, 8, 6, 10));    // 14:10 베이징
  assert.equal(b.schedOut, utc(2026, 12, 15, 17, 15)); // 01:15 광저우
  assert.equal(b.schedIn, utc(2026, 12, 15, 20, 40));  // 05:40 KST
  assert.equal(b.logDate, '2026-12-16');
  assert.equal(a.fn, 'PIC');
  assert.equal(a.acCode, '32A');
  assert.equal(a.aircraftType, 'A321');
  assert.ok(b.crew.includes('KIM FO')); // 페이지 넘어간 승무원 줄도 붙음
});

test('Crew Roster: 부기장(F1)이면 기장(P1) 이름 자동', () => {
  const r = LS.importRoster(cwpRows('F1'), {});
  assert.equal(r.add[0].fn, 'SIC');
  assert.equal(r.add[0].picName, 'PARK CAP');
  assert.equal(LS.roleFromCode('P2', 'CAP').fn, 'RELIEF');
});

test('Crew Roster: 기종 코드 매핑과 스캔 연결(편명 끝 문자 무시)', () => {
  const r = LS.importRoster(cwpRows(), { aircraft: [{ code: '32A', name: 'Airbus A321', mp: true, me: true, cls: 'AMEL', turbine: true }] });
  assert.equal(r.add[0].aircraftType, '32A');
  assert.equal(L.aircraftInfo('32A', [{ code: '32A', name: 'Airbus A321' }]).name, 'Airbus A321');
  assert.equal(LS.matchPlanned(r.add, 'KE333', utc(2026, 12, 8, 3, 55)).flightNumber, 'KE333');
});

test('회사 기종 코드 → A321', () => {
  const r = LS.importRoster(cwpRows(), { careers: [{ from: '2020-01-01', fn: 'PIC', aircraftType: 'B777' }] });
  assert.equal(r.add[0].aircraftType, 'A321'); // 32A
  assert.equal(r.add[1].aircraftType, 'A321'); // 2QB
  assert.equal(L.aircraftInfo('3QR').name, 'Airbus A321');
  // 설정에서 코드를 따로 정하면 그게 우선
  assert.equal(LS.importRoster(cwpRows(), { aircraft: [{ code: '32A', name: 'Airbus A321neo' }] }).add[0].aircraftType, '32A');
});

/* ===== 함께 탄 조종사 · 취소된 비행 ===== */
test('스케줄에서 함께 탄 조종사 이름', () => {
  const a = LS.importRoster(cwpRows('P1'), {}).add[0];
  assert.equal(a.picName, '');
  assert.equal(a.copilotName, 'KIM FO');
  const b = LS.importRoster(cwpRows('F1'), {}).add[0];
  assert.equal(b.picName, 'PARK CAP');
  assert.equal(b.copilotName, '');
  const s = LS.importRoster(skdRows(), {}).add[0];
  assert.equal(s.copilotName, '김부기');
});

test('다시 가져올 때 빠진 예정 비행 = 취소', () => {
  const first = LS.importRoster(cwpRows(), {}).add;
  const manual = L.newEntry({ planned: true, source: 'manual', flightNumber: 'KE999', logDate: '2026-12-10', schedOut: utc(2026, 12, 10, 0, 0) });
  const gone = L.newEntry({ planned: true, source: 'schedule', flightNumber: 'KE111', logDate: '2026-12-09', schedOut: utc(2026, 12, 9, 0, 0) });
  const outside = L.newEntry({ planned: true, source: 'schedule', flightNumber: 'KE222', logDate: '2026-11-30', schedOut: utc(2026, 11, 30, 0, 0) });
  const r = LS.importRoster(cwpRows(), { existing: first.concat([manual, gone, outside]) });
  assert.equal(r.add.length, 0);
  assert.deepEqual(r.cancelled.map(e => e.flightNumber), ['KE111']); // 직접 만든 것·기간 밖은 그대로
});

test('함께 탄 사람 찾기', () => {
  const mk = (d, extra) => L.recalc(L.newEntry(Object.assign({ origin: 'RKSI', destination: 'RJBB', out: utc(2026, 11, d, 0, 0), in: utc(2026, 11, d, 2, 0) }, extra)), { takeoff: true, landing: true });
  const list = [
    mk(1, { fn: 'PIC', copilotName: 'KIM FO' }),
    mk(5, { fn: 'PIC', copilotName: 'kim fo, LEE FO' }),
    mk(9, { fn: 'SIC', picName: 'PARK CAP', crewList: [{ name: 'PARK CAP', rank: 'CAP', code: 'P1' }] }),
    Object.assign(L.newEntry({ planned: true, copilotName: 'KIM FO', logDate: '2026-11-20' }))
  ];
  assert.deepEqual(L.crewNamesOf(list[2]), ['PARK CAP']);
  const idx = L.crewIndex(list);
  assert.equal(idx[0].name, 'KIM FO');
  assert.equal(idx[0].count, 2); // 예정 비행은 빼고, 대소문자 무시
  assert.equal(idx[0].first, '2026-11-01');
  assert.equal(idx[0].last, '2026-11-05');
  assert.deepEqual(L.crewIndex(list, 'park').map(x => x.name), ['PARK CAP']);
});

test('취소 감지는 그 달 전체 기준, 함께 탄 사람은 고친 이름 우선', () => {
  const first = LS.importRoster(skdRows(), {}).add; // 12/01 ~ 12/31
  const onlyFirstDay = skdRows().slice(0, 9);      // 12/01 비행만 남은 스케줄
  const r = LS.importRoster(onlyFirstDay, { existing: first });
  assert.deepEqual(r.cancelled.map(e => e.flightNumber), ['OZ8148', 'OZ8149', 'OZ8984', 'OZ8999']);
  const e = Object.assign({}, first[0], { copilotName: 'LEE FO' });
  assert.deepEqual(L.crewNamesOf(e), ['LEE FO']); // 스케줄 원래 부기장(김부기)은 빼고
});

/* ===== 로그북 목록 보기 ===== */
test('목록: 오늘·예정 / 기록 / 전체, 정렬, 필터', () => {
  const now = utc(2026, 11, 27, 3, 0), today = '2026-11-27';
  const rec = (d, extra) => L.recalc(L.newEntry(Object.assign({ origin: 'RKSI', destination: 'RJBB', aircraftType: 'A321', out: utc(2026, 11, d, 0, 0), in: utc(2026, 11, d, 2, 0) }, extra)), { takeoff: true, landing: true });
  const plan = (d, extra) => L.newEntry(Object.assign({ planned: true, source: 'schedule', flightNumber: 'KE' + d, origin: 'RKSS', destination: 'RKPC', logDate: `2026-11-${String(d).padStart(2, '0')}`, schedOut: utc(2026, 11, d, 1, 0), schedIn: utc(2026, 11, d, 2, 10) }, extra));
  const list = [
    rec(10, { flightNumber: 'OZ10', fn: 'PIC' }), rec(20, { flightNumber: 'OZ20', fn: 'SIC', registration: 'HL8399' }), rec(27, { flightNumber: 'OZ27', fn: 'PIC', instructing: true }),
    L.newEntry({ isSimulator: true, logDate: '2026-11-15', block: 240 }),
    plan(25), plan(27), plan(28), plan(30), Object.assign(plan(29), { deleted: true })
  ];
  const ids = v => v.items.map(e => e.flightNumber || 'SIM');
  const up = L.logView(list, { tab: 'up', sort: 'asc', now, today });
  assert.deepEqual(ids(up), ['OZ27', 'KE27', 'KE28', 'KE30']); // 오늘 비행부터
  assert.deepEqual(up.stale.map(e => e.flightNumber), ['KE25']);   // 기록 안 한 지난 예정
  assert.equal(up.totals.planned, 3);
  assert.equal(up.totals.plannedBlock, 210);
  assert.deepEqual(ids(L.logView(list, { tab: 'up', sort: 'desc', now, today })), ['KE30', 'KE28', 'KE27', 'OZ27']);
  const r = L.logView(list, { tab: 'rec', sort: 'desc', now, today });
  assert.deepEqual(ids(r), ['OZ27', 'OZ20', 'SIM', 'OZ10']);
  assert.equal(r.totals.flights, 3);
  assert.equal(r.totals.block, 360);
  const all = L.logView(list, { tab: 'all', sort: 'asc', now, today });
  assert.equal(all.items[all.todayIndex].logDate, '2026-11-27');
  // 필터
  const f = (filter, tab = 'rec') => ids(L.logView(list, { tab, sort: 'asc', now, today, filter }));
  assert.deepEqual(f({ fn: 'PIC' }), ['OZ10', 'OZ27']);
  assert.deepEqual(f({ fn: 'SIC' }), ['OZ20']);
  assert.deepEqual(f({ fn: 'instr' }), ['OZ27']);
  assert.deepEqual(f({ kind: 'sim' }), ['SIM']);
  assert.deepEqual(f({ reg: 'hl 8399' }), ['OZ20']);
  assert.deepEqual(f({ period: 'custom', from: '2026-11-15', to: '2026-11-20' }), ['SIM', 'OZ20']);
  assert.deepEqual(f({ apt: 'CJU' }, 'all'), ['KE25', 'KE27', 'KE28', 'KE30']);
  assert.deepEqual(L.periodRange('lastMonth', '2026-01-15'), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(L.periodRange('90d', '2026-11-27'), ['2026-08-30', '2026-11-27']);
  assert.equal(L.filterActive({ period: '', night: false }), false);
  assert.equal(L.filterActive({ fn: 'PIC' }), true);
});

test('계기 접근: VISUAL은 계기 접근에서 제외, 순항 교대·옵저버 칸', () => {
  const mk = (extra) => L.recalc(L.newEntry(Object.assign({ origin: 'RKSI', destination: 'RJBB', aircraftType: 'A321', out: utc(2026, 11, 1, 0, 0), in: utc(2026, 11, 1, 2, 0) }, extra)), {});
  const ils = mk({ fn: 'PIC', approaches: 2, approachType: 'ILS' }), vis = mk({ fn: 'PIC', approaches: 1, approachType: 'VISUAL' });
  assert.equal(L.instApproaches(ils), 2);
  assert.equal(L.instApproaches(vis), 0);
  assert.equal(L.totalsFull([ils, vis]).approaches, 2);
  const faa = L.buildLog([ils, vis], { format: 'faa' });
  const col = k => faa.cols.findIndex(c => c.key === k);
  assert.equal(faa.pages[0].rows[0].cells[col('app')], 2);
  assert.ok(faa.pages[0].rows[0].cells[col('remarks')].includes('2× ILS'));
  const crz = mk({ fn: 'RELIEF' }), obs = mk({ fn: 'OBS' });
  const icao = L.buildLog([crz, obs], { format: 'icao' });
  assert.equal(icao.rowCount, 1);                                   // 옵저버는 출력·누계에 안 들어감
  assert.equal(icao.pages[0].pageTotal.fnCop, 120);                  // CRZ → ICAO Co-pilot
  assert.equal(L.buildLog([crz], { format: 'faa' }).pages[0].pageTotal.sic, 120); // CRZ → FAA SIC
  assert.equal(L.totalsFull([crz, obs]).flights, 1);
});

test('실계기: 비행시간 − 2분 규칙', () => {
  const e = L.recalc(L.newEntry({ origin: 'RKSI', destination: 'RJCC', out: utc(2026, 11, 1, 0, 0), off: utc(2026, 11, 1, 0, 15), on: utc(2026, 11, 1, 2, 22), in: utc(2026, 11, 1, 2, 30) }), { instrumentRule: 'flight2' });
  assert.equal(e.flight, 127);
  assert.equal(e.instrument, 125); // 회사 로그북: T/S 2:07 → I/T 2:05
});
