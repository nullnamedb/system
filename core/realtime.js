// NullName DB - Real-time WebSocket Engine
// No brand. No name. No payment.
// Version: 2.0.0

const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');

class RealtimeEngine extends EventEmitter {
    constructor() {
        super();
        this.clients = new Map();
        this.subscriptions = new Map();
        this.presence = new Map();
        this.rooms = new Map();
        this.messageHistory = new Map();
        this.broadcastQueue = [];
        this.isProcessing = false;
        
        this.maxHistoryPerChannel = 100;
        this.broadcastInterval = 100;
        
        this.init();
    }

    init() {
        this.startBroadcastProcessor();
        console.log('Realtime engine initialized');
    }

    startBroadcastProcessor() {
        setInterval(() => {
            this.processBroadcastQueue();
        }, this.broadcastInterval);
    }

    async processBroadcastQueue() {
        if (this.isProcessing) return;
        if (this.broadcastQueue.length === 0) return;
        
        this.isProcessing = true;
        
        const batch = [...this.broadcastQueue];
        this.broadcastQueue = [];
        
        for (const item of batch) {
            await this.deliverToSubscribers(item);
        }
        
        this.isProcessing = false;
    }

    addSubscription(ws, query, user) {
        const clientId = this.getClientId(ws);
        const subscriptionId = crypto.randomBytes(8).toString('hex');
        
        if (!this.clients.has(clientId)) {
            this.clients.set(clientId, {
                ws: ws,
                user: user,
                subscriptions: new Set(),
                rooms: new Set(),
                connectedAt: Date.now(),
                lastActivity: Date.now(),
                messageCount: 0
            });
        }
        
        const client = this.clients.get(clientId);
        client.subscriptions.add(subscriptionId);
        client.lastActivity = Date.now();
        
        if (!this.subscriptions.has(query)) {
            this.subscriptions.set(query, new Map());
        }
        
        this.subscriptions.get(query).set(subscriptionId, {
            ws: ws,
            clientId: clientId,
            user: user,
            subscribedAt: Date.now()
        });
        
        this.updatePresence(clientId, user, true);
        
        return { id: subscriptionId, query: query };
    }

    removeSubscription(ws, query = null) {
        const clientId = this.getClientId(ws);
        const client = this.clients.get(clientId);
        
        if (!client) return false;
        
        if (query) {
            for (const [subId, sub] of this.subscriptions.entries()) {
                if (sub.has(subId) && sub.get(subId).clientId === clientId) {
                    sub.delete(subId);
                    if (sub.size === 0) {
                        this.subscriptions.delete(subId);
                    }
                    break;
                }
            }
        } else {
            for (const [subId, subMap] of this.subscriptions.entries()) {
                for (const [innerId, sub] of subMap.entries()) {
                    if (sub.clientId === clientId) {
                        subMap.delete(innerId);
                    }
                }
                if (subMap.size === 0) {
                    this.subscriptions.delete(subId);
                }
            }
            client.subscriptions.clear();
        }
        
        this.updatePresence(clientId, client.user, false);
        
        return true;
    }

