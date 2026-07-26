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
// IN-MEMORY DATABASE (replace with PostgreSQL later)
// ============================================
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

// Seed demo data
const demoClans = [
  { id: "clan_001", name: "Vortex Gaming", tag: "VTX", description: "Elite CDL competitive clan. Top ranked in Season 1.", captain: "ShadowStrike", captainId: "user_001", primaryMode: "All modes", recruiting: true, rank: 1, wins: 67, losses: 12, winRate: 85, streak: 8, memberCount: 6, color: "#C8102E", textColor: "#E84060", borderColor: "rgba(200,16,46,0.25)", createdAt: "2026-01-10", modes: ["hp","sd","ctl"] },
  { id: "clan_002", name: "Legion Esports", tag: "LGN", description: "Rising stars of the CDL scene. Looking for dedicated players.", captain: "NightOwl", captainId: "user_002", primaryMode: "Hardpoint", recruiting: true, rank: 3, wins: 54, losses: 21, winRate: 72, streak: 3, memberCount: 5, color: "#3D8EF5", textColor: "#5CA0FF", borderColor: "rgba(61,142,245,0.25)", createdAt: "2026-02-15", modes: ["hp"] },
  { id: "clan_003", name: "Phantom Squad", tag: "PHM", description: "Stealth and precision. S&D specialists.", captain: "GhostRider", captainId: "user_003", primaryMode: "S&D", recruiting: false, rank: 5, wins: 48, losses: 28, winRate: 63, streak: -1, memberCount: 4, color: "#9C27B0", textColor: "#CE93D8", borderColor: "rgba(156,39,176,0.25)", createdAt: "2026-03-01", modes: ["sd"] },
  { id: "clan_004", name: "Storm Riders", tag: "STR", description: "Aggressive playstyle. Control mode experts.", captain: "Thunder", captainId: "user_004", primaryMode: "Control", recruiting: true, rank: 8, wins: 41, losses: 33, winRate: 55, streak: 2, memberCount: 5, color: "#FF5722", textColor: "#FF8A65", borderColor: "rgba(255,87,34,0.25)", createdAt: "2026-03-20", modes: ["ctl"] }
];
demoClans.forEach(c => DB.clans.set(c.id, c));

const demoUsers = [
  { id: "user_001", username: "ShadowStrike", email: "shadow@example.com", passwordHash: null, clanId: "clan_001", role: "owner", discordId: "123456", avatar: "", color: "#C8102E", textColor: "#E84060", joinedAt: "2026-01-05", lastActive: "2026-07-23", kd: 1.34, wins: 97, losses: 59, winRate: 62, matchesPlayed: 156, mvps: 23, level: 12 },
  { id: "user_002", username: "NightOwl", email: "night@example.com", passwordHash: null, clanId: "clan_002", role: "captain", discordId: "234567", avatar: "", color: "#3D8EF5", textColor: "#5CA0FF", joinedAt: "2026-02-01", lastActive: "2026-07-22", kd: 1.21, wins: 82, losses: 71, winRate: 54, matchesPlayed: 153, mvps: 18, level: 10 },
  { id: "user_003", username: "GhostRider", email: "ghost@example.com", passwordHash: null, clanId: "clan_003", role: "captain", discordId: "345678", avatar: "", color: "#9C27B0", textColor: "#CE93D8", joinedAt: "2026-02-20", lastActive: "2026-07-21", kd: 1.45, wins: 76, losses: 45, winRate: 63, matchesPlayed: 121, mvps: 31, level: 11 },
  { id: "user_004", username: "Thunder", email: "thunder@example.com", passwordHash: null, clanId: "clan_004", role: "captain", discordId: "456789", avatar: "", color: "#FF5722", textColor: "#FF8A65", joinedAt: "2026-03-10", lastActive: "2026-07-20", kd: 1.12, wins: 68, losses: 82, winRate: 45, matchesPlayed: 150, mvps: 15, level: 9 }
];
demoUsers.forEach(u => DB.users.set(u.id, u));

