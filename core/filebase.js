// NullName DB - FileBase Database Engine
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');

class FileBaseEngine {
    constructor() {
        this.filesPath = path.join(__dirname, '..', 'database', 'filebase', 'files');
        this.metadataPath = path.join(__dirname, '..', 'database', 'filebase', 'metadata.json');
        this.thumbnailsPath = path.join(__dirname, '..', 'database', 'filebase', 'thumbnails');
        this.chunksPath = path.join(__dirname, '..', 'database', 'filebase', 'chunks');
        this.recyclePath = path.join(__dirname, '..', 'database', 'filebase', 'recycle');
        
        this.metadata = {
            files: {},
            totalSize: 0,
            totalFiles: 0,
            lastId: 0
        };
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.filesPath);
        await fs.ensureDir(this.thumbnailsPath);
        await fs.ensureDir(this.chunksPath);
        await fs.ensureDir(this.recyclePath);
        await this.loadMetadata();
        console.log('FileBase engine initialized');
    }

    async loadMetadata() {
        try {
            if (await fs.pathExists(this.metadataPath)) {
                this.metadata = await fs.readJson(this.metadataPath);
            }
        } catch (error) {
            console.error('Failed to load metadata:', error);
        }
    }

    async saveMetadata() {
        try {
            await fs.writeJson(this.metadataPath, this.metadata, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save metadata:', error);
        }
    }

    generateFileId() {
        this.metadata.lastId++;
        return this.metadata.lastId;
    }

    getFileExtension(filename) {
        return path.extname(filename).toLowerCase();
    }

    getFileType(extension) {
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
        const videoExts = ['.mp4', '.webm', '.avi', '.mov', '.mkv'];
        const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
        const documentExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md'];
        const archiveExts = ['.zip', '.tar', '.gz', '.7z', '.rar'];
        
        if (imageExts.includes(extension)) return 'image';
        if (videoExts.includes(extension)) return 'video';
        if (audioExts.includes(extension)) return 'audio';
        if (documentExts.includes(extension)) return 'document';
        if (archiveExts.includes(extension)) return 'archive';
        return 'other';
    }

    getMimeType(filename) {
        return mime.lookup(filename) || 'application/octet-stream';
    }

    async generateThumbnail(filePath, fileId, extension) {
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        if (!imageExts.includes(extension)) return null;
        
        try {
            const sharp = require('sharp');
            const thumbnailPath = path.join(this.thumbnailsPath, `${fileId}.jpg`);
            await sharp(filePath).resize(200, 200, { fit: 'inside' }).toFile(thumbnailPath);
            return `/filebase/thumbnails/${fileId}.jpg`;
        } catch (error) {
            return null;
        }
    }

    async uploadFromLocal(filePath, originalName, description = '', tags = '', user = null) {
        const stats = await fs.stat(filePath);
        const extension = this.getFileExtension(originalName);
        const fileType = this.getFileType(extension);
        const fileId = this.generateFileId();
        const storedName = `${fileId}_${Date.now()}${extension}`;
        const storedPath = path.join(this.filesPath, storedName);
        
        await fs.copy(filePath, storedPath);
        
        const thumbnailUrl = await this.generateThumbnail(storedPath, fileId, extension);
        
        const fileMetadata = {
            id: fileId,
            originalName: originalName,
            storedName: storedName,
            size: stats.size,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
            mimeType: this.getMimeType(originalName),
            extension: extension,
            type: fileType,
            description: description,
            tags: tags ? tags.split(',').map(t => t.trim()) : [],
            uploadedAt: new Date().toISOString(),
            uploadedBy: user?.username || 'system',
            downloads: 0,
            views: 0,
            thumbnail: thumbnailUrl,
            url: `/filebase/files/${storedName}`,
            metadata: {}
        };
        
        this.metadata.files[fileId] = fileMetadata;
        this.metadata.totalSize += stats.size;
        this.metadata.totalFiles++;
        
        await this.saveMetadata();
        
        // Also store in SQL table (3 columns: file_name, file_link, description)
        const database = require('./database');
        await database.add('filebase', 'files', 'file_name', originalName, { username: 'system' });
        await database.add('filebase', 'files', 'file_link', fileMetadata.url, { username: 'system' });
        await database.add('filebase', 'files', 'description', description || null, { username: 'system' });
        
        // Also store in NoSQL
        const nosql = require('./nosql');
        await nosql.insert('filebase_files', fileMetadata, user);
        
        return {
            success: true,
            file: fileMetadata,
            message: 'File uploaded successfully'
        };
    }

    async uploadFromUrl(url, description = '', tags = '', user = null) {
        const internet = require('../internet');
        const result = await internet.downloadAndSave(url);
        
        if (!result.success) {
            return { error: result.error };
        }
        
        return await this.uploadFromLocal(result.path, result.filename, description, tags, user);
    }

    async uploadFromBase64(base64Data, filename, description = '', tags = '', user = null) {
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let data = base64Data;
        
        if (matches) {
            data = matches[2];
        }
        
        const buffer = Buffer.from(data, 'base64');
        const tempPath = path.join(this.filesPath, `temp_${Date.now()}.tmp`);
        await fs.writeFile(tempPath, buffer);
        
        const result = await this.uploadFromLocal(tempPath, filename, description, tags, user);
        await fs.remove(tempPath);
        
        return result;
    }

    async getFile(fileId) {
        const fileMetadata = this.metadata.files[fileId];
        if (!fileMetadata) {
            return { error: 'File not found' };
        }
        
        fileMetadata.views++;
        await this.saveMetadata();
        
        const filePath = path.join(this.filesPath, fileMetadata.storedName);
        
        if (!await fs.pathExists(filePath)) {
            return { error: 'File data not found' };
        }
        
        return {
            success: true,
            file: fileMetadata,
            buffer: await fs.readFile(filePath),
            stream: fs.createReadStream(filePath)
        };
    }

    async getFileByOriginalName(originalName) {
        for (const file of Object.values(this.metadata.files)) {
            if (file.originalName === originalName) {
                return await this.getFile(file.id);
            }
        }
        return { error: 'File not found' };
    }

    async getFileInfo(fileId) {
        const fileMetadata = this.metadata.files[fileId];
        if (!fileMetadata) {
            return { error: 'File not found' };
        }
        
        return {
            success: true,
            file: fileMetadata
        };
    }

    async listFiles(options = {}) {
        let files = Object.values(this.metadata.files);
        
        if (options.type) {
            files = files.filter(f => f.type === options.type);
        }
        
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            files = files.filter(f => 
                f.originalName.toLowerCase().includes(searchLower) ||
                f.description.toLowerCase().includes(searchLower) ||
                f.tags.some(tag => tag.toLowerCase().includes(searchLower))
            );
        }
        
        if (options.user) {
            files = files.filter(f => f.uploadedBy === options.user);
        }
        
        if (options.fromDate) {
            const fromDate = new Date(options.fromDate);
            files = files.filter(f => new Date(f.uploadedAt) >= fromDate);
        }
        
        if (options.toDate) {
            const toDate = new Date(options.toDate);
            files = files.filter(f => new Date(f.uploadedAt) <= toDate);
        }
        
        files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        
        if (options.limit) {
            files = files.slice(0, options.limit);
        }
        
        return {
            success: true,
            files: files,
            count: files.length,
            total: this.metadata.totalFiles,
            totalSizeMB: (this.metadata.totalSize / (1024 * 1024)).toFixed(2)
        };
    }

    async searchFiles(query) {
        return await this.listFiles({ search: query });
    }

    async updateFileMetadata(fileId, updates, user = null) {
        const fileMetadata = this.metadata.files[fileId];
        if (!fileMetadata) {
            return { error: 'File not found' };
        }
        
        if (updates.description !== undefined) {
            fileMetadata.description = updates.description;
            // Update SQL table
            const database = require('./database');
            const files = await database.getTable('filebase', 'files');
            for (const [id, record] of Object.entries(files)) {
                if (record.file_name === fileMetadata.originalName) {
                    await database.update('filebase', 'files', parseInt(id), 'description', updates.description, { username: 'system' });
                    break;
                }
            }
        }
        
        if (updates.tags !== undefined) {
            fileMetadata.tags = updates.tags.split(',').map(t => t.trim());
        }
        
        if (updates.metadata !== undefined) {
            fileMetadata.metadata = { ...fileMetadata.metadata, ...updates.metadata };
        }
        
        fileMetadata.updatedAt = new Date().toISOString();
        fileMetadata.updatedBy = user?.username || 'system';
        
        await this.saveMetadata();
        
        // Update NoSQL
        const nosql = require('./nosql');
        await nosql.updateOne('filebase_files', { _id: fileId }, { $set: updates }, user);
        
        return {
            success: true,
            file: fileMetadata,
            message: 'Metadata updated'
        };
    }

    async deleteFile(fileId, permanent = false, user = null) {
        const fileMetadata = this.metadata.files[fileId];
        if (!fileMetadata) {
            return { error: 'File not found' };
        }
        
        const filePath = path.join(this.filesPath, fileMetadata.storedName);
        
        if (permanent) {
            if (await fs.pathExists(filePath)) {
                await fs.remove(filePath);
            }
            
            if (fileMetadata.thumbnail) {
                const thumbnailPath = path.join(this.thumbnailsPath, `${fileId}.jpg`);
                if (await fs.pathExists(thumbnailPath)) {
                    await fs.remove(thumbnailPath);
                }
            }
            
            delete this.metadata.files[fileId];
            this.metadata.totalSize -= fileMetadata.size;
            this.metadata.totalFiles--;
            
            // Delete from SQL
            const database = require('./database');
            const files = await database.getTable('filebase', 'files');
            for (const [id, record] of Object.entries(files)) {
                if (record.file_name === fileMetadata.originalName) {
                    await database.deleteById('filebase', 'files', parseInt(id), { username: 'system' });
                    break;
                }
            }
            
            // Delete from NoSQL
            const nosql = require('./nosql');
            await nosql.deleteOne('filebase_files', { _id: fileId }, user);
            
            await this.saveMetadata();
            
            return {
                success: true,
                fileId: fileId,
                message: 'File permanently deleted'
            };
        } else {
            const recyclePath = path.join(this.recyclePath, fileMetadata.storedName);
            if (await fs.pathExists(filePath)) {
                await fs.move(filePath, recyclePath);
            }
            
            fileMetadata.deletedAt = new Date().toISOString();
            fileMetadata.deletedBy = user?.username || 'system';
            fileMetadata.deleted = true;
            
            await this.saveMetadata();
            
            return {
                success: true,
                fileId: fileId,
                message: 'File moved to recycle bin'
            };
        }
    }

    async restoreFile(fileId, user = null) {
        const fileMetadata = this.metadata.files[fileId];
        if (!fileMetadata) {
            return { error: 'File not found' };
        }
        
        const recyclePath = path.join(this.recyclePath, fileMetadata.storedName);
        const filePath = path.join(this.filesPath, fileMetadata.storedName);
        
        if (await fs.pathExists(recyclePath)) {
            await fs.move(recyclePath, filePath);
        }
        
        delete fileMetadata.deletedAt;
        delete fileMetadata.deletedBy;
        delete fileMetadata.deleted;
        
        fileMetadata.restoredAt = new Date().toISOString();
        fileMetadata.restoredBy = user?.username || 'system';
        
        await this.saveMetadata();
        
        return {
            success: true,
            fileId: fileId,
            message: 'File restored from recycle bin'
        };
    }

    async listDeletedFiles() {
        const deletedFiles = Object.values(this.metadata.files).filter(f => f.deleted);
        
        return {
            success: true,
            files: deletedFiles,
            count: deletedFiles.length
        };
    }

    async emptyRecycleBin(user = null) {
        const recycleFiles = await fs.readdir(this.recyclePath);
        let deletedCount = 0;
        
        for (const file of recycleFiles) {
            await fs.remove(path.join(this.recyclePath, file));
            deletedCount++;
        }
        
        for (const [id, file] of Object.entries(this.metadata.files)) {
            if (file.deleted) {
                delete this.metadata.files[id];
                this.metadata.totalSize -= file.size;
                this.metadata.totalFiles--;
                deletedCount++;
            }
        }
        
        await this.saveMetadata();
        
        return {
            success: true,
            deletedCount: deletedCount,
            message: 'Recycle bin emptied'
        };
    }

    async getDownloadUrl(fileId, expiresIn = 3600) {
        const fileMetadata = this.metadata.files[fileId];
        if (!fileMetadata) {
            return { error: 'File not found' };
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + (expiresIn * 1000);
        
        const downloadToken = {
            fileId: fileId,
            token: token,
            expires: expires
        };
        
        const tokensPath = path.join(__dirname, '..', 'database', 'download_tokens.json');
        let tokens = {};
        if (await fs.pathExists(tokensPath)) {
            tokens = await fs.readJson(tokensPath);
        }
        tokens[token] = downloadToken;
        await fs.writeJson(tokensPath, tokens, { spaces: 2 });
        
        fileMetadata.downloads++;
        await this.saveMetadata();
        
        return {
            success: true,
            url: `/filebase/download/${token}`,
            expires: new Date(expires).toISOString(),
            message: 'Download URL generated'
        };
    }

    async downloadByToken(token) {
        const tokensPath = path.join(__dirname, '..', 'database', 'download_tokens.json');
        if (!await fs.pathExists(tokensPath)) {
            return { error: 'Invalid download token' };
        }
        
        const tokens = await fs.readJson(tokensPath);
        const tokenData = tokens[token];
        
        if (!tokenData) {
            return { error: 'Invalid download token' };
        }
        
        if (tokenData.expires < Date.now()) {
            delete tokens[token];
            await fs.writeJson(tokensPath, tokens, { spaces: 2 });
            return { error: 'Download token expired' };
        }
        
        return await this.getFile(tokenData.fileId);
    }

    async shareFile(fileId, expiresIn = 86400, password = null) {
        const shareId = crypto.randomBytes(16).toString('hex');
        const expires = Date.now() + (expiresIn * 1000);
        
        const shareData = {
            fileId: fileId,
            shareId: shareId,
            expires: expires,
            password: password ? crypto.createHash('sha256').update(password).digest('hex') : null,
            createdAt: Date.now()
        };
        
        const sharesPath = path.join(__dirname, '..', 'database', 'filebase_shares.json');
        let shares = {};
        if (await fs.pathExists(sharesPath)) {
            shares = await fs.readJson(sharesPath);
        }
        shares[shareId] = shareData;
        await fs.writeJson(sharesPath, shares, { spaces: 2 });
        
        return {
            success: true,
            shareUrl: `/filebase/share/${shareId}`,
            expires: new Date(expires).toISOString(),
            message: 'Share link created'
        };
    }

    async getSharedFile(shareId, password = null) {
        const sharesPath = path.join(__dirname, '..', 'database', 'filebase_shares.json');
        if (!await fs.pathExists(sharesPath)) {
            return { error: 'Invalid share link' };
        }
        
        const shares = await fs.readJson(sharesPath);
        const shareData = shares[shareId];
        
        if (!shareData) {
            return { error: 'Invalid share link' };
        }
        
        if (shareData.expires < Date.now()) {
            delete shares[shareId];
            await fs.writeJson(sharesPath, shares, { spaces: 2 });
            return { error: 'Share link expired' };
        }
        
        if (shareData.password) {
            if (!password) {
                return { error: 'Password required', requiresPassword: true };
            }
            const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
            if (hashedPassword !== shareData.password) {
                return { error: 'Incorrect password' };
            }
        }
        
        return await this.getFile(shareData.fileId);
    }

    async getStats() {
        const byType = {
            image: 0,
            video: 0,
            audio: 0,
            document: 0,
            archive: 0,
            other: 0
        };
        
        let totalSizeByType = {
            image: 0,
            video: 0,
            audio: 0,
            document: 0,
            archive: 0,
            other: 0
        };
        
        for (const file of Object.values(this.metadata.files)) {
            if (!file.deleted) {
                byType[file.type]++;
                totalSizeByType[file.type] += file.size;
            }
        }
        
        return {
            totalFiles: this.metadata.totalFiles,
            totalSizeBytes: this.metadata.totalSize,
            totalSizeKB: (this.metadata.totalSize / 1024).toFixed(2),
            totalSizeMB: (this.metadata.totalSize / (1024 * 1024)).toFixed(2),
            totalSizeGB: (this.metadata.totalSize / (1024 * 1024 * 1024)).toFixed(2),
            byType: byType,
            sizeByTypeMB: {
                image: (totalSizeByType.image / (1024 * 1024)).toFixed(2),
                video: (totalSizeByType.video / (1024 * 1024)).toFixed(2),
                audio: (totalSizeByType.audio / (1024 * 1024)).toFixed(2),
                document: (totalSizeByType.document / (1024 * 1024)).toFixed(2),
                archive: (totalSizeByType.archive / (1024 * 1024)).toFixed(2),
                other: (totalSizeByType.other / (1024 * 1024)).toFixed(2)
            },
            mostDownloaded: Object.values(this.metadata.files)
                .sort((a, b) => b.downloads - a.downloads)
                .slice(0, 5)
                .map(f => ({ name: f.originalName, downloads: f.downloads, sizeMB: f.sizeMB }))
        };
    }
}

module.exports = new FileBaseEngine();
