// รายชื่อผู้ใช้ที่อนุญาต — PIN ไม่ได้อยู่ในโค้ดแล้ว แต่ตรวจกับ Firestore (ดู firestore.rules)
const ACCOUNTS = [
  { name: "Faye", role: "user" },
  { name: "Piink", role: "user" },
  { name: "Qin", role: "user" },
  { name: "Beam", role: "user" },
  { name: "Third", role: "user" },
  { name: "Bac", role: "user" },
  { name: "Feen", role: "user" },
  { name: "Jet", role: "user" },
  { name: "Rita", role: "user" },
  { name: "Nezumi", role: "user" },
  { name: "Teddy", role: "user" },
  { name: "Rohinii", role: "user" },
  { name: "Lu", role: "admin" },
  { name: "Eros", role: "admin" },
  { name: "Siren", role: "admin" },
  { name: "Amor", role: "admin" },
];

const SESSION_KEY = "suankularb.session";

// ===== PIN ใน Firestore =====
// gens/{id}      = { gen, role, change }  รุ่นของ PIN ปัจจุบัน (อ่านได้ ไม่มีข้อมูลลับ)
// pinkeys/{key}  = { user, gen, change }  key = SHA-256("suankularb:<ชื่อ>:<PIN>:<gen>")
//                  อ่านได้ทีละ doc เมื่อรู้ key เท่านั้น (list ไม่ได้) → รู้ PIN ถึงจะตรวจได้
// changes/{id}   = { user, gen, by }      ใบอนุญาตเปลี่ยน PIN (อ่านไม่ได้) by = key ของผู้อนุมัติ
// เปลี่ยน PIN = gen +1 → key ของ PIN เก่าใช้ไม่ได้ทันที

const PIN_SALT = "suankularb";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function authDb() {
  if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) {
    throw new Error("ยังไม่ได้ตั้งค่า Firebase");
  }
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
  return app.firestore();
}

const accountId = (name) => name.toLowerCase();
const pinKey = (name, pin, gen) => sha256(`${PIN_SALT}:${name}:${pin}:${gen}`);

// คืน { key, gen } ถ้า PIN ถูกต้อง, null ถ้าผิด
async function verifyPin(name, pin) {
  const account = ACCOUNTS.find((a) => a.name === name);
  if (!account || !/^\d{4}$/.test(pin)) return null;
  const db = authDb();
  const id = accountId(name);
  const genSnap = await db.collection("gens").doc(id).get();
  if (!genSnap.exists) return null;
  const gen = genSnap.data().gen;
  const key = await pinKey(name, pin, gen);
  const keySnap = await db.collection("pinkeys").doc(key).get();
  if (!keySnap.exists) return null;
  const data = keySnap.data();
  return data.user === id && data.gen === gen ? { key, gen } : null;
}

async function login(name, pin) {
  const ok = await verifyPin(name, pin);
  if (!ok) return null;
  const account = ACCOUNTS.find((a) => a.name === name);
  const session = { name: account.name, role: account.role, at: Date.now() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

// ตั้ง PIN ใหม่ให้ targetName โดยใช้ PIN ของ authName ยืนยัน
//   - แก้ของตัวเอง: authName === targetName, authPin = PIN เดิม
//   - Admin รีเซ็ตให้คนอื่น: authName = Admin, authPin = PIN ของ Admin
// คืนข้อความ error (string) หรือ null เมื่อสำเร็จ
async function setPin(authName, authPin, targetName, newPin) {
  if (!/^\d{4}$/.test(newPin)) return "PIN ใหม่ต้องเป็นตัวเลข 4 หลัก";
  const auth = await verifyPin(authName, authPin);
  if (!auth) return authName === targetName ? "PIN เดิมไม่ถูกต้อง" : "PIN ของคุณ (Admin) ไม่ถูกต้อง";

  const db = authDb();
  const targetId = accountId(targetName);
  const genRef = db.collection("gens").doc(targetId);
  const genSnap = await genRef.get();
  if (!genSnap.exists) return "ไม่พบผู้ใช้นี้ในระบบ";
  const newGen = genSnap.data().gen + 1;
  const newKey = await pinKey(targetName, newPin, newGen);
  const changeRef = db.collection("changes").doc();

  const batch = db.batch();
  batch.set(changeRef, { user: targetId, gen: newGen, by: auth.key });
  batch.update(genRef, { gen: newGen, change: changeRef.id });
  batch.set(db.collection("pinkeys").doc(newKey), { user: targetId, gen: newGen, change: changeRef.id });
  try {
    await batch.commit();
    return null;
  } catch (err) {
    return "บันทึกไม่สำเร็จ: " + (err && err.message ? err.message : err);
  }
}

function currentSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
