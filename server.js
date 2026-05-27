// NullName DB - Main Server
// No brand. No name. No payment.
// Version: 2.0.0

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
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'production';

let serverInstance = null;
let wss = null;

// ============================================
// RESPONSE FORMAT CONVERTERS
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
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return '';
    
    const csvLines = [];
    const headerRow = columns.map(col => `"${String(col).replace(/"/g, '""')}"`).join(',');
    csvLines.push(headerRow);
    
    for (const row of rows) {
        const rowData = columns.map(col => {
            let value = row[col];
            if (value === undefined || value === null) return '""';
            if (typeof value === 'object') value = JSON.stringify(value);
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(',');
        csvLines.push(rowData);
    }
    
    return csvLines.join('\n');
}

function convertToMarkdownTable(data) {
    if (!data) return '';
    
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return '';
    
    const lines = [];
    const header = `| ${columns.join(' | ')} |`;
    const separator = `| ${columns.map(() => '---').join(' | ')} |`;
    lines.push(header);
    lines.push(separator);
    
    for (const row of rows) {
        const rowLine = `| ${columns.map(col => {
            let val = row[col];
            if (val === undefined || val === null) return ' ';
            if (typeof val === 'object') val = JSON.stringify(val);
            return String(val);
        }).join(' | ')} |`;
        lines.push(rowLine);
    }
    
    return lines.join('\n');
}

function convertToAsciiTable(data) {
    if (!data) return '';
    
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
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
    for (let i = 0; i < columns.length; i++) {
        headerLine += ` ${columns[i].padEnd(colWidths[i] - 1)}|`;
    }
    lines.push(headerLine);
    
    let separatorLine = '|';
    for (let i = 0; i < columns.length; i++) {
        separatorLine += `-${'-'.repeat(colWidths[i] - 1)}|`;
    }
    lines.push(separatorLine);
    
    for (const row of rows) {
        let rowLine = '|';
        for (let i = 0; i < columns.length; i++) {
            let val = row[columns[i]];
            if (val === undefined || val === null) val = '';
            if (typeof val === 'object') val = JSON.stringify(val);
            let str = String(val);
            if (str.length > colWidths[i] - 1) {
                str = str.substring(0, colWidths[i] - 4) + '...';
            }
            rowLine += ` ${str.padEnd(colWidths[i] - 1)}|`;
        }
        lines.push(rowLine);
    }
    
    return lines.join('\n');
}

function convertToYAML(data, indent = 0) {
    if (data === null || data === undefined) return 'null';
    if (typeof data === 'string') return `"${data.replace(/"/g, '\\"')}"`;
    if (typeof data === 'number') return String(data);
    if (typeof data === 'boolean') return data ? 'true' : 'false';
    
    if (Array.isArray(data)) {
        if (data.length === 0) return '[]';
        const items = data.map(item => `- ${convertToYAML(item, indent + 2)}`);
        return items.join('\n');
    }
    
    if (typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 0) return '{}';
        const spaces = ' '.repeat(indent);
        const lines = [];
        for (const key of keys) {
            const value = data[key];
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                lines.push(`${spaces}${key}:`);
                lines.push(convertToYAML(value, indent + 2));
            } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
                lines.push(`${spaces}${key}:`);
                for (const item of value) {
                    lines.push(`${spaces}  -`);
                    const itemLines = convertToYAML(item, indent + 4).split('\n');
                    for (const line of itemLines) {
                        lines.push(`  ${line}`);
                    }
                }
            } else {
                lines.push(`${spaces}${key}: ${convertToYAML(value, indent + 2)}`);
            }
        }
        return lines.join('\n');
    }
    
    return String(data);
}

function convertToXML(data, rootName = 'root') {
    if (data === null || data === undefined) return `<${rootName}/>`;
    
    if (typeof data !== 'object') {
        return `<${rootName}>${String(data).replace(/[<>&]/g, (c) => {
            if (c === '<') return '&lt;';
            if (c === '>') return '&gt;';
            if (c === '&') return '&amp;';
            return c;
        })}</${rootName}>`;
    }
    
    if (Array.isArray(data)) {
        let xml = '';
        for (const item of data) {
            xml += convertToXML(item, 'item');
        }
        return xml;
    }
    
    let xml = `<${rootName}>`;
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null) {
            xml += convertToXML(value, key);
        } else if (Array.isArray(value)) {
            for (const item of value) {
                xml += convertToXML(item, key);
            }
        } else {
            xml += `<${key}>${String(value).replace(/[<>&]/g, (c) => {
                if (c === '<') return '&lt;';
                if (c === '>') return '&gt;';
                if (c === '&') return '&amp;';
                return c;
            })}</${key}>`;
        }
    }
    xml += `</${rootName}>`;
    return xml;
}

