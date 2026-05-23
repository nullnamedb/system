// NullName DB - Base UI Utilities & Global Functions
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 550+

// ============================================
// GLOBAL UTILITIES
// ============================================

window.NullNameDB = {
    version: '1.0.0',
    name: 'NullName DB',
    tagline: 'No brand. No name. No payment.',
    environment: 'production',
    startTime: Date.now(),
    
    // Configuration
    config: {
        apiEndpoint: '/q',
        uploadEndpoint: '/upload',
        sessionTimeout: 86400000,
        maxHistorySize: 100,
        autoSaveInterval: 30000,
        debounceDelay: 500
    },
    
    // State
    state: {
        isOnline: navigator.onLine,
        isAuthenticated: false,
        currentUser: null,
        currentSession: null,
        lastActivity: Date.now(),
        pendingRequests: 0
    },
    
    // Event listeners
    events: new Map(),
    
    // Cache
    cache: new Map(),
    cacheTimeout: 60000
};

// ============================================
// DOM HELPERS
// ============================================

function $(selector, parent = document) {
    return parent.querySelector(selector);
}

function $$(selector, parent = document) {
    return parent.querySelectorAll(selector);
}

function createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'dataset') {
            Object.assign(element.dataset, value);
        } else {
            element.setAttribute(key, value);
        }
    }
    
    for (const child of children) {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    }
    
    return element;
}

function showElement(element, display = 'block') {
    if (element) element.style.display = display;
}

function hideElement(element) {
    if (element) element.style.display = 'none';
}

function toggleElement(element) {
    if (element) {
        element.style.display = element.style.display === 'none' ? 'block' : 'none';
    }
}

function setText(element, text) {
    if (element) element.textContent = text;
}

function setHtml(element, html) {
    if (element) element.innerHTML = html;
}

function addClass(element, className) {
    if (element) element.classList.add(className);
}

function removeClass(element, className) {
    if (element) element.classList.remove(className);
}

function toggleClass(element, className) {
    if (element) element.classList.toggle(className);
}

function hasClass(element, className) {
    return element ? element.classList.contains(className) : false;
}

// ============================================
// STORAGE HELPERS
// ============================================

function storageSet(key, value, useSession = false) {
    const storage = useSession ? sessionStorage : localStorage;
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error('Storage set failed:', error);
        return false;
    }
}

function storageGet(key, defaultValue = null, useSession = false) {
    const storage = useSession ? sessionStorage : localStorage;
    try {
        const item = storage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
        console.error('Storage get failed:', error);
        return defaultValue;
    }
}

function storageRemove(key, useSession = false) {
    const storage = useSession ? sessionStorage : localStorage;
    storage.removeItem(key);
}

function storageClear(useSession = false) {
    const storage = useSession ? sessionStorage : localStorage;
    storage.clear();
}

// ============================================
// STRING HELPERS
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function unescapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.innerHTML = str;
    return div.textContent;
}

function truncate(str, length = 50, suffix = '...') {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.substring(0, length) + suffix;
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function formatNumber(num, decimals = 0) {
    if (num === undefined || num === null) return '0';
    return Number(num).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

function formatDate(timestamp, format = 'default') {
    const date = new Date(timestamp);
    
    if (format === 'iso') return date.toISOString();
    if (format === 'date') return date.toLocaleDateString();
    if (format === 'time') return date.toLocaleTimeString();
    if (format === 'datetime') return date.toLocaleString();
    if (format === 'relative') return getRelativeTime(date);
    
    return date.toLocaleString();
}

function getRelativeTime(date) {
    const now = Date.now();
    const diff = now - date.getTime();
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (weeks < 4) return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;
    return `${years} year${years !== 1 ? 's' : ''} ago`;
}

// ============================================
// URL HELPERS
// ============================================

function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function setQueryParam(param, value) {
    const url = new URL(window.location.href);
    url.searchParams.set(param, value);
    window.history.pushState({}, '', url);
}

function removeQueryParam(param) {
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.pushState({}, '', url);
}

function buildApiUrl(query, session = null, format = null) {
    let url = `${NullNameDB.config.apiEndpoint}?q=${encodeURIComponent(query)}`;
    if (session) url += `&ses=${session}`;
    if (format && format !== 'json') url += `&format=${format}`;
    return url;
}

// ============================================
// COLOR HELPERS
// ============================================

function getStatusColor(status) {
    const colors = {
        success: '#00ff88',
        error: '#ff007f',
        warning: '#ffaa00',
        info: '#00d2ff',
        pending: '#888888',
        active: '#00ff88',
        inactive: '#888888',
        online: '#00ff88',
        offline: '#ff007f'
    };
    return colors[status] || '#00d2ff';
}

function getRoleColor(role) {
    const colors = {
        admin: '#ff007f',
        editor: '#00d2ff',
        viewer: '#ffaa00',
        user: '#00ff88',
        guest: '#888888',
        root: '#ff00ff'
    };
    return colors[role] || '#00d2ff';
}

function lightenColor(color, percent) {
    // Simple lighten - for production use proper color library
    return color;
}

function darkenColor(color, percent) {
    return color;
}

// ============================================
// VALIDATION HELPERS
// ============================================

function isValidEmail(email) {
    const re = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
    return re.test(email);
}

function isValidUsername(username) {
    const re = /^[a-zA-Z0-9_]{3,20}$/;
    return re.test(username);
}

function isValidPassword(password) {
    return password && password.length >= 4;
}

function isValidDatabaseName(name) {
    const re = /^[a-zA-Z0-9_]+$/;
    return re.test(name) && name.length <= 50;
}

function isValidTableName(name) {
    const re = /^[a-zA-Z0-9_]+$/;
    return re.test(name) && name.length <= 50;
}

function isValidColumnName(name) {
    const re = /^[a-zA-Z0-9_]+$/;
    return re.test(name) && name.length <= 50;
}

// ============================================
// COPY TO CLIPBOARD
// ============================================

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return { success: true };
    } catch (error) {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return { success: true };
    }
}

