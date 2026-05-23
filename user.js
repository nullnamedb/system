// NullName DB - User Management System
// No brand. No name. No payment.
// Version: 1.0.0

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
                await fs.writeJson(file, {});
            }
        }
    }

    async createDefaultAdmin() {
        const users = await this.readUsers();
        const adminUsername = process.env.ADMIN_USER || 'admin';
        
        if (!users[adminUsername]) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASS || 'nullname2025', saltRounds);
            
            users[adminUsername] = {
                username: adminUsername,
                password: hashedPassword,
                role: 'admin',
                status: 'active',
                created: new Date().toISOString(),
                createdBy: 'system',
                lastLogin: null,
                lastIp: null,
                loginCount: 0
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
                loginCount: data.loginCount
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
            lastLogin: null,
            lastIp: null,
            lastUserAgent: null,
            loginCount: 0
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
            role: user.role
        };
    }

    async updateUser(username, updates) {
        const users = await this.readUsers();
        
        if (!users[username]) {
            return { success: false, error: 'User not found' };
        }
        
        const allowedUpdates = ['role', 'status', 'lastLogin', 'lastIp', 'lastUserAgent', 'loginCount'];
        
        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                users[username][key] = updates[key];
            }
        }
        
        users[username].updated = new Date().toISOString();
        users[username].updatedBy = updates.updatedBy || null;
        
        await this.writeUsers(users);
        
        await this.logActivity(username, 'user_updated', { updates: Object.keys(updates), by: updates.updatedBy });
        
        return {
            success: true,
            message: 'User updated successfully'
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
        
        return await this.updateUser(username, { role: newRole, updatedBy: changedBy });
    }

    async logActivity(username, action, details = {}) {
        const activity = await this.readActivity();
        
        if (!activity[username]) {
            activity[username] = [];
        }
        
        activity[username].push({
            action: action,
            details: details,
            timestamp: new Date().toISOString(),
            ip: details.ip || null
        });
        
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
        for (const username in activity) {
            if (activity[username] && activity[username].length > 1000) {
                activity[username] = activity[username].slice(-1000);
            }
        }
        await fs.writeJson(this.activityFile, activity, { spaces: 2 });
    }

    async getUserActivity(username, limit = 50) {
        const activity = await this.readActivity();
        const userActivity = activity[username] || [];
        return userActivity.slice(-limit).reverse();
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
            timestamp: new Date().toISOString()
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

    async getUserStats() {
        const users = await this.readUsers();
        
        let total = 0;
        let active = 0;
        let admin = 0;
        let user = 0;
        let viewer = 0;
        let todayLogins = 0;
        
        const today = new Date().toDateString();
        
        for (const [_, userData] of Object.entries(users)) {
            total++;
            if (userData.status === 'active') active++;
            if (userData.role === 'admin') admin++;
            if (userData.role === 'user') user++;
            if (userData.role === 'viewer') viewer++;
            
            if (userData.lastLogin && new Date(userData.lastLogin).toDateString() === today) {
                todayLogins++;
            }
        }
        
        return {
            total: total,
            active: active,
            inactive: total - active,
            roles: { admin, user, viewer },
            todayLogins: todayLogins
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
                    lastLogin: userData.lastLogin
                });
            }
            
            if (results.length >= (options.limit || 100)) break;
        }
        
        return results;
    }
}

module.exports = new UserManager();