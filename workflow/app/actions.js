/**
 * Workflow app — Actions, modals, clear/restart.
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.setBusy = function setBusy(next) {
        rt.busy = Boolean(next);
        if (rt.els.btnClearAll) rt.els.btnClearAll.disabled = rt.busy;
        if (rt.els.btnRestart) rt.els.btnRestart.disabled = rt.busy;
        if (rt.pipeline) rt.updateUI(rt.pipeline);
    }

    rt.handleClearAll = function handleClearAll() {
        if (rt.busy) return;
        rt.runRedo('setup');
    }

    rt.handleRestart = async function handleRestart() {
        if (rt.busy) return;
        rt.log('restarting workflow UI…');
        rt.scriptDirty = false;
        rt.captionDirty = false;
        rt.scriptText = '';
        rt.caption = { title: '', description: '', privacy: 'public' };
        if (rt.els.inputScript) rt.els.inputScript.value = '';
        if (rt.els.inputTitle) rt.els.inputTitle.value = '';
        if (rt.els.inputDescription) rt.els.inputDescription.value = '';
        if (rt.els.inputPrivacy) rt.els.inputPrivacy.value = 'public';
        rt.previewNode = rt.isPipelineReady(rt.setupReady) ? 'record' : (rt.isMatchupReady(rt.setupReady) && rt.hasIntroNode() ? 'intro' : 'setup');
        rt.clearPreviewVideo();
        if (!rt.isComputerWorkflow()) rt.stopBracketPreview();
        rt.pipelineEpoch += 1;
        await rt.refreshPipeline({ force: true });
        if (rt.pipeline?.active?.raw) await rt.loadDraftScript(rt.pipeline.active.raw);
        if (rt.pipeline?.active?.composed) await rt.loadDraftCaption(rt.pipeline.active.composed);
        rt.showPreview(rt.previewNode, { forceReload: true });
        rt.log('workflow restarted');
    }

    rt.runCompose = async function runCompose() {
        const rawName = rt.pipeline?.active?.raw;
        const script = (rt.els.inputScript?.value || rt.scriptText).trim();
        if (!rawName || !script) return;
    
        rt.setBusy(true);
        WorkflowGraph.setNodeStatus('compose', 'Composing…', 'busy');
        rt.log(`compose ${rawName}…`);
    
        try {
            const result = await rt.apiPost('/api/compose', { file: rawName, script });
            rt.scriptText = script;
            rt.scriptDirty = false;
            WorkflowGraph.setNodeStatus('compose', `→ ${result.composed}`, 'success');
            rt.log(`composed: ${result.composed}`);
            rt.previewNode = 'compose';
            rt.setBusy(false);
            rt.pipelineEpoch += 1;
            if (result.pipeline) rt.updateUI(result.pipeline);
            else await rt.refreshPipeline({ force: true });
            await rt.loadDraftCaption(result.composed);
            if (rt.pipeline) rt.updateUI(rt.pipeline);
        } catch (err) {
            WorkflowGraph.setNodeStatus('compose', err.message, 'error');
            rt.log(`compose failed: ${err.message}`);
        } finally {
            rt.setBusy(false);
            await rt.refreshPipeline({ force: true });
        }
    }

    rt.runUpload = async function runUpload() {
        const composedName = rt.pipeline?.active?.composed
            || (rt.isComputerWorkflow() ? rt.tournamentMedia.final : null);
        const title = (rt.els.inputTitle?.value || rt.caption.title).trim();
        const description = (rt.els.inputDescription?.value || rt.caption.description).trim();
        if (!composedName || !title) return;
    
        rt.setBusy(true);
        WorkflowGraph.setNodeStatus('youtube', 'Uploading…', 'busy');
        rt.log(`upload ${composedName}…`);
    
        try {
            const result = await rt.apiPost('/api/upload', {
                file: composedName,
                title,
                description,
                privacy: rt.els.inputPrivacy?.value || rt.caption.privacy,
            });
            rt.caption = { title, description, privacy: rt.els.inputPrivacy?.value || rt.caption.privacy };
            rt.captionDirty = false;
            WorkflowGraph.setNodeStatus('youtube', 'Posted!', 'success');
            rt.log(`posted: ${result.shortsUrl}`);
            rt.previewNode = 'youtube';
            rt.setBusy(false);
            rt.pipelineEpoch += 1;
            if (result.pipeline) rt.updateUI(result.pipeline);
            else await rt.refreshPipeline({ force: true });
        } catch (err) {
            WorkflowGraph.setNodeStatus('youtube', err.message, 'error');
            rt.log(`upload failed: ${err.message}`);
        } finally {
            rt.setBusy(false);
            await rt.refreshPipeline({ force: true });
        }
    }

    rt.openModal = function openModal(dialog) {
        if (!dialog) return;
        if (dialog === rt.els.modalSetup) {
            if (rt.isComputerWorkflow()) rt.restoreTournamentRoster();
            window.ArenaSetup?.refreshForWorkflow?.();
        }
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    }

    rt.closeModal = function closeModal(dialog) {
        if (!dialog) return;
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
        if (dialog === rt.els.modalSetup && rt.isComputerWorkflow()) {
            rt.activateArenaMatch();
        }
    }

    rt.runRedo = async function runRedo(nodeId) {
        if (!rt.canRedoStep(nodeId, rt.pipeline)) return;
        if (!window.confirm(rt.redoConfirmMessage(nodeId))) return;
    
        rt.setBusy(true);
        WorkflowGraph.setNodeStatus(nodeId, 'Reverting…', 'busy');
        rt.log(`redo ${nodeId}…`);
    
        try {
            if (nodeId === 'setup') {
                rt.clearSetupReady();
                rt.stopBracketPreview();
                rt.persistBracket(null);
                rt.persistTournamentRoster(null);
                rt.clearMatchComposes();
            }
            if (nodeId === 'intro') rt.clearIntroReady();
            if (nodeId === 'record' && rt.isComputerWorkflow()) {
                rt.clearMatchComposes();
            }
            if (nodeId === 'record' && rt.isComputerWorkflow()) {
                const rebuilt = rt.buildBracketFromMatchup(rt.loadTournamentRoster());
                rt.persistBracket(rebuilt);
                rt.stopBracketPreview();
            }
    
            const hasDownstream = Boolean(
                rt.pipeline?.active?.raw
                || rt.pipeline?.active?.composed
                || rt.pipeline?.stages?.posted?.length
            );
            let result = { pipeline: null };
            if (nodeId === 'setup') {
                if (hasDownstream) {
                    result = await rt.apiPost('/api/redo', { step: 'record' });
                }
            } else if (nodeId === 'intro') {
                // Keep recordings; only clear intro choice locally.
                result = { pipeline: rt.pipeline };
            } else if (nodeId === 'record' && rt.isComputerWorkflow() && !hasDownstream) {
                result = { pipeline: rt.pipeline };
            } else {
                result = await rt.apiPost('/api/redo', { step: nodeId });
            }
    
            if (nodeId === 'setup' || nodeId === 'record') {
                rt.scriptDirty = false;
                rt.captionDirty = false;
                rt.scriptText = '';
                rt.caption = { title: '', description: '', privacy: 'public' };
                if (rt.els.inputScript) rt.els.inputScript.value = '';
                if (rt.els.inputTitle) rt.els.inputTitle.value = '';
                if (rt.els.inputDescription) rt.els.inputDescription.value = '';
                if (rt.els.inputPrivacy) rt.els.inputPrivacy.value = 'public';
            } else if (nodeId === 'compose') {
                rt.captionDirty = false;
                rt.caption = { title: '', description: '', privacy: 'public' };
                if (rt.els.inputTitle) rt.els.inputTitle.value = '';
                if (rt.els.inputDescription) rt.els.inputDescription.value = '';
                if (rt.els.inputPrivacy) rt.els.inputPrivacy.value = 'public';
            }
    
            rt.previewNode = nodeId;
            WorkflowGraph.setNodeStatus(nodeId, 'Reverted', 'success');
            rt.log(`workflow reset to ${rt.nodeLabel(nodeId)}`);
            rt.setBusy(false);
            rt.pipelineEpoch += 1;
            if (result.pipeline) {
                rt.updateUI(result.pipeline);
            } else if (rt.pipeline) {
                rt.updateUI(rt.pipeline);
            } else if (nodeId === 'setup' || nodeId === 'intro') {
                rt.updateUI({
                    active: { raw: null, composed: null },
                    stages: { raw: [], composed: [], posted: [] },
                });
            } else {
                await rt.refreshPipeline({ force: true });
            }
            if (result.pipeline?.active?.raw) {
                await rt.loadDraftScript(result.pipeline.active.raw);
            }
            if (result.pipeline?.active?.composed) {
                await rt.loadDraftCaption(result.pipeline.active.composed);
            }
            if (rt.pipeline) rt.updateUI(rt.pipeline);
            if (nodeId === 'record' && rt.isComputerWorkflow() && rt.isMatchupReady(rt.setupReady)) {
                rt.showPreview('record', { forceReload: true, autoplay: true });
            }
        } catch (err) {
            WorkflowGraph.setNodeStatus(nodeId, err.message, 'error');
            rt.log(`redo failed: ${err.message}`);
        } finally {
            rt.setBusy(false);
            await rt.refreshPipeline({ force: true });
        }
    }

    rt.loadMatchupPayload = function loadMatchupPayload() {
        let mode = 'collision';
        try {
            const savedMode = localStorage.getItem('arena-game-mode');
            if (savedMode === 'weapon' || savedMode === 'collision') mode = savedMode;
        } catch { /* ignore */ }
    
        if (window.ArenaSetup?.getGameMode) {
            mode = window.ArenaSetup.getGameMode() || mode;
        } else if (window.ArenaApp?.getGameMode) {
            mode = window.ArenaApp.getGameMode() || mode;
        }
    
        let matchup = null;
        if (window.ArenaSetup?.getPendingMatchup) {
            matchup = window.ArenaSetup.getPendingMatchup();
        } else if (window.ArenaApp?.getMatchup) {
            matchup = window.ArenaApp.getMatchup();
        }
    
        if (!Array.isArray(matchup) || matchup.length < 2) {
            try {
                const key = mode === 'weapon' ? 'arena-matchup-weapon-v2' : 'arena-matchup-v2';
                const raw = localStorage.getItem(key);
                const parsed = raw ? JSON.parse(raw) : null;
                if (Array.isArray(parsed) && parsed.length >= 2) matchup = parsed;
            } catch { /* ignore */ }
        }
    
        if (!Array.isArray(matchup) || matchup.length < 2) {
            throw new Error('No matchup saved — finish Make setup first');
        }
    
        const payload = { mode, matchup };
        const setup = rt.loadSetupReady();
        if (setup?.introReady) {
            payload.introMode = setup.introMode || 'skip';
            if (payload.introMode !== 'skip') {
                if (payload.introMode === 'default') {
                    const defaults = window.BallIntros?.getDefaultIntroAssignment?.(matchup.length) || [];
                    payload.intros = defaults.length >= 2
                        ? defaults
                        : (Array.isArray(setup.intros) ? setup.intros.slice(0, matchup.length) : []);
                } else if (Array.isArray(setup.intros) && setup.intros.filter(Boolean).length >= 2) {
                    payload.intros = setup.intros.slice(0, matchup.length);
                }
            }
        }
        return payload;
    }

    rt.syncPhoneSetup = async function syncPhoneSetup() {
        if (!rt.isPipelineReady(rt.setupReady)) return;
        try {
            const payload = rt.loadMatchupPayload();
            if (!payload.introMode) payload.introMode = 'skip';
            await rt.apiPost('/api/setup', payload);
        } catch (err) {
            console.warn('setup sync failed', err);
        }
    }

    rt.runOfflineRecord = async function runOfflineRecord() {
        if (!rt.isPipelineReady(rt.setupReady)) {
            const hasRaw = Boolean(rt.pipeline?.active?.raw || rt.pipeline?.stages?.raw?.[0]);
            if (!hasRaw) {
                rt.log('finish Make setup and Make intro before recording');
                if (!rt.isMatchupReady(rt.setupReady)) rt.openModal(rt.els.modalSetup);
                return;
            }
        }
    
        let payload;
        try {
            payload = rt.loadMatchupPayload();
        } catch (err) {
            WorkflowGraph.setNodeStatus('record', err.message, 'error');
            rt.log(err.message);
            rt.openModal(rt.els.modalSetup);
            return;
        }
    
        rt.setBusy(true);
        WorkflowGraph.setNodeStatus('record', 'Fast forwarding…', 'busy');
        rt.log(`fast forward (${payload.mode}, ${payload.matchup.length} fighters)…`);
    
        try {
            const result = await rt.apiPost('/api/offline-record', payload);
            WorkflowGraph.setNodeStatus('record', `→ ${result.file}`, 'success');
            rt.log(`fast forward done: ${result.file}${result.winner ? ` — ${result.winner} wins` : ''}${result.hasIntro ? ' (with VS intro)' : ''}`);
            rt.previewNode = 'record';
            rt.setBusy(false);
            rt.pipelineEpoch += 1;
            if (result.pipeline) rt.updateUI(result.pipeline);
            else await rt.refreshPipeline({ force: true });
            if (rt.pipeline?.active?.raw) await rt.loadDraftScript(rt.pipeline.active.raw);
            if (rt.pipeline) rt.updateUI(rt.pipeline);
            rt.showPreview('record', { forceReload: true });
        } catch (err) {
            WorkflowGraph.setNodeStatus('record', err.message, 'error');
            rt.log(`fast forward failed: ${err.message}`);
        } finally {
            rt.setBusy(false);
            await rt.refreshPipeline({ force: true });
        }
    }

    rt.refreshAfterIntroChange = function refreshAfterIntroChange(message) {
        WorkflowGraph.setNodeStatus('intro', message, 'success');
        rt.log(message);
        const state = rt.pipeline || {
            active: { raw: null, composed: null },
            stages: { raw: [], composed: [], posted: [] },
        };
        rt.updateUI(state);
        rt.syncPhoneSetup();
    }

    rt.requireMatchup = function requireMatchup() {
        if (!window.ArenaSetup) throw new Error('setup UI not ready');
        if (!rt.isMatchupReady(rt.setupReady)) {
            throw new Error('Save the matchup first');
        }
        window.ArenaSetup.applyMatchup();
        return {
            matchup: window.ArenaSetup.getPendingMatchup(),
            mode: window.ArenaSetup.getGameMode(),
        };
    }

    rt.saveMatchup = function saveMatchup() {
        if (!window.ArenaSetup) {
            rt.log('setup UI not ready');
            return;
        }
        try {
            window.ArenaSetup.applyMatchup();
            const matchup = window.ArenaSetup.getPendingMatchup();
            const mode = window.ArenaSetup.getGameMode();
            rt.saveSetupReady({
                matchupReady: true,
                introReady: rt.isComputerWorkflow() ? true : false,
                introMode: rt.isComputerWorkflow() ? 'skip' : null,
                mode,
                count: matchup.length,
                intros: [],
                at: Date.now(),
            });
            rt.closeModal(rt.els.modalSetup);
            WorkflowGraph.setNodeStatus('setup', 'Matchup saved', 'success');
    
            if (rt.isComputerWorkflow()) {
                rt.persistTournamentRoster(matchup);
                const built = rt.buildBracketFromMatchup(matchup);
                if (!built) {
                    throw new Error('Could not build bracket from fighters');
                }
                rt.clearMatchComposes();
                rt.persistBracket(built);
                rt.log(`tournament saved — ${matchup.length} entrants → bracket (${built.size}-slot)`);
                rt.previewNode = 'bracket';
                rt.updateUI(rt.pipeline || {
                    active: { raw: null, composed: null },
                    stages: { raw: [], composed: [], posted: [] },
                });
                rt.startBracketPreview({ force: true, run: false });
                WorkflowGraph.setNodeStatus('setup', 'Tournament saved', 'success');
            } else {
                rt.log(`matchup saved — ${matchup.length} fighters (${mode})`);
                rt.updateUI(rt.pipeline || {
                    active: { raw: null, composed: null },
                    stages: { raw: [], composed: [], posted: [] },
                });
                WorkflowGraph.setNodeStatus('intro', 'Waiting…', '');
            }
        } catch (err) {
            WorkflowGraph.setNodeStatus('setup', err.message, 'error');
            rt.log(`save matchup failed: ${err.message}`);
        }
    }

    rt.completeIntro = function completeIntro({ introMode, intros = [] }) {
        if (!rt.isMatchupReady(rt.setupReady)) {
            rt.log('save the matchup before making an intro');
            rt.openModal(rt.els.modalSetup);
            return;
        }
        rt.saveSetupReady({
            ...rt.setupReady,
            matchupReady: true,
            introReady: true,
            introMode,
            intros,
            at: Date.now(),
        });
        rt.refreshAfterIntroChange(
            introMode === 'skip'
                ? 'Intro skipped'
                : introMode === 'default'
                    ? 'Default intro ready'
                    : 'Manual intro ready'
        );
    }

    rt.introSkip = function introSkip() {
        try {
            rt.requireMatchup();
            rt.completeIntro({ introMode: 'skip', intros: [] });
        } catch (err) {
            WorkflowGraph.setNodeStatus('intro', err.message, 'error');
            rt.log(err.message);
            if (!rt.isMatchupReady(rt.setupReady)) rt.openModal(rt.els.modalSetup);
        }
    }

    rt.introDefault = async function introDefault() {
        try {
            const { matchup } = rt.requireMatchup();
            const BI = window.BallIntros;
            if (BI?.init) await BI.init();
            const assigned = BI?.getDefaultIntroAssignment?.(matchup.length) || [];
            if (assigned.filter(Boolean).length < 2) {
                throw new Error('Default intros (Sukuna / Gojo) not found in intros/ — add them or use Manual');
            }
            for (const id of assigned) BI.loadIntroImage?.(id);
            rt.completeIntro({ introMode: 'default', intros: assigned });
            await window.WorkflowIntroEditor?.playAssigned?.({ matchup, intros: assigned });
        } catch (err) {
            WorkflowGraph.setNodeStatus('intro', err.message, 'error');
            rt.log(err.message);
            if (!rt.isMatchupReady(rt.setupReady)) rt.openModal(rt.els.modalSetup);
        }
    }

    rt.introManual = function introManual() {
        if (!window.WorkflowIntroEditor) {
            rt.log('intro editor not ready');
            return;
        }
        try {
            const { matchup } = rt.requireMatchup();
            window.WorkflowIntroEditor.open({
                matchup,
                intros: rt.setupReady?.intros || [],
                onDone(result) {
                    rt.completeIntro({ introMode: 'manual', intros: result.intros });
                },
            });
        } catch (err) {
            WorkflowGraph.setNodeStatus('intro', err.message, 'error');
            rt.log(err.message);
            if (!rt.isMatchupReady(rt.setupReady)) rt.openModal(rt.els.modalSetup);
        }
    }

    rt.handleAction = function handleAction(action, nodeId) {
        switch (action) {
            case 'watch':
                rt.showPreview(nodeId, { forceReload: true, autoplay: true });
                break;
            case 'edit-setup':
                rt.openModal(rt.els.modalSetup);
                break;
            case 'intro-skip':
                rt.introSkip();
                break;
            case 'intro-default':
                rt.introDefault();
                break;
            case 'intro-manual':
                rt.introManual();
                break;
            case 'fast-forward':
                rt.runOfflineRecord();
                break;
            case 'preview-fast-forward': {
                if (!rt.isMatchupReady(rt.setupReady)) {
                    rt.log('save fighters before running the tournament');
                    rt.openModal(rt.els.modalSetup);
                    return;
                }
                const preview = window.WorkflowBracketPreview;
                const wasRunning = preview?.isRunning?.();
                if (!rt.startBracketPreview({ run: true })) return;
                if (wasRunning) {
                    const speed = preview.cyclePlaybackRate();
                    window.ArenaApp?.setPreviewPlaybackRate?.(speed);
                    rt.syncTournamentPhaseState();
                    rt.log(`tournament running ${speed}×`);
                } else {
                    preview?.setPlaybackRate?.(1);
                    window.ArenaApp?.setPreviewPlaybackRate?.(1);
                    rt.syncTournamentPhaseState();
                    rt.log('tournament running');
                }
                break;
            }
            case 'toggle-powerup': {
                const next = !rt.isPowerupSpinEnabled();
                window.ArenaSetup?.setTournamentOptions?.({ powerupSpin: next });
                window.WorkflowBracketPreview?.setPowerupSpinEnabled?.(next);
                rt.syncTournamentPhaseState();
                rt.log(next ? 'powerup spins on' : 'powerup spins off');
                break;
            }
            case 'preview-step': {
                if (!rt.isMatchupReady(rt.setupReady)) {
                    rt.log('save fighters before stepping the tournament');
                    rt.openModal(rt.els.modalSetup);
                    return;
                }
                if (!rt.startBracketPreview()) return;
                if (!window.WorkflowBracketPreview.stepOneMatch()) {
                    rt.log('could not step tournament match');
                    return;
                }
                rt.syncTournamentPhaseState();
                rt.log('tournament step — one match + voice-over, then pause');
                break;
            }
            case 'open-arena': {
                if (!rt.isPipelineReady(rt.setupReady)) {
                    rt.log(rt.isComputerWorkflow()
                        ? 'save fighters before opening the arena'
                        : 'finish Make setup and Make intro before opening the arena');
                    if (!rt.isMatchupReady(rt.setupReady)) rt.openModal(rt.els.modalSetup);
                    return;
                }
                const needsRecord = !rt.videoForNode('record', rt.pipeline);
                if (rt.isComputerWorkflow()) rt.activateArenaMatch();
                const qs = new URLSearchParams();
                if (rt.isComputerWorkflow()) {
                    qs.set('view', 'computer');
                    qs.set('from', 'workflow-long');
                }
                if (needsRecord) {
                    if (!rt.isComputerWorkflow()) qs.set('from', 'workflow');
                }
                const q = qs.toString();
                const arenaUrl = q ? `/pages/index.html?${q}` : '/pages/index.html';
                window.open(arenaUrl, '_blank');
                break;
            }
            case 'open-bracket': {
                if (!rt.isPipelineReady(rt.setupReady)) {
                    rt.log('save fighters before opening the bracket');
                    if (!rt.isMatchupReady(rt.setupReady)) rt.openModal(rt.els.modalSetup);
                    return;
                }
                rt.ensureBracket();
                const qs = new URLSearchParams();
                qs.set('from', 'workflow-long');
                window.open(`/pages/bracket.html?${qs}`, '_blank');
                break;
            }
            case 'refresh':
                rt.log('refreshing pipeline…');
                rt.refreshPipeline();
                break;
            case 'run-compose':
                rt.runCompose();
                break;
            case 'edit-script':
                if (nodeId !== 'compose') return;
                if (rt.els.inputScript) rt.els.inputScript.value = rt.scriptText;
                rt.openModal(rt.els.modalScript);
                break;
            case 'reload-script':
                if (nodeId !== 'compose') return;
                rt.scriptDirty = false;
                rt.loadDraftScript(rt.pipeline?.active?.raw).then(() => {
                    WorkflowGraph.setNodeStatus(nodeId, 'Draft reloaded', 'success');
                }).catch((err) => {
                    WorkflowGraph.setNodeStatus(nodeId, err.message, 'error');
                });
                break;
            case 'run-upload':
                rt.runUpload();
                break;
            case 'edit-caption':
                if (rt.els.inputTitle) rt.els.inputTitle.value = rt.caption.title;
                if (rt.els.inputDescription) rt.els.inputDescription.value = rt.caption.description;
                if (rt.els.inputPrivacy) rt.els.inputPrivacy.value = rt.caption.privacy;
                rt.openModal(rt.els.modalCaption);
                break;
            case 'reload-caption':
                rt.captionDirty = false;
                rt.loadDraftCaption(rt.pipeline?.active?.composed).then(() => {
                    WorkflowGraph.setNodeStatus('youtube', 'Draft reloaded', 'success');
                }).catch((err) => {
                    WorkflowGraph.setNodeStatus('youtube', err.message, 'error');
                });
                break;
            case 'redo':
                rt.runRedo(nodeId);
                break;
            default:
                rt.log(`unknown action: ${action}`);
        }
    }

    rt.bindCanvas = function bindCanvas() {
        rt.els.canvas?.addEventListener('click', (e) => {
            const btn = e.target.closest('.wf-act-btn');
            if (!btn || btn.disabled) return;
            e.stopPropagation();
            rt.handleAction(btn.dataset.action, btn.dataset.node);
        });
        rt.bindCanvasViewport();
    }
}());
