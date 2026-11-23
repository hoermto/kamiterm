// Benachrichtigungen (Mail/Telegram): Konfiguration in den normalen Einstellungen, data/settings.json → tools.NOTIFY
// (über lib/tool-settings.js, wie SEC-Kontakt). Ein Kanal ist aktiv, sobald er ausgefüllt ist:
//   Mail     = SMTP-Host + Absender + mindestens ein Empfänger
//   Telegram = Bot-Token + Chat-ID
// Je Kanal eine Mehrfachauswahl der Alarmtypen (mailKinds / telegramKinds / bellKinds; Standard: alle).
// Glocke = im Terminal: Popup + 🔔-Zähler; abgewählte Typen stehen trotzdem in ALERTS, zählen aber nicht.
// settings.json steht in seafile-ignore.txt: nur der Rechner, auf dem die Kanäle eingetragen sind, versendet
// (Box und lokales Terminal schicken so nichts doppelt).
// SMTP-Passwort und Bot-Token liegen ebenfalls dort; die API gibt sie nie zurück (nur „gesetzt“), ein leeres Feld
// beim Speichern behält den Wert, nie loggen.
import os from 'node:os';
import * as toolSettings from './tool-settings.js';

export const TOOL = 'NOTIFY';
export const KINDS = Object.freeze({
  price: 'Kurs',
  gsw: 'GSW',
  rslSell: 'RSL Verkauf',
  rslBuy: 'RSL Kauf',
});
export const SECURITY = ['starttls', 'ssl', 'none'];
const ALL = Object.keys(KINDS);

export const defaults = () => ({
  smtp: { host: '', port: 587, security: 'starttls', user: '', pass: '', from: '', to: [] },
  telegram: { token: '', chatId: '' },
  mailKinds: [...ALL], telegramKinds: [...ALL], bellKinds: [...ALL],
});

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const emailRe = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((s) => String(s).trim()).filter(Boolean);
const clean = (s, max = 200) => String(s ?? '').replace(/[\r\n\0]/g, '').trim().slice(0, max);
const kindList = (v) => (Array.isArray(v) ? ALL.filter((k) => v.includes(k)) : [...ALL]);

/** Vollständige Konfiguration inkl. Geheimnissen — nur serverseitig verwenden. */
export function loadConfig() {
  const d = defaults(), raw = toolSettings.loadAll().tools?.[TOOL] || {};
  return {
    smtp: { ...d.smtp, ...(raw.smtp || {}), to: splitList(raw.smtp?.to) },
    telegram: { ...d.telegram, ...(raw.telegram || {}) },
    mailKinds: kindList(raw.mailKinds), telegramKinds: kindList(raw.telegramKinds), bellKinds: kindList(raw.bellKinds),
  };
}

/** Kanal aktiv = ausgefüllt. */
export function activeChannels(cfg = loadConfig()) {
  return { mail: !!(cfg.smtp.host && cfg.smtp.from && cfg.smtp.to.length), telegram: !!(cfg.telegram.token && cfg.telegram.chatId) };
}

/** Ohne Geheimnisse (für API, auch für GET /api/settings). */
export function maskConfig(cfg) {
  const { pass, ...smtp } = cfg.smtp;
  const { token, ...telegram } = cfg.telegram;
  return { smtp, telegram, mailKinds: cfg.mailKinds, telegramKinds: cfg.telegramKinds, bellKinds: cfg.bellKinds, secrets: { smtpPass: !!pass, telegramToken: !!token } };
}

export function publicConfig() {
  const cfg = loadConfig();
  return { ...maskConfig(cfg), active: activeChannels(cfg), kinds: KINDS, securityModes: SECURITY, host: os.hostname() };
}

/** Speichern. body: { smtp, telegram, mailKinds, telegramKinds, bellKinds, smtpPass?, telegramToken?, clearSmtpPass?, clearTelegramToken? } */
export function saveConfig(body = {}) {
  const cur = loadConfig();
  const next = { smtp: { ...cur.smtp }, telegram: { ...cur.telegram }, mailKinds: cur.mailKinds, telegramKinds: cur.telegramKinds, bellKinds: cur.bellKinds };
  if (body.smtp) {
    const s = body.smtp;
    const port = s.port === '' || s.port == null ? cur.smtp.port : Number(s.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('SMTP-Port 1–65535');
    const security = s.security ?? cur.smtp.security;
    if (!SECURITY.includes(security)) throw bad(`Sicherheit: ${SECURITY.join(' / ')}`);
    const host = clean(s.host ?? cur.smtp.host);
    if (host && !/^[A-Za-z0-9.-]+$/.test(host)) throw bad('SMTP-Host ungültig');
    const from = clean(s.from ?? cur.smtp.from);
    const fromAddr = (from.match(/<([^>]+)>/) || [, from])[1];
    if (from && !emailRe.test(fromAddr)) throw bad('Absender ist keine E-Mail-Adresse');
    const to = s.to === undefined ? cur.smtp.to : splitList(s.to);
    const badTo = to.find((x) => !emailRe.test(x));
    if (badTo) throw bad(`Empfänger ungültig: ${badTo}`);
    if (to.length > 20) throw bad('Höchstens 20 Empfänger');
    Object.assign(next.smtp, { host, port, security, user: clean(s.user ?? cur.smtp.user), from, to });
  }
  if (body.telegram) {
    const chatId = clean(body.telegram.chatId ?? cur.telegram.chatId, 64);
    if (chatId && !/^(-?\d+|@[A-Za-z0-9_]{4,})$/.test(chatId)) throw bad('Telegram-Chat-ID: Zahl (z. B. 123456789 oder -100…) oder @kanalname');
    next.telegram.chatId = chatId;
  }
  // Geheimnisse: leer = behalten; nur ausdrückliches Löschen entfernt
  const tok = typeof body.telegramToken === 'string' ? body.telegramToken.trim() : '';
  if (tok && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(tok)) throw bad('Telegram-Bot-Token hat nicht das Format 123456:ABC…');
  if (tok) next.telegram.token = tok;
  if (typeof body.smtpPass === 'string' && body.smtpPass !== '') next.smtp.pass = body.smtpPass.replace(/[\r\n\0]/g, '');
  if (body.clearSmtpPass) next.smtp.pass = '';
  if (body.clearTelegramToken) next.telegram.token = '';
  if (body.mailKinds !== undefined) next.mailKinds = kindList(Array.isArray(body.mailKinds) ? body.mailKinds : []);
  if (body.telegramKinds !== undefined) next.telegramKinds = kindList(Array.isArray(body.telegramKinds) ? body.telegramKinds : []);
  if (body.bellKinds !== undefined) next.bellKinds = kindList(Array.isArray(body.bellKinds) ? body.bellKinds : []);
  toolSettings.saveTool(TOOL, next);
  return publicConfig();
}
