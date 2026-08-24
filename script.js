const EMPTY = 0;
const FIRST = 1;
const SECOND = -1;
const BLOCKED = 2;
const GRAY = 3;
const EVENT_BOARD_SIZE = 'event';
const EXTRA_BOARD_SIZE = 'extra';
const SUPPORTED_BOARD_SIZES = [9, 11, 13];
const SUPPORTED_AI_LEVELS = ['easy', 'normal', 'hard'];
const PIECE_IMAGE = {
    [FIRST]: 'images/unit_red_piece.png',
    [SECOND]: 'images/unit_blue_piece.png',
    [GRAY]: 'images/unit_gray_piece.png'
};

const boardElement = document.getElementById('board');
const currentPlayerElement = document.getElementById('current-player');
const blackScoreElement = document.getElementById('black-score');
const whiteScoreElement = document.getElementById('white-score');
const blackTerritoryElement = document.getElementById('black-territory');
const whiteTerritoryElement = document.getElementById('white-territory');
const boardSizeDisplayElement = document.getElementById('board-size-display');
const aiLevelDisplayElement = document.getElementById('ai-level-display');
const guideDisplayElement = document.getElementById('guide-display');
const passDisplayElement = document.getElementById('pass-display');
const modeDisplay = document.getElementById('mode-display');
const messageElement = document.getElementById('message');
const selectionStatusElement = document.getElementById('selection-status');
const resetButton = document.getElementById('reset-button');
const openSetupButton = document.getElementById('open-setup-button');
const clearSelectionButton = document.getElementById('clear-selection-button');
const setupOverlay = document.getElementById('setup-overlay');
const setupForm = document.getElementById('setup-form');
const aiLevelFieldset = document.getElementById('ai-level-fieldset');
const resultOverlay = document.getElementById('result-overlay');
const resultSummary = document.getElementById('result-summary');
const resultDetail = document.getElementById('result-detail');
const resultRestartButton = document.getElementById('result-restart-button');
const resultSetupButton = document.getElementById('result-setup-button');
const turnChip = document.getElementById('turn-chip');
const passChip = document.getElementById('pass-chip');
const boardArea = document.querySelector('.board-area');
const themeButton = document.getElementById('theme-button');
const titleOverlay = document.getElementById('title-overlay');
const howtoOverlay = document.getElementById('howto-overlay');
const titleStartButton = document.getElementById('title-start-button');
const titleSkipButton = document.getElementById('title-skip-button');
const howtoBackButton = document.getElementById('howto-back-button');
const howtoNextButton = document.getElementById('howto-next-button');
const setupHowtoButton = document.getElementById('setup-howto-button');
const setupCancelButton = document.getElementById('setup-cancel-button');
const setupSubmitButton = document.getElementById('setup-submit-button');
const simpleSizeSelect = document.getElementById('simple-size-select');
const eventMapSelect = document.getElementById('event-map-select');
const boardKindNote = document.getElementById('board-kind-note');

const THEME_STORAGE_KEY = 'gelpiyo-theme';
const PIECE_EXIT_MS = 260;
const darkSchemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

let cellNodes = [];
let renderedBoard = null;
let gameStarted = false;
let activeMap = null;
let board = [];
let boardSize = 11;
let boardRows = 11;
let boardCols = 11;
let currentPlayer = FIRST;
let gameOver = false;
let aiThinking = false;
let consecutivePasses = 0;
let selectedCells = [];
let gameConfig = {
    opponent: 'ai',
    humanColor: FIRST,
    boardSize: 11,
    eventMapIndex: 0,
    aiLevel: 'normal',
    showGuide: true
};

