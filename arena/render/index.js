/**
 * Arena canvas draw orchestration.
 * Load order: sprites → arena-bg → weapons-melee → weapons-ranged → effects → ball → index
 * Exposes: window.ArenaRender = { draw, drawBallAt, drawBallLabel }
 */
(function (R) {
    'use strict';

    const LETTERBOX_BG = '#ece8e1';

    function isWeaponArena(sim) {
        return Boolean(sim?.isWeaponArena);
    }

    function draw(canvas, sim) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const pad = R.arenaSpikePad(dpr);
        const scaleX = Math.max(1, w - pad * 2) / sim.width;
        const scaleY = Math.max(1, h - pad * 2) / sim.height;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (w - sim.width * scale) / 2;
        const offsetY = (h - sim.height * scale) / 2;
        const arenaW = sim.width * scale;
        const arenaH = sim.height * scale;
        const weaponMode = isWeaponArena(sim);

        R.offsetXFromSim = (x) => offsetX + x * scale;
        R.offsetYFromSim = (y) => offsetY + y * scale;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = LETTERBOX_BG;
        ctx.fillRect(0, 0, w, h);

        R.drawArenaFill(ctx, offsetX, offsetY, arenaW, arenaH);

        ctx.save();
        ctx.beginPath();
        ctx.rect(offsetX, offsetY, arenaW, arenaH);
        ctx.clip();

        R.drawArenaGrid(ctx, offsetX, offsetY, arenaW, arenaH, sim, scale, dpr);
        R.drawWebs(ctx, sim, scale, dpr);

        for (const ball of sim.balls) {
            if (!ball.isAlive()) continue;

            const cx = offsetX + ball.x * scale;
            const cy = offsetY + ball.y * scale;
            const r = ball.radius * scale;
            R.drawBall(ctx, ball, cx, cy, r, scale, dpr, weaponMode, sim._simTime || 0);
        }

        R.drawArrows(ctx, sim, scale, dpr);
        R.drawProjectileShreds(ctx, sim, scale, dpr);
        R.drawLightningBolts(ctx, sim, scale, dpr);
        R.drawLightningImpacts(ctx, sim, scale, dpr);
        R.drawExplosions(ctx, sim, scale, dpr);
        R.drawDamagePopups(ctx, sim, scale, dpr);
        ctx.restore();

        R.drawArenaSpikes(ctx, offsetX, offsetY, arenaW, arenaH, dpr);
        R.drawArenaBorder(ctx, offsetX, offsetY, arenaW, arenaH, dpr);

        if (sim.finished) {
            ctx.fillStyle = 'rgba(236, 232, 225, 0.62)';
            ctx.fillRect(offsetX, offsetY, arenaW, arenaH);
            R.drawArenaGrid(ctx, offsetX, offsetY, arenaW, arenaH, sim, scale, dpr);
            const titleSize = Math.min(arenaW, arenaH) * 0.1;
            const koSize = Math.min(arenaW, arenaH) * 0.055;
            const subSize = Math.min(arenaW, arenaH) * 0.042;
            const cx = offsetX + arenaW / 2;
            const cy = offsetY + arenaH / 2;
            const winFont = R.canvasFontFamily(sim.winner?.displayFont);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (sim.winner) {
                const winColor = sim.winner.color || '#111';
                const teamWin = Boolean(sim.winnerIsTeam);
                const theme = [
                    { hex: '#ef4444', label: 'Red' },
                    { hex: '#f97316', label: 'Orange' },
                    { hex: '#eab308', label: 'Yellow' },
                    { hex: '#22c55e', label: 'Green' },
                    { hex: '#3b82f6', label: 'Blue' },
                    { hex: '#a855f7', label: 'Purple' },
                    { hex: '#000000', label: 'Black' },
                ].find((c) => c.hex === String(winColor || '').trim().toLowerCase());
                const winTitle = teamWin
                    ? `${theme ? `Team ${theme.label}` : 'Team'} wins`
                    : (sim.winner.name || 'Winner');

                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                ctx.font = `700 ${koSize}px "Bebas Neue", sans-serif`;
                ctx.fillText('KO', cx, cy - titleSize * 0.85);

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = Math.max(3, 3.5 * dpr);
                ctx.fillStyle = winColor;
                ctx.font = `700 ${titleSize}px ${winFont}`;
                ctx.strokeText(winTitle, cx, cy - titleSize * 0.05);
                ctx.fillText(winTitle, cx, cy - titleSize * 0.05);

                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.font = `${subSize}px "DM Sans", sans-serif`;
                ctx.fillText('Tap arena to play again', cx, cy + titleSize * 0.55);
            } else {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                ctx.font = `700 ${koSize}px "Bebas Neue", sans-serif`;
                ctx.fillText('KO', cx, cy - titleSize * 0.85);
                ctx.fillStyle = '#111';
                ctx.font = `700 ${titleSize}px ${R.canvasFontFamily(R.DEFAULT_FONT)}`;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = Math.max(3, 3.5 * dpr);
                ctx.strokeText('Draw', cx, cy - titleSize * 0.05);
                ctx.fillText('Draw', cx, cy - titleSize * 0.05);
                ctx.font = `${subSize}px "DM Sans", sans-serif`;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillText('Tap arena to play again', cx, cy + titleSize * 0.55);
            }
            R.drawArenaSpikes(ctx, offsetX, offsetY, arenaW, arenaH, dpr);
            R.drawArenaBorder(ctx, offsetX, offsetY, arenaW, arenaH, dpr);
        }
    }

    window.ArenaRender = {
        draw,
        drawBallAt: R.drawBallAt,
        drawBallLabel: R.drawBallLabel,
    };
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
