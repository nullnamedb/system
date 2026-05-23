// NullName DB - Core System Management
// No brand. No name. No payment.
// Version: 1.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

class CoreSystem {
    constructor() {
        this.initialized = false;
        this.systemStartTime = Date.now();
        this.version = '1.0.0';
        this.name = 'NullName DB';
        this.tagline = 'No brand. No name. No payment.';
        
        this.stateFile = path.join(__dirname, '..', 'database', 'system_state.json');
        this.configFile = path.join(__dirname, '..', 'database', 'system_config.json');
        this.eventsFile = path.join(__dirname, '..', 'database', 'system_events.json');
        this.metricsFile = path.join(__dirname, '..', 'database', 'system_metrics.json');
        this.lockFile = path.join(__dirname, '..', 'database', 'system.lock');
        
        this.state = null;
        this.config = null;
        this.metrics = {
            queries: { total: 0, success: 0, failed: 0, avgTime: 0 },
            storage: { total: 0, databases: 0, tables: 0, records: 0, files: 0 },
            uptime: 0,
            memory: {},
            cpu: {}
        };
        
        this.eventListeners = new Map();
        this.healthInterval = null;
    }

    async initialize() {
        if (this.initialized) {
            console.log('Core system already initialized');
            return;
        }
        
        console.log('========================================');
        console.log('NullName DB Core System Initialization');
        console.log('========================================');
        
        try {
            await this.ensureDirectories();
            await this.initSystemState();
            await this.loadConfig();
            await this.loadMetrics();
            await this.checkLock();
            this.startHealthMonitoring();
            this.startMetricsCollection();
            
            this.initialized = true;
            
            console.log('========================================');
            console.log('Core System Initialized Successfully');
            console.log(`System ID: ${this.state.systemId}`);
            console.log(`Version: ${this.version}`);
            console.log(`Started: ${new Date(this.systemStartTime).toISOString()}`);
            console.log('========================================');
            
            await this.trackEvent('system_start', {
                version: this.version,
                node_version: process.version,
                platform: process.platform
            });
            
        } catch (error) {
            console.error('Failed to initialize core system:', error);
            throw error;
        }
    }

    async ensureDirectories() {
        const dirs = [
            path.join(__dirname, '..', 'database'),
            path.join(__dirname, '..', 'database', 'path'),
            path.join(__dirname, '..', 'database', 'files'),
            path.join(__dirname, '..', 'database', 'commits'),
            path.join(__dirname, '..', 'database', 'branches'),
            path.join(__dirname, '..', 'database', 'backups'),
            path.join(__dirname, '..', 'database', 'temp'),
            path.join(__dirname, '..', 'database', 'users'),
            path.join(__dirname, '..', 'database', 'logs'),
            path.join(__dirname, '..', 'database', 'track'),
            path.join(__dirname, '..', 'logs'),
            path.join(__dirname, '..', 'ui'),
            path.join(__dirname, '..', 'docs')
        ];
        
        for (const dir of dirs) {
            await fs.ensureDir(dir);
        }
        
        console.log(`✓ Directories verified (${dirs.length} directories)`);
    }

    async initSystemState() {
        if (await fs.pathExists(this.stateFile)) {
            this.state = await fs.readJson(this.stateFile);
        } else {
            const systemId = crypto.randomBytes(16).toString('hex');
            
            this.state = {
                systemId: systemId,
                version: this.version,
                created: new Date().toISOString(),
                lastStart: new Date().toISOString(),
                lastBackup: null,
                lastCleanup: null,
                totalQueries: 0,
                totalStorage: 0,
                totalDatabases: 0,
                totalUsers: 1,
                status: 'running',
                features: {
                    versionControl: true,
                    fileUploads: true,
                    userManagement: true,
                    backupSystem: true,
                    publicRead: false
                }
            };
            
            await fs.writeJson(this.stateFile, this.state, { spaces: 2 });
        }
    }

