// NullName DB - Main Application UI
// No brand. No name. No payment.
// Version: 1.0.0

let currentUser = null;
let currentSession = null;
let currentView = 'dashboard';
let queryHistory = [];
let queryResults = null;
let currentFormat = 'json';
let currentTheme = 'dark';

const elements = {};

document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    loadUserPreferences();
    await checkSession();
    await loadDashboardStats();
    await loadQueryHistory();
    initEventListeners();
    initKeyboardShortcuts();
    startHealthCheck();
    updateUI();
    console.log('NullName DB UI Initialized');
});

function cacheElements() {
    elements.queryInput = document.getElementById('queryInput');
    elements.runBtn = document.getElementById('runQueryBtn');
    elements.resultsPre = document.getElementById('resultsPre');
    elements.resultsArea = document.getElementById('resultsContent');
    elements.statusMsg = document.getElementById('statusMsg');
    elements.timeMsg = document.getElementById('timeMsg');
    elements.userDisplay = document.getElementById('userName');
    elements.userAvatar = document.getElementById('userAvatar');
    elements.formatSelect = document.getElementById('formatSelect');
    elements.refreshBtn = document.getElementById('refreshBtn');
    elements.clearBtn = document.getElementById('clearResultsBtn');
    elements.copyBtn = document.getElementById('copyResultsBtn');
    elements.logoutBtn = document.getElementById('logoutBtn');
    elements.createBackupBtn = document.getElementById('createBackupBtn');
    elements.saveSettingsBtn = document.getElementById('saveSettingsBtn');
}

function loadUserPreferences() {
    const savedTheme = localStorage.getItem('nullname_theme');
    if (savedTheme) { currentTheme = savedTheme; applyTheme(currentTheme); }
    const savedFormat = localStorage.getItem('nullname_format');
    if (savedFormat) { currentFormat = savedFormat; if (elements.formatSelect) elements.formatSelect.value = currentFormat; }
}

function saveUserPreferences() {
    localStorage.setItem('nullname_theme', currentTheme);
    localStorage.setItem('nullname_format', currentFormat);
}

function applyTheme(theme) {
    if (theme === 'light') document.body.classList.add('light-theme');
    else document.body.classList.remove('light-theme');
    currentTheme = theme;
    saveUserPreferences();
}

async function checkSession() {
    const sessionKey = localStorage.getItem('nullname_session');
    if (!sessionKey) { redirectToLogin(); return false; }
    try {
        const response = await fetch(`/q?q=status&ses=${sessionKey}`);
        const data = await response.json();
        if (data.status === 'online') {
            currentUser = { username: 'admin', role: 'admin' };
            currentSession = sessionKey;
            updateUserDisplay();
            return true;
        } else { logout(); return false; }
    } catch (error) { console.error('Session check:', error); return false; }
}

function redirectToLogin() { window.location.href = '/login'; }

async function logout() {
    if (currentSession) try { await fetch(`/q?q=logout&ses=${currentSession}`); } catch(e) {}
    localStorage.removeItem('nullname_session');
    localStorage.removeItem('nullname_user');
    currentUser = null;
    currentSession = null;
    redirectToLogin();
}

function updateUserDisplay() {
    if (elements.userDisplay && currentUser) {
        elements.userDisplay.textContent = currentUser.username || 'Guest';
        if (elements.userAvatar) elements.userAvatar.textContent = (currentUser.username || 'G')[0].toUpperCase();
    }
}

async function executeQuery() {
    const query = elements.queryInput?.value.trim();
    if (!query) { showNotification('Please enter a query', 'warning'); return; }
    
    showLoading(true);
    updateStatus('Executing query...', 'info');
    const startTime = Date.now();
    
    try {
        let url = `/q?q=${encodeURIComponent(query)}`;
        if (currentSession) url += `&ses=${currentSession}`;
        if (currentFormat && currentFormat !== 'json') url += `&format=${currentFormat}`;
        
        const response = await fetch(url);
        const elapsed = Date.now() - startTime;
        updateTimeDisplay(elapsed);
        
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/csv')) {
            const csvText = await response.text();
            displayResults(csvText, 'csv');
        } else if (contentType.includes('text/plain')) {
            const textData = await response.text();
            displayResults(textData, 'text');
        } else {
            const jsonData = await response.json();
            queryResults = jsonData;
            displayResults(jsonData, 'json');
        }
        
        updateStatus(response.ok ? 'Success' : 'Error', response.ok ? 'success' : 'error');
        addToHistory(query, response.ok, elapsed);
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
        displayResults({ error: error.message }, 'json');
        addToHistory(query, false, 0);
    } finally { showLoading(false); }
}

