// NullName DB - Main Application UI
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 650+

// ============================================
// GLOBAL STATE
// ============================================

let currentUser = null;
let currentSession = null;
let currentView = 'dashboard';
let queryHistory = [];
let favorites = [];
let queryResults = null;
let autoRefresh = false;
let refreshInterval = null;
let currentFormat = 'json';
let currentTheme = 'dark';
let notifications = [];
let recentQueries = [];

// DOM Elements cache
const elements = {};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    loadUserPreferences();
    await checkSession();
    await loadDashboardStats();
    await loadQueryHistory();
    await loadFavorites();
    initEventListeners();
    initKeyboardShortcuts();
    startHealthCheck();
    updateUI();
    
    console.log('NullName DB UI Initialized');
});

function cacheElements() {
    elements.queryInput = document.getElementById('queryInput');
    elements.runBtn = document.getElementById('runBtn');
    elements.resultsPre = document.getElementById('resultsPre');
    elements.resultsArea = document.getElementById('resultsArea');
    elements.statusMsg = document.getElementById('statusMsg');
    elements.timeMsg = document.getElementById('timeMsg');
    elements.userDisplay = document.getElementById('userDisplay');
    elements.statsPanel = document.getElementById('statsPanel');
    elements.historyList = document.getElementById('historyList');
    elements.favoritesList = document.getElementById('favoritesList');
    elements.formatSelect = document.getElementById('formatSelect');
    elements.themeToggle = document.getElementById('themeToggle');
    elements.sidebar = document.getElementById('sidebar');
    elements.menuToggle = document.getElementById('menuToggle');
    elements.clearBtn = document.getElementById('clearBtn');
    elements.exportBtn = document.getElementById('exportBtn');
    elements.copyBtn = document.getElementById('copyBtn');
    elements.saveFavoriteBtn = document.getElementById('saveFavoriteBtn');
    elements.settingsBtn = document.getElementById('settingsBtn');
    elements.logoutBtn = document.getElementById('logoutBtn');
    elements.helpBtn = document.getElementById('helpBtn');
}

// ============================================
// USER PREFERENCES
// ============================================

function loadUserPreferences() {
    const savedTheme = localStorage.getItem('nullname_theme');
    if (savedTheme) {
        currentTheme = savedTheme;
        applyTheme(currentTheme);
    }
    
    const savedFormat = localStorage.getItem('nullname_format');
    if (savedFormat) {
        currentFormat = savedFormat;
        if (elements.formatSelect) {
            elements.formatSelect.value = currentFormat;
        }
    }
    
    const savedQueries = localStorage.getItem('nullname_recent_queries');
    if (savedQueries) {
        recentQueries = JSON.parse(savedQueries);
    }
    
    const savedFavorites = localStorage.getItem('nullname_favorites');
    if (savedFavorites) {
        favorites = JSON.parse(savedFavorites);
    }
}

function saveUserPreferences() {
    localStorage.setItem('nullname_theme', currentTheme);
    localStorage.setItem('nullname_format', currentFormat);
    localStorage.setItem('nullname_recent_queries', JSON.stringify(recentQueries.slice(0, 50)));
    localStorage.setItem('nullname_favorites', JSON.stringify(favorites));
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    } else {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    }
    currentTheme = theme;
    saveUserPreferences();
}

// ============================================
// SESSION MANAGEMENT
// ============================================

async function checkSession() {
    const sessionKey = localStorage.getItem('nullname_session');
    if (!sessionKey) {
        redirectToLogin();
        return false;
    }
    
    try {
        const response = await fetch(`/q?q=status&ses=${sessionKey}`);
        const data = await response.json();
        
        if (data.success && data.user) {
            currentUser = data.user;
            currentSession = sessionKey;
            updateUserDisplay();
            return true;
        } else {
            logout();
            return false;
        }
    } catch (error) {
        console.error('Session check failed:', error);
        return false;
    }
}

function redirectToLogin() {
    window.location.href = '/login';
}

async function logout() {
    if (currentSession) {
        try {
            await fetch(`/q?q=logout&ses=${currentSession}`);
        } catch (e) {}
    }
    
    localStorage.removeItem('nullname_session');
    currentUser = null;
    currentSession = null;
    redirectToLogin();
}

function updateUserDisplay() {
    if (elements.userDisplay && currentUser) {
        elements.userDisplay.textContent = `${currentUser.username} (${currentUser.role})`;
    }
}

// ============================================
// QUERY EXECUTION
// ============================================

