# Jr7 Community Backend

Ready-to-deploy Node.js backend for the Jr7 CDL Competitive Platform.

## Deploy to Railway

1. **Create new project** on [railway.app](https://railway.app)
2. **Upload this folder** (drag & drop or connect GitHub repo)
3. **Add environment variables** (see below)
4. **Deploy** — Railway auto-detects Node.js and runs `npm start`

## Environment Variables

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `PUSHER_APP_ID` | No | Pusher dashboard → App Keys |
| `PUSHER_KEY` | No | Pusher dashboard → App Keys |
| `PUSHER_SECRET` | No | Pusher dashboard → App Keys |
| `PUSHER_CLUSTER` | No | Pusher dashboard → App Keys (e.g. `us2`) |
| `DISCORD_CLIENT_ID` | No | discord.com/developers/applications |
| `DISCORD_CLIENT_SECRET` | No | Same as above |
| `DISCORD_BOT_TOKEN` | No | Same as above → Bot section |
| `DISCORD_GUILD_ID` | No | Right-click your Discord server → Copy Server ID |
| `CLOUDINARY_CLOUD_NAME` | No | cloudinary.com/console |
| `FRONTEND_URL` | **Yes** | Your frontend domain (e.g. `https://jr7community.vercel.app`) |
| `SESSION_SECRET` | **Yes** | Any random string, 32+ characters |
| `ADMIN_DISCORD_IDS` | No | Comma-separated Discord user IDs of admins |

## API Endpoints

All endpoints are prefixed with `/v1/`:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/auth/register` | POST | None | Email registration |
| `/v1/auth/login` | POST | None | Email login |
| `/v1/auth/logout` | POST | Cookie | Logout |
| `/v1/auth/session` | GET | Cookie | Get current session |
| `/v1/users/:id` | GET | None | User profile |
| `/v1/users/:id/stats` | GET | Cookie | Full stats |
| `/v1/users/leaderboard` | GET | None | Rankings |
| `/v1/clans` | GET | None | List clans |
| `/v1/clans/:id` | GET | None | Clan detail |
| `/v1/clans/create` | POST | Cookie | Create clan |
| `/v1/matches` | GET | None | Recent matches |
| `/v1/matches/:id` | GET | Cookie | Match detail |
| `/v1/tournaments` | GET | None | Tournaments |
| `/v1/news` | GET | None | News articles |
| `/v1/stats/overview` | GET | None | Homepage stats |
| `/v1/api/pusher/auth` | POST | Cookie | Pusher private channel auth |
| `/v1/admin/security` | GET | Admin | Admin dashboard |
| `/health` | GET | None | Health check |

## Important: Update Frontend Config

After deploying, copy your Railway URL (e.g. `https://jr7-api.up.railway.app`) and paste it into your frontend `config.js`:

```javascript
api: {
  baseUrl: "https://jr7-api.up.railway.app/v1"
}
```

## Database Note

This server uses **in-memory storage** (data resets on restart). For production:

1. Add PostgreSQL to your Railway project
2. Replace `DB.users`, `DB.clans`, `DB.matches` with actual database queries
3. The API response shapes stay exactly the same
