require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const axios = require('axios');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// ---------- Twilio ----------
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// ---------- Middleware ----------
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(express.static('public'));

// ---------- Data directories ----------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const USERS_DIR = path.join(DATA_DIR, 'users');
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR);
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');
if (!fs.existsSync(MESSAGES_DIR)) fs.mkdirSync(MESSAGES_DIR);
const GROUP_MESSAGES_DIR = path.join(DATA_DIR, 'group_messages');
if (!fs.existsSync(GROUP_MESSAGES_DIR)) fs.mkdirSync(GROUP_MESSAGES_DIR);
const CHANNEL_MESSAGES_DIR = path.join(DATA_DIR, 'channel_messages');
if (!fs.existsSync(CHANNEL_MESSAGES_DIR)) fs.mkdirSync(CHANNEL_MESSAGES_DIR);

// ---------- Session persistence ----------
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessions = {};
function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        } else {
            sessions = {};
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
        }
    } catch (e) { sessions = {}; }
}
function saveSessions() {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}
loadSessions();

// ---------- Helpers ----------
function genId() { return crypto.randomBytes(8).toString('hex'); }
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function cleanPhone(phone) { return phone.replace(/[\s\-\(\)]/g, ''); }
function getChatId(user1, user2) {
    return [user1, user2].sort().join('_');
}

function getUserFilePath(phone) {
    return path.join(USERS_DIR, `${phone}.json`);
}
function loadUser(phone) {
    const file = getUserFilePath(phone);
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { return null; }
    }
    return null;
}
function saveUser(phone, data) {
    const file = getUserFilePath(phone);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return data;
}

function getMessageFilePath(chatId) {
    return path.join(MESSAGES_DIR, `${chatId}.json`);
}
function loadMessages(chatId) {
    const file = getMessageFilePath(chatId);
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { return []; }
    }
    return [];
}
function saveMessages(chatId, msgs) {
    const file = getMessageFilePath(chatId);
    fs.writeFileSync(file, JSON.stringify(msgs, null, 2));
}

function getGroupMessageFilePath(groupId) {
    return path.join(GROUP_MESSAGES_DIR, `${groupId}.json`);
}
function loadGroupMessages(groupId) {
    const file = getGroupMessageFilePath(groupId);
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { return []; }
    }
    return [];
}
function saveGroupMessages(groupId, msgs) {
    const file = getGroupMessageFilePath(groupId);
    fs.writeFileSync(file, JSON.stringify(msgs, null, 2));
}

function getChannelMessageFilePath(channelId) {
    return path.join(CHANNEL_MESSAGES_DIR, `${channelId}.json`);
}
function loadChannelMessages(channelId) {
    const file = getChannelMessageFilePath(channelId);
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { return []; }
    }
    return [];
}
function saveChannelMessages(channelId, msgs) {
    const file = getChannelMessageFilePath(channelId);
    fs.writeFileSync(file, JSON.stringify(msgs, null, 2));
}

// ---------- Groups file ----------
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
let groups = {};
function loadGroups() {
    try {
        if (fs.existsSync(GROUPS_FILE)) {
            groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
        } else {
            groups = {};
            fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
        }
    } catch (e) { groups = {}; }
}
function saveGroups() { fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2)); }
loadGroups();

// ---------- Channels file ----------
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
let channels = {};
function loadChannels() {
    try {
        if (fs.existsSync(CHANNELS_FILE)) {
            channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
        } else {
            channels = {};
            fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
        }
    } catch (e) { channels = {}; }
}
function saveChannels() { fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2)); }
loadChannels();

// ---------- Statuses file ----------
const STATUS_FILE = path.join(DATA_DIR, 'statuses.json');
let statuses = [];
function loadStatuses() {
    try {
        if (fs.existsSync(STATUS_FILE)) {
            statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        } else {
            statuses = [];
            fs.writeFileSync(STATUS_FILE, JSON.stringify(statuses, null, 2));
        }
    } catch (e) { statuses = []; }
}
function saveStatuses() { fs.writeFileSync(STATUS_FILE, JSON.stringify(statuses, null, 2)); }
loadStatuses();

// ---------- Stickers file ----------
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');
let stickers = {};
function loadStickers() {
    try {
        if (fs.existsSync(STICKERS_FILE)) {
            stickers = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'));
        } else {
            stickers = {};
            fs.writeFileSync(STICKERS_FILE, JSON.stringify(stickers, null, 2));
        }
    } catch (e) { stickers = {}; }
}
function saveStickers() { fs.writeFileSync(STICKERS_FILE, JSON.stringify(stickers, null, 2)); }
loadStickers();

// ---------- In-memory ----------
const otpStore = {};   // phone -> otp
const reports = [];
const bannedWords = ['stupid', 'idiot', 'badword'];
const scheduledMessages = [];

