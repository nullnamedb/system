// NullName DB - SQL Parser & Executor
// No brand. No name. No payment.
// Version: 2.0.0

const database = require('./database');

class SQLExecutor {
    constructor() {
        this.supportedCommands = [
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'CREATE', 'DROP', 'ALTER', 'TRUNCATE'
        ];
    }

    async execute(sqlQuery, user = null) {
        if (!sqlQuery || typeof sqlQuery !== 'string') {
            return { error: 'Invalid SQL query' };
        }

        const trimmed = sqlQuery.trim().toUpperCase();
        let command = trimmed.split(' ')[0];

        if (!this.supportedCommands.includes(command)) {
            return { error: `Unsupported SQL command: ${command}` };
        }

        try {
            switch (command) {
                case 'SELECT':
                    return await this.executeSelect(sqlQuery, user);
                case 'INSERT':
                    return await this.executeInsert(sqlQuery, user);
                case 'UPDATE':
                    return await this.executeUpdate(sqlQuery, user);
                case 'DELETE':
                    return await this.executeDelete(sqlQuery, user);
                case 'CREATE':
                    return await this.executeCreate(sqlQuery, user);
                case 'DROP':
                    return await this.executeDrop(sqlQuery, user);
                case 'ALTER':
                    return await this.executeAlter(sqlQuery, user);
                case 'TRUNCATE':
                    return await this.executeTruncate(sqlQuery, user);
                default:
                    return { error: `Unknown command: ${command}` };
            }
        } catch (error) {
            return { error: error.message };
        }
    }

    parseSelect(sql) {
        const patterns = {
            selectColumns: /SELECT\s+(.*?)\s+FROM\s+([^\s]+)/i,
            where: /WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i,
            groupBy: /GROUP\s+BY\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i,
            orderBy: /ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i,
            limit: /LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i
        };

        const selectMatch = sql.match(patterns.selectColumns);
        if (!selectMatch) {
            throw new Error('Invalid SELECT syntax');
        }

        const columnsPart = selectMatch[1].trim();
        const tableName = selectMatch[2].trim();

        let columns = [];
        if (columnsPart === '*') {
            columns = ['*'];
        } else {
            columns = columnsPart.split(',').map(c => c.trim());
        }

        const whereMatch = sql.match(patterns.where);
        let whereClause = whereMatch ? whereMatch[1].trim() : null;

        const groupByMatch = sql.match(patterns.groupBy);
        let groupBy = groupByMatch ? groupByMatch[1].trim().split(',').map(g => g.trim()) : null;

        const orderByMatch = sql.match(patterns.orderBy);
        let orderBy = null;
        if (orderByMatch) {
            const orderStr = orderByMatch[1].trim();
            orderBy = orderStr.split(',').map(o => {
                const parts = o.trim().split(' ');
                return { column: parts[0], direction: parts[1]?.toUpperCase() || 'ASC' };
            });
        }

        const limitMatch = sql.match(patterns.limit);
        let limit = null;
        let offset = 0;
        if (limitMatch) {
            limit = parseInt(limitMatch[1]);
            offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
        }

        return { tableName, columns, whereClause, groupBy, orderBy, limit, offset };
    }

    parseCondition(condition) {
        if (!condition) return null;

        const patterns = [
            { regex: /(.+?)\s*=\s*(.+)/, operator: '=' },
            { regex: /(.+?)\s*!=\s*(.+)/, operator: '!=' },
            { regex: /(.+?)\s*>\s*(.+)/, operator: '>' },
            { regex: /(.+?)\s*<\s*(.+)/, operator: '<' },
            { regex: /(.+?)\s*>=\s*(.+)/, operator: '>=' },
            { regex: /(.+?)\s*<=\s*(.+)/, operator: '<=' },
            { regex: /(.+?)\s+LIKE\s+(.+)/i, operator: 'LIKE' },
            { regex: /(.+?)\s+IN\s+\((.+)\)/i, operator: 'IN' }
        ];

        for (const pattern of patterns) {
            const match = condition.match(pattern.regex);
            if (match) {
                let value = match[2].trim();
                if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.slice(1, -1);
                }
                if (!isNaN(value) && value !== '') {
                    value = Number(value);
                }
                if (value === 'true') value = true;
                if (value === 'false') value = false;
                if (value === 'null') value = null;

                if (pattern.operator === 'IN') {
                    value = value.split(',').map(v => {
                        v = v.trim();
                        if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
                        if (!isNaN(v)) return Number(v);
                        return v;
                    });
                }

                return {
                    column: match[1].trim(),
                    operator: pattern.operator,
                    value: value
                };
            }
        }

