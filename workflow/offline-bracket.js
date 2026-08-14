/**
 * Headless tournament bracket frames for compose segments.
 * Depends: WorkflowBracket, WorkflowBracketPreview.paintSnapshot
 */
(function () {
    'use strict';

    const WIDTH = 1280;
    const HEIGHT = 720;
    const FPS = 30;
    const PAGE_BG = '#ece8e1';

    let canvas = null;
    let prepared = false;
    let lastPayload = null;
    let powerupSpins = null;
    let wheelTitle = 'POWERUP SPIN';

    function waitForFonts() {
        if (!document.fonts?.ready) return Promise.resolve();
        return document.fonts.ready.catch(() => {});
    }

    function ensureCanvas() {
        if (!canvas) canvas = document.getElementById('bracket-canvas');
        if (!canvas) throw new Error('OfflineBracket: missing #bracket-canvas');
        return canvas;
    }

    function previewDur() {
        return window.WorkflowBracketPreview?.DUR || {
            advance: 850,
            bracketHold: 1100,
            champion: 2600,
            bracketIntro: 1600,
        };
    }

    function timelineFor(payload) {
        const dur = previewDur();
        const phase = payload?.phase || 'pre';
        const givenHold = Number(payload?.holdMs);
        const holdMs = givenHold > 0 ? givenHold : 0;
        if (phase === 'champion') {
            const hold = holdMs || dur.champion;
            return { motionMs: 0, holdMs: hold, durationMs: hold, animated: false };
        }
        if (phase === 'post') {
            const givenMotion = Number(payload?.motionMs);
            const motionMs = givenMotion > 0 ? givenMotion : dur.advance;
            const hold = holdMs || Math.max(dur.bracketHold, 2200);
            return {
                motionMs,
                holdMs: hold,
                durationMs: motionMs + hold,
                animated: motionMs > 0,
            };
        }
        const hold = holdMs || Math.max(dur.bracketIntro, 2500);
        return { motionMs: 0, holdMs: hold, durationMs: hold, animated: false };
    }

    function paintPhaseForElapsed(payload, elapsedMs) {
        const PHASE = window.WorkflowBracketPreview?.PHASE || {};
        const times = timelineFor(payload);
        const elapsed = Math.max(0, Number(elapsedMs) || 0);
        if (payload?.phase === 'champion') {
            return { phase: PHASE.CHAMPION || 'champion', elapsedMs: elapsed };
        }
        if (payload?.phase === 'post') {
            if (elapsed < times.motionMs) {
                return { phase: PHASE.BRACKET_ADVANCE || 'bracket-advance', elapsedMs: elapsed };
            }
            return {
                phase: PHASE.BRACKET_HOLD || 'bracket-hold',
                elapsedMs: elapsed - times.motionMs,
            };
        }
        return { phase: PHASE.BRACKET_INTRO || 'bracket-intro', elapsedMs: elapsed };
    }

    function paint(payload, elapsedMs) {
        ensureCanvas();
        if (!window.WorkflowBracketPreview?.paintSnapshot) {
            throw new Error('OfflineBracket: paintSnapshot unavailable');
        }
        const state = payload?.state;
        if (!state) throw new Error('OfflineBracket: bracket state required');
        const painted = paintPhaseForElapsed(payload, elapsedMs);
        const intro = painted.phase === (window.WorkflowBracketPreview.PHASE?.BRACKET_INTRO || 'bracket-intro');
        const activeMatch = payload?.activeMatch
            || (intro ? window.WorkflowBracket.currentMatch(state) : null);
        window.WorkflowBracketPreview.paintSnapshot(canvas, {
            state,
            phase: painted.phase,
            elapsedMs: painted.elapsedMs,
            width: WIDTH,
            height: HEIGHT,
            activeMatch,
            lastWinner: payload?.lastWinner || null,
            lastLoser: payload?.lastLoser || null,
            advanceFrom: payload?.advanceFrom || activeMatch || null,
        });
    }

    function paintPaper(ctx) {
        ctx.fillStyle = PAGE_BG;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.strokeStyle = 'rgba(17,17,17,0.045)';
        ctx.lineWidth = 1;
        for (let x = 0; x < WIDTH; x += 24) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, HEIGHT);
            ctx.stroke();
        }
        for (let y = 0; y < HEIGHT; y += 24) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(WIDTH, y);
            ctx.stroke();
        }
    }

    function paintTitleCard(title) {
        ensureCanvas();
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('OfflineBracket: 2d context unavailable');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        paintPaper(ctx);
        const heading = String(title?.heading || 'MATCH').trim() || 'MATCH';
        const detail = String(title?.detail || '').trim();
        ctx.fillStyle = '#111111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 84px "Russo One", "Bebas Neue", sans-serif';
        ctx.fillText(heading, WIDTH / 2, detail ? HEIGHT / 2 - 28 : HEIGHT / 2);
        if (detail) {
            ctx.fillStyle = 'rgba(0,0,0,0.48)';
            ctx.font = '700 28px "DM Sans", "IBM Plex Sans", sans-serif';
            ctx.fillText(detail, WIDTH / 2, HEIGHT / 2 + 42);
        }
        ctx.textBaseline = 'alphabetic';
    }

    async function prepare(payload) {
        await waitForFonts();
        await window.WorkflowBracketPreview.preloadWeaponIcons?.(payload?.state, [
            payload?.lastWinner,
            payload?.lastLoser,
            payload?.activeMatch?.a,
            payload?.activeMatch?.b,
            payload?.advanceFrom?.a,
            payload?.advanceFrom?.b,
        ]);
        lastPayload = payload || {};
        prepared = true;
        powerupSpins = null;
        paint(lastPayload, 0);
        const times = timelineFor(lastPayload);
        return {
            fps: FPS,
            width: WIDTH,
            height: HEIGHT,
            phase: lastPayload.phase || 'pre',
            ...times,
        };
    }

    function paintPowerup(elapsedMs) {
        if (!canvas) canvas = document.getElementById('bracket-canvas');
        if (!canvas) throw new Error('OfflineBracket: missing #bracket-canvas');
        if (!powerupSpins?.a) throw new Error('OfflineBracket: powerup spins required');
        window.WorkflowBracketPreview.paintSnapshot(canvas, {
            phase: window.WorkflowBracketPreview.PHASE?.POWERUP_SPIN || 'powerup-spin',
            width: WIDTH,
            height: HEIGHT,
            spinA: powerupSpins.a,
            spinB: powerupSpins.b || null,
            elapsedMs: Number(elapsedMs) || 0,
            title: wheelTitle,
        });
    }

    async function preparePowerup(spins, opts = {}) {
        await waitForFonts();
        if (!spins?.a || !spins?.b) throw new Error('OfflineBracket: powerup spins a/b required');
        if (!window.PowerupWheel) throw new Error('OfflineBracket: PowerupWheel unavailable');
        powerupSpins = spins;
        wheelTitle = (opts && typeof opts.title === 'string' && opts.title.trim())
            ? opts.title.trim()
            : 'POWERUP SPIN';
        prepared = true;
        lastPayload = { phase: 'powerup', spins, title: wheelTitle };
        await window.PowerupWheel.preloadIcons?.([
            ...(spins.a.slices || []),
            ...(spins.b.slices || []),
        ]);
        paintPowerup(0);
        return {
            fps: FPS,
            width: WIDTH,
            height: HEIGHT,
            phase: 'powerup',
            durationMs: window.PowerupWheel.spinDurationMs(spins.a, spins.b),
        };
    }

    async function renderTickAudio() {
        if (!powerupSpins || !window.PowerupWheel || !window.ArenaAudio?.renderCaptureWav) {
            return null;
        }
        const durationMs = window.PowerupWheel.spinDurationMs(powerupSpins.a, powerupSpins.b);
        const events = window.PowerupWheel.collectTickEvents(powerupSpins.a, powerupSpins.b);
        window.ArenaAudio.beginCapture();
        for (const ev of events) {
            window.ArenaAudio.setCaptureTime((Number(ev.tMs) || 0) / 1000);
            window.ArenaAudio.playWheelTick(ev.intensity);
        }
        window.ArenaAudio.endCapture();
        return window.ArenaAudio.renderCaptureWav(Math.max(0.05, durationMs / 1000));
    }

    function canvasPngBase64() {
        const dataUrl = canvas.toDataURL('image/png');
        const comma = dataUrl.indexOf(',');
        return comma >= 0 ? dataUrl.slice(comma + 1) : null;
    }

    function renderPngBase64(elapsedMs) {
        if (!prepared || !canvas || !lastPayload) throw new Error('call OfflineBracket.prepare first');
        paint(lastPayload, elapsedMs);
        return canvasPngBase64();
    }

    function renderTitlePngBase64(title) {
        if (!canvas) throw new Error('call OfflineBracket.prepare first');
        paintTitleCard(title || {});
        return canvasPngBase64();
    }

    function renderPowerupPngBase64(elapsedMs) {
        if (!prepared || !canvas || !powerupSpins) {
            throw new Error('call OfflineBracket.preparePowerup first');
        }
        paintPowerup(elapsedMs);
        const dataUrl = canvas.toDataURL('image/png');
        const comma = dataUrl.indexOf(',');
        return comma >= 0 ? dataUrl.slice(comma + 1) : null;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForSkinImages(fighters, timeoutMs = 8000) {
        const SK = window.BallSkins;
        if (!SK?.init || !SK.getSkinImage) return;
        await SK.init();
        const ids = (fighters || [])
            .map((f) => {
                const id = f?.skinId || (f?.id && f.id !== '_weapon' ? f.id : null);
                return id && SK.getSkin(id) ? id : null;
            })
            .filter(Boolean);
        if (!ids.length) return;
        const start = performance.now();
        while (performance.now() - start < timeoutMs) {
            let ready = true;
            for (const id of ids) {
                if (!SK.getSkinImage(id)) ready = false;
            }
            if (ready) return;
            await sleep(40);
        }
    }

    function loadImage(src) {
        return new Promise((resolve) => {
            if (!src) {
                resolve(null);
                return;
            }
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    function introGrid(count) {
        const n = Math.max(1, count);
        if (n <= 4) return { cols: n, rows: 1 };
        if (n <= 6) return { cols: 3, rows: 2 };
        if (n <= 8) return { cols: 4, rows: 2 };
        if (n <= 9) return { cols: 3, rows: 3 };
        if (n <= 12) return { cols: 4, rows: 3 };
        if (n <= 16) return { cols: 4, rows: 4 };
        if (n <= 24) return { cols: 6, rows: 4 };
        if (n <= 32) return { cols: 8, rows: 4 };
        const cols = Math.ceil(Math.sqrt(n));
        return { cols, rows: Math.ceil(n / cols) };
    }

    function drawIntroBall(ctx, fighter, cx, cy, radius, weaponMode, weaponImg) {
        const skinId = fighter?.skinId || (fighter?.id && fighter.id !== '_weapon' ? fighter.id : null);
        const skinImg = skinId && window.BallSkins ? window.BallSkins.getSkinImage(skinId) : null;
        const color = (typeof fighter?.color === 'string' && fighter.color) || '#888888';

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        if (skinImg) {
            ctx.save();
            ctx.clip();
            ctx.drawImage(skinImg, cx - radius, cy - radius, radius * 2, radius * 2);
            ctx.restore();
        } else {
            ctx.fillStyle = color;
            ctx.fill();
        }
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = Math.max(2, radius * 0.055);
        ctx.stroke();

        const showWeapon = weaponMode || (!skinId && fighter?.weaponId);
        if (!showWeapon || !weaponImg) return;
        const size = radius * (skinId ? 0.85 : 1.15);
        ctx.drawImage(weaponImg, cx + radius * 0.35, cy - size * 0.55, size, size);
    }

    function wrapTitleLines(ctx, title, maxWidth, maxLines) {
        const words = String(title || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return ['Ball Arena Tournament'];
        const lines = [];
        let current = words[0];
        for (let i = 1; i < words.length; i++) {
            const next = `${current} ${words[i]}`;
            if (ctx.measureText(next).width <= maxWidth) {
                current = next;
            } else {
                lines.push(current);
                current = words[i];
                if (lines.length >= maxLines - 1) {
                    const rest = [current, ...words.slice(i + 1)].join(' ');
                    lines.push(rest);
                    return lines;
                }
            }
        }
        lines.push(current);
        return lines;
    }

    async function paintIntroCard(card) {
        ensureCanvas();
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('OfflineBracket: 2d context unavailable');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        paintPaper(ctx);

        const fighters = Array.isArray(card?.fighters) ? card.fighters.filter(Boolean) : [];
        const weaponMode = !!card?.weaponMode;
        const title = String(card?.title || 'Ball Arena Tournament').trim() || 'Ball Arena Tournament';

        await waitForSkinImages(fighters);
        const weaponImgs = await Promise.all(fighters.map(async (fighter) => {
            const src = fighter?.weaponIcon
                || window.PremadeWeapons?.iconUrl?.(fighter?.weaponId)
                || null;
            return loadImage(src);
        }));

        ctx.fillStyle = '#111111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let titleSize = fighters.length > 6 ? 44 : 56;
        ctx.font = `700 ${titleSize}px "Russo One", "Bebas Neue", sans-serif`;
        let lines = wrapTitleLines(ctx, title, WIDTH - 120, 2);
        while (titleSize > 34 && lines.some((line) => ctx.measureText(line).width > WIDTH - 120)) {
            titleSize -= 2;
            ctx.font = `700 ${titleSize}px "Russo One", "Bebas Neue", sans-serif`;
            lines = wrapTitleLines(ctx, title, WIDTH - 120, 2);
        }
        const titleTop = 78;
        const titleGap = titleSize * 1.05;
        lines.forEach((line, i) => {
            ctx.fillText(line, WIDTH / 2, titleTop + i * titleGap);
        });

        if (!fighters.length) {
            ctx.textBaseline = 'alphabetic';
            return;
        }

        const { cols, rows } = introGrid(fighters.length);
        const rosterTop = titleTop + lines.length * titleGap + 36;
        const rosterBottom = HEIGHT - 110;
        const rosterH = Math.max(180, rosterBottom - rosterTop);
        const cellW = WIDTH / cols;
        const cellH = rosterH / rows;
        const radius = Math.min(cellW, cellH) * (
            fighters.length <= 2 ? 0.28
                : fighters.length <= 4 ? 0.26
                    : fighters.length <= 8 ? 0.22
                        : fighters.length <= 16 ? 0.2
                            : 0.18
        );

        fighters.forEach((fighter, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const rowCount = Math.min(cols, fighters.length - row * cols);
            const rowOffset = (cols - rowCount) * cellW * 0.5;
            const cx = rowOffset + col * cellW + cellW / 2;
            const cy = rosterTop + row * cellH + cellH * 0.42;
            drawIntroBall(ctx, fighter, cx, cy, radius, weaponMode, weaponImgs[i]);
            ctx.fillStyle = '#111111';
            ctx.font = `700 ${Math.max(16, Math.min(26, radius * 0.42))}px "DM Sans", "IBM Plex Sans", sans-serif`;
            ctx.fillText(String(fighter?.name || fighter?.id || 'Ball'), cx, cy + radius + 28);
        });
        ctx.textBaseline = 'alphabetic';
    }

    async function prepareIntro(card) {
        await waitForFonts();
        await window.BallSkins?.init?.();
        await paintIntroCard(card || {});
        prepared = true;
        lastPayload = { phase: 'intro', card };
        return { fps: FPS, width: WIDTH, height: HEIGHT, phase: 'intro' };
    }

    async function renderIntroPngBase64(card) {
        await prepareIntro(card || {});
        return canvasPngBase64();
    }

    window.OfflineBracket = {
        WIDTH,
        HEIGHT,
        FPS,
        prepare,
        preparePowerup,
        prepareIntro,
        renderTickAudio,
        renderPngBase64,
        renderTitlePngBase64,
        renderPowerupPngBase64,
        renderIntroPngBase64,
        canvasSelector: '#bracket-canvas',
    };
}());
