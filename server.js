// NullName DB - Main Server
// No brand. No name. No payment.
// Version: 2.0.0 - FIXED

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const crypto = require('crypto');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 2345;

let serverInstance = null;

// ============================================
// RESPONSE FORMAT CONVERTERS
// ============================================

function convertToCSV(data) {
    if (!data) return '';
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) columns = Object.keys(rows[0]);
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) return { id: key, ...value };
            return { id: key, value: value };
        });
        if (rows.length > 0) columns = Object.keys(rows[0]);
    }
    
    if (columns.length === 0) return '';
    const csvLines = [columns.map(col => `"${String(col).replace(/"/g, '""')}"`).join(',')];
    for (const row of rows) {
        csvLines.push(columns.map(col => {
            let value = row[col];
            if (value === undefined || value === null) return '""';
            if (typeof value === 'object') value = JSON.stringify(value);
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(','));
    }
    return csvLines.join('\n');
}

function convertToMarkdownTable(data) {
    if (!data) return '';
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) columns = Object.keys(rows[0]);
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) return { id: key, ...value };
            return { id: key, value: value };
        });
        if (rows.length > 0) columns = Object.keys(rows[0]);
    }
    
    if (columns.length === 0) return '';
    const lines = [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`];
    for (const row of rows) {
        lines.push(`| ${columns.map(col => {
            let val = row[col];
            if (val === undefined || val === null) return ' ';
            if (typeof val === 'object') val = JSON.stringify(val);
            return String(val);
        }).join(' | ')} |`);
    }
    return lines.join('\n');
}

function convertToAsciiTable(data) {
    if (!data) return '';
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) columns = Object.keys(rows[0]);
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) return { id: key, ...value };
            return { id: key, value: value };
        });
        if (rows.length > 0) columns = Object.keys(rows[0]);
    }
    
    if (columns.length === 0) return 'No data';
    const colWidths = columns.map(col => {
        let maxLen = col.length;
        for (const row of rows) {
            let val = row[col];
            if (val === undefined || val === null) val = '';
            if (typeof val === 'object') val = JSON.stringify(val);
            const len = String(val).length;
            if (len > maxLen && len < 50) maxLen = len;
        }
        return Math.min(maxLen + 2, 30);
    });
    
    const lines = [];
    let headerLine = '|';
    for (let i = 0; i < columns.length; i++) headerLine += ` ${columns[i].padEnd(colWidths[i] - 1)}|`;
    lines.push(headerLine);
    let separatorLine = '|';
    for (let i = 0; i < columns.length; i++) separatorLine += `-${'-'.repeat(colWidths[i] - 1)}|`;
    lines.push(separatorLine);
    for (const row of rows) {
        let rowLine = '|';
        for (let i = 0; i < columns.length; i++) {
            let val = row[columns[i]];
            if (val === undefined || val === null) val = '';
            if (typeof val === 'object') val = JSON.stringify(val);
            let str = String(val);
            if (str.length > colWidths[i] - 1) str = str.substring(0, colWidths[i] - 4) + '...';
            rowLine += ` ${str.padEnd(colWidths[i] - 1)}|`;
        }
        lines.push(rowLine);
    }
    return lines.join('\n');
}

function sendResponse(req, res, data, query = '') {
    let format = req.query.format || 'json';
    format = String(format).toLowerCase();
    const pretty = req.query.pretty === 'true';
    
    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.send(convertToCSV(data));
    } else if (format === 'markdown' || format === 'md') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send(convertToMarkdownTable(data));
    } else if (format === 'table' || format === 'ascii') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(convertToAsciiTable(data));
    } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (pretty) res.send(JSON.stringify(data, null, 2));
        else res.send(JSON.stringify(data));
    }
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], credentials: true }));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { error: 'Too many requests' } });
app.use('/q', limiter);

// ============================================
// MULTER
// ============================================

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        await fs.ensureDir('/opt/nullname/database/temp');
        cb(null, '/opt/nullname/database/temp');
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================
// IMPORTS
// ============================================

const auth = require('./auth');
const queries = require('./queries');

// ============================================
// MAIN QUERY ENDPOINT
// ============================================

app.all('/q', async (req, res) => {
    try {
        let query = req.query.q || req.body.q;
        if (!query) return res.status(400).json({ error: 'No query provided. Use ?q=your_query' });
        try { query = decodeURIComponent(query); } catch(e) {}
        
        const sessionKey = req.query.ses || req.headers['x-session'];
        const apiKey = req.query.key || req.headers['x-api-key'];
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        
        const authResult = await auth.authenticate(sessionKey, apiKey, ip, query);
        if (!authResult.allowed) return res.status(401).json({ error: 'Unauthorized', message: authResult.message });
        
        const result = await queries.execute(query, authResult.user, authResult.session || sessionKey);
        if (authResult.newSession) {
            result.session = authResult.newSession;
            res.setHeader('X-Session', authResult.newSession);
        }
        sendResponse(req, res, result, query);
    } catch (error) {
        console.error('Query error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// FILE UPLOAD
// ============================================

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        
        const sessionKey = req.query.ses || req.headers['x-session'];
        const authResult = await auth.authenticate(sessionKey, null, req.ip, 'upload');
        if (!authResult.allowed) {
            await fs.remove(file.path);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const fileName = Date.now() + '_' + file.originalname;
        const permPath = '/opt/nullname/database/files/' + fileName;
        await fs.move(file.path, permPath);
        
        res.json({ success: true, filename: file.originalname, stored: fileName, url: '/files/' + fileName });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// STATIC FILES & UI
// ============================================

app.use('/files', express.static('/opt/nullname/database/files'));
app.use('/studio', express.static('/opt/nullname/studio'));
app.use('/cli', express.static('/opt/nullname/cli'));
app.use('/ui', express.static('/opt/nullname/ui'));

app.get('/', (req, res) => res.redirect('/studio'));
app.get('/dashboard', (req, res) => res.sendFile('/opt/nullname/ui/dashboard.html'));
app.get('/login', (req, res) => res.sendFile('/opt/nullname/ui/auth.html'));
app.get('/studio', (req, res) => res.sendFile('/opt/nullname/studio/index.html'));
app.get('/cli', (req, res) => res.sendFile('/opt/nullname/cli/index.html'));

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), version: '2.0.0' });
});

// ============================================
// FORCE RECOVERY
// ============================================

app.get('/f1', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') return res.status(401).json({ error: 'Admin required' });
    res.json({ success: true, message: 'Force recovery f1 executed' });
});

app.get('/f2', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') return res.status(401).json({ error: 'Admin required' });
    res.json({ success: true, message: 'Force recovery f2 executed' });
});

app.get('/f3', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') return res.status(401).json({ error: 'Admin required' });
    res.json({ success: true, message: 'Force recovery f3 executed' });
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((req, res) => res.status(404).sendFile('/opt/nullname/ui/errors.html'));
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
    try {
        await fs.ensureDir('/opt/nullname/database');
        await fs.ensureDir('/opt/nullname/database/files');
        await fs.ensureDir('/opt/nullname/database/temp');
        await fs.ensureDir('/opt/nullname/studio');
        await fs.ensureDir('/opt/nullname/cli');
        await fs.ensureDir('/opt/nullname/ui');
        
        serverInstance = app.listen(PORT, '0.0.0.0', () => {
            console.log('========================================');
            console.log('NullName DB - No brand. No name. No payment.');
            console.log('Version: 2.0.0');
            console.log('========================================');
            console.log(`Server running on port ${PORT}`);
            console.log(`Studio GUI: http://localhost:${PORT}/studio`);
            console.log(`CLI Terminal: http://localhost:${PORT}/cli`);
            console.log(`API: http://localhost:${PORT}/q?=your_query`);
            console.log('========================================');
        });
    } catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app, serverInstance };
