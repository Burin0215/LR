// Love Roulette → Discord (Google Apps Script Web App)
//
// ตั้งค่า (ครั้งเดียว):
//   1. script.google.com → New project → วางโค้ดนี้ทั้งไฟล์
//   2. Project Settings → Script Properties → Add property
//        DISCORD_WEBHOOK       = ลิงก์ Webhook ห้องหลัก (โพสต์ใหม่ / 1:1 เริ่ม-หยุด-ครบ 24 ชม.)
//        DISCORD_WEBHOOK_ADMIN = ลิงก์ Webhook ห้อง Log แอดมิน (มอบดอก / Request / แก้คลัง / วงล้อ / โควตา)
//        (Channel → Edit Channel → Integrations → Webhooks — ไม่ตั้งห้องแอดมิน = ส่งเข้าห้องหลัก)
//   3. เลือกฟังก์ชัน setup แล้วกด Run (อนุญาตสิทธิ์) — สร้างตัวเช็ค "ครบ 24 ชม." ทุก 5 นาที
//   4. Deploy → New deployment → Web app → Execute as: Me / Who has access: Anyone → Deploy
//   5. คัดลอก Web app URL (…/exec) ไปใส่ DISCORD_RELAY_URL ใน notify.js
//
// หน้าเว็บส่งแค่ข้อมูลเหตุการณ์ — ข้อความ Discord สร้างที่นี่จากรายการที่อนุญาตเท่านั้น

const SITE_URL = 'https://burin0215.github.io/LR/';
const MAX_PER_MINUTE = 20; // กันสแปม
const COLORS = {
  request: 0xec4899, ooo_start: 0xf59e0b, ooo_stop: 0x78716c, ooo_end: 0x10b981, gift: 0xe11d48, post: 0x8b5cf6,
  admin_inv: 0x0ea5e9, admin_reset: 0xdc2626, spin: 0xa855f7, quota: 0xf97316,
};
// เหตุการณ์ที่ไปห้อง Log แอดมิน (ที่เหลือไปห้องหลัก)
const ADMIN_TYPES = ['gift', 'request', 'admin_inv', 'admin_reset', 'spin', 'quota'];

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!rateOk()) return reply('rate');
    const embed = buildEmbed(d);
    if (!embed) return reply('bad');
    sendDiscord(embed, d.type);
    if (d.type === 'ooo_start') trackRunning(d);
    if (d.type === 'ooo_stop') untrack(clean(d.code, 12));
    return reply('ok');
  } catch (err) {
    return reply('error');
  }
}

function doGet() {
  return reply('Love Roulette Discord relay');
}

// ข้อความจากหน้าเว็บ: ตัดความยาว + ตัด @ และ ` (กันแท็ก @everyone / แต่งข้อความ)
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[@`]/g, '').slice(0, max || 60);
}
function unix(ms) {
  return Math.floor(Number(ms) / 1000);
}

function buildEmbed(d) {
  const from = clean(d.from), to = clean(d.to), code = clean(d.code, 12);
  switch (d.type) {
    case 'request':
      return {
        title: '💞 Request 1:1 ใหม่',
        description: `**${from}** ขอ 1:1 กับ **${to}**\nจ่ายด้วย: ${clean(d.pay)}\nรหัสอ้างอิง: \`${code}\`\n\nรอ Admin กด Start`,
      };
    case 'ooo_start': {
      const ends = Number(d.endsAt);
      if (!(ends > Date.now() && ends < Date.now() + 25 * 3600e3)) return null;
      return {
        title: '⏳ เริ่มนับถอยหลัง 24 ชม.',
        description: `**${from}** ➔ **${to}**\nเริ่มโดย: ${clean(d.by)}\nครบเวลา: <t:${unix(ends)}:f> (<t:${unix(ends)}:R>)\nรหัสอ้างอิง: \`${code}\``,
      };
    }
    case 'ooo_stop':
      return { title: '⏹️ หยุดนับถอยหลัง', description: `**${from}** ➔ **${to}**\nรหัสอ้างอิง: \`${code}\`` };
    case 'gift': {
      const amount = Math.max(1, Math.min(1000, parseInt(d.amount, 10) || 1));
      return { title: '🌹 มอบดอกกุหลาบ', description: `**${from}** มอบให้ **${to}** ${amount} ดอก` };
    }
    case 'post': {
      const images = Math.max(0, Math.min(2, parseInt(d.images, 10) || 0));
      const text = clean(d.text, 200);
      return {
        title: '📝 โพสต์ใหม่ในไทม์ไลน์',
        description: `**${clean(d.author)}**${d.feeling ? ' — ' + clean(d.feeling, 40) : ''}\n${text || '_(รูปภาพ)_'}${images ? `\n🖼️ ${images} รูป` : ''}\n\n[เปิดดูไทม์ไลน์](${SITE_URL})`,
      };
    }
    case 'admin_inv': {
      const delta = parseInt(d.delta, 10) || 0;
      const total = parseInt(d.total, 10) || 0;
      if (!delta) return null;
      return {
        title: delta > 0 ? '🛠️ แอดมินเพิ่มของในคลัง' : '🛠️ แอดมินลดของในคลัง',
        description: `**${clean(d.name)}** — ${clean(d.item, 40)} ${delta > 0 ? '+' : ''}${delta} ${clean(d.unit, 10)} (คงเหลือ ${total})`
          + `${d.reason ? `\nเหตุผล: ${clean(d.reason, 40)}` : ''}\nโดย: ${clean(d.by)}`,
      };
    }
    case 'admin_reset':
      return { title: '⚠️ Reset คลังของ Member ทุกคน', description: `โดย: ${clean(d.by)}` };
    case 'spin':
      return { title: '🎡 หมุน Love Roulette', description: `**${clean(d.name)}** ได้รับ **${clean(d.prize, 40)}**` };
    case 'quota': {
      const current = parseInt(d.current, 10) || 0, amount = parseInt(d.amount, 10) || 0, limit = parseInt(d.limit, 10) || 10;
      return {
        title: '🚨 แจกดอกประจำสัปดาห์เกินโควตา',
        description: `**${clean(d.name)}** ได้ไปแล้ว ${current}/${limit} ดอก — เพิ่มอีก ${amount} ดอก เป็น **${current + amount}/${limit}**\nยืนยันโดย: ${clean(d.by)}`,
      };
    }
    default:
      return null;
  }
}

