/**
 * ArenaApp — start/stop sim, animation frame, reset, pause.
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});

    P.togglePause = function togglePause() {
        if (!P.sim || !P.sim.balls.length || P.sim.finished) return;
        if (P.running) {
            P.pause();
        } else {
            P.run();
        }
        P.updateStageControls();
    }

    P.clearArena = function clearArena() {
        P.pause();
        if (!P.sim) return;
        P.sim.clear();
        if (P.sim.damagePopups) P.sim.damagePopups = [];
        if (P.sim.arrows) P.sim.arrows = [];
        if (P.sim.projectileShreds) P.sim.projectileShreds = [];
        if ('strikeSlowRemaining' in P.sim) P.sim.strikeSlowRemaining = 0;
        if (P.sim._weaponHitReadyAt) P.sim._weaponHitReadyAt.clear();
        if (P.sim._weaponClashReadyAt) P.sim._weaponClashReadyAt.clear();
        P.draw();
        P.updateContestantUI();
        P.updateStageControls();
    }

    /**
     * @param {{ silent?: boolean }} [opts]
     *   silent — no audio, UI, draw, or rAF (for FightSim / batch win checks)
     */
    P.reset = function reset(opts = {}) {
        const silent = opts.silent === true;
        P.pause();
        if (!silent) P.resizeCanvas();
        const wallInset = silent ? P.SILENT_WALL_INSET : P.computeWallInset();

        if (P.gameMode === 'weapon') {
            P.sim = new WeaponArenaSim({
                width: P.ARENA_SIZE,
                height: P.ARENA_SIZE,
                wallInset,
                onBallCollision(a, b, impactSpeed) {
                    if (silent || !window.ArenaAudio) return;
                    ArenaAudio.playCollision(impactSpeed);
                },
                onWeaponHit(attacker, defender, damage) {
                    if (silent || !window.ArenaAudio) return;
                    const speed = 80 + damage * 4;
                    if (attacker.weaponBehavior?.hitSfx === 'punch') ArenaAudio.playPunch(speed);
                    else ArenaAudio.playWeaponHit(speed);
                },
                onShieldReflect(shield, striker, damage) {
                    if (silent || !window.ArenaAudio) return;
                    const speed = 140 + (damage || 0) * 5 + Math.abs(shield.spinSpeed || 0) * 20;
                    ArenaAudio.playShieldDeflect(speed);
                },
                onWebCut(cutter) {
                    if (silent || !window.ArenaAudio) return;
                    const speed = 100 + Math.abs(cutter.spinSpeed || 0) * 22;
                    ArenaAudio.playWebCut(speed);
                },
                onWeaponClash(a, b) {
                    if (silent || !window.ArenaAudio) return;
                    const spin = Math.abs(a.spinSpeed || 0) + Math.abs(b.spinSpeed || 0);
                    const speed = 120 + spin * 18;
                    if (a.weaponBehavior?.clashSfx === 'glove' && b.weaponBehavior?.clashSfx === 'glove') {
                        ArenaAudio.playGloveClash(speed);
                    } else {
                        ArenaAudio.playWeaponClash(speed);
                    }
                },
                onProjectileDeflect(melee, projectile) {
                    if (silent || !window.ArenaAudio) return;
                    const speed = Math.hypot(projectile.vx || 0, projectile.vy || 0);
                    ArenaAudio.playProjectileDeflect(90 + speed * 0.2 + Math.abs(melee.spinSpeed || 0) * 20);
                },
                onExplosion(_x, _y, radius) {
                    if (silent || !window.ArenaAudio) return;
                    ArenaAudio.playExplosion(320 + (radius || 80) * 1.2);
                },
            });
        } else {
            P.sim = new ArenaSim({
                width: P.ARENA_SIZE,
                height: P.ARENA_SIZE,
                wallInset,
                onBallCollision(a, b, impactSpeed) {
                    if (silent || !window.ArenaAudio) return;
                    ArenaAudio.playCollision(impactSpeed);
                },
            });
        }

        let balls = P.makeRoster();
        if (balls.length < 2 && P.gameMode === 'weapon') {
            P.repairWeaponMatchup();
            balls = P.makeRoster();
        }
        if (balls.length < 2) {
            throw new Error('ArenaApp.reset: need at least 2 fighters in the roster');
        }
        for (const ball of balls) {
            P.sim.addBall(ball);
        }
        if (silent) return;
        P.buildContestantUI(balls);
        P.updatePageTitle();
        P.draw();
        P.run();
        P.updateStageControls();
        P.fitContestantTitles();
        requestAnimationFrame(P.fitContestantTitles);
        setTimeout(P.fitContestantTitles, 0);
        if (document.fonts?.ready) {
            document.fonts.ready.then(P.fitContestantTitles);
        }
    }

    P.draw = function draw() {
        if (P.sim) ArenaRender.draw(P.canvas, P.sim);
    }

    /** Advance sim time only — no draw / UI. @returns {boolean} still fighting */
    P.stepSimSilent = function stepSimSilent(realDt = 1 / 30) {
        if (!P.sim) return false;
        const dt = Number(realDt);
        if (!P.sim.finished && Number.isFinite(dt) && dt > 0) {
            const timeScale = P.sim.getSimDtScale?.(dt) ?? 1;
            const simDt = dt * timeScale;
            const substeps = 3;
            const subDt = simDt / substeps;
            for (let i = 0; i < substeps; i++) {
                P.sim.step(subDt);
            }
        }
        return !P.sim.finished;
    }

    P.summarizeFight = function summarizeFight(durationSec) {
        const winnerBall = P.sim?.winner || null;
        const winnerName = P.resolveWinnerLabel(P.sim);
        const slotIndex = winnerBall?._slotIndex;
        const slot = Number.isInteger(slotIndex) ? P.matchupSlots[slotIndex] : null;
        const fighters = (P.sim?.balls || []).map((ball, i) => {
            const idx = Number.isInteger(ball._slotIndex) ? ball._slotIndex : i;
            const s = P.matchupSlots[idx];
            return {
                slotIndex: idx,
                id: s?.id ?? null,
                name: ball.name || null,
                color: ball.color || null,
                weaponId: ball.weaponId || s?.config?.weaponId || null,
                powerupId: ball.powerupId || s?.config?.powerupId || null,
                powerupName: ball.powerupName || null,
                health: ball.health,
                alive: typeof ball.isAlive === 'function' ? ball.isAlive() : ball.health > 0,
            };
        });
        return {
            mode: P.gameMode,
            finished: Boolean(P.sim?.finished),
            timedOut: Boolean(P.sim && !P.sim.finished),
            draw: Boolean(P.sim?.finished && !winnerName),
            durationSec: Math.round(durationSec * 1000) / 1000,
            winner: winnerName
                ? {
                    name: winnerName,
                    isTeam: Boolean(P.sim?.winnerIsTeam),
                    slotIndex: Number.isInteger(slotIndex) ? slotIndex : null,
                    id: slot?.id ?? null,
                    weaponId: winnerBall.weaponId || slot?.config?.weaponId || null,
                    color: winnerBall?.color || null,
                }
                : null,
            fighters,
        };
    }

    /**
     * Run one fight with no visuals/audio. Optionally set mode/matchup first.
     * @param {{ mode?: string, matchup?: object[], maxSeconds?: number, dt?: number }} [opts]
     */
    P.simulateFight = function simulateFight(opts = {}) {
        const maxSeconds = Number(opts.maxSeconds) > 0 ? Number(opts.maxSeconds) : 90;
        const dt = Number(opts.dt) > 0 ? Number(opts.dt) : 1 / 30;

        if (opts.mode && P.GAME_MODES[opts.mode] && opts.mode !== P.gameMode) {
            P.gameMode = opts.mode;
            P.saveMode(P.gameMode);
        }
        if (Array.isArray(opts.matchup)) {
            P.matchupSlots = P.gameMode === 'weapon'
                ? P.normalizeWeaponMatchupInput(opts.matchup)
                : P.normalizeCollisionMatchupInput(opts.matchup);
            if (P.gameMode === 'weapon') P.repairWeaponMatchup();
        }

        P.pause();
        P.reset({ silent: true });

        const maxSteps = Math.ceil(maxSeconds / dt);
        let steps = 0;
        while (P.sim && !P.sim.finished && steps < maxSteps) {
            P.stepSimSilent(dt);
            steps += 1;
        }
        return P.summarizeFight(steps * dt);
    }

    /**
     * Advance one video frame worth of sim time and redraw.
     * Used by offline recording (no requestAnimationFrame / wall clock).
     * @param {number} [realDt=1/30]
     * @returns {boolean} true if the fight is still in progress
     */
    P.stepSimFrame = function stepSimFrame(realDt = 1 / 30) {
        if (!P.sim) return false;
        const dt = Number(realDt);
        if (!P.sim.finished && Number.isFinite(dt) && dt > 0) {
            const timeScale = P.sim.getSimDtScale?.(dt) ?? 1;
            const simDt = dt * timeScale;
            const substeps = 3;
            const subDt = simDt / substeps;
            for (let i = 0; i < substeps; i++) {
                P.sim.step(subDt);
            }
            if (P.sim.finished) P.pause();
            P.updateContestantUI();
            P.updateStageControls();
        }
        P.draw();
        return !P.sim.finished;
    }

    P.frame = function frame(ts) {
        if (!P.running || !P.sim) return;
        const now = Number.isFinite(ts) ? ts : performance.now();
        if (!P.lastTs) P.lastTs = now;
        let dt = (now - P.lastTs) / 1000;
        P.lastTs = now;
        dt = Math.min(dt, 1 / 30);

        const timeScale = (P.sim.getSimDtScale?.(dt) ?? 1) * P.playbackSpeed() * P.previewPlaybackRate;
        const simDt = dt * timeScale;

        const substeps = 3;
        const subDt = simDt / substeps;
        for (let i = 0; i < substeps; i++) {
            P.sim.step(subDt);
        }

        if (P.sim.finished) {
            P.pause();
        }

        P.updateContestantUI();
        P.draw();
        P.updateStageControls();
        if (P.running) P.rafId = requestAnimationFrame(P.frame);
    }

    P.run = function run() {
        if (P.running) return;
        P.running = true;
        P.lastTs = 0;
        P.updateStageControls();
        P.rafId = requestAnimationFrame(P.frame);
    }

    P.pause = function pause() {
        P.running = false;
        if (P.rafId) cancelAnimationFrame(P.rafId);
        P.rafId = 0;
        P.lastTs = 0;
        P.updateStageControls();
    }

    P.resizeCanvas = function resizeCanvas() {
        const letterbox = document.getElementById('stage-letterbox');
        if (!letterbox || !P.canvas) return;
        let rect = letterbox.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        let cssSide = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
        // If CSS left a non-square box, lock it to a square so the P.canvas isn't stretched.
        if (Math.abs(rect.width - rect.height) > 1) {
            letterbox.style.width = `${cssSide}px`;
            letterbox.style.height = `${cssSide}px`;
            rect = letterbox.getBoundingClientRect();
            cssSide = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
        }
        const px = Math.max(1, Math.floor(cssSide * dpr));
        if (P.canvas.width !== px || P.canvas.height !== px) {
            P.canvas.width = px;
            P.canvas.height = px;
        }
        P.resizeWinOddsChart();
        P.drawWinOddsChart();
        const sidePx = `${cssSide}px`;
        if (P.canvas.style.width !== sidePx) P.canvas.style.width = sidePx;
        if (P.canvas.style.height !== sidePx) P.canvas.style.height = sidePx;
        if (P.sim) P.sim.wallInset = P.computeWallInset();
        P.draw();
    }
}());
