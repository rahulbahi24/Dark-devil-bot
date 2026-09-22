const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8617505040:AAFaxlw_-q7wbAhyzn5W_cH15ckWSM2QOCI';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let waSock = null;

async function initWhatsApp(chatId, phoneNumber) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    waSock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    waSock.ev.on('creds.update', saveCreds);

    waSock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                bot.sendMessage(chatId, '🔄 WhatsApp reconnecting...');
                initWhatsApp(chatId, phoneNumber);
            } else {
                bot.sendMessage(chatId, '❌ WhatsApp logged out.');
            }
        } else if (connection === 'open') {
            bot.sendMessage(chatId, '✅ WhatsApp Bot সফলভাবে কানেক্ট হয়েছে! এখন যেকোনো গ্রুপে বটকে অ্যাড করে অ্যাডমিন বানিয়ে দিন।');
        }
    });

    // Anti-link Logic
    waSock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';

        if (isGroup && (text.includes('chat.whatsapp.com') || text.includes('http://') || text.includes('https://'))) {
            try {
                await waSock.sendMessage(from, { delete: m.key });
                await waSock.sendMessage(from, { text: '⚠️ গ্রুপে লিংক দেওয়া সম্পূর্ণ নিষেধ! মেসেজটি মুছে দেওয়া হলো।' });
            } catch (err) {
                console.error('Delete error (Ensure bot is group admin):', err);
            }
        }
    });

    // Generate pairing code
    if (!waSock.authState.creds.registered && phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await waSock.requestPairingCode(phoneNumber);
                bot.sendMessage(chatId, `📲 *আপনার WhatsApp Pairing Code:* \`${code}\`\n\n১. WhatsApp খুলুন -> Linked Devices\n২. Link a device -> "Link with phone number instead"-এ যান\n৩. এই কোডটি বসিয়ে দিন।`, { parse_mode: 'Markdown' });
            } catch (err) {
                bot.sendMessage(chatId, '⚠️ Pairing code তৈরি করতে সমস্যা হয়েছে। নম্বরটি কান্ট্রি কোড সহ (যেমন: 91XXXXXXXXXX) দিয়েছেন কিনা যাচাই করুন।');
            }
        }, 3000);
    }
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'স্বাগতম! আপনার WhatsApp নম্বরটি কান্ট্রি কোড সহ পাঠান (যেমন: 91XXXXXXXXXX) পেয়ারিং কোড পাওয়ার জন্য:');
});

bot.on('message', (msg) => {
    const text = msg.text?.trim();
    if (!text || text.startsWith('/')) return;

    const cleanedNumber = text.replace(/[^0-9]/g, '');
    if (cleanedNumber.length >= 10 && cleanedNumber.length <= 15) {
        bot.sendMessage(msg.chat.id, '⏳ Pairing code তৈরি হচ্ছে, কয়েক সেকেন্ড অপেক্ষা করুন...');
        initWhatsApp(msg.chat.id, cleanedNumber);
    }
});
