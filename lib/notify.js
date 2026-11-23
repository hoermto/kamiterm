// Versand von Benachrichtigungen: E-Mail über nodemailer (npm-Abhängigkeit, von den Startskripten installiert),
// Telegram über die Bot-API (fetch). Ein Kanal versendet, wenn er in den Einstellungen ausgefüllt ist und der
// Alarmtyp für ihn ausgewählt ist (lib/notify-config.js).
// Geheimnisse (SMTP-Passwort, Bot-Token) werden nie geloggt und nie in Fehlermeldungen übernommen.
import { loadConfig, activeChannels, KINDS } from './notify-config.js';

let nodemailerP = null;
/** nodemailer laden; fehlt das Paket: null (Mail aus, Rest läuft). Für Tests austauschbar. */
export async function getNodemailer() {
  nodemailerP ||= import('nodemailer').then((m) => m.default || m).catch(() => null);
  return nodemailerP;
}
export function _setNodemailer(m) { nodemailerP = Promise.resolve(m); }

const scrub = (msg, cfg) => {
  let s = String(msg || '');
  for (const v of [cfg.smtp?.pass, cfg.telegram?.token]) if (v) s = s.split(v).join('***');
  return s.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***');
};

/** Pure: nodemailer-Transportoptionen aus der Konfiguration. */
export function transportOptions(smtp, pass) {
  const sec = smtp.security || 'starttls';
  return {
    host: smtp.host, port: Number(smtp.port) || (sec === 'ssl' ? 465 : 587),
    secure: sec === 'ssl', requireTLS: sec === 'starttls', ignoreTLS: sec === 'none',
    auth: smtp.user ? { user: smtp.user, pass: pass || '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}

export async function sendMail(subject, text, { cfg = loadConfig(), nodemailer } = {}) {
  const s = cfg.smtp;
  if (!s.host || !s.from || !s.to?.length) throw new Error('SMTP unvollständig: Host, Absender und Empfänger nötig');
  const nm = nodemailer || (await getNodemailer());
  if (!nm) throw new Error('nodemailer fehlt: im Ordner amber-terminal „npm install“ ausführen (die Startskripte tun das automatisch)');
  try {
    const tr = nm.createTransport(transportOptions(s, s.pass));
    const info = await tr.sendMail({ from: s.from, to: s.to.join(', '), subject, text });
    try { tr.close?.(); } catch { /* egal */ }
    return { ok: true, id: info?.messageId || null, accepted: info?.accepted?.length ?? null };
  } catch (e) {
    throw new Error(`Mail fehlgeschlagen: ${scrub(e.message, cfg)}`);
  }
}

export async function sendTelegram(text, { cfg = loadConfig(), fetchFn = fetch } = {}) {
  if (!cfg.telegram.token || !cfg.telegram.chatId) throw new Error('Telegram unvollständig: Bot-Token und Chat-ID nötig');
  let r;
  try {
    r = await fetchFn(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram.chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) { throw new Error(`Telegram nicht erreichbar: ${scrub(e.message, cfg)}`); }
  let j = null; try { j = await r.json(); } catch { /* kein JSON */ }
  if (!r.ok || j?.ok === false) throw new Error(`Telegram: ${scrub(j?.description || `HTTP ${r.status}`, cfg)}`);
  return { ok: true };
}

/**
 * Ereignis zustellen (Popup macht der Server selbst per SSE). event: { kind, title?, text }
 * Je Kanal: 'off' (nicht eingerichtet oder Typ nicht gewählt), 'sent' oder 'failed: …'.
 */
export async function deliver(event, deps = {}) {
  const cfg = deps.cfg || loadConfig();
  const act = activeChannels(cfg);
  const subject = `Amber Terminal · ${event.title || KINDS[event.kind] || 'Alarm'}`;
  const out = { mail: 'off', telegram: 'off' };
  if (act.mail && cfg.mailKinds.includes(event.kind)) {
    try { await sendMail(subject, `${event.text}\n\n— Amber Terminal (${event.at || new Date().toISOString()})`, { cfg, nodemailer: deps.nodemailer }); out.mail = 'sent'; }
    catch (e) { out.mail = `failed: ${e.message}`; }
  }
  if (act.telegram && cfg.telegramKinds.includes(event.kind)) {
    try { await sendTelegram(`${event.title ? `${event.title}\n` : ''}${event.text}`, { cfg, fetchFn: deps.fetchFn }); out.telegram = 'sent'; }
    catch (e) { out.telegram = `failed: ${e.message}`; }
  }
  return out;
}
/** Wurde irgendein Kanal versucht? */
export const attempted = (d) => !!d && (d.mail !== 'off' || d.telegram !== 'off');
