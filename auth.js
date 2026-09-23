// รายชื่อผู้ใช้ที่อนุญาต — เก็บเฉพาะ hash ของรหัสผ่าน (SHA-256 ของ "suankularb:<ชื่อ>:<รหัส>")
const ACCOUNTS = [
  { name: "Faye", role: "user", hash: "dff3f81b4d1708da6fb9aff60d5a833f347be782fba2af7714d94497177333fa" },
  { name: "Piink", role: "user", hash: "2c94844e6f075d33a15d27949930a4b4f519eb3ecf0ee12bd47cb58d6baa3e9b" },
  { name: "Qin", role: "user", hash: "191739eec378eb7c41086fe048bd9221fbb79875863e5bb2dcb5d02c1e7e8070" },
  { name: "Beam", role: "user", hash: "e4547a26c5fb409506c93d70b6f42322bb0046aed39678508141b8d1e1331341" },
  { name: "Third", role: "user", hash: "cd737b8fd5679da54000e101f92df4bcb4a7caaf49db93b5b966b3e21b786a39" },
  { name: "Bac", role: "user", hash: "5390e29b43207730601b17ee5f329085de5888d24b20a2f5cdc428df5bce9b8e" },
  { name: "Feen", role: "user", hash: "7057f9e46aaf0ac136be56a5b76a82f66767218a11fd20d5bb63a18077887c35" },
  { name: "Jet", role: "user", hash: "e7b424b90d2da3c2542aada27f4fb2ed038e8f3d7cfe9cb37450b99181903232" },
  { name: "Rita", role: "user", hash: "83946e57926d7aa011ce9af4997f1f15bac8a8f7dd2c6e1053d5d5927943572c" },
  { name: "Nezumi", role: "user", hash: "b14e8572e678e7baa784e57b7b1fd0bbe18fdb0e7db5036692eaa1f552750ae8" },
  { name: "Teddy", role: "user", hash: "5c83de8fb9b9643a4cb47eb85458faf13ce962a764018cf2b0d2f825627f4d91" },
  { name: "Rohinii", role: "user", hash: "16247dc948e76fa9d23daa22222ad7038e35d92c820b317a780991131c425477" },
  { name: "Lu", role: "admin", hash: "196bdb19fd49334f507b728c31b2252fa3509a5a2e7425ceef8b522a80f4fef0" },
  { name: "Eros", role: "admin", hash: "6187712edbd9a5dab4eaf3ad7d840738759ee117b64621d54021647a734b73a1" },
  { name: "Siren", role: "admin", hash: "556b44d630c887322cd799425fa634641d0870dd59c9f958dff357f42c370a6d" },
  { name: "Amor", role: "admin", hash: "08c5e96a9f22ba68a3e11cdf463d1c9b175da3f94a792e25a51920487d1fbe9d" },
];

const SESSION_KEY = "suankularb.session";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function login(name, pin) {
  const account = ACCOUNTS.find((a) => a.name === name);
  if (!account || !/^\d{4}$/.test(pin)) return null;
  if ((await sha256(`suankularb:${name}:${pin}`)) !== account.hash) return null;
  const session = { name: account.name, role: account.role, at: Date.now() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function currentSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
