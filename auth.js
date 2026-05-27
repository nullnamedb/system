// NullName DB - Authentication System
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class AuthSystem {
    constructor() {
        this.sessions = new Map();
        this.sessionFile = path.join(__dirname, 'database', 'sessions.json');
        this.usersFile = path.join(__dirname, 'database', 'users.json');
        this.blacklistFile = path.join(__dirname, 'database', 'blacklist.json');
        this.whitelistFile = path.join(__dirname, 'database', 'whitelist.json');
        this.tokensFile = path.join(__dirname, 'database', 'api_tokens.json');
        this.failedAttempts = new Map();
        this.maxFailedAttempts = 5;
        this.lockoutTimeMs = 900000;
        this.sessionTimeoutMs = parseInt(process.env.SESSION_TIMEOUT) || 86400000;
        
        this.init();
    }

    async init() {
        await this.ensureDirectories();
        await this.loadSessions();
        await this.loadUsers();
        await this.loadBlacklist();
        await this.loadWhitelist();
        await this.loadTokens();
        await this.cleanupExpiredSessions();
        
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 3600000);
        
        setInterval(() => {
            this.cleanupFailedAttempts();
        }, 300000);
        
        console.log('Auth system initialized');
    }

    async ensureDirectories() {
        await fs.ensureDir(path.join(__dirname, 'database'));
    }

    async loadSessions() {
        try {
            if (await fs.pathExists(this.sessionFile)) {
                const data = await fs.readJson(this.sessionFile);
                this.sessions = new Map(Object.entries(data));
            }
        } catch (error) {
            console.error('Failed to load sessions:', error);
            this.sessions = new Map();
        }
    }

    async loadUsers() {
        try {
            if (!await fs.pathExists(this.usersFile)) {
                const saltRounds = 10;
                const adminPass = process.env.ADMIN_PASS || 'nullname2025';
                const hashedPassword = await bcrypt.hash(adminPass, saltRounds);
                
                const defaultUsers = {
                    [process.env.ADMIN_USER || 'admin']: {
                        password: hashedPassword,
                        role: 'admin',
                        created: new Date().toISOString(),
                        lastLogin: null,
                        lastIp: null,
                        active: true,
                        loginCount: 0
                    }
                };
                await fs.writeJson(this.usersFile, defaultUsers, { spaces: 2 });
                console.log('Default admin user created');
            }
        } catch (error) {
            console.error('Failed to load users:', error);
        }
    }

    async loadBlacklist() {
        try {
            if (!await fs.pathExists(this.blacklistFile)) {
                await fs.writeJson(this.blacklistFile, { ips: [], users: [], expires: {}, reasons: {} }, { spaces: 2 });
            }
        } catch (error) {
            console.error('Failed to load blacklist:', error);
        }
    }

    async loadWhitelist() {
        try {
            if (!await fs.pathExists(this.whitelistFile)) {
                await fs.writeJson(this.whitelistFile, { ips: [], users: [] }, { spaces: 2 });
            }
        } catch (error) {
            console.error('Failed to load whitelist:', error);
        }
    }

    async loadTokens() {
        try {
            if (!await fs.pathExists(this.tokensFile)) {
                await fs.writeJson(this.tokensFile, {}, { spaces: 2 });
            }
        } catch (error) {
            console.error('Failed to load tokens:', error);
        }
    }

    async saveSessions() {
        try {
            const data = Object.fromEntries(this.sessions);
            await fs.writeJson(this.sessionFile, data, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save sessions:', error);
        }
    }

    async saveTokens() {
        try {
            const tokens = await fs.readJson(this.tokensFile);
            await fs.writeJson(this.tokensFile, tokens, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save tokens:', error);
        }
    }

    async cleanupExpiredSessions() {
        const now = Date.now();
        let expiredCount = 0;
        
        for (const [key, session] of this.sessions.entries()) {
            if (session.expires && session.expires < now) {
                this.sessions.delete(key);
                expiredCount++;
            }
        }
        
        if (expiredCount > 0) {
            await this.saveSessions();
            console.log(`Cleaned up ${expiredCount} expired sessions`);
        }
    }

    cleanupFailedAttempts() {
        const now = Date.now();
        for (const [key, data] of this.failedAttempts.entries()) {
            if (now - data.timestamp > this.lockoutTimeMs) {
                this.failedAttempts.delete(key);
            }
        }
    }

    createSession(user, ip = null, userAgent = null) {
        const sessionKey = uuidv4();
        
        const session = {
            key: sessionKey,
            user: {
                username: user.username,
                role: user.role
            },
            created: Date.now(),
            expires: Date.now() + this.sessionTimeoutMs,
            lastUsed: Date.now(),
            ip: ip,
            userAgent: userAgent,
            requests: 0
        };
        
        this.sessions.set(sessionKey, session);
        this.saveSessions();
        
        return sessionKey;
    }

    getSession(sessionKey) {
        const session = this.sessions.get(sessionKey);
        
        if (!session) {
            return null;
        }
        
        if (session.expires && session.expires < Date.now()) {
            this.destroySession(sessionKey);
            return null;
        }
        
        session.lastUsed = Date.now();
        session.requests++;
        this.saveSessions();
        
        return session;
    }

    destroySession(sessionKey) {
        const deleted = this.sessions.delete(sessionKey);
        if (deleted) {
            this.saveSessions();
        }
        return deleted;
    }

    destroyAllUserSessions(username) {
        let count = 0;
        for (const [key, session] of this.sessions.entries()) {
            if (session.user && session.user.username === username) {
                this.sessions.delete(key);
                count++;
            }
        }
        if (count > 0) {
            this.saveSessions();
        }
        return count;
    }

    async getUser(username) {
        try {
            const users = await fs.readJson(this.usersFile);
            return users[username] || null;
        } catch (error) {
            return null;
        }
    }

    async getAllUsers() {
        try {
            const users = await fs.readJson(this.usersFile);
            const userList = [];
            
            for (const [username, data] of Object.entries(users)) {
                userList.push({
                    username: username,
                    role: data.role,
                    created: data.created,
                    lastLogin: data.lastLogin,
                    lastIp: data.lastIp,
                    active: data.active !== false,
                    loginCount: data.loginCount || 0
                });
            }
            
            return userList;
        } catch (error) {
            return [];
        }
    }

    async createUser(username, password, role = 'user', createdBy = null) {
        try {
            const users = await fs.readJson(this.usersFile);
            
            if (users[username]) {
                return { success: false, error: 'Username already exists' };
            }
            
            if (username.length < 3) {
                return { success: false, error: 'Username must be at least 3 characters' };
            }
            
            if (username.length > 50) {
                return { success: false, error: 'Username must be less than 50 characters' };
            }
            
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                return { success: false, error: 'Username can only contain letters, numbers, and underscores' };
            }
            
            if (!password || password.length < 4) {
                return { success: false, error: 'Password must be at least 4 characters' };
            }
            
            const validRoles = ['admin', 'user', 'viewer'];
            if (!validRoles.includes(role)) {
                return { success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` };
            }
            
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            
            users[username] = {
                password: hashedPassword,
                role: role,
                created: new Date().toISOString(),
                createdBy: createdBy,
                lastLogin: null,
                lastIp: null,
                active: true,
                loginCount: 0
            };
            
            await fs.writeJson(this.usersFile, users, { spaces: 2 });
            
            return { 
                success: true, 
                username: username, 
                role: role,
                message: 'User created successfully'
            };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteUser(username, deletedBy = null) {
        try {
            if (username === (process.env.ADMIN_USER || 'admin')) {
                return { success: false, error: 'Cannot delete the primary admin user' };
            }
            
            const users = await fs.readJson(this.usersFile);
            
            if (!users[username]) {
                return { success: false, error: 'User not found' };
            }
            
            if (users[username].role === 'admin') {
                let adminCount = 0;
                for (const [_, userData] of Object.entries(users)) {
                    if (userData.role === 'admin' && userData.active !== false) {
                        adminCount++;
                    }
                }
                if (adminCount <= 1) {
                    return { success: false, error: 'Cannot delete the last admin user' };
                }
            }
            
            delete users[username];
            await fs.writeJson(this.usersFile, users, { spaces: 2 });
            
            this.destroyAllUserSessions(username);
            
            return { success: true, message: 'User deleted successfully' };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateUserRole(username, newRole, changedBy = null) {
        try {
            const validRoles = ['admin', 'user', 'viewer'];
            if (!validRoles.includes(newRole)) {
                return { success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` };
            }
            
            if (username === (process.env.ADMIN_USER || 'admin') && newRole !== 'admin') {
                return { success: false, error: 'Cannot change the primary admin role' };
            }
            
            const users = await fs.readJson(this.usersFile);
            
            if (!users[username]) {
                return { success: false, error: 'User not found' };
            }
            
            if (users[username].role === 'admin' && newRole !== 'admin') {
                let adminCount = 0;
                for (const [_, userData] of Object.entries(users)) {
                    if (userData.role === 'admin' && userData.active !== false && userData.username !== username) {
                        adminCount++;
                    }
                }
                if (adminCount === 0) {
                    return { success: false, error: 'Cannot demote the last admin user' };
                }
            }
            
            users[username].role = newRole;
            users[username].updatedAt = new Date().toISOString();
            users[username].updatedBy = changedBy;
            
            await fs.writeJson(this.usersFile, users, { spaces: 2 });
            
            this.destroyAllUserSessions(username);
            
            return { success: true, message: `User role updated to ${newRole}` };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateUserPassword(username, oldPassword, newPassword) {
        try {
            const users = await fs.readJson(this.usersFile);
            
            if (!users[username]) {
                return { success: false, error: 'User not found' };
            }
            
            const passwordMatch = await bcrypt.compare(oldPassword, users[username].password);
            if (!passwordMatch) {
                return { success: false, error: 'Current password is incorrect' };
            }
            
            if (!newPassword || newPassword.length < 4) {
                return { success: false, error: 'New password must be at least 4 characters' };
            }
            
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
            
            users[username].password = hashedPassword;
            users[username].passwordUpdated = new Date().toISOString();
            
            await fs.writeJson(this.usersFile, users, { spaces: 2 });
            
            this.destroyAllUserSessions(username);
            
            return { success: true, message: 'Password updated successfully' };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async createApiToken(username, description = null, expiresIn = null) {
        try {
            const tokens = await fs.readJson(this.tokensFile);
            
            if (!tokens[username]) {
                tokens[username] = [];
            }
            
            const token = crypto.randomBytes(32).toString('hex');
            const tokenId = crypto.randomBytes(8).toString('hex');
            
            const tokenData = {
                id: tokenId,
                token: token,
                description: description,
                created: new Date().toISOString(),
                expires: expiresIn ? Date.now() + expiresIn : null,
                lastUsed: null,
                usageCount: 0
            };
            
            tokens[username].push(tokenData);
            await fs.writeJson(this.tokensFile, tokens, { spaces: 2 });
            
            return { success: true, token: token, id: tokenId };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async validateApiToken(token) {
        try {
            const tokens = await fs.readJson(this.tokensFile);
            
            for (const [username, userTokens] of Object.entries(tokens)) {
                for (const tokenData of userTokens) {
                    if (tokenData.token === token) {
                        if (tokenData.expires && tokenData.expires < Date.now()) {
                            return null;
                        }
                        
                        tokenData.lastUsed = Date.now();
                        tokenData.usageCount++;
                        await fs.writeJson(this.tokensFile, tokens, { spaces: 2 });
                        
                        const user = await this.getUser(username);
                        return user;
                    }
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    async revokeApiToken(username, tokenId) {
        try {
            const tokens = await fs.readJson(this.tokensFile);
            
            if (!tokens[username]) {
                return { success: false, error: 'No tokens found for user' };
            }
            
            const initialLength = tokens[username].length;
            tokens[username] = tokens[username].filter(t => t.id !== tokenId);
            
            if (tokens[username].length === initialLength) {
                return { success: false, error: 'Token not found' };
            }
            
            await fs.writeJson(this.tokensFile, tokens, { spaces: 2 });
            
            return { success: true, message: 'Token revoked' };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async listApiTokens(username) {
        try {
            const tokens = await fs.readJson(this.tokensFile);
            
            if (!tokens[username]) {
                return [];
            }
            
            return tokens[username].map(t => ({
                id: t.id,
                description: t.description,
                created: t.created,
                expires: t.expires ? new Date(t.expires).toISOString() : null,
                lastUsed: t.lastUsed ? new Date(t.lastUsed).toISOString() : null,
                usageCount: t.usageCount
            }));
            
        } catch (error) {
            return [];
        }
    }

    async isIpBlocked(ip) {
        try {
            const blacklist = await fs.readJson(this.blacklistFile);
            
            if (blacklist.expires) {
                for (const [blockedIp, expiry] of Object.entries(blacklist.expires)) {
                    if (expiry < Date.now()) {
                        delete blacklist.expires[blockedIp];
                        blacklist.ips = blacklist.ips.filter(i => i !== blockedIp);
                    }
                }
                await fs.writeJson(this.blacklistFile, blacklist, { spaces: 2 });
            }
            
            return blacklist.ips && blacklist.ips.includes(ip);
        } catch (error) {
            return false;
        }
    }

    async isIpWhitelisted(ip) {
        try {
            const whitelist = await fs.readJson(this.whitelistFile);
            if (whitelist.ips && whitelist.ips.length > 0) {
                return whitelist.ips.includes(ip);
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    async addToBlacklist(ip, reason = null, expiresIn = null) {
        try {
            const blacklist = await fs.readJson(this.blacklistFile);
            
            if (!blacklist.ips.includes(ip)) {
                blacklist.ips.push(ip);
            }
            
            if (expiresIn) {
                if (!blacklist.expires) blacklist.expires = {};
                blacklist.expires[ip] = Date.now() + expiresIn;
            }
            
            if (reason) {
                if (!blacklist.reasons) blacklist.reasons = {};
                blacklist.reasons[ip] = reason;
            }
            
            await fs.writeJson(this.blacklistFile, blacklist, { spaces: 2 });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeFromBlacklist(ip) {
        try {
            const blacklist = await fs.readJson(this.blacklistFile);
            blacklist.ips = blacklist.ips.filter(i => i !== ip);
            if (blacklist.expires) delete blacklist.expires[ip];
            if (blacklist.reasons) delete blacklist.reasons[ip];
            await fs.writeJson(this.blacklistFile, blacklist, { spaces: 2 });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addToWhitelist(ip) {
        try {
            const whitelist = await fs.readJson(this.whitelistFile);
            if (!whitelist.ips.includes(ip)) {
                whitelist.ips.push(ip);
                await fs.writeJson(this.whitelistFile, whitelist, { spaces: 2 });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeFromWhitelist(ip) {
        try {
            const whitelist = await fs.readJson(this.whitelistFile);
            whitelist.ips = whitelist.ips.filter(i => i !== ip);
            await fs.writeJson(this.whitelistFile, whitelist, { spaces: 2 });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    recordFailedAttempt(username, ip) {
        const key = username || ip;
        const attempts = this.failedAttempts.get(key) || { count: 0, timestamp: Date.now() };
        
        attempts.count++;
        this.failedAttempts.set(key, attempts);
        
        if (attempts.count >= this.maxFailedAttempts) {
            this.addToBlacklist(ip, 'Too many failed attempts', this.lockoutTimeMs);
        }
    }

    isAccountLocked(username) {
        const attempts = this.failedAttempts.get(username);
        if (!attempts) return false;
        
        if (attempts.count >= this.maxFailedAttempts) {
            const lockDuration = Date.now() - attempts.timestamp;
            if (lockDuration < this.lockoutTimeMs) {
                return true;
            } else {
                this.failedAttempts.delete(username);
            }
        }
        
        return false;
    }

    clearFailedAttempts(username) {
        this.failedAttempts.delete(username);
    }

    async validateUser(username, password, ip = null) {
        try {
            const isBlocked = await this.isIpBlocked(ip);
            if (isBlocked) {
                return { success: false, error: 'IP address is blocked' };
            }
            
            if (this.isAccountLocked(username)) {
                return { success: false, error: 'Account is temporarily locked. Try again later.' };
            }
            
            const user = await this.getUser(username);
            
            if (!user) {
                this.recordFailedAttempt(username, ip);
                return { success: false, error: 'Invalid username or password' };
            }
            
            if (user.active === false) {
                return { success: false, error: 'Account is disabled' };
            }
            
            const passwordMatch = await bcrypt.compare(password, user.password);
            
            if (!passwordMatch) {
                this.recordFailedAttempt(username, ip);
                return { success: false, error: 'Invalid username or password' };
            }
            
            user.lastLogin = new Date().toISOString();
            user.lastIp = ip;
            user.loginCount = (user.loginCount || 0) + 1;
            
            const users = await fs.readJson(this.usersFile);
            users[username] = user;
            await fs.writeJson(this.usersFile, users, { spaces: 2 });
            
            this.clearFailedAttempts(username);
            
            return {
                success: true,
                username: username,
                role: user.role
            };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async authenticate(sessionKey, apiKey, ip, query, userAgent = null) {
        const isBlocked = await this.isIpBlocked(ip);
        if (isBlocked) {
            return { allowed: false, message: 'IP address is blocked' };
        }
        
        const isWhitelisted = await this.isIpWhitelisted(ip);
        const whitelistEnabled = process.env.WHITELIST_ENABLED === 'true';
        if (whitelistEnabled && !isWhitelisted) {
            return { allowed: false, message: 'IP address not whitelisted' };
        }
        
        if (sessionKey) {
            const session = this.getSession(sessionKey);
            if (session && session.user) {
                return {
                    allowed: true,
                    user: session.user,
                    session: sessionKey,
                    method: 'session'
                };
            }
        }
        
        if (apiKey) {
            const user = await this.validateApiToken(apiKey);
            if (user) {
                return {
                    allowed: true,
                    user: { username: user.username, role: user.role },
                    method: 'api_key'
                };
            }
        }
        
        const credentials = this.extractCredentials(query);
        if (credentials) {
            if (credentials.signup) {
                const result = await this.createUser(credentials.username, credentials.password, 'user', ip);
                if (result.success) {
                    const session = this.createSession(
                        { username: credentials.username, role: 'user' },
                        ip,
                        userAgent
                    );
                    return {
                        allowed: true,
                        user: { username: credentials.username, role: 'user' },
                        newSession: session,
                        method: 'signup'
                    };
                }
                return { allowed: false, message: result.error };
            } else {
                const result = await this.validateUser(credentials.username, credentials.password, ip);
                if (result.success) {
                    const session = this.createSession(
                        { username: result.username, role: result.role },
                        ip,
                        userAgent
                    );
                    return {
                        allowed: true,
                        user: { username: result.username, role: result.role },
                        newSession: session,
                        method: 'login'
                    };
                }
                return { allowed: false, message: result.error };
            }
        }
        
        const rootKey = process.env.ROOT_KEY;
        if (rootKey && query && query.includes(`key=${rootKey}`)) {
            return {
                allowed: true,
                user: { role: 'root', username: 'root' },
                method: 'root_key'
            };
        }
        
        const publicOperations = ['help', 'status', 'health'];
        if (publicOperations.some(op => query.includes(op))) {
            return {
                allowed: true,
                user: { role: 'public', username: 'public' },
                method: 'public'
            };
        }
        
        return { allowed: false, message: 'Authentication required' };
    }

    extractCredentials(query) {
        if (!query || typeof query !== 'string') return null;
        
        const loginMatch = query.match(/login\.([^.]+)\.([^.]+)/);
        if (loginMatch) {
            return { username: loginMatch[1], password: loginMatch[2], signup: false };
        }
        
        const signupMatch = query.match(/signup\.([^.]+)\.([^.]+)/);
        if (signupMatch) {
            return { username: signupMatch[1], password: signupMatch[2], signup: true };
        }
        
        return null;
    }

    async getSessionInfo(sessionKey) {
        const session = this.sessions.get(sessionKey);
        if (!session) return null;
        
        return {
            user: session.user,
            created: new Date(session.created).toISOString(),
            expires: new Date(session.expires).toISOString(),
            lastUsed: new Date(session.lastUsed).toISOString(),
            ip: session.ip,
            requests: session.requests
        };
    }

    async getAllSessions() {
        const sessions = [];
        for (const [key, session] of this.sessions.entries()) {
            sessions.push({
                key: key.substring(0, 8) + '...',
                user: session.user,
                created: new Date(session.created).toISOString(),
                expires: new Date(session.expires).toISOString(),
                lastUsed: new Date(session.lastUsed).toISOString(),
                ip: session.ip,
                requests: session.requests
            });
        }
        return sessions;
    }

    async getStats() {
        const users = await this.getAllUsers();
        
        return {
            totalSessions: this.sessions.size,
            totalUsers: users.length,
            adminUsers: users.filter(u => u.role === 'admin').length,
            activeUsers: users.filter(u => u.active !== false).length,
            lockedAccounts: this.failedAttempts.size,
            blockedIps: (await fs.readJson(this.blacklistFile)).ips?.length || 0
        };
    }

    async refreshSession(sessionKey) {
        const session = this.sessions.get(sessionKey);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }
        
        session.expires = Date.now() + this.sessionTimeoutMs;
        this.saveSessions();
        
        return { success: true, session: sessionKey };
    }
}

module.exports = new AuthSystem();
