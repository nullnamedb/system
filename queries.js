// NullName DB - Query Parser & Executor
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 520+

const database = require('./core/database');
const internet = require('./internet');
const commit = require('./core/commit');
const track = require('./core/track');
const backup = require('./core/backup');
const auth = require('./auth');
const userManager = require('./user');

// ============================================
// QUERY PROCESSOR CLASS
// ============================================

class QueryProcessor {
    constructor() {
        this.queryHistory = [];
        this.maxHistory = 1000;
        this.queryTimeout = 30000;
        
        // Command registry
        this.commands = {
            // Data operations
            'add': this.add.bind(this),
            'get': this.get.bind(this),
            'update': this.update.bind(this),
            'delete': this.delete.bind(this),
            'create': this.create.bind(this),
            'drop': this.drop.bind(this),
            'set': this.set.bind(this),
            
            // Version control
            'commit': this.commit.bind(this),
            'checkout': this.checkout.bind(this),
            'branch': this.branch.bind(this),
            'merge': this.merge.bind(this),
            'undo': this.undo.bind(this),
            'redo': this.redo.bind(this),
            'commits': this.listCommits.bind(this),
            'branches': this.listBranches.bind(this),
            'diff': this.diff.bind(this),
            
            // Tracking & backup
            'track': this.track.bind(this),
            'backup': this.backup.bind(this),
            'restore': this.restore.bind(this),
            'backups': this.listBackups.bind(this),
            
            // Force recovery
            'force': this.force.bind(this),
            
            // User management
            'login': this.login.bind(this),
            'signup': this.signup.bind(this),
            'logout': this.logout.bind(this),
            'user': this.userManagement.bind(this),
            
            // System
            'help': this.help.bind(this),
            'status': this.status.bind(this),
            'stats': this.stats.bind(this),
            'clear': this.clear.bind(this),
            'export': this.exportData.bind(this),
            'import': this.importData.bind(this)
        };
        
        // Shortcut aliases
        this.aliases = {
            'a': 'add',
            'g': 'get',
            'u': 'update',
            'd': 'delete',
            'c': 'create',
            'cm': 'commit',
            'co': 'checkout',
            'br': 'branch',
            'mg': 'merge',
            'un': 'undo',
            're': 'redo',
            'tr': 'track',
            'bk': 'backup',
            'rs': 'restore',
            'fc': 'force',
            'lg': 'login',
            'sg': 'signup',
            'lo': 'logout',
            'st': 'status',
            'h': 'help'
        };
    }

    // ============================================
    // MAIN EXECUTION ENTRY POINT
    // ============================================

    async execute(query, user, sessionKey = null) {
        const startTime = Date.now();
        
        // Validate query
        if (!query || typeof query !== 'string') {
            return { error: 'Invalid query: must be a non-empty string' };
        }
        
        // Trim whitespace
        query = query.trim();
        
        // Skip empty queries
        if (query.length === 0) {
            return { error: 'Empty query' };
        }
        
        // Check for simple set/get pattern (no command prefix)
        if (!this.hasCommandPrefix(query)) {
            // Simple set: name=value
            if (query.includes('=') && !query.startsWith('=')) {
                const equalIndex = query.indexOf('=');
                const key = query.substring(0, equalIndex);
                let value = query.substring(equalIndex + 1);
                
                if (value === '') {
                    // Delete operation
                    return await database.delete(key, user);
                } else {
                    // Set operation
                    return await database.set(key, this.parseValue(value), user);
                }
            }
            // Simple get: name
            else if (!query.includes(' ') && !query.includes('.') && !query.includes('=')) {
                return await database.get(query, user);
            }
            // Check if it's a path like db.table.column
            else if (query.includes('.')) {
                const parts = query.split('.');
                if (parts.length === 2) {
                    return await database.getTable(parts[0], parts[1], user);
                } else if (parts.length === 3) {
                    return await database.getColumn(parts[0], parts[1], parts[2], user);
                } else {
                    return await database.getPath(query, user);
                }
            }
        }
        
        // Parse command
        const parsed = this.parseCommand(query);
        
        if (!parsed || !parsed.command) {
            return { 
                error: 'Unknown query format',
                hint: 'Try: add.db.table.col.value or get.db.table or name=value',
                example: '/q?q=score=100'
            };
        }
        
        // Check if command exists
        let commandName = parsed.command;
        
        // Check alias
        if (this.aliases[commandName]) {
            commandName = this.aliases[commandName];
        }
        
        if (!this.commands[commandName]) {
            return { 
                error: `Unknown command: ${parsed.command}`,
                available: Object.keys(this.commands),
                aliases: Object.keys(this.aliases)
            };
        }
        
        // Check permissions for sensitive commands
        const sensitiveCommands = ['force', 'backup', 'restore', 'drop', 'user', 'admin'];
        if (sensitiveCommands.includes(commandName)) {
            if (!user || (user.role !== 'admin' && user.role !== 'root')) {
                return { error: `Permission denied: ${commandName} requires admin access` };
            }
        }
        
        // Execute command with timeout
        try {
            const result = await this.executeWithTimeout(
                this.commands[commandName](parsed, user, sessionKey),
                this.queryTimeout
            );
            
            // Add metadata
            if (result && typeof result === 'object') {
                result._query_time_ms = Date.now() - startTime;
                result._command = commandName;
            }
            
            // Store in history
            this.addToHistory(query, result, user);
            
            return result;
            
        } catch (error) {
            console.error(`Query execution error:`, error);
            return { 
                error: error.message,
                command: commandName,
                query: query.substring(0, 200)
            };
        }
    }

