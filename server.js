// ============================================
// JR7 COMMUNITY — BACKEND API SERVER
// Node.js + Express, ready for Railway
// ============================================

require('dotenv').config();
const express = require('express');
const https   = require('https');
const http    = require('http');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Pusher = require('pusher');
const cors = require('cors');

const app = express();

// ============================================
// SECURITY HEADERS (helmet)
// ============================================
const helmet = (() => {
  try { return require('helmet'); } catch(e) { return null; }
})();
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // We use inline scripts, so disable CSP for now
    crossOriginEmbedderPolicy: false
  }));
}

// ---- HTTP HELPER (works on all Node versions, no node-fetch needed) ----
function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: () => Promise.resolve(data), json: () => Promise.resolve(JSON.parse(data)) });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const PORT = process.env.PORT || 3000;

// ============================================
// DATABASE — PostgreSQL with in-memory fallback
// ============================================
const { Pool } = (() => { try { return require('pg'); } catch(e) { return { Pool: null }; } })();

// In-memory fallback (used if no DATABASE_URL set)
const DB = {
  users: new Map(),
  clans: new Map(),
  matches: new Map(),
  sessions: new Map(),
  securityEvents: [],
  news: [
    { id: 1, title: "Jr7 Season 2 — Signups Open", category: "announcements", excerpt: "Clan registrations for the second CDL season are now live. Minimum 4 active players required. Prize pool increased to $5,000.", date: "2026-07-23", author: "Jr7 Staff", readTime: "3 min", featured: true, icon: "🚀" },
    { id: 2, title: "New Proof System Live", category: "patches", excerpt: "Match proof submissions are now required every round. Screenshots must show full scoreboard, K/D, and objective stats.", date: "2026-07-20", author: "Dev Team", readTime: "2 min", featured: false, icon: "🛡" },
    { id: 3, title: "Summer Showdown Finals Recap", category: "tournaments", excerpt: "Team Vortex takes the crown in a thrilling 3-2 reverse sweep against Legion Esports. Full match breakdown inside.", date: "2026-07-18", author: "Analyst Desk", readTime: "5 min", featured: false, icon: "🏆" },
    { id: 4, title: "Community Spotlight: Rising Stars", category: "community", excerpt: "Meet the top 5 players who broke into the top 50 this month. Their journey from unranked to elite.", date: "2026-07-15", author: "Community Team", readTime: "4 min", featured: false, icon: "⭐" },
    { id: 5, title: "Ranked Playlist Update", category: "patches", excerpt: "Map rotation updated for Season 2. Three new CDL maps added to the competitive pool.", date: "2026-07-12", author: "Dev Team", readTime: "2 min", featured: false, icon: "🗺" },
    { id: 6, title: "Anti-Cheat Measures Enhanced", category: "announcements", excerpt: "New bot detection and honeypot systems deployed.", date: "2026-07-10", author: "Security Team", readTime: "3 min", featured: false, icon: "🔒" }
  ],
  tournaments: [
    { id: "tourn_001", name: "Summer Showdown 2026", status: "live", startDate: "2026-07-20", maxTeams: 32, teamsRegistered: 28, format: "Best of 5", prizePool: 5000, organizer: "Jr7 Staff", bracketPreview: [{ team1: "VTX", team2: "LGN", score1: 3, score2: 1, winner: "VTX" }, { team1: "PHM", team2: "STR", score1: 2, score2: 3, winner: "STR" }] },
    { id: "tourn_002", name: "Fall Championship 2026", status: "upcoming", startDate: "2026-09-15", maxTeams: 64, teamsRegistered: 12, format: "Best of 5", prizePool: 10000, organizer: "Jr7 Staff", bracketPreview: [] },
    { id: "tourn_003", name: "Spring Invitational", status: "past", startDate: "2026-04-01", maxTeams: 16, teamsRegistered: 16, format: "Best of 3", prizePool: 2500, organizer: "Community", bracketPreview: [{ team1: "VTX", team2: "PHM", score1: 3, score2: 0, winner: "VTX" }] }
  ]
};

// No demo data — real users and clans only

