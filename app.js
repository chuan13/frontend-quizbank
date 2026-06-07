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
   KaTeX 渲染輔助函式
   ========================================================================= */

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
        async add({ questionBank, question, options, description = '', questionNumber = null }) {
            const num = questionNumber ?? await this.nextQuestionNumber(questionBank);
            return p(store('readwrite').add({
                questionBank,
                questionNumber: num,
                type: 'single',
                correct: 0,
                fail: 0,
                question,
                options,
                description,
            }));
        },

        // 批次匯入到指定題庫，自動接續題號
        async addBatch(items, bank) {
            const all = await this.getAll();
            let maxNum = all.filter(q => q.questionBank === bank).length;
            return new Promise((resolve, reject) => {
                const t = db.transaction(['questions'], 'readwrite');
                const s = t.objectStore('questions');
                items.forEach(it => {
                    maxNum++;
                    s.add({
                        questionBank: bank,
                        questionNumber: maxNum,
                        type: 'single',
                        correct: 0,
                        fail: 0,
                        question: it.question,
                        options: it.options,
                        description: it.description,
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
   2. Home：首頁資料庫狀態
   ========================================= */
const Home = (function () {
    async function onShow() {
        const all = await QuizDB.getAll();
        const banks = [...new Set(all.map(q => q.questionBank))];
        const el = document.getElementById('db-status');
        if (all.length === 0) {
            el.textContent = '目前資料庫為空，可從「JSON 匯入」開始。';
        } else {
            el.innerHTML = `目前共 <b>${all.length}</b> 題，分布於 <b>${banks.length}</b> 個題庫。`;
        }
    }
    return { init() { }, onShow };
})();

/* =========================================
   3. Quiz（原 part1）：測驗
   ========================================= */
const Quiz = (function () {
    let quizQueue = [];
    let currentQ = null;
    let selectedOptionData = null;
    let isAnswerSubmitted = false;

    function shuffle(array) {
        let i = array.length, r;
        while (i > 0) {
            r = Math.floor(Math.random() * i);
            i--;
            [array[i], array[r]] = [array[r], array[i]];
        }
        return array;
    }

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
        const select = document.getElementById('config-bank-select');
        select.innerHTML = '';
        banks.forEach(bank => {
            const opt = document.createElement('option');
            opt.value = bank;
            opt.textContent = bank;
            select.appendChild(opt);
        });
    }

    // 回到出題設定畫面（取代原本的 location.reload）
    function resetToConfig() {
        document.getElementById('view-quiz').classList.add('hidden');
        document.getElementById('view-config').classList.remove('hidden');
        document.getElementById('bottom-bar').classList.remove('show');
        quizQueue = [];
        currentQ = null;
    }

    async function startQuiz() {
        let questions = await QuizDB.getAll();
        const scope = document.getElementById('config-scope').value;
        const bankName = document.getElementById('config-bank-select').value;
        const mode = document.getElementById('config-mode').value;

        if (scope === 'bank' && bankName) {
            questions = questions.filter(q => q.questionBank === bankName);
        }
        if (questions.length === 0) {
            alert('選擇的範圍內沒有題目！');
            return;
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
        } else {
            quizQueue = shuffle([...questions]);
        }

        document.getElementById('view-config').classList.add('hidden');
        document.getElementById('view-quiz').classList.remove('hidden');
        document.getElementById('bottom-bar').classList.add('show');
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

        document.getElementById('quiz-bank-name').textContent = `題庫：${currentQ.questionBank}`;
        document.getElementById('quiz-progress').textContent = `題號：${currentQ.questionNumber}`;
        document.getElementById('quiz-stats-count').textContent = `次數：${currentQ.correct + currentQ.fail}`;
        
        const qEl = document.getElementById('question-text');
        qEl.textContent = currentQ.question;
        renderMath(qEl);
        
        document.getElementById('feedback-box').classList.remove('show');

        const btn = document.getElementById('confirm-btn');
        btn.textContent = '請先選擇選項';
        btn.disabled = true;
        btn.classList.remove('next-mode');

        let opts = [...currentQ.options];
        if (opts.every(o => o.order === 0)) opts = shuffle(opts);
        else opts.sort((a, b) => a.order - b.order);

        const container = document.getElementById('options-container');
        container.innerHTML = '';
        opts.forEach(option => {
            const optBtn = document.createElement('button');
            optBtn.className = 'option-btn';
            optBtn.textContent = option.text;
            /** @type {any} */ (optBtn)._optionData = option; // 為了在 JS 中暫存選項資料
            optBtn.onclick = () => selectOption(optBtn, option);
            container.appendChild(optBtn);
            renderMath(optBtn);
        });
    }

    function selectOption(btnEl, data) {
        if (isAnswerSubmitted) return;
        document.querySelectorAll('.option-btn').forEach(el => el.classList.remove('selected'));
        btnEl.classList.add('selected');
        selectedOptionData = data;
        const cb = document.getElementById('confirm-btn');
        cb.textContent = '確認送出';
        cb.disabled = false;
    }

    async function handleConfirm() {
        const cb = document.getElementById('confirm-btn');
        if (!isAnswerSubmitted) {
            isAnswerSubmitted = true;
            const isCorrect = selectedOptionData.true === true;
            await QuizDB.updateStats(currentQ.id, isCorrect);

            document.querySelectorAll('.option-btn').forEach(btn => {
                btn.disabled = true;
                const od = /** @type {any} */ (btn)._optionData;
                if (od && od.true === true) btn.classList.add('correct');
            });
            if (!isCorrect) {
                const sel = document.querySelector('.option-btn.selected');
                if (sel) sel.classList.add('wrong');
            }

            const ft = document.getElementById('feedback-title');
            if (isCorrect) {
                ft.textContent = '✅ 答對了！';
                ft.className = 'feedback-title success';
            } else {
                ft.textContent = '❌ 答錯了！';
                ft.className = 'feedback-title error';
            }
            
            const fdEl = document.getElementById('feedback-desc');
            fdEl.textContent = currentQ.description || '無詳解';
            renderMath(fdEl);
            
            document.getElementById('feedback-box').classList.add('show');

            cb.textContent = '下一題';
            cb.classList.add('next-mode');
        } else {
            loadNextQuestion();
        }
    }

    function init() {
        document.getElementById('config-scope').addEventListener('change', e => {
            document.getElementById('config-bank-wrapper').classList.toggle('hidden', e.target.value !== 'bank');
        });
        document.getElementById('start-btn').addEventListener('click', startQuiz);
        document.getElementById('confirm-btn').addEventListener('click', handleConfirm);
    }

    // 每次進入測驗頁：回到設定畫面並重新整理題庫清單
    async function onShow() {
        resetToConfig();
        await refreshConfigUI();
    }

    return { init, onShow };
})();

/* =========================================
   4. Bank（原 part2）：題庫管理
   ========================================= */
const Bank = (function () {
    let allRecords = [];
    let editingId = null;

    let overlay, editModal, addModal, addBankSelect, addNewBankInput, addOptionsList;

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
            div.innerHTML = `
                <div class="record-info">
                    <span class="bank-tag">${q.questionBank}</span>
                    <span>第 ${q.questionNumber} 題</span>
                    <span class="preview">${preview}</span>
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
        const opts = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}${o.true ? ' (正確答案)' : ''}`).join('\n');
        const text = `題庫：${q.questionBank}\n第 ${q.questionNumber} 題\n題目：${q.question}\n選項：\n${opts}\n說明：${q.description || '無'}`;
        navigator.clipboard.writeText(text).then(() => alert('題目已複製到剪貼簿！'));
    }

    /* ---------- 編輯 Modal ---------- */

    function openEditModal(q) {
        editingId = q.id;
        document.getElementById('edit-question-text').value = q.question;
        document.getElementById('edit-description').value = q.description || '';
        const list = document.getElementById('edit-options-list');
        list.innerHTML = '';
        q.options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'option-edit-item';
            item.innerHTML = `
                <input type="checkbox" class="edit-opt-correct" ${opt.true ? 'checked' : ''}>
                <input type="text" class="edit-opt-text" value="${escapeAttr(opt.text)}">
            `;
            list.appendChild(item);
        });
        editModal.classList.add('show');
        overlay.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
        if (!addModal.classList.contains('show')) overlay.classList.remove('show');
    }

    async function saveEdit() {
        if (editingId === null) return;
        const question = document.getElementById('edit-question-text').value.trim();
        if (!question) return alert('題目不能為空');

        const items = document.querySelectorAll('#edit-options-list .option-edit-item');
        const options = [];
        let hasCorrect = false;
        items.forEach((it, idx) => {
            const text = it.querySelector('.edit-opt-text').value.trim();
            const isTrue = it.querySelector('.edit-opt-correct').checked;
            if (text) {
                const o = { order: idx + 1, text };
                if (isTrue) { o.true = true; hasCorrect = true; }
                options.push(o);
            }
        });
        if (options.length < 2) return alert('至少需要兩個選項');
        if (!hasCorrect) return alert('請至少勾選一個正確答案');

        await QuizDB.update(editingId, {
            question,
            options,
            description: document.getElementById('edit-description').value.trim(),
        });
        alert('修改成功！');
        closeEditModal();
        refresh();
    }

    /* ---------- 新增 Modal ---------- */

    function buildOptionRow({ text = '', isTrue = false, order = 0 } = {}) {
        const item = document.createElement('div');
        item.className = 'option-edit-item';
        item.innerHTML = `
            <input type="checkbox" class="add-opt-correct" ${isTrue ? 'checked' : ''} title="正確答案">
            <input type="text" class="add-opt-text" placeholder="選項內容" value="${escapeAttr(text)}">
            <input type="number" class="add-opt-order" value="${order}" min="0" title="order">
            <button type="button" class="opt-remove" title="刪除選項">✕</button>
        `;
        item.querySelector('.opt-remove').onclick = () => {
            if (addOptionsList.children.length <= 2) return alert('至少需保留兩個選項');
            item.remove();
        };
        addOptionsList.appendChild(item);
    }

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
        document.getElementById('add-question-text').value = '';
        document.getElementById('add-description').value = '';
        addOptionsList.innerHTML = '';
        [0, 1, 2, 3].forEach(() => buildOptionRow());

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

        const rows = addOptionsList.querySelectorAll('.option-edit-item');
        const options = [];
        let hasCorrect = false;
        rows.forEach(r => {
            const text = r.querySelector('.add-opt-text').value.trim();
            if (!text) return;
            const isTrue = r.querySelector('.add-opt-correct').checked;
            const order = parseInt(r.querySelector('.add-opt-order').value, 10) || 0;
            const o = { order, text };
            if (isTrue) { o.true = true; hasCorrect = true; }
            options.push(o);
        });
        if (options.length < 2) return alert('至少需要兩個選項');
        if (!hasCorrect) return alert('請至少勾選一個正確答案');

        await QuizDB.add({
            questionBank: bank,
            question,
            options,
            description: document.getElementById('add-description').value.trim(),
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
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ---------- 初始化 ---------- */

    function init() {
        overlay = document.getElementById('overlay');
        editModal = document.getElementById('edit-modal');
        addModal = document.getElementById('add-modal');
        addBankSelect = document.getElementById('add-bank-select');
        addNewBankInput = document.getElementById('add-new-bank-name');
        addOptionsList = document.getElementById('add-options-list');

        document.getElementById('record-bank-filter').addEventListener('change', render);
        document.getElementById('record-sort-filter').addEventListener('change', render);

        document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
        document.getElementById('edit-save').addEventListener('click', saveEdit);

        document.getElementById('add-cancel').addEventListener('click', closeAddModal);
        document.getElementById('add-save').addEventListener('click', saveNew);
        document.getElementById('add-option-btn').addEventListener('click', () => buildOptionRow());
        addBankSelect.addEventListener('change', () => {
            addNewBankInput.classList.toggle('hidden', addBankSelect.value !== 'new');
        });

        overlay.addEventListener('click', () => {
            if (editModal.classList.contains('show')) closeEditModal();
            if (addModal.classList.contains('show')) closeAddModal();
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

    function init() {
        document.getElementById('btn-reset-fails').addEventListener('click', resetFails);
        document.getElementById('btn-clear-all').addEventListener('click', clearAll);
    }

    return { init, onShow: refresh };
})();

/* =========================================
   7. Router：單頁換頁
   ========================================= */
const Router = (function () {
    const titles = {
        home: 'Frontend Quizbank',
        quiz: '測驗',
        bank: '題庫管理',
        import: 'JSON 匯入',
        maint: '狀態與維護',
    };
    const parts = { home: Home, quiz: Quiz, bank: Bank, import: Importer, maint: Maint };

    function show(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById('page-' + name).classList.remove('hidden');
        document.getElementById('header-title').textContent = titles[name];
        document.getElementById('nav-back').classList.toggle('invisible', name === 'home');
        document.querySelector('main').classList.toggle('quiz-active', name === 'quiz');
        if (name !== 'quiz') document.getElementById('bottom-bar').classList.remove('show');

        const part = parts[name];
        if (part && part.onShow) part.onShow();
    }

    return { show };
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

    document.getElementById('nav-back').addEventListener('click', () => Router.show('home'));
    document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', () => Router.show(el.dataset.nav));
    });

    Router.show('home');
});
