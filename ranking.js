// ランキング点の計算と表示・対局の判定。サーバーとは通信しない純粋な処理だけを置きます。
(function () {
    const RANK_TIME_LIMIT_SEC = 3600;
    const AI_WEIGHT = Object.freeze({ easy: 1, normal: 2, hard: 3 });
    const MS_PER_SECOND = 1000;
    const THOUSANDS_SEPARATOR = /\B(?=(\d{3})+(?!\d))/g;
    const NO_POINTS_TEXT = '-';
    const DETAIL_APP = 'gelpiyo-territory';
    const DETAIL_VERSION = 1;
    const NOTES = Object.freeze({
        lost: 'ランキングの対象は、AI戦で勝った対局だけです。',
        overtime: '60分以上かかった対局は、ランキングの対象外です。',
        excluded: '人間同士の対局は、ランキングの対象外です。'
    });

    // 2^53 以上の数は正確な整数として扱えず、Godot 版の int でもあふれうるため、安全な整数（2^53 − 1 以下）だけを認めます。
    function isNonNegativeInteger(value) {
        return Number.isSafeInteger(value) && value >= 0;
    }
    function hasAiWeight(ai) {
        return typeof ai === 'string' && Object.prototype.hasOwnProperty.call(AI_WEIGHT, ai);
    }
    // 結果画面の「対局時間」（formatElapsed）と同じ Math.round で丸めます。
    function playSeconds(playMs) {
        return Math.max(0, Math.round(playMs / MS_PER_SECOND));
    }
    function encodeRankValue(score, playMs, ai) {
        if (!isNonNegativeInteger(score) || !hasAiWeight(ai) || !Number.isFinite(playMs))
            return null;
        const seconds = playSeconds(playMs);
        if (seconds >= RANK_TIME_LIMIT_SEC)
            return null;
        const value = score * (RANK_TIME_LIMIT_SEC - seconds) * AI_WEIGHT[ai];
        return isNonNegativeInteger(value) ? value : null;
    }
    function detailSeconds(playMs) {
        const seconds = playSeconds(playMs);
        return isNonNegativeInteger(seconds) ? seconds : null;
    }
    function formatRankPoints(value) {
        if (!isNonNegativeInteger(value))
            return NO_POINTS_TEXT;
        return `${String(value).replace(THOUSANDS_SEPARATOR, ',')}点`;
    }
    function rankedNote(value) {
        return `ランキングの対象です（ランキング点 ${formatRankPoints(value)}）。`;
    }
    function scoreParts(side) {
        return {
            pieces: side.pieces,
            regions: side.regions,
            cubes: side.cubes,
            total: side.total
        };
    }
    function challengeDetail(input) {
        return {
            app: DETAIL_APP,
            v: DETAIL_VERSION,
            mode: input.mode,
            board: input.board,
            ai: input.ai,
            side: input.side,
            guide: input.guide,
            resumed: input.resumed,
            sec: detailSeconds(input.playMs),
            self: scoreParts(input.self),
            opponent: scoreParts(input.opponent)
        };
    }
    // 「ai」以外の対戦はすべて対象外にします（ランキングに紛れ込ませないため）。
    function challengeStatus(input) {
        if (input.vs !== 'ai')
            return 'excluded';
        if (input.self.total <= input.opponent.total)
            return 'lost';
        return playSeconds(input.playMs) >= RANK_TIME_LIMIT_SEC ? 'overtime' : 'ranked';
    }
    function buildChallengeResult(input) {
        const status = challengeStatus(input);
        const isAiGame = status !== 'excluded';
        const value = isAiGame ? encodeRankValue(input.self.total, input.playMs, input.ai) : null;
        return {
            status,
            note: status === 'ranked' ? rankedNote(value) : NOTES[status],
            cleared: status === 'ranked',
            value,
            playMs: input.playMs,
            detail: isAiGame ? challengeDetail(input) : null
        };
    }

    window.GelpiyoRanking = Object.freeze({
        RANK_TIME_LIMIT_SEC,
        AI_WEIGHT,
        NOTES,
        playSeconds,
        encodeRankValue,
        formatRankPoints,
        buildChallengeResult
    });
}());
