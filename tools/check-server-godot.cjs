'use strict';
// にせ窓口（tools/mock-server.mjs）を起こし、Godot版の窓口との通信の確認（godot/tests/server_check.gd）を流します。実行は作業フォルダで node tools/check-server-godot.cjs [--resolution 195x422]（本番の窓口には決してつなぎません）。
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MOCK_SCRIPT = path.join(__dirname, 'mock-server.mjs');
const GODOT_COMMAND = 'godot';
const GODOT_PROJECT = path.join(ROOT, 'godot');
const TEST_SCRIPT = 'res://tests/server_check.gd';
const MOCK_HOST = '127.0.0.1';
const LISTEN_PATTERN = /^LISTEN (\d+)\s*$/m;
const ERROR_PATTERNS = [/SCRIPT ERROR/, /Parse Error/];
// server_check.gd が保存データを元に戻した後にだけ出す行。無ければ途中で止まり、保存データがテストの状態のまま残っているかもしれません
const SUMMARY_PATTERN = /窓口との通信の確認: 不一致 \d+ 件/;
const LEFTOVER_WARNING = 'Godot のテストが途中で止まったため、このPCの Godot 版の保存データ（アカウント・送り残しなど）がテストの状態のまま残っているかもしれません。ゲームを普通に起動する前に、もう一度 node tools/check-server-godot.cjs を流してください（始めに元の状態へ戻します）。';
const BANNER_CHAR = '!';
const BANNER_WIDTH = 72;
// --script を外されて製品の起動（本番の窓口につながる）にならないよう、Godot に渡せる引数は画面の大きさだけにします
const RESOLUTION_FLAG = '--resolution';
const RESOLUTION_PATTERN = /^\d+x\d+$/;
const MOCK_START_TIMEOUT_MS = 10000;
const MS_PER_MINUTE = 60000;
const GODOT_TIMEOUT_MINUTES = 10;
const EXIT_FAILURE = 1;

function parseGodotArgs(argv) {
  if (argv.length === 0) return [];
  if (argv.length === 2 && argv[0] === RESOLUTION_FLAG && RESOLUTION_PATTERN.test(argv[1])) return argv;
  throw new Error(`Godot に渡せる引数は「${RESOLUTION_FLAG} <幅>x<高さ>」だけです（渡された引数: ${argv.join(' ')}）`);
}

async function startMock() {
  const mock = spawn(process.execPath, [MOCK_SCRIPT], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    return { mock, port: await listenPort(mock) };
  } catch (e) {
    mock.kill();
    throw new Error(`${e.message}（${MOCK_SCRIPT}）`);
  }
}

function listenPort(mock) {
  mock.stdout.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`にせ窓口が ${MOCK_START_TIMEOUT_MS} ms 以内に LISTEN を出さない`)), MOCK_START_TIMEOUT_MS);
    const stop = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    mock.on('error', (e) => stop(new Error(`にせ窓口を起動できない: ${e.message}`)));
    mock.once('exit', (code) => stop(new Error(`にせ窓口が終了した（終了コード ${code}）`)));
    mock.stdout.on('data', (chunk) => {
      output += chunk;
      const listened = LISTEN_PATTERN.exec(output);
      if (listened === null) return;
      clearTimeout(timer);
      resolve(Number(listened[1]));
    });
  });
}

function relay(stream, sink, collect) {
  stream.setEncoding('utf8');
  stream.on('data', (text) => {
    collect(text);
    sink.write(text);
  });
}

function runGodot(url, godotArgs) {
  const args = [...godotArgs, '--path', GODOT_PROJECT, '--script', TEST_SCRIPT, '--', `--server=${url}`];
  const godot = spawn(GODOT_COMMAND, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  relay(godot.stdout, process.stdout, (text) => chunks.push(text));
  relay(godot.stderr, process.stderr, (text) => chunks.push(text));
  return waitForGodot(godot, chunks);
}

function waitForGodot(godot, chunks) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`Godot が ${GODOT_TIMEOUT_MINUTES} 分たっても終わらないため止めます。`);
      godot.kill();
    }, GODOT_TIMEOUT_MINUTES * MS_PER_MINUTE);
    godot.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Godot を起動できない（${GODOT_COMMAND}）: ${e.message}`));
    });
    godot.on('close', (code) => {
      clearTimeout(timer);
      resolve(outcomeOf(code, chunks.join(''), timedOut));
    });
  });
}

function outcomeOf(code, output, timedOut) {
  return {
    code: code ?? EXIT_FAILURE,
    scriptError: ERROR_PATTERNS.some((pattern) => pattern.test(output)),
    finished: !timedOut && SUMMARY_PATTERN.test(output),
  };
}

function warnLeftoverSaveData() {
  const banner = BANNER_CHAR.repeat(BANNER_WIDTH);
  console.error(`\n${banner}\n${LEFTOVER_WARNING}\n${banner}\n`);
}

async function main() {
  const godotArgs = parseGodotArgs(process.argv.slice(2));
  const { mock, port } = await startMock();
  try {
    const { code, scriptError, finished } = await runGodot(`http://${MOCK_HOST}:${port}`, godotArgs);
    if (scriptError) console.error('Godot の出力に SCRIPT ERROR / Parse Error があります。');
    if (!finished) warnLeftoverSaveData();
    return (scriptError || !finished) && code === 0 ? EXIT_FAILURE : code;
  } finally {
    mock.kill();
  }
}

(async () => {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error(`check-server-godot: ${e.message}`);
    process.exitCode = EXIT_FAILURE;
  }
})();
