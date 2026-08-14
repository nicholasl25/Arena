/**
 * VS intro splash renderer — stacked fighter halves + VS mark.
 * Depends: BallIntros, ArenaRender, WeaponBall, PremadeWeapons, BallSkins
 * Exposes: window.IntroVsRender
 */
(function () {
    'use strict';

    const FRAME_W = 1080;
    const FRAME_H = 1440;
    const DURATION_SEC = 4;
    const MUSIC_CANDIDATES = [
        'intros/music/vs.mp3',
        'intros/music/vs.wav',
        'intros/music/vs.ogg',
        'intros/music/vs.m4a',
    ];

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

    function fighterSkinId(slot, mode) {
        if (mode !== 'weapon') return null;
        const id = slot?.id;
        if (!id || id === '_weapon') return null;
        return id;
    }

    function slotWeaponId(slot) {
        const id = slot?.config?.weaponId;
        if (id === 'none') return 'none';
        if (typeof id === 'string' && window.PremadeWeapons?.getPremadeWeapon?.(id)) return id;
        return window.ArenaApp?.defaultWeaponFor?.() || 'sword';
    }

    function buildPreviewBall(slot, index, pixelRadius, mode) {
        if (mode !== 'weapon' || typeof WeaponBall === 'undefined') return null;

        const skinId = fighterSkinId(slot, mode);
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

    function drawSimpleBall(targetCtx, cx, cy, r, slot, index, mode) {
        const skinId = fighterSkinId(slot, mode);
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

    function drawFighterBallOnIntro(targetCtx, cx, cy, r, slot, index, dpr, mode) {
        if (fighterSkinId(slot, mode)) {
            drawSimpleBall(targetCtx, cx, cy, r, slot, index, mode);
            return;
        }

        const render = window.ArenaRender;
        if (mode === 'weapon' && render?.drawBallAt) {
            const ball = buildPreviewBall(slot, index, r, mode);
            if (ball) {
                render.drawBallAt(targetCtx, ball, cx, cy, r, dpr, true);
                if (render.drawBallLabel) {
                    const label = ball.name || ball.weaponName || 'Weapon';
                    render.drawBallLabel(targetCtx, label, cx, cy, r, ball.displayFont, dpr);
                }
                return;
            }
        }
        drawSimpleBall(targetCtx, cx, cy, r, slot, index, mode);
    }

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

    function drawIntroInBand(targetCtx, introId, slot, index, band, mode, dpr) {
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
        drawFighterBallOnIntro(targetCtx, cx, cy, r, slot, index, dpr, mode);
        targetCtx.restore();
    }

    function drawVsMark(targetCtx, w, h, frameIndex, fps) {
        const delay = 0.18;
        const duration = 0.55;
        const t = Math.max(0, (frameIndex / fps) - delay) / duration;
        if (t <= 0) return;

        const eased = 1 - (1 - Math.min(1, t)) ** 3;
        const scale = 0.55 + (1 - 0.55) * eased;
        const rotate = (-14 + (6 - (-14)) * eased) * Math.PI / 180;
        const opacity = eased;

        const fontSize = Math.max(48, Math.min(w, h) * 0.12);
        targetCtx.save();
        targetCtx.globalAlpha = opacity;
        targetCtx.translate(w / 2, h / 2);
        targetCtx.rotate(rotate);
        targetCtx.scale(scale, scale);
        targetCtx.font = `800 ${fontSize}px "DM Sans", system-ui, sans-serif`;
        targetCtx.textAlign = 'center';
        targetCtx.textBaseline = 'middle';
        targetCtx.fillStyle = '#fff';
        targetCtx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        targetCtx.shadowBlur = fontSize * 0.28;
        targetCtx.shadowOffsetY = fontSize * 0.08;
        targetCtx.fillText('VS', 0, 0);
        targetCtx.restore();
    }

    /**
     * Paint the full VS splash into a canvas context.
     * @param {CanvasRenderingContext2D} targetCtx
     * @param {{ matchup: object[], intros: string[], frameIndex?: number, fps?: number, mode?: string }} opts
     */
    function paintFrame(targetCtx, opts) {
        const matchup = Array.isArray(opts?.matchup) ? opts.matchup : [];
        const intros = Array.isArray(opts?.intros) ? opts.intros : [];
        const frameIndex = Number(opts?.frameIndex) || 0;
        const fps = Number(opts?.fps) || 30;
        const mode = opts?.mode === 'weapon' ? 'weapon' : 'collision';
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        const w = targetCtx.canvas.width;
        const h = targetCtx.canvas.height;
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        targetCtx.clearRect(0, 0, w, h);
        targetCtx.fillStyle = '#0b0f19';
        targetCtx.fillRect(0, 0, w, h);

        if (matchup.length < 2 || intros.length < 2) return;

        const splitY = Math.round(h * 0.5);
        drawIntroInBand(targetCtx, intros[0], matchup[0], 0, { x: 0, y: 0, w, h: splitY }, mode, dpr);
        drawIntroInBand(targetCtx, intros[1], matchup[1], 1, { x: 0, y: splitY, w, h: h - splitY }, mode, dpr);
        // Offline recording needs the canvas mark; workflow Play VS uses the CSS overlay instead.
        if (opts?.showVsMark !== false) {
            drawVsMark(targetCtx, w, h, frameIndex, fps);
        }
    }

    window.IntroVsRender = {
        FRAME_W,
        FRAME_H,
        DURATION_SEC,
        MUSIC_CANDIDATES,
        paintFrame,
        drawIntroInBand,
        fighterLabel,
        fighterColor,
    };
}());