async function copyFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        return { success: true, text };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// DOWNLOAD HELPERS
// ============================================

function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadJson(data, filename = 'export.json') {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, filename, 'application/json');
}

function downloadCsv(data, filename = 'export.csv') {
    if (!Array.isArray(data) || data.length === 0) {
        downloadFile('', filename, 'text/csv');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => JSON.stringify(row[h] || '').replace(/"/g, '""')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    downloadFile(csv, filename, 'text/csv');
}

// ============================================
// DEBOUNCE & THROTTLE
// ============================================

function debounce(func, delay = NullNameDB.config.debounceDelay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

function throttle(func, limit = 250) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================
// EVENT BUS
// ============================================

function on(event, callback) {
    if (!NullNameDB.events.has(event)) {
        NullNameDB.events.set(event, []);
    }
    NullNameDB.events.get(event).push(callback);
}

function off(event, callback) {
    if (!NullNameDB.events.has(event)) return;
    const listeners = NullNameDB.events.get(event);
    const index = listeners.indexOf(callback);
    if (index !== -1) listeners.splice(index, 1);
}

function emit(event, data) {
    if (!NullNameDB.events.has(event)) return;
    for (const callback of NullNameDB.events.get(event)) {
        try {
            callback(data);
        } catch (error) {
            console.error(`Event handler error for ${event}:`, error);
        }
    }
}

function once(event, callback) {
    const wrapper = (data) => {
        callback(data);
        off(event, wrapper);
    };
    on(event, wrapper);
}

// ============================================
// CACHE HELPERS
// ============================================

function cacheSet(key, value, ttl = NullNameDB.cacheTimeout) {
    NullNameDB.cache.set(key, {
        value: value,
        expires: Date.now() + ttl
    });
}

function cacheGet(key) {
    const cached = NullNameDB.cache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expires) {
        NullNameDB.cache.delete(key);
        return null;
    }
    return cached.value;
}

function cacheDelete(key) {
    NullNameDB.cache.delete(key);
}

function cacheClear() {
    NullNameDB.cache.clear();
}

// ============================================
// ONLINE/OFFLINE HANDLING
// ============================================

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

function isOnline() {
    return NullNameDB.state.isOnline;
}

// ============================================
// ERROR HANDLING
// ============================================

function handleError(error, context = 'unknown') {
    console.error(`Error in ${context}:`, error);
    
    let message = error.message || 'An unexpected error occurred';
    
    if (error.response) {
        message = error.response.data?.error || message;
    } else if (error.request) {
        message = 'Network error - please check your connection';
    }
    
    emit('error', { error, context, message });
    
    return { success: false, error: message };
}

// ============================================
// RETRY UTILITY
// ============================================

async function retry(fn, maxAttempts = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i < maxAttempts; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
    }
    
    throw lastError;
}

// ============================================
// ID GENERATION
// ============================================

function generateId(prefix = '') {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    return prefix ? `${prefix}_${id}` : id;
}

function generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================
// DEEP MERGE
// ============================================

function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    
    return result;
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// ============================================
// ARRAY HELPERS
// ============================================

function unique(arr) {
    return [...new Set(arr)];
}

function groupBy(arr, key) {
    return arr.reduce((result, item) => {
        const groupKey = item[key];
        if (!result[groupKey]) result[groupKey] = [];
        result[groupKey].push(item);
        return result;
    }, {});
}

function sortBy(arr, key, order = 'asc') {
    return [...arr].sort((a, b) => {
        let aVal = a[key];
        let bVal = b[key];
        
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        
        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
    });
}

// ============================================
// EXPORT
// ============================================

// Make utilities globally available
window.$ = $;
window.$$ = $$;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.formatBytes = formatBytes;
window.copyToClipboard = copyToClipboard;
window.downloadFile = downloadFile;
window.on = on;
window.emit = emit;
window.retry = retry;
window.generateId = generateId;
window.deepClone = deepClone;

console.log('NullName DB Base Utilities Loaded');
