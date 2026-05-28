// NullName DB - Base UI Utilities & Global Functions
// No brand. No name. No payment.
// Version: 2.0.0

(function(window) {
    'use strict';

    // ============================================
    // GLOBAL NAMESPACE
    // ============================================
    
    window.NullNameDB = {
        version: '2.0.0',
        name: 'NullName DB',
        tagline: 'No brand. No name. No payment.',
        startTime: Date.now(),
        
        config: {
            apiEndpoint: '/q',
            uploadEndpoint: '/upload',
            sessionTimeout: 86400000,
            debounceDelay: 500,
            throttleDelay: 250
        },
        
        state: {
            isOnline: navigator.onLine,
            isAuthenticated: false,
            currentUser: null,
            currentSession: null
        },
        
        events: new Map(),
        cache: new Map(),
        cacheTimeout: 60000
    };

    // ============================================
    // DOM SELECTION HELPERS
    // ============================================
    
    window.$ = function(selector, parent = document) {
        return parent.querySelector(selector);
    };
    
    window.$$ = function(selector, parent = document) {
        return parent.querySelectorAll(selector);
    };
    
    window.$id = function(id) {
        return document.getElementById(id);
    };
    
    window.$create = function(tag, attributes = {}, children = []) {
        const el = document.createElement(tag);
        for (const [key, val] of Object.entries(attributes)) {
            if (key === 'className') {
                el.className = val;
            } else if (key === 'style' && typeof val === 'object') {
                Object.assign(el.style, val);
            } else if (key.startsWith('on') && typeof val === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), val);
            } else if (key === 'dataset' && typeof val === 'object') {
                Object.assign(el.dataset, val);
            } else {
                el.setAttribute(key, val);
            }
        }
        for (const child of children) {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            } else if (Array.isArray(child)) {
                for (const c of child) {
                    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
                    else if (c instanceof Node) el.appendChild(c);
                }
            }
        }
        return el;
    };

    // ============================================
    // ELEMENT MANIPULATION
    // ============================================
    
    window.showElement = function(el, display = 'block') {
        if (el) el.style.display = display;
    };
    
    window.hideElement = function(el) {
        if (el) el.style.display = 'none';
    };
    
    window.toggleElement = function(el) {
        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    };
    
    window.setVisible = function(el, visible) {
        if (el) el.style.display = visible ? 'block' : 'none';
    };
    
    window.setText = function(el, text) {
        if (el) el.textContent = text;
    };
    
    window.setHtml = function(el, html) {
        if (el) el.innerHTML = html;
    };
    
    window.addClass = function(el, className) {
        if (el) el.classList.add(className);
    };
    
    window.removeClass = function(el, className) {
        if (el) el.classList.remove(className);
    };
    
    window.toggleClass = function(el, className) {
        if (el) el.classList.toggle(className);
    };
    
    window.hasClass = function(el, className) {
        return el ? el.classList.contains(className) : false;
    };
    
    window.emptyElement = function(el) {
        if (el) el.innerHTML = '';
    };
    
    window.removeElement = function(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    };

    // ============================================
    // STORAGE HELPERS
    // ============================================
    
    window.storageSet = function(key, value, session = false) {
        const storage = session ? sessionStorage : localStorage;
        try {
            storage.setItem(key, JSON.stringify(value));
            return true;
        } catch(e) {
            console.error('Storage set error:', e);
            return false;
        }
    };
    
    window.storageGet = function(key, defaultValue = null, session = false) {
        const storage = session ? sessionStorage : localStorage;
        try {
            const item = storage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch(e) {
            console.error('Storage get error:', e);
            return defaultValue;
        }
    };
    
    window.storageRemove = function(key, session = false) {
        const storage = session ? sessionStorage : localStorage;
        storage.removeItem(key);
    };
    
    window.storageClear = function(session = false) {
        const storage = session ? sessionStorage : localStorage;
        storage.clear();
    };

    // ============================================
    // STRING UTILITIES
    // ============================================
    
    window.escapeHtml = function(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };
    
    window.unescapeHtml = function(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.innerHTML = str;
        return div.textContent;
    };
    
    window.truncate = function(str, length = 50, suffix = '...') {
        if (!str) return '';
        if (str.length <= length) return str;
        return str.substring(0, length) + suffix;
    };
    
    window.capitalize = function(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    };
    
    window.slugify = function(str) {
        if (!str) return '';
        return str.toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    };
    
    window.formatNumber = function(num, decimals = 0) {
        if (num === undefined || num === null) return '0';
        return Number(num).toLocaleString(undefined, { 
            minimumFractionDigits: decimals, 
            maximumFractionDigits: decimals 
        });
    };
    
    window.formatBytes = function(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    };
    
    window.formatDuration = function(ms) {
        if (ms < 1000) return `${ms}ms`;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    };
    
    window.formatDate = function(timestamp, format = 'default') {
        const date = new Date(timestamp);
        if (format === 'iso') return date.toISOString();
        if (format === 'date') return date.toLocaleDateString();
        if (format === 'time') return date.toLocaleTimeString();
        if (format === 'datetime') return date.toLocaleString();
        if (format === 'relative') return getRelativeTime(date);
        return date.toLocaleString();
    };
    
    function getRelativeTime(date) {
        const diff = Date.now() - date.getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (seconds < 60) return 'just now';
        if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
        return `${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''} ago`;
    }

    // ============================================
    // URL & API HELPERS
    // ============================================
    
    window.buildApiUrl = function(query, session = null, format = null) {
        let url = `${NullNameDB.config.apiEndpoint}?q=${encodeURIComponent(query)}`;
        if (session) url += `&ses=${session}`;
        if (format && format !== 'json') url += `&format=${format}`;
        return url;
    };
    
    window.getQueryParam = function(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    };
    
    window.getStatusColor = function(status) {
        const colors = {
            success: '#00ff88',
            error: '#ff007f',
            warning: '#ffaa00',
            info: '#00d2ff',
            pending: '#888888'
        };
        return colors[status] || '#00d2ff';
    };

    // ============================================
    // VALIDATION
    // ============================================
    
    window.isValidEmail = function(email) {
        return /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email);
    };
    
    window.isValidUsername = function(username) {
        return /^[a-zA-Z0-9_]{3,20}$/.test(username);
    };
    
    window.isValidPassword = function(password) {
        return password && password.length >= 4;
    };
    
    window.isValidDatabaseName = function(name) {
        return /^[a-zA-Z0-9_]+$/.test(name) && name.length <= 50;
    };
    
    window.isValidTableName = function(name) {
        return /^[a-zA-Z0-9_]+$/.test(name) && name.length <= 50;
    };

    // ============================================
    // CLIPBOARD & DOWNLOAD
    // ============================================
    
    window.copyToClipboard = async function(text) {
        try {
            await navigator.clipboard.writeText(text);
            showNotification('Copied to clipboard', 'success');
            return { success: true };
        } catch (error) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showNotification('Copied to clipboard', 'success');
            return { success: true };
        }
    };
    
    window.downloadFile = function(content, filename, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
    
    window.downloadJson = function(data, filename = 'export.json') {
        downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
    };
    
    window.downloadCsv = function(data, filename = 'export.csv') {
        if (Array.isArray(data) && data.length > 0) {
            const headers = Object.keys(data[0]);
            const rows = data.map(row => headers.map(h => JSON.stringify(row[h] || '')).join(','));
            const csv = [headers.join(','), ...rows].join('\n');
            downloadFile(csv, filename, 'text/csv');
        } else {
            downloadFile('', filename, 'text/csv');
        }
    };

    // ============================================
    // DEBOUNCE & THROTTLE
    // ============================================
    
    window.debounce = function(func, delay = NullNameDB.config.debounceDelay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    };
    
    window.throttle = function(func, limit = NullNameDB.config.throttleDelay) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    };

    // ============================================
    // EVENT SYSTEM
    // ============================================
    
    window.on = function(event, callback) {
        if (!NullNameDB.events.has(event)) {
            NullNameDB.events.set(event, []);
        }
        NullNameDB.events.get(event).push(callback);
    };
    
    window.off = function(event, callback) {
        if (!NullNameDB.events.has(event)) return;
        const listeners = NullNameDB.events.get(event);
        const index = listeners.indexOf(callback);
        if (index !== -1) listeners.splice(index, 1);
    };
    
    window.emit = function(event, data) {
        if (!NullNameDB.events.has(event)) return;
        for (const callback of NullNameDB.events.get(event)) {
            try {
                callback(data);
            } catch(e) {
                console.error(`Event error ${event}:`, e);
            }
        }
    };
    
    window.once = function(event, callback) {
        const wrapper = function(data) {
            callback(data);
            off(event, wrapper);
        };
        on(event, wrapper);
    };

    // ============================================
    // CACHE SYSTEM
    // ============================================
    
    window.cacheSet = function(key, value, ttl = NullNameDB.cacheTimeout) {
        NullNameDB.cache.set(key, { value, expires: Date.now() + ttl });
    };
    
    window.cacheGet = function(key) {
        const cached = NullNameDB.cache.get(key);
        if (!cached) return null;
        if (Date.now() > cached.expires) {
            NullNameDB.cache.delete(key);
            return null;
        }
        return cached.value;
    };
    
    window.cacheDelete = function(key) {
        NullNameDB.cache.delete(key);
    };
    
    window.cacheClear = function() {
        NullNameDB.cache.clear();
    };

    // ============================================
    // NETWORK STATUS
    // ============================================
    
    window.isOnline = function() {
        return NullNameDB.state.isOnline;
    };
    
    window.addEventListener('online', () => {
        NullNameDB.state.isOnline = true;
        emit('online', {});
        showNotification('Connection restored', 'success');
    });
    
    window.addEventListener('offline', () => {
        NullNameDB.state.isOnline = false;
        emit('offline', {});
        showNotification('Connection lost', 'error');
    });

    // ============================================
    // NOTIFICATIONS
    // ============================================
    
    window.showNotification = function(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `toast notification-${type}`;
        notification.innerHTML = `
            <div class="toast-content">
                <i class="fa fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${escapeHtml(message)}</span>
            </div>
        `;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--bg-panel);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border-primary);
            border-radius: var(--radius-md);
            padding: 0.75rem 1.25rem;
            color: ${type === 'error' ? 'var(--accent-error)' : type === 'success' ? 'var(--accent-secondary)' : 'var(--text-primary)'};
            z-index: 3000;
            animation: slideInRight 0.3s ease;
            box-shadow: var(--shadow-lg);
        `;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    };

    // ============================================
    // ERROR HANDLING
    // ============================================
    
    window.handleError = function(error, context = 'unknown') {
        console.error(`Error in ${context}:`, error);
        const message = error.message || 'An unexpected error occurred';
        emit('error', { error, context, message });
        showNotification(message, 'error');
        return { success: false, error: message };
    };
    
    window.retry = async function(fn, maxAttempts = 3, delay = 1000) {
        let lastError;
        for (let i = 0; i < maxAttempts; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (i < maxAttempts - 1) {
                    await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
                }
            }
        }
        throw lastError;
    };

    // ============================================
    // ID GENERATION
    // ============================================
    
    window.generateId = function(prefix = '') {
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        return prefix ? `${prefix}_${id}` : id;
    };
    
    window.generateUuid = function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    };

    // ============================================
    // OBJECT UTILITIES
    // ============================================
    
    window.deepMerge = function(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    };
    
    window.deepClone = function(obj) {
        return JSON.parse(JSON.stringify(obj));
    };
    
    window.unique = function(arr) {
        return [...new Set(arr)];
    };
    
    window.groupBy = function(arr, key) {
        return arr.reduce((result, item) => {
            const groupKey = item[key];
            if (!result[groupKey]) result[groupKey] = [];
            result[groupKey].push(item);
            return result;
        }, {});
    };

    // ============================================
    // DOM READY
    // ============================================
    
    window.ready = function(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    };
    
    window.waitForElement = function(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const check = setInterval(() => {
                const element = $(selector);
                if (element) {
                    clearInterval(check);
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(check);
                    reject(new Error(`Element ${selector} not found within ${timeout}ms`));
                }
            }, 100);
        });
    };

    // ============================================
    // FORM HELPERS
    // ============================================
    
    window.serializeForm = function(form) {
        const data = {};
        const formData = new FormData(form);
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }
        return data;
    };
    
    window.populateForm = function(form, data) {
        for (const [key, value] of Object.entries(data)) {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) input.value = value;
        }
    };
    
    window.resetForm = function(form) {
        form.reset();
    };

    // ============================================
    // CONSOLE STYLES
    // ============================================
    
    window.logSuccess = function(message) {
        console.log('%c✓ ' + message, 'color: #00ff88');
    };
    
    window.logError = function(message) {
        console.log('%c✗ ' + message, 'color: #ff007f');
    };
    
    window.logInfo = function(message) {
        console.log('%cℹ ' + message, 'color: #00d2ff');
    };
    
    window.logWarn = function(message) {
        console.log('%c⚠ ' + message, 'color: #ffaa00');
    };

    // ============================================
    // INITIALIZATION
    // ============================================
    
    window.initBaseUI = function() {
        logInfo(`NullName DB v${NullNameDB.version} initialized`);
        logSuccess('Base UI utilities loaded');
        emit('base:ready', { version: NullNameDB.version });
    };
    
    // Auto-initialize on DOM ready
    ready(initBaseUI);

})(window);
