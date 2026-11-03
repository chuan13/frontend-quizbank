/* =========================================================================
   Frontend Quizbank — 合併腳本（單檔版）
   結構：
     1. QuizDB            共用 IndexedDB 資料層（原 shared/db.js）
     2. Home              首頁狀態（原 index.html inline script）
     3. Quiz   (part1)    測驗
     4. Bank   (part2)    題庫管理
     5. Importer(part3)   JSON 匯入
     6. Maint  (part4)    狀態與維護
     7. Router            單頁換頁
   每個 part 都包在獨立 IIFE，避免全域變數／函式撞名（例如 part2 與 part4
   原本都有 refresh()）。各 part 對外只暴露 init() 與 onShow()。
   ========================================================================= */

/* =========================================================================
   全域輔助函式 (KaTeX 渲染與 HTML 跳脫)
   ========================================================================= */

/**
 * 轉義 HTML 特殊字元以防 XSS。
 * @param {string} s 
 * @returns {string}
 */
function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 格式化文字內容：支援 Markdown 行內程式碼 (`...`)、多行程式碼區塊 (```...```) 與 <code>...</code> 標籤。
 * 格式化後的程式碼標籤會被 KaTeX 的 ignoredTags 自動忽略，避免行內 $ 被誤判為 LaTeX 數學公式。
 *
 * @param {string} s - 輸入字串
 * @param {{ isFill?: boolean }} [options] - 選項，如是否為填充題需要替換 {{1}}
 * @returns {string} 轉義並包含安全標籤的 HTML 字串
 */