function playerName(player) {
    return player === FIRST ? '先攻' : '後攻';
}
function cellKey(row, col) {
    return `${row},${col}`;
}
function aiLevelLabel(level) {
    return level === 'hard' ? '強い' : level === 'normal' ? '普通' : '弱い';
}
function guideLabel(showGuide) {
    return showGuide ? 'ON' : 'OFF';
}
function isAiMode() {
    return gameConfig.opponent === 'ai';
}
function isHumanTurn() {
    return !isAiMode() || currentPlayer === gameConfig.humanColor;
}
function inBounds(row, col) {
    return row >= 0 && row < boardRows && col >= 0 && col < boardCols;
}
function normalizeBoardSize(value) {
    if (value === EVENT_BOARD_SIZE) return EVENT_BOARD_SIZE;
    if (value === EXTRA_BOARD_SIZE) return EXTRA_BOARD_SIZE;
    const n = Number(value);
    return SUPPORTED_BOARD_SIZES.includes(n) ? n : 11;
}
function normalizeAiLevel(value) {
    return SUPPORTED_AI_LEVELS.includes(value) ? value : 'normal';
}
function normalizeGuide(value) {
    return value !== 'off';
}
function cloneBoard(source) {
    return source.map(row => [...row]);
}
function currentSetupOpponent() {
    return (setupForm.querySelector('input[name="opponent"]:checked')?.value) || 'ai';
}
function currentSetupBoardKind() {
    return (setupForm.querySelector('input[name="boardKind"]:checked')?.value) || 'simple';
}
function updateSetupFormVisibility() {
    aiLevelFieldset.hidden = currentSetupOpponent() !== 'ai';
    const kind = currentSetupBoardKind();
    const noMaps = kind === EVENT_BOARD_SIZE && getEventMaps().length === 0;
    const blocked = kind === EXTRA_BOARD_SIZE || noMaps;
    boardKindNote.textContent = noMaps ? 'イベントの盤面パターンが読み込めません。map.js を確認してください。' : 'エキストラは準備中です。シンプルかイベントを選んでください。';
    boardKindNote.hidden = !blocked;
    setupSubmitButton.disabled = blocked;
}
function prefersReducedMotion() {
    return reducedMotionQuery ? reducedMotionQuery.matches : false;
}
function isDarkTheme() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark' || explicit === 'light') return explicit === 'dark';
    return darkSchemeQuery ? darkSchemeQuery.matches : false;
}
function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const dark = isDarkTheme();
    themeButton.textContent = dark ? 'ダーク' : 'ライト';
    themeButton.setAttribute('aria-label', dark ? 'ライトテーマに切り替える' : 'ダークテーマに切り替える');
}
function readStoredTheme() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
        return null;
    }
}
function toggleTheme() {
    const next = isDarkTheme() ? 'light' : 'dark';
    try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
        applyTheme(next);
        return;
    }
    applyTheme(next);
}
function fitBoard() {
    if (!boardArea) return;
    const area = boardArea.getBoundingClientRect();
    if (area.width <= 0 || area.height <= 0) return;
    const frame = 2 * (parseFloat(getComputedStyle(boardElement).borderLeftWidth) || 0);
    const innerWidth = Math.max(0, area.width - frame);
    const innerHeight = Math.max(0, area.height - frame);
    const width = Math.min(innerWidth, innerHeight * boardCols / boardRows);
    if (width <= 0) return;
    boardElement.style.width = `${Math.floor(width + frame)}px`;
    boardElement.style.height = `${Math.floor(width * boardRows / boardCols + frame)}px`;
}

function getConfigLabel() {
    return !isAiMode() ? '人間 vs 人間' : `AI対戦 / あなた: ${playerName(gameConfig.humanColor)} / ${aiLevelLabel(gameConfig.aiLevel)}`;
}
function applyBoardLayout() {
    boardElement.style.setProperty('--board-cols', String(boardCols));
    boardElement.style.setProperty('--board-rows', String(boardRows));
    applyBoardBackground(activeMap ? activeMap.background : getSimpleBackground());
    boardElement.setAttribute('aria-label', `${boardCols}x${boardRows} ゲルぴよ盤`);
    boardSizeDisplayElement.textContent = activeMap ? `${activeMap.name} ${boardCols} × ${boardRows}` : `シンプル ${boardSize} × ${boardSize}`;
    aiLevelDisplayElement.textContent = isAiMode() ? aiLevelLabel(gameConfig.aiLevel) : '対象外';
    guideDisplayElement.textContent = guideLabel(gameConfig.showGuide);
    passDisplayElement.textContent = consecutivePasses;
    passChip.classList.toggle('is-zero', consecutivePasses === 0);
    fitBoard();
}
function createInitialBoard() {
    boardRows = boardSize;
    boardCols = boardSize;
    const newBoard = Array.from({
        length: boardRows
    }, () => Array(boardCols).fill(EMPTY));
    const center = Math.floor(boardSize / 2);
    newBoard[center - 1][center - 1] = FIRST;
    newBoard[center + 1][center + 1] = SECOND;
    return newBoard;
}

