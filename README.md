# Utalk / Unipus 口语课程自动化

外研社 Utalk（`utalk.unipus.cn` / `ucontent.unipus.cn`）口语课程的自动化提交工具。

> 仅用于**自己已选修课程**的批量补做与进度修复。所有操作依赖浏览器里已登录的会话，不涉及登录凭据的自动化。

---

## 它解决什么

- 口语题量大、逐页手点耗时
- 某些页面的录音控件在不同版本的学生端上加载不出来
- 需要把课程正确率稳定在目标区间

## 三个必须（踩过的坑，写在最前面）

### 1. 页面路径必须从课程树取

```js
const s = window.withReduxStore(st => st.getState())();
// s.courseStructure.data.units → 递归拿 url 链
const pathMap = Object.fromEntries(tree.map(t => [t.leaf, t.path]));
```

实测：`u0g18` 的真实路径是 `u0/u0g14/u0g18`。**任何靠命名规律猜的路径都是错的**，猜错会导致页面空渲染、提交返回 `601`。

### 2. 题目数必须从 `courseSummary` 读

```js
const qLen = await page.evaluate((lf) => {
  const s = window.withReduxStore(x => x.getState())();
  const cs = s.courseSummary && s.courseSummary[lf];
  return cs ? (cs.questionsList || []).length : 0;
}, leaf);
```

**题数不对时服务端返回 `{"code":600002}` —— 和频控是同一个错误码。**

这是本项目最大的坑：被误判成限流，脚本 abort，整个队列卡死在第一个页。实测 `u0g58` 真实 7 题、`u2g12` 真实 13 题，按 1 题提交必然失败。

### 3. 切换课程后必须 reload

同一 SPA 里 `goto` 另一门课，路由不重挂，`courseStructure` 还是旧课程的。

```js
await page.goto(url); await sleep(15000);
await page.reload({ waitUntil: "commit" }); await sleep(14000);
// 用节点数校验：286 约 282 个，309 约 55 个
```

---

## 接口

### 提交

```
POST https://ucontent.unipus.cn/course/api/v3/submit/{courseId}/{leaf}/
```

```js
{
  enable_mistake: false,
  version: "default",
  record_version: String(Date.now()),
  state: JSON.stringify({ version, __EXTEND_DATA__: { __SUMMARY__: { answerList } } }),
  specific_scores: [SC, ...],           // 长度必须 == 题数
  answers: { "0": {score}, ... }        // 长度必须 == 题数
}
```

- `answers[k].score` 是**归一化分数**（0–1），`0.95` 表示 95%
- `specific_scores` 结构：`{ total, accuracy, fluency, integrity }`
- **服务端不复算**，给多少存多少

回读：

```
GET /api/mobile/user_module/{courseId}/{leaf}/progress/v2/
→ state: { state, score_pct, score_avg, score: "[0.95,0.95]" }
```

### 打点（只对 non-scoring 页）

```
POST /api/mobile/user_module/{courseId}/{leaf}/progress/     ← 注意是 user_group 还是 user_module 按版本
body { status:1, rid:`flowengine:studyStatus:1:${leaf}`, groupId:leaf, version:"default" }
```

`purecontent` / `vocabulary` 这两类页 `questionsList` 为空，**提交分数会返回 code:0 但 `state.score` 永远是 `[]`**，服务端直接忽略。它们只推进度，不参与正确率。

### 鉴权头

```js
{
  "X-ANNOTATOR-AUTH-TOKEN": localStorage.jwtToke,
  "X-CSRFTOKEN": cookie.csrftoken,
  "Content-Type": "application/json",
  "uni-client-ver": "fcc3421e",
  "uni-ucontent-ver": "fcc3421e"
}
```

---

## 用法

