// แจ้งเตือนเข้า Discord ผ่าน Google Apps Script (ดู discord-relay.gs)
// ลิงก์ Webhook ของ Discord เก็บไว้ใน Apps Script เท่านั้น — หน้าเว็บรู้แค่ URL ของตัวส่งต่อ
// ว่าง = ปิดการแจ้งเตือน
const DISCORD_RELAY_URL = 'https://script.google.com/macros/s/AKfycbz7MrdAVAqiwG_tSaF4vYJVBciH_f7-EXVgXcEO9ZbClGzxmkKk7GPATAyTVsbDtmB1/exec';

// type: ห้องหลัก post | ooo_start | ooo_stop / ห้อง Log แอดมิน request | gift | admin_inv | admin_reset | spin | quota — ส่งแล้วไม่รอผล (แจ้งไม่สำเร็จไม่กระทบการใช้งาน)
function notifyDiscord(type, data) {
  if (!DISCORD_RELAY_URL) return;
  try {
    fetch(DISCORD_RELAY_URL, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...data, type }),
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}
