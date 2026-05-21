/* =========================================
   Part 1: 測驗
   ========================================= */

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
        location.reload();
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
        optBtn.onclick = () => selectOption(optBtn, option);
        container.appendChild(optBtn);
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
            const od = currentQ.options.find(o => o.text === btn.textContent);
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
        document.getElementById('feedback-desc').textContent = currentQ.description || '無詳解';
        document.getElementById('feedback-box').classList.add('show');

        cb.textContent = '下一題';
        cb.classList.add('next-mode');
    } else {
        loadNextQuestion();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await QuizDB.init();
    await refreshConfigUI();

    document.getElementById('config-scope').addEventListener('change', e => {
        document.getElementById('config-bank-wrapper').classList.toggle('hidden', e.target.value !== 'bank');
    });
    document.getElementById('start-btn').addEventListener('click', startQuiz);
    document.getElementById('confirm-btn').addEventListener('click', handleConfirm);
});
