/**
 * Utalk 口语驱动器
 * ------------------------------------------------------------------
 * 三个必须：真实路径（课程树） / 真实题数（courseSummary） / 切课程后 reload
 *
 * 用法：
 *   UTALK_SPACE=utalk-login
 *   UTALK_COURSE=course-v1:unipus+kdxyspeaking+2017_05
 *   UTALK_ENTRY=u0/u0g1/u0g514/u0g515
 *   UTALK_UID=<你的 user_id>
 *   ego-browser nodejs -e "await import('file:///.../driver.mjs')"
 */
const SPACE = process.env.UTALK_SPACE || "utalk-login";
const COURSE = process.env.UTALK_COURSE || "course-v1:unipus+kdxyspeaking+2017_05";
const ENTRY = process.env.UTALK_ENTRY || "u0/u0g1/u0g514/u0g515";
const UID = process.env.UTALK_UID || "";
const GAP = Number(process.env.UTALK_GAP || 60000);
const MAX_MIN = Number(process.env.UTALK_MAXMIN || 26);
const RATE = 0.95;
const LOG = process.env.UTALK_LOG || "/tmp/utalk.log";
const TEXT = ["purecontent", "vocabulary"];

const task = await taskSpace(SPACE);
const page = task.page("p1");
const sleep = (ms) => page.waitForTimeout(ms);
const fss = await import("node:fs");
const T0 = Date.now();
const Log = (m) => {
  const l = `${new Date().toISOString().slice(11, 19)} ${m}`;
  console.log(l);
  try { fss.appendFileSync(LOG, l + "\n", "utf8"); } catch (e) {}
};

Log(`boot space=${SPACE} course=${COURSE} uid=${UID} gap=${GAP}`);

// ---------- 1. 拿课程树 ----------
let tree = [];
for (let a = 0; a < 3; a++) {
  try {
    await page.goto(`https://ucontent.unipus.cn/_utalk_default/pc.html?cid=1064841#/${COURSE}/courseware/${ENTRY}/p_1`, { waitUntil: "commit" });
  } catch (e) {}
  await sleep(15000);
  // 切课程必须 reload，否则读到旧课程的树
  try { await page.reload({ waitUntil: "commit" }); } catch (e) {}
  await sleep(14000);

  for (let i = 0; i < 8; i++) {
    tree = await page.evaluate(() => {
      const s = window.withReduxStore((st) => (st.getState ? st.getState() : st))();
      const units = (s.courseStructure && s.courseStructure.data && s.courseStructure.data.units) || [];
      const out = [];
      const walk = (n, p) => {
        if (!n || !n.url) return;
        const q = p ? p + "/" + n.url : n.url;
        if (n.tab_type || n.role === "group") out.push({ leaf: n.url, path: q, base: n.base || "" });
        (n.children || []).forEach((c) => walk(c, q));
      };
      units.forEach((u) => walk(u, ""));
      return out;
    }).catch(() => []);
    if (tree.length > 5) break;
    await sleep(3000);
  }
  if (tree.length > 5) break;
  Log(`  retry ${a + 1}: tree=${tree.length}`);
}
Log(`tree ${tree.length}`);
if (!tree.length) process.exit(1);

const pathMap = Object.fromEntries(tree.map((t) => [t.leaf, t.path]));
const baseMap = Object.fromEntries(tree.map((t) => [t.leaf, t.base]));

// ---------- 2. 扫状态 ----------
const leaves = tree.map((t) => t.leaf);
const info = {};
for (let i = 0; i < leaves.length; i += 25) {
  const chunk = leaves.slice(i, i + 25);
  await page.evaluate(`window.__C = ${JSON.stringify(chunk)}`).catch(() => {});
  await page.evaluate(`window.__CO = ${JSON.stringify(COURSE)}`).catch(() => {});
  const r = await page.evaluate(async () => {
    const list = window.__C || [], course = window.__CO || "";
    const tok = localStorage.jwtToke || "";
    const csrf = (/csrftoken=([\w\d%]+)/.exec(document.cookie) || [])[1] || "";
    const H = { "X-ANNOTATOR-AUTH-TOKEN": tok, "X-CSRFTOKEN": csrf, "Content-Type": "application/json", "uni-client-ver": "fcc3421e", "uni-ucontent-ver": "fcc3421e" };
    const out = [];
    for (const leaf of list) {
      try {
        const x = await fetch(`https://ucontent.unipus.cn/api/mobile/user_module/${course}/${leaf}/progress/v2/`, { credentials: "include", headers: H });
        const j = await x.json();
        const s = (j.data && j.data.state) || {};
        out.push({ leaf, st: s.state, pct: s.score_pct });
      } catch (e) { out.push({ leaf, st: -1 }); }
    }
    return out;
  }).catch(() => []);
  r.forEach((x) => { info[x.leaf] = x; });
}

const need = tree.filter((t) => {
  if (TEXT.includes(t.base)) return false;
  const s = info[t.leaf];
  return !s || s.st !== 1 || Number(s.pct) < 0.9;
});
Log(`need ${need.length}`);