    // ============================================
    // COMMAND PARSING
    // ============================================

    hasCommandPrefix(query) {
        const prefixes = Object.keys(this.commands).concat(Object.keys(this.aliases));
        for (const prefix of prefixes) {
            if (query.startsWith(prefix + '.') || query === prefix || query.startsWith(prefix + ' ')) {
                return true;
            }
        }
        return false;
    }

    parseCommand(query) {
        // Find the command separator
        let separator = '.';
        let commandEnd = query.indexOf(separator);
        
        if (commandEnd === -1) {
            separator = ' ';
            commandEnd = query.indexOf(separator);
        }
        
        let command;
        let rest = '';
        
        if (commandEnd === -1) {
            command = query;
            rest = '';
        } else {
            command = query.substring(0, commandEnd);
            rest = query.substring(commandEnd + 1);
        }
        
        // Parse arguments based on separator type
        let args = [];
        if (rest) {
            if (separator === '.') {
                args = rest.split('.');
            } else {
                // Parse quoted arguments
                args = this.parseArgsWithQuotes(rest);
            }
        }
        
        return {
            command: command.toLowerCase(),
            original: query,
            args: args,
            raw: rest
        };
    }

    parseArgsWithQuotes(input) {
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        
        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            
            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
                continue;
            }
            
