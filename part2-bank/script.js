/* =========================================
   Part 2: 題庫管理（查看 / 編輯 / UI 新增題目）
   ========================================= */

let allRecords = [];
let editingId = null;

const overlay = document.getElementById('overlay');
const editModal = document.getElementById('edit-modal');
const addModal = document.getElementById('add-modal');

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

const addBankSelect = document.getElementById('add-bank-select');
const addNewBankInput = document.getElementById('add-new-bank-name');
const addOptionsList = document.getElementById('add-options-list');

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

document.addEventListener('DOMContentLoaded', async () => {
    await QuizDB.init();
    await refresh();

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
});
