/**
 * Workflow intro editor — pick intro images, set ball point + radius, play VS splash.
 * Depends: BallIntros, SetupSearchSelect, ArenaSetup (for fighter labels/colors).
 * Exposes: window.WorkflowIntroEditor
 */
(function () {
    'use strict';

    const VS_MUSIC_CANDIDATES = [
        'intros/music/vs.mp3',
        'intros/music/vs.wav',
        'intros/music/vs.ogg',
        'intros/music/vs.m4a',
    ];
    /** Match offline_record.py Shorts frame (1080×1440). */
    const VS_FRAME_W = 1080;
    const VS_FRAME_H = 1440;
    const VS_ASPECT = VS_FRAME_W / VS_FRAME_H;

    /** @type {{ id: string, config: object }[]} */
    let matchup = [];
    /** @type {string[]} */
    let assignedIntros = [];
    let activeSlot = 0;
    let dirty = false;
    /** @type {((result: { intros: string[], matchup: object[] }) => void) | null} */
    let onDone = null;
    /** @type {HTMLAudioElement | null} */
    let vsAudio = null;
    let reopenModalAfterVs = false;

    const modal = document.getElementById('modal-intro');
    const slotsEl = document.getElementById('intro-slots');
    const pickerMount = document.getElementById('intro-picker-mount');
    const canvas = document.getElementById('intro-canvas');
    const radiusInput = document.getElementById('intro-radius');
    const radiusValue = document.getElementById('intro-radius-value');
    const statusEl = document.getElementById('intro-status');
    const btnSave = document.getElementById('btn-intro-save');
    const btnPlayVs = document.getElementById('btn-intro-play-vs');
    const btnDone = document.getElementById('btn-intro-done');
    const vsOverlay = document.getElementById('intro-vs-overlay');

    if (!modal || !slotsEl || !canvas) return;

    const ctx = canvas.getContext('2d');

    function BI() {
        return window.BallIntros;
    }

    function fighterLabel(slot, index) {
        const name = slot?.config?.name?.trim();
        if (name) return name;
        const meta = window.ArenaApp?.listFighters?.()?.find((f) => f.id === slot?.id);
        if (meta?.name) return meta.name;
        return slot?.id || `Fighter ${index + 1}`;
    }

    function fighterColor(slot, index) {
        const color = slot?.config?.color;
        if (typeof color === 'string' && color) return color;
        const meta = window.ArenaApp?.listFighters?.()?.find((f) => f.id === slot?.id);
        if (meta?.color) return meta.color;
        const fallback = ['#cc0000', '#00308f', '#f58426', '#22c55e'];
        return fallback[index % fallback.length];
    }

    function fighterSkinId(slot) {
        const mode = window.ArenaSetup?.getGameMode?.() || window.ArenaApp?.getGameMode?.();
        if (mode !== 'weapon') return null;
        const id = slot?.id;
        if (!id || id === '_weapon') return null;
        return id;
    }

    function isWeaponMode() {
        return (window.ArenaSetup?.getGameMode?.() || window.ArenaApp?.getGameMode?.()) === 'weapon';
    }

    function slotWeaponId(slot) {
        const id = slot?.config?.weaponId;
        if (id === 'none') return 'none';
        if (typeof id === 'string' && window.PremadeWeapons?.getPremadeWeapon?.(id)) return id;
        return window.ArenaApp?.defaultWeaponFor?.() || 'sword';
    }

    function buildPreviewBall(slot, index, pixelRadius) {
        if (!isWeaponMode() || typeof WeaponBall === 'undefined') return null;

        const skinId = fighterSkinId(slot);
        const color = fighterColor(slot, index);
        const weaponId = slotWeaponId(slot);
        const customName = slot?.config?.name?.trim();
        const skinSpec = skinId ? window.BallSkins?.getSkin?.(skinId) : null;
        const displayName = customName
            || (!skinId ? window.ArenaApp?.weaponDisplayName?.(weaponId) : skinSpec?.name)
            || 'Ball';
        const health = Number(slot?.config?.health) || 60;

        const ball = new WeaponBall({
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            radius: pixelRadius,
            health,
            maxHealth: health,
            mass: 64,
            color,
            name: displayName,
            skinId: skinId || null,
            weaponAngle: Math.PI * 0.22 + index * 0.35,
        });

        if (weaponId === 'none') {
            ball.weaponKind = 'none';
            ball.weaponBehavior = window.PremadeWeaponRegistry?.NoneWeaponBehavior || null;
            ball.spinSpeed = 0;
            ball.weaponId = 'none';
            ball.weaponName = 'None';
        } else {
            window.PremadeWeapons.applyWeaponToBall(ball, weaponId);
        }
        window.PremadePowerups?.applyPowerupToBall?.(ball, slot.config?.powerupId);

        ball.displayFont = index % 2 === 0 ? 'Russo One' : 'Orbitron';
        return ball;
    }

    function drawSimpleBall(targetCtx, cx, cy, r, slot, index) {
        const skinId = fighterSkinId(slot);
        const skinImg = skinId && window.BallSkins
            ? window.BallSkins.getSkinImage(skinId)
            : null;
        const color = fighterColor(slot, index);

        targetCtx.beginPath();
        targetCtx.arc(cx, cy, r, 0, Math.PI * 2);
        if (skinImg) {
            targetCtx.save();
            targetCtx.clip();
            targetCtx.drawImage(skinImg, cx - r, cy - r, r * 2, r * 2);
            targetCtx.restore();
        } else {
            targetCtx.fillStyle = color;
            targetCtx.fill();
        }
        targetCtx.strokeStyle = '#111';
        targetCtx.lineWidth = Math.max(2, r * 0.06);
        targetCtx.stroke();
    }

    function drawFighterBallOnIntro(targetCtx, cx, cy, r, slot, index, dpr) {
        // Skinned balls: face only. Weapon art + name only when there's no skin.
        if (fighterSkinId(slot)) {
            drawSimpleBall(targetCtx, cx, cy, r, slot, index);
            return;
        }

        const render = window.ArenaRender;
        if (isWeaponMode() && render?.drawBallAt) {
            const ball = buildPreviewBall(slot, index, r);
            if (ball) {
                render.drawBallAt(targetCtx, ball, cx, cy, r, dpr, true);
                if (render.drawBallLabel) {
                    const label = ball.name || ball.weaponName || 'Weapon';
                    render.drawBallLabel(targetCtx, label, cx, cy, r, ball.displayFont, dpr);
                }
                return;
            }
        }
        drawSimpleBall(targetCtx, cx, cy, r, slot, index);
    }

    function setStatus(msg, kind = '') {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.dataset.kind = kind;
    }

    function allAssigned() {
        return matchup.length >= 2
            && assignedIntros.length >= matchup.length
            && assignedIntros.every((id) => Boolean(id && BI()?.getIntro(id)));
    }

    function syncActionButtons() {
        const ready = allAssigned();
        if (btnPlayVs) btnPlayVs.disabled = !ready;
        if (btnDone) btnDone.disabled = !ready;
        if (btnSave) {
            btnSave.disabled = !assignedIntros[activeSlot];
        }
    }

    function currentPlacement() {
        const id = assignedIntros[activeSlot];
        return BI()?.getPlacement(id) || { ...BI().DEFAULT_PLACEMENT };
    }

    function writeLocalPlacement(partial) {
        const id = assignedIntros[activeSlot];
        if (!id || !BI()) return;
        const next = { ...currentPlacement(), ...partial };
        BI().setPlacementLocal(id, next);
        dirty = true;
        paintPreview();
        syncRadiusUi();
    }

    function syncRadiusUi() {
        const p = currentPlacement();
        if (radiusInput) radiusInput.value = String(Math.round(p.radius * 1000) / 1000);
        if (radiusValue) radiusValue.textContent = p.radius.toFixed(3);
    }

    function introOptions() {
        const ids = BI()?.listIntroIds?.() || [];
        return ids.map((id) => {
            const spec = BI().getIntro(id);
            return { id, name: spec?.name || id, searchText: `${spec?.name || ''} ${id}` };
        });
    }

    function ensurePicker() {
        if (!pickerMount || !window.SetupSearchSelect) return;
        pickerMount.innerHTML = '';
        const options = introOptions();
        if (!options.length) {
            pickerMount.innerHTML = '<p class="intro-empty-hint">Drop images into <code>intros/</code>, then refresh.</p>';
            return;
        }
        const current = assignedIntros[activeSlot] || options[0].id;
        if (!assignedIntros[activeSlot]) {
            assignedIntros[activeSlot] = current;
        }
        window.SetupSearchSelect.mount(pickerMount, {
            options,
            value: assignedIntros[activeSlot],
            ariaLabel: 'Intro image',
            onChange(id) {
                assignedIntros[activeSlot] = id;
                dirty = true;
                BI()?.loadIntroImage?.(id);
                syncRadiusUi();
                paintPreview();
                renderSlotTabs();
                syncActionButtons();
                setStatus(`Selected ${BI().getIntro(id)?.name || id}`);
            },
        });
    }

    function renderSlotTabs() {
        slotsEl.innerHTML = matchup.map((slot, i) => {
            const introId = assignedIntros[i];
            const introName = introId ? (BI()?.getIntro(introId)?.name || introId) : 'No intro';
            const color = fighterColor(slot, i);
            return `
                <button
                    type="button"
                    class="intro-slot-tab${i === activeSlot ? ' is-active' : ''}${introId ? ' has-intro' : ''}"
                    data-slot="${i}"
                    style="--ball-color:${color}"
                >
                    <span class="intro-slot-index">${i + 1}</span>
                    <span class="intro-slot-meta">
                        <strong>${escapeHtml(fighterLabel(slot, i))}</strong>
                        <small>${escapeHtml(introName)}</small>
                    </span>
                </button>
            `;
        }).join('');

        slotsEl.querySelectorAll('[data-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
                activeSlot = Number(btn.dataset.slot) || 0;
                ensurePicker();
                syncRadiusUi();
                paintPreview();
                renderSlotTabs();
                syncActionButtons();
            });
        });
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fitCanvas() {
        const wrap = canvas.parentElement;
        const cssW = Math.max(280, wrap?.clientWidth || 480);
        const cssH = Math.round(cssW * 0.75);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        return { cssW, cssH, dpr };
    }

    function imageDrawRect(img, cssW, cssH) {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.min(cssW / iw, cssH / ih);
        const w = iw * scale;
        const h = ih * scale;
        const x = (cssW - w) / 2;
        const y = (cssH - h) / 2;
        return { x, y, w, h, scale };
    }

    /** Cover-fit into a box, top-aligned (shows face/ball area). */
    function imageCoverRectTop(img, boxW, boxH) {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.max(boxW / iw, boxH / ih);
        const w = iw * scale;
        const h = ih * scale;
        return {
            x: (boxW - w) / 2,
            y: 0,
            w,
            h,
            scale,
        };
    }

    function drawBallOverlay(cx, cy, r, slot, index, dpr) {
        drawFighterBallOnIntro(ctx, cx, cy, r, slot, index, dpr);
    }

    function paintPreview() {
        if (!ctx) return;
        const { cssW, cssH, dpr } = fitCanvas();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, cssW, cssH);

        const introId = assignedIntros[activeSlot];
        const img = introId ? BI()?.getIntroImage(introId) : null;
        if (!img) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '500 14px IBM Plex Sans, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(introId ? 'Loading intro image…' : 'Select an intro image', cssW / 2, cssH / 2);
            return;
        }

        const rect = imageDrawRect(img, cssW, cssH);
        ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);

        const placement = currentPlacement();
        const cx = rect.x + placement.x * rect.w;
        const cy = rect.y + placement.y * rect.h;
        const r = BI().pixelRadius(placement, rect.w, rect.h);
        drawBallOverlay(cx, cy, r, matchup[activeSlot], activeSlot, dpr);

        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    function canvasToPlacement(clientX, clientY) {
        const introId = assignedIntros[activeSlot];
        const img = introId ? BI()?.getIntroImage(introId) : null;
        if (!img) return null;
        const bounds = canvas.getBoundingClientRect();
        const cssW = bounds.width;
        const cssH = bounds.height;
        const rect = imageDrawRect(img, cssW, cssH);
        const px = clientX - bounds.left;
        const py = clientY - bounds.top;
        if (px < rect.x || py < rect.y || px > rect.x + rect.w || py > rect.y + rect.h) {
            return null;
        }
        return {
            x: (px - rect.x) / rect.w,
            y: (py - rect.y) / rect.h,
        };
    }

    async function saveCurrentPlacement() {
        const id = assignedIntros[activeSlot];
        if (!id || !BI()) return;
        try {
            setStatus('Saving…', 'busy');
            await BI().savePlacement(id, currentPlacement());
            dirty = false;
            setStatus(`Saved placement for ${BI().getIntro(id)?.name || id}`, 'success');
            syncActionButtons();
        } catch (err) {
            setStatus(err.message || 'Save failed', 'error');
        }
    }

    function stopVsMusic() {
        if (vsAudio) {
            vsAudio.pause();
            vsAudio.currentTime = 0;
        }
    }

    function tryPlayVsMusic() {
        stopVsMusic();
        let i = 0;
        const tryNext = () => {
            if (i >= VS_MUSIC_CANDIDATES.length) return;
            const src = VS_MUSIC_CANDIDATES[i++];
            const audio = new Audio(src);
            vsAudio = audio;
            audio.volume = 0.85;
            audio.play().catch(() => tryNext());
        };
        tryNext();
    }

    /** Draw one intro into a rectangular band (top-aligned cover). */
    function drawIntroInBand(targetCtx, introId, slot, index, band) {
        const img = BI()?.getIntroImage(introId);
        targetCtx.fillStyle = '#0b0f19';
        targetCtx.fillRect(band.x, band.y, band.w, band.h);
        if (!img) return;

        const cover = imageCoverRectTop(img, band.w, band.h);
        const drawX = band.x + cover.x;
        const drawY = band.y + cover.y;
        targetCtx.save();
        targetCtx.beginPath();
        targetCtx.rect(band.x, band.y, band.w, band.h);
        targetCtx.clip();
        targetCtx.drawImage(img, drawX, drawY, cover.w, cover.h);

        const placement = BI().getPlacement(introId);
        const cx = drawX + placement.x * cover.w;
        const cy = drawY + placement.y * cover.h;
        const r = BI().pixelRadius(placement, cover.w, cover.h);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        drawFighterBallOnIntro(targetCtx, cx, cy, r, slot, index, dpr);
        targetCtx.restore();
    }

    function vsFrameCssSize() {
        const maxW = window.innerWidth;
        const maxH = window.innerHeight;
        let w = maxW;
        let h = w / VS_ASPECT;
        if (h > maxH) {
            h = maxH;
            w = h * VS_ASPECT;
        }
        return {
            cssW: Math.max(1, Math.round(w)),
            cssH: Math.max(1, Math.round(h)),
        };
    }

    function paintVsFrame() {
        const vsCanvas = document.getElementById('intro-vs-canvas');
        if (!vsCanvas || !allAssigned()) return;

        const { cssW, cssH } = vsFrameCssSize();
        const scale = Math.min(cssW / VS_FRAME_W, cssH / VS_FRAME_H);
        const w = VS_FRAME_W;
        const h = VS_FRAME_H;

        vsCanvas.width = w;
        vsCanvas.height = h;
        vsCanvas.style.width = `${Math.round(w * scale)}px`;
        vsCanvas.style.height = `${Math.round(h * scale)}px`;

        const vctx = vsCanvas.getContext('2d');
        if (!vctx || !window.IntroVsRender?.paintFrame) return;
        const mode = window.ArenaSetup?.getGameMode?.() || window.ArenaApp?.getGameMode?.() || 'collision';
        window.IntroVsRender.paintFrame(vctx, {
            matchup,
            intros: [assignedIntros[0], assignedIntros[1]],
            frameIndex: 30,
            fps: 30,
            mode,
            showVsMark: false,
        });
    }

    function hideModalForVs() {
        reopenModalAfterVs = Boolean(modal.open);
        if (reopenModalAfterVs && typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
    }

    function restoreModalAfterVs() {
        if (!reopenModalAfterVs) return;
        reopenModalAfterVs = false;
        if (typeof modal.showModal === 'function') modal.showModal();
        else modal.setAttribute('open', '');
    }

    function playVs() {
        if (!allAssigned() || !vsOverlay) return;

        const a = assignedIntros[0];
        const b = assignedIntros[1];
        BI()?.loadIntroImage?.(a);
        BI()?.loadIntroImage?.(b);

        hideModalForVs();

        vsOverlay.hidden = false;
        vsOverlay.classList.remove('is-playing');
        void vsOverlay.offsetWidth;
        vsOverlay.classList.add('is-playing');
        vsOverlay.innerHTML = `
            <div class="intro-vs-frame">
                <canvas class="intro-vs-canvas" id="intro-vs-canvas"></canvas>
                <div class="intro-vs-mark" aria-hidden="true">VS</div>
                <button type="button" class="intro-vs-close" id="btn-intro-vs-close" aria-label="Close">×</button>
            </div>
        `;

        document.getElementById('btn-intro-vs-close')?.addEventListener('click', closeVs);
        document.addEventListener('keydown', onVsKeydown);

        requestAnimationFrame(() => {
            paintVsFrame();
            setTimeout(paintVsFrame, 120);
            setTimeout(paintVsFrame, 400);
        });
        tryPlayVsMusic();
    }

    function onVsKeydown(e) {
        if (e.key !== 'Escape' || vsOverlay?.hidden) return;
        e.preventDefault();
        closeVs();
    }

    function closeVs() {
        stopVsMusic();
        document.removeEventListener('keydown', onVsKeydown);
        if (!vsOverlay) return;
        vsOverlay.classList.remove('is-playing');
        vsOverlay.hidden = true;
        vsOverlay.innerHTML = '';
        restoreModalAfterVs();
    }

    async function open(options = {}) {
        matchup = Array.isArray(options.matchup) ? options.matchup.slice() : [];
        if (matchup.length < 2) throw new Error('Need at least 2 fighters before creating intros');

        assignedIntros = Array.isArray(options.intros)
            ? options.intros.slice(0, matchup.length)
            : [];
        while (assignedIntros.length < matchup.length) assignedIntros.push('');

        activeSlot = 0;
        dirty = false;
        onDone = typeof options.onDone === 'function' ? options.onDone : null;

        if (BI()?.init) await BI().init();
        if (!BI()?.listIntroIds?.().length) {
            setStatus('No intro images yet — drop files into intros/ and reopen.', 'error');
        } else {
            setStatus('Click the image to place the ball. Adjust radius, then Save.');
        }

        // Default-assign first intros if empty
        const defaults = BI()?.getDefaultIntroAssignment?.(assignedIntros.length) || [];
        for (let i = 0; i < assignedIntros.length; i++) {
            if (!assignedIntros[i] && defaults[i]) assignedIntros[i] = defaults[i];
            if (assignedIntros[i]) BI()?.loadIntroImage?.(assignedIntros[i]);
        }

        renderSlotTabs();
        ensurePicker();
        syncRadiusUi();
        paintPreview();
        syncActionButtons();

        if (typeof modal.showModal === 'function') modal.showModal();
        else modal.setAttribute('open', '');
    }

    /** Play the VS splash for a matchup without opening the editor modal. */
    async function playAssigned(options = {}) {
        matchup = Array.isArray(options.matchup) ? options.matchup.slice() : [];
        assignedIntros = Array.isArray(options.intros) ? options.intros.slice(0, matchup.length) : [];
        while (assignedIntros.length < matchup.length) assignedIntros.push('');
        if (BI()?.init) await BI().init();
        for (const id of assignedIntros) {
            if (id) BI()?.loadIntroImage?.(id);
        }
        reopenModalAfterVs = false;
        playVs();
    }

    function close() {
        reopenModalAfterVs = false;
        closeVs();
        if (typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
    }

    function finish() {
        if (!allAssigned()) {
            setStatus('Assign an intro image to each fighter first.', 'error');
            return;
        }
        const result = {
            intros: assignedIntros.slice(),
            matchup: matchup.slice(),
        };
        close();
        onDone?.(result);
    }

    canvas.addEventListener('pointerdown', (e) => {
        const point = canvasToPlacement(e.clientX, e.clientY);
        if (!point) return;
        writeLocalPlacement(point);
        setStatus('Point updated — click Save to keep it.');
    });

    radiusInput?.addEventListener('input', () => {
        const radius = Number(radiusInput.value);
        if (!Number.isFinite(radius)) return;
        writeLocalPlacement({ radius });
    });

    btnSave?.addEventListener('click', () => {
        saveCurrentPlacement();
    });

    btnPlayVs?.addEventListener('click', () => {
        if (dirty) {
            saveCurrentPlacement().then(() => playVs());
            return;
        }
        playVs();
    });

    btnDone?.addEventListener('click', finish);

    modal.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', close);
    });

    window.addEventListener('arena-intros-loaded', () => {
        if (!modal.open) return;
        paintPreview();
        ensurePicker();
        renderSlotTabs();
        syncActionButtons();
    });

    window.addEventListener('resize', () => {
        if (modal.open) paintPreview();
        if (vsOverlay && !vsOverlay.hidden) paintVsFrame();
    });

    window.WorkflowIntroEditor = {
        open,
        close,
        playVs,
        playAssigned,
        closeVs,
        isOpen() {
            return Boolean(modal.open);
        },
    };
}());
