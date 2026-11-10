// テスト専用のにせ窓口（本物の窓口 app.js と同じ入口と返事をメモリだけで返す）。node tools/mock-server.mjs [--port N] [--cors] [--web <dir>] で 127.0.0.1 に立ち "LISTEN <port>" を出す。本番の窓口に向けては決して使わない。
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';

const VERSION = '0.1.0';
const ID_CHARS = '0123456789abcdefghijkmnpqrstuvwxyz';
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ID_LEN = 19;
const KEY_BYTES = 32;
const CODE_LEN = 12;
const CODE_GROUP = 4;
const CODE_GROUP_RE = new RegExp(`.{${CODE_GROUP}}`, 'g');
const NAME_MAX = 20;
const SHORT_MAX = 40;
const SAVE_MAX = 512 * 1024;
const BODY_MAX = 600 * 1024;
const BACKUP_EVERY_SEC = 600;
const BACKUPS_KEEP = 5;
const HISTORY_MAX = 20;
const DETAIL_MAX = 2048;
const RECOVER_LIMIT = 10;
const RECOVER_WINDOW_SEC = 600;
const NO_BEST = -1;
const TOP_LIMIT = { fallback: 50, min: 1, max: 100 };
const AROUND_COUNT = { fallback: 3, min: 1, max: 10 };
const BORDER_PCT = { fallback: 10, min: 0.01, max: 100 };
const PERCENT = 100;
const RADIX = 10;
const MS_PER_SEC = 1000;
const SEC_PER_DAY = 86400;
const EVENT_DAYS = 30;

const DEFAULT_EVENT_ID = 'gc01';
const DEFAULT_EVENT_NAME = 'テスト';
const DEFAULT_BOARD_ID = 'gc01_gelpiyo-territory';
const DEFAULT_BOARD = { eventId: DEFAULT_EVENT_ID, game: 'gelpiyo-territory', minSec: 60, maxSec: 3600, maxValue: 5000000, graceSec: 600 };
const BOARD_CONFIG_KEYS = ['minSec', 'maxSec', 'maxValue', 'graceSec'];
const EVENT_CONFIG_KEYS = [['eventStart', 'startMs'], ['eventEnd', 'endMs']];
const CLIENT_TIMEOUT_MS = 15000;
const SERVER_CONFIG_PATH = '/server-config.js';
const SERVER_CONFIG_JS = `window.GelpiyoServerConfig = Object.freeze({ baseUrl: '', board: '${DEFAULT_BOARD_ID}', timeoutMs: ${CLIENT_TIMEOUT_MS} });\n`;
const LISTEN_HOST = '127.0.0.1';
const PORT_MAX = 65535;
const EXIT_FAILURE = 1;

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const SERVER_ERROR = 500;
const FAIL_STATUS_MIN = 200;
const FAIL_STATUS_MAX = 599;
const ERROR_STATUS = {
  bad_json: 400, bad_name: 400, bad_code: 400, bad_data: 400, bad_value: 400, bad_cleared: 400, bad_detail: 400, bad_test: 400,
  no_key: 401, bad_key: 401,
  not_found: 404, no_player: 404, code_not_found: 404, no_board: 404, no_event: 404, no_run: 404,
  bad_method: 405,
  not_open: 409, already_done: 409, too_short: 409, too_long: 409, closed: 409, too_high: 409,
  too_large: 413,
  too_many: 429,
};
const JSON_TYPE = 'application/json; charset=utf-8';
const JS_TYPE = 'text/javascript; charset=utf-8';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': JS_TYPE,
  '.mjs': JS_TYPE,
  '.css': 'text/css; charset=utf-8',
  '.json': JSON_TYPE,
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
};

class ApiError extends Error {
  constructor(code, message = '') {
    super(message || code);
    this.status = ERROR_STATUS[code];
    this.code = code;
  }
}

