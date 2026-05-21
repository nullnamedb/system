// NullName DB - Main Server Entry Point
// No brand. No name. No payment.
// Version: 1.0.0

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
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'production';

let serverInstance = null;
let isShuttingDown = false;

// ============================================
// RESPONSE FORMAT CONVERTERS - CLEAN VERSION
// ============================================

function convertToCSV(data) {
    if (!data) return '';
    
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(function(item) {
            var key = item[0];
            var value = item[1];
            if (typeof value === 'object' && value !== null) {
                var obj = { id: key };
                Object.assign(obj, value);
                return obj;
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return '';
    
    var csvLines = [];
    
    // Header row
    var headerRow = [];
    for (var i = 0; i < columns.length; i++) {
        var colName = String(columns[i]);
        headerRow.push('"' + colName.replace(/"/g, '""') + '"');
    }
    csvLines.push(headerRow.join(','));
    
    // Data rows
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var rowData = [];
        for (var c = 0; c < columns.length; c++) {
            var col = columns[c];
            var value = row[col];
            var strValue = '';
            
            if (value === undefined || value === null) {
                strValue = '';
            } else if (typeof value === 'object') {
                strValue = JSON.stringify(value);
            } else {
                strValue = String(value);
            }
            
            strValue = strValue.replace(/"/g, '""');
            rowData.push('"' + strValue + '"');
        }
        csvLines.push(rowData.join(','));
    }
    
    return csvLines.join('\n');
}

function convertToText(data, indentLevel) {
    var indent = indentLevel || 0;
    var spaces = '';
    for (var s = 0; s < indent; s++) {
        spaces = spaces + ' ';
    }
    
    if (!data) return spaces + 'null';
    
    if (Array.isArray(data)) {
        if (data.length === 0) return spaces + '[]';
        var arrResult = [];
        for (var a = 0; a < data.length; a++) {
            arrResult.push(convertToText(data[a], indent));
        }
        return arrResult.join('\n');
    }
    
    if (typeof data === 'object') {
        var keys = Object.keys(data);
        if (keys.length === 0) return spaces + '{}';
        
        var objResult = [];
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var val = data[key];
            
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                objResult.push(spaces + key + ':');
                objResult.push(convertToText(val, indent + 2));
            } else if (Array.isArray(val)) {
                objResult.push(spaces + key + ':');
                objResult.push(convertToText(val, indent + 2));
            } else {
                objResult.push(spaces + key + ': ' + String(val));
            }
        }
        return objResult.join('\n');
    }
    
    if (typeof data === 'string') return spaces + data;
    if (typeof data === 'number') return spaces + String(data);
    if (typeof data === 'boolean') return spaces + (data ? 'true' : 'false');
    
    return spaces + String(data);
}

function convertToTable(data) {
    if (!data) return '';
    
    var rows = [];
    var columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        var entries = Object.entries(data);
        for (var e = 0; e < entries.length; e++) {
            var kv = entries[e];
            var keyId = kv[0];
            var valObj = kv[1];
            if (typeof valObj === 'object' && valObj !== null) {
                var newRow = { id: keyId };
                Object.assign(newRow, valObj);
                rows.push(newRow);
            } else {
                rows.push({ id: keyId, value: valObj });
            }
        }
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return 'No data';
    
    // Calculate column widths
    var colWidths = [];
    for (var ci = 0; ci < columns.length; ci++) {
        var colLabel = String(columns[ci]);
        var maxLen = colLabel.length;
        for (var ri = 0; ri < rows.length; ri++) {
            var val = rows[ri][columns[ci]];
            var valStr = val === undefined || val === null ? '' : String(val);
            if (valStr.length > maxLen) {
                maxLen = Math.min(valStr.length, 30);
            }
        }
        colWidths.push(maxLen + 2);
    }
    
    var lines = [];
    
    // Header
    var headerLine = '';
    for (var h = 0; h < columns.length; h++) {
        var colHeader = String(columns[h]);
        var padded = colHeader.padEnd(colWidths[h]);
        headerLine = headerLine + '| ' + padded;
    }
    headerLine = headerLine + '|';
    lines.push(headerLine);
    
    // Separator
    var sepLine = '';
    for (var s = 0; s < columns.length; s++) {
        sepLine = sepLine + '|-' + '-'.repeat(colWidths[s] - 1);
    }
    sepLine = sepLine + '|';
    lines.push(sepLine);
    
    // Rows
    for (var rw = 0; rw < rows.length; rw++) {
        var row = rows[rw];
        var rowLine = '';
        for (var cl = 0; cl < columns.length; cl++) {
            var colName = columns[cl];
            var cellValue = row[colName];
            var cellStr = cellValue === undefined || cellValue === null ? '' : String(cellValue);
            if (cellStr.length > 30) {
                cellStr = cellStr.substring(0, 27) + '...';
            }
            var paddedCell = cellStr.padEnd(colWidths[cl]);
            rowLine = rowLine + '| ' + paddedCell;
        }
        rowLine = rowLine + '|';
        lines.push(rowLine);
    }
    
    return lines.join('\n');
}

// ============================================
// RESPONSE FORMATTER
// ============================================

function sendResponse(req, res, data) {
    var format = 'json';
    if (req.query.format) {
        format = String(req.query.format).toLowerCase();
    } else if (req.body && req.body.format) {
        format = String(req.body.format).toLowerCase();
    }
    
    var callback = req.query.callback;
    var pretty = req.query.pretty === 'true' || req.query.pretty === '1';
    var raw = req.query.raw === 'true';
    
    var metadata = {
        timestamp: new Date().toISOString(),
        format: format,
        count: 0
    };
    
    if (Array.isArray(data)) {
        metadata.count = data.length;
    } else if (typeof data === 'object' && data !== null) {
        metadata.count = Object.keys(data).length;
    } else {
        metadata.count = 1;
    }
    
    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="export_' + Date.now() + '.csv"');
        var csvData = convertToCSV(data);
        res.send(csvData);
        return;
    }
    
    if (format === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        if (raw && typeof data === 'string') {
            res.send(data);
        } else if (raw && typeof data === 'number') {
            res.send(String(data));
        } else {
            var textData = convertToText(data);
            res.send(textData);
        }
        return;
    }
    
    if (format === 'table') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        var tableData = convertToTable(data);
        res.send(tableData);
        return;
    }
    
    if (format === 'jsonp') {
        res.setHeader('Content-Type', 'application/javascript');
        var jsonStr = JSON.stringify({ data: data, _meta: metadata });
        res.send(callback + '(' + jsonStr + ');');
        return;
    }
    
    // Default JSON
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (pretty) {
        res.send(JSON.stringify({ data: data, _meta: metadata }, null, 2));
    } else {
        res.send(JSON.stringify({ data: data, _meta: metadata }));
    }
}

// ============================================
// SECURITY MIDDLEWARE
// ============================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Session', 'X-Request-ID', 'Content-Disposition'],
    credentials: true
}));

