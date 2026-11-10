// 127.0.0.1 に立てたにせ窓口（tools/mock-server.mjs）だけを相手に窓口との通信を確かめ、全部通れば文言を godot/tests/fixtures/server_texts.json に書き出します（node tools/check-server.cjs・本番の窓口には決してつなぎません）。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { loadWebEngine, makeStub, ROOT } = require('./load-web-engine.cjs');

const MOCK_SCRIPT = path.join(ROOT, 'tools', 'mock-server.mjs');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const TEXTS_PATH = path.join(ROOT, 'godot', 'tests', 'fixtures', 'server_texts.json');
const TEXTS_VERSION = 2;
const BOARD = 'gc01_gelpiyo-territory';
const APP_VERSION = 'gelpiyo-territory-web';
const CLIENT_TIMEOUT_MS = 800;
const SHORT_TIMEOUT_MS = 300;
const MOCK_START_TIMEOUT_MS = 15000;
const WAIT_TIMEOUT_MS = 8000;
const POLL_MS = 10;
const SETTLE_MS = 150;
const TIMEOUT_MARGIN_MS = 500;
const BACKUP_RETRY_MS = 60000;
const SAVE_LIMIT_BYTES = 512 * 1024;
const TOP_LIMIT = 100;
const HTTP_OK = 200;
const MS_PER_SEC = 1000;
const HOUR_MS = 3600000;
const EVENT_DAYS_MS = 30 * 24 * HOUR_MS;
const RANK_LIMIT_SEC = 3600;
const NORMAL_WEIGHT = 2;
const WON_TOTAL = 2;
const FIRST_PLAY_MS = 754000;
const SLOWER_PLAY_MS = 1500000;
const FASTER_PLAY_MS = 100000;
const HIGH_RECOVER_LIMIT = 100;
const LONG_MIN_SEC = 3600;
// tools/mock-server.mjs の DEFAULT_BOARD と同じ値
const MOCK_DEFAULT_MAX_VALUE = 5000000;
const MOCK_GRACE_SEC = 600;
const EVENT_END_IN_SEC = 5;
const WIDE_CHAR_BYTES = 3;
const PIYO_PAD_COUNT = 10;
const FIRST = 1;
const PIYO = '\u{1F424}';
const PLAYER_ID_PATTERN = /^p[0-9a-z]{19}$/;
const RUN_ID_PATTERN = /^r[0-9a-z]{19}$/;
const CODE_PATTERN = /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/;
const PAST_EVENT = { eventStart: '2020-01-01T00:00:00.000Z', eventEnd: '2020-01-02T00:00:00.000Z' };
const NO_TICKET = { runId: null, startedAt: null, error: null };
const AI_GAME = "gameConfig = { opponent: 'ai', humanColor: FIRST, boardSize: 9, eventMapIndex: 0, aiLevel: 'normal', showGuide: true }";
const HUMAN_GAME = "gameConfig = { opponent: 'human', humanColor: FIRST, boardSize: 9, eventMapIndex: 0, aiLevel: 'normal', showGuide: true }";

// 製品のコードとは別にここにも写して、完全一致を確かめます。
const EXPECTED_TEXTS = {
    'gate.text': 'ランキングに参加するには、名前を決めてから始めてください。決めずに始めることもできます（その対局はランキングに送りません）。',
    'gate.back': '戻る',
    'gate.skip': '決めずに始める',
    'account.sending': 'サーバーに送っています…',
    'account.registered': '登録しました。引き継ぎコードを控えておいてください。',
    'account.syncFailed': '名前はこの端末に保存しました。サーバーには届かなかったため、あとでもう一度送ります（{reason}）。',
    'code.heading': '引き継ぎコード',
    'code.none': '（ありません）',
    'code.help': '機種変更やアプリの入れ直しのときに、このコードで記録を引き継げます。控えておいてください。',
    'code.copy': 'コピー',
    'code.copied': 'コピーしました。',
    'code.copyFailed': 'コピーできませんでした。コードを書き写してください。',
    'code.reissue': '出し直す',
    'code.reissueWarn': '出し直すと、今のコードは使えなくなります。',
    'code.reissueConfirm': '出し直す（確定）',
    'code.reissued': '新しいコードにしました。控えておいてください。',
    'code.reissueFailed': '出し直せませんでした（{reason}）。',
    'code.reissueUnknown': '出し直せたか確かめられませんでした（{reason}）。今のコードは使えなくなっているかもしれません。もう一度「出し直す」を押して、新しいコードを控えてください。',
    'recover.heading': 'ほかの端末から引き継ぐ',
    'recover.help': 'ゲルぴよ陣取りで控えた引き継ぎコードを入れてください。引き継ぐと、前の端末ではランキングに参加できなくなります。この端末の対局の記録・中断中の対局・テーマは、引き継いだ控えで置き換わります。',
    'recover.placeholder': 'XXXX-XXXX-XXXX',
    'recover.button': '引き継ぐ',
    'recover.confirmText': '本当に引き継ぎますか？',
    'recover.confirm': '引き継ぐ（確定）',
    'recover.done': '引き継ぎました。',
    'recover.doneNoSave': '引き継ぎました（控えはありませんでした）。',
    'recover.suspendedDropped': '別の機種で中断した対局は引き継げませんでした。',
    'recover.otherApp': 'このコードは、ゲルぴよ陣取りのものではありません。',
    'recover.failed': '引き継げませんでした（{reason}）。',
    'result.noName': '名前を決めると、次の対局からランキングに参加できます。',
    'result.noTicket': '対局を始めたときにサーバーにつながらなかったため、ランキングに送れません。',
    'result.notOpen': 'ランキングの開催期間外のため、送れません。',
    'result.sending': 'ランキングに送っています…',
    'result.improved': 'ランキングに送りました。自己ベストを更新しました（{rank}位／{participants}人中）。',
    'result.sent': 'ランキングに送りました（自己ベスト {best}・{rank}位／{participants}人中）。',
    'result.sentPlain': 'ランキングに送りました。',
    'result.failed': 'ランキングに送れませんでした（{reason}）。',
    'result.failedRetry': 'ランキングに送れませんでした（{reason}）。次にランキングを開いたときか、次のAI戦を始めたときに、もう一度送ります。',
    'ranking.loading': '読み込んでいます…',
    'ranking.loadFailed': '順位表を読み込めませんでした（{reason}）。',
    'ranking.myBest': '自己ベスト {best}（{rank}位／{participants}人中）',
    'ranking.myNone': 'まだ記録がありません。AIとの対局に勝つと記録されます。',
    'ranking.unregistered': 'サーバーにまだ登録されていません。',
    'reason.offline': 'サーバーにつながりませんでした',
    'reason.network': 'サーバーにつながりませんでした',
    'reason.timeout': 'サーバーから返事がありませんでした',
    'reason.badName': '名前を受け付けてもらえませんでした',
    'reason.badKey': 'この端末の登録が使えなくなっています（別の端末で引き継いだ可能性があります）',
    'reason.notOpen': 'ランキングの開催期間外です',
    'reason.closed': '受け付けの期間が終わっています',
    'reason.tooShort': '対局が短すぎます',
    'reason.tooLong': '対局を始めてから時間がたちすぎています',
    'reason.tooHigh': '点が上限を超えています',
    'reason.alreadyDone': 'この対局はもう送ってあります',
    'reason.noRun': 'この対局の札が見つかりません',
    'reason.badCode': '引き継ぎコードが正しくありません',
    'reason.codeNotFound': 'この引き継ぎコードは見つかりませんでした',
    'reason.tooMany': '試した回数が多すぎます。しばらく待ってからもう一度お試しください',
    'reason.other': 'サーバーで問題が起きました：{error}'
};
const REASON_KEYS = {
    offline: 'reason.offline', network: 'reason.network', timeout: 'reason.timeout', bad_name: 'reason.badName',
    no_key: 'reason.badKey', bad_key: 'reason.badKey', no_player: 'reason.badKey', not_open: 'reason.notOpen',
    closed: 'reason.closed', too_short: 'reason.tooShort', too_long: 'reason.tooLong', too_high: 'reason.tooHigh',
    already_done: 'reason.alreadyDone', no_run: 'reason.noRun', bad_code: 'reason.badCode',
    code_not_found: 'reason.codeNotFound', too_many: 'reason.tooMany'
};
const HTML_TEXTS = [
    ['account-gate-text', 'gate.text'], ['account-gate-back-button', 'gate.back'], ['account-gate-skip-button', 'gate.skip'],
    ['account-code-heading', 'code.heading'], ['account-code-value', 'code.none'], ['account-code-help', 'code.help'],
    ['account-code-copy-button', 'code.copy'], ['account-code-reissue-button', 'code.reissue'],
    ['recover-heading', 'recover.heading'], ['recover-help', 'recover.help'], ['recover-button', 'recover.button']
];
const SNAPSHOT_MESSAGES = {
    newer: '新しい版の控えのため、読み込めません。アプリを更新してください。',
    badShape: '控えの形が正しくないため、読み込めません。',
    restoreFailed: 'この端末に控えを書き込めませんでした。'
};
const ACCOUNT_SAVE_FAILED = 'この端末に名前を保存できませんでした。';

const failures = [];
const secrets = new Set();
const allLogs = [];
const harness = { mock: null };
let passedCount = 0;
async function check(label, body) {
    try {
        await body();
        passedCount += 1;
    } catch (error) {
        failures.push(`${label}: ${describe(error)}`);
    } finally {
        await clearInjectedFailures();
    }
}
// 製品が送るはずの要求を送らなかったとき、仕込んだ失敗が次の確かめに持ち越されないようにします。
async function clearInjectedFailures() {
    try {
        if (harness.mock !== null)
            await harness.mock.fail({ count: 0, mode: 'status' });
    } catch (error) {
        failures.push(`にせ窓口の失敗の仕込みを消せませんでした: ${describe(error)}`);
    }
}
async function group(label, body) {
    try {
        await body();
    } catch (error) {
        failures.push(`${label}（準備）: ${describe(error)}`);
    }
}
function describe(value) {
    return value && typeof value === 'object' && 'message' in value ? `${value.message}` : String(value);
}
// vm の中で作られたオブジェクトは原型が別なので、JSON で通常のオブジェクトに直してから比べます。
function plain(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function same(actual, expected, ...message) {
    assert.deepStrictEqual(plain(actual), plain(expected), ...message.filter(text => text !== undefined));
}
// 鍵と引き継ぎコードは、失敗の文やログに出さないよう覚えておいて伏せます。
function remember(...values) {
    values.filter(value => typeof value === 'string' && value !== '').forEach(value => {
        secrets.add(value);
        secrets.add(value.replace(/-/g, ''));
    });
}
function redact(text) {
    return [...secrets].reduce((out, secret) => out.split(secret).join('＜伏せ字＞'), String(text));
}
function T(key, params = {}) {
    return EXPECTED_TEXTS[key].replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}
function reasonOf(error) {
    return error in REASON_KEYS ? EXPECTED_TEXTS[REASON_KEYS[error]] : T('reason.other', { error });
}
function points(value) {
    return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}点`;
}
function rankedNote(value) {
    return `ランキングの対象です（ランキング点 ${points(value)}）。`;
}
function wonValue(playMs) {
    return WON_TOTAL * (RANK_LIMIT_SEC - Math.round(playMs / MS_PER_SEC)) * NORMAL_WEIGHT;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => delay(SETTLE_MS);
async function waitFor(label, predicate, deadline = Date.now() + WAIT_TIMEOUT_MS) {
    const value = await predicate();
    if (value)
        return value;
    if (Date.now() > deadline)
        throw new Error(`${label} を ${WAIT_TIMEOUT_MS}ms 待っても満たされませんでした`);
    await delay(POLL_MS);
    return waitFor(label, predicate, deadline);
}

function relayMockErrors(child) {
    const errors = { text: '' };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
        errors.text += chunk;
        process.stderr.write(redact(chunk));
    });
    return errors;
}
function startMock() {
    const child = spawn(process.execPath, [MOCK_SCRIPT, '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    process.on('exit', () => child.kill());
    const errors = relayMockErrors(child);
    return new Promise((resolve, reject) => {
        const output = { text: '' };
        const timer = setTimeout(() => reject(new Error(`にせ窓口が ${MOCK_START_TIMEOUT_MS}ms 以内に LISTEN を出しませんでした（${MOCK_SCRIPT}）`)), MOCK_START_TIMEOUT_MS);
        const fail = error => { clearTimeout(timer); reject(error); };
        child.stdout.on('data', chunk => {
            output.text += chunk;
            const match = /LISTEN (\d+)/.exec(output.text);
            if (!match)
                return;
            clearTimeout(timer);
            resolve({ child, port: Number(match[1]) });
        });
        child.on('error', error => fail(new Error(`にせ窓口を起動できませんでした（${MOCK_SCRIPT}）: ${error.message}`)));
        child.once('close', code => fail(new Error(`にせ窓口が起動前に終わりました（終了コード ${code}・${MOCK_SCRIPT}）: ${redact(errors.text.trim())}`)));
    });
}
async function mockCall(base, method, pathname, body, key) {
    const headers = {};
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    if (key !== undefined)
        headers.Authorization = `Bearer ${key}`;
    const response = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}
function makeMockClient(port) {
    const base = `http://127.0.0.1:${port}`;
    const call = (...args) => mockCall(base, ...args);
    return {
        base,
        reset: () => call('POST', '/_test/reset', {}),
        config: settings => call('POST', '/_test/config', settings),
        fail: failure => call('POST', '/_test/fail', failure),
        clock: advanceSec => call('POST', '/_test/clock', { advanceSec }),
        rows: rows => call('POST', '/_test/rows', { rows }),
        state: async () => (await call('GET', '/_test/state')).body,
        saveOf: async key => (await call('GET', '/v1/save', undefined, key)).body
    };
}
async function requestCount(mock) {
    return (await mock.state()).requests;
}
async function expectNoRequests(mock, before) {
    await settle();
    assert.strictEqual(await requestCount(mock), before, '窓口へ送ってしまった');
}
async function waitForRequests(mock, count) {
    return waitFor(`窓口への要求 ${count} 件`, async () => (await requestCount(mock)) >= count);
}
async function waitForSave(mock, playerId) {
    await waitFor('控えが届くこと', async () => (await mock.state()).saves[playerId]);
    await settle();
}
async function openEvent(mock) {
    await mock.config({ eventStart: new Date(Date.now() - HOUR_MS).toISOString(), eventEnd: new Date(Date.now() + EVENT_DAYS_MS).toISOString() });
}

const STUB = makeStub();
function symbolValue(key) {
    if (key === Symbol.toPrimitive)
        return () => '';
    return key === Symbol.iterator ? function* () {} : undefined;
}
function makeClassList(state) {
    return {
        add: (...names) => names.forEach(name => state.classes.add(name)),
        remove: (...names) => names.forEach(name => state.classes.delete(name)),
        toggle: (name, force) => {
            const on = force === undefined ? !state.classes.has(name) : Boolean(force);
            if (on)
                state.classes.add(name);
            else
                state.classes.delete(name);
            return on;
        },
        contains: name => state.classes.has(name)
    };
}
function treeMethods(state) {
    return {
        appendChild: child => {
            state.children.push(child);
            return child;
        },
        append: (...children) => state.children.push(...children),
        replaceChildren: (...children) => {
            state.children = children;
        },
        querySelector: selector => (selector in state.queries ? state.queries[selector] : STUB),
        querySelectorAll: () => [],
        contains: () => false,
        closest: () => null,
        remove() {}
    };
}
function elementMethods(state) {
    return {
        ...treeMethods(state),
        classList: makeClassList(state),
        style: STUB,
        addEventListener: (type, listener) => {
            state.listeners[type] = [...(state.listeners[type] || []), listener];
        },
        removeEventListener() {},
        setAttribute: (name, value) => {
            state.attributes[name] = String(value);
        },
        getBoundingClientRect: () => ({ width: 0, height: 0 }),
        focus() {}
    };
}
function makeElement(tag) {
    const state = { tag, textContent: '', hidden: false, disabled: false, value: '', className: '', children: [], listeners: {}, attributes: {}, dataset: {}, classes: new Set(), queries: {} };
    const methods = elementMethods(state);
    return new Proxy(state, {
        get(target, key) {
            if (typeof key === 'symbol')
                return symbolValue(key);
            if (key === 'then')
                return undefined;
            if (Object.prototype.hasOwnProperty.call(methods, key))
                return methods[key];
            return key in target ? target[key] : STUB;
        },
        set(target, key, value) {
            target[key] = value;
            return true;
        }
    });
}
function makeFakeDocument() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id))
            elements.set(id, makeElement(id));
        return elements.get(id);
    };
    return {
        element,
        getElementById: element,
        querySelector: selector => element(`query:${selector}`),
        querySelectorAll: () => [],
        createElement: tag => makeElement(tag),
        createDocumentFragment: () => makeElement('#fragment'),
        documentElement: makeElement('html'),
        addEventListener() {}
    };
}

