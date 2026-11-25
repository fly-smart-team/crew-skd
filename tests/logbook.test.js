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
