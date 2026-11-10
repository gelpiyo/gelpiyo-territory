// アカウント・ランキング（通信しない部分）の Web 版を確かめ、Godot 版と照合するためのデータを書き出します。
//   node tools/check-account-ranking.cjs
// 失敗があれば終了コード 1 で終わり、照合データ（godot/tests/fixtures/account_ranking.json）は書き出しません。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { loadWebEngine, ROOT } = require('./load-web-engine.cjs');

const FIXTURE_PATH = path.join(ROOT, 'godot', 'tests', 'fixtures', 'account_ranking.json');
const FIXTURE_SEED = 20261109;
const FIXTURE_VERSION = 2;
const MIN_FIXTURE_COUNTS = { encode: 200, formatRankPoints: 40, validateName: 40, transferCode: 30, challenge: 40, snapshotParse: 10 };
const SNAPSHOT_MAX_BYTES = 512 * 1024;
const AI_LEVELS = ['easy', 'normal', 'hard'];
const STORAGE_KEYS = ['gelpiyo-theme', 'gelpiyo-result-history', 'gelpiyo-suspended-game', 'gelpiyo-account'];
const PENDING_KEY = 'gelpiyo-pending-finish';
const PENDING_LIMIT = 5;
const BASE_TIME_MS = 1794200000000;
const JST_OFFSET_S = 32400;
const EXTRA_CELL_COUNT = 729;
const FULLWIDTH_OFFSET = 0xfee0;

const NOTES = {
    lost: 'ランキングの対象は、AI戦で勝った対局だけです。',
    overtime: '60分以上かかった対局は、ランキングの対象外です。',
    excluded: '人間同士の対局は、ランキングの対象外です。'
};
function rankedNote(pointsText) {
    return `ランキングの対象です（ランキング点 ${pointsText}）。`;
}
const NAME_MESSAGES = {
    empty: '名前を入力してください。',
    bad_char: '名前に使えない文字が含まれています。',
    too_long: '名前は20文字までです。'
};
const TRANSFER_CODE_MESSAGE = '引き継ぎコードは英数字12文字です。';
const SNAPSHOT_MESSAGES = {
    otherApp: 'このゲームの控えではないため、読み込めません。',
    newer: '新しい版の控えのため、読み込めません。アプリを更新してください。',
    badShape: '控えの形が正しくないため、読み込めません。',
    restoreFailed: 'この端末に控えを書き込めませんでした。'
};

// --- 小さな試験の枠組み -------------------------------------------------------
const failures = [];
let passedCount = 0;
function check(label, body) {
    try {
        body();
        passedCount += 1;
    } catch (error) {
        failures.push(`${label}: ${error.message}`);
    }
}
// vm の中で作られたオブジェクトは原型が別なので、JSON で通常のオブジェクトに直してから比べます。
function plain(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function same(actual, expected) {
    assert.deepStrictEqual(plain(actual), plain(expected));
}
function omit(object, key) {
    const copy = { ...object };
    delete copy[key];
    return copy;
}

// --- 読み込み -----------------------------------------------------------------
function makeMemoryStorage() {
    const store = new Map();
    return {
        store,
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    };
}
function loadPureModules() {
    const storage = makeMemoryStorage();
    const warnings = [];
    const sandbox = { localStorage: storage, console: { ...console, warn: (...args) => warnings.push(args.map(String).join(' ')) } };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    ['ranking.js', 'account.js'].forEach(file => {
        const filePath = path.join(ROOT, file);
        vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
    });
    return { ranking: sandbox.GelpiyoRanking, account: sandbox.GelpiyoAccount, storage, warnings };
}

// --- 決まった手順の乱数（線形合同法） ---------------------------------------
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 4294967296;
function makeLcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
        return state / UINT32_RANGE;
    };
}
function randInt(rand, min, max) {
    return min + Math.floor(rand() * (max - min + 1));
}
function pick(rand, list) {
    return list[Math.floor(rand() * list.length)];
}

// --- §1 ランキング点 ------------------------------------------------------------
const SPEC_ENCODE = [
    [45, 754300, 'hard', 384210],
    [45, 754300, 'easy', 128070],
    [45, 120000, 'normal', 313200],
    [0, 0, 'easy', 0],
    [10, 1500, 'normal', 71960],
    [312, 3599400, 'hard', 936],
    [462, 0, 'hard', 4989600],
    [5, -5000, 'easy', 18000]
];
const SPEC_INVALID_ENCODE = [[312, 3599500, 'hard'], [50, 3600000, 'easy'], [-1, 0, 'hard'], [1.5, 0, 'hard'], [5, 0, 'x']];
// 得点とランキング点は 2^53 − 1（Number.MAX_SAFE_INTEGER）までが有効です（強い AI・0 秒は ×10,800、弱い AI・3,599 秒は ×1）。
const SAFE_LIMIT_ENCODE = [[833999930994, 0, 'hard', 9007199254735200], [9007199254740991, 3599000, 'easy', 9007199254740991]];
const SAFE_LIMIT_INVALID_ENCODE = [[833999930995, 0, 'hard'], [9007199254740991, 3598000, 'easy'], [9007199254740992, 3599000, 'easy'], [1e15, 0, 'hard']];
const INVALID_ENCODE = [
    ...SPEC_INVALID_ENCODE,
    ...SAFE_LIMIT_INVALID_ENCODE,
    [-45, 754300, 'hard'], [0.5, 0, 'easy'], [10, 3600499, 'normal'], [10, 7200000, 'hard'],
    [10, 1000, 'expert'], [10, 1000, 'Hard'], [10, 1000, 'EASY'], [10, 1000, ''], [10, 1000, ' easy']
];
// JSON に書けない値や型の違う値は、照合データに入れず Web 版だけで確かめます。
const WEB_ONLY_INVALID_ENCODE = [[5, NaN, 'hard'], [5, Infinity, 'easy'], ['45', 1000, 'easy'], [45, '1000', 'normal'], [45, 1000, null]];
function checkRankValues(ranking) {
    [...SPEC_ENCODE, ...SAFE_LIMIT_ENCODE].forEach(([score, playMs, ai, value]) =>
        check(`encode(${score}, ${playMs}, ${ai})`, () => assert.strictEqual(ranking.encodeRankValue(score, playMs, ai), value)));
    [...INVALID_ENCODE, ...WEB_ONLY_INVALID_ENCODE].forEach(([score, playMs, ai]) =>
        check(`encode(${JSON.stringify(score)}, ${playMs}, ${JSON.stringify(ai)}) は無効`, () => assert.strictEqual(ranking.encodeRankValue(score, playMs, ai), null)));
    check('秒の丸め（正の 0.5 は切り上げ・負は 0・上限なし）', () => {
        same([499, 500, 1499, 1500, -500, -501, -5000, 3599499, 3599500, 400000000].map(ranking.playSeconds), [0, 1, 1, 2, 0, 0, 0, 3599, 3600, 400000]);
    });
    check('定数', () => same([ranking.RANK_TIME_LIMIT_SEC, ranking.AI_WEIGHT], [3600, { easy: 1, normal: 2, hard: 3 }]));
}

// --- §2 ランキング点の表示 -----------------------------------------------------
const SPEC_RANK_POINTS = [
    [384210, '384,210点'], [0, '0点'], [4989600, '4,989,600点'], [1, '1点'], [999, '999点'], [1000, '1,000点'],
    [999999, '999,999点'], [1000000, '1,000,000点'], [97200000000, '97,200,000,000点'], [9007199254740991, '9,007,199,254,740,991点']
];
const INVALID_RANK_POINTS = [-1, -384210, 1.5, 0.5, 384210.5, null, '384210', 'abc', '', 9007199254740992, 1e21];
const WEB_ONLY_INVALID_RANK_POINTS = [undefined, NaN, Infinity, true, [384210]];
function checkRankPoints(ranking) {
    SPEC_RANK_POINTS.forEach(([value, text]) => check(`formatRankPoints(${value})`, () => assert.strictEqual(ranking.formatRankPoints(value), text)));
    [...INVALID_RANK_POINTS, ...WEB_ONLY_INVALID_RANK_POINTS].forEach(value =>
        check(`formatRankPoints(${String(JSON.stringify(value))}) は「-」`, () => assert.strictEqual(ranking.formatRankPoints(value), '-')));
}

