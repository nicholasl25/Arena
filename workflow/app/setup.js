/**
 * Workflow app — Setup / intro ready + matchup persist.
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.resolveInitialWorkflowId = function resolveInitialWorkflowId() {
        const fromUrl = new URLSearchParams(window.location.search).get('wf');
        if (fromUrl && WorkflowGraph.WORKFLOWS[fromUrl]) return fromUrl;
        try {
            const stored = localStorage.getItem(rt.WF_STORAGE_KEY);
            if (stored && WorkflowGraph.WORKFLOWS[stored]) return stored;
        } catch { /* ignore */ }
        return 'shorts';
    }

    rt.isComputerWorkflow = function isComputerWorkflow() {
        return WorkflowGraph.getWorkflow()?.arenaView === 'computer';
    }

    rt.hasIntroNode = function hasIntroNode() {
        return WorkflowGraph.nodeById.has('intro');
    }

    rt.isFutureNode = function isFutureNode(id) {
        return Boolean(WorkflowGraph.nodeById.get(id)?.future);
    }

    rt.syncWorkflowChrome = function syncWorkflowChrome() {
        const wf = WorkflowGraph.getWorkflow();
        if (!wf) return;
        if (rt.els.title) rt.els.title.textContent = wf.title;
        if (rt.els.subtitle) rt.els.subtitle.textContent = wf.subtitle;
        document.title = wf.title;
        document.body.dataset.workflow = wf.id;
        rt.els.switcher?.querySelectorAll('[data-wf]').forEach((btn) => {
            const on = btn.dataset.wf === wf.id;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    rt.persistWorkflowId = function persistWorkflowId(id) {
        try {
            localStorage.setItem(rt.WF_STORAGE_KEY, id);
        } catch { /* ignore */ }
        const url = new URL(window.location.href);
        if (id === 'shorts') url.searchParams.delete('wf');
        else url.searchParams.set('wf', id);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    rt.switchWorkflow = function switchWorkflow(id) {
        if (!WorkflowGraph.setWorkflow(id)) return;
        rt.persistWorkflowId(id);
        rt.syncWorkflowChrome();
        rt.setupReady = rt.loadSetupReady(id);
        rt.restoreWorkflowMatchup();
        window.ArenaSetup?.refreshForWorkflow?.();
        WorkflowGraph.render(rt.els.canvas);
        rt.resetCanvasView();
        if (!rt.isComputerWorkflow()) rt.stopBracketPreview();
        else if (rt.isMatchupReady(rt.setupReady)) rt.ensureBracket();
        rt.previewNode = rt.isPipelineReady(rt.setupReady) ? 'record' : (rt.isMatchupReady(rt.setupReady) && rt.hasIntroNode() ? 'intro' : 'setup');
        if (rt.pipeline) rt.updateUI(rt.pipeline);
        else rt.refreshPipeline({ force: true });
        rt.log(`switched to ${WorkflowGraph.getWorkflow().label}`);
    }

    rt.normalizeSetupReady = function normalizeSetupReady(data) {
        if (!data || typeof data !== 'object') return null;
        if (data.matchupReady != null || data.introReady != null) {
            return {
                matchupReady: Boolean(data.matchupReady),
                introReady: Boolean(data.introReady),
                introMode: data.introMode || null,
                mode: data.mode,
                count: data.count,
                intros: Array.isArray(data.intros) ? data.intros : [],
                at: data.at,
            };
        }
        // Legacy: single ready flag meant matchup + intro done together.
        if (data.ready) {
            const hasIntros = Array.isArray(data.intros) && data.intros.length > 0;
            return {
                matchupReady: true,
                introReady: true,
                introMode: hasIntros ? 'manual' : 'skip',
                mode: data.mode,
                count: data.count,
                intros: hasIntros ? data.intros : [],
                at: data.at,
            };
        }
        return null;
    }

    rt.setupStorageKey = function setupStorageKey(workflowId = WorkflowGraph.getWorkflow()?.id || rt.resolveInitialWorkflowId()) {
        return workflowId === 'long' ? rt.LONG_SETUP_STORAGE_KEY : rt.SETUP_STORAGE_KEY;
    }

    rt.loadSetupReady = function loadSetupReady(workflowId) {
        try {
            const key = rt.setupStorageKey(workflowId);
            const raw = localStorage.getItem(key);
            if (!raw && key === rt.LONG_SETUP_STORAGE_KEY) {
                const roster = JSON.parse(localStorage.getItem(rt.TOURNAMENT_ROSTER_STORAGE_KEY) || 'null');
                if (Array.isArray(roster) && roster.length >= 2) {
                    const migrated = {
                        matchupReady: true,
                        introReady: true,
                        introMode: 'skip',
                        mode: 'weapon',
                        count: roster.length,
                        intros: [],
                        at: Date.now(),
                    };
                    localStorage.setItem(key, JSON.stringify(migrated));
                    return migrated;
                }
            }
            if (!raw) return null;
            return rt.normalizeSetupReady(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    rt.saveSetupReady = function saveSetupReady(data) {
        rt.setupReady = data ? rt.normalizeSetupReady(data) || data : null;
        try {
            const key = rt.setupStorageKey();
            if (rt.setupReady) localStorage.setItem(key, JSON.stringify(rt.setupReady));
            else localStorage.removeItem(key);
        } catch { /* ignore */ }
    }

    rt.clearSetupReady = function clearSetupReady() {
        rt.saveSetupReady(null);
    }

    rt.clearIntroReady = function clearIntroReady() {
        if (!rt.setupReady?.matchupReady) {
            rt.saveSetupReady(null);
            return;
        }
        rt.saveSetupReady({
            ...rt.setupReady,
            introReady: false,
            introMode: null,
            intros: [],
            at: Date.now(),
        });
    }

    rt.isMatchupReady = function isMatchupReady(data = rt.setupReady) {
        return Boolean(data?.matchupReady) || Boolean(data?.ready);
    }

    rt.isIntroReady = function isIntroReady(data = rt.setupReady) {
        return Boolean(data?.introReady);
    }

    rt.isPipelineReady = function isPipelineReady(data = rt.setupReady) {
        if (rt.isComputerWorkflow() && !rt.hasIntroNode()) {
            return rt.isMatchupReady(data);
        }
        return rt.isMatchupReady(data) && rt.isIntroReady(data);
    }

    rt.setupSummary = function setupSummary(data = rt.setupReady) {
        if (!rt.isMatchupReady(data)) return '';
        const count = Number(data.count) || 0;
        const mode = data.mode === 'weapon' ? 'weapon' : 'ball';
        return count ? `${count} · ${mode}` : mode;
    }

    rt.introSummary = function introSummary(data = rt.setupReady) {
        if (!rt.isIntroReady(data)) return '';
        if (data.introMode === 'skip') return 'skipped';
        if (data.introMode === 'default') return 'default';
        if (data.introMode === 'manual') return 'manual';
        return 'ready';
    }

    rt.resolveFighterDisplay = function resolveFighterDisplay(slot, index) {
        const app = window.ArenaApp;
        const id = slot.id;
        const weaponId = typeof slot.config?.weaponId === 'string' && slot.config.weaponId
            ? slot.config.weaponId
            : null;
        const customName = (typeof slot.config?.name === 'string' && slot.config.name.trim())
            ? slot.config.name.trim()
            : '';
        let name = customName;
        if (!name) {
            if (id === '_weapon' && weaponId && app?.weaponDisplayName) {
                name = app.weaponDisplayName(weaponId);
            } else {
                name = app?.defaultNameFor?.(id) || id;
            }
        }
        const color = (typeof slot.config?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(slot.config.color))
            ? slot.config.color
            : (app?.defaultColorFor?.(id, index) || '#888888');
        const skinId = id && id !== '_weapon' ? id : null;
        return {
            id,
            name,
            color,
            slotIndex: index,
            slotKey: `slot-${index}:${id}:${weaponId || ''}`,
            weaponId,
            skinId,
            powerupId: typeof slot.config?.powerupId === 'string' && slot.config.powerupId
                ? slot.config.powerupId
                : null,
            arenaMatchup: {
                id,
                config: { ...(slot.config || {}) },
            },
        };
    }

    rt.cloneMatchup = function cloneMatchup(matchup) {
        return matchup.map((slot) => ({
            id: slot.id,
            config: { ...(slot.config || {}) },
        }));
    }

    rt.persistTournamentRoster = function persistTournamentRoster(matchup) {
        try {
            if (Array.isArray(matchup) && matchup.length >= 2) {
                localStorage.setItem(rt.TOURNAMENT_ROSTER_STORAGE_KEY, JSON.stringify(rt.cloneMatchup(matchup)));
            } else {
                localStorage.removeItem(rt.TOURNAMENT_ROSTER_STORAGE_KEY);
                localStorage.removeItem(rt.TOURNAMENT_ARENA_STORAGE_KEY);
            }
        } catch { /* ignore */ }
    }

    rt.persistTournamentArenaMatchup = function persistTournamentArenaMatchup(mode, matchup) {
        try {
            localStorage.setItem(rt.TOURNAMENT_ARENA_STORAGE_KEY, JSON.stringify({
                mode,
                matchup: rt.cloneMatchup(matchup),
            }));
        } catch { /* ignore */ }
    }

    rt.loadTournamentRoster = function loadTournamentRoster() {
        try {
            const raw = localStorage.getItem(rt.TOURNAMENT_ROSTER_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed) && parsed.length >= 2) return rt.cloneMatchup(parsed);
        } catch { /* ignore */ }
        if (rt.bracketState?.fighters?.length >= 2 && window.WorkflowBracket?.fighterArenaMatchup) {
            return rt.bracketState.fighters
                .map(window.WorkflowBracket.fighterArenaMatchup)
                .filter(Boolean);
        }
        return null;
    }

    rt.restoreWorkflowMatchup = function restoreWorkflowMatchup() {
        if (!window.ArenaApp) return;
        if (rt.isComputerWorkflow()) {
            const roster = rt.loadTournamentRoster();
            if (!roster?.length) return;
            const mode = rt.setupReady?.mode === 'collision' ? 'collision' : 'weapon';
            window.ArenaApp.setGameMode(mode, { persist: false });
            window.ArenaApp.setMatchup(roster, { persist: false });
            rt.activeArenaMatchKey = null;
            return;
        }
        try {
            const savedMode = localStorage.getItem('arena-game-mode');
            const mode = savedMode === 'weapon' ? 'weapon' : 'collision';
            const key = mode === 'weapon' ? 'arena-matchup-weapon-v2' : 'arena-matchup-v2';
            const matchup = JSON.parse(localStorage.getItem(key) || 'null');
            window.ArenaApp.setGameMode(mode, { persist: false });
            if (Array.isArray(matchup) && matchup.length >= 2) {
                window.ArenaApp.setMatchup(matchup, { persist: false });
            }
        } catch { /* ignore */ }
    }
}());
