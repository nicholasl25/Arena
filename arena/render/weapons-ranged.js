/**
 * Ranged weapon / projectile draws: bow, longbow, arrows, slingshot, laser,
 * grenade, basketball, boomerang, plasma.
 * Extends window.ArenaRenderParts
 */
(function (R) {
    'use strict';

    function drawBow(ctx, ball, cx, cy, r, dpr) {
        const bowLen = (ball.bowLength || 28) * (r / ball.radius);
        const angle = ball.weaponAngle ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const baseR = r + 2 * (r / ball.radius);
        const gx = cx + baseR * cos;
        const gy = cy + baseR * sin;
        const charge = ball.shootInterval > 0 ? (ball._shootTimer ?? 0) / ball.shootInterval : 0;
        const size = Math.max(34, bowLen * 1.55 + r * 0.35);
        const heldX = cx + Math.cos(angle) * (r + size * 0.22);
        const heldY = cy + Math.sin(angle) * (r + size * 0.22);

        if (R.drawAimedSprite(ctx, 'slingshot', heldX, heldY, angle, size)) {
            if (charge > 0.55) {
                const nockDist = r + size * 0.42;
                const nx = cx + Math.cos(angle) * nockDist;
                const ny = cy + Math.sin(angle) * nockDist;
                const nockR = Math.max(5, 6.5 * dpr);
                if (ball.projectileKind === 'basketball') {
                    drawBasketball(ctx, nx, ny, nockR * 1.35, dpr, ball.color || '#c45c14', 0);
                } else {
                    drawSlingshotProjectile(ctx, nx, ny, nockR, dpr, ball.color || '#888', 0);
                }
            }
            return;
        }

        const limbW = Math.max(3.5, 4.5 * dpr);
        const tipX = bowLen * 0.88;
        const spread = bowLen * 0.52;

        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(angle);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.strokeStyle = '#3d2814';
        ctx.lineWidth = limbW + 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(tipX * 0.42, -spread * 0.55, tipX, -spread);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(tipX * 0.42, spread * 0.55, tipX, spread);
        ctx.stroke();

        ctx.strokeStyle = '#6b4423';
        ctx.lineWidth = limbW;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(tipX * 0.42, -spread * 0.55, tipX, -spread);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(tipX * 0.42, spread * 0.55, tipX, spread);
        ctx.stroke();

        const stringPull = charge > 0.72 ? (charge - 0.72) / 0.28 * tipX * 0.18 : 0;
        ctx.strokeStyle = '#ddd6c8';
        ctx.lineWidth = Math.max(1.2, 1.5 * dpr);
        ctx.beginPath();
        ctx.moveTo(tipX, -spread);
        ctx.lineTo(-stringPull, 0);
        ctx.lineTo(tipX, spread);
        ctx.stroke();

        if (charge > 0.55) {
            const nockR = Math.max(3.5, 4.5 * dpr);
            if (ball.projectileKind === 'basketball') {
                drawBasketball(
                    ctx,
                    -stringPull + tipX * 0.35,
                    0,
                    nockR * 1.35,
                    dpr,
                    ball.color || '#c45c14',
                    0,
                );
            } else {
                drawSlingshotProjectile(
                    ctx,
                    -stringPull + tipX * 0.35,
                    0,
                    nockR,
                    dpr,
                    ball.color || '#888',
                    0,
                );
            }
        }

        ctx.fillStyle = '#4a3020';
        ctx.strokeStyle = '#1a1008';
        ctx.lineWidth = Math.max(1, dpr);
        const gripW = limbW * 1.35;
        ctx.fillRect(-gripW * 0.35, -gripW * 0.5, gripW * 0.7, gripW);
        ctx.strokeRect(-gripW * 0.35, -gripW * 0.5, gripW * 0.7, gripW);

        ctx.restore();
    }

    function drawRadialArrow(ctx, fromX, tipX, dpr, color) {
        const headLen = Math.max(5.5, 6.5 * dpr);
        const halfHead = Math.max(3.2, 3.8 * dpr);
        const shaftEnd = tipX - headLen;

        ctx.strokeStyle = '#1a1008';
        ctx.lineWidth = Math.max(2.2, 2.6 * dpr);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fromX, 0);
        ctx.lineTo(shaftEnd, 0);
        ctx.stroke();

        ctx.strokeStyle = '#6b4a2e';
        ctx.lineWidth = Math.max(1.5, 1.9 * dpr);
        ctx.beginPath();
        ctx.moveTo(fromX, 0);
        ctx.lineTo(shaftEnd, 0);
        ctx.stroke();

        ctx.fillStyle = R.shadeHex(color || '#c4a574', 0.15);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1, 1.2 * dpr);
        ctx.beginPath();
        ctx.moveTo(tipX, 0);
        ctx.lineTo(shaftEnd, -halfHead);
        ctx.lineTo(shaftEnd, halfHead);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const fletch = Math.max(4, 5 * dpr);
        ctx.strokeStyle = R.shadeHex(color || '#888', 0.4);
        ctx.lineWidth = Math.max(1.2, 1.4 * dpr);
        ctx.beginPath();
        ctx.moveTo(fromX, -fletch * 0.7);
        ctx.lineTo(fromX + fletch * 0.7, 0);
        ctx.lineTo(fromX, fletch * 0.7);
        ctx.stroke();
    }

    /**
     * Bow: pixel-art longbow (pull frames when charging), arrow nocked along fire dir.
     */
    function drawLongbow(ctx, ball, cx, cy, r, dpr) {
        const angle = ball.weaponAngle ?? 0;
        const scale = r / Math.max(1, ball.radius);
        const charge = ball.shootInterval > 0
            ? Math.max(0, Math.min(1, (ball._shootTimer ?? 0) / ball.shootInterval))
            : 0;
        let bowKey = 'bow';
        if (charge > 0.72) bowKey = 'bowPull2';
        else if (charge > 0.4) bowKey = 'bowPull1';

        const bowSize = Math.max(33, r * 1.42 + 16.5 * scale);
        const bowDist = r + bowSize * 0.18;
        const bx = cx + Math.cos(angle) * bowDist;
        const by = cy + Math.sin(angle) * bowDist;

        if (R.drawAimedSprite(ctx, bowKey, bx, by, angle, bowSize)) {
            // Unloaded sprite has no arrow — draw one nocked along the fire direction.
            if (bowKey === 'bow') {
                const arrowSize = bowSize * 0.92;
                const arrowDist = r + arrowSize * 0.28;
                R.drawAimedSprite(
                    ctx,
                    'arrow',
                    cx + Math.cos(angle) * arrowDist,
                    cy + Math.sin(angle) * arrowDist,
                    angle,
                    arrowSize,
                );
            }
            return;
        }

        // Fallback vector longbow if sprites haven't loaded yet.
        const halfH = r * 0.92;
        const stringX = r + Math.max(5, 6 * scale);
        const bellyX = stringX + Math.max(10, 12 * scale);
        const limbW = Math.max(3.4, 4.2 * dpr);
        const nockX = stringX - Math.max(2, 2.5 * dpr);
        const arrowTip = bellyX + r * 0.35;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.strokeStyle = '#2a1a0c';
        ctx.lineWidth = limbW + 1.8;
        ctx.beginPath();
        ctx.moveTo(stringX, -halfH);
        ctx.quadraticCurveTo(bellyX, 0, stringX, halfH);
        ctx.stroke();

        ctx.strokeStyle = '#7a5230';
        ctx.lineWidth = limbW;
        ctx.beginPath();
        ctx.moveTo(stringX, -halfH);
        ctx.quadraticCurveTo(bellyX, 0, stringX, halfH);
        ctx.stroke();

        ctx.strokeStyle = '#e8e0d4';
        ctx.lineWidth = Math.max(1.3, 1.6 * dpr);
        ctx.beginPath();
        ctx.moveTo(stringX, -halfH);
        ctx.lineTo(stringX, halfH);
        ctx.stroke();

        drawRadialArrow(ctx, nockX, arrowTip, dpr, ball.color || '#c4a574');
        ctx.restore();
    }

    function drawFlightArrow(ctx, arrow, scale, dpr) {
        const cx = R.offsetXFromSim(arrow.x, scale);
        const cy = R.offsetYFromSim(arrow.y, scale);
        const len = (arrow.length ?? 34) * scale;
        const angle = arrow.angle ?? Math.atan2(arrow.vy || 0, arrow.vx || 0);
        const size = Math.max(20, len * 1.25);

        if (R.drawAimedSprite(ctx, 'arrow', cx, cy, angle, size)) return;

        const half = len * 0.5;
        const head = Math.max(6, 7 * dpr);
        const halfHead = Math.max(3.2, 3.8 * dpr);
        const color = arrow.color || '#c4a574';

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.lineCap = 'round';

        ctx.strokeStyle = '#1a1008';
        ctx.lineWidth = Math.max(2.4, 2.8 * dpr);
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(half - head * 0.35, 0);
        ctx.stroke();

        ctx.strokeStyle = '#6b4a2e';
        ctx.lineWidth = Math.max(1.6, 2 * dpr);
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(half - head * 0.35, 0);
        ctx.stroke();

        ctx.fillStyle = R.shadeHex(color, 0.15);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1, 1.2 * dpr);
        ctx.beginPath();
        ctx.moveTo(half, 0);
        ctx.lineTo(half - head, -halfHead);
        ctx.lineTo(half - head, halfHead);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = R.shadeHex(color, 0.4);
        ctx.lineWidth = Math.max(1.2, 1.5 * dpr);
        ctx.beginPath();
        ctx.moveTo(-half, -halfHead * 0.85);
        ctx.lineTo(-half + head * 0.55, 0);
        ctx.lineTo(-half, halfHead * 0.85);
        ctx.stroke();

        ctx.restore();
    }

    function drawNockedBall(ctx, x, y, dpr, color) {
        const r = Math.max(3.5, 4.5 * dpr);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color || '#111';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(1.2, 1.5 * dpr);
        ctx.stroke();
    }

    function drawProjectileArrow(ctx, arrow, scale, dpr) {
        const cx = R.offsetXFromSim(arrow.x, scale);
        const cy = R.offsetYFromSim(arrow.y, scale);
        const ballR = (arrow.radius ?? 7.5) * scale;
        const helpers = {
            cx,
            cy,
            ballR,
            scale,
            dpr,
            drawBasketball,
            drawSlingshotProjectile,
            drawGrenade,
            drawPlasmaOrb,
            drawFlightArrow,
            drawBoomerang,
            drawLightningBolt: R.drawLightningBolt,
            drawBat: R.drawBat,
        };
        const custom = window.PremadeWeaponRegistry?.getProjectileDraw?.(arrow.kind);
        if (custom) {
            custom(ctx, arrow, helpers);
            return;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, ballR, 0, Math.PI * 2);
        ctx.fillStyle = arrow.color || '#111';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(1.5, 2 * dpr);
        ctx.stroke();
    }

    /** Fighter-colored slingshot ammo (Minecraft snowball sprite, tinted). */
    function drawSlingshotProjectile(ctx, cx, cy, r, dpr, color, spin = 0) {
        const size = Math.max(14, r * 2.2);
        if (R.drawTintedCenteredSprite(ctx, 'slingshotProjectile', cx, cy, size, color || '#888', spin)) {
            return;
        }
        drawNockedBall(ctx, cx, cy, dpr, color || '#888');
    }

    /** Fighter-colored basketball with classic seam lines. */
    function drawBasketball(ctx, cx, cy, r, dpr, color, spin = 0) {
        if (R.drawCenteredSprite(ctx, 'basketball', cx, cy, r * 2.15, spin)) return;

        const core = color || '#c45c14';
        const seam = R.shadeHex(core, -0.55);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.4, 1.8 * dpr);
        ctx.stroke();

        ctx.strokeStyle = seam;
        ctx.lineWidth = Math.max(1.1, 1.35 * dpr);
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(0, -r * 0.92);
        ctx.lineTo(0, r * 0.92);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-r * 0.92, 0);
        ctx.lineTo(r * 0.92, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.55, r * 0.92, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = R.shadeHex(core, 0.45);
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(-r * 0.28, -r * 0.3, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawGrenade(ctx, cx, cy, r, dpr, color, spin = 0) {
        const size = Math.max(18, r * 2.7);
        if (R.drawAimedSprite(ctx, 'grenade', cx, cy, spin, size)) return;

        const body = color || '#3f6b3a';
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.4, 1.8 * dpr);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.92, r * 0.28, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1, 1.2 * dpr);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -r * 0.75);
        ctx.lineTo(0, -r * 1.25);
        ctx.strokeStyle = '#5c4030';
        ctx.lineWidth = Math.max(1.5, 2 * dpr);
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -r * 1.28, Math.max(1.6, 2 * dpr), 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.restore();
    }

    function drawPlasmaOrb(ctx, cx, cy, r, dpr, color) {
        const core = color || '#888';
        const stroke = R.shadeHex(core, -0.45);
        const shine = R.shadeHex(core, 0.55);
        ctx.save();

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1.2, 1.5 * dpr);
        ctx.stroke();

        ctx.fillStyle = shine;
        ctx.beginPath();
        ctx.arc(cx - r * 0.28, cy - r * 0.3, r * 0.42, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx - r * 0.18, cy - r * 0.2, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /** Classic L-shaped returning blade. */
    function drawBoomerang(ctx, cx, cy, r, dpr, color, spin = 0) {
        const body = color || '#c4a35a';
        const edge = R.shadeHex(body, -0.45);
        const arm = Math.max(10, r * 2.1);
        const thick = Math.max(3.2, r * 0.55);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-arm * 0.15, -thick * 0.2);
        ctx.lineTo(arm, -thick * 0.35);
        ctx.quadraticCurveTo(arm + thick * 0.6, 0, arm, thick * 0.55);
        ctx.lineTo(thick * 0.35, thick * 0.45);
        ctx.lineTo(thick * 0.45, arm);
        ctx.quadraticCurveTo(0, arm + thick * 0.55, -thick * 0.35, arm);
        ctx.lineTo(-thick * 0.2, -arm * 0.1);
        ctx.closePath();
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.6, 1.8 * dpr);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(arm * 0.25, 0);
        ctx.lineTo(arm * 0.85, -thick * 0.05);
        ctx.moveTo(0, thick * 0.35);
        ctx.lineTo(thick * 0.05, arm * 0.85);
        ctx.strokeStyle = edge;
        ctx.lineWidth = Math.max(1.2, 1.3 * dpr);
        ctx.stroke();
        ctx.restore();
    }

    function drawBoomerangHeld(ctx, ball, cx, cy, r, dpr, show = true) {
        if (!show) return;
        const ang = ball.weaponAngle ?? 0;
        const dist = r + Math.max(10, r * 0.35);
        const bx = cx + Math.cos(ang) * dist;
        const by = cy + Math.sin(ang) * dist;
        drawBoomerang(ctx, bx, by, Math.max(5, r * 0.28), dpr, ball.color, ang + Math.PI * 0.35);
    }

    function drawLaser(ctx, x1, y1, x2, y2, scale, dpr, widthScale = 1, color = '#ff3344') {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return;

        const coreW = Math.max(1.8, 2.2 * dpr) * widthScale;
        const glowW = coreW * 3.2;

        ctx.save();
        ctx.translate(x1, y1);
        ctx.rotate(angle);
        ctx.lineCap = 'round';

        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = color || '#ff3344';
        ctx.lineWidth = glowW * 1.6;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();

        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color || '#ff3344';
        ctx.lineWidth = glowW;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff8f0';
        ctx.lineWidth = coreW;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();

        ctx.fillStyle = color || '#ff3344';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(3, 3.5 * dpr) * widthScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1.2, 1.4 * dpr), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawArrows(ctx, sim, scale, dpr) {
        if (!sim.arrows?.length) return;
        for (const arrow of sim.arrows) {
            drawProjectileArrow(ctx, arrow, scale, dpr);
        }
    }

    R.drawBow = drawBow;
    R.drawLongbow = drawLongbow;
    R.drawFlightArrow = drawFlightArrow;
    R.drawProjectileArrow = drawProjectileArrow;
    R.drawSlingshotProjectile = drawSlingshotProjectile;
    R.drawBasketball = drawBasketball;
    R.drawGrenade = drawGrenade;
    R.drawPlasmaOrb = drawPlasmaOrb;
    R.drawBoomerang = drawBoomerang;
    R.drawBoomerangHeld = drawBoomerangHeld;
    R.drawLaser = drawLaser;
    R.drawArrows = drawArrows;
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