依赖 [ego-browser](https://github.com/citrolabs/ego-browser)（一个可被 Agent 驱动的 Chromium）。

```bash
# 1. 在 ego 里手动登录 utalk.unipus.cn
# 2. 进任意一个课程播放器页，让 localStorage.jwtToke 生成

# 3. 跑
UTALK_SPACE=utalk \
UTALK_COURSE=course-v1:unipus+kdxyspeaking+2017_05 \
UTALK_ENTRY=u0/u0g1/u0g514/u0g515 \
UTALK_UID=<你的 user_id> \
UTALK_GAP=60000 \
UTALK_MAXMIN=240 \
ego-browser nodejs -e "await import('file:///path/to/scripts/driver.mjs')"
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `UTALK_SPACE` | `utalk-login` | ego 任务空间名 |
| `UTALK_COURSE` | 286 的 courseId | 课程 ID |
| `UTALK_ENTRY` | `u0/u0g1/u0g514/u0g515` | 进入课程时用的任意一个已知 leaf |
| `UTALK_UID` | 空 | 用于筛选 `recordUrl` 池；空则不过滤 |
| `UTALK_GAP` | 60000 | 每页间隔毫秒 |
| `UTALK_MAXMIN` | 26 | 单次运行分钟上限 |
| `UTALK_LOG` | `/tmp/utalk.log` | 日志路径 |

### 课程 ID 参考

| 课程 | courseId |
|---|---|
| 校园情景口语 | `course-v1:unipus+kdxyspeaking+2017_05` |
| 四级口语开口说 | `course-v1:Unipus+sxcet4speaking+2017_09` |

---

## 频控

| 信号 | 含义 | 处置 |
|---|---|---|
| `600002` + 题数**不对** | 题数错 | 修题数，**不是频控** |
| `600002` + 题数**正确** | 真频控 | 停 30 分钟 |
| `503` | 服务端过载 | 立即停 |
| `601` | 课程切换失败，拿错 leaf | reload 重来 |
| `901 invalid score slice len` | `answers` 长度 ≠ 题数 | 修长度 |

**实测安全速率：60 秒/页。** 21 页连续提交零失败。

**并发是最大杀手**：`job_kill` 杀不掉 `ego-browser nodejs` 子进程，会变孤儿继续跑。日志里出现多套计数器（`[17/105]` `[13/101]` `[8/96]`）就是并发在打。

```powershell
taskkill /F /IM ego-browser.exe
taskkill /F /IM node.exe
```

---

## 成绩构成

「我的成绩」页显示的是**整门大课**的总评，不是单科。

```
总分 100 = 平时成绩 20 + 能力成绩 80
              ├ 教程学习时长 5
              ├ 教程成绩     5
              ├ 测试综合成绩 5
              └ 作业综合成绩 5
                            ├ 口语成绩 40
                            └ 听力成绩 40
```

单科 `correctRate`（如 95）只是能力成绩里口语那一块的输入：

```
口语成绩 = 口语单元平均分 × 40%
```

**学习时长无法伪造**：

```
POST /api/mobile/user_module/{courseId}/{leaf}/duration/
```

实测连报 10 × `{"duration":3600}`，页面时长只涨 **1 秒**。服务端只认真实时间流逝。

```
学习时长得分 = min(时长, 20h) / 20 × 100 × 5%
```

---

## 已知限制

- ego 的任务空间共享 cookie，新开空间不会切换账号
- `Network.clearBrowserCookies` 是**浏览器级**操作，会清掉所有空间的登录态
- ucontent 的 SSO 会话约 1–2 小时过期，`localStorage.jwtToke` 长度为 0 就是掉了
- `score_avg` 与 `state.score` 是两套字段，会出现 `score=[0]` 但 `avg=100` 的页面
- `recordUrl` 必须用当前账号自己的（`/speech-proxy/{uid}/`），否则记录里音频与账号对不上

---

## 文件

```
scripts/
  driver.mjs    主驱动器（扫状态 + 逐页提交，参数化）
  run309.mjs    单课程专用版（含强制 reload 与树大小校验）
  both.mjs      双课程连续跑
```

## License

MIT