function unrefTimeout(callback, ms) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return timer;
}
const realTimer = { set: (callback, ms) => unrefTimeout(callback, ms), clear: id => clearTimeout(id) };
function capturingConsole(logs) {
    const record = level => (...args) => logs.push(`${level}: ${args.map(arg => (arg && typeof arg === 'object' && 'stack' in arg ? arg.stack : String(arg))).join(' ')}`);
    return { log: record('log'), info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') };
}
function wrapEngine(engine, doc, logs, mockBase) {
    return { ...engine, doc, logs, mockBase, storage: engine.context.localStorage, account: engine.context.GelpiyoAccount, online: engine.run('online') };
}
function makeEngine(mock, options = {}) {
    const doc = makeFakeDocument();
    const logs = [];
    allLogs.push(logs);
    const engine = loadWebEngine({
        document: doc,
        serverConfig: { baseUrl: mock.base, board: BOARD, timeoutMs: options.timeoutMs || CLIENT_TIMEOUT_MS },
        globals: { fetch, AbortController, setTimeout: unrefTimeout, clearTimeout, console: capturingConsole(logs) }
    });
    return wrapEngine(engine, doc, logs, mock.base);
}
// fetch を渡さないので、本番の設定のまま読み込んでも送らずに offline になる。
function makeOfflineEngine() {
    const doc = makeFakeDocument();
    const logs = [];
    allLogs.push(logs);
    const engine = loadWebEngine({ document: doc, globals: { setTimeout: unrefTimeout, clearTimeout, console: capturingConsole(logs) } });
    return wrapEngine(engine, doc, logs, null);
}
function makeApi(engine, settings = {}) {
    const config = { baseUrl: engine.mockBase, board: BOARD, timeoutMs: CLIENT_TIMEOUT_MS, ...settings };
    return engine.context.GelpiyoServer.create(config, { timer: realTimer });
}
function makeFakeTimer() {
    const pending = new Map();
    const counter = { next: 1 };
    return {
        pending,
        set: (callback, ms) => {
            const id = counter.next;
            counter.next += 1;
            pending.set(id, { callback, ms });
            return id;
        },
        clear: id => pending.delete(id),
        fireAll: () => [...pending.entries()].forEach(([id, entry]) => {
            pending.delete(id);
            entry.callback();
        })
    };
}
function makeDirectOnline(engine, overrides = {}) {
    const timer = makeFakeTimer();
    const online = engine.context.GelpiyoOnline.create({
        api: overrides.api || makeApi(engine),
        account: engine.account,
        snapshot: overrides.snapshot || { collect: () => engine.context.collectSaveSnapshot(), restore: snapshot => engine.context.restoreSaveSnapshot(snapshot) },
        platform: 'web',
        timer
    });
    return { online, timer };
}
function useFakeFetch(engine, respond) {
    const calls = [];
    const original = engine.context.fetch;
    engine.context.fetch = async (url, init) => {
        calls.push({ url, method: init.method, headers: { ...init.headers }, body: init.body, hasSignal: init.signal !== undefined });
        return respond(url, init);
    };
    return { calls, restore: () => { engine.context.fetch = original; } };
}
function fakeResponse(status, bodyText) {
    return { status, text: async () => bodyText };
}
function recordSentNames(engine) {
    const names = [];
    const original = engine.context.fetch;
    engine.context.fetch = (url, init) => {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
        if (typeof body.name === 'string')
            names.push(body.name);
        return original(url, init);
    };
    return { names, restore: () => { engine.context.fetch = original; } };
}
function failStorageWrites(engine, failingKey) {
    const { setItem } = engine.storage;
    engine.storage.setItem = (key, value) => {
        if (key === failingKey)
            throw new Error(`QuotaExceededError（${key}）`);
        return setItem(key, value);
    };
    return () => { engine.storage.setItem = setItem; };
}

function el(engine, id) {
    return engine.doc.element(id);
}
function textOf(engine, id) {
    return el(engine, id).textContent;
}
function hasWarning(engine, fragment) {
    return engine.logs.some(line => line.startsWith('warn:') && line.includes(fragment));
}
function fire(engine, id, type, extra = {}) {
    const element = el(engine, id);
    const listeners = element.listeners[type] || [];
    assert.ok(listeners.length > 0, `#${id} に ${type} の処理が無い`);
    return listeners.map(listener => listener({ preventDefault() {}, target: element, ...extra }));
}
function screenOf(engine) {
    return engine.run('currentScreen');
}
function accountOf(engine) {
    const account = plain(engine.account.readAccount());
    remember(account.deviceKey, account.transferCode);
    return account;
}
function redactAccount(account) {
    return {
        ...account,
        playerId: typeof account.playerId === 'string' && PLAYER_ID_PATTERN.test(account.playerId) ? 'ID' : account.playerId,
        deviceKey: typeof account.deviceKey === 'string' && account.deviceKey !== '' ? 'KEY' : account.deviceKey,
        transferCode: typeof account.transferCode === 'string' && CODE_PATTERN.test(account.transferCode) ? 'CODE' : account.transferCode
    };
}
function setName(engine, name) {
    assert.ok(engine.account.writeAccountName(name).ok, '名前を保存できなかった');
}
async function register(engine, mock, name) {
    setName(engine, name);
    const result = plain(await engine.online.syncAccount());
    assert.strictEqual(result.registered, true, `登録できなかった（${result.error}）`);
    const account = accountOf(engine);
    await waitForSave(mock, account.playerId);
    return account;
}
function startGame(engine, setup = AI_GAME) {
    engine.run(`${setup}; startGameFromConfig()`);
}
function ticketOf(engine) {
    return plain(engine.run('gameRanking'));
}
async function waitTicket(engine) {
    return waitFor('札の返事', () => {
        const ticket = ticketOf(engine);
        return ticket.runId !== null || ticket.error !== null ? ticket : null;
    });
}
function endGameWith(engine, piece, playMs) {
    engine.context.__playMs = playMs;
    engine.run(`board = createInitialBoard(); board[0][0] = ${piece}; gameStartedAt = Date.now() - __playMs; endGame()`);
}
const endWonGame = (engine, playMs = FIRST_PLAY_MS) => endGameWith(engine, 'FIRST', playMs);
const endLostGame = (engine, playMs = FIRST_PLAY_MS) => endGameWith(engine, 'SECOND', playMs);
function resultLine(engine) {
    return { text: textOf(engine, 'result-ranking-status'), hidden: el(engine, 'result-ranking-status').hidden };
}
async function waitResultLine(engine) {
    return waitFor('結果の行', () => {
        const text = textOf(engine, 'result-ranking-status');
        return text !== T('result.sending') ? text : null;
    });
}
function listTexts(engine) {
    return el(engine, 'ranking-list').children.map(item => (item.children.length > 0 ? item.children.map(cell => cell.textContent) : [item.textContent]));
}
function accountBusy(engine) {
    return ['account-name-input', 'account-submit-button', 'account-close-button', 'recover-code-input', 'recover-button'].map(id => el(engine, id).disabled);
}
function makeWebGame(ranking) {
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[3][3] = 1;
    board[5][5] = -1;
    const config = { opponent: 'ai', humanColor: 1, boardSize: 9, eventMapIndex: 0, aiLevel: 'normal', showGuide: true };
    const game = { version: 1, savedAt: Date.now(), elapsedMs: 1000, config, mode: '2d', board, activeMap: null, boardSize: 9, currentPlayer: 1, consecutivePasses: 0 };
    return ranking === undefined ? game : { ...game, ranking };
}

function htmlTextOf(html, id) {
    const match = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html);
    return match ? match[1] : null;
}
async function checkTexts(mock) {
    const engine = makeEngine(mock);
    const server = engine.context.GelpiyoServer;
    await check('§9 の文言が表と完全一致（キーと順も同じ）', () => {
        assert.deepStrictEqual(Object.keys(server.TEXTS), Object.keys(EXPECTED_TEXTS));
        Object.entries(EXPECTED_TEXTS).forEach(([key, text]) => assert.strictEqual(server.TEXTS[key], text, key));
    });
    await check('error から理由の文言を選び、表に無い error は reason.other に名前を入れる', () => {
        Object.keys(REASON_KEYS).forEach(error => assert.strictEqual(server.reasonText(error), reasonOf(error), error));
        same(['bad_json', 'server', 'http_418'].map(server.reasonText), ['サーバーで問題が起きました：bad_json', 'サーバーで問題が起きました：server', 'サーバーで問題が起きました：http_418']);
    });
    await check('{名前} の差し込み（数はカンマなしの整数のまま）', () => {
        assert.strictEqual(server.formatText('result.improved', { rank: 1234, participants: 5678 }), 'ランキングに送りました。自己ベストを更新しました（1234位／5678人中）。');
        assert.strictEqual(server.formatText('result.sent', { best: '384,210点', rank: 2, participants: 9 }), 'ランキングに送りました（自己ベスト 384,210点・2位／9人中）。');
    });
    await checkIndexHtml();
    return plain(server.TEXTS);
}
async function checkIndexHtml() {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    await check('index.html に書いた文言も §9 と同じ', () => {
        HTML_TEXTS.forEach(([id, key]) => assert.strictEqual(htmlTextOf(html, id), EXPECTED_TEXTS[key], id));
        assert.strictEqual((/id="recover-code-input"[^>]*placeholder="([^"]*)"/.exec(html) || [])[1], EXPECTED_TEXTS['recover.placeholder']);
    });
    await check('準備中の文言（名前の注記・ランキングの状態）は消えている', () => {
        ['ランキングへの参加は準備中です。', 'ランキングはサーバーとの接続を準備中です。', 'サーバーへの送信は準備中です。'].forEach(text => assert.ok(!html.includes(text), text));
    });
    await check('引き継ぎコードの入力は名前のフォームの外（Enter で名前を送らない）', () => {
        const accountForm = /<form id="account-form"[\s\S]*?<\/form>/.exec(html)[0];
        assert.ok(!accountForm.includes('recover-code-input'));
        assert.ok(/<form id="recover-form"[\s\S]*?id="recover-code-input"[\s\S]*?<\/form>/.test(html));
    });
    await check('読み込み順は account.js → server-config.js → server-api.js → online.js → script.js', () => {
        const order = ['account.js', 'server-config.js', 'server-api.js', 'online.js', 'script.js'].map(file => html.indexOf(`<script src="${file}"></script>`));
        assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])), JSON.stringify(order));
    });
}

const OFFLINE_RESULT = { ok: false, status: 0, error: 'offline', message: 'サーバーにつながりませんでした' };
function apiCalls(api) {
    return [
        () => api.register('ぴよ'), () => api.rename('k', 'ぴよ'), () => api.reissueCode('k'), () => api.recover('ABCD-EFGH-JK23'),
        () => api.putSave('k', '{}'), () => api.startRun('k'), () => api.finishRun('k', 'r', { value: 1, cleared: true, detail: null }),
        () => api.top(), () => api.myEntry('k')
    ];
}
function badConfigs(base) {
    const good = { baseUrl: base, board: BOARD, timeoutMs: CLIENT_TIMEOUT_MS };
    return [
        undefined, null, 'x', { ...good, offline: true }, { ...good, baseUrl: `${base}/` }, { ...good, baseUrl: 5 },
        { ...good, board: '' }, { ...good, board: 3 }, { ...good, timeoutMs: 0 }, { ...good, timeoutMs: -1 }, { ...good, timeoutMs: '15000' }, { ...good, timeoutMs: Infinity }
    ];
}
async function checkApiOffline(mock) {
    const offlineEngine = makeOfflineEngine();
    await check('fetch の無い試験環境では、本番の設定でも送らずに offline を返す（読み込みでも落ちない）', async () => {
        const api = offlineEngine.context.GelpiyoServer.create(offlineEngine.context.GelpiyoServerConfig);
        assert.strictEqual(api.offline, true);
        (await Promise.all(apiCalls(api).map(call => call()))).forEach(result => same(result, OFFLINE_RESULT));
        same([offlineEngine.online.isOffline(), offlineEngine.context.GelpiyoServer.isRetryable(OFFLINE_RESULT)], [true, false]);
    });
    const engine = makeEngine(mock);
    await check('設定が無い・offline: true・形が違う設定は offline（窓口へ送らない）', async () => {
        const before = await requestCount(mock);
        const apis = badConfigs(mock.base).map(config => engine.context.GelpiyoServer.create(config, { timer: realTimer }));
        assert.ok(apis.every(api => api.offline), JSON.stringify(apis.map(api => api.offline)));
        (await Promise.all(apis.map(api => api.top()))).forEach(result => same(result, OFFLINE_RESULT));
        await expectNoRequests(mock, before);
        assert.strictEqual(makeApi(engine).offline, false);
    });
}

