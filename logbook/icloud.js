/* iCloud 동기화 (Apple CloudKit JS)
 * 각 사용자의 iCloud "비공개 데이터베이스"에 로그북 파일 하나(LogbookBackup / pilot-logbook)를 둡니다.
 * 다른 사람은 물론 앱 운영자도 볼 수 없는 영역입니다.
 * 켜려면 Apple 개발자 계정으로 CloudKit 컨테이너와 API 토큰을 만들어 config.js(SKD_CONFIG.cloudkit)나 설정 화면에 넣어야 합니다 → docs/icloud-setup.md
 */
(function () {
  'use strict';
  const LIB = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js';
  const RECORD_TYPE = 'LogbookBackup', RECORD_NAME = 'pilot-logbook';
  const KEY = 'logbook.cloudkit';
  let containerP = null, user = null, signInWaiter = null;
  const listeners = [];

  function config() {
    const fromFile = window.SKD_CONFIG && window.SKD_CONFIG.cloudkit;
    if (fromFile && fromFile.containerIdentifier && fromFile.apiToken) return Object.assign({ environment: 'production' }, fromFile, { source: 'config' });
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && c.containerIdentifier && c.apiToken) return Object.assign({ environment: 'production' }, c, { source: 'device' });
    } catch (e) { /* 무시 */ }
    return null;
  }
  const configured = () => !!config();

  function saveDeviceConfig(c) {
    try {
      if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY);
    } catch (e) { /* 무시 */ }
    containerP = null; user = null;
  }

  function loadLib() {
    if (window.CloudKit) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIB; s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('iCloud 연결 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
      document.head.appendChild(s);
    });
  }

  function container() {
    if (!containerP) {
      containerP = (async () => {
        const c = config();
        if (!c) throw new Error('iCloud 설정(컨테이너·API 토큰)이 없습니다.');
        await loadLib();
        window.CloudKit.configure({
          containers: [{
            containerIdentifier: c.containerIdentifier,
            apiTokenAuth: { apiToken: c.apiToken, persist: true, signInButton: { id: 'ck-sign-in', theme: 'black' }, signOutButton: { id: 'ck-sign-out', theme: 'black' } },
            environment: c.environment || 'production'
          }]
        });
        return window.CloudKit.getDefaultContainer();
      })().catch(e => { containerP = null; throw e; });
    }
    return containerP;
  }

  const notify = () => listeners.forEach(fn => { try { fn(!!user); } catch (e) { /* 무시 */ } });

  /**
   * 로그인 상태 확인. 로그인 안 돼 있으면 화면의 #ck-sign-in 자리에 Apple 로그인 버튼이 그려지고,
   * 사용자가 로그인하면 onChange 콜백이 불림 (Apple 정책상 로그인은 그 버튼으로만 가능)
   */
  async function setUp() {
    const c = await container();
    user = await c.setUpAuth();
    if (user) {
      c.whenUserSignsOut().then(() => { user = null; notify(); setUp().catch(() => {}); });
    } else if (!signInWaiter) {
      signInWaiter = c.whenUserSignsIn().then(u => { signInWaiter = null; user = u; notify(); setUp().catch(() => {}); });
    }
    notify();
    return user;
  }

  const signedIn = () => !!user;
  const onChange = fn => listeners.push(fn);

  function ckError(r, step) {
    const e = (r && r.errors && r.errors[0]) || r || {};
    const code = e.ckErrorCode || e.serverErrorCode || '';
    const err = new Error(`iCloud ${step} 실패${code ? ' (' + code + ')' : ''}${e.reason ? ': ' + e.reason : ''}`);
    err.code = code;
    if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTHENTICATION_FAILED') { user = null; err.needLogin = true; notify(); }
    return err;
  }

  /** 로그북 파일 내려받기 → { text, tag } 또는 null(아직 없음) */
  async function download() {
    if (!user) throw Object.assign(new Error('iCloud에 로그인해 주세요.'), { needLogin: true });
    const db = (await container()).privateCloudDatabase;
    const r = await db.fetchRecords([RECORD_NAME]);
    if (r.hasErrors) {
      const code = r.errors[0] && r.errors[0].ckErrorCode;
      if (code === 'NOT_FOUND' || code === 'UNKNOWN_ITEM') return null;
      throw ckError(r, '내려받기');
    }
    const rec = r.records[0];
    const f = rec && rec.fields && rec.fields.file && rec.fields.file.value;
    if (!f || !f.downloadURL) return null;
    const res = await fetch(f.downloadURL);
    if (!res.ok) throw new Error('iCloud 파일을 내려받지 못했습니다 (HTTP ' + res.status + ')');
    return { text: await res.text(), tag: rec.recordChangeTag };
  }

  /** 올리기. tag는 내려받을 때 받은 값 (다른 기기가 그 사이 고쳤으면 CONFLICT 오류) → 새 tag */
  async function upload(text, tag) {
    if (!user) throw Object.assign(new Error('iCloud에 로그인해 주세요.'), { needLogin: true });
    const db = (await container()).privateCloudDatabase;
    const rec = {
      recordType: RECORD_TYPE, recordName: RECORD_NAME,
      fields: { file: { value: new File([text], 'pilot-logbook.json', { type: 'application/json' }) }, updated: { value: Date.now() } }
    };
    if (tag) rec.recordChangeTag = tag;
    const r = await db.saveRecords([rec]);
    if (r.hasErrors) throw ckError(r, '올리기');
    return r.records[0].recordChangeTag;
  }

  window.LOGBOOK_ICLOUD = { configured, config, saveDeviceConfig, setUp, signedIn, onChange, download, upload };
})();
