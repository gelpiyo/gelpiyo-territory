// プレイヤー名・引き継ぎコードの整形・端末に置くアカウントと送り残しの結果・セーブの控え。サーバーとは通信しない処理だけを置きます。
(function () {
    const NAME_MAX_LENGTH = 20;
    const NAME_EDGE_SPACES = /^[ \t\n\r　]+|[ \t\n\r　]+$/g;
    const NAME_BAD_CHARS = /[\u0000-\u001f\u007f]/;
    const NAME_MESSAGES = Object.freeze({
        empty: '名前を入力してください。',
        bad_char: '名前に使えない文字が含まれています。',
        too_long: '名前は20文字までです。'
    });

    const TRANSFER_CODE_LENGTH = 12;
    const TRANSFER_CODE_GROUP = 4;
    const FULLWIDTH_ALNUM = /[０-９Ａ-Ｚａ-ｚ]/g;
    const FULLWIDTH_OFFSET = 0xfee0;
    const TRANSFER_CODE_SEPARATORS = /[ 　\t\-‐‑‒–−－]/g;
    const ASCII_LOWER = /[a-z]/g;
    const TRANSFER_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${TRANSFER_CODE_LENGTH}}$`);
    const TRANSFER_CODE_GROUPS = new RegExp(`.{${TRANSFER_CODE_GROUP}}`, 'g');
    const TRANSFER_CODE_MESSAGE = '引き継ぎコードは英数字12文字です。';

    const ACCOUNT_STORAGE_KEY = 'gelpiyo-account';
    const ACCOUNT_VERSION = 1;
    const ACCOUNT_SAVE_FAILED = 'この端末に名前を保存できませんでした。';
    const ACCOUNT_FIELDS = Object.freeze(['name', 'playerId', 'deviceKey', 'transferCode', 'serverName']);

    const PENDING_STORAGE_KEY = 'gelpiyo-pending-finish';
    const PENDING_VERSION = 1;
    const PENDING_LIMIT = 5;

    const SNAPSHOT_APP = 'gelpiyo-territory';
    const SNAPSHOT_SCHEMA = 1;
    const SNAPSHOT_HISTORY_LIMIT = 5;
    const SNAPSHOT_MESSAGES = Object.freeze({
        otherApp: 'このゲームの控えではないため、読み込めません。',
        newer: '新しい版の控えのため、読み込めません。アプリを更新してください。',
        badShape: '控えの形が正しくないため、読み込めません。'
    });

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
    function textOrEmpty(raw) {
        return typeof raw === 'string' ? raw : '';
    }
    function hasOwn(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }
    function readStoredJson(key) {
        try {
            return JSON.parse(localStorage.getItem(key));
        } catch (error) {
            return null;
        }
    }

    // --- プレイヤー名 ---------------------------------------------------------
    function normalizeName(raw) {
        return textOrEmpty(raw).replace(NAME_EDGE_SPACES, '');
    }
    // 文字数は窓口と同じく UTF-16 の長さで数えます（絵文字などのサロゲートペアは 1 つで 2 文字。窓口に断られる名前を通さないため）。
    function nameError(name) {
        if (name === '')
            return 'empty';
        if (NAME_BAD_CHARS.test(name))
            return 'bad_char';
        if (name.length > NAME_MAX_LENGTH)
            return 'too_long';
        return '';
    }
    function validateName(raw) {
        const name = normalizeName(raw);
        const error = nameError(name);
        if (error)
            return { ok: false, name: '', error, message: NAME_MESSAGES[error] };
        return { ok: true, name, error: '', message: '' };
    }

    // --- 引き継ぎコード -------------------------------------------------------
    function toHalfWidth(text) {
        return text.replace(FULLWIDTH_ALNUM, char => String.fromCharCode(char.charCodeAt(0) - FULLWIDTH_OFFSET));
    }
    // 大文字にするのは半角の a〜z だけです（toUpperCase は ß や ı まで英字に変えてしまうため）。
    function normalizeTransferCode(raw) {
        const text = toHalfWidth(textOrEmpty(raw))
            .replace(TRANSFER_CODE_SEPARATORS, '')
            .replace(ASCII_LOWER, char => char.toUpperCase());
        if (!TRANSFER_CODE_PATTERN.test(text))
            return { ok: false, code: '', message: TRANSFER_CODE_MESSAGE };
        return { ok: true, code: text.match(TRANSFER_CODE_GROUPS).join('-'), message: '' };
    }

    // --- 端末に置くアカウント（セーブの控えには入れません） -------------------
    function defaultAccount() {
        return { version: ACCOUNT_VERSION, name: '', playerId: null, deviceKey: null, transferCode: null, serverName: null };
    }
    function keptValue(value) {
        return value === undefined ? null : value;
    }
    function textOrNull(value) {
        return typeof value === 'string' ? value : null;
    }
    function storedName(raw) {
        const checked = validateName(raw);
        return checked.ok ? checked.name : '';
    }
    function readAccount() {
        const data = readStoredJson(ACCOUNT_STORAGE_KEY);
        if (!isPlainObject(data))
            return defaultAccount();
        return {
            version: ACCOUNT_VERSION,
            name: storedName(data.name),
            playerId: textOrNull(data.playerId),
            deviceKey: textOrNull(data.deviceKey),
            transferCode: textOrNull(data.transferCode),
            serverName: textOrNull(data.serverName)
        };
    }
    // 渡したキーだけを書き換え、サーバーが出した番号などのほかの値は残します。
    function writeAccount(fields) {
        const changes = Object.fromEntries(ACCOUNT_FIELDS.filter(key => hasOwn(fields, key)).map(key => [key, fields[key]]));
        const account = { ...readAccount(), ...changes };
        try {
            localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account));
        } catch (error) {
            console.warn(`localStorage の「${ACCOUNT_STORAGE_KEY}」にアカウントを保存できませんでした。`, error);
            return { ok: false, message: ACCOUNT_SAVE_FAILED };
        }
        return { ok: true, message: '' };
    }
    function writeAccountName(name) {
        return writeAccount({ name });
    }
    function isRegistered(account) {
        return typeof account.deviceKey === 'string' && account.deviceKey !== '';
    }
    function needsSync(account) {
        return account.name !== '' && (!isRegistered(account) || account.name !== account.serverName);
    }

    function isPendingItem(item) {
        return isPlainObject(item) && typeof item.runId === 'string' && item.runId !== '' && isPlainObject(item.payload);
    }
    function keptPendingItems(items) {
        return items.filter(isPendingItem).slice(-PENDING_LIMIT).map(item => ({ runId: item.runId, payload: item.payload }));
    }
    function readPendingFinish() {
        const data = readStoredJson(PENDING_STORAGE_KEY);
        if (!isPlainObject(data) || data.version !== PENDING_VERSION || !Array.isArray(data.items))
            return [];
        return keptPendingItems(data.items);
    }
    function writePendingFinish(items) {
        try {
            localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ version: PENDING_VERSION, items: keptPendingItems(items) }));
        } catch (error) {
            console.warn(`localStorage の「${PENDING_STORAGE_KEY}」に送り残しの結果を保存できませんでした。`, error);
            return { ok: false };
        }
        return { ok: true };
    }

    // --- セーブの控え ---------------------------------------------------------
    function normalizeTheme(theme) {
        return theme === 'light' || theme === 'dark' ? theme : null;
    }
    function isTextPair(row) {
        return Array.isArray(row) && row.length === 2 && row.every(cell => typeof cell === 'string');
    }
    function isOffsetSeconds(offset) {
        return offset === undefined || offset === null || Number.isInteger(offset);
    }
    function parseHistoryEntry(entry) {
        if (!isPlainObject(entry) || !Number.isFinite(entry.finishedAt) || typeof entry.summary !== 'string')
            return null;
        if (!isOffsetSeconds(entry.offsetS) || !Array.isArray(entry.rows) || !entry.rows.every(isTextPair))
            return null;
        return {
            finishedAt: entry.finishedAt,
            offsetS: keptValue(entry.offsetS),
            summary: entry.summary,
            rows: entry.rows.map(row => [...row])
        };
    }
    function parseHistory(list) {
        if (!Array.isArray(list))
            return [];
        return list.map(parseHistoryEntry).filter(entry => entry !== null).slice(0, SNAPSHOT_HISTORY_LIMIT);
    }
    function webHistoryToCommon(entry) {
        return {
            finishedAt: entry.finishedAt,
            offsetS: null,
            summary: entry.summary,
            rows: entry.rows.map(([label, value]) => [String(label), String(value)])
        };
    }
    function commonHistoryToWeb(entry) {
        return {
            finishedAt: entry.finishedAt,
            summary: entry.summary,
            rows: entry.rows.map(row => [...row])
        };
    }
    function buildSaveSnapshot(parts) {
        return {
            app: SNAPSHOT_APP,
            schema: SNAPSHOT_SCHEMA,
            platform: parts.platform,
            createdAt: parts.createdAt,
            theme: normalizeTheme(parts.theme),
            history: parts.history.slice(0, SNAPSHOT_HISTORY_LIMIT),
            suspended: isPlainObject(parts.suspendedGame) ? { platform: parts.platform, game: parts.suspendedGame } : null
        };
    }
    // app の確認は、別のアプリ（GELPIYO WORLD など）の控えを読み込まないためです。
    function snapshotError(snapshot) {
        if (!isPlainObject(snapshot) || snapshot.app !== SNAPSHOT_APP)
            return SNAPSHOT_MESSAGES.otherApp;
        if (typeof snapshot.schema === 'number' && snapshot.schema > SNAPSHOT_SCHEMA)
            return SNAPSHOT_MESSAGES.newer;
        if (snapshot.schema !== SNAPSHOT_SCHEMA)
            return SNAPSHOT_MESSAGES.badShape;
        return '';
    }
    // 別の機種で中断した対局は盤面データの形が違うため引き継げません。
    function parseSuspended(suspended, platform) {
        if (!isPlainObject(suspended))
            return { suspended: null, suspendedDropped: false };
        if (suspended.platform !== platform)
            return { suspended: null, suspendedDropped: true };
        const game = isPlainObject(suspended.game) ? suspended.game : null;
        return { suspended: game ? { platform, game } : null, suspendedDropped: false };
    }
    function parseSaveSnapshot(snapshot, platform) {
        const error = snapshotError(snapshot);
        if (error)
            return { ok: false, message: error, theme: null, history: [], suspended: null, suspendedDropped: false };
        return {
            ok: true,
            message: '',
            theme: normalizeTheme(snapshot.theme),
            history: parseHistory(snapshot.history),
            ...parseSuspended(snapshot.suspended, platform)
        };
    }

    window.GelpiyoAccount = Object.freeze({
        NAME_MAX_LENGTH,
        ACCOUNT_STORAGE_KEY,
        PENDING_STORAGE_KEY,
        PENDING_LIMIT,
        SNAPSHOT_APP,
        SNAPSHOT_SCHEMA,
        SNAPSHOT_HISTORY_LIMIT,
        normalizeName,
        validateName,
        normalizeTransferCode,
        readAccount,
        writeAccount,
        writeAccountName,
        isRegistered,
        needsSync,
        readPendingFinish,
        writePendingFinish,
        webHistoryToCommon,
        commonHistoryToWeb,
        buildSaveSnapshot,
        parseSaveSnapshot
    });
}());
