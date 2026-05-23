// NullName DB - Core Database Engine
// No brand. No name. No payment.
// Version: 1.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class DatabaseEngine {
    constructor() {
        this.dataPath = path.join(__dirname, '..', 'database', 'path');
        this.usersPath = path.join(__dirname, '..', 'database', 'users');
        this.cache = new Map();
        this.locks = new Map();
        this.cacheTimeout = 60000;
        this.writeQueue = [];
        this.isWriting = false;
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.dataPath);
        await fs.ensureDir(this.usersPath);
        console.log('Database engine initialized');
        this.startCacheCleanup();
    }

    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.cache.delete(key);
                }
            }
        }, 300000);
    }

    getCacheKey(dbName, tableName = null, id = null) {
        if (id !== null) return `${dbName}:${tableName}:${id}`;
        if (tableName) return `${dbName}:${tableName}`;
        return `${dbName}`;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    getCache(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    getDbPath(dbName) {
        return path.join(this.dataPath, dbName);
    }

    getTablePath(dbName, tableName) {
        return path.join(this.dataPath, dbName, `${tableName}.json`);
    }

    async ensureDbDir(dbName) {
        const dbPath = this.getDbPath(dbName);
        await fs.ensureDir(dbPath);
        return dbPath;
    }

    async readJson(filePath) {
        try {
            if (await fs.pathExists(filePath)) {
                const content = await fs.readFile(filePath, 'utf8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('Read error:', filePath, error.message);
        }
        return {};
    }

    async writeJson(filePath, data) {
        return new Promise((resolve, reject) => {
            this.writeQueue.push({
                filePath,
                data,
                resolve,
                reject
            });
            this.processWriteQueue();
        });
    }

    async processWriteQueue() {
        if (this.isWriting) return;
        if (this.writeQueue.length === 0) return;

        this.isWriting = true;

        while (this.writeQueue.length > 0) {
            const item = this.writeQueue.shift();
            try {
                await fs.writeJson(item.filePath, item.data, { spaces: 2 });
                item.resolve(true);
            } catch (error) {
                console.error('Write error:', item.filePath, error.message);
                item.reject(error);
            }
        }

        this.isWriting = false;
    }

    async acquireLock(resource) {
        while (this.locks.has(resource)) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.locks.set(resource, Date.now());
        return true;
    }

    releaseLock(resource) {
        this.locks.delete(resource);
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async getAllDatabases(user = null) {
        const databases = [];
        const items = await fs.readdir(this.dataPath);
        
        for (const item of items) {
            const itemPath = path.join(this.dataPath, item);
            const stat = await fs.stat(itemPath);
            if (stat.isDirectory()) {
                databases.push(item);
            }
        }
        
        return { databases: databases, count: databases.length };
    }

    async getDatabase(dbName, user = null) {
        const dbPath = this.getDbPath(dbName);
        
        if (!await fs.pathExists(dbPath)) {
            return { error: `Database '${dbName}' not found` };
        }
        
        const cacheKey = this.getCacheKey(dbName);
        const cached = this.getCache(cacheKey);
        if (cached) return cached;
        
        const tables = {};
        const files = await fs.readdir(dbPath);
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const tableName = file.replace('.json', '');
                const tableData = await this.readJson(path.join(dbPath, file));
                tables[tableName] = tableData;
            }
        }
        
        const result = { [dbName]: tables };
        this.setCache(cacheKey, result);
        
        return result;
    }

    async createDatabase(dbName, user = null) {
        if (!dbName || typeof dbName !== 'string') {
            return { error: 'Invalid database name' };
        }
        
        if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
            return { error: 'Database name can only contain letters, numbers, and underscores' };
        }
        
        const dbPath = this.getDbPath(dbName);
        
        if (await fs.pathExists(dbPath)) {
            return { error: `Database '${dbName}' already exists` };
        }
        
        await this.ensureDbDir(dbName);
        
        this.cache.delete(this.getCacheKey(dbName));
        
        return {
            success: true,
            database: dbName,
            created: new Date().toISOString(),
            by: user?.username || 'system'
        };
    }

    async deleteDatabase(dbName, user = null) {
        const dbPath = this.getDbPath(dbName);
        
        if (!await fs.pathExists(dbPath)) {
            return { error: `Database '${dbName}' not found` };
        }
        
        let size = 0;
        const files = await fs.readdir(dbPath);
        for (const file of files) {
            const filePath = path.join(dbPath, file);
            const stat = await fs.stat(filePath);
            size += stat.size;
        }
        
        await fs.remove(dbPath);
        
        this.cache.delete(this.getCacheKey(dbName));
        
        return {
            success: true,
            database: dbName,
            deleted: true,
            sizeBytes: size,
            by: user?.username || 'system'
        };
    }

    // ============================================
    // TABLE OPERATIONS
    // ============================================

    async getTable(dbName, tableName, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found in database '${dbName}'` };
        }
        
        const cacheKey = this.getCacheKey(dbName, tableName);
        const cached = this.getCache(cacheKey);
        if (cached) return cached;
        
        const data = await this.readJson(tablePath);
        this.setCache(cacheKey, data);
        
        return data;
    }

    async createTable(dbName, tableName, columns = [], user = null) {
        const dbPath = this.getDbPath(dbName);
        
        if (!await fs.pathExists(dbPath)) {
            return { error: `Database '${dbName}' not found` };
        }
        
        if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
            return { error: 'Table name can only contain letters, numbers, and underscores' };
        }
        
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' already exists in database '${dbName}'` };
        }
        
        const initialData = { _nextId: 1 };
        
        await this.writeJson(tablePath, initialData);
        
        this.cache.delete(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            columns: columns,
            created: new Date().toISOString(),
            by: user?.username || 'system'
        };
    }

    async deleteTable(dbName, tableName, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found in database '${dbName}'` };
        }
        
        const stat = await fs.stat(tablePath);
        await fs.remove(tablePath);
        
        this.cache.delete(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            deleted: true,
            sizeBytes: stat.size,
            by: user?.username || 'system'
        };
    }

    // ============================================
    // RECORD OPERATIONS
    // ============================================

    async add(dbName, tableName, columnName, value, user = null) {
        await this.ensureDbDir(dbName);
        
        const tablePath = this.getTablePath(dbName, tableName);
        let data = await this.readJson(tablePath);
        
        if (Object.keys(data).length === 0) {
            data = { _nextId: 1 };
        }
        
        if (!data._nextId) {
            data._nextId = 1;
        }
        
        if (typeof value === 'string' && value.includes(',') && !value.startsWith('[')) {
            const values = value.split(',').map(v => this.parseValue(v.trim()));
            
            const ids = [];
            for (const v of values) {
                const id = data._nextId++;
                if (!data[id]) data[id] = {};
                data[id][columnName] = v;
                ids.push(id);
            }
            
            await this.writeJson(tablePath, data);
            this.cache.delete(this.getCacheKey(dbName, tableName));
            
            return {
                success: true,
                database: dbName,
                table: tableName,
                column: columnName,
                count: values.length,
                ids: ids,
                by: user?.username || 'system'
            };
        }
        
        const id = data._nextId++;
        if (!data[id]) data[id] = {};
        data[id][columnName] = this.parseValue(value);
        
        await this.writeJson(tablePath, data);
        this.cache.delete(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            column: columnName,
            value: this.parseValue(value),
            id: id,
            by: user?.username || 'system'
        };
    }

    async getColumn(dbName, tableName, columnName, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found` };
        }
        
        const data = await this.readJson(tablePath);
        const result = {};
        
        for (const [id, row] of Object.entries(data)) {
            if (id !== '_nextId' && row[columnName] !== undefined) {
                result[id] = row[columnName];
            }
        }
        
        return result;
    }

    async getById(dbName, tableName, id, columnName = null, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found` };
        }
        
        const data = await this.readJson(tablePath);
        const row = data[id];
        
        if (!row) {
            return { error: `Record with ID ${id} not found` };
        }
        
        if (columnName) {
            return { [columnName]: row[columnName] };
        }
        
        return { id: id, ...row };
    }

    async update(dbName, tableName, id, columnName, value, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found` };
        }
        
        const data = await this.readJson(tablePath);
        
        if (!data[id]) {
            return { error: `Record with ID ${id} not found` };
        }
        
        const oldValue = data[id][columnName];
        data[id][columnName] = this.parseValue(value);
        
        await this.writeJson(tablePath, data);
        this.cache.delete(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            id: id,
            column: columnName,
            oldValue: oldValue,
            newValue: this.parseValue(value),
            by: user?.username || 'system'
        };
    }

    async deleteById(dbName, tableName, id, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found` };
        }
        
        const data = await this.readJson(tablePath);
        
        if (!data[id]) {
            return { error: `Record with ID ${id} not found` };
        }
        
        const deletedRow = { ...data[id] };
        delete data[id];
        
        await this.writeJson(tablePath, data);
        this.cache.delete(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            id: id,
            deleted: deletedRow,
            by: user?.username || 'system'
        };
    }

    // ============================================
    // SIMPLE KEY-VALUE OPERATIONS
    // ============================================

    async set(key, value, user = null) {
        const kvPath = path.join(this.dataPath, '_keyvalue.json');
        let data = await this.readJson(kvPath);
        
        const oldValue = data[key];
        data[key] = value;
        
        await this.writeJson(kvPath, data);
        
        return {
            success: true,
            key: key,
            oldValue: oldValue,
            newValue: value,
            by: user?.username || 'system'
        };
    }

    async get(key, user = null) {
        const kvPath = path.join(this.dataPath, '_keyvalue.json');
        const data = await this.readJson(kvPath);
        
        if (data[key] === undefined) {
            return { error: `Key '${key}' not found` };
        }
        
        return { [key]: data[key] };
    }

    async delete(key, user = null) {
        const kvPath = path.join(this.dataPath, '_keyvalue.json');
        let data = await this.readJson(kvPath);
        
        if (data[key] === undefined) {
            return { error: `Key '${key}' not found` };
        }
        
        const deletedValue = data[key];
        delete data[key];
        
        await this.writeJson(kvPath, data);
        
        return {
            success: true,
            key: key,
            deleted: deletedValue,
            by: user?.username || 'system'
        };
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    parseValue(value) {
        if (value === null || value === 'null') return null;
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        if (!isNaN(value) && value !== '') {
            const num = Number(value);
            if (Number.isInteger(num)) return num;
            return num;
        }
        
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
                (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    return JSON.parse(trimmed);
                } catch (e) {}
            }
        }
        
        return value;
    }

    async getStats() {
        let databases = 0;
        let tables = 0;
        let records = 0;
        let totalSize = 0;
        
        const dbDirs = await fs.readdir(this.dataPath);
        databases = dbDirs.length;
        
        for (const db of dbDirs) {
            const dbPath = path.join(this.dataPath, db);
            const stat = await fs.stat(dbPath);
            
            if (stat.isDirectory()) {
                const tableFiles = await fs.readdir(dbPath);
                tables += tableFiles.length;
                
                for (const table of tableFiles) {
                    const tablePath = path.join(dbPath, table);
                    const tableStat = await fs.stat(tablePath);
                    totalSize += tableStat.size;
                    
                    if (table.endsWith('.json')) {
                        const data = await this.readJson(tablePath);
                        records += Object.keys(data).filter(k => !isNaN(k)).length;
                    }
                }
            }
        }
        
        return {
            databases: databases,
            tables: tables,
            records: records,
            totalSizeBytes: totalSize,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
        };
    }

    async clearCache() {
        const size = this.cache.size;
        this.cache.clear();
        return { cleared: size };
    }
}

module.exports = new DatabaseEngine();