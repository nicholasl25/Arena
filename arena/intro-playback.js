/**
 * VS intro playback for live arena recording — reads workflow-setup-v1.
 * Depends: BallIntros, IntroVsRender, ArenaApp
 * Exposes: window.ArenaIntroPlayback
 */
(function () {
    'use strict';

    const SETUP_KEY = 'workflow-setup-v1';
    const FPS = 30;

    const layer = document.getElementById('arena-intro-layer');
    const canvas = document.getElementById('arena-intro-canvas');
    const vsMark = layer?.querySelector('.arena-intro-vs-mark');

    /** @type {HTMLAudioElement | null} */
    let vsAudio = null;

    function loadWorkflowSetup() {
        try {
            const raw = localStorage.getItem(SETUP_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return null;
            return data;
        } catch {
            return null;
        }
    }

    function resolveIntros(setup, matchup) {
        if (setup.introMode === 'default') {
            const defaults = window.BallIntros?.getDefaultIntroAssignment?.(matchup.length) || [];
            if (defaults.filter(Boolean).length >= 2) return defaults;
        }
        const saved = Array.isArray(setup.intros) ? setup.intros.filter(Boolean) : [];
        if (saved.length >= 2) return saved.slice(0, matchup.length);
        const fallback = window.BallIntros?.getDefaultIntroAssignment?.(matchup.length) || [];
        return fallback.filter(Boolean).length >= 2 ? fallback : null;
    }

    /** @returns {{ matchup: object[], intros: string[], mode: string } | null} */
    function resolveFromWorkflow() {
        const setup = loadWorkflowSetup();
        if (!setup?.introReady || setup.introMode === 'skip') return null;

        const matchup = window.ArenaApp?.getMatchup?.()
            || window.ArenaSetup?.getPendingMatchup?.();
        if (!Array.isArray(matchup) || matchup.length < 2) return null;

        const intros = resolveIntros(setup, matchup);
        if (!intros || intros.length < 2) return null;

        const mode = window.ArenaApp?.getGameMode?.()
            || window.ArenaSetup?.getGameMode?.()
            || setup.mode
            || 'collision';

        return { matchup, intros, mode };
    }

    function syncCanvasSize() {
        if (!canvas || !layer) return;
        const page = layer.parentElement;
        const rect = page?.getBoundingClientRect();
        if (!rect) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }

    async function waitForIntroImages(ids) {
        const BI = window.BallIntros;
        if (!BI?.init || !BI.loadIntroImage) return;
        await BI.init();
        for (const id of ids) BI.loadIntroImage(id);

        const start = performance.now();
        while (performance.now() - start < 8000) {
            let ready = true;
            for (const id of ids) {
                if (!BI.getIntroImage(id)) ready = false;
            }
            if (ready) return;
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    function paintFrame(plan, frameIndex) {
        if (!canvas || !window.IntroVsRender?.paintFrame) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        window.IntroVsRender.paintFrame(ctx, {
            matchup: plan.matchup,
            intros: plan.intros,
            frameIndex,
            fps: FPS,
            mode: plan.mode,
            showVsMark: false,
        });
    }

    function stopVsMusic() {
        if (vsAudio) {
            vsAudio.pause();
            vsAudio.currentTime = 0;
            vsAudio = null;
        }
    }

    function tryPlayVsMusic() {
        stopVsMusic();
        const candidates = window.IntroVsRender?.MUSIC_CANDIDATES || [];
        let i = 0;
        const tryNext = () => {
            if (i >= candidates.length) return;
            const src = candidates[i++];
            const audio = new Audio(src);
            vsAudio = audio;
            audio.volume = 0.85;
            audio.play().catch(() => tryNext());
        };
        tryNext();
    }

    function showLayer() {
        if (!layer) return;
        layer.hidden = false;
        layer.classList.add('is-playing');
    }

    function hideLayer() {
        if (!layer) return;
        layer.classList.remove('is-playing');
        layer.hidden = true;
        stopVsMusic();
    }

    /** Load images and paint frame 0 — call before recording starts. */
    async function prepare(plan) {
        if (!layer || !canvas || !plan) return;
        await waitForIntroImages(plan.intros);
        syncCanvasSize();
        showLayer();
        paintFrame(plan, 0);
    }

    /** Animate the VS splash for DURATION_SEC. */
    async function run(plan) {
        if (!layer || !canvas || !plan) return;

        const durationSec = window.IntroVsRender?.DURATION_SEC || 4;
        const totalFrames = Math.round(durationSec * FPS);
        tryPlayVsMusic();

        const start = performance.now();
        let frameIndex = 0;

        return new Promise((resolve) => {
            function tick() {
                const elapsed = (performance.now() - start) / 1000;
                frameIndex = Math.min(totalFrames - 1, Math.floor(elapsed * FPS));
                syncCanvasSize();
                paintFrame(plan, frameIndex);

                if (elapsed >= durationSec) {
                    hideLayer();
                    resolve();
                    return;
                }
                requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        });
    }

    /** Prepare + run in one call. */
    async function play(plan) {
        await prepare(plan);
        await run(plan);
    }

    window.ArenaIntroPlayback = {
        resolveFromWorkflow,
        prepare,
        run,
        play,
        hide: hideLayer,
    };
}());
