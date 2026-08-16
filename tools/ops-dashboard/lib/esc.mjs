// HTML escaping, in its own module so more than one renderer can use it.
//
// It lived in render.mjs, which was fine while render.mjs was the only renderer.
// The agent roster is a second one, and having it import from render.mjs while
// render.mjs imports it back is a cycle that happens to work today only because
// nothing calls `esc` at module-evaluation time. That is a fact about the current
// code, not a guarantee, so the shared leaf moved out instead.
export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