function getSimpleBackground() {
    return typeof window.SIMPLE_BOARD_BACKGROUND === 'string' ? window.SIMPLE_BOARD_BACKGROUND : '';
}
function getEventMaps() {
    if (Array.isArray(window.EVENT_MAPS)) {
        return window.EVENT_MAPS.filter(map => map && Array.isArray(map.cells));
    }
    if (window.EVENT_MAP_DATA) {
        return [window.EVENT_MAP_DATA];
    }
    return [];
}
function eventMapName(map, index) {
    return (map && typeof map.name === 'string' && map.name.trim()) || `イベント${index + 1}`;
}
function normalizeEventMapIndex(value) {
    const maps = getEventMaps();
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index < maps.length ? index : 0;
}
function populateEventMapOptions() {
    const maps = getEventMaps();
    const previous = eventMapSelect.value;
    eventMapSelect.innerHTML = '';
    maps.forEach((map, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = eventMapName(map, index);
        eventMapSelect.appendChild(option);
    });
    eventMapSelect.disabled = maps.length === 0;
    if (maps.length === 0) {
        const option = document.createElement('option');
        option.textContent = '読み込めません';
        eventMapSelect.appendChild(option);
        return;
    }
    eventMapSelect.value = previous && Number(previous) < maps.length ? previous : '0';
}
function applyBoardBackground(background) {
    const url = typeof background === 'string' ? background.trim() : '';
    boardElement.classList.toggle('has-background', url !== '');
    boardElement.style.backgroundImage = url === '' ? '' : `url("${url.replace(/["\\]/g, '\\$&')}")`;
}
function loadEventMap(index) {
    const maps = getEventMaps();
    if (maps.length === 0) {
        throw new Error('map.js が読み込まれていません。index.html と同じフォルダに map.js を配置してください。');
    }
    const chosen = maps[normalizeEventMapIndex(index)];
    return {
        name: eventMapName(chosen, normalizeEventMapIndex(index)),
        background: chosen.background,
        board: parseMapData(chosen)
    };
}
function parseMapData(data) {
    const rawRows = Array.isArray(data) ? data : data.cells;
    if (!Array.isArray(rawRows) || rawRows.length === 0) throw new Error('map.js が空、または cells がありません。');
    const expectedCols = rawRows[0].length;
    if (!expectedCols) throw new Error('map.js の列数が0です。');
    const parsed = rawRows.map((rowData, rowIndex) => {
        if (!Array.isArray(rowData)) throw new Error(`${rowIndex + 1}行目が配列ではありません。`);
        if (rowData.length !== expectedCols) throw new Error(`${rowIndex + 1}行目の列数が他の行と異なります。`);
        return rowData.map(value => {
            const code = String(value || '').charAt(0).toUpperCase();
            if (code === 'W') return EMPTY;
            if (code === 'X') return BLOCKED;
            if (code === 'R') return FIRST;
            if (code === 'B') return SECOND;
            if (code === 'G') return GRAY;
            throw new Error(`map.js に不正なマス種別があります: ${value}`);
        });
    });
    return parsed;
}
function countPieces(sourceBoard=board) {
    let first = 0
      , second = 0;
    for (const row of sourceBoard)
        for (const cell of row) {
            if (cell === FIRST)
                first += 1;
            if (cell === SECOND)
                second += 1;
        }
    return {
        first,
        second
    };
}
function getTerritoryRegions(sourceBoard=board) {
    const firstRegions = []
      , secondRegions = [];
    const cellsForFirst = new Set()
      , cellsForSecond = new Set();
    for (let row = 0; row <= boardRows - 3; row += 1)
        for (let col = 0; col <= boardCols - 3; col += 1) {
            const corners = [sourceBoard[row][col], sourceBoard[row][col + 2], sourceBoard[row + 2][col], sourceBoard[row + 2][col + 2]];
            if (corners.every(v => v === FIRST)) {
                firstRegions.push({
                    row,
                    col,
                    owner: FIRST
                });
                for (let r = row; r < row + 3; r += 1)
                    for (let c = col; c < col + 3; c += 1)
                        cellsForFirst.add(cellKey(r, c));
            }
            if (corners.every(v => v === SECOND)) {
                secondRegions.push({
                    row,
                    col,
                    owner: SECOND
                });
                for (let r = row; r < row + 3; r += 1)
                    for (let c = col; c < col + 3; c += 1)
                        cellsForSecond.add(cellKey(r, c));
            }
        }
    return {
        firstRegions,
        secondRegions,
        cellsForFirst,
        cellsForSecond,
        firstCount: firstRegions.length,
        secondCount: secondRegions.length
    };
}
function isInsideOpponentTerritory(sourceBoard, row, col, player) {
    const territories = getTerritoryRegions(sourceBoard);
    return player === FIRST ? territories.cellsForSecond.has(cellKey(row, col)) : territories.cellsForFirst.has(cellKey(row, col));
}
function purgeEnemyInsideTerritories(sourceBoard) {
    const nextBoard = cloneBoard(sourceBoard);
    const territories = getTerritoryRegions(nextBoard);
    let removed = 0;
    for (const region of territories.firstRegions)
        for (let r = region.row; r < region.row + 3; r += 1)
            for (let c = region.col; c < region.col + 3; c += 1)
                if (nextBoard[r][c] === SECOND || nextBoard[r][c] === GRAY) {
                    nextBoard[r][c] = EMPTY;
                    removed += 1;
                }
    for (const region of territories.secondRegions)
        for (let r = region.row; r < region.row + 3; r += 1)
            for (let c = region.col; c < region.col + 3; c += 1)
                if (nextBoard[r][c] === FIRST || nextBoard[r][c] === GRAY) {
                    nextBoard[r][c] = EMPTY;
                    removed += 1;
                }
    return {
        board: nextBoard,
        removed,
        territories: getTerritoryRegions(nextBoard)
    };
}
function isBlockedGapForPlayer(sourceBoard, row, col, player) {
    const opponent = -player;
    const blockedHorizontal = inBounds(row, col - 1) && inBounds(row, col + 1) && sourceBoard[row][col - 1] === opponent && sourceBoard[row][col + 1] === opponent;
    const blockedVertical = inBounds(row - 1, col) && inBounds(row + 1, col) && sourceBoard[row - 1][col] === opponent && sourceBoard[row + 1][col] === opponent;
    return blockedHorizontal || blockedVertical;
}
function collectCapturesOnBoard(sourceBoard, player) {
    const capturedKeys = new Set();
    for (let row = 0; row < boardRows; row += 1)
        for (let col = 0; col < boardCols; col += 1) {
            if (sourceBoard[row][col] !== -player)
                continue;
            const horizontal = inBounds(row, col - 1) && inBounds(row, col + 1) && sourceBoard[row][col - 1] === player && sourceBoard[row][col + 1] === player;
            const vertical = inBounds(row - 1, col) && inBounds(row + 1, col) && sourceBoard[row - 1][col] === player && sourceBoard[row + 1][col] === player;
            if (horizontal || vertical)
                capturedKeys.add(cellKey(row, col));
        }
    return Array.from(capturedKeys).map(key => key.split(',').map(Number));
}
function getMoveResultOnBoard(sourceBoard, firstCell, secondCell, player) {
    const [r1,c1] = firstCell;
    const [r2,c2] = secondCell;
    if (!inBounds(r1, c1) || !inBounds(r2, c2))
        return null;
    if (r1 === r2 && c1 === c2)
        return null;
    if (sourceBoard[r1][c1] !== EMPTY || sourceBoard[r2][c2] !== EMPTY)
        return null;
    if (isInsideOpponentTerritory(sourceBoard, r1, c1, player) || isInsideOpponentTerritory(sourceBoard, r2, c2, player))
        return null;
    if (isBlockedGapForPlayer(sourceBoard, r1, c1, player) || isBlockedGapForPlayer(sourceBoard, r2, c2, player))
        return null;
    let middle = null;
    if (r1 === r2 && Math.abs(c1 - c2) === 2)
        middle = [r1, (c1 + c2) / 2];
    else if (c1 === c2 && Math.abs(r1 - r2) === 2)
        middle = [(r1 + r2) / 2, c1];
    else
        return null;
    const [midR,midC] = middle;
    if (sourceBoard[midR][midC] !== -player)
        return null;
    const nextBoard = cloneBoard(sourceBoard);
    nextBoard[r1][c1] = player;
    nextBoard[r2][c2] = player;
    const captured = collectCapturesOnBoard(nextBoard, player);
    const includesPrimary = captured.some( ([r,c]) => r === midR && c === midC);
    if (!includesPrimary)
        return null;
    for (const [r,c] of captured)
        nextBoard[r][c] = EMPTY;
    const territoryPurge = purgeEnemyInsideTerritories(nextBoard);
    return {
        player,
        placements: [firstCell, secondCell],
        captured,
        territoryCleared: territoryPurge.removed,
        nextBoard: territoryPurge.board
    };
}
function getValidSecondPlacementsOnBoard(sourceBoard, player, firstCell) {
    const [row,col] = firstCell;
    const candidates = [[row, col - 2], [row, col + 2], [row - 2, col], [row + 2, col]];
    const results = [];
    for (const [r,c] of candidates) {
        const move = getMoveResultOnBoard(sourceBoard, firstCell, [r, c], player);
        if (move)
            results.push(move);
    }
    return results;
}
function getValidFirstPlacementsOnBoard(sourceBoard, player) {
    const map = new Map();
    for (let row = 0; row < boardRows; row += 1)
        for (let col = 0; col < boardCols; col += 1) {
            if (sourceBoard[row][col] !== EMPTY)
                continue;
            if (isInsideOpponentTerritory(sourceBoard, row, col, player))
                continue;
            if (isBlockedGapForPlayer(sourceBoard, row, col, player))
                continue;
            const firstCell = [row, col];
            const secondMoves = getValidSecondPlacementsOnBoard(sourceBoard, player, firstCell);
            if (secondMoves.length > 0)
                map.set(cellKey(row, col), secondMoves);
        }
    return map;
}
function getValidMovesOnBoard(sourceBoard, player) {
    const firstMap = getValidFirstPlacementsOnBoard(sourceBoard, player);
    const moves = [];
    const seen = new Set();
    for (const secondMoves of firstMap.values())
        for (const move of secondMoves) {
            const key = [cellKey(...move.placements[0]), cellKey(...move.placements[1])].sort().join('|');
            if (!seen.has(key)) {
                seen.add(key);
                moves.push(move);
            }
        }
    return moves;
}
function getValidMoves(player) {
    return getValidMovesOnBoard(board, player);
}
function getValidFirstPlacements(player) {
    return getValidFirstPlacementsOnBoard(board, player);
}
function getValidSecondPlacements(player, firstCell) {
    return getValidSecondPlacementsOnBoard(board, player, firstCell);
}
function evaluateBoard(sourceBoard, player) {
    const counts = countPieces(sourceBoard);
    const territories = getTerritoryRegions(sourceBoard);
    const pieceDiff = player === FIRST ? counts.first - counts.second : counts.second - counts.first;
    const mobilityDiff = getValidMovesOnBoard(sourceBoard, player).length - getValidMovesOnBoard(sourceBoard, -player).length;
    const territoryDiff = player === FIRST ? territories.firstCount - territories.secondCount : territories.secondCount - territories.firstCount;
    return pieceDiff * 6 + mobilityDiff * 2 + territoryDiff * 25;
}
function minimax(sourceBoard, playerToMove, rootPlayer, depth, maximizingPlayer) {
    const myMoves = getValidMovesOnBoard(sourceBoard, playerToMove);
    const oppMoves = getValidMovesOnBoard(sourceBoard, -playerToMove);
    if (depth === 0 || (myMoves.length === 0 && oppMoves.length === 0))
        return evaluateBoard(sourceBoard, rootPlayer);
    if (myMoves.length === 0)
        return minimax(sourceBoard, -playerToMove, rootPlayer, depth - 1, !maximizingPlayer);
    if (maximizingPlayer) {
        let best = -Infinity;
        for (const move of myMoves) {
            const value = minimax(move.nextBoard, -playerToMove, rootPlayer, depth - 1, false);
            if (value > best)
                best = value;
        }
        return best;
    }
    let best = Infinity;
    for (const move of myMoves) {
        const value = minimax(move.nextBoard, -playerToMove, rootPlayer, depth - 1, true);
        if (value < best)
            best = value;
    }
    return best;
}
function chooseAiMove(player) {
    const moves = getValidMoves(player);
    if (moves.length === 0)
        return null;
    const simpleScore = move => {
        const counts = countPieces(move.nextBoard);
        const territories = getTerritoryRegions(move.nextBoard);
        const pieceGain = player === FIRST ? counts.first - counts.second : counts.second - counts.first;
        const territoryGain = player === FIRST ? territories.firstCount - territories.secondCount : territories.secondCount - territories.firstCount;
        return pieceGain * 8 + territoryGain * 30 + move.captured.length * 14 + move.territoryCleared * 10;
    }
    ;
    if (gameConfig.aiLevel === 'easy') {
        const ranked = moves.map(move => ({
            move,
            score: simpleScore(move)
        })).sort( (a, b) => b.score - a.score);
        const pool = ranked.slice(0, Math.min(4, ranked.length));
        return pool[Math.floor(Math.random() * pool.length)].move;
    }
    if (gameConfig.aiLevel === 'normal') {
        let bestMove = moves[0]
          , bestScore = simpleScore(bestMove);
        for (let i = 1; i < moves.length; i += 1) {
            const score = simpleScore(moves[i]);
            if (score > bestScore) {
                bestScore = score;
                bestMove = moves[i];
            }
        }
        return bestMove;
    }
    const depth = Math.max(boardRows, boardCols) >= 13 ? 2 : 3;
    let bestMove = moves[0]
      , bestScore = -Infinity;
    for (const move of moves) {
        const score = minimax(move.nextBoard, -player, player, depth - 1, false) + simpleScore(move) * 0.2;
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }
    return bestMove;
}
function selectionToGuideSet() {
    if (!gameConfig.showGuide || gameOver || aiThinking || !isHumanTurn())
        return new Set();
    if (selectedCells.length === 0)
        return new Set(Array.from(getValidFirstPlacements(currentPlayer).keys()));
    const set = new Set();
    for (const move of getValidSecondPlacements(currentPlayer, selectedCells[0]))
        set.add(cellKey(...move.placements[1]));
    return set;
}
function buildBoardCells() {
    boardElement.innerHTML = '';
    cellNodes = [];
    const fragment = document.createDocumentFragment();
    for (let row = 0; row < boardRows; row += 1) {
        const rowNodes = [];
        for (let col = 0; col < boardCols; col += 1) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cell';
            button.dataset.row = String(row);
            button.dataset.col = String(col);
            button.setAttribute('role', 'gridcell');
            button.setAttribute('aria-label', `${row + 1}行 ${col + 1}列`);
            rowNodes.push(button);
            fragment.appendChild(button);
        }
        cellNodes.push(rowNodes);
    }
    boardElement.appendChild(fragment);
    renderedBoard = null;
    fitBoard();
}
function setCellPiece(cell, value, previous, animate) {
    const existing = cell.querySelector('.piece:not(.piece-exit)');
    if (existing) {
        if (animate && previous !== EMPTY && previous !== BLOCKED) {
            existing.classList.add('piece-exit');
            window.setTimeout( () => existing.remove(), PIECE_EXIT_MS);
            cell.classList.add('cell-flash');
            window.setTimeout( () => cell.classList.remove('cell-flash'), PIECE_EXIT_MS + 180);
        } else {
            existing.remove();
        }
    }
    if (value !== FIRST && value !== SECOND && value !== GRAY)
        return;
    const wrap = document.createElement('div');
    wrap.className = value === GRAY ? 'piece piece--gray' : 'piece';
    if (animate)
        wrap.classList.add('piece-enter');
    const img = document.createElement('img');
    img.src = PIECE_IMAGE[value];
    img.alt = value === FIRST ? '先攻の駒' : value === SECOND ? '後攻の駒' : '灰色駒';
    wrap.appendChild(img);
    cell.appendChild(wrap);
}
function renderBoard() {
    if (cellNodes.length !== boardRows || !cellNodes[0] || cellNodes[0].length !== boardCols)
        buildBoardCells();
    const guideSet = selectionToGuideSet();
    const selectedSet = new Set(selectedCells.map( ([r,c]) => cellKey(r, c)));
    const territories = getTerritoryRegions(board);
    const animate = renderedBoard !== null && !prefersReducedMotion();
    const locked = gameOver || aiThinking || (isAiMode() && !isHumanTurn());
    clearSelectionButton.disabled = gameOver || aiThinking || selectedCells.length === 0;
    for (let row = 0; row < boardRows; row += 1)
        for (let col = 0; col < boardCols; col += 1) {
            const cell = cellNodes[row][col];
            const key = cellKey(row, col);
            const cellValue = board[row][col];
            const isBlockedCell = cellValue === BLOCKED;
            cell.disabled = locked || isBlockedCell;
            cell.classList.toggle('disabled', cell.disabled);
            cell.classList.toggle('blocked', isBlockedCell);
            cell.classList.toggle('selected', selectedSet.has(key));
            const isGuide = !isBlockedCell && guideSet.has(key);
            cell.classList.toggle('guide', isGuide);
            cell.classList.toggle('second-guide', isGuide && selectedCells.length > 0);
            cell.classList.toggle('territory-first', territories.cellsForFirst.has(key));
            cell.classList.toggle('territory-second', territories.cellsForSecond.has(key));
            const previous = renderedBoard ? renderedBoard[row][col] : null;
            if (previous !== cellValue)
                setCellPiece(cell, cellValue, previous, animate);
        }
    renderedBoard = cloneBoard(board);
}
function clearSelection(message='1手で2個の駒を選択してください。') {
    selectedCells = [];
    selectionStatusElement.textContent = message;
    renderBoard();
}
function applyMove(move) {
    board = move.nextBoard;
    currentPlayer *= -1;
    consecutivePasses = 0;
    selectedCells = [];
}
function formatMoveMessage(actor, move) {
    const parts = [`${actor}が 2個置いて ${move.captured.length} 個の相手駒を消しました`];
    if (move.territoryCleared > 0)
        parts.push(`陣内の相手駒・灰色駒 ${move.territoryCleared} 個も消えました`);
    return parts.join(' / ') + '。';
}
function handleCellClick(row, col) {
    if (gameOver || aiThinking || board[row][col] !== EMPTY || (isAiMode() && !isHumanTurn()))
        return;
    if (selectedCells.length === 0) {
        if (isInsideOpponentTerritory(board, row, col, currentPlayer)) {
            selectionStatusElement.textContent = 'そのマスは相手の陣の中なので、新しく駒を置けません。';
            renderBoard();
            return;
        }
        if (isBlockedGapForPlayer(board, row, col, currentPlayer)) {
            selectionStatusElement.textContent = 'その空白は相手の「相手 / 空白 / 相手」の間なので置けません。';
            renderBoard();
            return;
        }
        selectedCells = [[row, col]];
        const secondMoves = getValidSecondPlacements(currentPlayer, selectedCells[0]);
        if (secondMoves.length === 0) {
            selectedCells = [];
            selectionStatusElement.textContent = '2個目候補が0件だったため、1個目の選択を自動で解除しました。';
            renderBoard();
            return;
        }
        selectionStatusElement.textContent = `1個目: ${row + 1}行 ${col + 1}列。2個目候補: ${secondMoves.length} 箇所。`;
        renderBoard();
        return;
    }
    if (selectedCells.some( ([r,c]) => r === row && c === col)) {
        selectedCells = selectedCells.filter( ([r,c]) => !(r === row && c === col));
        selectionStatusElement.textContent = selectedCells.length === 0 ? '1手で2個の駒を選択してください。' : '2個目の駒を選んでください。';
        renderBoard();
        return;
    }
    const move = getMoveResultOnBoard(board, selectedCells[0], [row, col], currentPlayer);
    if (!move) {
        selectionStatusElement.textContent = 'その2個目では手が完成しません。';
        renderBoard();
        return;
    }
    const actor = playerName(currentPlayer);
    applyMove(move);
    handleTurnProgress(formatMoveMessage(actor, move));
}
function canCurrentPlayerMove() {
    return getValidMoves(currentPlayer).length > 0;
}
function performAutoPass() {
    const passedPlayer = currentPlayer;
    currentPlayer *= -1;
    consecutivePasses += 1;
    return `${playerName(passedPlayer)}は完成できる手がなくパスです。`;
}
function resolveForcedPasses(messages=[]) {
    let autoPassed = false;
    while (!gameOver && !canCurrentPlayerMove()) {
        autoPassed = true;
        messages.push(performAutoPass());
        if (consecutivePasses >= 2) {
            endGame();
            return {
                ended: true,
                autoPassed,
                message: messages.join(' / ')
            };
        }
    }
    if (!gameOver)
        updateUI(messages.join(' / '));
    selectionStatusElement.textContent = autoPassed ? '連続パスを判定しました。相手の自動パスの直後にこちらも自動パスなら対戦終了です。' : '1手で2個の駒を選択してください。';
    return {
        ended: false,
        autoPassed,
        message: messages.join(' / ')
    };
}
function endGame() {
    gameOver = true;
    aiThinking = false;
    selectedCells = [];
    const counts = countPieces();
    const territories = getTerritoryRegions();
    const firstTotal = counts.first + territories.firstCount * 3;
    const secondTotal = counts.second + territories.secondCount * 3;
    let summary = '引き分け';
    if (firstTotal > secondTotal)
        summary = '先攻の勝ち';
    if (secondTotal > firstTotal)
        summary = '後攻の勝ち';
    updateUI(`ゲーム終了。${summary}！`);
    resultSummary.textContent = `${summary}！`;
    resultDetail.innerHTML = `
    <div class="result-row"><span>盤面サイズ</span><strong>${boardCols} × ${boardRows}</strong></div>
    <div class="result-row"><span>先攻の駒数</span><strong>${counts.first}</strong></div>
    <div class="result-row"><span>後攻の駒数</span><strong>${counts.second}</strong></div>
    <div class="result-row"><span>先攻の陣取り</span><strong>${territories.firstCount}</strong></div>
    <div class="result-row"><span>後攻の陣取り</span><strong>${territories.secondCount}</strong></div>
    <div class="result-row"><span>総合判定</span><strong>${firstTotal} vs ${secondTotal}</strong></div>
    <div class="result-row"><span>対戦設定</span><strong>${getConfigLabel()}</strong></div>
    <div class="result-row"><span>候補ガイド</span><strong>${guideLabel(gameConfig.showGuide)}</strong></div>
  `;
    showScreen('result');
}
function updateUI(message='') {
    const counts = countPieces();
    const territories = getTerritoryRegions();
    const validFirstCount = gameOver ? 0 : getValidFirstPlacements(currentPlayer).size;
    blackScoreElement.textContent = counts.first;
    whiteScoreElement.textContent = counts.second;
    blackTerritoryElement.textContent = territories.firstCount;
    whiteTerritoryElement.textContent = territories.secondCount;
    modeDisplay.textContent = getConfigLabel();
    applyBoardLayout();
    currentPlayerElement.textContent = gameOver ? '終了' : playerName(currentPlayer);
    turnChip.classList.toggle('is-first', !gameOver && currentPlayer === FIRST);
    turnChip.classList.toggle('is-second', !gameOver && currentPlayer === SECOND);
    if (message)
        messageElement.textContent = message;
    else if (gameOver)
        messageElement.textContent = 'ゲーム終了';
    else if (isAiMode() && !isHumanTurn())
        messageElement.textContent = `AI（${playerName(currentPlayer)} / ${aiLevelLabel(gameConfig.aiLevel)}）が考えています...`;
    else
        messageElement.textContent = `${playerName(currentPlayer)}の番です。1個目候補: ${validFirstCount} 箇所。相手の自動パスの直後にこちらもパスなら終了します。`;
    renderBoard();
}
function scheduleAiTurn() {
    if (!isAiMode() || gameOver || isHumanTurn())
        return;
    aiThinking = true;
    updateUI();
    window.setTimeout( () => {
        const actor = `AI（${aiLevelLabel(gameConfig.aiLevel)}）`;
        const move = chooseAiMove(currentPlayer);
        aiThinking = false;
        if (!move) {
            const passResult = resolveForcedPasses([]);
            if (passResult.ended)
                return;
            scheduleAiTurn();
            return;
        }
        applyMove(move);
        handleTurnProgress(formatMoveMessage(actor, move));
    }
    , gameConfig.aiLevel === 'hard' ? 650 : 420);
}
function handleTurnProgress(message='') {
    const result = resolveForcedPasses(message ? [message] : []);
    if (result.ended)
        return;
    scheduleAiTurn();
}
function showScreen(name) {
    titleOverlay.classList.toggle('hidden', name !== 'title');
    howtoOverlay.classList.toggle('hidden', name !== 'howto');
    setupOverlay.classList.toggle('hidden', name !== 'setup');
    resultOverlay.classList.toggle('hidden', name !== 'result');
    if (name === 'setup') {
        updateSetupFormVisibility();
        setupCancelButton.hidden = !gameStarted;
    }
}
function openSetup() {
    showScreen('setup');
}
async function startGameFromConfig() {
    try {
        if (gameConfig.boardSize === EXTRA_BOARD_SIZE) {
            showScreen('setup');
            return;
        }
        gameConfig.aiLevel = normalizeAiLevel(gameConfig.aiLevel);
        gameConfig.showGuide = Boolean(gameConfig.showGuide);
        currentPlayer = FIRST;
        gameOver = false;
        aiThinking = false;
        consecutivePasses = 0;
        selectedCells = [];
        if (gameConfig.boardSize === EVENT_BOARD_SIZE) {
            const loaded = loadEventMap(gameConfig.eventMapIndex);
            activeMap = {
                name: loaded.name,
                background: loaded.background
            };
            board = loaded.board;
            boardRows = board.length;
            boardCols = board[0].length;
            boardSize = Math.max(boardRows, boardCols);
        } else {
            activeMap = null;
            boardSize = normalizeBoardSize(gameConfig.boardSize);
            boardRows = boardSize;
            boardCols = boardSize;
            board = createInitialBoard();
        }
        gameStarted = true;
        showScreen('game');
        updateUI(activeMap ? `イベント「${activeMap.name}」を読み込みました。` : 'ゲーム開始！ 駒はアップロード画像を使用しています。');
        selectionStatusElement.textContent = '1手で2個の駒を選択してください。';
        const result = resolveForcedPasses([]);
        if (!result.ended) scheduleAiTurn();
    } catch (error) {
        console.error(error);
        messageElement.textContent = error.message;
        alert(error.message);
    }
}
setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const boardKind = currentSetupBoardKind();
    if (boardKind === EXTRA_BOARD_SIZE || (boardKind === EVENT_BOARD_SIZE && getEventMaps().length === 0)) {
        updateSetupFormVisibility();
        return;
    }
    const formData = new FormData(setupForm);
    gameConfig = {
        humanColor: formData.get('playerColor') === 'white' ? SECOND : FIRST,
        opponent: formData.get('opponent') === 'human' ? 'human' : 'ai',
        aiLevel: normalizeAiLevel(formData.get('aiLevel')),
        boardSize: boardKind === EVENT_BOARD_SIZE ? EVENT_BOARD_SIZE : normalizeBoardSize(simpleSizeSelect.value),
        eventMapIndex: normalizeEventMapIndex(eventMapSelect.value),
        showGuide: normalizeGuide(formData.get('showGuide'))
    };
    startGameFromConfig();
}
);
setupForm.querySelectorAll('input[name="opponent"]').forEach(input => input.addEventListener('change', updateSetupFormVisibility));
setupForm.querySelectorAll('input[name="boardKind"]').forEach(input => input.addEventListener('change', updateSetupFormVisibility));
function selectBoardKind(kind) {
    const radio = setupForm.querySelector(`input[name="boardKind"][value="${kind}"]`);
    if (radio)
        radio.checked = true;
    updateSetupFormVisibility();
}
simpleSizeSelect.addEventListener('change', () => selectBoardKind('simple'));
eventMapSelect.addEventListener('change', () => selectBoardKind(EVENT_BOARD_SIZE));
openSetupButton.addEventListener('click', openSetup);
clearSelectionButton.addEventListener('click', () => clearSelection());
resetButton.addEventListener('click', startGameFromConfig);
resultRestartButton.addEventListener('click', startGameFromConfig);
resultSetupButton.addEventListener('click', openSetup);
titleStartButton.addEventListener('click', () => showScreen('howto'));
titleSkipButton.addEventListener('click', () => showScreen('setup'));
howtoBackButton.addEventListener('click', () => showScreen('title'));
howtoNextButton.addEventListener('click', () => showScreen('setup'));
setupHowtoButton.addEventListener('click', () => showScreen('howto'));
setupCancelButton.addEventListener('click', () => showScreen('game'));
themeButton.addEventListener('click', toggleTheme);
boardElement.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || cell.disabled || !boardElement.contains(cell))
        return;
    handleCellClick(Number(cell.dataset.row), Number(cell.dataset.col));
}
);
window.addEventListener('resize', fitBoard);
window.addEventListener('orientationchange', fitBoard);
document.querySelectorAll('details').forEach(node => node.addEventListener('toggle', fitBoard));
if (window.ResizeObserver && boardArea)
    new ResizeObserver(fitBoard).observe(boardArea);
if (darkSchemeQuery && darkSchemeQuery.addEventListener)
    darkSchemeQuery.addEventListener('change', () => applyTheme(document.documentElement.dataset.theme));
applyTheme(readStoredTheme());
board = createInitialBoard();
applyBoardLayout();
updateUI('「はじめる」から操作説明と設定に進みます。');
selectionStatusElement.textContent = '先攻は赤い駒、後攻は青い駒です。';
populateEventMapOptions();
updateSetupFormVisibility();
showScreen('title');
