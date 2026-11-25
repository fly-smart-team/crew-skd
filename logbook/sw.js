/* 오프라인용 서비스 워커: 앱 파일과 글자 인식 엔진을 이 기기에 저장해 두고, 인터넷 없이도 열리게 합니다.
 * 앱 파일을 고치면 VERSION을 올리세요 (app.js의 LOGBOOK_VERSION도 같이). */
const VERSION = '2026.11.25-4';
const CACHE = 'logbook-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.js', 'logbook-core.js', 'ocr.js', 'store.js', 'drive.js', '../config.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/eng.traineddata.gz'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('logbook-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 구글 로그인·드라이브 API는 항상 네트워크
  if (/(^|\.)googleapis\.com$|accounts\.google\.com$/.test(url.hostname) && !/fonts\.googleapis\.com$/.test(url.hostname)) return;

  // 글꼴: 저장해 둔 것 먼저, 뒤에서 갱신
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    ev.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // 페이지: 네트워크 먼저(새 버전 반영), 안 되면 저장본
  if (req.mode === 'navigate') {
    ev.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // 글자 인식 엔진(큼, 거의 안 바뀜): 저장본 먼저
  if (url.pathname.includes('/vendor/')) {
    ev.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    })));
    return;
  }
  // 앱 파일: 인터넷이 되면 새 버전 확인(브라우저 캐시 건너뜀), 안 되면 저장본
  ev.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
