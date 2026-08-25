// 3D rules for エキストラ mode (XYZ).
// 2D 用のエンジン（シンプル / イベント）は script.js 側にあり、こちらとは独立しています。
//
// 盤面は 9 × 9 × 9。座標は 0 始まりで index(x, y, z) の一次元配列に格納します。
// 陣地は2段階:
//   平面陣地 … 軸に沿った 3 × 3 の四隅が自分の色（XY / XZ / YZ の3向き）
//   立方陣地 … 3 × 3 × 3 の八隅が自分の色
(function () {
    const SIZE = 9;
    const EMPTY = 0;
    const FIRST = 1;
    const SECOND = -1;
    const BLOCKED = 2;
    const GRAY = 3;
    const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const AXIS_LABELS = ['X', 'Y', 'Z'];

    function index(x, y, z) {
        return (x * SIZE + y) * SIZE + z;
    }
    function decode(i) {
        return {
            x: Math.floor(i / (SIZE * SIZE)),
            y: Math.floor(i / SIZE) % SIZE,
            z: i % SIZE
        };
    }
    function inBounds(x, y, z) {
        return x >= 0 && x < SIZE && y >= 0 && y < SIZE && z >= 0 && z < SIZE;
    }
    function cloneBoard(source) {
        return Int8Array.from(source);
    }
    function createInitialBoard() {
        const board = new Int8Array(SIZE * SIZE * SIZE);
        board[index(3, 3, 3)] = FIRST;
        board[index(5, 5, 5)] = SECOND;
        return board;
    }
    function buildPlaneRegions() {
        const regions = [];
        for (let x = 0; x < SIZE; x += 1)
            for (let y = 0; y < SIZE; y += 1)
                for (let z = 0; z < SIZE; z += 1) {
                    if (x + 2 < SIZE && y + 2 < SIZE) {
                        const cells = [];
                        for (let a = 0; a < 3; a += 1)
                            for (let b = 0; b < 3; b += 1)
                                cells.push(index(x + a, y + b, z));
                        regions.push({
                            kind: 'plane',
                            orientation: 'XY',
                            normal: 2,
                            cells,
                            corners: [index(x, y, z), index(x + 2, y, z), index(x, y + 2, z), index(x + 2, y + 2, z)]
                        });
                    }
                    if (x + 2 < SIZE && z + 2 < SIZE) {
                        const cells = [];
                        for (let a = 0; a < 3; a += 1)
                            for (let b = 0; b < 3; b += 1)
                                cells.push(index(x + a, y, z + b));
                        regions.push({
                            kind: 'plane',
                            orientation: 'XZ',
                            normal: 1,
                            cells,
                            corners: [index(x, y, z), index(x + 2, y, z), index(x, y, z + 2), index(x + 2, y, z + 2)]
                        });
                    }
                    if (y + 2 < SIZE && z + 2 < SIZE) {
                        const cells = [];
                        for (let a = 0; a < 3; a += 1)
                            for (let b = 0; b < 3; b += 1)
                                cells.push(index(x, y + a, z + b));
                        regions.push({
                            kind: 'plane',
                            orientation: 'YZ',
                            normal: 0,
                            cells,
                            corners: [index(x, y, z), index(x, y + 2, z), index(x, y, z + 2), index(x, y + 2, z + 2)]
                        });
                    }
                }
        return regions;
    }
    function buildCubeRegions() {
        const regions = [];
        for (let x = 0; x + 2 < SIZE; x += 1)
            for (let y = 0; y + 2 < SIZE; y += 1)
                for (let z = 0; z + 2 < SIZE; z += 1) {
                    const cells = [];
                    for (let a = 0; a < 3; a += 1)
                        for (let b = 0; b < 3; b += 1)
                            for (let c = 0; c < 3; c += 1)
                                cells.push(index(x + a, y + b, z + c));
                    const corners = [];
                    for (const a of [0, 2])
                        for (const b of [0, 2])
                            for (const c of [0, 2])
                                corners.push(index(x + a, y + b, z + c));
                    regions.push({
                        kind: 'cube',
                        cells,
                        corners
                    });
                }
        return regions;
    }

    const PLANE_REGIONS = buildPlaneRegions();
    const CUBE_REGIONS = buildCubeRegions();

    function countPieces(board) {
        let first = 0;
        let second = 0;
        for (let i = 0; i < board.length; i += 1) {
            if (board[i] === FIRST) first += 1;
            else if (board[i] === SECOND) second += 1;
        }
        return {
            first,
            second
        };
    }
    function getTerritories(board) {
        const firstPlanes = [];
        const secondPlanes = [];
        const firstCubes = [];
        const secondCubes = [];
        const cellsForFirst = new Set();
        const cellsForSecond = new Set();
        // 平面陣の中の駒は、その平面の法線軸からは挟めません。
        // cell -> 挟めない軸のビットマスク（1 << 軸番号）を持ち回ります。
        const guardForFirst = new Map();
        const guardForSecond = new Map();
        // 平面陣を形成している駒（＝成立している平面陣の四隅）。
        // 平面陣の消去ではこれを残し、立方陣の消去では残しません。
        const planeCornersFirst = new Set();
        const planeCornersSecond = new Set();
        const collect = (regions, planeBucketFirst, planeBucketSecond) => {
            for (const region of regions) {
                const owner = board[region.corners[0]];
                if (owner !== FIRST && owner !== SECOND) continue;
                let matched = true;
                for (let i = 1; i < region.corners.length; i += 1)
                    if (board[region.corners[i]] !== owner) {
                        matched = false;
                        break;
                    }
                if (!matched) continue;
                (owner === FIRST ? planeBucketFirst : planeBucketSecond).push(region);
                const target = owner === FIRST ? cellsForFirst : cellsForSecond;
                for (const cell of region.cells) target.add(cell);
                if (region.kind !== 'plane') continue;
                const guard = owner === FIRST ? guardForFirst : guardForSecond;
                const bit = 1 << region.normal;
                for (const cell of region.cells) guard.set(cell, (guard.get(cell) || 0) | bit);
                const corners = owner === FIRST ? planeCornersFirst : planeCornersSecond;
                for (const cell of region.corners) corners.add(cell);
            }
        };
        collect(PLANE_REGIONS, firstPlanes, secondPlanes);
        collect(CUBE_REGIONS, firstCubes, secondCubes);
        return {
            firstPlanes,
            secondPlanes,
            firstCubes,
            secondCubes,
            cellsForFirst,
            cellsForSecond,
            guardForFirst,
            guardForSecond,
            planeCornersFirst,
            planeCornersSecond,
            firstPlaneCount: firstPlanes.length,
            secondPlaneCount: secondPlanes.length,
            firstCubeCount: firstCubes.length,
            secondCubeCount: secondCubes.length
        };
    }
    function isInsideOpponentTerritory(territories, cell, player) {
        return player === FIRST ? territories.cellsForSecond.has(cell) : territories.cellsForFirst.has(cell);
    }
    function isBlockedGap(board, x, y, z, player) {
        const opponent = -player;
        for (const [dx, dy, dz] of AXES) {
            if (!inBounds(x - dx, y - dy, z - dz) || !inBounds(x + dx, y + dy, z + dz)) continue;
            if (board[index(x - dx, y - dy, z - dz)] === opponent && board[index(x + dx, y + dy, z + dz)] === opponent) return true;
        }
        return false;
    }
    function collectCaptures(board, player, territories) {
        const captured = [];
        const guard = territories ? (player === FIRST ? territories.guardForSecond : territories.guardForFirst) : null;
        for (let i = 0; i < board.length; i += 1) {
            if (board[i] !== -player) continue;
            const blockedAxes = guard ? (guard.get(i) || 0) : 0;
            const { x, y, z } = decode(i);
            for (let axis = 0; axis < AXES.length; axis += 1) {
                if (blockedAxes & (1 << axis)) continue;
                const [dx, dy, dz] = AXES[axis];
                if (!inBounds(x - dx, y - dy, z - dz) || !inBounds(x + dx, y + dy, z + dz)) continue;
                if (board[index(x - dx, y - dy, z - dz)] === player && board[index(x + dx, y + dy, z + dz)] === player) {
                    captured.push(i);
                    break;
                }
            }
        }
        return captured;
    }
    function clearRegionCells(board, cells, owner, spared) {
        let removed = 0;
        for (const cell of cells) {
            if (spared && spared.has(cell)) continue;
            const value = board[cell];
            if (value === -owner || value === GRAY) {
                board[cell] = EMPTY;
                removed += 1;
            }
        }
        return removed;
    }
    // 立方陣地の成立時のみ: 立方体に重なっている相手の平面陣地を解体し、
    // 立方体の外にはみ出している分の駒までまとめて消します。
    function dissolveOverlappedPlanes(board, cubeRegion, owner, territories) {
        const opponentPlanes = owner === FIRST ? territories.secondPlanes : territories.firstPlanes;
        const cubeCells = new Set(cubeRegion.cells);
        let removed = 0;
        for (const plane of opponentPlanes) {
            let overlaps = false;
            for (const cell of plane.cells)
                if (cubeCells.has(cell)) {
                    overlaps = true;
                    break;
                }
            if (!overlaps) continue;
            removed += clearRegionCells(board, plane.cells, owner);
        }
        return removed;
    }
    function purgeTerritories(source) {
        const board = cloneBoard(source);
        const territories = getTerritories(board);
        let removed = 0;
        let dissolved = 0;
        for (const region of territories.firstPlanes) removed += clearRegionCells(board, region.cells, FIRST, territories.planeCornersSecond);
        for (const region of territories.secondPlanes) removed += clearRegionCells(board, region.cells, SECOND, territories.planeCornersFirst);
        for (const region of territories.firstCubes) {
            removed += clearRegionCells(board, region.cells, FIRST);
            dissolved += dissolveOverlappedPlanes(board, region, FIRST, territories);
        }
        for (const region of territories.secondCubes) {
            removed += clearRegionCells(board, region.cells, SECOND);
            dissolved += dissolveOverlappedPlanes(board, region, SECOND, territories);
        }
        return {
            board,
            removed: removed + dissolved,
            dissolved
        };
    }
    function getMoveResult(source, cellA, cellB, player, territories) {
        const a = decode(cellA);
        const b = decode(cellB);
        if (source[cellA] !== EMPTY || source[cellB] !== EMPTY) return null;
        let axis = -1;
        const deltas = [b.x - a.x, b.y - a.y, b.z - a.z];
        for (let i = 0; i < 3; i += 1) {
            if (Math.abs(deltas[i]) !== 2) continue;
            if (deltas[(i + 1) % 3] !== 0 || deltas[(i + 2) % 3] !== 0) continue;
            axis = i;
        }
        if (axis === -1) return null;
        const middle = index((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        if (source[middle] !== -player) return null;
        const known = territories || getTerritories(source);
        if (isInsideOpponentTerritory(known, cellA, player) || isInsideOpponentTerritory(known, cellB, player)) return null;
        if (isBlockedGap(source, a.x, a.y, a.z, player) || isBlockedGap(source, b.x, b.y, b.z, player)) return null;
        const placed = cloneBoard(source);
        placed[cellA] = player;
        placed[cellB] = player;
        const captured = collectCaptures(placed, player, known);
        if (!captured.includes(middle)) return null;
        for (const cell of captured) placed[cell] = EMPTY;
        const purged = purgeTerritories(placed);
        return {
            player,
            axis,
            axisLabel: AXIS_LABELS[axis],
            placements: [cellA, cellB],
            middle,
            captured,
            territoryCleared: purged.removed,
            planesDissolved: purged.dissolved,
            nextBoard: purged.board
        };
    }
    // 着手は必ず相手駒を挟むため、相手駒を中心にした候補だけを調べれば漏れなく列挙できます。
    function getValidMoves(board, player) {
        const territories = getTerritories(board);
        const moves = [];
        for (let i = 0; i < board.length; i += 1) {
            if (board[i] !== -player) continue;
            const { x, y, z } = decode(i);
            for (const [dx, dy, dz] of AXES) {
                if (!inBounds(x - dx, y - dy, z - dz) || !inBounds(x + dx, y + dy, z + dz)) continue;
                const move = getMoveResult(board, index(x - dx, y - dy, z - dz), index(x + dx, y + dy, z + dz), player, territories);
                if (move) moves.push(move);
            }
        }
        return moves;
    }
    function getFirstPlacements(board, player) {
        const map = new Map();
        for (const move of getValidMoves(board, player))
            for (const cell of move.placements) {
                if (!map.has(cell)) map.set(cell, []);
                map.get(cell).push(move);
            }
        return map;
    }
    function getSecondPlacements(board, player, firstCell) {
        const moves = getFirstPlacements(board, player).get(firstCell) || [];
        return moves.map(move => ({
            move,
            cell: move.placements[0] === firstCell ? move.placements[1] : move.placements[0]
        }));
    }
    function scoreOf(board, player) {
        const counts = countPieces(board);
        const territories = getTerritories(board);
        const pieces = player === FIRST ? counts.first : counts.second;
        const planes = player === FIRST ? territories.firstPlaneCount : territories.secondPlaneCount;
        const cubes = player === FIRST ? territories.firstCubeCount : territories.secondCubeCount;
        return {
            pieces,
            planes,
            cubes,
            total: pieces + planes * 3 + cubes * 9
        };
    }
    function simpleScore(move, player) {
        const counts = countPieces(move.nextBoard);
        const territories = getTerritories(move.nextBoard);
        const pieceGain = player === FIRST ? counts.first - counts.second : counts.second - counts.first;
        const planeGain = player === FIRST ? territories.firstPlaneCount - territories.secondPlaneCount : territories.secondPlaneCount - territories.firstPlaneCount;
        const cubeGain = player === FIRST ? territories.firstCubeCount - territories.secondCubeCount : territories.secondCubeCount - territories.firstCubeCount;
        return pieceGain * 8 + planeGain * 24 + cubeGain * 70 + move.captured.length * 14 + move.territoryCleared * 10;
    }
    // 3Dは合法手が平均30手前後あるため、探索幅を固定して2手読みします。
    // 幅を制限しないと終盤で1手あたり1.5秒以上かかり、画面が固まります。
    const HARD_BRANCH = 8;
    function chooseHardMove(board, player, moves) {
        const ranked = moves.map(move => ({
            move,
            score: simpleScore(move, player)
        })).sort((a, b) => b.score - a.score).slice(0, HARD_BRANCH);
        let bestMove = ranked[0].move;
        let bestScore = -Infinity;
        for (const entry of ranked) {
            let bestReply = 0;
            for (const reply of getValidMoves(entry.move.nextBoard, -player)) {
                const value = simpleScore(reply, -player);
                if (value > bestReply) bestReply = value;
            }
            const score = entry.score - bestReply * 0.6;
            if (score > bestScore) {
                bestScore = score;
                bestMove = entry.move;
            }
        }
        return bestMove;
    }
    function chooseAiMove(board, player, level) {
        const moves = getValidMoves(board, player);
        if (moves.length === 0) return null;
        if (level === 'easy') {
            const ranked = moves.map(move => ({
                move,
                score: simpleScore(move, player)
            })).sort((a, b) => b.score - a.score);
            const pool = ranked.slice(0, Math.min(4, ranked.length));
            return pool[Math.floor(Math.random() * pool.length)].move;
        }
        if (level === 'normal') {
            let bestMove = moves[0];
            let bestScore = simpleScore(bestMove, player);
            for (let i = 1; i < moves.length; i += 1) {
                const score = simpleScore(moves[i], player);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = moves[i];
                }
            }
            return bestMove;
        }
        return chooseHardMove(board, player, moves);
    }

    window.Extra3DRules = Object.freeze({
        SIZE,
        EMPTY,
        FIRST,
        SECOND,
        BLOCKED,
        GRAY,
        index,
        decode,
        inBounds,
        createInitialBoard,
        cloneBoard,
        countPieces,
        getTerritories,
        getValidMoves,
        getFirstPlacements,
        getSecondPlacements,
        getMoveResult,
        chooseAiMove,
        scoreOf
    });
}());
