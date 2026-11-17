/* crew-skd 독립 웹앱: Google Identity Services 토큰 + Calendar REST API */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { parseSkd, buildItems, gLink, toIcs, toGoogleEvent, iso, hm, dlabel, dur, DAY } = window.SKD;
  const API = 'https://www.googleapis.com/calendar/v3';
  const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
  const LBL = { new: '', dup: '이미 있음', ok: '추가됨', bad: '실패', busy: '추가 중…' };
  const S = { data: null, group: 'leg', start: 'std', items: [], status: {}, cal: 'primary' };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } }
  };

  /* ---------- Google 인증 ---------- */
  let token = '', tokenExp = 0, client = null, pending = null;
  const clientId = () => (window.SKD_CONFIG && SKD_CONFIG.googleClientId) || store.get('skd.clientId');
  const signedIn = () => token && Date.now() < tokenExp - 60000;

  function ensureToken() {
    if (signedIn()) return Promise.resolve(token);
    if (!clientId()) { $('set').open = true; return Promise.reject(new Error('먼저 설정에서 Google OAuth 클라이언트 ID를 넣어 주세요.')); }
    if (!(window.google && google.accounts && google.accounts.oauth2)) return Promise.reject(new Error('Google 로그인 스크립트를 아직 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.'));
    if (!client || client._id !== clientId()) {
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPES,
        callback: r => {
          const p = pending; pending = null; if (!p) return;
          if (r.error) return p.rej(new Error('Google 로그인 실패: ' + r.error));
          token = r.access_token; tokenExp = Date.now() + (+r.expires_in || 3600) * 1000;
          $('who').textContent = '로그인됨'; $('login').textContent = '다시 로그인';
          p.res(token);
        },
        error_callback: e => { const p = pending; pending = null; if (p) p.rej(new Error(e && e.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : '로그인 창을 열 수 없습니다. 팝업 차단을 확인해 주세요.')); }
      });
      client._id = clientId();
    }
    return new Promise((res, rej) => { pending = { res, rej }; client.requestAccessToken({ prompt: token ? '' : 'consent' }); });
  }

  async function gcal(path, opts) {
    const t = await ensureToken();
    const r = await fetch(API + path, Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } }));
    if (r.status === 401) { token = ''; $('who').textContent = '로그인 만료'; throw new Error('로그인이 만료됐습니다. 다시 로그인해 주세요.'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || ('HTTP ' + r.status)); }
    return r.status === 204 ? null : r.json();
  }

  async function loadCals() {
    const j = await gcal('/users/me/calendarList?minAccessRole=writer');
    const sel = $('cal'), keep = S.cal;
    sel.innerHTML = '<option value="primary">기본 캘린더</option>' + (j.items || []).filter(c => !c.primary)
      .map(c => `<option value="${esc(c.id)}">${esc(c.summaryOverride || c.summary)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === keep) ? keep : 'primary';
    S.cal = sel.value;
  }

  async function checkDup() {
    if (!signedIn() || !S.items.length) return;
    const ts = S.items.map(i => i.day);
    const q = new URLSearchParams({ timeMin: iso(Math.min(...ts) - DAY) + '+09:00', timeMax: iso(Math.max(...ts) + 2 * DAY) + '+09:00',
      singleEvents: 'true', maxResults: '2500', fields: 'items(description,extendedProperties),nextPageToken' });
    const tags = new Set();
    let tok = '';
    try {
      for (let k = 0; k < 5; k++) {
        if (tok) q.set('pageToken', tok);
        const j = await gcal(`/calendars/${encodeURIComponent(S.cal)}/events?` + q);
        (j.items || []).forEach(e => {
          const p = e.extendedProperties && e.extendedProperties.private;
          if (p && p.skd) tags.add(p.skd);
          const m = /\[(skd:[^\]]+)\]/.exec(e.description || ''); if (m) tags.add(m[1]);
        });
        tok = j.nextPageToken; if (!tok) break;
      }
      let d = 0;
      S.items.forEach(it => { if (tags.has(it.tag)) { S.status[it.tag] = 'dup'; d++; } else if (S.status[it.tag] === 'dup') delete S.status[it.tag]; });
      render();
      say(d ? `${S.items.length}건 중 ${d}건은 이미 캘린더에 있습니다.` : `${S.items.length}건 모두 새 일정입니다.`);
    } catch (e) { say(e.message, 'bad'); }
  }

  /* ---------- 화면 ---------- */
  function say(t, cls) { const m = $('msg'); m.textContent = t; m.className = 'msg ' + (cls || ''); }
  function rebuild() { S.items = buildItems(S.data, { group: S.group, start: S.start }); }

  function render() {
    const D = S.data;
    $('meta').innerHTML = D ? `<span>월 <b>${D.month.slice(0, 4)}.${D.month.slice(4)}</b></span><span>사번 <b>${esc(D.emp)}</b></span>${D.me ? `<span>이름 <b>${esc(D.me)}</b></span>` : ''}<span>일정 <b>${S.items.length}건</b></span><span>BLOCK <b>${dur(S.items.reduce((s, i) => s + i.block, 0))}</b></span>` : '';
    $('board').innerHTML = S.items.length ? S.items.map((it, i) => {
      const s = S.status[it.tag] || 'new', locked = s === 'dup' || s === 'ok';
      return `<li class="row"><input type="checkbox" data-i="${i}" ${it.on && !locked ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(it.title)} 선택">
      <div class="t">${it.allDay ? '종일' : hm(it.start)}<small>${it.allDay ? '' : '– ' + hm(it.end)}</small></div>
      <div><div class="d">${dlabel(it.day)}</div><div class="ttl">${esc(it.title)}</div>${it.crew ? `<div class="crew">${esc(it.crew)}</div>` : ''}</div>
      <div class="side">${LBL[s] ? `<span class="st ${s}">${LBL[s]}</span>` : ''}<a href="${gLink(it)}" target="_blank" rel="noopener">구글에서 열기</a></div></li>`;
    }).join('') : `<li class="empty">${D ? '이 파일에서 본인 일정을 찾지 못했습니다.' : '아직 불러온 스케줄이 없습니다.'}</li>`;
    const n = todo().length;
    $('add').disabled = !n; $('add').textContent = n ? `${n}건 캘린더에 추가` : '캘린더에 추가';
    $('ics').disabled = !S.items.length;
  }
  const todo = () => S.items.filter(i => i.on && !['dup', 'ok'].includes(S.status[i.tag]));

  function load(buf, name) {
    try {
      const wb = XLSX.read(buf, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      S.data = parseSkd(rows); S.status = {}; rebuild(); render();
      $('fname').textContent = name;
      say(`${S.items.length}건을 찾았습니다.` + (signedIn() ? ' 중복 확인 중…' : ' 넣으려면 추가 버튼을 누르세요.'));
      checkDup();
    } catch (e) { say('읽기 실패: ' + e.message, 'bad'); }
  }

  $('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(b => load(b, f.name)); e.target.value = ''; });
  const dz = $('drop');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) f.arrayBuffer().then(b => load(b, f.name)); });

  function seg(id, key) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S[key] = b.dataset.v; [...$(id).children].forEach(x => x.setAttribute('aria-pressed', x === b));
      rebuild(); render(); checkDup();
    });
  }
  seg('segGroup', 'group'); seg('segStart', 'start');
  $('board').addEventListener('change', e => { const i = e.target.dataset.i; if (i != null) { S.items[i].on = e.target.checked; render(); } });
  $('cal').addEventListener('change', e => { S.cal = e.target.value; store.set('skd.cal', S.cal); S.status = {}; render(); checkDup(); });

  $('login').addEventListener('click', () => {
    token = '';
    ensureToken().then(() => loadCals()).then(() => { say('로그인했습니다.', 'ok'); return checkDup(); }).catch(e => say(e.message, 'bad'));
  });

  $('add').addEventListener('click', async () => {
    const list = todo(); if (!list.length) return;
    $('add').disabled = true;
    try { await ensureToken(); } catch (e) { say(e.message, 'bad'); render(); return; }
    if ($('cal').options.length === 1) await loadCals().catch(() => {});
    await checkDup();
    let ok = 0, bad = 0, last = '';
    for (const it of todo()) {
      S.status[it.tag] = 'busy'; render();
      try {
        await gcal(`/calendars/${encodeURIComponent(S.cal)}/events`, { method: 'POST', body: JSON.stringify(toGoogleEvent(it)) });
        S.status[it.tag] = 'ok'; ok++;
      } catch (e) { S.status[it.tag] = 'bad'; bad++; last = e.message; if (!signedIn()) break; }
      render();
    }
    Object.keys(S.status).forEach(k => { if (S.status[k] === 'busy') delete S.status[k]; });
    render();
    if (bad) say(`${ok}건 추가, ${bad}건 실패. ${last}`, 'bad'); else say(`${ok}건을 캘린더에 추가했습니다.`, 'ok');
  });

  $('ics').addEventListener('click', () => {
    const blob = new Blob([toIcs(S.items.filter(i => i.on))], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `SKD_${S.data.month}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('.ics 파일을 저장했습니다. 구글 캘린더 → 설정 → 가져오기에서 올리면 됩니다.', 'ok');
  });

  $('cid').value = clientId();
  $('saveCid').addEventListener('click', () => { store.set('skd.clientId', $('cid').value.trim()); client = null; say('클라이언트 ID를 저장했습니다.', 'ok'); });
  S.cal = store.get('skd.cal') || 'primary';
  render();
})();
