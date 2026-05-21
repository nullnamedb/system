// NullName DB - Session Management
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 550+

// ============================================
// SESSION MANAGER CLASS
// ============================================

class SessionManager {
    constructor() {
        this.sessionKey = null;
        this.user = null;
        this.expires = null;
        this.permissions = [];
        this.role = null;
        this.createdAt = null;
        this.lastActivity = null;
        this.refreshTimer = null;
        this.heartbeatInterval = null;
        
        // Configuration
        this.config = {
            storageKey: 'nullname_session',
            storageKeyData: 'nullname_session_data',
            heartbeatIntervalMs: 60000, // 1 minute
            refreshThresholdMs: 300000, // 5 minutes before expiry
            maxInactivityMs: 3600000 // 1 hour
        };
        
        this.init();
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    init() {
        this.load();
        this.startHeartbeat();
        this.startInactivityTimer();
        this.attachEventListeners();
        this.updateUI();
        
        console.log('Session Manager initialized');
    }

    load() {
        try {
            // Load session key
            this.sessionKey = localStorage.getItem(this.config.storageKey);
            
            // Load session data
            const savedData = localStorage.getItem(this.config.storageKeyData);
            if (savedData) {
                const data = JSON.parse(savedData);
                this.user = data.user;
                this.expires = data.expires;
                this.permissions = data.permissions || [];
                this.role = data.role;
                this.createdAt = data.createdAt;
                this.lastActivity = data.lastActivity;
                
                // Check expiration
                if (this.expires && Date.now() > this.expires) {
                    console.log('Session expired');
                    this.clear();
                }
                
                // Check inactivity
                if (this.lastActivity && (Date.now() - this.lastActivity) > this.config.maxInactivityMs) {
                    console.log('Session inactive too long');
                    this.clear();
                }
            }
        } catch (error) {
            console.error('Failed to load session:', error);
            this.clear();
        }
    }

    save() {
        try {
            if (this.sessionKey && this.user) {
                localStorage.setItem(this.config.storageKey, this.sessionKey);
                localStorage.setItem(this.config.storageKeyData, JSON.stringify({
                    user: this.user,
                    expires: this.expires,
                    permissions: this.permissions,
                    role: this.role,
                    createdAt: this.createdAt,
                    lastActivity: this.lastActivity
                }));
            }
        } catch (error) {
            console.error('Failed to save session:', error);
        }
    }

    // ============================================
    // SESSION MANAGEMENT
    // ============================================

    setSession(sessionKey, user, expiresIn = 86400000) {
        this.sessionKey = sessionKey;
        this.user = user;
        this.role = user.role || 'user';
        this.permissions = user.permissions || this.getDefaultPermissions(this.role);
        this.expires = Date.now() + expiresIn;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
        
        this.save();
        this.startRefreshTimer();
        this.updateUI();
        
        // Emit session change event
        this.emitEvent('sessionChange', { 
            authenticated: true, 
            user: this.user,
            role: this.role 
        });
        
        return true;
    }

    clear() {
        this.sessionKey = null;
        this.user = null;
        this.role = null;
        this.permissions = [];
        this.expires = null;
        this.createdAt = null;
        this.lastActivity = null;
        
        localStorage.removeItem(this.config.storageKey);
        localStorage.removeItem(this.config.storageKeyData);
        
        this.stopRefreshTimer();
        this.updateUI();
        
        this.emitEvent('sessionChange', { 
            authenticated: false, 
            user: null 
        });
        
        return true;
    }

    getSessionKey() {
        this.updateActivity();
        return this.sessionKey;
    }

    isLoggedIn() {
        if (!this.sessionKey || !this.user) return false;
        if (this.expires && Date.now() > this.expires) {
            this.clear();
            return false;
        }
        return true;
    }

    isExpired() {
        return this.expires ? Date.now() > this.expires : true;
    }

    getTimeRemaining() {
        if (!this.expires) return 0;
        const remaining = this.expires - Date.now();
        return remaining > 0 ? remaining : 0;
    }

    getTimeRemainingFormatted() {
        const ms = this.getTimeRemaining();
        if (ms <= 0) return 'Expired';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    updateActivity() {
        if (this.isLoggedIn()) {
            this.lastActivity = Date.now();
            this.save();
        }
    }

    // ============================================
    // REFRESH & HEARTBEAT
    // ============================================

    startRefreshTimer() {
        this.stopRefreshTimer();
        
        if (!this.expires) return;
        
        const timeToRefresh = this.expires - Date.now() - this.config.refreshThresholdMs;
        if (timeToRefresh > 0) {
            this.refreshTimer = setTimeout(() => {
                this.refreshSession();
            }, timeToRefresh);
        }
    }

    stopRefreshTimer() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    async refreshSession() {
        if (!this.isLoggedIn()) return;
        
        try {
            const response = await fetch(`/q?q=session.refresh&ses=${this.sessionKey}`);
            const data = await response.json();
            
            if (data.success && data.session) {
                this.setSession(data.session, this.user);
                console.log('Session refreshed');
                this.emitEvent('sessionRefreshed', { timestamp: Date.now() });
            } else {
                console.warn('Session refresh failed, logging out');
                this.clear();
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Session refresh error:', error);
        }
    }

    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isLoggedIn()) {
                this.sendHeartbeat();
            }
        }, this.config.heartbeatIntervalMs);
    }

    async sendHeartbeat() {
        try {
            const response = await fetch(`/q?q=session.heartbeat&ses=${this.sessionKey}`);
            const data = await response.json();
            
            if (!data.success) {
                console.warn('Heartbeat failed, session may be invalid');
                if (data.expired) {
                    this.clear();
                    window.location.href = '/login';
                }
            }
        } catch (error) {
            console.error('Heartbeat error:', error);
        }
    }

    // ============================================
    // INACTIVITY MANAGEMENT
    // ============================================

    startInactivityTimer() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
        
        const resetTimer = () => {
            if (this.isLoggedIn()) {
                this.updateActivity();
            }
        };
        
        events.forEach(event => {
            document.addEventListener(event, resetTimer);
        });
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

    hasPermission(action) {
        if (!this.isLoggedIn()) return false;
        if (this.permissions.includes('*')) return true;
        
        const actionMap = {
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
        
        const required = actionMap[action] || [action];
        return required.some(perm => this.permissions.includes(perm));
    }

    isAdmin() {
        return this.role === 'admin' || this.role === 'root';
    }

    isRoot() {
        return this.role === 'root';
    }

    // ============================================
    // AUTHENTICATION ACTIONS
    // ============================================

    async login(username, password) {
        try {
            const response = await fetch(`/q?q=login.${username}.${password}`);
            const data = await response.json();
            
            if (data.success && data.session) {
                this.setSession(data.session, data.user);
                return { success: true, user: data.user };
            }
            return { success: false, error: data.error || 'Login failed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signup(username, password, role = 'user') {
        try {
            const response = await fetch(`/q?q=signup.${username}.${password}.${role}`);
            const data = await response.json();
            
            if (data.success && data.session) {
                this.setSession(data.session, data.user);
                return { success: true, user: data.user };
            }
            return { success: false, error: data.error || 'Signup failed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async logout() {
        if (this.isLoggedIn()) {
            try {
                await fetch(`/q?q=logout&ses=${this.sessionKey}`);
            } catch (error) {
                console.error('Logout error:', error);
            }
        }
        
        this.clear();
        window.location.href = '/login';
    }

    async changePassword(oldPassword, newPassword) {
        if (!this.isLoggedIn()) {
            return { success: false, error: 'Not logged in' };
        }
        
        try {
            const response = await fetch(`/q?q=user.changepass.${oldPassword}.${newPassword}&ses=${this.sessionKey}`);
            const data = await response.json();
            return data;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // UI INTEGRATION
    // ============================================

    updateUI() {
        const userDisplay = document.getElementById('userDisplay');
        const roleDisplay = document.getElementById('roleDisplay');
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const adminPanel = document.getElementById('adminPanel');
        
        if (this.isLoggedIn() && this.user) {
            if (userDisplay) {
                userDisplay.textContent = this.user.username;
                userDisplay.title = `Role: ${this.role}`;
            }
            if (roleDisplay) roleDisplay.textContent = this.role;
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (loginBtn) loginBtn.style.display = 'none';
            if (adminPanel && this.isAdmin()) adminPanel.style.display = 'block';
        } else {
            if (userDisplay) userDisplay.textContent = 'Guest';
            if (roleDisplay) roleDisplay.textContent = 'guest';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (loginBtn) loginBtn.style.display = 'block';
            if (adminPanel) adminPanel.style.display = 'none';
        }
    }

    // ============================================
    // EVENT HANDLING
    // ============================================

    attachEventListeners() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
        
        // Activity tracking
        document.addEventListener('click', () => this.updateActivity());
        document.addEventListener('keydown', () => this.updateActivity());
    }

    emitEvent(eventName, data) {
        const event = new CustomEvent(eventName, { detail: data });
        window.dispatchEvent(event);
    }

    on(eventName, callback) {
        window.addEventListener(eventName, (event) => callback(event.detail));
    }

    // ============================================
    // TOKEN MANAGEMENT
    // ============================================

    async createApiToken(name, expiresIn = null) {
        if (!this.isLoggedIn()) {
            return { success: false, error: 'Not logged in' };
        }
        
        try {
            let url = `/q?q=token.create.${name}&ses=${this.sessionKey}`;
            if (expiresIn) url += `&expires=${expiresIn}`;
            
            const response = await fetch(url);
            const data = await response.json();
            return data;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async listApiTokens() {
        if (!this.isLoggedIn()) {
            return { success: false, error: 'Not logged in' };
        }
        
        try {
            const response = await fetch(`/q?q=token.list&ses=${this.sessionKey}`);
            const data = await response.json();
            return data;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async revokeApiToken(tokenId) {
        if (!this.isLoggedIn()) {
            return { success: false, error: 'Not logged in' };
        }
        
        try {
            const response = await fetch(`/q?q=token.revoke.${tokenId}&ses=${this.sessionKey}`);
            const data = await response.json();
            return data;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // SESSION INFO
    // ============================================

    getSessionInfo() {
        return {
            authenticated: this.isLoggedIn(),
            user: this.user,
            role: this.role,
            expires: this.expires,
            expiresFormatted: this.expires ? new Date(this.expires).toLocaleString() : null,
            timeRemaining: this.getTimeRemainingFormatted(),
            createdAt: this.createdAt ? new Date(this.createdAt).toLocaleString() : null,
            lastActivity: this.lastActivity ? new Date(this.lastActivity).toLocaleString() : null
        };
    }

    async validateSession() {
        if (!this.isLoggedIn()) return false;
        
        try {
            const response = await fetch(`/q?q=session.validate&ses=${this.sessionKey}`);
            const data = await response.json();
            
            if (data.valid) {
                return true;
            } else {
                this.clear();
                return false;
            }
        } catch (error) {
            return false;
        }
    }
}

// ============================================
// GLOBAL INSTANCE
// ============================================

window.sessionManager = new SessionManager();

// Auto redirect to login if not authenticated and on protected page
document.addEventListener('DOMContentLoaded', () => {
    const protectedPages = ['/dashboard', '/db', '/settings', '/admin'];
    const currentPath = window.location.pathname;
    
    if (protectedPages.includes(currentPath)) {
        if (!window.sessionManager.isLoggedIn()) {
            window.location.href = '/login';
        }
    }
    
    // Login page redirect if already logged in
    if (currentPath === '/login' && window.sessionManager.isLoggedIn()) {
        window.location.href = '/dashboard';
    }
});

// ============================================
// EXPORT
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SessionManager };
}
