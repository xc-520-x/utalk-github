# AGENTS.md

本文件是给 AI agent 的仓库级指令。人类用户看 `README.md`。

---

## 这个仓库是什么

外研社 Utalk（`utalk.unipus.cn` / `ucontent.unipus.cn`）口语课程自动化脚本。

**不是库，是执行器。** 没有 npm 包、没有构建步骤、没有测试套件。你拿到这个仓库要做的事是：**在用户已登录的 ego-browser 里把课程题做完**，不是改代码。

---

## 你被指向这里时，先判断三件事

1. **用户是否已登录 utalk？**
   没有 → 停止，要求用户手动登录。**不要尝试自动化登录流程。**
2. **ego-browser 是否可用？**
   `ego-browser --version` 不通 → 停止，告诉用户安装。
3. **用户要的是哪门课？**
   课程 key 只有 `286`（校园情景口语）、`309`（四级口语开口说）。其他课程需要用户提供 `courseId` 和 `entry`。

三项都确认后再动手。

---

## 执行顺序（不要跳步）

```bash
# 1. 自检 —— 必须全绿才继续
UTALK_SPACE=$SPACE \
ego-browser nodejs -e "await import('file:///$REPO/scripts/check.mjs')"

# 2. 干跑 —— 只看有多少页要做
UTALK_DRY=1 UTALK_SPACE=$SPACE UTALK_COURSES=286 \
ego-browser nodejs -e "await import('file:///$REPO/scripts/utalk.mjs')"

# 3. 正式跑
UTALK_SPACE=$SPACE UTALK_UID=$UID UTALK_COURSES=286,309 \
UTALK_GAP=60000 UTALK_MAXMIN=240 \
ego-browser nodejs -e "await import('file:///$REPO/scripts/utalk.mjs')"

# 4. 验收 —— 服务端回读，不看日志
```

第 1 步失败就停，不要"试一下能不能跑"。

---

## 硬约束（违反会导致账号被限或数据错乱）

### 1. `UTALK_GAP` 不得低于 60000

60 秒/页是实测安全值，21 连发零失败。更快的速率未经验证。

### 2. 单次运行不超过 `UTALK_MAXMIN`

到上限即停，不要连续追加。用户想要更快就调大这个值，不要缩短间隔。

### 3. 不得调用 `Network.clearBrowserCookies`

这是**浏览器级**操作。ego 的任务空间共享 cookie，清一次会把该实例下所有空间的登录态一起清掉。本项目曾因此丢失过一次用户会话。

需要重置登录态时，让用户手动退出再登录。

### 4. 不得伪造 `duration` 上报

```
POST /api/mobile/user_module/{courseId}/{leaf}/duration/
```

服务端完全忽略客户端数值。实测 10 × `{"duration":3600}` 只涨 1 秒。

**任何"补学习时长"的实现都不存在。** 用户问怎么涨时长，答案只有：真实挂机。

### 5. `recordUrl` 池必须按当前账号过滤

```
/speech-proxy/{UTALK_UID}/
```

不过滤会混入其他账号的音频引用，记录里对不上。

`UTALK_UID` 获取：

```js
Object.keys(localStorage).map(k => (k.match(/-(\d+)-userstate/) || [])[1]).filter(Boolean)
```

### 6. 验收只认服务端回读

日志里的 `ok=N` 是提交计数，不是落地证据。

必须回读：

```
GET /api/mobile/user_module/{courseId}/{leaf}/progress/v2/
→ data.state.state === 1 && data.state.score_pct >= 0.9
```

或课程总进度：

```
POST https://utalk.unipus.cn/api/stu/tutorial/content
{ "tutorialId":"286", "curriculaId":"361019", "classId":"1064841" }
→ rs.tutorialContent.tutorialProgress / correctRate
```

### 7. 遇到 `600002` 先问题数，再判频控

| 情况 | 判定 | 动作 |
|---|---|---|
| `nq` 为 0 或与页面明显不符 | **题数读取失败** | 跳过该页，不要重试 |
| `nq` 正常 | 真频控 | 停 30 分钟 |

**这是本项目最容易误判的点。** 题数错和真频控返回同一个错误码。

---

## 不要做的事

- **不要改脚本去"优化速度"。** 现在的 60 秒/页是踩过坑之后的值。
- **不要并发跑多个实例。** `job_kill` 杀不掉 `ego-browser nodejs` 子进程，会变孤儿继续跑，日志里出现多套计数器就是病了。
- **不要用脚本填账号密码。** 登录必须由用户在浏览器里手动完成。
- **不要相信 `state.score` 数组。** 它和 `score_avg` 是两套字段，会出现 `score=[0]` 但 `avg=100`。要看 `state.state` 和 `state.score_pct`。
- **不要动 `purecontent` / `vocabulary` 页。** 它们 `questionsList` 为空，提交返回 `code:0` 但 `state.score` 恒为 `[]`。脚本已内置跳过。

---

## 排障对照

| 输出 | 原因 | 处理 |
|---|---|---|
| `tree 0` | `courseId` 或 `entry` 错 | 让用户提供正确的课程地址 |
| `tree 282` 但跑的是 309 | 切课程没 reload | 脚本会自动重试 3 次；仍失败让用户手动刷新播放器页 |
| `jwtToke` 长度为 0 | 只登了首页，没进播放器 | 让用户打开任意一门课的播放器页 |
| 日志出现 `[17/105]` `[13/101]` 两套计数 | 并发 | `taskkill /F /IM ego-browser.exe` + `taskkill /F /IM node.exe` |
| `FAIL 601` | 拿错课程的 leaf | reload 后重试一次；仍失败跳过 |
| `FAIL 901` | `answers` 长度 ≠ 题数 | 该页跳过，记录 |
| `503` | 服务端过载 | 停 60 分钟 |

---

## 汇报格式

执行结束后按这个模板回用户，不要自由发挥：

```
课程：286 校园情景口语
执行：提交 N 页，失败 M 页，耗时 X 分钟
验收：服务端回读 progress=__%，correctRate=__%
遗留：<未完成项及原因 / 无>
```

数值必须来自服务端回读。

---

## 用户可能会问的问题，答案在这里

**"为什么刷完了不是 100 分？"**
成绩是整门大课的总评，不是单科。见 `docs/internals.md` 的成绩构成一节。核心：本工具只能影响「教程成绩」和「口语成绩」，学习时长、测试、作业、听力取决于课程配置。

**"能不能把学习时长补满？"**
不能。服务端只认真实时间流逝，接口上报无效。见硬约束第 4 条。

**"正确率上不去？"**
口语已经 95% 时边际收益很低。剩下的缺口在时长和其他板块，不在刷题。

**"会不会被封号？"**
60 秒/页是安全速率。但任何自动化都有风险，如实告知用户，不要说"绝对安全"。

---

## 代码在哪

| 文件 | 作用 |
|---|---|
| `scripts/check.mjs` | 四步自检 |
| `scripts/utalk.mjs` | 主执行器（扫状态 + 逐页提交） |
| `docs/internals.md` | 接口细节、鉴权头、成绩算法 |

改代码之前先读 `docs/internals.md`，里面写了为什么必须这么做。
