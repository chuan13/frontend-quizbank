/* =========================================
   IndexedDB 資料庫操作
   ========================================= */
const DB_NAME = 'QuizDB';
const DB_VERSION = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (e) => {
            console.error("DB Error", e);
            reject("DB Error");
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
            checkDBStatus();
        };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('questions')) {
                const store = database.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
                store.createIndex('questionBank', 'questionBank', { unique: false });
                store.createIndex('questionNumber', 'questionNumber', { unique: false });
                store.createIndex('fail', 'fail', { unique: false });
                store.createIndex('correct', 'correct', { unique: false });
            }
        };
    });
}

// 取得資料庫內所有題目
function getAllQuestions() {
    return new Promise((resolve) => {
        const transaction = db.transaction(['questions'], 'readonly');
        const store = transaction.objectStore('questions');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

// 更新題目的答題紀錄
function updateQuestionStats(id, isCorrect) {
    const transaction = db.transaction(['questions'], 'readwrite');
    const store = transaction.objectStore('questions');
    const request = store.get(id);
    request.onsuccess = () => {
        const data = request.result;
        if (isCorrect) data.correct += 1;
        else data.fail += 1;
        store.put(data);
    };
}

/* =========================================
   UI 與選單控制
   ========================================= */
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const appTitle = document.getElementById('app-title');

function toggleSidebar() {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
}

function switchView(viewId, title) {
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-quiz').classList.add('hidden');
    document.getElementById('view-records').classList.add('hidden');
    document.getElementById('bottom-bar').classList.remove('show');

    document.getElementById(viewId).classList.remove('hidden');
    appTitle.textContent = title;
    if (sidebar.classList.contains('open')) toggleSidebar();
}

function goHome() {
    switchView('view-home', '首頁');
    checkDBStatus();
}

async function checkDBStatus() {
    const questions = await getAllQuestions();
    const statusEl = document.getElementById('home-status');
    const configArea = document.getElementById('quiz-config-area');
    
    if (questions.length === 0) {
        statusEl.textContent = "目前沒有題庫。請開啟左上角選單載入 JSON 檔案。";
        configArea.classList.add('hidden');
    } else {
        statusEl.textContent = `資料庫共有 ${questions.length} 題。`;
        configArea.classList.remove('hidden');

        // 更新首頁的題庫下拉選單
        const banks = [...new Set(questions.map(q => q.questionBank))];
        const configBankSelect = document.getElementById('config-bank-select');
        configBankSelect.innerHTML = '';
        banks.forEach(bank => {
            const opt = document.createElement('option');
            opt.value = bank;
            opt.textContent = bank;
            configBankSelect.appendChild(opt);
        });
    }
}

/* =========================================
   功能 3.1: 載入 JSON (重構為 Modal 形式)
   ========================================= */
const importModal = document.getElementById('import-modal');
const bankSelect = document.getElementById('bank-select');
const newBankInput = document.getElementById('new-bank-name');
const pasteArea = document.getElementById('import-paste-area');
const modalFileIn = document.getElementById('modal-file-upload');
const fileInfo = document.getElementById('file-info');

let pendingQuestions = null;
let currentImportTab = 'file';

async function openImportModal() {
    // 取得現有題庫清單
    const allQ = await getAllQuestions();
    const banks = [...new Set(allQ.map(q => q.questionBank))];
    
    // 更新下拉選單
    bankSelect.innerHTML = '<option value="new">+ 建立新題庫</option>';
    banks.forEach(bank => {
        const opt = document.createElement('option');
        opt.value = bank;
        opt.textContent = bank;
        bankSelect.appendChild(opt);
    });

    // 重置狀態
    pendingQuestions = null;
    pasteArea.value = '';
    modalFileIn.value = '';
    fileInfo.textContent = '';
    newBankInput.value = '';
    newBankInput.classList.remove('hidden');
    bankSelect.value = 'new';
    
    importModal.classList.add('show');
    overlay.classList.add('show');
}

function closeImportModal() {
    importModal.classList.remove('show');
    if (!sidebar.classList.contains('open')) {
        overlay.classList.remove('show');
    }
}

// 分頁切換
function switchImportTab(tabName) {
    currentImportTab = tabName;
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `tab-${tabName}-content`);
    });
}

