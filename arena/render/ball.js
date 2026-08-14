/**
 * Ball drawing: health pie skin, enchant glint, labels, drawBallAt.
 * Extends window.ArenaRenderParts
 */
(function (R) {
    'use strict';

    const DEFAULT_FONT = 'Bebas Neue';

    function canvasFontFamily(name) {
        return `"${name || DEFAULT_FONT}", sans-serif`;
    }

    function ballFont(ball) {
        return canvasFontFamily(ball.displayFont);
    }

    function measureTextBlock(ctx, text, fontSize, fontFamily) {
        ctx.font = `700 ${fontSize}px ${fontFamily}`;
        const metrics = ctx.measureText(text);
        const width = metrics.width;
        let height = fontSize;
        if (metrics.actualBoundingBoxAscent != null && metrics.actualBoundingBoxDescent != null) {
            height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        }
        return { width, height };
    }

    /** Largest font size so text fits inside the ball circle. */
    function fitHealthFontSize(ctx, text, radius, fontFamily) {
        const maxW = radius * 1.55;
        const maxH = radius * 1.35;
        const minSize = 5;
        let lo = minSize;
        let hi = Math.max(minSize, Math.floor(maxH));
        let best = minSize;

        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const { width, height } = measureTextBlock(ctx, text, mid, fontFamily);
            if (width <= maxW && height <= maxH) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return best;
    }

    function drawHealthPieSkin(ctx, cx, cy, r, ball, skinImg) {
        const fraction = Math.max(0, Math.min(1, ball.healthFraction?.() ?? 1));
        const fillColor = ball.color || '#888';
        const fullHealth = fraction >= 0.999;
        const start = -Math.PI / 2;
        const end = start + fraction * Math.PI * 2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();

        if (skinImg) {
            ctx.globalAlpha = 0.22;
            ctx.drawImage(skinImg, cx - r, cy - r, r * 2, r * 2);
            ctx.globalAlpha = 1;

            if (fullHealth) {
                ctx.drawImage(skinImg, cx - r, cy - r, r * 2, r * 2);
            } else if (fraction > 0.001) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, r, start, end);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(skinImg, cx - r, cy - r, r * 2, r * 2);
                ctx.restore();
            }
        } else {
            ctx.fillStyle = fillColor;
            ctx.globalAlpha = 0.22;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            ctx.globalAlpha = 1;
            if (fullHealth) {
                ctx.fillStyle = fillColor;
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            } else if (fraction > 0.001) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, r, start, end);
                ctx.closePath();
                ctx.clip();
                ctx.fillStyle = fillColor;
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
                ctx.restore();
            }
        }

        // Radial pie cuts — skins need these; solid colors read without them, but
        // draw either way so depleted health always has a clear black divider.
        if (!fullHealth && fraction > 0.001) {
            const cut = Math.max(1.5, r * 0.06);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = cut;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(end) * r, cy + Math.sin(end) * r);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Minecraft-style enchanted glint — scrolling diagonal sheen clipped to the ball.
     * Solid balls use additive glow; skins use soft-light so faces/textures aren't washed out.
     * @param {number} timeSec sim clock (deterministic for recordings)
     * @param {{ soft?: boolean }} [opts]
     */
    function drawEnchantGlint(ctx, cx, cy, r, timeSec, opts = {}) {
        if (!(r > 2)) return;
        const soft = Boolean(opts.soft);
        const cycle = 2.15;
        const t = (((Number(timeSec) || 0) % cycle) + cycle) % cycle / cycle;
        const period = r * 3.1;
        const bandW = period * 0.3;
        const offset = t * period * 1.4;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, r - 0.75), 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 4);
        // Additive looks great on flat colors; on skins it blooms and muddies the art.
        ctx.globalCompositeOperation = soft ? 'soft-light' : 'lighter';

        for (let i = -3; i <= 3; i++) {
            const x0 = -period * 1.4 + i * (bandW * 1.75) + offset;
            const g = ctx.createLinearGradient(x0, 0, x0 + bandW, 0);
            if (soft) {
                g.addColorStop(0, 'rgba(120, 40, 210, 0)');
                g.addColorStop(0.32, 'rgba(160, 100, 255, 0.28)');
                g.addColorStop(0.5, 'rgba(255, 255, 255, 0.42)');
                g.addColorStop(0.68, 'rgba(160, 100, 255, 0.28)');
                g.addColorStop(1, 'rgba(120, 40, 210, 0)');
            } else {
                g.addColorStop(0, 'rgba(120, 40, 210, 0)');
                g.addColorStop(0.32, 'rgba(170, 90, 255, 0.16)');
                g.addColorStop(0.5, 'rgba(255, 255, 255, 0.34)');
                g.addColorStop(0.68, 'rgba(170, 90, 255, 0.16)');
                g.addColorStop(1, 'rgba(120, 40, 210, 0)');
            }
            ctx.fillStyle = g;
            ctx.fillRect(x0, -r * 1.7, bandW, r * 3.4);
        }
        ctx.restore();
    }

    function drawBall(ctx, ball, cx, cy, r, scale, dpr, weaponMode, timeSec = 0) {
        const fontFamily = ballFont(ball);
        const ballStroke = Math.max(2, 2.5 * dpr);
        const skinImg = ball.skinId && window.BallSkins
            ? window.BallSkins.getSkinImage(ball.skinId)
            : null;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);

        if (weaponMode) {
            drawHealthPieSkin(ctx, cx, cy, r, ball, skinImg);
        } else if (skinImg) {
            ctx.save();
            ctx.clip();
            ctx.drawImage(skinImg, cx - r, cy - r, r * 2, r * 2);
            ctx.restore();
        } else {
            ctx.fillStyle = ball.color;
            ctx.fill();
        }

        if (ball.powerupId) {
            drawEnchantGlint(ctx, cx, cy, r, timeSec, { soft: Boolean(skinImg) });
        }

        // Health pie / glint replace the path — rebuild the rim before stroking.
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = ballStroke;
        ctx.stroke();

        const flash = Number(ball.hitFlash) || 0;
        if (flash > 0) {
            const alpha = Math.min(0.45, flash / 0.09) * 0.4;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.fill();
        }

        ctx.restore();

        if (ball.weaponBehavior?.draw) {
            ball.weaponBehavior.draw(ctx, ball, {
                cx,
                cy,
                r,
                scale,
                dpr,
                toX: (x) => R.offsetXFromSim(x, scale),
                toY: (y) => R.offsetYFromSim(y, scale),
                drawSword: R.drawSword,
                drawHammer: R.drawHammer,
                drawLaser: R.drawLaser,
                drawSpikes: R.drawSpikes,
                drawBow: R.drawBow,
                drawLongbow: R.drawLongbow,
                drawFists: R.drawFists,
                drawStaff: R.drawStaff,
                drawShield: R.drawShield,
                drawBasketball: R.drawBasketball,
                drawSlingshotProjectile: R.drawSlingshotProjectile,
                drawGrenade: R.drawGrenade,
                drawPlasmaOrb: R.drawPlasmaOrb,
                drawFlightArrow: R.drawFlightArrow,
                drawBoomerang: R.drawBoomerang,
                drawBoomerangHeld: R.drawBoomerangHeld,
                drawLightningBolt: R.drawLightningBolt,
                drawBat: R.drawBat,
                drawWitchBroom: R.drawWitchBroom,
            });
        } else if (ball.weaponKind !== 'none' && ball.getSwordSegment) {
            const seg = ball.getSwordSegment();
            const x1 = R.offsetXFromSim(seg.x1, scale);
            const y1 = R.offsetYFromSim(seg.y1, scale);
            const x2 = R.offsetXFromSim(seg.x2, scale);
            const y2 = R.offsetYFromSim(seg.y2, scale);
            R.drawSword(ctx, x1, y1, x2, y2, scale, dpr, ball.bladeWidthScale ?? 1);
        }

        if (!weaponMode) {
            const hp = ball.centerLabel || String(ball.health);
            const fontSize = fitHealthFontSize(ctx, hp, r, fontFamily);
            ctx.fillStyle = '#000';
            ctx.font = `700 ${fontSize}px ${fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = Math.max(2, 2 * dpr);
            ctx.strokeText(hp, cx, cy);
            ctx.fillText(hp, cx, cy);
        }
    }

    function drawBallAt(ctx, ball, cx, cy, pixelRadius, dpr, weaponMode) {
        const prevOx = R.offsetXFromSim;
        const prevOy = R.offsetYFromSim;
        const prevX = ball.x;
        const prevY = ball.y;
        const prevR = ball.radius;

        R.offsetXFromSim = (x) => x;
        R.offsetYFromSim = (y) => y;
        ball.x = cx;
        ball.y = cy;
        ball.radius = pixelRadius;

        drawBall(ctx, ball, cx, cy, pixelRadius, 1, dpr, weaponMode, performance.now() / 1000);

        ball.x = prevX;
        ball.y = prevY;
        ball.radius = prevR;
        R.offsetXFromSim = prevOx;
        R.offsetYFromSim = prevOy;
    }

    function drawBallLabel(ctx, text, cx, cy, radius, fontFamily, dpr) {
        const family = canvasFontFamily(fontFamily);
        const fontSize = fitHealthFontSize(ctx, text, radius, family);
        ctx.fillStyle = '#000';
        ctx.font = `700 ${fontSize}px ${family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(2, 2 * dpr);
        ctx.strokeText(text, cx, cy);
        ctx.fillText(text, cx, cy);
    }

    R.DEFAULT_FONT = DEFAULT_FONT;
    R.canvasFontFamily = canvasFontFamily;
    R.fitHealthFontSize = fitHealthFontSize;
    R.drawBall = drawBall;
    R.drawBallAt = drawBallAt;
    R.drawBallLabel = drawBallLabel;
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