// --- §3 対局の判定 -------------------------------------------------------------
function sideScore(pieces, regions, cubes) {
    return { pieces, regions, cubes, total: pieces + regions * 3 + cubes * 9 };
}
function challengeInput(overrides) {
    return {
        vs: 'ai', side: 'first', ai: 'hard', mode: 'simple', board: '9x9', guide: true, resumed: false, playMs: 754300,
        self: sideScore(30, 5, 0), opponent: sideScore(20, 2, 0), ...overrides
    };
}
const RANKED_DETAIL = {
    app: 'gelpiyo-territory', v: 1, mode: 'simple', board: '9x9', ai: 'hard', side: 'first', guide: true, resumed: true,
    sec: 754, self: sideScore(30, 5, 0), opponent: sideScore(20, 2, 0)
};
const SIDE_SCORE_KEYS = ['pieces', 'regions', 'cubes', 'total'];
const LAST_RANKED_PLAY_MS = 3599499;
const FIRST_OVERTIME_PLAY_MS = 3599500;
const HOUR_MS = 3600000;
// ランキング点・秒数が 2^53 − 1 を超える入力です。
const HUGE_SELF_SCORE = sideScore(1e15, 0, 0);
const HUGE_PLAY_MS = 1e300;
// 4 状態と、ランキング点・秒数が 2^53 − 1 を超える場合がそろうように決めた入力です。照合データにもそのまま入れます。
const FIXED_CHALLENGE_INPUTS = [
    challengeInput({ self: HUGE_SELF_SCORE }),
    challengeInput({ playMs: HUGE_PLAY_MS }),
    challengeInput({ resumed: true }),
    challengeInput({ playMs: LAST_RANKED_PLAY_MS }),
    challengeInput({ playMs: FIRST_OVERTIME_PLAY_MS }),
    challengeInput({ playMs: 2 * HOUR_MS, ai: 'easy' }),
    challengeInput({ opponent: sideScore(30, 5, 0) }),
    challengeInput({ playMs: HOUR_MS, self: sideScore(20, 2, 0), opponent: sideScore(30, 5, 0) }),
    challengeInput({ mode: 'extra', board: '9x9x9', self: sideScore(10, 1, 0), opponent: sideScore(5, 1, 1) }),
    challengeInput({ vs: 'human' }),
    challengeInput({ vs: 'human', playMs: 2 * HOUR_MS }),
    challengeInput({ vs: 'online' })
];
function checkChallenge(ranking) {
    checkChallengeRanked(ranking);
    checkChallengeOvertime(ranking);
    checkChallengeNotRanked(ranking);
}
function checkChallengeRanked(ranking) {
    check('勝ち → ranked（note にランキング点）', () => {
        const output = ranking.buildChallengeResult(challengeInput({ resumed: true }));
        assert.deepStrictEqual(Object.keys(output), ['status', 'note', 'cleared', 'value', 'playMs', 'detail']);
        same(output, { status: 'ranked', note: rankedNote('384,210点'), cleared: true, value: 384210, playMs: 754300, detail: RANKED_DETAIL });
        assert.deepStrictEqual(Object.keys(output.detail), ['app', 'v', 'mode', 'board', 'ai', 'side', 'guide', 'resumed', 'sec', 'self', 'opponent']);
        assert.deepStrictEqual(Object.keys(output.detail.self), SIDE_SCORE_KEYS);
    });
    check('59分59秒（丸めて 3599 秒）の勝ち → ranked', () => {
        const output = ranking.buildChallengeResult(challengeInput({ playMs: LAST_RANKED_PLAY_MS }));
        same([output.status, output.note, output.cleared, output.value, output.detail.sec], ['ranked', rankedNote('135点'), true, 135, 3599]);
    });
    check('入力の余分なキーは detail に入れない', () => {
        const output = ranking.buildChallengeResult(challengeInput({ self: { ...sideScore(30, 5, 0), extra: 1 } }));
        assert.deepStrictEqual(Object.keys(output.detail.self), SIDE_SCORE_KEYS);
    });
}
function checkChallengeOvertime(ranking) {
    check('丸めて 3600 秒の勝ち → overtime（value は null、detail は付く）', () => {
        same(ranking.buildChallengeResult(challengeInput({ playMs: FIRST_OVERTIME_PLAY_MS, resumed: true })), {
            status: 'overtime', note: NOTES.overtime, cleared: false, value: null, playMs: FIRST_OVERTIME_PLAY_MS, detail: { ...RANKED_DETAIL, sec: 3600 }
        });
    });
    check('2時間の勝ち → overtime', () => {
        const output = ranking.buildChallengeResult(challengeInput({ playMs: 2 * HOUR_MS }));
        same([output.status, output.note, output.cleared, output.value, output.detail.sec], ['overtime', NOTES.overtime, false, null, 7200]);
    });
    check('ランキング点・秒数が 2^53 − 1 を超えると value・sec は null', () => {
        const scored = ranking.buildChallengeResult(challengeInput({ self: HUGE_SELF_SCORE }));
        same([scored.status, scored.note, scored.value, scored.detail.sec], ['ranked', rankedNote('-'), null, 754]);
        const timed = ranking.buildChallengeResult(challengeInput({ playMs: HUGE_PLAY_MS }));
        assert.deepStrictEqual([timed.status, timed.value, timed.playMs, timed.detail.sec], ['overtime', null, HUGE_PLAY_MS, null]);
    });
}
function checkChallengeNotRanked(ranking) {
    check('引き分け → lost（value と detail は付く）', () => {
        const output = ranking.buildChallengeResult(challengeInput({ opponent: sideScore(30, 5, 0) }));
        same([output.status, output.note, output.cleared, output.value, output.detail.sec], ['lost', NOTES.lost, false, 384210, 754]);
    });
    check('負け → lost', () => {
        const output = ranking.buildChallengeResult(challengeInput({ mode: 'extra', board: '9x9x9', self: sideScore(10, 1, 0), opponent: sideScore(5, 1, 1) }));
        same([output.status, output.cleared, output.value, output.detail.mode, output.detail.opponent.cubes], ['lost', false, 110994, 'extra', 1]);
    });
    check('60分以上かかった負けは overtime より先に lost', () => {
        const output = ranking.buildChallengeResult(challengeInput({ playMs: HOUR_MS, self: sideScore(20, 2, 0), opponent: sideScore(30, 5, 0) }));
        same([output.status, output.note, output.value, output.detail.sec], ['lost', NOTES.lost, null, 3600]);
    });
    ['human', 'online'].forEach(vs => check(`vs "${vs}" → excluded（60分以上でも）`, () => {
        same(ranking.buildChallengeResult(challengeInput({ vs })), { status: 'excluded', note: NOTES.excluded, cleared: false, value: null, playMs: 754300, detail: null });
        assert.strictEqual(ranking.buildChallengeResult(challengeInput({ vs, playMs: 2 * HOUR_MS })).status, 'excluded');
    }));
}