// 處理檔案選擇 (僅讀取，不匯入)
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if (!Array.isArray(json)) throw new Error("格式錯誤");
            pendingQuestions = json;
            fileInfo.textContent = `已選擇：${file.name} (${json.length} 題)`;
            
            // 自動帶入檔名作為新題庫建議名稱
            if (bankSelect.value === 'new') {
                newBankInput.value = file.name.replace('.json', '');
            }
        } catch (err) {
            alert("無效的 JSON 檔案");
            modalFileIn.value = '';
        }
    };
    reader.readAsText(file);
}

// 執行最終匯入
async function executeImport() {
    let data = null;

    if (currentImportTab === 'file') {
        data = pendingQuestions;
    } else {
        try {
            data = JSON.parse(pasteArea.value);
        } catch (e) {
            alert("貼上的文字不是有效的 JSON 格式");
            return;
        }
    }

    if (!data || !Array.isArray(data)) {
        alert("請先選擇檔案或貼上正確的題庫資料（必須是陣列）");
        return;
    }

    // 決定題庫名稱
    let bankName = '';
    if (bankSelect.value === 'new') {
        bankName = newBankInput.value.trim();
        if (!bankName) {
            alert("請輸入新題庫名稱");
            return;
        }
    } else {
        bankName = bankSelect.value;
    }

    try {
        const allQ = await getAllQuestions();
        const existingInBank = allQ.filter(q => q.questionBank === bankName);
        let maxNum = existingInBank.length;

        const transaction = db.transaction(['questions'], 'readwrite');
        const store = transaction.objectStore('questions');

        data.forEach(item => {
            maxNum++;
            store.add({
                questionBank: bankName,
                questionNumber: maxNum,
                type: 'single',
                correct: 0,
                fail: 0,
                question: item.question,
                options: item.options,
                description: item.description
            });
        });

        transaction.oncomplete = () => {
            alert(`成功匯入至「${bankName}」共 ${data.length} 題！`);
            closeImportModal();
            goHome();
        };
    } catch (err) {
        alert("匯入失敗：" + err.message);
    }
}

/* =========================================
   功能 3.2: 查看題庫 (含篩選與排序)
   ========================================= */
let allRecordsData = [];
let editingQuestionId = null;

async function showRecords() {
    switchView('view-records', '查看題庫');
    allRecordsData = await getAllQuestions();
    
    // 更新題庫篩選下拉選單
    const banks = [...new Set(allRecordsData.map(q => q.questionBank))];
    const bankFilter = document.getElementById('record-bank-filter');
    const currentVal = bankFilter.value;
    bankFilter.innerHTML = '<option value="all">全部題庫</option>';
    banks.forEach(bank => {
        const opt = document.createElement('option');
        opt.value = bank;
        opt.textContent = bank;
        bankFilter.appendChild(opt);
    });
    bankFilter.value = currentVal || 'all';

    renderRecords();
}