// ここから下の検証・形式・入口ごとの処理は app.js をそのまま写す（にせ窓口だけ通るアプリを作らないため）
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randFrom = (chars, n) => [...crypto.randomBytes(n)].map((b) => chars[b % chars.length]).join('');
const newId = (prefix) => prefix + randFrom(ID_CHARS, ID_LEN);
const newKey = () => crypto.randomBytes(KEY_BYTES).toString('base64url');
const newCode = () => randFrom(CODE_CHARS, CODE_LEN).match(CODE_GROUP_RE).join('-');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const short = (v, n) => String(v ?? '').slice(0, n);
const compareIds = (a, b) => Number(a > b) - Number(a < b);

function cleanName(v) {
  const n = String(v ?? '').trim();
  if (n.length < 1 || n.length > NAME_MAX) throw new ApiError('bad_name', `名前は 1〜${NAME_MAX} 文字`);
  return n;
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'unknown';
}

// にせ窓口の「今」はすべてここを通す（/_test/clock で時計を進められるように）
const clock = { offsetMs: 0 };
const nowMs = () => Date.now() + clock.offsetMs;
const isoOf = (ms) => new Date(ms).toISOString();
const secondsOf = (ms) => Math.floor(ms / MS_PER_SEC);

function seedState() {
  const startMs = nowMs();
  return {
    players: new Map(),
    devices: new Map(),
    codes: new Map(),
    saves: new Map(),
    limits: new Map(),
    events: new Map([[DEFAULT_EVENT_ID, { name: DEFAULT_EVENT_NAME, startMs, endMs: startMs + EVENT_DAYS * SEC_PER_DAY * MS_PER_SEC }]]),
    boards: new Map([[DEFAULT_BOARD_ID, { ...DEFAULT_BOARD }]]),
    runs: new Map(),
    entries: new Map(),
    finishes: [],
    recoverLimit: RECOVER_LIMIT,
    failure: { count: 0 },
    requests: 0,
  };
}
const state = seedState();

const playerName = (pid) => String(state.players.get(pid)?.name || '');
const runKey = (board, rid) => `${board}/${rid}`;

function entriesOf(board) {
  if (!state.entries.has(board)) state.entries.set(board, new Map());
  return state.entries.get(board);
}

function auth(req) {
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ''));
  if (!m) throw new ApiError('no_key');
  const pid = state.devices.get(sha(m[1]));
  if (pid === undefined) throw new ApiError('bad_key');
  return pid;
}

const dropDevicesOf = (pid) => [...state.devices]
  .filter(([, owner]) => owner === pid)
  .forEach(([keyHash]) => state.devices.delete(keyHash));

function register(body) {
  const name = cleanName(body.name);
  const playerId = newId('p');
  const deviceKey = newKey();
  const recoveryCode = newCode();
  const codeHash = sha(normCode(recoveryCode));
  state.players.set(playerId, { name, codeHash, createdAtMs: nowMs() });
  state.devices.set(sha(deviceKey), playerId);
  state.codes.set(codeHash, playerId);
  return [CREATED, { playerId, name, deviceKey, recoveryCode }];
}

function me(pid) {
  const p = state.players.get(pid);
  if (!p) throw new ApiError('no_player');
  return [OK, { playerId: pid, name: p.name, createdAt: isoOf(p.createdAtMs) }];
}

function rename(pid, body) {
  const name = cleanName(body.name);
  const p = state.players.get(pid);
  // app.js では無い文書への update が Firestore の NOT_FOUND になり、500 の server で返る
  if (!p) throw new Error(`players/${pid} が無いので名前を変えられない`);
  p.name = name;
  return [OK, { playerId: pid, name }];
}

function reissueCode(pid) {
  const recoveryCode = newCode();
  const p = state.players.get(pid);
  if (!p) throw new ApiError('no_player');
  if (p.codeHash) state.codes.delete(p.codeHash);
  p.codeHash = sha(normCode(recoveryCode));
  state.codes.set(p.codeHash, pid);
  return [OK, { recoveryCode }];
}

