/**
 * Desktop-only iPhone-view recorder — lives in the invisible area (#record-panel).
 * Saves to a user-chosen recordings folder via the File System Access API (Chrome/Edge).
 * Depends: ArenaApp (arena/app/*), hidden on phone layout via CSS.
 */
(function () {
    'use strict';

    const panel = document.getElementById('record-panel');
    const statusEl = document.getElementById('record-status');
    const hintEl = document.getElementById('record-hint');
    const timerEl = document.getElementById('record-timer');
    const prepareBtn = document.getElementById('btn-record-prepare');
    const recordBtn = document.getElementById('btn-record-restart');
    const stopBtn = document.getElementById('btn-record-stop');
    const doneBtn = document.getElementById('btn-record-done');
    const rerecordBtn = document.getElementById('btn-record-rerecord');
    const panelTitleEl = document.getElementById('record-panel-title');

    if (!panel || !recordBtn) return;

    const IDB_NAME = 'arena-recordings';
    const IDB_STORE = 'handles';
    const IDB_KEY = 'recordings-dir';
    const params = new URLSearchParams(window.location.search);
    const isComputerView = params.get('view') === 'computer'
        || document.body.classList.contains('arena-computer');
    const viewLabel = isComputerView ? 'Computer view' : 'Phone view';
    const fromWorkflow = params.get('from'); // 'workflow' | 'workflow-long' | null

    if (panelTitleEl) {
        panelTitleEl.textContent = isComputerView ? 'Record Computer View' : 'Record iPhone View';
    }
    panel.setAttribute('aria-label', isComputerView ? 'Computer view recorder' : 'iPhone view recorder');

    const supportsCropTarget = typeof window.CropTarget !== 'undefined'
        && typeof window.CropTarget.fromElement === 'function';
    const supportsFileSystemAccess = typeof window.showDirectoryPicker === 'function';

    let mediaRecorder = null;
    let displayStream = null;
    let chunks = [];
    let timerId = 0;
    let fightPollId = 0;
    let startedAt = 0;
    /** @type {string[]} */
    let recordingFighterIds = [];
    let recordedWithIntro = false;
    /** @type {FileSystemDirectoryHandle | null} */
    let recordingsDir = null;
    /** @type {{ rawDir: FileSystemDirectoryHandle, filename: string, metaFilename?: string|null } | null} */
    let lastSavedRecording = null;

    function setHint() {
        if (!hintEl) return;
        if (!supportsFileSystemAccess) {
            hintEl.textContent = 'Chrome or Edge required to save recordings.';
            return;
        }
        const captureNote = supportsCropTarget
            ? 'Share this tab once with Prepare — it stays active until you stop sharing or close the tab.'
            : 'Canvas-only in this browser (no share prompt).';
        hintEl.textContent = `${viewLabel} → recordings/raw/. ${captureNote} Pick the recordings folder (not raw/ itself).`;
    }

    function openedFromWorkflow() {
        return fromWorkflow === 'workflow' || fromWorkflow === 'workflow-long';
    }

    function returnToWorkflow() {
        if (!openedFromWorkflow()) return;
        if (window.opener && !window.opener.closed) {
            window.opener.focus();
            window.close();
            return;
        }
        const wf = fromWorkflow === 'workflow-long' ? 'long' : 'shorts';
        window.location.href = `/pages/workflow.html?wf=${wf}`;
    }

    function setStatus(text) {
        if (!statusEl) return;
        const msg = text || '';
        statusEl.textContent = msg;
        statusEl.hidden = !msg;
    }

    function formatElapsed(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${String(sec).padStart(2, '0')}`;
    }

    function syncButtons(recording) {
        recordBtn.disabled = recording;
        recordBtn.textContent = recording ? 'Recording…' : 'Record & restart';
        if (stopBtn) stopBtn.disabled = !recording;
        if (prepareBtn) prepareBtn.disabled = recording;
    }

    function syncPostSave(saved) {
        if (doneBtn) doneBtn.disabled = !saved;
        if (rerecordBtn) rerecordBtn.disabled = !saved;
    }

    function syncCaptureReady(ready) {
        if (!prepareBtn) return;
        prepareBtn.classList.toggle('record-btn-ready', ready);
        prepareBtn.textContent = ready ? 'Screen capture ready' : 'Prepare screen capture';
    }

    function attachStreamLifecycle(stream) {
        for (const track of stream.getTracks()) {
            track.addEventListener('ended', () => {
                if (displayStream !== stream) return;
                displayStream = null;
                syncCaptureReady(false);
                if (!mediaRecorder) setStatus('Screen capture stopped — prepare again before recording.');
            });
        }
    }

    function clearTimer() {
        if (timerId) {
            clearInterval(timerId);
            timerId = 0;
        }
        if (timerEl) timerEl.textContent = '';
    }

    function clearFightPoll() {
        if (fightPollId) {
            clearInterval(fightPollId);
            fightPollId = 0;
        }
    }

    function streamIsLive() {
        if (!displayStream) return false;
        const [track] = displayStream.getVideoTracks();
        return Boolean(track && track.readyState === 'live');
    }

    function captureTargetElement() {
        return isComputerView
            ? document.getElementById('arena-presentation')
            : document.querySelector('.page');
    }

    function captureBounds() {
        const rect = captureTargetElement()?.getBoundingClientRect();
        if (!rect) return null;
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        };
    }

    function stopTracks() {
        if (!displayStream) return;
        for (const track of displayStream.getTracks()) track.stop();
        displayStream = null;
    }

    function pickMimeType() {
        const candidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ];
        for (const type of candidates) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return '';
    }

    function waitFrames(count) {
        return new Promise((resolve) => {
            let remaining = count;
            function step() {
                remaining -= 1;
                if (remaining <= 0) resolve();
                else requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
        });
    }

    function slugify(id) {
        return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    /** Id used in the recording filename — must resolve to a readable name in the pipeline. */
    function recordingIdForSlot(slot) {
        const mode = window.ArenaApp?.getGameMode?.() || window.ArenaSetup?.getGameMode?.();
        if (mode !== 'weapon') return slot.id;

        const customName = typeof slot.config?.name === 'string' ? slot.config.name.trim() : '';
        if (customName) return customName;

        const defaultSkin = window.ArenaApp?.defaultWeaponSkinId?.() || '_weapon';
        if (slot.id === defaultSkin) {
            const weaponId = slot.config?.weaponId;
            if (typeof weaponId === 'string' && weaponId && weaponId !== 'none') return weaponId;
            return window.ArenaApp?.defaultWeaponFor?.() || 'sword';
        }
        return slot.id;
    }

    function fighterIdsFromSetup() {
        const matchup = window.ArenaSetup?.getPendingMatchup?.();
        if (!Array.isArray(matchup) || matchup.length < 2) {
            throw new Error('Need at least two fighters in match setup.');
        }
        return matchup.map((slot) => recordingIdForSlot(slot));
    }

    function applySetupMatchup() {
        if (!window.ArenaSetup?.applyMatchup) {
            throw new Error('Match setup panel is not available.');
        }
        window.ArenaSetup.applyMatchup();
    }

    function buildBaseName(fighterIds) {
        const base = fighterIds.map(slugify).filter(Boolean).join('-vs-');
        const mode = window.ArenaApp?.getGameMode?.() || window.ArenaSetup?.getGameMode?.();
        if (mode === 'weapon') return `weapon-${base}`;
        return base;
    }

    function openIdb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(IDB_NAME, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(IDB_STORE);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function loadSavedDirHandle() {
        try {
            const db = await openIdb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch {
            return null;
        }
    }

    async function persistDirHandle(handle) {
        const db = await openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function verifyDirPermission(handle) {
        if (!handle) return false;
        const current = await handle.queryPermission({ mode: 'readwrite' });
        if (current === 'granted') return true;
        if (current !== 'prompt') return false;
        const requested = await handle.requestPermission({ mode: 'readwrite' });
        return requested === 'granted';
    }

    async function pickRecordingsDir() {
        if (!supportsFileSystemAccess) {
            throw new Error('Use Chrome or Edge to save recordings to a folder.');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        recordingsDir = handle;
        await persistDirHandle(handle);
        return handle;
    }

    async function ensureRecordingsDir() {
        // Prefer the in-memory handle so we can requestPermission while the
        // click gesture is still valid (any prior await breaks that).
        if (recordingsDir && await verifyDirPermission(recordingsDir)) {
            return recordingsDir;
        }

        if (!recordingsDir) {
            const saved = await loadSavedDirHandle();
            if (saved) recordingsDir = saved;
            if (recordingsDir && await verifyDirPermission(recordingsDir)) {
                return recordingsDir;
            }
        }

        setStatus('Choose your recordings folder…');
        return pickRecordingsDir();
    }

    async function fileExists(dirHandle, filename) {
        try {
            await dirHandle.getFileHandle(filename);
            return true;
        } catch (err) {
            if (err?.name === 'NotFoundError') return false;
            throw err;
        }
    }

    async function resolveFilename(dirHandle, baseName) {
        let candidate = `${baseName}.webm`;
        if (!(await fileExists(dirHandle, candidate))) return candidate;

        let version = 2;
        while (version < 10000) {
            candidate = `${baseName}-${version}.webm`;
            if (!(await fileExists(dirHandle, candidate))) return candidate;
            version += 1;
        }
        throw new Error('Too many versions of this recording already exist.');
    }

    const WIN_SCREEN_HOLD_MS = 2800;

    function captureWinnerMeta() {
        const sim = window.ArenaApp?.getSim?.();
        if (!sim?.finished) return null;
        if (!sim.winner) return { draw: true };
        const label = window.ArenaApp?.resolveWinnerLabel?.(sim);
        const name = label
            || (typeof sim.winner.name === 'string' ? sim.winner.name.trim() : '');
        if (!name) return { draw: true };
        return { winner: name, draw: false, isTeam: Boolean(sim.winnerIsTeam) };
    }

    async function writeJsonFile(dirHandle, filename, data) {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(`${JSON.stringify(data, null, 2)}\n`);
        await writable.close();
    }

    async function ensureRawSubdir(dirHandle) {
        // User may have already picked the raw/ folder — don't nest raw/raw/.
        if (dirHandle.name === 'raw') return dirHandle;
        return dirHandle.getDirectoryHandle('raw', { create: true });
    }

    async function saveRecording(blob) {
        const dirHandle = await ensureRecordingsDir();
        const rawDir = await ensureRawSubdir(dirHandle);
        const baseName = buildBaseName(recordingFighterIds);
        if (!baseName) throw new Error('Could not build a filename from fighter ids.');

        const filename = await resolveFilename(rawDir, baseName);
        const fileHandle = await rawDir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        const meta = captureWinnerMeta();
        let metaFilename = null;
        const sidecar = { savedAt: new Date().toISOString() };
        if (meta?.winner && !meta.draw) sidecar.winner = meta.winner;
        const simBalls = window.ArenaApp?.getSim?.()?.balls || [];
        const fighters = simBalls.map((ball) => {
            const entry = {
                name: typeof ball.name === 'string' ? ball.name.trim() : '',
                color: typeof ball.color === 'string' ? ball.color : '',
            };
            const powerupId = typeof ball.powerupId === 'string' ? ball.powerupId.trim() : '';
            if (powerupId) {
                entry.powerupId = powerupId;
                if (typeof ball.powerupName === 'string' && ball.powerupName.trim()) {
                    entry.powerupName = ball.powerupName.trim();
                }
            }
            return entry;
        }).filter((f) => f.name);
        if (fighters.length >= 2) sidecar.fighters = fighters;
        if (recordedWithIntro) {
            sidecar.hasIntro = true;
            sidecar.introFrames = Math.round(
                (window.IntroVsRender?.DURATION_SEC || 4) * 30
            );
        }
        if (sidecar.winner || sidecar.hasIntro || sidecar.fighters) {
            metaFilename = filename.replace(/\.webm$/i, '.json');
            await writeJsonFile(rawDir, metaFilename, sidecar);
        }
        recordedWithIntro = false;

        try {
            localStorage.setItem('arena-recording-saved', JSON.stringify({
                filename,
                at: Date.now(),
            }));
        } catch {
            /* ignore quota errors */
        }

        return { filename, metaFilename, folder: `${dirHandle.name}/raw`, rawDir };
    }

    function finishRecordingSession() {
        clearTimer();
        clearFightPoll();
        mediaRecorder = null;
        syncButtons(false);
    }

    async function acquireStream() {
        if (streamIsLive()) return displayStream;

        const pageEl = captureTargetElement();
        const arenaCanvas = window.ArenaApp?.getCanvas?.();

        // Long-form is a full DOM presentation, so its canvas-only fallback
        // would capture only the square arena and omit the surrounding frame.
        if ((supportsCropTarget || isComputerView) && pageEl) {
            const cropTarget = supportsCropTarget
                ? await window.CropTarget.fromElement(pageEl)
                : null;
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: 'browser' },
                audio: true,
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
            });
            const [videoTrack] = stream.getVideoTracks();
            if (cropTarget && videoTrack && typeof videoTrack.cropTo === 'function') {
                await videoTrack.cropTo(cropTarget);
            }
            displayStream = stream;
            attachStreamLifecycle(stream);
            syncCaptureReady(true);
            return displayStream;
        }

        if (!arenaCanvas || typeof arenaCanvas.captureStream !== 'function') {
            throw new Error('Recording is not supported in this browser.');
        }

        displayStream = arenaCanvas.captureStream(30);
        attachStreamLifecycle(displayStream);
        syncCaptureReady(true);
        return displayStream;
    }

    async function prepareCapture() {
        if (streamIsLive()) {
            syncCaptureReady(true);
            setStatus('Screen capture ready.');
            return true;
        }

        setStatus('Waiting for capture permission…');
        try {
            await acquireStream();
            setStatus('Screen capture ready.');
            return true;
        } catch (err) {
            syncCaptureReady(false);
            if (err?.name === 'NotAllowedError') {
                setStatus('Screen capture cancelled.');
            } else {
                setStatus(err?.message || 'Could not start screen capture.');
            }
            return false;
        }
    }

    function watchFightEnd() {
        clearFightPoll();
        let finishedAt = 0;
        fightPollId = window.setInterval(() => {
            const sim = window.ArenaApp?.getSim?.();
            if (!sim?.finished || mediaRecorder?.state !== 'recording') {
                finishedAt = 0;
                return;
            }
            if (!finishedAt) finishedAt = performance.now();
            if (performance.now() - finishedAt >= WIN_SCREEN_HOLD_MS) {
                stopRecording();
            }
        }, 200);
    }

    async function startRecording() {
        if (mediaRecorder) return;

        chunks = [];
        syncButtons(true);

        if (!streamIsLive()) {
            setStatus('Waiting for capture permission…');
            try {
                await acquireStream();
            } catch (err) {
                finishRecordingSession();
                if (err?.name === 'NotAllowedError') {
                    setStatus('Recording cancelled.');
                } else {
                    setStatus(err?.message || 'Could not start recording.');
                }
                return;
            }
        }

        const options = {};
        const mimeType = pickMimeType();
        if (mimeType) options.mimeType = mimeType;

        mediaRecorder = new MediaRecorder(displayStream, options);
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        mediaRecorder.onstop = async () => {
            const recorder = mediaRecorder;
            const blob = chunks.length
                ? new Blob(chunks, { type: recorder?.mimeType || 'video/webm' })
                : null;

            finishRecordingSession();

            if (!blob || !blob.size) {
                setStatus('Recording empty.');
                return;
            }

            setStatus('Saving recording…');
            try {
                const saved = await saveRecording(blob);
                lastSavedRecording = {
                    rawDir: saved.rawDir,
                    filename: saved.filename,
                    metaFilename: saved.metaFilename || null,
                };
                setStatus(`Saved ${saved.filename} → ${saved.folder}/`);
                syncPostSave(true);
            } catch (err) {
                if (err?.name === 'AbortError') {
                    setStatus('Folder pick cancelled.');
                } else {
                    setStatus(err?.message || 'Could not save recording.');
                }
            }
        };
        mediaRecorder.onerror = () => {
            setStatus('Recording failed.');
            finishRecordingSession();
        };

        mediaRecorder.start(1000);
        startedAt = performance.now();
        setStatus(`Recording ${viewLabel.toLowerCase()}…`);
        if (timerEl) timerEl.textContent = '0:00';
        timerId = window.setInterval(() => {
            if (timerEl) timerEl.textContent = formatElapsed(performance.now() - startedAt);
        }, 250);
        watchFightEnd();
    }

    function stopRecording() {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
        setStatus('Finishing recording…');
        mediaRecorder.stop();
    }

    async function recordAndRestart() {
        if (mediaRecorder) return;

        if (!supportsFileSystemAccess) {
            setStatus('Use Chrome or Edge to save recordings to a folder.');
            return;
        }

        // Folder permission must run before any other await — Chrome only
        // honors requestPermission inside the originating user gesture.
        try {
            await ensureRecordingsDir();
        } catch (err) {
            if (err?.name === 'AbortError') {
                setStatus('Folder pick cancelled.');
            } else {
                setStatus(err?.message || 'Could not access recordings folder.');
            }
            return;
        }

        try {
            await window.ArenaApp?.whenReady?.();
        } catch (err) {
            setStatus(err?.message || 'Arena is still loading.');
            return;
        }

        try {
            recordingFighterIds = fighterIdsFromSetup();
        } catch (err) {
            setStatus(err.message);
            return;
        }

        if (supportsCropTarget && !streamIsLive()) {
            setStatus('Prepare screen capture first (or approve when prompted).');
            try {
                await acquireStream();
            } catch (err) {
                if (err?.name === 'AbortError' || err?.name === 'NotAllowedError') {
                    setStatus('Screen capture cancelled.');
                } else {
                    setStatus(err?.message || 'Could not start screen capture.');
                }
                return;
            }
        }

        try {
            applySetupMatchup();
        } catch (err) {
            setStatus(err.message);
            return;
        }

        window.ArenaApp?.pause?.();

        const introPlan = window.ArenaIntroPlayback?.resolveFromWorkflow?.() || null;
        recordedWithIntro = Boolean(introPlan);
        if (introPlan) {
            try {
                setStatus('Loading VS intro…');
                await window.ArenaIntroPlayback.prepare(introPlan);
            } catch (err) {
                setStatus(err?.message || 'Intro failed to load.');
                window.ArenaIntroPlayback?.hide?.();
                return;
            }
        }

        await waitFrames(2);
        await startRecording();

        if (introPlan) {
            setStatus('Playing VS intro…');
            await window.ArenaIntroPlayback.run(introPlan);
        }

        window.ArenaApp?.run?.();
        if (introPlan) setStatus(`Recording ${viewLabel.toLowerCase()}…`);
    }

    if (prepareBtn) {
        prepareBtn.hidden = !supportsCropTarget;
        prepareBtn.addEventListener('click', () => {
            prepareCapture();
        });
    }

    recordBtn.addEventListener('click', () => {
        recordAndRestart();
    });

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            stopRecording();
        });
    }

    async function undoLastRecording() {
        if (!lastSavedRecording) return;

        const { rawDir, filename, metaFilename } = lastSavedRecording;
        if (rerecordBtn) rerecordBtn.disabled = true;
        if (doneBtn) doneBtn.disabled = true;
        setStatus('Removing recording…');

        try {
            // Re-assert folder access in this click gesture before delete.
            if (recordingsDir) await verifyDirPermission(recordingsDir);
            await rawDir.removeEntry(filename);
            if (metaFilename) {
                try {
                    await rawDir.removeEntry(metaFilename);
                } catch {
                    /* sidecar may already be gone */
                }
            }
            lastSavedRecording = null;
            localStorage.removeItem('arena-recording-saved');
            syncPostSave(false);
            syncButtons(false);
            setStatus('');
        } catch (err) {
            setStatus(err?.message || 'Could not remove recording.');
            syncPostSave(Boolean(lastSavedRecording));
        }
    }

    if (doneBtn) {
        doneBtn.addEventListener('click', () => {
            returnToWorkflow();
        });
    }

    if (rerecordBtn) {
        rerecordBtn.addEventListener('click', () => {
            undoLastRecording();
        });
    }

    window.addEventListener('pagehide', () => {
        stopTracks();
    });

    // Warm the saved folder handle so Record can requestPermission immediately.
    const dirWarm = loadSavedDirHandle().then((handle) => {
        if (handle) recordingsDir = handle;
        return handle;
    });

    setHint();
    if (!supportsFileSystemAccess) {
        setStatus('Use Chrome or Edge to record.');
    }
    syncButtons(false);
    syncPostSave(false);
    dirWarm.catch(() => {});

    window.ArenaRecord = {
        recordAndRestart,
        prepareCapture,
        stop: stopRecording,
        isRecording() {
            return mediaRecorder?.state === 'recording';
        },
        isCaptureReady() {
            return streamIsLive();
        },
        captureBounds,
        supportsFullPhoneView: supportsCropTarget,
        supportsFileSystemAccess,
        async chooseRecordingsFolder() {
            return pickRecordingsDir();
        },
    };
}());
