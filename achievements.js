/* Alligator Games achievements catalog.
   Games never define achievements themselves; they only call the unlock hook:
     window.__ag.unlock('achievement-id')        (direct)
     parent.postMessage({ag:'unlock', id:'achievement-id'}, '*')   (fallback)
   Fields: id (unique), game (game id from catalog), name, desc, img (path/URL, optional), tokens (GGG-Tokens, any number >= 0), hidden (optional) */
window.AG_ACHIEVEMENTS = [
  // { id:'first-snap', game:'example-game', name:'First Snap', desc:'Win your first match.', img:'achievements/first-snap.png', tokens:10 },
];