// --- §4 名前 ---------------------------------------------------------------------
const PIYO = '\u{1F424}';
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
function nameOk(name) {
    return { ok: true, name, error: '', message: '' };
}
function nameNg(error) {
    return { ok: false, name: '', error, message: NAME_MESSAGES[error] };
}
const SPEC_NAMES = [
    ['', nameNg('empty')], ['   ', nameNg('empty')], ['　　', nameNg('empty')], ['\t\n\r ', nameNg('empty')],
    [' ぴよ太 ', nameOk('ぴよ太')], ['　ぴよ　太　', nameOk('ぴよ　太')], ['\nぴよ 太\t', nameOk('ぴよ 太')],
    ['a'.repeat(20), nameOk('a'.repeat(20))], ['a'.repeat(21), nameNg('too_long')],
    ['あ'.repeat(20), nameOk('あ'.repeat(20))], ['あ'.repeat(21), nameNg('too_long')],
    [`　${'あ'.repeat(20)}　`, nameOk('あ'.repeat(20))],
    [PIYO.repeat(10), nameOk(PIYO.repeat(10))], [PIYO.repeat(11), nameNg('too_long')],
    [`${'a'.repeat(18)}${PIYO}`, nameOk(`${'a'.repeat(18)}${PIYO}`)], [`${'a'.repeat(19)}${PIYO}`, nameNg('too_long')],
    [FAMILY.repeat(2), nameOk(FAMILY.repeat(2))], [FAMILY.repeat(3), nameNg('too_long')],
    ['ぴよ\u0000', nameNg('bad_char')], ['\u0001ぴよ', nameNg('bad_char')], ['ぴよ\u001f', nameNg('bad_char')], ['ぴ\u007fよ', nameNg('bad_char')],
    ['ぴ\tよ', nameNg('bad_char')], ['ぴ\nよ', nameNg('bad_char')], [`${'a'.repeat(25)}\u0001`, nameNg('bad_char')],
    ['ぴ\u0085よ', nameOk('ぴ\u0085よ')], ['   ', nameOk(' ')]
];
function checkNames(account) {
    SPEC_NAMES.forEach(([raw, expected]) => check(`validateName(${JSON.stringify(raw)})`, () => same(account.validateName(raw), expected)));
    check('normalizeName は前後の空白だけを取る', () => assert.strictEqual(account.normalizeName(' 　a b　 '), 'a b'));
    check('validateName(文字列以外) は empty', () => same(account.validateName(null), nameNg('empty')));
}

// --- §5 引き継ぎコード -----------------------------------------------------------
function codeOk(code) {
    return { ok: true, code, message: '' };
}
const CODE_NG = { ok: false, code: '', message: TRANSFER_CODE_MESSAGE };
const SPEC_CODES = [
    ['abcd efgh jk23', codeOk('ABCD-EFGH-JK23')], ['ＡＢＣＤ－ＥＦＧＨ－ＪＫ２３', codeOk('ABCD-EFGH-JK23')], ['ABCD-EFGH-JK2', CODE_NG],
    ['ａｂｃｄ　ｅｆｇｈ\tｊｋ２３', codeOk('ABCD-EFGH-JK23')], ['ab‐cd‑ef‒gh–jk−23', codeOk('ABCD-EFGH-JK23')],
    ['ABCDEFGHJK23', codeOk('ABCD-EFGH-JK23')], ['0000-0000-0000', codeOk('0000-0000-0000')], ['ABCD-EFGH-JK234', CODE_NG],
    ['ABCD—EFGH—JK23', CODE_NG], ['ABCDーEFGHーJK23', CODE_NG], ['ABCD_EFGH_JK23', CODE_NG], ['ABCD-EFGH-JK2\n3', CODE_NG],
    ['ıBCD-EFGH-JK23', CODE_NG], ['ßBCD-EFGH-JK2', CODE_NG], ['', CODE_NG], ['------------', CODE_NG]
];
function checkTransferCodes(account) {
    SPEC_CODES.forEach(([raw, expected]) => check(`normalizeTransferCode(${JSON.stringify(raw)})`, () => same(account.normalizeTransferCode(raw), expected)));
}

// --- §6 アカウント -------------------------------------------------------------
const DEFAULT_ACCOUNT = { version: 1, name: '', playerId: null, deviceKey: null, transferCode: null, serverName: null };
function checkAccountStore() {
    const { account, storage, warnings } = loadPureModules();
    checkAccountRead(account, storage);
    checkAccountWrite(account, storage);
    checkAccountWriteFields(account, storage);
    checkAccountWriteFailure(account, storage, warnings);
    checkSyncNeeds(account);
    checkPendingStore();
}
function checkAccountRead(account, storage) {
    check('アカウントが無ければ既定値', () => same(account.readAccount(), DEFAULT_ACCOUNT));
    ['{壊れた', '[1,2]', '"ぴよ"', 'null'].forEach(text => check(`壊れたアカウント ${text} は既定値`, () => {
        storage.setItem('gelpiyo-account', text);
        same(account.readAccount(), DEFAULT_ACCOUNT);
    }));
    check('規則に合わない名前は空、文字列でない番号などは null で読む', () => {
        const odd = { version: 1, name: '123456789012345678901', playerId: 5, deviceKey: 'k-1', transferCode: ['x'], serverName: 7 };
        storage.setItem('gelpiyo-account', JSON.stringify(odd));
        same(account.readAccount(), { ...DEFAULT_ACCOUNT, deviceKey: 'k-1' });
    });
    check('サーバーが受け付けた名前（serverName）を読む', () => {
        storage.setItem('gelpiyo-account', JSON.stringify({ version: 1, name: 'ぴよ太', serverName: 'ぴよ' }));
        same(account.readAccount(), { ...DEFAULT_ACCOUNT, name: 'ぴよ太', serverName: 'ぴよ' });
    });
}
function checkAccountWrite(account, storage) {
    check('名前を書き込む', () => {
        storage.removeItem('gelpiyo-account');
        same(account.writeAccountName('ぴよ太'), { ok: true, message: '' });
        same(JSON.parse(storage.getItem('gelpiyo-account')), { ...DEFAULT_ACCOUNT, name: 'ぴよ太' });
    });
    check('書き込みで既存の番号などを消さない', () => {
        const kept = { version: 1, name: 'a', playerId: 'p-1', deviceKey: 'k-1', transferCode: 'ABCD-EFGH-JK23', serverName: 'a' };
        storage.setItem('gelpiyo-account', JSON.stringify({ ...kept, future: 1 }));
        account.writeAccountName('b');
        same(JSON.parse(storage.getItem('gelpiyo-account')), { ...kept, name: 'b' });
    });
}
function checkAccountWriteFields(account, storage) {
    const kept = { version: 1, name: 'ぴよ太', playerId: 'p-1', deviceKey: 'k-1', transferCode: 'ABCD-EFGH-JK23', serverName: 'ぴよ太' };
    check('writeAccount は渡したキーだけ書き換え、ほかは残す', () => {
        storage.setItem('gelpiyo-account', JSON.stringify(kept));
        same(account.writeAccount({ deviceKey: null, playerId: null, serverName: null }), { ok: true, message: '' });
        same(JSON.parse(storage.getItem('gelpiyo-account')), { ...kept, deviceKey: null, playerId: null, serverName: null });
    });
    check('writeAccount は知らないキーと version を書かない', () => {
        storage.setItem('gelpiyo-account', JSON.stringify(kept));
        account.writeAccount({ transferCode: 'WXYZ-WXYZ-WXYZ', version: 9, future: 1 });
        same(JSON.parse(storage.getItem('gelpiyo-account')), { ...kept, transferCode: 'WXYZ-WXYZ-WXYZ' });
    });
}
function checkSyncNeeds(account) {
    const registered = { ...DEFAULT_ACCOUNT, name: 'ぴよ太', playerId: 'p-1', deviceKey: 'k-1', serverName: 'ぴよ太' };
    check('登録済みは deviceKey が空でない文字列のとき', () => {
        same([registered, { ...registered, deviceKey: '' }, { ...registered, deviceKey: null }].map(account.isRegistered), [true, false, false]);
    });
    check('同期が要るのは、名前があり、未登録か名前がサーバーと違うとき', () => {
        const cases = [registered, { ...registered, name: 'ぴよ次郎' }, { ...registered, deviceKey: null }, { ...DEFAULT_ACCOUNT }, { ...DEFAULT_ACCOUNT, deviceKey: 'k-1' }];
        same(cases.map(account.needsSync), [false, true, true, false, false]);
    });
}
function pendingItem(index) {
    return { runId: `r-${index}`, payload: { value: index, cleared: true, detail: null } };
}
function checkPendingStore() {
    const { account, storage, warnings } = loadPureModules();
    check('送り残しが無ければ空', () => same(account.readPendingFinish(), []));
    check('送り残しは古い順に最大5件（古いものから捨てる）', () => {
        same(account.writePendingFinish([1, 2, 3, 4, 5, 6].map(pendingItem)), { ok: true });
        same(JSON.parse(storage.getItem(PENDING_KEY)), { version: 1, items: [2, 3, 4, 5, 6].map(pendingItem) });
        same(account.readPendingFinish(), [2, 3, 4, 5, 6].map(pendingItem));
        assert.strictEqual(account.PENDING_LIMIT, PENDING_LIMIT);
    });
    check('形の違う送り残しは読まない', () => {
        const items = [pendingItem(1), { runId: '', payload: {} }, { runId: 5, payload: {} }, { runId: 'r-x', payload: [1] }, null, { ...pendingItem(2), extra: 1 }];
        storage.setItem(PENDING_KEY, JSON.stringify({ version: 1, items }));
        same(account.readPendingFinish(), [pendingItem(1), pendingItem(2)]);
    });
    ['{壊れた', '[1]', JSON.stringify({ version: 2, items: [pendingItem(1)] }), JSON.stringify({ version: 1, items: 'x' })].forEach(text => check(`壊れた送り残し ${text} は空`, () => {
        storage.setItem(PENDING_KEY, text);
        same(account.readPendingFinish(), []);
    }));
    checkPendingWriteFailure(account, storage, warnings);
}
function checkPendingWriteFailure(account, storage, warnings) {
    check('送り残しを書き込めなければ ok false（警告にキー名）', () => {
        const setItem = storage.setItem;
        storage.setItem = () => { throw new Error('QuotaExceededError'); };
        try {
            same(account.writePendingFinish([pendingItem(1)]), { ok: false });
        } finally {
            storage.setItem = setItem;
        }
        assert.ok(warnings.some(text => text.includes(PENDING_KEY)), '警告にキー名が入っていない');
    });
}
function checkAccountWriteFailure(account, storage, warnings) {
    check('書き込みに失敗したら決まった文言を返す', () => {
        const setItem = storage.setItem;
        storage.setItem = () => { throw new Error('QuotaExceededError'); };
        try {
            same(account.writeAccountName('c'), { ok: false, message: 'この端末に名前を保存できませんでした。' });
        } finally {
            storage.setItem = setItem;
        }
        assert.ok(warnings.some(text => text.includes('gelpiyo-account')), '警告にキー名が入っていない');
    });
}

