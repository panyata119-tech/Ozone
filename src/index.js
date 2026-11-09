const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const path = require("path");

const required = ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const LOG_FILE = path.join(DATA_DIR, "events.jsonl");
const ADMIN_IDS = new Set((process.env.ADMIN_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
const SPAM_WINDOW_MS = Number(process.env.SPAM_WINDOW_MS || 10000);
const SPAM_LIMIT = Number(process.env.SPAM_LIMIT || 5);
const WARN_LIMIT = Number(process.env.WARN_LIMIT || 3);
const LINK_BLOCK = (process.env.LINK_BLOCK || "true").toLowerCase() === "true";

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { groups: {}, recent: {}, warnings: {} }; }
}
let state = loadState();
function saveState() {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}
function groupState(groupId) {
  if (!state.groups[groupId]) {
    state.groups[groupId] = { enabled: true, blockedWords: ["เครดิตฟรี", "เว็บพนัน", "รับโปรโมท"], warned: {} };
  }
  return state.groups[groupId];
}
function logEvent(event) {
  const row = { at: new Date().toISOString(), ...event };
  fs.appendFileSync(LOG_FILE, JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row));
}
function isAdmin(userId) { return ADMIN_IDS.has(userId); }
function hasUrl(text) {
  return /(https?:\/\/|www\.|line\.me\/|t\.me\/|bit\.ly\/)/i.test(text);
}
function normalize(text) { return (text || "").toLowerCase().replace(/\s+/g, " ").trim(); }

async function reply(replyToken, text) {
  if (!replyToken) return;
  try {
    await client.replyMessage({ replyToken, messages: [{ type: "text", text }] });
  } catch (e) {
    console.error("Reply failed:", e.message);
  }
}
async function push(groupId, text) {
  try {
    await client.pushMessage({ to: groupId, messages: [{ type: "text", text }] });
  } catch (e) {
    console.error("Push failed:", e.message);
  }
}

async function handleMessage(event) {
  const source = event.source || {};
  const groupId = source.groupId;
  const userId = source.userId;
  const message = event.message || {};
  if (!groupId || message.type !== "text" || !userId) return;

  const text = message.text || "";
  const cmd = text.trim();
  const gs = groupState(groupId);

  if (cmd === "!myid") {
    return reply(event.replyToken, `LINE User ID ของคุณ: ${userId}`);
  }

  if (cmd.startsWith("!")) {
    if (!isAdmin(userId)) {
      await reply(event.replyToken, "คำสั่งนี้สำหรับผู้ดูแลกลุ่มเท่านั้น");
      return;
    }
    const [action, ...args] = cmd.slice(1).split(/\s+/);
    const value = args.join(" ").trim();
    if (action === "guard") {
      if (value === "on") gs.enabled = true;
      else if (value === "off") gs.enabled = false;
      else return reply(event.replyToken, "วิธีใช้: !guard on หรือ !guard off");
      saveState();
      logEvent({ type: "guard", groupId, userId, enabled: gs.enabled });
      return reply(event.replyToken, `ระบบป้องกัน${gs.enabled ? "เปิด" : "ปิด"}แล้ว`);
    }
    if (action === "status") {
      return reply(event.replyToken, `สถานะ: ${gs.enabled ? "เปิด" : "ปิด"}\nกรองลิงก์: ${LINK_BLOCK ? "เปิด" : "ปิด"}\nคำต้องห้าม: ${gs.blockedWords.join(", ") || "ไม่มี"}\nคำสั่งแอดมิน: !guard on/off, !bad add/remove, !log`);
    }
    if (action === "bad" && args[0] === "add") {
      const word = args.slice(1).join(" ").trim();
      if (!word) return reply(event.replyToken, "วิธีใช้: !bad add คำ");
      if (!gs.blockedWords.includes(word)) gs.blockedWords.push(word);
      saveState();
      return reply(event.replyToken, `เพิ่มคำต้องห้าม: ${word}`);
    }
    if (action === "bad" && args[0] === "remove") {
      const word = args.slice(1).join(" ").trim();
      gs.blockedWords = gs.blockedWords.filter(w => w !== word);
      saveState();
      return reply(event.replyToken, `นำคำออกจากรายการ: ${word}`);
    }
    if (action === "log") {
      let rows = [];
      try { rows = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean).slice(-8); } catch {}
      const summary = rows.map(r => {
        const x = JSON.parse(r);
        return `${x.at} | ${x.type || "event"} | ${x.reason || x.enabled || ""}`;
      }).join("\n");
      return reply(event.replyToken, summary || "ยังไม่มีบันทึกเหตุการณ์");
    }
    return reply(event.replyToken, "คำสั่งไม่ถูกต้อง พิมพ์ !status เพื่อดูคำสั่ง");
  }

  if (!gs.enabled) return;
  const now = Date.now();
  const key = `${groupId}:${userId}`;
  const recent = (state.recent[key] || []).filter(t => now - t < SPAM_WINDOW_MS);
  recent.push(now);
  state.recent[key] = recent;

  let reason = "";
  if (LINK_BLOCK && hasUrl(text)) reason = "พบลิงก์";
  const normalized = normalize(text);
  const forbidden = gs.blockedWords.find(w => normalized.includes(normalize(w)));
  if (!reason && forbidden) reason = `พบคำต้องห้าม: ${forbidden}`;
  if (!reason && recent.length >= SPAM_LIMIT) reason = "ส่งข้อความถี่เกินกำหนด";

  if (reason) {
    state.warnings[key] = (state.warnings[key] || 0) + 1;
    const count = state.warnings[key];
    saveState();
    logEvent({ type: "moderation", groupId, userId, reason, warningCount: count, message: text.slice(0, 300) });
    await reply(event.replyToken, `⚠️ ตรวจพบพฤติกรรมที่อาจผิดกฎ (${reason})\nเตือนครั้งที่ ${count}\nกรุณาปฏิบัติตามกฎของกลุ่ม`);
    if (count >= WARN_LIMIT) {
      await push(groupId, `แจ้งผู้ดูแล: สมาชิกมีการแจ้งเตือนครบ ${count} ครั้ง กรุณาตรวจสอบด้วยตนเอง`);
    }
  } else {
    saveState();
  }
}

app.get("/", (_req, res) => res.status(200).send("LINE Group Guardian is running"));
app.get("/health", (_req, res) => res.json({ ok: true, service: "line-group-guardian" }));

app.post("/webhook", line.middleware(config), async (req, res) => {
  res.status(200).end();
  for (const event of req.body.events || []) {
    try {
      if (event.type === "message") await handleMessage(event);
      else if (event.type === "join" && event.source?.groupId) {
        groupState(event.source.groupId);
        saveState();
        logEvent({ type: "bot_joined", groupId: event.source.groupId });
        await reply(event.replyToken, "สวัสดีครับ ฉันคือ LINE GROUP GUARDIAN\nระบบป้องกันกลุ่มพร้อมทำงาน\nผู้ดูแลใช้ !status เพื่อตรวจสอบสถานะ");
      }
    } catch (e) {
      console.error("Event handling error:", e);
    }
  }
});

app.listen(PORT, () => console.log(`LINE Group Guardian listening on ${PORT}`));