const demoMatches = [
  { id: "match_001", clan1Id: "clan_001", clan2Id: "clan_002", clan1: { id: "clan_001", name: "Vortex Gaming", tag: "VTX", captain: "ShadowStrike", rank: 1 }, clan2: { id: "clan_002", name: "Legion Esports", tag: "LGN", captain: "NightOwl", rank: 3 }, status: "completed", currentRound: 5, mode: "Mixed", map: "Mercado", format: "Best of 5", division: "Elite", scheduledAt: "2026-07-22T20:00:00Z", score: { clan1: 3, clan2: 1 }, winnerId: "clan_001", rounds: [{ winner: "clan_001", confirmed: true }, { winner: "clan_002", confirmed: true }, { winner: "clan_001", confirmed: true }, { winner: "clan_001", confirmed: true }, { winner: null, confirmed: false }], referee: "RefereeMike", endedAt: "2026-07-22T21:30:00Z" },
  { id: "match_002", clan1Id: "clan_003", clan2Id: "clan_004", clan1: { id: "clan_003", name: "Phantom Squad", tag: "PHM", captain: "GhostRider", rank: 5 }, clan2: { id: "clan_004", name: "Storm Riders", tag: "STR", captain: "Thunder", rank: 8 }, status: "completed", currentRound: 5, mode: "Hardpoint", map: "Hotel", format: "Best of 5", division: "Elite", scheduledAt: "2026-07-20T19:00:00Z", score: { clan1: 2, clan2: 3 }, winnerId: "clan_004", rounds: [{ winner: "clan_003", confirmed: true }, { winner: "clan_004", confirmed: true }, { winner: "clan_004", confirmed: true }, { winner: "clan_003", confirmed: true }, { winner: "clan_004", confirmed: true }], referee: "RefereeSarah", endedAt: "2026-07-20T20:45:00Z" }
];
demoMatches.forEach(m => DB.matches.set(m.id, m));