// --- §7 セーブの控え（純粋な処理） -------------------------------------------
function makeConfig(overrides) {
    return { opponent: 'ai', humanColor: 1, boardSize: 9, eventMapIndex: 0, aiLevel: 'hard', showGuide: true, ...overrides };
}
function makeWebGame2d() {
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[3][3] = 1;
    board[5][5] = -1;
    return { version: 1, savedAt: BASE_TIME_MS, elapsedMs: 123456, config: makeConfig(), mode: '2d', board, activeMap: null, boardSize: 9, currentPlayer: 1, consecutivePasses: 0 };
}
function makeWebGameExtra() {
    return { version: 1, savedAt: BASE_TIME_MS, elapsedMs: 5000, config: makeConfig({ boardSize: 'extra' }), mode: 'extra', extraBoard: Array(EXTRA_CELL_COUNT).fill(0), extraPlayer: -1, extraPasses: 1, cursor: { x: 4, y: 4, z: 4 } };
}
function makeGodotGame() {
    return { version: 1, mode: '2d', rows: 9, cols: 9, board: Array(81).fill(0), current_player: 1, passes: 0, elapsed_ms: 1000, config: { opponent: 'ai', human_color: 1, board_size: 9, ai_level: 'easy', show_guide: true } };
}
function commonEntry(index, offsetS) {
    return { finishedAt: BASE_TIME_MS - index * 60000, offsetS, summary: index % 2 === 0 ? '先攻の勝ち！' : '後攻の勝ち！', rows: [['盤面サイズ', '9 × 9'], ['総合判定', `${10 + index} vs 8`]] };
}
function messyHistory() {
    return [
        commonEntry(0, JST_OFFSET_S), omit(commonEntry(1, null), 'offsetS'), commonEntry(2, null),
        { ...commonEntry(3, null), finishedAt: '1794200000000' }, { ...commonEntry(4, null), summary: 5 },
        { ...commonEntry(5, null), rows: [['盤面', 9]] }, { ...commonEntry(6, null), rows: [['a', 'b', 'c']] }, { ...commonEntry(7, null), rows: 'a' },
        { ...commonEntry(8, null), offsetS: 1.5 }, { ...commonEntry(9, null), offsetS: '32400' }, null, [1, 2], '記録',
        { ...commonEntry(10, -18000), extraKey: true }, { ...commonEntry(11, null), rows: [] }, commonEntry(12, 0)
    ];
}
function baseSnapshot() {
    return {
        app: 'gelpiyo-territory', schema: 1, platform: 'web', createdAt: BASE_TIME_MS, theme: 'dark',
        history: [commonEntry(0, null), commonEntry(1, null)], suspended: { platform: 'web', game: makeWebGame2d() }
    };
}
function snapshotCases() {
    const base = baseSnapshot();
    const godotBase = { ...base, platform: 'godot', theme: 'light', history: [commonEntry(0, JST_OFFSET_S)], suspended: { platform: 'godot', game: makeGodotGame() } };
    return [
        [base, 'web'], [base, 'godot'], [godotBase, 'godot'], [godotBase, 'web'],
        [{ ...base, theme: null, suspended: null }, 'web'], [{ ...base, theme: 'blue' }, 'web'], [omit(base, 'theme'), 'godot'],
        [{ ...base, history: messyHistory() }, 'web'], [{ ...base, history: Array.from({ length: 7 }, (_, i) => commonEntry(i, JST_OFFSET_S)) }, 'godot'],
        [{ ...base, history: 'x' }, 'web'], [omit(base, 'history'), 'web'],
        [{ ...base, suspended: { platform: 'web', game: [1, 2] } }, 'web'], [{ ...base, suspended: { platform: 'web', game: null } }, 'web'],
        [{ ...base, suspended: { platform: 'web' } }, 'web'], [{ ...base, suspended: 'web' }, 'web'], [{ ...base, suspended: { platform: 'android', game: {} } }, 'web'],
        [{ ...base, suspended: { platform: 'web', game: makeWebGameExtra() } }, 'web'],
        [{ ...base, app: 'gelpiyo-world' }, 'web'], [omit(base, 'app'), 'web'], [{ ...base, app: 'gelpiyo-world', schema: 99 }, 'godot'],
        [null, 'web'], [[base], 'web'], ['gelpiyo-territory', 'web'], [42, 'godot'],
        [{ ...base, schema: 2 }, 'web'], [{ ...base, schema: 1.5 }, 'godot'], [{ ...base, schema: 0 }, 'web'], [{ ...base, schema: -1 }, 'web'],
        [{ ...base, schema: '1' }, 'web'], [{ ...base, schema: '2' }, 'godot'], [omit(base, 'schema'), 'web']
    ];
}
function failedSnapshot(message) {
    return { ok: false, message, theme: null, history: [], suspended: null, suspendedDropped: false };
}
function checkSnapshotParse(account) {
    const base = baseSnapshot();
    check('正しい控えを読む', () => same(account.parseSaveSnapshot(base, 'web'), { ok: true, message: '', theme: 'dark', history: base.history, suspended: base.suspended, suspendedDropped: false }));
    check('別の機種の中断データは捨てる', () => same(account.parseSaveSnapshot(base, 'godot'), { ok: true, message: '', theme: 'dark', history: base.history, suspended: null, suspendedDropped: true }));
    [null, [base], 'x', 42, { ...base, app: 'gelpiyo-world' }, omit(base, 'app')].forEach(snapshot =>
        check(`別アプリ・オブジェクトでない控え ${JSON.stringify(snapshot).slice(0, 40)}`, () => same(account.parseSaveSnapshot(snapshot, 'web'), failedSnapshot(SNAPSHOT_MESSAGES.otherApp))));
    [2, 1.5, 99].forEach(schema => check(`schema ${schema} は新しい版`, () => same(account.parseSaveSnapshot({ ...base, schema }, 'web'), failedSnapshot(SNAPSHOT_MESSAGES.newer))));
    [0, -1, '1', '2', null].forEach(schema => check(`schema ${JSON.stringify(schema)} は形が正しくない`, () => same(account.parseSaveSnapshot({ ...base, schema }, 'web'), failedSnapshot(SNAPSHOT_MESSAGES.badShape))));
    check('schema が無い控えは形が正しくない', () => same(account.parseSaveSnapshot(omit(base, 'schema'), 'web'), failedSnapshot(SNAPSHOT_MESSAGES.badShape)));
    check('記録は形の正しいものだけ・最大5件', () => {
        const history = account.parseSaveSnapshot({ ...base, history: messyHistory() }, 'web').history;
        same(history, [commonEntry(0, JST_OFFSET_S), commonEntry(1, null), commonEntry(2, null), commonEntry(10, -18000), commonEntry(11, null)].map((entry, index) => (index === 4 ? { ...entry, rows: [] } : entry)));
    });
    check('テーマは light / dark 以外 null', () => assert.strictEqual(account.parseSaveSnapshot({ ...base, theme: 'blue' }, 'web').theme, null));
    check('中断データの game がオブジェクトでなければ null（捨てた扱いにはしない）', () => {
        const parsed = account.parseSaveSnapshot({ ...base, suspended: { platform: 'web', game: [1] } }, 'web');
        same([parsed.suspended, parsed.suspendedDropped], [null, false]);
    });
}

