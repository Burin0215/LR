// คลัง / ประวัติ / แจ้งเตือน / รางวัลวงล้อ — เก็บใน Firestore (ทุกเครื่องเห็นข้อมูลชุดเดียวกัน)
//
// inventories/{user}  = { rose, received, coin, ticket, op }
// logs/{id}           = { userId, itemId, changeType, amount, note, adminNote, timestamp, op }
// notifications/{id}  = { visitorId, visitorName, visitorAvatar, amount, note, read, deleted, timestamp, op }
// config/roulette     = { prizes: [{ label, icon, description, item, amount }], op }
// ops/{id}            = ใบอนุญาตของการเปลี่ยนแปลงแต่ละครั้ง (อ่านไม่ได้) { kind, by, ... }
//   kind 'admin' → Admin ปรับได้ทุกอย่าง
//   kind 'gift'  → { from, to, amount } ย้ายดอกกุหลาบจากคลังผู้ส่งไป "ที่ได้รับ" ของผู้รับพอดี
//   kind 'spin'  → { user, prize } หัก 20 เหรียญ + รางวัลตามช่องวงล้อ
//   kind 'request' → { from, to } Member ขอ 1:1 กับ Member อื่น: ผู้ขอเสียดอกที่ใช้ได้ 5 ดอก
//                    ผู้ถูกขอได้ "ดอกที่ได้รับจาก Member" +5
//
// ประเภทดอกกุหลาบ:
//   rose     = ดอกที่ใช้ได้ (จาก Admin + รางวัลวงล้อ) — ใช้จ่ายได้ (มอบ / ขอ 1:1)
//   received = ดอกที่ได้รับจาก Member (มอบให้ + ถูกขอ 1:1) — แสดงยอดรวมเท่านั้น ใช้จ่ายไม่ได้
// firestore.rules ตรวจตัวเลขทุกครั้ง — แก้คลังตรง ๆ โดยไม่มีใบอนุญาตไม่ได้

const SPIN_COST = 20;
const REQUEST_COST = 5; // ดอกกุหลาบที่ใช้ขอ Request 1:1
// id ของรายการในหน้าเว็บ → ชื่อช่องใน Firestore
const ITEM_FIELDS = { rose: 'rose', rose_received: 'received', elu_coin: 'coin', ticket_1to1: 'ticket' };
const emptyInventory = () => ({ rose: 0, received: 0, coin: 0, ticket: 0 });

const DEFAULT_PRIZES = [
  { label: 'ดอกกุหลาบ 1 ดอก', icon: '🌹' },
  { label: 'ELU Coin 5 เหรียญ', icon: '🪙' },
  { label: 'ตั๋ว 1:1 1 ใบ', icon: '🎫' },
  { label: 'ดอกกุหลาบ 3 ดอก', icon: '🌹' },
  { label: 'ELU Coin 10 เหรียญ', icon: '🪙' },
];

// รางวัลของช่องวงล้อ: ประเภทจากไอคอน/ชื่อ, จำนวน = ตัวเลขตัวแรกในชื่อ (ไม่นับ "1:1")
function prizeReward(prize) {
  const label = String(prize.label || '').toLowerCase();
  let item = 'rose';
  if (prize.icon === '🪙' || label.includes('coin') || label.includes('เหรียญ')) item = 'coin';
  else if (prize.icon === '🎫' || label.includes('ตั๋ว')) item = 'ticket';
  if (prize.icon === '🌹') item = 'rose';
  const match = label.replace('1:1', '').match(/\d+/);
  const amount = match ? Math.min(1000, Math.max(1, parseInt(match[0], 10))) : 1;
  return { item, amount };
}

function normalizePrizes(prizes) {
  return prizes.map((p) => {
    const label = String(p.label || '').trim().slice(0, 40) || 'รางวัล';
    const icon = ['🌹', '🪙', '🎫'].includes(p.icon) ? p.icon : '🌹';
    return { label, icon, description: 'รับ ' + label, ...prizeReward({ label, icon }) };
  });
}

function subscribeInventories(onChange, onError) {
  return authDb().collection('inventories').onSnapshot(
    (snap) => { const map = {}; snap.docs.forEach((d) => { map[d.id] = { ...emptyInventory(), ...d.data() }; }); onChange(map); },
    (err) => onError && onError(err));
}

// userId: ประวัติของคนนั้นเท่านั้น (Member) / ไม่ระบุ: ล่าสุดของทุกคน (Admin)
// (ประหยัดโควตาอ่านของ Firebase แบบฟรี — Member ไม่ต้องโหลดประวัติของคนอื่น)
function subscribeLogs(onChange, onError, userId) {
  const col = authDb().collection('logs');
  const query = userId ? col.where('userId', '==', userId) : col.orderBy('timestamp', 'desc').limit(200);
  return query.onSnapshot(
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.timestamp - a.timestamp)),
    (err) => onError && onError(err));
}

// ประวัติของทุกคนในช่วงเวลา [start, end) — ใช้สรุปดอกประจำสัปดาห์ (Admin)
function subscribeLogsBetween(start, end, onChange, onError) {
  return authDb().collection('logs').where('timestamp', '>=', start).where('timestamp', '<', end).onSnapshot(
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError && onError(err));
}

function subscribeNotifications(onChange, onError) {
  return authDb().collection('notifications').orderBy('timestamp', 'desc').limit(100).onSnapshot(
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => !n.deleted)),
    (err) => onError && onError(err));
}

