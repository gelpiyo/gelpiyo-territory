const EMPTY = 0;
const FIRST = 1;
const SECOND = -1;
const SUPPORTED_BOARD_SIZES = [9, 11, 13];
const SUPPORTED_AI_LEVELS = ['easy', 'normal', 'hard'];
const PIECE_IMAGE = {
    [FIRST]: 'images/unit_red_piece.png',
    [SECOND]: 'images/unit_blue_piece.png'
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

let board = [];
let boardSize = 11;
let currentPlayer = FIRST;
let gameOver = false;
let aiThinking = false;
let consecutivePasses = 0;
let selectedCells = [];
let gameConfig = {
    opponent: 'ai',
    humanColor: FIRST,
    boardSize: 11,
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
    return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}
function normalizeBoardSize(value) {
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
function updateSetupFormVisibility() {
    aiLevelFieldset.hidden = currentSetupOpponent() !== 'ai';
}

function getConfigLabel() {
    return !isAiMode() ? '人間 vs 人間' : `AI対戦 / あなた: ${playerName(gameConfig.humanColor)} / ${aiLevelLabel(gameConfig.aiLevel)}`;
}
function applyBoardLayout() {
    boardElement.style.setProperty('--board-size', String(boardSize));
    boardElement.setAttribute('aria-label', `${boardSize}x${boardSize} ゲルぴよ盤`);
    boardSizeDisplayElement.textContent = `${boardSize} × ${boardSize}`;
    aiLevelDisplayElement.textContent = isAiMode() ? aiLevelLabel(gameConfig.aiLevel) : '対象外';
    guideDisplayElement.textContent = guideLabel(gameConfig.showGuide);
    passDisplayElement.textContent = consecutivePasses;
}
function createInitialBoard() {
    const newBoard = Array.from({
        length: boardSize
    }, () => Array(boardSize).fill(EMPTY));
    const center = Math.floor(boardSize / 2);
    newBoard[center - 1][center - 1] = FIRST;
    newBoard[center + 1][center + 1] = SECOND;
    return newBoard;
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
    for (let row = 0; row <= boardSize - 3; row += 1)
        for (let col = 0; col <= boardSize - 3; col += 1) {
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
                if (nextBoard[r][c] === SECOND) {
                    nextBoard[r][c] = EMPTY;
                    removed += 1;
                }
    for (const region of territories.secondRegions)
        for (let r = region.row; r < region.row + 3; r += 1)
            for (let c = region.col; c < region.col + 3; c += 1)
                if (nextBoard[r][c] === FIRST) {
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
    for (let row = 0; row < boardSize; row += 1)
        for (let col = 0; col < boardSize; col += 1) {
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
    for (let row = 0; row < boardSize; row += 1)
        for (let col = 0; col < boardSize; col += 1) {
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
    const depth = boardSize >= 13 ? 2 : 3;
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
function renderBoard() {
    const guideSet = selectionToGuideSet();
    const selectedSet = new Set(selectedCells.map( ([r,c]) => cellKey(r, c)));
    const territories = getTerritoryRegions(board);
    boardElement.innerHTML = '';
    for (let row = 0; row < boardSize; row += 1)
        for (let col = 0; col < boardSize; col += 1) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cell';
            button.setAttribute('role', 'gridcell');
            button.setAttribute('aria-label', `${row + 1}行 ${col + 1}列`);
            button.disabled = gameOver || aiThinking || (isAiMode() && !isHumanTurn());
            if (button.disabled)
                button.classList.add('disabled');
            if (selectedSet.has(cellKey(row, col)))
                button.classList.add('selected');
            if (guideSet.has(cellKey(row, col)))
                button.classList.add('guide');
            if (selectedCells.length > 0 && guideSet.has(cellKey(row, col)))
                button.classList.add('second-guide');
            if (territories.cellsForFirst.has(cellKey(row, col)))
                button.classList.add('territory-first');
            if (territories.cellsForSecond.has(cellKey(row, col)))
                button.classList.add('territory-second');
            button.addEventListener('click', () => handleCellClick(row, col));
            if (board[row][col] !== EMPTY) {
                const wrap = document.createElement('div');
                wrap.className = 'piece-image';
                const img = document.createElement('img');
                img.src = PIECE_IMAGE[board[row][col]];
                img.alt = board[row][col] === FIRST ? '先攻の駒' : '後攻の駒';
                wrap.appendChild(img);
                button.appendChild(wrap);
            }
            boardElement.appendChild(button);
        }
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
        parts.push(`陣内の相手駒 ${move.territoryCleared} 個も消えました`);
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
    <div class="result-row"><span>盤面サイズ</span><strong>${boardSize} × ${boardSize}</strong></div>
    <div class="result-row"><span>先攻の駒数</span><strong>${counts.first}</strong></div>
    <div class="result-row"><span>後攻の駒数</span><strong>${counts.second}</strong></div>
    <div class="result-row"><span>先攻の陣取り</span><strong>${territories.firstCount}</strong></div>
    <div class="result-row"><span>後攻の陣取り</span><strong>${territories.secondCount}</strong></div>
    <div class="result-row"><span>総合判定</span><strong>${firstTotal} vs ${secondTotal}</strong></div>
    <div class="result-row"><span>対戦設定</span><strong>${getConfigLabel()}</strong></div>
    <div class="result-row"><span>候補ガイド</span><strong>${guideLabel(gameConfig.showGuide)}</strong></div>
  `;
    resultOverlay.classList.remove('hidden');
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
    if (message)
        messageElement.textContent = message;
    else if (gameOver)
        messageElement.textContent = 'ゲーム終了';
    else if (isAiMode() && !isHumanTurn())
        messageElement.textContent = `AI（${playerName(currentPlayer)} / ${aiLevelLabel(gameConfig.aiLevel)}）が考えています...`;
    else
        messageElement.textContent = `${playerName(currentPlayer)}の番です。1個目候補: ${validFirstCount} 箇所。相手の自動パスの直後にこちらもパスなら終了します。`;
    clearSelectionButton.disabled = gameOver || aiThinking || selectedCells.length === 0;
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
function openSetup() {
    resultOverlay.classList.add('hidden');
    updateSetupFormVisibility();
    setupOverlay.classList.remove('hidden');
}
function closeSetup() {
    setupOverlay.classList.add('hidden');
}
function startGameFromConfig() {
    boardSize = normalizeBoardSize(gameConfig.boardSize);
    gameConfig.aiLevel = normalizeAiLevel(gameConfig.aiLevel);
    gameConfig.showGuide = Boolean(gameConfig.showGuide);
    currentPlayer = FIRST;
    board = createInitialBoard();
    gameOver = false;
    aiThinking = false;
    consecutivePasses = 0;
    selectedCells = [];
    closeSetup();
    resultOverlay.classList.add('hidden');
    updateUI('ゲーム開始！ 駒はアップロード画像を使用しています。');
    selectionStatusElement.textContent = '1手で2個の駒を選択してください。';
    const result = resolveForcedPasses([]);
    if (!result.ended)
        scheduleAiTurn();
}
setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(setupForm);
    gameConfig = {
        humanColor: formData.get('playerColor') === 'white' ? SECOND : FIRST,
        opponent: formData.get('opponent') === 'human' ? 'human' : 'ai',
        aiLevel: normalizeAiLevel(formData.get('aiLevel')),
        boardSize: normalizeBoardSize(formData.get('boardSize')),
        showGuide: normalizeGuide(formData.get('showGuide'))
    };
    startGameFromConfig();
}
);
setupForm.querySelectorAll('input[name="opponent"]').forEach(input => input.addEventListener('change', updateSetupFormVisibility));
openSetupButton.addEventListener('click', openSetup);
clearSelectionButton.addEventListener('click', () => clearSelection());
resetButton.addEventListener('click', startGameFromConfig);
resultRestartButton.addEventListener('click', startGameFromConfig);
resultSetupButton.addEventListener('click', openSetup);
board = createInitialBoard();
applyBoardLayout();
updateUI('ゲーム設定を選んで開始してください。');
selectionStatusElement.textContent = '先攻は赤画像、後攻は青画像の駒です。';
updateSetupFormVisibility();
openSetup();
