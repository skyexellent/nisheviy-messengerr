const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

let data = {
    users: {},
    messages: {},
    groups: {},
    stories: {},
    pinnedMessages: {},
    userSettings: {},
    inviteLinks: {}
};

try {
    if (fs.existsSync(DATA_FILE)) {
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        data.users = saved.users || {};
        data.messages = saved.messages || {};
        data.groups = saved.groups || {};
        data.stories = saved.stories || {};
        data.pinnedMessages = saved.pinnedMessages || {};
        data.userSettings = saved.userSettings || {};
        data.inviteLinks = saved.inviteLinks || {};
        console.log('✅ Данные загружены. Пользователей:', Object.keys(data.users).length);
    }
} catch (e) { console.log('Начинаем с чистыми данными'); }

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch(e) { console.error('Ошибка сохранения:', e.message); }
}

const clients = new Map();
try { fs.mkdirSync('uploads'); } catch(e) {}

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg'
};

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    console.log(`${req.method} ${req.url}`);

    // Главная страница
    if (req.url === '/' || req.url === '/index.html') {
        const htmlPath = path.join(__dirname, 'index.html');
        if (fs.existsSync(htmlPath)) {
            const html = fs.readFileSync(htmlPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('index.html не найден');
        }
        return;
    }

    // Статические файлы из uploads
    if (req.url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, req.url);
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            const content = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' });
            res.end(content);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
        }
        return;
    }

    // Загрузка файлов
    if (req.url === '/api/upload' && req.method === 'POST') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                const contentType = req.headers['content-type'] || '';
                const boundaryMatch = contentType.match(/boundary=(.+)/);
                
                if (!boundaryMatch) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No boundary found' }));
                    return;
                }
                
                const boundary = boundaryMatch[1];
                const parts = buffer.toString('binary').split('--' + boundary);
                
                for (let part of parts) {
                    if (part.includes('filename=')) {
                        const headerEndIndex = part.indexOf('\r\n\r\n');
                        if (headerEndIndex === -1) continue;
                        
                        const header = part.substring(0, headerEndIndex);
                        const contentStart = headerEndIndex + 4;
                        let contentEnd = part.lastIndexOf('\r\n--');
                        if (contentEnd === -1) contentEnd = part.lastIndexOf('\r\n');
                        if (contentEnd <= contentStart) contentEnd = part.length;
                        
                        const content = part.substring(contentStart, contentEnd);
                        const filenameMatch = header.match(/filename="(.+?)"/);
                        
                        if (filenameMatch) {
                            const originalName = filenameMatch[1];
                            const safeName = Date.now() + '_' + originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
                            const filePath = path.join('uploads', safeName);
                            
                            fs.writeFileSync(filePath, Buffer.from(content, 'binary'));
                            
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ 
                                url: '/uploads/' + safeName,
                                fileName: originalName,
                                size: Buffer.from(content, 'binary').length
                            }));
                            return;
                        }
                    }
                }
                
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No file found in upload' }));
            } catch (e) {
                console.error('Upload error:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Upload failed: ' + e.message }));
            }
        });
        return;
    }

    // API - Регистрация
    if (req.url === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password, name } = JSON.parse(body);
                
                if (!username || !password || !name) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Все поля обязательны' }));
                    return;
                }
                
                if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username может содержать только буквы, цифры и _' }));
                    return;
                }
                
                if (username.length < 3) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username должен быть не менее 3 символов' }));
                    return;
                }
                
                if (password.length < 6) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Пароль должен быть не менее 6 символов' }));
                    return;
                }
                
                if (data.users[username]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username уже занят' }));
                    return;
                }
                
                data.users[username] = {
                    password: password,
                    name: name,
                    bio: '',
                    avatar: '',
                    createdAt: Date.now(),
                    lastSeen: Date.now()
                };
                data.userSettings[username] = {
                    theme: 'light',
                    hideLastSeen: false,
                    notifications: true
                };
                saveData();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Неверный формат данных' }));
            }
        });
        return;
    }

    // API - Вход
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = data.users[username];
                
                if (!user || user.password !== password) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Неверный логин или пароль' }));
                    return;
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, name: user.name }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Неверный формат данных' }));
            }
        });
        return;
    }

    // API - Поиск пользователей
    if (req.url.startsWith('/api/search')) {
        try {
            const url = new URL(req.url, 'http://localhost:' + PORT);
            const query = (url.searchParams.get('q') || '').toLowerCase();
            
            const results = Object.entries(data.users)
                .filter(([username]) => username.toLowerCase().includes(query))
                .slice(0, 20)
                .map(([username, user]) => ({
                    username: username,
                    name: user.name,
                    bio: user.bio || '',
                    avatar: user.avatar || '',
                    online: clients.has(username),
                    lastSeen: user.lastSeen
                }));
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
        }
        return;
    }

    // API - Поиск по сообщениям
    if (req.url === '/api/search_messages' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, query, type } = JSON.parse(body);
                const results = [];
                
                Object.entries(data.messages).forEach(([chatId, msgs]) => {
                    if (chatId.includes(username)) {
                        msgs.forEach(msg => {
                            let found = false;
                            
                            if (type === 'text' && msg.text && msg.text.toLowerCase().includes(query.toLowerCase())) {
                                found = true;
                            }
                            if (type === 'date') {
                                const d = new Date(msg.timestamp).toLocaleDateString('ru-RU');
                                if (d.includes(query)) found = true;
                            }
                            if (type === 'file' && msg.file && msg.file.toLowerCase().includes(query.toLowerCase())) {
                                found = true;
                            }
                            if (type === 'link' && msg.text && (msg.text.includes('http://') || msg.text.includes('https://'))) {
                                found = true;
                            }
                            
                            if (found) {
                                results.push({
                                    ...msg,
                                    chatId: chatId
                                });
                            }
                        });
                    }
                });
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(results.slice(0, 50)));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify([]));
            }
        });
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// ==================== WEBSOCKET ====================
server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
        socket.destroy();
        return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const acceptKey = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
    );

    let currentUser = null;

    socket.on('data', (buffer) => {
        const message = decodeWebSocketFrame(buffer);
        if (!message) return;

        try {
            const msg = JSON.parse(message);
            console.log('📩', msg.type, msg.username || msg.to || '');

            // ========== РЕГИСТРАЦИЯ ==========
            if (msg.type === 'register') {
                if (!msg.username || !msg.password || !msg.name) {
                    sendWS(socket, { type: 'register_error', text: 'Все поля обязательны' });
                    return;
                }
                if (data.users[msg.username]) {
                    sendWS(socket, { type: 'register_error', text: 'Username занят' });
                    return;
                }

                data.users[msg.username] = {
                    password: msg.password,
                    name: msg.name,
                    bio: '',
                    avatar: '',
                    createdAt: Date.now(),
                    lastSeen: Date.now()
                };
                data.userSettings[msg.username] = {
                    theme: 'light',
                    hideLastSeen: false,
                    notifications: true
                };
                saveData();

                currentUser = msg.username;
                clients.set(currentUser, socket);

                sendWS(socket, {
                    type: 'login_success',
                    username: currentUser,
                    name: msg.name,
                    bio: '',
                    avatar: '',
                    onlineUsers: Array.from(clients.keys()),
                    groups: [],
                    settings: data.userSettings[currentUser]
                });

                broadcast({ type: 'user_online', username: currentUser }, currentUser);
                console.log('✅ Зарегистрирован:', currentUser);
            }

            // ========== ВХОД ==========
            if (msg.type === 'login') {
                const user = data.users[msg.username];

                if (user && user.password === msg.password) {
                    currentUser = msg.username;
                    clients.set(currentUser, socket);
                    data.users[currentUser].lastSeen = Date.now();
                    saveData();

                    const myGroups = Object.entries(data.groups)
                        .filter(([_, g]) => g.members && g.members[currentUser])
                        .map(([id, g]) => ({
                            id: id,
                            name: g.name,
                            members: Object.keys(g.members).length,
                            role: g.members[currentUser],
                            inviteCode: g.inviteCode
                        }));

                    sendWS(socket, {
                        type: 'login_success',
                        username: currentUser,
                        name: user.name,
                        bio: user.bio || '',
                        avatar: user.avatar || '',
                        onlineUsers: Array.from(clients.keys()),
                        groups: myGroups,
                        settings: data.userSettings[currentUser] || { theme: 'light', hideLastSeen: false, notifications: true }
                    });

                    broadcast({ type: 'user_online', username: currentUser }, currentUser);
                    console.log('✅ Вошел:', currentUser);
                } else {
                    sendWS(socket, { type: 'login_error', text: 'Неверный логин или пароль' });
                }
            }

            // ========== ПРОФИЛЬ ==========
            if (msg.type === 'update_profile' && currentUser) {
                const user = data.users[currentUser];

                if (msg.username !== currentUser && data.users[msg.username]) {
                    sendWS(socket, { type: 'error', text: 'Username занят' });
                    return;
                }

                user.name = msg.name;
                user.bio = msg.bio || '';
                user.avatar = msg.avatar || '';

                if (msg.username !== currentUser) {
                    data.users[msg.username] = user;
                    delete data.users[currentUser];
                    clients.delete(currentUser);
                    clients.set(msg.username, socket);

                    Object.keys(data.messages).forEach(chatId => {
                        data.messages[chatId].forEach(m => {
                            if (m.from === currentUser) m.from = msg.username;
                        });
                    });

                    Object.keys(data.groups).forEach(groupId => {
                        const group = data.groups[groupId];
                        if (group.members[currentUser]) {
                            group.members[msg.username] = group.members[currentUser];
                            delete group.members[currentUser];
                        }
                        if (group.owner === currentUser) group.owner = msg.username;
                        if (group.admins && group.admins[currentUser]) {
                            group.admins[msg.username] = true;
                            delete group.admins[currentUser];
                        }
                    });

                    currentUser = msg.username;
                }

                saveData();

                sendWS(socket, {
                    type: 'profile_updated',
                    name: user.name,
                    username: currentUser,
                    bio: user.bio,
                    avatar: user.avatar
                });
            }

            // ========== СООБЩЕНИЕ ==========
            if (msg.type === 'send_message' && currentUser) {
                const messageData = {
                    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
                    from: currentUser,
                    text: msg.text || '',
                    file: msg.file || null,
                    fileName: msg.fileName || null,
                    replyTo: msg.replyTo || null,
                    mentions: msg.mentions || [],
                    timestamp: Date.now(),
                    reactions: {},
                    edited: false,
                    deleted: false
                };

                let chatId;

                if (msg.groupId) {
                    chatId = 'group_' + msg.groupId;
                    const group = data.groups[msg.groupId];

                    if (group && group.members && group.members[currentUser] && !group.banned?.[currentUser]) {
                        if (!data.messages[chatId]) data.messages[chatId] = [];
                        data.messages[chatId].push(messageData);
                        saveData();

                        Object.keys(group.members).forEach(member => {
                            const memberSocket = clients.get(member);
                            if (memberSocket) {
                                sendWS(memberSocket, {
                                    type: 'new_message',
                                    chatId: chatId,
                                    message: messageData,
                                    groupId: msg.groupId
                                });
                            }
                        });

                        if (msg.mentions && msg.mentions.length > 0) {
                            msg.mentions.forEach(mentioned => {
                                const mentionedSocket = clients.get(mentioned);
                                if (mentionedSocket && mentioned !== currentUser) {
                                    sendWS(mentionedSocket, {
                                        type: 'mention',
                                        from: currentUser,
                                        text: msg.text?.substring(0, 50),
                                        groupId: msg.groupId
                                    });
                                }
                            });
                        }
                    }
                } else if (msg.to) {
                    chatId = [currentUser, msg.to].sort().join('_');
                    if (!data.messages[chatId]) data.messages[chatId] = [];
                    data.messages[chatId].push(messageData);
                    saveData();

                    const targetSocket = clients.get(msg.to);
                    if (targetSocket) {
                        sendWS(targetSocket, {
                            type: 'new_message',
                            chatId: chatId,
                            message: messageData
                        });
                    }

                    sendWS(socket, {
                        type: 'message_sent',
                        chatId: chatId,
                        message: messageData
                    });

                    if (msg.mentions && msg.mentions.includes(msg.to)) {
                        const mentionedSocket = clients.get(msg.to);
                        if (mentionedSocket) {
                            sendWS(mentionedSocket, {
                                type: 'mention',
                                from: currentUser,
                                text: msg.text?.substring(0, 50)
                            });
                        }
                    }
                }
            }

            // ========== УДАЛЕНИЕ СООБЩЕНИЯ ==========
            if (msg.type === 'delete_message' && currentUser) {
                const chatId = msg.groupId ? 'group_' + msg.groupId : [currentUser, msg.chatWith].sort().join('_');
                const msgs = data.messages[chatId];

                if (msgs) {
                    const msgIndex = msgs.findIndex(m => m.id === msg.messageId);
                    if (msgIndex > -1) {
                        if (msg.forAll && msgs[msgIndex].from === currentUser) {
                            msgs[msgIndex].deleted = true;
                            msgs[msgIndex].text = '🗑️ Сообщение удалено';
                            msgs[msgIndex].file = null;
                        }
                        saveData();

                        const deleteData = {
                            type: 'message_deleted',
                            chatId: chatId,
                            messageId: msg.messageId,
                            forAll: msg.forAll
                        };

                        sendWS(socket, deleteData);

                        if (msg.chatWith) {
                            const targetSocket = clients.get(msg.chatWith);
                            if (targetSocket && msg.forAll) sendWS(targetSocket, deleteData);
                        }

                        if (msg.groupId) {
                            const group = data.groups[msg.groupId];
                            if (group && group.members) {
                                Object.keys(group.members).forEach(member => {
                                    const memberSocket = clients.get(member);
                                    if (memberSocket && memberSocket !== socket) {
                                        sendWS(memberSocket, deleteData);
                                    }
                                });
                            }
                        }
                    }
                }
            }

            // ========== РЕАКЦИЯ ==========
            if (msg.type === 'add_reaction' && currentUser) {
                const chatId = msg.groupId ? 'group_' + msg.groupId : [currentUser, msg.chatWith].sort().join('_');
                const msgs = data.messages[chatId];

                if (msgs) {
                    const message = msgs.find(x => x.id === msg.messageId);
                    if (message) {
                        if (!message.reactions) message.reactions = {};
                        if (!message.reactions[msg.emoji]) message.reactions[msg.emoji] = [];

                        const index = message.reactions[msg.emoji].indexOf(currentUser);
                        if (index > -1) {
                            message.reactions[msg.emoji].splice(index, 1);
                            if (message.reactions[msg.emoji].length === 0) {
                                delete message.reactions[msg.emoji];
                            }
                        } else {
                            message.reactions[msg.emoji].push(currentUser);
                        }
                        saveData();

                        const reactionData = {
                            type: 'reaction_update',
                            chatId: chatId,
                            messageId: msg.messageId,
                            reactions: message.reactions
                        };

                        sendWS(socket, reactionData);

                        if (msg.chatWith) {
                            const targetSocket = clients.get(msg.chatWith);
                            if (targetSocket) sendWS(targetSocket, reactionData);
                        }

                        if (msg.groupId) {
                            const group = data.groups[msg.groupId];
                            if (group && group.members) {
                                Object.keys(group.members).forEach(member => {
                                    const memberSocket = clients.get(member);
                                    if (memberSocket) sendWS(memberSocket, reactionData);
                                });
                            }
                        }
                    }
                }
            }

            // ========== ЗАКРЕПЛЕНИЕ ==========
            if (msg.type === 'pin_message' && currentUser) {
                const chatId = msg.groupId ? 'group_' + msg.groupId : [currentUser, msg.chatWith].sort().join('_');
                if (!data.pinnedMessages[chatId]) data.pinnedMessages[chatId] = [];

                if (msg.unpin) {
                    data.pinnedMessages[chatId] = [];
                } else {
                    const message = data.messages[chatId]?.find(x => x.id === msg.messageId);
                    if (message) {
                        data.pinnedMessages[chatId] = [{
                            ...message,
                            pinnedBy: currentUser,
                            pinnedAt: Date.now()
                        }];
                    }
                }
                saveData();

                const pinData = {
                    type: 'pin_update',
                    chatId: chatId,
                    pinned: data.pinnedMessages[chatId] || []
                };

                sendWS(socket, pinData);

                if (msg.chatWith) {
                    const targetSocket = clients.get(msg.chatWith);
                    if (targetSocket) sendWS(targetSocket, pinData);
                }

                if (msg.groupId) {
                    const group = data.groups[msg.groupId];
                    if (group && group.members) {
                        Object.keys(group.members).forEach(member => {
                            const memberSocket = clients.get(member);
                            if (memberSocket) sendWS(memberSocket, pinData);
                        });
                    }
                }
            }

            // ========== ПОЛУЧИТЬ СООБЩЕНИЯ ==========
            if (msg.type === 'get_messages' && currentUser) {
                let chatId;
                if (msg.groupId) {
                    chatId = 'group_' + msg.groupId;
                } else if (msg.with) {
                    chatId = [currentUser, msg.with].sort().join('_');
                }

                if (chatId) {
                    sendWS(socket, {
                        type: 'messages',
                        chatId: chatId,
                        messages: data.messages[chatId] || [],
                        pinned: data.pinnedMessages[chatId] || []
                    });
                }
            }

            // ========== НАСТРОЙКИ ==========
            if (msg.type === 'update_settings' && currentUser) {
                if (!data.userSettings[currentUser]) {
                    data.userSettings[currentUser] = { theme: 'light', hideLastSeen: false, notifications: true };
                }
                Object.assign(data.userSettings[currentUser], msg.settings);
                saveData();
                sendWS(socket, {
                    type: 'settings_updated',
                    settings: data.userSettings[currentUser]
                });
            }

            // ========== ГРУППЫ ==========
            if (msg.type === 'create_group' && currentUser) {
                const groupId = Date.now().toString();
                const inviteCode = Math.random().toString(36).substr(2, 8).toUpperCase();

                data.groups[groupId] = {
                    id: groupId,
                    name: msg.name || 'Новая группа',
                    description: msg.description || '',
                    owner: currentUser,
                    admins: {},
                    members: { [currentUser]: 'owner' },
                    banned: {},
                    inviteCode: inviteCode,
                    createdAt: Date.now()
                };
                data.inviteLinks[inviteCode] = groupId;
                saveData();

                sendWS(socket, {
                    type: 'group_created',
                    group: {
                        id: groupId,
                        name: data.groups[groupId].name,
                        members: 1,
                        role: 'owner',
                        inviteCode: inviteCode
                    }
                });
            }

            if (msg.type === 'join_by_invite' && currentUser) {
                const groupId = data.inviteLinks[msg.code];
                if (groupId && data.groups[groupId]) {
                    const group = data.groups[groupId];
                    if (group.banned && group.banned[currentUser]) {
                        sendWS(socket, { type: 'error', text: 'Вы заблокированы в этой группе' });
                        return;
                    }
                    group.members[currentUser] = 'member';
                    saveData();

                    sendWS(socket, {
                        type: 'group_joined',
                        group: {
                            id: group.id,
                            name: group.name,
                            members: Object.keys(group.members).length,
                            role: 'member'
                        }
                    });

                    Object.keys(group.members).forEach(member => {
                        const memberSocket = clients.get(member);
                        if (memberSocket && member !== currentUser) {
                            sendWS(memberSocket, {
                                type: 'member_joined',
                                groupId: group.id,
                                username: currentUser,
                                membersCount: Object.keys(group.members).length
                            });
                        }
                    });
                } else {
                    sendWS(socket, { type: 'error', text: 'Неверный код приглашения' });
                }
            }

            // ========== ДРУЗЬЯ ==========
            if (msg.type === 'add_friend' && currentUser) {
                const targetSocket = clients.get(msg.username);
                if (targetSocket) {
                    sendWS(targetSocket, { type: 'friend_added', username: currentUser });
                }
                sendWS(socket, { type: 'friend_added', username: msg.username });
            }

            // ========== ИСТОРИИ ==========
            if (msg.type === 'create_story' && currentUser) {
                if (!data.stories[currentUser]) data.stories[currentUser] = [];

                data.stories[currentUser].push({
                    id: Date.now().toString(),
                    user: currentUser,
                    url: msg.url,
                    type: msg.storyType || 'image',
                    caption: msg.caption || '',
                    timestamp: Date.now(),
                    views: {}
                });

                data.stories[currentUser] = data.stories[currentUser].filter(
                    s => Date.now() - s.timestamp < 86400000
                );
                saveData();

                sendWS(socket, {
                    type: 'story_created',
                    story: data.stories[currentUser][data.stories[currentUser].length - 1]
                });

                broadcast({ type: 'new_story_available', username: currentUser }, currentUser);
            }

            if (msg.type === 'get_stories' && currentUser) {
                const allStories = {};
                const now = Date.now();

                Object.entries(data.stories).forEach(([username, userStories]) => {
                    const active = userStories.filter(s => now - s.timestamp < 86400000);
                    if (active.length > 0) {
                        allStories[username] = active;
                    }
                });

                sendWS(socket, { type: 'stories_list', stories: allStories });
            }

            // ========== ПЕЧАТАЕТ ==========
            if (msg.type === 'typing' && currentUser) {
                const targetSocket = clients.get(msg.to);
                if (targetSocket) {
                    sendWS(targetSocket, {
                        type: 'typing',
                        from: currentUser,
                        typing: msg.typing
                    });
                }
            }

            // ========== PING ==========
            if (msg.type === 'ping') {
                sendWS(socket, { type: 'pong' });
            }

        } catch (e) {
            console.error('Ошибка обработки сообщения:', e.message);
        }
    });

    socket.on('close', () => {
        if (currentUser) {
            clients.delete(currentUser);
            if (data.users[currentUser]) {
                data.users[currentUser].lastSeen = Date.now();
            }
            saveData();
            broadcast({
                type: 'user_offline',
                username: currentUser,
                lastSeen: Date.now()
            }, currentUser);
            console.log('❌ Отключился:', currentUser);
        }
    });

    socket.on('error', (err) => {
        console.error('Ошибка сокета:', err.message);
        if (currentUser) {
            clients.delete(currentUser);
        }
    });
});

