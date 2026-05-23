// NullName DB - Base UI Utilities & Global Functions
// No brand. No name. No payment.
// Version: 1.0.0

window.NullNameDB = {
    version: '1.0.0',
    name: 'NullName DB',
    tagline: 'No brand. No name. No payment.',
    startTime: Date.now(),
    
    config: {
        apiEndpoint: '/q',
        uploadEndpoint: '/upload',
        sessionTimeout: 86400000,
        debounceDelay: 500
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

function $(selector, parent = document) { return parent.querySelector(selector); }
function $$(selector, parent = document) { return parent.querySelectorAll(selector); }

function createElement(tag, attributes = {}, children = []) {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(attributes)) {
        if (key === 'className') el.className = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val);
        else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
        else el.setAttribute(key, val);
    }
    for (const child of children) {
        if (typeof child === 'string') el.appendChild(document.createTextNode(child));
        else if (child instanceof Node) el.appendChild(child);
    }
    return el;
}

function showElement(el, display = 'block') { if (el) el.style.display = display; }
function hideElement(el) { if (el) el.style.display = 'none'; }
function toggleElement(el) { if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
function setText(el, text) { if (el) el.textContent = text; }
function setHtml(el, html) { if (el) el.innerHTML = html; }
function addClass(el, className) { if (el) el.classList.add(className); }
function removeClass(el, className) { if (el) el.classList.remove(className); }
function toggleClass(el, className) { if (el) el.classList.toggle(className); }

function storageSet(key, value, session = false) {
    const storage = session ? sessionStorage : localStorage;
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch(e) { return false; }
}

function storageGet(key, defaultValue = null, session = false) {
    const storage = session ? sessionStorage : localStorage;
    try { const item = storage.getItem(key); return item ? JSON.parse(item) : defaultValue; } catch(e) { return defaultValue; }
}

function storageRemove(key, session = false) {
    const storage = session ? sessionStorage : localStorage;
    storage.removeItem(key);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
    return str.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function formatNumber(num, decimals = 0) {
    if (num === undefined || num === null) return '0';
    return Number(num).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
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

function buildApiUrl(query, session = null, format = null) {
    let url = `${NullNameDB.config.apiEndpoint}?q=${encodeURIComponent(query)}`;
    if (session) url += `&ses=${session}`;
    if (format && format !== 'json') url += `&format=${format}`;
    return url;
}

function getStatusColor(status) {
    const colors = { success: '#00ff88', error: '#ff007f', warning: '#ffaa00', info: '#00d2ff', pending: '#888888' };
    return colors[status] || '#00d2ff';
}

function isValidEmail(email) { return /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email); }
function isValidUsername(username) { return /^[a-zA-Z0-9_]{3,20}$/.test(username); }
function isValidPassword(password) { return password && password.length >= 4; }
function isValidDatabaseName(name) { return /^[a-zA-Z0-9_]+$/.test(name) && name.length <= 50; }

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return { success: true };
    } catch (error) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return { success: true };
    }
}

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
    downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
}

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

function on(event, callback) {
    if (!NullNameDB.events.has(event)) NullNameDB.events.set(event, []);
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
        try { callback(data); } catch(e) { console.error(`Event error ${event}:`, e); }
    }
}

function cacheSet(key, value, ttl = NullNameDB.cacheTimeout) {
    NullNameDB.cache.set(key, { value, expires: Date.now() + ttl });
}

function cacheGet(key) {
    const cached = NullNameDB.cache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expires) { NullNameDB.cache.delete(key); return null; }
    return cached.value;
}

function cacheDelete(key) { NullNameDB.cache.delete(key); }
function cacheClear() { NullNameDB.cache.clear(); }

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

function isOnline() { return NullNameDB.state.isOnline; }

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `<div class="notification-content">${escapeHtml(message)}</div>`;
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
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 4000);
}

function handleError(error, context = 'unknown') {
    console.error(`Error in ${context}:`, error);
    const message = error.message || 'An unexpected error occurred';
    emit('error', { error, context, message });
    showNotification(message, 'error');
    return { success: false, error: message };
}

async function retry(fn, maxAttempts = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < maxAttempts; i++) {
        try { return await fn(); }
        catch (error) { lastError = error; if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delay * Math.pow(2, i))); }
    }
    throw lastError;
}

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

function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else { result[key] = source[key]; }
    }
    return result;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function unique(arr) { return [...new Set(arr)]; }

function groupBy(arr, key) {
    return arr.reduce((result, item) => {
        const groupKey = item[key];
        if (!result[groupKey]) result[groupKey] = [];
        result[groupKey].push(item);
        return result;
    }, {});
}

window.$ = $;
window.$$ = $$;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.formatBytes = formatBytes;
window.copyToClipboard = copyToClipboard;
window.showNotification = showNotification;
window.on = on;
window.emit = emit;
window.retry = retry;
window.generateId = generateId;
window.deepClone = deepClone;

console.log('NullName DB Base Utilities Loaded');
