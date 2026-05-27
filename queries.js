// NullName DB - Query Parser & Executor
// No brand. No name. No payment.
// Version: 2.0.0

const database = require('./core/database');
const internet = require('./internet');
const commit = require('./core/commit');
const track = require('./core/track');
const backup = require('./core/backup');
const auth = require('./auth');
const userManager = require('./user');
const nosql = require('./core/nosql');
const filebase = require('./core/filebase');
const timeback = require('./core/timeback');
const realtime = require('./core/realtime');
const sqlParser = require('./core/sql');

class QueryProcessor {
    constructor() {
        this.queryHistory = [];
        this.maxHistory = 1000;
        this.queryTimeout = 30000;
        
        this.commands = {
            'add': this.add.bind(this),
            'get': this.get.bind(this),
            'update': this.update.bind(this),
            'delete': this.delete.bind(this),
            'create': this.create.bind(this),
            'drop': this.drop.bind(this),
            'set': this.set.bind(this),
            'commit': this.commit.bind(this),
            'checkout': this.checkout.bind(this),
            'branch': this.branch.bind(this),
            'merge': this.merge.bind(this),
            'undo': this.undo.bind(this),
            'redo': this.redo.bind(this),
            'commits': this.listCommits.bind(this),
            'branches': this.listBranches.bind(this),
            'diff': this.diff.bind(this),
            'track': this.track.bind(this),
            'backup': this.backup.bind(this),
            'restore': this.restore.bind(this),
            'backups': this.listBackups.bind(this),
            'force': this.force.bind(this),
            'login': this.login.bind(this),
            'signup': this.signup.bind(this),
            'logout': this.logout.bind(this),
            'user': this.userManagement.bind(this),
            'help': this.help.bind(this),
            'status': this.status.bind(this),
            'stats': this.stats.bind(this),
            'clear': this.clear.bind(this),
            'format': this.setFormat.bind(this),
            'search': this.search.bind(this),
            'explain': this.explain.bind(this),
            'export': this.exportData.bind(this),
            'import': this.importData.bind(this),
            'sync': this.sync.bind(this),
            'watch': this.watch.bind(this),
            'unwatch': this.unwatch.bind(this),
            'travel': this.timeTravel.bind(this),
            'restore': this.restorePoint.bind(this),
            'sql': this.executeSQL.bind(this),
            'nosql': this.executeNoSQL.bind(this),
            'filebase': this.executeFileBase.bind(this)
        };
        
        this.aliases = {
            'a': 'add', 'g': 'get', 'u': 'update', 'd': 'delete',
            'c': 'create', 'cm': 'commit', 'co': 'checkout',
            'br': 'branch', 'mg': 'merge', 'un': 'undo',
            're': 'redo', 'tr': 'track', 'bk': 'backup',
            'rs': 'restore', 'fc': 'force', 'lg': 'login',
            'sg': 'signup', 'lo': 'logout', 'st': 'status',
            'h': 'help', 'fmt': 'format', 'exp': 'export',
            'imp': 'import', 'tv': 'travel', 'rst': 'restore'
        };
        
        this.currentFormat = 'json';
        this.userFormats = new Map();
    }