            if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
                args.push(current);
                current = '';
                continue;
            }
            
            if (char === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
                continue;
            }
            
            current += char;
        }
        
        if (current) {
            args.push(current);
        }
        
        return args;
    }

    parseValue(value) {
        if (!value || value === 'null') return null;
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (!isNaN(value) && value !== '') return Number(value);
        
        // Try parse JSON
        if ((value.startsWith('{') && value.endsWith('}')) || 
            (value.startsWith('[') && value.endsWith(']'))) {
            try {
                return JSON.parse(value);
            } catch (e) {
                // Not valid JSON, return as string
            }
        }
        
        return value;
    }

    executeWithTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    }

    addToHistory(query, result, user) {
        this.queryHistory.unshift({
            query: query.substring(0, 500),
            timestamp: Date.now(),
            user: user?.username || 'anonymous',
            success: !result?.error,
            result_preview: result?.error ? result.error.substring(0, 100) : 'success'
        });
        
        if (this.queryHistory.length > this.maxHistory) {
            this.queryHistory = this.queryHistory.slice(0, this.maxHistory);
        }
    }

    // ============================================
    // DATA OPERATIONS
    // ============================================

    async add(parsed, user) {
        // Format: add.databasename.tablename.columnname.value
        // Or: add.databasename.tablename.columnname.value1,value2,value3
        const args = parsed.args;
        
        if (args.length < 4) {
            return { error: 'Invalid add syntax. Expected: add.db.table.column.value' };
        }
        
        const [dbName, tableName, columnName, ...valueParts] = args;
        let value = valueParts.join('.');
        
        // Check for file upload (.upload suffix)
        if (value.endsWith('.upload')) {
            const url = value.slice(0, -7);
            if (internet.isUrl(url)) {
                const result = await internet.downloadAndSave(url);
                if (result.success) {
                    value = result.url;
                } else {
                    return { error: `Failed to upload file: ${result.error}` };
                }
            }
        }
        
        // Handle multiple values (comma-separated)
        if (value.includes(',') && !value.startsWith('[')) {
            const values = value.split(',');
            const results = [];
            for (const v of values) {
                const result = await database.add(dbName, tableName, columnName, this.parseValue(v.trim()), user);
                results.push(result);
            }
            return { success: true, count: results.length, results };
        }
        
        return await database.add(dbName, tableName, columnName, this.parseValue(value), user);
    }

    async get(parsed, user) {
        // Format: get.databasename.tablename.id.column
        // Or: get.databasename.tablename
        // Or: get.databasename.tablename.id
        const args = parsed.args;
        
        if (args.length === 0) {
            return await database.getAllDatabases(user);
        }
        
        const [dbName, tableName, idOrColumn, columnName] = args;
        
        if (!tableName) {
            return await database.getDatabase(dbName, user);
        }
        
        // Check if third argument is a number (ID) or column name
        if (idOrColumn && !isNaN(idOrColumn)) {
            // get.db.table.id
            if (columnName) {
                // get.db.table.id.column
                return await database.getById(dbName, tableName, parseInt(idOrColumn), columnName, user);
            }
            // get.db.table.id
            return await database.getById(dbName, tableName, parseInt(idOrColumn), null, user);
        }
        
        // get.db.table.column
        if (idOrColumn && !isNaN(idOrColumn) === false) {
            return await database.getColumn(dbName, tableName, idOrColumn, user);
        }
        
        // get.db.table
        return await database.getTable(dbName, tableName, user);
    }

    async update(parsed, user) {
        // Format: update.databasename.tablename.id.column=value
        const args = parsed.args;
        
        if (args.length < 3) {
            return { error: 'Invalid update syntax. Expected: update.db.table.id.column=value' };
        }
        
        const [dbName, tableName, id, ...rest] = args;
        const updateStr = rest.join('.');
        const equalIndex = updateStr.indexOf('=');
        
        if (equalIndex === -1) {
            return { error: 'Invalid update format. Use column=value' };
        }
        
        const column = updateStr.substring(0, equalIndex);
        let value = updateStr.substring(equalIndex + 1);
        
        // Handle file upload
        if (value.endsWith('.upload')) {
            const url = value.slice(0, -7);
            if (internet.isUrl(url)) {
                const result = await internet.downloadAndSave(url);
                if (result.success) {
                    value = result.url;
                }
            }
        }
        
        return await database.update(dbName, tableName, parseInt(id), column, this.parseValue(value), user);
    }

    async delete(parsed, user) {
        // Format: delete.databasename.tablename.id
        // Or: delete.databasename.tablename
        // Or: delete.databasename
        const args = parsed.args;
        
        if (args.length === 0) {
            return { error: 'Invalid delete syntax. Expected: delete.db.table.id' };
        }
        
        const [dbName, tableName, id] = args;
        
        if (id && !isNaN(id)) {
            return await database.deleteById(dbName, tableName, parseInt(id), user);
        }
        
        if (tableName) {
            return await database.deleteTable(dbName, tableName, user);
        }
        
        return await database.deleteDatabase(dbName, user);
    }

    async create(parsed, user) {
        // Format: create.databasename
        // Or: create.databasename.tablename
        // Or: create.databasename.tablename.column1,column2,column3
        const args = parsed.args;
        
        if (args.length === 0) {
            return { error: 'Invalid create syntax. Expected: create.databasename' };
        }
        
        const [dbName, tableName, columns] = args;
        
        if (tableName) {
            if (columns) {
                const columnList = columns.split(',');
                return await database.createTable(dbName, tableName, columnList, user);
            }
            return await database.createTable(dbName, tableName, [], user);
        }
        
        return await database.createDatabase(dbName, user);
    }

    async drop(parsed, user) {
        // Alias for delete
        return await this.delete(parsed, user);
    }

    async set(parsed, user) {
        // Simple set operation
        const args = parsed.args;
        if (args.length < 2) {
            return { error: 'Invalid set syntax. Expected: set.key.value' };
        }
        
        const key = args[0];
        const value = args.slice(1).join('.');
        
        return await database.set(key, this.parseValue(value), user);
    }

    // ============================================
    // VERSION CONTROL
    // ============================================

    async commit(parsed, user) {
        const message = parsed.args.join(' ') || 'Auto commit';
        return await commit.create(message, user);
    }

    async checkout(parsed, user) {
        const [commitId] = parsed.args;
        if (!commitId) {
            return { error: 'Commit ID required. Usage: checkout.commit_id' };
        }
        return await commit.checkout(commitId, user);
    }

    async branch(parsed, user) {
        const [branchName, sourceBranch] = parsed.args;
        if (!branchName) {
            return await commit.listBranches(user);
        }
        return await commit.createBranch(branchName, sourceBranch || 'main', user);
    }

    async merge(parsed, user) {
        const args = parsed.args;
        let source, target;
        
        if (args.length === 2) {
            source = args[0];
            target = args[1];
        } else if (args.length === 1) {
            source = args[0];
            target = 'main';
        } else {
            // Check for "into" keyword
            const raw = parsed.raw;
            const intoMatch = raw.match(/(.+)\s+into\s+(.+)/i);
            if (intoMatch) {
                source = intoMatch[1].trim();
                target = intoMatch[2].trim();
            } else {
                return { error: 'Invalid merge syntax. Usage: merge.source.into.target' };
            }
        }
        
        return await commit.merge(source, target, user);
    }

    async undo(parsed, user) {
        const steps = parseInt(parsed.args[0]) || 1;
        return await commit.undo(steps, user);
    }

    async redo(parsed, user) {
        const steps = parseInt(parsed.args[0]) || 1;
        return await commit.redo(steps, user);
    }

    async listCommits(parsed, user) {
        const limit = parseInt(parsed.args[0]) || 20;
        const commits = await commit.getHistory(limit);
        return { commits, count: commits.length };
    }

    async listBranches(parsed, user) {
        return await commit.listBranches(user);
    }

    async diff(parsed, user) {
        const [source, target] = parsed.args;
        if (!source || !target) {
            return { error: 'Invalid diff syntax. Usage: diff.source.target' };
        }
        return await commit.diff(source, target, user);
    }

    // ============================================
    // TRACKING & BACKUP
    // ============================================

    async track(parsed, user) {
        const filter = parsed.args[0] || 'all';
        const limit = parseInt(parsed.args[1]) || 100;
        
        const filters = {};
        
        if (filter === 'errors') filters.type = 'error';
        if (filter === 'success') filters.type = 'success';
        if (filter === '1hr' || filter === '24hr' || filter === '7d') filters.timeRange = filter;
        
        filters.limit = limit;
        
        return await track.getTracks(filters);
    }

    async backup(parsed, user) {
        const name = parsed.args.join('_') || `backup_${Date.now()}`;
        return await backup.createBackup(name, user);
    }

    async restore(parsed, user) {
        const [backupName] = parsed.args;
        if (!backupName) {
            const backups = await backup.listBackups();
            return { backups, message: 'Specify backup name to restore: restore.backup_name' };
        }
        return await backup.restoreBackup(backupName, user);
    }

    async listBackups(parsed, user) {
        const backups = await backup.listBackups();
        return { backups, count: backups.length };
    }

    // ============================================
    // FORCE RECOVERY
    // ============================================

    async force(parsed, user) {
        const action = parsed.args[0];
        const steps = parseInt(parsed.args[1]) || 1;
        
        if (action === 'back') {
            return await commit.forceBack(steps, user);
        } else if (action === 'reset') {
            return await commit.factoryReset(user);
        } else if (action === 'clean') {
            return await commit.cleanForce(steps, user);
        }
        
        return { error: 'Invalid force command. Usage: force.back.steps or force.reset' };
    }

    // ============================================
    // USER MANAGEMENT
    // ============================================

    async login(parsed, user) {
        const [username, password] = parsed.args;
        
        if (!username || !password) {
            return { error: 'Username and password required. Usage: login.username.password' };
        }
        
        const result = await auth.login(username, password);
        
        if (result.success) {
            const session = auth.createSession(result.user);
            return {
                success: true,
                session,
                user: result.user,
                message: `Welcome back, ${username}!`
            };
        }
        
        return { error: result.error || 'Invalid credentials' };
    }

    async signup(parsed, user) {
        const [username, password, role] = parsed.args;
        
        if (!username || !password) {
            return { error: 'Username and password required. Usage: signup.username.password' };
        }
        
        const result = await userManager.createUser(username, password, role || 'user');
        
        if (result.success) {
            const session = auth.createSession({ username, role: result.role });
            return {
                success: true,
                session,
                user: { username, role: result.role },
                message: `Account created for ${username}!`
            };
        }
        
        return { error: result.error };
    }

    async logout(parsed, user, sessionKey) {
        if (sessionKey) {
            auth.destroySession(sessionKey);
        }
        return { success: true, message: 'Logged out successfully' };
    }

    async userManagement(parsed, user) {
        const [action, username, ...args] = parsed.args;
        
        if (!user || (user.role !== 'admin' && user.role !== 'root')) {
            return { error: 'Admin access required for user management' };
        }
        
        switch (action) {
            case 'list':
                const users = await userManager.getAllUsers();
                return { users };
            case 'delete':
                if (!username) return { error: 'Username required' };
                return await userManager.deleteUser(username);
            case 'role':
                const newRole = args[0];
                if (!username || !newRole) return { error: 'Username and role required' };
                return await userManager.setRole(username, newRole);
            case 'reset':
                const newPass = args[0];
                if (!username || !newPass) return { error: 'Username and new password required' };
                return await userManager.resetPassword(username, newPass);
            default:
                return { error: 'Unknown user action. Available: list, delete, role, reset' };
        }
    }

    // ============================================
    // SYSTEM OPERATIONS
    // ============================================

    async help(parsed, user) {
        const commands = {
            data: ['add.db.table.col.value', 'get.db.table', 'update.db.table.id.col=value', 'delete.db.table.id'],
            simple: ['name=value', 'name', 'db.table.column'],
            version: ['commit "message"', 'commits', 'checkout.id', 'branch.name', 'merge.source.into.target'],
            recovery: ['undo', 'redo', 'force.back.1', 'f1', 'f2', 'f3'],
            files: ['add.db.table.col=https://url.jpg.upload', 'upload', 'upload/url'],
            user: ['login.username.password', 'signup.username.password', 'logout'],
            system: ['backup', 'restore.name', 'track', 'status', 'stats']
        };
        
        return {
            message: 'NullName DB - Query Reference',
            commands,
            shortcuts: {
                a: 'add',
                g: 'get',
                u: 'update',
                d: 'delete',
                c: 'create',
                cm: 'commit',
                co: 'checkout',
                un: 'undo',
                f1_f2_f3: 'force recovery'
            },
            examples: [
                '/q?q=score=100',
                '/q?q=add.mydb.users.name.John',
                '/q?q=get.mydb.users',
                '/q?q=commit "first version"',
                '/q?q=undo',
                '/q?q=f1'
            ]
        };
    }

    async status(parsed, user) {
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        const stats = await database.getStats();
        
        return {
            status: 'online',
            version: '1.0.0',
            uptime: {
                seconds: Math.floor(uptime),
                human: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
            },
            memory: {
                rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
                heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`,
                heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`
            },
            stats
        };
    }

    async stats(parsed, user) {
        const trackStats = await track.getStats();
        const backupStats = await backup.listBackups();
        
        return {
            queries: trackStats,
            backups: {
                count: backupStats.length,
                latest: backupStats[0] || null
            },
            database: await database.getStats()
        };
    }

    async clear(parsed, user) {
        if (!user || (user.role !== 'admin' && user.role !== 'root')) {
            return { error: 'Admin access required' };
        }
        
        const target = parsed.args[0] || 'history';
        
        if (target === 'history') {
            this.queryHistory = [];
            return { success: true, cleared: 'query history' };
        }
        
        if (target === 'tracks') {
            await track.clearOldTracks(0);
            return { success: true, cleared: 'tracking logs' };
        }
        
        return { error: 'Invalid clear target. Available: history, tracks' };
    }

    async exportData(parsed, user) {
        if (!user) {
            return { error: 'Authentication required for export' };
        }
        
        const format = parsed.args[0] || 'json';
        const data = await database.getFullExport();
        
        if (format === 'json') {
            return { data, format: 'json' };
        }
        
        if (format === 'csv') {
            // Convert to CSV (simplified)
            return { error: 'CSV export coming soon' };
        }
        
        return { error: 'Invalid format. Available: json' };
    }

    async importData(parsed, user) {
        if (!user || (user.role !== 'admin' && user.role !== 'root')) {
            return { error: 'Admin access required for import' };
        }
        
        const [source] = parsed.args;
        if (!source) {
            return { error: 'Import source required' };
        }
        
        return await database.importData(source, user);
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new QueryProcessor();
