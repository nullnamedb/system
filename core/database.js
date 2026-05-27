// NullName DB - Core Database Engine
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class DatabaseEngine {
    constructor() {
        this.dataPath = path.join(__dirname, '..', 'database', 'sql');
        this.kvPath = path.join(__dirname, '..', 'database', 'keyvalue.json');
        this.cache = new Map();
        this.locks = new Map();
        this.cacheTimeout = 60000;
        this.writeQueue = [];
        this.isWriting = false;
        this.indexes = new Map();
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.dataPath);
        await this.ensureKeyValueFile();
        await this.loadIndexes();
        this.startCacheCleanup();
        console.log('Database engine initialized');
    }

    async ensureKeyValueFile() {
        if (!await fs.pathExists(this.kvPath)) {
            await fs.writeJson(this.kvPath, {}, { spaces: 2 });
        }
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

    async loadIndexes() {
        const indexPath = path.join(this.dataPath, '_indexes.json');
        if (await fs.pathExists(indexPath)) {
            this.indexes = new Map(Object.entries(await fs.readJson(indexPath)));
        }
    }

    async saveIndexes() {
        const indexPath = path.join(this.dataPath, '_indexes.json');
        const indexObj = Object.fromEntries(this.indexes);
        await fs.writeJson(indexPath, indexObj, { spaces: 2 });
    }

    getCacheKey(dbName, tableName = null, id = null) {
        if (id !== null) return `${dbName}:${tableName}:${id}`;
        if (tableName) return `${dbName}:${tableName}`;
        return `${dbName}`;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: JSON.parse(JSON.stringify(data)),
            timestamp: Date.now()
        });
    }

    getCache(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return JSON.parse(JSON.stringify(cached.data));
        }
        return null;
    }

    clearCache(key = null) {
        if (key) {
            this.cache.delete(key);
        } else {
            this.cache.clear();
        }
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

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async getAllDatabases(user = null) {
        const databases = [];
        const items = await fs.readdir(this.dataPath);
        
        for (const item of items) {
            const itemPath = path.join(this.dataPath, item);
            const stat = await fs.stat(itemPath);
            if (stat.isDirectory() && !item.startsWith('_')) {
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
            if (file.endsWith('.json') && !file.startsWith('_')) {
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
        
        const schemaFile = path.join(dbPath, '_schema.json');
        await fs.writeJson(schemaFile, {
            name: dbName,
            created: new Date().toISOString(),
            createdBy: user?.username || 'system',
            tables: []
        }, { spaces: 2 });
        
        this.clearCache(this.getCacheKey(dbName));
        
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
        
        this.clearCache(this.getCacheKey(dbName));
        
        return {
            success: true,
            database: dbName,
            deleted: true,
            sizeBytes: size,
            sizeMB: (size / (1024 * 1024)).toFixed(2),
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
        
        const records = [];
        for (const [id, row] of Object.entries(data)) {
            if (id !== '_nextId' && id !== '_schema' && !id.startsWith('_')) {
                records.push({ id: parseInt(id), ...row });
            }
        }
        
        return { table: tableName, records: records, count: records.length };
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
        
        const schema = {
            _nextId: 1,
            _schema: {
                name: tableName,
                created: new Date().toISOString(),
                createdBy: user?.username || 'system',
                columns: columns.map(col => ({ name: col, type: 'TEXT' }))
            }
        };
        
        await this.writeJson(tablePath, schema);
        
        const schemaFile = path.join(dbPath, '_schema.json');
        const dbSchema = await this.readJson(schemaFile);
        dbSchema.tables.push(tableName);
        await fs.writeJson(schemaFile, dbSchema, { spaces: 2 });
        
        this.clearCache(this.getCacheKey(dbName, tableName));
        
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
        
        const schemaFile = path.join(this.getDbPath(dbName), '_schema.json');
        const dbSchema = await this.readJson(schemaFile);
        dbSchema.tables = dbSchema.tables.filter(t => t !== tableName);
        await fs.writeJson(schemaFile, dbSchema, { spaces: 2 });
        
        this.clearCache(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            deleted: true,
            sizeBytes: stat.size,
            by: user?.username || 'system'
        };
    }

    async deleteColumn(dbName, tableName, columnName, user = null) {
        const tablePath = this.getTablePath(dbName, tableName);
        
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found` };
        }
        
        const data = await this.readJson(tablePath);
        
        for (const [id, row] of Object.entries(data)) {
            if (id !== '_nextId' && id !== '_schema' && row[columnName] !== undefined) {
                delete row[columnName];
            }
        }
        
        if (data._schema && data._schema.columns) {
            data._schema.columns = data._schema.columns.filter(c => c.name !== columnName);
        }
        
        await this.writeJson(tablePath, data);
        this.clearCache(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            column: columnName,
            deleted: true,
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
            data = { _nextId: 1, _schema: { columns: [] } };
        }
        
        if (!data._nextId) {
            data._nextId = 1;
        }
        
        if (!data._schema) {
            data._schema = { columns: [] };
        }
        
        if (!data._schema.columns.find(c => c.name === columnName)) {
            data._schema.columns.push({ name: columnName, type: typeof value });
        }
        
        if (typeof value === 'string' && value.includes(',') && !value.startsWith('[')) {
            const values = value.split(',').map(v => this.parseValue(v.trim()));
            
            const ids = [];
            for (const v of values) {
                const id = data._nextId++;
                if (!data[id]) data[id] = {};
                data[id][columnName] = v;
                ids.push(id);
                
                await this.updateIndex(dbName, tableName, columnName, v, id);
            }
            
            await this.writeJson(tablePath, data);
            this.clearCache(this.getCacheKey(dbName, tableName));
            
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
        const parsedValue = this.parseValue(value);
        data[id][columnName] = parsedValue;
        
        await this.updateIndex(dbName, tableName, columnName, parsedValue, id);
        
        await this.writeJson(tablePath, data);
        this.clearCache(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            column: columnName,
            value: parsedValue,
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
            if (id !== '_nextId' && id !== '_schema' && row[columnName] !== undefined) {
                result[id] = row[columnName];
            }
        }
        
        return { column: columnName, values: result, count: Object.keys(result).length };
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
        const newValue = this.parseValue(value);
        data[id][columnName] = newValue;
        
        await this.updateIndex(dbName, tableName, columnName, newValue, id, oldValue);
        
        await this.writeJson(tablePath, data);
        this.clearCache(this.getCacheKey(dbName, tableName));
        
        return {
            success: true,
            database: dbName,
            table: tableName,
            id: id,
            column: columnName,
            oldValue: oldValue,
            newValue: newValue,
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
        
        await this.removeFromIndexes(dbName, tableName, id);
        
        await this.writeJson(tablePath, data);
        this.clearCache(this.getCacheKey(dbName, tableName));
        
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
    // INDEX MANAGEMENT
    // ============================================

    async createIndex(dbName, tableName, columnName, user = null) {
        const key = `${dbName}:${tableName}:${columnName}`;
        
        if (this.indexes.has(key)) {
            return { error: `Index already exists on ${dbName}.${tableName}.${columnName}` };
        }
        
        const tablePath = this.getTablePath(dbName, tableName);
        if (!await fs.pathExists(tablePath)) {
            return { error: `Table '${tableName}' not found` };
        }
        
        const data = await this.readJson(tablePath);
        const index = new Map();
        
        for (const [id, row] of Object.entries(data)) {
            if (id !== '_nextId' && id !== '_schema' && row[columnName] !== undefined) {
                const value = row[columnName];
                const valueKey = JSON.stringify(value);
                if (!index.has(valueKey)) {
                    index.set(valueKey, []);
                }
                index.get(valueKey).push(parseInt(id));
            }
        }
        
        this.indexes.set(key, index);
        await this.saveIndexes();
        
        return {
            success: true,
            index: `${dbName}.${tableName}.${columnName}`,
            entries: index.size,
            by: user?.username || 'system'
        };
    }

    async updateIndex(dbName, tableName, columnName, value, id, oldValue = null) {
        const key = `${dbName}:${tableName}:${columnName}`;
        
        if (this.indexes.has(key)) {
            const index = this.indexes.get(key);
            
            if (oldValue !== null) {
                const oldKey = JSON.stringify(oldValue);
                if (index.has(oldKey)) {
                    const ids = index.get(oldKey).filter(i => i !== id);
                    if (ids.length === 0) {
                        index.delete(oldKey);
                    } else {
                        index.set(oldKey, ids);
                    }
                }
            }
            
            const newKey = JSON.stringify(value);
            if (!index.has(newKey)) {
                index.set(newKey, []);
            }
            if (!index.get(newKey).includes(id)) {
                index.get(newKey).push(id);
            }
            
            this.indexes.set(key, index);
            await this.saveIndexes();
        }
    }

    async removeFromIndexes(dbName, tableName, id) {
        for (const [key, index] of this.indexes.entries()) {
            if (key.startsWith(`${dbName}:${tableName}:`)) {
                for (const [valueKey, ids] of index.entries()) {
                    const newIds = ids.filter(i => i !== id);
                    if (newIds.length === 0) {
                        index.delete(valueKey);
                    } else {
                        index.set(valueKey, newIds);
                    }
                }
                this.indexes.set(key, index);
            }
        }
        await this.saveIndexes();
    }

    async findUsingIndex(dbName, tableName, columnName, value) {
        const key = `${dbName}:${tableName}:${columnName}`;
        
        if (!this.indexes.has(key)) {
            return null;
        }
        
        const index = this.indexes.get(key);
        const valueKey = JSON.stringify(value);
        
        return index.get(valueKey) || [];
    }

    // ============================================
    // KEY-VALUE OPERATIONS
    // ============================================

    async set(key, value, user = null) {
        let data = await this.readJson(this.kvPath);
        
        const oldValue = data[key];
        data[key] = this.parseValue(value);
        
        await this.writeJson(this.kvPath, data);
        
        return {
            success: true,
            key: key,
            oldValue: oldValue,
            newValue: data[key],
            by: user?.username || 'system'
        };
    }

    async get(key, user = null) {
        const data = await this.readJson(this.kvPath);
        
        if (data[key] === undefined) {
            return { error: `Key '${key}' not found` };
        }
        
        return { [key]: data[key] };
    }

    async delete(key, user = null) {
        let data = await this.readJson(this.kvPath);
        
        if (data[key] === undefined) {
            return { error: `Key '${key}' not found` };
        }
        
        const deletedValue = data[key];
        delete data[key];
        
        await this.writeJson(this.kvPath, data);
        
        return {
            success: true,
            key: key,
            deleted: deletedValue,
            by: user?.username || 'system'
        };
    }

    async getAllKeys() {
        const data = await this.readJson(this.kvPath);
        return Object.keys(data);
    }

    // ============================================
    // SEARCH OPERATIONS
    // ============================================

    async searchAll(keyword, user = null) {
        const results = [];
        const databases = await this.getAllDatabases(user);
        
        for (const dbName of databases.databases) {
            const dbPath = this.getDbPath(dbName);
            const tables = await fs.readdir(dbPath);
            
            for (const tableFile of tables) {
                if (tableFile.endsWith('.json') && !tableFile.startsWith('_')) {
                    const tableName = tableFile.replace('.json', '');
                    const data = await this.readJson(path.join(dbPath, tableFile));
                    
                    for (const [id, row] of Object.entries(data)) {
                        if (id !== '_nextId' && id !== '_schema') {
                            for (const [col, val] of Object.entries(row)) {
                                if (String(val).toLowerCase().includes(keyword.toLowerCase())) {
                                    results.push({
                                        database: dbName,
                                        table: tableName,
                                        id: id,
                                        column: col,
                                        value: val
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        const kvData = await this.readJson(this.kvPath);
        for (const [key, value] of Object.entries(kvData)) {
            if (String(key).toLowerCase().includes(keyword.toLowerCase()) ||
                String(value).toLowerCase().includes(keyword.toLowerCase())) {
                results.push({
                    type: 'keyvalue',
                    key: key,
                    value: value
                });
            }
        }
        
        return results;
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    async getStats() {
        let databases = 0;
        let tables = 0;
        let records = 0;
        let totalSize = 0;
        
        const dbDirs = await fs.readdir(this.dataPath);
        databases = dbDirs.filter(d => !d.startsWith('_')).length;
        
        for (const db of dbDirs) {
            if (db.startsWith('_')) continue;
            const dbPath = path.join(this.dataPath, db);
            const stat = await fs.stat(dbPath);
            
            if (stat.isDirectory()) {
                const tableFiles = await fs.readdir(dbPath);
                const tableCount = tableFiles.filter(f => f.endsWith('.json') && !f.startsWith('_')).length;
                tables += tableCount;
                
                for (const table of tableFiles) {
                    if (table.endsWith('.json') && !table.startsWith('_')) {
                        const tablePath = path.join(dbPath, table);
                        const tableStat = await fs.stat(tablePath);
                        totalSize += tableStat.size;
                        
                        const data = await this.readJson(tablePath);
                        records += Object.keys(data).filter(k => !isNaN(k) && k !== '_nextId' && k !== '_schema').length;
                    }
                }
            }
        }
        
        const kvStat = await fs.stat(this.kvPath);
        totalSize += kvStat.size;
        
        return {
            databases: databases,
            tables: tables,
            records: records,
            totalSizeBytes: totalSize,
            totalSizeKB: (totalSize / 1024).toFixed(2),
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
            indexes: this.indexes.size
        };
    }

    async backupDatabase(dbName, backupPath = null) {
        const dbPath = this.getDbPath(dbName);
        
        if (!await fs.pathExists(dbPath)) {
            return { error: `Database '${dbName}' not found` };
        }
        
        const targetPath = backupPath || path.join(__dirname, '..', 'database', 'backups', `${dbName}_${Date.now()}`);
        await fs.copy(dbPath, targetPath);
        
        return {
            success: true,
            database: dbName,
            backupPath: targetPath,
            timestamp: new Date().toISOString()
        };
    }

    async restoreDatabase(dbName, backupPath) {
        const dbPath = this.getDbPath(dbName);
        
        if (!await fs.pathExists(backupPath)) {
            return { error: `Backup '${backupPath}' not found` };
        }
        
        if (await fs.pathExists(dbPath)) {
            await fs.remove(dbPath);
        }
        
        await fs.copy(backupPath, dbPath);
        this.clearCache(this.getCacheKey(dbName));
        
        return {
            success: true,
            database: dbName,
            restored: true,
            from: backupPath,
            timestamp: new Date().toISOString()
        };
    }

    async exportData(data, format = 'json') {
        switch(format) {
            case 'csv':
                return this.convertToCSV(data);
            case 'json':
                return JSON.stringify(data, null, 2);
            case 'sql':
                return this.convertToSQL(data);
            default:
                return data;
        }
    }

    convertToCSV(data) {
        if (!data) return '';
        
        let rows = [];
        let columns = [];
        
        if (Array.isArray(data)) {
            rows = data;
            if (rows.length > 0) {
                columns = Object.keys(rows[0]);
            }
        } else if (typeof data === 'object') {
            rows = Object.entries(data).map(([key, value]) => {
                if (typeof value === 'object' && value !== null) {
                    return { id: key, ...value };
                }
                return { id: key, value: value };
            });
            if (rows.length > 0) {
                columns = Object.keys(rows[0]);
            }
        }
        
        if (columns.length === 0) return '';
        
        const csvLines = [columns.map(c => `"${c}"`).join(',')];
        
        for (const row of rows) {
            const line = columns.map(c => {
                let val = row[c];
                if (val === undefined || val === null) return '""';
                if (typeof val === 'object') val = JSON.stringify(val);
                return `"${String(val).replace(/"/g, '""')}"`;
            }).join(',');
            csvLines.push(line);
        }
        
        return csvLines.join('\n');
    }

    convertToSQL(data, tableName = 'export') {
        if (!data) return '';
        
        let rows = [];
        let columns = [];
        
        if (Array.isArray(data)) {
            rows = data;
            if (rows.length > 0) {
                columns = Object.keys(rows[0]);
            }
        } else if (typeof data === 'object') {
            rows = Object.entries(data).map(([key, value]) => {
                if (typeof value === 'object' && value !== null) {
                    return { id: key, ...value };
                }
                return { id: key, value: value };
            });
            if (rows.length > 0) {
                columns = Object.keys(rows[0]);
            }
        }
        
        if (columns.length === 0) return '';
        
        const sqlLines = [`CREATE TABLE IF NOT EXISTS ${tableName} (${columns.map(c => `${c} TEXT`).join(', ')});`];
        
        for (const row of rows) {
            const values = columns.map(c => {
                let val = row[c];
                if (val === undefined || val === null) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                return val;
            }).join(', ');
            sqlLines.push(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values});`);
        }
        
        return sqlLines.join('\n');
    }
}

module.exports = new DatabaseEngine();