function formatContent(s, { isFill = false } = {}) {
    if (!s) return '';
    let safe = escapeHtml(String(s));

    // 支援已存在的 <code> 與 <pre><code> 標籤（先被 escapeHtml 轉成實體者）
    safe = safe.replace(/&lt;pre&gt;&lt;code&gt;([\s\S]*?)&lt;\/code&gt;&lt;\/pre&gt;/gi, '<pre class="code-block"><code>$1</code></pre>');
    safe = safe.replace(/&lt;code&gt;([\s\S]*?)&lt;\/code&gt;/gi, '<code class="inline-code">$1</code>');

    // 支援 Markdown 多行程式碼區塊 ```...```，自動忽略第一行的語言識別字（如 ```php 或 ```html）
    safe = safe.replace(/```(?:[a-zA-Z0-9_\-+]*[ \t]*(?:\r\n|\r|\n))?([\s\S]*?)```/g, (match, code) => {
        const cleanCode = code.replace(/[\r\n]+$/, '');
        return `<pre class="code-block"><code>${cleanCode}</code></pre>`;
    });

    // 支援 Markdown 行內程式碼 `...`
    safe = safe.replace(/`([^`\r\n]+)`/g, '<code class="inline-code">$1</code>');

    // 填充題題目空格
    if (isFill) {
        safe = safe.replace(/\{\{(\d+)\}\}/g, '<span class="blank-slot-badge">($1)</span>');
    }

    return safe;
}


/**
 * 渲染指定 HTML 元素中的 LaTeX 數學公式。
 * 內部呼叫 KaTeX 提供的 renderMathInElement API，如果 KaTeX 資源尚未載入則不執行任何動作。
 *
 * @param {HTMLElement} element - 需要進行 LaTeX 渲染的 HTML 元素節點。
 * @returns {void}
 */
function renderMath(element) {
    if (typeof renderMathInElement === 'function') {
        try {
            renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                throwOnError: false
            });
        } catch (error) {
            console.error('KaTeX 渲染時發生錯誤：', error);
        }
    }
}

/* =========================================
   1. 共用 IndexedDB 資料層 (window.QuizDB)
   ========================================= */
(function () {
    const DB_NAME = 'QuizDB';
    const DB_VERSION = 1;
    let db = null;

    function open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = (e) => reject(req.error || e);
            req.onsuccess = (e) => { db = e.target.result; resolve(db); };
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('questions')) {
                    const store = d.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('questionBank', 'questionBank', { unique: false });
                    store.createIndex('questionNumber', 'questionNumber', { unique: false });
                    store.createIndex('fail', 'fail', { unique: false });
                    store.createIndex('correct', 'correct', { unique: false });
                }
            };
        });
    }

    function store(mode) {
        return db.transaction(['questions'], mode).objectStore('questions');
    }

    function p(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    window.QuizDB = {
        async init() {
            if (!db) await open();
            return db;
        },

        getAll() {
            return p(store('readonly').getAll());
        },

        async getBanks() {
            const all = await this.getAll();
            return [...new Set(all.map(q => q.questionBank))];
        },

        async nextQuestionNumber(bank) {
            const all = await this.getAll();
            return all.filter(q => q.questionBank === bank).length + 1;
        },

        // 單題新增（自動填預設欄位）
        async add({ questionBank, question, options = [], description = '', remark = '', questionNumber = null, type = 'single', answers = [], correct = 0, fail = 0 }) {
            const num = questionNumber ?? await this.nextQuestionNumber(questionBank);
            const parseStat = (v) => {
                const n = Number(v);
                return Number.isInteger(n) && n >= 0 ? n : 0;
            };
            return p(store('readwrite').add({
                questionBank,
                questionNumber: num,
                type: type || 'single',
                correct: parseStat(correct),
                fail: parseStat(fail),
                question,
                options: options || [],
                answers: answers || [],
                description,
                remark: remark || '',
            }));
        },

        // 批次匯入到指定題庫，自動接續題號
        async addBatch(items, bank) {
            const all = await this.getAll();
            let maxNum = all.filter(q => q.questionBank === bank).length;
            const parseStat = (v) => {
                const n = Number(v);
                return Number.isInteger(n) && n >= 0 ? n : 0;
            };
            return new Promise((resolve, reject) => {
                const t = db.transaction(['questions'], 'readwrite');
                const s = t.objectStore('questions');
                items.forEach(it => {
                    maxNum++;
                    const inferredType = it.type || (Array.isArray(it.answers) && it.answers.length > 0 ? 'fill' : 'single');
                    s.add({
                        questionBank: bank,
                        questionNumber: maxNum,
                        type: inferredType,
                        correct: parseStat(it.correct),
                        fail: parseStat(it.fail),
                        question: it.question,
                        options: it.options || [],
                        answers: it.answers || [],
                        description: it.description || '',
                        remark: it.remark || '',
                    });
                });
                t.oncomplete = () => resolve(items.length);
                t.onerror = () => reject(t.error);
            });
        },

        async update(id, patch) {
            const s = store('readwrite');
            const cur = await p(s.get(id));
            if (!cur) throw new Error(`找不到題目 id=${id}`);
            Object.assign(cur, patch);
            return p(s.put(cur));
        },

        async updateStats(id, isCorrect) {
            const s = store('readwrite');
            const cur = await p(s.get(id));
            if (!cur) return;
            if (isCorrect) cur.correct = (cur.correct || 0) + 1;
            else cur.fail = (cur.fail || 0) + 1;
            return p(s.put(cur));
        },

        async resetAllFails() {
            const all = await this.getAll();
            return new Promise((resolve, reject) => {
                const t = db.transaction(['questions'], 'readwrite');
                const s = t.objectStore('questions');
                all.forEach(q => {
                    if (q.fail > 0) { q.fail = 0; s.put(q); }
                });
                t.oncomplete = () => resolve();
                t.onerror = () => reject(t.error);
            });
        },

        clearAll() {
            return p(store('readwrite').clear());
        },
    };
})();

/* =========================================
   2. Home：資料庫狀態（抽屜）
   ========================================= */
const Home = (function () {
    async function updateStatus() {
        const all = await QuizDB.getAll();
        const banks = [...new Set(all.map(q => q.questionBank))];
        const el = document.getElementById('drawer-db-status');
        if (!el) return;
        if (all.length === 0) {
            el.textContent = '目前資料庫為空，可由「JSON 匯入」開始。';
        } else {
            el.innerHTML = `目前共 <b>${all.length}</b> 題，分布於 <b>${banks.length}</b> 個題庫。`;
        }
    }
    return { init() { updateStatus(); }, updateStatus };
})();

/* =========================================
   3. Quiz（原 part1）：測驗
   ========================================= */
const Quiz = (function () {
    let quizQueue = [];
    let currentQ = null;
    let selectedOptionData = null; // 用於 single
    let selectedOptionsSet = new Set(); // 用於 multi
    let fillInputValues = []; // 用於 fill
    let isAnswerSubmitted = false;

    let remarkBtn = null;
    let remarkModal = null;
    let remarkModalText = null;
    let remarkModalQuestion = null;

    function shuffle(array) {
        let i = array.length, r;
        while (i > 0) {
            r = Math.floor(Math.random() * i);
            i--;
            [array[i], array[r]] = [array[r], array[i]];
        }
        return array;
    }

    /**
     * 重新整理測驗配置的 UI，包含載入題庫清單與還原上次儲存的選項。
     * @returns {Promise<void>}
     */
    async function refreshConfigUI() {
        const all = await QuizDB.getAll();
        const emptyHint = document.getElementById('empty-hint');
        const configArea = document.getElementById('config-area');

        if (all.length === 0) {
            emptyHint.classList.remove('hidden');
            configArea.classList.add('hidden');
            return;
        }
        emptyHint.classList.add('hidden');
        configArea.classList.remove('hidden');

        const banks = [...new Set(all.map(q => q.questionBank))];
        /** @type {HTMLSelectElement} */
        const select = /** @type {any} */ (document.getElementById('config-bank-select'));
        select.innerHTML = '';
        banks.forEach(bank => {
            const opt = document.createElement('option');
            opt.value = bank;
            opt.textContent = bank;
            select.appendChild(opt);
        });

        /** @type {HTMLSelectElement} */
        const scopeSelect = /** @type {any} */ (document.getElementById('config-scope'));
        /** @type {HTMLSelectElement} */
        const modeSelect = /** @type {any} */ (document.getElementById('config-mode'));

        // 讀取 localStorage
        let savedConfig = null;
        try {
            const savedStr = localStorage.getItem('quiz_config');
            if (savedStr) {
                savedConfig = JSON.parse(savedStr);
            }
        } catch (e) {
            console.error('讀取 localStorage 失敗', e);
        }

        // 預設值
        let targetScope = scopeSelect.options[0]?.value || 'all';
        let targetBank = select.options[0]?.value || '';
        let targetMode = modeSelect.options[0]?.value || 'unanswered';

        if (savedConfig) {
            // 檢查 savedConfig.scope 是否有效
            const validScopes = Array.from(scopeSelect.options).map(o => o.value);
            if (savedConfig.scope && validScopes.includes(savedConfig.scope)) {
                targetScope = savedConfig.scope;
            }

            // 檢查 savedConfig.bank 是否有效
            const validBanks = Array.from(select.options).map(o => o.value);
            if (savedConfig.bank && validBanks.includes(savedConfig.bank)) {
                targetBank = savedConfig.bank;
            }

            // 檢查 savedConfig.mode 是否有效
            const validModes = Array.from(modeSelect.options).map(o => o.value);
            if (savedConfig.mode && validModes.includes(savedConfig.mode)) {
                targetMode = savedConfig.mode;
            }
        }

        // 套用選項
        scopeSelect.value = targetScope;
        select.value = targetBank;
        modeSelect.value = targetMode;

        // 觸發一次根據「全部」或「指定」題庫選項切換題庫下拉選單的呈現
        const bankWrapper = document.getElementById('config-bank-wrapper');
        if (bankWrapper) {
            bankWrapper.classList.toggle('hidden', targetScope !== 'bank');
        }

        // 觸發一次根據出題模式切換起始題號輸入框的呈現與還原上次的值
        const startNumWrapper = document.getElementById('config-start-num-wrapper');
        if (startNumWrapper) {
            startNumWrapper.classList.toggle('hidden', targetMode !== 'number');
        }
        /** @type {HTMLInputElement} */
        const startNumInput = /** @type {any} */ (document.getElementById('config-start-num'));
        if (startNumInput && savedConfig && savedConfig.startNum !== undefined) {
            startNumInput.value = savedConfig.startNum;
        }
    }

    // 回到出題設定畫面（取代原本的 location.reload）
    function resetToConfig() {
        document.getElementById('view-quiz').classList.add('hidden');
        document.getElementById('view-config').classList.remove('hidden');
        document.getElementById('bottom-bar').classList.remove('show');
        if (remarkBtn) remarkBtn.classList.add('hidden');
        const remarkBox = document.getElementById('remark-box');
        if (remarkBox) remarkBox.classList.remove('show');
        closeRemarkModal();
        quizQueue = [];
        currentQ = null;

        const navBack = document.getElementById('nav-back');
        if (navBack && typeof Router !== 'undefined' && Router.getCurrent() === 'quiz') {
            navBack.classList.add('invisible');
            navBack.textContent = '< 離開';
        }
    }

    /**
     * 開始測驗並將當前配置儲存至 localStorage。
     * @returns {Promise<void>}
     */
    async function startQuiz() {
        let questions = await QuizDB.getAll();
        /** @type {HTMLSelectElement} */
        const scopeEl = /** @type {any} */ (document.getElementById('config-scope'));
        /** @type {HTMLSelectElement} */
        const bankSelectEl = /** @type {any} */ (document.getElementById('config-bank-select'));
        /** @type {HTMLSelectElement} */
        const modeEl = /** @type {any} */ (document.getElementById('config-mode'));

        const scope = scopeEl.value;
        const bankName = bankSelectEl.value;
        const mode = modeEl.value;

        // 整理並儲存當前選項
        /** @type {HTMLInputElement} */
        const startNumEl = /** @type {any} */ (document.getElementById('config-start-num'));
        const startNumRaw = (startNumEl ? startNumEl.value : '').trim();

        const quizConfig = {
            scope: scope,
            bank: bankName,
            mode: mode,
            startNum: startNumRaw
        };
        try {
            localStorage.setItem('quiz_config', JSON.stringify(quizConfig));
        } catch (e) {
            console.error('儲存測驗設定失敗：', e);
        }

        if (scope === 'bank' && bankName) {
            questions = questions.filter(q => q.questionBank === bankName);
        }
        if (questions.length === 0) {
            alert('選擇的範圍內沒有題目！');
            return;
        }

        let startNum = null;
        if (mode === 'number' && startNumRaw !== '') {
            if (!/^\d+$/.test(startNumRaw) || parseInt(startNumRaw, 10) <= 0) {
                alert('請輸入有效的數字題號！');
                return;
            }
            startNum = parseInt(startNumRaw, 10);
            const hasQuestion = questions.some(q => Number(q.questionNumber) === startNum);
            if (!hasQuestion) {
                const targetName = scope === 'bank' && bankName ? `題庫「${bankName}」` : '選取範圍';
                alert(`${targetName}中沒有題號 ${startNum} 的題目！`);
                return;
            }
        }

        if (mode === 'unanswered') {
            quizQueue = [...questions].sort((a, b) => {
                const at = a.correct + a.fail, bt = b.correct + b.fail;
                if (at !== bt) return bt - at;
                return Math.random() - 0.5;
            });
        } else if (mode === 'wrong') {
            quizQueue = [...questions].sort((a, b) => {
                if (a.fail !== b.fail) return a.fail - b.fail;
                const ad = a.fail - a.correct, bd = b.fail - b.correct;
                if (ad !== bd) return ad - bd;
                return Math.random() - 0.5;
            });
        } else if (mode === 'number') {
            if (startNum !== null) {
                questions = questions.filter(q => Number(q.questionNumber) >= startNum);
            }
            quizQueue = [...questions].sort((a, b) => {
                if (a.questionBank !== b.questionBank) {
                    return String(b.questionBank || '').localeCompare(String(a.questionBank || ''));
                }
                return Number(b.questionNumber || 0) - Number(a.questionNumber || 0);
            });
        } else {
            quizQueue = shuffle([...questions]);
        }

        document.getElementById('view-config').classList.add('hidden');
        document.getElementById('view-quiz').classList.remove('hidden');
        document.getElementById('bottom-bar').classList.add('show');
        const navBack = document.getElementById('nav-back');
        if (navBack) {
            navBack.classList.remove('invisible');
            navBack.textContent = '< 離開';
        }
        loadNextQuestion();
    }

    function loadNextQuestion() {
        if (quizQueue.length === 0) {
            alert('測驗結束！');
            resetToConfig();
            refreshConfigUI();
            return;
        }

        currentQ = quizQueue.pop();
        isAnswerSubmitted = false;
        selectedOptionData = null;
        selectedOptionsSet.clear();
        fillInputValues = [];

        if (remarkBtn) remarkBtn.classList.add('hidden');
        const remarkBox = document.getElementById('remark-box');
        const remarkText = document.getElementById('remark-text');
        if (remarkBox) remarkBox.classList.remove('show');
        if (remarkText) remarkText.textContent = '';

        document.getElementById('quiz-bank-name').textContent = `題庫：${currentQ.questionBank}`;
        document.getElementById('quiz-progress').textContent = `題號：${currentQ.questionNumber}`;
        document.getElementById('quiz-stats-count').textContent = `次數：${currentQ.correct + currentQ.fail}`;
        
        const qType = currentQ.type || (Array.isArray(currentQ.answers) && currentQ.answers.length > 0 ? 'fill' : 'single');
        const typeBadge = document.getElementById('quiz-type-badge');
        if (typeBadge) {
            typeBadge.className = `type-badge ${qType}`;
            typeBadge.textContent = qType === 'single' ? '單選' : (qType === 'multi' ? '複選' : '填充');
        }

        const qEl = document.getElementById('question-text');
        const isFill = qType === 'fill' || /\{\{\d+\}\}/.test(currentQ.question);
        qEl.innerHTML = formatContent(currentQ.question, { isFill });
        renderMath(qEl);
        
        document.getElementById('feedback-box').classList.remove('show');

        const btn = document.getElementById('confirm-btn');
        btn.disabled = true;
        btn.classList.remove('next-mode');
        if (qType === 'single') {
            btn.textContent = '請先選擇選項';
        } else if (qType === 'multi') {
            btn.textContent = '請選擇選項 (複選)';
        } else {
            btn.textContent = '請輸入所有空格';
        }

        const container = document.getElementById('options-container');
        container.innerHTML = '';

        if (qType === 'fill') {
            renderFillInputs(container);
        } else {
            renderChoiceOptions(container, qType);
        }
    }

    function renderChoiceOptions(container, qType) {
        let opts = [...(currentQ.options || [])];
        if (opts.every(o => o.order === 0)) opts = shuffle(opts);
        else opts.sort((a, b) => a.order - b.order);

        opts.forEach(option => {
            const optBtn = document.createElement('button');
            optBtn.className = qType === 'multi' ? 'option-btn multi-choice' : 'option-btn';
            optBtn.innerHTML = formatContent(option.text);
            /** @type {any} */ (optBtn)._optionData = option;
            if (qType === 'multi') {
                optBtn.onclick = () => toggleMultiOption(optBtn, option);
            } else {
                optBtn.onclick = () => selectSingleOption(optBtn, option);
            }
            container.appendChild(optBtn);
            renderMath(optBtn);
        });
    }

    function selectSingleOption(btnEl, data) {
        if (isAnswerSubmitted) return;
        document.querySelectorAll('.option-btn').forEach(el => el.classList.remove('selected'));
        btnEl.classList.add('selected');
        selectedOptionData = data;
        const cb = document.getElementById('confirm-btn');
        cb.textContent = '確認送出';
        cb.disabled = false;
    }

    function toggleMultiOption(btnEl, data) {
        if (isAnswerSubmitted) return;
        if (selectedOptionsSet.has(data)) {
            selectedOptionsSet.delete(data);
            btnEl.classList.remove('selected');
        } else {
            selectedOptionsSet.add(data);
            btnEl.classList.add('selected');
        }
        const cb = document.getElementById('confirm-btn');
        if (selectedOptionsSet.size > 0) {
            cb.textContent = `確認送出 (已選 ${selectedOptionsSet.size} 項)`;
            cb.disabled = false;
        } else {
            cb.textContent = '請選擇選項 (複選)';
            cb.disabled = true;
        }
    }

    function renderFillInputs(container) {
        let slotCount = (currentQ.answers && currentQ.answers.length) || 0;
        if (slotCount === 0) {
            const matches = [...currentQ.question.matchAll(/\{\{(\d+)\}\}/g)];
            if (matches.length > 0) {
                slotCount = Math.max(...matches.map(m => parseInt(m[1], 10)));
            } else {
                slotCount = 1;
            }
        }

        fillInputValues = new Array(slotCount).fill('');
        const fillList = document.createElement('div');
        fillList.className = 'fill-list';

        for (let i = 0; i < slotCount; i++) {
            const item = document.createElement('div');
            item.className = 'fill-item';
            item.innerHTML = `
                <div class="fill-header">
                    <span class="fill-label">第 ${i + 1} 格</span>
                </div>
                <input type="text" class="fill-input" data-index="${i}" placeholder="請在此輸入第 ${i + 1} 格答案...">
            `;
            const input = item.querySelector('.fill-input');
            input.addEventListener('input', (e) => {
                fillInputValues[i] = e.target.value;
                updateFillConfirmBtn(slotCount);
            });
            fillList.appendChild(item);
        }
        container.appendChild(fillList);
    }

    function updateFillConfirmBtn(slotCount) {
        const cb = document.getElementById('confirm-btn');
        const allFilled = fillInputValues.length === slotCount && fillInputValues.every(val => (val || '').trim().length > 0);
        if (allFilled) {
            cb.textContent = '確認送出';
            cb.disabled = false;
        } else {
            cb.textContent = '請輸入所有空格';
            cb.disabled = true;
        }
    }

    async function handleConfirm() {
        const cb = document.getElementById('confirm-btn');
        if (!isAnswerSubmitted) {
            isAnswerSubmitted = true;
            const qType = currentQ.type || (Array.isArray(currentQ.answers) && currentQ.answers.length > 0 ? 'fill' : 'single');
            let isCorrect = false;

            if (qType === 'single') {
                isCorrect = selectedOptionData && selectedOptionData.true === true;
                document.querySelectorAll('.option-btn').forEach(btn => {
                    btn.disabled = true;
                    const od = /** @type {any} */ (btn)._optionData;
                    if (od && od.true === true) btn.classList.add('correct');
                });
                if (!isCorrect) {
                    const sel = document.querySelector('.option-btn.selected');
                    if (sel) sel.classList.add('wrong');
                }
            } else if (qType === 'multi') {
                const correctOptions = (currentQ.options || []).filter(o => o.true === true);
                isCorrect = (selectedOptionsSet.size === correctOptions.length) &&
                    correctOptions.every(o => selectedOptionsSet.has(o));

                document.querySelectorAll('.option-btn').forEach(btn => {
                    btn.disabled = true;
                    const od = /** @type {any} */ (btn)._optionData;
                    const isSelected = selectedOptionsSet.has(od);
                    const isAnswer = od && od.true === true;

                    if (isAnswer && isSelected) {
                        btn.classList.add('correct');
                    } else if (isAnswer && !isSelected) {
                        btn.classList.add('correct-missed');
                        btn.title = '此為正確答案（漏選）';
                    } else if (!isAnswer && isSelected) {
                        btn.classList.add('wrong');
                    }
                });
            } else if (qType === 'fill') {
                const slotCount = (currentQ.answers && currentQ.answers.length) || fillInputValues.length;
                let allSlotsCorrect = true;

                for (let i = 0; i < slotCount; i++) {
                    const userVal = (fillInputValues[i] || '').trim();
                    const validAnswers = (currentQ.answers && currentQ.answers[i]) || [];
                    // 比對規則：不忽略英文字母大小寫，去前後空白
                    const isSlotCorrect = validAnswers.some(ans => String(ans).trim() === userVal);
                    if (!isSlotCorrect) allSlotsCorrect = false;

                    const container = document.getElementById('options-container');
                    const inputEl = container.querySelector(`.fill-input[data-index="${i}"]`);
                    if (inputEl) {
                        inputEl.disabled = true;
                        if (isSlotCorrect) {
                            inputEl.classList.add('correct');
                        } else {
                            inputEl.classList.add('wrong');
                            const hint = document.createElement('div');
                            hint.className = 'fill-answer-hint';
                            hint.textContent = `正確解答：${validAnswers.join(' 或 ')}`;
                            inputEl.parentElement.appendChild(hint);
                        }
                    }
                }
                isCorrect = allSlotsCorrect;
            }

            await QuizDB.updateStats(currentQ.id, isCorrect);

            const ft = document.getElementById('feedback-title');
            if (isCorrect) {
                ft.textContent = '✅ 答對了！';
                ft.className = 'feedback-title success';
            } else {
                ft.textContent = '❌ 答錯了！';
                ft.className = 'feedback-title error';
            }
            
            const fdEl = document.getElementById('feedback-desc');
            fdEl.innerHTML = formatContent(currentQ.description || '無詳解');
            renderMath(fdEl);

            document.getElementById('feedback-box').classList.add('show');

            // 備註呈現：若有內容則在 feedback-box 外部獨立呈現 remark-box
            const remarkBox = document.getElementById('remark-box');
            const remarkText = document.getElementById('remark-text');
            if (currentQ.remark && currentQ.remark.trim()) {
                remarkText.innerHTML = formatContent(currentQ.remark.trim());
                renderMath(remarkText);
                remarkBox.classList.add('show');
            } else {
                remarkBox.classList.remove('show');
            }

            // 顯示下一題左側的方形筆 Emoji 按鈕
            if (remarkBtn) remarkBtn.classList.remove('hidden');

            cb.textContent = '下一題';
            cb.classList.add('next-mode');
            cb.disabled = false;
        } else {
            loadNextQuestion();
        }
    }

    function openRemarkModal() {
        if (!currentQ) return;
        if (remarkModalQuestion) remarkModalQuestion.innerHTML = formatContent(currentQ.question);
        if (remarkModalText) remarkModalText.value = currentQ.remark || '';
        if (remarkModal) remarkModal.classList.add('show');
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.add('show');
    }

    function closeRemarkModal() {
        if (remarkModal) remarkModal.classList.remove('show');
        const editModal = document.getElementById('edit-modal');
        const addModal = document.getElementById('add-modal');
        const isOtherModalOpen = (editModal && editModal.classList.contains('show')) ||
            (addModal && addModal.classList.contains('show'));
        if (!isOtherModalOpen) {
            const overlay = document.getElementById('overlay');
            if (overlay) overlay.classList.remove('show');
        }
    }

    async function saveRemark() {
        if (!currentQ) return;
        const newRemark = (remarkModalText ? remarkModalText.value : '').trim();
        currentQ.remark = newRemark;
        await QuizDB.update(currentQ.id, { remark: newRemark });

        // 即時刷新 feedback-box 外部的獨立備註區塊
        const remarkBox = document.getElementById('remark-box');
        const remarkText = document.getElementById('remark-text');
        if (newRemark) {
            remarkText.innerHTML = formatContent(newRemark);
            renderMath(remarkText);
            remarkBox.classList.add('show');
        } else {
            remarkBox.classList.remove('show');
        }

        closeRemarkModal();
    }

    function init() {
        remarkBtn = document.getElementById('remark-edit-btn');
        remarkModal = document.getElementById('remark-modal');
        remarkModalText = document.getElementById('remark-modal-text');
        remarkModalQuestion = document.getElementById('remark-modal-question');

        document.getElementById('config-scope').addEventListener('change', e => {
            document.getElementById('config-bank-wrapper').classList.toggle('hidden', e.target.value !== 'bank');
        });
        document.getElementById('config-mode').addEventListener('change', e => {
            const startNumWrapper = document.getElementById('config-start-num-wrapper');
            if (startNumWrapper) {
                startNumWrapper.classList.toggle('hidden', e.target.value !== 'number');
            }
        });
        document.getElementById('start-btn').addEventListener('click', startQuiz);
        document.getElementById('confirm-btn').addEventListener('click', handleConfirm);

        if (remarkBtn) remarkBtn.addEventListener('click', openRemarkModal);
        const remarkCancelBtn = document.getElementById('remark-modal-cancel');
        if (remarkCancelBtn) remarkCancelBtn.addEventListener('click', closeRemarkModal);
        const remarkSaveBtn = document.getElementById('remark-modal-save');
        if (remarkSaveBtn) remarkSaveBtn.addEventListener('click', saveRemark);
    }

    // 每次進入測驗頁：回到設定畫面並重新整理題庫清單
    async function onShow() {
        resetToConfig();
        await refreshConfigUI();
    }

    return { init, onShow, resetToConfig };
})();

/* =========================================
   4. Bank（原 part2）：題庫管理
   ========================================= */
const Bank = (function () {
    let allRecords = [];
    let editingId = null;

    let overlay, editModal, addModal, addBankSelect, addNewBankInput;
    let editTypeSelect, editOptionsArea, editBlanksArea, editOptionsList, editBlanksList;
    let addTypeSelect, addOptionsArea, addBlanksArea, addOptionsList, addBlanksList;

    /* ---------- 列表渲染 ---------- */

    async function refresh() {
        allRecords = await QuizDB.getAll();
        const banks = [...new Set(allRecords.map(q => q.questionBank))];
        const filter = document.getElementById('record-bank-filter');
        const cur = filter.value;
        filter.innerHTML = '<option value="all">全部題庫</option>';
        banks.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            filter.appendChild(opt);
        });
        filter.value = banks.includes(cur) || cur === 'all' ? cur : 'all';
        render();
    }

    function render() {
        const container = document.getElementById('records-container');
        const bankVal = document.getElementById('record-bank-filter').value;
        const sortVal = document.getElementById('record-sort-filter').value;
        container.innerHTML = '';

        const addBtn = document.createElement('button');
        addBtn.className = 'add-btn';
        addBtn.textContent = bankVal === 'all' ? '➕ 新增題目' : `➕ 新增題目到「${bankVal}」`;
        addBtn.onclick = () => openAddModal(bankVal === 'all' ? null : bankVal);
        container.appendChild(addBtn);

        let filtered = allRecords;
        if (bankVal !== 'all') filtered = filtered.filter(q => q.questionBank === bankVal);

        filtered = [...filtered].sort((a, b) => {
            if (sortVal === 'num-asc') {
                if (a.questionBank !== b.questionBank) return a.questionBank.localeCompare(b.questionBank);
                return a.questionNumber - b.questionNumber;
            }
            return b.fail - a.fail;
        });

        if (filtered.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'text-align:center; padding:20px; color:#999;';
            p.textContent = '沒有符合的紀錄';
            container.appendChild(p);
            return;
        }

        filtered.forEach(q => {
            const div = document.createElement('div');
            div.className = 'record-item';
            const preview = q.question.length > 20 ? q.question.slice(0, 20) + '...' : q.question;
            const qType = q.type || (Array.isArray(q.answers) && q.answers.length > 0 ? 'fill' : 'single');
            const typeText = qType === 'single' ? '單選' : (qType === 'multi' ? '複選' : '填充');
            div.innerHTML = `
                <div class="record-info">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="bank-tag">${q.questionBank}</span>
                        <span class="type-badge ${qType}">${typeText}</span>
                        <span style="font-size:0.85rem; color:var(--text-light);">第 ${q.questionNumber} 題</span>
                    </div>
                    <span class="preview">${escapeHtml(preview)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <div class="record-stats">
                        <span class="stats-c">✔️ ${q.correct}</span> /
                        <span class="stats-f">❌ ${q.fail}</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <button class="action-icon-btn copy-btn" title="複製題目">📋</button>
                        <button class="action-icon-btn edit-btn" title="編輯題目">✏️</button>
                    </div>
                </div>
            `;
            div.querySelector('.copy-btn').onclick = () => copyQ(q);
            div.querySelector('.edit-btn').onclick = () => openEditModal(q);
            container.appendChild(div);
        });
    }

    function copyQ(q) {
        const qType = q.type || (Array.isArray(q.answers) && q.answers.length > 0 ? 'fill' : 'single');
        let answerText = '';
        if (qType === 'fill') {
            const ansList = q.answers || [];
            answerText = ansList.map((a, i) => `第 ${i + 1} 格答案：${Array.isArray(a) ? a.join(' / ') : a}`).join('\n');
        } else {
            const opts = (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}${o.true ? ' (正確答案)' : ''}`).join('\n');
            answerText = `選項：\n${opts}`;
        }
        const typeText = qType === 'single' ? '單選' : (qType === 'multi' ? '複選' : '填充');
        const remarkPart = q.remark ? `\n備註：${q.remark}` : '';
        const text = `題庫：${q.questionBank}\n題型：${typeText}\n第 ${q.questionNumber} 題\n題目：${q.question}\n${answerText}\n說明：${q.description || '無'}${remarkPart}`;
        navigator.clipboard.writeText(text).then(() => alert('題目已複製到剪貼簿！'));
    }

    /* ---------- 空格與選項輔助 ---------- */

    function buildBlankRow(container, value = '') {
        const idx = container.children.length + 1;
        const item = document.createElement('div');
        item.className = 'option-edit-item blank-edit-item';
        item.innerHTML = `
            <span style="font-size:0.85rem; color:var(--primary); font-weight:bold; width:55px; flex-shrink:0;">第 ${idx} 格</span>
            <input type="text" class="blank-edit-text" placeholder="多個可接受答案以逗號 , 分隔" value="${escapeAttr(value)}">
            <button type="button" class="opt-remove" title="刪除空格">✕</button>
        `;
        item.querySelector('.opt-remove').onclick = () => {
            if (container.children.length <= 1) return alert('至少需保留一個空格');
            item.remove();
            Array.from(container.children).forEach((child, i) => {
                const sp = child.querySelector('span');
                if (sp) sp.textContent = `第 ${i + 1} 格`;
            });
        };
        container.appendChild(item);
    }

    function buildOptionRow(container, { text = '', isTrue = false, order = 0 } = {}, isEdit = false) {
        const item = document.createElement('div');
        item.className = 'option-edit-item';
        item.innerHTML = `
            <input type="checkbox" class="opt-correct" ${isTrue ? 'checked' : ''} title="正確答案">
            <input type="text" class="opt-text" placeholder="選項內容" value="${escapeAttr(text)}">
            <input type="number" class="opt-order" value="${order}" min="0" title="order (0=隨機, 1+=固定順序)">
            <button type="button" class="opt-remove" title="刪除選項">✕</button>
        `;
        item.querySelector('.opt-remove').onclick = () => {
            if (container.children.length <= 2) return alert('至少需保留兩個選項');
            item.remove();
        };
        container.appendChild(item);
    }

    /* ---------- 編輯 Modal ---------- */

    function openEditModal(q) {
        editingId = q.id;
        const qType = q.type || (Array.isArray(q.answers) && q.answers.length > 0 ? 'fill' : 'single');
        editTypeSelect.value = qType;
        document.getElementById('edit-question-text').value = q.question;
        document.getElementById('edit-description').value = q.description || '';
        document.getElementById('edit-remark').value = q.remark || '';
        
        editOptionsList.innerHTML = '';
        (q.options || []).forEach(opt => {
            buildOptionRow(editOptionsList, { text: opt.text, isTrue: !!opt.true, order: opt.order || 0 }, true);
        });
        if (editOptionsList.children.length === 0) {
            [0, 1, 2, 3].forEach(() => buildOptionRow(editOptionsList, {}, true));
        }

        editBlanksList.innerHTML = '';
        if (Array.isArray(q.answers) && q.answers.length > 0) {
            q.answers.forEach(ansGroup => {
                const valStr = Array.isArray(ansGroup) ? ansGroup.join(', ') : String(ansGroup);
                buildBlankRow(editBlanksList, valStr);
            });
        } else {
            buildBlankRow(editBlanksList);
        }

        updateModalTypeUI('edit', qType);

        editModal.classList.add('show');
        overlay.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
        if (!addModal.classList.contains('show')) overlay.classList.remove('show');
    }

    function updateModalTypeUI(mode, type) {
        const isEdit = mode === 'edit';
        const optArea = isEdit ? editOptionsArea : addOptionsArea;
        const blankArea = isEdit ? editBlanksArea : addBlanksArea;
        const optLabel = document.getElementById(isEdit ? 'edit-options-label' : 'add-options-label');

        if (type === 'fill') {
            optArea.classList.add('hidden');
            blankArea.classList.remove('hidden');
        } else {
            optArea.classList.remove('hidden');
            blankArea.classList.add('hidden');
            if (optLabel) {
                optLabel.textContent = type === 'multi'
                    ? '選項 (可勾選多個正確答案)'
                    : '選項 (勾選一個正確答案；order 0=隨機，1+=固定順序)';
            }
        }
    }

    async function saveEdit() {
        if (editingId === null) return;
        const question = document.getElementById('edit-question-text').value.trim();
        if (!question) return alert('題目不能為空');
        const type = editTypeSelect.value;
        const description = document.getElementById('edit-description').value.trim();
        const remark = document.getElementById('edit-remark').value.trim();

        let options = [];
        let answers = [];

        if (type === 'fill') {
            const blankItems = editBlanksList.querySelectorAll('.blank-edit-item');
            blankItems.forEach(it => {
                const raw = it.querySelector('.blank-edit-text').value.trim();
                if (raw) {
                    const ansList = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                    if (ansList.length > 0) answers.push(ansList);
                }
            });
            if (answers.length === 0) return alert('填充題至少需要設定一個空格答案');
        } else {
            const items = editOptionsList.querySelectorAll('.option-edit-item');
            let hasCorrect = false;
            items.forEach((it, idx) => {
                const text = it.querySelector('.opt-text').value.trim();
                const isTrue = it.querySelector('.opt-correct').checked;
                const order = parseInt(it.querySelector('.opt-order').value, 10) || 0;
                if (text) {
                    const o = { order: order || (idx + 1), text };
                    if (isTrue) { o.true = true; hasCorrect = true; }
                    options.push(o);
                }
            });
            if (options.length < 2) return alert('至少需要兩個選項');
            if (!hasCorrect) return alert('請至少勾選一個正確答案');
        }

        await QuizDB.update(editingId, {
            question,
            type,
            options,
            answers,
            description,
            remark,
        });
        alert('修改成功！');
        closeEditModal();
        refresh();
    }

    /* ---------- 新增 Modal ---------- */

    async function openAddModal(presetBank = null) {
        const banks = await QuizDB.getBanks();
        addBankSelect.innerHTML = '<option value="new">+ 建立新題庫</option>';
        banks.forEach(b => {
            const o = document.createElement('option');
            o.value = b;
            o.textContent = b;
            addBankSelect.appendChild(o);
        });

        if (presetBank && banks.includes(presetBank)) {
            addBankSelect.value = presetBank;
            addNewBankInput.classList.add('hidden');
        } else {
            addBankSelect.value = 'new';
            addNewBankInput.classList.remove('hidden');
        }
        addNewBankInput.value = '';
        addTypeSelect.value = 'single';
        document.getElementById('add-question-text').value = '';
        document.getElementById('add-description').value = '';
        document.getElementById('add-remark').value = '';

        addOptionsList.innerHTML = '';
        [0, 1, 2, 3].forEach(() => buildOptionRow(addOptionsList));

        addBlanksList.innerHTML = '';
        buildBlankRow(addBlanksList);

        updateModalTypeUI('add', 'single');

        addModal.classList.add('show');
        overlay.classList.add('show');
    }

    function closeAddModal() {
        addModal.classList.remove('show');
        if (!editModal.classList.contains('show')) overlay.classList.remove('show');
    }

    async function saveNew() {
        const question = document.getElementById('add-question-text').value.trim();
        if (!question) return alert('題目不能為空');

        let bank = addBankSelect.value;
        if (bank === 'new') {
            bank = addNewBankInput.value.trim();
            if (!bank) return alert('請輸入新題庫名稱');
        }

        const type = addTypeSelect.value;
        const description = document.getElementById('add-description').value.trim();
        const remark = document.getElementById('add-remark').value.trim();
        let options = [];
        let answers = [];

        if (type === 'fill') {
            const blankItems = addBlanksList.querySelectorAll('.blank-edit-item');
            blankItems.forEach(it => {
                const raw = it.querySelector('.blank-edit-text').value.trim();
                if (raw) {
                    const ansList = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                    if (ansList.length > 0) answers.push(ansList);
                }
            });
            if (answers.length === 0) return alert('填充題至少需要設定一個空格答案');
        } else {
            const rows = addOptionsList.querySelectorAll('.option-edit-item');
            let hasCorrect = false;
            rows.forEach(r => {
                const text = r.querySelector('.opt-text').value.trim();
                if (!text) return;
                const isTrue = r.querySelector('.opt-correct').checked;
                const order = parseInt(r.querySelector('.opt-order').value, 10) || 0;
                const o = { order, text };
                if (isTrue) { o.true = true; hasCorrect = true; }
                options.push(o);
            });
            if (options.length < 2) return alert('至少需要兩個選項');
            if (!hasCorrect) return alert('請至少勾選一個正確答案');
        }

        await QuizDB.add({
            questionBank: bank,
            question,
            type,
            options,
            answers,
            description,
            remark,
        });

        if (document.getElementById('add-keep-open').checked) {
            await openAddModal(bank);
        } else {
            alert(`已新增至「${bank}」`);
            closeAddModal();
        }
        refresh();
    }

    /* ---------- 工具 ---------- */

    function escapeAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ---------- 初始化 ---------- */

    function init() {
        overlay = document.getElementById('overlay');
        editModal = document.getElementById('edit-modal');
        addModal = document.getElementById('add-modal');
        addBankSelect = document.getElementById('add-bank-select');
        addNewBankInput = document.getElementById('add-new-bank-name');

        editTypeSelect = document.getElementById('edit-type-select');
        editOptionsArea = document.getElementById('edit-options-area');
        editBlanksArea = document.getElementById('edit-blanks-area');
        editOptionsList = document.getElementById('edit-options-list');
        editBlanksList = document.getElementById('edit-blanks-list');

        addTypeSelect = document.getElementById('add-type-select');
        addOptionsArea = document.getElementById('add-options-area');
        addBlanksArea = document.getElementById('add-blanks-area');
        addOptionsList = document.getElementById('add-options-list');
        addBlanksList = document.getElementById('add-blanks-list');

        document.getElementById('record-bank-filter').addEventListener('change', render);
        document.getElementById('record-sort-filter').addEventListener('change', render);

        // 題型切換事件
        if (editTypeSelect) {
            editTypeSelect.addEventListener('change', (e) => updateModalTypeUI('edit', e.target.value));
        }
        if (addTypeSelect) {
            addTypeSelect.addEventListener('change', (e) => updateModalTypeUI('add', e.target.value));
        }

        document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
        document.getElementById('edit-save').addEventListener('click', saveEdit);
        document.getElementById('edit-option-btn').addEventListener('click', () => buildOptionRow(editOptionsList, {}, true));
        document.getElementById('edit-blank-btn').addEventListener('click', () => buildBlankRow(editBlanksList));

        document.getElementById('add-cancel').addEventListener('click', closeAddModal);
        document.getElementById('add-save').addEventListener('click', saveNew);
        document.getElementById('add-option-btn').addEventListener('click', () => buildOptionRow(addOptionsList));
        document.getElementById('add-blank-btn').addEventListener('click', () => buildBlankRow(addBlanksList));

        addBankSelect.addEventListener('change', () => {
            addNewBankInput.classList.toggle('hidden', addBankSelect.value !== 'new');
        });

        overlay.addEventListener('click', () => {
            if (editModal.classList.contains('show')) closeEditModal();
            if (addModal.classList.contains('show')) closeAddModal();
            const remarkModal = document.getElementById('remark-modal');
            if (remarkModal && remarkModal.classList.contains('show')) {
                remarkModal.classList.remove('show');
                overlay.classList.remove('show');
            }
            const exportModal = document.getElementById('export-modal');
            if (exportModal && exportModal.classList.contains('show')) {
                exportModal.classList.remove('show');
                overlay.classList.remove('show');
            }
        });
    }

    return { init, onShow: refresh };
})();

