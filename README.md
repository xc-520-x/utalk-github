# Utalk 口语课程自动化

外研社 Utalk（`utalk.unipus.cn`）口语题批量提交工具。跑在**已登录**的浏览器里，不做登录自动化。

> 仅用于自己已选修的课程。

## 怎么用

**把下面这段复制给你的 AI agent：**

```text
用 https://github.com/xc-520-x/utalk-github 这个仓库，帮我把 Utalk 口语课刷完。
按 AGENTS.md 执行：先跑 check.mjs 自检 → UTALK_DRY=1 干跑报页数给我确认 →
正式跑（GAP=60000, MAXMIN=240）→ 服务端回读验收 → 按汇报格式回我。
遇到 600002 且题数正常、503、或日志多套计数器，立刻停手告诉我。
```

更多变体和追问处理见 [PROMPT.md](PROMPT.md)。

**手动执行：**

```bash
git clone https://github.com/xc-520-x/utalk-github
cd utalk-github

# 1. 自检
UTALK_SPACE=<空间名> ego-browser nodejs -e "await import('file://'$PWD'/scripts/check.mjs')"

# 2. 干跑
UTALK_DRY=1 UTALK_SPACE=<空间名> ego-browser nodejs -e "await import('file://'$PWD'/scripts/utalk.mjs')"

# 3. 正式跑
UTALK_SPACE=<空间名> UTALK_UID=<user_id> UTALK_COURSES=286,309 \
ego-browser nodejs -e "await import('file://'$PWD'/scripts/utalk.mjs')"
```

## 前置条件

| 条件 | 说明 |
|---|---|
| [ego-browser](https://ego.app) | 可被脚本驱动的 Chromium，`ego-browser --version` 能通 |
| 已登录 utalk | 在 ego 里手动登录，并进过一次播放器页（生成 `jwtToke`） |
| 知道任务空间名 | ego 窗口标题，或 `UTALK_SPACE` 默认 `utalk` |

## 参数

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `UTALK_SPACE` | ✅ | `utalk` | ego 任务空间名 |
| `UTALK_COURSES` | ✅ | `286` | `286` / `309` / `286,309` |
| `UTALK_UID` | 建议 | 空 | user_id，用于筛选音频引用；**留空会混入他人 recordUrl** |
| `UTALK_GAP` | | `60000` | 每页毫秒间隔，**不得低于 60000** |
| `UTALK_MAXMIN` | | `240` | 单次运行分钟上限 |
| `UTALK_RATE` | | `0.95` | 目标分数（0–1） |
| `UTALK_DRY` | | — | `1` = 只扫描不提交 |
| `UTALK_LOG` | | `utalk.log` | 日志路径 |
| `UTALK_CID` | | `1064841` | classId |

`UTALK_UID` 取值（浏览器控制台）：

```js
Object.keys(localStorage).map(k => (k.match(/-(\d+)-userstate/) || [])[1]).filter(Boolean)
```

## 内置课程

| key | 课程名 | courseId |
|---|---|---|
| `286` | 校园情景口语 | `course-v1:unipus+kdxyspeaking+2017_05` |
| `309` | 四级口语开口说 | `course-v1:Unipus+sxcet4speaking+2017_09` |

其他课程：在 `scripts/utalk.mjs` 顶部的 `COURSES` 里加一条，填 `id` / `entry` / `nodes`。`entry` 用任意已知 leaf 的完整路径。

## 成绩怎么算

「我的成绩」页显示的是**整门大课**的总评，不是单科。

```
总分 100
├─ 平时成绩 20
│   ├─ 教程学习时长 5   ← 要累计 20 小时，无法伪造
│   ├─ 教程成绩     5   ← 本工具刷的
│   ├─ 测试综合成绩 5   ← 看课程有没有配
│   └─ 作业综合成绩 5   ← 看课程有没有配
└─ 能力成绩 80
    ├─ 口语成绩 40     ← 本工具刷的
    └─ 听力成绩 40     ← 看课程有没有配
```

**本工具只能影响「教程成绩」和「口语成绩」。** 学时长、测试、作业、听力取决于课程配置，未配置则恒为 0。

所以刷完后总分会有上限，具体看课程。

## 文件

| 文件 | 作用 |
|---|---|
| `PROMPT.md` | 给 agent 的一步式执行提示词（可直接复制） |
| `AGENTS.md` | agent 仓库级指令：执行顺序、硬约束、排障、汇报格式 |
| `docs/internals.md` | 接口细节、鉴权头、成绩算法（改代码前读） |
| `scripts/check.mjs` | 四步环境自检 |
| `scripts/utalk.mjs` | 主执行器 |

## 已知限制

- ego 任务空间**共享 cookie**，新开空间不切换账号
- `Network.clearBrowserCookies` 是**浏览器级**操作，会清所有空间的登录态
- ucontent 会话约 1–2 小时过期
- `job_kill` 杀不掉 `ego-browser nodejs` 子进程，会变孤儿继续跑

## License

MIT
