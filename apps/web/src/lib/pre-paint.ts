/**
 * Scripts that must run before the first paint.
 *
 * They live here, in a module with no `"use client"` directive, for a reason
 * that is easy to get wrong: every export of a client module is a *client
 * reference*, not its value. Exporting these strings from the components that
 * use them meant the server layout interpolated a reference object into a
 * `<script>` tag — producing markup that silently did nothing, and a theme
 * choice that stopped surviving a reload.
 *
 * Both scripts are tiny, synchronous and inlined in the document head. Anything
 * in the bundle would already be too late: the flash they exist to prevent
 * happens before the first module executes.
 */

export const THEME_STORAGE_KEY = "siumora.theme";
export const CONSENT_STORAGE_KEY = "siumora.consent";

/** Applies a stored theme choice, so a dark visitor never sees an ivory flash. */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`.trim();

/**
 * Decides whether the consent banner is shown.
 *
 * On a storage failure it asks: consent that cannot be read has not been given.
 */
const CONSENT_SCRIPT = `
try {
  if (!localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)})) {
    document.documentElement.setAttribute("data-consent", "ask");
  }
} catch (e) {
  document.documentElement.setAttribute("data-consent", "ask");
}
`.trim();

export const PRE_PAINT_SCRIPT = `${THEME_SCRIPT}\n${CONSENT_SCRIPT}`;
