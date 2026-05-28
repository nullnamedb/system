// NullName DB - NoSQL Document Database Engine
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class NoSQLEngine {
    constructor() {
        this.dataPath = path.join(__dirname, '..', 'database', 'nosql');
        this.indexPath = path.join(this.dataPath, '_indexes.json');
        this.cache = new Map();
        this.cacheTimeout = 60000;
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.dataPath);
        await this.ensureIndexFile();
        this.startCacheCleanup();
        console.log('NoSQL engine initialized');
    }

    async ensureIndexFile() {
        if (!await fs.pathExists(this.indexPath)) {
            await fs.writeJson(this.indexPath, {}, { spaces: 2 });
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

    clearCache(collection = null) {
        if (collection) {
            for (const key of this.cache.keys()) {
                if (key.startsWith(collection)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }

    getCollectionPath(collectionName) {
        return path.join(this.dataPath, `${collectionName}.json`);
    }

    async loadCollection(collectionName) {
        const cacheKey = `collection:${collectionName}`;
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        const collectionPath = this.getCollectionPath(collectionName);
        if (!await fs.pathExists(collectionPath)) {
            return { _id: null, documents: [], indexes: {} };
        }

        const data = await fs.readJson(collectionPath);
        this.setCache(cacheKey, data);
        return data;
    }

    async saveCollection(collectionName, data) {
        const collectionPath = this.getCollectionPath(collectionName);
        await fs.writeJson(collectionPath, data, { spaces: 2 });
        this.clearCache(collectionName);
        return true;
    }

    generateId() {
        return crypto.randomBytes(12).toString('hex');
    }

    async createCollection(collectionName, user = null) {
        const collectionPath = this.getCollectionPath(collectionName);
        
        if (await fs.pathExists(collectionPath)) {
            return { error: `Collection '${collectionName}' already exists` };
        }

        const collection = {
            _id: null,
            documents: [],
            indexes: {},
            metadata: {
                name: collectionName,
                created: new Date().toISOString(),
                createdBy: user?.username || 'system',
                documentCount: 0
            }
        };

        await this.saveCollection(collectionName, collection);
        
        return {
            success: true,
            collection: collectionName,
            created: collection.metadata.created,
            message: `Collection '${collectionName}' created`
        };
    }

    async dropCollection(collectionName, user = null) {
        const collectionPath = this.getCollectionPath(collectionName);
        
        if (!await fs.pathExists(collectionPath)) {
            return { error: `Collection '${collectionName}' not found` };
        }

        const collection = await this.loadCollection(collectionName);
        await fs.remove(collectionPath);
        this.clearCache(collectionName);

        return {
            success: true,
            collection: collectionName,
            documentCount: collection.documents.length,
            message: `Collection '${collectionName}' dropped`
        };
    }

    async listCollections() {
        const files = await fs.readdir(this.dataPath);
        const collections = [];
        
        for (const file of files) {
            if (file.endsWith('.json') && !file.startsWith('_')) {
                const collectionName = file.replace('.json', '');
                const collection = await this.loadCollection(collectionName);
                collections.push({
                    name: collectionName,
                    documentCount: collection.documents.length,
                    created: collection.metadata.created
                });
            }
        }
        
        return collections;
    }

    evaluateCondition(doc, condition) {
        for (const [key, value] of Object.entries(condition)) {
            if (key === '$or') {
                return value.some(subCond => this.evaluateCondition(doc, subCond));
            }
            if (key === '$and') {
                return value.every(subCond => this.evaluateCondition(doc, subCond));
            }
            if (key === '$not') {
                return !this.evaluateCondition(doc, value);
            }
            
            const docValue = this.getNestedValue(doc, key);
            
            if (typeof value === 'object' && value !== null) {
                for (const [op, opValue] of Object.entries(value)) {
                    switch (op) {
                        case '$eq':
                            if (docValue != opValue) return false;
                            break;
                        case '$ne':
                            if (docValue == opValue) return false;
                            break;
                        case '$gt':
                            if (!(docValue > opValue)) return false;
                            break;
                        case '$gte':
                            if (!(docValue >= opValue)) return false;
                            break;
                        case '$lt':
                            if (!(docValue < opValue)) return false;
                            break;
                        case '$lte':
                            if (!(docValue <= opValue)) return false;
                            break;
                        case '$in':
                            if (!opValue.includes(docValue)) return false;
                            break;
                        case '$nin':
                            if (opValue.includes(docValue)) return false;
                            break;
                        case '$exists':
                            if (opValue ? (docValue === undefined) : (docValue !== undefined)) return false;
                            break;
                        case '$regex':
                            if (!new RegExp(opValue, 'i').test(String(docValue))) return false;
                            break;
                        case '$type':
                            if (typeof docValue !== opValue) return false;
                            break;
                        default:
                            if (docValue != value) return false;
                    }
                }
            } else {
                if (docValue != value) return false;
            }
        }
        return true;
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((current, part) => current?.[part], obj);
    }

    setNestedValue(obj, path, value) {
        const parts = path.split('.');
        const last = parts.pop();
        const target = parts.reduce((current, part) => {
            if (!current[part]) current[part] = {};
            return current[part];
        }, obj);
        target[last] = value;
    }

    async insert(collectionName, document, user = null) {
        const collection = await this.loadCollection(collectionName);
        
        if (!document._id) {
            document._id = this.generateId();
        }
        
        if (collection.documents.some(doc => doc._id === document._id)) {
            return { error: `Document with _id '${document._id}' already exists` };
        }
        
        const newDocument = {
            ...document,
            _created: new Date().toISOString(),
            _createdBy: user?.username || 'system',
            _updated: new Date().toISOString(),
            _updatedBy: user?.username || 'system'
        };
        
        collection.documents.push(newDocument);
        collection.metadata.documentCount = collection.documents.length;
        
        await this.saveCollection(collectionName, collection);
        
        return {
            success: true,
            collection: collectionName,
            document: newDocument,
            _id: document._id,
            message: 'Document inserted'
        };
    }

    async insertMany(collectionName, documents, user = null) {
        const results = [];
        for (const doc of documents) {
            const result = await this.insert(collectionName, doc, user);
            results.push(result);
        }
        
        return {
            success: true,
            collection: collectionName,
            insertedCount: results.filter(r => r.success).length,
            results: results
        };
    }

    async find(collectionName, filter = {}, options = {}) {
        const collection = await this.loadCollection(collectionName);
        
        let results = collection.documents;
        
        if (filter && Object.keys(filter).length > 0) {
            results = results.filter(doc => this.evaluateCondition(doc, filter));
        }
        
        if (options.sort) {
            const [field, order] = Object.entries(options.sort)[0];
            results.sort((a, b) => {
                const aVal = this.getNestedValue(a, field);
                const bVal = this.getNestedValue(b, field);
                if (order === -1) {
                    return aVal < bVal ? 1 : -1;
                }
                return aVal < bVal ? -1 : 1;
            });
        }
        
        if (options.skip) {
            results = results.slice(options.skip);
        }
        
        if (options.limit) {
            results = results.slice(0, options.limit);
        }
        
        if (options.projection) {
            results = results.map(doc => {
                const projected = {};
                for (const field of options.projection) {
                    projected[field] = doc[field];
                }
                return projected;
            });
        }
        
        return {
            success: true,
            collection: collectionName,
            documents: results,
            count: results.length,
            total: collection.documents.length
        };
    }

    async findOne(collectionName, filter = {}) {
        const result = await this.find(collectionName, filter, { limit: 1 });
        return {
            success: true,
            collection: collectionName,
            document: result.documents[0] || null
        };
    }

    async findById(collectionName, id) {
        return await this.findOne(collectionName, { _id: id });
    }

    async update(collectionName, filter, update, user = null) {
        const collection = await this.loadCollection(collectionName);
        
        let matched = 0;
        let modified = 0;
        
        for (const doc of collection.documents) {
            if (this.evaluateCondition(doc, filter)) {
                matched++;
                
                const oldDoc = { ...doc };
                
                if (update.$set) {
                    for (const [field, value] of Object.entries(update.$set)) {
                        this.setNestedValue(doc, field, value);
                    }
                }
                
                if (update.$unset) {
                    for (const field of Object.keys(update.$unset)) {
                        const parts = field.split('.');
                        const last = parts.pop();
                        const target = parts.reduce((current, part) => current?.[part], doc);
                        if (target) delete target[last];
                    }
                }
                
                if (update.$inc) {
                    for (const [field, incValue] of Object.entries(update.$inc)) {
                        const current = this.getNestedValue(doc, field) || 0;
                        this.setNestedValue(doc, field, current + incValue);
                    }
                }
                
                if (update.$push) {
                    for (const [field, pushValue] of Object.entries(update.$push)) {
                        const array = this.getNestedValue(doc, field) || [];
                        array.push(pushValue);
                        this.setNestedValue(doc, field, array);
                    }
                }
                
                if (update.$pull) {
                    for (const [field, pullValue] of Object.entries(update.$pull)) {
                        const array = this.getNestedValue(doc, field) || [];
                        const newArray = array.filter(item => item !== pullValue);
                        this.setNestedValue(doc, field, newArray);
                    }
                }
                
                doc._updated = new Date().toISOString();
                doc._updatedBy = user?.username || 'system';
                
                if (JSON.stringify(oldDoc) !== JSON.stringify(doc)) {
                    modified++;
                }
            }
        }
        
        if (modified > 0) {
            await this.saveCollection(collectionName, collection);
        }
        
        return {
            success: true,
            collection: collectionName,
            matched: matched,
            modified: modified,
            message: `${matched} document(s) matched, ${modified} modified`
        };
    }

    async updateOne(collectionName, filter, update, user = null) {
        const collection = await this.loadCollection(collectionName);
        
        for (const doc of collection.documents) {
            if (this.evaluateCondition(doc, filter)) {
                const oldDoc = { ...doc };
                
                if (update.$set) {
                    for (const [field, value] of Object.entries(update.$set)) {
                        this.setNestedValue(doc, field, value);
                    }
                }
                
                doc._updated = new Date().toISOString();
                doc._updatedBy = user?.username || 'system';
                
                await this.saveCollection(collectionName, collection);
                
                return {
                    success: true,
                    collection: collectionName,
                    matched: 1,
                    modified: JSON.stringify(oldDoc) !== JSON.stringify(doc) ? 1 : 0,
                    document: doc
                };
            }
        }
        
        return {
            success: true,
            collection: collectionName,
            matched: 0,
            modified: 0,
            message: 'No document matched'
        };
    }

    async updateById(collectionName, id, update, user = null) {
        return await this.updateOne(collectionName, { _id: id }, update, user);
    }

    async delete(collectionName, filter, user = null) {
        const collection = await this.loadCollection(collectionName);
        
        const initialLength = collection.documents.length;
        collection.documents = collection.documents.filter(doc => !this.evaluateCondition(doc, filter));
        const deleted = initialLength - collection.documents.length;
        
        collection.metadata.documentCount = collection.documents.length;
        
        await this.saveCollection(collectionName, collection);
        
        return {
            success: true,
            collection: collectionName,
            deleted: deleted,
            message: `${deleted} document(s) deleted`
        };
    }

    async deleteOne(collectionName, filter, user = null) {
        const collection = await this.loadCollection(collectionName);
        
        let index = -1;
        for (let i = 0; i < collection.documents.length; i++) {
            if (this.evaluateCondition(collection.documents[i], filter)) {
                index = i;
                break;
            }
        }
        
        if (index !== -1) {
            const deletedDoc = collection.documents[index];
            collection.documents.splice(index, 1);
            collection.metadata.documentCount = collection.documents.length;
            await this.saveCollection(collectionName, collection);
            
            return {
                success: true,
                collection: collectionName,
                deleted: 1,
                document: deletedDoc
            };
        }
        
        return {
            success: true,
            collection: collectionName,
            deleted: 0,
            message: 'No document matched'
        };
    }

    async deleteById(collectionName, id, user = null) {
        return await this.deleteOne(collectionName, { _id: id }, user);
    }

    async count(collectionName, filter = {}) {
        const collection = await this.loadCollection(collectionName);
        
        if (filter && Object.keys(filter).length > 0) {
            const filtered = collection.documents.filter(doc => this.evaluateCondition(doc, filter));
            return {
                success: true,
                collection: collectionName,
                count: filtered.length
            };
        }
        
        return {
            success: true,
            collection: collectionName,
            count: collection.documents.length
        };
    }

    async createIndex(collectionName, field, options = {}) {
        const collection = await this.loadCollection(collectionName);
        const indexName = options.name || `${field}_index`;
        
        if (collection.indexes[indexName]) {
            return { error: `Index '${indexName}' already exists` };
        }
        
        const index = {
            name: indexName,
            field: field,
            unique: options.unique || false,
            sparse: options.sparse || false,
            created: new Date().toISOString()
        };
        
        collection.indexes[indexName] = index;
        await this.saveCollection(collectionName, collection);
        
        return {
            success: true,
            collection: collectionName,
            index: indexName,
            field: field,
            message: `Index '${indexName}' created on '${field}'`
        };
    }

    async dropIndex(collectionName, indexName) {
        const collection = await this.loadCollection(collectionName);
        
        if (!collection.indexes[indexName]) {
            return { error: `Index '${indexName}' not found` };
        }
        
        delete collection.indexes[indexName];
        await this.saveCollection(collectionName, collection);
        
        return {
            success: true,
            collection: collectionName,
            index: indexName,
            message: `Index '${indexName}' dropped`
        };
    }

    async listIndexes(collectionName) {
        const collection = await this.loadCollection(collectionName);
        
        return {
            success: true,
            collection: collectionName,
            indexes: Object.values(collection.indexes)
        };
    }

    async aggregate(collectionName, pipeline) {
        let results = await this.loadCollection(collectionName);
        let data = [...results.documents];
        
        for (const stage of pipeline) {
            if (stage.$match) {
                data = data.filter(doc => this.evaluateCondition(doc, stage.$match));
            }
            else if (stage.$group) {
                const groups = {};
                for (const doc of data) {
                    const groupKey = this.getNestedValue(doc, stage.$group._id);
                    if (!groups[groupKey]) {
                        groups[groupKey] = { _id: groupKey };
                    }
                    for (const [key, value] of Object.entries(stage.$group)) {
                        if (key === '_id') continue;
                        if (value.$sum) {
                            groups[groupKey][key] = (groups[groupKey][key] || 0) + (this.getNestedValue(doc, value.$sum) || 0);
                        }
                        if (value.$avg) {
                            groups[groupKey][`${key}_sum`] = (groups[groupKey][`${key}_sum`] || 0) + (this.getNestedValue(doc, value.$avg) || 0);
                            groups[groupKey][`${key}_count`] = (groups[groupKey][`${key}_count`] || 0) + 1;
                            groups[groupKey][key] = groups[groupKey][`${key}_sum`] / groups[groupKey][`${key}_count`];
                        }
                        if (value.$first) {
                            if (!groups[groupKey][key]) {
                                groups[groupKey][key] = this.getNestedValue(doc, value.$first);
                            }
                        }
                        if (value.$last) {
                            groups[groupKey][key] = this.getNestedValue(doc, value.$last);
                        }
                        if (value.$push) {
                            if (!groups[groupKey][key]) groups[groupKey][key] = [];
                            groups[groupKey][key].push(this.getNestedValue(doc, value.$push));
                        }
                    }
                }
                data = Object.values(groups);
            }
            else if (stage.$sort) {
                const [field, order] = Object.entries(stage.$sort)[0];
                data.sort((a, b) => {
                    const aVal = this.getNestedValue(a, field);
                    const bVal = this.getNestedValue(b, field);
                    if (order === -1) {
                        return aVal < bVal ? 1 : -1;
                    }
                    return aVal < bVal ? -1 : 1;
                });
            }
            else if (stage.$limit) {
                data = data.slice(0, stage.$limit);
            }
            else if (stage.$skip) {
                data = data.slice(stage.$skip);
            }
            else if (stage.$project) {
                data = data.map(doc => {
                    const projected = {};
                    for (const [field, include] of Object.entries(stage.$project)) {
                        if (include === 1) {
                            projected[field] = doc[field];
                        }
                    }
                    return projected;
                });
            }
        }
        
        return {
            success: true,
            collection: collectionName,
            results: data,
            count: data.length
        };
    }

    async getStats() {
        const collections = await this.listCollections();
        let totalDocuments = 0;
        let totalSize = 0;
        
        for (const collection of collections) {
            totalDocuments += collection.documentCount;
            const collectionPath = this.getCollectionPath(collection.name);
            const stat = await fs.stat(collectionPath);
            totalSize += stat.size;
        }
        
        return {
            collections: collections.length,
            totalDocuments: totalDocuments,
            totalSizeBytes: totalSize,
            totalSizeKB: (totalSize / 1024).toFixed(2),
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
            collections: collections
        };
    }
}

module.exports = new NoSQLEngine();
