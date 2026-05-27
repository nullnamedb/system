// NullName DB - Git-like Version Control System
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class CommitSystem {
    constructor() {
        this.commitsPath = path.join(__dirname, '..', 'database', 'commits');
        this.branchesPath = path.join(__dirname, '..', 'database', 'branches');
        this.statePath = path.join(__dirname, '..', 'database', 'git_state.json');
        this.tagsPath = path.join(__dirname, '..', 'database', 'tags.json');
        
        this.currentBranch = 'main';
        this.commitHistory = [];
        this.undoStack = [];
        this.redoStack = [];
        this.branches = new Map();
        this.tags = new Map();
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.commitsPath);
        await fs.ensureDir(this.branchesPath);
        await this.loadState();
        await this.loadBranches();
        await this.loadTags();
        console.log('Version control system initialized');
    }

    async loadState() {
        try {
            if (await fs.pathExists(this.statePath)) {
                const state = await fs.readJson(this.statePath);
                this.currentBranch = state.currentBranch || 'main';
                this.commitHistory = state.commitHistory || [];
                this.undoStack = state.undoStack || [];
                this.redoStack = state.redoStack || [];
            } else {
                await this.saveState();
            }
        } catch (error) {
            console.error('Failed to load state:', error);
        }
    }

    async saveState() {
        try {
            const state = {
                currentBranch: this.currentBranch,
                commitHistory: this.commitHistory,
                undoStack: this.undoStack,
                redoStack: this.redoStack,
                updatedAt: new Date().toISOString()
            };
            await fs.writeJson(this.statePath, state, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save state:', error);
        }
    }

    async loadBranches() {
        try {
            const branches = await fs.readdir(this.branchesPath);
            for (const branch of branches) {
                if (branch.endsWith('.json')) {
                    const branchName = branch.replace('.json', '');
                    const branchData = await fs.readJson(path.join(this.branchesPath, branch));
                    this.branches.set(branchName, branchData);
                }
            }
            
            if (!this.branches.has('main')) {
                await this.createBranch('main', null);
            }
        } catch (error) {
            console.error('Failed to load branches:', error);
        }
    }

    async saveBranch(branchName) {
        try {
            const branchData = this.branches.get(branchName);
            if (branchData) {
                await fs.writeJson(path.join(this.branchesPath, `${branchName}.json`), branchData, { spaces: 2 });
            }
        } catch (error) {
            console.error(`Failed to save branch ${branchName}:`, error);
        }
    }

    async loadTags() {
        try {
            if (await fs.pathExists(this.tagsPath)) {
                const tagsObj = await fs.readJson(this.tagsPath);
                this.tags = new Map(Object.entries(tagsObj));
            }
        } catch (error) {
            console.error('Failed to load tags:', error);
        }
    }

    async saveTags() {
        try {
            const tagsObj = Object.fromEntries(this.tags);
            await fs.writeJson(this.tagsPath, tagsObj, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save tags:', error);
        }
    }

    async takeSnapshot() {
        const dbPath = path.join(__dirname, '..', 'database', 'sql');
        const kvPath = path.join(__dirname, '..', 'database', 'keyvalue.json');
        
        const snapshot = {
            databases: {},
            keyvalue: {},
            timestamp: Date.now(),
            branch: this.currentBranch,
            id: this.generateCommitId()
        };
        
        if (await fs.pathExists(dbPath)) {
            const databases = await fs.readdir(dbPath);
            
            for (const db of databases) {
                if (db.startsWith('_')) continue;
                const dbFullPath = path.join(dbPath, db);
                const stat = await fs.stat(dbFullPath);
                
                if (stat.isDirectory()) {
                    snapshot.databases[db] = {};
                    const tables = await fs.readdir(dbFullPath);
                    
                    for (const table of tables) {
                        if (table.endsWith('.json') && !table.startsWith('_')) {
                            const tablePath = path.join(dbFullPath, table);
                            const tableName = table.replace('.json', '');
                            snapshot.databases[db][tableName] = await fs.readJson(tablePath);
                        }
                    }
                }
            }
        }
        
        if (await fs.pathExists(kvPath)) {
            snapshot.keyvalue = await fs.readJson(kvPath);
        }
        
        return snapshot;
    }

    async restoreSnapshot(snapshot) {
        const dbPath = path.join(__dirname, '..', 'database', 'sql');
        const kvPath = path.join(__dirname, '..', 'database', 'keyvalue.json');
        
        if (await fs.pathExists(dbPath)) {
            const databases = await fs.readdir(dbPath);
            for (const db of databases) {
                if (db.startsWith('_')) continue;
                const dbFullPath = path.join(dbPath, db);
                const stat = await fs.stat(dbFullPath);
                if (stat.isDirectory()) {
                    await fs.remove(dbFullPath);
                    await fs.ensureDir(dbFullPath);
                }
            }
        }
        
        for (const [dbName, tables] of Object.entries(snapshot.databases)) {
            const dbFullPath = path.join(dbPath, dbName);
            await fs.ensureDir(dbFullPath);
            
            for (const [tableName, data] of Object.entries(tables)) {
                const tablePath = path.join(dbFullPath, `${tableName}.json`);
                await fs.writeJson(tablePath, data, { spaces: 2 });
            }
        }
        
        if (snapshot.keyvalue) {
            await fs.writeJson(kvPath, snapshot.keyvalue, { spaces: 2 });
        }
    }

    generateCommitId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `${timestamp}_${random}`;
    }

    getCurrentHead() {
        const branch = this.branches.get(this.currentBranch);
        return branch?.head || null;
    }

    async getChanges(oldSnapshot, newSnapshot) {
        let added = 0;
        let modified = 0;
        let deleted = 0;
        
        const oldKeys = new Set();
        const newKeys = new Set();
        
        for (const [db, tables] of Object.entries(oldSnapshot.databases || {})) {
            for (const table of Object.keys(tables)) {
                oldKeys.add(`${db}.${table}`);
            }
        }
        
        for (const [db, tables] of Object.entries(newSnapshot.databases || {})) {
            for (const table of Object.keys(tables)) {
                newKeys.add(`${db}.${table}`);
            }
        }
        
        for (const key of newKeys) {
            if (!oldKeys.has(key)) added++;
            else modified++;
        }
        
        for (const key of oldKeys) {
            if (!newKeys.has(key)) deleted++;
        }
        
        return { added, modified, deleted };
    }

    countTables(snapshot) {
        let count = 0;
        for (const tables of Object.values(snapshot.databases || {})) {
            count += Object.keys(tables).length;
        }
        return count;
    }

    async countRecords(snapshot) {
        let count = 0;
        for (const tables of Object.values(snapshot.databases || {})) {
            for (const data of Object.values(tables)) {
                count += Object.keys(data).filter(k => !isNaN(k) && k !== '_nextId' && k !== '_schema').length;
            }
        }
        return count;
    }

    async create(message, user = null, options = {}) {
        const commitId = this.generateCommitId();
        const timestamp = Date.now();
        
        const snapshot = await this.takeSnapshot();
        const parentCommit = this.getCurrentHead();
        
        const changes = parentCommit ? await this.getChanges(
            await this.getSnapshot(parentCommit),
            snapshot
        ) : { added: this.countTables(snapshot), modified: 0, deleted: 0 };
        
        const commit = {
            id: commitId,
            message: message,
            author: user?.username || 'anonymous',
            authorRole: user?.role || 'guest',
            timestamp: timestamp,
            timestampISO: new Date(timestamp).toISOString(),
            branch: this.currentBranch,
            parent: parentCommit,
            snapshot: snapshot,
            changes: changes,
            stats: {
                databases: Object.keys(snapshot.databases).length,
                tables: this.countTables(snapshot),
                records: await this.countRecords(snapshot)
            }
        };
        
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        await fs.writeJson(commitPath, commit, { spaces: 2 });
        
        const branch = this.branches.get(this.currentBranch);
        if (branch) {
            branch.head = commitId;
            branch.commits.push(commitId);
            branch.updatedAt = timestamp;
            await this.saveBranch(this.currentBranch);
        }
        
        this.commitHistory.push(commitId);
        this.undoStack.push(commitId);
        this.redoStack = [];
        await this.saveState();
        
        return {
            success: true,
            commit: {
                id: commitId,
                message: message,
                author: commit.author,
                timestamp: commit.timestampISO,
                branch: this.currentBranch,
                changes: changes
            }
        };
    }

    async getSnapshot(commitId) {
        if (!commitId) return null;
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        if (!await fs.pathExists(commitPath)) return null;
        const commit = await fs.readJson(commitPath);
        return commit.snapshot;
    }

    async getCommit(commitId) {
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        if (!await fs.pathExists(commitPath)) {
            return null;
        }
        
        const commit = await fs.readJson(commitPath);
        const { snapshot, ...commitWithoutSnapshot } = commit;
        return commitWithoutSnapshot;
    }

    async getFullCommit(commitId) {
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        if (!await fs.pathExists(commitPath)) {
            return null;
        }
        return await fs.readJson(commitPath);
    }

    async checkout(commitId, user = null) {
        const commit = await this.getFullCommit(commitId);
        
        if (!commit) {
            if (this.branches.has(commitId)) {
                return await this.switchBranch(commitId, user);
            }
            return { error: `Commit or branch '${commitId}' not found` };
        }
        
        await this.restoreSnapshot(commit.snapshot);
        
        const branch = this.branches.get(this.currentBranch);
        if (branch) {
            branch.head = commitId;
            await this.saveBranch(this.currentBranch);
        }
        
        await this.saveState();
        
        return {
            success: true,
            checkedOut: commitId,
            message: commit.message,
            author: commit.author,
            timestamp: commit.timestampISO,
            branch: this.currentBranch
        };
    }

    async switchBranch(branchName, user = null) {
        if (!this.branches.has(branchName)) {
            return { error: `Branch '${branchName}' not found` };
        }
        
        const branch = this.branches.get(branchName);
        const headCommit = branch.head;
        
        if (headCommit) {
            const commit = await this.getFullCommit(headCommit);
            if (commit) {
                await this.restoreSnapshot(commit.snapshot);
            }
        }
        
        this.currentBranch = branchName;
        await this.saveState();
        
        return {
            success: true,
            branch: branchName,
            head: headCommit,
            message: `Switched to branch '${branchName}'`
        };
    }

    async createBranch(branchName, sourceBranch = null, user = null) {
        if (this.branches.has(branchName)) {
            return { error: `Branch '${branchName}' already exists` };
        }
        
        const source = sourceBranch || this.currentBranch;
        const sourceBranchData = this.branches.get(source);
        
        if (!sourceBranchData && source !== 'main') {
            return { error: `Source branch '${source}' not found` };
        }
        
        const headCommit = sourceBranchData?.head || this.getCurrentHead();
        
        const newBranch = {
            name: branchName,
            source: source,
            head: headCommit,
            commits: headCommit ? [headCommit] : [],
            created: Date.now(),
            createdISO: new Date().toISOString(),
            createdBy: user?.username || 'system',
            updatedAt: Date.now()
        };
        
        this.branches.set(branchName, newBranch);
        await this.saveBranch(branchName);
        
        return {
            success: true,
            branch: branchName,
            from: source,
            head: headCommit
        };
    }

    async deleteBranch(branchName, user = null) {
        if (branchName === 'main') {
            return { error: 'Cannot delete the main branch' };
        }
        
        if (!this.branches.has(branchName)) {
            return { error: `Branch '${branchName}' not found` };
        }
        
        this.branches.delete(branchName);
        const branchPath = path.join(this.branchesPath, `${branchName}.json`);
        if (await fs.pathExists(branchPath)) {
            await fs.remove(branchPath);
        }
        
        return {
            success: true,
            deleted: branchName
        };
    }

    async listBranches(user = null) {
        const branches = [];
        
        for (const [name, data] of this.branches.entries()) {
            branches.push({
                name: name,
                current: name === this.currentBranch,
                head: data.head,
                commits: data.commits.length,
                created: data.createdISO,
                createdBy: data.createdBy,
                source: data.source
            });
        }
        
        return branches;
    }

    async merge(sourceBranch, targetBranch, user = null) {
        if (!this.branches.has(sourceBranch)) {
            return { error: `Source branch '${sourceBranch}' not found` };
        }
        
        if (!this.branches.has(targetBranch)) {
            return { error: `Target branch '${targetBranch}' not found` };
        }
        
        const source = this.branches.get(sourceBranch);
        const target = this.branches.get(targetBranch);
        
        if (!source.head) {
            return { error: `Source branch '${sourceBranch}' has no commits` };
        }
        
        const sourceCommit = await this.getFullCommit(source.head);
        if (!sourceCommit) {
            return { error: 'Source commit not found' };
        }
        
        const currentBranch = this.currentBranch;
        
        await this.switchBranch(targetBranch, user);
        await this.restoreSnapshot(sourceCommit.snapshot);
        
        const mergeMessage = `Merge ${sourceBranch} into ${targetBranch}`;
        const mergeResult = await this.create(mergeMessage, user);
        
        if (mergeResult.success) {
            target.head = mergeResult.commit.id;
            target.commits.push(mergeResult.commit.id);
            await this.saveBranch(targetBranch);
            
            if (currentBranch !== targetBranch) {
                await this.switchBranch(currentBranch, user);
            }
        }
        
        return {
            success: true,
            merged: sourceBranch,
            into: targetBranch,
            commit: mergeResult.commit
        };
    }

    async undo(steps = 1, user = null) {
        const results = [];
        
        for (let i = 0; i < steps; i++) {
            if (this.undoStack.length === 0) {
                if (i === 0) return { error: 'Nothing to undo' };
                break;
            }
            
            const lastCommitId = this.undoStack.pop();
            const commit = await this.getFullCommit(lastCommitId);
            
            if (commit) {
                const parentCommitId = commit.parent;
                
                if (parentCommitId) {
                    const parentCommit = await this.getFullCommit(parentCommitId);
                    if (parentCommit) {
                        await this.restoreSnapshot(parentCommit.snapshot);
                    }
                } else {
                    const emptySnapshot = { databases: {}, keyvalue: {} };
                    await this.restoreSnapshot(emptySnapshot);
                }
                
                this.redoStack.push(lastCommitId);
                results.push(lastCommitId);
            }
        }
        
        const branch = this.branches.get(this.currentBranch);
        if (branch && results.length > 0) {
            const newHead = this.undoStack[this.undoStack.length - 1] || null;
            branch.head = newHead;
            await this.saveBranch(this.currentBranch);
        }
        
        await this.saveState();
        
        return {
            success: true,
            undone: results.length,
            commits: results
        };
    }

    async redo(steps = 1, user = null) {
        const results = [];
        
        for (let i = 0; i < steps; i++) {
            if (this.redoStack.length === 0) {
                if (i === 0) return { error: 'Nothing to redo' };
                break;
            }
            
            const nextCommitId = this.redoStack.pop();
            const commit = await this.getFullCommit(nextCommitId);
            
            if (commit) {
                await this.restoreSnapshot(commit.snapshot);
                this.undoStack.push(nextCommitId);
                results.push(nextCommitId);
            }
        }
        
        const branch = this.branches.get(this.currentBranch);
        if (branch && results.length > 0) {
            branch.head = results[results.length - 1];
            await this.saveBranch(this.currentBranch);
        }
        
        await this.saveState();
        
        return {
            success: true,
            redone: results.length,
            commits: results
        };
    }

    async forceBack(steps = 1, user = null) {
        if (this.undoStack.length < steps) {
            return { error: `Cannot go back ${steps} commits. Only ${this.undoStack.length} available.` };
        }
        
        const targetIndex = this.undoStack.length - steps;
        const targetCommitId = targetIndex > 0 ? this.undoStack[targetIndex - 1] : null;
        
        if (targetCommitId) {
            const commit = await this.getFullCommit(targetCommitId);
            if (commit) {
                await this.restoreSnapshot(commit.snapshot);
            }
        } else {
            const emptySnapshot = { databases: {}, keyvalue: {} };
            await this.restoreSnapshot(emptySnapshot);
        }
        
        const removed = this.undoStack.slice(targetIndex);
        this.undoStack = this.undoStack.slice(0, targetIndex);
        this.redoStack = [];
        
        const branch = this.branches.get(this.currentBranch);
        if (branch) {
            branch.head = targetCommitId;
            await this.saveBranch(this.currentBranch);
        }
        
        await this.saveState();
        
        return {
            success: true,
            forcedBack: steps,
            removed: removed.length,
            nowAt: targetCommitId || 'initial state'
        };
    }

    async factoryReset(user = null) {
        const backup = await this.takeSnapshot();
        const backupPath = path.join(this.commitsPath, `factory_reset_backup_${Date.now()}.json`);
        await fs.writeJson(backupPath, backup);
        
        const emptySnapshot = { databases: {}, keyvalue: {} };
        await this.restoreSnapshot(emptySnapshot);
        
        this.undoStack = [];
        this.redoStack = [];
        this.commitHistory = [];
        
        const branch = this.branches.get(this.currentBranch);
        if (branch) {
            branch.head = null;
            branch.commits = [];
            await this.saveBranch(this.currentBranch);
        }
        
        await this.saveState();
        
        return {
            success: true,
            message: 'Factory reset completed',
            backup: backupPath
        };
    }

    async diff(source, target, user = null) {
        let sourceSnapshot, targetSnapshot;
        
        if (this.branches.has(source)) {
            const branch = this.branches.get(source);
            if (branch.head) {
                const commit = await this.getFullCommit(branch.head);
                sourceSnapshot = commit?.snapshot;
            }
        } else {
            const commit = await this.getFullCommit(source);
            sourceSnapshot = commit?.snapshot;
        }
        
        if (this.branches.has(target)) {
            const branch = this.branches.get(target);
            if (branch.head) {
                const commit = await this.getFullCommit(branch.head);
                targetSnapshot = commit?.snapshot;
            }
        } else {
            const commit = await this.getFullCommit(target);
            targetSnapshot = commit?.snapshot;
        }
        
        if (!sourceSnapshot && !targetSnapshot) {
            return { error: 'No valid commits found for comparison' };
        }
        
        const currentSnapshot = await this.takeSnapshot();
        const sourceData = sourceSnapshot || { databases: {}, keyvalue: {} };
        const targetData = targetSnapshot || currentSnapshot;
        
        const changes = {
            added: [],
            modified: [],
            removed: []
        };
        
        const allKeys = new Set();
        
        for (const [db, tables] of Object.entries(sourceData.databases || {})) {
            for (const table of Object.keys(tables)) {
                allKeys.add(`${db}.${table}`);
            }
        }
        
        for (const [db, tables] of Object.entries(targetData.databases || {})) {
            for (const table of Object.keys(tables)) {
                allKeys.add(`${db}.${table}`);
            }
        }
        
        for (const key of allKeys) {
            const [db, table] = key.split('.');
            const sourceTable = sourceData.databases?.[db]?.[table];
            const targetTable = targetData.databases?.[db]?.[table];
            
            if (!sourceTable && targetTable) {
                changes.added.push(key);
            } else if (sourceTable && !targetTable) {
                changes.removed.push(key);
            } else if (JSON.stringify(sourceTable) !== JSON.stringify(targetTable)) {
                changes.modified.push(key);
            }
        }
        
        return {
            source: source || 'current',
            target: target || 'current',
            changes: changes,
            summary: {
                added: changes.added.length,
                modified: changes.modified.length,
                removed: changes.removed.length
            }
        };
    }

    async getHistory(limit = 20, branch = null) {
        const targetBranch = branch || this.currentBranch;
        const branchData = this.branches.get(targetBranch);
        
        if (!branchData || !branchData.commits.length) {
            return [];
        }
        
        const commits = [];
        const commitIds = branchData.commits.slice(-limit).reverse();
        
        for (const commitId of commitIds) {
            const commit = await this.getCommit(commitId);
            if (commit) {
                commits.push(commit);
            }
        }
        
        return commits;
    }

    async getCommitLog(limit = 50) {
        const commits = [];
        
        for (const commitId of this.commitHistory.slice(-limit).reverse()) {
            const commit = await this.getCommit(commitId);
            if (commit) {
                commits.push(commit);
            }
        }
        
        return commits;
    }

    async getBranchTree() {
        const tree = {
            main: {
                name: 'main',
                commits: [],
                branches: []
            }
        };
        
        for (const [name, data] of this.branches.entries()) {
            if (name === 'main') {
                tree.main.commits = data.commits;
            } else {
                const source = data.source || 'main';
                if (!tree[source]) tree[source] = { commits: [], branches: [] };
                tree[source].branches.push({
                    name: name,
                    commits: data.commits,
                    head: data.head
                });
            }
        }
        
        return tree;
    }

    async createTag(tagName, commitId = null, user = null) {
        if (this.tags.has(tagName)) {
            return { error: `Tag '${tagName}' already exists` };
        }
        
        const targetCommit = commitId || this.getCurrentHead();
        if (!targetCommit) {
            return { error: 'No commit to tag' };
        }
        
        const commit = await this.getCommit(targetCommit);
        if (!commit) {
            return { error: `Commit '${targetCommit}' not found` };
        }
        
        this.tags.set(tagName, {
            name: tagName,
            commit: targetCommit,
            created: Date.now(),
            createdISO: new Date().toISOString(),
            createdBy: user?.username || 'system'
        });
        
        await this.saveTags();
        
        return {
            success: true,
            tag: tagName,
            commit: targetCommit
        };
    }

    async listTags() {
        const tags = [];
        for (const [name, data] of this.tags.entries()) {
            tags.push({
                name: name,
                commit: data.commit,
                created: data.createdISO,
                createdBy: data.createdBy
            });
        }
        return tags.sort((a, b) => new Date(b.created) - new Date(a.created));
    }

    async deleteTag(tagName) {
        if (!this.tags.has(tagName)) {
            return { error: `Tag '${tagName}' not found` };
        }
        
        this.tags.delete(tagName);
        await this.saveTags();
        
        return {
            success: true,
            deleted: tagName
        };
    }

    async getStats() {
        const totalCommits = this.commitHistory.length;
        const totalBranches = this.branches.size;
        const totalTags = this.tags.size;
        
        const authors = new Map();
        for (const commitId of this.commitHistory) {
            const commit = await this.getCommit(commitId);
            if (commit && commit.author) {
                authors.set(commit.author, (authors.get(commit.author) || 0) + 1);
            }
        }
        
        const topAuthors = Array.from(authors.entries())
            .map(([author, count]) => ({ author, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        
        const commitsByDay = new Map();
        for (const commitId of this.commitHistory) {
            const commit = await this.getCommit(commitId);
            if (commit && commit.timestamp) {
                const day = new Date(commit.timestamp).toISOString().split('T')[0];
                commitsByDay.set(day, (commitsByDay.get(day) || 0) + 1);
            }
        }
        
        const recentActivity = Array.from(commitsByDay.entries())
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 7)
            .map(([day, count]) => ({ day, count }));
        
        return {
            totalCommits,
            totalBranches,
            totalTags,
            currentBranch: this.currentBranch,
            topAuthors,
            recentActivity,
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0
        };
    }
}

module.exports = new CommitSystem();
