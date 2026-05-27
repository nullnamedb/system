// NullName DB - Internet/Network Request Handler
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const zlib = require('zlib');

class InternetHandler {
    constructor() {
        this.downloadQueue = [];
        this.isDownloading = false;
        this.activeDownloads = 0;
        this.maxConcurrentDownloads = 5;
        this.downloadTimeout = 30000;
        this.maxFileSize = 100 * 1024 * 1024;
        this.tempDir = path.join(__dirname, 'database', 'temp');
        this.filesDir = path.join(__dirname, 'database', 'files');
        
        this.userAgent = 'NullName-DB/2.0 (https://nullname.com)';
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.tempDir);
        await fs.ensureDir(this.filesDir);
        
        setInterval(() => this.cleanupTempFiles(), 3600000);
        
        console.log('Internet handler initialized');
    }

    isValidUrl(urlString) {
        if (!urlString || typeof urlString !== 'string') {
            return false;
        }
        
        try {
            const parsed = new URL(urlString);
            const validProtocols = ['http:', 'https:', 'ftp:', 'ftps:'];
            return validProtocols.includes(parsed.protocol);
        } catch (error) {
            return false;
        }
    }

    isUrl(str) {
        return this.isValidUrl(str);
    }

    extractUrlFromString(str) {
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
        const matches = str.match(urlRegex);
        return matches ? matches[0] : null;
    }

    parseUrl(urlString) {
        try {
            return new URL(urlString);
        } catch (error) {
            return null;
        }
    }

    getFileExtensionFromUrl(urlString) {
        const parsed = this.parseUrl(urlString);
        if (!parsed) return '';
        
        const pathname = parsed.pathname;
        const ext = path.extname(pathname);
        return ext.toLowerCase();
    }

    getMimeTypeFromExtension(ext) {
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.ppt': 'application/vnd.ms-powerpoint',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.htm': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.zip': 'application/zip',
            '.tar': 'application/x-tar',
            '.gz': 'application/gzip',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.csv': 'text/csv',
            '.md': 'text/markdown'
        };
        
        return mimeTypes[ext] || 'application/octet-stream';
    }

    async downloadFile(urlString, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isValidUrl(urlString)) {
                reject(new Error('Invalid URL: ' + urlString));
                return;
            }

            const parsedUrl = this.parseUrl(urlString);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            const timeout = options.timeout || this.downloadTimeout;
            const maxSize = options.maxSize || this.maxFileSize;
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': options.userAgent || this.userAgent,
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                },
                timeout: timeout
            };
            
            if (options.headers) {
                Object.assign(requestOptions.headers, options.headers);
            }
            
            if (options.range) {
                requestOptions.headers.Range = `bytes=${options.range.start}-${options.range.end || ''}`;
            }
            
            const req = protocol.request(requestOptions, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        const maxRedirects = options.maxRedirects || 5;
                        if ((options.redirectCount || 0) >= maxRedirects) {
                            reject(new Error(`Too many redirects (${maxRedirects})`));
                            return;
                        }
                        this.downloadFile(redirectUrl, {
                            ...options,
                            redirectCount: (options.redirectCount || 0) + 1
                        }).then(resolve).catch(reject);
                        return;
                    }
                }
                
                if (res.statusCode !== 200 && res.statusCode !== 206) {
                    reject(new Error(`HTTP ${res.statusCode}: Failed to fetch ${urlString}`));
                    return;
                }
                
                const contentLength = parseInt(res.headers['content-length'], 10);
                if (contentLength > maxSize && !options.range) {
                    req.destroy();
                    reject(new Error(`File too large: ${contentLength} bytes (max ${maxSize} bytes)`));
                    return;
                }
                
                let chunks = [];
                let downloadedSize = 0;
                
                const handleChunk = (chunk) => {
                    chunks.push(chunk);
                    downloadedSize += chunk.length;
                    
                    if (downloadedSize > maxSize) {
                        req.destroy();
                        reject(new Error(`Download exceeded max size of ${maxSize} bytes`));
                    }
                    
                    if (options.onProgress) {
                        options.onProgress(downloadedSize, contentLength);
                    }
                };
                
                let stream = res;
                
                if (res.headers['content-encoding'] === 'gzip') {
                    stream = res.pipe(zlib.createGunzip());
                } else if (res.headers['content-encoding'] === 'deflate') {
                    stream = res.pipe(zlib.createInflate());
                } else if (res.headers['content-encoding'] === 'br') {
                    stream = res.pipe(zlib.createBrotliDecompress());
                }
                
                stream.on('data', handleChunk);
                
                stream.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    
                    let filename = options.filename || this.extractFilename(res, parsedUrl);
                    const contentType = res.headers['content-type'];
                    const extension = this.getExtensionFromContentType(contentType, filename);
                    
                    if (filename && !path.extname(filename)) {
                        filename += extension;
                    }
                    
                    resolve({
                        buffer: buffer,
                        size: buffer.length,
                        contentType: contentType,
                        contentLength: contentLength,
                        filename: filename,
                        headers: res.headers,
                        url: urlString,
                        statusCode: res.statusCode
                    });
                });
                
                stream.on('error', (err) => {
                    reject(new Error(`Stream error: ${err.message}`));
                });
            });
            
            req.on('error', (err) => {
                reject(new Error(`Request error: ${err.message}`));
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${timeout}ms`));
            });
            
            req.end();
        });
    }

    extractFilename(res, parsedUrl) {
        const disposition = res.headers['content-disposition'];
        if (disposition) {
            const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                let filename = filenameMatch[1].replace(/['"]/g, '');
                try {
                    filename = decodeURIComponent(filename);
                } catch (e) {}
                return this.sanitizeFilename(filename);
            }
        }
        
        const pathname = parsedUrl.pathname;
        if (pathname && pathname !== '/') {
            const basename = path.basename(pathname);
            if (basename && basename.length > 0) {
                try {
                    const decoded = decodeURIComponent(basename);
                    if (decoded && decoded !== '/') {
                        return this.sanitizeFilename(decoded);
                    }
                } catch (e) {}
            }
        }
        
        const hostname = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        return this.sanitizeFilename(`${hostname}_${Date.now()}.bin`);
    }

    sanitizeFilename(filename) {
        if (!filename) return `file_${Date.now()}.bin`;
        
        let clean = filename.replace(/\.\./g, '');
        clean = clean.replace(/[\\/]/g, '_');
        clean = clean.replace(/[<>:"|?*]/g, '_');
        clean = clean.replace(/[^a-zA-Z0-9_.-]/g, '_');
        
        if (clean.length > 200) {
            const ext = path.extname(clean);
            const name = clean.slice(0, 200 - ext.length);
            clean = name + ext;
        }
        
        if (clean === '' || clean === '.') {
            clean = `file_${Date.now()}.bin`;
        }
        
        return clean;
    }

    getExtensionFromContentType(contentType, filename) {
        if (filename && filename.includes('.')) {
            return path.extname(filename);
        }
        
        const mimeMap = {
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'image/bmp': '.bmp',
            'application/pdf': '.pdf',
            'text/plain': '.txt',
            'text/html': '.html',
            'text/css': '.css',
            'text/javascript': '.js',
            'application/javascript': '.js',
            'application/json': '.json',
            'application/xml': '.xml',
            'text/xml': '.xml',
            'application/zip': '.zip',
            'application/x-tar': '.tar',
            'application/gzip': '.gz',
            'application/x-gzip': '.gz',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg',
            'text/csv': '.csv',
            'text/markdown': '.md',
            'application/octet-stream': '.bin'
        };
        
        const mainType = contentType ? contentType.split(';')[0].toLowerCase() : '';
        return mimeMap[mainType] || '.bin';
    }

    async saveFile(buffer, filename, subdir = '') {
        const targetDir = subdir ? path.join(this.filesDir, subdir) : this.filesDir;
        await fs.ensureDir(targetDir);
        
        let finalFilename = this.sanitizeFilename(filename);
        let filePath = path.join(targetDir, finalFilename);
        
        let counter = 1;
        const ext = path.extname(finalFilename);
        const name = finalFilename.slice(0, -ext.length);
        
        while (await fs.pathExists(filePath)) {
            finalFilename = `${name}_${counter}${ext}`;
            filePath = path.join(targetDir, finalFilename);
            counter++;
        }
        
        await fs.writeFile(filePath, buffer);
        
        const stats = await fs.stat(filePath);
        
        return {
            success: true,
            filename: finalFilename,
            path: filePath,
            size: buffer.length,
            sizeMB: (buffer.length / (1024 * 1024)).toFixed(2),
            url: `/files/${subdir ? subdir + '/' : ''}${finalFilename}`,
            created: stats.birthtime,
            modified: stats.mtime
        };
    }

    async downloadAndSave(urlString, customFilename = null, subdir = '', options = {}) {
        try {
            if (!this.isValidUrl(urlString)) {
                return {
                    success: false,
                    error: 'Invalid URL: ' + urlString
                };
            }
            
            const downloadResult = await this.downloadFile(urlString, options);
            
            let filename = customFilename;
            if (!filename) {
                const ext = this.getExtensionFromContentType(
                    downloadResult.contentType,
                    downloadResult.filename
                );
                const hash = crypto.createHash('md5').update(urlString).digest('hex').substring(0, 8);
                filename = `${Date.now()}_${hash}${ext}`;
            } else {
                filename = this.sanitizeFilename(customFilename);
            }
            
            const saveResult = await this.saveFile(downloadResult.buffer, filename, subdir);
            
            return {
                success: true,
                filename: saveResult.filename,
                path: saveResult.path,
                url: saveResult.url,
                size: saveResult.size,
                sizeMB: saveResult.sizeMB,
                originalUrl: urlString,
                originalFilename: downloadResult.filename,
                contentType: downloadResult.contentType,
                downloadedAt: new Date().toISOString(),
                duration: downloadResult.duration
            };
            
        } catch (error) {
            console.error('Download failed:', error);
            return {
                success: false,
                error: error.message,
                url: urlString
            };
        }
    }

    async downloadMultiple(urls, options = {}) {
        const results = [];
        const concurrency = options.concurrency || 3;
        
        const downloadOne = async (url, index) => {
            const result = await this.downloadAndSave(url, null, options.subdir || '', options);
            results[index] = result;
            return result;
        };
        
        for (let i = 0; i < urls.length; i += concurrency) {
            const batch = urls.slice(i, i + concurrency);
            await Promise.all(batch.map((url, idx) => downloadOne(url, i + idx)));
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        return {
            success: true,
            total: urls.length,
            successful: successful,
            failed: failed,
            results: results
        };
    }

    async downloadStream(urlString, writeStream, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isValidUrl(urlString)) {
                reject(new Error('Invalid URL: ' + urlString));
                return;
            }

            const parsedUrl = this.parseUrl(urlString);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': '*/*'
                },
                timeout: options.timeout || this.downloadTimeout
            };
            
            const req = protocol.request(requestOptions, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        this.downloadStream(redirectUrl, writeStream, options)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }
                
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                
                let stream = res;
                if (res.headers['content-encoding'] === 'gzip') {
                    stream = res.pipe(zlib.createGunzip());
                } else if (res.headers['content-encoding'] === 'deflate') {
                    stream = res.pipe(zlib.createInflate());
                }
                
                stream.pipe(writeStream);
                
                writeStream.on('finish', () => {
                    resolve({
                        success: true,
                        url: urlString,
                        size: res.headers['content-length']
                    });
                });
                
                writeStream.on('error', reject);
                stream.on('error', reject);
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
    }

    async getFileInfo(filename, subdir = '') {
        const filePath = subdir ? path.join(this.filesDir, subdir, filename) : path.join(this.filesDir, filename);
        
        if (!await fs.pathExists(filePath)) {
            return null;
        }
        
        const stat = await fs.stat(filePath);
        const ext = path.extname(filename);
        
        return {
            success: true,
            filename: filename,
            path: filePath,
            size: stat.size,
            sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
            created: stat.birthtime,
            modified: stat.mtime,
            url: `/files/${subdir ? subdir + '/' : ''}${filename}`,
            extension: ext,
            mimeType: this.getMimeTypeFromExtension(ext)
        };
    }

    async deleteFile(filename, subdir = '') {
        const filePath = subdir ? path.join(this.filesDir, subdir, filename) : path.join(this.filesDir, filename);
        
        if (!await fs.pathExists(filePath)) {
            return { success: false, error: 'File not found' };
        }
        
        const stats = await fs.stat(filePath);
        await fs.remove(filePath);
        
        return {
            success: true,
            filename: filename,
            size: stats.size,
            deleted: true,
            deletedAt: new Date().toISOString()
        };
    }

    async listFiles(subdir = '') {
        const targetDir = subdir ? path.join(this.filesDir, subdir) : this.filesDir;
        
        if (!await fs.pathExists(targetDir)) {
            return [];
        }
        
        const files = await fs.readdir(targetDir);
        const results = [];
        
        for (const file of files) {
            const filePath = path.join(targetDir, file);
            const stat = await fs.stat(filePath);
            
            if (stat.isFile()) {
                const ext = path.extname(file);
                results.push({
                    filename: file,
                    size: stat.size,
                    sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
                    created: stat.birthtime,
                    modified: stat.mtime,
                    url: `/files/${subdir ? subdir + '/' : ''}${file}`,
                    extension: ext,
                    mimeType: this.getMimeTypeFromExtension(ext)
                });
            }
        }
        
        return results.sort((a, b) => b.modified - a.modified);
    }

    async cleanupTempFiles(maxAgeMs = 3600000) {
        if (!await fs.pathExists(this.tempDir)) {
            return { deleted: 0 };
        }
        
        const files = await fs.readdir(this.tempDir);
        let deleted = 0;
        const now = Date.now();
        
        for (const file of files) {
            const filePath = path.join(this.tempDir, file);
            const stat = await fs.stat(filePath);
            
            if (now - stat.mtimeMs > maxAgeMs) {
                await fs.remove(filePath);
                deleted++;
            }
        }
        
        return { deleted: deleted, timestamp: new Date().toISOString() };
    }

    async getRemoteFileSize(urlString) {
        return new Promise((resolve, reject) => {
            if (!this.isValidUrl(urlString)) {
                reject(new Error('Invalid URL'));
                return;
            }
            
            const parsedUrl = this.parseUrl(urlString);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'HEAD',
                headers: {
                    'User-Agent': this.userAgent
                }
            };
            
            const req = protocol.request(options, (res) => {
                const size = parseInt(res.headers['content-length'], 10);
                resolve(isNaN(size) ? null : size);
            });
            
            req.on('error', reject);
            req.end();
        });
    }

    async httpGet(urlString, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isValidUrl(urlString)) {
                reject(new Error('Invalid URL'));
                return;
            }
            
            const parsedUrl = this.parseUrl(urlString);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': this.userAgent,
                    ...options.headers
                },
                timeout: options.timeout || 10000
            };
            
            const req = protocol.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve({
                        success: true,
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data,
                        url: urlString
                    });
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
    }

    async httpPost(urlString, postData, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isValidUrl(urlString)) {
                reject(new Error('Invalid URL'));
                return;
            }
            
            const parsedUrl = this.parseUrl(urlString);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const dataString = typeof postData === 'string' ? postData : JSON.stringify(postData);
            const isJson = typeof postData === 'object';
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'User-Agent': this.userAgent,
                    'Content-Type': isJson ? 'application/json' : 'text/plain',
                    'Content-Length': Buffer.byteLength(dataString),
                    ...options.headers
                },
                timeout: options.timeout || 30000
            };
            
            const req = protocol.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    let parsedData = data;
                    if (isJson && data) {
                        try {
                            parsedData = JSON.parse(data);
                        } catch(e) {}
                    }
                    
                    resolve({
                        success: true,
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: parsedData,
                        url: urlString
                    });
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.write(dataString);
            req.end();
        });
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    generateUniqueFilename(originalName) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(originalName);
        const name = path.basename(originalName, ext);
        const cleanName = this.sanitizeFilename(name);
        return `${cleanName}_${timestamp}_${random}${ext}`;
    }

    getStats() {
        return {
            tempDir: this.tempDir,
            filesDir: this.filesDir,
            maxConcurrentDownloads: this.maxConcurrentDownloads,
            downloadTimeout: this.downloadTimeout,
            maxFileSize: this.formatBytes(this.maxFileSize),
            activeDownloads: this.activeDownloads,
            queueLength: this.downloadQueue.length
        };
    }
}

module.exports = new InternetHandler();