// ---------- SMS sender ----------
function sendSMS(phone, message) {
    const cleanPhoneNumber = cleanPhone(phone);
    client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE,
        to: cleanPhoneNumber
    })
    .then(msg => console.log(`[SMS] Sent to ${cleanPhoneNumber}: ${msg.sid}`))
    .catch(err => console.error('[SMS] Error:', err));
}

// ---------- Voice Call OTP ----------
function callWithOTP(phone, otp) {
    const cleanPhoneNumber = cleanPhone(phone);
    client.calls.create({
        twiml: `<Response><Say voice="alice">Your NEXORA CHQT verification code is. ${otp.split('').join('. ')}. Repeat. ${otp.split('').join('. ')}.</Say></Response>`,
        to: cleanPhoneNumber,
        from: process.env.TWILIO_PHONE
    })
    .then(call => console.log(`[Voice OTP] Called ${cleanPhoneNumber}: ${call.sid}`))
    .catch(err => console.error('[Voice OTP] Error:', err));
}

// ---------- OTP ----------
app.post('/api/request-otp', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const cleanPhoneNumber = cleanPhone(phone);
    const otp = generateOTP();
    otpStore[cleanPhoneNumber] = otp;
    console.log(`[OTP] ${cleanPhoneNumber} -> ${otp}`);

    // Check if user already has an active session
    let existingSession = null;
    for (const [token, sessionPhone] of Object.entries(sessions)) {
        if (sessionPhone === cleanPhoneNumber) {
            existingSession = token;
            break;
        }
    }

    // If already logged in on another device → send OTP via chat message
    if (existingSession) {
        const chatId = getChatId(cleanPhoneNumber, 'system');
        let messages = loadMessages(chatId);
        const message = {
            id: genId(),
            sender: 'system',
            text: `🔐 Your OTP for login on a new device is: ${otp}`,
            type: 'text',
            timestamp: new Date().toISOString()
        };
        messages.push(message);
        saveMessages(chatId, messages);
        io.to(cleanPhoneNumber).emit('system-message', { message });
        return res.json({ success: true, sentVia: 'chat' });
    }

    // New login → send SMS and/or voice call
    try {
        sendSMS(cleanPhoneNumber, `Your NEXORA CHQT OTP is: ${otp}`);
        res.json({ success: true, otp, sentVia: 'sms' });
    } catch(err) {
        console.error('SMS error:', err);
        callWithOTP(cleanPhoneNumber, otp);
        res.json({ success: true, otp, sentVia: 'voice' });
    }
});

app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Missing data' });
    const cleanPhoneNumber = cleanPhone(phone);
    if (otpStore[cleanPhoneNumber] && otpStore[cleanPhoneNumber] === otp) {
        const token = crypto.randomBytes(16).toString('hex');
        sessions[token] = cleanPhoneNumber;
        saveSessions();
        const user = loadUser(cleanPhoneNumber);
        res.json({ success: true, token, user });
    } else {
        res.status(401).json({ success: false, error: 'Invalid OTP' });
    }
});

// ---------- Profile ----------
app.post('/api/complete-profile', (req, res) => {
    const { token, displayName, username, email, avatar } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    let user = loadUser(phone);
    if (user) return res.json({ success: true, user });
    user = {
        phone,
        displayName: displayName || 'User',
        username: username || phone,
        email: email || '',
        avatar: avatar || '',
        premium: false,
        coins: 0,
        createdAt: new Date().toISOString(),
        banned: false,
        warnings: 0,
        settings: {
            darkMode: false,
            accentColor: '#14C37A',
            fontSize: 'medium',
            wallpaper: null,
            privacy: {
                lastSeen: 'everyone',
                profilePhoto: 'everyone',
                about: 'everyone',
                readReceipts: true,
                onlineStatus: true,
                statusVisibility: 'everyone',
                groupInvite: 'everyone',
                whoCanCall: 'everyone'
            },
            notifications: {
                messages: true,
                groups: true,
                calls: true,
                channels: true,
                sound: true,
                vibration: true,
                popup: true,
                badge: true
            },
            chats: {
                theme: 'dark',
                fontSize: 'medium',
                bubbleStyle: 'sharp',
                enterSends: true,
                messageAnimations: true
            },
            calls: {
                hdVoice: true,
                noiseCancellation: true,
                echoCancellation: true,
                hdVideo: true,
                lowDataMode: false,
                callWaiting: true
            },
            security: {
                pinLock: false,
                fingerprintLock: false,
                faceUnlock: false,
                twoFactor: false,
                loginAlerts: false
            }
        }
    };
    saveUser(phone, user);
    res.json({ success: true, user });
});

app.post('/api/me', (req, res) => {
    const { token } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const user = loadUser(phone);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ success: true, user });
});

