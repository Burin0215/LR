// Timeline — เก็บใน Firestore (ทุกเครื่องเห็นโพสต์ชุดเดียวกัน)
//
// posts/{id}                 = { authorId, content, image, feeling, mentions, createdAt, updatedAt, edited, deleted, edit }
// posts/{id}/likes/{user}    = { on, at, edit }            ถูกใจ / เลิกถูกใจ
// posts/{id}/comments/{id}   = { authorId, text, mentions, createdAt, deleted, edit }
// mentions/{id}              = { to, from, postId, commentId, createdAt, read, edit }  แจ้งเตือนการแท็ก
// feedOps/{id}               = { user, by }  ใบอนุญาต (อ่านไม่ได้) by = key PIN ของ user เอง หรือของ Admin
//
// ทุกการเขียนสร้างใบอนุญาตใหม่ในชุดเดียวกัน (ดู firestore.rules) — ลบ = ตั้ง deleted: true (ข้อมูลยังอยู่ให้ Admin ตรวจได้)

const POST_MAX_CHARS = 1000;
const COMMENT_MAX_CHARS = 300;
const TIMELINE_PAGE = 20; // โหลดทีละ 20 โพสต์ (ประหยัดโควตาอ่านของ Firebase แบบฟรี)

// ฟังโพสต์ล่าสุด `limit` โพสต์ + ถูกใจ/ความคิดเห็นเฉพาะของโพสต์ที่โหลดอยู่
// onChange([{ id, ...post, likes: [userId], comments: [...] }], { hasMore })
// คืน { stop(), showMore() }
function subscribeTimeline(onChange, onError) {
  const db = authDb();
  const fail = (err) => onError && onError(err);
  let limit = TIMELINE_PAGE;
  let posts = null;
  let hasMore = false;
  let postsUnsub = null;
  const perPost = new Map(); // postId → { likes, comments, unsubs }

  const emit = () => {
    if (!posts) return;
    onChange(posts.filter((p) => !p.deleted).map((p) => {
      const extra = perPost.get(p.id) || { likes: [], comments: [] };
      return {
        ...p,
        likes: extra.likes.filter((l) => l.on).sort((a, b) => a.at - b.at).map((l) => l.userId),
        comments: extra.comments.filter((c) => !c.deleted).sort((a, b) => a.createdAt - b.createdAt),
      };
    }), { hasMore });
  };

  const watchPost = (postId) => {
    if (perPost.has(postId)) return;
    const entry = { likes: [], comments: [], unsubs: [] };
    perPost.set(postId, entry);
    const ref = db.collection('posts').doc(postId);
    entry.unsubs.push(ref.collection('likes').onSnapshot((snap) => {
      entry.likes = snap.docs.map((d) => ({ userId: d.id, ...d.data() }));
      emit();
    }, fail));
    entry.unsubs.push(ref.collection('comments').onSnapshot((snap) => {
      entry.comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    }, fail));
  };
  const unwatchPost = (postId) => {
    const entry = perPost.get(postId);
    if (!entry) return;
    entry.unsubs.forEach((u) => u());
    perPost.delete(postId);
  };

  const listenPosts = () => {
    if (postsUnsub) postsUnsub();
    postsUnsub = db.collection('posts').orderBy('createdAt', 'desc').limit(limit).onSnapshot((snap) => {
      posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      hasMore = snap.size >= limit;
      const visible = new Set(posts.filter((p) => !p.deleted).map((p) => p.id));
      [...perPost.keys()].forEach((id) => { if (!visible.has(id)) unwatchPost(id); });
      visible.forEach(watchPost);
      emit();
    }, fail);
  };
  listenPosts();

  return {
    stop() {
      if (postsUnsub) postsUnsub();
      [...perPost.keys()].forEach(unwatchPost);
    },
    showMore() {
      limit += TIMELINE_PAGE;
      listenPosts();
    },
  };
}

// ใบอนุญาต + การเขียน ในชุดเดียว (สำเร็จทั้งหมดหรือไม่เกิดเลย)
async function commitFeed(user, byKey, write) {
  const db = authDb();
  const opRef = db.collection('feedOps').doc();
  const batch = db.batch();
  batch.set(opRef, { user, by: byKey });
  write(batch, db, opRef.id);
  await batch.commit();
}

const cleanPostBody = ({ content, image, feeling }) => ({
  content: String(content || '').trim().slice(0, POST_MAX_CHARS),
  image: typeof image === 'string' && image.startsWith('data:image/') ? image : '',
  feeling: String(feeling || '').slice(0, 40),
});

