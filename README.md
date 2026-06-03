# Frontend Quizbank

純前端 IndexedDB 題庫系統。四個功能（測驗 / 題庫管理 / JSON 匯入 / 狀態維護）原由四人分組開發，現已整併為**單一頁面應用（SPA）**：一個 `index.html` + 一個 `app.css` + 一個 `app.js`。

## 線上使用

[Frontend Quizbank](https://chuan13.github.io/frontend-quizbank)

## 啟動本地 server

因為使用 IndexedDB，建議透過本地 server 開啟（不要直接 `file://`）。

```sh
# 方式 1：Python
python3 -m http.server 8000

# 方式 2：Node
pnpm dlx serve

# 方式 3：VS Code Live Server
```

開啟 http://localhost:8000/

## 部署（GitHub Pages）

本專案為純靜態網站，採用 **GitHub Pages** 部署，無需建置流程與伺服器：

1. 將 `index.html`、`app.css`、`app.js` 推送到 GitHub repository。
2. 進入 repository 的 **Settings → Pages**，選擇發佈分支（例如 `main` 的 root）。
3. GitHub 自動建置並發佈，取得 `https://<帳號>.github.io/<repo>/` 網址（預設提供 HTTPS）。

> 資料存於使用者瀏覽器的 IndexedDB，伺服器端不保存任何資料，因此部署近乎零成本。

## 目錄結構

```
frontend-quizbank/
├── index.html              # 單頁入口，內含 5 個 view（首頁＋4 功能）
├── app.css                 # 整併後的樣式
├── app.js                  # QuizDB 資料層 + 4 個功能模組 + 換頁路由
├── question-format.md      # 題庫 JSON 格式說明
└── test-questions.json     # 測試題庫
```

整個系統是單一 SPA，`app.js` 內以獨立模組（IIFE）封裝四個功能，避免全域命名衝突；切換頁面由 `Router` 控制，資料統一存於同一個 IndexedDB（QuizDB），任一功能寫入的題庫資料其他功能都看得到。

## 分工（原始開發）

| 功能 | 負責人 | 內容 | 主要 DB API |
|------|------|------|-----------|
| **測驗 (Quiz)** | 成員 A | 出題設定、抽題、答題、回饋 | `getAll`, `updateStats` |
| **題庫管理 (Bank)** | 成員 B | 查看／篩選／排序／編輯／UI 新增題目 | `getAll`, `update`, `add`, `getBanks` |
| **JSON 匯入 (Importer)** | 成員 C | 檔案 / 貼上文字匯入 JSON | `addBatch`, `getBanks` |
| **狀態維護 (Maint)** | 成員 D | DB 狀態、清空錯題、清空全部 | `getAll`, `resetAllFails`, `clearAll` |

## 共用 API（`app.js` 內 `QuizDB` 模組）

所有模組都先呼叫 `QuizDB.init()`。

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

## 維護守則

1. **修改 `QuizDB` 模組需謹慎**——schema 異動會影響所有功能。
2. 各功能模組請維持封裝在自己的 IIFE 內，只透過 `init()` / `onShow()` 與路由互動。
3. 新增功能頁時：在 `index.html` 加一個 `.view` 區塊、在 `app.js` 加對應模組、並在 `Router` 註冊。

## 資料儲存

資料儲存於瀏覽器的 IndexedDB（`QuizDB`），目前無雲端同步與匯出。可在「狀態與維護」頁清空。