// ==================== WEBSOCKET УТИЛИТЫ ====================
function decodeWebSocketFrame(buffer) {
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const opcode = firstByte & 0x0F;

    if (opcode === 0x8) return null;
    if (opcode === 0x9) {
        const pongFrame = Buffer.alloc(2);
        pongFrame[0] = 0x8A;
        pongFrame[1] = 0x00;
        return null;
    }

    const secondByte = buffer[1];
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7F;
    let offset = 2;

    if (payloadLength === 126) {
        if (buffer.length < 4) return null;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
    } else if (payloadLength === 127) {
        if (buffer.length < 10) return null;
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
    }

    let mask = null;
    if (masked) {
        if (buffer.length < offset + 4) return null;
        mask = buffer.slice(offset, offset + 4);
        offset += 4;
    }

    if (buffer.length < offset + payloadLength) return null;

    const payload = Buffer.alloc(payloadLength);
    buffer.copy(payload, 0, offset, offset + payloadLength);

    if (masked && mask) {
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
    }

    return payload.toString('utf8');
}

function sendWS(socket, data) {
    try {
        const json = JSON.stringify(data);
        const payload = Buffer.from(json, 'utf8');
        const length = payload.length;

        let frame;
        if (length < 126) {
            frame = Buffer.alloc(2 + length);
            frame[0] = 0x81;
            frame[1] = length;
            payload.copy(frame, 2);
        } else if (length < 65536) {
            frame = Buffer.alloc(4 + length);
            frame[0] = 0x81;
            frame[1] = 126;
            frame.writeUInt16BE(length, 2);
            payload.copy(frame, 4);
        } else {
            frame = Buffer.alloc(10 + length);
            frame[0] = 0x81;
            frame[1] = 127;
            frame.writeBigUInt64BE(BigInt(length), 2);
            payload.copy(frame, 10);
        }

        if (socket.writable) {
            socket.write(frame);
        }
    } catch (e) {
        console.error('Ошибка отправки:', e.message);
    }
}

