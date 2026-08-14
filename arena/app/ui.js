/**
 * ArenaApp — contestant DOM, titles, speed controls, HUD.
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});


    P.playbackSpeed = function playbackSpeed() {
        return P.PLAYBACK_SPEEDS[P.playbackSpeedIndex];
    }

    P.formatPlaybackSpeed = function formatPlaybackSpeed(speed) {
        return `${speed}×`;
    }

    P.updateSpeedControls = function updateSpeedControls() {
        const label = document.getElementById('stage-speed-label');
        const downBtn = document.getElementById('btn-speed-down');
        const upBtn = document.getElementById('btn-speed-up');
        if (label) label.textContent = P.formatPlaybackSpeed(P.playbackSpeed());
        if (downBtn) downBtn.disabled = P.playbackSpeedIndex <= 0;
        if (upBtn) upBtn.disabled = P.playbackSpeedIndex >= P.PLAYBACK_SPEEDS.length - 1;
    }

    P.contestantStyle = function contestantStyle(ball) {
        const font = ball.displayFont || 'Bebas Neue';
        return `color:${ball.color};--ball-font:'${font}'`;
    }

    P.fitContestantTitles = function fitContestantTitles() {
        if (!P.titlesEl) return;
        const titles = [...P.titlesEl.querySelectorAll('.contestant-title')];
        titles.forEach((el) => { el.style.fontSize = ''; });
        if (!titles.length) return;

        let size = Math.min(...titles.map((el) => parseFloat(getComputedStyle(el).fontSize)));
        if (!Number.isFinite(size) || size <= 0) return;
        const rowItems = [...P.titlesEl.children];
        const styles = getComputedStyle(P.titlesEl);
        const gap = parseFloat(styles.columnGap) || 0;
        const availableWidth = P.titlesEl.clientWidth
            - (parseFloat(styles.paddingLeft) || 0)
            - (parseFloat(styles.paddingRight) || 0);
        while (true) {
            titles.forEach((el) => { el.style.fontSize = `${size}px`; });
            // Measure intrinsic widths (ignore any CSS max-width / flex shrink).
            const rowWidth = rowItems.reduce((sum, el) => {
                const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
                return sum + w;
            }, gap * Math.max(0, rowItems.length - 1));
            if (rowWidth <= availableWidth + 0.5 || size <= 9) break;
            size = Math.max(9, size - 0.5);
        }
    }

    P.isComputerView = function isComputerView() {
        if (document.body.classList.contains('arena-computer')) return true;
        // Long YouTube embeds the live arena in the workflow pane (no arena-computer on <body>).
        return document.body.dataset.workflow === 'long'
            && Boolean(document.getElementById('workflow-preview-arena'));
    }

    P.escapeHtml = function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    P.formatStat = function formatStat(label, value) {
        return `<li><strong>${P.escapeHtml(label)}</strong> ${P.escapeHtml(value)}</li>`;
    }

    /** First clause only — keeps long-form weapon blurbs short. */
    P.shortBio = function shortBio(text) {
        const raw = String(text || '').replace(/\s+/g, ' ').trim();
        if (!raw) return '';
        const cut = raw.split(/\s*[—–-]\s*/)[0].trim();
        const clause = cut.split(/(?<=\.)\s+/)[0].trim();
        if (clause.length <= 72) return clause;
        return `${clause.slice(0, 69).replace(/\s+\S*$/, '').trim()}…`;
    }

    /** Long-form-only card extras: weapon/powerup lines + combat stats. */
    P.longFormCardDetails = function longFormCardDetails(ball, weaponMode) {
        if (!P.isComputerView()) return '';

        const parts = [];
        if (weaponMode) {
            const weaponBlock = P.weaponLineHtml(ball);
            if (weaponBlock) parts.push(weaponBlock);
        }
        if (ball.powerupName) {
            parts.push(P.powerupLineHtml(ball));
        }
        if (!weaponMode) {
            const bio = P.shortBio(ball.bio || '');
            if (bio) {
                parts.push(`<p class="contestant-card-bio">${P.escapeHtml(bio)}</p>`);
            }
        }

        const stats = [];
        if (weaponMode) {
            const base = Number(ball.weaponDamage) || 0;
            const max = Number(ball.damageMax) || base;
            const live = typeof ball.getWeaponDamage === 'function'
                ? Number(ball.getWeaponDamage()) || base
                : base;
            if (max > base + 0.01) {
                stats.push(P.formatStat('Melee Dmg', `${Math.round(base)}–${Math.round(max)}`));
            } else if (base > 0 || live > 0) {
                stats.push(P.formatStat('Melee Dmg', `${Math.round(live || base)}`));
            }
            const proj = Number(ball.projectileDamage) || 0;
            if (proj > 0 && Math.abs(proj - base) > 0.01) {
                stats.push(P.formatStat('Proj. Dmg', `${Math.round(proj)}`));
            }
            const reach = Number(ball.swordLength) || 0;
            if (reach > 0) stats.push(P.formatStat('Reach', String(Math.round(reach))));
            const spike = Number(ball.spikeLength) || 0;
            if (spike > 0) stats.push(P.formatStat('Spike', String(Math.round(spike))));
            const knock = Number(ball.knockbackScale);
            if (Number.isFinite(knock) && knock > 0) {
                stats.push(P.formatStat('Knockback', `×${knock.toFixed(1)}`));
            }
            const spin = Number(ball.baseSpinSpeed ?? ball.spinSpeed);
            if (Number.isFinite(spin) && spin > 0) {
                stats.push(P.formatStat('Spin', spin.toFixed(1)));
            }
            const interval = Number(ball.shootInterval);
            if (ball.weaponBehavior?.shootsProjectiles?.(ball) && interval > 0) {
                stats.push(P.formatStat('Rate', `${interval.toFixed(1)}s`));
            }
            const hp = Number(ball.maxHealth) || 0;
            if (hp > 0) stats.push(P.formatStat('HP', String(Math.round(hp))));
        } else {
            const hp = Number(ball.maxHealth) || 0;
            if (hp > 0) stats.push(P.formatStat('HP', String(Math.round(hp))));
            const r = Number(ball.radius);
            if (Number.isFinite(r) && r > 0) stats.push(P.formatStat('Size', r.toFixed(0)));
        }

        if (stats.length) {
            parts.push(`<ul class="contestant-card-stats">${stats.join('')}</ul>`);
        }
        return parts.join('');
    }

    P.contestantTitleHtml = function contestantTitleHtml(ball, index, { showEmptyPowerup = false } = {}) {
        const lines = [
            `<span class="contestant-title-name">`
            + `${P.weaponMarkHtml(ball, 'contestant-title-weapon')}`
            + `${P.escapeHtml(ball.name)}`
            + `</span>`,
        ];
        if (ball.powerupName) {
            const color = ball.powerupColor || '#888888';
            lines.push(
                `<span class="contestant-title-powerup" style="color:${color}">`
                + `${P.powerupMarkHtml(ball, 'contestant-title-powerup')}`
                + `${P.escapeHtml(ball.powerupName)}`
                + `</span>`,
            );
        } else if (showEmptyPowerup) {
            const PU = window.PremadePowerups;
            const label = PU?.EMPTY_POWERUP_NAME || 'No Powerup';
            const icon = PU?.EMPTY_POWERUP_ICON || '';
            lines.push(
                `<span class="contestant-title-powerup is-empty">`
                + (icon ? `<img class="contestant-title-powerup-icon" src="${P.escapeHtml(icon)}" alt="" aria-hidden="true">` : '')
                + `${P.escapeHtml(label)}`
                + `</span>`,
            );
        }
        return `<span class="contestant-title" id="title-${index}" style="${P.contestantStyle(ball)}">${lines.join('')}</span>`;
    }

    P.powerupMarkHtml = function powerupMarkHtml(ball, classPrefix) {
        if (!ball.powerupIcon) return '';
        return `<img class="${classPrefix}-icon" src="${P.escapeHtml(ball.powerupIcon)}" alt="" aria-hidden="true">`;
    }

    P.weaponMarkHtml = function weaponMarkHtml(ball, classPrefix) {
        const src = ball.weaponIcon || P.PW.iconUrl?.(ball.weaponId);
        if (!src) return '';
        return `<img class="${classPrefix}-icon" src="${P.escapeHtml(src)}" alt="" aria-hidden="true">`;
    }

    P.weaponLineHtml = function weaponLineHtml(ball) {
        if (!ball.weaponName) return '';
        const bio = P.shortBio(ball.weaponBio || ball.bio || '');
        const sameAsFighter = String(ball.weaponName).trim().toLowerCase()
            === String(ball.name || '').trim().toLowerCase();
        if (sameAsFighter && !bio) return '';
        return `<div class="contestant-card-weapon-block">`
            + (sameAsFighter ? '' : `<p class="contestant-card-weapon">${P.escapeHtml(ball.weaponName)}</p>`)
            + (bio ? `<p class="contestant-card-weapon-bio">${P.escapeHtml(bio)}</p>` : '')
            + `</div>`;
    }

    P.powerupLineHtml = function powerupLineHtml(ball) {
        if (!ball.powerupName) return '';
        const color = ball.powerupColor || '#888888';
        const bio = String(ball.powerupBio || '').trim();
        return `<div class="contestant-card-powerup-block">`
            + `<p class="contestant-card-powerup" style="color:${color}">`
            + `${P.powerupMarkHtml(ball, 'contestant-card-powerup')}`
            + `${P.escapeHtml(ball.powerupName)}`
            + `</p>`
            + (bio ? `<p class="contestant-card-powerup-bio">${P.escapeHtml(bio)}</p>` : '')
            + `</div>`;
    }

    P.buildContestantUI = function buildContestantUI(balls) {
        if (!P.titlesEl || !P.rosterEl) return;

        P.rosterEntries = balls.map((b, i) => ({
            slotIndex: i,
            premadeId: b.premadeId,
            skinId: b.skinId,
            name: b.name,
            color: b.color,
            bio: b.bio,
            fontFamily: b.displayFont || 'Bebas Neue',
            maxHealth: b.maxHealth,
        }));

        if (balls.length >= 2) {
            const groups = [];
            const groupIndexByColor = new Map();
            balls.forEach((b, i) => {
                const colorKey = String(b.color || '').trim().toLowerCase();
                const key = colorKey || `__solo_${i}`;
                let gi = groupIndexByColor.get(key);
                if (gi == null) {
                    gi = groups.length;
                    groupIndexByColor.set(key, gi);
                    groups.push([]);
                }
                groups[gi].push({ ball: b, index: i });
            });
            const someoneHasPowerup = balls.some((b) => b.powerupName || b.powerupId);
            P.titlesEl.innerHTML = groups.map((group, gi) => {
                const names = group.map(({ ball, index }) => P.contestantTitleHtml(ball, index, {
                    showEmptyPowerup: someoneHasPowerup && !ball.powerupName,
                }))
                    .join('<span class="and-label"> and </span>');
                if (gi === 0) return names;
                return `<span class="versus-label">VS</span>${names}`;
            }).join('');
        } else {
            const someoneHasPowerup = balls.some((b) => b.powerupName || b.powerupId);
            P.titlesEl.innerHTML = balls.map((b, i) => P.contestantTitleHtml(b, i, {
                showEmptyPowerup: someoneHasPowerup && !b.powerupName,
            })).join('');
        }
        const weaponMode = P.gameMode === 'weapon';
        const shortsTwoLine = !P.isComputerView() && balls.length >= 4;
        const twoLineClass = shortsTwoLine ? ' is-two-line' : '';
        P.rosterEl.innerHTML = `
            <div class="matchup-cards${twoLineClass}" data-count="${balls.length}">
                ${balls.map((b, i) => {
                    const shortsWeapon = !P.isComputerView() && weaponMode ? P.weaponLineHtml(b) : '';
                    const shortsBallBio = !P.isComputerView() && !weaponMode
                        ? P.shortBio(b.bio || '')
                        : '';
                    return `
                    <article class="contestant-card" id="card-${i}" style="--ball-color:${b.color};--ball-font:'${b.displayFont || 'Bebas Neue'}'">
                        <div class="contestant-card-header">
                            <h2 class="contestant-card-name">${P.escapeHtml(b.name)}</h2>
                            <span class="contestant-card-status" id="status-${i}">Active</span>
                        </div>
                        ${shortsWeapon}
                        ${!P.isComputerView() ? P.powerupLineHtml(b) : ''}
                        ${P.longFormCardDetails(b, weaponMode)}
                        ${shortsBallBio ? `<p class="contestant-card-bio">${P.escapeHtml(shortsBallBio)}</p>` : ''}
                        ${weaponMode ? `
                        <div class="contestant-health" aria-label="${P.escapeHtml(b.name)} health">
                            <div class="contestant-health-track">
                                <div class="contestant-health-fill" id="health-fill-${i}" style="width:100%"></div>
                            </div>
                            <span class="contestant-health-value" id="health-value-${i}">${b.health}</span>
                        </div>
                        ` : ''}
                    </article>
                `;
                }).join('')}
            </div>
        `;
        P.buildWinOddsUI(balls);
    }

    P.getBallForEntry = function getBallForEntry(entry) {
        if (!P.sim) return null;
        return P.sim.balls.find((b) => b._slotIndex === entry.slotIndex) || null;
    }

    P.isContestantAlive = function isContestantAlive(entry) {
        const ball = P.getBallForEntry(entry);
        return Boolean(ball && ball.isAlive());
    }

    P.updateContestantUI = function updateContestantUI() {
        if (!P.sim) return;
        P.rosterEntries.forEach((entry, i) => {
            const title = document.getElementById(`title-${i}`);
            const card = document.getElementById(`card-${i}`);
            const status = document.getElementById(`status-${i}`);
            const healthFill = document.getElementById(`health-fill-${i}`);
            const healthValue = document.getElementById(`health-value-${i}`);
            const ball = P.getBallForEntry(entry);
            const alive = Boolean(ball && ball.isAlive());

            if (title) title.classList.toggle('is-dead', !alive);
            if (card) card.classList.toggle('is-dead', !alive);
            if (status) status.textContent = alive ? 'Active' : 'KO';

            if (ball && healthFill) {
                const pct = entry.maxHealth > 0
                    ? Math.max(0, Math.min(100, (ball.health / entry.maxHealth) * 100))
                    : 0;
                healthFill.style.width = `${pct}%`;
            }
            if (ball && healthValue) {
                healthValue.textContent = String(ball.health);
            }
        });
        P.updateWinOddsUI();
    }

    P.updatePageTitle = function updatePageTitle() {
        const mode = P.GAME_MODES[P.gameMode];
        if (P.eventTitleEl && mode) P.eventTitleEl.textContent = mode.title;
        document.title = mode?.title || 'Ball Arena';
    }

    P.bindAudioUnlock = function bindAudioUnlock() {
        const unlockAudio = () => {
            if (window.ArenaAudio) ArenaAudio.unlock();
        };
        document.addEventListener('pointerdown', unlockAudio, { passive: true });
        document.addEventListener('keydown', unlockAudio);
    }

    P.updatePauseButton = function updatePauseButton() {
        const btn = document.getElementById('btn-P.pause');
        if (!btn) return;
        const hasBalls = Boolean(P.sim?.balls?.length);
        const canResume = hasBalls && !P.sim.finished && !P.running;
        const label = P.running ? 'Pause' : (canResume ? 'Resume' : 'Pause');
        btn.textContent = label;
        btn.disabled = !hasBalls || Boolean(P.sim?.finished);
        btn.setAttribute('aria-label', label);
    }

    P.updateClearButton = function updateClearButton() {
        const btn = document.getElementById('btn-clear');
        if (!btn) return;
        btn.disabled = !P.sim?.balls?.length;
    }

    P.updateRedoButton = function updateRedoButton() {
        const btn = document.getElementById('btn-P.reset');
        if (!btn) return;
        btn.disabled = !P.matchupSlots?.length;
    }

    P.updateStageControls = function updateStageControls() {
        P.updatePauseButton();
        P.updateClearButton();
        P.updateRedoButton();
        P.updateSpeedControls();
    }
}());
