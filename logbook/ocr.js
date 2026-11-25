/* OOOI 화면 사진 글자 인식 (Tesseract.js, 오프라인)
 * MCDU는 검은 바탕에 초록·흰·하늘색 글자라, 밝은 글자를 검게 뒤집어 흰 바탕에 검은 글자로 만든 뒤 읽습니다.
 * 결과는 logbook-core.js의 parseOOOI가 받는 토큰 형식 [{text, x0, y0, x1, y1}] (0~1, 왼쪽 위 원점)
 */
(function () {
  'use strict';
  const BASE = new URL('vendor/tesseract/', document.currentScript.src).href;
  let workerPromise = null, progressCb = null;

  let params = {
    tessedit_pageseg_mode: '11',          // 흩어진 글자 (MCDU 칸 배치)
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-<>*',
    preserve_interword_spaces: '1'
  };

  function load(onProgress) {
    progressCb = onProgress || progressCb;
    if (!workerPromise) {
      workerPromise = (async () => {
        const w = await Tesseract.createWorker('eng', 1, {
          workerPath: BASE + 'worker.min.js',
          corePath: BASE + 'core/',
          langPath: BASE + 'lang/',
          gzip: true,
          logger: m => { if (progressCb && m && typeof m.progress === 'number') progressCb(m.status, m.progress); }
        });
        await w.setParameters(params);
        return w;
      })().catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('사진을 열 수 없습니다.'));
      img.src = src;
    });
  }

  /**
   * 밝은 글자 → 검은 글자. 주변 밝기보다 확실히 밝은 점만 글자로 봐서 반사·긁힘을 줄임
   * opts: { maxSide: 긴 변 픽셀, angle: 기울기 보정(도), quarter: 90° 회전 횟수 }
   */
  function preprocess(img, opts) {
    opts = opts || {};
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.min(1, (opts.maxSide || 1800) / Math.max(iw, ih));
    const sw = Math.round(iw * s), sh = Math.round(ih * s);
    const q = ((opts.quarter || 0) % 4 + 4) % 4;
    const w = q % 2 ? sh : sw, h = q % 2 ? sw : sh;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate((q * 90 - (opts.angle || 0)) * Math.PI / 180);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const d = ctx.getImageData(0, 0, w, h), p = d.data;

    const v = new Float32Array(w * h);
    for (let i = 0, j = 0; i < p.length; i += 4, j++) v[j] = Math.max(p[i], p[i + 1], p[i + 2]);
    // 적분 영상으로 주변 평균 밝기
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += v[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; }
    }
    const R = Math.max(8, Math.round(Math.min(w, h) / 40));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
        const mean = (ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const val = v[y * w + x];
        const o = (y * w + x) * 4, out = val > mean + 28 && val > 90 ? 0 : 255;
        p[o] = p[o + 1] = p[o + 2] = out; p[o + 3] = 255;
      }
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  async function ocrCanvas(canvas) {
    const worker = await load();
    const { data } = await worker.recognize(canvas);
    const W = canvas.width, H = canvas.height;
    return (data.words || [])
      .filter(wd => wd.text && wd.text.trim())
      .map(wd => ({ text: wd.text.trim(), x0: wd.bbox.x0 / W, y0: wd.bbox.y0 / H, x1: wd.bbox.x1 / W, y1: wd.bbox.y1 / H, conf: wd.confidence }));
  }

  /**
   * 사진 → OOOI 화면 값. 한 번 읽어서 확실하면 끝, 아니면 기울기 보정·다른 배율로 더 읽어 합칩니다.
   * onStep(text): 진행 상황 문구
   * 반환: { reading (LOGBOOK.parseOOOI 결과), sets (OCR 토큰 묶음들), canvas (처리한 흑백 이미지), passes }
   */
  async function scan(src, opts) {
    opts = opts || {};
    const L = window.LOGBOOK, step = opts.onStep || (() => {});
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    try {
      const img = await loadImage(url);
      step('글자 인식 준비 중…');
      await load((status, p) => { if (/load|init/i.test(status)) step('글자 인식 준비 중… ' + Math.round(p * 100) + '%'); });
      const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
      const parse = sets => L.parseOOOI(sets, { airports: opts.airports });

      step('읽는 중… (1/3)');
      let canvas = preprocess(img, { maxSide: 1800 });
      const sets = [await ocrCanvas(canvas)];
      let reading = parse(sets);

      // OOOI 화면을 못 찾으면 옆으로 누운 사진일 수 있음
      if (!reading.isOOOIPage) {
        for (const q of [1, 3]) {
          const c = preprocess(img, { maxSide: 1800, quarter: q });
          const t = await ocrCanvas(c);
          const r = parse([t]);
          if (r.isOOOIPage) { sets.splice(0, sets.length, t); reading = r; canvas = c; opts.quarter = q; break; }
        }
      }
      if (!reading.confident && reading.isOOOIPage) {
        const skew = L.estimateSkew(sets[0], opts.quarter % 2 ? 1 / aspect : aspect);
        const angle = Math.abs(skew) > 0.8 ? skew : 0;
        step('다시 읽는 중… (2/3)');
        if (angle) {
          const c = preprocess(img, { maxSide: 1800, angle, quarter: opts.quarter });
          sets.push(await ocrCanvas(c));
          reading = parse(sets);
          canvas = c;
        }
        if (!reading.confident) {
          step('다시 읽는 중… (3/3)');
          sets.push(await ocrCanvas(preprocess(img, { maxSide: 1100, angle, quarter: opts.quarter })));
          reading = parse(sets);
        }
      }
      return { reading, sets, canvas, passes: sets.length };
    } finally {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
    }
  }

  /** JPEG의 EXIF 촬영 시각(ms). 없으면 null. iPad 사진 보관함에서 고른 사진의 날짜 추정용 */
  async function captureTime(file) {
    try {
      const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if (buf.getUint16(0) !== 0xFFD8) return null;
      let p = 2;
      while (p + 4 < buf.byteLength) {
        const marker = buf.getUint16(p), len = buf.getUint16(p + 2);
        if (marker === 0xFFE1 && buf.getUint32(p + 4) === 0x45786966) return readExif(buf, p + 10);
        p += 2 + len;
      }
    } catch (e) { /* 읽을 수 없음 */ }
    return null;
  }

  function readExif(v, tiff) {
    const le = v.getUint16(tiff) === 0x4949;
    const u16 = o => v.getUint16(tiff + o, le), u32 = o => v.getUint32(tiff + o, le);
    const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(tiff + o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
    const tags = ifd => {
      const out = {}, n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12, tag = u16(e), count = u32(e + 4);
        out[tag] = { type: u16(e + 2), count, off: count > 4 ? u32(e + 8) : e + 8, val: u32(e + 8) };
      }
      return out;
    };
    const ifd0 = tags(u32(4));
    if (!ifd0[0x8769]) return null;
    const ex = tags(ifd0[0x8769].val);
    const dt = ex[0x9003] || ex[0x9004];
    if (!dt) return null;
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(str(dt.off, dt.count));
    if (!m) return null;
    const off = ex[0x9011] ? str(ex[0x9011].off, ex[0x9011].count) : ''; // "+09:00"
    const om = /^([+-])(\d{2}):(\d{2})$/.exec(off);
    if (om) {
      const mins = (om[1] === '-' ? -1 : 1) * (+om[2] * 60 + +om[3]);
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - mins * 60000;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); // 기기 시간대로 가정
  }

  async function setParams(p) { params = Object.assign({}, params, p); if (workerPromise) await (await workerPromise).setParameters(params); }
  window.LOGBOOK_OCR = { load, scan, preprocess, setParams, captureTime };
})();
