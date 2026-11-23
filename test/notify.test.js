// AT-16: Benachrichtigungen — Konfiguration in den Einstellungen (tools.NOTIFY), Geheimnisse maskiert, Kanäle aktiv
// wenn ausgefüllt, Mehrfachauswahl je Kanal, Telegram (fetch gemockt), Mail über nodemailer
// gegen einen lokalen Fake-SMTP-Server, API-Routen, Abhängigkeits-Prüfung der Startskripte (scripts/deps.js).
import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

process.env.QT_OFFLINE = '1';
const cfgMod = await import('../lib/notify-config.js');
const notify = await import('../lib/notify.js');
const { depsState } = await import('../scripts/deps.js');
const { start } = await import('../server.js');

const TOKEN = '123456789:FAKEFAKEFAKEFAKEFAKE_test-x';
let server, base;
const H = { 'x-qt': '1', 'Content-Type': 'application/json' };
before(async () => { const s = await start(41000 + Math.floor(Math.random() * 1000)); server = s.server; base = `http://127.0.0.1:${s.port}`; });
after(() => server.close());

const settingsFile = () => path.join(TEST_DATA_DIR, 'settings.json');

test('Konfiguration in settings.json (isoliert): Geheimnisse nie zurückgeben, leer = behalten, löschen ausdrücklich', () => {
  assert.ok(!TEST_DATA_DIR.startsWith(REAL_DATA_DIR), 'nur isoliertes QT_DATA_DIR');
  let c = cfgMod.publicConfig();
  assert.deepEqual(c.active, { mail: false, telegram: false }, 'leer = kein Versand');
  assert.deepEqual(c.mailKinds, ['price', 'gsw', 'rslSell', 'rslBuy'], 'Standard: alle Typen');
  assert.deepEqual(c.bellKinds, ['price', 'gsw', 'rslSell', 'rslBuy'], 'Glocke: Standard alle (bisheriges Verhalten)');
  c = cfgMod.saveConfig({ smtp: { host: 'smtp.example.com', port: '587', security: 'starttls', user: 'u', from: 'Amber <a@example.com>', to: 'x@example.com; y@example.com' },
    telegram: { chatId: '-1001234' }, mailKinds: ['gsw', 'rslSell'], smtpPass: 'Geheim!pw', telegramToken: TOKEN });
  const json = JSON.stringify(c);
  assert.ok(!json.includes('Geheim!pw') && !json.includes(TOKEN));
  assert.deepEqual(c.secrets, { smtpPass: true, telegramToken: true });
  assert.deepEqual(c.active, { mail: true, telegram: true });
  assert.deepEqual(c.smtp.to, ['x@example.com', 'y@example.com']);
  assert.deepEqual(c.mailKinds, ['gsw', 'rslSell']);
  assert.deepEqual(c.telegramKinds, ['price', 'gsw', 'rslSell', 'rslBuy']);
  const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  assert.equal(raw.tools.NOTIFY.smtp.pass, 'Geheim!pw', 'in den normalen Einstellungen');
  assert.equal(raw.tools.NOTIFY.telegram.token, TOKEN);
  for (const f of ['notify.json', 'notify-secrets.json']) assert.ok(!fs.existsSync(path.join(TEST_DATA_DIR, f)), `keine ${f}`);
  c = cfgMod.saveConfig({ smtp: { host: 'smtp2.example.com' }, smtpPass: '', telegramToken: '' });
  assert.equal(c.smtp.host, 'smtp2.example.com');
  assert.equal(cfgMod.loadConfig().smtp.pass, 'Geheim!pw');
  assert.equal(cfgMod.loadConfig().telegram.token, TOKEN);
  c = cfgMod.saveConfig({ clearSmtpPass: true });
  assert.equal(c.secrets.smtpPass, false);
  assert.equal(c.active.mail, true, 'Mail ohne Passwort (Relay ohne AUTH) bleibt aktiv');
  c = cfgMod.saveConfig({ clearTelegramToken: true });
  assert.equal(c.active.telegram, false, 'ohne Token kein Telegram');
  cfgMod.saveConfig({ telegramToken: TOKEN, mailKinds: [] });
  assert.deepEqual(cfgMod.loadConfig().mailKinds, [], 'keine Auswahl = über diesen Kanal nichts');
  cfgMod.saveConfig({ mailKinds: ['gsw', 'rslSell'] });
});

