const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://jr7.netlify.app' }));

// Boot the Discord bot
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
bot.login(process.env.BOT_TOKEN);

bot.once('ready', () => {
  console.log(`Bot ready: ${bot.user.tag}`);
});

// Health check
app.get('/', (req, res) => res.send('JR7 backend live'));

// Called when someone clicks Accept on the website
app.post('/accept', async (req, res) => {
  const { challengerDiscordId, challengeId, challengeText, accepterName } = req.body;

  if (!challengerDiscordId) {
    return res.status(400).json({ error: 'No Discord ID provided' });
  }

  try {
    const user = await bot.users.fetch(challengerDiscordId);
    await user.send(
      `⚔️ **Challenge #${challengeId} — Someone wants to accept!**\n\n` +
      `Your challenge: **${challengeText}**\n` +
      `Accepted by: **${accepterName}**\n\n` +
      `Reply **yes** to confirm or **no** to decline.`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not DM user. Are DMs enabled?' });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
