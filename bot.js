import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { runBypass } from './bypass.js';
import dotenv from 'dotenv';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Register slash command
const commands = [
  new SlashCommandBuilder()
    .setName('bypass')
    .setDescription('Bypass a platoboost / loot link URL')
    .addStringOption(option =>
      option.setName('url')
        .setRequired(true)
        .setDescription('The URL to bypass')
    )
    .addStringOption(option =>
      option.setName('loot_result')
        .setRequired(false)
        .setDescription('Optional pre‑obtained ticket2 URL (manual paste)')
    ),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

try {
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(cmd => cmd.toJSON()) });
  console.log('Slash commands registered.');
} catch (error) {
  console.error(error);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'bypass') return;

  const url = interaction.options.getString('url');
  const lootResult = interaction.options.getString('loot_result') || undefined;

  await interaction.deferReply();

  const logMessages = [];
  const sendLog = (msg) => {
    console.log(msg);
    logMessages.push(msg);
    if (logMessages.length > 10) logMessages.shift();
    if (logMessages.length % 3 === 0 || msg.includes('Bypass hoàn tất')) {
      const content = `**Bypassing...**\n\`\`\`\n${logMessages.join('\n')}\n\`\`\``;
      interaction.editReply(content).catch(() => {});
    }
  };

  try {
    const result = await runBypass(url, sendLog, lootResult);

    let finalMessage = `**Result:** ${result.success ? '✅ Success' : '❌ Failed'}\n`;
    if (result.success) {
      finalMessage += `**Key:** \`${result.key || 'N/A'}\``;
    } else {
      finalMessage += `**Error:** ${result.error || 'Unknown error'}`;
    }

    const logText = logMessages.join('\n');
    const fullResponse = `${finalMessage}\n\n**Log:**\n\`\`\`\n${logText}\n\`\`\``;

    if (fullResponse.length > 2000) {
      const shortLog = logText.slice(-1800);
      const truncated = `${finalMessage}\n\n**Log (last 1800 chars):**\n\`\`\`\n${shortLog}\n\`\`\``;
      await interaction.editReply(truncated);
    } else {
      await interaction.editReply(fullResponse);
    }
  } catch (error) {
    console.error(error);
    await interaction.editReply(`❌ An error occurred: ${error.message}`);
  }
});

client.login(TOKEN);