test('Konfiguration: Eingaben werden geprüft', () => {
  const before = JSON.stringify(cfgMod.loadConfig());
  for (const body of [{ smtp: { port: 0 } }, { smtp: { security: 'tls13' } }, { smtp: { host: 'bad host;' } }, { smtp: { to: 'kein-mail' } },
    { smtp: { from: 'x' } }, { telegram: { chatId: 'abc def' } }, { telegramToken: 'nope' }])
    assert.throws(() => cfgMod.saveConfig(body), (e) => e.status === 400, JSON.stringify(body));
  assert.equal(JSON.stringify(cfgMod.loadConfig()), before, 'ungültiges Speichern ändert nichts');
});

test('deliver: nur eingerichtete Kanäle und gewählte Typen; Fehler ohne Token im Text', async () => {
  const cfg = cfgMod.loadConfig(); // mail: gsw+rslSell, telegram: alle
  const calls = [];
  const ok = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const sent = [];
  const nm = { createTransport: (opt) => ({ sendMail: async (m) => { sent.push({ opt, m }); return { messageId: '<1>', accepted: m.to.split(',') }; } }) };
  const d = await notify.deliver({ kind: 'gsw', title: 'GSW: Swap fällig', text: 'EWG2 → Silber' }, { cfg, fetchFn: ok, nodemailer: nm });
  assert.deepEqual(d, { mail: 'sent', telegram: 'sent' });
  assert.equal(notify.attempted(d), true);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].body.chat_id, '-1001234');
  assert.match(calls[0].body.text, /Swap fällig/);
  assert.equal(sent[0].opt.requireTLS, true);
  assert.equal(sent[0].opt.auth.user, 'u');
  assert.match(sent[0].m.subject, /GSW: Swap fällig/);
  const price = await notify.deliver({ kind: 'price', text: 'p' }, { cfg, fetchFn: ok, nodemailer: nm });
  assert.deepEqual(price, { mail: 'off', telegram: 'sent' }, 'Kurs nicht für Mail gewählt');
  const empty = cfgMod.defaults();
  const none = await notify.deliver({ kind: 'gsw', text: 'x' }, { cfg: empty, fetchFn: ok, nodemailer: nm });
  assert.deepEqual(none, { mail: 'off', telegram: 'off' }, 'nicht eingetragen = kein Versand');
  assert.equal(notify.attempted(none), false);
  const fail = async (url) => { throw new Error(`connect ECONNREFUSED ${url}`); };
  const bad = await notify.deliver({ kind: 'gsw', text: 'x' }, { cfg, fetchFn: fail, nodemailer: nm });
  assert.match(bad.telegram, /^failed: /);
  assert.ok(!bad.telegram.includes(TOKEN.split(':')[1]), 'Token nicht in der Fehlermeldung');
  const tgErr = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) });
  await assert.rejects(notify.sendTelegram('x', { cfg, fetchFn: tgErr }), /chat not found/);
});

test('fehlendes nodemailer: klare Meldung, Telegram läuft weiter', async () => {
  notify._setNodemailer(null);
  try {
    const cfg = cfgMod.loadConfig();
    await assert.rejects(notify.sendMail('s', 't', { cfg }), /nodemailer fehlt.*npm install/);
  } finally { notify._setNodemailer(null); }
  // wieder echtes Paket laden
  const real = (await import('nodemailer')).default;
  notify._setNodemailer(real);
});

