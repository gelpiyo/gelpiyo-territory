// Web版のスクリプト（SCRIPT_FILES）を Node.js の vm で動かすための読み込み口。
// script.js は画面部品(DOM)に依存しているため、何を呼んでも何も起きないダミーの document を渡して評価します。
// ルールの照合（make-rule-fixtures.cjs）と、アカウント・ランキング・窓口との通信の確認（check-account-ranking.cjs・check-server.cjs）から使います。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_FILES = ['map.js', 'extra-rules.js', 'ranking.js', 'account.js', 'server-config.js', 'server-api.js', 'online.js', 'script.js'];
const SERVER_CONFIG_FILE = 'server-config.js';
const LOOPBACK_BASE_URL = /^http:\/\/127\.0\.0\.1:\d+$/;

function makeStub() {
    const target = function () {};
    const stub = new Proxy(target, {
        get(_t, key) {
            if (key === Symbol.toPrimitive) return () => '';
            if (key === Symbol.iterator) return function* () {};
            if (key === 'length') return 0;
            if (key === 'then') return undefined;
            return stub;
        },
        set() {
            return true;
        },
        apply() {
            return stub;
        },
        construct() {
            return stub;
        },
        has() {
            return true;
        }
    });
    return stub;
}

// 既定の vm には fetch が無いので送りません。fetch を渡すときは、本番の窓口へつながないよう 127.0.0.1 のにせ窓口を指す設定も必ず渡させます。
function assertSafeServer(options) {
    const globals = options.globals || {};
    if (globals.fetch === undefined)
        return;
    const baseUrl = options.serverConfig && options.serverConfig.baseUrl;
    if (typeof baseUrl !== 'string' || !LOOPBACK_BASE_URL.test(baseUrl))
        throw new Error('fetch を渡すときは、127.0.0.1 のにせ窓口を指す serverConfig（baseUrl: http://127.0.0.1:<port>）も渡してください。');
}

const BUILTINS = { console, Math, JSON, Date, Set, Map, Array, Number, String, Object, Error, Int8Array, Uint8Array, Uint16Array, Int16Array };

function makeSandbox(stub, store, options) {
    return {
        ...BUILTINS,
        FormData: function () { return stub; },
        Event: function () { return stub; },
        alert() {},
        confirm() { return true; },
        setTimeout() { return 0; },
        clearTimeout() {},
        requestAnimationFrame() { return 0; },
        localStorage: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        document: options.document || stub,
        ...(options.globals || {})
    };
}

function loadWebEngine(options = {}) {
    assertSafeServer(options);
    const stub = makeStub();
    const store = new Map();
    const sandbox = makeSandbox(stub, store, options);
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};
    sandbox.window.dispatchEvent = () => {};
    if (options.serverConfig)
        sandbox.GelpiyoServerConfig = Object.freeze({ ...options.serverConfig });
    const context = vm.createContext(sandbox);
    const files = options.serverConfig ? SCRIPT_FILES.filter(file => file !== SERVER_CONFIG_FILE) : SCRIPT_FILES;
    files.forEach(file => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file }));
    // script.js の let / const はスクリプト間で共有される領域にあるので、評価用の小さな関数経由で読み書きします。
    const run = code => vm.runInContext(code, context);
    return { context, run, rules3d: sandbox.Extra3DRules, eventMaps: sandbox.EVENT_MAPS, simpleBackground: sandbox.SIMPLE_BOARD_BACKGROUND };
}

module.exports = { loadWebEngine, makeStub, ROOT };