function rateLimit(req) {
  const ip = clientIp(req);
  const t = nowMs() / MS_PER_SEC;
  const d = state.limits.get(ip);
  const start = d ? Number(d.windowStart || 0) : 0;
  const count = d && t - start < RECOVER_WINDOW_SEC ? Number(d.count || 0) : 0;
  if (count >= state.recoverLimit) throw new ApiError('too_many', 'しばらく待ってからもう一度');
  state.limits.set(ip, { windowStart: count === 0 ? t : start, count: count + 1 });
}

function recover(req, body) {
  rateLimit(req);
  const code = normCode(body.code);
  if (code.length !== CODE_LEN) throw new ApiError('bad_code');
  const pid = state.codes.get(sha(code));
  if (pid === undefined) throw new ApiError('code_not_found');
  const p = state.players.get(pid);
  if (!p) throw new ApiError('code_not_found');
  dropDevicesOf(pid);
  const deviceKey = newKey();
  state.devices.set(sha(deviceKey), pid);
  const s = state.saves.get(pid);
  return [OK, { playerId: pid, name: p.name, deviceKey, save: s ? saveOut(s) : null }];
}

const saveOut = (s) => ({ data: s.data, appVersion: s.appVersion, savedAt: s.savedAt, updatedAt: isoOf(s.updatedAtMs), size: s.size });

function getSave(pid) {
  const s = state.saves.get(pid);
  return [OK, s ? { exists: true, ...saveOut(s) } : { exists: false }];
}

function checkSaveData(data) {
  if (typeof data !== 'string') throw new ApiError('bad_data', 'data は JSON の文字列');
  const size = Buffer.byteLength(data, 'utf8');
  if (size > SAVE_MAX) throw new ApiError('too_large');
  try {
    JSON.parse(data);
  } catch {
    throw new ApiError('bad_data', 'data が JSON として読めない');
  }
  return size;
}

function putSave(pid, body) {
  const size = checkSaveData(body.data);
  const t = nowMs();
  const cur = state.saves.get(pid);
  const backupDue = cur !== undefined && secondsOf(t) - (cur.lastBackupAtMs ?? 0) / MS_PER_SEC >= BACKUP_EVERY_SEC;
  state.saves.set(pid, {
    data: body.data,
    size,
    appVersion: short(body.appVersion, SHORT_MAX),
    savedAt: short(body.savedAt, SHORT_MAX),
    updatedAtMs: t,
    lastBackupAtMs: backupDue ? t : cur?.lastBackupAtMs ?? null,
    // 控えの中身は窓口から読めないので、10 分に 1 回・5 件までの決まりを数だけでなぞる
    backups: Math.min(BACKUPS_KEEP, (cur?.backups ?? 0) + Number(backupDue)),
  });
  return [OK, { ok: true, size, updatedAt: isoOf(t) }];
}

// Firestore はコレクションの文書を ID の順に返し、orderBy の同点は同じ向きの ID の順に並べる
const sortedById = (map) => [...map].sort(([a], [b]) => compareIds(a, b));
const byBestDesc = (a, b) => b.best - a.best || compareIds(b.playerId, a.playerId);
const byBestAsc = (a, b) => a.best - b.best || compareIds(a.playerId, b.playerId);
const rankedEntries = (board) => [...entriesOf(board).values()].filter((e) => typeof e.best === 'number' && e.best >= 0);
const row = (e) => ({ playerId: e.playerId, name: e.name, title: e.title || '', frame: e.frame || '', best: e.best });
const intParam = (q, key, { fallback, min, max }) => Math.max(min, Math.min(max, parseInt(q.get(key) || String(fallback), RADIX) || fallback));