// ============================================
// POSTGRESQL POOL + PERSISTENCE LAYER
// ============================================
const pgPool = Pool && process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// Initialize PostgreSQL tables if connected
async function initDB() {
  if (!pgPool) {
    console.log("⚠️  No DATABASE_URL set — using in-memory storage (data will reset on restart)");
    return;
  }
  console.log("✅ PostgreSQL connected — initialising tables...");
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT,
        clan_id TEXT,
        role TEXT DEFAULT 'player',
        discord_id TEXT,
        avatar TEXT DEFAULT '',
        color TEXT DEFAULT '#C8102E',
        text_color TEXT DEFAULT '#E84060',
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        last_active TIMESTAMPTZ DEFAULT NOW(),
        kd FLOAT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        win_rate FLOAT DEFAULT 0,
        matches_played INT DEFAULT 0,
        mvps INT DEFAULT 0,
        level INT DEFAULT 1,
        bio TEXT DEFAULT '',
        activision TEXT DEFAULT '',
        twitter TEXT DEFAULT '',
        twitch TEXT DEFAULT '',
        youtube TEXT DEFAULT '',
        instagram TEXT DEFAULT '',
        banned BOOLEAN DEFAULT FALSE,
        ban_reason TEXT,
        flagged BOOLEAN DEFAULT FALSE,
        flag_reason TEXT,
        data JSONB DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS clans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tag TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        captain TEXT,
        captain_id TEXT,
        primary_mode TEXT DEFAULT 'All modes',
        recruiting BOOLEAN DEFAULT TRUE,
        rank INT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        win_rate FLOAT DEFAULT 0,
        streak INT DEFAULT 0,
        member_count INT DEFAULT 1,
        color TEXT DEFAULT '#C8102E',
        text_color TEXT DEFAULT '#E84060',
        border_color TEXT DEFAULT '#C8102E40',
        logo TEXT DEFAULT '',
        banner TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        modes TEXT[] DEFAULT ARRAY['hp','sd','ctl'],
        notes TEXT DEFAULT '',
        roles TEXT[] DEFAULT ARRAY[]::TEXT[],
        data JSONB DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        clan1_id TEXT, clan2_id TEXT,
        clan1 JSONB, clan2 JSONB,
        status TEXT DEFAULT 'pending',
        current_round INT DEFAULT 1,
        mode TEXT DEFAULT 'Mixed',
        map TEXT DEFAULT 'TBD',
        format TEXT DEFAULT 'Best of 5',
        division TEXT DEFAULT 'Elite',
        scheduled_at TIMESTAMPTZ,
        score JSONB DEFAULT '{"clan1":0,"clan2":0}',
        winner_id TEXT,
        rounds JSONB DEFAULT '[]',
        referee TEXT,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        ts BIGINT,
        level TEXT,
        type TEXT,
        message TEXT,
        ip TEXT,
        city TEXT,
        region TEXT,
        country TEXT,
        isp TEXT,
        is_vpn BOOLEAN,
        os TEXT,
        browser TEXT,
        device TEXT,
        user_agent TEXT,
        url TEXT,
        referrer TEXT,
        timezone TEXT,
        language TEXT,
        screen TEXT,
        timestamp_str TEXT
      );
    `);
    console.log("✅ PostgreSQL tables ready");

    // Load existing data into memory for fast reads
    await loadFromDB();
  } catch(err) {
    console.error("❌ DB init error:", err.message);
  }
}

async function loadFromDB() {
  if (!pgPool) return;
  try {
    const [users, clans, matches] = await Promise.all([
      pgPool.query('SELECT * FROM users'),
      pgPool.query('SELECT * FROM clans'),
      pgPool.query('SELECT * FROM matches')
    ]);
    users.rows.forEach(row => DB.users.set(row.id, pgRowToUser(row)));
    clans.rows.forEach(row => DB.clans.set(row.id, pgRowToClan(row)));
    matches.rows.forEach(row => DB.matches.set(row.id, pgRowToMatch(row)));
    console.log(`✅ Loaded ${users.rowCount} users, ${clans.rowCount} clans, ${matches.rowCount} matches from PostgreSQL`);
  } catch(err) {
    console.error("❌ Load from DB error:", err.message);
  }
}

function pgRowToUser(row) {
  return {
    id: row.id, username: row.username, email: row.email,
    passwordHash: row.password_hash, clanId: row.clan_id,
    role: row.role, discordId: row.discord_id, avatar: row.avatar,
    color: row.color, textColor: row.text_color,
    joinedAt: row.joined_at, lastActive: row.last_active,
    kd: row.kd, wins: row.wins, losses: row.losses,
    winRate: row.win_rate, matchesPlayed: row.matches_played,
    mvps: row.mvps, level: row.level, bio: row.bio,
    activision: row.activision, twitter: row.twitter,
    twitch: row.twitch, youtube: row.youtube, instagram: row.instagram,
    banned: row.banned, banReason: row.ban_reason,
    flagged: row.flagged, flagReason: row.flag_reason,
    ...(row.data || {})
  };
}

function pgRowToClan(row) {
  return {
    id: row.id, name: row.name, tag: row.tag,
    description: row.description, captain: row.captain,
    captainId: row.captain_id, primaryMode: row.primary_mode,
    recruiting: row.recruiting, rank: row.rank,
    wins: row.wins, losses: row.losses, winRate: row.win_rate,
    streak: row.streak, memberCount: row.member_count,
    color: row.color, textColor: row.text_color,
    borderColor: row.border_color, logo: row.logo, banner: row.banner,
    createdAt: row.created_at, modes: row.modes || [],
    notes: row.notes, roles: row.roles || [],
    ...(row.data || {})
  };
}

function pgRowToMatch(row) {
  return {
    id: row.id, clan1Id: row.clan1_id, clan2Id: row.clan2_id,
    clan1: row.clan1, clan2: row.clan2, status: row.status,
    currentRound: row.current_round, mode: row.mode,
    map: row.map, format: row.format, division: row.division,
    scheduledAt: row.scheduled_at, score: row.score,
    winnerId: row.winner_id, rounds: row.rounds || [],
    referee: row.referee, endedAt: row.ended_at
  };
}

// Persist user to PostgreSQL
async function saveUser(user) {
  if (!pgPool) return;
  try {
    await pgPool.query(`
      INSERT INTO users (id,username,email,password_hash,clan_id,role,discord_id,avatar,color,text_color,joined_at,last_active,kd,wins,losses,win_rate,matches_played,mvps,level,bio,activision,twitter,twitch,youtube,instagram,banned,ban_reason,flagged,flag_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
      ON CONFLICT (id) DO UPDATE SET
        username=$2,email=$3,password_hash=$4,clan_id=$5,role=$6,discord_id=$7,avatar=$8,color=$9,text_color=$10,
        last_active=$12,kd=$13,wins=$14,losses=$15,win_rate=$16,matches_played=$17,mvps=$18,level=$19,
        bio=$20,activision=$21,twitter=$22,twitch=$23,youtube=$24,instagram=$25,banned=$26,ban_reason=$27,flagged=$28,flag_reason=$29
    `, [user.id,user.username,user.email,user.passwordHash,user.clanId||null,user.role,user.discordId||null,
        user.avatar||'',user.color||'#C8102E',user.textColor||'#E84060',
        user.joinedAt,user.lastActive||new Date().toISOString(),
        user.kd||0,user.wins||0,user.losses||0,user.winRate||0,user.matchesPlayed||0,user.mvps||0,user.level||1,
        user.bio||'',user.activision||'',user.twitter||'',user.twitch||'',user.youtube||'',user.instagram||'',
        user.banned||false,user.banReason||null,user.flagged||false,user.flagReason||null]);
  } catch(err) { console.error("saveUser error:", err.message); }
}

async function saveClan(clan) {
  if (!pgPool) return;
  try {
    await pgPool.query(`
      INSERT INTO clans (id,name,tag,description,captain,captain_id,primary_mode,recruiting,rank,wins,losses,win_rate,streak,member_count,color,text_color,border_color,logo,banner,created_at,modes,notes,roles)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (id) DO UPDATE SET
        name=$2,description=$4,captain=$5,captain_id=$6,primary_mode=$7,recruiting=$8,rank=$9,
        wins=$10,losses=$11,win_rate=$12,streak=$13,member_count=$14,color=$15,text_color=$16,
        border_color=$17,logo=$18,banner=$19,modes=$21,notes=$22,roles=$23
    `, [clan.id,clan.name,clan.tag,clan.description||'',clan.captain,clan.captainId,
        clan.primaryMode||'All modes',clan.recruiting!==false,clan.rank||0,
        clan.wins||0,clan.losses||0,clan.winRate||0,clan.streak||0,clan.memberCount||1,
        clan.color||'#C8102E',clan.textColor||'#E84060',clan.borderColor||'#C8102E40',
        clan.logo||'',clan.banner||'',clan.createdAt||new Date().toISOString(),
        clan.modes||['hp','sd','ctl'],clan.notes||'',clan.roles||[]]);
  } catch(err) { console.error("saveClan error:", err.message); }
}

async function saveMatch(match) {
  if (!pgPool) return;
  try {
    await pgPool.query(`
      INSERT INTO matches (id,clan1_id,clan2_id,clan1,clan2,status,current_round,mode,map,format,division,scheduled_at,score,winner_id,rounds,referee,ended_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        status=$6,current_round=$7,score=$13,winner_id=$14,rounds=$15,referee=$16,ended_at=$17
    `, [match.id,match.clan1Id,match.clan2Id,JSON.stringify(match.clan1),JSON.stringify(match.clan2),
        match.status,match.currentRound||1,match.mode||'Mixed',match.map||'TBD',
        match.format||'Best of 5',match.division||'Elite',match.scheduledAt||null,
        JSON.stringify(match.score||{clan1:0,clan2:0}),match.winnerId||null,
        JSON.stringify(match.rounds||[]),match.referee||null,match.endedAt||null]);
  } catch(err) { console.error("saveMatch error:", err.message); }
}

// PostgreSQL session store
async function createTokenPG(userId) {
  const crypto = require('crypto');
  const token  = crypto.randomBytes(32).toString('hex');
  SESSION_STORE.set(token, { userId, createdAt: Date.now() });
  if (pgPool) {
    try {
      await pgPool.query('INSERT INTO sessions (token,user_id,created_at) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',
        [token, userId, Date.now()]);
    } catch(err) {}
  }
  return token;
}

let securityStats = {
  botsBlocked: 0, honeypotHits: 0, failedLogins: 0,
  attackAttempts: 0, activeUsers: 0, attacksToday: 0,
  botsToday: 0, loginsToday: 0, honeypotIPs: 0, pendingReports: 0
};

// ============================================
// PUSHER SETUP
// ============================================
const pusher = process.env.PUSHER_APP_ID ? new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER || "us2",
  useTLS: true
}) : null;

// ============================================
// INPUT VALIDATION
// ============================================
function sanitize(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLen)
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 200;
}
function isValidUsername(username) {
  return /^[a-zA-Z0-9_.\-]{2,24}$/.test(username);
}

// ============================================
// MIDDLEWARE
// ============================================

const allowedOrigins = [
  "https://jr7arena.netlify.app",
  "https://jr7cdl.netlify.app",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ============================================
// SESSION — TOKEN BASED (fixes cross-domain cookie issue)
// Instead of cookies, we use a token in the response header
// that the frontend stores in localStorage
// ============================================
const SESSION_STORE = new Map(); // token -> { userId, createdAt }

const crypto = require('crypto');
function createToken(userId) {
  const token = crypto.randomBytes(32).toString('hex'); // cryptographically secure
  SESSION_STORE.set(token, { userId, createdAt: Date.now() });
  return token;
}

function getTokenUser(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const session = SESSION_STORE.get(token);
  if (!session) return null;
  // Expire after 7 days
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    SESSION_STORE.delete(token);
    return null;
  }
  return { token, userId: session.userId };
}

app.use((req, res, next) => {
  const sess = getTokenUser(req);
  req.sessionUserId = sess ? sess.userId : null;
  req.sessionToken = sess ? sess.token : null;
  next();
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ============================================
// AUTH MIDDLEWARE
// ============================================
function requireAuth(req, res, next) {
  if (!req.sessionUserId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  req.user = DB.users.get(req.sessionUserId);
  if (!req.user) return res.status(401).json({ message: "User not found" });
  if (req.user.banned) {
    return res.status(403).json({ message: `You are banned. Reason: ${req.user.banReason || "Violation of rules"}` });
  }
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const adminIds = (process.env.ADMIN_DISCORD_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    const isAdmin = req.user.role === "owner" || req.user.role === "admin" || req.user.role === "moderator" || adminIds.includes(req.user.discordId) || adminIds.includes(req.user.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin access required" });
    next();
  });
}

// ============================================
// AUTH ROUTES
// ============================================
app.post("/v1/auth/register", checkRateLimit, async (req, res) => {
  try {
    if (req.body.website) { securityStats.honeypotHits++; return res.status(400).json({ message: "Bot detected" }); }
    const username = sanitize(req.body.username || '', 24);
    const email    = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    if (!username || !isValidUsername(username)) return res.status(400).json({ message: "Username must be 2-24 characters (letters, numbers, _, -, . only)" });
    if (!isValidEmail(email))   return res.status(400).json({ message: "Invalid email address" });
    if (password.length < 8)   return res.status(400).json({ message: "Password must be at least 8 characters" });
    if (password.length > 128) return res.status(400).json({ message: "Password too long" });
    const existing = Array.from(DB.users.values()).find(u => u.email === email);
    if (existing) return res.status(409).json({ message: "Email already registered" });
    const existingName = Array.from(DB.users.values()).find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existingName) return res.status(409).json({ message: "Username already taken" });
    const id = "user_" + uuidv4().slice(0, 8);
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id, username, email, passwordHash, clanId: null, role: "player", discordId: null, avatar: "", color: "#C8102E", textColor: "#E84060", joinedAt: new Date().toISOString(), lastActive: new Date().toISOString(), kd: 0, wins: 0, losses: 0, winRate: 0, matchesPlayed: 0, mvps: 0, level: 1 };
    DB.users.set(id, user);
    await saveUser(user);
    securityStats.activeUsers = DB.users.size;
    const token = createToken(id);
    res.json({ id, username, email, token });
  } catch (err) { res.status(500).json({ message: "Server error during registration" }); }
});

app.post("/v1/auth/login", checkRateLimit, async (req, res) => {
  try {
    if (req.body.website) { securityStats.honeypotHits++; return res.status(400).json({ message: "Bot detected" }); }
    const { email, password } = req.body;
    const user = Array.from(DB.users.values()).find(u => u.email === email);
    if (!user || !user.passwordHash) {
      securityStats.failedLogins++;
      const ip = req.headers["x-forwarded-for"] || req.ip || "unknown";
      const rec = loginAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
      rec.count++; loginAttempts.set(ip, rec);
      DB.securityEvents.push({ ts: Date.now(), level: "warning", type: "failed_login", message: `Failed login for ${email} from ${ip}`, ip });
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { securityStats.failedLogins++; return res.status(401).json({ message: "Invalid email or password" }); }
    const token = createToken(user.id);
    user.lastActive = new Date().toISOString();
    res.json({ id: user.id, username: user.username, email: user.email, token });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post("/v1/auth/logout", (req, res) => {
  if (req.sessionToken) SESSION_STORE.delete(req.sessionToken);
  res.json({ message: "Logged out" });
});

app.get("/v1/auth/session", (req, res) => {
  if (!req.sessionUserId) return res.json({ user: null });
  const user = DB.users.get(req.sessionUserId);
  if (!user) return res.json({ user: null });
  securityStats.activeUsers = DB.users.size;
  res.json({ user: { id: user.id, username: user.username, avatar: user.avatar, role: user.role, clanId: user.clanId } });
});

// ============================================
// DISCORD OAUTH2 CALLBACK
// ============================================
app.get("/v1/auth/discord/callback", async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "https://jr7arena.netlify.app";

  console.log("Discord callback triggered");

  if (error) {
    console.error("Discord returned error:", error);
    return res.redirect(`${frontendUrl}/pages/register.html?error=discord_denied&reason=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(`${frontendUrl}/pages/register.html?error=no_code`);
  }

  // Check env vars are set
  if (!process.env.DISCORD_CLIENT_SECRET) {
    console.error("DISCORD_CLIENT_SECRET is not set in environment variables!");
    return res.redirect(`${frontendUrl}/pages/register.html?error=server_misconfigured`);
  }

  const redirectUri = process.env.DISCORD_REDIRECT_URI || "https://jr7-backened-production.up.railway.app/v1/auth/discord/callback";
  console.log("Using redirect_uri:", redirectUri);

  try {
    const tokenBody = new URLSearchParams({
      client_id:     process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type:    "authorization_code",
      code:          code,
      redirect_uri:  redirectUri
    }).toString();

    console.log("Exchanging code for token...");

    const tokenRes = await httpRequest("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(tokenBody)
      }
    }, tokenBody);

    const tokenText = await tokenRes.text();
    console.log("Token exchange status:", tokenRes.status, "body:", tokenText.substring(0, 200));

    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokenRes.status, tokenText);
      return res.redirect(`${frontendUrl}/pages/register.html?error=token_failed&status=${tokenRes.status}`);
    }

    let tokenData;
    try { tokenData = JSON.parse(tokenText); }
    catch(e) { console.error("Token JSON parse failed:", tokenText); return res.redirect(`${frontendUrl}/pages/register.html?error=token_parse_failed`); }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error("No access_token in response:", tokenData);
      return res.redirect(`${frontendUrl}/pages/register.html?error=no_access_token`);
    }

    console.log("Got access token, fetching Discord user...");

    const userRes = await httpRequest("https://discord.com/api/users/@me", {
      method:  "GET",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    const userText = await userRes.text();
    console.log("User fetch status:", userRes.status);

    if (!userRes.ok) {
      console.error("User fetch failed:", userRes.status, userText);
      return res.redirect(`${frontendUrl}/pages/register.html?error=user_fetch_failed`);
    }

    let discordUser;
    try { discordUser = JSON.parse(userText); }
    catch(e) { return res.redirect(`${frontendUrl}/pages/register.html?error=user_parse_failed`); }

    // User authenticated successfully
    const discordId = discordUser.id;
    const username  = discordUser.username;
    const email     = discordUser.email;
    const avatar    = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
      : "";

    let user = Array.from(DB.users.values()).find(u => u.discordId === discordId);
    if (!user && email) user = Array.from(DB.users.values()).find(u => u.email === email);

    if (user) {
      user.discordId  = discordId;
      user.avatar     = avatar || user.avatar;
      user.lastActive = new Date().toISOString();
    } else {
      const id = "user_" + uuidv4().slice(0, 8);
      user = { id, username, email: email || `${discordId}@discord.local`, passwordHash: null, clanId: null, role: "player", discordId, avatar, color: "#C8102E", textColor: "#E84060", joinedAt: new Date().toISOString(), lastActive: new Date().toISOString(), kd: 0, wins: 0, losses: 0, winRate: 0, matchesPlayed: 0, mvps: 0, level: 1 };
      DB.users.set(id, user);
    }
    // Auto-promote if Discord ID is in ADMIN_DISCORD_IDS
    const adminIds = (process.env.ADMIN_DISCORD_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (adminIds.includes(discordId) && user.role === "player") {
      user.role = "admin";
      // User role updated
    }

    // Save/update user in DB
    await saveUser(user);
    const token = createToken(user.id);
    // Redirecting to frontend
    res.redirect(`${frontendUrl}/#token=${encodeURIComponent(token)}`);

  } catch (err) {
    console.error("Discord callback error:", err);
    res.redirect(`${frontendUrl}/pages/register.html?error=server_error`);
  }
});

