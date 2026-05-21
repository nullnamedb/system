// NullName DB - Main Server Entry Point
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 650+ (Updated with CSV, TEXT, JSON formats)

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

// ============================================
// INITIALIZATION
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'production';

// Server instance variables
let serverInstance = null;
let isShuttingDown = false;

// ============================================
// RESPONSE FORMAT CONVERTERS
// ============================================

const convertToCSV = (data, headers = null) => {
    if (!data) return '';
    
    // Handle array of objects
    let rows = [];
    let columns = [];
    
    if (Array.isArray(data)) {
        rows = data;
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    } else if (typeof data === 'object') {
        // Convert object to array of key-value pairs
        rows = Object.entries(data).map(([key, value]) => {
            if (typeof value === 'object') {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (headers) {
        columns = headers;
    }
    
    // Build CSV string
    let csv = [];
    
    // Add headers
    if (columns.length > 0) {
        csv.push(columns.map(col => `"${String(col).replace(/"/g, '""')}"`).join(','));
    }
    
    // Add rows
    for (const row of rows) {
        const rowData = columns.map(col => {
            const value = row[col];
            if (value === undefined || value === null) return '';
            if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csv.push(rowData.join(','));
    }
    
    return csv.join('\n');
};

const convertToText = (data, indent = 0) => {
    if (!data) return '';
    
    const spaces = ' '.repeat(indent);
    let result = '';
    
    if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
            result += convertToText(data[i], indent);
            if (i < data.length - 1) result += '\n';
        }
    } else if (typeof data === 'object') {
        const entries = Object.entries(data);
        for (let i = 0; i < entries.length; i++) {
            const [key, value] = entries[i];
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result += `${spaces}${key}:\n${convertToText(value, indent + 2)}`;
            } else if (Array.isArray(value)) {
                result += `${spaces}${key}:\n${convertToText(value, indent + 2)}`;
            } else {
                result += `${spaces}${key}: ${value}`;
            }
            if (i < entries.length - 1) result += '\n';
        }
    } else {
        result = `${spaces}${data}`;
    }
    
    return result;
};

const convertToTable = (data) => {
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
            if (typeof value === 'object') {
                return { id: key, ...value };
            }
            return { id: key, value: value };
        });
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
    }
    
    if (columns.length === 0) return '';
    
    // Calculate column widths
    const colWidths = columns.map(col => {
        let maxLen = col.length;
        for (const row of rows) {
            const val = String(row[col] || '');
            maxLen = Math.max(maxLen, val.length);
        }
        return Math.min(maxLen, 30);
    });
    
    // Build table
    let table = [];
    
    // Header
    const headerRow = columns.map((col, i) => col.padEnd(colWidths[i])).join(' | ');
    table.push(headerRow);
    table.push(columns.map((_, i) => '-'.repeat(colWidths[i])).join('-+-'));
    
    // Rows
    for (const row of rows) {
        const rowData = columns.map((col, i) => {
            let val = String(row[col] || '');
            if (val.length > 30) val = val.substring(0, 27) + '...';
            return val.padEnd(colWidths[i]);
        });
        table.push(rowData.join(' | '));
    }
    
    return table.join('\n');
};

// ============================================
// RESPONSE FORMATTER MIDDLEWARE
// ============================================

const formatResponse = (req, res, data) => {
    const format = (req.query.format || req.body.format || 'json').toLowerCase();
    const callback = req.query.callback;
    const raw = req.query.raw === 'true';
    
    // Add metadata
    const metadata = {
        timestamp: new Date().toISOString(),
        query_time_ms: Date.now() - (req.startTime || Date.now()),
        format: format,
        count: Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.keys(data).length : 1)
    };
    
    // Raw mode - return exact data without metadata
    if (raw && format === 'text') {
        if (typeof data === 'string') {
            res.setHeader('Content-Type', 'text/plain');
            return res.send(data);
        }
        if (typeof data === 'number') {
            res.setHeader('Content-Type', 'text/plain');
            return res.send(String(data));
        }
    }
    
    switch(format) {
        case 'csv':
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `inline; filename="export_${Date.now()}.csv"`);
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            const csvData = convertToCSV(data);
            res.send(csvData);
            break;
            
        case 'text':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            const textData = convertToText(data);
            res.send(textData);
            break;
            
        case 'table':
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            const tableData = convertToTable(data);
            res.send(tableData);
            break;
            
        case 'jsonp':
            res.setHeader('Content-Type', 'application/javascript');
            res.send(`${callback}(${JSON.stringify({ ...data, _meta: metadata }, null, 2)});`);
            break;
            
        case 'json':
        default:
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (req.query.pretty === 'true' || req.query.pretty === '1') {
                res.send(JSON.stringify({ ...data, _meta: metadata }, null, 2));
            } else {
                res.send(JSON.stringify({ ...data, _meta: metadata }));
            }
            break;
    }
};

// ============================================
// SECURITY MIDDLEWARE
// ============================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const corsOptions = {
    origin: function(origin, callback) {
        const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
            process.env.ALLOWED_ORIGINS.split(',') : ['*'];
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Session', 'X-Request-ID', 'Content-Disposition'],
    credentials: true,
    maxAge: 86400
};
app.use(cors(corsOptions));

// Compression
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.path.includes('/q')) return true;
        return compression.filter(req, res);
    }
}));

// ============================================
// RATE LIMITING
// ============================================

const globalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests, please try again later.', code: 429 },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress,
    skip: (req) => {
        const adminIPs = (process.env.ADMIN_IPS