const boardsOf = (eventId) => sortedById(state.boards)
  .filter(([, b]) => b.eventId === eventId)
  .map(([board, b]) => ({ board, game: b.game, minSec: b.minSec, maxSec: b.maxSec, maxValue: b.maxValue, graceSec: b.graceSec }));

function events() {
  const t = nowMs();
  const out = sortedById(state.events).map(([id, e]) => ({
    id,
    name: e.name,
    start: isoOf(e.startMs),
    end: isoOf(e.endMs),
    active: e.startMs <= t && t <= e.endMs,
    boards: boardsOf(id),
  }));
  return [OK, { serverTime: isoOf(t), events: out }];
}

function boardAndEvent(board) {
  const b = state.boards.get(board);
  if (!b) throw new ApiError('no_board');
  const e = state.events.get(b.eventId);
  if (!e) throw new ApiError('no_event');
  return [b, e];
}

function startRun(pid, board, body) {
  const rid = newId('r');
  const [, ev] = boardAndEvent(board);
  const t = nowMs();
  if (t < ev.startMs || t > ev.endMs) throw new ApiError('not_open', '開催の期間の外');
  const name = playerName(pid);
  state.runs.set(runKey(board, rid), { playerId: pid, state: 'open', startedAtMs: t, appVersion: short(body.appVersion, SHORT_MAX) });
  const entries = entriesOf(board);
  const e = entries.get(pid);
  const attempts = e ? Number(e.attempts || 0) + 1 : 1;
  const fresh = { playerId: pid, name, attempts, clears: 0, history: [], lastRun: rid, updatedAtMs: t };
  entries.set(pid, e ? { ...e, name, attempts, lastRun: rid, updatedAtMs: t } : fresh);
  return [CREATED, { runId: rid, startedAt: isoOf(t), attempts }];
}

function checkFinish(body) {
  const { value, cleared } = body;
  if (!Number.isInteger(value) || value < 0) throw new ApiError('bad_value');
  if (typeof cleared !== 'boolean') throw new ApiError('bad_cleared');
  const detail = body.detail === undefined ? null : body.detail;
  if (detail !== null && (typeof detail !== 'object' || Array.isArray(detail) || JSON.stringify(detail).length > DETAIL_MAX)) throw new ApiError('bad_detail');
  return { value, cleared, detail };
}

function openRunOf(pid, board, rid) {
  const run = state.runs.get(runKey(board, rid));
  if (!run || run.playerId !== pid) throw new ApiError('no_run');
  if (run.state !== 'open') throw new ApiError('already_done');
  return run;
}

function checkTiming(cfg, ev, run, t) {
  const elapsedSec = (t - run.startedAtMs) / MS_PER_SEC;
  if (elapsedSec < Number(cfg.minSec || 0)) throw new ApiError('too_short');
  if (elapsedSec > Number(cfg.maxSec || 0)) throw new ApiError('too_long');
  if (t > ev.endMs + Number(cfg.graceSec || 0) * MS_PER_SEC) throw new ApiError('closed');
  return elapsedSec;
}

function updateEntry(pid, board, rid, { value, cleared, detail, t }) {
  const entries = entriesOf(board);
  const old = entries.get(pid) ?? { attempts: 0, clears: 0, history: [] };
  const history = [{ v: value, c: cleared, at: secondsOf(t) }, ...(old.history || [])].slice(0, HISTORY_MAX);
  const best = old.best === undefined ? NO_BEST : Number(old.best);
  const improved = cleared && value > best;
  const upd = { name: playerName(pid), clears: Number(old.clears || 0) + (cleared ? 1 : 0), lastDone: rid, history, updatedAtMs: t };
  if (improved) Object.assign(upd, { best: value, bestRun: rid }, detail ? { bestDetail: detail } : {});
  entries.set(pid, { ...old, playerId: pid, ...upd });
  return { accepted: true, improved, best: improved ? value : best >= 0 ? best : null, attempts: Number(old.attempts || 0), clears: upd.clears };
}