// ============================================
// USER ROUTES
// ============================================
app.post("/v1/users/:id/update", requireAuth, (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ message: "Cannot edit another user" });
  const user = req.user;
  if (req.body.username !== undefined) {
    const newName = sanitize(req.body.username, 24);
    if (!isValidUsername(newName)) return res.status(400).json({ message: "Invalid username format" });
    const taken = Array.from(DB.users.values()).find(u => u.id !== user.id && u.username.toLowerCase() === newName.toLowerCase());
    if (taken) return res.status(409).json({ message: "Username already taken" });
    user.username = newName;
  }
  if (req.body.bio       !== undefined) user.bio       = sanitize(req.body.bio, 160);
  if (req.body.avatar    !== undefined) user.avatar    = req.body.avatar.startsWith('https://') ? req.body.avatar : user.avatar;
  if (req.body.color     !== undefined && /^#[0-9A-Fa-f]{6}$/.test(req.body.color)) user.color = req.body.color;
  if (req.body.textColor !== undefined && /^#[0-9A-Fa-f]{6}$/.test(req.body.textColor)) user.textColor = req.body.textColor;
  if (req.body.activision !== undefined) user.activision = sanitize(req.body.activision, 40);
  if (req.body.twitter    !== undefined) user.twitter    = sanitize(req.body.twitter, 40);
  if (req.body.twitch     !== undefined) user.twitch     = sanitize(req.body.twitch, 40);
  if (req.body.youtube    !== undefined) user.youtube    = sanitize(req.body.youtube, 60);
  if (req.body.instagram  !== undefined) user.instagram  = sanitize(req.body.instagram, 40);
  await saveUser(user);
  res.json({ message: "Profile updated", user: { id: user.id, username: user.username, avatar: user.avatar } });
});

