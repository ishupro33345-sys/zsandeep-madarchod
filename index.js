const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
require("dotenv").config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error("ERROR: DISCORD_BOT_TOKEN not set."); process.exit(1); }

// Only these two users may run any slash command
const ALLOWED_USER_IDS = new Set(["1507743274407034993", "1294922262348300378"]);

const ACTIVITY_TYPE_MAP = {
  listening: ActivityType.Listening,
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
};

const DEFAULT_STATUS_TEXT = "Bedfight Tournament Live Till 1 July 2026";
const DEFAULT_STATUS_TYPE = ActivityType.Listening;
const currentActivity = { text: DEFAULT_STATUS_TEXT, type: DEFAULT_STATUS_TYPE };

const MUTE_CHANNEL_ID = "1516470489126670416";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MUTE_CHANNEL_WARNING =
  "# DO NOT CHAT HERE\n" +
  "This channel's sole purpose is to mute spam/hacked accounts, **DO NOT CHAT HERE** or you will be assumed hacked and be **instantly getting a 1-day timeout**.";

const starboardConfig = new Map();
const starredMessages = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("setstatus").setDescription("Update the bot activity status")
    .addStringOption((opt) => opt.setName("text").setDescription("Status text").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("type").setDescription("Activity type (default: Listening)").setRequired(false)
        .addChoices(
          { name: "Listening", value: "listening" }, { name: "Playing", value: "playing" },
          { name: "Watching", value: "watching" }, { name: "Competing", value: "competing" }
        )
    ).toJSON(),
  new SlashCommandBuilder().setName("resetstatus").setDescription("Reset bot status to default").toJSON(),
  new SlashCommandBuilder()
    .setName("message").setDescription("Make the bot post a message to a channel")
    .addStringOption((opt) => opt.setName("content").setDescription("The message, link, image or GIF URL").setRequired(true))
    .addChannelOption((opt) =>
      opt.setName("channel").setDescription("Channel to post in (defaults to this channel)")
        .addChannelTypes(ChannelType.GuildText).setRequired(false)
    ).toJSON(),
  new SlashCommandBuilder()
    .setName("dm").setDescription("Send a private DM to any user")
    .addUserOption((opt) => opt.setName("user").setDescription("The user to DM").setRequired(true))
    .addStringOption((opt) => opt.setName("message").setDescription("The message to send").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("starboard").setDescription("Set up a starboard")
    .addChannelOption((opt) =>
      opt.setName("channel").setDescription("Channel where starred messages will be posted")
        .addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .addStringOption((opt) => opt.setName("emoji").setDescription("The emoji that triggers the starboard (e.g. ⭐)").setRequired(true))
    .toJSON(),
];

async function safeReply(interaction, content) {
  if (interaction.replied || interaction.deferred) return;
  await interaction.reply({ content, flags: 64 }).catch(() => {});
}

async function registerCommands(clientId) {
  const rest = new REST().setToken(TOKEN);
  try { await rest.put(Routes.applicationCommands(clientId), { body: commands }); console.log("[OK] Commands registered"); }
  catch (err) { console.error("[ERR] Commands:", err.message); }
}

function applyPresence(client) {
  client.user?.setPresence({ status: "online", activities: [{ name: currentActivity.text, type: currentActivity.type }] });
}

async function ensureMuteChannelWarning(client) {
  try {
    const channel = await client.channels.fetch(MUTE_CHANNEL_ID);
    if (!channel) return;
    const recent = await channel.messages.fetch({ limit: 10 });
    const alreadyPosted = recent.some((m) => m.author.id === client.user.id && m.content.includes("DO NOT CHAT HERE"));
    if (!alreadyPosted) { await channel.send(MUTE_CHANNEL_WARNING); console.log("[OK] Posted mute channel warning"); }
  } catch (err) { console.error("[ERR] Mute channel warning:", err.message); }
}

async function handleMuteChannelMessage(message) {
  if (message.author.bot) return;
  if (message.channelId !== MUTE_CHANNEL_ID) return;
  const member = message.member;
  if (!member) return;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return;
  await message.delete().catch(() => {});
  try { await member.timeout(ONE_DAY_MS, "Sent a message in the mute channel"); }
  catch (err) { console.error("[ERR] Timeout failed:", err.message); return; }
  console.log(`[OK] Muted ${message.author.tag} for 1 day`);
  try { const dm = await message.author.createDM(); await dm.send(`You are muted from Zeqa Bedfight Tiers because of messaging in <#${MUTE_CHANNEL_ID}>`); }
  catch { /* DMs disabled */ }
  try {
    const members = await message.guild.members.fetch();
    const admins = members.filter((m) => !m.user.bot && m.permissions.has(PermissionFlagsBits.Administrator));
    for (const [, admin] of admins) {
      try { const dm = await admin.createDM(); await dm.send(`⚠️ **${message.author.tag}** (\`${member.id}\`) was muted for **1 day** for chatting in <#${MUTE_CHANNEL_ID}>.`); }
      catch { /* admin DMs disabled */ }
    }
  } catch (err) { console.error("[ERR] Admin DMs:", err.message); }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("clientReady", async (c) => {
  console.log(`[OK] Logged in as ${c.user.tag}`);
  applyPresence(client);
  setInterval(() => applyPresence(client), 30_000);
  await registerCommands(c.user.id);
  await ensureMuteChannelWarning(client);
});

client.on("shardResume", () => applyPresence(client));
client.on("error", (err) => console.error("[ERR] Client:", err.message));
process.on("unhandledRejection", (err) => console.error("[ERR] Unhandled:", err?.message ?? err));

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!ALLOWED_USER_IDS.has(interaction.user.id)) {
    await safeReply(interaction, "❌ You are not authorized to use this command.");
    return;
  }

  try {
    if (interaction.commandName === "setstatus") {
      const text = interaction.options.getString("text", true);
      const typeKey = interaction.options.getString("type") ?? "listening";
      currentActivity.text = text;
      currentActivity.type = ACTIVITY_TYPE_MAP[typeKey] ?? ActivityType.Listening;
      applyPresence(client);
      await safeReply(interaction, `✅ Status → **${typeKey.charAt(0).toUpperCase()+typeKey.slice(1)}**: **${text}**`);
    }
    else if (interaction.commandName === "resetstatus") {
      currentActivity.text = DEFAULT_STATUS_TEXT;
      currentActivity.type = DEFAULT_STATUS_TYPE;
      applyPresence(client);
      await safeReply(interaction, `✅ Status reset to: **Listening** → **${DEFAULT_STATUS_TEXT}**`);
    }
    else if (interaction.commandName === "message") {
      const content = interaction.options.getString("content", true);
      const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
      try { await targetChannel.send(content); await safeReply(interaction, `✅ Message posted in <#${targetChannel.id}>`); }
      catch { await safeReply(interaction, "❌ Failed — check bot permissions in that channel."); }
    }
    else if (interaction.commandName === "dm") {
      const targetUser = interaction.options.getUser("user", true);
      const msg = interaction.options.getString("message", true);
      if (targetUser.bot) { await safeReply(interaction, "❌ Cannot DM a bot."); return; }
      try { const dm = await targetUser.createDM(); await dm.send(msg); await safeReply(interaction, `✅ DM sent to **${targetUser.tag}**`); }
      catch { await safeReply(interaction, `❌ Could not DM **${targetUser.tag}** — DMs may be disabled.`); }
    }
    else if (interaction.commandName === "starboard") {
      const channel = interaction.options.getChannel("channel", true);
      const emoji = interaction.options.getString("emoji", true).trim();
      const guildId = interaction.guildId;
      starboardConfig.set(guildId, { channelId: channel.id, emoji });
      if (!starredMessages.has(guildId)) starredMessages.set(guildId, new Set());
      await safeReply(interaction, `✅ Starboard set!\n📌 <#${channel.id}>\n${emoji} Admins react with **${emoji}** to pin.`);
    }
  } catch (err) {
    console.error("[ERR] interaction handler:", err.message);
    await safeReply(interaction, "❌ An unexpected error occurred.");
  }
});

