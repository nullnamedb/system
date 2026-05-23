// NullName DB - Backup and Restore System
// No brand. No name. No payment.
// Version: 1.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

class BackupSystem {
    constructor() {
        this.backupPath = path.join(__dirname, '..', 'database', 'backups');
        this.tempPath = path.join(__dirname, '..', 'database', 'temp_backup');
        this.scheduler = null;
        this.isBackingUp = false;
        this.currentBackup = null;
        
        this.backupIndex = new Map();
        this.indexFile = path.join(this.backupPath, 'backup_index.json');
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.backupPath);
        await fs.ensureDir(this.tempPath);
        await this.loadIndex();
        console.log('Backup system initialized');
    }

    async loadIndex() {
        try {
            if (await fs.pathExists(this.indexFile)) {
                const data = await fs.readJson(this.indexFile);
                this.backupIndex = new Map(Object.entries(data));
            }
        } catch (error) {
            console.error('Failed to load backup index:', error);
            this.backupIndex = new Map();
        }
    }

    async saveIndex() {
        try {
            const data = Object.fromEntries(this.backupIndex);
            await fs.writeJson(this.indexFile, data, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save backup index:', error);
        }
    }

    async createBackup(name = null, user = null, options = {}) {
        if (this.isBackingUp) {
            return { success: false, error: 'A backup is already in progress' };
        }

        this.isBackingUp = true;
        const startTime = Date.now();
        
        try {
            const backupId = this.generateBackupId();
            const backupName = name || `backup_${backupId}`;
            const backupDir = path.join(this.backupPath, backupId);
            
            await fs.ensureDir(backupDir);
            
            console.log(`Starting backup: ${backupName} (${backupId})`);
            
            const metadata = {
                id: backupId,
                name: backupName,
                created: new Date().toISOString(),
                timestamp: Date.now(),
                createdBy: user?.username || 'system',
                createdByRole: user?.role || 'system',
                version: '1.0.0',
                size: 0,
                sizeMB: 0,
                compressed: options.compressed !== false,
                includes: {
                    databases: true,
                    files: options.includeFiles !== false,
                    commits: options.includeCommits !== false,
                    users: options.includeUsers !== false,
                    tracking: options.includeTracking === true
                },
                duration: 0
            };
            
            await fs.writeJson(path.join(backupDir, 'metadata.json'), metadata, { spaces: 2 });
            
            if (metadata.includes.databases) {
                await this.backupDatabases(backupDir);
            }
            
            if (metadata.includes.files) {
                await this.backupFiles(backupDir);
            }
            
            if (metadata.includes.commits) {
                await this.backupCommits(backupDir);
            }
            
            if (metadata.includes.users) {
                await this.backupUsers(backupDir);
            }
            
            if (metadata.includes.tracking) {
                await this.backupTracking(backupDir);
            }
            
            const totalSize = await this.getDirectorySize(backupDir);
            metadata.size = totalSize;
            metadata.sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
            metadata.duration = Date.now() - startTime;
            metadata.durationMs = metadata.duration.toFixed(2);
            
            await fs.writeJson(path.join(backupDir, 'metadata.json'), metadata, { spaces: 2 });
            
            let finalPath = backupDir;
            let compressed = false;
            
            if (options.compressed !== false && metadata.sizeMB > 1) {
                const compressedPath = await this.compressBackup(backupDir);
                if (compressedPath) {
                    await fs.remove(backupDir);
                    finalPath = compressedPath;
                    compressed = true;
                    metadata.compressed = true;
                    metadata.compressedSize = (await fs.stat(compressedPath)).size;
                    metadata.compressedSizeMB = (metadata.compressedSize / (1024 * 1024)).toFixed(2);
                }
            }
            
            this.backupIndex.set(backupId, {
                id: backupId,
                name: backupName,
                created: metadata.created,
                timestamp: metadata.timestamp,
                createdBy: metadata.createdBy,
                sizeMB: metadata.sizeMB,
                compressed: compressed,
                path: finalPath
            });
            
            await this.cleanOldBackups();
            await this.saveIndex();
            
            console.log(`Backup completed: ${backupName} (${metadata.sizeMB} MB) in ${metadata.durationMs}ms`);
            
            return {
                success: true,
                backup: {
                    id: backupId,
                    name: backupName,
                    created: metadata.created,
                    sizeMB: metadata.sizeMB,
                    duration: metadata.durationMs,
                    compressed: compressed,
                    path: finalPath
                },
                by: user?.username || 'system'
            };
            
        } catch (error) {
            console.error('Backup failed:', error);
            return { success: false, error: error.message };
        } finally {
            this.isBackingUp = false;
            this.currentBackup = null;
            
            if (await fs.pathExists(this.tempPath)) {
                await fs.remove(this.tempPath);
                await fs.ensureDir(this.tempPath);
            }
        }
    }

    generateBackupId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `${timestamp}_${random}`;
    }

    async backupDatabases(backupDir) {
        const dbPath = path.join(__dirname, '..', 'database', 'path');
        const destPath = path.join(backupDir, 'database');
        
        if (await fs.pathExists(dbPath)) {
            await fs.copy(dbPath, destPath);
            console.log('✓ Databases backed up');
        } else {
            await fs.ensureDir(destPath);
            console.log('⚠ No databases to backup');
        }
    }

    async backupFiles(backupDir) {
        const filesPath = path.join(__dirname, '..', 'database', 'files');
        const destPath = path.join(backupDir, 'files');
        
        if (await fs.pathExists(filesPath)) {
            await fs.copy(filesPath, destPath);
            console.log('✓ Files backed up');
        } else {
            await fs.ensureDir(destPath);
            console.log('⚠ No files to backup');
        }
    }

    async backupCommits(backupDir) {
        const commitsPath = path.join(__dirname, '..', 'database', 'commits');
        const destPath = path.join(backupDir, 'commits');
        
        if (await fs.pathExists(commitsPath)) {
            await fs.copy(commitsPath, destPath);
            console.log('✓ Commits backed up');
        } else {
            await fs.ensureDir(destPath);
        }
    }

    async backupUsers(backupDir) {
        const usersFile = path.join(__dirname, '..', 'database', 'users.json');
        const destPath = path.join(backupDir, 'users.json');
        
        if (await fs.pathExists(usersFile)) {
            await fs.copy(usersFile, destPath);
            console.log('✓ Users backed up');
        }
    }

    async backupTracking(backupDir) {
        const trackingFile = path.join(__dirname, '..', 'database', 'tracking.json');
        const destPath = path.join(backupDir, 'tracking.json');
        
        if (await fs.pathExists(trackingFile)) {
            await fs.copy(trackingFile, destPath);
            console.log('✓ Tracking data backed up');
        }
    }

    async compressBackup(backupDir) {
        const tarPath = `${backupDir}.tar.gz`;
        
        try {
            const archiver = require('archiver');
            const output = fs.createWriteStream(tarPath);
            const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
            
            return new Promise((resolve, reject) => {
                output.on('close', () => resolve(tarPath));
                archive.on('error', reject);
                
                archive.pipe(output);
                archive.directory(backupDir, false);
                archive.finalize();
            });
        } catch (error) {
            console.error('Compression failed:', error);
            return null;
        }
    }

    async decompressBackup(compressedPath) {
        const extractPath = compressedPath.replace('.tar.gz', '');
        
        try {
            const decompress = require('decompress');
            await decompress(compressedPath, extractPath);
            return extractPath;
        } catch (error) {
            console.error('Decompression failed:', error);
            return null;
        }
    }

    async listBackups() {
        const backups = [];
        
        for (const [id, backup] of this.backupIndex.entries()) {
            backups.push({
                id: id,
                name: backup.name,
                created: backup.created,
                createdBy: backup.createdBy,
                sizeMB: backup.sizeMB,
                compressed: backup.compressed
            });
        }
        
        const items = await fs.readdir(this.backupPath);
        
        for (const item of items) {
            const itemPath = path.join(this.backupPath, item);
            const stat = await fs.stat(itemPath);
            
            if (stat.isDirectory() && !this.backupIndex.has(item)) {
                const metadataPath = path.join(itemPath, 'metadata.json');
                if (await fs.pathExists(metadataPath)) {
                    const metadata = await fs.readJson(metadataPath);
                    backups.push({
                        id: item,
                        name: metadata.name || item,
                        created: metadata.created,
                        createdBy: metadata.createdBy,
                        sizeMB: (await this.getDirectorySize(itemPath) / (1024 * 1024)).toFixed(2),
                        compressed: false
                    });
                }
            } else if (item.endsWith('.tar.gz')) {
                const id = item.replace('.tar.gz', '');
                if (!this.backupIndex.has(id)) {
                    backups.push({
                        id: id,
                        name: id,
                        created: new Date(stat.mtime).toISOString(),
                        createdBy: 'unknown',
                        sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
                        compressed: true
                    });
                }
            }
        }
        
        backups.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        return backups;
    }

    async getBackupInfo(backupId) {
        if (this.backupIndex.has(backupId)) {
            return this.backupIndex.get(backupId);
        }
        
        const backupDir = path.join(this.backupPath, backupId);
        const compressedPath = `${backupDir}.tar.gz`;
        
        if (await fs.pathExists(backupDir)) {
            const metadataPath = path.join(backupDir, 'metadata.json');
            if (await fs.pathExists(metadataPath)) {
                return await fs.readJson(metadataPath);
            }
        } else if (await fs.pathExists(compressedPath)) {
            const stat = await fs.stat(compressedPath);
            return {
                id: backupId,
                name: backupId,
                created: new Date(stat.mtime).toISOString(),
                sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
                compressed: true
            };
        }
        
        return null;
    }

    async restoreBackup(backupId, user = null, options = {}) {
        const startTime = Date.now();
        
        let backupPath = path.join(this.backupPath, backupId);
        let compressed = false;
        
        if (!await fs.pathExists(backupPath)) {
            const compressedPath = `${backupPath}.tar.gz`;
            if (await fs.pathExists(compressedPath)) {
                backupPath = await this.decompressBackup(compressedPath);
                compressed = true;
            } else {
                return { success: false, error: `Backup '${backupId}' not found` };
            }
        }
        
        try {
            const metadataPath = path.join(backupPath, 'metadata.json');
            if (!await fs.pathExists(metadataPath)) {
                return { success: false, error: 'Backup metadata not found' };
            }
            
            const metadata = await fs.readJson(metadataPath);
            
            console.log(`Restoring backup: ${metadata.name} (${backupId})`);
            
            if (options.createBackup !== false) {
                await this.createBackup(`before_restore_${backupId}`, user, { compressed: true });
            }
            
            const dbBackup = path.join(backupPath, 'database');
            const dbPath = path.join(__dirname, '..', 'database', 'path');
            
            if (await fs.pathExists(dbBackup)) {
                await fs.remove(dbPath);
                await fs.copy(dbBackup, dbPath);
                console.log('✓ Databases restored');
            }
            
            const filesBackup = path.join(backupPath, 'files');
            const filesPath = path.join(__dirname, '..', 'database', 'files');
            
            if (await fs.pathExists(filesBackup)) {
                await fs.remove(filesPath);
                await fs.copy(filesBackup, filesPath);
                console.log('✓ Files restored');
            }
            
            const commitsBackup = path.join(backupPath, 'commits');
            const commitsPath = path.join(__dirname, '..', 'database', 'commits');
            
            if (await fs.pathExists(commitsBackup)) {
                await fs.remove(commitsPath);
                await fs.copy(commitsBackup, commitsPath);
                console.log('✓ Commits restored');
            }
            
            const usersBackup = path.join(backupPath, 'users.json');
            const usersPath = path.join(__dirname, '..', 'database', 'users.json');
            
            if (await fs.pathExists(usersBackup)) {
                await fs.copy(usersBackup, usersPath);
                console.log('✓ Users restored');
            }
            
            const trackingBackup = path.join(backupPath, 'tracking.json');
            const trackingPath = path.join(__dirname, '..', 'database', 'tracking.json');
            
            if (await fs.pathExists(trackingBackup)) {
                await fs.copy(trackingBackup, trackingPath);
                console.log('✓ Tracking data restored');
            }
            
            const duration = Date.now() - startTime;
            
            console.log(`Restore completed in ${duration}ms`);
            
            return {
                success: true,
                restored: {
                    id: backupId,
                    name: metadata.name,
                    created: metadata.created,
                    sizeMB: metadata.sizeMB
                },
                duration: duration,
                by: user?.username || 'system'
            };
            
        } catch (error) {
            console.error('Restore failed:', error);
            return { success: false, error: error.message };
        } finally {
            if (compressed && await fs.pathExists(backupPath)) {
                await fs.remove(backupPath);
            }
        }
    }

    async deleteBackup(backupId, user = null) {
        try {
            let deleted = false;
            let sizeMB = 0;
            
            const backupDir = path.join(this.backupPath, backupId);
            if (await fs.pathExists(backupDir)) {
                const size = await this.getDirectorySize(backupDir);
                sizeMB = size / (1024 * 1024);
                await fs.remove(backupDir);
                deleted = true;
            }
            
            const compressedPath = `${backupDir}.tar.gz`;
            if (await fs.pathExists(compressedPath)) {
                const stat = await fs.stat(compressedPath);
                sizeMB = stat.size / (1024 * 1024);
                await fs.remove(compressedPath);
                deleted = true;
            }
            
            if (!deleted) {
                return { success: false, error: `Backup '${backupId}' not found` };
            }
            
            this.backupIndex.delete(backupId);
            await this.saveIndex();
            
            return {
                success: true,
                deleted: backupId,
                sizeMB: sizeMB.toFixed(2),
                by: user?.username || 'system'
            };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    startScheduler() {
        const intervalHours = parseInt(process.env.BACKUP_INTERVAL_HOURS) || 24;
        
        if (intervalHours <= 0) {
            console.log('Auto-backup disabled');
            return;
        }
        
        if (this.scheduler) {
            clearInterval(this.scheduler);
        }
        
        this.scheduler = setInterval(async () => {
            console.log('Running scheduled backup...');
            try {
                const result = await this.createBackup(null, { username: 'system' });
                if (result.success) {
                    console.log(`Scheduled backup created: ${result.backup.name} (${result.backup.sizeMB} MB)`);
                } else {
                    console.error('Scheduled backup failed:', result.error);
                }
            } catch (error) {
                console.error('Scheduled backup error:', error);
            }
        }, intervalHours * 3600000);
        
        console.log(`Backup scheduler started (every ${intervalHours} hours)`);
    }

    stopScheduler() {
        if (this.scheduler) {
            clearInterval(this.scheduler);
            this.scheduler = null;
            console.log('Backup scheduler stopped');
        }
    }

    async cleanOldBackups() {
        const maxBackups = parseInt(process.env.MAX_BACKUPS_KEEP) || 10;
        const backups = await this.listBackups();
        
        if (backups.length <= maxBackups) {
            return { kept: backups.length, deleted: 0 };
        }
        
        const toDelete = backups.slice(maxBackups);
        let deleted = 0;
        
        for (const backup of toDelete) {
            await this.deleteBackup(backup.id);
            deleted++;
        }
        
        console.log(`Cleaned up ${deleted} old backups (kept ${maxBackups})`);
        
        return { kept: maxBackups, deleted: deleted };
    }

    async getDirectorySize(dirPath) {
        let size = 0;
        
        if (!await fs.pathExists(dirPath)) {
            return 0;
        }
        
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const filePath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                size += await this.getDirectorySize(filePath);
            } else {
                const stat = await fs.stat(filePath);
                size += stat.size;
            }
        }
        
        return size;
    }

    async getBackupStats() {
        const backups = await this.listBackups();
        const totalSizeMB = backups.reduce((sum, b) => sum + parseFloat(b.sizeMB), 0);
        
        return {
            totalBackups: backups.length,
            totalSizeMB: totalSizeMB.toFixed(2),
            oldestBackup: backups[backups.length - 1]?.created || null,
            newestBackup: backups[0]?.created || null,
            averageSizeMB: backups.length > 0 ? (totalSizeMB / backups.length).toFixed(2) : 0
        };
    }

    async verifyBackup(backupId) {
        const backupInfo = await this.getBackupInfo(backupId);
        
        if (!backupInfo) {
            return { success: false, error: 'Backup not found' };
        }
        
        let backupPath = path.join(this.backupPath, backupId);
        
        if (!await fs.pathExists(backupPath)) {
            const compressedPath = `${backupPath}.tar.gz`;
            if (await fs.pathExists(compressedPath)) {
                backupPath = await this.decompressBackup(compressedPath);
            }
        }
        
        if (!await fs.pathExists(backupPath)) {
            return { success: false, error: 'Backup files not accessible' };
        }
        
        const metadataPath = path.join(backupPath, 'metadata.json');
        if (!await fs.pathExists(metadataPath)) {
            return { success: false, error: 'Metadata missing' };
        }
        
        const dbBackup = path.join(backupPath, 'database');
        if (!await fs.pathExists(dbBackup)) {
            return { success: false, error: 'Database backup missing' };
        }
        
        return {
            success: true,
            backup: backupInfo,
            verified: true,
            sizeMB: backupInfo.sizeMB,
            createdAt: backupInfo.created
        };
    }
}

module.exports = new BackupSystem();
