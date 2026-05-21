// NullName DB - Git-like Version Control System
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 700+

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

// ============================================
// COMMIT SYSTEM CLASS
// ============================================

class CommitSystem {
    constructor() {
        this.commitsPath = path.join(__dirname, '..', 'database', 'commits');
        this.branchesPath = path.join(__dirname, '..', 'database', 'branches');
        this.statePath = path.join(__dirname, '..', 'database', 'git_state.json');
        
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
                // Create initial state
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

    // ============================================
    // SNAPSHOT MANAGEMENT
    // ============================================

    async takeSnapshot() {
        const dbPath = path.join(__dirname, '..', 'database', 'path');
        const snapshot = {
            databases: {},
            timestamp: Date.now(),
            branch: this.currentBranch
        };
        
        if (await fs.pathExists(dbPath)) {
            const databases = await fs.readdir(dbPath);
            
            for (const db of databases) {
                const dbFullPath = path.join(dbPath, db);
                const stat = await fs.stat(dbFullPath);
                
                if (stat.isDirectory()) {
                    snapshot.databases[db] = {};
                    const tables = await fs.readdir(dbFullPath);
                    
                    for (const table of tables) {
                        if (table.endsWith('.json')) {
                            const tablePath = path.join(dbFullPath, table);
                            const tableName = table.replace('.json', '');
                            snapshot.databases[db][tableName] = await fs.readJson(tablePath);
                        }
                    }
                }
            }
        }
        
        // Also capture key-value store
        const kvPath = path.join(dbPath, '_keyvalue.json');
        if (await fs.pathExists(kvPath)) {
            snapshot.keyvalue = await fs.readJson(kvPath);
        }
        
        return snapshot;
    }

    async restoreSnapshot(snapshot) {
        const dbPath = path.join(__dirname, '..', 'database', 'path');
        
        // Clear current database
        if (await fs.pathExists(dbPath)) {
            const databases = await fs.readdir(dbPath);
            for (const db of databases) {
                const dbFullPath = path.join(dbPath, db);
                const stat = await fs.stat(dbFullPath);
                if (stat.isDirectory()) {
                    await fs.remove(dbFullPath);
                    await fs.ensureDir(dbFullPath);
                }
            }
        }
        
        // Restore from snapshot
        for (const [dbName, tables] of Object.entries(snapshot.databases)) {
            const dbFullPath = path.join(dbPath, dbName);
            await fs.ensureDir(dbFullPath);
            
            for (const [tableName, data] of Object.entries(tables)) {
                const tablePath = path.join(dbFullPath, `${tableName}.json`);
                await fs.writeJson(tablePath, data, { spaces: 2 });
            }
        }
        
        // Restore key-value store
        if (snapshot.keyvalue) {
            const kvPath = path.join(dbPath, '_keyvalue.json');
            await fs.writeJson(kvPath, snapshot.keyvalue, { spaces: 2 });
        }
    }

    // ============================================
    // COMMIT OPERATIONS
    // ============================================

    async create(message, user = null, options = {}) {
        const commitId = this.generateCommitId();
        const timestamp = Date.now();
        
        // Take snapshot of current state
        const snapshot = await this.takeSnapshot();
        
        // Get parent commit
        const parentCommit = this.getCurrentHead();
        
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
            filesChanged: await this.getChanges(parentCommit, snapshot),
            stats: {
                databases: Object.keys(snapshot.databases).length,
                tables: this.countTables(snapshot),
                records: await this.countRecords(snapshot)
            }
        };
        
        // Save commit
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        await fs.writeJson(commitPath, commit, { spaces: 2 });
        
        // Update branch head
        const branch = this.branches.get(this.currentBranch);
        if (branch) {
            branch.head = commitId;
            branch.commits.push(commitId);
            branch.updatedAt = timestamp;
            await this.saveBranch(this.currentBranch);
        }
        
        // Update history
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
                branch: this.currentBranch
            }
        };
    }

    generateCommitId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(6).toString('hex');
        return `commit_${timestamp}_${random}`;
    }

    getCurrentHead() {
        const branch = this.branches.get(this.currentBranch);
        return branch?.head || null;
    }

    async getChanges(commitId, currentSnapshot) {
        if (!commitId) {
            return { added: 0, modified: 0, deleted: 0 };
        }
        
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        if (!await fs.pathExists(commitPath)) {
            return { added: 0, modified: 0, deleted: 0 };
        }
        
        const commit = await fs.readJson(commitPath);
        const oldSnapshot = commit.snapshot;
        
        let added = 0;
        let modified = 0;
        let deleted = 0;
        
        // Compare snapshots (simplified)
        const oldKeys = new Set();
        const newKeys = new Set();
        
        for (const [db, tables] of Object.entries(oldSnapshot.databases || {})) {
            for (const table of Object.keys(tables)) {
                oldKeys.add(`${db}.${table}`);
            }
        }
        
        for (const [db, tables] of Object.entries(currentSnapshot.databases || {})) {
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
                count += Object.keys(data).filter(k => !isNaN(k)).length;
            }
        }
        return count;
    }

    async getCommit(commitId) {
        const commitPath = path.join(this.commitsPath, `${commitId}.json`);
        if (!await fs.pathExists(commitPath)) {
            return null;
        }
        
        const commit = await fs.readJson(commitPath);
        // Remove snapshot to save memory (can be loaded separately)
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

    // ============================================
    // CHECKOUT OPERATIONS
    // ============================================

    async checkout(commitId, user = null) {
        const commit = await this.getFullCommit(commitId);
        
        if (!commit) {
            // Check if it's a branch name
            if (this.branches.has(commitId)) {
                return await this.switchBranch(commitId, user);
            }
            return { error: `Commit or branch '${commitId}' not found` };
        }
        
        // Restore snapshot
        await this.restoreSnapshot(commit.snapshot);
        
        // Update current branch to point to this commit
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
            // Checkout the head commit
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

    // ============================================
    // BRANCH OPERATIONS
    // ============================================

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
                createdBy: data.createdBy
            });
        }
        
        return branches;
    }

    // ============================================
    // MERGE OPERATIONS
    // ============================================

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
        
        // Get source commit
        const sourceCommit = await this.getFullCommit(source.head);
        if (!sourceCommit) {
            return { error: 'Source commit not found' };
        }
        
        // Store current state
        const currentBranch = this.currentBranch;
        
        // Switch to target branch
        await this.switchBranch(targetBranch, user);
        
        // Restore source snapshot (merge)
        await this.restoreSnapshot(sourceCommit.snapshot);
        
        // Create merge commit
        const mergeMessage = `Merge ${sourceBranch} into ${targetBranch}`;
        const mergeResult = await this.create(mergeMessage, user);
        
        if (mergeResult.success) {
            // Update target branch head
            target.head = mergeResult.commit.id;
            target.commits.push(mergeResult.commit.id);
            await this.saveBranch(targetBranch);
            
            // Switch back to original branch if needed
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

    // ============================================
    // UNDO/REDO OPERATIONS
    // ============================================

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
                // Get parent commit (state before this commit)
                const parentCommitId = commit.parent;
                
                if (parentCommitId) {
                    const parentCommit = await this.getFullCommit(parentCommitId);
                    if (parentCommit) {
                        await this.restoreSnapshot(parentCommit.snapshot);
                    }
                } else {
                    // No parent, restore empty state
                    const emptySnapshot = { databases: {}, keyvalue: {} };
                    await this.restoreSnapshot(emptySnapshot);
                }
                
                this.redoStack.push(lastCommitId);
                results.push(lastCommitId);
            }
        }
        
        // Update branch head
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
        
        // Update branch head
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

    // ============================================
    // FORCE RECOVERY
    // ============================================

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
            // Reset to empty state
            const emptySnapshot = { databases: {}, keyvalue: {} };
            await this.restoreSnapshot(emptySnapshot);
        }
        
        // Trim stacks
        const removed = this.undoStack.slice(targetIndex);
        this.undoStack = this.undoStack.slice(0, targetIndex);
        this.redoStack = [];
        
        // Update branch head
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
        // Create backup before reset
        const backup = await this.takeSnapshot();
        const backupPath = path.join(this.commitsPath, `factory_reset_backup_${Date.now()}.json`);
        await fs.writeJson(backupPath, backup);
        
        // Clear all data
        const emptySnapshot = { databases: {}, keyvalue: {} };
        await this.restoreSnapshot(emptySnapshot);
        
        // Reset state
        this.undoStack = [];
        this.redoStack = [];
        this.commitHistory = [];
        
        // Reset current branch head
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

    // ============================================
    // DIFF OPERATIONS
    // ============================================

    async diff(source, target, user = null) {
        let sourceCommit, targetCommit;
        
        // Get source (can be commit ID or branch name)
        if (this.branches.has(source)) {
            const branch = this.branches.get(source);
            if (branch.head) {
                sourceCommit = await this.getFullCommit(branch.head);
            }
        } else {
            sourceCommit = await this.getFullCommit(source);
        }
        
        // Get target
        if (this.branches.has(target)) {
            const branch = this.branches.get(target);
            if (branch.head) {
                targetCommit = await this.getFullCommit(branch.head);
            }
        } else {
            targetCommit = await this.getFullCommit(target);
        }
        
        if (!sourceCommit && !targetCommit) {
            return { error: 'No valid commits found for comparison' };
        }
        
        const sourceSnapshot = sourceCommit?.snapshot || { databases: {}, keyvalue: {} };
        const targetSnapshot = targetCommit?.snapshot || await this.takeSnapshot();
        
        const changes = {
            added: [],
            modified: [],
            removed: []
        };
        
        // Compare databases and tables
        const allKeys = new Set();
        
        for (const [db, tables] of Object.entries(sourceSnapshot.databases || {})) {
            for (const table of Object.keys(tables)) {
                allKeys.add(`${db}.${table}`);
            }
        }
        
        for (const [db, tables] of Object.entries(targetSnapshot.databases || {})) {
            for (const table of Object.keys(tables)) {
                allKeys.add(`${db}.${table}`);
            }
        }
        
        for (const key of allKeys) {
            const [db, table] = key.split('.');
            const sourceTable = sourceSnapshot.databases?.[db]?.[table];
            const targetTable = targetSnapshot.databases?.[db]?.[table];
            
            if (!sourceTable && targetTable) {
                changes.added.push(key);
            } else if (sourceTable && !targetTable) {
                changes.removed.push(key);
            } else if (JSON.stringify(sourceTable) !== JSON.stringify(targetTable)) {
                changes.modified.push(key);
            }
        }
        
        return {
            source: sourceCommit ? sourceCommit.id : 'current',
            target: targetCommit ? targetCommit.id : 'current',
            changes: changes,
            summary: {
                added: changes.added.length,
                modified: changes.modified.length,
                removed: changes.removed.length
            }
        };
    }

    // ============================================
    // HISTORY OPERATIONS
    // ============================================

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

    async getStats() {
        const totalCommits = this.commitHistory.length;
        const totalBranches = this.branches.size;
        const totalTags = this.tags.size;
        
        // Calculate commit authors
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
        
        // Calculate commit frequency (by day)
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

    // ============================================
    // TAG OPERATIONS
    // ============================================

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
        
        // Save tags
        const tagsPath = path.join(__dirname, '..', 'database', 'tags.json');
        const tagsObj = Object.fromEntries(this.tags);
        await fs.writeJson(tagsPath, tagsObj, { spaces: 2 });
        
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
        
        const tagsPath = path.join(__dirname, '..', 'database', 'tags.json');
        const tagsObj = Object.fromEntries(this.tags);
        await fs.writeJson(tagsPath, tagsObj, { spaces: 2 });
        
        return {
            success: true,
            deleted: tagName
        };
    }

    // ============================================
    // CLEANUP
    // ============================================

    async loadTags() {
        try {
            const tagsPath = path.join(__dirname, '..', 'database', 'tags.json');
            if (await fs.pathExists(tagsPath)) {
                const tagsObj = await fs.readJson(tagsPath);
                this.tags = new Map(Object.entries(tagsObj));
            }
        } catch (error) {
            console.error('Failed to load tags:', error);
        }
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new CommitSystem();
