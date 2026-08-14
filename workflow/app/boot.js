/**
 * Workflow app — boot: wire DOM, mount preview, start poll loop.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.els.formScript = document.getElementById('form-script');
    rt.els.formCaption = document.getElementById('form-caption');

    rt.els.formScript?.addEventListener('submit', (e) => {
        e.preventDefault();
        rt.scriptText = rt.els.inputScript?.value || '';
        rt.scriptDirty = true;
        rt.closeModal(rt.els.modalScript);
        WorkflowGraph.setNodeStatus('compose', 'Script saved', 'success');
    });

    rt.els.formCaption?.addEventListener('submit', (e) => {
        e.preventDefault();
        rt.caption = {
            title: rt.els.inputTitle?.value || '',
            description: rt.els.inputDescription?.value || '',
            privacy: rt.els.inputPrivacy?.value || 'public',
        };
        rt.captionDirty = true;
        rt.closeModal(rt.els.modalCaption);
        WorkflowGraph.setNodeStatus('youtube', 'Caption saved', 'success');
    });

    rt.els.btnReloadScript?.addEventListener('click', () => rt.handleAction('reload-script', 'compose'));
    rt.els.btnReloadCaption?.addEventListener('click', () => rt.handleAction('reload-caption', 'youtube'));
    rt.els.btnZoomIn?.addEventListener('click', () => rt.zoomCanvasBy(1.15));
    rt.els.btnZoomOut?.addEventListener('click', () => rt.zoomCanvasBy(1 / 1.15));
    rt.els.btnClearAll?.addEventListener('click', rt.handleClearAll);
    rt.els.btnRestart?.addEventListener('click', rt.handleRestart);
    rt.els.btnSaveMatchup?.addEventListener('click', rt.saveMatchup);

    rt.els.switcher?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-wf]');
        if (!btn || btn.classList.contains('is-active')) return;
        rt.switchWorkflow(btn.dataset.wf);
    });

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', () => rt.closeModal(btn.closest('dialog')));
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'arena-recording-saved') rt.refreshPipeline();
    });

    WorkflowGraph.setWorkflow(rt.resolveInitialWorkflowId());
    rt.syncWorkflowChrome();
    rt.setupReady = rt.loadSetupReady();
    WorkflowGraph.render(rt.els.canvas);
    rt.bindCanvas();
    if (rt.els.previewBracket && window.WorkflowBracketPreview) {
        window.WorkflowBracketPreview.mount(rt.els.previewBracket, {
            onStatus(text) {
                if (rt.isComputerWorkflow() && text) {
                    if (rt.els.previewFile) rt.els.previewFile.textContent = text;
                    rt.log(text);
                }
            },
            onMatchCompose(payload) {
                return rt.ensureMatchCompose(payload);
            },
            onArenaMatch(payload) {
                // Always restart the pair when the preview enters/resyncs Arena.
                // Otherwise a paused leftover sim (same match key) never resumes.
                const pair = rt.activateArenaMatch(payload.match, { force: true });
                if (rt.tournamentPhase === 'arena' && pair) {
                    WorkflowGraph.setNodeStatus('record', `${pair[0].config?.name || payload.match.a.name} vs ${pair[1].config?.name || payload.match.b.name}`, 'busy');
                }
            },
            getArenaResult(payload) {
                try {
                    return rt.readArenaResult(payload);
                } catch (err) {
                    console.warn('arena result poll failed', err);
                    return null;
                }
            },
            onBracketChange(nextState) {
                rt.persistBracket(nextState);
                if (rt.pipeline) rt.updateUI(rt.pipeline);
                else rt.syncTournamentPhaseState(rt.tournamentPhase);
                if (nextState?.complete) {
                    rt.stitchTournamentFinal().catch(() => {});
                }
            },
            onPhaseChange(next) {
                rt.tournamentPhase = next.phase;
                rt.setTournamentPresentationPhase(next.phase);
                if (next.phase) rt.log(`step: ${next.phase}`);
                if (next.phase === 'arena') window.ArenaApp?.run?.();
                rt.syncTournamentPhaseState(next.phase);
                if (next.phase === 'champion') {
                    rt.stitchTournamentFinal()
                        .then(() => { if (rt.pipeline) rt.updateUI(rt.pipeline); })
                        .catch(() => {});
                }
            },
        });
        window.addEventListener('resize', () => {
            if (rt.isComputerWorkflow()) window.WorkflowBracketPreview.resize();
        });
    }

    window.WorkflowTournamentDebug = {
        getFightEvidence() {
            return rt.tournamentFightEvidence.map((entry) => ({
                ...entry,
                fighters: entry.fighters.map((fighter) => ({ ...fighter })),
            }));
        },
    };
    rt.bracketState = rt.loadPersistedBracket();
    rt.migrateTournamentRoster();
    if (rt.isComputerWorkflow() && rt.isMatchupReady(rt.setupReady)) {
        rt.ensureBracket();
        rt.previewNode = 'record';
    }
    window.ArenaApp?.whenReady?.().then(() => {
        rt.restoreWorkflowMatchup();
        window.ArenaSetup?.refreshForWorkflow?.();
        if (rt.tournamentPhase !== 'arena') window.ArenaApp.pause?.();
    });
    rt.loadQuota();
    rt.refreshPipeline();
    rt.syncPhoneSetup();
    setInterval(rt.refreshPipeline, rt.POLL_MS);
}());