function displayResults(data, format) {
    if (!elements.resultsArea) return;
    const pre = document.createElement('pre');
    pre.className = 'results-pre';
    if (format === 'csv' || format === 'text') pre.textContent = data;
    else pre.textContent = JSON.stringify(data, null, 2);
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    elements.resultsArea.innerHTML = '';
    elements.resultsArea.appendChild(pre);
}

function showLoading(show) {
    if (elements.runBtn) {
        elements.runBtn.disabled = show;
        elements.runBtn.innerHTML = show ? '<i class="fa fa-spinner fa-spin"></i> Running...' : '<i class="fa fa-play"></i> Run Query';
    }
}

function updateStatus(message, type) {
    if (elements.statusMsg) {
        elements.statusMsg.innerHTML = `<i class="fa fa-circle" style="color: ${type === 'error' ? 'var(--accent-error)' : type === 'success' ? 'var(--accent-success)' : 'var(--accent-primary)'}; font-size: 0.6rem;"></i> ${message}`;
        setTimeout(() => {
            if (elements.statusMsg.innerHTML.includes(message)) 
                elements.statusMsg.innerHTML = '<i class="fa fa-circle" style="color: var(--accent-success); font-size: 0.6rem;"></i> Connected';
        }, 3000);
    }
}

function updateTimeDisplay(elapsed) { if (elements.timeMsg) elements.timeMsg.textContent = `${elapsed}ms`; }

async function loadQueryHistory() {
    try {
        const response = await fetch(`/q?q=track&ses=${currentSession}&limit=20`);
        const data = await response.json();
        if (data.tracks) queryHistory = data.tracks;
    } catch (error) { console.error('Failed to load history:', error); }
}

function addToHistory(query, success, duration) {
    queryHistory.unshift({ query: query.substring(0, 100), success, timestamp: Date.now(), duration });
    if (queryHistory.length > 50) queryHistory = queryHistory.slice(0, 50);
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`/q?q=stats&ses=${currentSession}`);
        const stats = await response.json();
        if (stats.database) {
            if (document.getElementById('statDatabases')) document.getElementById('statDatabases').textContent = stats.database.databases || 0;
            if (document.getElementById('statTables')) document.getElementById('statTables').textContent = stats.database.tables || 0;
            if (document.getElementById('statRecords')) document.getElementById('statRecords').textContent = stats.database.records || 0;
            if (document.getElementById('statStorage')) document.getElementById('statStorage').textContent = stats.database.totalSizeMB || '0';
            if (document.getElementById('statUptime')) document.getElementById('statUptime').textContent = stats.uptime?.human || '0s';
            if (document.getElementById('statVersion')) document.getElementById('statVersion').textContent = '1.0.0';
        }
    } catch (error) { console.error('Failed to load stats:', error); }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `<div class="notification-content">${escapeHtml(message)}</div>`;
    notification.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: var(--bg-panel); backdrop-filter: blur(20px);
        border: 1px solid var(--border-primary); border-radius: var(--radius-md);
        padding: 0.75rem 1.25rem;
        color: ${type === 'error' ? 'var(--accent-error)' : type === 'success' ? 'var(--accent-secondary)' : 'var(--text-primary)'};
        z-index: 3000; animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 4000);
}

function copyResults() {
    const content = elements.resultsArea?.querySelector('pre')?.textContent;
    if (content) { navigator.clipboard.writeText(content); showNotification('Copied!', 'success'); }
}

