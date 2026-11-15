# Utalk 口语课程自动化

外研社 Utalk（`utalk.unipus.cn`）口语题批量提交工具。跑在你**已登录**的浏览器里，不做登录自动化。

> 仅用于自己已选修的课程。

---

## 5 分钟上手

### 第 1 步：装 ego-browser

本项目依赖 [ego-browser](https://ego.app) —— 一个可被脚本驱动的 Chromium。

```bash
npm i -g @citrolabs/ego-cli     # 或按官网说明安装
ego-browser --version
```

### 第 2 步：登录 utalk

在 ego 浏览器里手动打开 `https://utalk.unipus.cn`，用学校账号登录，随便点进一门课进到播放器页。

看到播放器正常显示、课程目录能展开就够了。

### 第 3 步：自检

```bash
UTALK_SPACE=<你的任务空间名> \
ego-browser nodejs -e "await import('file:///绝对路径/scripts/check.mjs')"
```

会依次检查：浏览器连接 → 登录态 → `jwtToke` 是否生成 → 两门课节点数 → 当前进度。

全部 ✅ 才能往下走。

### 第 4 步：干跑一次

```bash
UTALK_DRY=1 UTALK_SPACE=<空间名> UTALK_COURSES=286 \
ego-browser nodejs -e "await import('file:///绝对路径/scripts/utalk.mjs')"
```

只会扫描，不提交。输出类似：

```
=== 286 校园情景口语 ===
  tree 282
  总节点 282（其中 102 个 non-scoring）
  待做 148 页
  DRY 模式，不提交
```

**看到「待做 N 页」就说明环境完全正常。**

### 第 5 步：正式跑

```bash
UTALK_SPACE=<空间名> \
UTALK_COURSES=286,309 \
UTALK_GAP=60000 \
UTALK_MAXMIN=240 \
ego-browser nodejs -e "await import('file:///绝对路径/scripts/utalk.mjs')"
```

按 60 秒/页，286 约 3 小时，309 约 25 分钟。

---

## 常用命令

```bash
# 只跑 286
UTALK_COURSES=286 ...

# 只跑 309
UTALK_COURSES=309 ...

# 两门连跑，一次跑满 4 小时
UTALK_COURSES=286,309 UTALK_MAXMIN=240 ...

# 先看有多少页要做
UTALK_DRY=1 ...

# 换账号（先在 ego 里切换登录）
UTALK_UID=新账号的user_id ...
```

---

## 参数

| 变量 | 默认 | 说明 |
|---|---|---|
| `UTALK_SPACE` | `utalk` | ego 任务空间名 |
| `UTALK_COURSES` | `286` | 课程 key，逗号分隔：`286` / `309` / `286,309` |
| `UTALK_UID` | 空 | 你的 user_id，用于筛选音频引用；留空则不过滤 |
| `UTALK_GAP` | `60000` | 每页间隔毫秒，**不建议低于 60000** |
| `UTALK_MAXMIN` | `240` | 单次运行分钟上限 |
| `UTALK_RATE` | `0.95` | 目标分数（0–1） |
| `UTALK_DRY` | — | 设为 `1` 则只扫描不提交 |
| `UTALK_LOG` | `utalk.log` | 日志文件路径 |
| `UTALK_CID` | `1064841` | classId，一般不用改 |

### 内置课程

| key | 课程名 | courseId |
|---|---|---|
| `286` | 校园情景口语 | `course-v1:unipus+kdxyspeaking+2017_05` |
| `309` | 四级口语开口说 | `course-v1:Unipus+sxcet4speaking+2017_09` |

其他课程：在 `scripts/utalk.mjs` 顶部的 `COURSES` 里加一条，填 `id` / `entry` / `nodes`。`entry` 用任意一个已知 leaf 的完整路径（打开那页时浏览器地址栏 `#/` 后面那段）。

---

## 出问题了看这里

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 连不上任务空间 | 空间名写错，或 ego 没起来 | 确认 ego 在跑，`UTALK_SPACE` 和窗口标题一致 |
| 停在登录页 | 会话过期 | 在 ego 里重新登录一次 |
| `jwtToke` 为 0 | 只在 utalk 首页登录了，没进播放器 | 打开任意一门课的播放器页 |
| `tree 0` | 课程 ID 或 entry 写错 | 手动打开那门课，复制地址栏 |
| `tree 282` 但跑的是 309 | 切课程没 reload | 脚本会自动重试 3 次；都失败就手动刷新那页再跑 |
| 大量 `FAIL 600002` | **题数读错了**，不是频控 | 正常不该出现；如果出现说明那页 `questionsList` 结构特殊 |
| `FAIL 600002` 且题数正常 | 真的被限流 | 停 30 分钟再跑 |
| `FAIL 601` | 拿错课程的 leaf | 同上，切课程失败 |
| `FAIL 901` | answers 长度不对 | 不该出现，报告 issue |
| 进度涨了但正确率没涨 | 只做 non-scoring 页没用 | 见下方「成绩怎么算」 |

---

## 成绩怎么算（为什么刷完不是 100 分）

「我的成绩」页显示的是**整门大课**的总评，不是单科。

```
总分 100
├─ 平时成绩 20
│   ├─ 教程学习时长 5   ← 要累计 20 小时，无法伪造
│   ├─ 教程成绩     5   ← 就是本工具刷的
│   ├─ 测试综合成绩 5   ← 看课程有没有配
│   └─ 作业综合成绩 5   ← 看课程有没有配
└─ 能力成绩 80
    ├─ 口语成绩 40     ← 本工具刷的就是这个
    └─ 听力成绩 40     ← 看课程有没有配
```

**本工具只能影响「教程成绩」和「口语成绩」两块。**

- 刷到 95% → 教程成绩 4.75/5，口语成绩 38/40
- 学习时长要靠真实使用累计（实测接口不接受伪造，见下）
- 测试/作业/听力如果课程没配，那几项恒为 0

**所以总分会有上限，具体看课程配置。**

---

## 原理（想改代码才需要看）

### 三个必须满足的前提

**1. 路径从课程树取，不能猜**

```js
const s = window.withReduxStore(st => st.getState())();
// s.courseStructure.data.units → 递归拿 url 链
```

实测 `u0g18` 的真实路径是 `u0/u0g14/u0g18`。靠命名规律猜必错，猜错会空渲染 + 提交返回 `601`。

**2. 题数从 `courseSummary` 读，不能猜**

```js
const qLen = s.courseSummary[leaf].questionsList.length;
```

**题数不对时服务端返回 `600002`** —— 和频控同一个错误码。这是最容易踩的坑：误判成限流，脚本 abort，队列卡死在第一个页。

**3. 切课程后必须 reload**

同一 SPA 里跳另一门课，路由不重挂，`courseStructure` 还是旧的。用节点数校验：286 约 282，309 约 55。

### 接口

**提交**（服务端不复算分数）

```
POST /course/api/v3/submit/{courseId}/{leaf}/

{
  enable_mistake: false, version: "default",
  record_version: String(Date.now()),
  state: JSON.stringify({ version, __EXTEND_DATA__: { __SUMMARY__: { answerList } } }),
  specific_scores: [SC, ...],        // 长度 == 题数
  answers: { "0": {score}, ... }     // 长度 == 题数
}
```

**回读**

```
GET /api/mobile/user_module/{courseId}/{leaf}/progress/v2/
→ { state: { state, score_pct, score_avg, score: "[0.95,0.95]" } }
```

**鉴权头**（ucontent 域）

```js
{
  "X-ANNOTATOR-AUTH-TOKEN": localStorage.jwtToke,
  "X-CSRFTOKEN": cookie.csrftoken,
  "uni-client-ver": "fcc3421e",
  "uni-ucontent-ver": "fcc3421e"
}
```

### 两类特殊页

| 类型 | `questionsList` | 处理 |
|---|---|---|
| `purecontent` / `vocabulary` | 空 | 跳过。提交返回 `code:0` 但 `state.score` 永远是 `[]`，服务端忽略 |
| 其他（roleplay/shortAnswer/presentation/magic…） | 有 | 按题数提交 |

### 学习时长无法伪造

```
POST /api/mobile/user_module/{courseId}/{leaf}/duration/
```

实测连报 10 次 `{"duration":3600}`，页面时长只涨 **1 秒**。服务端只认真实时间流逝，本项目不提供时长伪造。

---

## 已知坑

- ego 的任务空间**共享 cookie**，新开空间不会切换账号
- `Network.clearBrowserCookies` 是**浏览器级**操作，会清掉所有空间的登录态
- ucontent 会话约 1–2 小时过期
- `job_kill` 杀不掉 `ego-browser nodejs` 子进程，会变孤儿继续跑。发现日志里多套计数器说明有并发：
  ```powershell
  taskkill /F /IM ego-browser.exe
  taskkill /F /IM node.exe
  ```
- `score_avg` 与 `state.score` 是两套字段，会出现 `score=[0]` 但 `avg=100` 的页

---

## 文件

```
scripts/
  check.mjs   环境自检（先跑这个）
  utalk.mjs   主脚本（扫描 + 提交）
```

## License

MIT
