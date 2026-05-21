// NullName DB - Internet/Network Request Handler
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 550+

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { promisify } = require('util');
const zlib = require('zlib');

const pipelineAsync = promisify(pipeline);

// ============================================
// INTERNET HANDLER CLASS
// ============================================

class InternetHandler {
    constructor() {
        this.downloadQueue = [];
        this.isDownloading = false;
        this.maxConcurrentDownloads = 3;
        this.activeDownloads = 0;
        this.downloadTimeout = 30000;
        this.maxFileSize = 50 * 1024 * 1024; // 50MB
        this.tempDir = path.join(__dirname, 'database', 'temp');
        this.filesDir = path.join(__dirname, 'database', 'files');
        
        // Ensure directories exist
        fs.ensureDirSync(this.tempDir);
        fs.ensureDirSync(this.filesDir);
        
        // Start queue processor
        this.processQueue();
    }

    // ============================================
    // URL VALIDATION & PARSING
    // ============================================

    isValidUrl(urlString) {
        if (!urlString || typeof urlString !== 'string') {
            return false;
        }
        
        try {
            const parsed = new URL(urlString);
            const validProtocols = ['http:', 'https:'];
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

    // ============================================
    // FILE DOWNLOAD METHODS
    // ============================================

    async downloadFile(urlString, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isValidUrl(urlString)) {
                reject(new Error('Invalid URL: ' + urlString));
                return;
            }

            const parsedUrl = this.parseUrl(urlString);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const timeout = options.timeout || this.downloadTimeout;
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'NullName-DB/1.0 (https://nullname.db)',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive'
                },
                timeout: timeout
            };
            
            // Add custom headers if provided
            if (options.headers) {
                Object.assign(requestOptions.headers, options.headers);
            }
            
