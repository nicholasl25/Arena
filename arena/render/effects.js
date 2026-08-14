/**
 * FX: lightning bolts/impacts, explosions, damage popups, projectile shreds, webs.
 * Extends window.ArenaRenderParts
 */
(function (R) {
    'use strict';

    /** Chunky Zeus-style lightning bolt, used both held and in flight. */
    function drawLightningBolt(ctx, cx, cy, size, dpr, angle = 0, color = '#facc15') {
        const core = color || '#facc15';
        const bright = R.shadeHex(core, 0.58);
        const edge = R.shadeHex(core, -0.62);
        const length = Math.max(15, size * 2.7);
        const halfH = Math.max(5, size * 0.72);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.lineJoin = 'round';

        ctx.shadowColor = bright;
        ctx.shadowBlur = Math.max(5, 7 * dpr);
        ctx.beginPath();
        ctx.moveTo(-length * 0.55, -halfH * 0.38);
        ctx.lineTo(-length * 0.08, -halfH * 0.38);
        ctx.lineTo(-length * 0.2, -halfH);
        ctx.lineTo(length * 0.58, halfH * 0.05);
        ctx.lineTo(length * 0.08, halfH * 0.05);
        ctx.lineTo(length * 0.2, halfH);
        ctx.closePath();
        ctx.fillStyle = core;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = edge;
        ctx.lineWidth = Math.max(1.5, 1.8 * dpr);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-length * 0.35, -halfH * 0.18);
        ctx.lineTo(-length * 0.04, -halfH * 0.18);
        ctx.lineTo(length * 0.23, halfH * 0.12);
        ctx.strokeStyle = bright;
        ctx.lineWidth = Math.max(1.2, 1.4 * dpr);
        ctx.stroke();
        ctx.restore();
    }

    function drawLightningBolts(ctx, sim, scale, dpr) {
        if (!sim.lightningBolts?.length) return;
        for (const bolt of sim.lightningBolts) {
            const alpha = Math.max(0, Math.min(1, bolt.ttl / (bolt.maxTtl || 0.2)));
            const x1 = R.offsetXFromSim(bolt.x1, scale);
            const y1 = R.offsetYFromSim(bolt.y1, scale);
            const x2 = R.offsetXFromSim(bolt.x2, scale);
            const y2 = R.offsetYFromSim(bolt.y2, scale);
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const segs = 5;
            let seed = bolt.seed || 1;
            const rand = () => {
                seed = (seed * 16807) % 2147483647;
                return (seed & 0xffff) / 0xffff;
            };

            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = bolt.color || '#7dd3fc';
            ctx.lineWidth = Math.max(2.2, 2.6 * dpr);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            for (let i = 1; i < segs; i++) {
                const t = i / segs;
                const wobble = (rand() - 0.5) * 18 * dpr * (1 - Math.abs(0.5 - t) * 1.2);
                ctx.lineTo(x1 + dx * t + nx * wobble, y1 + dy * t + ny * wobble);
            }
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = Math.max(1, 1.1 * dpr);
            ctx.globalAlpha = alpha * 0.85;
            ctx.stroke();
            ctx.restore();
        }
    }

    /** High-contrast hit-stop frame: white silhouette, black ring, and sharp zap rays. */
    function drawLightningImpacts(ctx, sim, scale, dpr) {
        if (!sim.lightningImpacts?.length) return;
        for (const impact of sim.lightningImpacts) {
            const progress = 1 - impact.ttl / (impact.maxTtl || 0.11);
            const alpha = Math.max(0, Math.min(1, impact.ttl / 0.05));
            const cx = R.offsetXFromSim(impact.x, scale);
            const cy = R.offsetYFromSim(impact.y, scale);
            const radius = impact.radius * scale;
            const rayInner = radius * (0.75 + progress * 0.15);
            const rayOuter = radius * (1.45 + progress * 0.55);
            const rays = 12;

            ctx.save();
            ctx.globalAlpha = alpha;

            ctx.beginPath();
            ctx.arc(cx, cy, radius * 1.08, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#090909';
            ctx.lineWidth = Math.max(3, 4 * dpr);
            ctx.stroke();

            ctx.lineCap = 'round';
            for (let i = 0; i < rays; i++) {
                const angle = (i / rays) * Math.PI * 2 + (impact.seed || 0);
                const stagger = i % 2 ? 0.72 : 1;
                ctx.beginPath();
                ctx.moveTo(
                    cx + Math.cos(angle) * rayInner,
                    cy + Math.sin(angle) * rayInner,
                );
                ctx.lineTo(
                    cx + Math.cos(angle) * rayOuter * stagger,
                    cy + Math.sin(angle) * rayOuter * stagger,
                );
                ctx.strokeStyle = i % 3 === 0
                    ? (impact.color || '#facc15')
                    : '#111';
                ctx.lineWidth = i % 3 === 0
                    ? Math.max(2, 2.5 * dpr)
                    : Math.max(1.4, 1.8 * dpr);
                ctx.stroke();
            }

            ctx.restore();
        }
    }

    function drawExplosions(ctx, sim, scale, dpr) {
        if (!sim.explosions?.length) return;
        for (const blast of sim.explosions) {
            const progress = 1 - blast.ttl / (blast.maxTtl || 0.28);
            const alpha = Math.max(0, Math.min(1, blast.ttl / (blast.maxTtl || 0.28)));
            const cx = R.offsetXFromSim(blast.x, scale);
            const cy = R.offsetYFromSim(blast.y, scale);
            const r = blast.radius * scale * (0.35 + progress * 0.9);
            const core = blast.color || '#f59e0b';

            ctx.save();
            ctx.globalAlpha = alpha * 0.35;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = core;
            ctx.fill();

            ctx.globalAlpha = alpha * 0.9;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = Math.max(2, 3 * dpr);
            ctx.stroke();

            ctx.globalAlpha = alpha * 0.75;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
            ctx.strokeStyle = '#111';
            ctx.lineWidth = Math.max(1.5, 2 * dpr);
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawProjectileShreds(ctx, sim, scale, dpr) {
        if (!sim.projectileShreds?.length) return;
        for (const p of sim.projectileShreds) {
            const alpha = Math.max(0, Math.min(1, p.ttl / (p.maxTtl || 0.35)));
            const px = R.offsetXFromSim(p.x, scale);
            const py = R.offsetYFromSim(p.y, scale);
            const r = Math.max(1, (p.r || 2) * scale * (0.55 + alpha * 0.45));
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color || '#111';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = Math.max(1, dpr);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    function drawDamagePopups(ctx, sim, scale, dpr) {
        if (!sim.damagePopups?.length) return;
        const baseSize = Math.max(22, 28 * scale);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const pop of sim.damagePopups) {
            const maxTtl = pop.maxTtl || 0.9;
            const life = Math.max(0, Math.min(1, pop.ttl / Math.min(0.35, maxTtl)));
            const amount = Number(pop.amount) || 1;
            const big = Boolean(pop.big) || amount >= 12;
            const sizeScale = big
                ? 1.12 + Math.min(0.28, (amount - 12) * 0.012)
                : 1;
            const fontSize = baseSize * sizeScale;
            const px = R.offsetXFromSim(pop.x, scale);
            const py = R.offsetYFromSim(pop.y, scale);
            const color = pop.color || '#dc2626';
            const fill = color.startsWith('#')
                ? `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${life})`
                : color;
            ctx.font = `700 ${fontSize}px "Bebas Neue", sans-serif`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${life * 0.95})`;
            ctx.lineWidth = Math.max(2.8, (big ? 3.4 : 3) * dpr);
            ctx.fillStyle = fill;
            ctx.strokeText(pop.text, px, py);
            ctx.fillText(pop.text, px, py);
        }
        ctx.restore();
    }

    function drawWebs(ctx, sim, scale, dpr) {
        if (!sim.webSegments?.length) return;
        ctx.save();
        ctx.lineCap = 'round';

        for (const web of sim.webSegments) {
            const x1 = R.offsetXFromSim(web.x1, scale);
            const y1 = R.offsetYFromSim(web.y1, scale);
            const x2 = R.offsetXFromSim(web.x2, scale);
            const y2 = R.offsetYFromSim(web.y2, scale);
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (len < 1) continue;

            const color = web.color || '#888';

            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.28;
            ctx.lineWidth = Math.max(5, 6 * dpr);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.95;
            ctx.lineWidth = Math.max(1.6, 2 * dpr);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const nx = -dy / len;
            const ny = dx / len;
            const tie = Math.max(3, 3.5 * dpr);
            ctx.globalAlpha = 0.75;
            for (let t = 0.15; t < 1; t += 0.14) {
                const x = x1 + dx * t;
                const y = y1 + dy * t;
                ctx.beginPath();
                ctx.moveTo(x - nx * tie, y - ny * tie);
                ctx.lineTo(x + nx * tie, y + ny * tie);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    R.drawLightningBolt = drawLightningBolt;
    R.drawLightningBolts = drawLightningBolts;
    R.drawLightningImpacts = drawLightningImpacts;
    R.drawExplosions = drawExplosions;
    R.drawProjectileShreds = drawProjectileShreds;
    R.drawDamagePopups = drawDamagePopups;
    R.drawWebs = drawWebs;
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