async function executeQuery() {
    const query = elements.queryInput?.value.trim();
    if (!query) {
        showNotification('Please enter a query', 'warning');
        return;
    }
    
    // Show loading state
    showLoading(true);
    updateStatus('Executing query...', 'info');
    const startTime = Date.now();
    
    try {
        let url = `/q?q=${encodeURIComponent(query)}`;
        if (currentSession) {
            url += `&ses=${currentSession}`;
        }
        if (currentFormat && currentFormat !== 'json') {
            url += `&format=${currentFormat}`;
        }
        
        const response = await fetch(url);
        const elapsed = Date.now() - startTime;
        
        updateTimeDisplay(elapsed);
        
        // Handle different response formats
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
        
        if (response.ok) {
            updateStatus('Success', 'success');
            addToHistory(query, true, elapsed);
        } else {
            updateStatus('Error', 'error');
            addToHistory(query, false, elapsed);
        }
        
    } catch (error) {
        console.error('Query execution failed:', error);
        updateStatus(`Error: ${error.message}`, 'error');
        displayResults({ error: error.message, details: 'Network or server error' }, 'json');
        addToHistory(query, false, 0);
    } finally {
        showLoading(false);
    }
}

function displayResults(data, format) {
    const container = elements.resultsArea;
    if (!container) return;
    
    if (format === 'csv' || format === 'text') {
        const pre = document.createElement('pre');
        pre.textContent = data;
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordWrap = 'break-word';
        container.innerHTML = '';
        container.appendChild(pre);
    } else {
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(data, null, 2);
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordWrap = 'break-word';
        container.innerHTML = '';
        container.appendChild(pre);
    }
}

function showLoading(show) {
    const runBtn = elements.runBtn;
    if (runBtn) {
        if (show) {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Running...';
        } else {
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="fa fa-play"></i> Run Query';
        }
    }
}

function updateStatus(message, type) {
    if (elements.statusMsg) {
        elements.statusMsg.textContent = message;
        elements.statusMsg.className = `status-${type}`;
        
        setTimeout(() => {
            if (elements.statusMsg.textContent === message) {
                elements.statusMsg.textContent = 'Ready';
                elements.statusMsg.className = 'status-info';
            }
        }, 3000);
    }
}

function updateTimeDisplay(elapsed) {
    if (elements.timeMsg) {
        elements.timeMsg.textContent = `${elapsed}ms`;
    }
}

// ============================================
// QUERY HISTORY
// ============================================

async function loadQueryHistory() {
    try {
        const response = await fetch(`/q?q=track&ses=${currentSession}&limit=50`);
        const data = await response.json();
        
        if (data.tracks) {
            queryHistory = data.tracks;
            renderHistory();
        }
    } catch (error) {
        console.error('Failed to load history:', error);
    }
}

