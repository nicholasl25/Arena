/**
 * Long YouTube workflow preview — alternates bracket view ↔ arena match view.
 * Bracket presentation stays static except for the short result-card transition.
 */
(function () {
    'use strict';

    const PHASE = {
        BRACKET_INTRO: 'bracket-intro',
        POWERUP_SPIN: 'powerup-spin',
        ARENA: 'arena',
        COMPOSE: 'compose',
        BRACKET_ADVANCE: 'bracket-advance',
        BRACKET_HOLD: 'bracket-hold',
        CHAMPION: 'champion',
    };

    const DUR = {
        bracketIntro: 1600,
        compose: 1000,
        advance: 850,
        bracketHold: 1100,
        champion: 2600,
    };

    const WEAPON_ICON_URLS = {
        sword: 'premade-weapons/sprites/Sword.png',
        dagger: 'premade-weapons/sprites/Sword.png',
        hammer: 'premade-weapons/sprites/Stone_Hammer.png',
        bow: 'premade-weapons/sprites/Bow-unloaded.png',
        slingshot: 'premade-weapons/sprites/Slingshot.png',
        basketball: 'premade-weapons/sprites/Basketball.png',
        grenade: 'premade-weapons/sprites/Grenade.png',
        staff: 'premade-weapons/sprites/Staff.png',
    };
    /** @type {Record<string, HTMLImageElement>} */
    const weaponIconImgs = {};

    let canvas = null;
    let ctx = null;
    let running = false;
    let raf = 0;
    let state = null;
    let phase = PHASE.BRACKET_INTRO;
    let phaseStarted = 0;
    let activeMatch = null;
    let lastWinner = null;
    let lastLoser = null;
    let advanceFrom = null;
    let onStatus = null;
    let onMatchCompose = null;
    let onArenaMatch = null;
    let getArenaResult = null;
    let onBracketChange = null;
    let onPhaseChange = null;
    let lastFrame = 0;
    let playbackRate = 1;
    /** When true, pause after the current match finishes (bracket + arena + VO + advance). */
    let stopAfterMatch = false;
    let sourceBracket = null;
    let bracketOnly = false;
    let composeWait = null;
    let composeReady = false;
    let lastComposeKey = null;
    let lastArenaMatchKey = null;
    let phaseEpoch = 0;
    let phaseHistory = [];
    let arenaRetryCount = 0;
    let pendingBracketPre = null;
    /** When true, run the optional powerup wheel phase after bracket-intro. */
    let powerupSpinEnabled = false;
    let spinA = null;
    let spinB = null;
    let lastPowerupSpins = null;
    let spinTickElapsed = -1;
    let audioUnlockBound = false;

    function mount(el, opts = {}) {
        canvas = el;
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
        onMatchCompose = typeof opts.onMatchCompose === 'function' ? opts.onMatchCompose : null;
        onArenaMatch = typeof opts.onArenaMatch === 'function' ? opts.onArenaMatch : null;
        getArenaResult = typeof opts.getArenaResult === 'function' ? opts.getArenaResult : null;
        onBracketChange = typeof opts.onBracketChange === 'function' ? opts.onBracketChange : null;
        onPhaseChange = typeof opts.onPhaseChange === 'function' ? opts.onPhaseChange : null;
        if (typeof document !== 'undefined' && !audioUnlockBound) {
            audioUnlockBound = true;
            document.addEventListener('pointerdown', () => window.ArenaAudio?.unlock?.(), { passive: true });
        }
        resize();
    }

    function phaseNode(nextPhase) {
        if (nextPhase === PHASE.POWERUP_SPIN) return 'powerup';
        if (nextPhase === PHASE.ARENA) return 'record';
        if (nextPhase === PHASE.COMPOSE) return 'compose';
        return 'bracket';
    }

    function transitionTo(nextPhase) {
        phase = nextPhase;
        phaseStarted = performance.now();
        phaseHistory.push(nextPhase);
        if (phaseHistory.length > 20) phaseHistory.shift();
        onPhaseChange?.({ phase: nextPhase, nodeId: phaseNode(nextPhase) });
    }

    function resize() {
        if (!canvas) return;
        const parent = canvas.parentElement;
        const availableW = Math.max(1, parent?.clientWidth || 640);
        const maxH = Math.max(1, Math.min(window.innerHeight * 0.62, 600));
        const cssW = Math.min(availableW, maxH * 16 / 9);
        const cssH = cssW * 9 / 16;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function setStatus(text) {
        onStatus?.(text);
    }

    function start(bracketState, opts = {}) {
        if (!canvas || !window.WorkflowBracket) return;
        stop();
        sourceBracket = bracketState;
        state = window.WorkflowBracket.clone(bracketState);
        window.WorkflowBracket.settleByes(state);
        phaseEpoch += 1;
        phaseHistory = [];
        activeMatch = window.WorkflowBracket.currentMatch(state);
        lastWinner = null;
        lastLoser = null;
        advanceFrom = null;
        stopAfterMatch = false;
        bracketOnly = opts.bracketOnly === true;
        composeWait = null;
        composeReady = false;
        lastComposeKey = null;
        lastArenaMatchKey = null;
        arenaRetryCount = 0;
        pendingBracketPre = null;
        powerupSpinEnabled = opts.powerupSpin === true;
        spinA = null;
        spinB = null;
        lastPowerupSpins = null;
        spinTickElapsed = -1;
        const autorun = opts.autorun !== false && !state.complete;
        running = autorun;
        canvas.hidden = false;
        resize();
        transitionTo(state.complete ? PHASE.CHAMPION : PHASE.BRACKET_INTRO);
        if (autorun && opts.initialView === 'arena' && !state.complete) beginArena();
        setStatus(statusForPhase());
        lastFrame = performance.now();
        if (running) raf = requestAnimationFrame(tick);
        else draw(performance.now());
    }

    function stop() {
        phaseEpoch += 1;
        running = false;
        stopAfterMatch = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        state = null;
        activeMatch = null;
        lastWinner = null;
        lastLoser = null;
        advanceFrom = null;
        composeWait = null;
        composeReady = false;
        lastComposeKey = null;
        lastArenaMatchKey = null;
        arenaRetryCount = 0;
        pendingBracketPre = null;
        powerupSpinEnabled = false;
        spinA = null;
        spinB = null;
        lastPowerupSpins = null;
        phase = PHASE.BRACKET_INTRO;
        phaseHistory = [];
        onPhaseChange?.({ phase: null, nodeId: null });
    }

    function pauseAtMatchBoundary() {
        running = false;
        stopAfterMatch = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        draw(performance.now());
        const base = statusForPhase();
        setStatus(base ? `${base} · paused` : 'Paused');
    }

    function resume() {
        if (!state || running || phase === PHASE.CHAMPION) return false;
        stopAfterMatch = false;
        running = true;
        phaseStarted = performance.now();
        lastFrame = performance.now();
        setStatus(statusForPhase());
        raf = requestAnimationFrame(tick);
        return true;
    }

    function isRunning() {
        return running;
    }

    function hasState() {
        return Boolean(state);
    }

    function isMatchCycleActive() {
        return Boolean(state && (
            phase === PHASE.POWERUP_SPIN
            || phase === PHASE.ARENA
            || phase === PHASE.COMPOSE
            || phase === PHASE.BRACKET_ADVANCE
            || phase === PHASE.BRACKET_HOLD
        ));
    }

    function cyclePlaybackRate() {
        playbackRate = playbackRate === 1 ? 2 : (playbackRate === 2 ? 4 : 1);
        return playbackRate;
    }

    function setPlaybackRate(rate) {
        const next = Number(rate);
        playbackRate = (next === 2 || next === 4) ? next : 1;
        return playbackRate;
    }

    /**
     * Run exactly one full match (bracket intro → arena → voice-over → advance),
     * then pause before the next match begins. Mid-match calls finish the current match.
     */
    function stepOneMatch() {
        if (!canvas || !window.WorkflowBracket) return false;
        if (!state) {
            if (!sourceBracket) return false;
            start(sourceBracket);
        }
        if (phase === PHASE.CHAMPION) return false;
        stopAfterMatch = true;
        if (phase === PHASE.COMPOSE && !composeWait) {
            running = true;
            enterComposePhase();
            return true;
        }
        if (!running) {
            running = true;
            phaseStarted = performance.now();
            lastFrame = performance.now();
            setStatus(statusForPhase());
            raf = requestAnimationFrame(tick);
        }
        return true;
    }

    function captureBounds() {
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        };
    }

    function getDebugState() {
        return {
            phase,
            running,
            bracketOnly,
            hasArenaPhysics: Boolean(getArenaResult),
            resultAnimation: phase === PHASE.BRACKET_ADVANCE,
            composing: phase === PHASE.COMPOSE,
            composeReady,
            winnerSpotlight: false,
            winner: lastWinner?.name || null,
            loser: lastLoser?.name || null,
            composeKey: lastComposeKey,
            activeMatchId: activeMatch?.id || null,
            arenaPair: activeMatch ? [activeMatch.a?.name || null, activeMatch.b?.name || null] : [],
            playbackRate,
            phaseHistory: phaseHistory.slice(),
            durations: { ...DUR },
            arenaRetryCount,
            powerupSpinEnabled,
            spinResults: spinA && spinB
                ? [spinA.resultName, spinB.resultName]
                : null,
        };
    }

    function statusForPhase() {
        if (!state) return '';
        const WB = window.WorkflowBracket;
        if (phase === PHASE.CHAMPION && state.champion) {
            return `Champion — ${state.champion.name}`;
        }
        if (phase === PHASE.COMPOSE && lastWinner) {
            return `Voice over — ${lastWinner.name} wins`;
        }
        if (phase === PHASE.POWERUP_SPIN && activeMatch) {
            return `Powerup spin — ${activeMatch.a?.name || '?'} vs ${activeMatch.b?.name || '?'}`;
        }
        if (phase === PHASE.ARENA && activeMatch) {
            return `${activeMatch.a.name} vs ${activeMatch.b.name}`;
        }
        if (phase === PHASE.BRACKET_ADVANCE && lastWinner) {
            return `${lastWinner.name} advances`;
        }
        if (activeMatch) {
            const label = WB.roundLabel(activeMatch.round, state.rounds.length);
            return `${label} — ${activeMatch.a?.name || '?'} vs ${activeMatch.b?.name || '?'}`;
        }
        return 'Bracket';
    }

    function beginPowerupSpin() {
        activeMatch = window.WorkflowBracket.currentMatch(state);
        if (!activeMatch) {
            transitionTo(PHASE.CHAMPION);
            setStatus(statusForPhase());
            return;
        }
        const Wheel = window.PowerupWheel;
        if (!Wheel) {
            beginArena();
            return;
        }
        spinA = Wheel.createSpin({ fighter: activeMatch.a, delayMs: 0 });
        spinB = Wheel.createSpin({
            fighter: activeMatch.b,
            delayMs: Wheel.nextSpinDelayMs(spinA),
        });
        spinTickElapsed = -1;
        Wheel.preloadIcons?.([...(spinA.slices || []), ...(spinB.slices || [])]);
        window.ArenaAudio?.unlock?.();
        transitionTo(PHASE.POWERUP_SPIN);
        setStatus(statusForPhase());
    }

    function finishPowerupSpin() {
        const Wheel = window.PowerupWheel;
        if (Wheel && activeMatch) {
            Wheel.applyResultToFighter(activeMatch.a, spinA?.resultId || '');
            Wheel.applyResultToFighter(activeMatch.b, spinB?.resultId || '');
            window.LongPipeline?.requirePowerupSpinResult?.({
                matchKey: window.WorkflowBracket.matchComposeKey?.(activeMatch) || activeMatch.id || '',
                fighters: [
                    {
                        id: activeMatch.a?.id || null,
                        name: activeMatch.a?.name || '',
                        powerupId: spinA?.resultId || '',
                    },
                    {
                        id: activeMatch.b?.id || null,
                        name: activeMatch.b?.name || '',
                        powerupId: spinB?.resultId || '',
                    },
                ],
            });
        }
        lastPowerupSpins = currentPowerupSpins();
        beginArena();
    }

    function currentPowerupSpins() {
        if (!powerupSpinEnabled || !spinA || !spinB || !window.PowerupWheel?.serializeSpin) {
            return lastPowerupSpins;
        }
        return {
            a: window.PowerupWheel.serializeSpin(spinA),
            b: window.PowerupWheel.serializeSpin(spinB),
        };
    }

    function setPowerupSpinEnabled(enabled) {
        const next = enabled === true;
        if (powerupSpinEnabled === next) return next;
        powerupSpinEnabled = next;
        if (!next) lastPowerupSpins = null;
        if (!next && phase === PHASE.POWERUP_SPIN) {
            spinA = null;
            spinB = null;
            beginArena();
        }
        return powerupSpinEnabled;
    }

    function beginArena() {
        activeMatch = window.WorkflowBracket.currentMatch(state);
        if (!activeMatch) {
            transitionTo(PHASE.CHAMPION);
            setStatus(statusForPhase());
            return;
        }
        transitionTo(PHASE.ARENA);
        try {
            syncArenaMatch(true);
        } catch (err) {
            running = false;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            setStatus(`Arena failed — ${err.message || err}`);
            throw err;
        }
        setStatus(statusForPhase());
    }

    function syncArenaMatch(force = false) {
        if (!activeMatch || !onArenaMatch) return;
        const key = window.WorkflowBracket.matchComposeKey(activeMatch);
        if (!force && key && key === lastArenaMatchKey) return;
        onArenaMatch({
            match: activeMatch,
            matchup: window.WorkflowBracket.matchArenaMatchup(activeMatch),
            retry: force && key === lastArenaMatchKey,
        });
        lastArenaMatchKey = key || activeMatch.id;
    }

    function applyMatchResult(winner) {
        const acceptsResult = phase === PHASE.ARENA
            || (bracketOnly && phase === PHASE.BRACKET_INTRO);
        if (!state || !activeMatch || !acceptsResult) {
            return false;
        }
        if (!winner && bracketOnly) {
            winner = window.WorkflowBracket.pickDemoWinner(activeMatch);
        }
        if (!winner) return false;
        const bracketPre = window.WorkflowBracket.clone(state);
        advanceFrom = activeMatch;
        window.WorkflowBracket.applyWinner(state, winner);
        lastWinner = advanceFrom.winner;
        const winnerKey = window.WorkflowBracket.fighterKey(lastWinner);
        lastLoser = advanceFrom?.a && window.WorkflowBracket.fighterKey(advanceFrom.a) !== winnerKey
            ? advanceFrom.a
            : advanceFrom?.b || null;
        pendingBracketPre = bracketPre;
        enterComposePhase(bracketPre);
        return true;
    }

    function enterComposePhase(bracketPre = null) {
        if (!advanceFrom) {
            beginBracketAdvance();
            return;
        }
        // Standalone bracket.html skips voice-over; workflow preview always runs it.
        if (bracketOnly || !onMatchCompose) {
            beginBracketAdvance();
            return;
        }
        const matchKey = window.WorkflowBracket.matchComposeKey(advanceFrom);
        lastComposeKey = matchKey || null;
        transitionTo(PHASE.COMPOSE);
        composeReady = false;
        setStatus(statusForPhase());
        const composeEpoch = phaseEpoch;
        const composeKey = lastComposeKey;
        const preState = bracketPre || pendingBracketPre;
        const payload = {
            matchKey,
            match: advanceFrom,
            winner: lastWinner,
            loser: lastLoser,
            bracketPre: preState || null,
            bracketPost: window.WorkflowBracket.clone(state),
            powerupSpins: lastPowerupSpins || currentPowerupSpins(),
        };
        composeWait = Promise.resolve()
            .then(() => onMatchCompose(payload))
            .then(() => {
                composeWait = null;
                if (
                    !state
                    || phaseEpoch !== composeEpoch
                    || phase !== PHASE.COMPOSE
                    || lastComposeKey !== composeKey
                ) return;
                composeReady = true;
            }, (err) => {
                if (phaseEpoch !== composeEpoch || lastComposeKey !== composeKey) return;
                console.warn('match compose failed', err);
                composeWait = null;
                running = false;
                if (raf) cancelAnimationFrame(raf);
                raf = 0;
                setStatus(`Voice over failed — ${err.message || err}`);
            });
    }

    function beginBracketAdvance() {
        composeReady = false;
        transitionTo(PHASE.BRACKET_ADVANCE);
        setStatus(statusForPhase());
    }

    function beginBracketHold() {
        // Persist only after compose and the result-card transition. If the page
        // reloads earlier, the same match safely replays and compose deduplicates.
        onBracketChange?.(window.WorkflowBracket.clone(state));
        transitionTo(PHASE.BRACKET_HOLD);
        setStatus(lastWinner ? `${lastWinner.name} advanced` : 'Bracket updated');
    }

    function afterBracketHold() {
        if (state.complete) {
            activeMatch = null;
            advanceFrom = null;
        lastComposeKey = null;
        lastArenaMatchKey = null;
        pendingBracketPre = null;
        transitionTo(PHASE.CHAMPION);
            setStatus(statusForPhase());
            if (stopAfterMatch) pauseAtMatchBoundary();
            return;
        }
        // Transition to the next pre-match bracket before clearing result fields
        // or syncing Arena, so a setMatchup failure cannot leave us stranded in
        // bracket-advance with a dead animation frame loop.
        activeMatch = window.WorkflowBracket.currentMatch(state);
        lastWinner = null;
        lastLoser = null;
        advanceFrom = null;
        lastComposeKey = null;
        lastArenaMatchKey = null;
        arenaRetryCount = 0;
        pendingBracketPre = null;
        spinA = null;
        spinB = null;
        lastPowerupSpins = null;
        transitionTo(PHASE.BRACKET_INTRO);
        setStatus(statusForPhase());
        if (stopAfterMatch) pauseAtMatchBoundary();
    }

    function pollArenaResult() {
        if (!getArenaResult || !activeMatch) return;
        const result = getArenaResult({
            match: activeMatch,
            matchup: window.WorkflowBracket.matchArenaMatchup(activeMatch),
        });
        if (!result) return;
        if (result.winner) {
            applyMatchResult(result.winner);
            return;
        }
        if (result.draw) {
            arenaRetryCount += 1;
            setStatus(`Draw · restarting real fight (${arenaRetryCount})`);
            syncArenaMatch(true);
        }
    }

    function tick(now) {
        if (!running || !ctx || !canvas) return;
        lastFrame = now;
        const elapsed = (now - phaseStarted) * playbackRate;

        if (phase === PHASE.BRACKET_INTRO && !bracketOnly && elapsed >= DUR.bracketIntro) {
            if (powerupSpinEnabled) beginPowerupSpin();
            else beginArena();
        } else if (phase === PHASE.POWERUP_SPIN) {
            const Wheel = window.PowerupWheel;
            if (Wheel?.playDueTicks) {
                Wheel.playDueTicks(spinA, spinTickElapsed, elapsed);
                Wheel.playDueTicks(spinB, spinTickElapsed, elapsed);
                spinTickElapsed = elapsed;
            }
            if (!Wheel || Wheel.isPairDone(spinA, spinB, elapsed)) {
                finishPowerupSpin();
            }
        } else if (phase === PHASE.ARENA) {
            pollArenaResult();
        } else if (phase === PHASE.COMPOSE && composeReady && elapsed >= DUR.compose) {
            beginBracketAdvance();
        } else if (phase === PHASE.BRACKET_ADVANCE && elapsed >= DUR.advance) {
            beginBracketHold();
        } else if (phase === PHASE.BRACKET_HOLD && elapsed >= DUR.bracketHold) {
            afterBracketHold();
        }
        // COMPOSE waits on composeWait — no timer advance.

        try {
            draw(now);
        } catch (err) {
            console.warn('bracket preview draw failed', err);
        }
        if (running) raf = requestAnimationFrame(tick);
    }

    function draw(now) {
        const w = canvas.clientWidth || 640;
        const h = canvas.clientHeight || 360;
        ctx.clearRect(0, 0, w, h);

        if (phase === PHASE.POWERUP_SPIN && window.PowerupWheel) {
            const elapsed = (now - phaseStarted) * playbackRate;
            window.PowerupWheel.drawScene(ctx, {
                width: w,
                height: h,
                spinA,
                spinB,
                elapsedMs: elapsed,
            });
            return;
        }

        drawBracket(w, h, now);
    }

    /**
     * Paint one offline bracket frame onto an arbitrary canvas (1280×720 capture).
     * Does not disturb the live preview loop state.
     */
    function paintSnapshot(targetCanvas, opts = {}) {
        if (!targetCanvas || !window.WorkflowBracket) {
            throw new Error('WorkflowBracketPreview.paintSnapshot: canvas + WorkflowBracket required');
        }
        const width = Math.max(320, Number(opts.width) || 1280);
        const height = Math.max(180, Number(opts.height) || 720);
        const snapCtx = targetCanvas.getContext('2d');
        if (!snapCtx) throw new Error('WorkflowBracketPreview.paintSnapshot: 2d context unavailable');
        targetCanvas.width = width;
        targetCanvas.height = height;
        snapCtx.setTransform(1, 0, 0, 1, 0, 0);
        snapCtx.clearRect(0, 0, width, height);

        if (opts.spinA && window.PowerupWheel) {
            window.PowerupWheel.drawScene(snapCtx, {
                width,
                height,
                spinA: opts.spinA,
                spinB: opts.spinB || null,
                elapsedMs: Number(opts.elapsedMs) || 0,
                title: opts.title || 'POWERUP SPIN',
            });
            return;
        }

        const snap = opts.state;
        if (!snap?.rounds?.length) {
            throw new Error('WorkflowBracketPreview.paintSnapshot: bracket state required');
        }
        const prev = {
            canvas,
            ctx,
            state,
            phase,
            activeMatch,
            lastWinner,
            lastLoser,
            advanceFrom,
            phaseStarted,
            playbackRate,
        };
        try {
            canvas = targetCanvas;
            ctx = snapCtx;
            state = window.WorkflowBracket.clone(snap);
            phase = opts.phase || PHASE.BRACKET_INTRO;
            activeMatch = opts.activeMatch || null;
            lastWinner = opts.lastWinner || null;
            lastLoser = opts.lastLoser || null;
            advanceFrom = opts.advanceFrom || null;
            phaseStarted = 0;
            playbackRate = 1;
            drawBracket(width, height, Number(opts.elapsedMs) || 0);
        } finally {
            canvas = prev.canvas;
            ctx = prev.ctx;
            state = prev.state;
            phase = prev.phase;
            activeMatch = prev.activeMatch;
            lastWinner = prev.lastWinner;
            lastLoser = prev.lastLoser;
            advanceFrom = prev.advanceFrom;
            phaseStarted = prev.phaseStarted;
            playbackRate = prev.playbackRate;
        }
    }

    function layoutBracket(w, h) {
        const rounds = state.rounds;
        const r0 = rounds[0]?.length || 0;
        // >8 entrants (R1 has >4 matches): split left/right into the final.
        const doubleSided = r0 > 4 && rounds.length >= 2;
        if (!doubleSided) {
            const padX = 36;
            const padY = 148;
            const colW = (w - padX * 2) / Math.max(1, rounds.length);
            const cardW = Math.max(176, Math.min(292, colW * 0.88));
            const cardH = 118;
            const positions = new Map();
            rounds.forEach((round, ri) => {
                const n = round.length;
                const gap = (h - padY - 28) / n;
                round.forEach((match, mi) => {
                    const x = padX + colW * ri + colW * 0.5;
                    const y = padY + gap * (mi + 0.5);
                    positions.set(match.id, { x, y, match, ri, mi, side: 'center' });
                });
            });
            return { positions, colW, cardW, cardH, doubleSided: false };
        }

        const padX = 18;
        const padTop = 118;
        const padBot = 18;
        const sideRounds = rounds.length - 1;
        const cols = sideRounds * 2 + 1;
        const colW = (w - padX * 2) / cols;
        const maxSide = Math.ceil(r0 / 2);
        const rowGap = (h - padTop - padBot) / maxSide;
        const cardH = Math.max(28, Math.min(96, rowGap * 0.88));
        const cardW = Math.max(72, Math.min(168, colW * 0.9));
        const positions = new Map();
        const finalRi = rounds.length - 1;

        rounds.forEach((round, ri) => {
            if (ri === finalRi) {
                const match = round[0];
                if (!match) return;
                positions.set(match.id, {
                    x: padX + colW * (sideRounds + 0.5),
                    y: padTop + (h - padTop - padBot) * 0.5,
                    match,
                    ri,
                    mi: 0,
                    side: 'final',
                });
                return;
            }
            const half = Math.ceil(round.length / 2);
            round.forEach((match, mi) => {
                const onLeft = mi < half;
                const local = onLeft ? mi : mi - half;
                const localCount = onLeft ? half : round.length - half;
                const gap = (h - padTop - padBot) / Math.max(1, localCount);
                const x = onLeft
                    ? padX + colW * (ri + 0.5)
                    : padX + colW * (sideRounds * 2 - ri + 0.5);
                positions.set(match.id, {
                    x,
                    y: padTop + gap * (local + 0.5),
                    match,
                    ri,
                    mi,
                    side: onLeft ? 'left' : 'right',
                });
            });
        });
        return { positions, colW, cardW, cardH, doubleSided: true };
    }

    function drawBracketConnector(from, to, cardW) {
        const decided = from.match?.decided;
        ctx.strokeStyle = decided ? 'rgba(22,101,52,0.62)' : 'rgba(17,17,17,0.18)';
        ctx.lineWidth = decided ? 2.5 : 1.5;
        ctx.beginPath();
        if (from.side === 'right' || (from.side !== 'left' && from.x > to.x)) {
            // Flow toward center from the right half.
            ctx.moveTo(from.x - cardW / 2, from.y);
            ctx.lineTo((from.x + to.x) / 2, from.y);
            ctx.lineTo((from.x + to.x) / 2, to.y);
            ctx.lineTo(to.x + cardW / 2, to.y);
        } else {
            ctx.moveTo(from.x + cardW / 2, from.y);
            ctx.lineTo((from.x + to.x) / 2, from.y);
            ctx.lineTo((from.x + to.x) / 2, to.y);
            ctx.lineTo(to.x - cardW / 2, to.y);
        }
        ctx.stroke();
    }

    function drawBracket(w, h, now) {
        ctx.fillStyle = '#ece8e1';
        ctx.fillRect(0, 0, w, h);

        // Match the Arena page's warm paper surface and restrained grid.
        ctx.strokeStyle = 'rgba(17,17,17,0.045)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 24) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y < h; y += 24) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        ctx.fillStyle = '#111111';
        ctx.font = '700 22px "Russo One", "Bebas Neue", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BALL ARENA', 28, 38);
        ctx.fillStyle = 'rgba(0,0,0,0.46)';
        ctx.font = '600 14px "DM Sans", "IBM Plex Sans", sans-serif';
        ctx.fillText('LONG-FORM TOURNAMENT', 29, 58);

        ctx.fillStyle = '#111111';
        ctx.font = '700 34px "Russo One", "Bebas Neue", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TOURNAMENT BRACKET', w / 2, 42);

        if (phase === PHASE.CHAMPION && state.champion) {
            drawStatusPill(w / 2, 78, `${state.champion.name} · CHAMPION`, '#166534', '#dcfce7');
        } else if (phase === PHASE.BRACKET_HOLD && lastWinner) {
            drawStatusPill(w / 2, 78, `${lastWinner.name} · ADVANCED`, '#166534', '#dcfce7');
        } else if (phase === PHASE.COMPOSE && lastWinner) {
            drawStatusPill(
                w / 2,
                78,
                `VOICE OVER · ${lastWinner.name} WINS`,
                '#7c2d12',
                '#ffedd5'
            );
        } else if (activeMatch) {
            drawStatusPill(
                w / 2,
                78,
                `UP NEXT · ${activeMatch.a.name} vs ${activeMatch.b.name}`,
                '#1d4ed8',
                '#dbeafe'
            );
        }

        const { positions, cardW, cardH, doubleSided } = layoutBracket(w, h);
        const WB = window.WorkflowBracket;

        // Connectors
        for (let ri = 0; ri < state.rounds.length - 1; ri++) {
            for (const match of state.rounds[ri]) {
                const from = positions.get(match.id);
                const nextId = state.rounds[ri + 1][Math.floor(match.index / 2)]?.id;
                const to = positions.get(nextId);
                if (!from || !to) continue;
                drawBracketConnector(from, to, cardW);
            }
        }

        // Round labels (both sides when double-sided)
        const labeled = new Set();
        const labelY = doubleSided ? 96 : 128;
        const labelSize = cardH < 50 ? 12 : doubleSided ? 14 : 20;
        for (const pos of positions.values()) {
            const key = `${pos.ri}:${pos.side}`;
            if (labeled.has(key)) continue;
            labeled.add(key);
            ctx.fillStyle = 'rgba(0,0,0,0.48)';
            ctx.font = `700 ${labelSize}px "DM Sans", "IBM Plex Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(WB.roundLabel(pos.ri, state.rounds.length).toUpperCase(), pos.x, labelY);
        }

        const destination = advanceDestination(positions);
        const hiddenDestinationKey = phase === PHASE.BRACKET_ADVANCE && destination
            ? WB.fighterKey(lastWinner)
            : '';
        for (const { x, y, match } of positions.values()) {
            const isCurrent = activeMatch
                && match.id === activeMatch.id
                && phase !== PHASE.CHAMPION
                && phase !== PHASE.BRACKET_HOLD;
            const isDestination = destination?.match?.id === match.id;
            drawMatchNode(x, y, match, {
                isCurrent,
                cardW,
                cardH,
                hiddenFighterKey: isDestination ? hiddenDestinationKey : '',
            });
        }

        // Result motion uses participant cards only: winner advances along the
        // bracket path while the loser is struck and kicked out.
        if (phase === PHASE.BRACKET_ADVANCE && lastWinner && advanceFrom) {
            const from = positions.get(advanceFrom.id);
            if (from) drawResultAnimation(from, destination, cardH, now);
        }
    }

    function drawStatusPill(x, y, text, color, bg) {
        ctx.font = '700 20px "DM Sans", "IBM Plex Sans", sans-serif';
        const width = Math.min(640, ctx.measureText(text).width + 40);
        ctx.fillStyle = bg;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        roundRect(x - width / 2, y - 22, width, 44, 22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
        ctx.textBaseline = 'alphabetic';
    }

    function advanceDestination(positions) {
        if (!advanceFrom || !lastWinner) return null;
        const next = state.rounds[advanceFrom.round + 1]?.[Math.floor(advanceFrom.index / 2)];
        if (!next) return null;
        const pos = positions.get(next.id);
        if (!pos) return null;
        const slot = advanceFrom.index % 2 === 0 ? 'a' : 'b';
        return { ...pos, slot };
    }

    function fighterSlotY(match, fighter, centerY, cardH) {
        const key = window.WorkflowBracket.fighterKey(fighter);
        return key && key === window.WorkflowBracket.fighterKey(match.a)
            ? centerY - cardH * 0.24
            : centerY + cardH * 0.24;
    }

    function drawResultAnimation(from, destination, cardH, now) {
        const rawT = Math.min(1, Math.max(0, ((now - phaseStarted) * playbackRate) / DUR.advance));
        const moveT = Math.min(1, rawT / 0.72);
        const ease = 1 - Math.pow(1 - moveT, 3);
        const winnerStartY = fighterSlotY(advanceFrom, lastWinner, from.y, cardH);
        const winnerEndX = destination?.x || (canvas.clientWidth || 640) / 2;
        const winnerEndY = destination
            ? destination.y + (destination.slot === 'a' ? -cardH * 0.24 : cardH * 0.24)
            : 67;
        drawParticipantChip(
            from.x + (winnerEndX - from.x) * ease,
            winnerStartY + (winnerEndY - winnerStartY) * ease,
            lastWinner,
            { border: '#78716c', label: moveT < 1 ? 'ADVANCING' : 'ADVANCED' }
        );

        if (!lastLoser) return;
        const loserT = Math.min(1, Math.max(0, (rawT - 0.08) / 0.62));
        const loserY = fighterSlotY(advanceFrom, lastLoser, from.y, cardH);
        ctx.save();
        ctx.globalAlpha = 1 - loserT;
        ctx.translate(from.x - loserT * 105, loserY + loserT * 44);
        ctx.rotate(-loserT * 0.2);
        drawParticipantChip(0, 0, lastLoser, { border: '#dc2626', label: 'ELIMINATED', eliminated: true });
        ctx.restore();
    }

    function fighterWeaponIconUrl(fighter) {
        if (!fighter) return null;
        if (typeof fighter.weaponIcon === 'string' && fighter.weaponIcon) return fighter.weaponIcon;
        const id = fighter.weaponId || fighter.arenaMatchup?.config?.weaponId || '';
        return window.PremadeWeapons?.iconUrl?.(id) || WEAPON_ICON_URLS[id] || null;
    }

    function getWeaponIconImg(src) {
        if (!src || typeof Image === 'undefined') return null;
        let img = weaponIconImgs[src];
        if (!img) {
            img = new Image();
            img.decoding = 'async';
            img.src = src;
            weaponIconImgs[src] = img;
        }
        return img.complete && img.naturalWidth > 0 ? img : null;
    }

    function collectWeaponIconUrls(state, extras = []) {
        const urls = new Set();
        const add = (fighter) => {
            const url = fighterWeaponIconUrl(fighter);
            if (url) urls.add(url);
        };
        for (const fighter of state?.fighters || []) add(fighter);
        for (const round of state?.rounds || []) {
            for (const match of round || []) {
                add(match?.a);
                add(match?.b);
                add(match?.winner);
            }
        }
        for (const fighter of extras) add(fighter);
        return [...urls];
    }

    function preloadWeaponIcons(state, extras = []) {
        const urls = collectWeaponIconUrls(state, extras);
        if (typeof Image === 'undefined' || !urls.length) return Promise.resolve();
        return Promise.all(urls.map((url) => new Promise((resolve) => {
            const existing = weaponIconImgs[url];
            if (existing?.complete) {
                resolve();
                return;
            }
            const img = existing || new Image();
            const done = () => resolve();
            img.onload = done;
            img.onerror = done;
            if (!existing) {
                img.decoding = 'async';
                img.src = url;
                weaponIconImgs[url] = img;
            }
        })));
    }

    function weaponIconDrawSize(fighter, size) {
        const id = fighter?.weaponId || fighter?.arenaMatchup?.config?.weaponId;
        if (id === 'dagger') return Math.max(10, Math.round(size * 0.68));
        return size;
    }

    function drawWeaponIcon(ctx, fighter, x, y, size) {
        const img = getWeaponIconImg(fighterWeaponIconUrl(fighter));
        const drawSize = weaponIconDrawSize(fighter, size);
        if (!img || !(drawSize > 0)) return 0;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y - drawSize / 2, drawSize, drawSize);
        ctx.restore();
        return drawSize;
    }

    function drawParticipantChip(x, y, fighter, { border, label, eliminated = false }) {
        const width = 210;
        const height = 56;
        ctx.fillStyle = '#faf7f1';
        ctx.strokeStyle = border;
        ctx.lineWidth = 2.5;
        roundRect(x - width / 2, y - height / 2, width, height, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = fighter.color;
        ctx.fillRect(x - width / 2, y - height / 2, 7, height);
        ctx.fillStyle = eliminated ? '#991b1b' : '#111111';
        ctx.font = '700 20px "DM Sans", "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const chipIcon = drawWeaponIcon(ctx, fighter, x - width / 2 + 16, y - 6, 22);
        ctx.fillText(trimName(fighter.name, 14), x - width / 2 + 18 + (chipIcon ? chipIcon + 5 : 0), y - 6);
        ctx.fillStyle = border;
        ctx.font = '700 14px "DM Sans", "IBM Plex Sans", sans-serif';
        ctx.fillText(label, x - width / 2 + 18, y + 16);
        if (eliminated) {
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x - width / 2 + 12, y);
            ctx.lineTo(x + width / 2 - 12, y);
            ctx.stroke();
        }
        ctx.textBaseline = 'alphabetic';
    }

    function drawMatchNode(x, y, match, {
        isCurrent,
        cardW,
        cardH,
        hiddenFighterKey,
    }) {
        const compact = cardH < 70;
        const radius = compact ? 6 : 12;
        ctx.save();
        ctx.shadowColor = isCurrent ? 'rgba(37,99,235,0.2)' : 'rgba(17,17,17,0.08)';
        ctx.shadowBlur = isCurrent ? (compact ? 8 : 14) : (compact ? 3 : 7);
        ctx.shadowOffsetY = compact ? 1 : 2;
        ctx.fillStyle = '#faf7f1';
        ctx.strokeStyle = isCurrent ? '#2563eb' : 'rgba(0,0,0,0.16)';
        ctx.lineWidth = isCurrent ? (compact ? 2 : 3) : 1.5;
        roundRect(x - cardW / 2, y - cardH / 2, cardW, cardH, radius);
        ctx.fill();
        ctx.stroke();
        ctx.shadowColor = 'transparent';

        if (isCurrent && !compact) {
            ctx.fillStyle = '#2563eb';
            roundRect(x - 52, y - cardH / 2 - 16, 104, 30, 15);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 15px "DM Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('UP NEXT', x, y - cardH / 2 - 1);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - cardW / 2 + (compact ? 4 : 10), y);
        ctx.lineTo(x + cardW / 2 - (compact ? 4 : 10), y);
        ctx.stroke();

        const slotOffset = cardH * (compact ? 0.22 : 0.24);
        drawSlot(x, y - slotOffset, match.a, match, hiddenFighterKey, cardW, cardH);
        drawSlot(x, y + slotOffset, match.b, match, hiddenFighterKey, cardW, cardH);
        ctx.restore();
    }

    function drawSlot(x, y, fighter, match, hiddenFighterKey, cardW = 200, cardH = 118) {
        const compact = cardH < 70;
        const textMax = Math.max(6, Math.floor(cardW / (compact ? 9 : 12)));
        const swatchX = x - cardW / 2 + (compact ? 10 : 22);
        const nameX = swatchX + (compact ? 10 : 20);
        const fontSize = compact ? Math.max(9, Math.min(14, cardH * 0.32)) : 22;
        const swatchR = compact ? Math.max(3, cardH * 0.12) : 10;
        if (!fighter) {
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.font = `600 ${fontSize}px "DM Sans", "IBM Plex Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('TBD', x, y);
            return;
        }
        const WB = window.WorkflowBracket;
        const key = WB.fighterKey(fighter);
        if (hiddenFighterKey && key === hiddenFighterKey) return;
        const won = match.winner && key === WB.fighterKey(match.winner);
        const lost = match.decided && match.winner && !won;
        ctx.beginPath();
        ctx.fillStyle = fighter.color;
        ctx.arc(swatchX, y, swatchR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lost ? 'rgba(0,0,0,0.34)' : '#111111';
        ctx.font = `700 ${fontSize}px "DM Sans", "IBM Plex Sans", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const iconSize = compact ? 0 : drawWeaponIcon(ctx, fighter, nameX, y, 24);
        ctx.fillText(trimName(fighter.name, textMax), nameX + (iconSize ? iconSize + 6 : 0), y);
        if (lost) {
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = compact ? 1.2 : 2;
            ctx.beginPath();
            ctx.moveTo(nameX - 2, y);
            ctx.lineTo(x + cardW / 2 - (compact ? 6 : 14), y);
            ctx.stroke();
        }
        ctx.textBaseline = 'alphabetic';
    }

    function trimName(name, max) {
        const value = String(name || '?');
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    window.WorkflowBracketPreview = {
        mount,
        start,
        stop,
        resume,
        isRunning,
        hasState,
        isMatchCycleActive,
        resize,
        cyclePlaybackRate,
        setPlaybackRate,
        stepOneMatch,
        applyMatchResult,
        captureBounds,
        paintSnapshot,
        PHASE,
        DUR,
        getDebugState,
        getBracketState() {
            return state ? window.WorkflowBracket.clone(state) : null;
        },
        getPhase() {
            return state ? phase : null;
        },
        setPowerupSpinEnabled,
        preloadWeaponIcons,
        isPowerupSpinEnabled() {
            return powerupSpinEnabled;
        },
    };
})();