app.post('/api/update-profile', (req, res) => {
    const { token, updates } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    let user = loadUser(phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    Object.keys(updates).forEach(key => {
        if (key === 'settings' && typeof updates.settings === 'object') {
            Object.keys(updates.settings).forEach(settingKey => {
                if (typeof updates.settings[settingKey] === 'object') {
                    user.settings[settingKey] = { ...user.settings[settingKey], ...updates.settings[settingKey] };
                } else {
                    user.settings[settingKey] = updates.settings[settingKey];
                }
            });
        } else {
            user[key] = updates[key];
        }
    });
    saveUser(phone, user);
    res.json({ success: true, user });
});

// ---------- Private Messaging ----------
app.post('/api/send-message', (req, res) => {
    const { token, to, text, type, file, fileName, viewOnce } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const receiver = loadUser(to);
    if (receiver && receiver.blocked && receiver.blocked.includes(phone)) {
        return res.status(403).json({ error: 'You are blocked by this user' });
    }
    if (text) {
        const bad = bannedWords.some(w => text.toLowerCase().includes(w));
        if (bad) {
            const sender = loadUser(phone);
            if (sender) {
                sender.warnings = (sender.warnings || 0) + 1;
                if (sender.warnings >= 3) {
                    sender.banned = true;
                    saveUser(phone, sender);
                    return res.status(403).json({ error: 'Account banned for abusive language' });
                }
                saveUser(phone, sender);
            }
        }
    }
    const chatId = getChatId(phone, to);
    const messages = loadMessages(chatId);
    const message = {
        id: genId(),
        sender: phone,
        text: text || '',
        type: type || 'text',
        file: file || null,
        fileName: fileName || null,
        timestamp: new Date().toISOString(),
        viewOnce: viewOnce || false
    };
    messages.push(message);
    saveMessages(chatId, messages);
    io.to(phone).emit('new-message', { chatId, message });
    io.to(to).emit('new-message', { chatId, message });
    // Push notification
    sendPushNotification(to, `${loadUser(phone)?.displayName || 'Someone'}`, text || 'New message', `/chat.html?phone=${phone}`);
    res.json({ success: true, message });
});

app.post('/api/get-messages', (req, res) => {
    const { token, withUser, since } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const chatId = getChatId(phone, withUser);
    let messages = loadMessages(chatId);
    if (since) {
        const sinceTime = new Date(since).getTime();
        messages = messages.filter(m => new Date(m.timestamp).getTime() > sinceTime);
    }
    res.json({ success: true, messages });
});

// ---------- Message Reactions (Private) ----------
app.post('/api/message-react', (req, res) => {
    const { token, chatId, messageId, reaction } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const messages = loadMessages(chatId);
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (!msg.reactions) msg.reactions = [];
    const existing = msg.reactions.find(r => r.phone === phone);
    if (existing) {
        if (reaction) existing.reaction = reaction;
        else msg.reactions = msg.reactions.filter(r => r.phone !== phone);
    } else {
        if (reaction) msg.reactions.push({ phone, reaction });
    }
    saveMessages(chatId, messages);
    const [user1, user2] = chatId.split('_');
    io.to(user1).emit('reaction-updated', { chatId, messageId, reactions: msg.reactions });
    io.to(user2).emit('reaction-updated', { chatId, messageId, reactions: msg.reactions });
    res.json({ success: true, reactions: msg.reactions });
});

// ---------- Edit Message (Private) ----------
app.post('/api/edit-message', (req, res) => {
    const { token, chatId, messageId, newText } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const messages = loadMessages(chatId);
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== phone) return res.status(403).json({ error: 'Not your message' });
    msg.text = newText;
    msg.edited = true;
    saveMessages(chatId, messages);
    const [user1, user2] = chatId.split('_');
    io.to(user1).emit('message-edited', { chatId, messageId, newText });
    io.to(user2).emit('message-edited', { chatId, messageId, newText });
    res.json({ success: true });
});

// ---------- Delete Message (Private) ----------
app.post('/api/delete-message', (req, res) => {
    const { token, chatId, messageId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const messages = loadMessages(chatId);
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });
    const msg = messages[idx];
    if (msg.sender !== phone) return res.status(403).json({ error: 'Not your message' });
    messages.splice(idx, 1);
    saveMessages(chatId, messages);
    const [user1, user2] = chatId.split('_');
    io.to(user1).emit('message-deleted', { chatId, messageId });
    io.to(user2).emit('message-deleted', { chatId, messageId });
    res.json({ success: true });
});

