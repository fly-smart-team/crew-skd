// 가상 승무원으로 회사 SKD와 같은 구조의 .xls를 만든다: node tests/make-fixture.js
const XLSX = require('xlsx');
const path = require('path');
const blank = n => Array(n).fill('');
const row = (date, fl, show, sec, std, sta, emp, name, rank, posn) =>
  [date, '', fl, '', '', show, '', '', sec, '', std, sta, emp, name, '', rank, '', '', 'TL', posn, ''];
const rows = [
  [...blank(6), 'MONTHLY SKD', ...blank(14)],
  blank(21),
  ['EMPL : ', '100001', '', '', 'MONTH : ', '', '', '202612', ...blank(6), 'PRINT :', '', '', '', '', '', '1/1'],
  ['DUTY : 0:00(BLOCK)', ...blank(20)],
  ['DATE', '', 'FLIGHT', '', '', 'SHOW UP', '', '', 'SECTOR', '', 'STD', 'STA', 'EMPL', 'NAME', '', 'RANK', '', '', 'POSN \nTYP', 'POSN', ''],
  row('12/01(화)', '8236', '', 'CJU/CJJ', '01 19:15', '01 20:25', '100001', '홍길동', 'CAP', 'C'),
  row('12/01(화)', '', '', '', '', '', '100002', '김부기', 'F/O', 'F'),
  row('12/01(화)', '8237', '', 'CJJ/CJU', '01 20:55', '01 22:05', '100001', '홍길동', 'CAP', 'C'),
  row('12/01(화)', '', '', '', '', '', '100002', '김부기', 'F/O', 'F'),
  row('12/02(수)', '8148', '', 'CJU/KWJ', '02 17:10', '02 18:05', '100001', '홍길동', 'CAP', 'C'),
  row('12/02(수)', '', '', '', '', '', '100002', '김부기', 'F/O', 'F'),
  row('12/02(수)', '8149', '', 'KWJ/CJU', '02 18:40', '02 19:35', '100001', '홍길동', 'CAP', 'C'),
  row('12/02(수)', '', '', '', '', '', '100002', '김부기', 'F/O', 'F'),
  row('12/02(수)', '8984', '', 'CJU/GMP', '02 20:40', '02 21:55', '100001', '홍길동', 'CAP', 'C'),
  row('12/02(수)', '', '', '', '', '', '100002', '김부기', 'F/O', 'F'),
  row('12/31(목)', '8999', '', 'GMP/CJU', '31 23:30', '01 00:40', '100001', '홍길동', 'CAP', 'C'),
  row('12/31(목)', '', '', '', '', '', '100003', '이부기', 'F/O', 'F')
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'sheet 1');
XLSX.writeFile(wb, path.join(__dirname, 'fixtures', 'sample.xls'), { bookType: 'biff8' });
console.log('tests/fixtures/sample.xls');
