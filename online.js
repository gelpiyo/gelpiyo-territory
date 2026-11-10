(function () {
    const BACKUP_MAX_BYTES = 512 * 1024;
    const BACKUP_RETRY_MS = 60000;
    const NO_TICKET = Object.freeze({ runId: null, startedAt: null, error: null });
    const TICKET_KEYS = Object.freeze(['runId', 'startedAt', 'error']);
    const REGISTRATION_KEYS = Object.freeze(['playerId', 'name', 'deviceKey', 'recoveryCode']);
    const RECOVERY_KEYS = Object.freeze(['playerId', 'name', 'deviceKey']);
    const SKIPPED = Object.freeze({ ok: true, skipped: true });
    const NO_STATUS = 0;
    const TWO_BYTE_CHARS = /[\u0080-\u07ff]/g;
    const WIDE_CHARS = /[\u0800-\uffff]/g;
    const SURROGATE_PAIRS = /[\ud800-\udbff][\udc00-\udfff]/g;
    const PAIR_UNITS = 2;
    const THREE_BYTE_EXTRA = 2;
    const PAIR_OVERCOUNT = 2;

    function server() {
        return window.GelpiyoServer;
    }
    function text(key, params) {
        return server().formatText(key, params);
    }
    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
    function isFilledText(value) {
        return typeof value === 'string' && value !== '';
    }
    function textOrNull(value) {
        return typeof value === 'string' ? value : null;
    }
    async function quietly(label, task) {
        try {
            return await task();
        } catch (error) {
            console.warn(`${label}で失敗しました。`, error);
            return null;
        }
    }

    function countMatches(source, pattern) {
        return source.length - source.replace(pattern, '').length;
    }
    // Node の vm には TextEncoder が無いので自前で数え、3 + 3 と数えたサロゲートペアは 4 バイトに直します。
    function utf8ByteLength(source) {
        const pairs = countMatches(source, SURROGATE_PAIRS) / PAIR_UNITS;
        return source.length + countMatches(source, TWO_BYTE_CHARS) + THREE_BYTE_EXTRA * countMatches(source, WIDE_CHARS) - PAIR_OVERCOUNT * pairs;
    }

    function normalizeTicket(value) {
        const valid = isPlainObject(value) && TICKET_KEYS.every(key => value[key] === null || typeof value[key] === 'string');
        return valid ? { runId: value.runId, startedAt: value.startedAt, error: value.error } : { ...NO_TICKET };
    }
    function failedTicket(error) {
        return { ...NO_TICKET, error };
    }

    function currentAccount(ctx) {
        return ctx.account.readAccount();
    }
    // 返事を待つ間に引き継ぎで別の鍵になっていたら、新しい鍵は消しません。
    function forgetKeyIfBad(ctx, result, key) {
        if (!server().isBadKey(result) || currentAccount(ctx).deviceKey !== key)
            return;
        ctx.account.writeAccount({ deviceKey: null, playerId: null, serverName: null });
    }
    // 返事を待つ間に名前が変えられていたら、新しい名前は残して次の同期で送ります。
    function acceptedName(account, sentName, serverName) {
        return account.name === sentName ? { name: serverName, serverName } : { serverName };
    }
    function storageFailure(saved) {
        return { ok: false, status: NO_STATUS, error: 'storage', message: saved.message };
    }
    function badReply(status) {
        return server().failure(status, 'bad_reply');
    }

    function syncAccount(ctx) {
        if (ctx.sync === null)
            ctx.sync = runSyncOnce(ctx);
        return ctx.sync;
    }
    async function runSyncOnce(ctx) {
        try {
            return await runSync(ctx);
        } finally {
            ctx.sync = null;
        }
    }
    async function runSync(ctx) {
        const account = currentAccount(ctx);
        if (account.name === '' || ctx.api.offline)
            return SKIPPED;
        if (!ctx.account.isRegistered(account))
            return registerAccount(ctx, account.name);
        return account.name === account.serverName ? SKIPPED : renameAccount(ctx, account);
    }
    async function registerAccount(ctx, name) {
        const result = await ctx.api.register(name);
        if (!result.ok)
            return result;
        if (!REGISTRATION_KEYS.every(key => isFilledText(result.data[key])))
            return badReply(result.status);
        const account = currentAccount(ctx);
        // 返事を待つ間に引き継ぎで登録されていたら、そちらを残します。
        if (ctx.account.isRegistered(account))
            return SKIPPED;
        const { playerId, deviceKey, recoveryCode } = result.data;
        const saved = ctx.account.writeAccount({ ...acceptedName(account, name, result.data.name), playerId, deviceKey, transferCode: recoveryCode });
        if (!saved.ok)
            return storageFailure(saved);
        backup(ctx);
        return { ok: true, registered: true };
    }
    async function renameAccount(ctx, account) {
        const result = await ctx.api.rename(account.deviceKey, account.name);
        if (!result.ok) {
            forgetKeyIfBad(ctx, result, account.deviceKey);
            return result;
        }
        if (!isFilledText(result.data.name))
            return badReply(result.status);
        const current = currentAccount(ctx);
        if (current.deviceKey !== account.deviceKey)
            return SKIPPED;
        const saved = ctx.account.writeAccount(acceptedName(current, account.name, result.data.name));
        return saved.ok ? { ok: true, renamed: true } : storageFailure(saved);
    }

    function initialTicket(ctx) {
        return currentAccount(ctx).name === '' ? failedTicket('no_name') : { ...NO_TICKET };
    }
    async function startTicket(ctx) {
        if (currentAccount(ctx).name === '')
            return failedTicket('no_name');
        if (ctx.api.offline)
            return failedTicket('offline');
        await sendPending(ctx);
        const synced = await syncAccount(ctx);
        const account = currentAccount(ctx);
        if (ctx.account.isRegistered(account))
            return requestRun(ctx, account.deviceKey);
        return failedTicket(synced.ok ? 'no_name' : synced.error);
    }
    async function requestRun(ctx, key) {
        const result = await ctx.api.startRun(key);
        if (!result.ok) {
            forgetKeyIfBad(ctx, result, key);
            return failedTicket(result.error);
        }
        const { runId, startedAt } = result.data;
        return isFilledText(runId) ? { runId, startedAt: textOrNull(startedAt), error: null } : failedTicket('bad_reply');
    }

    // 札があるのに鍵が無いのは、鍵が使えないと分かって消した後だけです。
    function missingTicketText(ticket) {
        if (ticket.runId !== null)
            return text('result.failed', { reason: server().reasonText('bad_key') });
        if (ticket.error === 'no_name')
            return text('result.noName');
        return text(ticket.error === 'not_open' ? 'result.notOpen' : 'result.noTicket');
    }
    function planResult(ctx, challenge, ticket) {
        if (challenge.status !== 'ranked')
            return { text: '', send: false };
        if (ticket.runId !== null && ctx.account.isRegistered(currentAccount(ctx)))
            return { text: text('result.sending'), send: true };
        return { text: missingTicketText(ticket), send: false };
    }
    function isPlaced(data) {
        return Number.isInteger(data.rank) && Number.isInteger(data.participants);
    }
    function sentText(data) {
        const place = { rank: data.rank, participants: data.participants };
        if (data.improved === true && isPlaced(data))
            return text('result.improved', place);
        if (data.best !== null && data.best !== undefined && isPlaced(data))
            return text('result.sent', { ...place, best: window.GelpiyoRanking.formatRankPoints(data.best) });
        return text('result.sentPlain');
    }
    async function finishResult(ctx, challenge, ticket) {
        const key = currentAccount(ctx).deviceKey;
        const payload = { value: challenge.value, cleared: true, detail: challenge.detail };
        const result = await ctx.api.finishRun(key, ticket.runId, payload);
        if (result.ok)
            return sentText(result.data);
        forgetKeyIfBad(ctx, result, key);
        if (result.error === 'already_done')
            return text('result.sentPlain');
        if (!server().isRetryable(result) || !addPending(ctx, ticket.runId, payload))
            return text('result.failed', { reason: result.message });
        return text('result.failedRetry', { reason: result.message });
    }

    function addPending(ctx, runId, payload) {
        const items = ctx.account.readPendingFinish().filter(item => item.runId !== runId);
        return ctx.account.writePendingFinish([...items, { runId, payload }]).ok;
    }
    function removePending(ctx, runIds) {
        if (runIds.length === 0)
            return;
        ctx.account.writePendingFinish(ctx.account.readPendingFinish().filter(item => !runIds.includes(item.runId)));
    }
    function sendPending(ctx) {
        if (ctx.pending === null)
            ctx.pending = runPendingOnce(ctx);
        return ctx.pending;
    }
    async function runPendingOnce(ctx) {
        try {
            return await runPending(ctx);
        } finally {
            ctx.pending = null;
        }
    }
    async function runPending(ctx) {
        const account = currentAccount(ctx);
        if (!ctx.account.isRegistered(account) || ctx.api.offline)
            return { done: 0, kept: ctx.account.readPendingFinish().length };
        const outcomes = await ctx.account.readPendingFinish().reduce(async (previous, item) => {
            const sent = await previous;
            return [...sent, await sendPendingItem(ctx, account.deviceKey, item)];
        }, Promise.resolve([]));
        const done = outcomes.filter(outcome => outcome.done).map(outcome => outcome.runId);
        removePending(ctx, done);
        return { done: done.length, kept: outcomes.length - done.length };
    }
    async function sendPendingItem(ctx, key, item) {
        const result = await ctx.api.finishRun(key, item.runId, item.payload);
        forgetKeyIfBad(ctx, result, key);
        const done = result.ok || result.error === 'already_done' || !server().isRetryable(result);
        return { runId: item.runId, done };
    }

    async function loadRanking(ctx) {
        await syncAccount(ctx);
        await sendPending(ctx);
        const account = currentAccount(ctx);
        const registered = ctx.account.isRegistered(account);
        const [top, mine] = await Promise.all([ctx.api.top(), registered ? ctx.api.myEntry(account.deviceKey) : null]);
        if (mine !== null)
            forgetKeyIfBad(ctx, mine, account.deviceKey);
        return rankingView(top, mine, currentAccount(ctx));
    }
    function rankingView(top, mine, account) {
        const rows = top.ok && Array.isArray(top.data.rows) ? top.data.rows : null;
        const reason = top.ok ? server().reasonText('bad_reply') : top.message;
        return {
            rows,
            playerId: account.playerId,
            status: rows === null ? text('ranking.loadFailed', { reason }) : '',
            myBest: myBestText(mine, account)
        };
    }
    function myBestText(mine, account) {
        if (mine === null)
            return account.name === '' ? '' : text('ranking.unregistered');
        if (!mine.ok)
            return '';
        const { best, rank, participants } = mine.data;
        if (best === null || best === undefined)
            return text('ranking.myNone');
        return isPlaced(mine.data) ? text('ranking.myBest', { best: window.GelpiyoRanking.formatRankPoints(best), rank, participants }) : '';
    }

    function reissueFailure(textKey, reason) {
        return { ok: false, code: null, message: text(textKey, { reason }) };
    }
    // 窓口は前のコードを消してから返事をするので、送り直してよい失敗や読めない返事では、前のコードがもう消えているかもしれません。
    async function reissueCode(ctx) {
        const key = currentAccount(ctx).deviceKey;
        if (!isFilledText(key))
            return reissueFailure('code.reissueFailed', server().reasonText('no_key'));
        const result = await ctx.api.reissueCode(key);
        if (!result.ok) {
            forgetKeyIfBad(ctx, result, key);
            return reissueFailure(server().isRetryable(result) ? 'code.reissueUnknown' : 'code.reissueFailed', result.message);
        }
        const code = result.data.recoveryCode;
        if (!isFilledText(code))
            return reissueFailure('code.reissueUnknown', server().reasonText('bad_reply'));
        const saved = ctx.account.writeAccount({ transferCode: code });
        return { ok: saved.ok, code, message: saved.ok ? text('code.reissued') : saved.message };
    }
    function isRecovery(data) {
        return RECOVERY_KEYS.every(key => isFilledText(data[key])) && (data.save === null || isPlainObject(data.save));
    }
    async function recover(ctx, rawCode) {
        const checked = ctx.account.normalizeTransferCode(rawCode);
        if (!checked.ok)
            return { ok: false, message: checked.message };
        const result = await ctx.api.recover(checked.code);
        if (!result.ok)
            return { ok: false, message: text('recover.failed', { reason: result.message }) };
        if (!isRecovery(result.data))
            return { ok: false, message: text('recover.failed', { reason: server().reasonText('bad_reply') }) };
        const adopt = result.data.save === null ? adoptWithoutSave : adoptWithSave;
        return adopt(ctx, result.data, checked.code);
    }
    function adoptAccount(ctx, data, code) {
        return ctx.account.writeAccount({ name: data.name, serverName: data.name, playerId: data.playerId, deviceKey: data.deviceKey, transferCode: code });
    }
    function adoptWithoutSave(ctx, data, code) {
        const saved = adoptAccount(ctx, data, code);
        return saved.ok ? { ok: true, message: text('recover.doneNoSave') } : { ok: false, message: saved.message };
    }
    function parseSaveText(save) {
        try {
            return typeof save.data === 'string' ? JSON.parse(save.data) : null;
        } catch (error) {
            return null;
        }
    }
    // 読めない控えや別のアプリ（GELPIYO WORLD など）の控えでは、端末を上書きしないよう鍵も保存しません。
    function adoptWithSave(ctx, data, code) {
        const snapshot = parseSaveText(data.save);
        if (!isPlainObject(snapshot) || snapshot.app !== ctx.account.SNAPSHOT_APP)
            return { ok: false, message: text('recover.otherApp') };
        const parsed = ctx.account.parseSaveSnapshot(snapshot, ctx.platform);
        if (!parsed.ok)
            return { ok: false, message: parsed.message };
        const restored = ctx.snapshot.restore(snapshot);
        if (!restored.ok)
            return { ok: false, message: restored.message };
        const saved = adoptAccount(ctx, data, code);
        // 古い鍵のまま引き継いだデータを控えとして送り、元のプレイヤーの控えを上書きしないよう、端末のデータを戻します。
        if (!saved.ok) {
            restored.undo();
            return { ok: false, message: saved.message };
        }
        return { ok: true, message: text('recover.done') + (restored.suspendedDropped ? text('recover.suspendedDropped') : '') };
    }

    function backup(ctx) {
        return quietly('控えの送信', () => requestBackup(ctx));
    }
    async function requestBackup(ctx) {
        const prepared = prepareBackup(ctx);
        if (prepared === null)
            return;
        if (ctx.backup.running) {
            ctx.backup.queued = true;
            return;
        }
        ctx.backup.running = true;
        try {
            await sendBackupChain(ctx, prepared);
        } finally {
            ctx.backup.running = false;
        }
    }
    async function sendBackupChain(ctx, prepared) {
        ctx.backup.queued = false;
        await sendBackup(ctx, prepared);
        if (!ctx.backup.queued)
            return;
        const latest = prepareBackup(ctx);
        if (latest !== null)
            await sendBackupChain(ctx, latest);
    }
    function prepareBackup(ctx) {
        const account = currentAccount(ctx);
        if (!ctx.account.isRegistered(account) || ctx.api.offline)
            return null;
        const snapshot = ctx.snapshot.collect();
        const dataText = JSON.stringify(snapshot);
        const bytes = utf8ByteLength(dataText);
        if (bytes > BACKUP_MAX_BYTES) {
            console.warn(`控えが ${bytes} バイトあり、上限（${BACKUP_MAX_BYTES} バイト）を超えるため送りません。`);
            return null;
        }
        // createdAt は作るたびに変わるので、同じ中身かどうかは createdAt を除いて比べます。
        const contentKey = `${account.playerId}:${JSON.stringify({ ...snapshot, createdAt: null })}`;
        return contentKey === ctx.backup.sentKey ? null : { dataText, contentKey };
    }
    async function sendBackup(ctx, prepared) {
        const key = currentAccount(ctx).deviceKey;
        if (!isFilledText(key))
            return;
        const result = await ctx.api.putSave(key, prepared.dataText);
        if (result.ok) {
            ctx.backup.sentKey = prepared.contentKey;
            return;
        }
        forgetKeyIfBad(ctx, result, key);
        console.warn(`控えをサーバーに送れませんでした（${result.error}）。`);
        if (server().isRetryable(result))
            scheduleBackupRetry(ctx);
    }
    function scheduleBackupRetry(ctx) {
        if (ctx.backup.retryId !== null)
            return;
        ctx.backup.retryId = ctx.timer.set(() => {
            ctx.backup.retryId = null;
            backup(ctx);
        }, BACKUP_RETRY_MS);
    }

    function makeContext(deps) {
        return {
            api: deps.api,
            account: deps.account,
            snapshot: deps.snapshot,
            platform: deps.platform,
            timer: deps.timer,
            sync: null,
            pending: null,
            backup: { running: false, queued: false, sentKey: null, retryId: null }
        };
    }
    // deps: { api（GelpiyoServer.create の戻り値）, account（GelpiyoAccount と同じ形）, snapshot: {collect, restore（成功なら元に戻す undo を添える）}, platform, timer: {set, clear} }
    function create(deps) {
        const ctx = makeContext(deps);
        return Object.freeze({
            isOffline: () => ctx.api.offline,
            syncAccount: () => syncAccount(ctx),
            initialTicket: () => initialTicket(ctx),
            startTicket: () => startTicket(ctx),
            planResult: (challenge, ticket) => planResult(ctx, challenge, ticket),
            finishResult: (challenge, ticket) => finishResult(ctx, challenge, ticket),
            sendPending: () => sendPending(ctx),
            loadRanking: () => loadRanking(ctx),
            reissueCode: () => reissueCode(ctx),
            recover: code => recover(ctx, code),
            backup: () => backup(ctx)
        });
    }

    window.GelpiyoOnline = Object.freeze({
        BACKUP_MAX_BYTES,
        BACKUP_RETRY_MS,
        NO_TICKET,
        create,
        normalizeTicket,
        utf8ByteLength
    });
}());