function renderRecords() {
    const container = document.getElementById('records-container');
    const bankFilterVal = document.getElementById('record-bank-filter').value;
    const sortFilterVal = document.getElementById('record-sort-filter').value;
    
    container.innerHTML = '';

    // 1. 篩選
    let filtered = allRecordsData;
    if (bankFilterVal !== 'all') {
        filtered = allRecordsData.filter(q => q.questionBank === bankFilterVal);
    }

    // 2. 排序
    filtered.sort((a, b) => {
        if (sortFilterVal === 'num-asc') {
            if (a.questionBank !== b.questionBank) {
                return a.questionBank.localeCompare(b.questionBank);
            }
            return a.questionNumber - b.questionNumber;
        } else if (sortFilterVal === 'fail-desc') {
            return b.fail - a.fail;
        }
        return 0;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">沒有符合的紀錄</p>';
        return;
    }

    filtered.forEach(q => {
        const div = document.createElement('div');
        div.className = 'record-item';
        div.innerHTML = `
        <div class="record-info">
            <span style="font-size:0.8rem; color:var(--primary)">${q.questionBank}</span>
            <span>第 ${q.questionNumber} 題</span>
            <span style="font-size:0.85rem; color:var(--text-light); margin-top:4px;">${q.question.substring(0, 20)}${q.question.length > 20 ? '...' : ''}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div class="record-stats">
                <span class="stats-c">✔️ ${q.correct}</span> / 
                <span class="stats-f">❌ ${q.fail}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <button class="action-icon-btn copy-btn" title="複製題目">📋</button>
                <button class="action-icon-btn edit-btn" title="編輯題目">✏️</button>
            </div>
        </div>
    `;
        // 綁定按鈕點擊事件
        div.querySelector('.copy-btn').onclick = () => copyQuestionToClipboard(q);
        div.querySelector('.edit-btn').onclick = () => openEditModal(q);
        container.appendChild(div);
    });
}

/* =========================================
   題目操作邏輯 (複製與編輯)
   ========================================= */
function copyQuestionToClipboard(q) {
    const optionsText = q.options.map((opt, i) => {
        const label = String.fromCharCode(65 + i); // A, B, C, D...
        return `${label}. ${opt.text}${opt.true ? ' (正確答案)' : ''}`;
    }).join('\n');

    const fullText = `題庫：${q.questionBank}
第 ${q.questionNumber} 題
題目：${q.question}
選項：
${optionsText}
說明：${q.description || '無'}`;

    navigator.clipboard.writeText(fullText).then(() => {
        alert("題目已複製到剪貼簿！");
    }).catch(err => {
        console.error("複製失敗", err);
    });
}

const editModal = document.getElementById('edit-modal');
const editQText = document.getElementById('edit-question-text');
const editOptionsList = document.getElementById('edit-options-list');
const editDesc = document.getElementById('edit-description');

function openEditModal(question) {
    editingQuestionId = question.id;
    editQText.value = question.question;
    editDesc.value = question.description || '';
    
    // 動態產生選項編輯列
    editOptionsList.innerHTML = '';
    question.options.forEach((opt, index) => {
        const item = document.createElement('div');
        item.className = 'option-edit-item';
        item.innerHTML = `
            <input type="checkbox" ${opt.true ? 'checked' : ''} class="edit-opt-correct">
            <input type="text" value="${opt.text}" class="edit-opt-text" placeholder="選項內容">
        `;
        editOptionsList.appendChild(item);
    });

    editModal.classList.add('show');
    overlay.classList.add('show');
}

function closeEditModal() {
    editModal.classList.remove('show');
    if (!sidebar.classList.contains('open') && !importModal.classList.contains('show')) {
        overlay.classList.remove('show');
    }
}

async function saveEdit() {
    if (editingQuestionId === null) return;

    const newQuestion = editQText.value.trim();
    if (!newQuestion) {
        alert("題目不能為空");
        return;
    }

    // 收集選項
    const optionItems = editOptionsList.querySelectorAll('.option-edit-item');
    const newOptions = [];
    let hasCorrect = false;

    optionItems.forEach((item, index) => {
        const text = item.querySelector('.edit-opt-text').value.trim();
        const isTrue = item.querySelector('.edit-opt-correct').checked;
        if (text) {
            newOptions.push({
                text: text,
                true: isTrue,
                order: index + 1
            });
            if (isTrue) hasCorrect = true;
        }
    });

    if (newOptions.length < 2) {
        alert("至少需要兩個選項");
        return;
    }
    if (!hasCorrect) {
        alert("請至少勾選一個正確答案");
        return;
    }

    const newDescription = editDesc.value.trim();

    try {
        const transaction = db.transaction(['questions'], 'readwrite');
        const store = transaction.objectStore('questions');
        const request = store.get(editingQuestionId);

        request.onsuccess = () => {
            const data = request.result;
            data.question = newQuestion;
            data.options = newOptions;
            data.description = newDescription;
            store.put(data);
        };

        transaction.oncomplete = () => {
            alert("修改成功！");
            closeEditModal();
            showRecords(); // 刷新清單
        };
    } catch (err) {
        alert("儲存失敗：" + err.message);
    }
}


/* =========================================
   功能 3.3 & 3.4: 清空資料
   ========================================= */
async function clearFails() {
    if (!confirm("確定要將所有錯題紀錄歸零嗎？這不會刪除題目。")) return;
    const allQ = await getAllQuestions();
    const transaction = db.transaction(['questions'], 'readwrite');
    const store = transaction.objectStore('questions');

    allQ.forEach(q => {
        if (q.fail > 0) {
            q.fail = 0;
            store.put(q);
        }
    });
    transaction.oncomplete = () => { alert("錯題紀錄已歸零！"); goHome(); };
}

async function clearAllData() {
    if (!confirm("⚠️ 警告：確定要刪除所有題庫和紀錄嗎？此動作無法復原！")) return;
    const transaction = db.transaction(['questions'], 'readwrite');
    const store = transaction.objectStore('questions');
    const req = store.clear();
    req.onsuccess = () => { alert("資料已全部清空。"); goHome(); };
}


/* =========================================
   測驗邏輯
   ========================================= */
let quizQueue = [];
let currentQ = null;
let selectedOptionData = null;
let isAnswerSubmitted = false;

// 洗牌函數
function shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex > 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

async function startQuiz() {
    let questions = await getAllQuestions();
    
    const scope = document.getElementById('config-scope').value;
    const bankName = document.getElementById('config-bank-select').value;
    const mode = document.getElementById('config-mode').value;

    // 1. 範圍過濾
    if (scope === 'bank' && bankName) {
        questions = questions.filter(q => q.questionBank === bankName);
    }

    if (questions.length === 0) {
        alert("選擇的範圍內沒有題目！");
        return;
    }

    // 2. 出題模式排序
    if (mode === 'unanswered') {
        // 未答優先：答題總次數愈少的放在愈後面 (以便 pop 先取出)
        quizQueue = [...questions].sort((a, b) => {
            const aTotal = a.correct + a.fail;
            const bTotal = b.correct + b.fail;
            if (aTotal !== bTotal) return bTotal - aTotal; 
            return Math.random() - 0.5; // 次數相同時隨機
        });
    } else if (mode === 'wrong') {
        // 錯題優先：錯誤次數愈多的放在愈後面 (以便 pop 先取出)
        quizQueue = [...questions].sort((a, b) => {
            if (a.fail !== b.fail) return a.fail - b.fail;
            // 錯誤次數相同時，比較錯誤率或是錯誤與正確的差值
            const aDiff = a.fail - a.correct;
            const bDiff = b.fail - b.correct;
            if (aDiff !== bDiff) return aDiff - bDiff;
            return Math.random() - 0.5;
        });
    } else {
        // 完全隨機
        quizQueue = shuffle([...questions]);
    }

    switchView('view-quiz', '測驗中');
    document.getElementById('bottom-bar').classList.add('show');
    loadNextQuestion();
}

function loadNextQuestion() {
    if (quizQueue.length === 0) {
        alert("測驗結束！");
        goHome();
        return;
    }

    currentQ = quizQueue.pop(); 
    isAnswerSubmitted = false;
    selectedOptionData = null;

    document.getElementById('quiz-bank-name').textContent = `題庫：${currentQ.questionBank}`;
    document.getElementById('quiz-progress').textContent = `題號：${currentQ.questionNumber}`;
    document.getElementById('quiz-stats-count').textContent = `次數：${currentQ.correct + currentQ.fail}`;
    document.getElementById('question-text').textContent = currentQ.question;
    document.getElementById('feedback-box').classList.remove('show');

    const btn = document.getElementById('confirm-btn');
    btn.textContent = "請先選擇選項";
    btn.disabled = true;
    btn.classList.remove('next-mode');

    let processedOptions = [...currentQ.options];
    if (processedOptions.every(opt => opt.order === 0)) {
        processedOptions = shuffle(processedOptions);
    } else {
        processedOptions.sort((a, b) => a.order - b.order);
    }

    const container = document.getElementById('options-container');
    container.innerHTML = '';

    processedOptions.forEach((option) => {
        const optBtn = document.createElement('button');
        optBtn.className = 'option-btn';
        optBtn.textContent = option.text;
        optBtn.onclick = () => selectOption(optBtn, option);
        container.appendChild(optBtn);
    });
}

function selectOption(btnElement, optionData) {
    if (isAnswerSubmitted) return;

    document.querySelectorAll('.option-btn').forEach(el => el.classList.remove('selected'));
    btnElement.classList.add('selected');
    selectedOptionData = optionData;

    const confirmBtn = document.getElementById('confirm-btn');
    confirmBtn.textContent = "確認送出";
    confirmBtn.disabled = false;
}

function handleConfirm() {
    const confirmBtn = document.getElementById('confirm-btn');

    if (!isAnswerSubmitted) {
        isAnswerSubmitted = true;
        const isCorrect = selectedOptionData.true === true;

        updateQuestionStats(currentQ.id, isCorrect);

        const allBtns = document.querySelectorAll('.option-btn');
        allBtns.forEach(btn => {
            btn.disabled = true;
            const optData = currentQ.options.find(o => o.text === btn.textContent);
            if (optData && optData.true === true) {
                btn.classList.add('correct');
            }
        });

        if (!isCorrect) {
            const selectedBtn = document.querySelector('.option-btn.selected');
            if (selectedBtn) selectedBtn.classList.add('wrong');
        }

        const fbTitle = document.getElementById('feedback-title');
        if (isCorrect) {
            fbTitle.textContent = '✅ 答對了！';
            fbTitle.className = 'feedback-title success';
        } else {
            fbTitle.textContent = '❌ 答錯了！';
            fbTitle.className = 'feedback-title error';
        }
        document.getElementById('feedback-desc').textContent = currentQ.description || "無詳解";
        document.getElementById('feedback-box').classList.add('show');

        confirmBtn.textContent = "下一題";
        confirmBtn.classList.add('next-mode');
    } else {
        loadNextQuestion();
    }
}

/* =========================================
   初始化與事件綁定
   ========================================= */
function setViewportHeight() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

document.addEventListener('DOMContentLoaded', () => {
    initDB();
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', setViewportHeight);

    // 側邊欄開關與遮罩點擊
    document.querySelector('.menu-btn').addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', () => {
        if (importModal.classList.contains('show')) closeImportModal();
        if (editModal.classList.contains('show')) closeEditModal();
        if (sidebar.classList.contains('open')) toggleSidebar();
    });

    // 選單功能
    document.getElementById('nav-home')?.addEventListener('click', goHome);
    document.getElementById('nav-upload')?.addEventListener('click', () => {
        toggleSidebar();
        openImportModal();
    });
    document.getElementById('nav-records')?.addEventListener('click', showRecords);
    document.getElementById('nav-clear-fails')?.addEventListener('click', clearFails);
    document.getElementById('nav-clear-all')?.addEventListener('click', clearAllData);

    // 匯入 Modal 功能
    document.getElementById('import-cancel')?.addEventListener('click', closeImportModal);
    document.getElementById('import-confirm')?.addEventListener('click', executeImport);
    modalFileIn?.addEventListener('change', handleFileSelect);
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchImportTab(tab.dataset.tab));
    });
    bankSelect?.addEventListener('change', () => {
        newBankInput.classList.toggle('hidden', bankSelect.value !== 'new');
    });

    // 編輯 Modal 功能
    document.getElementById('edit-cancel')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-save')?.addEventListener('click', saveEdit);

    // 首頁測驗配置
    document.getElementById('config-scope')?.addEventListener('change', (e) => {
        document.getElementById('config-bank-wrapper').classList.toggle('hidden', e.target.value !== 'bank');
    });
    document.getElementById('start-btn').addEventListener('click', startQuiz);

    // 查看題庫篩選與排序
    document.getElementById('record-bank-filter')?.addEventListener('change', renderRecords);
    document.getElementById('record-sort-filter')?.addEventListener('change', renderRecords);

    // 測驗確認按鈕
    document.getElementById('confirm-btn').addEventListener('click', handleConfirm);
});
