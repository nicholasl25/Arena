/**
 * Headless offline fight renderer — steps the arena sim at CPU speed.
 * Uses the same .page layout as index.html; Playwright screenshots it.
 * SFX are logged on a sim timeline and mixed via OfflineAudioContext.
 *
 * Depends: ArenaApp, ArenaRender, ArenaAudio
 */
(function () {
    'use strict';

    const FPS = 30;
    const FRAME_DT = 1 / FPS;
    const WIN_HOLD_SEC = 2.8;
    const WIN_HOLD_FRAMES = Math.round(WIN_HOLD_SEC * FPS);
    const MAX_FRAMES = FPS * 60;

    let prepared = false;
    let holdFramesLeft = 0;
    let frameIndex = 0;
    let simTime = 0;
    let fighterIds = [];
    let introEnabled = false;
    let introFramesLeft = 0;
    let introTotalFrames = 0;
    let introFrameIndex = 0;
    /** @type {string[]} */
    let introIds = [];
    /** @type {object[]} */
    let introMatchup = [];
    let gameMode = 'collision';
    let introCanvas = null;
    let introLayer = null;

    function slugify(id) {
        return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function recordingIdForSlot(slot, mode) {
        if (mode !== 'weapon') return slot.id;

        const customName = typeof slot.config?.name === 'string' ? slot.config.name.trim() : '';
        if (customName) return customName;

        const defaultSkin = window.ArenaApp?.defaultWeaponSkinId?.() || '_weapon';
        if (slot.id === defaultSkin) {
            const weaponId = slot.config?.weaponId;
            if (typeof weaponId === 'string' && weaponId && weaponId !== 'none') return weaponId;
            return window.ArenaApp?.defaultWeaponFor?.() || 'sword';
        }
        return slot.id;
    }

    function buildBaseName(ids, mode) {
        const base = ids.map(slugify).filter(Boolean).join('-vs-');
        if (mode === 'weapon') return `weapon-${base}`;
        return base;
    }

    function waitForFonts() {
        if (!document.fonts?.ready) return Promise.resolve();
        return document.fonts.ready.catch(() => {});
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForSkinImages(matchup, timeoutMs = 8000) {
        const SK = window.BallSkins;
        if (!SK?.getSkinImage) return;
        const ids = matchup
            .map((slot) => slot.id)
            .filter((id) => id && id !== '_weapon' && SK.getSkin(id));
        if (!ids.length) return;

        const start = performance.now();
        while (performance.now() - start < timeoutMs) {
            let ready = true;
            for (const id of ids) {
                if (!SK.getSkinImage(id)) ready = false;
            }
            if (ready) return;
            await sleep(50);
        }
    }

    async function waitForIntroImages(ids, timeoutMs = 8000) {
        const BI = window.BallIntros;
        if (!BI?.loadIntroImage || !BI.getIntroImage) return;
        for (const id of ids) BI.loadIntroImage(id);

        const start = performance.now();
        while (performance.now() - start < timeoutMs) {
            let ready = true;
            for (const id of ids) {
                if (!BI.getIntroImage(id)) ready = false;
            }
            if (ready) return;
            await sleep(50);
        }
    }

    function resolveIntroPayload(payload, matchup) {
        if (!payload?.introMode || payload.introMode === 'skip') return null;

        const BI = window.BallIntros;
        if (payload.introMode === 'default') {
            const defaults = BI?.getDefaultIntroAssignment?.(matchup.length) || [];
            if (defaults.filter(Boolean).length >= 2) return defaults;
        }

        const intros = Array.isArray(payload?.intros)
            ? payload.intros.filter(Boolean)
            : [];
        if (intros.length >= 2) return intros.slice(0, matchup.length);

        const defaults = BI?.getDefaultIntroAssignment?.(matchup.length) || [];
        if (defaults.filter(Boolean).length >= 2) return defaults;
        return null;
    }

    function syncIntroCanvasSize() {
        if (!introCanvas) return;
        introCanvas.width = window.IntroVsRender?.FRAME_W || 1080;
        introCanvas.height = window.IntroVsRender?.FRAME_H || 1440;
    }

    function paintIntroFrame() {
        if (!window.IntroVsRender?.paintFrame) return null;
        if (!introCanvas) {
            introCanvas = document.createElement('canvas');
            syncIntroCanvasSize();
        }
        const ctx = introCanvas.getContext('2d');
        if (!ctx) return null;
        window.IntroVsRender.paintFrame(ctx, {
            matchup: introMatchup,
            intros: introIds,
            frameIndex: introFrameIndex,
            fps: FPS,
            mode: gameMode,
        });
        return introCanvas;
    }

    /** PNG base64 (no data: prefix) for the current intro frame — used by offline_record. */
    function renderIntroPngBase64() {
        const canvas = paintIntroFrame();
        if (!canvas) return null;
        const dataUrl = canvas.toDataURL('image/png');
        const comma = dataUrl.indexOf(',');
        return comma >= 0 ? dataUrl.slice(comma + 1) : null;
    }

    async function scheduleIntroMusic() {
        const candidates = window.IntroVsRender?.MUSIC_CANDIDATES || [];
        for (const url of candidates) {
            try {
                const res = await fetch(url);
                if (!res.ok) continue;
                window.ArenaAudio?.addCaptureMusic?.(url, 0, 0.85);
                return;
            } catch {
                /* try next */
            }
        }
    }

    function phonePage() {
        return document.getElementById('offline-phone-page')
            || document.querySelector('.page');
    }

    /** Let ArenaApp.resizeCanvas size the canvas from the real letterbox (same as live). */
    function syncLayout() {
        window.dispatchEvent(new Event('resize'));
    }

    function pageSize() {
        const page = phonePage();
        if (!page) return { width: 520, height: 900 };
        return {
            width: Math.round(page.getBoundingClientRect().width) || 520,
            height: Math.round(page.getBoundingClientRect().height) || 900,
        };
    }

    function syncAudioClock() {
        window.ArenaAudio?.setCaptureTime?.(simTime);
    }

    function isDone() {
        const sim = window.ArenaApp?.getSim?.();
        return frameIndex >= MAX_FRAMES + introTotalFrames
            || (Boolean(sim?.finished) && holdFramesLeft <= 0);
    }

    async function prepare(payload) {
        const app = window.ArenaApp;
        if (!app) throw new Error('ArenaApp not loaded');
        if (!window.ArenaAudio?.beginCapture) {
            throw new Error('ArenaAudio capture API not loaded');
        }

        await app.whenReady();
        await waitForFonts();

        const mode = payload?.mode === 'weapon' ? 'weapon' : 'collision';
        const matchup = Array.isArray(payload?.matchup) ? payload.matchup : null;
        if (!matchup || matchup.length < 2) {
            throw new Error('offline render needs at least 2 fighters');
        }
        gameMode = mode;
        introMatchup = matchup;

        if (window.BallIntros?.init) await window.BallIntros.init();

        const resolvedIntros = resolveIntroPayload(payload, matchup);
        introEnabled = Boolean(resolvedIntros && resolvedIntros.length >= 2);
        if (payload?.introMode && payload.introMode !== 'skip' && !introEnabled) {
            throw new Error('Intro requested but Sukuna/Gojo images failed to load from intros/');
        }
        if (introEnabled && !window.IntroVsRender?.paintFrame) {
            throw new Error('IntroVsRender not loaded');
        }
        introIds = introEnabled ? resolvedIntros : [];
        introTotalFrames = introEnabled
            ? Math.round((window.IntroVsRender?.DURATION_SEC || 4) * FPS)
            : 0;
        introFramesLeft = introTotalFrames;
        introFrameIndex = 0;
        introLayer = document.getElementById('offline-intro-layer');
        introCanvas = document.getElementById('offline-intro-canvas');
        if (introEnabled) {
            if (introLayer) introLayer.hidden = false;
            syncIntroCanvasSize();
            await waitForIntroImages(introIds);
            paintIntroFrame();
        } else if (introLayer) {
            introLayer.hidden = true;
        }

        if (app.getGameMode() !== mode) {
            app.setGameMode(mode, { persist: false });
        }

        await waitForSkinImages(matchup);
        syncLayout();

        window.ArenaAudio.beginCapture();
        simTime = 0;
        syncAudioClock();
        if (introEnabled) await scheduleIntroMusic();

        app.setMatchup(matchup, { persist: false });
        app.pause();
        syncLayout();

        // Second beginCapture resets the timeline after matchup spawn SFX — keep intro music.
        const music = window.ArenaAudio.getCaptureMusic?.() || [];
        window.ArenaAudio.beginCapture();
        simTime = 0;
        syncAudioClock();
        for (const track of music) {
            window.ArenaAudio.addCaptureMusic?.(track.url, track.t, track.volume);
        }

        app.stepSimFrame(0);
        app.pause();
        syncLayout();
        if (introEnabled) paintIntroFrame();

        fighterIds = matchup.map((slot) => recordingIdForSlot(slot, mode));
        prepared = true;
        holdFramesLeft = 0;
        frameIndex = 0;

        const size = pageSize();
        return {
            fps: FPS,
            width: size.width,
            height: size.height,
            mode,
            baseName: buildBaseName(fighterIds, mode),
            fighterIds,
            maxFrames: MAX_FRAMES + introTotalFrames,
            introFrames: introTotalFrames,
            hasIntro: introEnabled,
        };
    }

    function paintCaptureChrome() {
        // Keep the live "fighting" chrome even though rAF is paused between frames.
        const btn = document.getElementById('btn-pause');
        const sim = window.ArenaApp?.getSim?.();
        if (!btn || !sim) return;
        if (!sim.finished) {
            btn.textContent = 'Pause';
            btn.setAttribute('aria-label', 'Pause');
            btn.disabled = false;
        }
    }

    /**
     * Advance one video frame (sim + UI). Playwright screenshots the phone page.
     * @returns {{ done: boolean, frameIndex: number }}
     */
    function stepFrame() {
        if (!prepared) throw new Error('call OfflineRender.prepare first');

        if (introFramesLeft > 0) {
            const introPng = renderIntroPngBase64();
            introFrameIndex += 1;
            introFramesLeft -= 1;
            simTime += FRAME_DT;
            syncAudioClock();
            frameIndex += 1;
            if (introFramesLeft === 0 && introLayer) introLayer.hidden = true;
            return { done: false, frameIndex, introPng };
        }

        const app = window.ArenaApp;
        const sim = app.getSim();
        if (!sim) return { done: true, frameIndex };

        if (frameIndex >= MAX_FRAMES + introTotalFrames) {
            return { done: true, frameIndex };
        }

        if (!sim.finished) {
            syncAudioClock();
            app.stepSimFrame(FRAME_DT);
            app.pause();
            simTime += FRAME_DT;
            syncAudioClock();
            if (sim.finished) holdFramesLeft = WIN_HOLD_FRAMES;
        } else if (holdFramesLeft > 0) {
            app.stepSimFrame(0);
            app.pause();
            simTime += FRAME_DT;
            syncAudioClock();
            holdFramesLeft -= 1;
        } else {
            return { done: true, frameIndex };
        }

        paintCaptureChrome();
        frameIndex += 1;
        return { done: isDone(), frameIndex, introPng: null };
    }

    function getMeta() {
        const sim = window.ArenaApp?.getSim?.();
        const mode = window.ArenaApp?.getGameMode?.() || 'collision';
        const winnerName = window.ArenaApp?.resolveWinnerLabel?.(sim)
            || (typeof sim?.winner?.name === 'string' ? sim.winner.name.trim() : '');
        const size = pageSize();
        const fighters = (sim?.balls || []).map((ball) => ({
            name: typeof ball.name === 'string' ? ball.name.trim() : '',
            color: typeof ball.color === 'string' ? ball.color : '',
        })).filter((f) => f.name);
        return {
            mode,
            fighterIds,
            baseName: buildBaseName(fighterIds, mode),
            frameIndex,
            fps: FPS,
            width: size.width,
            height: size.height,
            durationSec: frameIndex / FPS,
            audioEvents: window.ArenaAudio?.getCaptureEvents?.()?.length || 0,
            finished: Boolean(sim?.finished),
            draw: Boolean(sim?.finished && !winnerName),
            winner: winnerName || null,
            isTeam: Boolean(sim?.winnerIsTeam),
            fighters,
            hasIntro: introEnabled,
            introFrames: introTotalFrames,
            intros: introIds.slice(),
        };
    }

    async function finalizeAudio() {
        const durationSec = Math.max(frameIndex / FPS, simTime, 0.05);
        window.ArenaAudio.endCapture?.();
        return window.ArenaAudio.renderCaptureWav(durationSec);
    }

    window.OfflineRender = {
        FPS,
        prepare,
        stepFrame,
        renderIntroPngBase64,
        finalizeAudio,
        getMeta,
        phoneSelector: '#offline-phone-page',
    };
}());
