'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const { DateTime } = require('luxon');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const OWNER_ID = (process.env.TELEGRAM_OWNER_ID || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const TIMEZONE = process.env.TIMEZONE || 'Africa/Khartoum';
const CURRENCY = process.env.CURRENCY || 'SDG';
const MAX_UPLOAD_MB = Math.max(1, Math.min(20, Number(process.env.MAX_UPLOAD_MB || 20)));
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!TOKEN || TOKEN === 'PASTE_NEW_TOKEN_HERE') {
  console.error('Configuration error: set TELEGRAM_BOT_TOKEN to a newly generated token.');
  process.exit(1);
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.startsWith('replace-with-')) {
  console.error('Configuration error: set ADMIN_PASSWORD to a unique password.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32 || SESSION_SECRET.startsWith('replace-with-')) {
  console.error('Configuration error: SESSION_SECRET must be a unique secret of at least 32 characters.');
  process.exit(1);
}

fs.mkdirSync(FILES_DIR, { recursive: true });
const emptyDb = () => ({ tasks: [], notes: [], links: [], transactions: [], files: [] });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2), 'utf8');
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  for (const key of Object.keys(emptyDb())) if (!Array.isArray(db[key])) db[key] = [];
} catch (err) {
  console.error(`Could not read ${DB_FILE}. Back up the file and repair its JSON before restarting.`);
  process.exit(1);
}

function saveDb() {
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(temp, DB_FILE);
}
function id() { return crypto.randomBytes(5).toString('hex'); }
function nowIso() { return new Date().toISOString(); }
function asText(v, max = 2000) { return String(v ?? '').trim().slice(0, max); }
function safeName(v) {
  const cleaned = path.basename(String(v || 'file')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 130);
  return cleaned || 'file';
}
function allowedUrl(input) {
  try { const u = new URL(input); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
function ownerMessage(msg) {
  return `هذا البوت مخصص للاستخدام الشخصي.\nمعرّف حسابك: ${msg.from?.id || 'غير متاح'}`;
}
function isOwner(msg) { return Boolean(OWNER_ID) && String(msg.from?.id) === OWNER_ID; }
function money(amount) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(amount) || 0)} ${CURRENCY}`;
}
function dateForTelegram(value) {
  const dt = DateTime.fromISO(value).setZone(TIMEZONE);
  return dt.isValid ? dt.toFormat('yyyy-LL-dd HH:mm') : value;
}
function parseBotDate(date, time) {
  return DateTime.fromFormat(`${date} ${time}`, 'yyyy-LL-dd HH:mm', { zone: TIMEZONE }).toUTC().toISO();
}
function sendHelp(chatId) {
  return bot.sendMessage(chatId,
`الأوامر الشخصية:
/id — عرض معرّف تيليجرام
/tasks — عرض المهام
/addtask YYYY-MM-DD HH:mm | نص المهمة — إضافة مهمة وتذكير
/done ID — إكمال مهمة
/deltask ID — حذف مهمة
/note نص الملاحظة — حفظ ملاحظة
/notes [كلمة] — البحث في الملاحظات
/delnote ID — حذف ملاحظة
/link https://example.com | عنوان — حفظ رابط
/links — عرض الروابط
/income مبلغ | وصف — تسجيل دخل
/expense مبلغ | وصف — تسجيل مصروف
/balance — ملخص الرصيد
/files — عرض الملفات المحفوظة
/help — عرض المساعدة

مثال:
/addtask 2026-10-24 09:00 | مراجعة التقرير