async function checkApiAccountCalls(api) {
    const registered = plain(await api.register('  ぴよ太  '));
    remember(registered.data && registered.data.deviceKey, registered.data && registered.data.recoveryCode);
    await check('register：201 で番号・名前（前後の空白は窓口が取る）・鍵・引き継ぎコード', () => {
        same([registered.ok, registered.status, registered.data.name], [true, 201, 'ぴよ太']);
        assert.ok(PLAYER_ID_PATTERN.test(registered.data.playerId) && registered.data.deviceKey.length > 0 && CODE_PATTERN.test(registered.data.recoveryCode));
    });
    const key = registered.data.deviceKey;
    await check('register の断り：名前が空・21 文字は bad_name（400）', async () => {
        const results = plain(await Promise.all(['   ', 'a'.repeat(21)].map(name => api.register(name))));
        results.forEach(result => same(result, { ok: false, status: 400, error: 'bad_name', message: reasonOf('bad_name') }));
    });
    await check('rename：200 で番号と新しい名前', async () => same(plain(await api.rename(key, 'ぴよ次郎')), { ok: true, status: 200, data: { playerId: registered.data.playerId, name: 'ぴよ次郎' } }));
    await check('rename の断り：使えない鍵は bad_key（401）', async () => same(plain(await api.rename('bogus-key', 'x')), { ok: false, status: 401, error: 'bad_key', message: reasonOf('bad_key') }));
    return registered.data;
}
async function checkApiRunCalls(api, player, mock) {
    await mock.config({ minSec: 0 });
    const run = plain(await api.startRun(player.deviceKey));
    await check('startRun：201 で札の番号・始めた時刻・回数', () => {
        same([run.ok, run.status, run.data.attempts], [true, 201, 1]);
        assert.ok(RUN_ID_PATTERN.test(run.data.runId) && !Number.isNaN(Date.parse(run.data.startedAt)));
    });
    const payload = { value: 1234, cleared: true, detail: { app: 'gelpiyo-territory', v: 1 } };
    await check('finishRun：200 で更新・最高点・回数・順位・参加人数', async () => {
        same(plain(await api.finishRun(player.deviceKey, run.data.runId, payload)), { ok: true, status: 200, data: { accepted: true, improved: true, best: 1234, attempts: 1, clears: 1, rank: 1, participants: 1 } });
        const finish = (await mock.state()).finishes.find(entry => entry.runId === run.data.runId);
        same([finish.value, finish.cleared, finish.detail], [1234, true, payload.detail]);
    });
    await check('finishRun の断り：同じ札は already_done（409）・知らない札は no_run（404）', async () => {
        same(plain(await api.finishRun(player.deviceKey, run.data.runId, payload)), { ok: false, status: 409, error: 'already_done', message: reasonOf('already_done') });
        same(plain(await api.finishRun(player.deviceKey, 'rnotexist', payload)), { ok: false, status: 404, error: 'no_run', message: reasonOf('no_run') });
    });
}
async function checkApiBoardCalls(api, player, mock) {
    await check('top：上位の表の行（順位・番号・名前・称号・枠・最高点）', async () => {
        same(plain(await api.top()), { ok: true, status: 200, data: { board: BOARD, rows: [{ rank: 1, playerId: player.playerId, name: 'ぴよ次郎', title: '', frame: '', best: 1234 }] } });
    });
    await check('myEntry：自分の行（最高点・順位・参加人数）', async () => {
        const mine = plain(await api.myEntry(player.deviceKey));
        same([mine.status, mine.data.exists, mine.data.name, mine.data.best, mine.data.rank, mine.data.participants], [200, true, 'ぴよ次郎', 1234, 1, 1]);
    });
    await check('top は limit=100 で頼む（窓口の既定の 50 件より多く返る）', async () => {
        await mock.rows(Array.from({ length: TOP_LIMIT + 1 }, (_, index) => ({ name: `p${index}`, best: index })));
        assert.strictEqual(plain(await api.top()).data.rows.length, TOP_LIMIT);
    });
}
async function checkApiSaveCalls(api, player, mock) {
    await check('putSave：200 で大きさと時刻。appVersion と今の ISO 時刻を添える', async () => {
        const saved = plain(await api.putSave(player.deviceKey, '{"app":"gelpiyo-territory"}'));
        same([saved.ok, saved.status, saved.data.ok, saved.data.size], [true, 200, true, 27]);
        const stored = (await mock.state()).saves[player.playerId];
        same([stored.appVersion, Number.isNaN(Date.parse(stored.savedAt))], [APP_VERSION, false]);
    });
    await check('putSave の断り：JSON でない中身は bad_data（400）→ reason.other', async () => {
        same(plain(await api.putSave(player.deviceKey, '{壊れた')), { ok: false, status: 400, error: 'bad_data', message: 'サーバーで問題が起きました：bad_data' });
    });
}
async function checkApiCodeCalls(api, player) {
    const reissued = plain(await api.reissueCode(player.deviceKey));
    remember(reissued.data && reissued.data.recoveryCode);
    await check('reissueCode：200 で新しいコード（前のコードは code_not_found になる）', async () => {
        assert.ok(reissued.ok && CODE_PATTERN.test(reissued.data.recoveryCode) && reissued.data.recoveryCode !== player.recoveryCode);
        same(plain(await api.recover(player.recoveryCode)), { ok: false, status: 404, error: 'code_not_found', message: reasonOf('code_not_found') });
    });
    const recovered = plain(await api.recover(reissued.data.recoveryCode));
    remember(recovered.data && recovered.data.deviceKey);
    await check('recover：200 で同じ番号・名前・新しい鍵・控え（前の鍵は bad_key になる）', async () => {
        same([recovered.status, recovered.data.playerId, recovered.data.name, recovered.data.save.data, recovered.data.save.appVersion], [200, player.playerId, 'ぴよ次郎', '{"app":"gelpiyo-territory"}', APP_VERSION]);
        assert.ok(recovered.data.deviceKey !== player.deviceKey);
        same(plain(await api.myEntry(player.deviceKey)), { ok: false, status: 401, error: 'bad_key', message: reasonOf('bad_key') });
        assert.strictEqual(plain(await api.myEntry(recovered.data.deviceKey)).status, 200);
    });
    await check('recover の断り：12 文字にならないコードは bad_code（400）', async () => same(plain(await api.recover('abc')), { ok: false, status: 400, error: 'bad_code', message: reasonOf('bad_code') }));
}
async function checkApiCalls(mock) {
    await mock.reset();
    const engine = makeEngine(mock);
    const api = makeApi(engine);
    const player = await checkApiAccountCalls(api);
    await checkApiRunCalls(api, player, mock);
    await checkApiBoardCalls(api, player, mock);
    await checkApiSaveCalls(api, player, mock);
    await checkApiCodeCalls(api, player);
    await check('myEntry：記録が無ければ exists false', async () => {
        const fresh = plain(await api.register('はじめて'));
        remember(fresh.data.deviceKey, fresh.data.recoveryCode);
        same(plain(await api.myEntry(fresh.data.deviceKey)).data, { exists: false, attempts: 0, clears: 0, history: [] });
    });
}

async function failedTop(mock, api, failure) {
    await mock.fail({ count: 1, ...failure });
    return plain(await api.top());
}
async function checkApiStatusErrors(mock, engine, api) {
    const server = engine.context.GelpiyoServer;
    await check('窓口の断り（status と error）はそのまま。500 以上は送り直してよい', async () => {
        const result = await failedTop(mock, api, { mode: 'status', status: 503, error: 'server' });
        same(result, { ok: false, status: 503, error: 'server', message: 'サーバーで問題が起きました：server' });
        assert.ok(server.isRetryable(result));
        assert.ok(server.isRetryable(await failedTop(mock, api, { mode: 'status', status: 502, error: 'weird' })));
    });
    await check('本文に error が無い 2xx 以外は http_<状態コード>', async () => {
        const result = await failedTop(mock, api, { mode: 'status', status: 418 });
        same(result, { ok: false, status: 418, error: 'http_418', message: 'サーバーで問題が起きました：http_418' });
        assert.ok(!server.isRetryable(result));
    });
}
async function checkApiTransportErrors(mock, engine, api) {
    const server = engine.context.GelpiyoServer;
    const topRequest = `GET ${mock.base}/v1/challenge/${BOARD}/top?limit=${TOP_LIMIT}`;
    await check('つながらない（drop）は network（status 0・送り直してよい）。method と URL を添えて警告を出す', async () => {
        const result = await failedTop(mock, api, { mode: 'drop' });
        same(result, { ok: false, status: 0, error: 'network', message: reasonOf('network') });
        assert.ok(server.isRetryable(result));
        assert.ok(hasWarning(engine, `${topRequest}・network`), '失敗の警告が出ていない');
    });
    await check('返事が来ない（hang）は timeoutMs で timeout（送り直してよい）。method と URL を添えて警告を出す', async () => {
        const startedAt = Date.now();
        const result = await failedTop(mock, makeApi(engine, { timeoutMs: SHORT_TIMEOUT_MS }), { mode: 'hang' });
        same(result, { ok: false, status: 0, error: 'timeout', message: reasonOf('timeout') });
        assert.ok(server.isRetryable(result) && Date.now() - startedAt >= SHORT_TIMEOUT_MS - POLL_MS);
        assert.ok(hasWarning(engine, `${topRequest}・timeout`), '時間切れの警告が出ていない');
    });
}
// 窓口が混んで Cloud Run が返す 429 は本文が JSON でない（にせ窓口では error の無い本文、本番の基盤では HTML）。
async function checkApiCongestion(mock, engine, api) {
    const server = engine.context.GelpiyoServer;
    await check('本文に error の無い 429（混雑）は http_429 で送り直してよい。窓口の too_many（429）は送り直さない', async () => {
        const result = await failedTop(mock, api, { mode: 'status', status: 429 });
        same(result, { ok: false, status: 429, error: 'http_429', message: reasonOf('http_429') });
        same([server.isRetryable(result), server.isRetryable(server.failure(429, 'too_many'))], [true, false]);
    });
    const fake = useFakeFetch(engine, async () => fakeResponse(429, '<html><body>Rate exceeded.</body></html>'));
    try {
        await check('本文が HTML の 429 も http_429 で、送り直してよい', async () => {
            const result = plain(await makeApi(engine).top());
            same([result.status, result.error, server.isRetryable(result)], [429, 'http_429', true]);
        });
    } finally {
        fake.restore();
    }
}
async function checkApiErrorKinds(engine) {
    const server = engine.context.GelpiyoServer;
    await check('鍵が使えない error（bad_key・no_key・no_player）だけを鍵の失敗とみなす', () => {
        const failure = error => server.failure(401, error);
        same(['bad_key', 'no_key', 'no_player', 'not_open', 'network'].map(error => server.isBadKey(failure(error))), [true, true, true, false, false]);
        same(['already_done', 'too_short', 'bad_key', 'offline', 'closed'].map(error => server.isRetryable(server.failure(409, error))), [false, false, false, false, false]);
    });
}
async function checkApiErrors(mock) {
    await mock.reset();
    const engine = makeEngine(mock);
    const api = makeApi(engine);
    await checkApiStatusErrors(mock, engine, api);
    await checkApiTransportErrors(mock, engine, api);
    await checkApiCongestion(mock, engine, api);
    await checkApiBadReply(engine);
    await checkApiErrorKinds(engine);
}
async function checkApiBadReply(engine) {
    const replies = [[200, 'JSON ではない'], [200, '[1,2]'], [201, '"文字"'], [200, '']];
    const fake = useFakeFetch(engine, async () => fakeResponse(...replies[fake.calls.length - 1]));
    try {
        const api = makeApi(engine);
        await check('2xx なのに本文が JSON のオブジェクトでなければ bad_reply（送り直してよい）', async () => {
            const results = plain(await Promise.all(replies.map(() => api.top())));
            same(results.map(result => [result.ok, result.error]), replies.map(() => [false, 'bad_reply']));
            assert.ok(results.every(result => engine.context.GelpiyoServer.isRetryable(result)));
        });
    } finally {
        fake.restore();
    }
}

const SHAPE_PAYLOAD = { value: 9, cleared: true, detail: null };
const SHAPE_CASES = [
    { call: api => api.register('ぴよ'), method: 'POST', path: '/v1/players', key: null, body: { name: 'ぴよ' } },
    { call: api => api.rename('KEY-1', 'ぴよ'), method: 'PATCH', path: '/v1/me', key: 'KEY-1', body: { name: 'ぴよ' } },
    { call: api => api.reissueCode('KEY-1'), method: 'POST', path: '/v1/me/code', key: 'KEY-1', body: undefined },
    { call: api => api.recover('ABCD-EFGH-JK23'), method: 'POST', path: '/v1/recover', key: null, body: { code: 'ABCD-EFGH-JK23' } },
    { call: api => api.startRun('KEY-1'), method: 'POST', path: '/v1/challenge/a%20b%2Fc/runs', key: 'KEY-1', body: { appVersion: APP_VERSION } },
    { call: api => api.finishRun('KEY-1', 'r/1?', SHAPE_PAYLOAD), method: 'POST', path: '/v1/challenge/a%20b%2Fc/runs/r%2F1%3F/finish', key: 'KEY-1', body: SHAPE_PAYLOAD },
    { call: api => api.top(), method: 'GET', path: '/v1/challenge/a%20b%2Fc/top?limit=100', key: null, body: undefined },
    { call: api => api.myEntry('KEY-1'), method: 'GET', path: '/v1/challenge/a%20b%2Fc/me', key: 'KEY-1', body: undefined }
];
function expectedHeaders(testCase) {
    const headers = {};
    if (testCase.body !== undefined)
        headers['Content-Type'] = 'application/json';
    if (testCase.key !== null)
        headers.Authorization = `Bearer ${testCase.key}`;
    return headers;
}
async function checkShapeCases(mock, api, fake) {
    await check('本文があるときだけ Content-Type、鍵を渡したときだけ Authorization。GET は本文なし。板と札はパスで符号化', async () => {
        await SHAPE_CASES.reduce(async (previous, testCase) => {
            await previous;
            await testCase.call(api);
            const sent = fake.calls[fake.calls.length - 1];
            same([sent.url, sent.method, sent.headers, sent.body === undefined ? undefined : JSON.parse(sent.body), sent.hasSignal],
                [mock.base + testCase.path, testCase.method, expectedHeaders(testCase), testCase.body, true], testCase.path);
        }, Promise.resolve());
    });
}
async function checkPutSaveShape(mock, api, fake) {
    await check('putSave の本文は {data, appVersion, savedAt（今の ISO 時刻）}', async () => {
        await api.putSave('KEY-1', '{"a":1}');
        const sent = fake.calls[fake.calls.length - 1];
        const body = JSON.parse(sent.body);
        same([sent.url, sent.method, sent.headers, body.data, body.appVersion], [`${mock.base}/v1/save`, 'PUT', { 'Content-Type': 'application/json', Authorization: 'Bearer KEY-1' }, '{"a":1}', APP_VERSION]);
        assert.ok(Math.abs(Date.parse(body.savedAt) - Date.now()) < HOUR_MS && body.savedAt.endsWith('Z'));
    });
}
async function checkApiRequestShape(mock) {
    const engine = makeEngine(mock);
    const fake = useFakeFetch(engine, async () => fakeResponse(200, '{}'));
    try {
        const api = makeApi(engine, { board: 'a b/c' });
        await checkShapeCases(mock, api, fake);
        await checkPutSaveShape(mock, api, fake);
    } finally {
        fake.restore();
    }
}