test('nodemailer gegen lokalen Fake-SMTP-Server: AUTH, Empfänger, UTF-8-Betreff', async () => {
  const seen = { auth: null, rcpt: [], data: '' };
  const srv = net.createServer((sock) => {
    let buf = '', inData = false;
    const w = (s) => sock.write(`${s}\r\n`);
    w('220 fake ESMTP');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; w('250 OK queued'); } else seen.data += `${line}\n`; continue; }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) { sock.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
        else if (cmd.startsWith('AUTH PLAIN')) { seen.auth = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8'); w('235 ok'); }
        else if (cmd.startsWith('MAIL FROM')) w('250 ok');
        else if (cmd.startsWith('RCPT TO')) { seen.rcpt.push(line.slice(8)); w('250 ok'); }
        else if (cmd === 'DATA') { inData = true; w('354 go'); }
        else if (cmd === 'QUIT') { w('221 bye'); sock.end(); }
        else w('250 ok');
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = { ...cfgMod.loadConfig(), smtp: { host: '127.0.0.1', port: srv.address().port, security: 'none', user: 'bot@example.com', from: 'Amber <a@example.com>', to: ['x@example.com', 'y@example.com'], pass: 'pw' } };
    const r = await notify.sendMail('Swap fällig: Gold → Silber', 'Text mit Ümlaut', { cfg });
    assert.equal(r.ok, true);
    assert.equal(seen.auth, '\0bot@example.com\0pw');
    assert.deepEqual(seen.rcpt.map((s) => s.replace(/[<>]/g, '')), ['x@example.com', 'y@example.com']);
    const subj = (seen.data.match(/^Subject: (.+(?:\n[ \t].+)*)/m) || [])[1] || '';
    assert.match(subj, /=\?UTF-8\?/i, 'Betreff MIME-kodiert');
    // falsches Passwort → Fehlermeldung ohne Passwort
    const refuse = net.createServer((s) => { s.write('220 x\r\n'); s.on('data', (d) => { const l = d.toString(); if (/^EHLO/i.test(l)) s.write('250-x\r\n250 AUTH PLAIN\r\n'); else if (/^AUTH/i.test(l)) s.write('535 auth failed\r\n'); else s.write('250 ok\r\n'); }); });
    await new Promise((res) => refuse.listen(0, '127.0.0.1', res));
    try {
      await assert.rejects(notify.sendMail('s', 't', { cfg: { ...cfg, smtp: { ...cfg.smtp, port: refuse.address().port, pass: 'SuperGeheim123' } } }),
        (e) => /Mail fehlgeschlagen/.test(e.message) && !e.message.includes('SuperGeheim123'));
    } finally { refuse.close(); }
  } finally { srv.close(); }
});