يمكنك أيضًا إرسال ملف أو صورة إلى البوت لحفظها. الوقت المستخدم: ${TIMEZONE}.`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'personal_assistant_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { httpOnly: true, secure: 'auto', sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));

function requireAuth(req, res, next) {
  if (req.session?.authenticated === true) return next();
  return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
}
function safeCompare(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

app.get('/health', (_req, res) => res.status(200).json({ ok: true, time: nowIso() }));
app.get('/api/me', (req, res) => res.json({ authenticated: req.session?.authenticated === true, timezone: TIMEZONE, currency: CURRENCY }));
app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (!safeCompare(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
  req.session.authenticated = true;
  req.session.loginAt = nowIso();
  return res.json({ ok: true });
});
app.post('/api/logout', requireAuth, (req, res) => req.session.destroy(() => {
  res.clearCookie('personal_assistant_sid');
  res.json({ ok: true });
}));

app.get('/api/data', requireAuth, (_req, res) => {
  const transactions = [...db.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  res.json({
    tasks: [...db.tasks].sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999')),
    notes: [...db.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    links: [...db.links].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    transactions: transactions.slice(0, 100),
    files: [...db.files].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    summary: { income, expenses, balance: income - expenses, currency: CURRENCY, timezone: TIMEZONE }
  });
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const title = asText(req.body?.title, 300);
  const dueAt = req.body?.dueAt ? new Date(req.body.dueAt) : null;
  if (!title) return res.status(400).json({ error: 'اكتب عنوان المهمة.' });
  if (req.body?.dueAt && (!dueAt || Number.isNaN(dueAt.getTime()))) return res.status(400).json({ error: 'موعد المهمة غير صالح.' });
  const task = { id: id(), title, dueAt: dueAt ? dueAt.toISOString() : null, done: false, notifiedAt: null, createdAt: nowIso() };
  db.tasks.push(task); saveDb(); res.status(201).json(task);
});
app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة.' });
  if (typeof req.body?.done === 'boolean') task.done = req.body.done;
  if (req.body?.title !== undefined) {
    const title = asText(req.body.title, 300); if (!title) return res.status(400).json({ error: 'عنوان المهمة مطلوب.' }); task.title = title;
  }
  if (req.body?.dueAt !== undefined) {
    if (req.body.dueAt === null || req.body.dueAt === '') { task.dueAt = null; task.notifiedAt = null; }
    else { const date = new Date(req.body.dueAt); if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'الموعد غير صالح.' }); task.dueAt = date.toISOString(); task.notifiedAt = null; }
  }
  if (task.done) task.completedAt = nowIso(); else delete task.completedAt;
  saveDb(); res.json(task);
});
app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const index = db.tasks.findIndex(t => t.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'المهمة غير موجودة.' });
  db.tasks.splice(index, 1); saveDb(); res.json({ ok: true });
});

app.post('/api/notes', requireAuth, (req, res) => {
  const text = asText(req.body?.text, 10000);
  if (!text) return res.status(400).json({ error: 'نص الملاحظة مطلوب.' });
  const note = { id: id(), text, createdAt: nowIso() };
  db.notes.push(note); saveDb(); res.status(201).json(note);
});
app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const index = db.notes.findIndex(n => n.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'الملاحظة غير موجودة.' });
  db.notes.splice(index, 1); saveDb(); res.json({ ok: true });
});

app.post('/api/links', requireAuth, (req, res) => {
  const url = allowedUrl(asText(req.body?.url, 2000));
  const title = asText(req.body?.title, 300) || url;
  if (!url) return res.status(400).json({ error: 'أدخل رابطًا يبدأ بـ http:// أو https://.' });
  const link = { id: id(), url, title, createdAt: nowIso() };
  db.links.push(link); saveDb(); res.status(201).json(link);
});
app.delete('/api/links/:id', requireAuth, (req, res) => {
  const index = db.links.findIndex(l => l.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'الرابط غير موجود.' });
  db.links.splice(index, 1); saveDb(); res.json({ ok: true });
});

app.post('/api/transactions', requireAuth, (req, res) => {
  const type = req.body?.type;
  const amount = Number(req.body?.amount);
  const description = asText(req.body?.description, 300);
  if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'نوع العملية غير صالح.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر.' });
  const transaction = { id: id(), type, amount: Math.round(amount * 100) / 100, description: description || (type === 'income' ? 'دخل' : 'مصروف'), createdAt: nowIso() };
  db.transactions.push(transaction); saveDb(); res.status(201).json(transaction);
});
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const index = db.transactions.findIndex(t => t.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'العملية غير موجودة.' });
  db.transactions.splice(index, 1); saveDb(); res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FILES_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(safeName(file.originalname)).slice(0, 12)}`)
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 }
});
app.post('/api/files', requireAuth, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `حجم الملف يتجاوز ${MAX_UPLOAD_MB} ميغابايت.` : 'تعذّر رفع الملف.';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'اختر ملفًا أولًا.' });
    const item = { id: id(), originalName: safeName(req.file.originalname), storedName: req.file.filename, mimeType: req.file.mimetype, size: req.file.size, source: 'web', createdAt: nowIso() };
    db.files.push(item); saveDb(); return res.status(201).json(item);
  });
});
app.get('/api/files/:id/download', requireAuth, (req, res) => {
  const item = db.files.find(f => f.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'الملف غير موجود.' });
  const filepath = path.join(FILES_DIR, path.basename(item.storedName));
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'الملف غير موجود على مساحة التخزين.' });
  res.download(filepath, item.originalName);
});
app.delete('/api/files/:id', requireAuth, (req, res) => {
  const index = db.files.findIndex(f => f.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'الملف غير موجود.' });
  const [item] = db.files.splice(index, 1);
  const filepath = path.join(FILES_DIR, path.basename(item.storedName));
  try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}
  saveDb(); res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error('Request error:', err?.message || 'unknown error');
  res.status(500).json({ error: 'حدث خطأ داخلي. راجع سجل الخادم.' });
});