app.get("/v1/users/:id", (req, res) => {
  const user = DB.users.get(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  const { passwordHash, ...publicUser } = user;
  res.json(publicUser);
});

app.get("/v1/users/:id/stats", (req, res) => {
  const user = DB.users.get(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  const clan = user.clanId ? DB.clans.get(user.clanId) : null;
  res.json({
    ...user,
    clanTag: clan?.tag || null,
    clanName: clan?.name || null,
    role: user.id === clan?.captainId ? "Captain" : "Player",
    modeStats: {
      hp:  { wins: Math.floor(user.wins * 0.4),  losses: Math.floor(user.losses * 0.35) },
      sd:  { wins: Math.floor(user.wins * 0.35), losses: Math.floor(user.losses * 0.4)  },
      ctl: { wins: Math.floor(user.wins * 0.25), losses: Math.floor(user.losses * 0.25) }
    },
    achievements: [
      { name: "First Blood",      unlocked: user.matchesPlayed > 0,  icon: "🩸" },
      { name: "Clutch King",      unlocked: user.mvps > 10,           icon: "👑" },
      { name: "50 Wins",          unlocked: user.wins >= 50,          icon: "🏆" },
      { name: "100 Wins",         unlocked: user.wins >= 100,         icon: "💯" },
      { name: "Tournament Champ", unlocked: false,                    icon: "🥇" },
      { name: "Unstoppable",      unlocked: user.wins >= 200,         icon: "🔥" }
    ],
    recentMatches: Array.from(DB.matches.values())
      .filter(m => m.clan1Id === user.clanId || m.clan2Id === user.clanId)
      .slice(0, 5)
      .map(m => ({
        id: m.id,
        opponent:    m.clan1Id === user.clanId ? m.clan2.name : m.clan1.name,
        opponentTag: m.clan1Id === user.clanId ? m.clan2.tag  : m.clan1.tag,
        result: m.winnerId === user.clanId ? "win" : "loss",
        score:  `${m.score.clan1}-${m.score.clan2}`,
        mode:   m.mode,
        date:   m.endedAt || m.scheduledAt
      }))
  });
});

app.get("/v1/users/leaderboard", (req, res) => {
  const page  = parseInt(req.query.page) || 1;
  const limit = 20;
  const players = Array.from(DB.users.values())
    .sort((a, b) => b.winRate - a.winRate)
    .slice((page - 1) * limit, page * limit)
    .map(u => {
      const clan = u.clanId ? DB.clans.get(u.clanId) : null;
      return { id: u.id, username: u.username, clanTag: clan?.tag || null, role: u.id === clan?.captainId ? "Captain" : "Player", wins: u.wins, losses: u.losses, kd: u.kd, winRate: u.winRate, trend: Math.floor(Math.random() * 10) - 3, color: u.color, textColor: u.textColor };
    });
  res.json({ players, total: DB.users.size, pages: Math.ceil(DB.users.size / limit) });
});

// ============================================
// CLAN ROUTES
// ============================================
app.get("/v1/clans", (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;
  const clans = Array.from(DB.clans.values()).slice((page - 1) * limit, page * limit);
  res.json({ clans, total: DB.clans.size, pages: Math.ceil(DB.clans.size / limit) });
});

app.get("/v1/clans/:id", (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  res.json(clan);
});

app.post("/v1/clans/create", requireAuth, checkRateLimit, (req, res) => {
  if (req.user.clanId) return res.status(400).json({ message: "You are already in a clan. Leave first." });
  const name        = sanitize(req.body.name || '', 40);
  const tag         = sanitize(req.body.tag  || '', 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const description = sanitize(req.body.description || '', 200);
  const primaryMode = req.body.primaryMode || "All modes";
  const recruiting  = req.body.recruiting !== false;
  const color       = /^#[0-9A-Fa-f]{6}$/.test(req.body.color || '') ? req.body.color : "#C8102E";
  const textColor   = /^#[0-9A-Fa-f]{6}$/.test(req.body.textColor || '') ? req.body.textColor : "#E84060";
  if (!name || name.length < 2) return res.status(400).json({ message: "Clan name must be at least 2 characters" });
  if (!tag  || tag.length < 2 || tag.length > 4) return res.status(400).json({ message: "Tag must be 2-4 letters/numbers" });
  const existing = Array.from(DB.clans.values()).find(c => c.tag === tag);
  if (existing) return res.status(409).json({ message: "Clan tag already taken" });
  const id   = "clan_" + uuidv4().slice(0, 8);
  const clan = { id, name, tag, description, captain: req.user.username, captainId: req.user.id, primaryMode, recruiting, rank: DB.clans.size + 1, wins: 0, losses: 0, winRate: 0, streak: 0, memberCount: 1, color, textColor, borderColor: color + "40", createdAt: new Date().toISOString(), modes: primaryMode === "all" ? ["hp","sd","ctl"] : [primaryMode] };
  DB.clans.set(id, clan);
  req.user.clanId = id;
  req.user.role   = "captain";
  await saveUser(req.user);
  await saveClan(clan);
  res.json(clan);
});

app.post("/v1/clans/:id/update", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (clan.captainId !== req.user.id && req.user.role !== "admin" && req.user.role !== "owner") {
    return res.status(403).json({ message: "Only the clan captain can update the clan" });
  }
  const { name, description, recruiting, logo, banner, color, textColor } = req.body;
  if (name)        clan.name        = name;
  if (description !== undefined) clan.description = description;
  if (recruiting  !== undefined) clan.recruiting  = recruiting;
  if (logo)        clan.logo        = logo;
  if (banner)      clan.banner      = banner;
  if (color)       { clan.color = color; clan.borderColor = color + "40"; }
  if (textColor)   clan.textColor   = textColor;
  res.json(clan);
});

app.post("/v1/clans/:id/leave", requireAuth, async (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (req.user.clanId !== clan.id) return res.status(400).json({ message: "You are not in this clan" });
  if (clan.captainId === req.user.id && clan.memberCount > 1) {
    return res.status(400).json({ message: "Transfer ownership before leaving" });
  }
  req.user.clanId = null;
  req.user.role   = "player";
  clan.memberCount = Math.max(0, (clan.memberCount || 1) - 1);
  if (clan.memberCount === 0) {
    DB.clans.delete(clan.id);
    if (pgPool) { try { await pgPool.query('DELETE FROM clans WHERE id=$1',[clan.id]); } catch(e){} }
  } else {
    await saveClan(clan);
  }
  await saveUser(req.user);
  res.json({ message: "Left clan" });
});

app.post("/v1/clans/:id/apply", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (!clan.recruiting) return res.status(400).json({ message: "Clan not recruiting" });
  res.json({ message: "Application sent", clanId: clan.id });
});

app.get("/v1/clans/:id/roster", (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  const members = Array.from(DB.users.values()).filter(u => u.clanId === clan.id).map(u => ({ id: u.id, username: u.username, role: u.id === clan.captainId ? "Captain" : "Player", kd: u.kd, color: u.color, textColor: u.textColor }));
  res.json({ members });
});

app.get("/v1/clans/:id/matches", (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  const matches = Array.from(DB.matches.values()).filter(m => m.clan1Id === clan.id || m.clan2Id === clan.id).map(m => ({ id: m.id, clan1: { id: m.clan1.id, tag: m.clan1.tag }, clan2: { id: m.clan2.id, tag: m.clan2.tag }, winnerId: m.winnerId, score: `${m.score.clan1}-${m.score.clan2}`, mode: m.mode, endedAt: m.endedAt }));
  res.json({ matches });
});

// ============================================
// MATCH ROUTES
// ============================================
app.get("/v1/matches", (req, res) => {
  const limit  = parseInt(req.query.limit) || 10;
  const status = req.query.status;
  let matches  = Array.from(DB.matches.values());
  if (status) matches = matches.filter(m => m.status === status);
  matches = matches.slice(0, limit).map(m => ({ id: m.id, clan1: { id: m.clan1.id, tag: m.clan1.tag }, clan2: { id: m.clan2.id, tag: m.clan2.tag }, winnerId: m.winnerId, score: `${m.score.clan1}-${m.score.clan2}`, mode: m.mode, endedAt: m.endedAt }));
  res.json({ matches });
});

app.get("/v1/matches/:id", (req, res) => {
  const match = DB.matches.get(req.params.id);
  if (!match) return res.status(404).json({ message: "Match not found" });
  res.json(match);
});

app.post("/v1/matches/challenge", requireAuth, checkRateLimit, (req, res) => {
  const { challengedClanId, mode, format, scheduledAt } = req.body;
  const challenger = req.user;
  const challenged = DB.clans.get(challengedClanId);
  if (!challenged) return res.status(404).json({ message: "Clan not found" });
  if (!challenger.clanId) return res.status(400).json({ message: "You must be in a clan" });
  const id             = "match_" + uuidv4().slice(0, 8);
  const challengerClan = DB.clans.get(challenger.clanId);
  const match = { id, clan1Id: challenger.clanId, clan2Id: challengedClanId, clan1: { id: challengerClan.id, name: challengerClan.name, tag: challengerClan.tag, captain: challenger.username, rank: challengerClan.rank }, clan2: { id: challenged.id, name: challenged.name, tag: challenged.tag, captain: challenged.captain, rank: challenged.rank }, status: "pending", currentRound: 1, mode: mode || "Mixed", map: "TBD", format: format || "Best of 5", division: "Elite", scheduledAt: scheduledAt || new Date().toISOString(), score: { clan1: 0, clan2: 0 }, winnerId: null, rounds: [], referee: null, endedAt: null };
  DB.matches.set(id, match);
  await saveMatch(match);
  res.json({ id, message: "Challenge sent", status: "pending" });
});

app.post("/v1/matches/:id/accept", requireAuth, (req, res) => {
  const match = DB.matches.get(req.params.id);
  if (!match) return res.status(404).json({ message: "Match not found" });
  match.status  = "in_progress";
  match.referee = "Referee" + Math.floor(Math.random() * 100);
  res.json({ message: "Challenge accepted", match });
});

app.post("/v1/matches/:id/rounds/:round/submit",  requireAuth, (req, res) => { res.json({ message: "Proof submitted", status: "awaiting_confirmation" }); });
app.post("/v1/matches/:id/rounds/:round/confirm", requireAuth, (req, res) => { res.json({ message: "Round confirmed" }); });
app.post("/v1/matches/:id/rounds/:round/dispute", requireAuth, (req, res) => { res.json({ message: "Dispute filed" }); });
app.post("/v1/matches/:id/escalate",              requireAuth, (req, res) => { res.json({ message: "Escalated to referee" }); });

app.post("/v1/matches/:id/chat", requireAuth, (req, res) => {
  const { message, type } = req.body;
  if (pusher) {
    pusher.trigger(`private-match-${req.params.id}`, "message", {
      message, type: type || "text", username: req.user.username,
      initials: req.user.username.substring(0, 2).toUpperCase(),
      time: new Date().toLocaleTimeString()
    });
  }
  res.json({ message: "Sent" });
});

// ============================================
// PUSHER AUTH
// ============================================
app.post("/v1/api/pusher/auth", requireAuth, (req, res) => {
  if (!pusher) return res.status(503).json({ message: "Pusher not configured" });
  const socketId = req.body.socket_id;
  const channel  = req.body.channel_name;
  const matchId  = channel.replace("private-match-", "");
  const match    = DB.matches.get(matchId);
  if (match) {
    const isParticipant = match.clan1Id === req.user.clanId || match.clan2Id === req.user.clanId;
    const isReferee     = ["moderator","admin","owner"].includes(req.user.role);
    if (!isParticipant && !isReferee) return res.status(403).json({ message: "Not authorized for this match" });
  }
  res.send(pusher.authorizeChannel(socketId, channel));
});

// ============================================
// TOURNAMENT & NEWS ROUTES
// ============================================
app.get("/v1/tournaments", (req, res) => { res.json({ tournaments: DB.tournaments }); });

app.get("/v1/news", (req, res) => {
  const page     = parseInt(req.query.page)  || 1;
  const limit    = parseInt(req.query.limit) || 10;
  const articles = DB.news.slice((page - 1) * limit, page * limit);
  res.json({ articles, total: DB.news.length, pages: Math.ceil(DB.news.length / limit) });
});

// ============================================
// STATS / OVERVIEW
// ============================================
app.get("/v1/stats/overview", (req, res) => {
  res.json({ players: DB.users.size, clans: DB.clans.size, matches: DB.matches.size });
});

// ============================================
// SECURITY ROUTES
// ============================================
app.post("/v1/security/honeypot", (req, res) => {
  securityStats.honeypotHits++;
  securityStats.botsBlocked++;

  const ip = req.body.ip || req.headers["x-forwarded-for"] || req.ip || "unknown";

  const event = {
    ts:        Date.now(),
    level:     "critical",
    type:      req.body.type || "honeypot_trigger",
    message:   req.body.type === "honeypot_file_access"
                 ? `Trap file accessed: ${req.body.url || "unknown"}`
                 : "Honeypot form field triggered — bot blocked",
    // Network
    ip,
    city:      req.body.city     || "—",
    region:    req.body.region   || "—",
    country:   req.body.country  || "—",
    isp:       req.body.isp      || "—",
    isVPN:     req.body.isVPN    || false,
    // Device
    os:        req.body.os       || "—",
    browser:   req.body.browser  || "—",
    device:    req.body.device   || "—",
    platform:  req.body.platform || "—",
    screen:    req.body.screen   || "—",
    userAgent: req.body.userAgent || req.headers["user-agent"] || "—",
    // Session
    url:       req.body.url       || "—",
    referrer:  req.body.referrer  || "direct",
    timezone:  req.body.timezone  || "—",
    language:  req.body.language  || "—",
    cookiesOn: req.body.cookiesOn !== undefined ? req.body.cookiesOn : "—",
    timestamp: req.body.timestamp || new Date().toISOString(),
  };

  DB.securityEvents.push(event);
  if (DB.securityEvents.length > 500) DB.securityEvents.shift();
  if (event.isVPN) securityStats.honeypotIPs = (securityStats.honeypotIPs || 0) + 1;

  console.log(`🍯 HONEYPOT | IP: ${ip} | ${event.city}, ${event.country} | ISP: ${event.isp} | VPN: ${event.isVPN} | OS: ${event.os} | ${event.url}`);
  res.json({ ok: true });
});

app.get("/v1/security/public-summary", (req, res) => {
  res.json({ botsBlocked: securityStats.botsBlocked, honeypotHits: securityStats.honeypotHits, failedLogins: securityStats.failedLogins });
});

// ============================================
// ADMIN ROUTES
// ============================================
app.get("/v1/admin/security",  requireAdmin, (req, res) => { res.json(securityStats); });

app.get("/v1/admin/logs", requireAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ events: DB.securityEvents.slice(-limit).map(e => ({ ...e, ts: e.ts || Date.now() })) });
});