function convertToPlainText(data, level = 0) {
    const indent = '  '.repeat(level);
    
    if (data === null || data === undefined) return `${indent}null`;
    
    if (typeof data === 'string') return `${indent}${data}`;
    if (typeof data === 'number') return `${indent}${data}`;
    if (typeof data === 'boolean') return `${indent}${data ? 'true' : 'false'}`;
    
    if (Array.isArray(data)) {
        if (data.length === 0) return `${indent}[]`;
        const lines = [];
        for (let i = 0; i < data.length; i++) {
            lines.push(convertToPlainText(data[i], level));
        }
        return lines.join('\n');
    }
    
    if (typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 0) return `${indent}{}`;
        const lines = [];
        for (const key of keys) {
            const value = data[key];
            if (typeof value === 'object' && value !== null) {
                lines.push(`${indent}${key}:`);
                lines.push(convertToPlainText(value, level + 1));
            } else {
                lines.push(`${indent}${key}: ${convertToPlainText(value, 0)}`);
            }
        }
        return lines.join('\n');
    }
    
    return `${indent}${String(data)}`;
}

function convertToVertical(data) {
    if (!data) return 'No data';
    
    if (Array.isArray(data)) {
        const blocks = [];
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            blocks.push(`Record ${i + 1}:`);
            for (const [key, value] of Object.entries(record)) {
                let val = value;
                if (typeof val === 'object') val = JSON.stringify(val);
                blocks.push(`  ${key}: ${val}`);
            }
            blocks.push('');
        }
        return blocks.join('\n');
    }
    
    if (typeof data === 'object') {
        const blocks = [];
        for (const [key, value] of Object.entries(data)) {
            let val = value;
            if (typeof val === 'object') val = JSON.stringify(val);
            blocks.push(`${key}: ${val}`);
        }
        return blocks.join('\n');
    }
    
    return String(data);
}

function convertToHTML(data) {
    if (!data) return '<div class="no-data">No data</div>';
    
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return '<div class="no-data">No data</div>';
    
    let html = '<table class="data-table">\n<thead>\n<tr>\n';
    for (const col of columns) {
        html += `<th>${escapeHtml(String(col))}</th>\n`;
    }
    html += '</tr>\n</thead>\n<tbody>\n';
    
    for (const row of rows) {
        html += '<tr>\n';
        for (const col of columns) {
            let val = row[col];
            if (val === undefined || val === null) val = '';
            if (typeof val === 'object') val = JSON.stringify(val);
            html += `<td>${escapeHtml(String(val))}</td>\n`;
        }
        html += '</tr>\n';
    }
    
    html += '</tbody>\n</table>\n';
    return html;
}

function convertToLaTeX(data) {
    if (!data) return '\\textit{No data}';
    
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return '\\textit{No data}';
    
    let latex = '\\begin{tabular}{|' + columns.map(() => 'c').join('|') + '|}\n\\hline\n';
    latex += columns.map(col => escapeLaTeX(String(col))).join(' & ') + ' \\\\\n\\hline\n';
    
    for (const row of rows) {
        const rowCells = columns.map(col => {
            let val = row[col];
            if (val === undefined || val === null) return '';
            if (typeof val === 'object') val = JSON.stringify(val);
            return escapeLaTeX(String(val));
        });
        latex += rowCells.join(' & ') + ' \\\\\n\\hline\n';
    }
    
    latex += '\\end{tabular}';
    return latex;
}

function convertToAIFriendly(data, query = '') {
    let rows = [];
    let columns = [];
    let summary = '';
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
        summary = `${rows.length} records returned`;
    } else if (typeof data === 'object') {
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
        summary = `${rows.length} items returned`;
    }
    
    const result = {
        success: true,
        query: query,
        timestamp: new Date().toISOString(),
        summary: summary,
        columns: columns,
        count: rows.length,
        data: rows,
        metadata: {
            format: 'ai_friendly',
            version: '2.0.0'
        }
    };
    
    if (rows.length > 0 && rows.length <= 10) {
        result.natural_language = generateNaturalLanguage(rows, columns);
    }
    
    return JSON.stringify(result, null, 2);
}

