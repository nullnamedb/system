// NullName DB - Authentication System
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 550+

const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ============================================
// AUTHENTICATION SYSTEM CLASS
// ============================================

class AuthSystem {
    constructor() {
        this.sessions = new Map();
        this.sessionFile = path.join(__dirname, 'database', 'sessions.json');
        this.usersFile = path.join(__dirname, 'database', 'users.json');
        this.blacklistFile = path.join(__dirname, 'database', 'blacklist.json');
        this.whitelistFile = path.join(__dirname, 'database', 'whitelist.json');
        this.failedAttempts = new Map();
        this.maxFailedAttempts = 5;
        this.lockoutTimeMs = 900000; // 15 minutes
        
        // Initialize
        this.init();
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async init() {
        await this.loadSessions();
        await this.loadUsers();
        await this.loadBlacklist();
        await this.loadWhitelist();
        await this.cleanupExpiredSessions();
        
        // Start cleanup interval (every hour)
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
                // Create default admin user
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASS || 'nullname2025', saltRounds);
                
                const defaultUsers = {
                    [process.env.ADMIN_USER || 'admin']: {
                        password: hashedPassword,
                        role: 'admin',
                        created: new Date().toISOString(),
                        lastLogin: null,
                        lastIp: null,
                        active: true,
                        permissions: ['*']
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

    // ============================================
    // SESSION MANAGEMENT
    // ============================================

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
                role: user.role,
                permissions: user.permissions || this.getDefaultPermissions(user.role)
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
        
        // Check expiration
        if (session.expires && session.expires < Date.now()) {
            this.destroySession(sessionKey);
            return null;
        }
        
        // Update last used
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

    // ============================================
    // USER MANAGEMENT
    // ============================================

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
                permissions: this.getDefaultPermissions(role),
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

    async updateUser(username, updates) {
        try {
            const users = await fs.readJson(this.usersFile);
            
            if (!users[username]) {
                return { success: false, error: 'User not found' };
            }
            
            const allowedUpdates = ['role', 'permissions', 'active'];
            for (const key of allowedUpdates) {
                if (updates[key] !== undefined) {
                    users[username][key] = updates[key];
                }
            }
            
            users[username].updated = new Date().toISOString();
            await fs.writeJson(this.usersFile, users);
            
            return { success: true, message: 'User updated' };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteUser(username, deletedBy = null) {
        try {
            // Prevent deleting the last admin
            if (username === (process.env.ADMIN_USER || 'admin')) {
                return { success: false, error: 'Cannot delete the primary admin user' };
            }
            
            const users = await fs.readJson(this.usersFile);
            
            if (!users[username]) {
                return { success: false, error: 'User not found' };
            }
            
            // Check if there's at least one admin left
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
            
            // Destroy all sessions for this user
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
            
            // Update last login
            user.lastLogin = new Date().toISOString();
            user.lastIp = ip;
            await this.updateUser(username, { lastLogin: user.lastLogin, lastIp: ip });
            
            // Clear failed attempts
            this.clearFailedAttempts(username);
            
            return {
                success: true,
                username: username,
                role: user.role,
                permissions: user.permissions || this.getDefaultPermissions(user.role)
            };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async changePassword(username, oldPassword, newPassword, changedBy = null) {
        try {
            const user = await this.getUser(username);
            
            if (!user) {
                return { success: false, error: 'User not found' };
            }
            
            // If not admin changing someone else's password, verify old password
            if (!changedBy || changedBy !== username) {
                const passwordMatch = await bcrypt.compare(oldPassword, user.password);
                if (!passwordMatch) {
                    return { success: false, error: 'Current password is incorrect' };
                }
            }
            
            if (newPassword.length < 4) {
                return { success: false, error: 'New password must be at least 4 characters' };
            }
            
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
            
            user.password = hashedPassword;
            user.passwordChanged = new Date().toISOString();
            user.passwordChangedBy = changedBy || username;
            
            await this.updateUser(username, { password: hashedPassword });
            
            // Destroy all sessions except current
            if (changedBy === username) {
                // Keep current session? This would need session tracking
            }
            
            return { success: true, message: 'Password changed successfully' };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async setUserRole(username, newRole, changedBy = null) {
        const validRoles = ['admin', 'editor', 'viewer', 'user'];
        
        if (!validRoles.includes(newRole)) {
            return { success: false, error: 'Invalid role. Valid roles: ' + validRoles.join(', ') };
        }
        
        // Prevent demoting the last admin
        if (username === (process.env.ADMIN_USER || 'admin') && newRole !== 'admin') {
            return { success: false, error: 'Cannot change the primary admin role' };
        }
        
        return await this.updateUser(username, { role: newRole });
    }

    // ============================================
    // PERMISSIONS
    // ============================================

    getDefaultPermissions(role) {
        const permissions = {
            'root': ['*'],
            'admin': ['read', 'write', 'delete', 'create', 'manage_users', 'manage_system', 'backup', 'restore', 'force'],
            'editor': ['read', 'write', 'update', 'create', 'backup'],
            'viewer': ['read'],
            'user': ['read', 'write']
        };
        
        return permissions[role] || permissions['user'];
    }

    hasPermission(user, action) {
        if (!user || !user.permissions) {
            return false;
        }
        
        if (user.permissions.includes('*')) {
            return true;
        }
        
        const actionPermissions = {
            'read': ['read', 'write', 'update', 'delete', 'create', 'admin'],
            'write': ['write', 'update', 'delete', 'create', 'admin'],
            'update': ['update', 'write', 'admin'],
            'delete': ['delete', 'admin'],
            'create': ['create', 'admin'],
            'backup': ['backup', 'admin'],
            'restore': ['restore', 'admin'],
            'manage_users': ['manage_users', 'admin'],
            'force': ['force', 'admin']
        };
        
        const required = actionPermissions[action] || [action];
        
        for (const perm of required) {
            if (user.permissions.includes(perm)) {
                return true;
            }
        }
        
        return false;
    }

    // ============================================
    // IP BLACKLIST / WHITELIST
    // ============================================

    async isIpBlocked(ip) {
        try {
            const blacklist = await fs.readJson(this.blacklistFile);
            
            // Check exact match
            if (blacklist.ips && blacklist.ips.includes(ip)) {
                return true;
            }
            
            // Check CIDR ranges (simple)
            if (blacklist.ranges) {
                for (const range of blacklist.ranges) {
                    if (this.ipInRange(ip, range)) {
                        return true;
                    }
                }
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
            
            if (whitelist.ranges) {
                for (const range of whitelist.ranges) {
                    if (this.ipInRange(ip, range)) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    ipInRange(ip, cidr) {
        // Simple IP range check (can be expanded)
        const [range, bits] = cidr.split('/');
        if (!bits) return ip === range;
        
        // Basic implementation
        const ipParts = ip.split('.').map(Number);
        const rangeParts = range.split('.').map(Number);
        const maskBits = parseInt(bits);
        const mask = ~((1 << (32 - maskBits)) - 1) >>> 0;
        
        const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        const rangeInt = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
        
        return (ipInt & mask) === (rangeInt & mask);
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
        // Check IP blacklist
        const isBlocked = await this.isIpBlocked(ip);
        if (isBlocked) {
            return { allowed: false, message: 'IP address is blocked' };
        }
        
        // API Key authentication
        if (apiKey) {
            const apiUser = await this.validateApiKey(apiKey);
            if (apiUser) {
                return {
                    allowed: true,
                    user: apiUser,
                    method: 'api_key'
                };
            }
        }
        
        // Session authentication
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
        
        // Check if it's a public read operation
        if (this.isPublicOperation(query)) {
            return {
                allowed: true,
                user: { role: 'guest', username: 'guest', permissions: ['read'] },
                method: 'public'
            };
        }
        
        // Extract credentials from query (login/signup)
        const credentials = this.extractCredentials(query);
        if (credentials) {
            if (credentials.signup) {
                const result = await this.createUser(credentials.username, credentials.password, 'user', ip);
                if (result.success) {
                    const session = this.createSession(
                        { username: credentials.username, role: 'user', permissions: this.getDefaultPermissions('user') },
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
                        { username: result.username, role: result.role, permissions: result.permissions },
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
        
        // Check root key
        if (query && query.includes(`key=${process.env.ROOT_KEY}`)) {
            return {
                allowed: true,
                user: { role: 'root', username: 'root', permissions: ['*'] },
                method: 'root_key'
            };
        }
        
        return { allowed: false, message: 'Authentication required' };
    }

    async validateApiKey(apiKey) {
        try {
            const apiKeysFile = path.join(__dirname, 'database', 'api_keys.json');
            if (!await fs.pathExists(apiKeysFile)) {
                return null;
            }
            
            const apiKeys = await fs.readJson(apiKeysFile);
            const keyData = apiKeys[apiKey];
            
            if (keyData && (!keyData.expires || keyData.expires > Date.now())) {
                return {
                    username: keyData.username,
                    role: keyData.role,
                    permissions: keyData.permissions || this.getDefaultPermissions(keyData.role)
                };
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    async createApiKey(username, role, expiresIn = null) {
        try {
            const apiKeysFile = path.join(__dirname, 'database', 'api_keys.json');
            let apiKeys = {};
            
            if (await fs.pathExists(apiKeysFile)) {
                apiKeys = await fs.readJson(apiKeysFile);
            }
            
            const apiKey = 'api_' + crypto.randomBytes(24).toString('hex');
            
            apiKeys[apiKey] = {
                username: username,
                role: role,
                permissions: this.getDefaultPermissions(role),
                created: Date.now(),
                expires: expiresIn ? Date.now() + expiresIn : null
            };
            
            await fs.writeJson(apiKeysFile, apiKeys);
            
            return { success: true, apiKey: apiKey };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    isPublicOperation(query) {
        if (!query) return true;
        
        const writeCommands = ['=', 'add.', 'update.', 'delete.', 'commit', 'merge', 'branch', 'backup', 'restore', 'force'];
        const isWrite = writeCommands.some(cmd => query.includes(cmd));
        
        return !isWrite;
    }

    extractCredentials(query) {
        // Login pattern: login.username.password
        const loginMatch = query.match(/login\.([^.]+)\.([^.]+)/);
        if (loginMatch) {
            return { username: loginMatch[1], password: loginMatch[2], signup: false };
        }
        
        // Signup pattern: signup.username.password
        const signupMatch = query.match(/signup\.([^.]+)\.([^.]+)/);
        if (signupMatch) {
            return { username: signupMatch[1], password: signupMatch[2], signup: true };
        }
        
        return null;
    }

    // ============================================
    // SESSION INFO & UTILITIES
    // ============================================

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

// ============================================
// EXPORT
// ============================================

module.exports = new AuthSystem();