async function checkSyncSkips(mock) {
    const engine = makeEngine(mock);
    await check('同期：名前が空なら何もしない（送らない）', async () => {
        const before = await requestCount(mock);
        same(await engine.online.syncAccount(), { ok: true, skipped: true });
        await expectNoRequests(mock, before);
    });
    const offline = makeOfflineEngine();
    await check('同期：API が offline なら何もしない', async () => {
        setName(offline, 'ぴよ太');
        same(await offline.online.syncAccount(), { ok: true, skipped: true });
        same(accountOf(offline).deviceKey, null);
    });
}
async function checkSyncRegister(mock) {
    const engine = makeEngine(mock);
    await check('同期：未登録なら登録し、番号・鍵・コード・サーバーの名前を保存して控えを送る', async () => {
        setName(engine, '登録する');
        same(await engine.online.syncAccount(), { ok: true, registered: true });
        const account = accountOf(engine);
        same(redactAccount(account), { version: 1, name: '登録する', playerId: 'ID', deviceKey: 'KEY', transferCode: 'CODE', serverName: '登録する' });
        await waitForSave(mock, account.playerId);
        const state = await mock.state();
        same([state.saves[account.playerId].appVersion, state.names.includes('登録する')], [APP_VERSION, true]);
    });
}
async function checkSyncCoalesce(mock) {
    const engine = makeEngine(mock);
    await check('同期：走っている間に呼ばれたら、新しく送らずに同じ結果を待って返す', async () => {
        setName(engine, 'まとめる');
        const before = (await mock.state()).players;
        const first = engine.online.syncAccount();
        const second = engine.online.syncAccount();
        assert.ok(first === second, '別の Promise が返った');
        same(await second, { ok: true, registered: true });
        assert.strictEqual((await mock.state()).players, before + 1);
        await waitForSave(mock, accountOf(engine).playerId);
    });
}
async function checkSyncRename(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '名前変更');
    await check('同期：名前がサーバーと違えば名前を変え、窓口が返した名前を保存する', async () => {
        setName(engine, '名前変更後');
        same(await engine.online.syncAccount(), { ok: true, renamed: true });
        const after = accountOf(engine);
        same([after.name, after.serverName, after.deviceKey === account.deviceKey], ['名前変更後', '名前変更後', true]);
        assert.ok((await mock.state()).names.includes('名前変更後'));
    });
    await check('同期：名前がサーバーと同じなら送らない', async () => {
        const before = await requestCount(mock);
        same(await engine.online.syncAccount(), { ok: true, skipped: true });
        await expectNoRequests(mock, before);
    });
}
async function checkSyncBadKey(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '鍵なし');
    await check('同期：bad_key なら鍵・番号・サーバーの名前を消し、名前と引き継ぎコードは残す', async () => {
        engine.account.writeAccount({ deviceKey: 'bogus-key-for-test', name: '鍵なし二' });
        const result = plain(await engine.online.syncAccount());
        same([result.ok, result.status, result.error, result.message], [false, 401, 'bad_key', reasonOf('bad_key')]);
        const after = accountOf(engine);
        same([after.deviceKey, after.playerId, after.serverName, after.name, after.transferCode === account.transferCode], [null, null, null, '鍵なし二', true]);
    });
    await check('同期：鍵を消した後の同期では新しく登録する', async () => {
        same(await engine.online.syncAccount(), { ok: true, registered: true });
        const after = accountOf(engine);
        assert.ok(after.playerId !== account.playerId && after.deviceKey !== null);
        await waitForSave(mock, after.playerId);
    });
}
async function checkSyncFailure(mock) {
    const engine = makeEngine(mock);
    await check('同期：登録が届かなければ ok false（network）で、未登録のまま', async () => {
        setName(engine, '届かない');
        await mock.fail({ count: 1, mode: 'drop' });
        const result = plain(await engine.online.syncAccount());
        same([result.ok, result.status, result.error, result.message], [false, 0, 'network', reasonOf('network')]);
        same(accountOf(engine).deviceKey, null);
    });
}
function makeHeldApi() {
    const held = [];
    const hold = kind => (...args) => new Promise(resolve => held.push({ kind, args, resolve }));
    const okSave = async () => ({ ok: true, status: 200, data: { ok: true, size: 1, updatedAt: new Date().toISOString() } });
    return { held, api: { offline: false, register: hold('register'), rename: hold('rename'), putSave: okSave } };
}
const HELD_REGISTRATION = { playerId: 'p-held', deviceKey: 'held-key', recoveryCode: 'ABCD-EFGH-JK23' };
async function checkSyncRaceRename(engine, held, online) {
    await check('同期：返事を待つ間に名前が変えられたら、新しい名前を残してサーバーの名前だけ入れる', async () => {
        setName(engine, '前の名前');
        const result = online.syncAccount();
        await waitFor('登録の要求', () => held.length === 1);
        setName(engine, '後の名前');
        held[0].resolve({ ok: true, status: 201, data: { ...HELD_REGISTRATION, name: '前の名前' } });
        same(await result, { ok: true, registered: true });
        const account = plain(engine.account.readAccount());
        same([account.name, account.serverName, engine.account.needsSync(account)], ['後の名前', '前の名前', true]);
    });
}
async function checkSyncRaceServerName(engine, held, online) {
    await check('同期：窓口が返した名前を、端末の名前とサーバーの名前にそのまま入れる', async () => {
        const result = online.syncAccount();
        await waitFor('名前変更の要求', () => held.length === 2);
        held[1].resolve({ ok: true, status: 200, data: { playerId: 'p-held', name: '窓口の名前' } });
        same(await result, { ok: true, renamed: true });
        same([plain(engine.account.readAccount()).name, plain(engine.account.readAccount()).serverName], ['窓口の名前', '窓口の名前']);
    });
}
async function checkSyncRaceRecovered(engine, held, online) {
    await check('同期：返事を待つ間に引き継ぎで別の鍵になったら、その鍵を残す', async () => {
        engine.account.writeAccount({ deviceKey: null, playerId: null, serverName: null });
        const result = online.syncAccount();
        await waitFor('登録の要求', () => held.length === 3);
        engine.account.writeAccount({ deviceKey: 'recovered-key', playerId: 'p-recovered', serverName: '窓口の名前' });
        held[2].resolve({ ok: true, status: 201, data: { ...HELD_REGISTRATION, name: '窓口の名前' } });
        same(await result, { ok: true, skipped: true });
        same(plain(engine.account.readAccount()).deviceKey, 'recovered-key');
    });
}
async function checkSyncRaces(mock) {
    const engine = makeEngine(mock);
    const { held, api } = makeHeldApi();
    const { online } = makeDirectOnline(engine, { api });
    await checkSyncRaceRename(engine, held, online);
    await checkSyncRaceServerName(engine, held, online);
    await checkSyncRaceRecovered(engine, held, online);
}
async function checkSync(mock) {
    await mock.reset();
    await checkSyncSkips(mock);
    await checkSyncRegister(mock);
    await checkSyncCoalesce(mock);
    await checkSyncRename(mock);
    await checkSyncBadKey(mock);
    await checkSyncFailure(mock);
    await checkSyncRaces(mock);
}

async function checkTicketBasics(mock) {
    const unnamed = makeEngine(mock);
    await check('札：名前が空なら取りに行かず、始めた直後から error は no_name', async () => {
        const before = await requestCount(mock);
        startGame(unnamed);
        same(ticketOf(unnamed), { ...NO_TICKET, error: 'no_name' });
        await expectNoRequests(mock, before);
    });
    const engine = makeEngine(mock);
    await register(engine, mock, '札の人');
    await check('札：登録済みで AI 戦を始めると、盤を作った後に裏で取って runId・startedAt を入れる', async () => {
        startGame(engine);
        same([ticketOf(engine), engine.run('gameStarted')], [NO_TICKET, true]);
        const ticket = await waitTicket(engine);
        assert.ok(RUN_ID_PATTERN.test(ticket.runId) && !Number.isNaN(Date.parse(ticket.startedAt)) && ticket.error === null, JSON.stringify(ticket));
    });
    await checkTicketHuman(mock, engine);
}
async function checkTicketHuman(mock, engine) {
    await check('札：人間同士の対局では取らない', async () => {
        const before = await requestCount(mock);
        startGame(engine, HUMAN_GAME);
        same(ticketOf(engine), NO_TICKET);
        await expectNoRequests(mock, before);
    });
}
async function checkTicketRegistersFirst(mock) {
    const engine = makeEngine(mock);
    setName(engine, '札で登録');
    await check('札：名前があり未登録なら、同期（登録）してから札を取る', async () => {
        startGame(engine);
        assert.ok((await waitTicket(engine)).runId !== null);
        const account = accountOf(engine);
        assert.ok(engine.account.isRegistered(account));
        await waitForSave(mock, account.playerId);
    });
}
async function checkTicketErrors(mock) {
    const engine = makeEngine(mock);
    await register(engine, mock, '札の失敗');
    const cases = [
        ['開催期間外なら error は not_open', () => mock.config(PAST_EVENT), 'not_open'],
        ['つながらなければ error は network', () => mock.fail({ count: 1, mode: 'drop' }), 'network'],
        ['窓口の中の失敗なら error は server', () => mock.fail({ count: 1, mode: 'status', status: 500, error: 'server' }), 'server']
    ];
    await cases.reduce(async (previous, [label, prepare, error]) => {
        await previous;
        await openEvent(mock);
        await check(`札：${label}`, async () => {
            await prepare();
            startGame(engine);
            same(await waitTicket(engine), { ...NO_TICKET, error });
        });
    }, Promise.resolve());
    await openEvent(mock);
    await checkTicketBadKey(engine);
}
async function checkTicketBadKey(engine) {
    await check('札：鍵が使えなければ error は bad_key で、鍵を消す', async () => {
        engine.account.writeAccount({ deviceKey: 'bogus-key-for-test' });
        startGame(engine);
        same(await waitTicket(engine), { ...NO_TICKET, error: 'bad_key' });
        same(accountOf(engine).deviceKey, null);
    });
}
async function checkTicketOfflineAndTimeout(mock) {
    const offline = makeOfflineEngine();
    await check('札：API が offline なら error は offline', async () => {
        setName(offline, 'オフライン');
        startGame(offline);
        same(await waitTicket(offline), { ...NO_TICKET, error: 'offline' });
    });
    const engine = makeEngine(mock, { timeoutMs: SHORT_TIMEOUT_MS });
    await register(engine, mock, '札の時間切れ');
    await check('札：返事が来なければ error は timeout', async () => {
        await mock.fail({ count: 1, mode: 'hang' });
        startGame(engine);
        same(await waitTicket(engine), { ...NO_TICKET, error: 'timeout' });
    });
}
async function checkTicketSessionGuard(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '札を捨てる');
    await check('札：返事が届く前に次の対局を始めたら、前の対局の返事は捨てる', async () => {
        const before = await requestCount(mock);
        startGame(engine);
        startGame(engine, HUMAN_GAME);
        await waitForRequests(mock, before + 1);
        await settle();
        same(ticketOf(engine), NO_TICKET);
        assert.strictEqual(plain(await makeApi(engine).myEntry(account.deviceKey)).data.attempts, 1, '札の要求が窓口に届いていない');
    });
}
async function checkTicketSendsPending(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '送り残しの人');
    await check('札：送り残しがあれば札の前に送る', async () => {
        await mock.config({ minSec: 0 });
        const run = plain(await makeApi(engine).startRun(account.deviceKey));
        engine.account.writePendingFinish([{ runId: run.data.runId, payload: { value: 77, cleared: true, detail: null } }]);
        startGame(engine);
        assert.ok((await waitTicket(engine)).runId !== null);
        same(engine.account.readPendingFinish(), []);
        assert.ok((await mock.state()).finishes.some(entry => entry.runId === run.data.runId && entry.value === 77));
    });
}
async function checkTicket(mock) {
    await mock.reset();
    await checkTicketBasics(mock);
    await checkTicketRegistersFirst(mock);
    await checkTicketErrors(mock);
    await checkTicketOfflineAndTimeout(mock);
    await checkTicketSessionGuard(mock);
    await checkTicketSendsPending(mock);
}

async function playRankedGame(engine, playMs) {
    startGame(engine);
    assert.ok((await waitTicket(engine)).runId !== null, '札が取れなかった');
    endWonGame(engine, playMs);
}
async function checkResultSent(mock) {
    const engine = makeEngine(mock);
    await register(engine, mock, '結果の人');
    await check('結果：勝った AI 戦は送っている間 result.sending、自己ベストを更新したら result.improved', async () => {
        await playRankedGame(engine, FIRST_PLAY_MS);
        same([textOf(engine, 'result-ranking-note'), resultLine(engine)], [rankedNote(wonValue(FIRST_PLAY_MS)), { text: T('result.sending'), hidden: false }]);
        same(await waitResultLine(engine), T('result.improved', { rank: 1, participants: 1 }));
        const finish = (await mock.state()).finishes.slice(-1)[0];
        same([finish.value, finish.cleared, finish.detail.app, finish.detail.sec], [wonValue(FIRST_PLAY_MS), true, 'gelpiyo-territory', FIRST_PLAY_MS / MS_PER_SEC]);
    });
    await check('結果：更新しなかったら result.sent（自己ベストと順位）', async () => {
        await playRankedGame(engine, SLOWER_PLAY_MS);
        same(await waitResultLine(engine), T('result.sent', { best: points(wonValue(FIRST_PLAY_MS)), rank: 1, participants: 1 }));
    });
    await check('結果：ほかの人がいるときの順位（2位／2人中）で更新', async () => {
        await mock.rows([{ name: 'つよい', best: 999999 }]);
        await playRankedGame(engine, FASTER_PLAY_MS);
        same(await waitResultLine(engine), T('result.improved', { rank: 2, participants: 2 }));
    });
}
function endWithTicket(engine, ticket) {
    startGame(engine, HUMAN_GAME);
    engine.context.__ticket = ticket;
    engine.run("gameConfig.opponent = 'ai'; gameRanking = __ticket");
    endWonGame(engine);
}
async function checkResultWithoutTicket(mock) {
    const engine = makeEngine(mock);
    const cases = [['no_name', 'result.noName'], ['not_open', 'result.notOpen'], ['network', 'result.noTicket'], ['offline', 'result.noTicket'], ['bad_key', 'result.noTicket'], [null, 'result.noTicket']];
    await check('結果：札が無いときは error で文言を選び、送らない（no_name・not_open・それ以外）', async () => {
        const before = await requestCount(mock);
        cases.forEach(([error, key]) => {
            endWithTicket(engine, { ...NO_TICKET, error });
            same(resultLine(engine), { text: T(key), hidden: false }, String(error));
        });
        await expectNoRequests(mock, before);
    });
    await check('結果：札はあるが鍵が消えていたら result.failed（鍵が使えない理由）', () => {
        endWithTicket(engine, { runId: 'rleftover', startedAt: null, error: null });
        same(resultLine(engine), { text: T('result.failed', { reason: reasonOf('bad_key') }), hidden: false });
    });
}
async function checkResultNotRanked(mock) {
    const engine = makeEngine(mock);
    await check('結果：ranked でない対局（人間同士・負け・60分以上）は行を空で隠す', () => {
        startGame(engine, HUMAN_GAME);
        endWonGame(engine);
        same(resultLine(engine), { text: '', hidden: true });
        startGame(engine);
        endLostGame(engine);
        same(resultLine(engine), { text: '', hidden: true });
        startGame(engine);
        endWonGame(engine, 2 * HOUR_MS);
        same(resultLine(engine), { text: '', hidden: true });
    });
}
async function checkResultGuards(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '結果を守る');
    await check('結果：「結果を見る」で開き直しても同じ行で、もう一度は送らない', async () => {
        await playRankedGame(engine, FIRST_PLAY_MS);
        const line = await waitResultLine(engine);
        const finishes = (await mock.state()).finishes.length;
        fire(engine, 'show-result-button', 'click');
        await settle();
        same([screenOf(engine), textOf(engine, 'result-ranking-status'), (await mock.state()).finishes.length], ['result', line, finishes]);
    });
    await checkResultLateReply(mock, engine);
    await checkResultBackup(mock, engine, account);
}
async function checkResultLateReply(mock, engine) {
    await check('結果：返事が届く前に次の対局を始めたら、行を書き換えない', async () => {
        const finishes = (await mock.state()).finishes.length;
        await playRankedGame(engine, SLOWER_PLAY_MS);
        startGame(engine, HUMAN_GAME);
        await waitFor('結果の送信', async () => (await mock.state()).finishes.length > finishes);
        await settle();
        same(resultLine(engine), { text: T('result.sending'), hidden: false });
    });
}
async function checkResultBackup(mock, engine, account) {
    await check('結果：対局が終わったら status に関係なく控えを送る', async () => {
        await settle();
        const before = await requestCount(mock);
        startGame(engine, HUMAN_GAME);
        endLostGame(engine);
        await waitForRequests(mock, before + 1);
        const recorded = JSON.parse(engine.storage.getItem('gelpiyo-result-history')).length;
        await waitFor('控えに今の対局', async () => JSON.parse((await mock.saveOf(account.deviceKey)).data).history.length === recorded);
    });
}
async function checkResult(mock) {
    await mock.reset();
    await mock.config({ minSec: 0 });
    await checkResultSent(mock);
    await checkResultWithoutTicket(mock);
    await checkResultNotRanked(mock);
    await checkResultGuards(mock);
}

