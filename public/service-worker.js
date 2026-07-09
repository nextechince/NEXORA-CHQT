// service-worker.js
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'NEXORA CHQT';
    const options = {
        body: data.body || 'You have a new message',
        icon: data.icon || '/icon-192.png',
        badge: '/badge-72.png',
        data: data.url || '/dashboard.html',
        vibrate: [200, 100, 200],
        actions: [
            { action: 'open', title: 'Open' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'open' || !event.action) {
        const url = event.notification.data || '/dashboard.html';
        event.waitUntil(
            clients.openWindow(url)
        );
    }
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-messages') {
        event.waitUntil(syncMessages());
    }
});

async function syncMessages() {
    console.log('Background sync triggered');
}