function sendDiscord(embed, type) {
  const props = PropertiesService.getScriptProperties();
  const url = (ADMIN_TYPES.includes(type) && props.getProperty('DISCORD_WEBHOOK_ADMIN')) || props.getProperty('DISCORD_WEBHOOK');
  if (!url) throw new Error('DISCORD_WEBHOOK not set');
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      username: 'Love Roulette',
      allowed_mentions: { parse: [] },
      embeds: [{ ...embed, color: embed.color || COLORS[type] || 0xec4899, timestamp: new Date().toISOString() }],
    }),
  });
}

function rateOk() {
  const cache = CacheService.getScriptCache();
  const key = 'rate_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(key) || 0);
  if (n >= MAX_PER_MINUTE) return false;
  cache.put(key, String(n + 1), 120);
  return true;
}

// ===== ครบ 24 ชม.: จำรายการที่กำลังนับไว้ แล้วตัวเช็คทุก 5 นาทีส่งแจ้งเมื่อครบ =====
function withRunning(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const list = JSON.parse(props.getProperty('RUNNING') || '[]');
    const next = fn(list);
    props.setProperty('RUNNING', JSON.stringify(next.slice(-50)));
  } finally {
    lock.releaseLock();
  }
}
function trackRunning(d) {
  const item = { code: clean(d.code, 12), from: clean(d.from), to: clean(d.to), endsAt: Number(d.endsAt) };
  withRunning((list) => list.filter((x) => x.code !== item.code).concat([item]));
}
function untrack(code) {
  withRunning((list) => list.filter((x) => x.code !== code));
}
function checkEnded() {
  const done = [];
  withRunning((list) => list.filter((x) => (x.endsAt <= Date.now() ? (done.push(x), false) : true)));
  done.forEach((x) => sendDiscord({
    title: '✅ ครบ 24 ชม. แล้ว',
    description: `**${x.from}** ➔ **${x.to}**\nรหัสอ้างอิง: \`${x.code}\``,
    color: COLORS.ooo_end,
  }));
}

// รันครั้งเดียวตอนตั้งค่า
function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkEnded')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkEnded').timeBased().everyMinutes(5).create();
}

// ทดสอบส่งข้อความ (กด Run ใน Apps Script)
function testSend() {
  sendDiscord({ title: '🔔 ทดสอบ', description: 'Love Roulette เชื่อม Discord สำเร็จ 💖' });
}
function testSendAdmin() {
  sendDiscord({ title: '🔔 ทดสอบห้อง Log แอดมิน', description: 'Love Roulette เชื่อมห้อง Log แอดมินสำเร็จ 🛡️' }, 'admin_inv');
}

function reply(text) {
  return ContentService.createTextOutput(text);
}
