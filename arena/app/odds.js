/**
 * ArenaApp — win odds / pie styles / winner label / chart.
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});

    P.colorKey = function colorKey(color) {
        return String(color || '').trim().toLowerCase();
    }

    P.teamNameForColor = function teamNameForColor(color) {
        const key = P.colorKey(color);
        const theme = P.WEAPON_THEME_COLORS.find((c) => c.hex === key);
        if (theme) return `Team ${theme.label}`;
        return 'Team';
    }

    P.isTeamMatchup = function isTeamMatchup(entries = P.rosterEntries) {
        const counts = new Map();
        for (const entry of entries) {
            const key = P.colorKey(entry.color);
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        for (const n of counts.values()) {
            if (n > 1) return true;
        }
        return false;
    }

    /** Win-odds units: one per ball, or one per color team in team matchups. */
    P.winOddsUnits = function winOddsUnits() {
        if (!P.isTeamMatchup(P.rosterEntries)) {
            return P.rosterEntries.map((entry, i) => ({
                key: `ball-${i}`,
                color: entry.color,
                name: entry.name,
                fontFamily: entry.fontFamily,
                indices: [i],
            }));
        }
        const units = [];
        const byColor = new Map();
        P.rosterEntries.forEach((entry, i) => {
            const key = P.colorKey(entry.color) || `__solo_${i}`;
            let unit = byColor.get(key);
            if (!unit) {
                unit = {
                    key,
                    color: entry.color,
                    name: P.teamNameForColor(entry.color),
                    fontFamily: entry.fontFamily,
                    indices: [],
                };
                byColor.set(key, unit);
                units.push(unit);
            }
            unit.indices.push(i);
        });
        return units;
    }

    P.isOddsUnitAlive = function isOddsUnitAlive(unit) {
        return unit.indices.some((i) => P.isContestantAlive(P.rosterEntries[i]));
    }

    P.currentHealthForEntry = function currentHealthForEntry(entry) {
        if (!P.sim || !entry) return 0;
        return P.sim.balls
            .filter((b) => b._slotIndex === entry.slotIndex && b.isAlive())
            .reduce((sum, b) => sum + Math.max(0, b.health), 0);
    }

    /** Squared remaining-health ratio for one odds unit (fighter or whole team). */
    P.healthShareForUnit = function healthShareForUnit(unit) {
        let current = 0;
        let max = 0;
        for (const i of unit.indices) {
            const entry = P.rosterEntries[i];
            if (!entry || entry.maxHealth <= 0) continue;
            // Include every member's max so a KO'd teammate still costs the team pool.
            max += entry.maxHealth;
            current += P.currentHealthForEntry(entry);
        }
        if (max <= 0 || current <= 0) return 0;
        return Math.max(0, (current / max) ** 2);
    }

    P.resolveWinnerLabel = function resolveWinnerLabel(simInstance = P.sim) {
        if (!simInstance?.winner) return null;
        // Team labels are for multi-ball same-color fights only — never for 1v1 pairs.
        if (simInstance.winnerIsTeam && P.rosterEntries.length > 2) {
            return P.teamNameForColor(simInstance.winner.color);
        }
        const name = typeof simInstance.winner.name === 'string'
            ? simInstance.winner.name.trim()
            : '';
        return name || null;
    }

    P.computeWinOdds = function computeWinOdds() {
        const units = P.winOddsUnits();
        if (!units.length) return [];
        const shares = units.map((unit) => P.healthShareForUnit(unit));
        const total = shares.reduce((sum, share) => sum + share, 0);
        const aliveN = units.reduce((count, unit) => count + (P.isOddsUnitAlive(unit) ? 1 : 0), 0);
        return shares.map((share, i) => ({
            index: i,
            pct: total > 0
                ? (share / total) * 100
                : (P.isOddsUnitAlive(units[i]) && aliveN > 0 ? 100 / aliveN : 0),
            unit: units[i],
        }));
    }

    P.buildWinOddsPieStyle = function buildWinOddsPieStyle(odds) {
        const active = odds.filter((o) => o.pct > 0);
        if (!active.length) return '#c8c4bc';
        let start = 0;
        const stops = [];
        active.forEach((o, i) => {
            const color = o.unit?.color || P.rosterEntries[o.index]?.color || '#c8c4bc';
            const end = i === active.length - 1 ? 100 : start + o.pct;
            stops.push(`${color} ${start}% ${end}%`);
            start = end;
        });
        return `conic-gradient(${stops.join(', ')})`;
    }

    /** Mid-slice label position for a pie that starts at 12 o'clock (CSS conic default). */
    P.winOddsSliceLabelStyle = function winOddsSliceLabelStyle(startPct, endPct) {
        const span = Math.max(0, endPct - startPct);
        if (span >= 90) return { left: '50%', top: '50%' };
        const mid = (startPct + endPct) / 2;
        // Percent sweeps clockwise from top; convert to math angle (0° = east, CCW+).
        const angleDeg = (mid / 100) * 360 - 90;
        const rad = (angleDeg * Math.PI) / 180;
        // Thin wedges are wider near the rim — sit labels farther out there.
        const dist = span < 20
            ? Math.min(42, 32 + span * 0.4)
            : Math.min(36, Math.max(20, span * 0.45));
        const x = 50 + Math.cos(rad) * dist;
        const y = 50 + Math.sin(rad) * dist;
        return { left: `${x}%`, top: `${y}%` };
    }

    P.shouldShowPieLabel = function shouldShowPieLabel(unit, pct) {
        return Boolean(unit && pct >= 4 && P.isOddsUnitAlive(unit));
    }

    P.shouldShowPieName = function shouldShowPieName(pct) {
        // Names need a wider wedge than a bare % or they spill into the neighbor.
        return pct >= 14;
    }

    P.resetWinOddsHistory = function resetWinOddsHistory() {
        P.winOddsHistory = [];
        P.lastWinOddsSampleT = -Infinity;
    }

    P.sampleWinOddsHistory = function sampleWinOddsHistory() {
        if (!P.sim || P.rosterEntries.length < 2) return;
        const t = P.sim._simTime || 0;
        if (P.winOddsHistory.length > 0 && t - P.lastWinOddsSampleT < 0.08) return;
        P.lastWinOddsSampleT = t;
        const odds = P.computeWinOdds();
        P.winOddsHistory.push({ t, pcts: odds.map((o) => o.pct) });
        if (P.winOddsHistory.length > 900) P.winOddsHistory.shift();
    }

    P.resizeWinOddsChart = function resizeWinOddsChart() {
        const canvas = document.getElementById('win-odds-chart');
        const wrap = canvas?.parentElement;
        if (!canvas || !wrap) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = wrap.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    P.drawWinOddsChart = function drawWinOddsChart() {
        const canvas = document.getElementById('win-odds-chart');
        const odds = P.computeWinOdds();
        if (!canvas || odds.length < 2) return;
        P.resizeWinOddsChart();
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, w, h);

        const padL = 28 * dpr;
        const padR = 6 * dpr;
        const padT = 8 * dpr;
        const padB = 8 * dpr;
        const plotW = Math.max(1, w - padL - padR);
        const plotH = Math.max(1, h - padT - padB);
        const yAt = (pct) => padT + (1 - Math.max(0, Math.min(100, pct)) / 100) * plotH;

        // Horizontal reference lines + labels at 100%, 50%, 0%
        ctx.font = `${Math.max(9, Math.round(10 * dpr))}px 'Bebas Neue', sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const yPct of [100, 50, 0]) {
            const y = yAt(yPct);
            ctx.strokeStyle = yPct === 50 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)';
            ctx.lineWidth = Math.max(1, dpr * (yPct === 50 ? 1 : 0.75));
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0,0,0,0.38)';
            ctx.fillText(`${yPct}%`, padL - 4 * dpr, y);
        }

        if (P.winOddsHistory.length < 2) return;

        const t0 = P.winOddsHistory[0].t;
        const t1 = P.winOddsHistory[P.winOddsHistory.length - 1].t;
        const tSpan = Math.max(0.001, t1 - t0);
        const n = odds.length;

        const xAt = (t) => padL + ((t - t0) / tSpan) * plotW;

        // Soft fill under the favorite (switches color when lead changes).
        if (n === 2) {
            const fillColor = (hex) => {
                if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    return `rgba(${r},${g},${b},0.16)`;
                }
                return 'rgba(0, 0, 0, 0.05)';
            };
            const leaderAt = (sample) => (
                (sample.pcts[0] ?? 0) >= (sample.pcts[1] ?? 0) ? 0 : 1
            );
            const hist = P.winOddsHistory;
            let i = 0;
            while (i < hist.length) {
                const lead = leaderAt(hist[i]);
                let j = i + 1;
                while (j < hist.length && leaderAt(hist[j]) === lead) j += 1;

                ctx.beginPath();
                ctx.moveTo(xAt(hist[i].t), yAt(hist[i].pcts[lead]));
                for (let k = i + 1; k < j; k += 1) {
                    ctx.lineTo(xAt(hist[k].t), yAt(hist[k].pcts[lead]));
                }
                let endT = hist[j - 1].t;
                let endPct = hist[j - 1].pcts[lead];
                if (j < hist.length) {
                    const a = hist[j - 1];
                    const b = hist[j];
                    const d0 = (a.pcts[0] ?? 0) - (a.pcts[1] ?? 0);
                    const d1 = (b.pcts[0] ?? 0) - (b.pcts[1] ?? 0);
                    const denom = d0 - d1;
                    const u = Math.abs(denom) < 1e-9 ? 1 : Math.max(0, Math.min(1, d0 / denom));
                    endT = a.t + (b.t - a.t) * u;
                    endPct = (a.pcts[0] ?? 0) + ((b.pcts[0] ?? 0) - (a.pcts[0] ?? 0)) * u;
                    ctx.lineTo(xAt(endT), yAt(endPct));
                }
                ctx.lineTo(xAt(endT), padT + plotH);
                ctx.lineTo(xAt(hist[i].t), padT + plotH);
                ctx.closePath();
                ctx.fillStyle = fillColor(odds[lead]?.unit?.color || '#888');
                ctx.fill();
                i = j;
            }
        }

        for (let i = 0; i < n; i++) {
            const color = odds[i]?.unit?.color || '#888';
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(2, dpr * 2);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            let started = false;
            for (const sample of P.winOddsHistory) {
                const pct = sample.pcts[i];
                if (pct == null) continue;
                const x = xAt(sample.t);
                const y = yAt(pct);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();

            // Current-value tip
            const last = P.winOddsHistory[P.winOddsHistory.length - 1];
            if (last?.pcts[i] != null) {
                ctx.beginPath();
                ctx.fillStyle = color;
                ctx.arc(xAt(last.t), yAt(last.pcts[i]), Math.max(2.5, dpr * 2.5), 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    P.buildWinOddsUI = function buildWinOddsUI(balls) {
        if (!P.winOddsEl) return;
        if (balls.length < 2) {
            P.winOddsEl.hidden = true;
            P.winOddsEl.innerHTML = '';
            P.resetWinOddsHistory();
            return;
        }

        const odds = P.computeWinOdds();
        const units = odds.map((o) => o.unit);
        P.winOddsEl.hidden = false;
        if (!P.isComputerView()) {
            const labelHtml = (unit, i) => `
                <div
                    class="win-odds-label${i === 0 ? ' is-left' : ''}${i === units.length - 1 ? ' is-right' : ''}"
                    id="win-odds-label-${i}"
                    style="--ball-color:${unit.color};--ball-font:'${unit.fontFamily || 'Bebas Neue'}';--pct:${odds[i].pct}%"
                >
                    <span class="win-odds-name">${P.escapeHtml(unit.name)}</span>
                    <span class="win-odds-pct" id="win-pct-${i}">${Math.round(odds[i].pct)}%</span>
                </div>
            `;
            const track = `
                <div class="win-odds-track" role="meter" aria-label="Win probability by health share">
                    ${units.map((unit, i) => `
                        <div
                            class="win-odds-seg"
                            id="win-odds-seg-${i}"
                            style="--ball-color:${unit.color};--pct:${odds[i].pct}%"
                        ></div>
                    `).join('')}
                </div>
            `;
            P.winOddsEl.innerHTML = units.length === 2
                ? `
                    <p class="win-odds-eyebrow">Win chance</p>
                    <div class="win-odds-row" data-count="2">
                        ${labelHtml(units[0], 0)}
                        ${track}
                        ${labelHtml(units[1], 1)}
                    </div>
                `
                : `
                    <p class="win-odds-eyebrow">Win chance</p>
                    <div class="win-odds-row" data-count="${units.length}">
                        <div class="win-odds-labels">
                            ${units.map((unit, i) => labelHtml(unit, i)).join('')}
                        </div>
                        ${track}
                    </div>
                `;
            P.updateWinOddsUI();
            return;
        }

        P.resetWinOddsHistory();
        let cursor = 0;
        const slices = units.map((unit, i) => {
            const start = cursor;
            const end = start + Math.max(0, odds[i]?.pct || 0);
            cursor = end;
            const show = P.shouldShowPieLabel(unit, odds[i]?.pct || 0);
            const pos = P.winOddsSliceLabelStyle(start, end);
            return `
                <span
                    class="win-odds-slice"
                    id="win-odds-label-${i}"
                    style="--ball-font:'${unit.fontFamily || 'Bebas Neue'}';left:${pos.left};top:${pos.top}"
                    ${show ? '' : 'hidden'}
                >
                    <span class="win-odds-name"${P.shouldShowPieName(odds[i]?.pct || 0) ? '' : ' hidden'}>${P.escapeHtml(unit.name)}</span>
                    <span class="win-odds-pct" id="win-pct-${i}">${Math.round(odds[i]?.pct || 0)}%</span>
                </span>
            `;
        }).join('');
        P.winOddsEl.innerHTML = `
            <div class="win-odds-pie-block">
                <p class="win-odds-eyebrow">Win chance</p>
                <div
                    class="win-odds-pie"
                    id="win-odds-pie"
                    role="img"
                    aria-label="Win probability by health share"
                    style="background:${P.buildWinOddsPieStyle(odds)}"
                >${slices}</div>
            </div>
            <div class="win-odds-chart-block">
                <p class="win-odds-eyebrow">Win prob.</p>
                <div class="win-odds-chart-wrap">
                    <canvas id="win-odds-chart" aria-label="Win probability over time"></canvas>
                </div>
            </div>
        `;
        P.sampleWinOddsHistory();
        P.updateWinOddsUI();
    }

    P.updateWinOddsUI = function updateWinOddsUI() {
        if (!P.winOddsEl || P.winOddsEl.hidden || P.rosterEntries.length < 2) return;
        if (!P.isComputerView()) {
            const odds = P.computeWinOdds();
            const maxPct = Math.max(...odds.map((o) => o.pct));
            odds.forEach(({ index, pct }) => {
                const seg = document.getElementById(`win-odds-seg-${index}`);
                const pctEl = document.getElementById(`win-pct-${index}`);
                const label = document.getElementById(`win-odds-label-${index}`);
                const leading = Math.abs(pct - maxPct) < 0.01;
                if (seg) {
                    seg.style.setProperty('--pct', `${pct}%`);
                    seg.classList.toggle('is-leading', leading);
                }
                if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
                if (label) {
                    label.style.setProperty('--pct', `${pct}%`);
                    label.classList.toggle('is-leading', leading);
                }
            });
            return;
        }

        P.sampleWinOddsHistory();
        const odds = P.computeWinOdds();
        const pie = document.getElementById('win-odds-pie');
        if (pie) pie.style.background = P.buildWinOddsPieStyle(odds);
        let cursor = 0;
        odds.forEach(({ index, pct, unit }) => {
            const start = cursor;
            const end = start + Math.max(0, pct);
            cursor = end;
            const pctEl = document.getElementById(`win-pct-${index}`);
            const label = document.getElementById(`win-odds-label-${index}`);
            const show = P.shouldShowPieLabel(unit, pct);
            if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
            if (!label) return;
            if (!show) {
                label.hidden = true;
                return;
            }
            label.hidden = false;
            const pos = P.winOddsSliceLabelStyle(start, end);
            label.style.setProperty('--ball-font', `'${unit?.fontFamily || 'Bebas Neue'}'`);
            label.style.left = pos.left;
            label.style.top = pos.top;
            const nameEl = label.querySelector('.win-odds-name');
            if (nameEl) {
                nameEl.textContent = unit?.name || '';
                nameEl.hidden = !P.shouldShowPieName(pct);
            }
        });
        P.drawWinOddsChart();
    }
}());
