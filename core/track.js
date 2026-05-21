// NullName DB - Query Tracking System
// No brand. No name. No payment.
// Version: 1.0.0
// Lines: 550+

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

// ============================================
// TRACKING SYSTEM CLASS
// ============================================

class TrackSystem {
    constructor() {
        this.trackFile = path.join(__dirname, '..', 'database', 'tracking.json');
        this.analyticsFile = path.join(__dirname, '..', 'database', 'analytics.json');
        this.trackCache = [];
        this.maxCacheSize = 5000;
        this.flushInterval = 60000; // Flush every minute
        this.flushTimer = null;
        
        // Analytics aggregates
        this.analytics = {
            totalQueries: 0,
            successfulQueries: 0,
            failedQueries: 0,
            uniqueIps: new Set(),
            uniqueUsers: new Set(),
            queriesByType: {},
            queriesByHour: new Array(24).fill(0),
            queriesByDay: {},
            averageResponseTime: 0,
            totalResponseTime: 0,
            lastUpdated: null
        };
        
        this.init();
    }

    async init() {
        await this.ensureFiles();
        await this.loadCache();
        await this.loadAnalytics();
        this.startFlushTimer();
        console.log('Tracking system initialized');
    }

    async ensureFiles() {
        if (!await fs.pathExists(this.trackFile)) {
            await fs.writeJson(this.trackFile, []);
        }
        if (!await fs.pathExists(this.analyticsFile)) {
            await fs.writeJson(this.analyticsFile, {
                totalQueries: 0,
                successfulQueries: 0,
                failedQueries: 0,
                uniqueIps: [],
                uniqueUsers: [],
                queriesByType: {},
                queriesByHour: new Array(24).fill(0),
                queriesByDay: {},
                averageResponseTime: 0,
                totalResponseTime: 0,
                lastUpdated: null
            });
        }
    }

    async loadCache() {
        try {
            const data = await fs.readJson(this.trackFile);
            this.trackCache = data.slice(-this.maxCacheSize);
        } catch (error) {
            console.error('Failed to load track cache:', error);
            this.trackCache = [];
        }
    }

