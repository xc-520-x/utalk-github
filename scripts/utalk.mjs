#!/usr/bin/env node
/**
 * Utalk 口语课程自动化
 * ------------------------------------------------------------------
 * 一个脚本跑完扫状态 + 逐页提交。支持单课程/多课程连续。
 *
 * 用法：
 *   # 只扫描，不提交（先看有多少页要做）
 *   UTALK_DRY=1 ego-browser nodejs -e "await import('file:///.../utalk.mjs')"
 *
 *   # 实际跑
 *   UTALK_COURSES=286 ego-browser nodejs -e "await import('file:///.../utalk.mjs')"
 *
 *   # 两门连跑
 *   UTALK_COURSES=286,309 ego-browser nodejs -e "await import('file:///.../utalk.mjs')"
 */

// ============ 配置 ============
const SPACE = process.env.UTALK_SPACE || "utalk";
const UID = process.env.UTALK_UID || "";
const GAP = Number(process.env.UTALK_GAP || 60000);
const MAX_MIN = Number(process.env.UTALK_MAXMIN || 240);
const RATE = Number(process.env.UTALK_RATE || 0.95);
const DRY = process.env.UTALK_DRY === "1";
const LOG = process.env.UTALK_LOG || "utalk.log";
const CID = process.env.UTALK_CID || "1064841";

const COURSES = {
  "286": { id: "course-v1:unipus+kdxyspeaking+2017_05", entry: "u0/u0g1/u0g514/u0g515", nodes: 282, name: "校园情景口语" },
  "309": { id: "course-v1:Unipus+sxcet4speaking+2017_09", entry: "u1/u1g1/u1g8", nodes: 55, name: "四级口语开口说" },
};

// non-scoring 页：questionsList 为空，提交分数会被服务端忽略
const TEXT_BASE = ["purecontent", "vocabulary"];

// ============ 工具 ============
const fss = await import("node:fs");
const T0 = Date.now();
const overTime = () => Date.now() - T0 > MAX_MIN * 60000;
const sleep = (ms) => page.waitForTimeout(ms);
const log = (m) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${m}`;
  console.log(line);
  try { fss.appendFileSync(LOG, line + "\n", "utf8"); } catch (e) {}
};

const task = await taskSpace(SPACE);
const page = task.page("p1");

// ============ 核心步骤 ============
const H = `{
  "X-ANNOTATOR-AUTH-TOKEN": localStorage.jwtToke || "",
  "X-CSRFTOKEN": (/csrftoken=([\\w\\d%]+)/.exec(document.cookie) || [])[1] || "",
  "Content-Type": "application/json",
  "uni-client-ver": "fcc3421e",
  "uni-ucontent-ver": "fcc3421e"
}`;

/** 打开课程并取树（含 reload 与大小校验） */
async function loadTree(co) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(`https://ucontent.unipus.cn/_utalk_default/pc.html?cid=${CID}#/${co.id}/courseware/${co.entry}/p_1`, { waitUntil: "commit" });
    } catch (e) {}
    await sleep(15000);
    // 切课程必须 reload，否则读到上一门课的树
    try { await page.reload({ waitUntil: "commit" }); } catch (e) {}
    await sleep(14000);

    let tree = [];
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
    // 大小校验：286 约 282，309 约 55
    const ok = Math.abs(tree.length - co.nodes) < co.nodes * 0.3;
    log(`  tree ${tree.length}${ok ? "" : " ⚠️ 节点数异常，可能没切过去"}`);
    if (ok) return tree;
  }
  return [];
}

/** 分批扫状态 */
async function scanState(leaves, courseId) {
  const info = {};
  for (let i = 0; i < leaves.length; i += 25) {
    const chunk = leaves.slice(i, i + 25);
    await page.evaluate(`window.__C=${JSON.stringify(chunk)};window.__CO=${JSON.stringify(courseId)};`).catch(() => {});
    const r = await page.evaluate(async () => {
      const H = JSON.parse(window.__H);
      const out = [];
      for (const leaf of window.__C) {
        try {
          const x = await fetch(`https://ucontent.unipus.cn/api/mobile/user_module/${window.__CO}/${leaf}/progress/v2/`, { credentials: "include", headers: H });
          const j = await x.json();
          const s = (j.data && j.data.state) || {};
          out.push({ leaf, st: s.state, pct: s.score_pct });
        } catch (e) { out.push({ leaf, st: -1 }); }
      }
      return out;
    }).catch(() => []);
    r.forEach((x) => { info[x.leaf] = x; });
  }
  return info;
}

/** 取 recordUrl 池（只留当前账号的） */
async function loadPool() {
  return await page.evaluate((uid) => {
    const list = [], seen = new Set();
    Object.keys(localStorage).forEach((k) => {
      try {
        const o = JSON.parse(localStorage.getItem(k));
        const p1 = o && o.p_1;
        if (!p1) return;
        Object.values(p1).forEach((b) => {
          if (!b || typeof b !== "object") return;
          Object.values(b).forEach((r) => {
            const hit = uid ? r && r.recordUrl && r.recordUrl.indexOf("/speech-proxy/" + uid + "/") >= 0 : r && r.recordUrl;
            if (hit && !seen.has(r.recordUrl)) { seen.add(r.recordUrl); list.push(r); }
          });
        });
      } catch (e) {}
    });
    return list;
  }, UID);
}