function renderHistory() {
    const container = elements.historyList;
    if (!container) return;
    
    container.innerHTML = '';
    
    queryHistory.slice(0, 20).forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-query">${escapeHtml(item.query.substring(0, 60))}${item.query.length > 60 ? '...' : ''}</div>
            <div class="history-meta">
                <span class="history-time">${new Date(item.timestamp).toLocaleString()}</span>
                <span class="history-status ${item.success ? 'success' : 'error'}">${item.success ? '✓' : '✗'}</span>
            </div>
        `;
        div.onclick = () => {
            if (elements.queryInput) {
                elements.queryInput.value = item.query;
            }
        };
        container.appendChild(div);
    });
}

function addToHistory(query, success, duration) {
    queryHistory.unshift({
        query: query,
        success: success,
        timestamp: Date.now(),
        duration: duration
    });
    
    if (queryHistory.length > 100) {
        queryHistory = queryHistory.slice(0, 100);
    }
    
    renderHistory();
    
    // Add to recent queries
    recentQueries.unshift({
        query: query,
        timestamp: Date.now()
    });
    if (recentQueries.length > 50) {
        recentQueries = recentQueries.slice(0, 50);
    }
    saveUserPreferences();
}

// ============================================
// FAVORITES
// ============================================

function saveCurrentAsFavorite() {
    const query = elements.queryInput?.value.trim();
    if (!query) {
        showNotification('No query to save', 'warning');
        return;
    }
    
    const name = prompt('Enter a name for this favorite:', query.substring(0, 30));
    if (!name) return;
    
    favorites.push({
        id: Date.now(),
        name: name,
        query: query,
        created: new Date().toISOString()
    });
    
    saveUserPreferences();
    renderFavorites();
    showNotification('Favorite saved', 'success');
}

function renderFavorites() {
    const container = elements.favoritesList;
    if (!container) return;
    
    container.innerHTML = '';
    
    favorites.forEach(fav => {
        const div = document.createElement('div');
        div.className = 'favorite-item';
        div.innerHTML = `
            <div class="favorite-name">${escapeHtml(fav.name)}</div>
            <div class="favorite-actions">
                <button class="favorite-run" data-id="${fav.id}"><i class="fa fa-play"></i></button>
                <button class="favorite-delete" data-id="${fav.id}"><i class="fa fa-trash"></i></button>
            </div>
        `;
        
        div.querySelector('.favorite-run').onclick = (e) => {
            e.stopPropagation();
            if (elements.queryInput) {
                elements.queryInput.value = fav.query;
                executeQuery();
            }
        };
        
        div.querySelector('.favorite-delete').onclick = (e) => {
            e.stopPropagation();
            favorites = favorites.filter(f => f.id !== fav.id);
            saveUserPreferences();
            renderFavorites();
        };
        
        container.appendChild(div);
    });
}

// ============================================
// DASHBOARD STATS
// ============================================

async function loadDashboardStats() {
    try {
        const response = await fetch(`/q?q=stats&ses=${currentSession}`);
        const stats = await response.json();
        
        if (elements.statsPanel) {
            elements.statsPanel.innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${stats.databases || 0}</div>
                    <div class="stat-label">Databases</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.tables || 0}</div>
                    <div class="stat-label">Tables</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.records || 0}</div>
                    <div class="stat-label">Records</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalSizeMB || 0} MB</div>
                    <div class="stat-label">Storage</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// ============================================
// NOTIFICATIONS
// ============================================

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">${escapeHtml(message)}</div>
        <button class="notification-close"><i class="fa fa-times"></i></button>
    `;
    
    notification.querySelector('.notification-close').onclick = () => {
        notification.remove();
    };
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
    
    notifications.push({ message, type, timestamp: Date.now() });
    if (notifications.length > 50) {
        notifications = notifications.slice(-50);
    }
}

// ============================================
// EXPORT/IMPORT
// ============================================

function exportResults() {
    if (!queryResults) {
        showNotification('No results to export', 'warning');
        return;
    }
    
    const dataStr = JSON.stringify(queryResults, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nullname_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Exported successfully', 'success');
}

function copyResults() {
    if (!queryResults) {
        showNotification('No results to copy', 'warning');
        return;
    }
    
    const text = JSON.stringify(queryResults, null, 2);
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Copied to clipboard', 'success');
    }).catch(() => {
        showNotification('Failed to copy', 'error');
    });
}

function clearResults() {
    if (elements.resultsArea) {
        elements.resultsArea.innerHTML = '<div class="placeholder">Ready to run queries. Type a query above.</div>';
    }
    if (elements.queryInput) {
        elements.queryInput.value = '';
    }
    queryResults = null;
    showNotification('Cleared', 'info');
}

// ============================================
// SETTINGS
// ============================================

function openSettings() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Settings</h3>
                <button class="modal-close"><i class="fa fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="setting-group">
                    <label>Response Format</label>
                    <select id="modalFormatSelect">
                        <option value="json">JSON</option>
                        <option value="text">Plain Text</option>
                        <option value="table">Table</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Theme</label>
                    <select id="modalThemeSelect">
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Auto-refresh (seconds)</label>
                    <input type="number" id="autoRefreshInterval" min="0" max="60" value="0">
                </div>
                <div class="setting-group">
                    <label>Query History Limit</label>
                    <input type="number" id="historyLimit" min="10" max="200" value="50">
                </div>
            </div>
            <div class="modal-footer">
                <button id="saveSettingsBtn">Save</button>
                <button id="cancelSettingsBtn">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('modalFormatSelect').value = currentFormat;
    document.getElementById('modalThemeSelect').value = currentTheme;
    
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    document.getElementById('cancelSettingsBtn').onclick = () => modal.remove();
    document.getElementById('saveSettingsBtn').onclick = () => {
        currentFormat = document.getElementById('modalFormatSelect').value;
        currentTheme = document.getElementById('modalThemeSelect').value;
        applyTheme(currentTheme);
        saveUserPreferences();
        
        const refreshInterval = parseInt(document.getElementById('autoRefreshInterval').value);
        setAutoRefresh(refreshInterval);
        
        modal.remove();
        showNotification('Settings saved', 'success');
    };
}

function setAutoRefresh(seconds) {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        autoRefresh = false;
    }
    
    if (seconds > 0) {
        autoRefresh = true;
        refreshInterval = setInterval(() => {
            if (elements.queryInput?.value) {
                executeQuery();
            }
        }, seconds * 1000);
        showNotification(`Auto-refresh set to ${seconds} seconds`, 'info');
    }
}

