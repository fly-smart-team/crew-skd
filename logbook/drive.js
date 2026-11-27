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

  /**
   * 버튼 클릭 등 사용자 동작 안에서 호출해야 함
   * opts.selectAccount: 계정 고르는 창을 꼭 띄움 (다른 계정으로 바꿀 때)
   * opts.hint: 전에 쓰던 계정 이메일 (다시 연결할 때 그 계정을 먼저 제시)
   */
  function signIn(opts) {
    opts = opts || {};
    if (signedIn() && !opts.selectAccount) return Promise.resolve(token);
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
      const req = { prompt: opts.selectAccount ? 'select_account' : '' };
      if (opts.hint && !opts.selectAccount) req.login_hint = opts.hint;
      client.requestAccessToken(req);
    });
  }

  // 로그인 창은 버튼을 눌렀을 때만 띄움(자동으로 띄우면 팝업 차단됨). 토큰이 없으면 needLogin 오류
  async function api(url, opts, step) {
    if (!signedIn()) throw Object.assign(new Error('구글 드라이브에 다시 연결해 주세요.'), { needLogin: true });
    const t = token;
    let r;
    try {
      r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (opts && opts.headers) || {}) }));
    } catch (e) {
      // 응답 자체가 없음: 인터넷 끊김, 또는 브라우저가 요청을 막음 (Brave Shields, 광고 차단기 등)
      const brave = navigator.brave ? ' Brave를 쓰신다면 주소창의 사자 아이콘 → 이 사이트 Shields 끄기 후 다시 시도해 주세요.' : ' 광고·추적 차단 기능이 있다면 이 사이트에서 꺼 주세요.';
      throw new Error(`${step || '드라이브 요청'} 단계에서 구글 서버에 연결하지 못했습니다.${brave}`);
    }
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
        const r = await api(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`, null, '파일 확인');
        const j = await r.json();
        if (!j.trashed) return j.id;
      } catch (e) { /* 지워졌으면 새로 찾음 */ }
    }
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const r = await api(`${API}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`, null, '파일 찾기');
    const j = await r.json();
    return j.files && j.files[0] ? j.files[0].id : null;
  }

  async function download(id) {
    const r = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`, null, '내려받기');
    return r.text();
  }

  async function upload(id, text) {
    const meta = id ? {} : { name: FILE_NAME, mimeType: 'application/json', description: '조종사 전자 로그북 백업 (자동 동기화)' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', new Blob([text], { type: 'application/json' }));
    const url = id ? `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await api(url, { method: id ? 'PATCH' : 'POST', body: form }, '올리기');
    return (await r.json()).id;
  }

  /** 연결 끊기: 이 기기의 토큰을 지우고 구글에도 권한 반납 */
  function signOut() {
    const t = token;
    token = ''; tokenExp = 0;
    try { localStorage.removeItem('logbook.driveToken'); } catch (e) { /* 무시 */ }
    if (t && gisReady()) { try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* 무시 */ } }
  }

  /** 연결된 계정 { email, name } (drive.file 권한으로 읽을 수 있는 about.user) */
  async function account() {
    const r = await api(`${API}/about?fields=user(emailAddress,displayName)`, null, '계정 확인');
    const j = await r.json();
    return { email: (j.user && j.user.emailAddress) || '', name: (j.user && j.user.displayName) || '' };
  }

  window.LOGBOOK_DRIVE = { signIn, signOut, signedIn, account, findFile, download, upload, gisReady, FILE_NAME };
})();