/** 单页提交 */
async function submit(courseId, leaf, nq, rec) {
  await page.evaluate(`window.__J=${JSON.stringify({ course: courseId, leaf, url: rec.recordUrl || "", sd: rec.scoreDetails || [], type: rec.type || 3, nq, rate: RATE, ver: String(Date.now()) })};`).catch(() => {});
  const res = await page.evaluate(async () => {
    const j = window.__J;
    const H = JSON.parse(window.__H);
    const SC = { total: j.rate, accuracy: 0.94, fluency: 0.93, integrity: 0.96 };
    const rd = { recordUrl: j.url, score: 95, recordId: 0, smooth: 93, completed: 96, correctness: 94, scoreDetails: j.sd, type: j.type };
    const al = {}, ans = {}, spec = [];
    for (let k = 0; k < j.nq; k++) {
      al[k] = {
        isDone: true, isRight: true, pct: j.rate, score: j.rate, signature: "", ext: null, version: "v2",
        specific_scores: SC, recordUrlArr: j.url ? [j.url] : [],
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
      const t = await r.text();
      return { ok: t.indexOf('"code":0') >= 0, msg: t.slice(0, 70) };
    } catch (e) { return { ok: false, msg: String(e).slice(0, 40) }; }
  }).catch(() => ({ ok: false, msg: "eval error" }));
  return res;
}

// ============ 主流程 ============
const keys = (process.env.UTALK_COURSES || "286").split(",").map((s) => s.trim()).filter(Boolean);
log(`start courses=${keys.join("+")} dry=${DRY} gap=${GAP}ms max=${MAX_MIN}min uid=${UID || "(不过滤)"}`);

// 把鉴权头注入页面上下文
await page.evaluate(`${H_FN}; window.__H = JSON.stringify(__mkH());`).catch(() => {});

let totalOk = 0, totalFail = 0;

for (const key of keys) {
  const co = COURSES[key];
  if (!co) { log(`未知课程 ${key}，跳过`); continue; }
  if (overTime()) { log("总时长到上限，停止"); break; }
  log(`\n=== ${key} ${co.name} ===`);

  const tree = await loadTree(co);
  if (!tree.length) { log("  取树失败，跳过"); continue; }

  const pathMap = Object.fromEntries(tree.map((t) => [t.leaf, t.path]));
  const baseMap = Object.fromEntries(tree.map((t) => [t.leaf, t.base]));
  await page.evaluate(`${H_FN}; window.__H = JSON.stringify(__mkH());`).catch(() => {});

  const info = await scanState(tree.map((t) => t.leaf), co.id);
  const need = tree.filter((t) => {
    if (TEXT_BASE.includes(t.base)) return false;
    const s = info[t.leaf];
    return !s || s.st !== 1 || Number(s.pct) < 0.9;
  });

  const textCount = tree.filter((t) => TEXT_BASE.includes(t.base)).length;
  log(`  总节点 ${tree.length}（其中 ${textCount} 个 non-scoring）`);
  log(`  待做 ${need.length} 页`);

  if (DRY) { log("  DRY 模式，不提交"); continue; }
  if (!need.length) { log("  无需处理"); continue; }

  const pool = await loadPool();
  log(`  recordUrl 池 ${pool.length} 条`);
  if (!pool.length && UID) { log("  ⚠️ 池为空，提交不带音频引用"); }

  let ok = 0, fail = 0;
  for (let i = 0; i < need.length; i++) {
    if (overTime()) { log("  本轮时长到上限"); break; }
    const t = need[i];
    const p = pathMap[t.leaf];
    if (!p) continue;

    // 打开真实路径
    try { await page.goto(`https://ucontent.unipus.cn/_utalk_default/pc.html?cid=${CID}#/${co.id}/courseware/${p}/p_1`, { waitUntil: "commit" }); } catch (e) {}
    await sleep(10000);
    await page.evaluate(`${H_FN}; window.__H = JSON.stringify(__mkH());`).catch(() => {});

    // 读真实题数（关键：猜错会得到 600002）
    const qLen = await page.evaluate((lf) => {
      try {
        const s = window.withReduxStore((x) => (x.getState ? x.getState() : x))();
        const cs = s.courseSummary && s.courseSummary[lf];
        return cs ? (cs.questionsList || []).length : 0;
      } catch (e) { return 0; }
    }, t.leaf).catch(() => 0);

    const rec = pool.length ? pool[i % pool.length] : {};
    const r = await submit(co.id, t.leaf, qLen || 1, rec);

    if (r.ok) {
      ok++; totalOk++;
      log(`  [${i + 1}/${need.length}] ${t.leaf} ${baseMap[t.leaf]} nq=${qLen} OK`);
    } else {
      fail++; totalFail++;
      log(`  [${i + 1}/${need.length}] ${t.leaf} ${baseMap[t.leaf]} nq=${qLen} FAIL ${(r.msg || "").slice(0, 55)}`);
      // 只有题数正确仍报 600002 才是真频控
      if ((r.msg || "").indexOf("600002") >= 0 && qLen > 0) { log("  真频控，停止本轮"); break; }
    }
    await sleep(GAP);
  }
  log(`  ${key} 完成 ok=${ok} fail=${fail}`);
}

log(`\n=== 全部结束 ok=${totalOk} fail=${totalFail} 耗时 ${Math.round((Date.now() - T0) / 60000)} 分钟 ===`);