app.use(compression());

// ============================================
// BODY PARSING
// ============================================

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

// ============================================
// MULTER SETUP
// ============================================

var storage = multer.diskStorage({
    destination: function(req, file, cb) {
        var uploadPath = path.join(__dirname, 'database', 'temp');
        fs.ensureDirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: function(req, file, cb) {
        var unique = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
        var ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});

var upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ============================================
// IMPORT MODULES
// ============================================

var internet = require('./internet');
var auth = require('./auth');
var queries = require('./queries');
var coreSystem = require('./core/system');
var database = require('./core/database');
var track = require('./core/track');
var backup = require('./core/backup');
var commit = require('./core/commit');
var admin = require('./core/admin');

// ============================================
// REQUEST LOGGER
// ============================================

app.use(function(req, res, next) {
    req.id = crypto.randomBytes(8).toString('hex');
    req.startTime = Date.now();
    next();
});

// ============================================
// MAIN QUERY ENDPOINT
// ============================================

app.all('/q', async function(req, res) {
    try {
        var query = req.query.q || req.body.q || req.query._q;
        
        if (!query) {
            return res.status(400).json({ error: 'No query provided. Use ?q=your_query' });
        }
        
        try {
            query = decodeURIComponent(query);
        } catch(e) {}
        
        var sessionKey = req.query.ses || req.headers['x-session'];
        var apiKey = req.query.key || req.headers['x-api-key'];
        var ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        
        var authResult = await auth.authenticate(sessionKey, apiKey, ip, query);
        
        if (!authResult.allowed) {
            return res.status(401).json({ error: 'Unauthorized', message: authResult.message });
        }
        
        var result = await queries.execute(query, authResult.user, sessionKey);
        
        await track.log(query, result, ip, authResult.user, false);
        
        if (authResult.newSession) {
            result.session = authResult.newSession;
            res.setHeader('X-Session', authResult.newSession);
        }
        
        // Use formatted response
        sendResponse(req, res, result);
        
    } catch (error) {
        console.error('Query error:', error);
        await track.log(query, { error: error.message }, req.ip, null, true);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// FILE UPLOAD ENDPOINTS
// ============================================

app.post('/upload', upload.single('file'), async function(req, res) {
    try {
        var file = req.file;
        var sessionKey = req.query.ses || req.headers['x-session'];
        
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        var authResult = await auth.authenticate(sessionKey, null, req.ip, 'upload');
        if (!authResult.allowed) {
            await fs.remove(file.path);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        var fileName = Date.now() + '_' + file.originalname;
        var permPath = path.join(__dirname, 'database', 'files', fileName);
        await fs.move(file.path, permPath, { overwrite: true });
        
        var protocol = req.protocol;
        var host = req.get('host');
        var fileUrl = protocol + '://' + host + '/files/' + fileName;
        
        res.json({
            success: true,
            filename: file.originalname,
            stored_as: fileName,
            url: fileUrl,
            size: file.size,
            mimetype: file.mimetype
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/upload/url', express.json(), async function(req, res) {
    try {
        var url = req.body.url;
        var sessionKey = req.query.ses || req.headers['x-session'];
        
        if (!url) {
            return res.status(400).json({ error: 'URL required' });
        }
        
        var authResult = await auth.authenticate(sessionKey, null, req.ip, 'upload');
        if (!authResult.allowed) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        var result = await internet.downloadAndSave(url);
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// STATIC FILES
// ============================================

app.use('/files', express.static(path.join(__dirname, 'database', 'files')));
app.use('/ui', express.static(path.join(__dirname, 'ui')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// ============================================
// WEB UI ROUTES
// ============================================

app.get('/', function(req, res) { res.redirect('/dashboard'); });
app.get('/dashboard', function(req, res) { res.sendFile(path.join(__dirname, 'ui', 'dashboard.html')); });
app.get('/login', function(req, res) { res.sendFile(path.join(__dirname, 'ui', 'auth.html')); });
app.get('/db', function(req, res) { res.sendFile(path.join(__dirname, 'ui', 'db.html')); });
app.get('/settings', function(req, res) { res.sendFile(path.join(__dirname, 'ui', 'setting.html')); });

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async function(req, res) {
    var stats = await database.getStats();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), stats: stats });
});

// ============================================
// FORCE RECOVERY SHORTCUTS
// ============================================

app.get('/f1', async function(req, res) {
    var sessionKey = req.query.ses || req.headers['x-session'];
    var authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin only' });
    }
    var result = await commit.forceBack(1, authResult.user);
    sendResponse(req, res, result);
});

app.get('/f2', async function(req, res) {
    var sessionKey = req.query.ses || req.headers['x-session'];
    var authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin only' });
    }
    var result = await commit.forceBack(2, authResult.user);
    sendResponse(req, res, result);
});

app.get('/f3', async function(req, res) {
    var sessionKey = req.query.ses || req.headers['x-session'];
    var authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin only' });
    }
    var result = await commit.forceBack(3, authResult.user);
    sendResponse(req, res, result);
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

app.get('/admin/stats', async function(req, res) {
    var sessionKey = req.query.ses || req.headers['x-session'];
    var authResult = await auth.authenticate(sessionKey, null, req.ip, 'admin');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin only' });
    }
    var stats = await admin.getStats();
    res.json(stats);
});

app.post('/admin/cleanup', async function(req, res) {
    var sessionKey = req.query.ses || req.headers['x-session'];
    var authResult = await auth.authenticate(sessionKey, null, req.ip, 'admin');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin only' });
    }
    var result = await admin.cleanup();
    res.json(result);
});

// ============================================
// ERROR HANDLER
// ============================================

app.use(function(req, res) {
    res.status(404).sendFile(path.join(__dirname, 'ui', 'errors.html'));
});

app.use(function(err, req, res, next) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
    try {
        var dirs = [
            'database/path', 'database/files', 'database/commits',
            'database/branches', 'database/backups', 'database/temp',
            'logs', 'ui', 'docs'
        ];
        
        for (var i = 0; i < dirs.length; i++) {
            await fs.ensureDir(path.join(__dirname, dirs[i]));
        }
        
        await coreSystem.initialize();
        await backup.startScheduler();
        
        serverInstance = app.listen(PORT, '0.0.0.0', function() {
            console.log('========================================');
            console.log('NullName DB - No brand. No name. No payment.');
            console.log('========================================');
            console.log('Server running on port ' + PORT);
            console.log('Dashboard: http://localhost:' + PORT + '/dashboard');
            console.log('API: http://localhost:' + PORT + '/q?=your_query');
            console.log('========================================');
            console.log('Format options: &format=json &format=csv &format=text &format=table');
            console.log('========================================');
        });
        
    } catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app, serverInstance };