// --- script.js とのつなぎ（collectSaveSnapshot / restoreSaveSnapshot） ----------
const WEB_HISTORY = [
    { finishedAt: BASE_TIME_MS, summary: '先攻の勝ち！', rows: [['盤面サイズ', '9 × 9'], ['総合判定', '12 vs 8']] },
    { finishedAt: BASE_TIME_MS - 60000, summary: '引き分け！', rows: [['盤面サイズ', '11 × 11'], ['総合判定', '5 vs 5']] }
];
const ACCOUNT_TEXT = JSON.stringify({ version: 1, name: 'ぴよ太', playerId: null, deviceKey: null, transferCode: null });
function readKeys(storage) {
    return Object.fromEntries(STORAGE_KEYS.map(key => [key, storage.getItem(key)]));
}
function writeKeys(storage, values) {
    Object.entries(values).forEach(([key, value]) => (value === null ? storage.removeItem(key) : storage.setItem(key, value)));
}
function restoreIn(engine, snapshot) {
    engine.context.__snapshot = snapshot;
    return plain(engine.run('restoreSaveSnapshot(__snapshot)'));
}
function seedStorage(storage) {
    const values = {
        'gelpiyo-theme': 'dark',
        'gelpiyo-result-history': JSON.stringify(WEB_HISTORY),
        'gelpiyo-suspended-game': JSON.stringify(makeWebGame2d()),
        'gelpiyo-account': ACCOUNT_TEXT
    };
    writeKeys(storage, values);
    return values;
}
function checkSnapshotRoundTrip() {
    const engine = loadWebEngine();
    const storage = engine.context.localStorage;
    const original = seedStorage(storage);
    const snapshot = plain(engine.run('collectSaveSnapshot()'));
    checkSnapshotShape(snapshot);
    writeKeys(storage, { 'gelpiyo-theme': 'light', 'gelpiyo-result-history': '[]', 'gelpiyo-suspended-game': null, 'gelpiyo-account': '{"version":1,"name":"別人"}' });
    const accountBefore = storage.getItem('gelpiyo-account');
    check('控えから読み戻すと端末のデータが元に戻る（アカウントには触らない）', () => {
        same(restoreIn(engine, snapshot), { ok: true, message: '', suspendedDropped: false, suspendedRestored: true });
        same(readKeys(storage), { ...original, 'gelpiyo-account': accountBefore });
    });
    check('読み戻した後にもう一度控えを作ると同じ中身', () => same(omit(plain(engine.run('collectSaveSnapshot()')), 'createdAt'), omit(snapshot, 'createdAt')));
    checkRestoreRefusals(engine, snapshot);
    checkRestoreSuspended(engine, snapshot);
    checkRestoreWriteFailure(engine, snapshot);
}
function checkSnapshotShape(snapshot) {
    check('控えの形', () => {
        same(omit(snapshot, 'createdAt'), {
            app: 'gelpiyo-territory', schema: 1, platform: 'web', theme: 'dark',
            history: WEB_HISTORY.map(entry => ({ finishedAt: entry.finishedAt, offsetS: null, summary: entry.summary, rows: entry.rows })),
            suspended: { platform: 'web', game: makeWebGame2d() }
        });
        assert.ok(Number.isInteger(snapshot.createdAt), 'createdAt がミリ秒の整数ではない');
        assert.ok(!JSON.stringify(snapshot).includes('ぴよ太'), 'アカウントが控えに入っている');
        assert.ok(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= SNAPSHOT_MAX_BYTES, '控えが 512KB を超えた');
    });
}
function checkRestoreRefusals(engine, snapshot) {
    const storage = engine.context.localStorage;
    check('別アプリの控えは読み込まず、端末のデータも変えない', () => {
        const before = readKeys(storage);
        same(restoreIn(engine, { ...snapshot, app: 'gelpiyo-world' }), { ok: false, message: SNAPSHOT_MESSAGES.otherApp, suspendedDropped: false, suspendedRestored: false });
        same(readKeys(storage), before);
    });
    check('新しい版の控えは読み込まない', () => assert.strictEqual(restoreIn(engine, { ...snapshot, schema: 2 }).message, SNAPSHOT_MESSAGES.newer));
    check('控えにテーマ・記録・中断データが無ければ端末からも消す', () => {
        same(restoreIn(engine, { ...snapshot, theme: null, history: [], suspended: null }).ok, true);
        same([storage.getItem('gelpiyo-theme'), storage.getItem('gelpiyo-result-history'), storage.getItem('gelpiyo-suspended-game')], [null, null, null]);
    });
}
function checkRestoreSuspended(engine, snapshot) {
    const storage = engine.context.localStorage;
    check('別の機種の中断データは捨て、記録とテーマは置き換える', () => {
        const fromGodot = { ...snapshot, platform: 'godot', theme: 'light', history: [commonEntry(0, JST_OFFSET_S)], suspended: { platform: 'godot', game: makeGodotGame() } };
        same(restoreIn(engine, fromGodot), { ok: true, message: '', suspendedDropped: true, suspendedRestored: false });
        assert.strictEqual(storage.getItem('gelpiyo-suspended-game'), null);
        assert.strictEqual(storage.getItem('gelpiyo-theme'), 'light');
        same(JSON.parse(storage.getItem('gelpiyo-result-history')), [{ finishedAt: BASE_TIME_MS, summary: '先攻の勝ち！', rows: commonEntry(0, null).rows }]);
    });
    check('readSavedGame の検証を通らない中断データは捨てる', () => {
        storage.setItem('gelpiyo-suspended-game', JSON.stringify(makeWebGame2d()));
        const broken = { ...makeWebGame2d(), version: 2 };
        same(restoreIn(engine, { ...snapshot, suspended: { platform: 'web', game: broken } }).suspendedRestored, false);
        assert.strictEqual(storage.getItem('gelpiyo-suspended-game'), null);
    });
    check('エキストラの中断データも読み戻せる', () => {
        same(restoreIn(engine, { ...snapshot, suspended: { platform: 'web', game: makeWebGameExtra() } }).suspendedRestored, true);
        same(JSON.parse(storage.getItem('gelpiyo-suspended-game')), makeWebGameExtra());
    });
}
const RESTORE_FAILED_RESULT = { ok: false, message: SNAPSHOT_MESSAGES.restoreFailed, suspendedDropped: false, suspendedRestored: false };
function restoreWithFailingWrites(engine, snapshot, shouldFail) {
    const storage = engine.context.localStorage;
    const { setItem } = storage;
    const originalConsole = engine.context.console;
    const errors = [];
    storage.setItem = (key, value) => {
        if (shouldFail(key, value))
            throw new Error(`QuotaExceededError（${key}）`);
        return setItem(key, value);
    };
    engine.context.console = { ...originalConsole, error: (...args) => errors.push(args.map(String).join(' ')) };
    try {
        return { result: restoreIn(engine, snapshot), errors };
    } finally {
        storage.setItem = setItem;
        engine.context.console = originalConsole;
    }
}
function incomingSnapshot(snapshot) {
    return { ...snapshot, theme: 'light', history: [commonEntry(3, null)], suspended: { platform: 'web', game: makeWebGameExtra() } };
}
function checkRestoreWriteFailure(engine, snapshot) {
    const storage = engine.context.localStorage;
    ['gelpiyo-theme', 'gelpiyo-result-history', 'gelpiyo-suspended-game'].forEach(failingKey => check(`${failingKey} の書き込みに失敗したら 3 キーとも読み戻し前のまま`, () => {
        seedStorage(storage);
        const before = readKeys(storage);
        const { result, errors } = restoreWithFailingWrites(engine, incomingSnapshot(snapshot), key => key === failingKey);
        same(result, RESTORE_FAILED_RESULT);
        same(readKeys(storage), before);
        assert.strictEqual(errors.length, 1, errors.join(' / '));
    }));
    check('元に戻せなかったキーは、キー名付きでエラーに出す', () => {
        seedStorage(storage);
        const { result, errors } = restoreWithFailingWrites(engine, incomingSnapshot(snapshot), (key, value) => key === 'gelpiyo-suspended-game' || (key === 'gelpiyo-theme' && value === 'dark'));
        same(result, RESTORE_FAILED_RESULT);
        same([storage.getItem('gelpiyo-theme'), JSON.parse(storage.getItem('gelpiyo-result-history'))], ['light', WEB_HISTORY]);
        assert.ok(errors.some(text => text.includes('gelpiyo-theme') && text.includes('戻せませんでした')), errors.join(' / '));
    });
}