app.get("/v1/security/events", requireAdmin, (req, res) => {
  const type  = req.query.type || "all";
  const limit = parseInt(req.query.limit) || 20;
  let events  = DB.securityEvents.slice(-limit).reverse();
  if (type !== "all") events = events.filter(e => e.type === type || e.level === type);
  const threats = events.filter(e => e.level === "critical" || e.level === "warning").map(e => ({
    severity: e.level, description: e.message, ip: e.ip || "—", ts: e.ts
  }));
  res.json({ threats, events });
});

app.get("/v1/security/flagged", requireAdmin, (req, res) => {
  const flagged = Array.from(DB.users.values())
    .filter(u => u.flagged || u.banned)
    .map(u => ({ id: u.id, username: u.username, reason: u.flagReason || u.banReason || "Flagged", banned: u.banned || false }));
  res.json({ users: flagged });
});

app.post("/v1/admin/security/block-ip", requireAdmin, (req, res) => { res.json({ message: "IP blocked" }); });
app.post("/v1/admin/users/:id/ban",      requireAdmin, (req, res) => { res.json({ message: "User banned" }); });
app.post("/v1/admin/users/:id/clear-flag", requireAdmin, (req, res) => { res.json({ message: "Flag cleared" }); });

app.get("/v1/admin/users", requireAdmin, (req, res) => {
  res.json({ users: Array.from(DB.users.values()).map(u => ({ id: u.id, username: u.username, role: u.role, discordId: u.discordId })) });
});

