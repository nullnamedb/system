// NullName DB - Authentication System
// No brand. No name. No payment.
// Version: 1.0.0

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
        this.failedAttempts = new Map();
        this.maxFailedAttempts = 5;
        this.lockoutTimeMs = 900000;
        
        this.init();
    }

    async init() {
        await this.loadSessions();
        await this.loadUsers();
        await this.loadBlacklist();
        await this.loadWhitelist();
        await this.cleanupExpiredSessions();
        
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 3600000);
        
        console.log('Auth system initialized');
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
                const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASS || 'nullname2025', saltRounds);
                
                const defaultUsers = {
                    [process.env.ADMIN_USER || 'admin']: {
                        password: hashedPassword,
                        role: 'admin',
                        created: new Date().toISOString(),
                        lastLogin: null,
                        lastIp: null,
                        active: true
                    }
                };
                await fs.writeJson(this.usersFile, defaultUsers);
                console.log('Default admin user created');
            }
        } catch (error) {
            console.error('Failed to load users:', error);
        }
    }

    async loadBlacklist() {
        try {
            if (!await fs.pathExists(this.blacklistFile)) {
                await fs.writeJson(this.blacklistFile, { ips: [], users: [], expires: {} });
            }
        } catch (error) {
            console.error('Failed to load blacklist:', error);
        }
    }

    async loadWhitelist() {
        try {
            if (!await fs.pathExists(this.whitelistFile)) {
                await fs.writeJson(this.whitelistFile, { ips: [], users: [] });
            }
        } catch (error) {
            console.error('Failed to load whitelist:', error);
        }
    }

    async saveSessions() {
        try {
            const data = Object.fromEntries(this.sessions);
            await fs.writeJson(this.sessionFile, data);
        } catch (error) {
            console.error('Failed to save sessions:', error);
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

    createSession(user, ip = null, userAgent = null) {
        const sessionKey = uuidv4();
        const expiresIn = parseInt(process.env.SESSION_TIMEOUT) || 86400000;
        
        const session = {
            key: sessionKey,
            user: {
                username: user.username,
                role: user.role
            },
            created: Date.now(),
            expires: Date.now() + expiresIn,
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
                    active: data.active !== false
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
            
            if (password.length < 4) {
                return { success: false, error: 'Password must be at least 4 characters' };
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
                active: true
            };
            
            await fs.writeJson(this.usersFile, users);
            
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
            await fs.writeJson(this.usersFile, users);
            
            this.destroyAllUserSessions(username);
            
            return { success: true, message: 'User deleted' };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async validateUser(username, password, ip = null) {
        try {
            const user = await this.getUser(username);
            
            if (!user) {
                this.recordFailedAttempt(username, ip);
                return { success: false, error: 'Invalid username or password' };
            }
            
            if (user.active === false) {
                return { success: false, error: 'Account is disabled' };
            }
            
            const isLocked = this.isAccountLocked(username);
            if (isLocked) {
                return { success: false, error: 'Account is temporarily locked. Try again later.' };
            }
            
            const passwordMatch = await bcrypt.compare(password, user.password);
            
            if (!passwordMatch) {
                this.recordFailedAttempt(username, ip);
                return { success: false, error: 'Invalid username or password' };
            }
            
            user.lastLogin = new Date().toISOString();
            user.lastIp = ip;
            
            const users = await fs.readJson(this.usersFile);
            users[username] = user;
            await fs.writeJson(this.usersFile, users);
            
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

    // ============================================
    // IP BLACKLIST / WHITELIST
    // ============================================

    async isIpBlocked(ip) {
        try {
            const blacklist = await fs.readJson(this.blacklistFile);
            
            if (blacklist.ips && blacklist.ips.includes(ip)) {
                return true;
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    async isIpWhitelisted(ip) {
        try {
            const whitelist = await fs.readJson(this.whitelistFile);
            
            if (whitelist.ips && whitelist.ips.includes(ip)) {
                return true;
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
                blacklist.expires[ip] = Date.now() + expiresIn;
            }
            
            if (reason) {
                blacklist.reasons = blacklist.reasons || {};
                blacklist.reasons[ip] = reason;
            }
            
            await fs.writeJson(this.blacklistFile, blacklist);
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
            await fs.writeJson(this.blacklistFile, blacklist);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // FAILED ATTEMPTS & LOCKOUT
    // ============================================

    recordFailedAttempt(username, ip) {
        const key = username || ip;
        const attempts = this.failedAttempts.get(key) || { count: 0, firstAttempt: Date.now() };
        
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
            const lockDuration = Date.now() - attempts.firstAttempt;
            if (lockDuration < this.lockoutTimeMs) {
                return true;
            } else {
                this.clearFailedAttempts(username);
            }
        }
        
        return false;
    }

    clearFailedAttempts(username) {
        this.failedAttempts.delete(username);
    }

    // ============================================
    // MAIN AUTHENTICATION
    // ============================================

    async authenticate(sessionKey, apiKey, ip, query, userAgent = null) {
        const isBlocked = await this.isIpBlocked(ip);
        if (isBlocked) {
            return { allowed: false, message: 'IP address is blocked' };
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
        
        if (query && query.includes(`key=${process.env.ROOT_KEY}`)) {
            return {
                allowed: true,
                user: { role: 'root', username: 'root' },
                method: 'root_key'
            };
        }
        
        return { allowed: false, message: 'Authentication required' };
    }

    isPublicOperation(query) {
        return false;
    }

    extractCredentials(query) {
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
            created: session.created,
            expires: session.expires,
            lastUsed: session.lastUsed,
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
                created: session.created,
                expires: session.expires,
                lastUsed: session.lastUsed,
                ip: session.ip
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
            lockedAccounts: this.failedAttempts.size
        };
    }
}

module.exports = new AuthSystem();