// --- script.js とのつなぎ（結果画面の note・resumed） ----------------------------
function captureResults(engine) {
    engine.run('showResult = (summary, rows, challenge) => { __result = { summary, rows, note: challenge.note }; }; Extra3DView = { setState() {}, stop() {}, ready: false };');
}
// 丸めの境目から離した長さにして、テストの実行にかかる時間で秒数が変わらないようにします。
const RESULT_PLAY_MS = 754000;
function endGameIn(engine, setup, playMs = RESULT_PLAY_MS) {
    engine.context.__playMs = playMs;
    engine.run(`${setup}; gameStartedAt = Date.now() - __playMs;`);
    engine.run('gameConfig.boardSize === EXTRA_BOARD_SIZE ? endExtraGame() : endGame()');
    return plain(engine.context.__result);
}
const SIMPLE_SETUP = "gameConfig = { opponent: 'ai', humanColor: FIRST, boardSize: 9, eventMapIndex: 0, aiLevel: 'hard', showGuide: true }; activeMap = null; boardSize = 9; boardRows = 9; boardCols = 9; board = createInitialBoard(); board[0][0] = FIRST";
const EXTRA_SETUP = "gameConfig = { opponent: 'ai', humanColor: SECOND, boardSize: 'extra', eventMapIndex: 0, aiLevel: 'easy', showGuide: false }; activeMap = null; extraBoard = Extra3DRules.createInitialBoard(); extraBoard[0] = SECOND";
function checkResultNotes() {
    const engine = loadWebEngine();
    captureResults(engine);
    check('2D: AI戦で勝つと ranked の文言（記録の rows には入れない）', () => {
        const result = endGameIn(engine, SIMPLE_SETUP);
        assert.strictEqual(result.note, rankedNote('17,076点'));
        assert.ok(!JSON.stringify(result.rows).includes('ランキング'), 'rows にランキングの文言が入っている');
    });
    check('2D: 60分以上かかって勝つと overtime の文言', () => assert.strictEqual(endGameIn(engine, SIMPLE_SETUP, HOUR_MS).note, NOTES.overtime));
    check('2D: 後攻を選んで負けると lost の文言', () => assert.strictEqual(endGameIn(engine, `${SIMPLE_SETUP}; gameConfig.humanColor = SECOND`).note, NOTES.lost));
    check('2D: 人間同士は excluded の文言', () => assert.strictEqual(endGameIn(engine, `${SIMPLE_SETUP}; gameConfig.opponent = 'human'`).note, NOTES.excluded));
    check('エキストラ: AI戦で勝つと ranked の文言', () => assert.strictEqual(endGameIn(engine, EXTRA_SETUP).note, rankedNote('5,692点')));
    check('エキストラ: 60分以上かかって勝つと overtime の文言', () => assert.strictEqual(endGameIn(engine, EXTRA_SETUP, 2 * HOUR_MS).note, NOTES.overtime));
    checkChallengeInputs(engine);
}
function checkChallengeInputs(engine) {
    check('判定への入力（シンプル・後攻・再開）', () => {
        engine.run(`${SIMPLE_SETUP}; gameConfig.humanColor = SECOND; gameResumed = true`);
        same(engine.run('buildChallengeInput(planeScore(2, 1, 5), planeScore(1, 0, 1), 61000)'), {
            vs: 'ai', side: 'second', ai: 'hard', mode: 'simple', board: '9x9', guide: true, resumed: true, playMs: 61000,
            self: { pieces: 1, regions: 0, cubes: 0, total: 1 }, opponent: { pieces: 2, regions: 1, cubes: 0, total: 5 }
        });
    });
    check('判定への入力（イベント・エキストラの盤面名）', () => {
        engine.run(`${SIMPLE_SETUP}; gameConfig.boardSize = EVENT_BOARD_SIZE; activeMap = { name: '公園①', background: '' }; boardRows = 9; boardCols = 11`);
        same(engine.run('challengeBoard()'), { mode: 'event', board: '公園①' });
        engine.run(EXTRA_SETUP);
        same(engine.run('challengeBoard()'), { mode: 'extra', board: '9x9x9' });
        same(engine.run('extraScore({ pieces: 3, planes: 2, cubes: 1, total: 18 })'), { pieces: 3, regions: 2, cubes: 1, total: 18 });
    });
}
function checkResumedFlag() {
    const engine = loadWebEngine();
    check('新しく始めた対局は resumed false', () => {
        engine.run(`${SIMPLE_SETUP}; gameResumed = true; startGameFromConfig()`);
        same([engine.run('gameStarted'), engine.run('gameResumed')], [true, false]);
    });
    check('「つづきから」で再開した対局は resumed true', () => {
        engine.context.localStorage.setItem('gelpiyo-suspended-game', JSON.stringify(makeWebGame2d()));
        engine.run('resumeSavedGame()');
        same([engine.run('gameStarted'), engine.run('gameResumed'), engine.run('boardRows')], [true, true, 9]);
    });
}