// onChange(prizes | null) — null = Admin ยังไม่เคยบันทึกวงล้อ
function subscribeRoulette(onChange, onError) {
  return authDb().collection('config').doc('roulette').onSnapshot(
    (snap) => onChange(snap.exists ? snap.data().prizes : null),
    (err) => onError && onError(err));
}

// สร้างคลังเปล่า (0 ทุกช่อง) ให้คนที่ยังไม่มี — ใครสร้างก็ได้เพราะเป็นค่าเริ่มต้น
async function ensureInventories(ids, existing) {
  const db = authDb();
  const missing = ids.filter((id) => !existing[id]);
  if (!missing.length) return;
  const batch = db.batch();
  missing.forEach((id) => batch.set(db.collection('inventories').doc(id), { ...emptyInventory(), op: 'init' }));
  await batch.commit();
}

// บันทึกการเปลี่ยนแปลงทั้งหมดของ 1 เหตุการณ์ในชุดเดียว (สำเร็จทั้งหมดหรือไม่เกิดเลย)
//   op: { kind, ...ข้อมูลเฉพาะ }  by: key PIN ของผู้ทำรายการ
//   updates: [{ user, next: { rose, received, coin, ticket } }]
//   logs / notifications: ข้อมูลที่จะบันทึก (ใส่ timestamp + op ให้อัตโนมัติ)
//   extra(batch, db, opId): เขียนเอกสารอื่นเพิ่มในชุดเดียวกัน (เช่น oneOnOne ของ Request 1:1)
async function commitInventoryChange({ op, by, updates = [], logs = [], notifications = [], roulettePrizes = null, extra = null }) {
  const db = authDb();
  const opRef = db.collection('ops').doc();
  const now = Date.now();
  const batch = db.batch();
  batch.set(opRef, { ...op, by });
  updates.forEach(({ user, next }) => {
    batch.set(db.collection('inventories').doc(user), {
      rose: next.rose, received: next.received, coin: next.coin, ticket: next.ticket, op: opRef.id,
    });
  });
  logs.forEach((log, i) => {
    batch.set(db.collection('logs').doc(), {
      userId: log.userId, itemId: log.itemId, changeType: log.changeType, amount: log.amount,
      note: log.note || '', adminNote: log.adminNote || '', timestamp: now + i, op: opRef.id,
    });
  });
  notifications.forEach((n) => {
    batch.set(db.collection('notifications').doc(), { ...n, read: false, deleted: false, timestamp: now, op: opRef.id });
  });
  if (roulettePrizes) {
    batch.set(db.collection('config').doc('roulette'), { prizes: roulettePrizes, op: opRef.id });
  }
  if (extra) extra(batch, db, opRef.id);
  await batch.commit();
  return opRef.id;
}

// ===== Request 1:1: นับถอยหลัง 24 ชม. หลัง Admin กด Start =====
// oneOnOne/{opId} = { from, to, createdAt, status: waiting|running|stopped, startedAt, endsAt, startedBy, stoppedAt, op, edit }
const ONE_ON_ONE_MS = 24 * 3600e3;

// สถานะที่แสดง: waiting (รอ Admin เริ่ม) / running (กำลังนับ) / ended (ครบ 24 ชม.) / stopped (Admin หยุด)
function oneOnOneState(r, now = Date.now()) {
  if (r.status === 'running') return now >= r.endsAt ? 'ended' : 'running';
  return r.status;
}

// fromUser: เฉพาะคำขอของคนนั้น (Member) / ไม่ระบุ: 50 รายการล่าสุดของทุกคน (Admin)
function subscribeOneOnOne(onChange, onError, fromUser) {
  const col = authDb().collection('oneOnOne');
  const query = fromUser ? col.where('from', '==', fromUser) : col.orderBy('createdAt', 'desc').limit(50);
  return query.onSnapshot(
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt)),
    (err) => onError && onError(err));
}

// Admin: Start / หยุด (ใบอนุญาต kind 'admin' ในชุดเดียวกัน)
function startOneOnOne(requestId, byKey, adminName) {
  const now = Date.now();
  return commitInventoryChange({
    op: { kind: 'admin' }, by: byKey,
    extra: (batch, db, opId) => batch.update(db.collection('oneOnOne').doc(requestId), {
      status: 'running', startedAt: now, endsAt: now + ONE_ON_ONE_MS, startedBy: adminName, edit: opId,
    }),
  });
}
function stopOneOnOne(requestId, byKey) {
  return commitInventoryChange({
    op: { kind: 'admin' }, by: byKey,
    extra: (batch, db, opId) => batch.update(db.collection('oneOnOne').doc(requestId), {
      status: 'stopped', stoppedAt: Date.now(), edit: opId,
    }),
  });
}

function formatCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

// รหัสอ้างอิงสั้น ๆ จาก id ของใบอนุญาต (ใช้ยืนยันรายการกับ Admin)
const refCode = (opId) => String(opId || '').slice(0, 8).toUpperCase();

async function markNotificationsRead(ids) {
  if (!ids.length) return;
  const db = authDb();
  const batch = db.batch();
  ids.forEach((id) => batch.update(db.collection('notifications').doc(id), { read: true }));
  await batch.commit();
}

function hideNotification(id) {
  return authDb().collection('notifications').doc(id).update({ deleted: true });
}
