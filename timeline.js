// Timeline — เก็บใน Firestore (ทุกเครื่องเห็นโพสต์ชุดเดียวกัน)
//
// posts/{id}                 = { authorId, content, image, feeling, createdAt, updatedAt, edited, deleted, edit }
// posts/{id}/likes/{user}    = { on, at, edit }            ถูกใจ / เลิกถูกใจ
// posts/{id}/comments/{id}   = { authorId, text, createdAt, deleted, edit }
// feedOps/{id}               = { user, by }  ใบอนุญาต (อ่านไม่ได้) by = key PIN ของ user เอง หรือของ Admin
//
// ทุกการเขียนสร้างใบอนุญาตใหม่ในชุดเดียวกัน (ดู firestore.rules) — ลบ = ตั้ง deleted: true (ข้อมูลยังอยู่ให้ Admin ตรวจได้)

const POST_MAX_CHARS = 1000;
const COMMENT_MAX_CHARS = 300;
const TIMELINE_LIMIT = 100;

// ฟังโพสต์ + ถูกใจ + ความคิดเห็นทั้งหมด แล้วรวมเป็น [{ id, ...post, likes: [userId], comments: [...] }]
function subscribeTimeline(onChange, onError) {
  const db = authDb();
  let posts = null;
  let likes = [];
  let comments = [];
  const emit = () => {
    if (!posts) return;
    onChange(posts.filter((p) => !p.deleted).map((p) => ({
      ...p,
      likes: likes.filter((l) => l.postId === p.id && l.on).sort((a, b) => a.at - b.at).map((l) => l.userId),
      comments: comments.filter((c) => c.postId === p.id && !c.deleted).sort((a, b) => a.createdAt - b.createdAt),
    })));
  };
  const fail = (err) => onError && onError(err);
  const unsubs = [
    db.collection('posts').orderBy('createdAt', 'desc').limit(TIMELINE_LIMIT).onSnapshot((snap) => {
      posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    }, fail),
    db.collectionGroup('likes').onSnapshot((snap) => {
      likes = snap.docs.map((d) => ({ postId: d.ref.parent.parent.id, userId: d.id, ...d.data() }));
      emit();
    }, fail),
    db.collectionGroup('comments').onSnapshot((snap) => {
      comments = snap.docs.map((d) => ({ id: d.id, postId: d.ref.parent.parent.id, ...d.data() }));
      emit();
    }, fail),
  ];
  return () => unsubs.forEach((u) => u());
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

function createPost(authorId, byKey, body) {
  const now = Date.now();
  return commitFeed(authorId, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(), {
      authorId, ...cleanPostBody(body), createdAt: now, updatedAt: now, edited: false, deleted: false, edit,
    });
  });
}

// แก้ไข / ลบโพสต์: ใบอนุญาตต้องเป็นของเจ้าของโพสต์ (key ของเจ้าของเอง หรือของ Admin)
function updatePost(post, byKey, changes) {
  return commitFeed(post.authorId, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(post.id), {
      authorId: post.authorId,
      ...cleanPostBody({ content: post.content, image: post.image, feeling: post.feeling, ...changes.body }),
      createdAt: post.createdAt,
      updatedAt: Date.now(),
      edited: changes.body ? true : !!post.edited,
      deleted: !!changes.deleted,
      edit,
    });
  });
}

function setPostLike(postId, userId, byKey, on) {
  return commitFeed(userId, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(postId).collection('likes').doc(userId), { on: !!on, at: Date.now(), edit });
  });
}

function addPostComment(postId, authorId, byKey, text) {
  return commitFeed(authorId, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(postId).collection('comments').doc(), {
      authorId, text: String(text).trim().slice(0, COMMENT_MAX_CHARS), createdAt: Date.now(), deleted: false, edit,
    });
  });
}

// ลบความคิดเห็น: ผู้เขียนความคิดเห็น เจ้าของโพสต์ หรือ Admin (asUser = คนที่ใบอนุญาตออกในนาม)
function deletePostComment(postId, comment, asUser, byKey) {
  return commitFeed(asUser, byKey, (batch, db, edit) => {
    batch.set(db.collection('posts').doc(postId).collection('comments').doc(comment.id), {
      authorId: comment.authorId, text: comment.text, createdAt: comment.createdAt, deleted: true, edit,
    });
  });
}