// ============================================
// HELP
// ============================================

function showHelp() {
    const modal = document.createElement('div');
    modal.className = 'modal modal-large';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Help - Query Reference</h3>
                <button class="modal-close"><i class="fa fa-times"></i></button>
            </div>
            <div class="modal-body">
                <h4>Basic Operations</h4>
                <table class="help-table">
                    <tr><td><code>name=value</code></td><td>Save a value</td></tr>
                    <tr><td><code>name</code></td><td>Get a value</td></tr>
                    <tr><td><code>add.db.table.col.value</code></td><td>Add to database</td></tr>
                    <tr><td><code>get.db.table</code></td><td>Get from database</td></tr>
                    <tr><td><code>update.db.table.id.col=value</code></td><td>Update record</td></tr>
                    <tr><td><code>delete.db.table.id</code></td><td>Delete record</td></tr>
                </table>
                <h4>Version Control</h4>
                <table class="help-table">
                    <tr><td><code>commit "message"</code></td><td>Create commit</td></tr>
                    <tr><td><code>checkout.id</code></td><td>Switch to commit</td></tr>
                    <tr><td><code>branch.name</code></td><td>Create branch</td></tr>
                    <tr><td><code>merge.source.into.target</code></td><td>Merge branches</td></tr>
                    <tr><td><code>undo</code></td><td>Undo last change</td></tr>
                    <tr><td><code>f1, f2, f3</code></td><td>Force recovery</td></tr>
                </table>
                <h4>Format Options</h4>
                <table class="help-table">
                    <tr><td><code>&format=json</code></td><td>JSON format (default)</td></tr>
                    <tr><td><code>&format=text</code></td><td>Plain text format</td></tr>
                    <tr><td><code>&format=table</code></td><td>ASCII table format</td></tr>
                </table>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick = () => modal.remove();
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
    if (elements.runBtn) {
        elements.runBtn.addEventListener('click', executeQuery);
    }
    
    if (elements.clearBtn) {
        elements.clearBtn.addEventListener('click', clearResults);
    }
    
    if (elements.exportBtn) {
        elements.exportBtn.addEventListener('click', exportResults);
    }
    
    if (elements.copyBtn) {
        elements.copyBtn.addEventListener('click', copyResults);
    }
    
    if (elements.saveFavoriteBtn) {
        elements.saveFavoriteBtn.addEventListener('click', saveCurrentAsFavorite);
    }
    
    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('click', openSettings);
    }
    
    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', logout);
    }
    
    if (elements.helpBtn) {
        elements.helpBtn.addEventListener('click', showHelp);
    }
    
    if (elements.formatSelect) {
        elements.formatSelect.addEventListener('change', (e) => {
            currentFormat = e.target.value;
            saveUserPreferences();
        });
    }
    
    if (elements.themeToggle) {
        elements.themeToggle.addEventListener('click', () => {
            currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(currentTheme);
        });
    }
    
    if (elements.menuToggle && elements.sidebar) {
        elements.menuToggle.addEventListener('click', () => {
            elements.sidebar.classList.toggle('open');
        });
    }
    
    if (elements.queryInput) {
        elements.queryInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                executeQuery();
            }
        });
    }
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K: Focus query input
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            elements.queryInput?.focus();
        }
        
        // Ctrl/Cmd + Enter: Run query
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            executeQuery();
        }
        
        // Ctrl/Cmd + L: Clear results
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            clearResults();
        }
        
        // F1: Help
        if (e.key === 'F1') {
            e.preventDefault();
            showHelp();
        }
    });
}

// ============================================
// HEALTH CHECK
// ============================================

function startHealthCheck() {
    setInterval(async () => {
        try {
            const response = await fetch('/health');
            if (response.ok) {
                document.body.classList.add('healthy');
                document.body.classList.remove('unhealthy');
            } else {
                document.body.classList.add('unhealthy');
                document.body.classList.remove('healthy');
            }
        } catch (error) {
            document.body.classList.add('unhealthy');
            document.body.classList.remove('healthy');
        }
    }, 30000);
}

// ============================================
// UI HELPERS
// ============================================

function updateUI() {
    // Update based on current view
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === currentView) {
            item.classList.add('active');
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// EXPORT GLOBALS
// ============================================

window.NullNameApp = {
    executeQuery,
    clearResults,
    exportResults,
    copyResults,
    showHelp,
    openSettings,
    logout,
    currentUser,
    currentSession
};
