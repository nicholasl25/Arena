/**
 * Searchable dropdown for match setup pickers (skins, weapons, fighters, powerups, intros).
 * Exposes: window.SetupSearchSelect
 */
(function () {
    'use strict';

    /** @type {Set<HTMLElement>} */
    const openRoots = new Set();

    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function optionLabel(option) {
        return option?.name || option?.id || '';
    }

    function optionSearchText(option) {
        if (option?.searchText) return normalize(option.searchText);
        return normalize(`${option?.name || ''} ${option?.id || ''}`);
    }

    function matchesQuery(searchText, query) {
        const q = normalize(query);
        if (!q) return true;
        const hay = searchText || '';
        // Every token must appear (so "mc gregor" / "harry" both match).
        return q.split(/\s+/).every((token) => hay.includes(token));
    }

    function findOption(options, value) {
        return options.find((opt) => opt.id === value) || null;
    }

    function closeAll(except) {
        for (const root of openRoots) {
            if (root !== except) closeRoot(root);
        }
    }

    function closeRoot(root, { restoreLabel = true } = {}) {
        const panel = root._panel;
        const trigger = root._trigger;
        if (!panel || !trigger) return;
        panel.hidden = true;
        panel.style.top = '';
        panel.style.left = '';
        panel.style.width = '';
        panel.style.maxHeight = '';
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreLabel) {
            trigger.value = root._selectedLabel || '';
            trigger.placeholder = root._searchPlaceholder || 'Search…';
        }
        openRoots.delete(root);
    }

    function positionPanel(root) {
        const panel = root._panel;
        const trigger = root._trigger;
        if (!panel || !trigger || panel.hidden) return;

        const rect = trigger.getBoundingClientRect();
        const viewportPad = 8;
        const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
        const spaceAbove = rect.top - viewportPad;
        const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
        const maxHeight = Math.max(140, Math.min(280, preferBelow ? spaceBelow : spaceAbove));

        panel.style.left = `${Math.round(rect.left)}px`;
        panel.style.width = `${Math.round(rect.width)}px`;
        panel.style.maxHeight = `${Math.round(maxHeight)}px`;

        if (preferBelow) {
            panel.style.top = `${Math.round(rect.bottom + 6)}px`;
        } else {
            panel.style.top = `${Math.round(rect.top - 6 - maxHeight)}px`;
        }
    }

    function filterOptions(root, query) {
        const panel = root._panel;
        if (!panel) return;
        panel.querySelectorAll('.setup-search-select-option').forEach((btn) => {
            const text = btn.dataset.search || '';
            btn.hidden = !matchesQuery(text, query);
        });
        const empty = panel.querySelector('.setup-search-select-empty');
        if (empty) {
            const anyVisible = [...panel.querySelectorAll('.setup-search-select-option')]
                .some((btn) => !btn.hidden);
            empty.hidden = anyVisible;
        }
    }

    function openRoot(root, { clearForSearch = false } = {}) {
        const panel = root._panel;
        const trigger = root._trigger;
        if (!panel || !trigger) return;
        closeAll(root);
        const host = root.closest('dialog') || document.body;
        host.appendChild(panel);
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        openRoots.add(root);
        positionPanel(root);
        if (clearForSearch) {
            trigger.placeholder = root._selectedLabel
                ? `Search — ${root._selectedLabel}`
                : (root._searchPlaceholder || 'Search…');
            trigger.value = '';
            filterOptions(root, '');
        } else {
            filterOptions(root, trigger.value === root._selectedLabel ? '' : trigger.value);
        }
    }

    function isEventInsideRoot(root, target) {
        if (!target || !(target instanceof Node)) return false;
        const panel = root._panel;
        return root.contains(target) || Boolean(panel?.contains(target));
    }

    /**
     * @param {HTMLElement} mount
     * @param {{ options: { id: string, name: string, searchText?: string }[], value: string, ariaLabel: string, onChange: (id: string) => void }} config
     */
    function mount(mount, config) {
        const root = document.createElement('div');
        root.className = 'setup-search-select';

        const selected = findOption(config.options, config.value) || config.options[0] || null;
        const selectedLabel = selected ? optionLabel(selected) : '';
        root._selectedLabel = selectedLabel;
        root._selectedValue = selected?.id || '';

        const panel = document.createElement('div');
        panel.className = 'setup-search-select-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <div class="setup-search-select-list" role="listbox" aria-label="${escapeHtml(config.ariaLabel)}">
                ${config.options.map((opt) => `
                    <button
                        type="button"
                        class="setup-search-select-option${opt.id === (selected?.id || '') ? ' is-selected' : ''}"
                        role="option"
                        data-value="${escapeHtml(opt.id)}"
                        data-search="${escapeHtml(optionSearchText(opt))}"
                        aria-selected="${opt.id === (selected?.id || '')}"
                    >${escapeHtml(optionLabel(opt))}</button>
                `).join('')}
                <p class="setup-search-select-empty" hidden>No matches</p>
            </div>
        `;

        root.innerHTML = `
            <input
                type="search"
                class="setup-search-select-trigger"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="false"
                aria-haspopup="listbox"
                aria-label="${escapeHtml(config.ariaLabel)}"
                placeholder="Search ${escapeHtml(config.ariaLabel.toLowerCase())}…"
                autocomplete="off"
                spellcheck="false"
                value="${escapeHtml(selectedLabel)}"
            >
        `;

        root._panel = panel;
        root._trigger = root.querySelector('.setup-search-select-trigger');
        root._searchPlaceholder = `Search ${config.ariaLabel.toLowerCase()}…`;
        const trigger = root._trigger;
        const list = panel.querySelector('.setup-search-select-list');

        function selectValue(value) {
            const opt = findOption(config.options, value);
            const label = opt ? optionLabel(opt) : value;
            root._selectedValue = value;
            root._selectedLabel = label;
            trigger.value = label;
            trigger.placeholder = root._searchPlaceholder;
            panel.querySelectorAll('.setup-search-select-option').forEach((btn) => {
                const active = btn.dataset.value === value;
                btn.classList.toggle('is-selected', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            closeRoot(root, { restoreLabel: false });
            config.onChange(value);
        }

        trigger.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });

        trigger.addEventListener('focus', () => {
            openRoot(root, { clearForSearch: true });
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (panel.hidden) openRoot(root, { clearForSearch: true });
        });

        trigger.addEventListener('input', () => {
            if (panel.hidden) openRoot(root);
            filterOptions(root, trigger.value);
        });

        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeRoot(root);
                trigger.blur();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = [...panel.querySelectorAll('.setup-search-select-option')]
                    .find((btn) => !btn.hidden);
                if (first?.hasAttribute('data-value')) {
                    selectValue(first.getAttribute('data-value'));
                }
            }
            if (e.key === 'ArrowDown' && panel.hidden) {
                e.preventDefault();
                openRoot(root, { clearForSearch: true });
            }
        });

        list.addEventListener('wheel', (e) => {
            e.stopPropagation();
            const atTop = list.scrollTop <= 0;
            const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
            if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
                e.preventDefault();
            }
        }, { passive: false });

        panel.querySelectorAll('.setup-search-select-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => {
                // Keep focus from leaving the input before click fires.
                e.preventDefault();
            });
            btn.addEventListener('click', () => {
                // Allow empty-string values (e.g. long-form empty entrant slots).
                if (!btn.hasAttribute('data-value')) return;
                selectValue(btn.getAttribute('data-value'));
            });
        });

        const onDocPointer = (e) => {
            if (!isEventInsideRoot(root, e.target)) closeRoot(root);
        };
        const onReposition = () => {
            if (openRoots.has(root)) positionPanel(root);
        };
        document.addEventListener('pointerdown', onDocPointer);
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);

        mount.replaceChildren(root);

        return {
            root,
            setValue(value) {
                const opt = findOption(config.options, value);
                const label = opt ? optionLabel(opt) : '';
                root._selectedValue = value;
                root._selectedLabel = label;
                trigger.value = label;
                trigger.placeholder = root._searchPlaceholder;
                panel.querySelectorAll('.setup-search-select-option').forEach((btn) => {
                    const active = btn.dataset.value === value;
                    btn.classList.toggle('is-selected', active);
                    btn.setAttribute('aria-selected', active ? 'true' : 'false');
                });
            },
            destroy() {
                document.removeEventListener('pointerdown', onDocPointer);
                window.removeEventListener('resize', onReposition);
                window.removeEventListener('scroll', onReposition, true);
                closeRoot(root, { restoreLabel: false });
                panel.remove();
                mount.replaceChildren();
            },
        };
    }

    window.SetupSearchSelect = { mount };
}());