let securityStats = {
  botsBlocked: 1247, honeypotHits: 89, failedLogins: 34,
  attackAttempts: 340, activeUsers: 156, attacksToday: 12,
  botsToday: 45, loginsToday: 8, honeypotIPs: 23, pendingReports: 3
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// SESSION — TOKEN BASED (fixes cross-domain cookie issue)
// Instead of cookies, we use a token in the response header
// that the frontend stores in localStorage
// ============================================
const SESSION_STORE = new Map(); // token -> { userId, createdAt }

function createToken(userId) {
  const token = uuidv4() + uuidv4(); // long random token
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
app.post("/v1/auth/register", async (req, res) => {
  try {
    if (req.body.website) { securityStats.honeypotHits++; return res.status(400).json({ message: "Bot detected" }); }
    const { username, email, password } = req.body;
    if (!username || !email || !password || password.length < 8) return res.status(400).json({ message: "Invalid input" });
    const existing = Array.from(DB.users.values()).find(u => u.email === email);
    if (existing) return res.status(409).json({ message: "Email already registered" });
    const id = "user_" + uuidv4().slice(0, 8);
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id, username, email, passwordHash, clanId: null, role: "player", discordId: null, avatar: "", color: "#C8102E", textColor: "#E84060", joinedAt: new Date().toISOString(), lastActive: new Date().toISOString(), kd: 0, wins: 0, losses: 0, winRate: 0, matchesPlayed: 0, mvps: 0, level: 1 };
    DB.users.set(id, user);
    const token = createToken(id);
    res.json({ id, username, email, token });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post("/v1/auth/login", async (req, res) => {
  try {
    if (req.body.website) { securityStats.honeypotHits++; return res.status(400).json({ message: "Bot detected" }); }
    const { email, password } = req.body;
    const user = Array.from(DB.users.values()).find(u => u.email === email);
    if (!user || !user.passwordHash) { securityStats.failedLogins++; return res.status(401).json({ message: "Invalid email or password" }); }
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
  res.json({ user: { id: user.id, username: user.username, avatar: user.avatar, role: user.role, clanId: user.clanId } });
});

// ============================================
// DISCORD OAUTH2 CALLBACK
// ============================================
app.get("/v1/auth/discord/callback", async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "https://jr7arena.netlify.app";

  console.log("Discord callback hit — code:", code ? "present" : "missing", "error:", error || "none");

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

    console.log("Discord user:", discordUser.username, discordUser.id);
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
      console.log(`Auto-promoted ${user.username} (${discordId}) to admin`);
    }

    // Create token and redirect to frontend — token in URL gets saved by app.js
    const token = createToken(user.id);
    console.log(`Login success for ${user.username} — redirecting to frontend`);
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
  const { username, bio, avatar, color, textColor, activision, twitter, twitch, youtube, instagram } = req.body;
  const user = req.user;
  if (username)   user.username   = username;
  if (bio !== undefined)  user.bio = bio;
  if (avatar)     user.avatar     = avatar;
  if (color)      { user.color = color; }
  if (textColor)  user.textColor  = textColor;
  if (activision !== undefined) user.activision = activision;
  if (twitter    !== undefined) user.twitter    = twitter;
  if (twitch     !== undefined) user.twitch     = twitch;
  if (youtube    !== undefined) user.youtube    = youtube;
  if (instagram  !== undefined) user.instagram  = instagram;
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

app.post("/v1/clans/create", requireAuth, (req, res) => {
  const { name, tag, description, primaryMode, recruiting, color, textColor } = req.body;
  if (!name || !tag || tag.length < 2 || tag.length > 4) return res.status(400).json({ message: "Invalid clan data" });
  const id   = "clan_" + uuidv4().slice(0, 8);
  const clan = { id, name, tag: tag.toUpperCase(), description: description || "", captain: req.user.username, captainId: req.user.id, primaryMode: primaryMode || "All modes", recruiting: recruiting !== false, rank: DB.clans.size + 1, wins: 0, losses: 0, winRate: 0, streak: 0, memberCount: 1, color: color || "#C8102E", textColor: textColor || "#E84060", borderColor: (color || "#C8102E") + "40", createdAt: new Date().toISOString(), modes: primaryMode === "all" ? ["hp","sd","ctl"] : [primaryMode] };
  DB.clans.set(id, clan);
  req.user.clanId = id;
  req.user.role   = "captain";
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

app.post("/v1/matches/challenge", requireAuth, (req, res) => {
  const { challengedClanId, mode, format, scheduledAt } = req.body;
  const challenger = req.user;
  const challenged = DB.clans.get(challengedClanId);
  if (!challenged) return res.status(404).json({ message: "Clan not found" });
  if (!challenger.clanId) return res.status(400).json({ message: "You must be in a clan" });
  const id             = "match_" + uuidv4().slice(0, 8);
  const challengerClan = DB.clans.get(challenger.clanId);
  const match = { id, clan1Id: challenger.clanId, clan2Id: challengedClanId, clan1: { id: challengerClan.id, name: challengerClan.name, tag: challengerClan.tag, captain: challenger.username, rank: challengerClan.rank }, clan2: { id: challenged.id, name: challenged.name, tag: challenged.tag, captain: challenged.captain, rank: challenged.rank }, status: "pending", currentRound: 1, mode: mode || "Mixed", map: "TBD", format: format || "Best of 5", division: "Elite", scheduledAt: scheduledAt || new Date().toISOString(), score: { clan1: 0, clan2: 0 }, winnerId: null, rounds: [], referee: null, endedAt: null };
  DB.matches.set(id, match);
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
  res.json({ threats: [
    { severity: "critical", description: "Multiple failed logins from IP 192.168.1.100", ip: "192.168.1.100" },
    { severity: "warning",  description: "Honeypot triggered 3 times",                   ip: "10.0.0.55"    },
    { severity: "info",     description: "New account registration spike",                ip: "—"            }
  ]});
});

app.get("/v1/security/flagged", requireAdmin, (req, res) => {
  res.json({ users: [
    { id: "user_flag_1", username: "SuspiciousPlayer", reason: "Multiple dispute filings" },
    { id: "user_flag_2", username: "AutoBot99",         reason: "Honeypot triggered"       }
  ]});
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
// HEALTH CHECK
// ============================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), users: DB.users.size });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║     JR7 COMMUNITY API SERVER             ║`);
  console.log(`║     Running on port ${PORT}                  ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Auth: token-based (cross-domain safe)   ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});
