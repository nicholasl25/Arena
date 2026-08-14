/**
 * ArenaApp — modes, storage keys, theme colors.
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});

    P.ARENA_SIZE = 400;
    P.GAME_MODES = {
        collision: { id: 'collision', label: 'Ball Arena', title: 'Ball Arena' },
        weapon: { id: 'weapon', label: 'Weapon Combat', title: 'Weapon Arena' },
    };

    P.MODE_STORAGE_KEY = 'arena-game-mode';
    P.MATCHUP_STORAGE_KEY = 'arena-matchup-v2';
    P.WEAPON_MATCHUP_STORAGE_KEY = 'arena-matchup-weapon-v2';
    P.TOURNAMENT_ARENA_STORAGE_KEY = 'workflow-tournament-current-matchup-v1';

    P.DEFAULT_WEAPON_SKIN_ID = '_weapon';
    P.NONE_WEAPON_ID = 'none';

    P.WEAPON_THEME_COLORS = [
        { id: 'red', hex: '#ef4444', label: 'Red' },
        { id: 'orange', hex: '#f97316', label: 'Orange' },
        { id: 'yellow', hex: '#eab308', label: 'Yellow' },
        { id: 'green', hex: '#22c55e', label: 'Green' },
        { id: 'blue', hex: '#3b82f6', label: 'Blue' },
        { id: 'purple', hex: '#a855f7', label: 'Purple' },
        { id: 'black', hex: '#000000', label: 'Black' },
    ];

    P.PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
    P.SPAWN_CORNERS = ['upper-left', 'upper-right'];
    /** Fixed inset so headless sims don't depend on canvas/DPR layout. */
    P.SILENT_WALL_INSET = 12;
}());