    async execute(query, user, sessionKey) {
        if (!query || typeof query !== 'string') {
            return { error: 'Invalid query: must be a non-empty string' };
        }
        
        query = query.trim();
        if (query.length === 0) {
            return { error: 'Empty query' };
        }
        
        const userFormat = this.userFormats.get(user?.username);
        if (userFormat) {
            this.currentFormat = userFormat;
        }
        
        if (query.includes('=') && !query.startsWith('=') && !this.hasCommandPrefix(query)) {
            const equalIndex = query.indexOf('=');
            const key = query.substring(0, equalIndex);
            let value = query.substring(equalIndex + 1);
            
            if (value === '') {
                return await database.delete(key, user);
            } else {
                return await database.set(key, this.parseValue(value), user);
            }
        }
        
        if (!query.includes(' ') && !query.includes('.') && !query.includes('=') && !this.hasCommandPrefix(query)) {
            return await database.get(query, user);
        }
        
        if (query.trim().toUpperCase().startsWith('SELECT') ||
            query.trim().toUpperCase().startsWith('INSERT') ||
            query.trim().toUpperCase().startsWith('UPDATE') ||
            query.trim().toUpperCase().startsWith('DELETE') ||
            query.trim().toUpperCase().startsWith('CREATE') ||
            query.trim().toUpperCase().startsWith('ALTER') ||
            query.trim().toUpperCase().startsWith('DROP')) {
            return await this.executeSQL(query, user);
        }
        
        const parsed = this.parseCommand(query);
        
        if (!parsed || !parsed.command) {
            return { error: 'Unknown query format. Try: add.db.table.col.value or name=value' };
        }
        
        let commandName = parsed.command;
        if (this.aliases[commandName]) {
            commandName = this.aliases[commandName];
        }
        
        if (!this.commands[commandName]) {
            return { error: 'Unknown command: ' + parsed.command };
        }
        
        try {
            const result = await this.commands[commandName](parsed, user, sessionKey);
            this.addToHistory(query, result, user);
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

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
        let separator = '.';
        let commandEnd = query.indexOf(separator);
        
        if (commandEnd === -1) {
            separator = ' ';
            commandEnd = query.indexOf(separator);
        }
        
        let command = '';
        let rest = '';
        
        if (commandEnd === -1) {
            command = query;
            rest = '';
        } else {
            command = query.substring(0, commandEnd);
            rest = query.substring(commandEnd + 1);
        }
        
        let args = [];
        if (rest) {
            if (separator === '.') {
                args = rest.split('.');
            } else {
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
            const ch = input[i];
            
            if ((ch === '"' || ch === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = ch;
                continue;
            }
            
            if (ch === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
                args.push(current);
                current = '';
                continue;
            }
            
            if (ch === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
                continue;
            }
            
            current += ch;
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
        
        if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
            try {
                return JSON.parse(value);
            } catch(e) {}
        }
        
        return value;
    }

    addToHistory(query, result, user) {
        this.queryHistory.unshift({
            query: query.substring(0, 500),
            timestamp: Date.now(),
            user: user ? user.username : 'anonymous',
            success: !result || !result.error
        });
        
        if (this.queryHistory.length > this.maxHistory) {
            this.queryHistory = this.queryHistory.slice(0, this.maxHistory);
        }
    }

    // ============================================
    // DATA OPERATIONS
    // ============================================

    async add(parsed, user) {
        const args = parsed.args;
        
        if (args.length < 4) {
            return { error: 'Invalid add syntax. Expected: add.db.table.col.value' };
        }
        
        const dbName = args[0];
        const tableName = args[1];
        const columnName = args[2];
        const valueParts = args.slice(3);
        let value = valueParts.join('.');
        
        if (value.endsWith('.upload')) {
            const url = value.slice(0, -7);
            if (internet.isUrl(url)) {
                const uploadResult = await internet.downloadAndSave(url);
                if (uploadResult.success) {
                    value = uploadResult.url;
                } else {
                    return { error: 'Failed to upload: ' + uploadResult.error };
                }
            }
        }
        
        if (value.includes(',') && !value.startsWith('[')) {
            const values = value.split(',');
            const results = [];
            for (const v of values) {
                const result = await database.add(dbName, tableName, columnName, this.parseValue(v.trim()), user);
                results.push(result);
            }
            return { success: true, count: results.length, results: results };
        }
        
        return await database.add(dbName, tableName, columnName, this.parseValue(value), user);
    }

    async get(parsed, user) {
        const args = parsed.args;
        
        if (args.length === 0) {
            return await database.getAllDatabases(user);
        }
        
        const dbName = args[0];
        const tableName = args[1];
        const idOrColumn = args[2];
        const columnName = args[3];
        
        if (!tableName) {
            return await database.getDatabase(dbName, user);
        }
        
        if (idOrColumn && !isNaN(idOrColumn)) {
            if (columnName) {
                return await database.getById(dbName, tableName, parseInt(idOrColumn), columnName, user);
            }
            return await database.getById(dbName, tableName, parseInt(idOrColumn), null, user);
        }
        
        if (idOrColumn && isNaN(idOrColumn)) {
            return await database.getColumn(dbName, tableName, idOrColumn, user);
        }
        
        return await database.getTable(dbName, tableName, user);
    }

    async update(parsed, user) {
        const args = parsed.args;
        
        if (args.length < 3) {
            return { error: 'Invalid update syntax. Expected: update.db.table.id.column=value' };
        }
        
        const dbName = args[0];
        const tableName = args[1];
        const id = args[2];
        const rest = args.slice(3).join('.');
        const equalIndex = rest.indexOf('=');
        
        if (equalIndex === -1) {
            return { error: 'Invalid update format. Use column=value' };
        }
        
        const column = rest.substring(0, equalIndex);
        let value = rest.substring(equalIndex + 1);
        
        if (value.endsWith('.upload')) {
            const url = value.slice(0, -7);
            if (internet.isUrl(url)) {
                const uploadResult = await internet.downloadAndSave(url);
                if (uploadResult.success) {
                    value = uploadResult.url;
                }
            }
        }
        
        return await database.update(dbName, tableName, parseInt(id), column, this.parseValue(value), user);
    }

    async delete(parsed, user) {
        const args = parsed.args;
        
        if (args.length === 0) {
            return { error: 'Invalid delete syntax. Expected: delete.db.table.id' };
        }
        
        const dbName = args[0];
        const tableName = args[1];
        const id = args[2];
        
        if (id && !isNaN(id)) {
            return await database.deleteById(dbName, tableName, parseInt(id), user);
        }
        
        if (tableName) {
            if (id === 'column' && args[3]) {
                return await database.deleteColumn(dbName, tableName, args[3], user);
            }
            return await database.deleteTable(dbName, tableName, user);
        }
        
        return await database.deleteDatabase(dbName, user);
    }

    async create(parsed, user) {
        const args = parsed.args;
        
        if (args.length === 0) {
            return { error: 'Invalid create syntax. Expected: create.databasename' };
        }
        
        const dbName = args[0];
        const tableName = args[1];
        const columns = args[2];
        
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
        return await this.delete(parsed, user);
    }

    async set(parsed, user) {
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
        const commitId = parsed.args[0];
        if (!commitId) {
            return { error: 'Commit ID required. Usage: checkout.commit_id' };
        }
        return await commit.checkout(commitId, user);
    }

    async branch(parsed, user) {
        const branchName = parsed.args[0];
        const sourceBranch = parsed.args[1];
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
        const commitsList = await commit.getHistory(limit);
        return { commits: commitsList, count: commitsList.length };
    }

    async listBranches(parsed, user) {
        return await commit.listBranches(user);
    }

    async diff(parsed, user) {
        const source = parsed.args[0];
        const target = parsed.args[1];
        if (!source || !target) {
            return { error: 'Invalid diff syntax. Usage: diff.source.target' };
        }
        return await commit.diff(source, target, user);
    }

    // ============================================
    // TIME TRAVEL
    // ============================================

    async timeTravel(parsed, user) {
        const args = parsed.args;
        
        if (args.length < 2) {
            return { error: 'Invalid travel syntax. Usage: travel.db.name.to.date or travel.table...' };
        }
        
        const target = args[0];
        const point = args[1];
        const action = args[2];
        
        if (target === 'db') {
            const dbName = args[1];
            const date = args[3];
            if (!date) return { error: 'Date required. Usage: travel.db.name.to.date' };
            return await timeback.travelDatabase(dbName, date, user);
        }
        
        if (target === 'table') {
            const dbName = args[1];
            const tableName = args[2];
            const date = args[4];
            if (!date) return { error: 'Date required. Usage: travel.db.name.table.name.to.date' };
            return await timeback.travelTable(dbName, tableName, date, user);
        }
        
        if (target === 'row') {
            const dbName = args[1];
            const tableName = args[2];
            const rowId = args[3];
            const date = args[5];
            return await timeback.travelRow(dbName, tableName, rowId, date, user);
        }
        
        if (target === 'cell') {
            const dbName = args[1];
            const tableName = args[2];
            const rowId = args[3];
            const columnName = args[4];
            const date = args[6];
            return await timeback.travelCell(dbName, tableName, rowId, columnName, date, user);
        }
        
        return { error: 'Invalid travel target. Use: db, table, row, or cell' };
    }

    async restorePoint(parsed, user) {
        const args = parsed.args;
        
        if (args.length < 2) {
            return { error: 'Invalid restore syntax. Usage: restore.db.name.to.date' };
        }
        
        const dbName = args[0];
        const date = args[2];
        
        return await timeback.restoreDatabase(dbName, date, user);
    }

    // ============================================
    // SQL EXECUTION
    // ============================================

    async executeSQL(query, user) {
        try {
            const result = await sqlParser.execute(query, user);
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

    // ============================================
    // NOSQL EXECUTION
    // ============================================

    async executeNoSQL(parsed, user) {
        const args = parsed.args;
        
        if (args.length < 2) {
            return { error: 'Invalid nosql syntax' };
        }
        
        const action = args[0];
        const collection = args[1];
        const query = args[2] ? JSON.parse(args[2]) : {};
        const update = args[3] ? JSON.parse(args[3]) : null;
        
        switch(action) {
            case 'find':
                return await nosql.find(collection, query, user);
            case 'findOne':
                return await nosql.findOne(collection, query, user);
            case 'insert':
                return await nosql.insert(collection, query, user);
            case 'update':
                return await nosql.update(collection, query, update, user);
            case 'delete':
                return await nosql.delete(collection, query, user);
            case 'count':
                return await nosql.count(collection, query, user);
            default:
                return { error: 'Unknown nosql action: ' + action };
        }
    }

    // ============================================
    // FILEBASE EXECUTION
    // ============================================

    async executeFileBase(parsed, user) {
        const args = parsed.args;
        
        if (args.length < 1) {
            return { error: 'Invalid filebase syntax' };
        }
        
        const action = args[0];
        
        switch(action) {
            case 'list':
                return await filebase.listFiles(user);
            case 'info':
                return await filebase.getFileInfo(args[1], user);
            case 'delete':
                return await filebase.deleteFile(args[1], user);
            case 'search':
                return await filebase.searchFiles(args[1], user);
            case 'stats':
                return await filebase.getStats(user);
            default:
                return { error: 'Unknown filebase action: ' + action };
        }
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
        const name = parsed.args.join('_') || 'backup_' + Date.now();
        return await backup.createBackup(name, user);
    }

    async restore(parsed, user) {
        const backupName = parsed.args[0];
        if (!backupName) {
            const backupsList = await backup.listBackups();
            return { backups: backupsList, message: 'Specify backup name to restore: restore.backup_name' };
        }
        return await backup.restoreBackup(backupName, user);
    }

    async listBackups(parsed, user) {
        const backupsList = await backup.listBackups();
        return { backups: backupsList, count: backupsList.length };
    }

    // ============================================
    // FORCE RECOVERY
    // ============================================

    async force(parsed, user) {
        if (!user || (user.role !== 'admin' && user.role !== 'root')) {
            return { error: 'Admin access required' };
        }
        
        const action = parsed.args[0];
        const steps = parseInt(parsed.args[1]) || 1;
        
        if (action === 'back') {
            return await commit.forceBack(steps, user);
        } else if (action === 'reset') {
            return await commit.factoryReset(user);
        }
        
        return { error: 'Invalid force command. Usage: force.back.steps or force.reset' };
    }

    // ============================================
    // USER MANAGEMENT
    // ============================================

    async login(parsed, user) {
        const username = parsed.args[0];
        const password = parsed.args[1];
        const ip = 'unknown';
        
        if (!username || !password) {
            return { error: 'Username and password required. Usage: login.username.password' };
        }
        
        const result = await auth.validateUser(username, password, ip);
        
        if (result.success) {
            const session = auth.createSession({ username: result.username, role: result.role });
            return {
                success: true,
                session: session,
                user: { username: result.username, role: result.role },
                message: 'Welcome back, ' + username + '!'
            };
        }
        
        return { error: result.error || 'Invalid credentials' };
    }

    async signup(parsed, user) {
        const username = parsed.args[0];
        const password = parsed.args[1];
        const role = parsed.args[2] || 'user';
        
        if (!username || !password) {
            return { error: 'Username and password required. Usage: signup.username.password' };
        }
        
        const result = await auth.createUser(username, password, role);
        
        if (result.success) {
            const session = auth.createSession({ username: username, role: result.role });
            return {
                success: true,
                session: session,
                user: { username: username, role: result.role },
                message: 'Account created for ' + username + '!'
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
        if (!user || (user.role !== 'admin' && user.role !== 'root')) {
            return { error: 'Admin access required for user management' };
        }
        
        const action = parsed.args[0];
        const username = parsed.args[1];
        const newRole = parsed.args[2];
        
        if (action === 'list') {
            const users = await auth.getAllUsers();
            return { users: users };
        }
        
        if (action === 'delete') {
            if (!username) return { error: 'Username required' };
            return await auth.deleteUser(username);
        }
        
        if (action === 'role') {
            if (!username || !newRole) return { error: 'Username and role required' };
            return await auth.updateUserRole(username, newRole);
        }
        
        if (action === 'changepass') {
            const oldPass = parsed.args[1];
            const newPass = parsed.args[2];
            if (!oldPass || !newPass) return { error: 'Old and new password required' };
            return await auth.updateUserPassword(user.username, oldPass, newPass);
        }
        
        if (action === 'token') {
            const subAction = parsed.args[1];
            if (subAction === 'create') {
                const description = parsed.args[2];
                return await auth.createApiToken(username, description);
            }
            if (subAction === 'list') {
                const tokens = await auth.listApiTokens(username);
                return { tokens: tokens };
            }
            if (subAction === 'revoke') {
                const tokenId = parsed.args[2];
                return await auth.revokeApiToken(username, tokenId);
            }
        }
        
        return { error: 'Unknown user action. Available: list, delete, role, changepass, token' };
    }

    // ============================================
    // FORMAT & SEARCH
    // ============================================

    async setFormat(parsed, user) {
        const format = parsed.args[0];
        const validFormats = ['json', 'csv', 'table', 'markdown', 'yaml', 'xml', 'text', 'vertical', 'compact', 'grid', 'ai'];
        
        if (!format) {
            return { current_format: this.currentFormat, available: validFormats };
        }
        
        if (validFormats.includes(format)) {
            this.currentFormat = format;
            if (user && user.username) {
                this.userFormats.set(user.username, format);
            }
            return { success: true, format: format, message: `Output format set to ${format}` };
        }
        
        return { error: `Invalid format. Available: ${validFormats.join(', ')}` };
    }

    async search(parsed, user) {
        const keyword = parsed.args[0];
        if (!keyword) {
            return { error: 'Search keyword required' };
        }
        
        const results = await database.searchAll(keyword, user);
        return { keyword: keyword, results: results, count: results.length };
    }

    async explain(parsed, user) {
        const query = parsed.raw;
        if (!query) {
            return { error: 'Query to explain required' };
        }
        
        const explanation = await database.explainQuery(query, user);
        return explanation;
    }

    async exportData(parsed, user) {
        const format = parsed.args[0] || 'json';
        const dbName = parsed.args[1];
        
        if (!dbName) {
            return { error: 'Database name required' };
        }
        
        const data = await database.getDatabase(dbName, user);
        const exportResult = await database.exportData(data, format);
        return exportResult;
    }

    async importData(parsed, user) {
        const file = parsed.args[0];
        const dbName = parsed.args[1];
        
        if (!file || !dbName) {
            return { error: 'File and database name required' };
        }
        
        const result = await database.importData(file, dbName, user);
        return result;
    }

    async sync(parsed, user) {
        const source = parsed.args[0];
        const target = parsed.args[1];
        
        if (!source || !target) {
            return { error: 'Source and target required' };
        }
        
        const result = await database.syncDatabases(source, target, user);
        return result;
    }

    async watch(parsed, user) {
        const query = parsed.raw;
        if (!query) {
            return { error: 'Query to watch required' };
        }
        
        const subscription = await realtime.subscribe(query, user);
        return { success: true, subscription_id: subscription.id, message: 'Watching ' + query };
    }

    async unwatch(parsed, user) {
        const subscriptionId = parsed.args[0];
        if (!subscriptionId) {
            return { error: 'Subscription ID required' };
        }
        
        const result = await realtime.unsubscribe(subscriptionId, user);
        return result;
    }

    // ============================================
    // SYSTEM OPERATIONS
    // ============================================

    async help(parsed, user) {
        return {
            message: 'NullName DB - Query Reference (v2.0)',
            commands: {
                data: ['add.db.table.col.value', 'get.db.table', 'update.db.table.id.col=value', 'delete.db.table.id'],
                simple: ['name=value', 'name', 'db.table.column'],
                version: ['commit "message"', 'commits', 'checkout.id', 'branch.name', 'merge.source.into.target'],
                recovery: ['undo', 'redo', 'force.back.1', 'f1', 'f2', 'f3'],
                files: ['add.db.table.col=https://url.jpg.upload', 'filebase.list', 'filebase.delete'],
                time: ['travel.db.name.to.date', 'travel.table.db.table.to.date', 'restore.db.name.to.date'],
                user: ['login.username.password', 'signup.username.password', 'logout', 'user.list', 'user.role.username.role'],
                sql: ['SELECT * FROM table', 'INSERT INTO table VALUES', 'UPDATE table SET col=value'],
                nosql: ['nosql.find.collection {}', 'nosql.insert.collection {}'],
                system: ['backup', 'restore.name', 'track', 'status', 'stats', 'format', 'search', 'explain'],
                formats: ['&format=json', '&format=csv', '&format=table', '&format=markdown', '&format=yaml', '&format=xml', '&format=ai']
            },
            examples: [
                '/q=score=100',
                '/q=add.mydb.users.name.John',
                '/q=get.mydb.users&format=markdown',
                '/q=commit "first version"',
                '/q=undo',
                '/q=f1',
                '/q=travel.db.mydb.to.2026-05-20',
                '/q=sql SELECT * FROM users'
            ],
            version: '2.0.0'
        };
    }

    async status(parsed, user) {
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        const stats = await database.getStats();
        const authStats = await auth.getStats();
        
        return {
            status: 'online',
            version: '2.0.0',
            uptime: {
                seconds: Math.floor(uptime),
                human: Math.floor(uptime / 86400) + 'd ' + Math.floor((uptime % 86400) / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm'
            },
            memory: {
                rss: Math.round(memory.rss / 1024 / 1024) + ' MB',
                heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + ' MB',
                heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + ' MB'
            },
            database: stats,
            auth: authStats,
            timestamp: new Date().toISOString()
        };
    }

    async stats(parsed, user) {
        const trackStats = await track.getStats();
        const backupStats = await backup.listBackups();
        const filebaseStats = await filebase.getStats();
        
        return {
            queries: trackStats,
            backups: {
                count: backupStats.length,
                latest: backupStats[0] || null
            },
            database: await database.getStats(),
            filebase: filebaseStats,
            timestamp: new Date().toISOString()
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
        
        if (target === 'cache') {
            await database.clearCache();
            return { success: true, cleared: 'database cache' };
        }
        
        return { error: 'Invalid clear target. Available: history, tracks, cache' };
    }
}

module.exports = new QueryProcessor();