const FINISH_CHALLENGE = { status: 'ranked', note: '', cleared: true, value: 5000, playMs: 1000, detail: { app: 'gelpiyo-territory', v: 1 } };
const FINISH_PAYLOAD = { value: 5000, cleared: true, detail: { app: 'gelpiyo-territory', v: 1 } };
async function freshTicket(engine, account) {
    const run = plain(await makeApi(engine).startRun(account.deviceKey));
    return { runId: run.data.runId, startedAt: run.data.startedAt, error: null };
}
const RETRYABLE_FAILURES = [
    ['server（503）', { mode: 'status', status: 503, error: 'server' }, 'server'],
    ['本文に error の無い 502', { mode: 'status', status: 502 }, 'http_502'],
    ['混雑で本文に error の無い 429', { mode: 'status', status: 429 }, 'http_429'],
    ['つながらない', { mode: 'drop' }, 'network'],
    ['返事が来ない', { mode: 'hang' }, 'timeout']
];
async function checkFinishRetryable(mock, engine, account) {
    const { online } = makeDirectOnline(engine);
    const slow = makeDirectOnline(engine, { api: makeApi(engine, { timeoutMs: SHORT_TIMEOUT_MS }) }).online;
    await RETRYABLE_FAILURES.reduce(async (previous, [label, failure, error]) => {
        await previous;
        // 時間切れを長く待たないよう、返事が来ない場合だけ timeoutMs の短い試験環境で送ります。
        const client = error === 'timeout' ? slow : online;
        await check(`結果の送信：送り直してよい失敗（${label}）は送り残しに入れて result.failedRetry`, async () => {
            engine.account.writePendingFinish([]);
            const ticket = await freshTicket(engine, account);
            await mock.fail({ count: 1, ...failure });
            same(await client.finishResult(FINISH_CHALLENGE, ticket), T('result.failedRetry', { reason: reasonOf(error) }));
            same(engine.account.readPendingFinish(), [{ runId: ticket.runId, payload: FINISH_PAYLOAD }]);
        });
    }, Promise.resolve());
}
async function checkFinishPendingWriteFailure(mock, engine, account) {
    const { online } = makeDirectOnline(engine);
    await check('結果の送信：送り残しに保存できなければ、もう一度送るとは言わずに result.failed', async () => {
        engine.account.writePendingFinish([]);
        const ticket = await freshTicket(engine, account);
        await mock.fail({ count: 1, mode: 'drop' });
        const restoreStorage = failStorageWrites(engine, 'gelpiyo-pending-finish');
        try {
            same(await online.finishResult(FINISH_CHALLENGE, ticket), T('result.failed', { reason: reasonOf('network') }));
        } finally {
            restoreStorage();
        }
        same(engine.account.readPendingFinish(), []);
    });
}
async function checkFinishRefused(mock, engine, account) {
    const { online } = makeDirectOnline(engine);
    const cases = [
        ['短すぎる（too_short）', { minSec: LONG_MIN_SEC }, 'too_short'],
        ['点が上限を超える（too_high）', { maxValue: 10 }, 'too_high']
    ];
    await cases.reduce(async (previous, [label, config, error]) => {
        await previous;
        await check(`結果の送信：送れない失敗（${label}）は result.failed で、送り残しに入れない`, async () => {
            engine.account.writePendingFinish([]);
            const ticket = await freshTicket(engine, account);
            await mock.config(config);
            same(await online.finishResult(FINISH_CHALLENGE, ticket), T('result.failed', { reason: reasonOf(error) }));
            same(engine.account.readPendingFinish(), []);
            await mock.config({ minSec: 0, maxValue: MOCK_DEFAULT_MAX_VALUE });
        });
    }, Promise.resolve());
}
async function checkFinishSpecialRuns(mock, engine, account) {
    const { online } = makeDirectOnline(engine);
    await check('結果の送信：知らない札（no_run）は result.failed', async () => {
        same(await online.finishResult(FINISH_CHALLENGE, { ...NO_TICKET, runId: 'rnotexist' }), T('result.failed', { reason: reasonOf('no_run') }));
    });
    await check('結果の送信：already_done は result.sentPlain（前の送信が届いていた）', async () => {
        const ticket = await freshTicket(engine, account);
        await makeApi(engine).finishRun(account.deviceKey, ticket.runId, FINISH_PAYLOAD);
        same(await online.finishResult(FINISH_CHALLENGE, ticket), T('result.sentPlain'));
    });
}
async function checkFinishOddReplies(mock, engine) {
    const reply = { ok: true, status: 200, data: { accepted: true, improved: false, best: null, attempts: 1, clears: 0 } };
    const { online } = makeDirectOnline(engine, { api: { offline: false, finishRun: async () => reply } });
    await check('結果の送信：best が null なら result.sentPlain', async () => same(await online.finishResult(FINISH_CHALLENGE, { ...NO_TICKET, runId: 'r1' }), T('result.sentPlain')));
    const direct = makeDirectOnline(engine).online;
    await check('結果の送信：鍵が使えなければ result.failed で、鍵を消す', async () => {
        engine.account.writeAccount({ deviceKey: 'bogus-key-for-test' });
        same(await direct.finishResult(FINISH_CHALLENGE, { ...NO_TICKET, runId: 'r1' }), T('result.failed', { reason: reasonOf('bad_key') }));
        same(accountOf(engine).deviceKey, null);
    });
}
async function checkFinishClosed(mock) {
    await mock.reset();
    await mock.config({ minSec: 0, eventEnd: new Date(Date.now() + EVENT_END_IN_SEC * MS_PER_SEC).toISOString() });
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '締め切り');
    const { online } = makeDirectOnline(engine);
    await check('結果の送信：締め切り＋猶予を過ぎたら（closed）result.failed', async () => {
        const ticket = await freshTicket(engine, account);
        await mock.clock(EVENT_END_IN_SEC + MOCK_GRACE_SEC + 1);
        same(await online.finishResult(FINISH_CHALLENGE, ticket), T('result.failed', { reason: reasonOf('closed') }));
    });
}
async function checkFinish(mock) {
    await mock.reset();
    await mock.config({ minSec: 0 });
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '送信の人');
    await checkFinishRetryable(mock, engine, account);
    await checkFinishPendingWriteFailure(mock, engine, account);
    await checkFinishRefused(mock, engine, account);
    await checkFinishSpecialRuns(mock, engine, account);
    await checkFinishOddReplies(mock, engine);
    await checkFinishClosed(mock);
}

async function openRuns(engine, account, count) {
    const api = makeApi(engine);
    return Promise.all(Array.from({ length: count }, async (_, index) => ({ runId: plain(await api.startRun(account.deviceKey)).data.runId, payload: { value: 100 + index, cleared: true, detail: null } })));
}
async function checkPendingSends(mock, engine, account, online) {
    await check('送り残し：古い順に送り、成功したものを消す', async () => {
        const items = await openRuns(engine, account, 3);
        engine.account.writePendingFinish(items);
        same(await online.sendPending(), { done: 3, kept: 0 });
        same(engine.account.readPendingFinish(), []);
        const sent = (await mock.state()).finishes.slice(-3).map(entry => entry.runId);
        same(sent, items.map(item => item.runId));
    });
}
async function checkPendingDrops(mock, engine, account, online) {
    await check('送り残し：already_done と送り直せない失敗（no_run）も消す', async () => {
        const [done] = await openRuns(engine, account, 1);
        await makeApi(engine).finishRun(account.deviceKey, done.runId, done.payload);
        engine.account.writePendingFinish([done, { runId: 'rnotexist', payload: { value: 1, cleared: true, detail: null } }]);
        same(await online.sendPending(), { done: 2, kept: 0 });
        same(engine.account.readPendingFinish(), []);
    });
    await check('送り残し：送り直してよい失敗は残して次の件へ進み、次の機会に送る', async () => {
        const items = await openRuns(engine, account, 2);
        engine.account.writePendingFinish(items);
        await mock.fail({ count: 1, mode: 'drop' });
        same(await online.sendPending(), { done: 1, kept: 1 });
        same(engine.account.readPendingFinish(), [items[0]]);
        same(await online.sendPending(), { done: 1, kept: 0 });
    });
}
async function checkPendingCongestion(mock, engine, account, online) {
    await check('送り残し：混雑で本文に error の無い 429 は送り直してよい失敗として残し、次の機会に送る', async () => {
        const items = await openRuns(engine, account, 1);
        engine.account.writePendingFinish(items);
        await mock.fail({ count: 1, mode: 'status', status: 429 });
        same(await online.sendPending(), { done: 0, kept: 1 });
        same(engine.account.readPendingFinish(), items);
        same(await online.sendPending(), { done: 1, kept: 0 });
    });
}
async function checkPendingGuards(mock, engine, account, online) {
    await check('送り残し：同時に 2 つ走らせない（同じ Promise を返し、1 件は 1 回だけ送る）', async () => {
        const items = await openRuns(engine, account, 1);
        engine.account.writePendingFinish(items);
        const finishes = (await mock.state()).finishes.length;
        const first = online.sendPending();
        assert.ok(first === online.sendPending(), '別の Promise が返った');
        await first;
        assert.strictEqual((await mock.state()).finishes.length, finishes + 1);
    });
    await check('送り残し：最大5件（古いものから捨てる）', async () => {
        const items = await openRuns(engine, account, 6);
        engine.account.writePendingFinish(items);
        same(engine.account.readPendingFinish().map(item => item.runId), items.slice(1).map(item => item.runId));
        engine.account.writePendingFinish([]);
    });
}
async function checkPendingKeys(mock, engine, account, online) {
    await check('送り残し：鍵が使えなければその件を消し、鍵も消す', async () => {
        engine.account.writePendingFinish((await openRuns(engine, account, 1)));
        engine.account.writeAccount({ deviceKey: 'bogus-key-for-test' });
        same(await online.sendPending(), { done: 1, kept: 0 });
        same([engine.account.readPendingFinish(), accountOf(engine).deviceKey], [[], null]);
    });
    await check('送り残し：登録済みでなければ何もしない', async () => {
        engine.account.writePendingFinish([{ runId: 'rkept', payload: { value: 1, cleared: true, detail: null } }]);
        const before = await requestCount(mock);
        same(await online.sendPending(), { done: 0, kept: 1 });
        await expectNoRequests(mock, before);
    });
}
async function checkPending(mock) {
    await mock.reset();
    await mock.config({ minSec: 0 });
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '送り残し');
    const { online } = makeDirectOnline(engine);
    await checkPendingSends(mock, engine, account, online);
    await checkPendingDrops(mock, engine, account, online);
    await checkPendingCongestion(mock, engine, account, online);
    await checkPendingGuards(mock, engine, account, online);
    await checkPendingKeys(mock, engine, account, online);
}

async function waitRankingLoaded(engine) {
    return waitFor('ランキングの読み込み', () => textOf(engine, 'ranking-status') !== T('ranking.loading'));
}
async function checkRankingRows(mock) {
    const engine = makeEngine(mock);
    await mock.rows([{ name: 'たろう', best: 384210 }, { name: '<b>はなこ</b>', best: 0 }]);
    await check('ランキング：開くと ranking.loading を出し、一覧と自分の行を空にしてから読み込む', () => {
        fire(engine, 'title-ranking-button', 'click');
        same([screenOf(engine), textOf(engine, 'ranking-status'), el(engine, 'ranking-status').hidden, listTexts(engine), el(engine, 'ranking-my-best').hidden], ['ranking', T('ranking.loading'), false, [], true]);
    });
    await check('ランキング：上位の表が届いたら一覧を描いて状態を隠す（名前が無ければ自分の行も隠す）', async () => {
        await waitRankingLoaded(engine);
        same([el(engine, 'ranking-status').hidden, listTexts(engine)], [true, [['1位', 'たろう', '384,210点'], ['2位', '<b>はなこ</b>', '0点']]]);
        same([el(engine, 'ranking-my-best').hidden, textOf(engine, 'ranking-my-best')], [true, '']);
    });
}
async function checkRankingMine(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '順位の人');
    await check('ランキング：記録が無ければ自分の行は ranking.myNone', async () => {
        fire(engine, 'title-ranking-button', 'click');
        await waitRankingLoaded(engine);
        same([textOf(engine, 'ranking-my-best'), el(engine, 'ranking-my-best').hidden], [T('ranking.myNone'), false]);
    });
    await check('ランキング：自己ベストがあれば ranking.myBest（順位・参加人数）、自分の行を目立たせる', async () => {
        const [item] = await openRuns(engine, account, 1);
        await makeApi(engine).finishRun(account.deviceKey, item.runId, { value: 11384, cleared: true, detail: null });
        fire(engine, 'title-ranking-button', 'click');
        await waitRankingLoaded(engine);
        same(textOf(engine, 'ranking-my-best'), T('ranking.myBest', { best: points(11384), rank: 2, participants: 3 }));
        const mine = el(engine, 'ranking-list').children.find(row => row.className === 'ranking-row is-me');
        same(mine && mine.children.map(cell => cell.textContent), ['2位', '順位の人（あなた）', '11,384点']);
    });
}
async function checkRankingUnregistered(mock) {
    const unregistered = makeEngine(mock);
    setName(unregistered, '未登録の人');
    await check('ランキング：名前はあるが未登録（登録が届かない）なら ranking.unregistered', async () => {
        await mock.fail({ count: 1, mode: 'drop' });
        fire(unregistered, 'title-ranking-button', 'click');
        await waitRankingLoaded(unregistered);
        same([textOf(unregistered, 'ranking-my-best'), el(unregistered, 'ranking-status').hidden], [T('ranking.unregistered'), true]);
    });
}
async function checkRankingFailure(mock) {
    const engine = makeEngine(mock);
    await check('ランキング：上位の表が読めなければ一覧は空で ranking.loadFailed', async () => {
        await mock.fail({ count: 1, mode: 'status', status: 500, error: 'server' });
        fire(engine, 'title-ranking-button', 'click');
        await waitRankingLoaded(engine);
        same([textOf(engine, 'ranking-status'), el(engine, 'ranking-status').hidden, listTexts(engine), el(engine, 'ranking-my-best').hidden],
            [T('ranking.loadFailed', { reason: reasonOf('server') }), false, [], true]);
    });
    const offline = makeOfflineEngine();
    await check('ランキング：API が offline なら ranking.loadFailed（つながらない）', async () => {
        fire(offline, 'title-ranking-button', 'click');
        await waitRankingLoaded(offline);
        same(textOf(offline, 'ranking-status'), T('ranking.loadFailed', { reason: reasonOf('offline') }));
    });
}
async function checkRankingStale(mock) {
    const engine = makeEngine(mock, { timeoutMs: SHORT_TIMEOUT_MS });
    await check('ランキング：閉じた後に届いた返事は捨てる', async () => {
        const before = await requestCount(mock);
        fire(engine, 'title-ranking-button', 'click');
        fire(engine, 'ranking-close-button', 'click');
        await waitForRequests(mock, before + 1);
        await settle();
        same([screenOf(engine), textOf(engine, 'ranking-status'), listTexts(engine)], ['title', T('ranking.loading'), []]);
    });
    await checkRankingReopened(mock, engine);
}
async function checkRankingReopened(mock, engine) {
    await check('ランキング：開き直した後に届いた古い返事は捨てる', async () => {
        await mock.rows([{ name: '新しい返事', best: 5 }]);
        await mock.fail({ count: 1, mode: 'hang' });
        const before = await requestCount(mock);
        fire(engine, 'title-ranking-button', 'click');
        await waitForRequests(mock, before + 1);
        engine.run("openRanking('title')");
        await waitRankingLoaded(engine);
        await delay(SHORT_TIMEOUT_MS + TIMEOUT_MARGIN_MS);
        same([el(engine, 'ranking-status').hidden, listTexts(engine).length > 0], [true, true]);
    });
}
async function checkRankingSyncAndPending(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '開くたび');
    await check('ランキング：開くたびに名前を同期し、送り残しを送る', async () => {
        engine.account.writePendingFinish(await openRuns(engine, account, 1));
        setName(engine, '開くたび二');
        fire(engine, 'title-ranking-button', 'click');
        await waitRankingLoaded(engine);
        same([engine.account.readPendingFinish(), accountOf(engine).serverName, textOf(engine, 'ranking-player-text')], [[], '開くたび二', 'あなた：開くたび二']);
    });
}
async function checkRanking(mock) {
    await mock.reset();
    await mock.config({ minSec: 0 });
    await checkRankingRows(mock);
    await checkRankingMine(mock);
    await checkRankingUnregistered(mock);
    await checkRankingFailure(mock);
    await checkRankingStale(mock);
    await checkRankingSyncAndPending(mock);
}

