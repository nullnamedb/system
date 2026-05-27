// NullName DB - Admin Management System
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class AdminSystem {
    constructor() {
        this.adminLogs = [];
        this.maxLogs = 5000;
        this.adminActions = [];
        this.systemHealth = {
            status: 'healthy',
            lastCheck: null,
            issues: []
        };
        
        this.logsPath = path.join(__dirname, '..', 'logs');
        this.adminLogFile = path.join(this.logsPath, 'admin.json');
        this.auditFile = path.join(this.logsPath, 'audit.json');
        this.metricsFile = path.join(__dirname, '..', 'database', 'system_metrics.json');
        this.alertsFile = path.join(__dirname, '..', 'database', 'alerts.json');
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.logsPath);
        await this.loadLogs();
        await this.loadAudit();
        await this.loadAlerts();
        console.log('Admin system initialized');
    }

    async loadLogs() {
        try {
            if (await fs.pathExists(this.adminLogFile)) {
                this.adminLogs = await fs.readJson(this.adminLogFile);
            }
        } catch (error) {
            console.error('Failed to load admin logs:', error);
            this.adminLogs = [];
        }
    }

    async saveLogs() {
        try {
            if (this.adminLogs.length > this.maxLogs) {
                this.adminLogs = this.adminLogs.slice(-this.maxLogs);
            }
            await fs.writeJson(this.adminLogFile, this.adminLogs, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save admin logs:', error);
        }
    }

    async loadAudit() {
        try {
            if (await fs.pathExists(this.auditFile)) {
                this.adminActions = await fs.readJson(this.auditFile);
            }
        } catch (error) {
            console.error('Failed to load audit:', error);
            this.adminActions = [];
        }
    }

    async saveAudit() {
        try {
            await fs.writeJson(this.auditFile, this.adminActions, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save audit:', error);
        }
    }

    async loadAlerts() {
        try {
            if (!await fs.pathExists(this.alertsFile)) {
                await fs.writeJson(this.alertsFile, { alerts: [], settings: {} });
            }
        } catch (error) {
            console.error('Failed to load alerts:', error);
        }
    }

    async getStats() {
        const dbPath = path.join(__dirname, '..', 'database', 'sql');
        const filesPath = path.join(__dirname, '..', 'database', 'files');
        const commitsPath = path.join(__dirname, '..', 'database', 'commits');
        
        let databaseCount = 0;
        let tableCount = 0;
        let recordCount = 0;
        let totalSize = 0;
        
        if (await fs.pathExists(dbPath)) {
            const databases = await fs.readdir(dbPath);
            databaseCount = databases.filter(d => !d.startsWith('_')).length;
            
            for (const db of databases) {
                if (db.startsWith('_')) continue;
                const dbFullPath = path.join(dbPath, db);
                const stat = await fs.stat(dbFullPath);
                if (stat.isDirectory()) {
                    const tables = await fs.readdir(dbFullPath);
                    tableCount += tables.filter(t => t.endsWith('.json') && !t.startsWith('_')).length;
                    
                    for (const table of tables) {
                        if (table.endsWith('.json') && !table.startsWith('_')) {
                            const tablePath = path.join(dbFullPath, table);
                            const tableStat = await fs.stat(tablePath);
                            totalSize += tableStat.size;
                            
                            const data = await fs.readJson(tablePath);
                            recordCount += Object.keys(data).filter(k => !isNaN(k) && k !== '_nextId' && k !== '_schema').length;
                        }
                    }
                }
            }
        }
        
        let fileCount = 0;
        let fileSize = 0;
        if (await fs.pathExists(filesPath)) {
            const files = await fs.readdir(filesPath);
            fileCount = files.length;
            for (const file of files) {
                const filePath = path.join(filesPath, file);
                const stat = await fs.stat(filePath);
                fileSize += stat.size;
            }
        }
        
        let commitCount = 0;
        if (await fs.pathExists(commitsPath)) {
            const commits = await fs.readdir(commitsPath);
            commitCount = commits.filter(c => c.endsWith('.json')).length;
        }
        
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const uptime = process.uptime();
        const cpus = os.cpus();
        
        return {
            databases: {
                count: databaseCount,
                tables: tableCount,
                records: recordCount,
                dataSizeBytes: totalSize,
                dataSizeKB: (totalSize / 1024).toFixed(2),
                dataSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
            },
            files: {
                count: fileCount,
                sizeBytes: fileSize,
                sizeKB: (fileSize / 1024).toFixed(2),
                sizeMB: (fileSize / (1024 * 1024)).toFixed(2)
            },
            version: {
                commits: commitCount
            },
            total: {
                sizeBytes: totalSize + fileSize,
                sizeKB: ((totalSize + fileSize) / 1024).toFixed(2),
                sizeMB: ((totalSize + fileSize) / (1024 * 1024)).toFixed(2),
                sizeGB: ((totalSize + fileSize) / (1024 * 1024 * 1024)).toFixed(2)
            },
            system: {
                memory: {
                    rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
                    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
                    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
                    external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB'
                },
                cpu: {
                    user: (cpuUsage.user / 1000).toFixed(2) + ' ms',
                    system: (cpuUsage.system / 1000).toFixed(2) + ' ms',
                    cores: cpus.length,
                    model: cpus[0]?.model || 'unknown'
                },
                uptime: {
                    seconds: Math.floor(uptime),
                    human: this.formatUptime(uptime)
                },
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                totalMemory: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
                freeMemory: Math.round(os.freemem() / 1024 / 1024) + ' MB',
                loadAverage: os.loadavg()
            },
            timestamp: new Date().toISOString()
        };
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
        
        return parts.join(' ');
    }

    async getSystemHealth() {
        const stats = await this.getStats();
        const warnings = [];
        const errors = [];
        let status = 'healthy';
        
        const maxStorageMB = parseInt(process.env.MAX_STORAGE_MB) || 10240;
        const currentStorageMB = parseFloat(stats.total.sizeMB);
        
        if (currentStorageMB > maxStorageMB) {
            status = 'critical';
            errors.push(`Storage exceeded: ${currentStorageMB}MB / ${maxStorageMB}MB`);
        } else if (currentStorageMB > maxStorageMB * 0.9) {
            status = 'warning';
            warnings.push(`Storage near limit: ${currentStorageMB}MB / ${maxStorageMB}MB`);
        }
        
        const heapUsed = parseFloat(stats.system.memory.heapUsed);
        const heapTotal = parseFloat(stats.system.memory.heapTotal);
        const memoryPercent = (heapUsed / heapTotal) * 100;
        
        if (memoryPercent > 95) {
            status = 'critical';
            errors.push(`Memory usage critical: ${memoryPercent.toFixed(1)}%`);
        } else if (memoryPercent > 80) {
            if (status !== 'critical') status = 'warning';
            warnings.push(`Memory usage high: ${memoryPercent.toFixed(1)}%`);
        }
        
        if (stats.system.uptime.seconds < 60) {
            warnings.push('System recently started');
        }
        
        const dbPath = path.join(__dirname, '..', 'database', 'sql');
        if (!await fs.pathExists(dbPath)) {
            status = 'critical';
            errors.push('Database directory missing');
        }
        
        const envFile = path.join(__dirname, '..', '.env');
        if (!await fs.pathExists(envFile)) {
            warnings.push('Configuration file missing');
        }
        
        this.systemHealth = {
            status: status,
            lastCheck: new Date().toISOString(),
            warnings: warnings,
            errors: errors,
            stats: stats
        };
        
        return this.systemHealth;
    }

    async cleanup(options = {}) {
        const results = {
            deletedFiles: [],
            deletedBackups: [],
            deletedLogs: [],
            deletedTemp: [],
            freedSpaceMB: 0,
            timestamp: new Date().toISOString()
        };
        
        const tempPath = path.join(__dirname, '..', 'database', 'temp');
        const maxAge = options.tempMaxAge || 86400000;
        
        if (await fs.pathExists(tempPath)) {
            const temps = await fs.readdir(tempPath);
            for (const temp of temps) {
                const tempFile = path.join(tempPath, temp);
                const stat = await fs.stat(tempFile);
                if (Date.now() - stat.mtimeMs > maxAge) {
                    results.deletedTemp.push(temp);
                    results.freedSpaceMB += stat.size / (1024 * 1024);
                    await fs.remove(tempFile);
                }
            }
        }
        
        const backupsPath = path.join(__dirname, '..', 'database', 'backups');
        const keepCount = options.backupKeepCount || 10;
        
        if (await fs.pathExists(backupsPath)) {
            const backups = await fs.readdir(backupsPath);
            const backupStats = [];
            
            for (const backup of backups) {
                const backupPath = path.join(backupsPath, backup);
                const stat = await fs.stat(backupPath);
                backupStats.push({ name: backup, mtime: stat.mtimeMs, size: stat.size, isDir: stat.isDirectory() });
            }
            
            backupStats.sort((a, b) => b.mtime - a.mtime);
            
            for (let i = keepCount; i < backupStats.length; i++) {
                const backupPath = path.join(backupsPath, backupStats[i].name);
                results.deletedBackups.push(backupStats[i].name);
                results.freedSpaceMB += backupStats[i].size / (1024 * 1024);
                await fs.remove(backupPath);
            }
        }
        
        const logsPath = path.join(__dirname, '..', 'logs');
        const logMaxAge = options.logMaxAge || 7 * 86400000;
        
        if (await fs.pathExists(logsPath)) {
            const logs = await fs.readdir(logsPath);
            for (const log of logs) {
                const logPath = path.join(logsPath, log);
                const stat = await fs.stat(logPath);
                if (Date.now() - stat.mtimeMs > logMaxAge) {
                    results.deletedLogs.push(log);
                    results.freedSpaceMB += stat.size / (1024 * 1024);
                    await fs.remove(logPath);
                }
            }
        }
        
        const trackFile = path.join(__dirname, '..', 'database', 'tracking.json');
        const trackMaxAge = options.trackMaxAge || 30 * 86400000;
        
        if (await fs.pathExists(trackFile)) {
            const trackData = await fs.readJson(trackFile);
            const cutoff = Date.now() - trackMaxAge;
            const filtered = trackData.filter(t => t.timestamp > cutoff);
            if (filtered.length < trackData.length) {
                await fs.writeJson(trackFile, filtered, { spaces: 2 });
                results.deletedLogs.push(`tracking: ${trackData.length - filtered.length} records`);
            }
        }
        
        results.freedSpaceMB = results.freedSpaceMB.toFixed(2);
        
        await this.logAdminAction('cleanup', results);
        
        return results;
    }

    async logAdminAction(action, details, adminUser = null) {
        const logEntry = {
            id: crypto.randomBytes(8).toString('hex'),
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            action: action,
            details: details,
            admin: adminUser?.username || 'system',
            role: adminUser?.role || 'system',
            ip: details.ip || null
        };
        
        this.adminLogs.unshift(logEntry);
        
        if (this.adminLogs.length > this.maxLogs) {
            this.adminLogs = this.adminLogs.slice(0, this.maxLogs);
        }
        
        await this.saveLogs();
        await this.addAuditTrail(logEntry);
    }

    async addAuditTrail(entry) {
        this.adminActions.unshift(entry);
        
        if (this.adminActions.length > 10000) {
            this.adminActions = this.adminActions.slice(0, 10000);
        }
        
        await this.saveAudit();
    }

    async getAdminLogs(limit = 50, filter = null) {
        let logs = [...this.adminLogs];
        
        if (filter) {
            if (filter.action) {
                logs = logs.filter(l => l.action === filter.action);
            }
            if (filter.admin) {
                logs = logs.filter(l => l.admin === filter.admin);
            }
            if (filter.fromDate) {
                const fromDate = new Date(filter.fromDate).getTime();
                logs = logs.filter(l => l.timestamp >= fromDate);
            }
            if (filter.toDate) {
                const toDate = new Date(filter.toDate).getTime();
                logs = logs.filter(l => l.timestamp <= toDate);
            }
        }
        
        return logs.slice(0, limit);
    }

    async getAuditTrail(limit = 100, skip = 0) {
        return {
            total: this.adminActions.length,
            entries: this.adminActions.slice(skip, skip + limit)
        };
    }

    async isAdmin(user) {
        return user && (user.role === 'admin' || user.role === 'root');
    }

    async requireAdmin(user, action) {
        if (!await this.isAdmin(user)) {
            return { allowed: false, error: `Admin access required for ${action}` };
        }
        return { allowed: true };
    }

    async getAdminList() {
        const userManager = require('../user');
        const users = await userManager.getAllUsers();
        return users.filter(u => u.role === 'admin' || u.role === 'root');
    }

    async getMetrics(timeRange = 'hour') {
        let metrics = await this.readMetrics();
        
        const now = Date.now();
        let cutoff;
        
        switch(timeRange) {
            case 'hour': cutoff = now - 3600000; break;
            case 'day': cutoff = now - 86400000; break;
            case 'week': cutoff = now - 604800000; break;
            case 'month': cutoff = now - 2592000000; break;
            default: cutoff = now - 3600000;
        }
        
        const filtered = metrics.filter(m => m.timestamp > cutoff);
        
        const aggregates = {
            avgQueryTime: 0,
            totalQueries: 0,
            successRate: 0,
            avgMemoryUsage: 0,
            peakMemoryUsage: 0,
            avgCpuUsage: 0,
            peakCpuUsage: 0
        };
        
        if (filtered.length > 0) {
            let totalQueryTime = 0;
            let totalQueries = 0;
            let totalSuccess = 0;
            let totalMemory = 0;
            let peakMemory = 0;
            let totalCpu = 0;
            let peakCpu = 0;
            
            for (const m of filtered) {
                if (m.queryTime) totalQueryTime += m.queryTime;
                if (m.queryCount) totalQueries += m.queryCount;
                if (m.successCount) totalSuccess += m.successCount;
                if (m.memoryUsed) {
                    totalMemory += m.memoryUsed;
                    if (m.memoryUsed > peakMemory) peakMemory = m.memoryUsed;
                }
                if (m.cpuUsage) {
                    totalCpu += m.cpuUsage;
                    if (m.cpuUsage > peakCpu) peakCpu = m.cpuUsage;
                }
            }
            
            aggregates.avgQueryTime = filtered.length > 0 ? totalQueryTime / filtered.length : 0;
            aggregates.totalQueries = totalQueries;
            aggregates.successRate = totalQueries > 0 ? (totalSuccess / totalQueries) * 100 : 0;
            aggregates.avgMemoryUsage = filtered.length > 0 ? totalMemory / filtered.length : 0;
            aggregates.peakMemoryUsage = peakMemory;
            aggregates.avgCpuUsage = filtered.length > 0 ? totalCpu / filtered.length : 0;
            aggregates.peakCpuUsage = peakCpu;
        }
        
        return {
            timeRange: timeRange,
            dataPoints: filtered.length,
            aggregates: aggregates,
            raw: filtered.slice(-100)
        };
    }

    async readMetrics() {
        if (await fs.pathExists(this.metricsFile)) {
            return await fs.readJson(this.metricsFile);
        }
        return [];
    }

    async recordMetric(metric) {
        let metrics = await this.readMetrics();
        
        metrics.push({
            ...metric,
            timestamp: Date.now(),
            timestampISO: new Date().toISOString()
        });
        
        if (metrics.length > 10000) {
            metrics = metrics.slice(-10000);
        }
        
        await fs.writeJson(this.metricsFile, metrics, { spaces: 2 });
    }

    async addAlert(alert) {
        const alerts = await fs.readJson(this.alertsFile);
        alerts.alerts.unshift({
            id: crypto.randomBytes(8).toString('hex'),
            ...alert,
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            acknowledged: false
        });
        
        if (alerts.alerts.length > 1000) {
            alerts.alerts = alerts.alerts.slice(0, 1000);
        }
        
        await fs.writeJson(this.alertsFile, alerts, { spaces: 2 });
        return alerts.alerts[0];
    }

    async getAlerts(limit = 50, acknowledged = null) {
        const alerts = await fs.readJson(this.alertsFile);
        let filtered = alerts.alerts;
        
        if (acknowledged !== null) {
            filtered = filtered.filter(a => a.acknowledged === acknowledged);
        }
        
        return filtered.slice(0, limit);
    }

    async acknowledgeAlert(alertId) {
        const alerts = await fs.readJson(this.alertsFile);
        const alert = alerts.alerts.find(a => a.id === alertId);
        
        if (alert) {
            alert.acknowledged = true;
            alert.acknowledgedAt = Date.now();
            await fs.writeJson(this.alertsFile, alerts, { spaces: 2 });
            return { success: true };
        }
        
        return { success: false, error: 'Alert not found' };
    }

    async restartSystem(adminUser) {
        await this.logAdminAction('system_restart', {}, adminUser);
        await new Promise(resolve => setTimeout(resolve, 500));
        process.exit(0);
    }

    async shutdownSystem(adminUser) {
        await this.logAdminAction('system_shutdown', {}, adminUser);
        await new Promise(resolve => setTimeout(resolve, 500));
        process.exit(0);
    }

    async clearAllCache(adminUser) {
        const database = require('./database');
        const result = await database.clearCache();
        await this.logAdminAction('clear_cache', result, adminUser);
        return result;
    }

    async getSystemInfo(adminUser) {
        const stats = await this.getStats();
        const health = await this.getSystemHealth();
        
        return {
            system: {
                name: 'NullName DB',
                version: '2.0.0',
                nodeVersion: process.version,
                platform: process.platform
            },
            stats: stats,
            health: health,
            timestamp: new Date().toISOString()
        };
    }

    async getSystemLogs(limit = 100, type = 'all') {
        if (type === 'admin') {
            return await this.getAdminLogs(limit);
        }
        
        if (type === 'audit') {
            const audit = await this.getAuditTrail(limit);
            return audit.entries;
        }
        
        const adminLogs = await this.getAdminLogs(limit);
        const auditLogs = await this.getAuditTrail(limit);
        
        const combined = [...adminLogs, ...auditLogs.entries];
        combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return combined.slice(0, limit);
    }

    async clearLogs(adminUser, logType = 'all') {
        const result = { cleared: [] };
        
        if (logType === 'admin' || logType === 'all') {
            this.adminLogs = [];
            await this.saveLogs();
            result.cleared.push('admin');
        }
        
        if (logType === 'audit' || logType === 'all') {
            this.adminActions = [];
            await this.saveAudit();
            result.cleared.push('audit');
        }
        
        await this.logAdminAction('clear_logs', { logType, result }, adminUser);
        
        return result;
    }
}

module.exports = new AdminSystem();
