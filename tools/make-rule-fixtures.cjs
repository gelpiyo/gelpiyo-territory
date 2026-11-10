// Godot版のルール移植が Web版と同じ結果になるかを照合するためのデータを作ります。
// Web版（script.js / extra-rules.js）で多数の局面を作り、各局面の合法手・消える駒・陣・AIの選ぶ手を記録します。
//   node tools/make-rule-fixtures.cjs
//   godot --headless --path godot --script res://tests/rules_check.gd
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadWebEngine, ROOT } = require('./load-web-engine.cjs');

const OUT_DIR = path.join(ROOT, 'godot', 'tests', 'fixtures');

function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const SYMBOL = { '0': '.', '1': 'r', '-1': 'b', '2': 'x', '3': 'g' };
function encode(values) {
    let text = '';
    for (const value of values) text += SYMBOL[String(value)];
    return text;
}
function md5(text) {
    return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

// --- 2D ---------------------------------------------------------------------
function make2D(engine) {
    const { run, context } = engine;
    const rand = mulberry32(20261023);
    const configs = [];
    for (const size of [9, 11, 13]) configs.push({ kind: 'simple', size });
    engine.eventMaps.forEach((_map, index) => configs.push({ kind: 'event', index }));
    const positions = [];
    for (const config of configs) {
        for (let game = 0; game < 3; game += 1) {
            if (config.kind === 'simple') {
                run(`boardSize = ${config.size}; boardRows = ${config.size}; boardCols = ${config.size}; board = createInitialBoard();`);
            } else {
                run(`(() => { const loaded = loadEventMap(${config.index}); board = loaded.board; boardRows = board.length; boardCols = board[0].length; boardSize = Math.max(boardRows, boardCols); })()`);
            }
            let player = 1;
            let passes = 0;
            for (let ply = 0; ply < 60 && passes < 2; ply += 1) {
                context.__player = player;
                const rows = run('boardRows');
                const cols = run('boardCols');
                const flat = run('board.flat()');
                const moves = run('getValidMovesOnBoard(board, __player)');
                if (moves.length === 0) {
                    passes += 1;
                    player = -player;
                    continue;
                }
                passes = 0;
                const record = rand() < 0.45 || ply < 4;
                if (record) {
                    const toIndex = ([r, c]) => r * cols + c;
                    const firstMap = run('getValidFirstPlacementsOnBoard(board, __player)');
                    const entry = {
                        config,
                        rows,
                        cols,
                        player,
                        board: encode(flat),
                        first_cells: Array.from(firstMap.keys()).map(key => toIndex(key.split(',').map(Number))),
                        moves: moves.map(move => ({
                            p1: toIndex(move.placements[0]),
                            p2: toIndex(move.placements[1]),
                            captured: move.captured.map(toIndex),
                            cleared: move.territoryCleared,
                            next: md5(encode(move.nextBoard.flat()))
                        })),
                        opponent_move_count: run('getValidMovesOnBoard(board, -__player).length'),
                        evaluate: run('evaluateBoard(board, __player)'),
                        territories: run('(() => { const t = getTerritoryRegions(board); return [t.firstCount, t.secondCount]; })()')
                    };
                    for (const level of ['normal', 'hard']) {
                        if (level === 'hard' && rand() > 0.35) continue;
                        run(`gameConfig.aiLevel = '${level}'`);
                        const chosen = run('chooseAiMove(__player)');
                        entry[`ai_${level}`] = [toIndex(chosen.placements[0]), toIndex(chosen.placements[1])];
                    }
                    // 弱いAIの候補（上位4手）。chooseAiMove は無作為に1つ選ぶので、候補の並びを照合します。
                    entry.easy_pool = run(`(() => {
                        const simpleScore = move => {
                            const counts = countPieces(move.nextBoard);
                            const territories = getTerritoryRegions(move.nextBoard);
                            const pieceGain = __player === FIRST ? counts.first - counts.second : counts.second - counts.first;
                            const territoryGain = __player === FIRST ? territories.firstCount - territories.secondCount : territories.secondCount - territories.firstCount;
                            return pieceGain * 8 + territoryGain * 30 + move.captured.length * 14 + move.territoryCleared * 10;
                        };
                        const ranked = getValidMovesOnBoard(board, __player).map(move => ({ move, score: simpleScore(move) })).sort((a, b) => b.score - a.score);
                        return ranked.slice(0, Math.min(4, ranked.length)).map(entry => entry.move.placements);
                    })()`).map(pair => [toIndex(pair[0]), toIndex(pair[1])]);
                    positions.push(entry);
                }
                // 局面を進める: 半分は「普通」AIの手、半分は無作為の手（陣ができる局面も混ぜるため）
                let next;
                if (rand() < 0.5) {
                    run("gameConfig.aiLevel = 'normal'");
                    next = run('chooseAiMove(__player)');
                } else {
                    next = moves[Math.floor(rand() * moves.length)];
                }
                context.__next = next;
                run('board = __next.nextBoard');
                player = -player;
            }
        }
    }
    return positions;
}

// --- 3D ---------------------------------------------------------------------
function make3D(engine) {
    const rules = engine.rules3d;
    const rand = mulberry32(3172026);
    const positions = [];
    for (let game = 0; game < 6; game += 1) {
        let board = rules.createInitialBoard();
        let player = 1;
        let passes = 0;
        for (let ply = 0; ply < 70 && passes < 2; ply += 1) {
            const moves = rules.getValidMoves(board, player);
            if (moves.length === 0) {
                passes += 1;
                player = -player;
                continue;
            }
            passes = 0;
            if (rand() < 0.3 || ply < 3) {
                const t = rules.getTerritories(board);
                const entry = {
                    player,
                    board: encode(board),
                    moves: moves.map(move => ({
                        a: move.placements[0],
                        b: move.placements[1],
                        axis: move.axis,
                        middle: move.middle,
                        captured: move.captured,
                        cleared: move.territoryCleared,
                        dissolved: move.planesDissolved,
                        next: md5(encode(move.nextBoard))
                    })),
                    territories: [t.firstPlaneCount, t.secondPlaneCount, t.firstCubeCount, t.secondCubeCount],
                    score_first: rules.scoreOf(board, 1),
                    score_second: rules.scoreOf(board, -1),
                    ai_normal: rules.chooseAiMove(board, player, 'normal').placements
                };
                if (rand() < 0.3) entry.ai_hard = rules.chooseAiMove(board, player, 'hard').placements;
                positions.push(entry);
            }
            const next = rand() < 0.6 ? rules.chooseAiMove(board, player, 'normal') : moves[Math.floor(rand() * moves.length)];
            board = next.nextBoard;
            player = -player;
        }
    }
    return positions;
}

// 3Dで「立方陣の成立」と「重なった相手の平面陣の解体」を必ず含めるための人工局面。
// 立方体の八隅のうち7つを自分の色にし、残る1隅に置くと相手駒を挟める形を作ります。
function make3DCrafted(engine) {
    const rules = engine.rules3d;
    const rand = mulberry32(777);
    const SIZE = rules.SIZE;
    const positions = [];
    for (let attempt = 0; attempt < 400 && positions.length < 90; attempt += 1) {
        const board = new Int8Array(SIZE * SIZE * SIZE);
        for (let i = 0; i < board.length; i += 1) {
            const r = rand();
            board[i] = r < 0.12 ? 1 : r < 0.24 ? -1 : r < 0.27 ? 3 : r < 0.29 ? 2 : 0;
        }
        const player = rand() < 0.5 ? 1 : -1;
        const x0 = Math.floor(rand() * (SIZE - 2));
        const y0 = Math.floor(rand() * (SIZE - 2));
        const z0 = Math.floor(rand() * (SIZE - 2));
        const corners = [];
        for (const a of [0, 2]) for (const b of [0, 2]) for (const c of [0, 2]) corners.push([x0 + a, y0 + b, z0 + c]);
        // 相手の平面陣を立方体に重ねて置く（隅が立方体の隅と重ならない向き・位置を選ぶ）
        const ox = x0 + Math.floor(rand() * 3) - 1;
        const oy = y0 + 1;
        const oz = z0 + Math.floor(rand() * 3) - 1;
        const planeCorners = [[ox, oy, oz], [ox + 2, oy, oz], [ox, oy, oz + 2], [ox + 2, oy, oz + 2]];
        if (planeCorners.every(([x, y, z]) => rules.inBounds(x, y, z))) for (const [x, y, z] of planeCorners) board[rules.index(x, y, z)] = -player;
        const missing = corners[Math.floor(rand() * corners.length)];
        for (const [x, y, z] of corners) board[rules.index(x, y, z)] = player;
        const axis = Math.floor(rand() * 3);
        const dir = rand() < 0.5 ? -1 : 1;
        const step = [0, 0, 0];
        step[axis] = dir;
        const mid = [missing[0] + step[0], missing[1] + step[1], missing[2] + step[2]];
        const other = [missing[0] + 2 * step[0], missing[1] + 2 * step[1], missing[2] + 2 * step[2]];
        if (!rules.inBounds(...other)) continue;
        board[rules.index(...missing)] = 0;
        board[rules.index(...mid)] = -player;
        board[rules.index(...other)] = 0;
        const moves = rules.getValidMoves(board, player);
        if (moves.length === 0) continue;
        const t = rules.getTerritories(board);
        positions.push({
            player,
            board: encode(board),
            moves: moves.map(move => ({
                a: move.placements[0],
                b: move.placements[1],
                axis: move.axis,
                middle: move.middle,
                captured: move.captured,
                cleared: move.territoryCleared,
                dissolved: move.planesDissolved,
                next: md5(encode(move.nextBoard))
            })),
            territories: [t.firstPlaneCount, t.secondPlaneCount, t.firstCubeCount, t.secondCubeCount],
            score_first: rules.scoreOf(board, 1),
            score_second: rules.scoreOf(board, -1),
            ai_normal: rules.chooseAiMove(board, player, 'normal').placements,
            ai_hard: positions.length % 6 === 0 ? rules.chooseAiMove(board, player, 'hard').placements : undefined
        });
    }
    return positions;
}

// 2Dで灰色駒・設置禁止マス・長方形盤を多く含めるための無作為な盤面。
function make2DRandom(engine) {
    const { run, context } = engine;
    const rand = mulberry32(4242);
    const positions = [];
    for (let n = 0; n < 160; n += 1) {
        const rows = 5 + Math.floor(rand() * 10);
        const cols = 5 + Math.floor(rand() * 12);
        const board = [];
        for (let r = 0; r < rows; r += 1) {
            const row = [];
            for (let c = 0; c < cols; c += 1) {
                const v = rand();
                row.push(v < 0.2 ? 1 : v < 0.4 ? -1 : v < 0.45 ? 3 : v < 0.5 ? 2 : 0);
            }
            board.push(row);
        }
        const player = rand() < 0.5 ? 1 : -1;
        context.__b = board;
        context.__player = player;
        run(`board = __b; boardRows = ${rows}; boardCols = ${cols}; boardSize = Math.max(boardRows, boardCols);`);
        const moves = run('getValidMovesOnBoard(board, __player)');
        if (moves.length === 0) continue;
        const toIndex = ([r, c]) => r * cols + c;
        const firstMap = run('getValidFirstPlacementsOnBoard(board, __player)');
        const entry = {
            config: { kind: 'random' },
            rows,
            cols,
            player,
            board: encode(board.flat()),
            first_cells: Array.from(firstMap.keys()).map(key => toIndex(key.split(',').map(Number))),
            moves: moves.map(move => ({
                p1: toIndex(move.placements[0]),
                p2: toIndex(move.placements[1]),
                captured: move.captured.map(toIndex),
                cleared: move.territoryCleared,
                next: md5(encode(move.nextBoard.flat()))
            })),
            opponent_move_count: run('getValidMovesOnBoard(board, -__player).length'),
            evaluate: run('evaluateBoard(board, __player)'),
            territories: run('(() => { const t = getTerritoryRegions(board); return [t.firstCount, t.secondCount]; })()')
        };
        run("gameConfig.aiLevel = 'normal'");
        const normal = run('chooseAiMove(__player)');
        entry.ai_normal = [toIndex(normal.placements[0]), toIndex(normal.placements[1])];
        if (rows * cols <= 120 && n % 3 === 0) {
            run("gameConfig.aiLevel = 'hard'");
            const hard = run('chooseAiMove(__player)');
            entry.ai_hard = [toIndex(hard.placements[0]), toIndex(hard.placements[1])];
        }
        positions.push(entry);
    }
    return positions;
}

const engine = loadWebEngine();
fs.mkdirSync(OUT_DIR, { recursive: true });
const p2 = make2D(engine).concat(make2DRandom(engine));
fs.writeFileSync(path.join(OUT_DIR, 'rules_2d.json'), JSON.stringify(p2) + '\n', 'utf8');
const p3 = make3D(engine).concat(make3DCrafted(engine));
fs.writeFileSync(path.join(OUT_DIR, 'rules_3d.json'), JSON.stringify(p3) + '\n', 'utf8');
const stat = list => ({
    positions: list.length,
    moves: list.reduce((sum, entry) => sum + entry.moves.length, 0),
    hard: list.filter(entry => entry.ai_hard).length
});
console.log('2D', stat(p2), 'territory positions', p2.filter(e => e.territories[0] + e.territories[1] > 0).length);
console.log('3D', stat(p3), 'plane positions', p3.filter(e => e.territories[0] + e.territories[1] > 0).length, 'cube positions', p3.filter(e => e.territories[2] + e.territories[3] > 0).length, 'dissolve moves', p3.reduce((s, e) => s + e.moves.filter(m => m.dissolved > 0).length, 0));
