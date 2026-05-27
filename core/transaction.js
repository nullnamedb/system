// NullName DB - ACID Transaction Engine
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class TransactionEngine {
    constructor() {
        this.activeTransactions = new Map();
        this.walPath = path.join(__dirname, '..', 'database', 'wal.log');
        this.checkpointPath = path.join(__dirname, '..', 'database', 'checkpoint.json');
        this.locks = new Map();
        this.transactionTimeout = 30000;
        this.isRecovering = false;
        
        this.init();
    }

    async init() {
        await this.ensureFiles();
        await this.recover();
        this.startCleanupInterval();
        console.log('Transaction engine initialized');
    }

    async ensureFiles() {
        await fs.ensureDir(path.dirname(this.walPath));
        if (!await fs.pathExists(this.walPath)) {
            await fs.writeFile(this.walPath, '');
        }
        if (!await fs.pathExists(this.checkpointPath)) {
            await fs.writeJson(this.checkpointPath, { lastLsn: 0, timestamp: Date.now() });
        }
    }

    startCleanupInterval() {
        setInterval(() => {
            this.cleanupExpiredTransactions();
        }, 60000);
    }

    cleanupExpiredTransactions() {
        const now = Date.now();
        for (const [txId, tx] of this.activeTransactions.entries()) {
            if (now - tx.startTime > this.transactionTimeout) {
                this.rollback(txId);
            }
        }
    }

    generateLsn() {
        return Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    }

    async writeWAL(entry) {
        const walEntry = {
            lsn: this.generateLsn(),
            timestamp: Date.now(),
            ...entry
        };
        await fs.appendFile(this.walPath, JSON.stringify(walEntry) + '\n');
        return walEntry.lsn;
    }

    async recover() {
        if (this.isRecovering) return;
        this.isRecovering = true;

        try {
            const checkpoint = await fs.readJson(this.checkpointPath);
            const walContent = await fs.readFile(this.walPath, 'utf8');
            const lines = walContent.split('\n').filter(l => l.trim());
            
            let lastLsn = checkpoint.lastLsn;
            const transactionsToRecover = new Map();

            for (const line of lines) {
                const entry = JSON.parse(line);
                if (entry.lsn <= lastLsn) continue;

                if (entry.type === 'BEGIN') {
                    transactionsToRecover.set(entry.transactionId, { entries: [], committed: false });
                } else if (entry.type === 'COMMIT') {
                    const tx = transactionsToRecover.get(entry.transactionId);
                    if (tx) tx.committed = true;
                } else if (entry.type === 'ROLLBACK') {
                    transactionsToRecover.delete(entry.transactionId);
                } else if (entry.type === 'DATA') {
                    const tx = transactionsToRecover.get(entry.transactionId);
                    if (tx) tx.entries.push(entry);
                }
            }

            for (const [txId, tx] of transactionsToRecover.entries()) {
                if (tx.committed) {
                    for (const entry of tx.entries) {
                        await this.applyDataEntry(entry);
                    }
                }
            }

            const newCheckpoint = {
                lastLsn: lines.length > 0 ? JSON.parse(lines[lines.length - 1]).lsn : 0,
                timestamp: Date.now()
            };
            await fs.writeJson(this.checkpointPath, newCheckpoint);
            await fs.writeFile(this.walPath, '');

            console.log(`Recovered ${transactionsToRecover.size} transactions`);
        } catch (error) {
            console.error('Recovery failed:', error);
        } finally {
            this.isRecovering = false;
        }
    }

    async applyDataEntry(entry) {
        const { operation, dbName, tableName, id, column, value, oldValue } = entry;
        
        const database = require('./database');
        
        switch (operation) {
            case 'ADD':
                await database.add(dbName, tableName, column, value, { username: 'system' });
                break;
            case 'UPDATE':
                await database.update(dbName, tableName, id, column, value, { username: 'system' });
                break;
            case 'DELETE':
                await database.deleteById(dbName, tableName, id, { username: 'system' });
                break;
        }
    }

    async begin(user = null) {
        const transactionId = crypto.randomBytes(8).toString('hex');
        const startTime = Date.now();

        const transaction = {
            id: transactionId,
            startTime: startTime,
            user: user,
            operations: [],
            status: 'active',
            locks: []
        };

        this.activeTransactions.set(transactionId, transaction);

        await this.writeWAL({
            type: 'BEGIN',
            transactionId: transactionId,
            user: user?.username || 'system',
            timestamp: startTime
        });

        return {
            success: true,
            transactionId: transactionId,
            message: 'Transaction started'
        };
    }

    async acquireLock(resource, transactionId, mode = 'WRITE') {
        const existingLock = this.locks.get(resource);
        
        if (existingLock && existingLock.transactionId !== transactionId) {
            const waitStart = Date.now();
            while (this.locks.has(resource) && this.locks.get(resource).transactionId !== transactionId) {
                if (Date.now() - waitStart > 5000) {
                    return { success: false, error: 'Lock timeout' };
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        this.locks.set(resource, {
            transactionId: transactionId,
            mode: mode,
            acquiredAt: Date.now()
        });

        const transaction = this.activeTransactions.get(transactionId);
        if (transaction) {
            transaction.locks.push(resource);
        }

        return { success: true };
    }

    releaseLocks(transactionId) {
        for (const [resource, lock] of this.locks.entries()) {
            if (lock.transactionId === transactionId) {
                this.locks.delete(resource);
            }
        }
    }

    async addOperation(transactionId, operation) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        if (transaction.status !== 'active') {
            return { success: false, error: `Transaction is ${transaction.status}` };
        }

        transaction.operations.push(operation);

        await this.writeWAL({
            type: 'DATA',
            transactionId: transactionId,
            operation: operation.type,
            dbName: operation.dbName,
            tableName: operation.tableName,
            id: operation.id,
            column: operation.column,
            value: operation.value,
            oldValue: operation.oldValue
        });

        return { success: true };
    }

    async addRecord(dbName, tableName, column, value, transactionId, user = null) {
        const lockResult = await this.acquireLock(`${dbName}.${tableName}`, transactionId);
        if (!lockResult.success) return lockResult;

        const database = require('./database');
        const result = await database.add(dbName, tableName, column, value, user);

        if (result.success) {
            await this.addOperation(transactionId, {
                type: 'ADD',
                dbName: dbName,
                tableName: tableName,
                column: column,
                value: value,
                resultId: result.id
            });
        }

        return result;
    }

    async updateRecord(dbName, tableName, id, column, value, transactionId, user = null) {
        const lockResult = await this.acquireLock(`${dbName}.${tableName}.${id}`, transactionId);
        if (!lockResult.success) return lockResult;

        const database = require('./database');
        const oldData = await database.getById(dbName, tableName, id, null, user);
        const result = await database.update(dbName, tableName, id, column, value, user);

        if (result.success) {
            await this.addOperation(transactionId, {
                type: 'UPDATE',
                dbName: dbName,
                tableName: tableName,
                id: id,
                column: column,
                value: value,
                oldValue: oldData[column]
            });
        }

        return result;
    }

    async deleteRecord(dbName, tableName, id, transactionId, user = null) {
        const lockResult = await this.acquireLock(`${dbName}.${tableName}.${id}`, transactionId);
        if (!lockResult.success) return lockResult;

        const database = require('./database');
        const oldData = await database.getById(dbName, tableName, id, null, user);
        const result = await database.deleteById(dbName, tableName, id, user);

        if (result.success) {
            await this.addOperation(transactionId, {
                type: 'DELETE',
                dbName: dbName,
                tableName: tableName,
                id: id,
                oldValue: oldData
            });
        }

        return result;
    }

    async commit(transactionId, user = null) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        if (transaction.status !== 'active') {
            return { success: false, error: `Transaction is ${transaction.status}` };
        }

        transaction.status = 'committed';

        await this.writeWAL({
            type: 'COMMIT',
            transactionId: transactionId,
            user: user?.username || 'system',
            timestamp: Date.now()
        });

        this.releaseLocks(transactionId);
        this.activeTransactions.delete(transactionId);

        return {
            success: true,
            transactionId: transactionId,
            operations: transaction.operations.length,
            message: 'Transaction committed successfully'
        };
    }

    async rollback(transactionId, user = null) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        if (transaction.status !== 'active') {
            return { success: false, error: `Transaction is ${transaction.status}` };
        }

        const database = require('./database');

        for (let i = transaction.operations.length - 1; i >= 0; i--) {
            const op = transaction.operations[i];
            try {
                switch (op.type) {
                    case 'ADD':
                        await database.deleteById(op.dbName, op.tableName, op.resultId, { username: 'system' });
                        break;
                    case 'UPDATE':
                        await database.update(op.dbName, op.tableName, op.id, op.column, op.oldValue, { username: 'system' });
                        break;
                    case 'DELETE':
                        for (const [key, value] of Object.entries(op.oldValue)) {
                            if (key !== 'id') {
                                await database.add(op.dbName, op.tableName, key, value, { username: 'system' });
                            }
                        }
                        break;
                }
            } catch (error) {
                console.error('Rollback error:', error);
            }
        }

        transaction.status = 'rolled_back';

        await this.writeWAL({
            type: 'ROLLBACK',
            transactionId: transactionId,
            user: user?.username || 'system',
            timestamp: Date.now()
        });

        this.releaseLocks(transactionId);
        this.activeTransactions.delete(transactionId);

        return {
            success: true,
            transactionId: transactionId,
            operations: transaction.operations.length,
            message: 'Transaction rolled back'
        };
    }

    async getTransactionStatus(transactionId) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        return {
            success: true,
            transactionId: transaction.id,
            status: transaction.status,
            startTime: new Date(transaction.startTime).toISOString(),
            operationsCount: transaction.operations.length,
            locks: transaction.locks,
            user: transaction.user?.username || 'system'
        };
    }

    async getActiveTransactions() {
        const transactions = [];
        for (const [id, tx] of this.activeTransactions.entries()) {
            transactions.push({
                id: id,
                status: tx.status,
                startTime: new Date(tx.startTime).toISOString(),
                operationsCount: tx.operations.length,
                locks: tx.locks,
                user: tx.user?.username || 'system'
            });
        }
        return transactions;
    }

    async getStats() {
        let totalLocks = this.locks.size;
        let totalOperations = 0;
        for (const tx of this.activeTransactions.values()) {
            totalOperations += tx.operations.length;
        }

        const walStat = await fs.stat(this.walPath).catch(() => ({ size: 0 }));

        return {
            activeTransactions: this.activeTransactions.size,
            totalLocks: totalLocks,
            totalPendingOperations: totalOperations,
            walSizeBytes: walStat.size,
            walSizeKB: (walStat.size / 1024).toFixed(2),
            isRecovering: this.isRecovering
        };
    }

    async savepoint(transactionId, name) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        if (!transaction.savepoints) {
            transaction.savepoints = [];
        }

        const savepoint = {
            name: name,
            index: transaction.operations.length,
            timestamp: Date.now()
        };

        transaction.savepoints.push(savepoint);

        return {
            success: true,
            transactionId: transactionId,
            savepoint: name,
            atOperation: savepoint.index
        };
    }

    async rollbackToSavepoint(transactionId, name) {
        const transaction = this.activeTransactions.get(transactionId);
        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        const savepoint = transaction.savepoints?.find(s => s.name === name);
        if (!savepoint) {
            return { success: false, error: `Savepoint '${name}' not found` };
        }

        const operationsToRollback = transaction.operations.slice(savepoint.index);
        const database = require('./database');

        for (let i = operationsToRollback.length - 1; i >= 0; i--) {
            const op = operationsToRollback[i];
            try {
                switch (op.type) {
                    case 'ADD':
                        await database.deleteById(op.dbName, op.tableName, op.resultId, { username: 'system' });
                        break;
                    case 'UPDATE':
                        await database.update(op.dbName, op.tableName, op.id, op.column, op.oldValue, { username: 'system' });
                        break;
                    case 'DELETE':
                        for (const [key, value] of Object.entries(op.oldValue)) {
                            if (key !== 'id') {
                                await database.add(op.dbName, op.tableName, key, value, { username: 'system' });
                            }
                        }
                        break;
                }
            } catch (error) {
                console.error('Savepoint rollback error:', error);
            }
        }

        transaction.operations = transaction.operations.slice(0, savepoint.index);
        transaction.savepoints = transaction.savepoints.filter(s => s.index <= savepoint.index);

        return {
            success: true,
            transactionId: transactionId,
            savepoint: name,
            rolledBackOperations: operationsToRollback.length
        };
    }
}

module.exports = new TransactionEngine();
