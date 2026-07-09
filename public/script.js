// =========================================
//   AUTH & NAVIGATION HELPERS
// =========================================

function setToken(token) {
    localStorage.setItem('token', token);
}

function getToken() {
    return localStorage.getItem('token');
}

function clearToken() {
    localStorage.removeItem('token');
}

function goTo(url) {
    window.location.href = url;
}

// =========================================
//   SOCKET.IO REAL-TIME
// =========================================

let socket = null;

function connectSocket(token) {
    if (socket && socket.connected) return socket;
    if (!window.io) {
        console.warn('Socket.io not loaded');
        return null;
    }
    socket = io('/', {
        auth: { token }
    });
    socket.on('connect', () => {
        console.log('Socket connected');
    });
    socket.on('disconnect', () => {
        console.log('Socket disconnected');
    });
    socket.on('connect_error', (err) => {
        console.warn('Socket error:', err);
    });
    return socket;
}

function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}

// =========================================
//   CACHED USER DATA
// =========================================

let cachedUser = null;

async function getUser(forceRefresh = false) {
    if (cachedUser && !forceRefresh) return cachedUser;
    const token = getToken();
    if (!token) return null;
    try {
        const res = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
            cachedUser = data.user;
            return cachedUser;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// =========================================
//   CHECK AUTH (with token validation)
// =========================================

async function checkAuth(redirect = true) {
    const token = getToken();
    if (!token) {
        if (redirect) goTo('login.html');
        return false;
    }
    try {
        const res = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
            // Keep cached user up to date
            cachedUser = data.user;
            // Connect socket if not already
            if (!socket || !socket.connected) {
                connectSocket(token);
            }
            return true;
        }
        clearToken();
        if (redirect) goTo('login.html');
        return false;
    } catch (e) {
        if (redirect) goTo('login.html');
        return false;
    }
}

// =========================================
//   REACTION HELPER
// =========================================

function getReactionEmojis() {
    return ['❤️', '😂', '😍', '😡', '👍', '👎', '🔥', '💯', '🥰', '🤣', '😱', '😢', '😡', '🙏', '✨', '💀'];
}

// =========================================
//   EXPOSE GLOBALLY
// =========================================

window.setToken = setToken;
window.getToken = getToken;
window.clearToken = clearToken;
window.goTo = goTo;
window.checkAuth = checkAuth;
window.getUser = getUser;
window.connectSocket = connectSocket;
window.disconnectSocket = disconnectSocket;
window.getReactionEmojis = getReactionEmojis;