// ---------- FORWARD MESSAGE ----------
app.post('/api/forward-message', (req, res) => {
    const { token, to, messageId, chatId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const messages = loadMessages(chatId);
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    const forwarded = {
        id: genId(),
        sender: phone,
        text: msg.text,
        type: msg.type,
        file: msg.file,
        fileName: msg.fileName,
        timestamp: new Date().toISOString(),
        forwarded: true,
        originalSender: msg.sender
    };
    const targetChatId = getChatId(phone, to);
    const targetMessages = loadMessages(targetChatId);
    targetMessages.push(forwarded);
    saveMessages(targetChatId, targetMessages);
    io.to(phone).emit('new-message', { chatId: targetChatId, message: forwarded });
    io.to(to).emit('new-message', { chatId: targetChatId, message: forwarded });
    res.json({ success: true });
});

// ---------- VIEW ONCE MEDIA ----------
app.post('/api/view-once', (req, res) => {
    const { token, chatId, messageId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const messages = loadMessages(chatId);
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (!msg.viewOnce) return res.status(400).json({ error: 'Not a view-once message' });
    const fileData = msg.file;
    msg.file = null;
    msg.text = '📷 View Once media (expired)';
    msg.type = 'text';
    msg.viewOnce = false;
    saveMessages(chatId, messages);
    res.json({ success: true, file: fileData });
});

// ---------- MESSAGE SCHEDULER ----------
app.post('/api/schedule-message', (req, res) => {
    const { token, to, text, scheduledAt } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    scheduledMessages.push({
        id: genId(),
        from: phone,
        to,
        text,
        scheduledAt: new Date(scheduledAt).getTime()
    });
    res.json({ success: true });
});

app.post('/api/check-scheduled', (req, res) => {
    const { token } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const now = Date.now();
    const due = scheduledMessages.filter(m => m.from === phone && m.scheduledAt <= now);
    scheduledMessages = scheduledMessages.filter(m => m.from !== phone || m.scheduledAt > now);
    res.json({ messages: due });
});

// ---------- SMART REPLY ----------
app.post('/api/smart-reply', (req, res) => {
    const { token, message } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const replies = [
        "That's interesting! Tell me more.",
        "I see. What do you think?",
        "Okay, noted.",
        "Sure, I'll get back to you.",
        "Can you elaborate?",
        "That's a great question.",
        "Let me think about that.",
        "I agree with you.",
        "That's a good point.",
        "I'll check and confirm."
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    res.json({ reply });
});

// ---------- Block ----------
app.post('/api/block-user', (req, res) => {
    const { token, blockPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    let user = loadUser(phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.blocked) user.blocked = [];
    if (!user.blocked.includes(blockPhone)) {
        user.blocked.push(blockPhone);
        saveUser(phone, user);
    }
    res.json({ success: true });
});

app.post('/api/unblock-user', (req, res) => {
    const { token, blockPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    let user = loadUser(phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.blocked) {
        user.blocked = user.blocked.filter(p => p !== blockPhone);
        saveUser(phone, user);
    }
    res.json({ success: true });
});

// ---------- Reports ----------
app.post('/api/report', (req, res) => {
    const { token, target, targetId, reason } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    reports.push({
        reportedBy: phone,
        target,
        targetId,
        reason: reason || 'No reason',
        timestamp: new Date().toISOString()
    });
    res.json({ success: true });
});

app.get('/api/reports', (req, res) => {
    res.json(reports);
});

// ---------- User lookup ----------
app.post('/api/user-by-phone', (req, res) => {
    const { phone } = req.body;
    const user = loadUser(phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: {
        phone: user.phone,
        displayName: user.displayName,
        username: user.username,
        avatar: user.avatar,
        createdAt: user.createdAt,
        premium: user.premium,
        banned: user.banned,
        bio: user.bio || 'No bio'
    }});
});

app.get('/api/users', (req, res) => {
    const files = fs.readdirSync(USERS_DIR);
    const list = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf8'));
        return {
            phone: data.phone,
            displayName: data.displayName,
            username: data.username,
            avatar: data.avatar,
            banned: data.banned,
            warnings: data.warnings || 0,
            premium: data.premium || false
        };
    });
    res.json(list);
});

// ---------- Admin ----------
app.post('/api/admin/ban-user', (req, res) => {
    const { token, banPhone, permanent } = req.body;
    const phone = sessions[token];
    if (phone !== '+2348123909919') return res.status(403).json({ error: 'Not admin' });
    let user = loadUser(banPhone);
    if (user) {
        user.banned = true;
        if (permanent) user.bannedPermanent = true;
        saveUser(banPhone, user);
    }
    res.json({ success: true });
});

app.post('/api/admin/unban-user', (req, res) => {
    const { token, banPhone } = req.body;
    const phone = sessions[token];
    if (phone !== '+2348123909919') return res.status(403).json({ error: 'Not admin' });
    let user = loadUser(banPhone);
    if (user) {
        user.banned = false;
        user.bannedPermanent = false;
        user.warnings = 0;
        saveUser(banPhone, user);
    }
    res.json({ success: true });
});

app.get('/api/admin/users', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const phone = sessions[token];
    if (phone !== '+2348123909919') return res.status(403).json({ error: 'Not admin' });
    const files = fs.readdirSync(USERS_DIR);
    const list = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf8'));
        return {
            phone: data.phone,
            displayName: data.displayName,
            username: data.username,
            avatar: data.avatar,
            banned: data.banned,
            warnings: data.warnings || 0,
            premium: data.premium || false,
            createdAt: data.createdAt
        };
    });
    res.json(list);
});