const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', err => console.error('Telegram polling error:', err?.message || 'unknown error'));
bot.on('webhook_error', err => console.error('Telegram webhook error:', err?.message || 'unknown error'));

bot.onText(/^\/id(?:@\w+)?$/i, async msg => {
  const text = `معرّف حسابك في تيليجرام: ${msg.from.id}\n${OWNER_ID ? (String(msg.from.id) === OWNER_ID ? 'الحساب مخوّل لاستخدام البوت.' : 'هذا الحساب غير مخوّل.') : 'أضف هذا الرقم إلى TELEGRAM_OWNER_ID في إعدادات الاستضافة ثم أعد تشغيل الخدمة.'}`;
  try { await bot.sendMessage(msg.chat.id, text); } catch (e) { console.error('Could not send ID reply:', e.message); }
});

function ownerCommand(handler) {
  return async (msg, match) => {
    if (!OWNER_ID) { await bot.sendMessage(msg.chat.id, ownerMessage(msg) + '\nلم يتم ضبط TELEGRAM_OWNER_ID بعد.'); return; }
    if (!isOwner(msg)) { await bot.sendMessage(msg.chat.id, 'غير مصرح لك باستخدام هذا البوت.'); return; }
    try { await handler(msg, match); } catch (err) { console.error('Bot command failed:', err?.message || 'unknown error'); await bot.sendMessage(msg.chat.id, 'حدث خطأ أثناء تنفيذ الأمر.'); }
  };
}

