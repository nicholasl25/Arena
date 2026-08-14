/**
 * Workflow app — Bracket build/persist/preview + tournament phase.
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.buildBracketFromMatchup = function buildBracketFromMatchup(matchup = null) {
        if (!window.WorkflowBracket || !window.ArenaApp) return null;
        // Never fall back to ArenaApp (may hold Shorts matchup or the live 1v1 pair).
        const source = matchup || rt.loadTournamentRoster();
        if (!Array.isArray(source) || source.length < 2) return null;
        const fighters = source.map(rt.resolveFighterDisplay);
        return window.WorkflowBracket.buildFromFighters(fighters);
    }

    rt.currentTournamentMatch = function currentTournamentMatch(state = rt.bracketState) {
        return window.WorkflowBracket?.currentMatch?.(state) || null;
    }

    rt.activateArenaMatch = function activateArenaMatch(match = rt.currentTournamentMatch(), { force = false } = {}) {
        if (!match || !window.ArenaApp || !window.WorkflowBracket?.matchArenaMatchup) return null;
        const pair = window.WorkflowBracket.matchArenaMatchup(match);
        if (pair.length !== 2) throw new Error('Tournament Arena requires exactly two fighters');
        const matchKey = window.WorkflowBracket.matchComposeKey(match);
        const sim = window.ArenaApp.getSim?.();
        if (!force && matchKey === rt.activeArenaMatchKey && sim && !sim.finished) {
            // Bracket intro / setup often pauses the sim after the pair was loaded.
            // Resume so the fight (and 60s stalemate) can actually finish.
            window.ArenaApp.run?.();
            return pair;
        }
        const mode = rt.setupReady?.mode === 'weapon' ? 'weapon' : 'collision';
        if (window.ArenaApp.getGameMode?.() !== mode) {
            window.ArenaApp.setGameMode(mode, { persist: false });
        }
        window.ArenaApp.setPreviewPlaybackRate?.(
            window.WorkflowBracketPreview?.getDebugState?.().playbackRate || 1
        );
        window.ArenaApp.setMatchup(pair, { persist: false });
        rt.persistTournamentArenaMatchup(mode, pair);
        rt.activeArenaMatchKey = matchKey;
        return pair;
    }

    rt.readArenaResult = function readArenaResult({ match }) {
        const sim = window.ArenaApp?.getSim?.();
        if (!sim) return null;
        const balls = Array.isArray(sim.balls) ? sim.balls : [];
        if (balls.length !== 2) return null;
        if (!sim.finished && (Number(sim._simTime) || 0) < 60) return null;
        if (!sim.finished) {
            const survivors = balls
                .filter((ball) => typeof ball.isAlive !== 'function' || ball.isAlive())
                .sort((a, b) => (Number(b.health) || 0) - (Number(a.health) || 0));
            const top = survivors[0];
            if (!top) return null;
            const winnerSlot = Number.isInteger(top._slotIndex)
                ? top._slotIndex
                : balls.indexOf(top);
            const winner = winnerSlot === 0 ? match.a : (winnerSlot === 1 ? match.b : null);
            if (!winner) return null;
            window.ArenaApp.pause?.();
            return { winner };
        }
        if (!sim.winner) return { draw: true };
        const winnerSlot = Number.isInteger(sim.winner._slotIndex)
            ? sim.winner._slotIndex
            : balls.indexOf(sim.winner);
        const winner = winnerSlot === 0 ? match.a : (winnerSlot === 1 ? match.b : null);
        if (!winner || typeof sim.winner.isAlive !== 'function' || !sim.winner.isAlive()) {
            return null;
        }
        const matchKey = window.WorkflowBracket.matchComposeKey(match);
        if (!rt.tournamentFightEvidence.some((entry) => entry.matchKey === matchKey)) {
            rt.tournamentFightEvidence.push({
                matchKey,
                winnerSlot,
                winnerName: sim.winner.name,
                simTime: Number(sim._simTime) || 0,
                fighters: balls.map((ball) => ({
                    slotIndex: ball._slotIndex,
                    name: ball.name,
                    health: ball.health,
                    alive: ball.isAlive(),
                    x: ball.x,
                    y: ball.y,
                })),
            });
        }
        return { winner };
    }

    rt.setTournamentPresentationPhase = function setTournamentPresentationPhase(phase) {
        if (!rt.isComputerWorkflow()) return;
        const showArena = phase === 'arena' || phase === 'compose';
        if (rt.els.previewArena) rt.els.previewArena.hidden = !showArena;
        if (rt.els.previewBracket) rt.els.previewBracket.hidden = showArena;
        if (showArena) window.ArenaApp?.resize?.();
        if (!showArena) window.ArenaApp?.pause?.();
    }

    rt.restoreTournamentRoster = function restoreTournamentRoster() {
        const roster = rt.loadTournamentRoster();
        if (roster?.length >= 2) {
            window.ArenaApp?.setMatchup?.(roster, { persist: false });
        }
        return roster;
    }

    rt.migrateTournamentRoster = function migrateTournamentRoster() {
        const roster = rt.loadTournamentRoster();
        if (roster?.length >= 2) rt.persistTournamentRoster(roster);
    }

    rt.persistBracket = function persistBracket(state) {
        rt.bracketState = state;
        try {
            if (state) localStorage.setItem(rt.BRACKET_STORAGE_KEY, JSON.stringify(state));
            else localStorage.removeItem(rt.BRACKET_STORAGE_KEY);
        } catch { /* ignore */ }
    }

    rt.loadPersistedBracket = function loadPersistedBracket() {
        try {
            const raw = localStorage.getItem(rt.BRACKET_STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    rt.ensureBracket = function ensureBracket() {
        if (!rt.isComputerWorkflow()) return null;
        if (rt.bracketState?.fighters?.length >= 2) return rt.bracketState;
        const built = rt.buildBracketFromMatchup();
        if (built) rt.persistBracket(built);
        return rt.bracketState;
    }

    rt.stopBracketPreview = function stopBracketPreview() {
        window.WorkflowBracketPreview?.stop?.();
        if (rt.els.previewBracket) rt.els.previewBracket.hidden = true;
        if (rt.els.previewArena) rt.els.previewArena.hidden = true;
        window.ArenaApp?.pause?.();
        rt.activeArenaMatchKey = null;
    }

    rt.tournamentLoopIsLive = function tournamentLoopIsLive() {
        const preview = window.WorkflowBracketPreview;
        return Boolean(
            preview?.hasState?.()
            || preview?.isRunning?.()
            || preview?.isMatchCycleActive?.()
        );
    }

    rt.startBracketPreview = function startBracketPreview({ force = false, view = null, run = false } = {}) {
        if (!rt.isComputerWorkflow() || !window.WorkflowBracketPreview || !rt.els.previewBracket) return false;
        const state = rt.ensureBracket();
        if (!state) return false;
        rt.clearPreviewVideo();
        if (rt.els.previewEmpty) rt.els.previewEmpty.hidden = true;
        const preview = window.WorkflowBracketPreview;
        // Persist happens only after VO + bracket-advance. A force restart during
        // compose would reload the pre-fight bracket and undo Arena / Powerup / VO.
        const keepExisting = rt.tournamentLoopIsLive() && (!force || preview.isMatchCycleActive?.());
        if (keepExisting) {
            preview.setPowerupSpinEnabled?.(rt.isPowerupSpinEnabled());
            preview.resize();
            rt.setTournamentPresentationPhase(preview.getPhase?.());
            if (run && !preview.isRunning()) preview.resume?.();
            return true;
        }
        rt.els.previewBracket.hidden = false;
        if (rt.els.previewArena) rt.els.previewArena.hidden = true;
        preview.start(state, {
            initialView: view,
            powerupSpin: rt.isPowerupSpinEnabled(),
            autorun: run === true,
        });
        if (run && !preview.isRunning()) preview.resume?.();
        if (rt.els.previewFile) rt.els.previewFile.textContent = rt.bracketSummary() || 'Bracket ready';
        return true;
    }

    rt.bracketSummary = function bracketSummary(state = rt.bracketState) {
        if (!state?.fighters?.length) return '';
        const n = state.fighters.length;
        const pending = window.WorkflowBracket?.listPendingMatches?.(state)?.length ?? 0;
        if (state.complete && state.champion) return `${n} · ${state.champion.name} wins`;
        return `${n} · ${pending} match${pending === 1 ? '' : 'es'}`;
    }

    rt.matchComposeSummary = function matchComposeSummary() {
        const n = rt.matchComposeStore?.size || 0;
        if (!n) return '';
        return `${n} VO`;
    }

    rt.isPowerupSpinEnabled = function isPowerupSpinEnabled() {
        return window.ArenaSetup?.getTournamentOptions?.()?.powerupSpin === true;
    }

    rt.tournamentNodeForPhase = function tournamentNodeForPhase(phase = rt.tournamentPhase) {
        if (phase === 'powerup-spin') return 'powerup';
        if (phase === 'arena') return 'record';
        if (phase === 'compose') return 'compose';
        return 'bracket';
    }

    rt.liveTournamentBracket = function liveTournamentBracket() {
        return window.WorkflowBracketPreview?.getBracketState?.() || rt.bracketState;
    }

    rt.tournamentProgressCounts = function tournamentProgressCounts(phase = rt.tournamentPhase) {
        const WB = window.WorkflowBracket;
        if (!WB?.tournamentCellProgress) {
            return { total: 0, bracket: 0, powerup: 0, arena: 0, compose: 0 };
        }
        return WB.tournamentCellProgress({
            state: rt.liveTournamentBracket(),
            composeCount: rt.matchComposeStore?.size || 0,
            phase: phase || window.WorkflowBracketPreview?.getPhase?.() || null,
        });
    }

    rt.isLongBracketComplete = function isLongBracketComplete() {
        if (!rt.isComputerWorkflow() || !window.WorkflowBracket?.isTournamentComplete) return false;
        return window.WorkflowBracket.isTournamentComplete(
            rt.bracketState,
            rt.matchComposeStore?.size || 0
        );
    }

    rt.isLongTournamentComplete = function isLongTournamentComplete() {
        return rt.isLongBracketComplete() && Boolean(rt.tournamentMedia.finalReady && rt.tournamentMedia.final);
    }

    rt.applyTournamentMediaStatus = function applyTournamentMediaStatus(tourney) {
        if (!tourney || typeof tourney !== 'object') return;
        const progressMsg = typeof tourney.progress?.message === 'string'
            ? tourney.progress.message
            : null;
        rt.tournamentMedia = {
            finalReady: Boolean(tourney.finalReady),
            final: tourney.final || null,
            previewReady: Boolean(tourney.previewReady),
            preview: tourney.preview || null,
            doneSegmentCount: Number(tourney.doneSegmentCount) || 0,
            segmentCount: Number(tourney.segmentCount) || 0,
            status: tourney.manifest?.status || tourney.status || null,
            error: tourney.manifest?.error || tourney.error || null,
            progress: progressMsg,
        };
        if (progressMsg && progressMsg !== rt.lastProgressMsg) {
            rt.lastProgressMsg = progressMsg;
            rt.log(progressMsg);
        }
    }

    rt.syncTournamentPhaseState = function syncTournamentPhaseState(phase = rt.tournamentPhase) {
        if (!rt.isComputerWorkflow()) return;
        const ready = rt.isPipelineReady(rt.setupReady);
        const tournamentDone = rt.isLongTournamentComplete();
        const bracketDone = rt.isLongBracketComplete();
        const activeNode = tournamentDone ? null : rt.tournamentNodeForPhase(phase);
        const progress = rt.tournamentProgressCounts(phase);
        const activeStatus = phase === 'arena'
            ? 'Running current matchup…'
            : phase === 'powerup-spin'
                ? 'Spinning powerup wheels…'
            : phase === 'compose'
                ? 'Recording + narrating match segment…'
                : phase === 'bracket-advance'
                    ? 'Updating bracket…'
                    : phase === 'bracket-hold'
                        ? 'Showing updated bracket…'
                    : phase === 'champion' || bracketDone
                        ? (tournamentDone ? 'Champion · final ready' : 'Stitching full video…')
                        : 'Matchup ready';
        const spinOn = rt.isPowerupSpinEnabled();
        const labels = {
            record: 'Arena',
            bracket: 'Bracket',
            compose: 'Voice Over',
            powerup: 'Powerup',
        };
        const counts = {
            record: progress.arena,
            bracket: progress.bracket,
            compose: progress.compose,
            powerup: progress.powerup,
        };
        WorkflowGraph.setActionPressed?.('powerup', 'toggle-powerup', spinOn);
        for (const nodeId of ['record', 'bracket', 'compose', 'powerup']) {
            if (nodeId === 'powerup' && !spinOn) {
                WorkflowGraph.setNodeSkipped?.('powerup', true);
                WorkflowGraph.setNodeState('powerup', null);
                WorkflowGraph.getNodeEl('powerup')?.classList.remove('is-previewing');
                WorkflowGraph.clearNodeProgress?.('powerup');
                WorkflowGraph.setNodeFile('powerup', '', true);
                WorkflowGraph.setNodeStatus('powerup', 'Off');
                continue;
            }
            WorkflowGraph.setNodeSkipped?.(nodeId, false);
            const active = ready && !tournamentDone && nodeId === activeNode;
            const count = counts[nodeId];
            const total = progress.total;
            let state = 'locked';
            if (ready) {
                if (tournamentDone || (total > 0 && count >= total && !active)) state = 'done';
                else if (active) state = 'active';
                else state = null;
            }
            WorkflowGraph.setNodeState(nodeId, state);
            WorkflowGraph.getNodeEl(nodeId)?.classList.toggle('is-previewing', active);
            if (ready && total > 0) {
                WorkflowGraph.setNodeProgress(nodeId, count, total, { label: labels[nodeId] });
                WorkflowGraph.setNodeFile(nodeId, '', true);
            } else {
                WorkflowGraph.clearNodeProgress?.(nodeId);
            }
            WorkflowGraph.setNodeStatus(
                nodeId,
                active ? activeStatus : (bracketDone && nodeId === 'compose' && !tournamentDone
                    ? (rt.tournamentMedia.error || 'Stitching…')
                    : (tournamentDone && nodeId === 'bracket' ? activeStatus : '')),
                active ? 'busy' : (rt.tournamentMedia.error && nodeId === 'compose' ? 'error'
                    : (tournamentDone && nodeId === 'bracket' ? 'success' : ''))
            );
        }
        const groupState = !ready
            ? 'locked'
            : tournamentDone
                ? 'done'
                : null;
        WorkflowGraph.setGroupState?.('tournament', groupState);
        const group = WorkflowGraph.getGroupEl?.('tournament');
        const sub = group?.querySelector('.wf-group-sub');
        if (sub) {
            if (tournamentDone) sub.textContent = `Final video ready · ${rt.tournamentMedia.final}`;
            else if (rt.tournamentMedia.error && bracketDone) sub.textContent = 'Final stitch failed · reload to retry';
            else if (rt.tournamentMedia.error) sub.textContent = 'Segment failed · retry Step';
            else if (bracketDone) sub.textContent = 'Champion set · stitching full video…';
            else sub.textContent = spinOn
                ? 'BracketState → PowerupSpin → ArenaResult → MatchSegment · until champion'
                : 'BracketState → ArenaResult → MatchSegment · powerup off';
        }
    }
}());