/* =========================================
   5. Importer（原 part3）：JSON 匯入
   ========================================= */
const Importer = (function () {
    let currentTab = 'file';
    let pendingData = null;

    let bankSelect, newBankInput, pasteArea, fileInput, fileInfo;

    function switchTab(name) {
        currentTab = name;
        document.querySelectorAll('#page-import .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('#page-import .tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}-content`));
    }

    async function refreshBanks() {
        const banks = await QuizDB.getBanks();
        bankSelect.innerHTML = '<option value="new">+ 建立新題庫</option>';
        banks.forEach(b => {
            const o = document.createElement('option');
            o.value = b;
            o.textContent = b;
            bankSelect.appendChild(o);
        });
        bankSelect.value = 'new';
        newBankInput.classList.remove('hidden');
    }

    function handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target.result);
                if (!Array.isArray(json)) throw new Error('需為陣列');
                pendingData = json;
                fileInfo.textContent = `已選擇：${file.name}（${json.length} 題）`;
                if (bankSelect.value === 'new') {
                    newBankInput.value = file.name.replace(/\.json$/i, '');
                }
            } catch (err) {
                alert('無效的 JSON 檔案：' + err.message);
                fileInput.value = '';
            }
        };
        reader.readAsText(file);
    }

    async function doImport() {
        let data = null;
        if (currentTab === 'file') {
            data = pendingData;
        } else {
            try {
                data = JSON.parse(pasteArea.value);
            } catch {
                return alert('貼上的文字不是有效的 JSON');
            }
        }
        if (!Array.isArray(data) || data.length === 0) {
            return alert('請提供有效的題庫陣列');
        }

        let bank = bankSelect.value;
        if (bank === 'new') {
            bank = newBankInput.value.trim();
            if (!bank) return alert('請輸入新題庫名稱');
        }

        try {
            const count = await QuizDB.addBatch(data, bank);
            alert(`成功匯入「${bank}」共 ${count} 題！`);
            pasteArea.value = '';
            fileInput.value = '';
            newBankInput.value = '';
            fileInfo.textContent = '';
            pendingData = null;
            await refreshBanks();
        } catch (err) {
            alert('匯入失敗：' + err.message);
        }
    }

    function init() {
        bankSelect = document.getElementById('bank-select');
        newBankInput = document.getElementById('new-bank-name');
        pasteArea = document.getElementById('paste-area');
        fileInput = document.getElementById('file-upload');
        fileInfo = document.getElementById('file-info');

        document.querySelectorAll('#page-import .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
        fileInput.addEventListener('change', handleFile);
        document.getElementById('import-btn').addEventListener('click', doImport);
        bankSelect.addEventListener('change', () => {
            newBankInput.classList.toggle('hidden', bankSelect.value !== 'new');
        });
    }

    return { init, onShow: refreshBanks };
})();