function broadcast(data, excludeUser = null) {
    clients.forEach((clientSocket, username) => {
        if (username !== excludeUser) {
            sendWS(clientSocket, data);
        }
    });
}

// ==================== ЗАПУСК СЕРВЕРА ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('='.repeat(60));
    console.log('🚀  n.me МЕССЕНДЖЕР ЗАПУЩЕН!');
    console.log('='.repeat(60));
    console.log('📡  Локальный доступ: http://localhost:' + PORT);
    console.log('📱  Для теста откройте две вкладки браузера');
    console.log('');
    console.log('✅  Регистрация и вход');
    console.log('💬  Личные сообщения');
    console.log('👥  Группы с приглашениями');
    console.log('📸  Отправка фото и файлов');
    console.log('🎤  Голосовые сообщения');
    console.log('😀  Реакции на сообщения');
    console.log('📌  Закрепление сообщений');
    console.log('↩️   Ответы на сообщения');
    console.log('🗑️   Удаление сообщений');
    console.log('🔍  Поиск по сообщениям');
    console.log('📱  Истории (24 часа)');
    console.log('🌓  Тёмная тема');
    console.log('👤  Профиль пользователя');
    console.log('='.repeat(60));
    console.log('');
});

server.on('error', (err) => {
    console.error('❌ Ошибка сервера:', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error('Порт ' + PORT + ' уже занят. Попробуйте другой порт.');
        process.exit(1);
    }
});

process.on('SIGINT', () => {
    console.log('\n👋 Сервер остановлен');
    saveData();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Сервер остановлен');
    saveData();
    process.exit(0);
});