async function checkCodeSection(mock, engine) {
    await check('コード：未登録なら欄を出さない（引き継ぐ欄は出す）', () => {
        fire(engine, 'title-name-button', 'click');
        same([screenOf(engine), el(engine, 'account-code-section').hidden, el(engine, 'recover-form').hidden], ['account', true, false]);
    });
    const account = await register(engine, mock, 'コードの人');
    await check('コード：登録済みなら欄を出し、今のコードを表示する', () => {
        fire(engine, 'title-name-button', 'click');
        same([el(engine, 'account-code-section').hidden, textOf(engine, 'account-code-value') === account.transferCode], [false, true]);
        same([textOf(engine, 'account-code-reissue-button'), el(engine, 'account-code-notice').hidden], [T('code.reissue'), true]);
    });
    await check('コード：登録済みでもコードが無ければ code.none', () => {
        engine.account.writeAccount({ transferCode: null });
        fire(engine, 'title-name-button', 'click');
        same(textOf(engine, 'account-code-value'), T('code.none'));
        engine.account.writeAccount({ transferCode: account.transferCode });
    });
    return account;
}
async function copyNotice(engine) {
    fire(engine, 'title-name-button', 'click');
    fire(engine, 'account-code-copy-button', 'click');
    return waitFor('コピーの知らせ', () => (el(engine, 'account-code-notice').hidden ? null : textOf(engine, 'account-code-notice')));
}
async function checkCodeCopy(engine, account) {
    await check('コード：navigator.clipboard が無ければ code.copyFailed', async () => same(await copyNotice(engine), T('code.copyFailed')));
    const copied = [];
    await check('コード：コピーできたら code.copied（コードを書き込む）', async () => {
        engine.context.navigator = { clipboard: { writeText: async text => { copied.push(text); } } };
        same(await copyNotice(engine), T('code.copied'));
        assert.ok(copied.length === 1 && copied[0] === account.transferCode, 'コードを書き込んでいない');
    });
    await check('コード：書き込みに失敗したら code.copyFailed', async () => {
        engine.context.navigator = { clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } };
        same(await copyNotice(engine), T('code.copyFailed'));
    });
}
async function checkCodeReissue(mock, engine, account) {
    await check('コード：出し直すの 1 回目は注意とボタンの確定だけで、送らない', async () => {
        fire(engine, 'title-name-button', 'click');
        const before = await requestCount(mock);
        fire(engine, 'account-code-reissue-button', 'click');
        same([textOf(engine, 'account-code-reissue-button'), textOf(engine, 'account-code-notice')], [T('code.reissueConfirm'), T('code.reissueWarn')]);
        await expectNoRequests(mock, before);
    });
    await check('コード：2 回目で出し直し、新しいコードを保存して表示する（前のコードは使えなくなる）', async () => {
        fire(engine, 'account-code-reissue-button', 'click');
        same([textOf(engine, 'account-code-notice'), accountBusy(engine)], [T('account.sending'), [true, true, true, true, true]]);
        await waitFor('出し直しの返事', () => textOf(engine, 'account-code-notice') !== T('account.sending'));
        const after = accountOf(engine);
        same([textOf(engine, 'account-code-notice'), textOf(engine, 'account-code-reissue-button'), accountBusy(engine)], [T('code.reissued'), T('code.reissue'), [false, false, false, false, false]]);
        assert.ok(CODE_PATTERN.test(after.transferCode) && after.transferCode !== account.transferCode && textOf(engine, 'account-code-value') === after.transferCode);
        same(plain(await makeApi(engine).recover(account.transferCode)).error, 'code_not_found');
    });
    await checkCodeReissueUncertain(mock, engine);
    await checkCodeReissueSaveFailure(engine);
}
async function reissueOnScreen(engine) {
    fire(engine, 'account-code-reissue-button', 'click');
    fire(engine, 'account-code-reissue-button', 'click');
    return waitFor('出し直しの返事', () => (textOf(engine, 'account-code-notice') === T('account.sending') ? null : textOf(engine, 'account-code-notice')));
}
function codeStoredAndShown(engine, code) {
    return [accountOf(engine).transferCode === code, textOf(engine, 'account-code-value') === code];
}
const UNCERTAIN_REISSUE_FAILURES = [...RETRYABLE_FAILURES, ['2xx なのに recoveryCode が無い', { mode: 'status', status: HTTP_OK }, 'bad_reply']];
async function checkCodeReissueUncertain(mock, engine) {
    await UNCERTAIN_REISSUE_FAILURES.reduce(async (previous, [label, failure, error]) => {
        await previous;
        await check(`コード：出し直せたか分からない失敗（${label}）は理由つきの code.reissueUnknown で、保存済み・表示中のコードはそのまま`, async () => {
            const before = accountOf(engine).transferCode;
            await mock.fail({ count: 1, ...failure });
            same(await reissueOnScreen(engine), T('code.reissueUnknown', { reason: reasonOf(error) }));
            same(codeStoredAndShown(engine, before), [true, true]);
        });
    }, Promise.resolve());
}
async function checkCodeReissueLost(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '返事が途切れる人');
    await check('コード：窓口で出し直した後に返事が途切れたら code.reissueUnknown（つながらない）で、コードは前のまま（窓口ではもう使えない）。もう一度出し直せば新しいコードを保存して表示する', async () => {
        fire(engine, 'title-name-button', 'click');
        await mock.fail({ count: 1, mode: 'lost' });
        same(await reissueOnScreen(engine), T('code.reissueUnknown', { reason: reasonOf('network') }));
        same(codeStoredAndShown(engine, account.transferCode), [true, true]);
        same(plain(await makeApi(engine).recover(account.transferCode)).error, 'code_not_found');
        same(await reissueOnScreen(engine), T('code.reissued'));
        await expectNewUsableCode(engine, account);
    });
}
async function expectNewUsableCode(engine, account) {
    const code = accountOf(engine).transferCode;
    assert.ok(CODE_PATTERN.test(code) && code !== account.transferCode && textOf(engine, 'account-code-value') === code, '新しいコードを保存・表示していない');
    const recovered = plain(await makeApi(engine).recover(code));
    remember(recovered.data && recovered.data.deviceKey);
    same([recovered.status, recovered.data && recovered.data.playerId === account.playerId], [HTTP_OK, true]);
}
async function checkCodeReissueRefused(mock) {
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '鍵が使えない人');
    await check('コード：送り直さない失敗（鍵が使えない bad_key）は code.reissueFailed のままで、鍵を消し、保存済み・表示中のコードはそのまま', async () => {
        fire(engine, 'title-name-button', 'click');
        engine.account.writeAccount({ deviceKey: 'bogus-key-for-test' });
        same(await reissueOnScreen(engine), T('code.reissueFailed', { reason: reasonOf('bad_key') }));
        same([accountOf(engine).deviceKey, ...codeStoredAndShown(engine, account.transferCode)], [null, true, true]);
    });
}
async function expectReissueRefusedWithoutSending(mock, engine, online, error) {
    const before = { code: accountOf(engine).transferCode, requests: await requestCount(mock) };
    same(await online.reissueCode(), { ok: false, code: null, message: T('code.reissueFailed', { reason: reasonOf(error) }) });
    await expectNoRequests(mock, before.requests);
    assert.ok(accountOf(engine).transferCode === before.code, '保存済みのコードが変わった');
}
async function checkCodeReissueNoKey(mock) {
    const engine = makeEngine(mock);
    await register(engine, mock, '鍵が無い人');
    await check('コード：端末に鍵が無い失敗（no_key）は送らずに code.reissueFailed のままで、保存済みのコードはそのまま', async () => {
        engine.account.writeAccount({ deviceKey: null });
        await expectReissueRefusedWithoutSending(mock, engine, engine.online, 'no_key');
    });
}
async function checkCodeReissueOffline(mock) {
    const engine = makeEngine(mock);
    await register(engine, mock, 'つながらない人');
    const { online } = makeDirectOnline(engine, { api: makeApi(engine, { offline: true }) });
    await check('コード：API が offline の失敗は送らずに code.reissueFailed のままで、保存済みのコードはそのまま', () => expectReissueRefusedWithoutSending(mock, engine, online, 'offline'));
}
async function reissueWithAccountWriteFailing(engine) {
    fire(engine, 'title-name-button', 'click');
    fire(engine, 'account-code-reissue-button', 'click');
    const restoreStorage = failStorageWrites(engine, 'gelpiyo-account');
    try {
        fire(engine, 'account-code-reissue-button', 'click');
        await waitFor('出し直しの返事', () => textOf(engine, 'account-code-notice') !== T('account.sending'));
    } finally {
        restoreStorage();
    }
    const shown = textOf(engine, 'account-code-value');
    remember(shown);
    return shown;
}
async function checkCodeReissueSaveFailure(engine) {
    await check('コード：出し直した後に端末へ保存できなければ、その文言で新しいコードを出し続け、「コピー」も表示中のコードを書き込む', async () => {
        const shown = await reissueWithAccountWriteFailing(engine);
        same(textOf(engine, 'account-code-notice'), ACCOUNT_SAVE_FAILED);
        assert.ok(CODE_PATTERN.test(shown) && shown !== accountOf(engine).transferCode, '新しいコードを出していない');
        const copied = [];
        engine.context.navigator = { clipboard: { writeText: async text => { copied.push(text); } } };
        fire(engine, 'account-code-copy-button', 'click');
        await waitFor('コピーの知らせ', () => textOf(engine, 'account-code-notice') !== ACCOUNT_SAVE_FAILED);
        same(textOf(engine, 'account-code-notice'), T('code.copied'));
        assert.ok(copied.length === 1 && copied[0] === shown, '表示中のコードを書き込んでいない');
    });
}
async function checkTransferCode(mock) {
    await mock.reset();
    const engine = makeEngine(mock);
    const account = await checkCodeSection(mock, engine);
    await checkCodeCopy(engine, account);
    await checkCodeReissue(mock, engine, account);
    await checkCodeReissueLost(mock);
    await checkCodeReissueRefused(mock);
    await checkCodeReissueNoKey(mock);
    await checkCodeReissueOffline(mock);
}

async function submitRecover(engine, rawCode) {
    el(engine, 'recover-code-input').value = rawCode;
    fire(engine, 'recover-form', 'submit');
    fire(engine, 'recover-form', 'submit');
    return waitFor('引き継ぎの返事', () => (textOf(engine, 'recover-notice') === T('account.sending') ? null : textOf(engine, 'recover-notice')));
}
async function recoverOnScreen(engine, rawCode) {
    fire(engine, 'title-name-button', 'click');
    return submitRecover(engine, rawCode);
}
const SOURCE_HISTORY = [{ finishedAt: 1794200000000, summary: '先攻の勝ち！', rows: [['盤面サイズ', '9 × 9'], ['総合判定', '12 vs 8']] }];
const OWN_HISTORY = [{ finishedAt: 1794300000000, summary: '後攻の勝ち！', rows: [['盤面サイズ', '9 × 9'], ['総合判定', '7 vs 13']] }];
const RECOVER_STORAGE_KEYS = ['gelpiyo-theme', 'gelpiyo-result-history', 'gelpiyo-suspended-game', 'gelpiyo-account'];
async function prepareSource(mock) {
    const source = makeEngine(mock);
    const account = await register(source, mock, '引き継ぎ元');
    source.storage.setItem('gelpiyo-theme', 'dark');
    source.storage.setItem('gelpiyo-result-history', JSON.stringify(SOURCE_HISTORY));
    source.storage.setItem('gelpiyo-suspended-game', JSON.stringify(makeWebGame({ runId: 'rsource', startedAt: null, error: null })));
    await source.online.backup();
    assert.ok(JSON.parse((await mock.saveOf(account.deviceKey)).data).theme === 'dark', '引き継ぎ元の控えが届いていない');
    return { source, account };
}
async function checkRecoverConfirm(mock, target, account) {
    await check('引き継ぎ：1 回目は確かめの文言とボタンの確定だけで、送らない', async () => {
        fire(target, 'title-name-button', 'click');
        el(target, 'recover-code-input').value = account.transferCode.toLowerCase().replace(/-/g, ' ');
        const before = await requestCount(mock);
        fire(target, 'recover-form', 'submit');
        same([textOf(target, 'recover-notice'), textOf(target, 'recover-button')], [T('recover.confirmText'), T('recover.confirm')]);
        await expectNoRequests(mock, before);
    });
    await check('引き継ぎ：コードを書き換えたら確かめをやり直す', () => {
        fire(target, 'recover-code-input', 'input');
        same([textOf(target, 'recover-button'), el(target, 'recover-notice').hidden], [T('recover.button'), true]);
    });
    await checkRecoverInvalidCode(mock, target);
}
async function checkRecoverInvalidCode(mock, target) {
    await check('引き継ぎ：英数字12文字でないコードはその文言で、送らない', async () => {
        const before = await requestCount(mock);
        el(target, 'recover-code-input').value = 'ABC';
        fire(target, 'recover-form', 'submit');
        same([textOf(target, 'recover-notice'), textOf(target, 'recover-button')], ['引き継ぎコードは英数字12文字です。', T('recover.button')]);
        await expectNoRequests(mock, before);
    });
}
async function checkRecoverRestores(mock, source, target, account) {
    await check('引き継ぎ：2 回目で引き継ぎ、控えで置き換えてアカウントを保存する（待つ間は押せない）', async () => {
        el(target, 'recover-code-input').value = account.transferCode.toLowerCase().replace(/-/g, ' ');
        fire(target, 'recover-form', 'submit');
        fire(target, 'recover-form', 'submit');
        same([textOf(target, 'recover-notice'), accountBusy(target)], [T('account.sending'), [true, true, true, true, true]]);
        await waitFor('引き継ぎの返事', () => textOf(target, 'recover-notice') !== T('account.sending'));
        same([textOf(target, 'recover-notice'), accountBusy(target)], [T('recover.done'), [false, false, false, false, false]]);
        const after = accountOf(target);
        same([after.name, after.serverName, after.playerId, after.transferCode === account.transferCode, after.deviceKey !== account.deviceKey], ['引き継ぎ元', '引き継ぎ元', account.playerId, true, true]);
    });
    await check('引き継ぎ：テーマ・記録・中断データが引き継ぎ元のものになり、名前の表示も描き直す', () => {
        same(['gelpiyo-theme', 'gelpiyo-result-history', 'gelpiyo-suspended-game'].map(key => target.storage.getItem(key)), ['gelpiyo-theme', 'gelpiyo-result-history', 'gelpiyo-suspended-game'].map(key => source.storage.getItem(key)));
        same([textOf(target, 'title-player-name'), el(target, 'account-name-input').value, el(target, 'account-code-section').hidden], ['プレイヤー名：引き継ぎ元', '引き継ぎ元', false]);
        assert.ok(textOf(target, 'account-code-value') === account.transferCode);
    });
    await check('引き継ぎ：引き継ぎ元の端末の鍵は使えなくなる', async () => same(plain(await makeApi(target).myEntry(account.deviceKey)).error, 'bad_key'));
}
async function putSaveAs(engine, key, snapshotText) {
    assert.ok(plain(await makeApi(engine).putSave(key, snapshotText)).ok, '控えを置けなかった');
}
async function freshPlayer(engine, name) {
    const registered = plain(await makeApi(engine).register(name));
    remember(registered.data.deviceKey, registered.data.recoveryCode);
    return registered.data;
}
async function checkRecoverSaveKinds(mock, source) {
    const godotSnapshot = { app: 'gelpiyo-territory', schema: 1, platform: 'godot', createdAt: 1, theme: 'light', history: [], suspended: { platform: 'godot', game: { version: 1 } } };
    const player = await freshPlayer(source, '別の機種');
    await putSaveAs(source, player.deviceKey, JSON.stringify(godotSnapshot));
    await check('引き継ぎ：別の機種で中断した対局は捨て、その旨を 1 行で続ける', async () => {
        const target = makeEngine(mock);
        same(await recoverOnScreen(target, player.recoveryCode), T('recover.done') + T('recover.suspendedDropped'));
        same([target.storage.getItem('gelpiyo-theme'), target.storage.getItem('gelpiyo-suspended-game')], ['light', null]);
    });
    const noSave = await freshPlayer(source, '控えなし');
    await check('引き継ぎ：控えが無ければ端末のデータはそのままで、アカウントだけ保存する', async () => {
        const target = makeEngine(mock);
        target.storage.setItem('gelpiyo-theme', 'dark');
        same(await recoverOnScreen(target, noSave.recoveryCode), T('recover.doneNoSave'));
        same([target.storage.getItem('gelpiyo-theme'), accountOf(target).playerId, accountOf(target).name], ['dark', noSave.playerId, '控えなし']);
    });
}
const REFUSED_SAVES = [
    ['別のアプリ（GELPIYO WORLD）の控え', JSON.stringify({ app: 'gelpiyo-world', schema: 1, data: {} }), T('recover.otherApp')],
    ['オブジェクトでない控え', '[1,2]', T('recover.otherApp')],
    ['新しい版の控え', JSON.stringify({ app: 'gelpiyo-territory', schema: 2 }), SNAPSHOT_MESSAGES.newer],
    ['形の違う控え', JSON.stringify({ app: 'gelpiyo-territory', schema: '1' }), SNAPSHOT_MESSAGES.badShape]
];
async function checkRecoverRefusals(mock, source) {
    await REFUSED_SAVES.reduce(async (previous, [label, saveText, message]) => {
        await previous;
        const player = await freshPlayer(source, '断られる');
        await putSaveAs(source, player.deviceKey, saveText);
        await check(`引き継ぎ：${label}は読み込まず、鍵も保存しない`, async () => {
            const target = makeEngine(mock);
            setName(target, 'この端末の人');
            target.storage.setItem('gelpiyo-theme', 'light');
            const before = target.storage.getItem('gelpiyo-account');
            same(await recoverOnScreen(target, player.recoveryCode), message);
            same([target.storage.getItem('gelpiyo-account') === before, target.storage.getItem('gelpiyo-theme')], [true, 'light']);
        });
    }, Promise.resolve());
}
async function checkRecoverWriteFailure(mock, source, account) {
    await check('引き継ぎ：控えを端末に書き込めなければ、その文言で鍵も保存しない', async () => {
        const target = makeEngine(mock);
        failStorageWrites(target, 'gelpiyo-theme');
        same(await recoverOnScreen(target, account.transferCode), SNAPSHOT_MESSAGES.restoreFailed);
        same(accountOf(target).deviceKey, null);
    });
}
async function prepareOwnPlayer(mock) {
    const target = makeEngine(mock);
    const own = await register(target, mock, '元のプレイヤー');
    target.storage.setItem('gelpiyo-theme', 'light');
    target.storage.setItem('gelpiyo-result-history', JSON.stringify(OWN_HISTORY));
    return { target, own };
}
async function checkRecoverAccountWriteFailure(mock, account) {
    const { target, own } = await prepareOwnPlayer(mock);
    await check('引き継ぎ：控えは書けたがアカウントを保存できなければ、端末のテーマ・記録・中断データを元に戻し、鍵も保存しない', async () => {
        const before = RECOVER_STORAGE_KEYS.map(key => target.storage.getItem(key));
        const restoreStorage = failStorageWrites(target, 'gelpiyo-account');
        try {
            same(await recoverOnScreen(target, account.transferCode), ACCOUNT_SAVE_FAILED);
        } finally {
            restoreStorage();
        }
        same([RECOVER_STORAGE_KEYS.filter((key, index) => target.storage.getItem(key) !== before[index]), target.doc.documentElement.dataset.theme], [[], 'light']);
        await target.online.backup();
        const saved = JSON.parse((await mock.saveOf(own.deviceKey)).data);
        same([saved.theme, saved.history.map(entry => entry.summary)], ['light', OWN_HISTORY.map(entry => entry.summary)]);
    });
}
async function checkRecoverClearsNameLines(mock, source) {
    const player = await freshPlayer(source, '引き継ぐ名前');
    await check('引き継ぎ：成功したら、前の名前についての失敗の行と名前のエラーの行を消す', async () => {
        const target = makeEngine(mock);
        fire(target, 'title-name-button', 'click');
        await mock.fail({ count: 1, mode: 'drop' });
        submitName(target, '届かない名前');
        await waitFor('同期の返事', () => textOf(target, 'account-status') !== T('account.sending'));
        submitName(target, 'a'.repeat(target.account.NAME_MAX_LENGTH + 1));
        same([el(target, 'account-status').hidden, el(target, 'account-name-error').hidden], [false, false]);
        same(await submitRecover(target, player.recoveryCode), T('recover.doneNoSave'));
        same([el(target, 'account-status').hidden, el(target, 'account-name-error').hidden, el(target, 'account-name-input').value], [true, true, '引き継ぐ名前']);
    });
}
async function checkRecoverBadCode(engine) {
    const api = { offline: false, recover: async () => engine.context.GelpiyoServer.failure(400, 'bad_code') };
    const { online } = makeDirectOnline(engine, { api });
    await check('引き継ぎ：窓口が bad_code なら recover.failed（引き継ぎコードが正しくない）', async () => {
        same(await online.recover('ABCD-EFGH-JK23'), { ok: false, message: T('recover.failed', { reason: reasonOf('bad_code') }) });
    });
}
async function checkRecoverFailures(mock, source) {
    await checkRecoverBadCode(source);
    await check('引き継ぎ：見つからないコードは recover.failed（code_not_found）', async () => {
        same(await recoverOnScreen(makeEngine(mock), 'ZZZZ-ZZZZ-ZZZZ'), T('recover.failed', { reason: reasonOf('code_not_found') }));
    });
    await mock.config({ recoverLimit: 1 });
    await check('引き継ぎ：試しすぎは recover.failed（too_many）', async () => {
        await recoverOnScreen(makeEngine(mock), 'ZZZZ-ZZZZ-ZZZY');
        same(await recoverOnScreen(makeEngine(mock), 'ZZZZ-ZZZZ-ZZZX'), T('recover.failed', { reason: reasonOf('too_many') }));
    });
}
async function checkRecover(mock) {
    await mock.reset();
    await mock.config({ recoverLimit: HIGH_RECOVER_LIMIT });
    const { source, account } = await prepareSource(mock);
    const target = makeEngine(mock);
    target.storage.setItem('gelpiyo-theme', 'light');
    await checkRecoverConfirm(mock, target, account);
    await checkRecoverRestores(mock, source, target, account);
    const latest = accountOf(target);
    await checkRecoverSaveKinds(mock, source);
    await checkRecoverRefusals(mock, source);
    await checkRecoverWriteFailure(mock, source, latest);
    await checkRecoverAccountWriteFailure(mock, latest);
    await checkRecoverClearsNameLines(mock, source);
    await mock.reset();
    await checkRecoverFailures(mock, source);
}

