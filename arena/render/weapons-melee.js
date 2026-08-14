/**
 * Melee weapon draws: sword, hammer, staff, fists, spikes, shield, bat, broom.
 * Extends window.ArenaRenderParts
 */
(function (R) {
    'use strict';

    function drawSpikes(ctx, ball, cx, cy, r, dpr) {
        const count = ball.spikeCount || 10;
        const spikeLen = (ball.spikeLength || 12) * (r / ball.radius);
        const baseR = r + 2 * (r / ball.radius);
        const angleOffset = ball.weaponAngle ?? 0;
        const spikeW = Math.max(4, 5 * dpr);

        ctx.save();
        ctx.fillStyle = '#9ca3af';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1, 1.5 * dpr);

        for (let i = 0; i < count; i++) {
            const angle = angleOffset + (i / count) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const bx = cx + baseR * cos;
            const by = cy + baseR * sin;
            R.drawTriangleSpike(ctx, bx, by, cos, sin, spikeLen, spikeW);
        }

        ctx.restore();
    }

    function drawFists(ctx, ball, cx, cy, r, dpr) {
        const scaleR = r / Math.max(1, ball.radius);
        const reach = (ball.swordLength || 58) * scaleR;
        const baseR = r + 2 * scaleR;
        const idle = 3 * scaleR;
        const angleOffset = ball.weaponAngle ?? 0;
        const exts = ball._fistExt || [0, 0];
        const widthScale = ball.bladeWidthScale ?? 1;
        const gloveW = Math.max(12, 13.5 * dpr) * widthScale;
        const gloveH = gloveW * 1.22;
        const baseColor = ball.color || '#c62828';
        const gloveIdle = R.shadeHex(baseColor, -0.12);
        const glovePunch = R.shadeHex(baseColor, 0.18);
        const knuckleIdle = R.shadeHex(baseColor, 0.08);
        const knucklePunch = R.shadeHex(baseColor, 0.32);
        const cuff = R.shadeHex(baseColor, -0.38);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 0; i < 2; i++) {
            const e = exts[i] || 0;
            const angle = angleOffset + i * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const dist = baseR + idle + reach * e;
            const fx = cx + dist * cos;
            const fy = cy + dist * sin;

            if (e > 0.05) {
                const armFrom = baseR + idle * 0.25;
                const ax0 = cx + armFrom * cos;
                const ay0 = cy + armFrom * sin;
                const ax1 = fx - cos * gloveH * 0.4;
                const ay1 = fy - sin * gloveH * 0.4;
                const armOutline = Math.max(9.5, 10.5 * dpr) * widthScale;
                const armFill = Math.max(6.5, 7.5 * dpr) * widthScale;
                ctx.strokeStyle = '#111';
                ctx.lineWidth = armOutline;
                ctx.beginPath();
                ctx.moveTo(ax0, ay0);
                ctx.lineTo(ax1, ay1);
                ctx.stroke();
                ctx.strokeStyle = '#e8b896';
                ctx.lineWidth = armFill;
                ctx.beginPath();
                ctx.moveTo(ax0, ay0);
                ctx.lineTo(ax1, ay1);
                ctx.stroke();
            }

            ctx.save();
            ctx.translate(fx, fy);
            ctx.rotate(angle);

            const punch = e > 0.55;
            ctx.fillStyle = punch ? glovePunch : gloveIdle;
            ctx.strokeStyle = '#111';
            ctx.lineWidth = Math.max(1.8, 2 * dpr);

            ctx.beginPath();
            ctx.roundRect(-gloveH * 0.2, -gloveW * 0.5, gloveH * 1.05, gloveW, gloveW * 0.38);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = punch ? knucklePunch : knuckleIdle;
            ctx.beginPath();
            ctx.roundRect(gloveH * 0.4, -gloveW * 0.44, gloveH * 0.42, gloveW * 0.88, gloveW * 0.3);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = cuff;
            ctx.beginPath();
            ctx.roundRect(-gloveH * 0.22, -gloveW * 0.38, gloveH * 0.28, gloveW * 0.76, gloveW * 0.2);
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = Math.max(1.2, 1.4 * dpr);
            for (let k = -1; k <= 1; k++) {
                const ky = k * gloveW * 0.2;
                ctx.beginPath();
                ctx.moveTo(gloveH * 0.48, ky);
                ctx.lineTo(gloveH * 0.72, ky);
                ctx.stroke();
            }

            ctx.restore();
        }

        ctx.restore();
    }

    function drawStaff(ctx, x1, y1, x2, y2, scale, dpr, widthScale = 1, charge = 0, color = '#888') {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return;

        // Corner-to-corner staff art; pin the butt at the ball edge (x1, y1).
        const size = (len / Math.SQRT2) * Math.max(0.85, Math.min(1.35, widthScale));
        if (R.drawAimedSpriteFromBase(ctx, 'staff', x1, y1, angle, size)) return;

        const shaftW = Math.max(3.5, 4.5 * dpr) * widthScale;
        const tipR = Math.max(4.5, 5.5 * dpr) * widthScale;
        const shaftLen = Math.max(0, len - tipR * 0.55);
        const t = Math.max(0, Math.min(1, charge));
        const core = color || '#888';
        const lit = R.shadeHex(core, 0.35);
        const stroke = R.shadeHex(core, -0.45);
        const shine = R.shadeHex(core, 0.6);

        ctx.save();
        ctx.translate(x1, y1);
        ctx.rotate(angle);

        ctx.fillStyle = '#5c3a1e';
        ctx.strokeStyle = '#1a1008';
        ctx.lineWidth = Math.max(1.2, 1.4 * dpr);
        ctx.fillRect(0, -shaftW * 0.45, shaftLen, shaftW * 0.9);
        ctx.strokeRect(0, -shaftW * 0.45, shaftLen, shaftW * 0.9);

        ctx.fillStyle = '#7a5230';
        ctx.fillRect(shaftLen * 0.08, -shaftW * 0.22, shaftLen * 0.18, shaftW * 0.44);

        const orbX = len;
        ctx.beginPath();
        ctx.arc(orbX, 0, tipR, 0, Math.PI * 2);
        ctx.fillStyle = t > 0.7 ? lit : core;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1.2, 1.4 * dpr);
        ctx.stroke();

        ctx.fillStyle = shine;
        ctx.beginPath();
        ctx.arc(orbX - tipR * 0.25, -tipR * 0.25, tipR * 0.32, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawShield(ctx, ball, cx, cy, r, dpr) {
        const angle = ball.weaponAngle ?? 0;
        const scaleR = r / Math.max(1, ball.radius);
        const thickness = Math.max(5, (ball.swordLength || 10) * scaleR) * (ball.bladeWidthScale || 1);
        const innerR = r + 2 * scaleR;
        const outerR = innerR + thickness;
        const halfSpan = Math.PI / 4;
        const start = angle - halfSpan;
        const end = angle + halfSpan;
        const face = '#8b5a2b';
        const rim = '#5c3a1e';
        const highlight = '#c4a574';

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const innerStart = end - 0.04;
        const innerEnd = start + 0.04;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, start, end, false);
        ctx.arc(cx, cy, innerR, innerStart, innerEnd, true);
        ctx.closePath();
        ctx.fillStyle = face;
        ctx.fill();
        ctx.strokeStyle = '#1a1008';
        ctx.lineWidth = Math.max(2, 2.2 * dpr);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, innerR + thickness * 0.38, start + 0.08, end - 0.08, false);
        ctx.strokeStyle = rim;
        ctx.lineWidth = Math.max(2, 2.4 * dpr);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, innerR + thickness * 0.62, start + 0.14, end - 0.14, false);
        ctx.strokeStyle = highlight;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(1.4, 1.6 * dpr);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const tipR = Math.max(2.2, thickness * 0.26);
        for (const tipAngle of [start, end]) {
            const tx = cx + (innerR + thickness * 0.5) * Math.cos(tipAngle);
            const ty = cy + (innerR + thickness * 0.5) * Math.sin(tipAngle);
            ctx.beginPath();
            ctx.arc(tx, ty, tipR, 0, Math.PI * 2);
            ctx.fillStyle = face;
            ctx.fill();
            ctx.strokeStyle = '#1a1008';
            ctx.lineWidth = Math.max(1.3, 1.5 * dpr);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawBat(ctx, cx, cy, r, dpr, color, flap = 0, angle = 0) {
        const body = color || '#2a1a14';
        const wing = R.shadeHex(body, 0.18);
        const wingSpan = Math.max(10, r * 2.4);
        const open = 0.55 + 0.45 * Math.abs(Math.sin(flap));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Wings
        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(side * wingSpan * 0.45, -r * open * 1.1, side * wingSpan, -r * 0.15);
            ctx.quadraticCurveTo(side * wingSpan * 0.55, r * 0.35 * open, 0, r * 0.15);
            ctx.closePath();
            ctx.fillStyle = wing;
            ctx.fill();
            ctx.strokeStyle = '#0a0604';
            ctx.lineWidth = Math.max(1.1, 1.2 * dpr);
            ctx.stroke();
        }

        // Body
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(2.4, r * 0.55), Math.max(3.2, r * 0.85), 0, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = '#0a0604';
        ctx.lineWidth = Math.max(1.1, 1.2 * dpr);
        ctx.stroke();

        // Ears
        ctx.beginPath();
        ctx.moveTo(-r * 0.25, -r * 0.55);
        ctx.lineTo(-r * 0.08, -r * 1.15);
        ctx.lineTo(0, -r * 0.5);
        ctx.moveTo(r * 0.25, -r * 0.55);
        ctx.lineTo(r * 0.08, -r * 1.15);
        ctx.lineTo(0, -r * 0.5);
        ctx.strokeStyle = body;
        ctx.lineWidth = Math.max(1.4, 1.5 * dpr);
        ctx.stroke();

        ctx.restore();
    }

    function drawWitchBroom(ctx, x1, y1, x2, y2, scale, dpr, color = '#888') {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;
        const shaftW = Math.max(2.4, 3 * dpr);
        const brushLen = Math.min(len * 0.42, Math.max(13, 17 * dpr));
        const brushHalfW = Math.max(6, 8 * dpr);
        const brushBaseX = x2 - ux * brushLen;
        const brushBaseY = y2 - uy * brushLen;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Crooked wooden broom handle.
        ctx.strokeStyle = '#1a1008';
        ctx.lineWidth = shaftW + Math.max(1.2, 1.4 * dpr);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(brushBaseX + ux * 2, brushBaseY + uy * 2);
        ctx.stroke();
        ctx.strokeStyle = '#704521';
        ctx.lineWidth = shaftW;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(brushBaseX + ux * 2, brushBaseY + uy * 2);
        ctx.stroke();

        // Binding around the base of the straw.
        ctx.beginPath();
        ctx.moveTo(brushBaseX - nx * brushHalfW * 0.58, brushBaseY - ny * brushHalfW * 0.58);
        ctx.lineTo(brushBaseX + nx * brushHalfW * 0.58, brushBaseY + ny * brushHalfW * 0.58);
        ctx.strokeStyle = color || '#7c3aed';
        ctx.lineWidth = Math.max(3, 3.5 * dpr);
        ctx.stroke();

        // Fan of straw bristles.
        const bristles = 9;
        for (let i = 0; i < bristles; i++) {
            const t = i / (bristles - 1) - 0.5;
            const rootX = brushBaseX + nx * t * brushHalfW;
            const rootY = brushBaseY + ny * t * brushHalfW;
            const tipSpread = t * brushHalfW * 1.5;
            const tipX = x2 + nx * tipSpread;
            const tipY = y2 + ny * tipSpread;
            ctx.beginPath();
            ctx.moveTo(rootX, rootY);
            ctx.lineTo(tipX, tipY);
            ctx.strokeStyle = i % 2 ? '#b47a32' : '#d2a24f';
            ctx.lineWidth = Math.max(1.3, 1.5 * dpr);
            ctx.stroke();
        }

        // Dark outline across the brush edge.
        ctx.beginPath();
        ctx.moveTo(x2 - nx * brushHalfW * 0.75, y2 - ny * brushHalfW * 0.75);
        ctx.lineTo(x2 + nx * brushHalfW * 0.75, y2 + ny * brushHalfW * 0.75);
        ctx.strokeStyle = '#3b2410';
        ctx.lineWidth = Math.max(1, 1.2 * dpr);
        ctx.stroke();

        ctx.restore();
    }

    function drawHammer(ctx, x1, y1, x2, y2, scale, dpr, widthScale = 1, charge = 1) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return;

        if (R.bladeSpriteDraw(ctx, 'hammer', x1, y1, x2, y2, dpr)) return;

        const handleW = Math.max(4, 5 * dpr) * widthScale;
        const t = Math.max(0, Math.min(1, charge));
        const headW = handleW * (2.2 + t * 1.1);
        const headH = handleW * (1.6 + t * 0.9);
        const handleLen = len * 0.72;

        ctx.save();
        ctx.translate(x1, y1);
        ctx.rotate(angle);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr);

        ctx.fillStyle = '#6b4423';
        ctx.fillRect(0, -handleW * 0.4, handleLen, handleW * 0.8);
        ctx.strokeRect(0, -handleW * 0.4, handleLen, handleW * 0.8);

        const hx = handleLen - headH * 0.15;
        ctx.fillStyle = t > 0.75 ? '#9aa3ad' : '#7a828c';
        ctx.fillRect(hx, -headW * 0.5, headH, headW);
        ctx.strokeRect(hx, -headW * 0.5, headH, headW);

        ctx.fillStyle = '#4a5560';
        ctx.fillRect(hx + headH * 0.15, -headW * 0.35, headH * 0.7, headW * 0.7);

        ctx.restore();
    }

    function drawSword(ctx, x1, y1, x2, y2, scale, dpr, widthScale = 1) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return;

        if (R.bladeSpriteDraw(ctx, 'sword', x1, y1, x2, y2, dpr)) return;

        const bladeW = Math.max(5, 6.5 * dpr) * widthScale;
        ctx.save();
        ctx.translate(x1, y1);
        ctx.rotate(angle);

        ctx.fillStyle = '#8b6914';
        const guardT = bladeW * 0.45;
        ctx.fillRect(0, -bladeW * 0.55, guardT, bladeW * 1.1);
        ctx.strokeRect(0, -bladeW * 0.55, guardT, bladeW * 1.1);

        ctx.fillStyle = '#c0c0c0';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
        ctx.beginPath();
        ctx.moveTo(guardT, -bladeW * 0.35);
        ctx.lineTo(len, -bladeW * 0.15);
        ctx.lineTo(len + bladeW * 0.6, 0);
        ctx.lineTo(len, bladeW * 0.15);
        ctx.lineTo(guardT, bladeW * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    R.drawSpikes = drawSpikes;
    R.drawFists = drawFists;
    R.drawStaff = drawStaff;
    R.drawShield = drawShield;
    R.drawBat = drawBat;
    R.drawWitchBroom = drawWitchBroom;
    R.drawHammer = drawHammer;
    R.drawSword = drawSword;
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
