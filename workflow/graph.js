/**
 * Workflow DAG — node layout + SVG edge rendering.
 * Supports multiple workflows (shorts vs long YouTube).
 */
(function () {
    'use strict';

    const NODE_W = 240;
    const NODE_H = 188;
    const COL_W = 300;
    const ROW_H = 248;
    const PAD_X = 64;
    const PAD_Y = 52;

    const ACTION_ICONS = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
        watch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M10 9l6 3.5-6 3.5z"/></svg>',
        goto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M10 20L20 10M15 4 9 4 4 9v11h11v-6"/></svg>',
        refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M4 12a8 8 0 0 1 13.5-5.7M20 12a8 8 0 0 1-13.5 5.7"/><path fill="currentColor" d="M20 3v5h-5M4 21v-5h5"/></svg>',
        edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 20h9M15.5 5.5l3 3L7 20l-4 1 1-4 11.5-11.5z"/></svg>',
        setup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h10M4 17h13"/><circle cx="18" cy="12" r="2.2" fill="currentColor"/><circle cx="15" cy="17" r="2.2" fill="currentColor"/></svg>',
        skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M5 7l8 5-8 5V7z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M19 7v10"/></svg>',
        default: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 4v3M12 17v3M4 12h3M17 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>',
        ffwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5v14l9-7-9-7zm9 0v14l9-7-9-7z"/></svg>',
        step: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5v14l9-7-9-7z"/><path fill="currentColor" d="M16 5h3v14h-3z"/></svg>',
        redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3 7v6h6"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M21 17a8 8 0 0 0-14.9-3"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M3 7l3 3"/></svg>',
        toggle: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="12" r="2.6" fill="currentColor"/></svg>',
    };

    const SHORTS_GRAPH = {
        nodes: [
            {
                id: 'setup', label: 'Make setup', sub: 'matchup', col: 0, row: 1, icon: 'setup',
                actions: [
                    { action: 'edit-setup', icon: 'setup', title: 'Edit matchup' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            {
                id: 'intro', label: 'Make intro', sub: 'VS splash', col: 1, row: 1, icon: 'intro',
                actions: [
                    { action: 'intro-skip', icon: 'skip', title: 'Skip intro' },
                    { action: 'intro-default', icon: 'default', title: 'Use default' },
                    { action: 'intro-manual', icon: 'edit', title: 'Manual' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            {
                id: 'record', label: 'Record', sub: 'phone capture', col: 2, row: 1, icon: 'rec',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview' },
                    { action: 'fast-forward', icon: 'ffwd', title: 'Fast forward' },
                    { action: 'open-arena', icon: 'goto', title: 'Open arena' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            {
                id: 'compose', label: 'Compose', sub: 'script + TTS', col: 3, row: 1, icon: 'doc',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview' },
                    { action: 'run-compose', icon: 'play', title: 'Run' },
                    { action: 'edit-script', icon: 'edit', title: 'Edit script' },
                    { action: 'reload-script', icon: 'refresh', title: 'Reload draft' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            {
                id: 'youtube', label: 'YouTube', sub: 'upload short', col: 4, row: 0, icon: 'yt',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview' },
                    { action: 'run-upload', icon: 'play', title: 'Upload' },
                    { action: 'edit-caption', icon: 'edit', title: 'Edit caption' },
                    { action: 'reload-caption', icon: 'refresh', title: 'Reload draft' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            { id: 'instagram', label: 'Instagram', sub: 'reels', col: 4, row: 1, future: true, icon: 'ig', actions: [] },
            { id: 'tiktok', label: 'TikTok', sub: 'post clip', col: 4, row: 2, future: true, icon: 'tt', actions: [] },
        ],
        edges: [
            { from: 'setup', to: 'intro' },
            { from: 'intro', to: 'record' },
            { from: 'record', to: 'compose' },
            { from: 'compose', to: 'youtube' },
            { from: 'compose', to: 'instagram' },
            { from: 'compose', to: 'tiktok' },
        ],
    };

    /** Long-form YouTube — bracket → computer arena → VO → bracket tournament loop. */
    const LONG_GRAPH = {
        nodes: [
            {
                id: 'setup', label: 'Make setup', sub: 'fighters', x: 64, y: 100, icon: 'setup',
                actions: [
                    { action: 'edit-setup', icon: 'setup', title: 'Edit fighters' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            {
                id: 'record', label: 'Arena', sub: 'ArenaResult JSON', x: 900, y: 100, icon: 'rec',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview arena loop' },
                    { action: 'open-arena', icon: 'goto', title: 'Open computer arena' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
            {
                id: 'bracket', label: 'Bracket', sub: 'state → frames', x: 380, y: 100, icon: 'bracket',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview bracket loop' },
                    { action: 'open-bracket', icon: 'goto', title: 'Open bracket view' },
                ],
            },
            {
                id: 'powerup', label: 'Powerup', sub: 'PowerupSpin JSON', x: 640, y: 100, icon: 'powerup',
                actions: [
                    { action: 'toggle-powerup', icon: 'toggle', title: 'Turn powerup spins on or off', toggle: true },
                ],
            },
            {
                id: 'compose', label: 'Voice Over', sub: 'MixSegment JSON', x: 1160, y: 100, icon: 'doc',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview latest voice-over' },
                ],
            },
            {
                id: 'youtube', label: 'YouTube', sub: 'upload video', x: 1500, y: 100, icon: 'yt',
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview' },
                    { action: 'run-upload', icon: 'play', title: 'Upload' },
                    { action: 'edit-caption', icon: 'edit', title: 'Edit caption' },
                    { action: 'reload-caption', icon: 'refresh', title: 'Reload draft' },
                    { action: 'redo', icon: 'redo', title: 'Redo step' },
                ],
            },
        ],
        groups: [
            {
                id: 'tournament',
                label: 'Tournament loop',
                sub: 'BracketState → PowerupSpin → ArenaResult → MatchSegment · until champion',
                x: 348,
                y: 20,
                width: 1084,
                height: 360,
                actions: [
                    { action: 'watch', icon: 'watch', title: 'Preview curated video so far' },
                    { action: 'preview-step', icon: 'step', title: 'Run one match (incl. voice-over), then pause' },
                    { action: 'preview-fast-forward', icon: 'ffwd', title: 'Run tournament (click again to speed up)' },
                ],
            },
        ],
        edges: [
            { from: 'setup', to: 'bracket' },
            { from: 'bracket', to: 'powerup' },
            { from: 'powerup', to: 'record' },
            { from: 'record', to: 'compose' },
            { from: 'compose', to: 'bracket', route: 'loop-below' },
            { from: 'compose', to: 'youtube' },
        ],
    };

    const WORKFLOWS = {
        shorts: {
            id: 'shorts',
            label: 'Shorts',
            title: 'Shorts workflow',
            subtitle: 'Green = done · blue = in progress · dashed = waiting on a prior step. Hover icon buttons for actions.',
            arenaView: 'phone',
            graph: SHORTS_GRAPH,
        },
        long: {
            id: 'long',
            label: 'Long YouTube',
            title: 'Long YouTube workflow',
            subtitle: 'Set up fighters → Bracket → Powerup → Arena → one Voice Over → bracket result, looping until a champion.',
            arenaView: 'computer',
            graph: LONG_GRAPH,
        },
    };

    /** @type {{ nodes: object[], edges: object[] }} */
    let GRAPH = SHORTS_GRAPH;
    /** @type {string} */
    let activeWorkflowId = 'shorts';
    /** @type {Map<string, object>} */
    let nodeById = new Map(GRAPH.nodes.map((n) => [n.id, n]));

    function nodeOrigin(node) {
        return {
            x: Number.isFinite(node.x) ? node.x : PAD_X + node.col * COL_W,
            y: Number.isFinite(node.y) ? node.y : PAD_Y + node.row * ROW_H,
        };
    }

    function portOut(node) {
        const o = nodeOrigin(node);
        return { x: o.x + NODE_W, y: o.y + NODE_H / 2 };
    }

    function portIn(node) {
        const o = nodeOrigin(node);
        return { x: o.x, y: o.y + NODE_H / 2 };
    }

    function canvasSize() {
        let width = 0;
        let height = 0;
        for (const n of GRAPH.nodes) {
            const o = nodeOrigin(n);
            width = Math.max(width, o.x + NODE_W + 48);
            height = Math.max(height, o.y + NODE_H + 32);
        }
        for (const group of GRAPH.groups || []) {
            width = Math.max(width, group.x + group.width + 32);
            height = Math.max(height, group.y + group.height + 24);
        }
        return {
            width,
            height,
        };
    }

    function edgePath(from, to, route) {
        const aOrigin = nodeOrigin(from);
        const bOrigin = nodeOrigin(to);
        // Voice Over → Bracket returns beneath the linear three-card row.
        if (route === 'loop-below') {
            const a = { x: aOrigin.x + NODE_W / 2, y: aOrigin.y + NODE_H };
            const b = { x: bOrigin.x + NODE_W / 2, y: bOrigin.y + NODE_H };
            const midY = Math.max(a.y, b.y) + 52;
            return `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
        }
        const a = portOut(from);
        const b = portIn(to);
        const dx = Math.max(52, (b.x - a.x) * 0.5);
        return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
    }

    function iconMarkup(kind) {
        const icons = {
            setup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h10M4 17h13"/><circle cx="18" cy="12" r="2.2" fill="currentColor"/><circle cx="15" cy="17" r="2.2" fill="currentColor"/></svg>',
            intro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M4 6h16v12H4z"/><path fill="currentColor" d="M11 9h2v6h-2zM9 11h6v2H9z"/></svg>',
            rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
            bracket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 4h5v4H4zM4 16h5v4H4zM15 10h5v4h-5zM9 6h3v6h3M9 18h3v-6"/></svg>',
            doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 4h6l4 4v12H8V4zm6 0v4h4"/></svg>',
            yt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 8l6 4-6 4V8z"/><rect x="3" y="6" width="18" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
            ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
            tt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 8v9l7-4.5L9 8z"/></svg>',
            powerup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M9 3h6M10 3v3.2L6.8 14.5A5.4 5.4 0 0 0 11.8 21h.4a5.4 5.4 0 0 0 5-6.5L14 6.2V3"/><path fill="currentColor" d="M8.6 15.2c.8 1.8 2.4 2.8 4.4 2.8 1.2 0 2.2-.3 3-.9-.7 2-2.4 3.3-4.6 3.3-2.8 0-4.8-1.8-5.4-4.2.7.1 1.7-.2 2.6-1z"/></svg>',
        };
        return icons[kind] || icons.doc;
    }

    function actionsMarkup(node) {
        if (!node.actions?.length) return '';
        const btns = node.actions.map((item) => (
            `<button type="button" class="wf-act-btn" data-action="${item.action}" data-node="${node.id}" data-tooltip="${item.title}" aria-label="${item.title}"${item.toggle ? ' aria-pressed="false"' : ''}>${ACTION_ICONS[item.icon] || ''}</button>`
        )).join('');
        return `<div class="wf-node-actions">${btns}</div>`;
    }

    function render(mount) {
        const size = canvasSize();
        mount.innerHTML = '';
        mount.style.width = `${size.width}px`;
        mount.style.height = `${size.height}px`;

        const groupLayer = document.createElement('div');
        groupLayer.className = 'wf-group-layer';
        for (const group of GRAPH.groups || []) {
            const el = document.createElement('section');
            el.className = 'wf-group';
            el.dataset.id = group.id;
            el.style.left = `${group.x}px`;
            el.style.top = `${group.y}px`;
            el.style.width = `${group.width}px`;
            el.style.height = `${group.height}px`;
            el.innerHTML = `
                <div class="wf-group-head">
                    <div>
                        <span class="wf-group-label">${group.label}</span>
                        <span class="wf-group-sub">${group.sub || ''}</span>
                    </div>
                    ${actionsMarkup(group)}
                </div>
            `;
            groupLayer.appendChild(el);
        }
        mount.appendChild(groupLayer);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'wf-edges');
        svg.setAttribute('width', String(size.width));
        svg.setAttribute('height', String(size.height));
        svg.setAttribute('aria-hidden', 'true');

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = '<marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor"/></marker>';
        svg.appendChild(defs);

        const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        for (const edge of GRAPH.edges) {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) continue;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'wf-edge');
            path.setAttribute('data-edge', `${edge.from}->${edge.to}`);
            path.setAttribute('d', edgePath(from, to, edge.route));
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', 'url(#wf-arrow)');
            edgeLayer.appendChild(path);
        }
        svg.appendChild(edgeLayer);
        mount.appendChild(svg);

        const layer = document.createElement('div');
        layer.className = 'wf-node-layer';

        for (const node of GRAPH.nodes) {
            const o = nodeOrigin(node);
            const el = document.createElement('div');
            el.className = 'wf-node';
            if (node.future) el.classList.add('is-future');
            el.dataset.id = node.id;
            el.style.left = `${o.x}px`;
            el.style.top = `${o.y}px`;

            el.innerHTML = `
                <span class="wf-port wf-port-in" aria-hidden="true"></span>
                <div class="wf-node-card">
                    ${actionsMarkup(node)}
                    <span class="wf-node-badge" data-badge-for="${node.id}" aria-hidden="true"></span>
                    <div class="wf-node-body">
                        <span class="wf-node-icon wf-node-icon-${node.icon}">${iconMarkup(node.icon)}</span>
                        <span class="wf-node-label">${node.label}</span>
                        <span class="wf-node-sub">${node.sub}</span>
                        <p class="wf-node-file" data-file-for="${node.id}" hidden></p>
                        <p class="wf-node-progress" data-progress-for="${node.id}" hidden></p>
                        <p class="wf-node-statusline" data-status-for="${node.id}"></p>
                    </div>
                </div>
                <span class="wf-port wf-port-out" aria-hidden="true"></span>
            `;
            layer.appendChild(el);
        }
        mount.appendChild(layer);
    }

    function setWorkflow(id) {
        const wf = WORKFLOWS[id];
        if (!wf) return false;
        activeWorkflowId = wf.id;
        GRAPH = wf.graph;
        nodeById = new Map(GRAPH.nodes.map((n) => [n.id, n]));
        return true;
    }

    function getWorkflow() {
        return WORKFLOWS[activeWorkflowId];
    }

    function getNodeEl(id) {
        return document.querySelector(`.wf-node[data-id="${id}"]`);
    }

    function getGroupEl(id) {
        return document.querySelector(`.wf-group[data-id="${id}"]`);
    }

    function setGroupState(id, state) {
        const el = getGroupEl(id);
        if (!el) return;
        el.classList.remove('is-locked', 'is-active', 'is-done');
        if (state) el.classList.add(`is-${state}`);
        if (state === 'done') {
            el.setAttribute('aria-label', `${el.querySelector('.wf-group-label')?.textContent || id} complete`);
        } else {
            el.removeAttribute('aria-label');
        }
    }

    function setNodeState(id, state) {
        const el = getNodeEl(id);
        if (!el) return;
        el.classList.remove('is-locked', 'is-active', 'is-done');
        if (state) el.classList.add(`is-${state}`);

        const badge = el.querySelector(`[data-badge-for="${id}"]`);
        if (badge) {
            badge.classList.remove('is-active-dot');
            if (state === 'done') {
                badge.textContent = '✓';
                badge.hidden = false;
            } else if (state === 'active') {
                badge.textContent = '';
                badge.hidden = false;
                badge.classList.add('is-active-dot');
            } else {
                badge.textContent = '';
                badge.hidden = true;
            }
        }
    }

    /**
     * Tournament match progress chip: "3/7".
     * partial (>0 && <total) adds is-partial yellow styling.
     */
    function setNodeProgress(id, current, total, opts = {}) {
        const el = getNodeEl(id);
        if (!el) return;
        const progressEl = el.querySelector(`[data-progress-for="${id}"]`);
        const cur = Math.max(0, Number(current) || 0);
        const tot = Math.max(0, Number(total) || 0);
        const show = tot > 0;
        const label = show ? `${Math.min(cur, tot)}/${tot}` : '';
        const partial = show && cur > 0 && cur < tot;
        const complete = show && cur >= tot;
        el.classList.toggle('is-partial', partial);
        el.dataset.progress = label;
        el.dataset.progressComplete = complete ? '1' : '0';
        if (progressEl) {
            progressEl.textContent = label;
            progressEl.hidden = !show;
            progressEl.setAttribute('aria-label', show
                ? `${opts.label || id} progress ${label} matches`
                : '');
        }
        if (opts.ariaLabel) {
            el.setAttribute('aria-label', opts.ariaLabel);
        } else if (show) {
            const name = opts.label || id;
            el.setAttribute('aria-label', `${name}, ${label} matches`);
        } else {
            el.removeAttribute('aria-label');
        }
    }

    function clearNodeProgress(id) {
        const el = getNodeEl(id);
        if (!el) return;
        el.classList.remove('is-partial');
        delete el.dataset.progress;
        delete el.dataset.progressComplete;
        el.removeAttribute('aria-label');
        const progressEl = el.querySelector(`[data-progress-for="${id}"]`);
        if (progressEl) {
            progressEl.textContent = '';
            progressEl.hidden = true;
            progressEl.removeAttribute('aria-label');
        }
    }

    function setNodeFile(id, text, empty, pending) {
        const el = getNodeEl(id)?.querySelector(`[data-file-for="${id}"]`);
        if (!el) return;
        const label = typeof text === 'string' ? text.trim() : '';
        const blocked = /^(complete|waiting…|waiting\.\.\.|posted)$/i.test(label);
        const show = Boolean(label) && label !== '—' && !blocked;
        el.textContent = show ? label : '';
        el.hidden = !show;
        el.classList.toggle('is-empty', Boolean(empty) && !show);
        el.classList.toggle('is-pending', Boolean(pending) && show);
    }

    function setNodeStatus(id, text, kind) {
        const el = getNodeEl(id)?.querySelector(`[data-status-for="${id}"]`);
        if (!el) return;
        el.textContent = text || '';
        el.classList.remove('is-error', 'is-success', 'is-busy');
        if (kind) el.classList.add(`is-${kind}`);
    }

    function setActionDisabled(nodeId, action, disabled) {
        const root = getNodeEl(nodeId) || document.querySelector(`.wf-group[data-id="${nodeId}"]`);
        const btn = root?.querySelector(`[data-action="${action}"]`);
        if (btn) btn.disabled = disabled;
    }

    function setActionPressed(nodeId, action, pressed) {
        const root = getNodeEl(nodeId) || document.querySelector(`.wf-group[data-id="${nodeId}"]`);
        const btn = root?.querySelector(`[data-action="${action}"]`);
        if (!btn) return;
        const on = Boolean(pressed);
        btn.classList.toggle('is-pressed', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.dataset.tooltip = on ? 'Turn powerup spins off' : 'Turn powerup spins on';
        btn.setAttribute('aria-label', btn.dataset.tooltip);
    }

    function setNodeSkipped(id, skipped) {
        const el = getNodeEl(id);
        if (!el) return;
        el.classList.toggle('is-skipped', Boolean(skipped));
    }

    function setEdgeProgress(from, to, fromDone, toActive) {
        const path = document.querySelector(`[data-edge="${from}->${to}"]`);
        if (!path) return;
        path.classList.remove('is-complete', 'is-active');
        if (fromDone && toActive) {
            path.classList.add('is-active');
        } else if (fromDone) {
            path.classList.add('is-complete');
        }
    }

    window.WorkflowGraph = {
        WORKFLOWS,
        get GRAPH() { return GRAPH; },
        NODE_W,
        NODE_H,
        render,
        setWorkflow,
        getWorkflow,
        get activeWorkflowId() { return activeWorkflowId; },
        getNodeEl,
        getGroupEl,
        setGroupState,
        setNodeState,
        setNodeFile,
        setNodeStatus,
        setNodeProgress,
        clearNodeProgress,
        setActionDisabled,
        setActionPressed,
        setNodeSkipped,
        setEdgeProgress,
        get nodeById() { return nodeById; },
    };
}());
