# Frontend Quizbank

考前臨時抱 AI 腳、vibe code 出的純前端刷題工具。

## 啟動 server

### 1. VS Code Live Server

### 2. npm package：serve
``` sh
pnpm dlx serve
```

## 建立題庫

請參考 [題庫 JSON 格式說明](./question-format.md)

## 資料儲存

資料儲存於瀏覽器的 IndexDB，目前無雲端同步與匯出功能；點擊［清空所有資料］以清空 IndexDB。
