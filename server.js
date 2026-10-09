require('dotenv').config();
const http           = require('http');
const express        = require('express');
const session        = require('express-session');
const rateLimit      = require('express-rate-limit');
const { DatabaseSync } = require('node:sqlite'); // Node.js 22+ 組み込み
const path           = require('path');
const fs             = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// ── データベース初期化 ──────────────────────────────────────
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dbDir, 'responses.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS responses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token   TEXT    NOT NULL,
    question_number INTEGER NOT NULL,
    answer          TEXT    NOT NULL,
    created_at      DATETIME DEFAULT (datetime('now'))
  )
`);

// ── ミドルウェア ───────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000 // 8時間
  }
}));

// ── レートリミット（同一IPから1分10回まで） ─────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。しばらくしてから再試行してください。' }
});

// ── 回答送信 API ───────────────────────────────────────────
app.post('/api/answer', apiLimiter, (req, res) => {
  const { session_token, question_number, answer } = req.body;

  if (!session_token || question_number === undefined || !answer) {
    return res.status(400).json({ error: '必須フィールドが不足しています' });
  }

  const qNum = parseInt(question_number, 10);
  if (isNaN(qNum) || qNum < 1 || qNum > 6) {
    return res.status(400).json({ error: '無効な質問番号です' });
  }

  if (typeof answer !== 'string' || answer.trim().length === 0) {
    return res.status(400).json({ error: '回答を入力してください' });
  }

  if (typeof session_token !== 'string' || session_token.length > 64) {
    return res.status(400).json({ error: '不正なリクエストです' });
  }

  try {
    const stmt = db.prepare(
      'INSERT INTO responses (session_token, question_number, answer) VALUES (?, ?, ?)'
    );
    stmt.run(session_token, qNum, answer.trim());
    res.json({ success: true });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'データの保存に失敗しました' });
  }
});

// ── 管理画面 ───────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.post('/admin/auth', apiLimiter, (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'パスワードが正しくありません' });
  }
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: '認証が必要です' });
  }
  next();
}

// 回答データ取得
app.get('/admin/data', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, question_number, answer, created_at FROM responses ORDER BY created_at DESC'
    ).all();
    res.json(rows);
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'データの取得に失敗しました' });
  }
});

// 回答削除
app.delete('/admin/response/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: '無効なIDです' });
  }
  try {
    const result = db.prepare('DELETE FROM responses WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: '該当する回答が見つかりません' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// CSVエクスポート（UTF-8 BOM付き）
app.get('/admin/export', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, session_token, question_number, answer, created_at FROM responses ORDER BY created_at ASC'
    ).all();

    const header = 'ID,セッショントークン,質問番号,回答,回答日時\n';
    const body = rows.map(r => {
      const escaped = r.answer.replace(/"/g, '""');
      return `${r.id},"${r.session_token}",${r.question_number},"${escaped}",${r.created_at}`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="responses.csv"');
    res.send('\uFEFF' + header + body);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'エクスポートに失敗しました' });
  }
});

// ── WebSocket サーバー ─────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// role ごとに接続クライアントを保持
const clients    = { other: null, self: null };
const logClients = new Set();  // log ロールは複数接続を許可

function sendTo(target, payload) {
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify(payload));
  }
}

function sendToLogs(payload) {
  const data = JSON.stringify(payload);
  for (const client of logClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  let role = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    // ── 登録 ──
    if (msg.type === 'register') {
      if (msg.role === 'other' || msg.role === 'self') {
        role = msg.role;
        clients[role] = ws;
        console.log(`[WS] ${role} 接続`);
      } else if (msg.role === 'log') {
        role = 'log';
        logClients.add(ws);
        console.log(`[WS] log 接続（計 ${logClients.size} 件）`);
      }
      return;
    }

    // log クライアントはメッセージを送信しない
    if (role === 'log') return;

    const other = role === 'other' ? clients.self : clients.other;

    switch (msg.type) {
      // AI の応答テキスト → もう一方へ転送 + log へ通知
      case 'ai_response':
        sendTo(other, { type: 'ai_response', text: msg.text });
        sendToLogs({ type: 'log_entry', role: role, text: msg.text });
        break;

      // 読み上げ完了 → もう一方に your_turn を送る
      case 'speaking_done':
        sendTo(other, { type: 'your_turn', text: msg.text });
        break;

      // 人間の割り込み → 両方に通知 + log へ通知
      case 'human_interrupt':
        sendTo(clients.other, { type: 'human_interrupt', text: msg.text });
        sendTo(clients.self,  { type: 'human_interrupt', text: msg.text });
        sendToLogs({ type: 'log_entry', role: 'human', text: msg.text });
        break;

      // 会話開始 → 両方に通知 + log へ通知
      case 'start':
        sendTo(clients.other, { type: 'start' });
        sendTo(clients.self,  { type: 'start' });
        sendToLogs({ type: 'start' });
        break;

      // 会話停止 → 両方に通知 + log へ通知
      case 'stop':
        sendTo(clients.other, { type: 'stop' });
        sendTo(clients.self,  { type: 'stop' });
        sendToLogs({ type: 'stop' });
        break;
    }
  });

  ws.on('close', () => {
    if (role === 'log') {
      logClients.delete(ws);
      console.log(`[WS] log 切断（残 ${logClients.size} 件）`);
    } else if (role && clients[role] === ws) {
      clients[role] = null;
      console.log(`[WS] ${role} 切断`);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] エラー:', err.message);
  });
});

// ── 起動 ───────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`起動しました → http://localhost:${PORT}`);
  console.log(`管理画面   → http://localhost:${PORT}/admin`);
  console.log(`WebSocket  → ws://localhost:${PORT}`);
});
