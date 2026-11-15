# 一步到位执行提示词

把下面整段复制给你的 AI agent（DSH / Claude Code / Cursor 均可），它会自己走完整个流程。

---

```text
用 https://github.com/xc-520-x/utalk-github 这个仓库，帮我把 Utalk 口语课刷完。

按仓库里的 AGENTS.md 执行，重点：

1. 先跑 scripts/check.mjs 自检。任何一项失败就停下来告诉我具体报错，不要自己想办法绕过。

2. 自检通过后，用 UTALK_DRY=1 干跑一次，把「待做 N 页」报给我确认。

3. 我确认后正式跑。参数：
   UTALK_GAP=60000
   UTALK_MAXMIN=240
   UTALK_UID=<我的 user_id，从浏览器 localStorage 里取>

4. 跑完必须做验收：服务端回读 progress/v2 的 state 和课程总进度 correctRate，
   不要拿日志里的 ok=N 当结果。

5. 过程中遇到问题按 AGENTS.md 的「排障对照」处理。出现以下任一情况立刻停手告诉我：
   - 600002 且题数正常（真频控）
   - 503
   - 日志里出现多套计数器（说明有并发进程）

6. 最后按 AGENTS.md 的「汇报格式」回我，格式是：
   课程 / 执行 / 验收 / 遗留

我不知道的信息：ego-browser 的任务空间名，你可以在当前环境里列一下；
如果列不出来就直接问我。

课程是 286 校园情景口语，如果 309 四级口语开口说也在这门大课里就一起跑。
```

---

## 使用前提

你的 agent 必须在这台机器上，且满足：

| 条件 | 检查方式 |
|---|---|
| 装了 `ego-browser` | `ego-browser --version` |
| utalk 已登录 | 浏览器能打开播放器页，课程目录能展开 |
| 仓库已 clone 到本地 | `git clone https://github.com/xc-520-x/utalk-github` |

---

## 如果你用的是 DSH

仓库里的 `AGENTS.md` 会被自动加载为仓库级指令。你只需要说：

```text
按 AGENTS.md 把 286、309 刷完
```

不需要把上面那一大段贴进去。

---

## 如果你用的是其他 agent

把第一段整段复制。它会：

1. 读 `AGENTS.md` 拿到硬约束
2. 读 `docs/internals.md` 拿到接口细节（只有出问题时才需要）
3. 按顺序执行自检 → 干跑 → 正式跑 → 验收

---

## 常见追问

**「agent 说找不到 ego-browser」**
没装。装法见仓库 README 顶部。

**「agent 说 jwtToke 是 0」**
会话过期。在 ego 浏览器里重新登一次 utalk，进任意一门课的播放器页。

**「agent 说 tree 0」**
课程 ID 或 entry 路径不对。让它问你要课程地址，或者你自己打开那门课看地址栏 `#/` 后面那段。

**「跑了一半停了」**
看日志尾部的退出原因。如果是 `600002` 且题数正常，等 30 分钟后重跑同一条命令即可——脚本会跳过已完成的页。