// ---------- GROUPS ----------
app.post('/api/create-group', (req, res) => {
    const { token, name, members, avatar } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const groupId = genId();
    const user = loadUser(phone);
    const displayName = user ? user.displayName : phone;
    groups[groupId] = {
        id: groupId,
        name: name || 'Group',
        owner: phone,
        admin: phone,
        description: '',
        members: [{ phone, displayName, role: 'owner' }],
        avatar: avatar || null,
        link: `https://${req.get('host')}/join-group.html?id=${groupId}`,
        createdAt: new Date().toISOString(),
        permissions: {
            sendMessages: true,
            sendMedia: true,
            sendLinks: true,
            addMembers: true,
            editGroupInfo: true
        },
        type: 'public',
        topicsEnabled: false,
        reactionsEnabled: true
    };
    saveGroups();
    res.json({ success: true, groupId });
});

app.post('/api/my-groups', (req, res) => {
    const { token } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const myGroups = Object.values(groups).filter(g => g.members.some(m => m.phone === phone));
    res.json({ success: true, groups: myGroups });
});

app.get('/api/group/:groupId', (req, res) => {
    const { groupId } = req.params;
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    group.members.forEach(m => { if (!m.role) m.role = 'member'; });
    res.json({ success: true, group });
});

app.post('/api/update-group', (req, res) => {
    const { token, groupId, name, description, avatar, type, topicsEnabled, reactionsEnabled } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin !== phone && group.owner !== phone) {
        return res.status(403).json({ error: 'Only admins can edit' });
    }
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (avatar) group.avatar = avatar;
    if (type) group.type = type;
    if (topicsEnabled !== undefined) group.topicsEnabled = topicsEnabled;
    if (reactionsEnabled !== undefined) group.reactionsEnabled = reactionsEnabled;
    saveGroups();
    res.json({ success: true });
});

app.post('/api/promote-admin', (req, res) => {
    const { token, groupId, phone: targetPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.owner !== phone) return res.status(403).json({ error: 'Only owner can promote' });
    const member = group.members.find(m => m.phone === targetPhone);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'owner') return res.status(400).json({ error: 'Cannot demote owner' });
    member.role = 'admin';
    saveGroups();
    res.json({ success: true });
});

app.post('/api/demote-admin', (req, res) => {
    const { token, groupId, phone: targetPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.owner !== phone) return res.status(403).json({ error: 'Only owner can demote' });
    const member = group.members.find(m => m.phone === targetPhone);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'owner') return res.status(400).json({ error: 'Cannot demote owner' });
    member.role = 'member';
    saveGroups();
    res.json({ success: true });
});

app.post('/api/kick-member', (req, res) => {
    const { token, groupId, phone: targetPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin !== phone && group.owner !== phone) return res.status(403).json({ error: 'Not admin' });
    const member = group.members.find(m => m.phone === targetPhone);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'owner') return res.status(400).json({ error: 'Cannot remove owner' });
    group.members = group.members.filter(m => m.phone !== targetPhone);
    saveGroups();
    res.json({ success: true });
});

app.post('/api/exit-group', (req, res) => {
    const { token, groupId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    group.members = group.members.filter(m => m.phone !== phone);
    if (group.owner === phone) {
        const newOwner = group.members.find(m => m.role === 'admin') || group.members[0];
        if (newOwner) {
            group.owner = newOwner.phone;
            newOwner.role = 'owner';
            group.admin = newOwner.phone;
        } else {
            delete groups[groupId];
            saveGroups();
            return res.json({ success: true });
        }
    }
    saveGroups();
    res.json({ success: true });
});

app.post('/api/update-group-permissions', (req, res) => {
    const { token, groupId, permissions } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.admin !== phone && group.owner !== phone) return res.status(403).json({ error: 'Not admin' });
    if (!group.permissions) group.permissions = {};
    Object.assign(group.permissions, permissions);
    saveGroups();
    res.json({ success: true });
});

// ---------- Join Group via Link ----------
app.post('/api/join-group', (req, res) => {
    const { token, groupId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.members.some(m => m.phone === phone)) {
        return res.json({ success: true, alreadyMember: true });
    }
    const user = loadUser(phone);
    group.members.push({ phone, displayName: user?.displayName || phone, role: 'member' });
    saveGroups();
    res.json({ success: true });
});