app.get("/v1/admin/clans", requireAdmin, (req, res) => {
  res.json({ clans: Array.from(DB.clans.values()) });
});

// ============================================
// NOTIFICATIONS
// ============================================
const DB_notifications = new Map(); // userId -> [{id, type, message, read, ts}]

function addNotification(userId, type, message) {
  if (!DB_notifications.has(userId)) DB_notifications.set(userId, []);
  const notifs = DB_notifications.get(userId);
  notifs.unshift({ id: uuidv4(), type, message, read: false, ts: Date.now() });
  if (notifs.length > 50) notifs.pop();
}

app.get("/v1/notifications", requireAuth, (req, res) => {
  const notifs = DB_notifications.get(req.user.id) || [];
  res.json({ notifications: notifs, unread: notifs.filter(n => !n.read).length });
});

app.post("/v1/notifications/read-all", requireAuth, (req, res) => {
  const notifs = DB_notifications.get(req.user.id) || [];
  notifs.forEach(n => n.read = true);
  res.json({ ok: true });
});

// ============================================
// CLAN — KICK / TRANSFER / PICTURE / APPLY
// ============================================
app.post("/v1/clans/:id/kick", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (clan.captainId !== req.user.id) return res.status(403).json({ message: "Only the captain can kick members" });
  const { userId } = req.body;
  if (userId === req.user.id) return res.status(400).json({ message: "Cannot kick yourself" });
  const target = DB.users.get(userId);
  if (!target || target.clanId !== clan.id) return res.status(404).json({ message: "User not in this clan" });
  target.clanId = null;
  target.role   = "player";
  clan.memberCount = Math.max(0, (clan.memberCount || 1) - 1);
  addNotification(userId, "kicked", `You were removed from ${clan.name}`);
  res.json({ message: "Member kicked" });
});

app.post("/v1/clans/:id/transfer", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (clan.captainId !== req.user.id) return res.status(403).json({ message: "Only the captain can transfer ownership" });
  const { userId } = req.body;
  const target = DB.users.get(userId);
  if (!target || target.clanId !== clan.id) return res.status(404).json({ message: "User not in this clan" });
  // Transfer
  req.user.role  = "member";
  target.role    = "captain";
  clan.captainId = userId;
  clan.captain   = target.username;
  addNotification(userId, "ownership", `You are now the captain of ${clan.name}`);
  res.json({ message: "Ownership transferred", newCaptain: target.username });
});

app.post("/v1/clans/:id/leave", requireAuth, async (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (req.user.clanId !== clan.id) return res.status(400).json({ message: "You are not in this clan" });
  if (clan.captainId === req.user.id && clan.memberCount > 1) {
    return res.status(400).json({ message: "Transfer ownership before leaving" });
  }
  req.user.clanId = null;
  req.user.role   = "player";
  clan.memberCount = Math.max(0, (clan.memberCount || 1) - 1);
  if (clan.memberCount === 0) {
    DB.clans.delete(clan.id);
    if (pgPool) { try { await pgPool.query('DELETE FROM clans WHERE id=$1',[clan.id]); } catch(e){} }
  } else {
    await saveClan(clan);
  }
  await saveUser(req.user);
  res.json({ message: "Left clan" });
});