    removeClient(ws) {
        const clientId = this.getClientId(ws);
        
        this.removeSubscription(ws);
        
        if (this.clients.has(clientId)) {
            const client = this.clients.get(clientId);
            this.updatePresence(clientId, client.user, false);
            this.clients.delete(clientId);
        }
        
        for (const [roomName, room] of this.rooms.entries()) {
            if (room.has(clientId)) {
                room.delete(clientId);
                if (room.size === 0) {
                    this.rooms.delete(roomName);
                }
                this.broadcastToRoom(roomName, {
                    type: 'presence',
                    action: 'leave',
                    user: clientId,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return true;
    }

    getClientId(ws) {
        return ws._socket?.remoteAddress + ':' + ws._socket?.remotePort + '_' + (ws.id || '');
    }

    updatePresence(clientId, user, isOnline) {
        if (!this.presence.has(clientId)) {
            this.presence.set(clientId, {
                user: user,
                status: 'offline',
                lastSeen: null,
                currentRoom: null
            });
        }
        
        const presence = this.presence.get(clientId);
        presence.status = isOnline ? 'online' : 'offline';
        presence.lastSeen = isOnline ? null : Date.now();
        
        this.emit('presence_change', {
            clientId: clientId,
            user: user,
            status: presence.status,
            timestamp: new Date().toISOString()
        });
    }

    async broadcast(data, query = null) {
        const message = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'broadcast',
            data: data,
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            query: query
        };
        
        this.broadcastQueue.push(message);
        
        if (query && this.messageHistory.has(query)) {
            const history = this.messageHistory.get(query);
            history.push(message);
            if (history.length > this.maxHistoryPerChannel) {
                history.shift();
            }
        } else if (query) {
            this.messageHistory.set(query, [message]);
        }
        
        return message;
    }

    async deliverToSubscribers(message) {
        const query = message.query;
        
        if (!query) {
            await this.deliverToAllClients(message);
            return;
        }
        
        const subscribers = this.subscriptions.get(query);
        if (!subscribers || subscribers.size === 0) return;
        
        const messageStr = JSON.stringify(message);
        
        for (const [subId, subscriber] of subscribers.entries()) {
            if (subscriber.ws.readyState === WebSocket.OPEN) {
                try {
                    subscriber.ws.send(messageStr);
                    const client = this.clients.get(subscriber.clientId);
                    if (client) {
                        client.messageCount++;
                        client.lastActivity = Date.now();
                    }
                } catch (error) {
                    console.error('Failed to send message to subscriber:', error);
                }
            }
        }
    }

    async deliverToAllClients(message) {
        const messageStr = JSON.stringify(message);
        const deadClients = [];
        
        for (const [clientId, client] of this.clients.entries()) {
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(messageStr);
                    client.messageCount++;
                    client.lastActivity = Date.now();
                } catch (error) {
                    deadClients.push(clientId);
                }
            } else {
                deadClients.push(clientId);
            }
        }
        
        for (const clientId of deadClients) {
            this.removeClient(this.clients.get(clientId)?.ws);
        }
    }

    async joinRoom(ws, roomName, user) {
        const clientId = this.getClientId(ws);
        
        if (!this.clients.has(clientId)) {
            this.addSubscription(ws, '__room__', user);
        }
        
        if (!this.rooms.has(roomName)) {
            this.rooms.set(roomName, new Set());
        }
        
        const room = this.rooms.get(roomName);
        room.add(clientId);
        
        const client = this.clients.get(clientId);
        if (client) {
            client.rooms.add(roomName);
            client.lastActivity = Date.now();
        }
        
        const presence = this.presence.get(clientId);
        if (presence) {
            presence.currentRoom = roomName;
        }
        
        await this.broadcastToRoom(roomName, {
            type: 'presence',
            action: 'join',
            user: user?.username || clientId,
            room: roomName,
            timestamp: new Date().toISOString()
        });
        
        return { success: true, room: roomName };
    }

    async leaveRoom(ws, roomName) {
        const clientId = this.getClientId(ws);
        
        if (this.rooms.has(roomName)) {
            const room = this.rooms.get(roomName);
            room.delete(clientId);
            
            if (room.size === 0) {
                this.rooms.delete(roomName);
            }
        }
        
        const client = this.clients.get(clientId);
        if (client) {
            client.rooms.delete(roomName);
            client.lastActivity = Date.now();
        }
        
        const presence = this.presence.get(clientId);
        if (presence && presence.currentRoom === roomName) {
            presence.currentRoom = null;
        }
        
        await this.broadcastToRoom(roomName, {
            type: 'presence',
            action: 'leave',
            user: clientId,
            room: roomName,
            timestamp: new Date().toISOString()
        });
        
        return { success: true, room: roomName };
    }

    async broadcastToRoom(roomName, data, excludeClientId = null) {
        if (!this.rooms.has(roomName)) return;
        
        const room = this.rooms.get(roomName);
        const message = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'room_broadcast',
            room: roomName,
            data: data,
            timestamp: Date.now(),
            timestampISO: new Date().toISOString()
        };
        
        const messageStr = JSON.stringify(message);
        
        for (const clientId of room) {
            if (excludeClientId === clientId) continue;
            
            const client = this.clients.get(clientId);
            if (client && client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(messageStr);
                } catch (error) {
                    console.error('Failed to broadcast to room:', error);
                }
            }
        }
    }

    async sendToClient(clientId, data) {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            const message = {
                id: crypto.randomBytes(8).toString('hex'),
                type: 'direct',
                data: data,
                timestamp: Date.now(),
                timestampISO: new Date().toISOString()
            };
            
            try {
                client.ws.send(JSON.stringify(message));
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
        
        return { success: false, error: 'Client not connected' };
    }

    async getPresence() {
        const presenceList = [];
        
        for (const [clientId, presence] of this.presence.entries()) {
            const client = this.clients.get(clientId);
            presenceList.push({
                clientId: clientId,
                user: presence.user,
                status: presence.status,
                currentRoom: presence.currentRoom,
                lastSeen: presence.lastSeen ? new Date(presence.lastSeen).toISOString() : null,
                connectedAt: client ? new Date(client.connectedAt).toISOString() : null,
                messageCount: client ? client.messageCount : 0
            });
        }
        
        return presenceList;
    }

    async getStats() {
        let totalSubscriptions = 0;
        for (const subs of this.subscriptions.values()) {
            totalSubscriptions += subs.size;
        }
        
        let totalRooms = 0;
        let totalRoomMembers = 0;
        for (const room of this.rooms.values()) {
            totalRooms++;
            totalRoomMembers += room.size;
        }
        
        return {
            connectedClients: this.clients.size,
            totalSubscriptions: totalSubscriptions,
            uniqueQueries: this.subscriptions.size,
            rooms: {
                count: totalRooms,
                totalMembers: totalRoomMembers
            },
            presence: {
                online: Array.from(this.presence.values()).filter(p => p.status === 'online').length,
                offline: Array.from(this.presence.values()).filter(p => p.status === 'offline').length
            },
            messageHistory: {
                channels: this.messageHistory.size,
                totalMessages: Array.from(this.messageHistory.values()).reduce((sum, arr) => sum + arr.length, 0)
            },
            queueLength: this.broadcastQueue.length
        };
    }

    async getChannelHistory(query, limit = 50) {
        const history = this.messageHistory.get(query);
        if (!history) return [];
        
        return history.slice(-limit);
    }

    async clearChannelHistory(query) {
        if (this.messageHistory.has(query)) {
            this.messageHistory.delete(query);
            return { success: true, channel: query };
        }
        return { success: false, error: 'Channel not found' };
    }

    async getRoomMembers(roomName) {
        if (!this.rooms.has(roomName)) {
            return [];
        }
        
        const room = this.rooms.get(roomName);
        const members = [];
        
        for (const clientId of room) {
            const client = this.clients.get(clientId);
            const presence = this.presence.get(clientId);
            if (client && presence) {
                members.push({
                    clientId: clientId,
                    user: presence.user,
                    status: presence.status,
                    connectedAt: new Date(client.connectedAt).toISOString()
                });
            }
        }
        
        return members;
    }

    async getActiveRooms() {
        const rooms = [];
        
        for (const [roomName, members] of this.rooms.entries()) {
            rooms.push({
                name: roomName,
                memberCount: members.size,
                members: Array.from(members)
            });
        }
        
        return rooms;
    }

    async kickClient(clientId, reason = 'Kicked by admin') {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify({
                    type: 'kicked',
                    reason: reason,
                    timestamp: new Date().toISOString()
                }));
                client.ws.close();
            } catch (error) {
                console.error('Failed to kick client:', error);
            }
        }
        
        this.removeClient(client?.ws);
        
        return { success: true, clientId: clientId, reason: reason };
    }

    async broadcastToAll(data) {
        return await this.broadcast(data, null);
    }

    async notifyUser(username, notification) {
        let targetClientId = null;
        
        for (const [clientId, client] of this.clients.entries()) {
            if (client.user?.username === username) {
                targetClientId = clientId;
                break;
            }
        }
        
        if (targetClientId) {
            return await this.sendToClient(targetClientId, {
                type: 'notification',
                notification: notification,
                timestamp: new Date().toISOString()
            });
        }
        
        return { success: false, error: 'User not connected' };
    }

    async shutdown() {
        for (const [clientId, client] of this.clients.entries()) {
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(JSON.stringify({
                        type: 'shutdown',
                        message: 'Server is shutting down',
                        timestamp: new Date().toISOString()
                    }));
                    client.ws.close();
                } catch (error) {
                    console.error('Failed to notify client during shutdown:', error);
                }
            }
        }
        
        this.clients.clear();
        this.subscriptions.clear();
        this.presence.clear();
        this.rooms.clear();
        this.messageHistory.clear();
        this.broadcastQueue = [];
        
        console.log('Realtime engine shutdown');
    }
}

module.exports = new RealtimeEngine();