// --- script.js とのつなぎ（ランキングの一覧） ----------------------------------
const SAMPLE_RANKING_ROWS = [
    { rank: 1, playerId: 'me', name: '<b>ぴよ</b>', title: null, frame: null, best: 4989600 },
    { rank: 2, playerId: 'p-2', name: 'たろう', title: null, frame: null, best: 384210 },
    { rank: 3, playerId: 'p-3', name: 'はなこ', title: null, frame: null, best: 0 },
    { rank: 100, playerId: 'p-4', name: '無効な記録', title: null, frame: null, best: -1 }
];
function rankingRowTextsIn(engine, row, isMine) {
    engine.context.__rankingRow = row;
    return plain(engine.run(`rankingRowTexts(__rankingRow, ${isMine})`));
}
// script.js の rankingList は読み込み時に決まるので、作られた要素を document.createElement の側で集めます。
function makeRecordingDocument(created) {
    return {
        createElement(tag) {
            const element = { tag, className: '', textContent: '', children: [], appendChild(child) { this.children.push(child); return child; } };
            created.push(element);
            return element;
        }
    };
}
function renderRankingIn(engine, rows, myPlayerId) {
    const created = [];
    const originalDocument = engine.context.document;
    engine.context.document = makeRecordingDocument(created);
    engine.context.__rankingArgs = [rows, myPlayerId];
    try {
        engine.run('renderRanking(__rankingArgs[0], __rankingArgs[1])');
    } finally {
        engine.context.document = originalDocument;
    }
    assert.ok(created.every(element => !('innerHTML' in element)), 'innerHTML を使っている');
    return created.filter(element => element.tag === 'li').map(item => ({
        className: item.className,
        cellClasses: item.children.map(cell => cell.className),
        texts: item.children.length > 0 ? item.children.map(cell => cell.textContent) : [item.textContent]
    }));
}
function checkRankingRows() {
    const engine = loadWebEngine();
    checkRankingRowTexts(engine);
    checkRenderRanking(engine);
}
function checkRankingRowTexts(engine) {
    check('一覧の行の文言（自分の行・HTML のような名前は文字のまま）', () => {
        same(rankingRowTextsIn(engine, SAMPLE_RANKING_ROWS[0], true), { rank: '1位', name: '<b>ぴよ</b>（あなた）', points: '4,989,600点' });
        same(rankingRowTextsIn(engine, SAMPLE_RANKING_ROWS[1], false), { rank: '2位', name: 'たろう', points: '384,210点' });
        same(rankingRowTextsIn(engine, SAMPLE_RANKING_ROWS[2], false), { rank: '3位', name: 'はなこ', points: '0点' });
        same(rankingRowTextsIn(engine, { rank: 1234, playerId: 'p-6', name: 'おおきい', best: 97200000000 }, false), { rank: '1234位', name: 'おおきい', points: '97,200,000,000点' });
    });
    [null, undefined, '384210', -1, 1.5].forEach(best => check(`best ${String(JSON.stringify(best))} はランキング点が「-」`, () => {
        same(rankingRowTextsIn(engine, { rank: 4, playerId: 'p-5', name: 'じろう', best }, false), { rank: '4位', name: 'じろう', points: '-' });
    }));
}
function checkRenderRanking(engine) {
    check('renderRanking: 1 行は順位・名前・ランキング点の 3 つ。自分の行だけ目立たせ「（あなた）」を付ける', () => {
        const items = renderRankingIn(engine, SAMPLE_RANKING_ROWS, 'me');
        same(items.map(item => item.className), ['ranking-row is-me', 'ranking-row', 'ranking-row', 'ranking-row']);
        same(items[0].cellClasses, ['ranking-rank', 'ranking-name', 'ranking-points']);
        same(items[0].texts, ['1位', '<b>ぴよ</b>（あなた）', '4,989,600点']);
        same(items[3].texts, ['100位', '無効な記録', '-']);
    });
    check('renderRanking: 自分の番号が無いときは、番号の無い行も自分の行にしない', () => {
        const rows = [{ rank: 1, playerId: null, name: 'a', best: null }, { rank: 2, name: 'b', best: null }];
        [null, undefined].forEach(myPlayerId => same(renderRankingIn(engine, rows, myPlayerId).map(item => item.className), ['ranking-row', 'ranking-row']));
    });
    check('renderRanking: 行が無ければ「まだ記録がありません。」', () => {
        [[], null].forEach(rows => same(renderRankingIn(engine, rows, 'me'), [{ className: 'ranking-empty', cellClasses: [], texts: ['まだ記録がありません。'] }]));
    });
}

