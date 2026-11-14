// Who this terminal says it is when it asks SEC EDGAR for data. SEC asks automated clients to name a
// contact email in the User-Agent; the address is the user's own, entered in SETTINGS > Data sources and
// kept in data/settings.json (tools.SEC.contact) on this computer only. It is never part of the code.
// Without it, the requests use the generic Amber Terminal name, and functions that need many EDGAR
// requests (the earnings history) ask the user to enter it first.
import * as toolSettings from "./tool-settings.js";

const GENERIC_UA = "AmberTerminal/1.0 (+https://part-timequant.com/bloomberg)";
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export const CONTACT_MAX = 120;

/** "" when the value is a usable email address (or empty), else the reason it isn't. */
export function validateContact(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v.length > CONTACT_MAX) return `At most ${CONTACT_MAX} characters.`;
  if (!EMAIL.test(v)) return "Enter an email address, e.g. name@example.com.";
  return "";
}

/** The saved contact address, or "" when none (or an invalid one) is saved. */
export function getContact() {
  const v = String(toolSettings.getTool("SEC").contact ?? "").trim();
  return v && !validateContact(v) ? v : "";
}

export function hasContact() {
  return getContact() !== "";
}

/** Saves the address (an empty value removes it). Throws a 400 error for an invalid address. */
export function saveContact(value) {
  const v = String(value ?? "").trim();
  const err = validateContact(v);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  toolSettings.saveTool("SEC", { contact: v });
  return getContact();
}

/** Request headers for sec.gov: the user's contact when set, the generic name otherwise. */
export function secHeaders() {
  const c = getContact();
  return { "User-Agent": c ? `AmberTerminal/1.0 ${c}` : GENERIC_UA };
}