client.on("messageCreate", async (message) => {
  try { await handleMuteChannelMessage(message); } catch (err) { console.error("[ERR] mute handler:", err.message); }
});

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) user = await user.fetch();
    if (user.bot) return;
    const guildId = reaction.message.guildId;
    if (!guildId) return;
    const config = starboardConfig.get(guildId);
    if (!config) return;
    const emojiMatch = reaction.emoji.name === config.emoji || reaction.emoji.toString() === config.emoji;
    if (!emojiMatch) return;
    const member = await reaction.message.guild?.members.fetch(user.id).catch(() => null);
    if (!member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const starred = starredMessages.get(guildId);
    if (starred.has(reaction.message.id)) return;
    starred.add(reaction.message.id);
    const message = reaction.message;
    const starChannel = reaction.message.guild?.channels.cache.get(config.channelId);
    if (!starChannel?.send) return;
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setAuthor({ name: message.author?.tag ?? "Unknown", iconURL: message.author?.displayAvatarURL() })
      .setDescription(message.content || null)
      .addFields({ name: "Original", value: `[Jump to message](${message.url})` })
      .setTimestamp(message.createdAt);
    const image = message.attachments.find((a) => a.contentType?.startsWith("image/"));
    if (image) embed.setImage(image.url);
    await starChannel.send({ content: `${config.emoji} **${reaction.count ?? 1}** | <#${message.channelId}>`, embeds: [embed] });
  } catch (err) { console.error("[ERR] reaction:", err.message); }
});

client.login(TOKEN).catch((err) => { console.error("[ERR] Login:", err.message); process.exit(1); });