const BYTE_SAMPLES = ['', 'a', '\u007f', '\u0080', '\u07ff', '\u0800', '\uffff', 'ぴよ', PIYO, `a${PIYO}あé`, '\ud800', '\udc00x', `\ud83d${PIYO}\udfff`, '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}', 'Ａ１－ｚ'];
async function checkByteLength(mock) {
    const engine = makeEngine(mock);
    await check('UTF-8 のバイト数を自前で数える（Buffer.byteLength と同じ。対にならないサロゲートは 3 バイト）', () => {
        const random = Array.from({ length: 50 }, (_, index) => Array.from({ length: index }, (__, offset) => String.fromCharCode((index * 7919 + offset * 104729) % 65536)).join(''));
        [...BYTE_SAMPLES, ...random].forEach(text => assert.strictEqual(engine.context.GelpiyoOnline.utf8ByteLength(text), Buffer.byteLength(text, 'utf8'), JSON.stringify(text)));
    });
}
async function checkBackupDedupe(mock, engine, account) {
    const { online } = makeDirectOnline(engine);
    await check('控え：前に送れた中身と同じなら送らない（作った時刻 createdAt の違いは中身に数えない）', async () => {
        const before = await requestCount(mock);
        await online.backup();
        await online.backup();
        await settle();
        assert.strictEqual(await requestCount(mock), before + 1);
    });
    await check('控え：中身が変われば送る', async () => {
        const before = await requestCount(mock);
        engine.storage.setItem('gelpiyo-theme', 'dark');
        await online.backup();
        assert.strictEqual(await requestCount(mock), before + 1);
        same(JSON.parse((await mock.saveOf(account.deviceKey)).data).theme, 'dark');
    });
}
async function checkBackupLatestWins(mock, engine, account) {
    const { online } = makeDirectOnline(engine);
    await check('控え：同時に 1 つだけ送り、送っている間に頼まれた分は終わってから最新を 1 回だけ送る', async () => {
        engine.storage.setItem('gelpiyo-theme', 'light');
        const before = await requestCount(mock);
        const first = online.backup();
        engine.storage.setItem('gelpiyo-theme', 'dark');
        const second = online.backup();
        engine.storage.setItem('gelpiyo-result-history', JSON.stringify(SOURCE_HISTORY));
        const third = online.backup();
        await Promise.all([first, second, third]);
        await settle();
        assert.strictEqual(await requestCount(mock), before + 2);
        const saved = JSON.parse((await mock.saveOf(account.deviceKey)).data);
        same([saved.theme, saved.history.length], ['dark', 1]);
    });
}
function sizedSnapshot(bytes) {
    const base = { app: 'gelpiyo-territory', schema: 1, platform: 'web', createdAt: 0, theme: null, history: [], suspended: null, pad: '' };
    const room = bytes - Buffer.byteLength(JSON.stringify(base), 'utf8') - Buffer.byteLength(PIYO.repeat(PIYO_PAD_COUNT), 'utf8');
    const wide = Math.floor(room / WIDE_CHAR_BYTES);
    return { ...base, pad: PIYO.repeat(PIYO_PAD_COUNT) + 'あ'.repeat(wide) + 'a'.repeat(room - wide * WIDE_CHAR_BYTES) };
}
async function checkBackupSizeLimit(mock, engine, account) {
    const size = { bytes: SAVE_LIMIT_BYTES };
    const { online } = makeDirectOnline(engine, { snapshot: { collect: () => sizedSnapshot(size.bytes), restore: () => ({ ok: true }) } });
    await check('控え：UTF-8 で 512 KiB ちょうどなら送る', async () => {
        assert.strictEqual(Buffer.byteLength(JSON.stringify(sizedSnapshot(size.bytes)), 'utf8'), SAVE_LIMIT_BYTES);
        await online.backup();
        same((await mock.state()).saves[account.playerId].size, SAVE_LIMIT_BYTES);
    });
    await check('控え：512 KiB を 1 バイトでも超えたら送らず、警告を出す', async () => {
        size.bytes = SAVE_LIMIT_BYTES + 1;
        const before = await requestCount(mock);
        await online.backup();
        await expectNoRequests(mock, before);
        assert.ok(hasWarning(engine, String(SAVE_LIMIT_BYTES + 1)), '警告が出ていない');
    });
}
function flipTheme(engine) {
    engine.storage.setItem('gelpiyo-theme', engine.storage.getItem('gelpiyo-theme') === 'dark' ? 'light' : 'dark');
}
async function checkBackupRetry(mock, engine, account) {
    const { online, timer } = makeDirectOnline(engine);
    await check('控え：送り直してよい失敗なら 60 秒後にもう一度（タイマーは 1 つだけ）', async () => {
        await mock.fail({ count: 1, mode: 'status', status: 503, error: 'server' });
        await online.backup();
        same([...timer.pending.values()].map(entry => entry.ms), [BACKUP_RETRY_MS]);
        flipTheme(engine);
        await mock.fail({ count: 1, mode: 'drop' });
        await online.backup();
        same(timer.pending.size, 1);
        assert.ok(hasWarning(engine, '（server）'), '失敗の警告が出ていない');
    });
    await check('控え：タイマーが鳴ったら最新の中身を送り直す', async () => {
        const before = await requestCount(mock);
        timer.fireAll();
        await waitForRequests(mock, before + 1);
        await settle();
        same([timer.pending.size, JSON.parse((await mock.saveOf(account.deviceKey)).data).theme], [0, engine.storage.getItem('gelpiyo-theme')]);
    });
}
async function checkBackupNoRetry(mock, engine) {
    const { online, timer } = makeDirectOnline(engine);
    await check('控え：送り直さない失敗（4xx の断り）ではタイマーを掛けない', async () => {
        flipTheme(engine);
        await mock.fail({ count: 1, mode: 'status', status: 400, error: 'bad_data' });
        await online.backup();
        same(timer.pending.size, 0);
    });
}
async function checkBackupSkips(mock) {
    const engine = makeEngine(mock);
    setName(engine, '控えなし');
    await check('控え：未登録なら送らない', async () => {
        const before = await requestCount(mock);
        await makeDirectOnline(engine).online.backup();
        await expectNoRequests(mock, before);
    });
    const calls = [];
    const offlineApi = { offline: true, putSave: async (...args) => { calls.push(args); return OFFLINE_RESULT; } };
    await check('控え：API が offline なら送らない', async () => {
        engine.account.writeAccount({ deviceKey: 'offline-key', playerId: 'p-offline' });
        await makeDirectOnline(engine, { api: offlineApi }).online.backup();
        same(calls.length, 0);
    });
}
async function checkBackupBadKey(mock, engine) {
    const { online, timer } = makeDirectOnline(engine);
    await check('控え：鍵が使えなければ鍵を消し、送り直さない', async () => {
        engine.account.writeAccount({ deviceKey: 'bogus-key-for-test' });
        await online.backup();
        same([accountOf(engine).deviceKey, timer.pending.size], [null, 0]);
    });
}
async function checkBackup(mock) {
    await mock.reset();
    await checkByteLength(mock);
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '控えの人');
    await checkBackupDedupe(mock, engine, account);
    await checkBackupLatestWins(mock, engine, account);
    await checkBackupSizeLimit(mock, engine, account);
    await checkBackupRetry(mock, engine, account);
    await checkBackupNoRetry(mock, engine);
    await checkBackupBadKey(mock, engine);
    await checkBackupSkips(mock);
}

const SETUP_VALUES = { playerColor: 'black', opponent: 'ai', aiLevel: 'hard', showGuide: 'on' };
function useSetupForm(engine, values) {
    engine.context.FormData = function FakeFormData() {
        return { get: key => (key in values ? values[key] : null) };
    };
    el(engine, 'setup-form').queries['input[name="boardKind"]:checked'] = { value: 'simple' };
    el(engine, 'simple-size-select').value = '9';
    el(engine, 'event-map-select').value = '0';
}
function submitSetup(engine) {
    engine.run("showScreen('setup')");
    fire(engine, 'setup-form', 'submit');
}
function gateView(engine) {
    return ['account-gate-text', 'account-gate-back-button', 'account-gate-skip-button', 'account-close-button', 'account-submit-button', 'account-code-section', 'recover-form'].map(id => !el(engine, id).hidden);
}
async function checkGateOpens(mock, engine) {
    const session = engine.run('gameSession');
    await check('勧め：AI 戦で名前が無ければ、始める前に名前の画面を対局前の形で開く', () => {
        submitSetup(engine);
        same([screenOf(engine), engine.run('accountMode'), gateView(engine)], ['account', 'gate', [true, true, true, false, true, false, false]]);
        same([engine.run('gameSession'), engine.run('gameStarted'), plain(engine.run('gameConfig')).aiLevel], [session, false, 'normal']);
    });
    await check('勧め：「戻る」で設定の画面へ戻り、対局は始めない', () => {
        fire(engine, 'account-gate-back-button', 'click');
        same([screenOf(engine), engine.run('gameSession'), engine.run('gameStarted')], ['setup', session, false]);
    });
}
async function checkGateChoices(mock, engine) {
    await check('勧め：名前が正しくなければエラーを出して留まる', () => {
        submitSetup(engine);
        el(engine, 'account-name-input').value = '　';
        fire(engine, 'account-form', 'submit');
        same([screenOf(engine), textOf(engine, 'account-name-error'), engine.run('gameStarted')], ['account', '名前を入力してください。', false]);
    });
    await check('勧め：「決めずに始める」で選んだ設定のまま始める（札は no_name で送らない）', async () => {
        const before = await requestCount(mock);
        fire(engine, 'account-gate-skip-button', 'click');
        const config = plain(engine.run('gameConfig'));
        same([screenOf(engine), engine.run('gameStarted'), config.aiLevel, config.boardSize, config.humanColor], ['game', true, 'hard', 9, FIRST]);
        same(ticketOf(engine), { ...NO_TICKET, error: 'no_name' });
        await expectNoRequests(mock, before);
    });
}
async function checkGateHidesCode(mock) {
    const engine = makeEngine(mock);
    useSetupForm(engine, SETUP_VALUES);
    engine.account.writeAccount({ name: '', playerId: 'p-gate', deviceKey: 'gate-key-for-test', transferCode: 'ABCD-EFGH-JK23' });
    await check('勧め：対局前の形では、登録済みでも引き継ぎコードの欄を出さない', () => {
        submitSetup(engine);
        same([screenOf(engine), engine.run('accountMode'), gateView(engine)], ['account', 'gate', [true, true, true, false, true, false, false]]);
    });
}
async function checkGateDecide(mock) {
    const engine = makeEngine(mock);
    useSetupForm(engine, SETUP_VALUES);
    await check('勧め：「決定」で名前を保存してすぐ始め、同期と札は裏で行う', async () => {
        submitSetup(engine);
        el(engine, 'account-name-input').value = ' 決めた人 ';
        fire(engine, 'account-form', 'submit');
        same([screenOf(engine), engine.run('gameStarted'), accountOf(engine).name, ticketOf(engine)], ['game', true, '決めた人', NO_TICKET]);
        assert.ok((await waitTicket(engine)).runId !== null);
        const account = accountOf(engine);
        assert.ok(engine.account.isRegistered(account));
        await waitForSave(mock, account.playerId);
    });
    await check('勧め：名前があれば名前の画面を出さずに始める', () => {
        submitSetup(engine);
        same(screenOf(engine), 'game');
    });
}
async function checkGateSkipsOthers(mock) {
    const engine = makeEngine(mock);
    useSetupForm(engine, { ...SETUP_VALUES, opponent: 'human' });
    await check('勧め：人間同士なら名前が無くても名前の画面を出さない', () => {
        submitSetup(engine);
        same([screenOf(engine), plain(engine.run('gameConfig')).opponent], ['game', 'human']);
    });
    useSetupForm(engine, SETUP_VALUES);
    await check('勧め：対局中に開いた名前の画面で「戻る」なら、対局中の設定は変わらない', () => {
        submitSetup(engine);
        fire(engine, 'account-gate-back-button', 'click');
        same([screenOf(engine), plain(engine.run('gameConfig')).opponent, engine.run('gameStarted')], ['setup', 'human', true]);
    });
    await checkGateNotOnRestart(engine);
}
async function checkGateNotOnRestart(engine) {
    await check('勧め：「最初から」「同じ設定で再戦」では名前を勧めない', () => {
        engine.run(AI_GAME);
        fire(engine, 'reset-button', 'click');
        same(screenOf(engine), 'game');
        fire(engine, 'result-restart-button', 'click');
        same([screenOf(engine), ticketOf(engine).error], ['game', 'no_name']);
    });
}
async function checkSetupGate(mock) {
    await mock.reset();
    const engine = makeEngine(mock);
    useSetupForm(engine, SETUP_VALUES);
    await checkGateOpens(mock, engine);
    await checkGateChoices(mock, engine);
    await checkGateHidesCode(mock);
    await checkGateDecide(mock);
    await checkGateSkipsOthers(mock);
}

