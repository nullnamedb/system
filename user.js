// NullName DB - User Management System
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 550+

const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ============================================
// USER MANAGEMENT CLASS
// ============================================

class UserManager {
    constructor() {
        this.usersFile = path.join(__dirname, 'database', 'users.json');
        this.profilesFile = path.join(__dirname, 'database', 'profiles.json');
        this.activityFile = path.join(__dirname, 'database', 'user_activity.json');
        this.settingsFile = path.join(__dirname, 'database', 'user_settings.json');
        this.tokensFile = path.join(__dirname, 'database', 'user_tokens.json');
        
        // Cache
        this.userCache = new Map();
        this.cacheTimeout = 60000; // 1 minute
        
        // Initialize
        this.init();
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async init() {
        await this.ensureFiles();
        await this.createDefaultAdmin();
        await this.loadCache();
        
        // Start cache cleanup interval
        setInterval(() => {
            this.cleanupCache();
        }, 300000); // 5 minutes
        
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
                email: null,
                created: new Date().toISOString(),
                createdBy: 'system',
                lastLogin: null,
                lastIp: null,
                lastUserAgent: null,
                loginCount: 0,
                passwordChanged: null,
                passwordResetToken: null,
                passwordResetExpires: null,
                twoFactorEnabled: false,
                twoFactorSecret: null,
                permissions: ['*'],
                notes: 'Default system administrator'
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

    // ============================================
    // FILE OPERATIONS
    // ============================================

    async readUsers() {
        try {
            return await fs.readJson(this.usersFile);
        } catch (error) {
            return {};
        }
    }

    async writeUsers(users) {
        await fs.writeJson(this.usersFile, users, { spaces: 2 });
        // Update cache
        for (const [username, userData] of Object.entries(users)) {
            this.userCache.set(username, {
                data: userData,
                cached: Date.now()
            });
        }
    }

    async readProfiles() {
        try {
            return await fs.readJson(this.profilesFile);
        } catch (error) {
            return {};
        }
    }

    async writeProfiles(profiles) {
        await fs.writeJson(this.profilesFile, profiles, { spaces: 2 });
    }

    async readActivity() {
        try {
            return await fs.readJson(this.activityFile);
        } catch (error) {
            return {};
        }
    }

    async writeActivity(activity) {
        // Keep only last 1000 activities per user
        for (const username in activity) {
            if (activity[username] && activity[username].length > 1000) {
                activity[username] = activity[username].slice(-1000);
            }
        }
        await fs.writeJson(this.activityFile, activity, { spaces: 2 });
    }

    async readSettings() {
        try {
            return await fs.readJson(this.settingsFile);
        } catch (error) {
            return {};
        }
    }

    async writeSettings(settings) {
        await fs.writeJson(this.settingsFile, settings, { spaces: 2 });
    }

    async readTokens() {
        try {
            return await fs.readJson(this.tokensFile);
        } catch (error) {
            return {};
        }
    }

    async writeTokens(tokens) {
        // Clean expired tokens
        const now = Date.now();
        for (const [token, data] of Object.entries(tokens)) {
            if (data.expires && data.expires < now) {
                delete tokens[token];
            }
        }
        await fs.writeJson(this.tokensFile, tokens, { spaces: 2 });
    }

    // ============================================
    // USER CRUD OPERATIONS
    // ============================================

    async getUser(username) {
        // Check cache first
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
                email: data.email,
                created: data.created,
                createdBy: data.createdBy,
                lastLogin: data.lastLogin,
                lastIp: data.lastIp,
                loginCount: data.loginCount,
                twoFactorEnabled: data.twoFactorEnabled || false
            });
        }
        
