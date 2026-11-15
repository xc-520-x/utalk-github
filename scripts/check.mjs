#!/usr/bin/env node
/**
 * 环境自检 —— 跑 utalk.mjs 之前先执行这个
 *
 *   ego-browser nodejs -e "await import('file:///.../check.mjs')"
 *
 * 检查项：
 *   1. ego 浏览器可连
 *   2. 任务空间存在
 *   3. utalk 已登录（jwtToke 存在）
 *   4. 两门课程可达、节点数正确
 *   5. 当前账号信息
 */

const SPACE = process.env.UTALK_SPACE || "utalk";
const CID = process.env.UTALK_CID || "1064841";
const COURSES = {
  "286": { id: "course-v1:unipus+kdxyspeaking+2017_05", entry: "u0/u0g1/u0g514/u0g515", nodes: 282, name: "校园情景口语" },
  "309": { id: "course-v1:Unipus+sxcet4speaking+2017_09", entry: "u1/u1g1/u1g8", nodes: 55, name: "四级口语开口说" },
};

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);

let task, page;
try {
  task = await taskSpace(SPACE);
  page = task.page("p1");
  ok(`浏览器连接成功，空间 "${SPACE}" (id=${task.spaceId})`);
} catch (e) {
  bad(`连不上任务空间 "${SPACE}"：${String(e).slice(0, 60)}`);
  console.log("\n→ 先在 ego 里新建或打开一个任务空间，然后设置 UTALK_SPACE=<空间名>");
  process.exit(1);
}

const sleep = (ms) => page.waitForTimeout(ms);

// 1. 登录态
console.log("\n[1/4] 检查登录态");
try {
  await page.goto("https://utalk.unipus.cn/page/homePage.html", { waitUntil: "commit" });
} catch (e) {}
await sleep(9000);

const who = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    name: (t.match(/欢迎，(\S+)/) || [])[1] || "",
    needLogin: t.indexOf("密码登录") >= 0,
    tokLen: (localStorage.jwtToke || "").length,
  };
}).catch(() => ({}));

if (who.needLogin) {
  bad("未登录 —— 页面停在登录页");
  console.log("→ 在 ego 浏览器窗口里手动登录 utalk.unipus.cn，完成后再跑一次");
  process.exit(1);
}
if (!who.name) {
  warn("读不到用户名，但页面不是登录页，继续检查");
} else {
  ok(`已登录：${who.name}`);
}

// 2. ucontent 域会话
console.log("\n[2/4] 检查 ucontent 会话");
try {
  await page.goto(`https://ucontent.unipus.cn/_utalk_default/pc.html?cid=${CID}#/${COURSES["286"].id}/courseware/${COURSES["286"].entry}/p_1`, { waitUntil: "commit" });
} catch (e) {}
await sleep(15000);

const tok2 = await page.evaluate(() => (localStorage.jwtToke || "").length).catch(() => 0);
if (tok2 > 0) {
  ok(`jwtToke 已生成（${tok2} 字符）`);
} else {
  bad("ucontent 域没有 jwtToke —— 会话可能过期");
  console.log("→ 在浏览器里重新走一遍登录流程，或刷新播放器页");
  process.exit(1);
}

// 3. 课程可达性 + 节点数
console.log("\n[3/4] 检查课程");
for (const [key, co] of Object.entries(COURSES)) {
  try {
    await page.goto(`https://ucontent.unipus.cn/_utalk_default/pc.html?cid=${CID}#/${co.id}/courseware/${co.entry}/p_1`, { waitUntil: "commit" });
  } catch (e) {}
  await sleep(13000);

  let tree = [];
  for (let i = 0; i < 6; i++) {
    tree = await page.evaluate(() => {
      const s = window.withReduxStore((st) => (st.getState ? st.getState() : st))();
      const units = (s.courseStructure && s.courseStructure.data && s.courseStructure.data.units) || [];
      const out = [];
      const walk = (n, p) => {
        if (!n || !n.url) return;
        const q = p ? p + "/" + n.url : n.url;
        if (n.tab_type || n.role === "group") out.push({ leaf: n.url });
        (n.children || []).forEach((c) => walk(c, q));
      };
      units.forEach((u) => walk(u, ""));
      return out;
    }).catch(() => []);
    if (tree.length > 5) break;
    await sleep(3000);
  }

  const pass = Math.abs(tree.length - co.nodes) < co.nodes * 0.3;
  if (pass) ok(`${key} ${co.name}：${tree.length} 个节点`);
  else warn(`${key} ${co.name}：读到 ${tree.length} 个节点（预期约 ${co.nodes}），可能没切过去，跑的时候脚本会自动 reload 重试`);
}

// 4. 进度快照
console.log("\n[4/4] 当前进度");
try {
  await page.goto("https://utalk.unipus.cn/page/homePage.html", { waitUntil: "commit" });
} catch (e) {}
await sleep(8000);

const prog = await page.evaluate(async () => {
  const out = {};
  for (const id of ["286", "309"]) {
    try {
      const x = await fetch("/api/stu/tutorial/content", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorialId: id, curriculaId: "361019", classId: "1064841" }),
      });
      const j = await x.json();
      const c = j.rs && j.rs.tutorialContent;
      out[id] = c ? `${c.tutorialProgress}% / 正确率 ${c.correctRate}%` : "无数据";
    } catch (e) { out[id] = "查询失败"; }
  }
  return out;
}).catch(() => ({}));

console.log(`  286 校园情景口语  : ${prog["286"] || "?"}`);
console.log(`  309 四级口语开口说: ${prog["309"] || "?"}`);

console.log("\n=== 自检完成 ===");
console.log("可以跑了：");
console.log(`  UTALK_SPACE=${SPACE} UTALK_COURSES=286,309 ego-browser nodejs -e "await import('file:///.../utalk.mjs')"`);
console.log("\n建议先干跑一次看看有多少页：");
console.log(`  UTALK_DRY=1 UTALK_SPACE=${SPACE} ego-browser nodejs -e "await import('file:///.../utalk.mjs')"`);
