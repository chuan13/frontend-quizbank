/* =========================================
   Part 4: 狀態與維護
   ========================================= */

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

document.addEventListener('DOMContentLoaded', async () => {
    await QuizDB.init();
    await refresh();
    document.getElementById('btn-reset-fails').addEventListener('click', resetFails);
    document.getElementById('btn-clear-all').addEventListener('click', clearAll);
});
