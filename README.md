# Utalk 刷课 · Agent 执行契约

本仓库供 agent 调用，不面向人工操作。人类用户只需提供：已登录的 ego 任务空间名、课程 key。

---

## WHEN — 何时加载

命中以下任一条件时使用：

- 用户要求「刷 utalk / 校园情景口语 / 四级口语开口说」
- 用户反馈 utalk 课程进度或正确率不对
- 需要批量补做口语题、修复卡住的页面
- 需要解释 utalk 成绩构成（为什么不是满分）

**不适用**：登录自动化（用户须已手动登录）、学习时长伪造（服务端不接受，见 `docs/internals.md`）。

---

## PRE — 前置检查（不通过则停止，不要尝试绕过）

按顺序执行，任一步失败即停止并向用户报告该步的具体错误。

### P1 浏览器可达

```bash
ego-browser --version
```

失败 → 告知用户安装 ego-browser，不要继续。

### P2 任务空间存在

```bash
UTALK_SPACE=$SPACE ego-browser nodejs -e "await import('file:///$REPO/scripts/check.mjs')"
```

`$SPACE` 从用户消息或 ego 窗口标题获取。失败 → 向用户索取正确的空间名。

### P3 登录态有效

`check.mjs` 会验证 `localStorage.jwtToke`。

- `jwtToke` 长度为 0 → **停止**，要求用户在 ego 窗口内手动登录 utalk 并在播放器页停留至 `jwtToke` 生成
- 页面停在 SSO 登录页 → 同上

**禁止**：用脚本填写账号密码。凭据由用户手动输入。

### P4 课程可达

`check.mjs` 会打印两门课的节点数：

| 课程 | 预期节点数 | 容差 |
|---|---|---|
| 286 校园情景口语 | 282 | ±30% |
| 309 四级口语开口说 | 55 | ±30% |

节点数偏差超容差 → 脚本内部会自动 reload 重试 3 次；3 次均失败则报告用户「课程切换异常，请手动刷新播放器页」。

---

## RUN — 执行序列

### R1 干跑，确认任务量

```bash
UTALK_DRY=1 UTALK_SPACE=$SPACE UTALK_COURSES=$COURSES \
ego-browser nodejs -e "await import('file:///$REPO/scripts/utalk.mjs')"
```

必须向用户报告输出中的：

```
待做 N 页
```

`N = 0` → 任务已完成，不要进入 R2。

### R2 正式执行

```bash
UTALK_SPACE=$SPACE \
UTALK_UID=$UID \
UTALK_COURSES=$COURSES \
UTALK_GAP=60000 \
UTALK_MAXMIN=240 \
UTALK_LOG=$REPO/run.log \
ego-browser nodejs -e "await import('file:///$REPO/scripts/utalk.mjs')"
```

### R3 验收

执行完毕后读取日志尾部，核对：

```
=== 全部结束 ok=N fail=M 耗时 X 分钟 ===
```

然后回读服务端确认落地：

```
GET /api/mobile/user_module/{courseId}/{leaf}/progress/v2/
→ state.state === 1 且 state.score_pct >= 0.9
```

或直接问课程总进度：

```
POST https://utalk.unipus.cn/api/stu/tutorial/content
{ "tutorialId":"286", "curriculaId":"361019", "classId":"1064841" }
→ rs.tutorialContent.tutorialProgress / correctRate
```

**只有服务端回读的数值才算验收证据。** 日志里的 `ok=N` 只是提交成功的计数。

---

## PARAMS

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `UTALK_SPACE` | ✅ | `utalk` | ego 任务空间名 |
| `UTALK_COURSES` | ✅ | `286` | `286` / `309` / `286,309` |
| `UTALK_UID` | 建议 | 空 | 用户 user_id。用于筛选 `recordUrl` 池；**留空会混入其他账号的音频引用** |
| `UTALK_GAP` | | `60000` | 每页毫秒间隔。**不得低于 60000** |
| `UTALK_MAXMIN` | | `240` | 单次运行分钟上限 |
| `UTALK_RATE` | | `0.95` | 目标分数（0–1） |
| `UTALK_DRY` | | — | `1` = 只扫描不提交 |
| `UTALK_LOG` | | `utalk.log` | 日志路径 |
| `UTALK_CID` | | `1064841` | classId |

