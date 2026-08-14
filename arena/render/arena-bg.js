/**
 * Arena fill, border, wall spikes, and grid.
 * Extends window.ArenaRenderParts
 */
(function (R) {
    'use strict';

    const ARENA_BG = '#ffffff';
    const ARENA_BORDER = '#000000';

    function drawArenaFill(ctx, x, y, aw, ah) {
        ctx.fillStyle = ARENA_BG;
        ctx.fillRect(x, y, aw, ah);
    }

    function drawArenaBorder(ctx, x, y, aw, ah, dpr) {
        const lineW = Math.max(6, 8 * dpr);
        ctx.strokeStyle = ARENA_BORDER;
        ctx.lineWidth = lineW;
        ctx.strokeRect(x + lineW / 2, y + lineW / 2, aw - lineW, ah - lineW);
    }

    function drawTriangleSpike(ctx, bx, by, dirX, dirY, spikeLen, spikeW) {
        const tx = bx + dirX * spikeLen;
        const ty = by + dirY * spikeLen;
        const px = -dirY;
        const py = dirX;
        const hw = spikeW * 0.5;

        ctx.beginPath();
        ctx.moveTo(bx + px * hw, by + py * hw);
        ctx.lineTo(tx, ty);
        ctx.lineTo(bx - px * hw, by - py * hw);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    /** Outward wall spikes need canvas margin so tips aren't clipped. */
    function arenaSpikePad(dpr) {
        const spikeLen = Math.max(11, 15 * dpr);
        const border = Math.max(6, 8 * dpr);
        return spikeLen + border * 0.5 + Math.max(2, 2 * dpr);
    }

    /**
     * Evenly space spikes along one edge, inset from corners so bases
     * don't overhang the adjacent side.
     */
    function drawEdgeSpikes(ctx, x1, y1, x2, y2, nx, ny, spikeLen, spikeW, spacing) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        const cornerPad = spikeW * 0.7 + 1;
        const usable = len - cornerPad * 2;
        if (usable < spikeW * 0.8) return;

        const count = Math.max(1, Math.round(usable / spacing));
        const step = usable / count;
        const ux = dx / len;
        const uy = dy / len;

        for (let i = 0; i < count; i++) {
            const t = cornerPad + step * (i + 0.5);
            drawTriangleSpike(ctx, x1 + ux * t, y1 + uy * t, nx, ny, spikeLen, spikeW);
        }
    }

    function drawArenaSpikes(ctx, x, y, aw, ah, dpr) {
        const spikeLen = Math.max(11, 15 * dpr);
        const spikeW = Math.max(5, 7 * dpr);
        const spacing = Math.max(18, 22 * dpr);
        const border = Math.max(6, 8 * dpr);
        // Seat bases under the outer half of the border stroke.
        const seat = border * 0.2;

        ctx.save();
        ctx.fillStyle = '#9ca3af';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1, 1.5 * dpr);

        const left = x + seat;
        const top = y + seat;
        const right = x + aw - seat;
        const bottom = y + ah - seat;

        drawEdgeSpikes(ctx, left, top, right, top, 0, -1, spikeLen, spikeW, spacing);
        drawEdgeSpikes(ctx, right, top, right, bottom, 1, 0, spikeLen, spikeW, spacing);
        drawEdgeSpikes(ctx, right, bottom, left, bottom, 0, 1, spikeLen, spikeW, spacing);
        drawEdgeSpikes(ctx, left, bottom, left, top, -1, 0, spikeLen, spikeW, spacing);

        ctx.restore();
    }

    function drawArenaGrid(ctx, offsetX, offsetY, arenaW, arenaH, sim, scale, dpr) {
        const insetPx = (sim.wallInset || 0) * scale;
        const innerX = offsetX + insetPx;
        const innerY = offsetY + insetPx;
        const innerW = arenaW - insetPx * 2;
        const innerH = arenaH - insetPx * 2;
        const cellWorld = 40;
        const cellPx = cellWorld * scale;
        if (cellPx < 6 || innerW <= 0 || innerH <= 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(innerX, innerY, innerW, innerH);
        ctx.clip();

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = Math.max(1, dpr);

        const inset = sim.wallInset || 0;
        for (let wx = inset; wx <= sim.width - inset; wx += cellWorld) {
            const px = offsetX + wx * scale;
            ctx.moveTo(px, innerY);
            ctx.lineTo(px, innerY + innerH);
        }
        for (let wy = inset; wy <= sim.height - inset; wy += cellWorld) {
            const py = offsetY + wy * scale;
            ctx.moveTo(innerX, py);
            ctx.lineTo(innerX + innerW, py);
        }
        ctx.stroke();

        ctx.restore();
    }

    R.drawArenaFill = drawArenaFill;
    R.drawArenaBorder = drawArenaBorder;
    R.drawTriangleSpike = drawTriangleSpike;
    R.arenaSpikePad = arenaSpikePad;
    R.drawArenaSpikes = drawArenaSpikes;
    R.drawArenaGrid = drawArenaGrid;
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