// ---------- Group Messaging ----------
app.post('/api/send-group-message', (req, res) => {
    const { token, groupId, text, type, file, fileName, viewOnce } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m.phone === phone)) {
        return res.status(403).json({ error: 'You are not a member' });
    }
    const isAdmin = group.admin === phone || group.owner === phone;
    if (group.permissions && group.permissions.sendMessages === false && !isAdmin) {
        return res.status(403).json({ error: 'You cannot send messages in this group' });
    }
    const messages = loadGroupMessages(groupId);
    const message = {
        id: genId(),
        sender: phone,
        senderName: group.members.find(m => m.phone === phone)?.displayName || phone,
        text: text || '',
        type: type || 'text',
        file: file || null,
        fileName: fileName || null,
        timestamp: new Date().toISOString(),
        viewOnce: viewOnce || false
    };
    messages.push(message);
    saveGroupMessages(groupId, messages);
    group.members.forEach(m => {
        io.to(m.phone).emit('new-group-message', { groupId, message });
    });
    res.json({ success: true, message });
});

app.get('/api/group-messages', (req, res) => {
    const { groupId, since } = req.query;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m.phone === phone)) {
        return res.status(403).json({ error: 'You are not a member' });
    }
    let messages = loadGroupMessages(groupId);
    if (since) {
        const sinceTime = new Date(since).getTime();
        messages = messages.filter(m => new Date(m.timestamp).getTime() > sinceTime);
    }
    res.json({ success: true, messages });
});

app.post('/api/delete-group-message', (req, res) => {
    const { token, groupId, messageId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const group = groups[groupId];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isAdmin = group.admin === phone || group.owner === phone;
    const messages = loadGroupMessages(groupId);
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });
    const msg = messages[idx];
    if (msg.sender !== phone && !isAdmin) {
        return res.status(403).json({ error: 'You cannot delete this message' });
    }
    messages.splice(idx, 1);
    saveGroupMessages(groupId, messages);
    group.members.forEach(m => {
        io.to(m.phone).emit('group-message-deleted', { groupId, messageId });
    });
    res.json({ success: true });
});

// ---------- CHANNELS ----------
app.post('/api/create-channel', (req, res) => {
    const { token, name, description, avatar } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channelId = genId();
    const user = loadUser(phone);
    const displayName = user ? user.displayName : phone;
    channels[channelId] = {
        id: channelId,
        name: name || 'Channel',
        description: description || '',
        owner: phone,
        admins: [phone],
        members: [{ phone, displayName, role: 'owner' }],
        avatar: avatar || null,
        link: `https://${req.get('host')}/join-channel.html?id=${channelId}`,
        createdAt: new Date().toISOString(),
        onlyAdminsCanSend: true,
        removedUsers: []
    };
    saveChannels();
    res.json({ success: true, channelId });
});

app.post('/api/my-channels', (req, res) => {
    const { token } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const myChannels = Object.values(channels).filter(c => c.members.some(m => m.phone === phone));
    res.json({ success: true, channels: myChannels });
});

app.get('/api/channel/:channelId', (req, res) => {
    const { channelId } = req.params;
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const response = { ...channel };
    response.members = undefined;
    response.memberCount = channel.members.length;
    res.json({ success: true, channel: response });
});

app.post('/api/channel-members', (req, res) => {
    const { token, channelId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.admins.includes(phone)) {
        return res.status(403).json({ error: 'Only admins can view members' });
    }
    res.json({ success: true, members: channel.members });
});

app.post('/api/update-channel', (req, res) => {
    const { token, channelId, name, description, avatar } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.admins.includes(phone)) {
        return res.status(403).json({ error: 'Only admins can edit' });
    }
    if (name) channel.name = name;
    if (description !== undefined) channel.description = description;
    if (avatar) channel.avatar = avatar;
    saveChannels();
    res.json({ success: true });
});