        return null;
    }

    async executeSelect(sql, user) {
        const parsed = this.parseSelect(sql);
        const tableData = await database.getTable('default', parsed.tableName, user);

        if (tableData.error) {
            return { error: tableData.error };
        }

        let records = tableData.records || [];

        if (parsed.whereClause) {
            const condition = this.parseCondition(parsed.whereClause);
            if (condition) {
                records = records.filter(record => {
                    const recordValue = record[condition.column];
                    switch (condition.operator) {
                        case '=': return recordValue == condition.value;
                        case '!=': return recordValue != condition.value;
                        case '>': return recordValue > condition.value;
                        case '<': return recordValue < condition.value;
                        case '>=': return recordValue >= condition.value;
                        case '<=': return recordValue <= condition.value;
                        case 'LIKE': return String(recordValue).toLowerCase().includes(String(condition.value).toLowerCase());
                        case 'IN': return condition.value.includes(recordValue);
                        default: return true;
                    }
                });
            }
        }

        if (parsed.groupBy) {
            const groups = {};
            for (const record of records) {
                const groupKey = parsed.groupBy.map(g => record[g]).join('|');
                if (!groups[groupKey]) {
                    groups[groupKey] = { ...record, _count: 0 };
                }
                groups[groupKey]._count++;
            }
            records = Object.values(groups);
        }

        if (parsed.orderBy) {
            records.sort((a, b) => {
                for (const order of parsed.orderBy) {
                    const aVal = a[order.column];
                    const bVal = b[order.column];
                    if (aVal < bVal) return order.direction === 'ASC' ? -1 : 1;
                    if (aVal > bVal) return order.direction === 'ASC' ? 1 : -1;
                }
                return 0;
            });
        }

        if (parsed.limit) {
            records = records.slice(parsed.offset, parsed.offset + parsed.limit);
        }

        if (parsed.columns[0] !== '*') {
            records = records.map(record => {
                const newRecord = {};
                for (const col of parsed.columns) {
                    if (col === 'COUNT(*)') {
                        newRecord['COUNT(*)'] = records.length;
                    } else {
                        newRecord[col] = record[col];
                    }
                }
                return newRecord;
            });
        }

        return {
            success: true,
            query: sql,
            columns: parsed.columns[0] === '*' ? Object.keys(records[0] || {}) : parsed.columns,
            rows: records,
            count: records.length,
            message: `${records.length} row(s) returned`
        };
    }

    async executeInsert(sql, user) {
        const insertMatch = sql.match(/INSERT\s+INTO\s+([^\s]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
        if (!insertMatch) {
            return { error: 'Invalid INSERT syntax' };
        }

        const tableName = insertMatch[1].trim();
        const columns = insertMatch[2].split(',').map(c => c.trim());
        const values = insertMatch[3].split(',').map(v => {
            v = v.trim();
            if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
            if (!isNaN(v)) return Number(v);
            if (v === 'true') return true;
            if (v === 'false') return false;
            if (v === 'null') return null;
            return v;
        });

        const results = [];
        for (let i = 0; i < columns.length; i++) {
            const result = await database.add('default', tableName, columns[i], values[i], user);
            results.push(result);
        }

        return {
            success: true,
            table: tableName,
            inserted: results.length,
            results: results,
            message: `${results.length} row(s) inserted`
        };
    }

    async executeUpdate(sql, user) {
        const updateMatch = sql.match(/UPDATE\s+([^\s]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
        if (!updateMatch) {
            return { error: 'Invalid UPDATE syntax' };
        }

        const tableName = updateMatch[1].trim();
        const setClause = updateMatch[2].trim();
        const whereClause = updateMatch[3] ? updateMatch[3].trim() : null;

        const setMatch = setClause.match(/(.+?)\s*=\s*(.+)/);
        if (!setMatch) {
            return { error: 'Invalid SET clause' };
        }

        const column = setMatch[1].trim();
        let value = setMatch[2].trim();
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (!isNaN(value)) value = Number(value);

        const tableData = await database.getTable('default', tableName, user);
        if (tableData.error) {
            return { error: tableData.error };
        }

        let records = tableData.records || [];
        let updated = 0;

        if (whereClause) {
            const condition = this.parseCondition(whereClause);
            if (condition) {
                for (const record of records) {
                    const recordValue = record[condition.column];
                    let match = false;
                    switch (condition.operator) {
                        case '=': match = recordValue == condition.value; break;
                        case '!=': match = recordValue != condition.value; break;
                        case '>': match = recordValue > condition.value; break;
                        case '<': match = recordValue < condition.value; break;
                        case '>=': match = recordValue >= condition.value; break;
                        case '<=': match = recordValue <= condition.value; break;
                        default: match = false;
                    }
                    if (match) {
                        await database.update('default', tableName, record.id, column, value, user);
                        updated++;
                    }
                }
            } else {
                for (const record of records) {
                    await database.update('default', tableName, record.id, column, value, user);
                    updated++;
                }
            }
        } else {
            for (const record of records) {
                await database.update('default', tableName, record.id, column, value, user);
                updated++;
            }
        }

        return {
            success: true,
            table: tableName,
            updated: updated,
            message: `${updated} row(s) updated`
        };
    }

    async executeDelete(sql, user) {
        const deleteMatch = sql.match(/DELETE\s+FROM\s+([^\s]+)(?:\s+WHERE\s+(.+))?$/i);
        if (!deleteMatch) {
            return { error: 'Invalid DELETE syntax' };
        }

        const tableName = deleteMatch[1].trim();
        const whereClause = deleteMatch[2] ? deleteMatch[2].trim() : null;

        const tableData = await database.getTable('default', tableName, user);
        if (tableData.error) {
            return { error: tableData.error };
        }

        let records = tableData.records || [];
        let deleted = 0;

        if (whereClause) {
            const condition = this.parseCondition(whereClause);
            if (condition) {
                for (const record of records) {
                    const recordValue = record[condition.column];
                    let match = false;
                    switch (condition.operator) {
                        case '=': match = recordValue == condition.value; break;
                        case '!=': match = recordValue != condition.value; break;
                        case '>': match = recordValue > condition.value; break;
                        case '<': match = recordValue < condition.value; break;
                        case '>=': match = recordValue >= condition.value; break;
                        case '<=': match = recordValue <= condition.value; break;
                        default: match = false;
                    }
                    if (match) {
                        await database.deleteById('default', tableName, record.id, user);
                        deleted++;
                    }
                }
            }
        } else {
            for (const record of records) {
                await database.deleteById('default', tableName, record.id, user);
                deleted++;
            }
        }

        return {
            success: true,
            table: tableName,
            deleted: deleted,
            message: `${deleted} row(s) deleted`
        };
    }

    async executeCreate(sql, user) {
        const createMatch = sql.match(/CREATE\s+TABLE\s+([^\s(]+)/i);
        if (!createMatch) {
            return { error: 'Invalid CREATE TABLE syntax' };
        }

        const tableName = createMatch[1].trim();
        const result = await database.createTable('default', tableName, [], user);

        if (result.error) {
            return { error: result.error };
        }

        return {
            success: true,
            table: tableName,
            message: `Table '${tableName}' created`
        };
    }

    async executeDrop(sql, user) {
        const dropMatch = sql.match(/DROP\s+TABLE\s+([^\s;]+)/i);
        if (!dropMatch) {
            return { error: 'Invalid DROP TABLE syntax' };
        }

        const tableName = dropMatch[1].trim();
        const result = await database.deleteTable('default', tableName, user);

        if (result.error) {
            return { error: result.error };
        }

        return {
            success: true,
            table: tableName,
            message: `Table '${tableName}' dropped`
        };
    }

    async executeAlter(sql, user) {
        const alterMatch = sql.match(/ALTER\s+TABLE\s+([^\s]+)\s+(ADD|DROP|MODIFY)\s+(.+)/i);
        if (!alterMatch) {
            return { error: 'Invalid ALTER TABLE syntax' };
        }

        const tableName = alterMatch[1].trim();
        const action = alterMatch[2].toUpperCase();
        const columnDef = alterMatch[3].trim();

        if (action === 'ADD') {
            const columnMatch = columnDef.match(/([^\s]+)/);
            if (columnMatch) {
                const columnName = columnMatch[1];
                const result = await database.addColumn('default', tableName, columnName, user);
                if (result.error) return { error: result.error };
                return { success: true, table: tableName, action: 'ADD', column: columnName };
            }
        } else if (action === 'DROP') {
            const columnName = columnDef.trim();
            const result = await database.deleteColumn('default', tableName, columnName, user);
            if (result.error) return { error: result.error };
            return { success: true, table: tableName, action: 'DROP', column: columnName };
        }

        return { error: 'Unsupported ALTER operation' };
    }

    async executeTruncate(sql, user) {
        const truncateMatch = sql.match(/TRUNCATE\s+TABLE\s+([^\s;]+)/i);
        if (!truncateMatch) {
            return { error: 'Invalid TRUNCATE syntax' };
        }

        const tableName = truncateMatch[1].trim();
        const tableData = await database.getTable('default', tableName, user);

        if (tableData.error) {
            return { error: tableData.error };
        }

        let deleted = 0;
        const records = tableData.records || [];
        for (const record of records) {
            await database.deleteById('default', tableName, record.id, user);
            deleted++;
        }

        return {
            success: true,
            table: tableName,
            deleted: deleted,
            message: `Table '${tableName}' truncated (${deleted} rows deleted)`
        };
    }
}

module.exports = new SQLExecutor();