`$UID` 获取方式：浏览器控制台执行

```js
Object.keys(localStorage).map(k => (k.match(/-(\d+)-userstate/) || [])[1]).filter(Boolean)
```

---

## FAIL — 失败处置

| 输出 | 判定 | 动作 |
|---|---|---|
| `600002` 且 `nq` 为 0 或明显不符 | **题数读取失败**，非频控 | 该页跳过，记录到报告；**不要重试** |
| `600002` 且 `nq` 正常 | 真频控 | 立即停止本轮，等 30 分钟后从断点续跑 |
| `503` | 服务端过载 | 立即停止，等 60 分钟 |
| `601` | 课程切换失败，leaf 属于别的课 | reload 后重试该页一次；仍失败则跳过 |
| `901 invalid score slice len` | answers 长度 ≠ 题数 | 该页跳过，记录 |
| `tree 0` | courseId 或 entry 错误 | 停止，向用户索取正确的课程地址 |
| 日志出现多套计数器（`[17/105]` `[13/101]`） | **并发在跑** | 立即杀进程后重来 |

并发清理：

```powershell
taskkill /F /IM ego-browser.exe
taskkill /F /IM node.exe
# 确认 ego 进程数为 0 才能重启
```

---

## HARD — 硬约束

1. **`UTALK_GAP` 不得低于 60000。** 实测 60 秒/页 21 连发零失败；更低的速率未经证实。
2. **单次运行不超过 `UTALK_MAXMIN`。** 到上限即停，不要连续追加。
3. **不得使用 `Network.clearBrowserCookies`。** 这是浏览器级操作，会清掉该 ego 实例下所有空间的登录态（本项目曾因此丢失过一次用户会话）。
4. **不得在未通过 P3 的情况下继续。** 会话过期时所有提交都会失败且污染日志。
5. **不得伪造 `duration` 上报。** 服务端忽略客户端数值（实测 10×3600 秒仅涨 1 秒），任何"补时长"的尝试都无效。
6. **不得把 `recordUrl` 指向其他账号。** 池必须按 `/speech-proxy/{UID}/` 过滤。
7. **验收以服务端回读为准，不以日志计数为准。**

---

## DATA — 关键数据结构

改代码或排查时需要。

### 课程树

```js
const s = window.withReduxStore(st => st.getState())();
s.courseStructure.data.units   // 递归
// 叶子：{ url, path, base, tab_type }
```

`path` 是完整路径（如 `u0/u0g14/u0g18`），**不能靠命名规律推导**。

### 单页题数

```js
s.courseSummary[leaf].questionsList.length
```

**这是唯一可靠的题数来源。** 与 `state.score` 数组长度不一致时以它为准。

### 进度

```js
GET /api/mobile/user_module/{courseId}/{leaf}/progress/v2/
// data.state      → { state, score, score_pct, score_avg, lastSubmit }
// data.first_pass → { datetime, score_avg, score_pct }
// data.strategy   → { record_every_submit, required, endTime }
```

`state.score` 是每题分数数组，`score_avg` 是服务端归一后的均值——两者可能出现 `score=[0]` 但 `avg=100`，验收看 `state` 和 `score_pct`。

### non-scoring 页

`base` 为 `purecontent` / `vocabulary` 的页面 `questionsList` 为空。提交会返回 `code:0`，但 `state.score` 永远是 `[]`。

**只推进度，不参与正确率。** 脚本已内置跳过。

### 成绩构成

```
总分 100 = 平时 20 + 能力 80
             平时 = 学习时长 5 + 教程成绩 5 + 测试 5 + 作业 5
             能力 = 口语 40 + 听力 40
```

本工具只能影响「教程成绩」和「口语成绩」。其余项取决于课程配置，未配置则恒为 0。

详细接口与鉴权头见 `docs/internals.md`。

---

## REPORT — 回给用户的格式

执行结束后按此模板汇报，不要自由发挥：

```
课程：286 校园情景口语
执行：提交 N 页，失败 M 页，耗时 X 分钟
验收：服务端回读 progress=__%，correctRate=__%
遗留：<未完成项及原因 / 无>
```

数值必须来自 R3 的服务端回读，不得引用日志中的 `ok=N`。