app.post('/api/add-channel-member', (req, res) => {
    const { token, channelId, phone: targetPhone } = req.body;
    const adminPhone = sessions[token];
    if (!adminPhone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.admins.includes(adminPhone)) {
        return res.status(403).json({ error: 'Only admins can add members' });
    }
    const user = loadUser(targetPhone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (channel.members.some(m => m.phone === targetPhone)) {
        return res.status(400).json({ error: 'Already a member' });
    }
    channel.members.push({ phone: targetPhone, displayName: user.displayName, role: 'member' });
    saveChannels();
    res.json({ success: true });
});

app.post('/api/remove-channel-member', (req, res) => {
    const { token, channelId, phone: targetPhone } = req.body;
    const adminPhone = sessions[token];
    if (!adminPhone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.admins.includes(adminPhone)) {
        return res.status(403).json({ error: 'Only admins can remove members' });
    }
    if (adminPhone === targetPhone) {
        return res.status(400).json({ error: 'Cannot remove yourself' });
    }
    channel.members = channel.members.filter(m => m.phone !== targetPhone);
    if (!channel.removedUsers) channel.removedUsers = [];
    channel.removedUsers.push(targetPhone);
    saveChannels();
    res.json({ success: true });
});

app.post('/api/promote-channel-admin', (req, res) => {
    const { token, channelId, phone: targetPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.owner !== phone) {
        return res.status(403).json({ error: 'Only owner can promote admins' });
    }
    const member = channel.members.find(m => m.phone === targetPhone);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (!channel.admins.includes(targetPhone)) {
        channel.admins.push(targetPhone);
        member.role = 'admin';
        saveChannels();
    }
    res.json({ success: true });
});

app.post('/api/demote-channel-admin', (req, res) => {
    const { token, channelId, phone: targetPhone } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.owner !== phone) {
        return res.status(403).json({ error: 'Only owner can demote admins' });
    }
    if (targetPhone === channel.owner) {
        return res.status(400).json({ error: 'Cannot demote owner' });
    }
    const member = channel.members.find(m => m.phone === targetPhone);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    channel.admins = channel.admins.filter(p => p !== targetPhone);
    member.role = 'member';
    saveChannels();
    res.json({ success: true });
});

app.post('/api/exit-channel', (req, res) => {
    const { token, channelId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const member = channel.members.find(m => m.phone === phone);
    if (!member) return res.status(404).json({ error: 'You are not a member' });
    channel.members = channel.members.filter(m => m.phone !== phone);
    channel.admins = channel.admins.filter(p => p !== phone);
    if (channel.owner === phone) {
        const newOwner = channel.members.find(m => m.role === 'admin') || channel.members[0];
        if (newOwner) {
            channel.owner = newOwner.phone;
            newOwner.role = 'admin';
            if (!channel.admins.includes(newOwner.phone)) channel.admins.push(newOwner.phone);
        } else {
            delete channels[channelId];
            saveChannels();
            return res.json({ success: true });
        }
    }
    saveChannels();
    res.json({ success: true });
});

// ---------- Join Channel via Link ----------
app.post('/api/join-channel', (req, res) => {
    const { token, channelId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.members.some(m => m.phone === phone)) {
        return res.json({ success: true, alreadyMember: true });
    }
    const user = loadUser(phone);
    channel.members.push({ phone, displayName: user?.displayName || phone, role: 'member' });
    saveChannels();
    res.json({ success: true });
});

// ---------- Channel Messaging ----------
app.post('/api/send-channel-message', (req, res) => {
    const { token, channelId, text, type, file, fileName, viewOnce } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.admins.includes(phone)) {
        return res.status(403).json({ error: 'Only admins can send messages' });
    }
    const messages = loadChannelMessages(channelId);
    const message = {
        id: genId(),
        sender: phone,
        senderName: channel.members.find(m => m.phone === phone)?.displayName || phone,
        text: text || '',
        type: type || 'text',
        file: file || null,
        fileName: fileName || null,
        timestamp: new Date().toISOString(),
        viewOnce: viewOnce || false
    };
    messages.push(message);
    saveChannelMessages(channelId, messages);
    channel.members.forEach(m => {
        io.to(m.phone).emit('new-channel-message', { channelId, message });
    });
    res.json({ success: true, message });
});

app.get('/api/channel-messages', (req, res) => {
    const { channelId, since } = req.query;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.members.some(m => m.phone === phone)) {
        return res.status(403).json({ error: 'You are not a subscriber' });
    }
    let messages = loadChannelMessages(channelId);
    if (since) {
        const sinceTime = new Date(since).getTime();
        messages = messages.filter(m => new Date(m.timestamp).getTime() > sinceTime);
    }
    res.json({ success: true, messages });
});

app.post('/api/delete-channel-message', (req, res) => {
    const { token, channelId, messageId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const channel = channels[channelId];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.admins.includes(phone)) {
        return res.status(403).json({ error: 'Only admins can delete messages' });
    }
    const messages = loadChannelMessages(channelId);
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });
    messages.splice(idx, 1);
    saveChannelMessages(channelId, messages);
    channel.members.forEach(m => {
        io.to(m.phone).emit('channel-message-deleted', { channelId, messageId });
    });
    res.json({ success: true });
});

// ---------- STATUS ----------
function cleanExpiredStatuses() {
    const now = Date.now();
    const expired = statuses.filter(s => new Date(s.expiresAt).getTime() < now);
    if (expired.length > 0) {
        statuses = statuses.filter(s => new Date(s.expiresAt).getTime() >= now);
        saveStatuses();
        console.log(`[Status] Removed ${expired.length} expired statuses`);
    }
}

