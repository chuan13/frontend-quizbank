/* =========================================
   共用 IndexedDB 資料層 (window.QuizDB)
   四個 part 都必須先呼叫 QuizDB.init()
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
