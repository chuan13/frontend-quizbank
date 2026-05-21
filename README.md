# Frontend Quizbank（分組協作版）

純前端 IndexedDB 題庫系統，依功能切成 4 個 mini-app，供四人分組協作開發。

## 線上使用

[Frontend Quizbank](https://chuan13.github.com/frontend-quizbank)

## 啟動本地 server

因為使用 IndexedDB + 跨資料夾相對路徑連結，建議透過本地 server 開啟（不要直接 `file://`）。

```sh
# 方式 1：Python
python3 -m http.server 8000

# 方式 2：Node
pnpm dlx serve

# 方式 3：VS Code Live Server
```

開啟 http://localhost:8000/

## 目錄結構

```
frontend-quizbank/
├── index.html              # 入口頁，連結到 4 個 part
├── style.css
├── shared/
│   └── db.js               # ★ 共用 IndexedDB 層（window.QuizDB）
├── part1-quiz/             # 成員 A：測驗
├── part2-bank/             # 成員 B：題庫管理（查看/編輯/UI 新增題目）
├── part3-import/           # 成員 C：JSON 匯入
├── part4-home/             # 成員 D：狀態與維護
├── question-format.md      # 題庫 JSON 格式說明
└── test-questions.json     # 測試題庫
```

每個 part 都是一個獨立可開啟的 mini-app（自己的 `index.html` / `style.css` / `script.js`），透過 `<script src="../shared/db.js"></script>` 共用同一個 IndexedDB（QuizDB）。任何 part 寫入的題庫資料，其他 part 都看得到。

## 分工

| Part | 負責人 | 功能 | 主要 DB API |
|------|------|------|-----------|
| **1. quiz** | 成員 A | 出題設定、抽題、答題、回饋 | `getAll`, `updateStats` |
| **2. bank** | 成員 B | 查看／篩選／排序／編輯／UI 新增題目 | `getAll`, `update`, `add`, `getBanks` |
| **3. import** | 成員 C | 檔案 / 貼上文字匯入 JSON | `addBatch`, `getBanks` |
| **4. home** | 成員 D | DB 狀態、清空錯題、清空全部 | `getAll`, `resetAllFails`, `clearAll` |

## 共用 API（`shared/db.js`）

所有 part 必須先呼叫 `QuizDB.init()`。

```js
QuizDB.init()                              // -> Promise<void>，開啟資料庫
QuizDB.getAll()                            // -> Promise<Question[]>
QuizDB.getBanks()                          // -> Promise<string[]>，題庫名稱列表
QuizDB.nextQuestionNumber(bank)            // -> Promise<number>，該題庫下一題的題號
QuizDB.add({ questionBank, question, options, description? })
                                            // -> Promise<id>，自動填預設欄位
QuizDB.addBatch(items, bank)               // -> Promise<count>，批次匯入並自動接續題號
QuizDB.update(id, patch)                   // -> Promise<void>，部分更新
QuizDB.updateStats(id, isCorrect)          // -> Promise<void>，answer 後更新統計
QuizDB.resetAllFails()                     // -> Promise<void>
QuizDB.clearAll()                          // -> Promise<void>
```

### Question schema

```ts
{
  id: number,             // 自動產生
  questionBank: string,   // 題庫名稱
  questionNumber: number, // 題庫內的題號
  type: 'single',
  correct: number,        // 累計答對次數
  fail: number,           // 累計答錯次數
  question: string,
  options: [
    { order: number, text: string, true?: true }  // order 0=隨機；1+=固定順序
  ],
  description: string,    // 詳解
}
```

題目 JSON 規格詳見 [question-format.md](./question-format.md)。

## 合作守則

1. **不要動 `shared/db.js`**，除非四人取得共識——schema 異動會影響所有 part。
2. 各 part 只能修改自己資料夾內的 `index.html` / `style.css` / `script.js`。
3. CSS 完全獨立，每人可自由設計風格。
4. 入口頁 `/index.html` 由維護者統一更新。

## 資料儲存

資料儲存於瀏覽器的 IndexedDB（`QuizDB`），目前無雲端同步與匯出。可在 Part 4 清空。
