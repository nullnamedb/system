// NullName DB - User Management System
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class UserManager {
    constructor() {
        this.usersFile = path.join(__dirname, 'database', 'users.json');
        this.profilesFile = path.join(__dirname, 'database', 'profiles.json');
        this.activityFile = path.join(__dirname, 'database', 'user_activity.json');
        this.settingsFile = path.join(__dirname, 'database', 'user_settings.json');
        this.tokensFile = path.join(__dirname, 'database', 'user_tokens.json');
        this.sessionsFile = path.join(__dirname, 'database', 'sessions.json');
        
        this.userCache = new Map();
        this.cacheTimeout = 60000;
        
        this.init();
    }

    async init() {
        await this.ensureFiles();
        await this.createDefaultAdmin();
        await this.loadCache();
        
        setInterval(() => {
            this.cleanupCache();
        }, 300000);
        
        console.log('User management system initialized');
    }

    async ensureFiles() {
        const files = [this.usersFile, this.profilesFile, this.activityFile, this.settingsFile, this.tokensFile];
        
        for (const file of files) {
            if (!await fs.pathExists(file)) {
                await fs.writeJson(file, {}, { spaces: 2 });
            }
        }
    }

    async createDefaultAdmin() {
        const users = await this.readUsers();
        const adminUsername = process.env.ADMIN_USER || 'admin';
        
        if (!users[adminUsername]) {
            const saltRounds = 10;
            const adminPass = process.env.ADMIN_PASS || 'nullname2025';
            const hashedPassword = await bcrypt.hash(adminPass, saltRounds);
            
            users[adminUsername] = {
                username: adminUsername,
                password: hashedPassword,
                role: 'admin',
                status: 'active',
                created: new Date().toISOString(),
                createdBy: 'system',
                lastLogin: null,
                lastIp: null,
                lastUserAgent: null,
                loginCount: 0,
                preferences: {
                    theme: 'dark',
                    defaultFormat: 'json',
                    notifications: true
                }
            };
            
            await this.writeUsers(users);
            console.log('Default admin user created');
        }
    }

    async loadCache() {
        try {
            const users = await this.readUsers();
            for (const [username, userData] of Object.entries(users)) {
                this.userCache.set(username, {
                    data: userData,
                    cached: Date.now()
                });
            }
        } catch (error) {
            console.error('Failed to load user cache:', error);
        }
    }

    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.userCache.entries()) {
            if (now - value.cached > this.cacheTimeout) {
                this.userCache.delete(key);
            }
        }
    }

    async readUsers() {
        try {
            return await fs.readJson(this.usersFile);
        } catch (error) {
            return {};
        }
    }

    async writeUsers(users) {
        await fs.writeJson(this.usersFile, users, { spaces: 2 });
        for (const [username, userData] of Object.entries(users)) {
            this.userCache.set(username, {
                data: userData,
                cached: Date.now()
            });
        }
    }

    async getUser(username) {
        const cached = this.userCache.get(username);
        if (cached && (Date.now() - cached.cached) < this.cacheTimeout) {
            return { ...cached.data };
        }
        
        const users = await this.readUsers();
        const user = users[username];
        
        if (user) {
            this.userCache.set(username, {
                data: { ...user },
                cached: Date.now()
            });
        }
        
        return user ? { ...user } : null;
    }

    async getUserByEmail(email) {
        const users = await this.readUsers();
        for (const [username, data] of Object.entries(users)) {
            if (data.email === email) {
                return { username, ...data };
            }
        }
        return null;
    }

    async getAllUsers(options = {}) {
        const users = await this.readUsers();
        const userList = [];
        
        for (const [username, data] of Object.entries(users)) {
            if (options.status && data.status !== options.status) continue;
            if (options.role && data.role !== options.role) continue;
            
            userList.push({
                username: username,
                role: data.role,
                status: data.status,
                created: data.created,
                createdBy: data.createdBy,
                lastLogin: data.lastLogin,
                lastIp: data.lastIp,
                lastUserAgent: data.lastUserAgent,
                loginCount: data.loginCount || 0,
                preferences: data.preferences || {}
            });
        }
        
        userList.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        return userList;
    }

    async createUser(username, password, options = {}) {
        if (!username || typeof username !== 'string') {
            return { success: false, error: 'Username is required' };
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
        
        const users = await this.readUsers();
        
        if (users[username]) {
            return { success: false, error: 'Username already exists' };
        }
        
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        const newUser = {
            username: username,
            password: hashedPassword,
            role: options.role || 'user',
            status: options.status || 'active',
            created: new Date().toISOString(),
            createdBy: options.createdBy || 'system',
            email: options.email || null,
            firstName: options.firstName || null,
            lastName: options.lastName || null,
            lastLogin: null,
            lastIp: null,
            lastUserAgent: null,
            loginCount: 0,
            preferences: {
                theme: options.theme || 'dark',
                defaultFormat: options.defaultFormat || 'json',
                notifications: options.notifications !== false,
                language: options.language || 'en'
            }
        };
        
        users[username] = newUser;
        await this.writeUsers(users);
        
        await this.logActivity(username, 'user_created', { by: options.createdBy || 'system' });
        
        return {
            success: true,
            username: username,
            role: newUser.role,
            message: 'User created successfully'
        };
    }

    async updateUser(username, updates, updatedBy = null) {
        const users = await this.readUsers();
        
        if (!users[username]) {
            return { success: false, error: 'User not found' };
        }
        
        const allowedUpdates = ['email', 'firstName', 'lastName', 'status', 'preferences'];
        
        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                if (key === 'preferences' && typeof updates[key] === 'object') {
                    users[username][key] = { ...users[username][key], ...updates[key] };
                } else {
                    users[username][key] = updates[key];
                }
            }
        }
        
        users[username].updatedAt = new Date().toISOString();
        users[username].updatedBy = updatedBy;
        
        await this.writeUsers(users);
        
        await this.logActivity(username, 'user_updated', { updates: Object.keys(updates), by: updatedBy });
        
        return {
            success: true,
            message: 'User updated successfully'
        };
    }

    async deleteUser(username, deletedBy = null) {
        if (username === (process.env.ADMIN_USER || 'admin')) {
            return { success: false, error: 'Cannot delete the primary admin user' };
        }
        
        const users = await this.readUsers();
        
        if (!users[username]) {
            return { success: false, error: 'User not found' };
        }
        
        if (users[username].role === 'admin') {
            let adminCount = 0;
            for (const [_, userData] of Object.entries(users)) {
                if (userData.role === 'admin' && userData.status === 'active') {
                    adminCount++;
                }
            }
            if (adminCount <= 1) {
                return { success: false, error: 'Cannot delete the last active admin user' };
            }
        }
        
        const archivedUser = { ...users[username] };
        delete archivedUser.password;
        
        await this.logActivity(username, 'user_deleted', { by: deletedBy, archived: archivedUser });
        
        delete users[username];
        await this.writeUsers(users);
        
        const sessions = await this.readSessions();
        for (const [key, session] of Object.entries(sessions)) {
            if (session.user && session.user.username === username) {
                delete sessions[key];
            }
        }
        await this.writeSessions(sessions);
        
        return {
            success: true,
            message: 'User deleted successfully'
        };
    }

    async validateUser(username, password, ip = null, userAgent = null) {
        const user = await this.getUser(username);
        
        if (!user) {
            await this.logFailedAttempt(username, ip);
            return { success: false, error: 'Invalid username or password' };
        }
        
        if (user.status !== 'active') {
            return { success: false, error: 'Account is ' + user.status };
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            await this.logFailedAttempt(username, ip);
            return { success: false, error: 'Invalid username or password' };
        }
        
        user.lastLogin = new Date().toISOString();
        user.lastIp = ip;
        user.lastUserAgent = userAgent;
        user.loginCount = (user.loginCount || 0) + 1;
        
        await this.updateUser(username, {
            lastLogin: user.lastLogin,
            lastIp: ip,
            lastUserAgent: userAgent,
            loginCount: user.loginCount
        });
        
        await this.clearFailedAttempts(username);
        
        await this.logActivity(username, 'user_login', { ip: ip, userAgent: userAgent });
        
        return {
            success: true,
            username: username,
            role: user.role,
            preferences: user.preferences || {}
        };
    }

    async changePassword(username, oldPassword, newPassword) {
        const user = await this.getUser(username);
        
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        const passwordMatch = await bcrypt.compare(oldPassword, user.password);
        if (!passwordMatch) {
            return { success: false, error: 'Current password is incorrect' };
        }
        
        if (!newPassword || newPassword.length < 4) {
            return { success: false, error: 'New password must be at least 4 characters' };
        }
        
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        const users = await this.readUsers();
        users[username].password = hashedPassword;
        users[username].passwordUpdated = new Date().toISOString();
        
        await this.writeUsers(users);
        
        await this.logActivity(username, 'password_changed', {});
        
        return {
            success: true,
            message: 'Password changed successfully'
        };
    }

    async setRole(username, newRole, changedBy = null) {
        const validRoles = ['admin', 'user', 'viewer'];
        
        if (!validRoles.includes(newRole)) {
            return { success: false, error: 'Invalid role. Valid roles: ' + validRoles.join(', ') };
        }
        
        if (username === (process.env.ADMIN_USER || 'admin') && newRole !== 'admin') {
            return { success: false, error: 'Cannot change the primary admin role' };
        }
        
        const user = await this.getUser(username);
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        if (user.role === 'admin' && newRole !== 'admin') {
            const users = await this.readUsers();
            let adminCount = 0;
            for (const [_, userData] of Object.entries(users)) {
                if (userData.role === 'admin' && userData.status === 'active' && userData.username !== username) {
                    adminCount++;
                }
            }
            if (adminCount === 0) {
                return { success: false, error: 'Cannot demote the last admin user' };
            }
        }
        
        const users = await this.readUsers();
        users[username].role = newRole;
        users[username].roleUpdated = new Date().toISOString();
        users[username].roleUpdatedBy = changedBy;
        
        await this.writeUsers(users);
        
        await this.logActivity(username, 'role_changed', { newRole: newRole, by: changedBy });
        
        return {
            success: true,
            message: `User role updated to ${newRole}`
        };
    }

    async getUserPreferences(username) {
        const user = await this.getUser(username);
        if (!user) {
            return null;
        }
        return user.preferences || {
            theme: 'dark',
            defaultFormat: 'json',
            notifications: true,
            language: 'en'
        };
    }

    async updateUserPreferences(username, preferences) {
        const user = await this.getUser(username);
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        const updatedPreferences = { ...user.preferences, ...preferences };
        
        const users = await this.readUsers();
        users[username].preferences = updatedPreferences;
        
        await this.writeUsers(users);
        
        await this.logActivity(username, 'preferences_updated', { preferences: Object.keys(preferences) });
        
        return {
            success: true,
            preferences: updatedPreferences
        };
    }

    async logActivity(username, action, details = {}) {
        const activity = await this.readActivity();
        
        if (!activity[username]) {
            activity[username] = [];
        }
        
        activity[username].push({
            id: crypto.randomBytes(8).toString('hex'),
            action: action,
            details: details,
            timestamp: new Date().toISOString(),
            timestampMs: Date.now(),
            ip: details.ip || null,
            userAgent: details.userAgent || null
        });
        
        if (activity[username].length > 1000) {
            activity[username] = activity[username].slice(-1000);
        }
        
        await this.writeActivity(activity);
    }

    async readActivity() {
        try {
            return await fs.readJson(this.activityFile);
        } catch (error) {
            return {};
        }
    }

    async writeActivity(activity) {
        await fs.writeJson(this.activityFile, activity, { spaces: 2 });
    }

    async getUserActivity(username, limit = 50, offset = 0) {
        const activity = await this.readActivity();
        const userActivity = activity[username] || [];
        return {
            total: userActivity.length,
            activities: userActivity.slice(-limit - offset, -offset || undefined).reverse()
        };
    }

    async getAllActivity(limit = 100, filter = null) {
        const activity = await this.readActivity();
        const allActivities = [];
        
        for (const [username, activities] of Object.entries(activity)) {
            for (const act of activities) {
                allActivities.push({
                    username: username,
                    ...act
                });
            }
        }
        
        allActivities.sort((a, b) => b.timestampMs - a.timestampMs);
        
        let filtered = allActivities;
        if (filter && filter.action) {
            filtered = filtered.filter(a => a.action === filter.action);
        }
        if (filter && filter.username) {
            filtered = filtered.filter(a => a.username === filter.username);
        }
        
        return filtered.slice(0, limit);
    }

    async logFailedAttempt(username, ip, type = 'login') {
        const activity = await this.readActivity();
        const key = '_failed_attempts';
        
        if (!activity[key]) {
            activity[key] = [];
        }
        
        activity[key].push({
            username: username,
            type: type,
            ip: ip,
            timestamp: new Date().toISOString(),
            timestampMs: Date.now()
        });
        
        if (activity[key].length > 1000) {
            activity[key] = activity[key].slice(-1000);
        }
        
        await this.writeActivity(activity);
    }

    async clearFailedAttempts(username) {
        const activity = await this.readActivity();
        const key = '_failed_attempts';
        
        if (activity[key]) {
            activity[key] = activity[key].filter(attempt => attempt.username !== username);
            await this.writeActivity(activity);
        }
    }

    async getFailedAttempts(username = null, limit = 100) {
        const activity = await this.readActivity();
        const key = '_failed_attempts';
        let attempts = activity[key] || [];
        
        if (username) {
            attempts = attempts.filter(a => a.username === username);
        }
        
        return attempts.slice(-limit).reverse();
    }

    async readSessions() {
        try {
            if (await fs.pathExists(this.sessionsFile)) {
                return await fs.readJson(this.sessionsFile);
            }
        } catch (error) {}
        return {};
    }

    async writeSessions(sessions) {
        await fs.writeJson(this.sessionsFile, sessions, { spaces: 2 });
    }

    async getUserStats() {
        const users = await this.readUsers();
        
        let total = 0;
        let active = 0;
        let admin = 0;
        let user = 0;
        let viewer = 0;
        let todayLogins = 0;
        
        const today = new Date().toDateString();
        
        for (const [username, userData] of Object.entries(users)) {
            total++;
            if (userData.status === 'active') active++;
            if (userData.role === 'admin') admin++;
            if (userData.role === 'user') user++;
            if (userData.role === 'viewer') viewer++;
            
            if (userData.lastLogin && new Date(userData.lastLogin).toDateString() === today) {
                todayLogins++;
            }
        }
        
        const activity = await this.getAllActivity(1000);
        const last24h = activity.filter(a => a.timestampMs > Date.now() - 86400000).length;
        
        return {
            total: total,
            active: active,
            inactive: total - active,
            roles: { admin, user, viewer },
            todayLogins: todayLogins,
            last24hActivity: last24h,
            timestamp: new Date().toISOString()
        };
    }

    async searchUsers(query, options = {}) {
        const users = await this.readUsers();
        const results = [];
        const searchLower = query.toLowerCase();
        
        for (const [username, userData] of Object.entries(users)) {
            if (username.toLowerCase().includes(searchLower)) {
                results.push({
                    username: username,
                    role: userData.role,
                    status: userData.status,
                    lastLogin: userData.lastLogin,
                    email: userData.email,
                    firstName: userData.firstName,
                    lastName: userData.lastName
                });
            } else if (userData.email && userData.email.toLowerCase().includes(searchLower)) {
                results.push({
                    username: username,
                    role: userData.role,
                    status: userData.status,
                    lastLogin: userData.lastLogin,
                    email: userData.email
                });
            }
            
            if (results.length >= (options.limit || 100)) break;
        }
        
        return {
            query: query,
            count: results.length,
            users: results
        };
    }

    async generateResetToken(username) {
        const user = await this.getUser(username);
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000;
        
        const tokens = await this.readTokens();
        tokens[token] = {
            username: username,
            expires: expires,
            created: Date.now()
        };
        
        await this.writeTokens(tokens);
        
        return {
            success: true,
            token: token,
            expires: new Date(expires).toISOString()
        };
    }

    async validateResetToken(token) {
        const tokens = await this.readTokens();
        const tokenData = tokens[token];
        
        if (!tokenData) {
            return { success: false, error: 'Invalid token' };
        }
        
        if (tokenData.expires < Date.now()) {
            delete tokens[token];
            await this.writeTokens(tokens);
            return { success: false, error: 'Token expired' };
        }
        
        return {
            success: true,
            username: tokenData.username
        };
    }

    async resetPassword(token, newPassword) {
        const validation = await this.validateResetToken(token);
        if (!validation.success) {
            return validation;
        }
        
        const username = validation.username;
        
        if (!newPassword || newPassword.length < 4) {
            return { success: false, error: 'Password must be at least 4 characters' };
        }
        
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        const users = await this.readUsers();
        users[username].password = hashedPassword;
        users[username].passwordReset = new Date().toISOString();
        
        await this.writeUsers(users);
        
        const tokens = await this.readTokens();
        delete tokens[token];
        await this.writeTokens(tokens);
        
        await this.logActivity(username, 'password_reset', {});
        
        return {
            success: true,
            message: 'Password reset successfully'
        };
    }

    async readTokens() {
        try {
            if (await fs.pathExists(this.tokensFile)) {
                return await fs.readJson(this.tokensFile);
            }
        } catch (error) {}
        return {};
    }

    async writeTokens(tokens) {
        await fs.writeJson(this.tokensFile, tokens, { spaces: 2 });
    }
}

module.exports = new UserManager();