function finishRun(pid, board, rid, body) {
  const { value, cleared, detail } = checkFinish(body);
  const [cfg, ev] = boardAndEvent(board);
  const run = openRunOf(pid, board, rid);
  const t = nowMs();
  const elapsedSec = checkTiming(cfg, ev, run, t);
  if (value > Number(cfg.maxValue || 0)) throw new ApiError('too_high');
  Object.assign(run, { state: 'done', value, cleared, endedAtMs: t }, detail ? { detail } : {});
  state.finishes.push({ board, runId: rid, playerId: pid, value, cleared, detail, elapsedSec });
  const out = updateEntry(pid, board, rid, { value, cleared, detail, t });
  return [OK, out.best === null ? out : { ...out, ...rankOf(board, out.best) }];
}

function rankOf(board, best) {
  const ranked = rankedEntries(board);
  return { rank: ranked.filter((e) => e.best > best).length + 1, participants: ranked.length };
}

function top(board, q) {
  const limit = intParam(q, 'limit', TOP_LIMIT);
  const docs = rankedEntries(board).sort(byBestDesc).slice(0, limit);
  const rows = docs.map((e) => ({ rank: docs.findIndex((d) => d.best === e.best) + 1, ...row(e) }));
  return [OK, { board, rows }];
}

function myEntry(pid, board) {
  const d = entriesOf(board).get(pid);
  if (!d) return [OK, { exists: false, attempts: 0, clears: 0, history: [] }];
  const out = { exists: true, name: d.name, attempts: d.attempts || 0, clears: d.clears || 0, history: d.history || [], best: d.best === undefined ? null : d.best };
  return [OK, out.best === null ? out : { ...out, ...rankOf(board, out.best) }];
}

function around(pid, board, q) {
  const n = intParam(q, 'n', AROUND_COUNT);
  const mine = entriesOf(board).get(pid);
  if (!mine || mine.best === undefined) return [OK, { up: [], down: [] }];
  const others = rankedEntries(board);
  const up = others.filter((e) => e.best > mine.best).sort(byBestAsc).slice(0, n);
  const down = others.filter((e) => e.best < mine.best).sort(byBestDesc).slice(0, n);
  return [OK, { up: up.map(row), down: down.map(row) }];
}

function border(board, q) {
  const { fallback, min, max } = BORDER_PCT;
  const pct = Math.max(min, Math.min(max, parseFloat(q.get('pct') || String(fallback)) || fallback));
  const ranked = rankedEntries(board).sort(byBestDesc);
  if (ranked.length === 0) return [OK, { pct, participants: 0, value: null }];
  const k = Math.max(1, Math.ceil((ranked.length * pct) / PERCENT));
  return [OK, { pct, participants: ranked.length, value: ranked[k - 1]?.best ?? null }];
}

// 総合ランク（events/{id}/overall）はどの版のアプリも使わないので置かない
const API_ROUTES = [
  ['GET', /^\/v1\/ping$/, () => [OK, { ok: true, time: isoOf(nowMs()), version: VERSION }]],
  ['POST', /^\/v1\/players$/, ({ body }) => register(body)],
  ['GET', /^\/v1\/me$/, ({ pid }) => me(pid), true],
  ['PATCH', /^\/v1\/me$/, ({ pid, body }) => rename(pid, body), true],
  ['POST', /^\/v1\/me\/code$/, ({ pid }) => reissueCode(pid), true],
  ['POST', /^\/v1\/recover$/, ({ req, body }) => recover(req, body)],
  ['GET', /^\/v1\/save$/, ({ pid }) => getSave(pid), true],
  ['PUT', /^\/v1\/save$/, ({ pid, body }) => putSave(pid, body), true],
  ['GET', /^\/v1\/challenge\/events$/, () => events()],
  ['POST', /^\/v1\/challenge\/([\w-]+)\/runs$/, ({ m, pid, body }) => startRun(pid, m[1], body), true],
  ['POST', /^\/v1\/challenge\/([\w-]+)\/runs\/([\w-]+)\/finish$/, ({ m, pid, body }) => finishRun(pid, m[1], m[2], body), true],
  ['GET', /^\/v1\/challenge\/([\w-]+)\/top$/, ({ m, q }) => top(m[1], q)],
  ['GET', /^\/v1\/challenge\/([\w-]+)\/me$/, ({ m, pid }) => myEntry(pid, m[1]), true],
  ['GET', /^\/v1\/challenge\/([\w-]+)\/around$/, ({ m, pid, q }) => around(pid, m[1], q), true],
  ['GET', /^\/v1\/challenge\/([\w-]+)\/border$/, ({ m, q }) => border(m[1], q)],
];