app.post("/v1/clans/:id/apply", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (!clan.recruiting) return res.status(400).json({ message: "Clan not recruiting" });
  if (req.user.clanId) return res.status(400).json({ message: "Leave your current clan first" });
  // Notify captain
  addNotification(clan.captainId, "application", `${req.user.username} applied to join ${clan.name}`);
  // Store pending application
  if (!clan.applications) clan.applications = [];
  clan.applications = clan.applications.filter(a => a.userId !== req.user.id);
  clan.applications.push({ userId: req.user.id, username: req.user.username, ts: Date.now() });
  res.json({ message: "Application sent" });
});

app.post("/v1/clans/:id/applications/:userId/accept", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (clan.captainId !== req.user.id) return res.status(403).json({ message: "Only captain can accept applications" });
  const target = DB.users.get(req.params.userId);
  if (!target) return res.status(404).json({ message: "User not found" });
  target.clanId = clan.id;
  target.role   = "member";
  clan.memberCount = (clan.memberCount || 0) + 1;
  clan.applications = (clan.applications || []).filter(a => a.userId !== req.params.userId);
  addNotification(req.params.userId, "accepted", `Your application to ${clan.name} was accepted!`);
  res.json({ message: "Application accepted" });
});

app.post("/v1/clans/:id/applications/:userId/reject", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (clan.captainId !== req.user.id) return res.status(403).json({ message: "Only captain can reject applications" });
  clan.applications = (clan.applications || []).filter(a => a.userId !== req.params.userId);
  addNotification(req.params.userId, "rejected", `Your application to ${clan.name} was not accepted.`);
  res.json({ message: "Application rejected" });
});

app.get("/v1/clans/:id/applications", requireAuth, (req, res) => {
  const clan = DB.clans.get(req.params.id);
  if (!clan) return res.status(404).json({ message: "Clan not found" });
  if (clan.captainId !== req.user.id) return res.status(403).json({ message: "Only captain can view applications" });
  res.json({ applications: clan.applications || [] });
});