function generateNaturalLanguage(rows, columns) {
    if (!rows || rows.length === 0) return 'No results found.';
    if (rows.length === 1) {
        const record = rows[0];
        const parts = [];
        for (const col of columns) {
            parts.push(`${col}: ${record[col]}`);
        }
        return `Found 1 record: ${parts.join(', ')}.`;
    }
    return `Found ${rows.length} records. Each record has fields: ${columns.join(', ')}.`;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeLaTeX(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '\\&')
        .replace(/%/g, '\\%')
        .replace(/\$/g, '\\$')
        .replace(/#/g, '\\#')
        .replace(/_/g, '\\_')
        .replace(/{/g, '\\{')
        .replace(/}/g, '\\}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}');
}

function sendResponse(req, res, data, query = '') {
    let format = req.query.format || req.body?.format || 'json';
    format = String(format).toLowerCase();
    
    const pretty = req.query.pretty === 'true' || req.query.pretty === '1';
    const raw = req.query.raw === 'true';
    const callback = req.query.callback;
    
    const metadata = {
        timestamp: new Date().toISOString(),
        format: format,
        count: Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.keys(data).length : 1)
    };
    
    switch (format) {
        case 'csv':
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="export_${Date.now()}.csv"`);
            res.send(convertToCSV(data));
            break;
            
        case 'markdown':
        case 'md':
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.send(convertToMarkdownTable(data));
            break;
            
        case 'table':
        case 'ascii':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(convertToAsciiTable(data));
            break;
            
        case 'grid':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(convertToAsciiTable(data));
            break;
            
        case 'compact':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            const compactData = Array.isArray(data) ? data : [data];
            if (compactData.length > 0) {
                const cols = Object.keys(compactData[0]);
                let output = cols.join('  ') + '\n';
                for (const row of compactData) {
                    output += cols.map(c => {
                        let v = row[c];
                        if (typeof v === 'object') v = JSON.stringify(v);
                        return String(v || '');
                    }).join('  ') + '\n';
                }
                res.send(output);
            } else {
                res.send('No data');
            }
            break;
            
        case 'vertical':
        case 'v':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(convertToVertical(data));
            break;
            
        case 'text':
        case 'plain':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            if (raw && typeof data === 'string') {
                res.send(data);
            } else if (raw && typeof data === 'number') {
                res.send(String(data));
            } else {
                res.send(convertToPlainText(data));
            }
            break;
            
        case 'yaml':
        case 'yml':
            res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
            res.send(convertToYAML(data));
            break;
            
        case 'xml':
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.send(convertToXML(data));
            break;
            
        case 'html':
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(convertToHTML(data));
            break;
            
        case 'latex':
        case 'tex':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(convertToLaTeX(data));
            break;
            
        case 'json-min':
        case 'minified':
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.send(JSON.stringify({ data: data, _meta: metadata }));
            break;
            
        case 'ndjson':
        case 'jsonl':
            res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
            if (Array.isArray(data)) {
                const lines = data.map(item => JSON.stringify(item));
                res.send(lines.join('\n'));
            } else {
                res.send(JSON.stringify(data));
            }
            break;
            
        case 'ai':
        case 'ai-friendly':
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.send(convertToAIFriendly(data, query));
            break;
            
        case 'jsonp':
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            const jsonpData = JSON.stringify({ data: data, _meta: metadata });
            res.send(`${callback}(${jsonpData});`);
            break;
            
        case 'json':
        default:
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (pretty) {
                res.send(JSON.stringify({ data: data, _meta: metadata }, null, 2));
            } else {
                res.send(JSON.stringify({ data: data, _meta: metadata }));
            }
            break;
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/q', limiter);

// ============================================
// MULTER SETUP FOR FILE UPLOADS
// ============================================

const storage = multer.diskStorage({
    destination: async function(req, file, cb) {
        const uploadPath = path.join(__dirname, 'database', 'temp');
        await fs.ensureDir(uploadPath);
        cb(null, uploadPath);
    },
    filename: function(req, file, cb) {
        const unique = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        cb(null, true);
    }
});

// ============================================
// IMPORT MODULES
// ============================================

const auth = require('./auth');
const queries = require('./queries');
const userManager = require('./user');
const internet = require('./internet');
const database = require('./core/database');
const commit = require('./core/commit');
const backup = require('./core/backup');
const track = require('./core/track');
const system = require('./core/system');
const realtime = require('./core/realtime');
const filebase = require('./core/filebase');

// ============================================
// WEBSOCKET SERVER
// ============================================

function initWebSocket(server) {
    wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress;
        console.log(`WebSocket client connected from ${ip}`);
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());
                const { type, query, session } = data;
                
                if (type === 'subscribe') {
                    const authResult = await auth.authenticate(session, null, ip, query);
                    if (authResult.allowed) {
                        realtime.addSubscription(ws, query, authResult.user);
                        ws.send(JSON.stringify({ type: 'subscribed', query: query }));
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
                    }
                } else if (type === 'unsubscribe') {
                    realtime.removeSubscription(ws, data.query);
                    ws.send(JSON.stringify({ type: 'unsubscribed' }));
                } else if (type === 'query') {
                    const authResult = await auth.authenticate(session, null, ip, data.query);
                    if (authResult.allowed) {
                        const result = await queries.execute(data.query, authResult.user, session);
                        ws.send(JSON.stringify({ type: 'result', data: result }));
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
                    }
                }
            } catch (error) {
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
        });
        
        ws.on('close', () => {
            realtime.removeClient(ws);
            console.log(`WebSocket client disconnected from ${ip}`);
        });
    });
    
    console.log('WebSocket server initialized');
}

// ============================================
// REQUEST LOGGER MIDDLEWARE
// ============================================

app.use((req, res, next) => {
    req.id = crypto.randomBytes(8).toString('hex');
    req.startTime = Date.now();
    next();
});

// ============================================
// MAIN QUERY ENDPOINT
// ============================================

app.all('/q', async (req, res) => {
    try {
        let query = req.query.q || req.body.q || req.query._q;
        
        if (!query) {
            return res.status(400).json({ error: 'No query provided. Use ?q=your_query' });
        }
        
        try {
            query = decodeURIComponent(query);
        } catch(e) {}
        
        const sessionKey = req.query.ses || req.headers['x-session'];
        const apiKey = req.query.key || req.headers['x-api-key'];
        const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
        
        const authResult = await auth.authenticate(sessionKey, apiKey, ip, query, req.headers['user-agent']);
        
        if (!authResult.allowed) {
            await track.log(query, { error: authResult.message }, ip, null, true);
            return res.status(401).json({ error: 'Unauthorized', message: authResult.message });
        }
        
        const result = await queries.execute(query, authResult.user, authResult.session || sessionKey);
        
        await track.log(query, result, ip, authResult.user, !!result?.error);
        
        if (authResult.newSession) {
            result.session = authResult.newSession;
            res.setHeader('X-Session', authResult.newSession);
        }
        
        sendResponse(req, res, result, query);
        
    } catch (error) {
        console.error('Query error:', error);
        await track.log(req.query.q, { error: error.message }, req.ip, null, true);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// FORMAT COMMAND
// ============================================

app.get('/q/format', (req, res) => {
    const formats = [
        'json', 'json-min', 'jsonp', 'ndjson',
        'csv', 'tsv', 'psv',
        'table', 'ascii', 'grid', 'compact', 'borderless', 'markdown', 'md',
        'text', 'plain', 'vertical', 'v',
        'yaml', 'yml', 'xml', 'html', 'latex', 'tex',
        'ai', 'ai-friendly'
    ];
    res.json({
        formats: formats,
        default: 'json',
        usage: 'Add &format=FORMAT to any query',
        example: '/q=get.users&format=markdown'
    });
});

// ============================================
// FILE UPLOAD ENDPOINTS
// ============================================

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        const sessionKey = req.query.ses || req.headers['x-session'];
        const description = req.body.description || req.query.description || '';
        const tags = req.body.tags || req.query.tags || '';
        
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const authResult = await auth.authenticate(sessionKey, null, req.ip, 'upload');
        if (!authResult.allowed) {
            await fs.remove(file.path);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const result = await filebase.uploadFromLocal(file.path, file.originalname, description, tags, authResult.user);
        
        await fs.remove(file.path);
        
        res.json(result);
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/upload/url', express.json(), async (req, res) => {
    try {
        const url = req.body.url;
        const sessionKey = req.query.ses || req.headers['x-session'];
        const description = req.body.description || '';
        const tags = req.body.tags || '';
        
        if (!url) {
            return res.status(400).json({ error: 'URL required' });
        }
        
        const authResult = await auth.authenticate(sessionKey, null, req.ip, 'upload');
        if (!authResult.allowed) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const result = await filebase.uploadFromUrl(url, description, tags, authResult.user);
        res.json(result);
        
    } catch (error) {
        console.error('URL upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/upload/base64', express.json(), async (req, res) => {
    try {
        const base64 = req.body.base64;
        const filename = req.body.filename || 'upload.bin';
        const sessionKey = req.query.ses || req.headers['x-session'];
        const description = req.body.description || '';
        const tags = req.body.tags || '';
        
        if (!base64) {
            return res.status(400).json({ error: 'Base64 data required' });
        }
        
        const authResult = await auth.authenticate(sessionKey, null, req.ip, 'upload');
        if (!authResult.allowed) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const result = await filebase.uploadFromBase64(base64, filename, description, tags, authResult.user);
        res.json(result);
        
    } catch (error) {
        console.error('Base64 upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// STATIC FILES
// ============================================

app.use('/files', express.static(path.join(__dirname, 'database', 'files')));
app.use('/studio', express.static(path.join(__dirname, 'studio')));
app.use('/cli', express.static(path.join(__dirname, 'cli')));
app.use('/ui', express.static(path.join(__dirname, 'ui')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// ============================================
// WEB UI ROUTES
// ============================================

app.get('/', (req, res) => { res.redirect('/studio'); });
app.get('/dashboard', (req, res) => { res.sendFile(path.join(__dirname, 'ui', 'dashboard.html')); });
app.get('/login', (req, res) => { res.sendFile(path.join(__dirname, 'ui', 'auth.html')); });
app.get('/studio', (req, res) => { res.sendFile(path.join(__dirname, 'studio', 'index.html')); });
app.get('/cli', (req, res) => { res.sendFile(path.join(__dirname, 'cli', 'index.html')); });
app.get('/ide', (req, res) => { res.sendFile(path.join(__dirname, 'ui', 'ide.html')); });

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
    const stats = await database.getStats();
    const uptime = process.uptime();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: uptime,
        version: '2.0.0',
        stats: stats
    });
});

// ============================================
// FORCE RECOVERY SHORTCUTS
// ============================================

app.get('/f1', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin access required' });
    }
    const result = await commit.forceBack(1, authResult.user);
    sendResponse(req, res, result);
});

app.get('/f2', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin access required' });
    }
    const result = await commit.forceBack(2, authResult.user);
    sendResponse(req, res, result);
});

app.get('/f3', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'force');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin access required' });
    }
    const result = await commit.forceBack(3, authResult.user);
    sendResponse(req, res, result);
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

app.get('/admin/stats', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'admin');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin access required' });
    }
    const stats = await database.getStats();
    const trackStats = await track.getStats();
    const backupList = await backup.listBackups();
    res.json({
        database: stats,
        queries: trackStats,
        backups: { count: backupList.length, latest: backupList[0] || null },
        system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: '2.0.0'
        }
    });
});

app.post('/admin/cleanup', async (req, res) => {
    const sessionKey = req.query.ses || req.headers['x-session'];
    const authResult = await auth.authenticate(sessionKey, null, req.ip, 'admin');
    if (!authResult.allowed || authResult.user?.role !== 'admin') {
        return res.status(401).json({ error: 'Admin access required' });
    }
    const result = await system.cleanup();
    res.json(result);
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'ui', 'errors.html'));
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
});

// ============================================
// BLOCK SENSITIVE DIRECTORIES
// ============================================

app.use('/database', (req, res) => { res.status(403).json({ error: 'Access denied' }); });
app.use('/core', (req, res) => { res.status(403).json({ error: 'Access denied' }); });
app.use('/.env', (req, res) => { res.status(403).json({ error: 'Access denied' }); });
app.use('/package.json', (req, res) => { res.status(403).json({ error: 'Access denied' }); });

// ============================================
// START SERVER
// ============================================

async function startServer() {
    try {
        const dirs = [
            'database', 'database/sql', 'database/nosql', 'database/filebase',
            'database/files', 'database/commits', 'database/branches',
            'database/backups', 'database/timeline', 'database/temp',
            'database/cache', 'database/logs', 'database/track',
            'logs', 'studio', 'cli', 'ui', 'docs'
        ];
        
        for (const dir of dirs) {
            await fs.ensureDir(path.join(__dirname, dir));
        }
        
        await system.initialize();
        await backup.startScheduler();
        
        serverInstance = http.createServer(app);
        
        initWebSocket(serverInstance);
        
        serverInstance.listen(PORT, '0.0.0.0', () => {
            console.log('========================================');
            console.log('NullName DB - No brand. No name. No payment.');
            console.log('Version: 2.0.0');
            console.log('========================================');
            console.log(`HTTP Server: http://localhost:${PORT}`);
            console.log(`WebSocket: ws://localhost:${PORT}`);
            console.log(`Studio GUI: http://localhost:${PORT}/studio`);
            console.log(`CLI Terminal: http://localhost:${PORT}/cli`);
            console.log(`API: http://localhost:${PORT}/q?=your_query`);
            console.log('========================================');
            console.log('Supported formats: json, csv, table, markdown, yaml, xml, html, text, vertical, ai');
            console.log('========================================');
        });
        
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app, serverInstance, wss };