// ここから下の /_test/ の入口は本物の窓口には無い（アプリのコードから呼ばない）
function testNumber(body, key) {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiError('bad_test', `${key} は数値`);
  return v;
}

function testTime(body, key) {
  const ms = typeof body[key] === 'string' ? Date.parse(body[key]) : NaN;
  if (!Number.isFinite(ms)) throw new ApiError('bad_test', `${key} は日時の文字列（ISO）`);
  return ms;
}

function testState() {
  const saves = [...state.saves].map(([pid, s]) => [pid, { size: s.size, appVersion: s.appVersion, savedAt: s.savedAt }]);
  return [OK, {
    players: state.players.size,
    devices: state.devices.size,
    names: [...state.players.values()].map((p) => p.name),
    finishes: state.finishes,
    saves: Object.fromEntries(saves),
    requests: state.requests,
  }];
}

function testReset() {
  clock.offsetMs = 0;
  Object.assign(state, seedState());
  return [OK, { ok: true }];
}

function configView() {
  const ev = state.events.get(DEFAULT_EVENT_ID);
  return {
    ok: true,
    board: { board: DEFAULT_BOARD_ID, ...state.boards.get(DEFAULT_BOARD_ID) },
    event: { id: DEFAULT_EVENT_ID, name: ev.name, start: isoOf(ev.startMs), end: isoOf(ev.endMs) },
    recoverLimit: state.recoverLimit,
  };
}

function testConfig(body) {
  const boardUpd = Object.fromEntries(BOARD_CONFIG_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, testNumber(body, k)]));
  const eventUpd = Object.fromEntries(EVENT_CONFIG_KEYS.filter(([k]) => body[k] !== undefined).map(([k, field]) => [field, testTime(body, k)]));
  const recoverLimit = body.recoverLimit === undefined ? state.recoverLimit : testNumber(body, 'recoverLimit');
  Object.assign(state.boards.get(DEFAULT_BOARD_ID), boardUpd);
  Object.assign(state.events.get(DEFAULT_EVENT_ID), eventUpd);
  state.recoverLimit = recoverLimit;
  return [OK, configView()];
}

function testClock(body) {
  clock.offsetMs += Math.round(testNumber(body, 'advanceSec') * MS_PER_SEC);
  return [OK, { ok: true, now: isoOf(nowMs()), offsetSec: clock.offsetMs / MS_PER_SEC }];
}

const FAILURES = {
  status: (req, res, f) => sendJson(res, f.status, { error: f.error, message: f.error }),
  drop: (req) => req.socket.destroy(),
  hang: () => {},
  // 本物の窓口が書き込みを終えてから返事だけ途切れる場合をなぞる（出し直しで前のコードが消えたのに新しいコードが届かない など）
  lost: async (req, res, f, url) => {
    await settle(() => answerRoute(API_ROUTES, req, url), url.pathname);
    req.socket.destroy();
  },
};

