/* =========================================
   Part 3: JSON 匯入
   ========================================= */

let currentTab = 'file';
let pendingData = null;

const bankSelect = document.getElementById('bank-select');
const newBankInput = document.getElementById('new-bank-name');
const pasteArea = document.getElementById('paste-area');
const fileInput = document.getElementById('file-upload');
const fileInfo = document.getElementById('file-info');

function switchTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}-content`));
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
            if (bankSelect.value === 'new' && !newBankInput.value) {
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
        fileInfo.textContent = '';
        pendingData = null;
        await refreshBanks();
    } catch (err) {
        alert('匯入失敗：' + err.message);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await QuizDB.init();
    await refreshBanks();

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    fileInput.addEventListener('change', handleFile);
    document.getElementById('import-btn').addEventListener('click', doImport);
    bankSelect.addEventListener('change', () => {
        newBankInput.classList.toggle('hidden', bankSelect.value !== 'new');
    });
});