app.post('/api/post-status', (req, res) => {
    const { token, type, content } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    cleanExpiredStatuses();
    const user = loadUser(phone);
    const displayName = user ? user.displayName : phone;
    const status = {
        id: genId(),
        phone,
        displayName,
        avatar: user?.avatar || null,
        type: type || 'text',
        content: content || '',
        timestamp: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        viewers: []
    };
    statuses.push(status);
    saveStatuses();
    res.json({ success: true, status });
});

app.post('/api/statuses', (req, res) => {
    const { token, contacts } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    cleanExpiredStatuses();
    const myStatuses = statuses.filter(s => s.phone === phone);
    const visible = statuses.filter(s => contacts.includes(s.phone));
    const all = [...myStatuses, ...visible.filter(s => s.phone !== phone)];
    all.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ success: true, statuses: all });
});

app.post('/api/status-react', (req, res) => {
    const { token, statusId } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const status = statuses.find(s => s.id === statusId);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    let viewer = status.viewers.find(v => v.phone === phone);
    if (!viewer) {
        viewer = { phone, liked: true, replies: [] };
        status.viewers.push(viewer);
    } else {
        viewer.liked = !viewer.liked;
    }
    saveStatuses();
    res.json({ success: true, liked: viewer.liked });
});

app.post('/api/status-reply', (req, res) => {
    const { token, statusId, replyText } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const status = statuses.find(s => s.id === statusId);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    let viewer = status.viewers.find(v => v.phone === phone);
    if (!viewer) {
        viewer = { phone, liked: false, replies: [] };
        status.viewers.push(viewer);
    }
    viewer.replies.push({ phone, text: replyText, timestamp: new Date().toISOString() });
    saveStatuses();
    res.json({ success: true });
});

// ---------- STICKERS ----------
app.post('/api/create-sticker-pack', (req, res) => {
    const { token, name } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    const packId = genId();
    stickers[packId] = { name, owner: phone, stickers: [] };
    saveStickers();
    res.json({ success: true, packId });
});

app.post('/api/add-sticker', (req, res) => {
    const { token, packId, file, type } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    if (!stickers[packId]) return res.status(404).json({ error: 'Pack not found' });
    stickers[packId].stickers.push({
        id: genId(),
        file,
        type: type || 'image'
    });
    saveStickers();
    res.json({ success: true });
});

app.get('/api/sticker-packs', (req, res) => {
    res.json(Object.values(stickers));
});

// ---------- PREMIUM ----------
app.post('/api/smart-reply', (req, res) => {
    // Already defined above
});

// ---------- Push Notification registration ----------
app.post('/api/register-push', (req, res) => {
    const { token, subscription } = req.body;
    const phone = sessions[token];
    if (!phone) return res.status(401).json({ error: 'Unauthorized' });
    let user = loadUser(phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.pushSubscription = subscription;
    saveUser(phone, user);
    res.json({ success: true });
});

// ---------- Search Users ----------
app.get('/api/search-users', (req, res) => {
    const { query } = req.query;
    if (!query || query.length < 2) return res.json([]);
    const files = fs.readdirSync(USERS_DIR);
    const results = [];
    files.forEach(f => {
        const data = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf8'));
        if (data.displayName.toLowerCase().includes(query.toLowerCase()) ||
            data.username.toLowerCase().includes(query.toLowerCase()) ||
            data.phone.includes(query)) {
            results.push({ phone: data.phone, displayName: data.displayName, username: data.username, avatar: data.avatar });
        }
    });
    res.json(results.slice(0, 20));
});

// ---------- Push notification sender (placeholder) ----------
function sendPushNotification(phone, title, body, url) {
    const user = loadUser(phone);
    if (!user || !user.pushSubscription) return;
    console.log(`[Push] To ${phone}: ${title} - ${body}`);
}

// ---------- Socket.io connection ----------
io.on('connection', (socket) => {
    const token = socket.handshake.auth.token;
    if (!token) return socket.disconnect();
    const phone = sessions[token];
    if (!phone) return socket.disconnect();
    socket.phone = phone;
    socket.join(phone);
    console.log(`Socket connected: ${phone}`);

    // WebRTC signalling
    socket.on('call-user', (data) => {
        const { target, offer } = data;
        io.to(target).emit('incoming-call', { from: phone, offer });
    });
    socket.on('answer-call', (data) => {
        const { target, answer } = data;
        io.to(target).emit('call-answered', { answer });
    });
    socket.on('ice-candidate', (data) => {
        const { target, candidate } = data;
        io.to(target).emit('ice-candidate', { candidate });
    });
    socket.on('end-call', (data) => {
        const { target } = data;
        io.to(target).emit('call-ended');
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${phone}`);
    });
});

// ---------- Start server ----------
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📁 Data stored in ${DATA_DIR}`);
    console.log(`📱 SMS will be sent via Twilio`);
});