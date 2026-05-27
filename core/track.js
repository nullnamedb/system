// NullName DB - Query Tracking & Analytics System
// No brand. No name. No payment.
// Version: 2.0.0

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class TrackSystem {
    constructor() {
        this.trackFile = path.join(__dirname, '..', 'database', 'tracking.json');
        this.analyticsFile = path.join(__dirname, '..', 'database', 'analytics.json');
        this.slowQueryFile = path.join(__dirname, '..', 'database', 'slow_queries.json');
        this.trackCache = [];
        this.maxCacheSize = 10000;
        this.flushInterval = 60000;
        this.flushTimer = null;
        this.slowQueryThreshold = parseInt(process.env.SLOW_QUERY_MS) || 1000;
        
        this.analytics = {
            totalQueries: 0,
            successfulQueries: 0,
            failedQueries: 0,
            uniqueIps: new Set(),
            uniqueUsers: new Set(),
            queriesByType: {},
            queriesByHour: new Array(24).fill(0),
            queriesByDay: {},
            queriesByUser: {},
            averageResponseTime: 0,
            totalResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            lastUpdated: null
        };
        
        this.slowQueries = [];
        this.maxSlowQueries = 1000;
        
        this.init();
    }

    async init() {
        await this.ensureFiles();
        await this.loadCache();
        await this.loadAnalytics();
        await this.loadSlowQueries();
        this.startFlushTimer();
        console.log('Tracking system initialized');
    }

    async ensureFiles() {
        await fs.ensureDir(path.dirname(this.trackFile));
        
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
                queriesByUser: {},
                averageResponseTime: 0,
                totalResponseTime: 0,
                minResponseTime: 0,
                maxResponseTime: 0,
                lastUpdated: null
            });
        }
        if (!await fs.pathExists(this.slowQueryFile)) {
            await fs.writeJson(this.slowQueryFile, []);
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
            this.analytics.queriesByUser = data.queriesByUser || {};
            this.analytics.averageResponseTime = data.averageResponseTime || 0;
            this.analytics.totalResponseTime = data.totalResponseTime || 0;
            this.analytics.minResponseTime = data.minResponseTime || Infinity;
            this.analytics.maxResponseTime = data.maxResponseTime || 0;
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
                queriesByUser: this.analytics.queriesByUser,
                averageResponseTime: this.analytics.averageResponseTime,
                totalResponseTime: this.analytics.totalResponseTime,
                minResponseTime: this.analytics.minResponseTime === Infinity ? 0 : this.analytics.minResponseTime,
                maxResponseTime: this.analytics.maxResponseTime,
                lastUpdated: new Date().toISOString()
            }, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save analytics:', error);
        }
    }

    async loadSlowQueries() {
        try {
            const data = await fs.readJson(this.slowQueryFile);
            this.slowQueries = data.slice(-this.maxSlowQueries);
        } catch (error) {
            this.slowQueries = [];
        }
    }

    async saveSlowQueries() {
        try {
            await fs.writeJson(this.slowQueryFile, this.slowQueries.slice(-this.maxSlowQueries), { spaces: 2 });
        } catch (error) {
            console.error('Failed to save slow queries:', error);
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
        await this.saveSlowQueries();
    }

    detectQueryType(query) {
        if (!query) return 'unknown';
        
        if (query.includes('=') && !query.startsWith('add.') && !query.startsWith('update.')) return 'set';
        if (query.startsWith('add.')) return 'add';
        if (query.startsWith('get.')) return 'get';
        if (query.startsWith('update.')) return 'update';
        if (query.startsWith('delete.')) return 'delete';
        if (query.startsWith('create.')) return 'create';
        if (query.startsWith('drop.')) return 'drop';
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
        if (query.startsWith('travel')) return 'travel';
        if (query.startsWith('sql')) return 'sql';
        if (query.startsWith('nosql')) return 'nosql';
        if (query.startsWith('filebase')) return 'filebase';
        if (query.startsWith('user')) return 'user_management';
        
        return 'other';
    }

    async log(query, result, ip, user, isError = false, duration = 0) {
        const queryType = this.detectQueryType(query);
        const hour = new Date().getHours();
        const day = new Date().toISOString().split('T')[0];
        const username = user?.username || 'anonymous';
        
        const entry = {
            id: crypto.randomBytes(8).toString('hex'),
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            query: query.substring(0, 1000),
            queryType: queryType,
            success: !isError && !result?.error,
            error: isError ? (result?.error || 'Unknown error') : (result?.error || null),
            ip: ip || 'unknown',
            user: username,
            userRole: user?.role || 'guest',
            resultSize: result ? JSON.stringify(result).length : 0,
            duration: duration,
            durationMs: duration.toFixed(2)
        };
        
        this.trackCache.unshift(entry);
        this.updateAnalytics(entry);
        
        if (duration > this.slowQueryThreshold) {
            this.slowQueries.unshift(entry);
            if (this.slowQueries.length > this.maxSlowQueries) {
                this.slowQueries = this.slowQueries.slice(0, this.maxSlowQueries);
            }
        }
        
        if (this.trackCache.length > this.maxCacheSize) {
            this.trackCache = this.trackCache.slice(0, this.maxCacheSize);
        }
        
        if (this.trackCache.length % 100 === 0) {
            await this.flush();
        }
        
        return entry;
    }

    updateAnalytics(entry) {
        this.analytics.totalQueries++;
        
        if (entry.success) {
            this.analytics.successfulQueries++;
        } else {
            this.analytics.failedQueries++;
        }
        
        if (entry.ip && entry.ip !== 'unknown') {
            this.analytics.uniqueIps.add(entry.ip);
        }
        
        if (entry.user && entry.user !== 'anonymous') {
            this.analytics.uniqueUsers.add(entry.user);
            
            if (!this.analytics.queriesByUser[entry.user]) {
                this.analytics.queriesByUser[entry.user] = 0;
            }
            this.analytics.queriesByUser[entry.user]++;
        }
        
        if (!this.analytics.queriesByType[entry.queryType]) {
            this.analytics.queriesByType[entry.queryType] = 0;
        }
        this.analytics.queriesByType[entry.queryType]++;
        
        const hour = new Date(entry.timestamp).getHours();
        this.analytics.queriesByHour[hour]++;
        
        const day = entry.timestampISO.split('T')[0];
        if (!this.analytics.queriesByDay[day]) {
            this.analytics.queriesByDay[day] = 0;
        }
        this.analytics.queriesByDay[day]++;
        
        this.analytics.totalResponseTime += entry.duration;
        this.analytics.averageResponseTime = this.analytics.totalResponseTime / this.analytics.totalQueries;
        
        if (entry.duration < this.analytics.minResponseTime) {
            this.analytics.minResponseTime = entry.duration;
        }
        if (entry.duration > this.analytics.maxResponseTime) {
            this.analytics.maxResponseTime = entry.duration;
        }
        
        this.analytics.lastUpdated = new Date().toISOString();
    }

    async getTracks(filter = {}) {
        let tracks = [...this.trackCache];
        
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

    async getSlowQueries(limit = 50) {
        return this.slowQueries.slice(0, limit);
    }

    async getStats() {
        const totalQueries = this.analytics.totalQueries;
        const successfulQueries = this.analytics.successfulQueries;
        const failedQueries = this.analytics.failedQueries;
        
        const successRate = totalQueries > 0 
            ? ((successfulQueries / totalQueries) * 100).toFixed(2) 
            : 0;
        
        const topQueryTypes = Object.entries(this.analytics.queriesByType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => ({ type, count }));
        
        const topUsers = Object.entries(this.analytics.queriesByUser)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([user, count]) => ({ user, count }));
        
        const busiestHours = this.analytics.queriesByHour
            .map((count, hour) => ({ hour, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        
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
            performance: {
                averageResponseTime: this.analytics.averageResponseTime.toFixed(2) + ' ms',
                minResponseTime: (this.analytics.minResponseTime === Infinity ? 0 : this.analytics.minResponseTime).toFixed(2) + ' ms',
                maxResponseTime: this.analytics.maxResponseTime.toFixed(2) + ' ms',
                totalResponseTime: (this.analytics.totalResponseTime / 1000).toFixed(2) + ' s'
            },
            unique: {
                ips: this.analytics.uniqueIps.size,
                users: this.analytics.uniqueUsers.size
            },
            topQueryTypes: topQueryTypes,
            topUsers: topUsers,
            busiestHours: busiestHours,
            recentActivity: recentDays,
            slowQueriesCount: this.slowQueries.length,
            lastUpdated: this.analytics.lastUpdated
        };
    }

    async getQueryTypeStats() {
        return {
            byType: this.analytics.queriesByType,
            total: this.analytics.totalQueries
        };
    }

    async getUserStats(username = null) {
        let tracks = this.trackCache;
        
        if (username) {
            tracks = tracks.filter(t => t.user === username);
        }
        
        const userStats = {};
        
        for (const track of tracks) {
            const user = track.user;
            if (!userStats[user]) {
                userStats[user] = {
                    queries: 0,
                    successful: 0,
                    failed: 0,
                    totalDuration: 0,
                    avgDuration: 0,
                    lastSeen: null,
                    queryTypes: {}
                };
            }
            
            userStats[user].queries++;
            if (track.success) {
                userStats[user].successful++;
            } else {
                userStats[user].failed++;
            }
            userStats[user].totalDuration += track.duration;
            
            if (!userStats[user].queryTypes[track.queryType]) {
                userStats[user].queryTypes[track.queryType] = 0;
            }
            userStats[user].queryTypes[track.queryType]++;
            
            if (!userStats[user].lastSeen || track.timestamp > userStats[user].lastSeen) {
                userStats[user].lastSeen = track.timestamp;
                userStats[user].lastSeenISO = track.timestampISO;
            }
        }
        
        for (const user in userStats) {
            userStats[user].avgDuration = (userStats[user].totalDuration / userStats[user].queries).toFixed(2);
            userStats[user].successRate = ((userStats[user].successful / userStats[user].queries) * 100).toFixed(2);
            delete userStats[user].totalDuration;
        }
        
        const userArray = Object.entries(userStats).map(([user, stats]) => ({
            user: user,
            ...stats
        }));
        
        userArray.sort((a, b) => b.queries - a.queries);
        
        return username ? userStats[username] || null : userArray;
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
                    totalDuration: 0,
                    lastSeen: null
                };
            }
            
            ipStats[ip].queries++;
            if (track.success) {
                ipStats[ip].successful++;
            } else {
                ipStats[ip].failed++;
            }
            ipStats[ip].totalDuration += track.duration;
            
            if (track.user) {
                ipStats[ip].users.add(track.user);
            }
            
            if (!ipStats[ip].lastSeen || track.timestamp > ipStats[ip].lastSeen) {
                ipStats[ip].lastSeen = track.timestamp;
                ipStats[ip].lastSeenISO = track.timestampISO;
            }
        }
        
        const ipArray = Object.entries(ipStats).map(([ip, stats]) => ({
            ip: ip,
            queries: stats.queries,
            successful: stats.successful,
            failed: stats.failed,
            successRate: ((stats.successful / stats.queries) * 100).toFixed(2),
            avgDuration: (stats.totalDuration / stats.queries).toFixed(2),
            users: stats.users.size,
            uniqueUsers: Array.from(stats.users),
            lastSeen: stats.lastSeenISO
        }));
        
        ipArray.sort((a, b) => b.queries - a.queries);
        
        return ipArray.slice(0, 100);
    }

    async getHourlyStats(date = null) {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const hourlyData = new Array(24).fill(0);
        let total = 0;
        
        for (const track of this.trackCache) {
            const trackDate = track.timestampISO.split('T')[0];
            if (trackDate === targetDate) {
                const hour = new Date(track.timestamp).getHours();
                hourlyData[hour]++;
                total++;
            }
        }
        
        return {
            date: targetDate,
            hourly: hourlyData,
            total: total,
            peakHour: hourlyData.indexOf(Math.max(...hourlyData)),
            peakCount: Math.max(...hourlyData)
        };
    }

    async getDailyStats(limit = 30) {
        const days = Object.entries(this.analytics.queriesByDay)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, limit)
            .map(([day, count]) => ({ day, count }));
        
        const total = days.reduce((sum, d) => sum + d.count, 0);
        const average = days.length > 0 ? Math.round(total / days.length) : 0;
        
        return {
            days: days,
            total: total,
            average: average,
            bestDay: days[0] || null,
            worstDay: days[days.length - 1] || null
        };
    }

    async getRealTimeStats() {
        const lastMinute = await this.getTracks({ timeRange: '1min' });
        const last5Minutes = await this.getTracks({ timeRange: '5min' });
        
        const calculateSuccessRate = (tracks) => {
            if (tracks.length === 0) return 0;
            const successCount = tracks.filter(t => t.success).length;
            return ((successCount / tracks.length) * 100).toFixed(2);
        };
        
        return {
            timestamp: new Date().toISOString(),
            lastMinute: {
                queries: lastMinute.filtered,
                successRate: calculateSuccessRate(lastMinute.tracks)
            },
            last5Minutes: {
                queries: last5Minutes.filtered,
                successRate: calculateSuccessRate(last5Minutes.tracks)
            },
            activeUsers: new Set(this.trackCache.slice(0, 100).map(t => t.user)).size,
            currentQPS: (lastMinute.filtered / 60).toFixed(2),
            currentAvgResponseTime: this.analytics.averageResponseTime.toFixed(2)
        };
    }

    async clearOldTracks(daysToKeep = 30) {
        const cutoff = Date.now() - (daysToKeep * 86400000);
        const oldCount = this.trackCache.length;
        
        this.trackCache = this.trackCache.filter(t => t.timestamp > cutoff);
        this.slowQueries = this.slowQueries.filter(t => t.timestamp > cutoff);
        
        const deletedCount = oldCount - this.trackCache.length;
        
        await this.saveCache();
        await this.saveSlowQueries();
        
        return {
            deleted: deletedCount,
            kept: this.trackCache.length,
            daysKept: daysToKeep,
            slowDeleted: oldCount - this.slowQueries.length
        };
    }

    async clearAllTracks() {
        const deletedCount = this.trackCache.length;
        const slowDeleted = this.slowQueries.length;
        
        this.trackCache = [];
        this.slowQueries = [];
        
        await this.saveCache();
        await this.saveSlowQueries();
        
        return {
            deleted: deletedCount,
            slowDeleted: slowDeleted,
            message: 'All tracking data cleared'
        };
    }

    async shutdown() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        await this.flush();
        console.log('Tracking system shutdown');
    }
}

module.exports = new TrackSystem();
