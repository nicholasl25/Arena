/**
 * ArenaApp — wires parts → window.ArenaApp public API.
 * Depends: Ball, ArenaSim, WeaponArenaSim, WeaponBall, ArenaRender, PremadeBalls, PremadeWeapons, BallSkins
 * Parts: arena/app/constants.js … sim-loop.js (load before this file)
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});

    P.PB = window.PremadeBalls;
    P.PW = window.PremadeWeapons;
    P.SK = window.BallSkins;
    if (!P.PB) {
        throw new Error('ArenaApp: missing PremadeBalls (load premade-balls/*.js first)');
    }
    if (!P.PW) {
        throw new Error('ArenaApp: missing PremadeWeapons (load premade-weapons/*.js first)');
    }

    P.tournamentArenaState = P.loadTournamentArenaState();
    P.gameMode = P.tournamentArenaState?.mode === 'weapon'
        ? 'weapon'
        : (P.tournamentArenaState?.mode === 'collision' ? 'collision' : P.loadSavedMode());
    /** @type {{ id: string, config: Record<string, unknown> }[]} */
    P.matchupSlots = [];

    P.canvas = document.getElementById('arena-canvas');
    P.titlesEl = document.getElementById('contestant-titles');
    P.rosterEl = document.getElementById('contestant-roster');
    P.winOddsEl = document.getElementById('win-odds');
    P.eventTitleEl = document.querySelector('.event-title');
    P.stageControlsEl = document.querySelector('.stage-controls');

    if (P.stageControlsEl && P.rosterEl) {
        if (P.isComputerView()) {
            // Right rail: fighter cards on top, Pause/Clear/Redo under them.
            let rail = document.querySelector('.arena-right-rail');
            if (!rail) {
                rail = document.createElement('div');
                rail.className = 'arena-right-rail';
                P.rosterEl.replaceWith(rail);
                rail.append(P.rosterEl, P.stageControlsEl);
            } else if (P.stageControlsEl.parentElement !== rail) {
                rail.append(P.stageControlsEl);
            }
        } else {
            P.rosterEl.after(P.stageControlsEl);
        }
    }

    P.sim = null;
    P.rosterEntries = [];
    P.running = false;
    P.rafId = 0;
    P.lastTs = 0;
    P.playbackSpeedIndex = Math.max(0, P.PLAYBACK_SPEEDS.indexOf(1));
    P.previewPlaybackRate = 1;
    /** @type {{ t: number, pcts: number[] }[]} */
    P.winOddsHistory = [];
    P.lastWinOddsSampleT = -Infinity;

    document.getElementById('btn-pause').addEventListener('click', () => {
        if (window.ArenaAudio) ArenaAudio.unlock();
        P.togglePause();
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
        P.clearArena();
    });

    document.getElementById('btn-reset')?.addEventListener('click', () => {
        if (window.ArenaAudio) ArenaAudio.unlock();
        P.reset();
    });

    document.getElementById('btn-speed-down')?.addEventListener('click', () => {
        if (P.playbackSpeedIndex <= 0) return;
        P.playbackSpeedIndex -= 1;
        P.updateSpeedControls();
    });

    document.getElementById('btn-speed-up')?.addEventListener('click', () => {
        if (P.playbackSpeedIndex >= P.PLAYBACK_SPEEDS.length - 1) return;
        P.playbackSpeedIndex += 1;
        P.updateSpeedControls();
    });

    P.canvas.addEventListener('pointerdown', () => {
        if (window.ArenaAudio) ArenaAudio.unlock();
    });

    P.canvas.addEventListener('click', () => {
        if (P.sim && P.sim.finished) P.reset();
    });

    P.bindAudioUnlock();

    window.addEventListener('resize', () => {
        const letterbox = document.getElementById('stage-letterbox');
        letterbox?.style.removeProperty('width');
        letterbox?.style.removeProperty('height');
        P.resizeCanvas();
        P.fitContestantTitles();
    });
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            const letterbox = document.getElementById('stage-letterbox');
            letterbox?.style.removeProperty('width');
            letterbox?.style.removeProperty('height');
            P.resizeCanvas();
            P.fitContestantTitles();
        }, 100);
    });

    const letterboxEl = document.getElementById('stage-letterbox');
    if (letterboxEl && typeof ResizeObserver !== 'undefined') {
        let resizeRaf = 0;
        new ResizeObserver(() => {
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = 0;
                P.resizeCanvas();
            });
        }).observe(letterboxEl);
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => P.draw());
    }

    window.addEventListener('arena-skins-loaded', () => {
        P.draw();
    });

    async function boot() {
        if (P.SK?.init) await P.SK.init();
        P.matchupSlots = P.loadSavedMatchup() || P.defaultMatchupSlots();
        P.repairWeaponMatchup();
        if (P.matchupSlots.length < 2) {
            P.matchupSlots = P.defaultMatchupSlots();
        }
        if (P.matchupSlots.length < 2 && P.gameMode === 'weapon') {
            P.gameMode = 'collision';
            P.saveMode(P.gameMode);
            P.matchupSlots = P.defaultMatchupSlots();
        }
        P.resizeCanvas();
        P.updatePageTitle();
        P.reset();
    }

    const bootPromise = boot().then(() => {
        window.dispatchEvent(new CustomEvent('arena-ready'));
    });

    window.ArenaApp = {
        whenReady() {
            return bootPromise;
        },
        getGameMode() {
            return P.gameMode;
        },
        setGameMode: P.setGameMode,
        setPreviewPlaybackRate(rate) {
            const next = Number(rate);
            P.previewPlaybackRate = next === 2 || next === 4 ? next : 1;
            return P.previewPlaybackRate;
        },
        getMatchup() {
            return P.matchupSlots.map((slot) => ({
                id: slot.id,
                config: { ...slot.config },
            }));
        },
        setMatchup: P.setMatchup,
        reset: P.reset,
        pause: P.pause,
        run: P.run,
        togglePause: P.togglePause,
        clearArena: P.clearArena,
        getCanvas() {
            return P.canvas;
        },
        resize: P.resizeCanvas,
        getSim() {
            return P.sim;
        },
        resolveWinnerLabel: P.resolveWinnerLabel,
        teamNameForColor: P.teamNameForColor,
        stepSimFrame: P.stepSimFrame,
        stepSimSilent: P.stepSimSilent,
        simulateFight: P.simulateFight,
        defaultHealthFor: P.defaultHealthFor,
        defaultMassFor: P.defaultMassFor,
        defaultRadiusFor: P.defaultRadiusFor,
        defaultColorFor: P.defaultColorFor,
        defaultNameFor: P.defaultNameFor,
        listWeaponThemeColors() {
            return P.WEAPON_THEME_COLORS.map((c) => ({ ...c }));
        },
        resolveWeaponThemeColor: P.resolveWeaponThemeColor,
        listFighters() {
            if (P.gameMode === 'weapon' && P.SK) {
                const skins = P.SK.listSkinIds().map((id) => {
                    const spec = P.SK.getSkin(id);
                    if (!spec) return null;
                    return {
                        id,
                        name: spec.name,
                        color: spec.color,
                        category: spec.category || 'Other',
                        bio: '',
                        defaultHealth: 60,
                        defaultMass: 64,
                        defaultRadius: 40,
                    };
                }).filter(Boolean);
                return [
                    {
                        id: P.DEFAULT_WEAPON_SKIN_ID,
                        name: 'Default (weapon name)',
                        color: '#888888',
                        bio: 'Uses the equipped weapon name as the ball label.',
                        defaultHealth: 60,
                        defaultMass: 64,
                        defaultRadius: 40,
                    },
                    ...skins,
                ];
            }
            return Object.entries(P.PB.PREMADE_BALLS).map(([id, spec]) => ({
                id,
                name: spec.name,
                color: spec.color,
                bio: spec.bio,
                defaultHealth: spec.health,
                defaultMass: spec.mass,
                defaultRadius: spec.radius,
            }));
        },
        listWeapons() {
            const weapons = Object.entries(P.PW.PREMADE_WEAPONS).map(([id, spec]) => ({
                id,
                name: spec.name,
                bio: spec.bio,
                weaponDamage: spec.weaponDamage,
                spinSpeed: spec.spinSpeed,
                swordLength: spec.swordLength,
                knockbackScale: spec.knockbackScale,
            }));
            return [
                {
                    id: P.NONE_WEAPON_ID,
                    name: 'None',
                    bio: 'No weapon equipped.',
                    weaponDamage: 0,
                    spinSpeed: 0,
                    swordLength: 0,
                    knockbackScale: 0,
                },
                ...weapons,
            ];
        },
        listPowerups() {
            return window.PremadePowerups?.listPowerups?.() || [];
        },
        defaultWeaponSkinId() {
            return P.DEFAULT_WEAPON_SKIN_ID;
        },
        noneWeaponId() {
            return P.NONE_WEAPON_ID;
        },
        weaponDisplayName: P.weaponDisplayName,
        defaultWeaponFor: P.defaultWeaponFor,
        listModes() {
            return Object.values(P.GAME_MODES);
        },
        async refreshSkins() {
            if (!P.SK?.init) return;
            await P.SK.init();
            P.repairWeaponMatchup();
            window.dispatchEvent(new CustomEvent('arena-mode-changed', { detail: { mode: P.gameMode } }));
            P.draw();
        },
    };
}());