test('API: Geheimnisse auch über /api/settings maskiert, Test-Endpunkt, Liste/Zähler/Quittieren', async () => {
  const g = await (await fetch(`${base}/api/notify/config`)).json();
  assert.ok(!JSON.stringify(g).includes(TOKEN) && !JSON.stringify(g).includes('Geheim'));
  assert.equal(g.secrets.telegramToken, true);
  assert.equal(g.active.telegram, true);
  for (const u of ['/api/settings', '/api/settings?tool=NOTIFY']) {
    const t = await (await fetch(`${base}${u}`)).text();
    assert.ok(!t.includes(TOKEN), `${u} ohne Token`);
    assert.ok(t.includes('"telegramToken":true'), `${u} zeigt „gesetzt“`);
  }
  // generischer Settings-Weg speichert geprüft und behält Geheimnisse
  const put = await fetch(`${base}/api/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ tool: 'NOTIFY', settings: { telegram: { chatId: '777' } } }) });
  assert.equal(put.status, 200);
  assert.ok(!(await put.text()).includes(TOKEN));
  assert.equal(cfgMod.loadConfig().telegram.token, TOKEN);
  assert.equal(cfgMod.loadConfig().telegram.chatId, '777');
  assert.equal((await fetch(`${base}/api/notify/config`, { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 403, 'ohne x-qt kein Schreiben');
  const bad = await fetch(`${base}/api/notify/config`, { method: 'PUT', headers: H, body: JSON.stringify({ smtp: { port: 99999 } }) });
  assert.equal(bad.status, 400);
  // Telegram-Test mit ungültigem Ziel: Server ist offline (QT_OFFLINE) → kein echter Versand nötig; Kanal-Fehler = 400/502
  const noCh = await fetch(`${base}/api/notify/test`, { method: 'POST', headers: H, body: JSON.stringify({ channel: 'fax' }) });
  assert.equal(noCh.status, 400);
  cfgMod.saveConfig({ clearTelegramToken: true });
  const t = await fetch(`${base}/api/notify/test`, { method: 'POST', headers: H, body: JSON.stringify({ channel: 'telegram' }) });
  assert.equal(t.status, 502);
  assert.match((await t.json()).error, /Telegram unvollständig/);
  const list = await (await fetch(`${base}/api/status-alerts`)).json();
  assert.ok(Array.isArray(list.rows));
  assert.deepEqual(list.providers.map((p) => p.id).sort(), ['gsw', 'rsl']);
  assert.deepEqual(list.channels, { mail: true, telegram: false });
  assert.deepEqual(list.bellKinds, ['price', 'gsw', 'rslSell', 'rslBuy']);
  const bell = await (await fetch(`${base}/api/notify/config`, { method: 'PUT', headers: H, body: JSON.stringify({ bellKinds: ['rslSell', 'bogus'] }) })).json();
  assert.deepEqual(bell.bellKinds, ['rslSell'], 'Glocke gespeichert (tools.NOTIFY, Testordner), unbekannte Typen verworfen');
  assert.ok(cfgMod.loadConfig().mailKinds.length > 0, 'andere Kanäle unverändert');
  assert.deepEqual((await (await fetch(`${base}/api/status-alerts`)).json()).bellKinds, ['rslSell']);
  cfgMod.saveConfig({ bellKinds: ['price', 'gsw', 'rslSell', 'rslBuy'] });
  const cnt = await (await fetch(`${base}/api/status-alerts/count`)).json();
  assert.equal(typeof cnt.unacked, 'number');
  const a404 = await fetch(`${base}/api/status-alerts/ack`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'gibts-nicht' }) });
  assert.equal(a404.status, 404);
  const all = await (await fetch(`${base}/api/status-alerts/ack`, { method: 'POST', headers: H, body: JSON.stringify({ all: true }) })).json();
  assert.equal(all.unacked, 0);
});

test('Startskripte: deps.js erkennt fehlende/veraltete Abhängigkeiten', () => {
  const d = fs.mkdtempSync(path.join(TEST_DATA_DIR, 'deps-'));
  assert.equal(depsState(d).need, false, 'ohne package.json');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ dependencies: { nodemailer: '^10' } }));
  assert.deepEqual(depsState(d).missing, ['nodemailer']);
  fs.mkdirSync(path.join(d, 'node_modules', 'nodemailer'), { recursive: true });
  fs.writeFileSync(path.join(d, 'node_modules', 'nodemailer', 'package.json'), '{}');
  assert.match(depsState(d).why, /ohne npm-Marke/);
  const marker = path.join(d, 'node_modules', '.package-lock.json');
  fs.writeFileSync(marker, '{}');
  const now = Date.now() / 1000;
  fs.utimesSync(path.join(d, 'package.json'), now - 100, now - 100);
  assert.equal(depsState(d).need, false);
  fs.utimesSync(path.join(d, 'package.json'), now + 100, now + 100);
  assert.match(depsState(d).why, /neuer/);
  assert.equal(depsState().need, false, 'Projekt selbst ist installiert');
});