    async loadConfig() {
        if (await fs.pathExists(this.configFile)) {
            this.config = await fs.readJson(this.configFile);
        } else {
            this.config = {
                server: {
                    port: parseInt(process.env.PORT) || 3000,
                    domain: process.env.DOMAIN || 'localhost',
                    env: process.env.NODE_ENV || 'production'
                },
                security: {
                    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 86400000,
                    maxLoginAttempts: 5,
                    lockoutTime: 900000,
                    bcryptRounds: 10
                },
                storage: {
                    maxSizeMB: parseInt(process.env.MAX_STORAGE_MB) || 1024,
                    autoCleanupDays: parseInt(process.env.AUTO_CLEANUP_DAYS) || 30,
                    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 50,
                    tempCleanupMs: parseInt(process.env.TEMP_FILE_CLEANUP_MS) || 3600000
                },
                backup: {
                    autoBackup: true,
                    intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS) || 24,
                    maxBackups: parseInt(process.env.MAX_BACKUPS_KEEP) || 10,
                    compression: true
                },
                logging: {
                    level: process.env.LOG_LEVEL || 'info',
                    enableRequestLog: true,
                    enableQueryTracking: true,
                    maxHistory: 10000
                },
                features: {
                    enableSignup: process.env.ENABLE_SIGNUP !== 'false',
                    enablePublicRead: process.env.ENABLE_PUBLIC_READ === 'true',
                    enableFileUploads: process.env.ENABLE_FILE_UPLOADS !== 'false',
                    enableVersionControl: process.env.ENABLE_VERSION_CONTROL !== 'false',
                    enableBackupSystem: process.env.ENABLE_BACKUP_SYSTEM !== 'false'
                },
                updatedAt: new Date().toISOString()
            };
            
            await fs.writeJson(this.configFile, this.config, { spaces: 2 });
        }
    }

    async loadMetrics() {
        if (await fs.pathExists(this.metricsFile)) {
            this.metrics = await fs.readJson(this.metricsFile);
        } else {
            await this.saveMetrics();
        }
    }

    async saveMetrics() {
        this.metrics.updatedAt = new Date().toISOString();
        await fs.writeJson(this.metricsFile, this.metrics, { spaces: 2 });
    }

    async checkLock() {
        if (await fs.pathExists(this.lockFile)) {
            const lockData = await fs.readJson(this.lockFile);
            const lockAge = Date.now() - lockData.timestamp;
            
            if (lockAge < 300000) {
                console.warn('⚠️ Lock file exists. Another instance may be running.');
                console.warn(`   Lock created: ${new Date(lockData.timestamp).toISOString()}`);
                console.warn(`   PID: ${lockData.pid}`);
                
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('Another instance is already running');
                }
            } else {
                console.log('Stale lock file found. Removing...');
                await fs.remove(this.lockFile);
            }
        }
        
        await fs.writeJson(this.lockFile, {
            pid: process.pid,
            timestamp: Date.now(),
            startTime: this.systemStartTime
        });
    }

    startHealthMonitoring() {
        if (this.healthInterval) {
            clearInterval(this.healthInterval);
        }
        
        this.healthInterval = setInterval(async () => {
            const health = await this.getHealthStatus();
            
            if (health.status !== 'healthy') {
                console.warn('⚠️ Health check warning:', health);
                await this.trackEvent('health_warning', health);
            }
        }, 60000);
        
        console.log('✓ Health monitoring started (interval: 60s)');
    }

    async getHealthStatus() {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const uptime = this.getUptime();
        
        const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
        
        let status = 'healthy';
        const warnings = [];
        
        if (memoryPercent > 90) {
            status = 'warning';
            warnings.push('Memory usage above 90%');
        }
        
        if (this.metrics.storage.total > this.config.storage.maxSizeMB * 1024 * 1024 * 0.9) {
            status = 'warning';
            warnings.push('Storage usage above 90%');
        }
        
        return {
            status: status,
            timestamp: new Date().toISOString(),
            uptime: uptime,
            memory: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
                percent: memoryPercent.toFixed(2) + '%',
                rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB'
            },
            cpu: {
                user: (cpuUsage.user / 1000).toFixed(2) + 'ms',
                system: (cpuUsage.system / 1000).toFixed(2) + 'ms'
            },
            metrics: {
                totalQueries: this.metrics.queries.total,
                successRate: this.metrics.queries.total > 0 
                    ? ((this.metrics.queries.success / this.metrics.queries.total) * 100).toFixed(2) + '%'
                    : '0%',
                avgQueryTime: this.metrics.queries.avgTime.toFixed(2) + 'ms'
            },
            warnings: warnings
        };
    }

    startMetricsCollection() {
        setInterval(async () => {
            await this.collectMetrics();
        }, 300000);
        
        console.log('✓ Metrics collection started (interval: 5min)');
    }

    async collectMetrics() {
        try {
            const dbPath = path.join(__dirname, '..', 'database', 'path');
            let databases = 0;
            let tables = 0;
            let records = 0;
            let totalSize = 0;
            
            if (await fs.pathExists(dbPath)) {
                const dbDirs = await fs.readdir(dbPath);
                databases = dbDirs.length;
                
                for (const db of dbDirs) {
                    const dbFullPath = path.join(dbPath, db);
                    const stat = await fs.stat(dbFullPath);
                    if (stat.isDirectory()) {
                        const tableFiles = await fs.readdir(dbFullPath);
                        tables += tableFiles.length;
                        
                        for (const table of tableFiles) {
                            const tablePath = path.join(dbFullPath, table);
                            const tableStat = await fs.stat(tablePath);
                            totalSize += tableStat.size;
                            
                            if (table.endsWith('.json')) {
                                const data = await fs.readJson(tablePath);
                                records += Object.keys(data).filter(k => !isNaN(k)).length;
                            }
                        }
                    }
                }
            }
            
            const filesPath = path.join(__dirname, '..', 'database', 'files');
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
            
            this.metrics.storage = {
                databases: databases,
                tables: tables,
                records: records,
                files: fileCount,
                totalBytes: totalSize + fileSize,
                totalMB: ((totalSize + fileSize) / (1024 * 1024)).toFixed(2),
                fileBytes: fileSize,
                fileMB: (fileSize / (1024 * 1024)).toFixed(2)
            };
            
            this.metrics.uptime = this.getUptime();
            this.metrics.memory = process.memoryUsage();
            this.metrics.cpu = process.cpuUsage();
            this.metrics.nodeVersion = process.version;
            this.metrics.platform = process.platform;
            
            await this.saveMetrics();
            
        } catch (error) {
            console.error('Failed to collect metrics:', error);
        }
    }

    async incrementQueryCount(success = true, duration = 0) {
        this.state.totalQueries = (this.state.totalQueries || 0) + 1;
        this.metrics.queries.total++;
        
        if (success) {
            this.metrics.queries.success++;
        } else {
            this.metrics.queries.failed++;
        }
        
        const totalTime = this.metrics.queries.avgTime * (this.metrics.queries.total - 1) + duration;
        this.metrics.queries.avgTime = totalTime / this.metrics.queries.total;
        
        if (this.state.totalQueries % 100 === 0) {
            await fs.writeJson(this.stateFile, this.state, { spaces: 2 });
            await this.saveMetrics();
        }
    }

    async trackEvent(eventName, eventData = {}) {
        let events = [];
        
        if (await fs.pathExists(this.eventsFile)) {
            events = await fs.readJson(this.eventsFile);
        }
        
        events.push({
            id: crypto.randomBytes(8).toString('hex'),
            event: eventName,
            data: eventData,
            timestamp: Date.now(),
            timestampISO: new Date().toISOString()
        });
        
        if (events.length > 10000) {
            events = events.slice(-10000);
        }
        
        await fs.writeJson(this.eventsFile, events, { spaces: 2 });
        
        const listeners = this.eventListeners.get(eventName) || [];
        for (const listener of listeners) {
            try {
                listener(eventData);
            } catch (error) {
                console.error(`Event listener error for ${eventName}:`, error);
            }
        }
    }

    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }

    async getEvents(limit = 100, filter = null) {
        if (!await fs.pathExists(this.eventsFile)) {
            return [];
        }
        
        let events = await fs.readJson(this.eventsFile);
        
        if (filter) {
            events = events.filter(e => e.event === filter);
        }
        
        return events.slice(-limit).reverse();
    }

    getUptime() {
        return Math.floor((Date.now() - this.systemStartTime) / 1000);
    }

    getUptimeHuman() {
        const seconds = this.getUptime();
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
        
        return parts.join(' ');
    }

    async getSystemInfo() {
        const health = await this.getHealthStatus();
        
        return {
            name: this.name,
            version: this.version,
            tagline: this.tagline,
            systemId: this.state.systemId,
            status: this.state.status,
            initialized: this.initialized,
            uptime: {
                seconds: this.getUptime(),
                human: this.getUptimeHuman()
            },
            started: new Date(this.systemStartTime).toISOString(),
            created: this.state.created,
            health: health,
            config: {
                server: this.config.server,
                features: this.config.features
            }
        };
    }

    async getSystemStats() {
        return {
            queries: this.metrics.queries,
            storage: this.metrics.storage,
            memory: this.metrics.memory,
            cpu: this.metrics.cpu,
            nodeVersion: this.metrics.nodeVersion,
            platform: this.metrics.platform,
            uptime: this.getUptimeHuman()
        };
    }

    async getConfig() {
        return { ...this.config };
    }

    async updateConfig(updates, user = null) {
        const oldConfig = { ...this.config };
        
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
        
        this.config = mergeDeep(this.config, updates);
        this.config.updatedAt = new Date().toISOString();
        this.config.updatedBy = user?.username || 'system';
        
        await fs.writeJson(this.configFile, this.config, { spaces: 2 });
        
        await this.trackEvent('config_updated', {
            changes: Object.keys(updates),
            by: user?.username || 'system',
            old: oldConfig,
            new: this.config
        });
        
        return { success: true, config: this.config };
    }

    async restart(reason = null) {
        await this.trackEvent('system_restart', { reason: reason });
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit(0);
    }

    async shutdown(reason = null) {
        await this.trackEvent('system_shutdown', { reason: reason });
        
        if (await fs.pathExists(this.lockFile)) {
            await fs.remove(this.lockFile);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit(0);
    }

    async cleanup() {
        const results = {
            tempFiles: 0,
            oldEvents: 0,
            oldBackups: 0,
            freedSpaceMB: 0
        };
        
              const tempPath = path.join(__dirname, '..', 'database', 'temp');
        if (await fs.pathExists(tempPath)) {
            const temps = await fs.readdir(tempPath);
            for (const temp of temps) {
                const tempFile = path.join(tempPath, temp);
                const stat = await fs.stat(tempFile);
                if (Date.now() - stat.mtimeMs > this.config.storage.tempCleanupMs) {
                    await fs.remove(tempFile);
                    results.tempFiles++;
                }
            }
        }
        
        let events = [];
        if (await fs.pathExists(this.eventsFile)) {
            events = await fs.readJson(this.eventsFile);
            const cutoff = Date.now() - (this.config.storage.autoCleanupDays * 86400000);
            const oldCount = events.length;
            events = events.filter(e => e.timestamp > cutoff);
            results.oldEvents = oldCount - events.length;
            await fs.writeJson(this.eventsFile, events, { spaces: 2 });
        }
        
        results.freedSpaceMB = ((results.tempFiles * 0.001) + (results.oldEvents * 0.0001)).toFixed(2);
        
        this.state.lastCleanup = new Date().toISOString();
        await fs.writeJson(this.stateFile, this.state, { spaces: 2 });
        
        await this.trackEvent('system_cleanup', results);
        
        return results;
    }

    generateId(prefix = '') {
        const id = crypto.randomBytes(8).toString('hex');
        return prefix ? `${prefix}_${id}` : id;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async isHealthy() {
        const health = await this.getHealthStatus();
        return health.status === 'healthy';
    }

    async waitForReady(timeoutMs = 30000) {
        const start = Date.now();
        
        while (!this.initialized) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('System initialization timeout');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return true;
    }
}

module.exports = new CoreSystem();