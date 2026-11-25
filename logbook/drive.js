/* 구글 드라이브 동기화
 * 내 드라이브에 "pilot-logbook.json" 파일 하나를 두고, 이 기기 기록과 합칩니다.
 * 권한은 drive.file: 이 앱이 만든 파일만 볼 수 있고, 드라이브의 다른 파일은 보지 못합니다.
 */
(function () {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILE_NAME = 'pilot-logbook.json';
  const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  let token = '', tokenExp = 0, client = null, pending = null;
  // 토큰(1시간짜리)을 이 기기에 잠시 보관: 앱을 다시 열어도 1시간 안에는 다시 로그인하지 않아도 됨
  try {
    const saved = JSON.parse(localStorage.getItem('logbook.driveToken') || 'null');
    if (saved && saved.exp > Date.now() + 60000) { token = saved.token; tokenExp = saved.exp; }
  } catch (e) { /* 무시 */ }
  const keep = () => { try { localStorage.setItem('logbook.driveToken', JSON.stringify({ token, exp: tokenExp })); } catch (e) { /* 무시 */ } };

  const clientId = () => (window.SKD_CONFIG && window.SKD_CONFIG.googleClientId) || '';
  const signedIn = () => !!token && Date.now() < tokenExp - 60000;
  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);

  /** 버튼 클릭 등 사용자 동작 안에서 호출해야 함 */
  function signIn() {
    if (signedIn()) return Promise.resolve(token);
    if (!clientId()) return Promise.reject(new Error('Google 클라이언트 ID가 설정되지 않았습니다 (config.js).'));
    if (!gisReady()) return Promise.reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    if (!client) {
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPE,
        callback: r => {
          const p = pending; pending = null;
          if (!p) return;
          if (r.error) return p.rej(new Error('Google 로그인 실패: ' + r.error));
          token = r.access_token;
          tokenExp = Date.now() + (+r.expires_in || 3600) * 1000;
          keep();
          p.res(token);
        },
        error_callback: e => {
          const p = pending; pending = null;
          if (p) p.rej(new Error(e && e.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : '로그인 창을 열 수 없습니다. 팝업 차단을 확인해 주세요.'));
        }
      });
    }
    return new Promise((res, rej) => {
      pending = { res, rej };
      client.requestAccessToken({ prompt: '' });
    });
  }

  // 로그인 창은 버튼을 눌렀을 때만 띄움(자동으로 띄우면 팝업 차단됨). 토큰이 없으면 needLogin 오류
  async function api(url, opts) {
    if (!signedIn()) throw Object.assign(new Error('구글 드라이브에 다시 연결해 주세요.'), { needLogin: true });
    const t = token;
    const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (opts && opts.headers) || {}) }));
    if (r.status === 401) { token = ''; throw Object.assign(new Error('구글 로그인이 만료됐습니다. 다시 연결해 주세요.'), { needLogin: true }); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
      if (/has not been used|is disabled/i.test(msg)) throw new Error('Google Cloud에서 Drive API를 켜야 합니다 (docs/google-setup.md 참고).');
      throw new Error(msg);
    }
    return r;
  }

  async function findFile(knownId) {
    if (knownId) {
      try {
        const r = await api(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`);
        const j = await r.json();
        if (!j.trashed) return j.id;
      } catch (e) { /* 지워졌으면 새로 찾음 */ }
    }
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const r = await api(`${API}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    const j = await r.json();
    return j.files && j.files[0] ? j.files[0].id : null;
  }

  async function download(id) {
    const r = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return r.text();
  }

  async function upload(id, text) {
    const meta = { name: FILE_NAME, mimeType: 'application/json', description: '조종사 전자 로그북 백업 (자동 동기화)' };
    const boundary = 'lb' + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(id ? { mimeType: meta.mimeType } : meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const url = id ? `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await api(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    return (await r.json()).id;
  }

  window.LOGBOOK_DRIVE = { signIn, signedIn, findFile, download, upload, gisReady, FILE_NAME };
})();
