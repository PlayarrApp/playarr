.pragma library
// The web nav's line icons (clients/tv-web/web/src/components/NavIcons.tsx), as data URLs in a given colour.
var inner = {
    downloads: '<path d="M12 3v12"/><path d="m7 10.5 5 4.5 5-4.5"/><path d="M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-6h4v6"/>',
    series: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/><path d="m10 1 2 3 2-3"/>',
    movies: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 5 2-3M13 5l2-3M19 5l2-3"/><path d="m10 10 5 2.5-5 2.5z" fill="CLR" stroke="none"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M9 10l10-2"/>',
    playlists: '<path d="M5 6h10M5 10h10M5 14h6"/><path d="M17 13.5v6"/><path d="m17 13.5 4-1.5v5.5"/><circle cx="15.5" cy="19.5" r="1.5"/><circle cx="19.5" cy="17.5" r="1.5"/>',
    filter: '<path d="M4 6h16M7 12h10m-7 6h4"/><circle cx="8" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>',
    logout: '<path d="M10 5H5v14h5"/><path d="M13 8l4 4-4 4M8 12h9"/>',
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    // Player control icons (clients/tv-web/web/src/components/player/PlayerIcons.tsx); CLR is the fill colour.
    pPlay: '<path d="M7 4.5v15l13-7.5z" fill="CLR" stroke="none"/>',
    pPrev: '<rect x="4.5" y="5" width="2.4" height="14" rx="1" fill="CLR" stroke="none"/><path d="M19.5 5.5v13L8.2 12z" fill="CLR" stroke="none"/>',
    pNext: '<rect x="17.1" y="5" width="2.4" height="14" rx="1" fill="CLR" stroke="none"/><path d="M4.5 5.5v13L15.8 12z" fill="CLR" stroke="none"/>',
    pAudio: '<path d="M5 9.5v5h4l4.5 3.5V6L9 9.5z" fill="CLR" stroke="none"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/>',
    pSubs: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M6.5 12h4"/><path d="M13.5 12h4"/><path d="M6.5 15.5h7"/><path d="M15.5 15.5h2"/>',
    pList: '<path d="M4 6.5h10"/><path d="M4 11.5h10"/><path d="M4 16.5h7"/><path d="m16 14 4 2.5-4 2.5z" fill="CLR" stroke="none"/>',
    pHealth: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.9" fill="CLR" stroke="none"/>',
    pVolume: '<path d="M4 9.5v5h4l5 4V5.5l-5 4z" fill="CLR" stroke="none"/><path d="M17 8.5a5 5 0 0 1 0 7"/><path d="M19.7 6a9 9 0 0 1 0 12"/>',
    pFull: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
    pCast: '<path d="M4 8V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M4 12a8 8 0 0 1 8 8"/><path d="M4 16a4 4 0 0 1 4 4"/><circle cx="4.8" cy="19.2" r="0.9" fill="CLR" stroke="none"/>',
    pMin: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>',
    pPause: '<rect x="6" y="4.5" width="4.5" height="15" rx="1" fill="CLR" stroke="none"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1" fill="CLR" stroke="none"/>',
    pClose: '<path d="M6 6l12 12M18 6 6 18"/>',
    watchlist: '<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"/><path d="M12 7.5v5M9.5 10h5"/>'
}
function url(name, color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="' + color +
        '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + inner[name].replace(/CLR/g, color) + '</svg>'
    return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg)
}