// ============================================
// ADMIN — BAN / UNBAN / EDIT USER
// ============================================
app.post("/v1/admin/users/:id/ban", requireAdmin, (req, res) => {
  const user = DB.users.get(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  user.banned     = true;
  user.bannedAt   = new Date().toISOString();
  user.banReason  = req.body.reason || "Banned by admin";
  // Invalidate their sessions
  for (const [token, sess] of SESSION_STORE.entries()) {
    if (sess.userId === user.id) SESSION_STORE.delete(token);
  }
  res.json({ message: "User banned" });
});

app.post("/v1/admin/users/:id/unban", requireAdmin, (req, res) => {
  const user = DB.users.get(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  user.banned    = false;
  user.bannedAt  = null;
  user.banReason = null;
  res.json({ message: "User unbanned" });
});

app.post("/v1/admin/users/:id/edit", requireAdmin, async (req, res) => {
  const user = DB.users.get(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  const { username, email, password, role } = req.body;
  if (username) user.username = username;
  if (email)    user.email    = email;
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  if (role)     user.role     = role;
  res.json({ message: "User updated", user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

// Ban check middleware — add to auth check
const _originalRequireAuth = requireAuth;

// ============================================
// GUIDES
// ============================================
const GUIDES = [
  {
    id: "ranked-tips", category: "competitive", title: "Ranked Play Tips", icon: "🏆",
    description: "How to climb the ranked ladder efficiently in CDL modes.",
    readTime: "5 min", author: "Jr7 Staff", date: "2026-07-20",
    content: [
      { heading: "Map Awareness", body: "Always know where your team is and where spawns are flipping. Watch the minimap every few seconds — most deaths come from unexpected flanks that the map would have warned you about." },
      { heading: "Communication", body: "Call out enemy positions using callouts, not descriptions. 'Garden' is faster than 'behind the bush near the house on the left'. Learn the callouts for every map you play." },
      { heading: "Play the Objective", body: "Kills don't win rounds — objectives do. In Hardpoint, hill time wins games. In S&D, plants and defuses win rounds. High kills with low objective play is a liability to your team." },
      { heading: "Economy of Movement", body: "Don't sprint everywhere. Holding angles while walking reduces footstep noise and gives you better reaction time. Sprint only when repositioning between objectives." },
      { heading: "Review Your Deaths", body: "After each death, ask: was that a bad decision or bad execution? Bad decisions need to change. Bad execution improves with practice. Most ranked losses come from avoidable decisions." }
    ]
  },
  {
    id: "controller-settings", category: "settings", title: "Best Controller Settings", icon: "🎮",
    description: "Optimal sensitivity, deadzone, and button layout for competitive play.",
    readTime: "4 min", author: "Jr7 Staff", date: "2026-07-18",
    content: [
      { heading: "Sensitivity", body: "Most CDL pros use 6-8 horizontal/vertical sensitivity. Start at 6-6 and increase only when you feel you're losing gunfights due to turn speed, not aim. Don't copy pro settings blindly — find what lets you track targets smoothly." },
      { heading: "Deadzone", body: "Set your stick deadzone as low as possible without stick drift (usually 0.02–0.05). Lower deadzone = faster initial movement response. Test by going to the settings preview and checking for unwanted drift." },
      { heading: "ADS Sensitivity", body: "Set ADS sensitivity multiplier to 0.80–0.90. This slows your aim slightly when scoped so you can make precise micro-adjustments. Higher ADS on snipers (1.0+) for faster tracking." },
      { heading: "Button Layout", body: "Tactical (crouch/slide on R3, melee on O/B) is the most common competitive layout. It lets you jump and crouch simultaneously without lifting your thumb from the aim stick." },
      { heading: "Trigger Effect", body: "Set triggers to Classic or turn off trigger effects entirely. Adaptive triggers add resistance that can slow your fire rate on semi-auto weapons." }
    ]
  },
  {
    id: "graphics-settings", category: "settings", title: "Best Graphics Settings", icon: "🖥️",
    description: "Maximise frame rate and visibility for competitive advantage.",
    readTime: "3 min", author: "Jr7 Staff", date: "2026-07-15",
    content: [
      { heading: "Frame Rate Priority", body: "Set Display Mode to Performance (60fps locked) or Performance+ (120fps on compatible TVs). Consistent frame rate beats higher but variable frames every time. Screen tearing is better than frame drops in gunfights." },
      { heading: "Brightness", body: "Set brightness to 55-65. Too dark and you miss enemies in shadows; too bright and the image washes out. Test in a dark indoor area of the map." },
      { heading: "Colour Blind Mode", body: "Even without colour blindness, Deuteranopia or Protanopia modes can make enemy outlines more distinct against certain backgrounds. Try each and see what works for you." },
      { heading: "Film Grain & Motion Blur", body: "Turn both to 0. Film grain adds visual noise that obscures targets. Motion blur makes tracking moving enemies harder. These are cinematic effects with zero competitive benefit." },
      { heading: "Field of View", body: "On PC/PS5, set FOV to 100-105. Wider FOV shows more of the environment but makes targets appear smaller. 100 is the sweet spot between awareness and target visibility." }
    ]
  },
  {
    id: "meta-loadouts", category: "loadouts", title: "Meta Loadouts", icon: "🔫",
    description: "Current season meta weapons and builds for each game mode.",
    readTime: "6 min", author: "Jr7 Staff", date: "2026-07-22",
    content: [
      { heading: "Hardpoint — SMG Rush", body: "For aggressive HP play: Compact SMG with extended mag, lightweight stock, and suppressor. Pair with smoke grenades. This build excels at hill entries and denying enemy resets." },
      { heading: "S&D — AR Precision", body: "Assault rifle with long barrel, precision stock, and vertical grip. The goal is one-burst accuracy at medium range. Avoid suppressors on AR in S&D — you want to hear and be heard for information." },
      { heading: "Control — Versatile Build", body: "A hybrid AR/SMG build works best in Control. Medium range barrel, agile stock. You need to hold sectors (AR strength) but also win close fights (SMG strength)." },
      { heading: "Secondary", body: "Pistol with fast draw always. In CDL modes you will run out of ammo or need to switch quickly. A fast pistol saves more lives than a launcher." },
      { heading: "Perks", body: "Double Time + Tracker + Ghost is the standard competitive perk set. Double Time for movement, Tracker for reading enemy routes, Ghost to stay off UAVs." }
    ]
  },
  {
    id: "spawn-guides", category: "competitive", title: "Spawn Guides", icon: "🗺️",
    description: "How spawns work and how to use them to your advantage.",
    readTime: "5 min", author: "Jr7 Staff", date: "2026-07-10",
    content: [
      { heading: "How Spawns Work", body: "Spawns in CoD are dynamic — they flip based on enemy pressure. The game tries to spawn you away from enemies and towards your team. Understanding this lets you predict where enemies will come from after a kill." },
      { heading: "Spawn Trapping", body: "When your team controls both flanks near the enemy spawn, the enemy spawns collapse to one predictable location. Three players holding spawn while two hold the objective is a common competitive strategy." },
      { heading: "Spawn Flipping", body: "If you push too far without your team, enemy spawns flip behind you. Always know your team's position before deep pushing. A spawn flip can turn a winning round into a loss in seconds." },
      { heading: "Safe Spawns", body: "Each map has 2-3 spawn clusters. Learn which positions are 'safe' (spawn behind you) vs 'contested' (spawn in front). Holding safe spawn positions gives your team sustainable map control." },
      { heading: "Hardpoint Specific", body: "For each Hardpoint hill, know which spawn feeds directly to it. When your team spawns poorly for a hill, rotate — don't fight uphill into better-spawned enemies." }
    ]
  },
  {
    id: "callouts", category: "competitive", title: "Map Callouts", icon: "📍",
    description: "Standard callouts for competitive CDL maps.",
    readTime: "4 min", author: "Jr7 Staff", date: "2026-07-08",
    content: [
      { heading: "Why Callouts Matter", body: "Vague callouts lose gunfights. 'He's on the left' means nothing when your teammate is rotated 180° from you. Specific callouts like 'Garden window' or 'Top mid' let teammates pre-aim and support you immediately." },
      { heading: "Standard Zones", body: "Every CDL map uses consistent zone names: A side, B side, Mid, Top, Bottom, Window, Corner, Street, Alley, Spawn. Learn these for every map you play and use them consistently every game." },
      { heading: "Elevation Callouts", body: "Always call elevation: 'Top window', 'Low garden', 'High mid'. Players at different heights have completely different sight lines and your teammate needs to know where to look." },
      { heading: "Distance Callouts", body: "Add distance when relevant: 'Far B', 'Short corner'. This tells teammates whether to peek or hold — far targets need different setups than close ones." },
      { heading: "Practice Tip", body: "In private matches, walk every map and name every position out loud. Do this with your team so everyone uses the same language. 30 minutes of callout practice saves hundreds of lost gunfights." }
    ]
  },
  {
    id: "rotations", category: "competitive", title: "Rotation Strategies", icon: "🔄",
    description: "When and how to rotate in each CDL game mode.",
    readTime: "4 min", author: "Jr7 Staff", date: "2026-07-05",
    content: [
      { heading: "Rotation Timing", body: "The biggest rotation mistake is going too early or too late. Rotate when: an objective is about to change, your team is outnumbered at the current position, or you've cleared a flank." },
      { heading: "Hardpoint Rotations", body: "Start rotating to the next hill 10-15 seconds before the current one ends. Send 1-2 players early while others hold. Never have your whole team rotating simultaneously — it leaves the current hill empty." },
      { heading: "S&D Rotations", body: "After winning a gunfight, rotate through the position you just cleared — not back through where enemies might respawn. Use your map advantage to pressure the remaining players." },
      { heading: "Reading the Minimap", body: "Your minimap shows teammate positions. When you see teammates clustering, rotate to cover the uncovered flank. Balanced map coverage beats everyone piling into one fight." },
      { heading: "Communication Before Rotating", body: "Always call your rotation before moving: 'Rotating B', 'Going mid'. Teammates need to know your position is vacating so they can adjust or cover it." }
    ]
  },
  {
    id: "coaching", category: "coaching", title: "How to Get Better Faster", icon: "📈",
    description: "Structured improvement approach used by coaches in competitive CDL.",
    readTime: "6 min", author: "Jr7 Staff", date: "2026-07-01",
    content: [
      { heading: "Film Review", body: "Record your games and watch back every death. Pause and ask: what information did I have? What should I have done? Most players never review film — those who do improve 3x faster than those who don't." },
      { heading: "One Thing at a Time", body: "Don't try to improve everything at once. Pick one skill per week: this week is map awareness, next week is rotations. Focused practice beats scattered effort every time." },
      { heading: "Find a Practice Partner", body: "A regular practice partner who communicates and gives feedback is worth more than 100 solo games. They hold you accountable, point out your blind spots, and match your schedule." },
      { heading: "Warm Up Before Ranked", body: "10-15 minutes in a private match or TDM before ranked. Ranked while cold leads to bad early rounds that are hard to come back from. Treat ranked like a job interview — prepare before you go in." },
      { heading: "Tilt Management", body: "When you lose 3 games in a row, stop. Tilted play is mechanical play — you stop thinking and just react. Step away for 30 minutes. Losses on tilt compound; a break breaks the cycle." },
      { heading: "Study the Pro Scene", body: "Watch CDL matches and pick one pro who plays your role. Study their positioning, rotations, and decision-making. Don't copy their settings — copy their decision-making." }
    ]
  }
];

app.get("/v1/guides", (req, res) => {
  const { category } = req.query;
  let guides = GUIDES.map(g => ({ id: g.id, category: g.category, title: g.title, icon: g.icon, description: g.description, readTime: g.readTime, author: g.author, date: g.date }));
  if (category && category !== "all") guides = guides.filter(g => g.category === category);
  res.json({ guides });
});

app.get("/v1/guides/:id", (req, res) => {
  const guide = GUIDES.find(g => g.id === req.params.id);
  if (!guide) return res.status(404).json({ message: "Guide not found" });
  res.json(guide);
});

// ============================================
// RATE LIMITING — login attempts
// ============================================
const loginAttempts = new Map(); // ip -> { count, firstAttempt }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(req, res, next) {
  const ip  = req.headers["x-forwarded-for"] || req.ip || "unknown";
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec) {
    if (now - rec.firstAttempt > LOCKOUT_MS) {
      loginAttempts.delete(ip);
    } else if (rec.count >= MAX_ATTEMPTS) {
      const wait = Math.ceil((LOCKOUT_MS - (now - rec.firstAttempt)) / 60000);
      return res.status(429).json({ message: `Too many attempts. Try again in ${wait} minute(s).` });
    }
  }
  next();
}

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), users: DB.users.size });
});

// ============================================
// START SERVER
// ============================================
// Initialise DB then start server
initDB().then(() => {
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║     JR7 COMMUNITY API SERVER             ║`);
  console.log(`║     Running on port ${PORT}                  ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Auth: token-based (cross-domain safe)   ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});
}); // end initDB
