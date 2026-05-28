// NullName DB - Time Travel Engine
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class TimeTravelEngine {
    constructor() {
        this.timelinePath = path.join(__dirname, '..', 'database', 'timeline');
        this.snapshotsPath = path.join(__dirname, '..', 'database', 'snapshots');
        this.indexPath = path.join(this.timelinePath, '_index.json');
        this.cache = new Map();
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.timelinePath);
        await fs.ensureDir(this.snapshotsPath);
        await this.ensureIndex();
        console.log('Time travel engine initialized');
    }

    async ensureIndex() {
        if (!await fs.pathExists(this.indexPath)) {
            await fs.writeJson(this.indexPath, {
                databases: {},
                lastIndexed: null,
                version: '2.0.0'
            }, { spaces: 2 });
        }
    }

    async loadIndex() {
        return await fs.readJson(this.indexPath);
    }

    async saveIndex(index) {
        await fs.writeJson(this.indexPath, index, { spaces: 2 });
    }

    parseDateInput(dateInput) {
        if (!dateInput) return null;
        
        if (dateInput === 'now') return Date.now();
        
        const relativeMatch = dateInput.match(/^(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mon|years?|y)$/i);
        if (relativeMatch) {
            const value = parseInt(relativeMatch[1]);
            const unit = relativeMatch[2].toLowerCase();
            const multipliers = {
                'second': 1000, 'sec': 1000, 's': 1000,
                'minute': 60000, 'min': 60000, 'm': 60000,
                'hour': 3600000, 'hr': 3600000, 'h': 3600000,
                'day': 86400000, 'd': 86400000,
                'week': 604800000, 'w': 604800000,
                'month': 2592000000, 'mon': 2592000000,
                'year': 31536000000, 'y': 31536000000
            };
            const multiplier = multipliers[unit] || 1000;
            return Date.now() - (value * multiplier);
        }
        
        const date = new Date(dateInput);
        if (!isNaN(date.getTime())) {
            return date.getTime();
        }
        
        return null;
    }

    async getCommitAtTime(timestamp, dbName = null) {
        const commitsPath = path.join(__dirname, '..', 'database', 'commits');
        if (!await fs.pathExists(commitsPath)) return null;
        
        const commits = await fs.readdir(commitsPath);
        let closestCommit = null;
        let closestDiff = Infinity;
        
        for (const commitFile of commits) {
            if (!commitFile.endsWith('.json')) continue;
            const commitPath = path.join(commitsPath, commitFile);
            const commit = await fs.readJson(commitPath);
            
            if (dbName && !commit.snapshot?.databases?.[dbName]) continue;
            
            const diff = Math.abs(commit.timestamp - timestamp);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestCommit = commit;
            }
        }
        
        return closestCommit;
    }

    async getCellHistory(dbName, tableName, rowId, columnName) {
        const historyPath = path.join(this.timelinePath, dbName, tableName, `row_${rowId}`, `${columnName}.json`);
        if (!await fs.pathExists(historyPath)) {
            return [];
        }
        return await fs.readJson(historyPath);
    }

    async recordChange(dbName, tableName, rowId, columnName, oldValue, newValue, user = null) {
        const historyPath = path.join(this.timelinePath, dbName, tableName, `row_${rowId}`);
        await fs.ensureDir(historyPath);
        
        const historyFile = path.join(historyPath, `${columnName}.json`);
        let history = [];
        
        if (await fs.pathExists(historyFile)) {
            history = await fs.readJson(historyFile);
        }
        
        history.push({
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            oldValue: oldValue,
            newValue: newValue,
            user: user?.username || 'system',
            operation: 'UPDATE'
        });
        
        await fs.writeJson(historyFile, history, { spaces: 2 });
        
        const index = await this.loadIndex();
        if (!index.databases[dbName]) index.databases[dbName] = {};
        if (!index.databases[dbName][tableName]) index.databases[dbName][tableName] = {};
        if (!index.databases[dbName][tableName][rowId]) index.databases[dbName][tableName][rowId] = [];
        if (!index.databases[dbName][tableName][rowId].includes(columnName)) {
            index.databases[dbName][tableName][rowId].push(columnName);
        }
        index.lastIndexed = Date.now();
        await this.saveIndex(index);
        
        return { success: true };
    }

    async travelDatabase(dbName, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const commit = await this.getCommitAtTime(targetTime, dbName);
        if (!commit) {
            return { error: `No snapshot found for ${dbName} at ${timestamp}` };
        }
        
        const snapshot = commit.snapshot.databases[dbName] || {};
        
        return {
            success: true,
            database: dbName,
            timestamp: new Date(targetTime).toISOString(),
            actualCommit: new Date(commit.timestamp).toISOString(),
            data: snapshot,
            message: `Viewing ${dbName} as it was at ${timestamp}`
        };
    }

    async travelTable(dbName, tableName, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const commit = await this.getCommitAtTime(targetTime, dbName);
        if (!commit) {
            return { error: `No snapshot found for ${dbName} at ${timestamp}` };
        }
        
        const tableData = commit.snapshot.databases?.[dbName]?.[tableName] || {};
        
        const records = [];
        for (const [id, row] of Object.entries(tableData)) {
            if (id !== '_nextId' && id !== '_schema') {
                records.push({ id: parseInt(id), ...row });
            }
        }
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            timestamp: new Date(targetTime).toISOString(),
            actualCommit: new Date(commit.timestamp).toISOString(),
            records: records,
            count: records.length,
            message: `Viewing ${dbName}.${tableName} as it was at ${timestamp}`
        };
    }

    async travelRow(dbName, tableName, rowId, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const commit = await this.getCommitAtTime(targetTime, dbName);
        if (!commit) {
            return { error: `No snapshot found for ${dbName} at ${timestamp}` };
        }
        
        const rowData = commit.snapshot.databases?.[dbName]?.[tableName]?.[rowId] || {};
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            rowId: parseInt(rowId),
            timestamp: new Date(targetTime).toISOString(),
            actualCommit: new Date(commit.timestamp).toISOString(),
            data: { id: parseInt(rowId), ...rowData },
            message: `Viewing ${dbName}.${tableName}.${rowId} as it was at ${timestamp}`
        };
    }

    async travelCell(dbName, tableName, rowId, columnName, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const history = await this.getCellHistory(dbName, tableName, rowId, columnName);
        
        let value = null;
        let closestHistory = null;
        let closestDiff = Infinity;
        
        for (const entry of history) {
            const diff = Math.abs(entry.timestamp - targetTime);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestHistory = entry;
                value = entry.oldValue;
            }
        }
        
        if (!closestHistory && await this.getCommitAtTime(targetTime, dbName)) {
            const commit = await this.getCommitAtTime(targetTime, dbName);
            value = commit.snapshot.databases?.[dbName]?.[tableName]?.[rowId]?.[columnName] || null;
        }
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            rowId: parseInt(rowId),
            column: columnName,
            timestamp: new Date(targetTime).toISOString(),
            value: value,
            message: `Cell value at ${timestamp}: ${value}`
        };
    }

    async restoreDatabase(dbName, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const commit = await this.getCommitAtTime(targetTime, dbName);
        if (!commit) {
            return { error: `No snapshot found for ${dbName} at ${timestamp}` };
        }
        
        const snapshot = commit.snapshot.databases[dbName] || {};
        const dbPath = path.join(__dirname, '..', 'database', 'sql', dbName);
        
        if (await fs.pathExists(dbPath)) {
            const backupPath = path.join(this.snapshotsPath, `${dbName}_before_restore_${Date.now()}`);
            await fs.copy(dbPath, backupPath);
        }
        
        await fs.emptyDir(dbPath);
        
        for (const [tableName, tableData] of Object.entries(snapshot)) {
            const tablePath = path.join(dbPath, `${tableName}.json`);
            await fs.writeJson(tablePath, tableData, { spaces: 2 });
        }
        
        const commitFile = require('./commit');
        await commitFile.create(`Restored database ${dbName} to ${timestamp}`, user);
        
        return {
            success: true,
            database: dbName,
            restoredTo: new Date(targetTime).toISOString(),
            fromCommit: commit.id,
            tables: Object.keys(snapshot).length,
            message: `Database ${dbName} restored to state at ${timestamp}`
        };
    }

    async restoreTable(dbName, tableName, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const commit = await this.getCommitAtTime(targetTime, dbName);
        if (!commit) {
            return { error: `No snapshot found for ${dbName} at ${timestamp}` };
        }
        
        const tableData = commit.snapshot.databases?.[dbName]?.[tableName];
        if (!tableData) {
            return { error: `Table ${tableName} not found in snapshot` };
        }
        
        const tablePath = path.join(__dirname, '..', 'database', 'sql', dbName, `${tableName}.json`);
        
        const backupPath = path.join(this.snapshotsPath, `${dbName}_${tableName}_before_restore_${Date.now()}.json`);
        if (await fs.pathExists(tablePath)) {
            await fs.copy(tablePath, backupPath);
        }
        
        await fs.writeJson(tablePath, tableData, { spaces: 2 });
        
        const commitFile = require('./commit');
        await commitFile.create(`Restored table ${dbName}.${tableName} to ${timestamp}`, user);
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            restoredTo: new Date(targetTime).toISOString(),
            fromCommit: commit.id,
            records: Object.keys(tableData).filter(k => !isNaN(k)).length,
            message: `Table ${dbName}.${tableName} restored to state at ${timestamp}`
        };
    }

    async restoreRow(dbName, tableName, rowId, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const commit = await this.getCommitAtTime(targetTime, dbName);
        if (!commit) {
            return { error: `No snapshot found for ${dbName} at ${timestamp}` };
        }
        
        const rowData = commit.snapshot.databases?.[dbName]?.[tableName]?.[rowId];
        if (!rowData) {
            return { error: `Row ${rowId} not found in snapshot` };
        }
        
        const tablePath = path.join(__dirname, '..', 'database', 'sql', dbName, `${tableName}.json`);
        const currentData = await fs.readJson(tablePath);
        
        currentData[rowId] = rowData;
        await fs.writeJson(tablePath, currentData, { spaces: 2 });
        
        const commitFile = require('./commit');
        await commitFile.create(`Restored row ${dbName}.${tableName}.${rowId} to ${timestamp}`, user);
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            rowId: parseInt(rowId),
            restoredTo: new Date(targetTime).toISOString(),
            fromCommit: commit.id,
            data: rowData,
            message: `Row ${dbName}.${tableName}.${rowId} restored to state at ${timestamp}`
        };
    }

    async restoreCell(dbName, tableName, rowId, columnName, timestamp, user = null) {
        const targetTime = this.parseDateInput(timestamp);
        if (!targetTime) {
            return { error: `Invalid timestamp: ${timestamp}` };
        }
        
        const history = await this.getCellHistory(dbName, tableName, rowId, columnName);
        
        let oldValue = null;
        let closestHistory = null;
        let closestDiff = Infinity;
        
        for (const entry of history) {
            const diff = Math.abs(entry.timestamp - targetTime);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestHistory = entry;
                oldValue = entry.oldValue;
            }
        }
        
        if (oldValue === null && await this.getCommitAtTime(targetTime, dbName)) {
            const commit = await this.getCommitAtTime(targetTime, dbName);
            oldValue = commit.snapshot.databases?.[dbName]?.[tableName]?.[rowId]?.[columnName] || null;
        }
        
        const tablePath = path.join(__dirname, '..', 'database', 'sql', dbName, `${tableName}.json`);
        const currentData = await fs.readJson(tablePath);
        
        const currentValue = currentData[rowId]?.[columnName];
        currentData[rowId][columnName] = oldValue;
        await fs.writeJson(tablePath, currentData, { spaces: 2 });
        
        await this.recordChange(dbName, tableName, rowId, columnName, oldValue, currentValue, user);
        
        const commitFile = require('./commit');
        await commitFile.create(`Restored cell ${dbName}.${tableName}.${rowId}.${columnName} to ${timestamp}`, user);
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            rowId: parseInt(rowId),
            column: columnName,
            restoredTo: new Date(targetTime).toISOString(),
            oldValue: oldValue,
            newValue: currentValue,
            message: `Cell ${dbName}.${tableName}.${rowId}.${columnName} restored to value: ${oldValue}`
        };
    }

    async createSnapshot(dbName, name = null, user = null) {
        const snapshotId = crypto.randomBytes(8).toString('hex');
        const snapshotName = name || `snapshot_${new Date().toISOString().replace(/[:.]/g, '_')}`;
        
        const commitFile = require('./commit');
        const commit = await commitFile.create(`Snapshot: ${snapshotName}`, user);
        
        const snapshot = {
            id: snapshotId,
            name: snapshotName,
            commitId: commit.commit.id,
            database: dbName,
            created: Date.now(),
            createdISO: new Date().toISOString(),
            createdBy: user?.username || 'system'
        };
        
        const snapshotPath = path.join(this.snapshotsPath, `${snapshotId}.json`);
        await fs.writeJson(snapshotPath, snapshot, { spaces: 2 });
        
        return {
            success: true,
            snapshot: snapshot,
            message: `Snapshot '${snapshotName}' created`
        };
    }

    async listSnapshots(dbName = null) {
        const snapshots = [];
        const files = await fs.readdir(this.snapshotsPath);
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const snapshot = await fs.readJson(path.join(this.snapshotsPath, file));
                if (!dbName || snapshot.database === dbName) {
                    snapshots.push(snapshot);
                }
            }
        }
        
        snapshots.sort((a, b) => b.created - a.created);
        
        return snapshots;
    }

    async restoreSnapshot(snapshotId, user = null) {
        const snapshotPath = path.join(this.snapshotsPath, `${snapshotId}.json`);
        if (!await fs.pathExists(snapshotPath)) {
            return { error: `Snapshot '${snapshotId}' not found` };
        }
        
        const snapshot = await fs.readJson(snapshotPath);
        const commitFile = require('./commit');
        
        const result = await commitFile.checkout(snapshot.commitId, user);
        
        return {
            success: true,
            snapshot: snapshot.name,
            restoredTo: snapshot.createdISO,
            commit: snapshot.commitId,
            message: `Restored to snapshot '${snapshot.name}'`
        };
    }

    async getTimeline(dbName, tableName = null, rowId = null, limit = 100) {
        const timeline = [];
        
        if (rowId && tableName) {
            const rowPath = path.join(this.timelinePath, dbName, tableName, `row_${rowId}`);
            if (await fs.pathExists(rowPath)) {
                const columns = await fs.readdir(rowPath);
                for (const column of columns) {
                    if (column.endsWith('.json')) {
                        const columnName = column.replace('.json', '');
                        const history = await fs.readJson(path.join(rowPath, column));
                        for (const entry of history) {
                            timeline.push({
                                type: 'cell',
                                database: dbName,
                                table: tableName,
                                rowId: rowId,
                                column: columnName,
                                ...entry
                            });
                        }
                    }
                }
            }
        } else if (tableName) {
            const tablePath = path.join(this.timelinePath, dbName, tableName);
            if (await fs.pathExists(tablePath)) {
                const rows = await fs.readdir(tablePath);
                for (const row of rows) {
                    const rowIdNum = parseInt(row.replace('row_', ''));
                    const rowTimeline = await this.getTimeline(dbName, tableName, rowIdNum, limit);
                    timeline.push(...rowTimeline);
                }
            }
        } else {
            const commits = await this.getCommitAtTime(Date.now(), dbName);
            if (commits) {
                timeline.push({
                    type: 'commit',
                    database: dbName,
                    commitId: commits.id,
                    timestamp: commits.timestamp,
                    timestampISO: commits.timestampISO,
                    message: commits.message,
                    author: commits.author
                });
            }
        }
        
        timeline.sort((a, b) => b.timestamp - a.timestamp);
        
        return timeline.slice(0, limit);
    }

    async diffTimestamps(timestamp1, timestamp2, dbName = null) {
        const time1 = this.parseDateInput(timestamp1);
        const time2 = this.parseDateInput(timestamp2);
        
        if (!time1 || !time2) {
            return { error: 'Invalid timestamps' };
        }
        
        const commit1 = await this.getCommitAtTime(time1, dbName);
        const commit2 = await this.getCommitAtTime(time2, dbName);
        
        if (!commit1 || !commit2) {
            return { error: 'No snapshots found at one of the timestamps' };
        }
        
        const commitFile = require('./commit');
        const diff = await commitFile.diff(commit1.id, commit2.id);
        
        return {
            success: true,
            from: new Date(time1).toISOString(),
            to: new Date(time2).toISOString(),
            fromCommit: commit1.id,
            toCommit: commit2.id,
            changes: diff.changes,
            summary: diff.summary
        };
    }

    async getStats() {
        const index = await this.loadIndex();
        let totalDatabases = Object.keys(index.databases).length;
        let totalTables = 0;
        let totalRows = 0;
        let totalChanges = 0;
        
        for (const db of Object.values(index.databases)) {
            totalTables += Object.keys(db).length;
            for (const table of Object.values(db)) {
                totalRows += Object.keys(table).length;
                for (const row of Object.values(table)) {
                    totalChanges += row.length;
                }
            }
        }
        
        const snapshots = await this.listSnapshots();
        
        return {
            databases: totalDatabases,
            tables: totalTables,
            rows: totalRows,
            totalChanges: totalChanges,
            snapshots: snapshots.length,
            lastIndexed: index.lastIndexed ? new Date(index.lastIndexed).toISOString() : null
        };
    }
}

module.exports = new TimeTravelEngine();
