const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const XLSX = require('xlsx');
const SKD = require('../skd-core.js');

const wb = XLSX.readFile(path.join(__dirname, 'fixtures', 'sample.xls'));
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
const D = SKD.parseSkd(rows);

test('헤더에서 사번·월·이름을 읽는다', () => {
  assert.strictEqual(D.emp, '100001');
  assert.strictEqual(D.month, '202612');
  assert.strictEqual(D.me, '홍길동');
  assert.strictEqual(D.legs.length, 6);
});

test('구간별 일정: 편명·시각·승무원', () => {
  const it = SKD.buildItems(D)[0];
  assert.strictEqual(it.title, 'OZ8236 CJU–CJJ');
  assert.strictEqual(SKD.iso(it.start), '2026-12-01T19:15:00');
  assert.strictEqual(SKD.iso(it.end), '2026-12-01T20:25:00');
  assert.strictEqual(it.crew, '김부기 F/O');
  assert.strictEqual(it.tag, 'skd:100001:20261201:8236');
  assert.match(it.desc, /\[skd:100001:20261201:8236\]$/);
});

test('월말 STA는 다음 달로 넘어간다', () => {
  const it = SKD.buildItems(D).at(-1);
  assert.strictEqual(SKD.iso(it.end), '2027-01-01T00:40:00');
});

test('근무일별로 묶고 블록 합계를 낸다', () => {
  const items = SKD.buildItems(D, { group: 'day' });
  assert.strictEqual(items.length, 3);
  assert.strictEqual(items[1].title, 'OZ8148·8149·8984 CJU–KWJ–CJU–GMP');
  assert.strictEqual(SKD.dur(items[1].block), '3:05');
  assert.strictEqual(SKD.dur(SKD.buildItems(D).reduce((s, i) => s + i.block, 0)), '6:35');
});

test('Google 이벤트 본문과 .ics', () => {
  const it = SKD.buildItems(D)[0];
  const ev = SKD.toGoogleEvent(it);
  assert.deepStrictEqual(ev.start, { dateTime: '2026-12-01T19:15:00', timeZone: 'Asia/Seoul' });
  assert.strictEqual(ev.extendedProperties.private.skd, it.tag);
  const ics = SKD.toIcs([it], Date.UTC(2026, 10, 17));
  assert.match(ics, /DTSTART:20261201T101500Z/);
  assert.match(ics, /DTEND:20261201T112500Z/);
});
