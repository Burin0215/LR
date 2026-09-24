// โปรไฟล์สมาชิก — เก็บใน Firestore
// profiles/{user}     = { photos[], bio, tags[], prompts[{q,a}], mbti, zodiac, theme, updatedAt, edit }
// profileEdits/{id}   = { user, by }  ใบอนุญาตแก้โปรไฟล์ (อ่านไม่ได้) by = key PIN ของเจ้าของหรือ Admin
// รูปถูกย่อเป็น JPEG แล้วเก็บเป็น data URL ในเอกสารเดียวกัน (ไม่ต้องใช้ Firebase Storage)

const PROFILE_MAX_PHOTOS = 3;
const PROFILE_MAX_TAGS = 8;
const PROFILE_MAX_PROMPTS = 3;
const PROFILE_BIO_MAX = 150;
const PROFILE_ANSWER_MAX = 60;
const PROFILE_PHOTO_MAX_BYTES = 120000; // ต่อรูป (ความยาว data URL) — 3 รูปรวมไม่เกินขีดจำกัด 1MB ของ Firestore

const PROFILE_TAG_GROUPS = [
  { name: 'อาหาร & เครื่องดื่ม', tags: ['สายคาเฟ่', 'สายหวาน', 'สายเผ็ด', 'สายชาไข่มุก', 'มังสวิรัติ', 'สายบุฟเฟต์'] },
  { name: 'เวลาชีวิต', tags: ['ตื่นเช้า', 'นกฮูกกลางคืน', 'ติดบ้าน', 'สายปาร์ตี้'] },
  { name: 'สัตว์เลี้ยง', tags: ['ทาสแมว', 'ทาสหมา', 'รักสัตว์ทุกชนิด'] },
  { name: 'งานอดิเรก', tags: ['ดูซีรีส์', 'ดูอนิเมะ', 'เกมเมอร์', 'อ่านหนังสือ', 'ถ่ายรูป', 'ทำอาหาร', 'วาดรูป', 'ช้อปปิ้ง'] },
  { name: 'สุขภาพ', tags: ['ออกกำลังกาย', 'โยคะ', 'วิ่ง', 'ว่ายน้ำ'] },
  { name: 'ท่องเที่ยว & ดนตรี', tags: ['สายเที่ยว', 'สายทะเล', 'สายภูเขา', 'ฟังเพลง', 'คาราโอเกะ', 'ไปคอนเสิร์ต'] },
];

const PROFILE_PROMPTS = [
  'อาหารปลอบใจของฉัน',
  'เพลงที่ติดหูตอนนี้',
  'ภาษารักของฉัน',
  'วันหยุดในฝัน',
  'ความสามารถลับ',
  'สิ่งที่ทำให้ยิ้มได้ทันที',
  'เมนูที่สั่งประจำ',
  'ถ้าเป็นสัตว์ จะเป็น',
  'ของขวัญที่อยากได้',
  'คำที่เพื่อนใช้บรรยายฉัน',
];

const MBTI_TYPES = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];
const ZODIACS = ['ราศีเมษ', 'ราศีพฤษภ', 'ราศีเมถุน', 'ราศีกรกฎ', 'ราศีสิงห์', 'ราศีกันย์', 'ราศีตุลย์', 'ราศีพิจิก', 'ราศีธนู', 'ราศีมังกร', 'ราศีกุมภ์', 'ราศีมีน'];

// สีธีมของการ์ด: bg = พื้นหลังรูป/แท็ก, text = ตัวอักษรบนพื้นนั้น, accent = สีเน้น
const PROFILE_THEMES = {
  rose:     { label: 'กุหลาบ',   bg: '#FFE3E8', text: '#9C1B45', accent: '#E04D70' },
  peach:    { label: 'พีช',      bg: '#FFE8D9', text: '#8A3A12', accent: '#F08A5D' },
  lavender: { label: 'ลาเวนเดอร์', bg: '#EDE7FF', text: '#4B3690', accent: '#8B6FE0' },
  mint:     { label: 'มิ้นต์',     bg: '#DDF5EC', text: '#1F6B52', accent: '#3FB98B' },
  sky:      { label: 'ฟ้า',       bg: '#DDEEFF', text: '#1D4F8A', accent: '#4A90E2' },
};

function emptyProfile() {
  return { photos: [], bio: '', tags: [], prompts: [], mbti: '', zodiac: '', theme: 'rose' };
}

// ทำความสะอาดข้อมูลก่อนบันทึก (ตัดความยาว/จำนวนให้อยู่ในขอบเขตที่ rules อนุญาต)
function normalizeProfile(p) {
  const allTags = PROFILE_TAG_GROUPS.flatMap((g) => g.tags);
  return {
    photos: (p.photos || []).filter((s) => typeof s === 'string' && s.startsWith('data:image/')).slice(0, PROFILE_MAX_PHOTOS),
    bio: String(p.bio || '').trim().slice(0, PROFILE_BIO_MAX),
    tags: [...new Set((p.tags || []).filter((t) => allTags.includes(t)))].slice(0, PROFILE_MAX_TAGS),
    prompts: (p.prompts || [])
      .filter((x) => x && PROFILE_PROMPTS.includes(x.q) && String(x.a || '').trim())
      .map((x) => ({ q: x.q, a: String(x.a).trim().slice(0, PROFILE_ANSWER_MAX) }))
      .slice(0, PROFILE_MAX_PROMPTS),
    mbti: MBTI_TYPES.includes(p.mbti) ? p.mbti : '',
    zodiac: ZODIACS.includes(p.zodiac) ? p.zodiac : '',
    theme: PROFILE_THEMES[p.theme] ? p.theme : 'rose',
  };
}

function subscribeProfiles(onChange, onError) {
  return authDb().collection('profiles').onSnapshot(
    (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = { ...emptyProfile(), ...d.data() }; });
      onChange(map);
    },
    (err) => onError && onError(err)
  );
}

// บันทึกโปรไฟล์ของ targetId โดยใช้ key PIN ของผู้แก้ (เจ้าของเอง หรือ Admin)
async function saveProfile(targetId, byKey, profile) {
  const db = authDb();
  const editRef = db.collection('profileEdits').doc();
  const batch = db.batch();
  batch.set(editRef, { user: targetId, by: byKey });
  batch.set(db.collection('profiles').doc(targetId), { ...normalizeProfile(profile), updatedAt: Date.now(), edit: editRef.id });
  await batch.commit();
}

// ย่อรูปเป็น JPEG ด้านยาวไม่เกิน maxSide และขนาดไม่เกิน PROFILE_PHOTO_MAX_BYTES
function compressImage(file, maxSide = 640) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let side = maxSide;
      for (let attempt = 0; attempt < 6; attempt++) {
        const scale = Math.min(1, side / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const q of [0.82, 0.72, 0.62, 0.52]) {
          const data = canvas.toDataURL('image/jpeg', q);
          if (data.length <= PROFILE_PHOTO_MAX_BYTES) { resolve(data); return; }
        }
        side = Math.round(side * 0.8);
      }
      reject(new Error('รูปใหญ่เกินไป ลองรูปอื่น'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    img.src = url;
  });
}