// --- 照合データ（Godot 版が同じ出力になるかを確かめる入力と Web 版の出力） ----------
const NEAR_LIMIT_MS = 20000;
const MAX_RANDOM_PLAY_MS = 3 * HOUR_MS;
const MIN_RANDOM_PLAY_MS = -60000;
// below は「乱数がこの値未満ならこの帯」という累積の割合です。60分の前後と負の値を多めに混ぜます。
const PLAY_MS_BANDS = [
    { below: 0.5, min: 0, max: HOUR_MS },
    { below: 0.7, min: HOUR_MS - NEAR_LIMIT_MS, max: HOUR_MS + NEAR_LIMIT_MS },
    { below: 0.9, min: HOUR_MS, max: MAX_RANDOM_PLAY_MS },
    { below: 1, min: MIN_RANDOM_PLAY_MS, max: 0 }
];
function randomPlayMs(rand) {
    const band = rand();
    const chosen = PLAY_MS_BANDS.find(entry => band < entry.below);
    return randInt(rand, chosen.min, chosen.max);
}
const BOUNDARY_PLAY_MS = [
    0, 499, 500, 501, 999, 1000, 1499, 1500, 1501, 59499, 59500, 3598500, 3599000, 3599400, 3599499, 3599500, 3599999, 3600000, 3600499, 3600500, 7200000,
    -1, -499, -500, -501, -5000, -100000
];
const BOUNDARY_SCORE_STEP = 7;
const RANDOM_ENCODE_COUNT = 200;
const TYPICAL_SCORE_RATE = 0.9;
const TYPICAL_SCORE_MAX = 400;
const HUGE_SCORE_MAX = 9000000;
function randomScore(rand) {
    return rand() < TYPICAL_SCORE_RATE ? randInt(rand, 0, TYPICAL_SCORE_MAX) : randInt(rand, 0, HUGE_SCORE_MAX);
}
function encodeInputs(rand) {
    const boundary = BOUNDARY_PLAY_MS.map((playMs, index) => [index * BOUNDARY_SCORE_STEP, playMs, AI_LEVELS[index % AI_LEVELS.length]]);
    const random = Array.from({ length: RANDOM_ENCODE_COUNT }, () => [randomScore(rand), randomPlayMs(rand), pick(rand, AI_LEVELS)]);
    return [...[...SPEC_ENCODE, ...SAFE_LIMIT_ENCODE].map(([score, playMs, ai]) => [score, playMs, ai]), ...boundary, ...random, ...INVALID_ENCODE];
}
const RANK_POINTS_EDGES = [0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 99999, 100000, 999999, 1000000, 4989600, 5000000, 97200000000];
const RANDOM_RANK_POINTS_MAXIMA = [999, 999999, 999999999, 99999999999];
const RANDOM_RANK_POINTS_COUNT = 50;
function rankPointsInputs(rand) {
    const random = Array.from({ length: RANDOM_RANK_POINTS_COUNT }, () => randInt(rand, 0, pick(rand, RANDOM_RANK_POINTS_MAXIMA)));
    return [...SPEC_RANK_POINTS.map(([value]) => value), ...RANK_POINTS_EDGES, ...random, ...INVALID_RANK_POINTS];
}
const NAME_CHARS = ['a', 'Z', '7', 'ぴ', 'よ', '太', '郎', 'ー', '・', 'é', '\u{1F600}', PIYO, '_', '-', '.', ' ', '　'];
const NAME_RARE_CHARS = ['\t', '\n', '\r', '\u0001', '\u001f', '\u007f', '\u0085', ' ', '‍'];
const NAME_PADDING = [' ', '　', '\t', '\n', ' 　', '\r\n'];
const MAX_RANDOM_NAME_LENGTH = 24;
const RARE_NAME_CHAR_RATE = 0.08;
const NAME_PADDING_RATE = 0.3;
const NAME_MAX_LENGTH = 20;
const RANDOM_NAME_COUNT = 30;
function randomName(rand) {
    const body = Array.from({ length: randInt(rand, 0, MAX_RANDOM_NAME_LENGTH) }, () => pick(rand, rand() < RARE_NAME_CHAR_RATE ? NAME_RARE_CHARS : NAME_CHARS)).join('');
    const pad = () => (rand() < NAME_PADDING_RATE ? pick(rand, NAME_PADDING) : '');
    return pad() + body + pad();
}
function nameInputs(rand) {
    const fixed = SPEC_NAMES.map(([raw]) => raw).filter(raw => !raw.includes('\u0000'));
    const fillAfterFamily = NAME_MAX_LENGTH - FAMILY.length;
    const familyNames = [`${FAMILY}${'a'.repeat(fillAfterFamily)}`, `${FAMILY}${'a'.repeat(fillAfterFamily + 1)}`];
    return [...fixed, '\u0001', '　\u0001　', ...familyNames, ...Array.from({ length: RANDOM_NAME_COUNT }, () => randomName(rand))];
}
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_SEPARATOR_CHARS = [' ', '　', '\t', '-', '‐', '‑', '‒', '–', '−', '－'];
const CODE_JUNK_CHARS = ['_', '.', '/', 'ー', '—', 'ı', 'ß', '\n', ' '];
const TRANSFER_CODE_LENGTH = 12;
// 正しい長さを多めにし、1 文字足りない・多いものも混ぜます。
const CODE_LENGTH_CHOICES = [TRANSFER_CODE_LENGTH, TRANSFER_CODE_LENGTH, TRANSFER_CODE_LENGTH, TRANSFER_CODE_LENGTH - 1, TRANSFER_CODE_LENGTH + 1];
const LOWERCASE_CODE_RATE = 0.3;
const FULLWIDTH_CODE_RATE = 0.25;
const CODE_SEPARATOR_RATE = 0.2;
const CODE_JUNK_RATE = 0.15;
const RANDOM_TRANSFER_CODE_COUNT = 30;
function toFullWidth(char) {
    return String.fromCharCode(char.charCodeAt(0) + FULLWIDTH_OFFSET);
}
function randomCodeChar(rand) {
    const base = pick(rand, CODE_CHARS);
    const cased = rand() < LOWERCASE_CODE_RATE ? base.toLowerCase() : base;
    return rand() < FULLWIDTH_CODE_RATE ? toFullWidth(cased) : cased;
}
function randomTransferCode(rand) {
    const chars = Array.from({ length: pick(rand, CODE_LENGTH_CHOICES) }, () => randomCodeChar(rand));
    const joined = chars.map((char, index) => (index > 0 && rand() < CODE_SEPARATOR_RATE ? pick(rand, CODE_SEPARATOR_CHARS) : '') + char).join('');
    return joined + (rand() < CODE_JUNK_RATE ? pick(rand, CODE_JUNK_CHARS) : '');
}
function transferCodeInputs(rand) {
    return [...SPEC_CODES.map(([raw]) => raw), ...Array.from({ length: RANDOM_TRANSFER_CODE_COUNT }, () => randomTransferCode(rand))];
}
const SIMPLE_BOARDS = ['9x9', '11x11', '13x13'];
const MAX_RANDOM_PIECES = 60;
const MAX_RANDOM_REGIONS = 8;
const MAX_RANDOM_CUBES = 3;
const AI_GAME_RATE = 0.8;
const GUIDE_ON_RATE = 0.5;
const RESUMED_RATE = 0.3;
const DRAW_RATE = 0.2;
const RANDOM_CHALLENGE_COUNT = 40;
function randomSideScore(rand, mode) {
    return sideScore(randInt(rand, 0, MAX_RANDOM_PIECES), randInt(rand, 0, MAX_RANDOM_REGIONS), mode === 'extra' ? randInt(rand, 0, MAX_RANDOM_CUBES) : 0);
}
function randomBoard(rand, mode, eventNames) {
    if (mode === 'simple')
        return pick(rand, SIMPLE_BOARDS);
    return mode === 'event' ? pick(rand, eventNames) : '9x9x9';
}
function randomChallengeInput(rand, eventNames) {
    const mode = pick(rand, ['simple', 'event', 'extra']);
    const self = randomSideScore(rand, mode);
    return {
        vs: rand() < AI_GAME_RATE ? 'ai' : 'human', side: pick(rand, ['first', 'second']), ai: pick(rand, AI_LEVELS), mode,
        board: randomBoard(rand, mode, eventNames), guide: rand() < GUIDE_ON_RATE, resumed: rand() < RESUMED_RATE, playMs: randomPlayMs(rand),
        self, opponent: rand() < DRAW_RATE ? { ...self } : randomSideScore(rand, mode)
    };
}
function buildFixtures(ranking, account, eventNames) {
    const rand = makeLcg(FIXTURE_SEED);
    const randomChallenges = () => Array.from({ length: RANDOM_CHALLENGE_COUNT }, () => randomChallengeInput(rand, eventNames));
    return plain({
        version: FIXTURE_VERSION,
        encode: encodeInputs(rand).map(([score, playMs, ai]) => ({ score, playMs, ai, value: ranking.encodeRankValue(score, playMs, ai) })),
        formatRankPoints: rankPointsInputs(rand).map(value => ({ value, text: ranking.formatRankPoints(value) })),
        validateName: nameInputs(rand).map(raw => ({ raw, result: account.validateName(raw) })),
        transferCode: transferCodeInputs(rand).map(raw => ({ raw, result: account.normalizeTransferCode(raw) })),
        challenge: [...FIXED_CHALLENGE_INPUTS, ...randomChallenges()].map(input => ({ input, output: ranking.buildChallengeResult(input) })),
        snapshotParse: snapshotCases().map(([snapshot, platform]) => ({ snapshot, platform, result: account.parseSaveSnapshot(snapshot, platform) }))
    });
}
const CHALLENGE_STATUSES = ['ranked', 'lost', 'overtime', 'excluded'];
function checkFixtureCoverage(fixtures) {
    check(`照合データの版が ${FIXTURE_VERSION}`, () => assert.strictEqual(fixtures.version, FIXTURE_VERSION));
    Object.entries(MIN_FIXTURE_COUNTS).forEach(([key, min]) =>
        check(`照合データ ${key} が ${min} 件以上`, () => assert.ok(fixtures[key].length >= min, `${fixtures[key].length} 件`)));
    check('照合データの challenge に 4 状態がそろっている', () => {
        same(CHALLENGE_STATUSES.map(status => fixtures.challenge.some(entry => entry.output.status === status)), CHALLENGE_STATUSES.map(() => true));
    });
    check('照合データの encode に 60 分の前後（有効・無効の両方）と負の時間がある', () => {
        const nearLimit = fixtures.encode.filter(entry => Math.abs(entry.playMs - HOUR_MS) <= NEAR_LIMIT_MS);
        same([nearLimit.some(entry => entry.value !== null), nearLimit.some(entry => entry.value === null)], [true, true]);
        assert.ok(fixtures.encode.some(entry => entry.playMs < 0 && entry.value !== null), '負の時間で有効な値が無い');
    });
    check('照合データの encode の値は null か安全な整数', () => {
        assert.ok(fixtures.encode.every(entry => entry.value === null || Number.isSafeInteger(entry.value)));
    });
    check('照合データの名前に U+0000 が無い（Godot の文字列で扱えないため）', () => {
        assert.ok(fixtures.validateName.every(entry => !entry.raw.includes('\u0000')));
    });
}
function writeFixtures(fixtures) {
    try {
        fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixtures) + '\n', 'utf8');
    } catch (error) {
        throw new Error(`照合データを書き出せませんでした（${FIXTURE_PATH}）: ${error.message}`);
    }
}

function checkPureModules(ranking, account) {
    checkRankValues(ranking);
    checkRankPoints(ranking);
    checkChallenge(ranking);
    checkNames(account);
    checkTransferCodes(account);
    checkAccountStore();
    checkSnapshotParse(account);
}
function checkScriptBindings() {
    checkSnapshotRoundTrip();
    checkResultNotes();
    checkResumedFlag();
    checkRankingRows();
}
function buildCheckedFixtures(ranking, account) {
    const eventNames = loadWebEngine().eventMaps.map(map => map.name);
    const fixtures = buildFixtures(ranking, account, eventNames);
    checkFixtureCoverage(fixtures);
    return fixtures;
}
function reportFailures() {
    failures.forEach(text => console.error(`NG ${text}`));
    console.error(`${failures.length} 件失敗 / ${passedCount} 件成功。照合データは書き出していません。`);
    process.exitCode = 1;
}
function main() {
    const { ranking, account } = loadPureModules();
    checkPureModules(ranking, account);
    checkScriptBindings();
    const fixtures = buildCheckedFixtures(ranking, account);
    if (failures.length > 0) {
        reportFailures();
        return;
    }
    writeFixtures(fixtures);
    const counts = Object.keys(MIN_FIXTURE_COUNTS).map(key => `${key} ${fixtures[key].length}`).join(', ');
    console.log(`${passedCount} 件すべて成功。照合データ: ${path.relative(ROOT, FIXTURE_PATH)}（version ${fixtures.version}、${counts}）`);
}

main();