bot.onText(/^\/start(?:@\w+)?$/i, ownerCommand(async msg => {
  await bot.sendMessage(msg.chat.id, `المساعد الشخصي جاهز.\nالوقت: ${TIMEZONE}\n\nاستخدم /help لعرض الأوامر.\nلوحة الويب متاحة على عنوان الاستضافة بعد النشر.`);
}));
bot.onText(/^\/help(?:@\w+)?$/i, ownerCommand(msg => sendHelp(msg.chat.id)));
bot.onText(/^\/tasks(?:@\w+)?$/i, ownerCommand(async msg => {
  const tasks = db.tasks.filter(t => !t.done).sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
  if (!tasks.length) return bot.sendMessage(msg.chat.id, 'لا توجد مهام غير مكتملة.');
  const lines = tasks.slice(0, 30).map(t => `• ${t.id} — ${t.title}${t.dueAt ? `\n  الموعد: ${dateForTelegram(t.dueAt)}` : ''}`);
  await bot.sendMessage(msg.chat.id, lines.join('\n'));
}));
bot.onText(/^\/addtask(?:@\w+)?\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\|\s*(.+)$/i, ownerCommand(async (msg, match) => {
  const dueAt = parseBotDate(match[1], match[2]);
  if (!dueAt || !DateTime.fromISO(dueAt).isValid) return bot.sendMessage(msg.chat.id, 'صيغة التاريخ أو الوقت غير صحيحة. استخدم YYYY-MM-DD HH:mm.');
  if (DateTime.fromISO(dueAt) < DateTime.utc()) return bot.sendMessage(msg.chat.id, 'الموعد في الماضي. أدخل موعدًا مستقبليًا.');
  const task = { id: id(), title: asText(match[3], 300), dueAt, done: false, notifiedAt: null, createdAt: nowIso() };
  db.tasks.push(task); saveDb(); await bot.sendMessage(msg.chat.id, `تمت إضافة المهمة.\nالمعرّف: ${task.id}\nالموعد: ${dateForTelegram(task.dueAt)}`);
}));
bot.onText(/^\/addtask(?:@\w+)?\s*$/i, ownerCommand(msg => bot.sendMessage(msg.chat.id, 'الصيغة: /addtask YYYY-MM-DD HH:mm | نص المهمة\nمثال: /addtask 2026-10-24 09:00 | مراجعة التقرير')));
bot.onText(/^\/(?:done|complete)(?:@\w+)?\s+([a-f0-9]+)$/i, ownerCommand(async (msg, match) => {
  const task = db.tasks.find(t => t.id === match[1]); if (!task) return bot.sendMessage(msg.chat.id, 'لم أجد هذه المهمة.');
  task.done = true; task.completedAt = nowIso(); saveDb(); await bot.sendMessage(msg.chat.id, `تم إكمال المهمة: ${task.title}`);
}));
bot.onText(/^\/deltask(?:@\w+)?\s+([a-f0-9]+)$/i, ownerCommand(async (msg, match) => {
  const i = db.tasks.findIndex(t => t.id === match[1]); if (i < 0) return bot.sendMessage(msg.chat.id, 'لم أجد هذه المهمة.');
  db.tasks.splice(i, 1); saveDb(); await bot.sendMessage(msg.chat.id, 'تم حذف المهمة.');
}));
bot.onText(/^\/note(?:@\w+)?\s+([\s\S]+)$/i, ownerCommand(async (msg, match) => {
  const note = { id: id(), text: asText(match[1], 10000), createdAt: nowIso() }; db.notes.push(note); saveDb();
  await bot.sendMessage(msg.chat.id, `تم حفظ الملاحظة. المعرّف: ${note.id}`);
}));
bot.onText(/^\/notes(?:@\w+)?(?:\s+([\s\S]+))?$/i, ownerCommand(async (msg, match) => {
  const query = asText(match[1] || '').toLocaleLowerCase();
  const found = db.notes.filter(n => !query || n.text.toLocaleLowerCase().includes(query)).slice(-12).reverse();
  if (!found.length) return bot.sendMessage(msg.chat.id, 'لا توجد ملاحظات مطابقة.');
  await bot.sendMessage(msg.chat.id, found.map(n => `• ${n.id} — ${n.text.slice(0, 400)}`).join('\n\n'));
}));
bot.onText(/^\/delnote(?:@\w+)?\s+([a-f0-9]+)$/i, ownerCommand(async (msg, match) => {
  const i = db.notes.findIndex(n => n.id === match[1]); if (i < 0) return bot.sendMessage(msg.chat.id, 'لم أجد هذه الملاحظة.');
  db.notes.splice(i, 1); saveDb(); await bot.sendMessage(msg.chat.id, 'تم حذف الملاحظة.');
}));
bot.onText(/^\/link(?:@\w+)?\s+(https?:\/\/\S+)(?:\s*\|\s*(.*))?$/i, ownerCommand(async (msg, match) => {
  const url = allowedUrl(match[1]); if (!url) return bot.sendMessage(msg.chat.id, 'أدخل رابطًا صحيحًا يبدأ بـ https:// أو http://.');
  const link = { id: id(), url, title: asText(match[2] || '', 300) || url, createdAt: nowIso() }; db.links.push(link); saveDb();
  await bot.sendMessage(msg.chat.id, `تم حفظ الرابط: ${link.title}\nالمعرّف: ${link.id}`);
}));
bot.onText(/^\/links(?:@\w+)?$/i, ownerCommand(async msg => {
  if (!db.links.length) return bot.sendMessage(msg.chat.id, 'لا توجد روابط محفوظة.');
  await bot.sendMessage(msg.chat.id, db.links.slice(-20).reverse().map(l => `• ${l.id} — ${l.title}\n${l.url}`).join('\n\n'));
}));
async function saveTransaction(msg, type, match) {
  const amount = Number(String(match[1]).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return bot.sendMessage(msg.chat.id, 'المبلغ غير صحيح. مثال: /expense 1500 | مواصلات');
  const tx = { id: id(), type, amount: Math.round(amount * 100) / 100, description: asText(match[2] || '', 300) || (type === 'income' ? 'دخل' : 'مصروف'), createdAt: nowIso() };
  db.transactions.push(tx); saveDb(); await bot.sendMessage(msg.chat.id, `تم تسجيل ${type === 'income' ? 'دخل' : 'مصروف'} بقيمة ${money(tx.amount)} — ${tx.description}`);
}
bot.onText(/^\/income(?:@\w+)?\s+([\d,.]+)(?:\s*\|\s*(.*))?$/i, ownerCommand((msg, match) => saveTransaction(msg, 'income', match)));
bot.onText(/^\/expense(?:@\w+)?\s+([\d,.]+)(?:\s*\|\s*(.*))?$/i, ownerCommand((msg, match) => saveTransaction(msg, 'expense', match)));
bot.onText(/^\/balance(?:@\w+)?$/i, ownerCommand(async msg => {
  const inc = db.transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const exp = db.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  await bot.sendMessage(msg.chat.id, `إجمالي الدخل: ${money(inc)}\nإجمالي المصروفات: ${money(exp)}\nالرصيد: ${money(inc - exp)}`);
}));
bot.onText(/^\/files(?:@\w+)?$/i, ownerCommand(async msg => {
  const list = db.files.slice(-15).reverse();
  if (!list.length) return bot.sendMessage(msg.chat.id, 'لا توجد ملفات محفوظة. أرسل مستندًا أو صورة إلى البوت.');
  await bot.sendMessage(msg.chat.id, list.map(f => `• ${f.id} — ${f.originalName}`).join('\n'));
}));

bot.on('message', async msg => {
  // File messages are stored only for the configured owner; text commands are handled above.
  if (!msg.from || !msg.chat || !OWNER_ID || !isOwner(msg)) return;
  let fileId = null; let originalName = null; let mimeType = 'application/octet-stream';
  if (msg.document) {
    fileId = msg.document.file_id; originalName = safeName(msg.document.file_name || 'document'); mimeType = msg.document.mime_type || mimeType;
  } else if (Array.isArray(msg.photo) && msg.photo.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id; originalName = `telegram-photo-${Date.now()}.jpg`; mimeType = 'image/jpeg';
  } else if (msg.video) {
    fileId = msg.video.file_id; originalName = safeName(msg.video.file_name || `video-${Date.now()}.mp4`); mimeType = msg.video.mime_type || 'video/mp4';
  } else if (msg.audio) {
    fileId = msg.audio.file_id; originalName = safeName(msg.audio.file_name || `audio-${Date.now()}.mp3`); mimeType = msg.audio.mime_type || 'audio/mpeg';
  } else if (msg.voice) {
    fileId = msg.voice.file_id; originalName = `voice-${Date.now()}.ogg`; mimeType = 'audio/ogg';
  }
  if (!fileId) return;
  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await fetch(fileLink);
    if (!response.ok) throw new Error(`file download failed (${response.status})`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_UPLOAD_MB * 1024 * 1024) {
      await bot.sendMessage(msg.chat.id, `الملف أكبر من الحد الحالي (${MAX_UPLOAD_MB} ميغابايت).`); return;
    }
    const storedName = `${crypto.randomUUID()}${path.extname(originalName).slice(0, 12)}`;
    fs.writeFileSync(path.join(FILES_DIR, storedName), Buffer.from(arrayBuffer));
    const item = { id: id(), originalName, storedName, mimeType, size: arrayBuffer.byteLength, source: 'telegram', createdAt: nowIso() };
    db.files.push(item); saveDb();
    await bot.sendMessage(msg.chat.id, `تم حفظ الملف: ${originalName}\nالمعرّف: ${item.id}`);
  } catch (err) {
    console.error('Could not save Telegram attachment:', err?.message || 'unknown error');
    try { await bot.sendMessage(msg.chat.id, 'تعذّر حفظ الملف. جرّب ملفًا أصغر.'); } catch {}
  }
});

setInterval(async () => {
  if (!OWNER_ID) return;
  const due = db.tasks.filter(t => !t.done && t.dueAt && !t.notifiedAt && new Date(t.dueAt).getTime() <= Date.now());
  for (const task of due) {
    try {
      await bot.sendMessage(Number(OWNER_ID), `⏰ تذكير بالمهمة\n${task.title}\nالمعرّف: ${task.id}\n\nلإكمالها أرسل: /done ${task.id}`);
      task.notifiedAt = nowIso(); saveDb();
    } catch (err) { console.error(`Reminder send failed for ${task.id}:`, err?.message || 'unknown error'); }
  }
}, 30 * 1000).unref();

const server = app.listen(PORT, '0.0.0.0', () => console.log(`Personal assistant dashboard listening on port ${PORT}`));
async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  try { await bot.stopPolling(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
