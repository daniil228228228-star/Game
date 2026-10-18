/* City layout switch (masterplan C, step C1). ONE decision, taken before any game script runs:
 *   window.LAYOUT_V161 === 'C'  new game (no save) and saves written by a C game ("layoutV161":"C"): the Plan C street skeleton
 *   window.LAYOUT_V161 === 'B'  every older save (field absent): the old core + plan B pads, nothing changes
 * ?layout=B|C overrides it (tests, screenshots). The save writer stores window.LAYOUT_V161 as `layoutV161`.
 * LAYOUT_DEFAULT_NEW is the layout of a game that has no save at all.
 */
(function () {
  'use strict';
  var LAYOUT_DEFAULT_NEW = 'C', layout = 'B';
  try {
    var q = /[?&]layout=([BC])\b/.exec(location.search);
    if (q) layout = q[1];
    else {
      var raw = localStorage.getItem('tycoon3d_save_v3');
      if (!raw) raw = localStorage.getItem('tycoon3d_save_v3_backup');
      if (!raw) layout = LAYOUT_DEFAULT_NEW;
      else { var d = JSON.parse(raw); layout = d && d.layoutV161 === 'C' ? 'C' : 'B'; }
    }
  } catch (e) { layout = 'B'; }
  window.LAYOUT_V161 = layout;
  window.LAYOUT_DEFAULT_NEW_V161 = LAYOUT_DEFAULT_NEW;
})();