            const req = protocol.request(requestOptions, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        this.downloadFile(redirectUrl, options)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }
                
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: Failed to fetch ${urlString}`));
                    return;
                }
                
                const contentLength = parseInt(res.headers['content-length'], 10);
                if (contentLength > this.maxFileSize) {
                    req.destroy();
                    reject(new Error(`File too large: ${contentLength} bytes (max ${this.maxFileSize} bytes)`));
                    return;
                }
                
                const chunks = [];
                let downloadedSize = 0;
                
                res.on('data', (chunk) => {
                    chunks.push(chunk);
                    downloadedSize += chunk.length;
                    
                    if (downloadedSize > this.maxFileSize) {
                        req.destroy();
                        reject(new Error(`Download exceeded max size of ${this.maxFileSize} bytes`));
                    }
                });
                
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    
                    // Handle decompression if needed
                    const encoding = res.headers['content-encoding'];
                    let finalBuffer = buffer;
                    
                    if (encoding === 'gzip') {
                        try {
                            finalBuffer = zlib.gunzipSync(buffer);
                        } catch (e) {
                            reject(new Error('Failed to decompress gzip content'));
                            return;
                        }
                    } else if (encoding === 'deflate') {
                        try {
                            finalBuffer = zlib.inflateSync(buffer);
                        } catch (e) {
                            reject(new Error('Failed to decompress deflate content'));
                            return;
                        }
                    }
                    
                    resolve({
                        buffer: finalBuffer,
                        size: finalBuffer.length,
                        contentType: res.headers['content-type'],
                        contentLength: contentLength,
                        filename: this.extractFilename(res, parsedUrl),
                        headers: res.headers,
                        url: urlString
                    });
                });
                
                res.on('error', (err) => {
                    reject(new Error(`Response error: ${err.message}`));
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
        // Try from Content-Disposition header
        const disposition = res.headers['content-disposition'];
        if (disposition) {
            const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                let filename = filenameMatch[1].replace(/['"]/g, '');
                // Decode URI component if needed
                try {
                    filename = decodeURIComponent(filename);
                } catch (e) {}
                return this.sanitizeFilename(filename);
            }
        }
        
        // Try from URL path
        const pathname = parsedUrl.pathname;
        if (pathname && pathname !== '/') {
            const basename = path.basename(pathname);
            if (basename && basename.length > 0) {
                const decoded = decodeURIComponent(basename);
                if (decoded.includes('.')) {
                    return this.sanitizeFilename(decoded);
                }
            }
        }
        
        // Generate from URL hostname
        const hostname = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        return this.sanitizeFilename(`${hostname}_${Date.now()}.bin`);
    }

    sanitizeFilename(filename) {
        // Remove path traversal and special characters
        let clean = filename.replace(/\.\./g, '');
        clean = clean.replace(/[\\/]/g, '_');
        clean = clean.replace(/[^a-zA-Z0-9_.-]/g, '_');
        
        // Limit length
        if (clean.length > 200) {
            const ext = path.extname(clean);
            const name = clean.slice(0, 200 - ext.length);
            clean = name + ext;
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
            'application/json': '.json',
            'application/xml': '.xml',
            'application/zip': '.zip',
            'application/x-tar': '.tar',
            'application/x-gzip': '.gz',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg'
        };
        
        const mainType = contentType ? contentType.split(';')[0] : '';
        return mimeMap[mainType] || '.bin';
    }

    // ============================================
    // SAVE FILE METHODS
    // ============================================

    async saveFile(buffer, filename, subdir = '') {
        const targetDir = subdir ? path.join(this.filesDir, subdir) : this.filesDir;
        await fs.ensureDir(targetDir);
        
        let finalFilename = filename;
        let filePath = path.join(targetDir, finalFilename);
        
        // Handle duplicate filenames
        let counter = 1;
        while (await fs.pathExists(filePath)) {
            const ext = path.extname(finalFilename);
            const name = finalFilename.slice(0, -ext.length);
            finalFilename = `${name}_${counter}${ext}`;
            filePath = path.join(targetDir, finalFilename);
            counter++;
        }
        
        await fs.writeFile(filePath, buffer);
        
        return {
            success: true,
            filename: finalFilename,
            path: filePath,
            size: buffer.length,
            url: `/files/${subdir ? subdir + '/' : ''}${finalFilename}`
        };
    }

    async downloadAndSave(urlString, customFilename = null, subdir = '') {
        try {
            // Validate URL
            if (!this.isValidUrl(urlString)) {
                return {
                    success: false,
                    error: 'Invalid URL: ' + urlString
                };
            }
            
            // Download file
            const downloadResult = await this.downloadFile(urlString);
            
            // Determine filename
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
            
            // Save file
            const saveResult = await this.saveFile(downloadResult.buffer, filename, subdir);
            
            return {
                success: true,
                filename: saveResult.filename,
                path: saveResult.path,
                url: saveResult.url,
                size: saveResult.size,
                originalUrl: urlString,
                contentType: downloadResult.contentType,
                downloadedAt: new Date().toISOString()
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

    // ============================================
    // QUEUE SYSTEM FOR MULTIPLE DOWNLOADS
    // ============================================

    addToQueue(urlString, customFilename = null, subdir = '', callback = null) {
        return new Promise((resolve, reject) => {
            this.downloadQueue.push({
                url: urlString,
                filename: customFilename,
                subdir: subdir,
                resolve: resolve,
                reject: reject,
                callback: callback
            });
            
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isDownloading) return;
        if (this.downloadQueue.length === 0) return;
        if (this.activeDownloads >= this.maxConcurrentDownloads) return;
        
        this.isDownloading = true;
        
        while (this.downloadQueue.length > 0 && this.activeDownloads < this.maxConcurrentDownloads) {
            const item = this.downloadQueue.shift();
            this.activeDownloads++;
            
            this.downloadAndSave(item.url, item.filename, item.subdir)
                .then((result) => {
                    item.resolve(result);
                    if (item.callback) item.callback(null, result);
                })
                .catch((error) => {
                    item.reject(error);
                    if (item.callback) item.callback(error, null);
                })
                .finally(() => {
                    this.activeDownloads--;
                    this.processQueue();
                });
        }
        
        this.isDownloading = false;
    }

    async downloadMultiple(urls, options = {}) {
        const results = [];
        const concurrency = options.concurrency || 3;
        const onProgress = options.onProgress || null;
        
        let completed = 0;
        const total = urls.length;
        
        const downloadOne = async (url, index) => {
            const result = await this.downloadAndSave(url);
            completed++;
            
            if (onProgress) {
                onProgress(completed, total, url, result);
            }
            
            results[index] = result;
        };
        
        // Process with concurrency limit
        const batches = [];
        for (let i = 0; i < urls.length; i += concurrency) {
            batches.push(urls.slice(i, i + concurrency));
        }
        
        for (const batch of batches) {
            await Promise.all(batch.map((url, idx) => downloadOne(url, urls.indexOf(url))));
        }
        
        return {
            success: true,
            total: total,
            completed: completed,
            results: results
        };
    }

    // ============================================
    // FILE MANAGEMENT
    // ============================================

    async getFileInfo(filename, subdir = '') {
        const filePath = subdir ? path.join(this.filesDir, subdir, filename) : path.join(this.filesDir, filename);
        
        if (!await fs.pathExists(filePath)) {
            return null;
        }
        
        const stat = await fs.stat(filePath);
        
        return {
            filename: filename,
            path: filePath,
            size: stat.size,
            created: stat.birthtime,
            modified: stat.mtime,
            url: `/files/${subdir ? subdir + '/' : ''}${filename}`
        };
    }

    async deleteFile(filename, subdir = '') {
        const filePath = subdir ? path.join(this.filesDir, subdir, filename) : path.join(this.filesDir, filename);
        
        if (!await fs.pathExists(filePath)) {
            return { success: false, error: 'File not found' };
        }
        
        await fs.remove(filePath);
        
        return { success: true, filename: filename, deleted: true };
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
                results.push({
                    filename: file,
                    size: stat.size,
                    modified: stat.mtime,
                    url: `/files/${subdir ? subdir + '/' : ''}${file}`
                });
            }
        }
        
        return results.sort((a, b) => b.modified - a.modified);
    }

    async cleanupTempFiles(maxAgeMs = 3600000) {
        // Delete temp files older than maxAgeMs (default 1 hour)
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
        
        return { deleted: deleted };
    }

    // ============================================
    // HTTP REQUESTS (GET, POST)
    // ============================================

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
                headers: options.headers || {},
                timeout: options.timeout || 10000
            };
            
            const req = protocol.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve({
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
            
            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(dataString),
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
            
            req.write(dataString);
            req.end();
        });
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    getFileSizeDisplay(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async getRemoteFileInfo(urlString) {
        try {
            const result = await this.httpGet(urlString, { method: 'HEAD' });
            
            if (result.statusCode !== 200) {
                return null;
            }
            
            const contentLength = result.headers['content-length'];
            const contentType = result.headers['content-type'];
            const lastModified = result.headers['last-modified'];
            
            return {
                url: urlString,
                size: contentLength ? parseInt(contentLength) : null,
                contentType: contentType,
                lastModified: lastModified,
                exists: true
            };
        } catch (error) {
            return { url: urlString, exists: false, error: error.message };
        }
    }

    generateUniqueFilename(originalName) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        const ext = path.extname(originalName);
        const name = path.basename(originalName, ext);
        const cleanName = this.sanitizeFilename(name);
        return `${cleanName}_${timestamp}_${random}${ext}`;
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new InternetHandler();