function testFail(body) {
  const { count, mode, status = SERVER_ERROR, error } = body;
  if (!Number.isInteger(count) || count < 0) throw new ApiError('bad_test', 'count は 0 以上の整数');
  if (!Object.hasOwn(FAILURES, mode)) throw new ApiError('bad_test', `mode は ${Object.keys(FAILURES).join(' / ')} のどれか`);
  if (!Number.isInteger(status) || status < FAIL_STATUS_MIN || status > FAIL_STATUS_MAX) throw new ApiError('bad_test', `status は ${FAIL_STATUS_MIN}〜${FAIL_STATUS_MAX}`);
  if (error !== undefined && typeof error !== 'string') throw new ApiError('bad_test', 'error は文字列');
  state.failure = { count, mode, status, error };
  return [OK, { ok: true }];
}

function testRow(r) {
  if (typeof r !== 'object' || r === null || !Number.isInteger(r.best) || r.best < 0) throw new ApiError('bad_test', 'rows の要素は {name, best: 0 以上の整数}');
  return { name: String(r.name ?? ''), best: r.best };
}

function insertFakeEntry({ name, best }, t) {
  const pid = newId('p');
  const rid = newId('r');
  const history = [{ v: best, c: true, at: secondsOf(t) }];
  entriesOf(DEFAULT_BOARD_ID).set(pid, { playerId: pid, name, attempts: 1, clears: 1, history, lastRun: rid, lastDone: rid, best, bestRun: rid, updatedAtMs: t });
  return pid;
}

function testRows(body) {
  if (!Array.isArray(body.rows)) throw new ApiError('bad_test', 'rows は配列');
  const rows = body.rows.map(testRow);
  const t = nowMs();
  return [OK, { ok: true, playerIds: rows.map((r) => insertFakeEntry(r, t)) }];
}

const TEST_ROUTES = [
  ['GET', /^\/_test\/state$/, () => testState()],
  ['POST', /^\/_test\/reset$/, () => testReset()],
  ['POST', /^\/_test\/config$/, ({ body }) => testConfig(body)],
  ['POST', /^\/_test\/clock$/, ({ body }) => testClock(body)],
  ['POST', /^\/_test\/fail$/, ({ body }) => testFail(body)],
  ['POST', /^\/_test\/rows$/, ({ body }) => testRows(body)],
];

// 入口 → 本文 → 鍵 → 中身の順は app.js の handler と同じにする（順が違うと返る error が変わる）
async function readJson(req) {
  if (req.method === 'GET') return {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > BODY_MAX) throw new ApiError('too_large');
    chunks.push(c);
  }
  return size === 0 ? {} : parseObject(Buffer.concat(chunks).toString('utf8'));
}

function parseObject(text) {
  try {
    const v = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('JSON のオブジェクトでない');
    return v;
  } catch {
    throw new ApiError('bad_json');
  }
}

function findRoute(routes, method, pathname) {
  const hit = routes.find(([meth, re]) => meth === method && re.test(pathname));
  if (hit) return hit;
  const pathOk = routes.some(([, re]) => re.test(pathname));
  throw new ApiError(pathOk ? 'bad_method' : 'not_found');
}

async function answerRoute(routes, req, url) {
  const [, re, fn, needAuth] = findRoute(routes, req.method, url.pathname);
  const body = await readJson(req);
  const pid = needAuth ? auth(req) : '';
  return fn({ req, body, pid, m: url.pathname.match(re), q: url.searchParams });
}

async function settle(answer, pathname) {
  try {
    return await answer();
  } catch (e) {
    if (e instanceof ApiError) return [e.status, { error: e.code, message: e.message }];
    console.error(JSON.stringify({ severity: 'ERROR', message: String(e?.stack ?? e), path: pathname }));
    return [SERVER_ERROR, { error: 'server', message: '窓口の中で失敗した' }];
  }
}

function sendJson(res, status, out) {
  res.writeHead(status, { 'content-type': JSON_TYPE, 'cache-control': 'no-store' });
  res.end(JSON.stringify(out));
}