/* =========================================
   6. Maint（原 part4）：狀態與維護
   ========================================= */
const Maint = (function () {
    let overlay, exportModal, exportBankSelect, exportOptRemark, exportOptStats, exportJsonTextarea, exportCopyBtn, exportDownloadBtn;

    async function refresh() {
        const all = await QuizDB.getAll();
        document.getElementById('stat-total').textContent = all.length;
        document.getElementById('stat-correct').textContent = all.reduce((s, q) => s + (q.correct || 0), 0);
        document.getElementById('stat-fail').textContent = all.reduce((s, q) => s + (q.fail || 0), 0);

        const bankCount = {};
        all.forEach(q => { bankCount[q.questionBank] = (bankCount[q.questionBank] || 0) + 1; });
        const banks = Object.keys(bankCount);
        document.getElementById('stat-banks').textContent = banks.length;

        const ul = document.getElementById('bank-list');
        ul.innerHTML = '';
        if (banks.length === 0) {
            const li = document.createElement('li');
            li.textContent = '尚無題庫';
            ul.appendChild(li);
            return;
        }
        banks.forEach(b => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${b}</span><b>${bankCount[b]} 題</b>`;
            ul.appendChild(li);
        });
    }

    async function resetFails() {
        if (!confirm('確定要將所有錯題紀錄歸零嗎？題目不會被刪除。')) return;
        await QuizDB.resetAllFails();
        alert('錯題紀錄已歸零。');
        refresh();
    }

    async function clearAll() {
        if (!confirm('⚠️ 確定刪除所有題庫與紀錄嗎？此動作無法復原！')) return;
        if (!confirm('再次確認：所有資料將被清空。')) return;
        await QuizDB.clearAll();
        alert('資料已全部清空。');
        refresh();
    }

    /* ---------- 匯出題庫 ---------- */

    async function openExportModal() {
        const banks = await QuizDB.getBanks();
        if (banks.length === 0) {
            alert('目前資料庫尚無題庫可供匯出，請先匯入或新增題目。');
            return;
        }

        exportBankSelect.innerHTML = '';
        banks.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            exportBankSelect.appendChild(opt);
        });

        exportModal.classList.add('show');
        overlay.classList.add('show');

        await updateExportJson();
    }

    function closeExportModal() {
        exportModal.classList.remove('show');
        overlay.classList.remove('show');
    }

    async function updateExportJson() {
        const selectedBank = exportBankSelect.value;
        if (!selectedBank) {
            exportJsonTextarea.value = '';
            return;
        }

        const includeRemark = exportOptRemark.checked;
        const includeStats = exportOptStats.checked;

        const all = await QuizDB.getAll();
        const bankQuestions = all
            .filter(q => q.questionBank === selectedBank)
            .sort((a, b) => (a.questionNumber || 0) - (b.questionNumber || 0));

        const exportData = bankQuestions.map(q => {
            const item = {
                type: q.type || 'single',
                question: q.question || '',
            };

            if (item.type === 'fill') {
                item.answers = q.answers || [];
            } else {
                item.options = (q.options || []).map(opt => {
                    const cleanOpt = {
                        order: typeof opt.order === 'number' ? opt.order : 0,
                        text: opt.text || ''
                    };
                    if (opt.true) {
                        cleanOpt.true = true;
                    }
                    return cleanOpt;
                });
            }

            if (q.description) {
                item.description = q.description;
            }

            if (includeRemark && q.remark) {
                item.remark = q.remark;
            }

            if (includeStats) {
                const correct = q.correct || 0;
                const fail = q.fail || 0;
                item.attempts = correct + fail;
                item.fail = fail;
                item.correct = correct;
            }

            return item;
        });

        exportJsonTextarea.value = JSON.stringify(exportData, null, 2);
    }

    async function copyToClipboard() {
        const content = exportJsonTextarea.value;
        if (!content) return;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(content);
            } else {
                exportJsonTextarea.select();
                document.execCommand('copy');
            }
            const originalText = exportCopyBtn.textContent;
            exportCopyBtn.textContent = '已複製！';
            setTimeout(() => {
                exportCopyBtn.textContent = originalText;
            }, 1500);
        } catch (err) {
            console.error('複製失敗：', err);
            alert('複製失敗，請手動複製文字框內容。');
        }
    }

    function downloadJsonFile() {
        const content = exportJsonTextarea.value;
        if (!content) return;

        const bankName = exportBankSelect.value || 'quizbank';
        const safeFilename = `${bankName.replace(/[/\\?%*:|"<>]/g, '_')}.json`;

        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function init() {
        overlay = document.getElementById('overlay');
        exportModal = document.getElementById('export-modal');
        exportBankSelect = document.getElementById('export-bank-select');
        exportOptRemark = document.getElementById('export-opt-remark');
        exportOptStats = document.getElementById('export-opt-stats');
        exportJsonTextarea = document.getElementById('export-json-textarea');
        exportCopyBtn = document.getElementById('export-copy-btn');
        exportDownloadBtn = document.getElementById('export-download-btn');

        document.getElementById('btn-reset-fails').addEventListener('click', resetFails);
        document.getElementById('btn-clear-all').addEventListener('click', clearAll);

        const btnOpenExport = document.getElementById('btn-open-export');
        if (btnOpenExport) btnOpenExport.addEventListener('click', openExportModal);

        const btnCloseExport = document.getElementById('export-modal-close');
        if (btnCloseExport) btnCloseExport.addEventListener('click', closeExportModal);

        if (exportBankSelect) exportBankSelect.addEventListener('change', updateExportJson);
        if (exportOptRemark) exportOptRemark.addEventListener('change', updateExportJson);
        if (exportOptStats) exportOptStats.addEventListener('change', updateExportJson);

        if (exportCopyBtn) exportCopyBtn.addEventListener('click', copyToClipboard);
        if (exportDownloadBtn) exportDownloadBtn.addEventListener('click', downloadJsonFile);
    }

    return { init, onShow: refresh };
})();

/* =========================================
   7. Router：單頁換頁
   ========================================= */
const Router = (function () {
    let currentPage = 'quiz';
    const titles = {
        quiz: '開始測驗',
        bank: '題庫管理',
        import: 'JSON 匯入',
        maint: '狀態與維護',
    };
    const parts = { quiz: Quiz, bank: Bank, import: Importer, maint: Maint };

    function show(name) {
        if (!parts[name]) name = 'quiz';
        currentPage = name;

        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const targetView = document.getElementById('page-' + name);
        if (targetView) targetView.classList.remove('hidden');

        document.getElementById('header-title').textContent = titles[name] || '開始測驗';

        const navBack = document.getElementById('nav-back');
        if (navBack) {
            // 只有在測驗作答中才顯示「< 離開」，其他一級模組全部隱藏保持置中
            const isQuizzing = name === 'quiz' && !document.getElementById('view-quiz').classList.contains('hidden');
            navBack.classList.toggle('invisible', !isQuizzing);
            navBack.textContent = '< 離開';
        }

        document.querySelector('main').classList.toggle('quiz-active', name === 'quiz');
        if (name !== 'quiz') {
            document.getElementById('bottom-bar').classList.remove('show');
        } else {
            const isQuizzing = !document.getElementById('view-quiz').classList.contains('hidden');
            document.getElementById('bottom-bar').classList.toggle('show', isQuizzing);
        }

        // 更新抽屜內項目的 active 狀態
        document.querySelectorAll('.drawer-item').forEach(item => {
            item.classList.toggle('active', item.dataset.nav === name);
        });

        const part = parts[name];
        if (part && part.onShow) part.onShow();
    }

    function getCurrent() {
        return currentPage;
    }

    return { show, getCurrent };
})();

/* =========================================
   啟動
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    await QuizDB.init();

    Home.init();
    Quiz.init();
    Bank.init();
    Importer.init();
    Maint.init();

    // 抽屜選單元素
    const drawer = document.getElementById('drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const menuBtn = document.getElementById('menu-btn');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');

    function openDrawer() {
        if (drawer) drawer.classList.add('open');
        if (drawerOverlay) drawerOverlay.classList.add('open');
        Home.updateStatus();
    }

    function closeDrawer() {
        if (drawer) drawer.classList.remove('open');
        if (drawerOverlay) drawerOverlay.classList.remove('open');
    }

    if (menuBtn) menuBtn.addEventListener('click', openDrawer);
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

    // ESC 鍵關閉抽屜
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) {
            closeDrawer();
        }
    });

    document.getElementById('nav-back').addEventListener('click', () => {
        if (Router.getCurrent() === 'quiz' && !document.getElementById('view-quiz').classList.contains('hidden')) {
            Quiz.resetToConfig();
        }
    });

    document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', () => {
            closeDrawer();
            Router.show(el.dataset.nav);
        });
    });

    // 預設進入「開始測驗」頁
    Router.show('quiz');
});