// ===== แท็กชื่อ (@ชื่อ) =====
// ชื่อที่แท็กได้ = ACCOUNTS ใน auth.js — คืนรายชื่อ id ที่ถูกแท็กในข้อความ (ไม่ซ้ำ ไม่รวมตัวเอง ไม่เกิน 10)
const MENTION_MAX = 10;
function mentionPattern() {
  const names = ACCOUNTS.map((a) => a.name).sort((x, y) => y.length - x.length).join('|');
  return new RegExp(`@(${names})(?![A-Za-z0-9_])`, 'gi');
}
function extractMentions(text, selfId) {
  const ids = [];
  for (const m of String(text || '').matchAll(mentionPattern())) {
    const acc = ACCOUNTS.find((a) => a.name.toLowerCase() === m[1].toLowerCase());
    const id = acc && accountId(acc.name);
    if (id && id !== selfId && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MENTION_MAX);
}

// id เรียงจากใหม่ไปเก่า (ใช้แทน orderBy — query ด้วย to == ฉัน จึงไม่ต้องสร้าง index เพิ่ม)
const mentionDocId = (now) => `m${String(9999999999999 - now).padStart(13, '0')}${Math.random().toString(36).slice(2, 8)}`;

function addMentionDocs(batch, db, edit, from, to, postId, commentId) {
  const now = Date.now();
  to.forEach((user) => {
    batch.set(db.collection('mentions').doc(mentionDocId(now)), {
      to: user, from, postId, commentId: commentId || '', createdAt: now, read: false, edit,
    });
  });
}

function createPost(authorId, byKey, body) {
  const now = Date.now();
  const mentions = extractMentions(body.content, authorId);
  return commitFeed(authorId, byKey, (batch, db, edit) => {
    const ref = db.collection('posts').doc();
    batch.set(ref, {
      authorId, ...cleanPostBody(body), mentions, createdAt: now, updatedAt: now, edited: false, deleted: false, edit,
    });
    addMentionDocs(batch, db, edit, authorId, mentions, ref.id, '');
  });
}

// แก้ไข / ลบโพสต์: ใบอนุญาตต้องเป็นของเจ้าของโพสต์ (key ของเจ้าของเอง หรือของ Admin)
// แก้ข้อความแล้วมีคนถูกแท็กเพิ่ม → แจ้งเตือนเฉพาะคนที่เพิ่มใหม่
function updatePost(post, byKey, changes) {
  const body = cleanPostBody({ content: post.content, image: post.image, feeling: post.feeling, ...changes.body });
  const before = post.mentions || [];
  const mentions = changes.body ? extractMentions(body.content, post.authorId) : before;
  const added = changes.deleted ? [] : mentions.filter((id) => !before.includes(id));
  return commitFeed(post.authorId, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(post.id), {
      authorId: post.authorId,
      ...body,
      mentions,
      createdAt: post.createdAt,
      updatedAt: Date.now(),
      edited: changes.body ? true : !!post.edited,
      deleted: !!changes.deleted,
      edit,
    });
    addMentionDocs(batch, db, edit, post.authorId, added, post.id, '');
  });
}

function setPostLike(postId, userId, byKey, on) {
  return commitFeed(userId, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(postId).collection('likes').doc(userId), { on: !!on, at: Date.now(), edit });
  });
}

function addPostComment(postId, authorId, byKey, text) {
  const clean = String(text).trim().slice(0, COMMENT_MAX_CHARS);
  const mentions = extractMentions(clean, authorId);
  return commitFeed(authorId, byKey, (batch, db, edit) => {
    const ref = db.collection('posts').doc(postId).collection('comments').doc();
    batch.set(ref, { authorId, text: clean, mentions, createdAt: Date.now(), deleted: false, edit });
    addMentionDocs(batch, db, edit, authorId, mentions, postId, ref.id);
  });
}

// ลบความคิดเห็น: ผู้เขียนความคิดเห็น เจ้าของโพสต์ หรือ Admin (asUser = คนที่ใบอนุญาตออกในนาม)
function deletePostComment(postId, comment, asUser, byKey) {
  return commitFeed(asUser, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(postId).collection('comments').doc(comment.id), {
      authorId: comment.authorId, text: comment.text, mentions: comment.mentions || [], createdAt: comment.createdAt, deleted: true, edit,
    });
  });
}

// แจ้งเตือนการแท็กของฉัน 30 รายการล่าสุด (id เรียงใหม่ → เก่าอยู่แล้ว)
function subscribeMyMentions(userId, onChange, onError) {
  return authDb().collection('mentions').where('to', '==', userId).limit(30).onSnapshot(
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt)),
    (err) => onError && onError(err));
}

function markMentionsRead(userId, byKey, ids) {
  if (!ids.length) return Promise.resolve();
  return commitFeed(userId, byKey, (batch, db, edit) => {
    ids.forEach((id) => batch.update(db.collection('mentions').doc(id), { read: true, edit }));
  });
}