        // Sort by created date
        userList.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        return userList;
    }

    async createUser(username, password, options = {}) {
        // Validation
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
            email: options.email || null,
            created: new Date().toISOString(),
            createdBy: options.createdBy || 'system',
            lastLogin: null,
            lastIp: null,
            lastUserAgent: null,
            loginCount: 0,
            passwordChanged: null,
            passwordResetToken: null,
            passwordResetExpires: null,
            twoFactorEnabled: false,
            twoFactorSecret: null,
            permissions: this.getDefaultPermissions(options.role || 'user'),
            notes: options.notes || null
        };
        
        users[username] = newUser;
        await this.writeUsers(users);
        
        // Create default profile
        await this.createProfile(username, {
            fullName: options.fullName || null,
            avatar: options.avatar || null,
            bio: options.bio || null,
            website: options.website || null,
            location: options.location || null
        });
        
        // Create default settings
        await this.createSettings(username);
        
        // Log activity
        await this.logActivity(username, 'user_created', { by: options.createdBy || 'system' });
        
        return {
            success: true,
            username: username,
            role: newUser.role,
            message: 'User created successfully'
        };
    }

    async updateUser(username, updates) {
        const users = await this.readUsers();
        
        if (!users[username]) {
            return { success: false, error: 'User not found' };
        }
        
        const allowedUpdates = [
            'role', 'status', 'email', 'password', 'notes',
            'twoFactorEnabled', 'twoFactorSecret', 'permissions'
        ];
        
        let passwordChanged = false;
        
        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                if (key === 'password') {
                    const saltRounds = 10;
                    users[username][key] = await bcrypt.hash(updates[key], saltRounds);
                    users[username].passwordChanged = new Date().toISOString();
                    passwordChanged = true;
                } else {
                    users[username][key] = updates[key];
                }
            }
        }
        
        users[username].updated = new Date().toISOString();
        users[username].updatedBy = updates.updatedBy || null;
        
        await this.writeUsers(users);
        
        // Log activity
        await this.logActivity(username, 'user_updated', { updates: Object.keys(updates), by: updates.updatedBy });
        
        return {
            success: true,
            message: 'User updated successfully',
            passwordChanged: passwordChanged
        };
    }

    async deleteUser(username, deletedBy = null) {
        // Prevent deleting the last admin
        if (username === (process.env.ADMIN_USER || 'admin')) {
            return { success: false, error: 'Cannot delete the primary admin user' };
        }
        
        const users = await this.readUsers();
        
        if (!users[username]) {
            return { success: false, error: 'User not found' };
        }
        
        // Check if there's at least one admin left
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
        
        // Archive user data before deletion
        const archivedUser = { ...users[username] };
        delete archivedUser.password;
        
        await this.logActivity(username, 'user_deleted', { by: deletedBy, archived: archivedUser });
        
        // Delete user
        delete users[username];
        await this.writeUsers(users);
        
        // Delete profile
        await this.deleteProfile(username);
        
        // Delete settings
        await this.deleteSettings(username);
        
        // Delete all tokens
        await this.deleteAllUserTokens(username);
        
        return {
            success: true,
            message: 'User deleted successfully'
        };
    }

    // ============================================
    // AUTHENTICATION
    // ============================================

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
        
        // Update login stats
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
        
        // Clear failed attempts
        await this.clearFailedAttempts(username);
        
        // Log activity
        await this.logActivity(username, 'user_login', { ip: ip, userAgent: userAgent });
        
        return {
            success: true,
            username: username,
            role: user.role,
            permissions: user.permissions,
            twoFactorRequired: user.twoFactorEnabled || false
        };
    }

    async changePassword(username, oldPassword, newPassword, changedBy = null) {
        const user = await this.getUser(username);
        
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        // If not admin changing someone else's password, verify old password
        if (!changedBy || changedBy !== username) {
            const passwordMatch = await bcrypt.compare(oldPassword, user.password);
            if (!passwordMatch) {
                await this.logFailedAttempt(username, null, 'password_change');
                return { success: false, error: 'Current password is incorrect' };
            }
        }
        
        if (!newPassword || newPassword.length < 4) {
            return { success: false, error: 'New password must be at least 4 characters' };
        }
        
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        await this.updateUser(username, {
            password: hashedPassword,
            passwordChanged: new Date().toISOString(),
            passwordChangedBy: changedBy || username,
            passwordResetToken: null,
            passwordResetExpires: null
        });
        
        // Log activity
        await this.logActivity(username, 'password_changed', { by: changedBy || username });
        
        return { success: true, message: 'Password changed successfully' };
    }

    async generatePasswordResetToken(username) {
        const user = await this.getUser(username);
        
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000; // 1 hour
        
        await this.updateUser(username, {
            passwordResetToken: token,
            passwordResetExpires: expires
        });
        
        return { success: true, token: token, expires: expires };
    }

    async resetPasswordWithToken(token, newPassword) {
        const users = await this.readUsers();
        
        let foundUser = null;
        let foundUsername = null;
        
        for (const [username, userData] of Object.entries(users)) {
            if (userData.passwordResetToken === token && userData.passwordResetExpires > Date.now()) {
                foundUser = userData;
                foundUsername = username;
                break;
            }
        }
        
        if (!foundUser) {
            return { success: false, error: 'Invalid or expired reset token' };
        }
        
        if (!newPassword || newPassword.length < 4) {
            return { success: false, error: 'Password must be at least 4 characters' };
        }
        
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        foundUser.password = hashedPassword;
        foundUser.passwordChanged = new Date().toISOString();
        foundUser.passwordResetToken = null;
        foundUser.passwordResetExpires = null;
        
        users[foundUsername] = foundUser;
        await this.writeUsers(users);
        
        // Log activity
        await this.logActivity(foundUsername, 'password_reset', {});
        
        return { success: true, message: 'Password reset successfully' };
    }

    // ============================================
    // USER PROFILE
    // ============================================

    async createProfile(username, profileData) {
        const profiles = await this.readProfiles();
        
        profiles[username] = {
            username: username,
            fullName: profileData.fullName || null,
            avatar: profileData.avatar || null,
            bio: profileData.bio || null,
            website: profileData.website || null,
            location: profileData.location || null,
            social: profileData.social || {},
            preferences: profileData.preferences || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        await this.writeProfiles(profiles);
        return { success: true };
    }

    async getProfile(username) {
        const profiles = await this.readProfiles();
        return profiles[username] || null;
    }

    async updateProfile(username, updates) {
        const profiles = await this.readProfiles();
        
        if (!profiles[username]) {
            await this.createProfile(username, updates);
            return { success: true };
        }
        
        const allowedUpdates = ['fullName', 'avatar', 'bio', 'website', 'location', 'social', 'preferences'];
        
        for (const key of allowedUpdates) {
            if (updates[key] !== undefined) {
                profiles[username][key] = updates[key];
            }
        }
        
        profiles[username].updatedAt = new Date().toISOString();
        
        await this.writeProfiles(profiles);
        
        return { success: true };
    }

    async deleteProfile(username) {
        const profiles = await this.readProfiles();
        
        if (profiles[username]) {
            delete profiles[username];
            await this.writeProfiles(profiles);
        }
        
        return { success: true };
    }

    // ============================================
    // USER SETTINGS
    // ============================================

    async createSettings(username) {
        const settings = await this.readSettings();
        
        settings[username] = {
            username: username,
            theme: 'dark',
            language: 'en',
            notifications: {
                email: true,
                push: false
            },
            privacy: {
                profilePublic: true,
                showEmail: false
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        await this.writeSettings(settings);
        return { success: true };
    }

    async getSettings(username) {
        const settings = await this.readSettings();
        return settings[username] || null;
    }

    async updateSettings(username, updates) {
        const settings = await this.readSettings();
        
        if (!settings[username]) {
            await this.createSettings(username);
            return await this.updateSettings(username, updates);
        }
        
        const mergeDeep = (target, source) => {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!target[key]) target[key] = {};
                    mergeDeep(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
            return target;
        };
        
        settings[username] = mergeDeep(settings[username], updates);
        settings[username].updatedAt = new Date().toISOString();
        
        await this.writeSettings(settings);
        
        return { success: true };
    }

    async deleteSettings(username) {
        const settings = await this.readSettings();
        
        if (settings[username]) {
            delete settings[username];
            await this.writeSettings(settings);
        }
        
        return { success: true };
    }

    // ============================================
    // TOKEN MANAGEMENT
    // ============================================

    async createToken(username, type, expiresIn = 86400000) {
        const tokens = await this.readTokens();
        const token = crypto.randomBytes(32).toString('hex');
        
        tokens[token] = {
            username: username,
            type: type,
            created: Date.now(),
            expires: Date.now() + expiresIn,
            lastUsed: null
        };
        
        await this.writeTokens(tokens);
        
        return { success: true, token: token };
    }

    async validateToken(token, type) {
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
        
        if (tokenData.type !== type) {
            return { success: false, error: 'Invalid token type' };
        }
        
        // Update last used
        tokenData.lastUsed = Date.now();
        tokens[token] = tokenData;
        await this.writeTokens(tokens);
        
        return {
            success: true,
            username: tokenData.username,
            tokenData: tokenData
        };
    }

    async revokeToken(token) {
        const tokens = await this.readTokens();
        
        if (tokens[token]) {
            delete tokens[token];
            await this.writeTokens(tokens);
            return { success: true };
        }
        
        return { success: false, error: 'Token not found' };
    }

    async deleteAllUserTokens(username) {
        const tokens = await this.readTokens();
        let deleted = 0;
        
        for (const [token, data] of Object.entries(tokens)) {
            if (data.username === username) {
                delete tokens[token];
                deleted++;
            }
        }
        
        if (deleted > 0) {
            await this.writeTokens(tokens);
        }
        
        return { success: true, deleted: deleted };
    }

    // ============================================
    // ACTIVITY LOGGING
    // ============================================

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
        
        // Keep only last 1000 failed attempts
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

    // ============================================
    // PERMISSIONS
    // ============================================

    getDefaultPermissions(role) {
        const permissions = {
            'root': ['*'],
            'admin': ['read', 'write', 'delete', 'create', 'manage_users', 'manage_system', 'backup', 'restore', 'force'],
            'editor': ['read', 'write', 'update', 'create', 'backup'],
            'viewer': ['read'],
            'user': ['read', 'write', 'update']
        };
        
        return permissions[role] || permissions['user'];
    }

    async hasPermission(username, action) {
        const user = await this.getUser(username);
        
        if (!user) return false;
        
        if (user.permissions && user.permissions.includes('*')) {
            return true;
        }
        
        const actionPermissions = {
            'read': ['read', 'write', 'update', 'delete', 'create'],
            'write': ['write', 'update', 'delete', 'create'],
            'update': ['update', 'write'],
            'delete': ['delete'],
            'create': ['create'],
            'manage_users': ['manage_users'],
            'manage_system': ['manage_system'],
            'backup': ['backup'],
            'restore': ['restore'],
            'force': ['force']
        };
        
        const required = actionPermissions[action] || [action];
        
        for (const perm of required) {
            if (user.permissions && user.permissions.includes(perm)) {
                return true;
            }
        }
        
        return false;
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
        
        const user = await this.getUser(username);
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        // Check admin count before demoting
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
        
        return await this.updateUser(username, {
            role: newRole,
            permissions: this.getDefaultPermissions(newRole),
            updatedBy: changedBy
        });
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getUserStats() {
        const users = await this.readUsers();
        
        let total = 0;
        let active = 0;
        let admin = 0;
        let editor = 0;
        let viewer = 0;
        let user = 0;
        let todayLogins = 0;
        
        const today = new Date().toDateString();
        
        for (const [_, userData] of Object.entries(users)) {
            total++;
            if (userData.status === 'active') active++;
            if (userData.role === 'admin') admin++;
            if (userData.role === 'editor') editor++;
            if (userData.role === 'viewer') viewer++;
            if (userData.role === 'user') user++;
            
            if (userData.lastLogin && new Date(userData.lastLogin).toDateString() === today) {
                todayLogins++;
            }
        }
        
        return {
            total: total,
            active: active,
            inactive: total - active,
            roles: { admin, editor, viewer, user },
            todayLogins: todayLogins
        };
    }

    // ============================================
    // SEARCH
    // ============================================

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
                    email: userData.email,
                    lastLogin: userData.lastLogin
                });
            } else if (userData.email && userData.email.toLowerCase().includes(searchLower)) {
                results.push({
                    username: username,
                    role: userData.role,
                    status: userData.status,
                    email: userData.email,
                    lastLogin: userData.lastLogin
                });
            }
            
            if (results.length >= (options.limit || 100)) break;
        }
        
        return results;
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new UserManager();
