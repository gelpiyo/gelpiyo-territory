// 返事は成功 {ok, status, data}・失敗 {ok, status, error, message} にそろえ、例外や reject を外へ出しません。
(function () {
    const APP_VERSION = 'gelpiyo-territory-web';
    const TOP_LIMIT = 100;
    const NO_STATUS = 0;
    const SUCCESS_MIN = 200;
    const SUCCESS_END = 300;
    const SERVER_ERROR_MIN = 500;
    // Cloud Run が空きのインスタンスが無いときに返す 429 は本文が JSON でなく一時的なので送り直します。
    const RETRYABLE_ERRORS = Object.freeze(['network', 'timeout', 'bad_reply', 'server', 'http_429']);
    const BAD_KEY_ERRORS = Object.freeze(['bad_key', 'no_key', 'no_player']);
    const TEXT_PARAM = /\{(\w+)\}/g;
    // キーは Godot 版の定数・godot/tests/fixtures/server_texts.json と同じにします（両版で同じ文言を出すため）。
    const TEXTS = Object.freeze({
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
    });
    const REASON_KEYS = Object.freeze({
        offline: 'reason.offline',
        network: 'reason.network',
        timeout: 'reason.timeout',
        bad_name: 'reason.badName',
        no_key: 'reason.badKey',
        bad_key: 'reason.badKey',
        no_player: 'reason.badKey',
        not_open: 'reason.notOpen',
        closed: 'reason.closed',
        too_short: 'reason.tooShort',
        too_long: 'reason.tooLong',
        too_high: 'reason.tooHigh',
        already_done: 'reason.alreadyDone',
        no_run: 'reason.noRun',
        bad_code: 'reason.badCode',
        code_not_found: 'reason.codeNotFound',
        too_many: 'reason.tooMany'
    });

    function hasOwn(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }
    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function formatText(key, params = {}) {
        return TEXTS[key].replace(TEXT_PARAM, (whole, name) => (hasOwn(params, name) ? String(params[name]) : whole));
    }
    // 窓口の message は人向けの文ではないので、画面には error の名前から選んだ文言を出します。
    function reasonText(error) {
        return hasOwn(REASON_KEYS, error) ? TEXTS[REASON_KEYS[error]] : formatText('reason.other', { error });
    }
    function failure(status, error) {
        return { ok: false, status, error, message: reasonText(error) };
    }
    function isRetryable(result) {
        return !result.ok && (RETRYABLE_ERRORS.includes(result.error) || result.status >= SERVER_ERROR_MIN);
    }
    function isBadKey(result) {
        return !result.ok && BAD_KEY_ERRORS.includes(result.error);
    }

    function readSettings(config) {
        if (!isPlainObject(config) || config.offline === true)
            return null;
        const { baseUrl, board, timeoutMs } = config;
        const valid = typeof baseUrl === 'string' && !baseUrl.endsWith('/') && typeof board === 'string' && board !== ''
            && Number.isFinite(timeoutMs) && timeoutMs > 0;
        return valid ? { baseUrl, board, timeoutMs } : null;
    }
    function windowTimer() {
        return { set: (callback, ms) => window.setTimeout(callback, ms), clear: id => window.clearTimeout(id) };
    }
    function requestInit(method, options, signal) {
        const headers = {};
        if (options.body !== undefined)
            headers['Content-Type'] = 'application/json';
        if (typeof options.key === 'string')
            headers.Authorization = `Bearer ${options.key}`;
        const init = { method, headers };
        if (options.body !== undefined)
            init.body = JSON.stringify(options.body);
        if (signal !== null)
            init.signal = signal;
        return init;
    }
    // AbortController が無い環境（Node の vm など）では、時間切れなしで送ります。
    function armDeadline(deadline, timer, timeoutMs) {
        if (typeof window.AbortController !== 'function')
            return;
        const controller = new window.AbortController();
        const id = timer.set(() => {
            deadline.expired = true;
            controller.abort();
        }, timeoutMs);
        deadline.signal = controller.signal;
        deadline.stop = () => timer.clear(id);
    }
    async function readJsonBody(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (error) {
            return undefined;
        }
    }
    function toResult(status, body) {
        if (status >= SUCCESS_MIN && status < SUCCESS_END)
            return isPlainObject(body) ? { ok: true, status, data: body } : failure(status, 'bad_reply');
        const named = isPlainObject(body) && typeof body.error === 'string' && body.error !== '';
        return failure(status, named ? body.error : `http_${status}`);
    }
    function makeSender(settings, timer) {
        return async function send(method, path, options = {}) {
            const deadline = { signal: null, expired: false, stop() {} };
            try {
                armDeadline(deadline, timer, settings.timeoutMs);
                const response = await window.fetch(settings.baseUrl + path, requestInit(method, options, deadline.signal));
                return toResult(response.status, await readJsonBody(response));
            } catch (error) {
                const reason = deadline.expired ? 'timeout' : 'network';
                console.warn(`窓口への要求に失敗しました（${method} ${settings.baseUrl}${path}・${reason}）。`, error);
                return failure(NO_STATUS, reason);
            } finally {
                deadline.stop();
            }
        };
    }
    function offlineSender() {
        return async () => failure(NO_STATUS, 'offline');
    }

    function create(config, options = {}) {
        const settings = typeof window.fetch === 'function' ? readSettings(config) : null;
        const send = settings === null ? offlineSender() : makeSender(settings, options.timer || windowTimer());
        const board = settings === null ? '' : `/v1/challenge/${encodeURIComponent(settings.board)}`;
        return Object.freeze({
            offline: settings === null,
            register: name => send('POST', '/v1/players', { body: { name } }),
            rename: (key, name) => send('PATCH', '/v1/me', { key, body: { name } }),
            reissueCode: key => send('POST', '/v1/me/code', { key }),
            recover: code => send('POST', '/v1/recover', { body: { code } }),
            putSave: (key, dataText) => send('PUT', '/v1/save', { key, body: { data: dataText, appVersion: APP_VERSION, savedAt: new Date().toISOString() } }),
            startRun: key => send('POST', `${board}/runs`, { key, body: { appVersion: APP_VERSION } }),
            finishRun: (key, runId, payload) => send('POST', `${board}/runs/${encodeURIComponent(runId)}/finish`, { key, body: payload }),
            top: () => send('GET', `${board}/top?limit=${TOP_LIMIT}`),
            myEntry: key => send('GET', `${board}/me`, { key })
        });
    }

    window.GelpiyoServer = Object.freeze({
        APP_VERSION,
        TEXTS,
        create,
        formatText,
        reasonText,
        failure,
        isRetryable,
        isBadKey
    });
}());
