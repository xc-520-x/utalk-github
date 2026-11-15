# 实现细节

Agent 执行任务**不需要**读这个文件。只有需要改代码、排查异常、或向用户解释成绩构成时才看。

---

## 鉴权头

ucontent 域四个头缺一不可：

```js
{
  "X-ANNOTATOR-AUTH-TOKEN": localStorage.jwtToke,      // 295 字符左右
  "X-CSRFTOKEN": (/csrftoken=([\w\d%]+)/.exec(document.cookie) || [])[1] || "",
  "Content-Type": "application/json",
  "uni-client-ver": "fcc3421e",
  "uni-ucontent-ver": "fcc3421e"
}
```

`jwtToke` 只在进入播放器页后才生成。只在 utalk 首页登录不够。

---

## 提交接口

```
POST https://ucontent.unipus.cn/course/api/v3/submit/{courseId}/{leaf}/
```

```js
{
  enable_mistake: false,
  version: "default",
  record_version: "<13 位时间戳字符串>",
  state: JSON.stringify({
    version: "<同一个时间戳>",
    __EXTEND_DATA__: { __SUMMARY__: { answerList } }
  }),
  specific_scores: [SC, SC, ...],        // 长度必须 == 题数
  answers: { "0": { score: 0.95 }, ... } // 长度必须 == 题数
}
```

### answerList 单项

```js
{
  isDone: true, isRight: true,
  pct: 0.95, score: 0.95,
  signature: "", ext: null, version: "v2",
  specific_scores: SC,
  recordUrlArr: [recordUrl],
  recordDetail: {
    recordUrl, score: 95, recordId: k,
    smooth: 93, completed: 96, correctness: 94,
    scoreDetails: [], type: 3
  },
  student_answer: {
    isDone: true, specific_scores: SC, version: "v2",
    recordDetail: rd, recordUrlArr: [recordUrl]
  }
}
```

### SC 结构

```js
const SC = { total: 0.95, accuracy: 0.94, fluency: 0.93, integrity: 0.96 };
```

**服务端不复算。** `answers[k].score` 给多少存多少。

### 成功判定

响应体含 `"code":0`。

```js
const ok = text.indexOf('"code":0') >= 0;
```

---

## 打点接口

```
POST https://ucontent.unipus.cn/api/mobile/user_group/{courseId}/{leaf}/progress/
```

```js
{ status: 1, rid: `flowengine:studyStatus:1:${leaf}`, groupId: leaf, version: "default" }
```

只对 `purecontent` / `vocabulary` 有效。这两类页提交分数会返回 `code:0` 但 `state.score` 恒为 `[]`。

**注意**：本项目主脚本直接跳过这两类页，不打点——因为它们的 pass 状态不计入正确率，且打点会被误认为"已完成"导致后续扫描漏判。

---

## 服务端忽略的接口

```
POST https://ucontent.unipus.cn/api/mobile/user_module/{courseId}/{leaf}/duration/
```

返回 200 空响应体，但**不累加任何时长**。

对照组实验：

```
上报前：8h21m39s
10 × {"duration":3600, "delta":3600}  →  全部 200
上报后：8h21m40s
增量：+1 秒
```

另一组 `60 + 60 + 60 + 3600` → 实际 +67 秒，约等于页面真实停留时间。

**结论：服务端完全忽略 `duration` 参数，只认真实时间流逝。** 任何"补时长"的实现都不存在。

---

## 成绩构成完整算法

「我的成绩」页的 `45` 是**整门大课**的总评（百分制），不是单科。

### 平时成绩（满分 20）

| 分项 | 满分 | 公式 |
|---|---|---|
| 教程学习时长 | 5 | `min(时长, 20h) / 20 × 100 × 5%` |
| 教程成绩 | 5 | `教程平均分 × 5%`（多教程取平均） |
| 测试综合成绩 | 5 | `(测试得分/满分) × 100 × 5%` |
| 作业综合成绩 | 5 | `(作业得分/满分) × 100 × 5%` |

### 能力成绩（满分 80）

| 分项 | 满分 | 公式 |
|---|---|---|
| 口语成绩 | 40 | `口语单元平均分 × 40%` |
| 听力成绩 | 40 | `听力单元平均分 × 40%` |

单科 `correctRate`（如 95）只是「口语成绩」的输入，不是总评。

### 实例验算

某课程实测：

```
教程学习时长 = 8h49m39s = 8.8275h
             = 8.8275 / 20 × 5 = 2.21 分      ← 页面显示 2.2 ✓

教程成绩     = (95 + 95) / 2 × 5% = 4.75 分    ← 页面显示 4.8 ✓

测试 / 作业  = 课程未配置，0 分

平时小计     = 2.2 + 4.8 = 7

口语成绩     = (95 + 95) / 2 × 40% = 38 分
听力成绩     = 课程未配置，0 分

能力小计     = 38

总评         = 7 + 38 = 45
```

### 提分路径

| 缺口 | 可补分数 | 前提 |
|---|---|---|
| 口语从 95 → 100 | +2 | 本工具能刷，但边际收益低 |
| 学习时长补到 20 小时 | +2.8 | 只能真实挂机 |
| 测试 / 作业 | 各 +5 | 课程配置了才能做 |
| 听力 | +40 | 课程配置了才能做 |

**本工具的能力边界：只覆盖「教程成绩」和「口语成绩」。**

---

## 并发问题

`ego-browser nodejs -e "..."` 启动的进程，在父 shell 被杀后不会退出，会变成孤儿继续跑。

表现：日志里同时出现多套计数器。

```
[17/105] u6g203 roleplay_old OK
[13/101] u6g203 roleplay_old OK
[8/96]   u6g203 roleplay_old OK
```

同一页被三个进程重复提交，速率三倍，触发限流。

清理：

```powershell
taskkill /F /IM ego-browser.exe
taskkill /F /IM node.exe
# 必须确认 ego 进程数为 0 才能重启
```

---

## 课程树节点数参考

用于校验是否真的切换了课程。

| 课程 | 节点数 | 说明 |
|---|---|---|
| 286 校园情景口语 | 282 | 含 51 purecontent + 51 vocabulary + 180 评分页 |
| 309 四级口语开口说 | 55 | 含 32 non-scoring + 23 评分页 |

节点数明显不符（如 309 读到 282）说明 `goto` 后 SPA 路由没重挂，必须 `reload`。

---

## 题型与题数对应

`courseSummary[leaf].questionsList.length` 是唯一可靠来源。实测样本：

| base | 典型题数 |
|---|---|
| `shortAnswer_course` | 1 |
| `presentation` | 1 |
| `roleplay_old` | 1 |
| `objectivesone_course` | 1–3 |
| `bankedcloze_course` | 4–7 |
| `scoopforsentencesrecord_course` | 2–7 |
| `sentencerecord` | 6–15 |
| `magic_*` | 2–9 |
| `objectivesimple_scoop_course` | 15 |

**没有固定规律，必须逐页读。**