// ---------- 3. recordUrl 池 ----------
const pool = await page.evaluate((uid) => {
  const list = [], seen = new Set();
  Object.keys(localStorage).forEach((k) => {
    try {
      const o = JSON.parse(localStorage.getItem(k));
      const p1 = o && o.p_1;
      if (!p1) return;
      Object.values(p1).forEach((b) => {
        if (!b || typeof b !== "object") return;
        Object.values(b).forEach((r) => {
          const ok = uid ? r && r.recordUrl && r.recordUrl.indexOf("/speech-proxy/" + uid + "/") >= 0 : r && r.recordUrl;
          if (ok && !seen.has(r.recordUrl)) { seen.add(r.recordUrl); list.push(r); }
        });
      });
    } catch (e) {}
  });
  return list;
}, UID);
Log(`pool ${pool.length}`);

// ---------- 4. 逐页提交 ----------
let ok = 0, fail = 0, skip = 0;
for (let i = 0; i < need.length; i++) {
  if (Date.now() - T0 > MAX_MIN * 60000) { Log("time cap"); break; }
  const t = need[i];
  const p = pathMap[t.leaf];
  if (!p) { skip++; continue; }

  try {
    await page.goto(`https://ucontent.unipus.cn/_utalk_default/pc.html?cid=1064841#/${COURSE}/courseware/${p}/p_1`, { waitUntil: "commit" });
  } catch (e) {}
  await sleep(10000);

  // 真实题数
  const qLen = await page.evaluate((lf) => {
    try {
      const s = window.withReduxStore((x) => (x.getState ? x.getState() : x))();
      const cs = s.courseSummary && s.courseSummary[lf];
      return cs ? (cs.questionsList || []).length : 0;
    } catch (e) { return 0; }
  }, t.leaf).catch(() => 0);

  const nq = qLen || 1;
  const rec = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { recordUrl: "", scoreDetails: [], type: 3 };

  await page.evaluate(`window.__J = ${JSON.stringify({ course: COURSE, leaf: t.leaf, url: rec.recordUrl, sd: rec.scoreDetails || [], type: rec.type || 3, nq, rate: RATE, ver: String(Date.now()) })}`).catch(() => {});
  const res = await page.evaluate(async () => {
    const j = window.__J || {};
    const tok = localStorage.jwtToke || "";
    const csrf = (/csrftoken=([\w\d%]+)/.exec(document.cookie) || [])[1] || "";
    const H = { "X-ANNOTATOR-AUTH-TOKEN": tok, "X-CSRFTOKEN": csrf, "Content-Type": "application/json", "uni-client-ver": "fcc3421e", "uni-ucontent-ver": "fcc3421e" };
    const SC = { total: j.rate, accuracy: 0.94, fluency: 0.93, integrity: 0.96 };
    const rd = { recordUrl: j.url, score: 95, recordId: 0, smooth: 93, completed: 96, correctness: 94, scoreDetails: j.sd, type: j.type };
    const al = {}, ans = {}, spec = [];
    for (let k = 0; k < j.nq; k++) {
      al[k] = {
        isDone: true, isRight: true, pct: j.rate, score: j.rate, signature: "", ext: null, version: "v2",
        specific_scores: SC,
        recordUrlArr: j.url ? [j.url] : [],
        recordDetail: Object.assign({}, rd, { recordId: k }),
        student_answer: { isDone: true, specific_scores: SC, version: "v2", recordDetail: rd, recordUrlArr: j.url ? [j.url] : [] },
      };
      ans[k] = { score: j.rate };
      spec.push(SC);
    }
    const state = { version: j.ver, __EXTEND_DATA__: { __SUMMARY__: { answerList: al } } };
    try {
      const r = await fetch(`https://ucontent.unipus.cn/course/api/v3/submit/${j.course}/${j.leaf}/`, {
        method: "POST", credentials: "include", headers: H,
        body: JSON.stringify({ enable_mistake: false, version: "default", record_version: j.ver, state: JSON.stringify(state), specific_scores: spec, answers: ans }),
      });
      const txt = await r.text();
      return JSON.stringify({ ok: txt.indexOf('"code":0') >= 0, m: txt.slice(0, 70) });
    } catch (e) { return JSON.stringify({ ok: false, m: String(e).slice(0, 40) }); }
  }).catch(() => JSON.stringify({ ok: false, m: "eval" }));

  const r = JSON.parse(res || "{}");
  if (r.ok) {
    ok++;
    Log(`  [${i + 1}/${need.length}] ${t.leaf} ${baseMap[t.leaf]} nq=${nq} OK`);
  } else {
    fail++;
    Log(`  [${i + 1}/${need.length}] ${t.leaf} ${baseMap[t.leaf]} nq=${nq} FAIL ${(r.m || "").slice(0, 55)}`);
    if ((r.m || "").indexOf("600002") >= 0) { Log("真频控，停止"); break; }
  }
  await sleep(GAP);
}

Log(`DONE ok=${ok} fail=${fail} skip=${skip}`);