function submitName(engine, name) {
    el(engine, 'account-name-input').value = name;
    fire(engine, 'account-form', 'submit');
}
async function checkNameRegister(mock, engine) {
    await check('名前の画面：初めての登録は送っている間押せず、成功したら閉じずにコードの欄と account.registered', async () => {
        fire(engine, 'title-name-button', 'click');
        submitName(engine, 'ぴよ太');
        same([textOf(engine, 'account-status'), accountBusy(engine)], [T('account.sending'), [true, true, true, true, true]]);
        await waitFor('同期の返事', () => textOf(engine, 'account-status') !== T('account.sending'));
        const account = accountOf(engine);
        same([textOf(engine, 'account-status'), screenOf(engine), accountBusy(engine), el(engine, 'account-code-section').hidden], [T('account.registered'), 'account', [false, false, false, false, false], false]);
        same([textOf(engine, 'account-code-value') === account.transferCode, textOf(engine, 'title-player-name')], [true, 'プレイヤー名：ぴよ太']);
        await waitForSave(mock, account.playerId);
    });
    await check('名前の画面：名前の変更が届いたら閉じて開いた画面へ戻る', async () => {
        fire(engine, 'account-close-button', 'click');
        fire(engine, 'title-name-button', 'click');
        submitName(engine, 'ぴよ次郎');
        await waitFor('閉じること', () => screenOf(engine) === 'title');
        same(accountOf(engine).serverName, 'ぴよ次郎');
    });
}
async function checkNameNoSync(mock, engine) {
    await check('名前の画面：同期が要らなければすぐ閉じる（送らない）', async () => {
        const before = await requestCount(mock);
        fire(engine, 'title-name-button', 'click');
        submitName(engine, 'ぴよ次郎');
        same(screenOf(engine), 'title');
        await expectNoRequests(mock, before);
    });
}
async function checkNameFailures(mock, engine) {
    await check('名前の画面：届かなければ留まって account.syncFailed（名前は端末に保存済み）', async () => {
        fire(engine, 'title-name-button', 'click');
        await mock.fail({ count: 1, mode: 'drop' });
        submitName(engine, 'ぴよ三郎');
        await waitFor('同期の返事', () => textOf(engine, 'account-status') !== T('account.sending'));
        same([textOf(engine, 'account-status'), screenOf(engine), accountBusy(engine)], [T('account.syncFailed', { reason: reasonOf('network') }), 'account', [false, false, false, false, false]]);
        same([accountOf(engine).name, accountOf(engine).serverName], ['ぴよ三郎', 'ぴよ次郎']);
    });
    await check('名前の画面：返事を待つ間に画面が閉じられたら、返事が来ても画面を移らない', async () => {
        await mock.fail({ count: 1, mode: 'hang' });
        submitName(engine, 'ぴよ四郎');
        engine.run("showScreen('title')");
        await delay(SHORT_TIMEOUT_MS + TIMEOUT_MARGIN_MS);
        same(screenOf(engine), 'title');
        fire(engine, 'title-name-button', 'click');
        same([el(engine, 'account-status').hidden, accountBusy(engine)], [true, [false, false, false, false, false]]);
    });
}
async function checkNameMovedAway(mock, engine) {
    await check('名前の画面：返事を待つ間に別の画面へ移ったら、名前の変更が届いても画面を移さず、何も書かない', async () => {
        fire(engine, 'title-name-button', 'click');
        submitName(engine, 'よそへ行く');
        engine.run("showScreen('setup')");
        await waitFor('名前の変更が届くこと', async () => (await mock.state()).names.includes('よそへ行く'));
        await settle();
        same([screenOf(engine), textOf(engine, 'account-status'), accountOf(engine).serverName], ['setup', T('account.sending'), 'よそへ行く']);
    });
}
async function checkNameInvalid(mock, engine) {
    await check('名前の画面：正しくない名前（21 文字・絵文字 11 個）はエラーを出して送らない', async () => {
        fire(engine, 'title-name-button', 'click');
        const before = await requestCount(mock);
        submitName(engine, 'a'.repeat(21));
        same(textOf(engine, 'account-name-error'), '名前は20文字までです。');
        submitName(engine, PIYO.repeat(11));
        same([textOf(engine, 'account-name-error'), screenOf(engine)], ['名前は20文字までです。', 'account']);
        await expectNoRequests(mock, before);
    });
}
async function checkNameReturns(mock, engine) {
    await check('名前の画面：ランキングから開いたら、名前を変えた後ランキングへ戻る', async () => {
        engine.run("openRanking('title')");
        fire(engine, 'ranking-name-button', 'click');
        submitName(engine, 'ぴよ五郎');
        await waitFor('ランキングへ戻ること', () => screenOf(engine) === 'ranking');
        await waitRankingLoaded(engine);
    });
    const offline = makeOfflineEngine();
    await check('名前の画面：API が offline ならすぐ閉じる', () => {
        fire(offline, 'title-name-button', 'click');
        submitName(offline, 'オフライン');
        same([screenOf(offline), accountOf(offline).name], ['title', 'オフライン']);
    });
}
async function checkNameJoinsRename(mock) {
    const engine = makeEngine(mock);
    await register(engine, mock, '前の名前A');
    const sent = recordSentNames(engine);
    try {
        await check('名前の画面：裏で走っている前の名前の同期に相乗りしたら、終わってから今の名前をもう一度送ってから閉じる', async () => {
            setName(engine, '裏の名前B');
            const background = engine.online.syncAccount();
            fire(engine, 'title-name-button', 'click');
            submitName(engine, '今の名前C');
            await waitFor('閉じること', () => screenOf(engine) === 'title');
            await background;
            const account = accountOf(engine);
            same([sent.names, account.serverName, engine.account.needsSync(account)], [['裏の名前B', '今の名前C'], '今の名前C', false]);
        });
    } finally {
        sent.restore();
    }
}
async function checkNameJoinsRegister(mock) {
    const engine = makeEngine(mock);
    const sent = recordSentNames(engine);
    try {
        await check('名前の画面：裏で走っている前の名前の登録に相乗りしたら、今の名前も送ってから account.registered とコードの欄を出す', async () => {
            setName(engine, '登録中の名前A');
            const background = engine.online.syncAccount();
            fire(engine, 'title-name-button', 'click');
            submitName(engine, '今の名前C');
            await waitFor('同期の返事', () => textOf(engine, 'account-status') !== T('account.sending'));
            await background;
            const account = accountOf(engine);
            same([textOf(engine, 'account-status'), screenOf(engine), el(engine, 'account-code-section').hidden, textOf(engine, 'account-code-value') === account.transferCode], [T('account.registered'), 'account', false, true]);
            same([sent.names, account.serverName, engine.account.needsSync(account)], [['登録中の名前A', '今の名前C'], '今の名前C', false]);
            await waitForSave(mock, account.playerId);
        });
    } finally {
        sent.restore();
    }
}
async function checkNameScreen(mock) {
    await mock.reset();
    const engine = makeEngine(mock, { timeoutMs: SHORT_TIMEOUT_MS });
    await checkNameRegister(mock, engine);
    await checkNameNoSync(mock, engine);
    await checkNameFailures(mock, engine);
    await checkNameMovedAway(mock, engine);
    await checkNameInvalid(mock, engine);
    await checkNameReturns(mock, engine);
    await checkNameJoinsRename(mock);
    await checkNameJoinsRegister(mock);
}

function storedGame(engine) {
    return JSON.parse(engine.storage.getItem('gelpiyo-suspended-game'));
}
async function checkSuspendKeepsTicket(mock, engine, account) {
    const ticket = { value: null };
    await check('中断：保存に札を入れ、控えを送る', async () => {
        startGame(engine);
        ticket.value = await waitTicket(engine);
        const before = await requestCount(mock);
        engine.run('suspendGame()');
        same(storedGame(engine).ranking, ticket.value);
        await waitForRequests(mock, before + 1);
        await waitFor('控えに中断データ', async () => (await mock.saveOf(account.deviceKey)).data.includes(ticket.value.runId));
    });
    await check('再開：札を取り直さず、持っている札をそのまま使う', async () => {
        const before = await requestCount(mock);
        engine.run('resumeSavedGame()');
        same([ticketOf(engine), engine.run('gameResumed')], [ticket.value, true]);
        await expectNoRequests(mock, before);
    });
    await checkResumedGameSends(engine);
}
async function checkResumedGameSends(engine) {
    await check('再開：再開した対局が終わったら、持っている札で送る', async () => {
        endWonGame(engine);
        same(await waitResultLine(engine), T('result.improved', { rank: 1, participants: 1 }));
    });
}
const ODD_RANKINGS = [undefined, null, 'x', [1], { runId: 5, startedAt: null, error: null }, { runId: 'r', startedAt: null }, { runId: 'r', startedAt: 1, error: null }];
function resumeWith(engine, ranking) {
    engine.storage.setItem('gelpiyo-suspended-game', JSON.stringify(makeWebGame(ranking)));
    engine.run('resumeSavedGame()');
    return ticketOf(engine);
}
async function checkResumeOddTickets(mock) {
    const engine = makeEngine(mock);
    await check('再開：札の無い古いデータ・形の違う札は「札なし・error null」として読む', () => {
        ODD_RANKINGS.forEach(ranking => same(resumeWith(engine, ranking), NO_TICKET, JSON.stringify(ranking)));
    });
    await check('再開：no_name の札は再開後も no_name（結果は result.noName）', () => {
        same(resumeWith(engine, { ...NO_TICKET, error: 'no_name' }), { ...NO_TICKET, error: 'no_name' });
        endWonGame(engine);
        same(resultLine(engine), { text: T('result.noName'), hidden: false });
    });
}
async function checkSuspendDropsLateTicket(mock) {
    const engine = makeEngine(mock);
    await register(engine, mock, '中断で捨てる');
    await check('中断：札の返事が届く前に中断したら、その返事は捨てる', async () => {
        const before = await requestCount(mock);
        startGame(engine);
        engine.run('suspendGame()');
        await waitForRequests(mock, before + 2);
        await settle();
        same([storedGame(engine).ranking, ticketOf(engine)], [NO_TICKET, NO_TICKET]);
    });
}
async function checkSuspendResume(mock) {
    await mock.reset();
    await mock.config({ minSec: 0 });
    const engine = makeEngine(mock);
    const account = await register(engine, mock, '中断の人');
    await checkSuspendKeepsTicket(mock, engine, account);
    await checkResumeOddTickets(mock);
    await checkSuspendDropsLateTicket(mock);
}

function checkNoSecretsInLogs() {
    return check('console に鍵・引き継ぎコードを出していない', () => {
        assert.ok(secrets.size > 0, '確かめる鍵・コードが集まっていない');
        const leaked = allLogs.flat().filter(line => [...secrets].some(secret => line.includes(secret)));
        assert.strictEqual(leaked.length, 0, `${leaked.length} 行`);
    });
}
async function runApiChecks(mock) {
    const texts = await checkTexts(mock);
    await group('offline', () => checkApiOffline(mock));
    await group('入口ごとの返事', () => checkApiCalls(mock));
    await group('失敗の読み替え', () => checkApiErrors(mock));
    await group('送る形', () => checkApiRequestShape(mock));
    return texts;
}
const FLOW_GROUPS = [
    ['同期', checkSync], ['札', checkTicket], ['結果の行', checkResult], ['結果の送信', checkFinish], ['送り残し', checkPending],
    ['ランキング', checkRanking], ['引き継ぎコード', checkTransferCode], ['引き継ぎ', checkRecover], ['控え', checkBackup],
    ['名前を勧める', checkSetupGate], ['名前の画面', checkNameScreen], ['中断と再開', checkSuspendResume]
];
async function runAllChecks(mock) {
    harness.mock = mock;
    const texts = await runApiChecks(mock);
    await FLOW_GROUPS.reduce(async (previous, [label, run]) => {
        await previous;
        await group(label, () => run(mock));
    }, Promise.resolve());
    await checkNoSecretsInLogs();
    return texts;
}
function writeTexts(texts) {
    try {
        fs.writeFileSync(TEXTS_PATH, JSON.stringify({ version: TEXTS_VERSION, texts }, null, 2) + '\n', 'utf8');
    } catch (error) {
        throw new Error(`文言を書き出せませんでした（${TEXTS_PATH}）: ${error.message}`);
    }
}
function reportFailures() {
    failures.forEach(text => console.error(redact(`NG ${text}`)));
    console.error(`${failures.length} 件失敗 / ${passedCount} 件成功。文言（server_texts.json）は書き出していません。`);
    process.exitCode = 1;
}
async function main() {
    process.on('unhandledRejection', reason => failures.push(`処理されない reject: ${describe(reason)}`));
    const { child, port } = await startMock();
    const texts = await runChecksWith(child, makeMockClient(port));
    if (failures.length > 0) {
        reportFailures();
        return;
    }
    writeTexts(texts);
    console.log(`${passedCount} 件すべて成功。文言: ${path.relative(ROOT, TEXTS_PATH)}（version ${TEXTS_VERSION}、${Object.keys(texts).length} 件）`);
}
async function runChecksWith(child, mock) {
    try {
        return await runAllChecks(mock);
    } finally {
        child.kill();
    }
}
async function run() {
    try {
        await main();
    } catch (error) {
        console.error(redact(`check-server.cjs が途中で止まりました: ${error && error.stack ? error.stack : error}`));
        process.exitCode = 1;
    }
}

run();