async function answerWith(routes, req, res, url) {
  const [status, out] = await settle(() => answerRoute(routes, req, url), url.pathname);
  sendJson(res, status, out);
}

function takeFailure() {
  const f = state.failure;
  if (f.count < 1) return null;
  f.count -= 1;
  return f;
}

async function answerApi(req, res, url) {
  state.requests += 1;
  const failure = takeFailure();
  if (failure) return FAILURES[failure.mode](req, res, failure, url);
  return answerWith(API_ROUTES, req, res, url);
}

const contentTypeOf = (file) => CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

function sendBody(res, type, body) {
  res.writeHead(OK, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function fileInside(root, pathname) {
  try {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel);
    const back = path.relative(root, file);
    return back === '' || back.split(path.sep)[0] === '..' || path.isAbsolute(back) ? null : file;
  } catch {
    return null;
  }
}

async function readFileOrNull(file) {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

async function serveStatic(res, url, webRoot) {
  if (url.pathname === SERVER_CONFIG_PATH) return sendBody(res, JS_TYPE, SERVER_CONFIG_JS);
  const file = fileInside(webRoot, url.pathname);
  const data = file === null ? null : await readFileOrNull(file);
  if (data === null) return sendJson(res, ERROR_STATUS.not_found, { error: 'not_found', message: `${url.pathname} は返せない` });
  sendBody(res, contentTypeOf(file), data);
}

const isStaticRequest = (req, url) => (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/v1/');

function sendNoContent(res) {
  res.writeHead(NO_CONTENT);
  res.end();
}

// 静的ファイルと CORS の下調べ（OPTIONS）は窓口への要求ではないので、数えず、わざと失敗させる対象にもしない
async function dispatch(req, res, opts) {
  if (opts.cors) Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (opts.cors && req.method === 'OPTIONS') return sendNoContent(res);
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/_test/')) return answerWith(TEST_ROUTES, req, res, url);
  if (opts.webRoot !== null && isStaticRequest(req, url)) return serveStatic(res, url, opts.webRoot);
  return answerApi(req, res, url);
}

const makeListener = (opts) => async (req, res) => {
  try {
    await dispatch(req, res, opts);
  } catch (e) {
    console.error(`にせ窓口: ${req.method} ${req.url} を処理できなかった: ${e?.stack ?? e}`);
    res.destroy();
  }
};

function parseOptions(argv) {
  const options = { port: { type: 'string', default: '0' }, cors: { type: 'boolean', default: false }, web: { type: 'string' } };
  const { values } = parseArgs({ args: argv, options });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > PORT_MAX) throw new Error(`--port は 0〜${PORT_MAX} の整数（${values.port}）`);
  return { port, cors: values.cors, webRoot: values.web === undefined ? null : path.resolve(values.web) };
}

async function checkWebRoot(webRoot) {
  if (webRoot === null) return;
  try {
    if (!(await fs.stat(webRoot)).isDirectory()) throw new Error('フォルダではない');
  } catch (e) {
    throw new Error(`--web のフォルダを使えない（${webRoot}）: ${e.message}`);
  }
}

function listen(opts) {
  const server = http.createServer(makeListener(opts));
  server.on('error', (e) => {
    console.error(`にせ窓口を ${LISTEN_HOST}:${opts.port} で待ち受けられない: ${e.message}`);
    process.exit(EXIT_FAILURE);
  });
  server.listen(opts.port, LISTEN_HOST, () => process.stdout.write(`LISTEN ${server.address().port}\n`));
}

async function main() {
  try {
    const opts = parseOptions(process.argv.slice(2));
    await checkWebRoot(opts.webRoot);
    listen(opts);
  } catch (e) {
    console.error(`にせ窓口を起動できない: ${e.message}\n使い方: node tools/mock-server.mjs [--port N] [--cors] [--web <dir>]`);
    process.exit(EXIT_FAILURE);
  }
}

await main();