function clearResults() {
    if (elements.resultsArea) elements.resultsArea.innerHTML = '<pre class="results-pre">Run a query to see results...</pre>';
    if (elements.queryInput) elements.queryInput.value = '';
    queryResults = null;
    showNotification('Cleared', 'info');
}

async function createBackup() {
    const res = await fetch(`/q?q=backup&ses=${currentSession}`);
    const data = await res.json();
    if (data.success) showNotification('Backup created', 'success');
    else showNotification('Backup failed', 'error');
}

async function saveSettings() {
    const theme = document.getElementById('settingsTheme')?.value || 'dark';
    const format = document.getElementById('settingsFormat')?.value || 'json';
    localStorage.setItem('nullname_theme', theme);
    localStorage.setItem('nullname_format', format);
    applyTheme(theme);
    currentFormat = format;
    if (elements.formatSelect) elements.formatSelect.value = format;
    showNotification('Settings saved', 'success');
}

function initEventListeners() {
    if (elements.runBtn) elements.runBtn.addEventListener('click', executeQuery);
    if (elements.clearBtn) elements.clearBtn.addEventListener('click', clearResults);
    if (elements.copyBtn) elements.copyBtn.addEventListener('click', copyResults);
    if (elements.refreshBtn) elements.refreshBtn.addEventListener('click', () => { loadDashboardStats(); showNotification('Refreshed', 'success'); });
    if (elements.logoutBtn) elements.logoutBtn.addEventListener('click', logout);
    if (elements.createBackupBtn) elements.createBackupBtn.addEventListener('click', createBackup);
    if (elements.saveSettingsBtn) elements.saveSettingsBtn.addEventListener('click', saveSettings);
    if (elements.formatSelect) elements.formatSelect.addEventListener('change', (e) => { currentFormat = e.target.value; saveUserPreferences(); });
    
    document.querySelectorAll('.quick-query').forEach(btn => {
        btn.addEventListener('click', () => { if (elements.queryInput) { elements.queryInput.value = btn.dataset.query; executeQuery(); } });
    });
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('dashboardView').style.display = view === 'dashboard' ? 'block' : 'none';
            document.getElementById('queryView').style.display = view === 'query' ? 'flex' : 'none';
            document.getElementById('databasesView').style.display = view === 'databases' ? 'block' : 'none';
            document.getElementById('filesView').style.display = view === 'files' ? 'block' : 'none';
            document.getElementById('backupsView').style.display = view === 'backups' ? 'block' : 'none';
            document.getElementById('settingsView').style.display = view === 'settings' ? 'block' : 'none';
            if (view === 'databases') loadDatabasesTree();
            if (view === 'files') loadFilesList();
            if (view === 'backups') loadBackupsList();
        });
    });
    
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); executeQuery(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); elements.queryInput?.focus(); }
        if (e.key === 'F1') { e.preventDefault(); executeQuery(); }
    });
}

function startHealthCheck() {
    setInterval(async () => {
        try { await fetch('/health'); document.body.classList.add('healthy'); }
        catch(e) { document.body.classList.remove('healthy'); }
    }, 30000);
}

function updateUI() { updateUserDisplay(); }

async function loadDatabasesTree() {
    const container = document.getElementById('databasesTree');
    if (!container) return;
    const res = await fetch(`/q?q=get.&ses=${currentSession}`);
    const data = await res.json();
    container.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
}

async function loadFilesList() {
    const container = document.getElementById('filesList');
    if (!container) return;
    const res = await fetch(`/q?q=files.list&ses=${currentSession}`);
    const data = await res.json();
    if (data.files) container.innerHTML = '<pre>' + JSON.stringify(data.files, null, 2) + '</pre>';
    else container.innerHTML = '<p>No files uploaded</p>';
}

async function loadBackupsList() {
    const container = document.getElementById('backupsList');
    if (!container) return;
    const res = await fetch(`/q?q=backups&ses=${currentSession}`);
    const data = await res.json();
    if (data.backups) container.innerHTML = '<pre>' + JSON.stringify(data.backups, null, 2) + '</pre>';
    else container.innerHTML = '<p>No backups found</p>';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.NullNameApp = { executeQuery, clearResults, copyResults, logout, showNotification };