    async saveCache() {
        try {
            await fs.writeJson(this.trackFile, this.trackCache, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save tracking:', error);
        }
    }

    async loadAnalytics() {
        try {
            const data = await fs.readJson(this.analyticsFile);
            this.analytics.totalQueries = data.totalQueries || 0;
            this.analytics.successfulQueries = data.successfulQueries || 0;
            this.analytics.failedQueries = data.failedQueries || 0;
            this.analytics.uniqueIps = new Set(data.uniqueIps || []);
            this.analytics.uniqueUsers = new Set(data.uniqueUsers || []);
            this.analytics.queriesByType = data.queriesByType || {};
            this.analytics.queriesByHour = data.queriesByHour || new Array(24).fill(0);
            this.analytics.queriesByDay = data.queriesByDay || {};
            this.analytics.averageResponseTime = data.averageResponseTime || 0;
            this.analytics.totalResponseTime = data.totalResponseTime || 0;
            this.analytics.lastUpdated = data.lastUpdated;
        } catch (error) {
            console.error('Failed to load analytics:', error);
        }
    }

    async saveAnalytics() {
        try {
            await fs.writeJson(this.analyticsFile, {
                totalQueries: this.analytics.totalQueries,
                successfulQueries: this.analytics.successfulQueries,
                failedQueries: this.analytics.failedQueries,
                uniqueIps: Array.from(this.analytics.uniqueIps),
                uniqueUsers: Array.from(this.analytics.uniqueUsers),
                queriesByType: this.analytics.queriesByType,
                queriesByHour: this.analytics.queriesByHour,
                queriesByDay: this.analytics.queriesByDay,
                averageResponseTime: this.analytics.averageResponseTime,
                totalResponseTime: this.analytics.totalResponseTime,
                lastUpdated: new Date().toISOString()
            }, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save analytics:', error);
        }
    }

    startFlushTimer() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        
        this.flushTimer = setInterval(() => {
            this.flush();
        }, this.flushInterval);
    }

    async flush() {
        await this.saveCache();
        await this.saveAnalytics();
    }

    // ============================================
    // LOG QUERY
    // ============================================

    async log(query, result, ip, user, isError = false, duration = 0) {
        const queryType = this.detectQueryType(query);
        const hour = new Date().getHours();
        const day = new Date().toISOString().split('T')[0];
        
        const entry = {
            id: crypto.randomBytes(8).toString('hex'),
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            query: query.substring(0, 1000),
            queryType: queryType,
            success: !isError,
            error: isError ? (result?.error || 'Unknown error') : null,
            ip: ip || 'unknown',
            user: user?.username || 'anonymous',
            userRole: user?.role || 'guest',
            resultSize: result ? JSON.stringify(result).length : 0,
            duration: duration,
            durationMs: duration.toFixed(2)
        };
        
        // Add to cache
        this.trackCache.unshift(entry);
        
        // Update analytics
        this.updateAnalytics(entry);
        
        // Keep cache size limited
        if (this.trackCache.length > this.maxCacheSize) {
            this.trackCache = this.trackCache.slice(0, this.maxCacheSize);
        }
        
        // Flush periodically
        if (this.trackCache.length % 100 === 0) {
            await this.flush();
        }
        
        return entry;
    }

    detectQueryType(query) {
        if (!query) return 'unknown';
        
        if (query.includes('=') && !query.startsWith('add.')) return 'set';
        if (query.startsWith('add.')) return 'add';
        if (query.startsWith('get.')) return 'get';
        if (query.startsWith('update.')) return 'update';
        if (query.startsWith('delete.')) return 'delete';
        if (query.startsWith('create.')) return 'create';
        if (query.startsWith('commit')) return 'commit';
        if (query.startsWith('checkout')) return 'checkout';
        if (query.startsWith('branch')) return 'branch';
        if (query.startsWith('merge')) return 'merge';
        if (query.startsWith('undo') || query.startsWith('redo')) return 'undo_redo';
        if (query.startsWith('backup')) return 'backup';
        if (query.startsWith('restore')) return 'restore';
        if (query.startsWith('login') || query.startsWith('signup')) return 'auth';
        if (query.startsWith('track')) return 'track';
        if (query.startsWith('force')) return 'force';
        
        return 'other';
    }

    updateAnalytics(entry) {
        // Update counts
        this.analytics.totalQueries++;
        if (entry.success) {
            this.analytics.successfulQueries++;
        } else {
            this.analytics.failedQueries++;
        }
        
        // Update unique IPs and users
        if (entry.ip && entry.ip !== 'unknown') {
            this.analytics.uniqueIps.add(entry.ip);
        }
        if (entry.user && entry.user !== 'anonymous') {
            this.analytics.uniqueUsers.add(entry.user);
        }
        
        // Update query type stats
        if (!this.analytics.queriesByType[entry.queryType]) {
            this.analytics.queriesByType[entry.queryType] = 0;
        }
        this.analytics.queriesByType[entry.queryType]++;
        
        // Update hour stats
        const hour = new Date(entry.timestamp).getHours();
        this.analytics.queriesByHour[hour]++;
        
        // Update day stats
        const day = entry.timestampISO.split('T')[0];
        if (!this.analytics.queriesByDay[day]) {
            this.analytics.queriesByDay[day] = 0;
        }
        this.analytics.queriesByDay[day]++;
        
        // Update response time
        this.analytics.totalResponseTime += entry.duration;
        this.analytics.averageResponseTime = this.analytics.totalResponseTime / this.analytics.totalQueries;
        
        this.analytics.lastUpdated = new Date().toISOString();
    }

    // ============================================
    // GET TRACKS
    // ============================================

    async getTracks(filter = {}) {
        let tracks = [...this.trackCache];
        
        // Apply filters
        if (filter.type === 'success') {
            tracks = tracks.filter(t => t.success === true);
        } else if (filter.type === 'error') {
            tracks = tracks.filter(t => t.success === false);
        }
        
        if (filter.queryType) {
            tracks = tracks.filter(t => t.queryType === filter.queryType);
        }
        
        if (filter.user) {
            tracks = tracks.filter(t => t.user === filter.user);
        }
        
        if (filter.ip) {
            tracks = tracks.filter(t => t.ip === filter.ip);
        }
        
        if (filter.timeRange) {
            const now = Date.now();
            const ranges = {
                '1min': now - 60000,
                '5min': now - 300000,
                '15min': now - 900000,
                '30min': now - 1800000,
                '1hr': now - 3600000,
                '6hr': now - 21600000,
                '12hr': now - 43200000,
                '24hr': now - 86400000,
                '7d': now - 604800000,
                '30d': now - 2592000000
            };
            const since = ranges[filter.timeRange];
            if (since) {
                tracks = tracks.filter(t => t.timestamp > since);
            }
        }
        
        if (filter.fromDate) {
            const fromDate = new Date(filter.fromDate).getTime();
            tracks = tracks.filter(t => t.timestamp >= fromDate);
        }
        
        if (filter.toDate) {
            const toDate = new Date(filter.toDate).getTime();
            tracks = tracks.filter(t => t.timestamp <= toDate);
        }
        
        if (filter.limit) {
            tracks = tracks.slice(0, filter.limit);
        }
        
        if (filter.offset) {
            tracks = tracks.slice(filter.offset);
        }
        
        return {
            total: this.trackCache.length,
            filtered: tracks.length,
            tracks: tracks
        };
    }

    // ============================================
    // ANALYTICS
    // ============================================

    async getStats() {
        const totalQueries = this.analytics.totalQueries;
        const successfulQueries = this.analytics.successfulQueries;
        const failedQueries = this.analytics.failedQueries;
        
        const successRate = totalQueries > 0 
            ? ((successfulQueries / totalQueries) * 100).toFixed(2) 
            : 0;
        
        // Get top query types
        const topQueryTypes = Object.entries(this.analytics.queriesByType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => ({ type, count }));
        
        // Get busiest hours
        const busiestHours = this.analytics.queriesByHour
            .map((count, hour) => ({ hour, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        
        // Get recent days
        const recentDays = Object.entries(this.analytics.queriesByDay)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 7)
            .map(([day, count]) => ({ day, count }));
        
        return {
            total: {
                queries: totalQueries,
                successful: successfulQueries,
                failed: failedQueries,
                successRate: successRate + '%'
            },
            unique: {
                ips: this.analytics.uniqueIps.size,
                users: this.analytics.uniqueUsers.size
            },
            performance: {
                averageResponseTime: this.analytics.averageResponseTime.toFixed(2) + ' ms',
                totalResponseTime: (this.analytics.totalResponseTime / 1000).toFixed(2) + ' s'
            },
            topQueryTypes: topQueryTypes,
            busiestHours: busiestHours,
            recentActivity: recentDays,
            lastUpdated: this.analytics.lastUpdated
        };
    }

    async getQueryTypeStats() {
        return {
            byType: this.analytics.queriesByType,
            total: this.analytics.totalQueries
        };
    }

    async getHourlyStats(date = null) {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const hourlyData = new Array(24).fill(0);
        
        for (const track of this.trackCache) {
            const trackDate = track.timestampISO.split('T')[0];
            if (trackDate === targetDate) {
                const hour = new Date(track.timestamp).getHours();
                hourlyData[hour]++;
            }
        }
        
        return {
            date: targetDate,
            hourly: hourlyData,
            total: hourlyData.reduce((a, b) => a + b, 0)
        };
    }

    async getDailyStats(limit = 30) {
        const days = Object.entries(this.analytics.queriesByDay)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, limit)
            .map(([day, count]) => ({ day, count }));
        
        return {
            days: days,
            total: days.reduce((sum, d) => sum + d.count, 0)
        };
    }

    async getUserStats() {
        const userStats = {};
        
        for (const track of this.trackCache) {
            const user = track.user;
            if (!userStats[user]) {
                userStats[user] = {
                    queries: 0,
                    successful: 0,
                    failed: 0,
                    lastSeen: null
                };
            }
            
            userStats[user].queries++;
            if (track.success) {
                userStats[user].successful++;
            } else {
                userStats[user].failed++;
            }
            
            if (!userStats[user].lastSeen || track.timestamp > userStats[user].lastSeen) {
                userStats[user].lastSeen = track.timestamp;
                userStats[user].lastSeenISO = track.timestampISO;
            }
        }
        
        // Convert to array and sort
        const userArray = Object.entries(userStats).map(([user, stats]) => ({
            user: user,
            ...stats
        }));
        
        userArray.sort((a, b) => b.queries - a.queries);
        
        return userArray;
    }

    async getIpStats() {
        const ipStats = {};
        
        for (const track of this.trackCache) {
            const ip = track.ip;
            if (!ipStats[ip]) {
                ipStats[ip] = {
                    queries: 0,
                    successful: 0,
                    failed: 0,
                    users: new Set(),
                    lastSeen: null
                };
            }
            
            ipStats[ip].queries++;
            if (track.success) {
                ipStats[ip].successful++;
            } else {
                ipStats[ip].failed++;
            }
            
            if (track.user) {
                ipStats[ip].users.add(track.user);
            }
            
            if (!ipStats[ip].lastSeen || track.timestamp > ipStats[ip].lastSeen) {
                ipStats[ip].lastSeen = track.timestamp;
                ipStats[ip].lastSeenISO = track.timestampISO;
            }
        }
        
        // Convert to array and sort
        const ipArray = Object.entries(ipStats).map(([ip, stats]) => ({
            ip: ip,
            ...stats,
            users: stats.users.size,
            uniqueUsers: Array.from(stats.users)
        }));
        
        ipArray.sort((a, b) => b.queries - a.queries);
        
        return ipArray.slice(0, 100); // Top 100 IPs
    }

    // ============================================
    // MAINTENANCE
    // ============================================

    async clearOldTracks(daysToKeep = 30) {
        const cutoff = Date.now() - (daysToKeep * 86400000);
        const oldCount = this.trackCache.length;
        
        this.trackCache = this.trackCache.filter(t => t.timestamp > cutoff);
        const deletedCount = oldCount - this.trackCache.length;
        
        await this.saveCache();
        
        return {
            deleted: deletedCount,
            kept: this.trackCache.length,
            daysKept: daysToKeep
        };
    }

    async clearAllTracks() {
        const deletedCount = this.trackCache.length;
        this.trackCache = [];
        await this.saveCache();
        
        return {
            deleted: deletedCount,
            message: 'All tracking data cleared'
        };
    }

    async exportTracks(format = 'json', filter = {}) {
        const { tracks } = await this.getTracks(filter);
        
        if (format === 'csv') {
            const headers = ['id', 'timestamp', 'query', 'queryType', 'success', 'error', 'ip', 'user', 'duration'];
            const csvRows = [headers.join(',')];
            
            for (const track of tracks) {
                const row = headers.map(header => {
                    let value = track[header] || '';
                    if (typeof value === 'string' && value.includes(',')) {
                        value = `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                });
                csvRows.push(row.join(','));
            }
            
            return csvRows.join('\n');
        }
        
        // Default JSON
        return {
            exportedAt: new Date().toISOString(),
            count: tracks.length,
            tracks: tracks
        };
    }

    async getPerformanceReport() {
        const stats = await this.getStats();
        const hourly = await this.getHourlyStats();
        const daily = await this.getDailyStats(7);
        const topUsers = await this.getUserStats();
        
        // Calculate trends
        const recentDays = daily.days.slice(0, 7);
        const previousDays = daily.days.slice(7, 14);
        
        const recentAvg = recentDays.reduce((sum, d) => sum + d.count, 0) / (recentDays.length || 1);
        const previousAvg = previousDays.reduce((sum, d) => sum + d.count, 0) / (previousDays.length || 1);
        
        const trend = previousAvg > 0 
            ? (((recentAvg - previousAvg) / previousAvg) * 100).toFixed(1)
            : 0;
        
        return {
            period: {
                start: daily.days[daily.days.length - 1]?.day || 'N/A',
                end: daily.days[0]?.day || 'N/A'
            },
            summary: stats,
            trends: {
                weeklyChange: trend + '%',
                direction: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable'
            },
            peakHours: stats.busiestHours,
            topUsers: topUsers.slice(0, 5),
            recommendations: this.generateRecommendations(stats)
        };
    }

    generateRecommendations(stats) {
        const recommendations = [];
        
        if (parseFloat(stats.performance.averageResponseTime) > 100) {
            recommendations.push('High average response time detected. Consider optimizing queries or adding indexes.');
        }
        
        const successRate = parseFloat(stats.total.successRate);
        if (successRate < 95) {
            recommendations.push(`Low success rate (${successRate}%). Check for errors in queries.`);
        }
        
        const busiestHour = stats.busiestHours[0];
        if (busiestHour && busiestHour.count > 1000) {
            recommendations.push(`High traffic at ${busiestHour.hour}:00. Consider scaling during peak hours.`);
        }
        
        if (recommendations.length === 0) {
            recommendations.push('System is performing well. No immediate recommendations.');
        }
        
        return recommendations;
    }

    async getRealTimeStats() {
        const lastMinute = await this.getTracks({ timeRange: '1min' });
        const last5Minutes = await this.getTracks({ timeRange: '5min' });
        
        return {
            timestamp: new Date().toISOString(),
            lastMinute: {
                queries: lastMinute.filtered,
                successRate: this.calculateSuccessRate(lastMinute.tracks)
            },
            last5Minutes: {
                queries: last5Minutes.filtered,
                successRate: this.calculateSuccessRate(last5Minutes.tracks)
            },
            activeUsers: new Set(this.trackCache.slice(0, 100).map(t => t.user)).size,
            currentQPS: lastMinute.filtered / 60
        };
    }

    calculateSuccessRate(tracks) {
        if (tracks.length === 0) return 0;
        const successCount = tracks.filter(t => t.success).length;
        return ((successCount / tracks.length) * 100).toFixed(2);
    }

    async shutdown() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        await this.flush();
        console.log('Tracking system shutdown');
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new TrackSystem();
