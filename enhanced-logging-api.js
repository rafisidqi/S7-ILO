const EnhancedS7ClientWithLogging = require('./EnhancedS7ClientWithLogging');
const http = require('http');
const url = require('url');
const fs = require('fs').promises;

class EnhancedS7LoggingHTTPServer {
    constructor(s7Config, httpPort = 3000) {
        this.s7client = new EnhancedS7ClientWithLogging(s7Config);
        this.httpPort = httpPort;
        this.server = null;
        this.currentData = {};
        this.enhancedData = {};
        this.isConnected = false;
        this.isSqlConnected = false;
        this.isLoggingEnabled = true;
        this.alarmHistory = [];
        this.maxAlarmHistory = 100;
        this.requestCount = 0;
        this.startTime = new Date();
        
        this.setupS7Events();
        this.createHTTPServer();
    }

    setupS7Events() {
        // Base events
        this.s7client.on('fully_initialized', () => {
            console.log('Enhanced S7 Client with Logging initialized');
        });

        this.s7client.on('connected', () => {
            console.log('S7 PLC Connected');
            this.isConnected = true;
        });

        this.s7client.on('sql_connected', () => {
            console.log('SQL Server Connected');
            this.isSqlConnected = true;
        });

        this.s7client.on('disconnected', () => {
            console.log('S7 PLC Disconnected');
            this.isConnected = false;
        });

        this.s7client.on('sql_disconnected', () => {
            console.log('SQL Server Disconnected');
            this.isSqlConnected = false;
        });

        this.s7client.on('error', (error) => {
            console.error('S7 Error:', error.message);
        });

        this.s7client.on('sql_error', (error) => {
            console.error('SQL Error:', error.message);
        });

        this.s7client.on('logging_error', (error) => {
            console.error('Logging Error:', error.message);
        });

        this.s7client.on('data', (values) => {
            this.currentData = { ...values };
        });

        this.s7client.on('enhanced_data', (data) => {
            this.enhancedData = { ...data };
        });

        // Logging events
        this.s7client.on('logging_state_changed', (state) => {
            this.isLoggingEnabled = state.enabled;
        });

        this.s7client.on('alarm', (alarm) => {
            console.log(`🚨 ALARM ${alarm.type}: ${alarm.tagName} = ${alarm.value}, Limit: ${alarm.limit}`);
            
            // Add to local alarm history for API
            this.alarmHistory.unshift({
                ...alarm,
                timestamp: new Date().toISOString(),
                acknowledged: false
            });

            if (this.alarmHistory.length > this.maxAlarmHistory) {
                this.alarmHistory = this.alarmHistory.slice(0, this.maxAlarmHistory);
            }
        });

        this.s7client.on('buffer_flushed', (info) => {
            console.log(`Flushed ${info.count} ${info.type} records to database`);
        });
    }

    createHTTPServer() {
        this.server = http.createServer((req, res) => {
            this.requestCount++;
            
            const parsedUrl = url.parse(req.url, true);
            const path = parsedUrl.pathname;
            const query = parsedUrl.query;

            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            try {
                this.handleRequest(req, res, path, query);
            } catch (error) {
                this.sendError(res, 500, error.message);
            }
        });
    }

    async handleRequest(req, res, path, query) {
        // Base API endpoints
        switch (path) {
            case '/api/status':
                this.handleStatus(req, res);
                break;
            case '/api/data':
                this.handleData(req, res);
                break;
            case '/api/enhanced-data':
                this.handleEnhancedData(req, res);
                break;
                
            // Logging-specific endpoints
            case '/api/logging/status':
                this.handleLoggingStatus(req, res);
                break;
            case '/api/logging/enable':
                await this.handleLoggingToggle(req, res, true);
                break;
            case '/api/logging/disable':
                await this.handleLoggingToggle(req, res, false);
                break;
            case '/api/logging/flush':
                await this.handleLoggingFlush(req, res);
                break;
            case '/api/logging/statistics':
                await this.handleLoggingStatistics(req, res);
                break;
                
            // Historical data endpoints
            case '/api/history':
                await this.handleHistoricalData(req, res, query);
                break;
            case '/api/history/summary':
                await this.handleDataSummary(req, res, query);
                break;
            case '/api/history/export':
                await this.handleDataExport(req, res, query);
                break;
                
            // Alarm endpoints
            case '/api/alarms/history':
                await this.handleAlarmHistory(req, res, query);
                break;
            case '/api/alarms/acknowledge':
                await this.handleAlarmAcknowledge(req, res);
                break;
                
            // Tag management (inherited)
            case '/api/tags':
                this.handleTags(req, res);
                break;
            case '/api/groups':
                this.handleGroups(req, res);
                break;
            case '/api/tag':
                await this.handleTagOperations(req, res);
                break;
                
            // Data operations
            case '/api/read':
                await this.handleRead(req, res, query);
                break;
            case '/api/write':
                await this.handleWrite(req, res);
                break;
                
            // SQL operations
            case '/api/sql/refresh':
                await this.handleSqlRefresh(req, res);
                break;
            case '/api/sql/test':
                await this.handleSqlTest(req, res);
                break;
                
            // Dashboard and documentation
            case '/':
                this.handleRoot(req, res);
                break;
            case '/api':
                this.handleApiDocumentation(req, res);
                break;
                
            default:
                this.sendError(res, 404, 'Not Found');
        }
    }

    handleStatus(req, res) {
        const status = this.s7client.getEnhancedStatusWithLogging();
        const response = {
            ...status,
            server: {
                uptime: Math.floor((new Date() - this.startTime) / 1000),
                requestCount: this.requestCount,
                startTime: this.startTime.toISOString()
            },
            activeAlarms: this.alarmHistory.filter(a => !a.acknowledged).length,
            totalAlarms: this.alarmHistory.length,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    handleLoggingStatus(req, res) {
        const status = this.s7client.getEnhancedStatusWithLogging();
        this.sendJSON(res, {
            logging: status.logging,
            timestamp: new Date().toISOString()
        });
    }

    async handleLoggingToggle(req, res, enable) {
        try {
            this.s7client.setLoggingEnabled(enable);
            
            this.sendJSON(res, {
                success: true,
                message: `Logging ${enable ? 'enabled' : 'disabled'}`,
                loggingEnabled: enable,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to ${enable ? 'enable' : 'disable'} logging: ${error.message}`);
        }
    }

    async handleLoggingFlush(req, res) {
        try {
            await this.s7client.flushLoggingBuffers();
            
            this.sendJSON(res, {
                success: true,
                message: 'All logging buffers flushed successfully',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to flush buffers: ${error.message}`);
        }
    }

    async handleLoggingStatistics(req, res) {
        try {
            const stats = await this.s7client.getLoggingStatistics();
            
            this.sendJSON(res, {
                statistics: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to get logging statistics: ${error.message}`);
        }
    }

    async handleHistoricalData(req, res, query) {
        try {
            const tagName = query.tag;
            const startDate = query.start ? new Date(query.start) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const endDate = query.end ? new Date(query.end) : new Date();
            const limit = parseInt(query.limit) || 1000;

            if (!tagName) {
                this.sendError(res, 400, 'Tag name is required');
                return;
            }

            const data = await this.s7client.getHistoricalData(tagName, startDate, endDate, limit);
            
            this.sendJSON(res, {
                tagName,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                recordCount: data.length,
                data: data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to get historical data: ${error.message}`);
        }
    }

    async handleDataSummary(req, res, query) {
        try {
            const startDate = query.start ? new Date(query.start) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const endDate = query.end ? new Date(query.end) : new Date();

            const summary = await this.s7client.generateDataSummary(startDate, endDate);
            
            this.sendJSON(res, {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                tagCount: summary.length,
                summary: summary,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to generate data summary: ${error.message}`);
        }
    }

    async handleDataExport(req, res, query) {
        try {
            const tagNames = query.tags ? query.tags.split(',') : null;
            const startDate = query.start ? new Date(query.start) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const endDate = query.end ? new Date(query.end) : new Date();
            const format = query.format || 'json';

            if (!tagNames || tagNames.length === 0) {
                this.sendError(res, 400, 'Tag names are required (use ?tags=tag1,tag2,tag3)');
                return;
            }

            if (format === 'csv') {
                const csvData = await this.s7client.exportDataToCSV(tagNames, startDate, endDate);
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="plc_data_${Date.now()}.csv"`);
                res.end(csvData);
            } else {
                // JSON format
                const data = {};
                for (const tagName of tagNames) {
                    data[tagName] = await this.s7client.getHistoricalData(tagName, startDate, endDate, 10000);
                }
                
                this.sendJSON(res, {
                    tags: tagNames,
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    format: 'json',
                    data: data,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            this.sendError(res, 500, `Failed to export data: ${error.message}`);
        }
    }

    async handleAlarmHistory(req, res, query) {
        try {
            const tagName = query.tag || null;
            const limit = parseInt(query.limit) || 100;

            const alarmHistory = await this.s7client.getAlarmHistory(tagName, limit);
            
            this.sendJSON(res, {
                tagName,
                recordCount: alarmHistory.length,
                alarmHistory: alarmHistory,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to get alarm history: ${error.message}`);
        }
    }

    async handleAlarmAcknowledge(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { alarmId, username } = JSON.parse(body);
                
                if (!alarmId) {
                    this.sendError(res, 400, 'Alarm ID is required');
                    return;
                }

                await this.s7client.acknowledgeAlarm(alarmId, username || 'API_USER');
                
                this.sendJSON(res, {
                    success: true,
                    message: `Alarm ${alarmId} acknowledged successfully`,
                    acknowledgedBy: username || 'API_USER',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.sendError(res, 500, `Failed to acknowledge alarm: ${error.message}`);
            }
        });
    }

    // Inherited methods with logging enhancements
    handleTags(req, res) {
        const allTags = this.s7client.getSqlTagManager().getAllTags();
        const response = {
            tags: allTags,
            count: allTags.length,
            loggingEnabled: this.isLoggingEnabled,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    handleGroups(req, res) {
        const groups = this.s7client.getTagGroups();
        const groupDetails = {};
        
        groups.forEach(groupName => {
            const groupTags = this.s7client.getTagsByGroup(groupName);
            groupDetails[groupName] = {
                count: groupTags.length,
                tags: groupTags.map(tag => ({
                    name: tag.name,
                    type: tag.type,
                    units: tag.units,
                    description: tag.description,
                    loggingEnabled: true // All tags with logging enabled by default
                }))
            };
        });

        this.sendJSON(res, {
            groups: groupDetails,
            totalGroups: groups.length,
            loggingEnabled: this.isLoggingEnabled,
            timestamp: new Date().toISOString()
        });
    }

    handleEnhancedData(req, res) {
        const response = {
            data: this.enhancedData,
            connected: this.isConnected,
            sqlConnected: this.isSqlConnected,
            loggingEnabled: this.isLoggingEnabled,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    async handleTagOperations(req, res) {
        if (!this.isSqlConnected) {
            this.sendError(res, 503, 'SQL Server not connected');
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const tagData = JSON.parse(body);
                    await this.s7client.saveTag(tagData);
                    this.sendJSON(res, { 
                        success: true, 
                        message: `Tag ${tagData.name} saved and logging enabled`,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.sendError(res, 500, `Failed to save tag: ${error.message}`);
                }
            });
        } else if (req.method === 'DELETE') {
            const parsedUrl = url.parse(req.url, true);
            const tagName = parsedUrl.query.name;
            
            if (!tagName) {
                this.sendError(res, 400, 'Tag name required');
                return;
            }

            try {
                await this.s7client.deleteTag(tagName);
                this.sendJSON(res, { 
                    success: true, 
                    message: `Tag ${tagName} deleted and logging disabled`,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.sendError(res, 500, `Failed to delete tag: ${error.message}`);
            }
        } else {
            this.sendError(res, 405, 'Method Not Allowed');
        }
    }

    async handleRead(req, res, query) {
        if (!this.isConnected) {
            this.sendError(res, 503, 'PLC not connected');
            return;
        }

        if (query.tag) {
            const enhancedTag = this.enhancedData[query.tag];
            const metadata = this.s7client.getTagMetadata(query.tag);
            
            if (enhancedTag) {
                this.sendJSON(res, { 
                    tag: query.tag,
                    value: enhancedTag.value,
                    rawValue: enhancedTag.rawValue,
                    metadata: metadata,
                    loggingEnabled: this.isLoggingEnabled,
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(res, 404, 'Tag not found');
            }
        } else {
            this.handleEnhancedData(req, res);
        }
    }

    async handleWrite(req, res) {
        if (!this.isConnected) {
            this.sendError(res, 503, 'PLC not connected');
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const writeData = JSON.parse(body);
                
                if (writeData.tag && writeData.value !== undefined) {
                    await this.s7client.writeVariable(writeData.tag, writeData.value);
                    this.sendJSON(res, { 
                        success: true, 
                        message: `Tag ${writeData.tag} written and logged`,
                        loggingEnabled: this.isLoggingEnabled,
                        timestamp: new Date().toISOString()
                    });
                } else if (writeData.tags) {
                    await this.s7client.writeVariables(writeData.tags);
                    this.sendJSON(res, { 
                        success: true, 
                        message: 'Tags written and logged successfully',
                        count: Object.keys(writeData.tags).length,
                        loggingEnabled: this.isLoggingEnabled,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    this.sendError(res, 400, 'Invalid write data format');
                }
            } catch (error) {
                this.sendError(res, 500, `Write failed: ${error.message}`);
            }
        });
    }

    async handleSqlRefresh(req, res) {
        if (!this.isSqlConnected) {
            this.sendError(res, 503, 'SQL Server not connected');
            return;
        }

        try {
            const result = await this.s7client.refreshTags();
            this.sendJSON(res, { 
                success: true, 
                message: 'Tags refreshed and logging updated',
                tagCount: result.count,
                timestamp: result.refreshTime
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to refresh tags: ${error.message}`);
        }
    }

    async handleSqlTest(req, res) {
        try {
            const testResults = await this.s7client.testConnections();
            this.sendJSON(res, { 
                success: true, 
                results: testResults,
                loggingStatus: this.isLoggingEnabled,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Connection test failed: ${error.message}`);
        }
    }

    handleApiDocumentation(req, res) {
        const documentation = {
            title: "Enhanced S7 PLC Client with Logging API",
            version: "1.0.0",
            description: "Complete API for S7 PLC communication with SQL Server data logging",
            endpoints: {
                "System Status": {
                    "GET /api/status": "Get complete system status including logging",
                    "GET /api/logging/status": "Get logging system status"
                },
                "Data Access": {
                    "GET /api/data": "Get current PLC data (raw)",
                    "GET /api/enhanced-data": "Get enhanced PLC data with metadata",
                    "GET /api/read?tag=NAME": "Read specific tag with metadata"
                },
                "Historical Data": {
                    "GET /api/history?tag=NAME&start=DATE&end=DATE&limit=N": "Get historical data for a tag",
                    "GET /api/history/summary?start=DATE&end=DATE": "Get data summary report",
                    "GET /api/history/export?tags=TAG1,TAG2&start=DATE&end=DATE&format=csv|json": "Export historical data"
                },
                "Data Logging": {
                    "POST /api/logging/enable": "Enable data logging",
                    "POST /api/logging/disable": "Disable data logging",
                    "POST /api/logging/flush": "Flush all logging buffers",
                    "GET /api/logging/statistics": "Get logging statistics"
                },
                "Alarms": {
                    "GET /api/alarms/history?tag=NAME&limit=N": "Get alarm history",
                    "POST /api/alarms/acknowledge": "Acknowledge alarm (body: {alarmId, username})"
                },
                "Tag Management": {
                    "GET /api/tags": "Get all tags with logging status",
                    "GET /api/groups": "Get tag groups",
                    "POST /api/tag": "Add/update tag",
                    "DELETE /api/tag?name=NAME": "Delete tag"
                },
                "Write Operations": {
                    "POST /api/write": "Write tag values (logged automatically)"
                },
                "SQL Operations": {
                    "POST /api/sql/refresh": "Refresh tags from database",
                    "GET /api/sql/test": "Test database connections"
                }
            },
            examples: {
                "Get historical data": "GET /api/history?tag=Motor1_Speed&start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z&limit=1000",
                "Export CSV data": "GET /api/history/export?tags=Motor1_Speed,Tank1_Level&format=csv",
                "Write with logging": "POST /api/write {\"tag\": \"Motor1_Running\", \"value\": true}",
                "Acknowledge alarm": "POST /api/alarms/acknowledge {\"alarmId\": 123, \"username\": \"operator1\"}"
            }
        };

        this.sendJSON(res, documentation);
    }

    handleRoot(req, res) {
        const status = this.s7client.getEnhancedStatusWithLogging();
        const activeAlarms = this.alarmHistory.filter(a => !a.acknowledged);
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        const loggingStats = status.logging.bufferCounts;
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Enhanced S7 PLC Client with Data Logging</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                }
                .container {
                    max-width: 1400px;
                    margin: 0 auto;
                    background: rgba(255,255,255,0.95);
                    border-radius: 15px;
                    padding: 30px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                    color: #333;
                }
                .header h1 {
                    margin: 0;
                    font-size: 2.5em;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .status-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .status-card {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    border-left: 4px solid;
                }
                .status-card.online { border-left-color: #28a745; }
                .status-card.offline { border-left-color: #dc3545; }
                .status-card.warning { border-left-color: #ffc107; }
                .status-card.info { border-left-color: #17a2b8; }
                .status { padding: 10px; border-radius: 5px; margin: 10px 0; font-weight: bold; text-align: center; }
                .online { background: #d4edda; color: #155724; }
                .offline { background: #f8d7da; color: #721c24; }
                .warning { background: #fff3cd; color: #856404; }
                .metric {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 0;
                    border-bottom: 1px solid #eee;
                }
                .metric:last-child { border-bottom: none; }
                .metric-label { font-weight: 600; color: #666; }
                .metric-value { font-weight: bold; color: #333; }
                .logging-section {
                    background: ${this.isLoggingEnabled ? '#d4edda' : '#fff3cd'};
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                    border-left: 4px solid ${this.isLoggingEnabled ? '#28a745' : '#ffc107'};
                }
                .api-section {
                    background: white;
                    padding: 25px;
                    border-radius: 10px;
                    margin: 20px 0;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .api-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 15px;
                }
                .api-category {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    border-left: 3px solid #007bff;
                }
                .api-endpoint { 
                    font-family: 'Courier New', monospace;
                    background: #e9ecef;
                    padding: 8px;
                    margin: 5px 0;
                    border-radius: 4px;
                    font-size: 0.9em;
                }
                .data-preview {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    font-family: 'Courier New', monospace;
                    max-height: 300px;
                    overflow-y: auto;
                    border: 1px solid #dee2e6;
                }
                .refresh-info {
                    text-align: center;
                    color: #6c757d;
                    margin-top: 20px;
                    font-style: italic;
                }
                .alarm-badge {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 0.8em;
                    font-weight: bold;
                    background: ${activeAlarms.length > 0 ? '#dc3545' : '#28a745'};
                    color: white;
                }
                .buffer-status {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .buffer-item {
                    background: #e9ecef;
                    padding: 5px 10px;
                    border-radius: 15px;
                    font-size: 0.9em;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🏭 Enhanced S7 PLC Client</h1>
                    <p style="font-size: 1.2em; color: #666; margin: 10px 0;">
                        Real-time monitoring and control with comprehensive data logging
                    </p>
                </div>
                
                <div class="status-grid">
                    <div class="status-card ${this.isConnected ? 'online' : 'offline'}">
                        <h3>🔌 PLC Connection</h3>
                        <div class="status ${this.isConnected ? 'online' : 'offline'}">
                            ${this.isConnected ? '✅ Connected' : '❌ Disconnected'}
                        </div>
                        <div class="metric">
                            <span class="metric-label">Address:</span>
                            <span class="metric-value">${this.s7client.config.address}:${this.s7client.config.port}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Variables:</span>
                            <span class="metric-value">${status.s7.variables}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Cycle Time:</span>
                            <span class="metric-value">${this.s7client.currentCycleTime}ms</span>
                        </div>
                    </div>
                    
                    <div class="status-card ${this.isSqlConnected ? 'online' : 'offline'}">
                        <h3>🗄️ SQL Server</h3>
                        <div class="status ${this.isSqlConnected ? 'online' : 'offline'}">
                            ${this.isSqlConnected ? '✅ Connected' : '❌ Disconnected'}
                        </div>
                        <div class="metric">
                            <span class="metric-label">Tags:</span>
                            <span class="metric-value">${status.tags.count}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Groups:</span>
                            <span class="metric-value">${status.tags.groups}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Last Refresh:</span>
                            <span class="metric-value">${status.sql.lastRefresh ? new Date(status.sql.lastRefresh).toLocaleString() : 'Never'}</span>
                        </div>
                    </div>
                    
                    <div class="status-card ${this.isLoggingEnabled ? 'online' : 'warning'}">
                        <h3>📊 Data Logging</h3>
                        <div class="status ${this.isLoggingEnabled ? 'online' : 'warning'}">
                            ${this.isLoggingEnabled ? '✅ Active' : '⚠️ Disabled'}
                        </div>
                        <div class="metric">
                            <span class="metric-label">Started:</span>
                            <span class="metric-value">${status.logging.startTime ? new Date(status.logging.startTime).toLocaleString() : 'N/A'}</span>
                        </div>
                        <div class="buffer-status">
                            <div class="buffer-item">Data: ${loggingStats.data}</div>
                            <div class="buffer-item">Alarms: ${loggingStats.alarms}</div>
                            <div class="buffer-item">Events: ${loggingStats.events}</div>
                        </div>
                    </div>
                    
                    <div class="status-card ${activeAlarms.length > 0 ? 'warning' : 'online'}">
                        <h3>⚠️ Alarms</h3>
                        <div class="status ${activeAlarms.length > 0 ? 'warning' : 'online'}">
                            <span class="alarm-badge">${activeAlarms.length > 0 ? activeAlarms.length : 0}</span>
                            ${activeAlarms.length > 0 ? ' Active Alarms' : ' No Active Alarms'}
                        </div>
                        <div class="metric">
                            <span class="metric-label">Total History:</span>
                            <span class="metric-value">${this.alarmHistory.length}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Last Alarm:</span>
                            <span class="metric-value">${this.alarmHistory.length > 0 ? new Date(this.alarmHistory[0].timestamp).toLocaleString() : 'None'}</span>
                        </div>
                    </div>
                    
                    <div class="status-card info">
                        <h3>📈 Server Stats</h3>
                        <div class="metric">
                            <span class="metric-label">Uptime:</span>
                            <span class="metric-value">${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Requests:</span>
                            <span class="metric-value">${this.requestCount}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Node.js:</span>
                            <span class="metric-value">${process.version}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Memory:</span>
                            <span class="metric-value">${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</span>
                        </div>
                    </div>
                </div>

                ${this.isLoggingEnabled ? `
                <div class="logging-section">
                    <h2>📊 Data Logging Active</h2>
                    <p><strong>✅ All PLC data is being automatically logged to SQL Server</strong></p>
                    <ul style="margin: 10px 0;">
                        <li>🔄 Continuous data logging every cycle (${this.s7client.currentCycleTime}ms)</li>
                        <li>🚨 Alarm events tracked and stored</li>
                        <li>📋 System events and user actions logged</li>
                        <li>📈 Historical data available via API</li>
                        <li>🗂️ Automatic data retention and cleanup</li>
                    </ul>
                </div>
                ` : `
                <div class="logging-section">
                    <h2>⚠️ Data Logging Disabled</h2>
                    <p><strong>Data logging is currently disabled. Enable it via the API:</strong></p>
                    <div class="api-endpoint">POST /api/logging/enable</div>
                </div>
                `}
                
                <div class="api-section">
                    <h2>🔗 Enhanced API Endpoints</h2>
                    <div class="api-grid">
                        <div class="api-category">
                            <h4>📊 Data Logging</h4>
                            <div class="api-endpoint">GET /api/logging/status</div>
                            <div class="api-endpoint">POST /api/logging/enable</div>
                            <div class="api-endpoint">POST /api/logging/disable</div>
                            <div class="api-endpoint">POST /api/logging/flush</div>
                            <div class="api-endpoint">GET /api/logging/statistics</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>📈 Historical Data</h4>
                            <div class="api-endpoint">GET /api/history?tag=NAME</div>
                            <div class="api-endpoint">GET /api/history/summary</div>
                            <div class="api-endpoint">GET /api/history/export</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🚨 Alarm Management</h4>
                            <div class="api-endpoint">GET /api/alarms/history</div>
                            <div class="api-endpoint">POST /api/alarms/acknowledge</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🏷️ Tag Operations</h4>
                            <div class="api-endpoint">GET /api/tags</div>
                            <div class="api-endpoint">GET /api/enhanced-data</div>
                            <div class="api-endpoint">POST /api/write</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🗄️ Database</h4>
                            <div class="api-endpoint">POST /api/sql/refresh</div>
                            <div class="api-endpoint">GET /api/sql/test</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>📋 System</h4>
                            <div class="api-endpoint">GET /api/status</div>
                            <div class="api-endpoint">GET /api</div>
                        </div>
                    </div>
                </div>
                
                <div class="api-section">
                    <h2>📊 Current Data Sample</h2>
                    <div class="data-preview">
${JSON.stringify(
    Object.fromEntries(
        Object.entries(this.enhancedData)
            .slice(0, 8)
            .map(([key, value]) => [key, {
                value: value.value,
                units: value.metadata?.units || 'N/A',
                group: value.metadata?.group || 'N/A',
                lastLogged: this.isLoggingEnabled ? 'Active' : 'Disabled'
            }])
    ), null, 2
)}
                    </div>
                    ${Object.keys(this.enhancedData).length > 8 ? 
                        `<p style="text-align: center; margin-top: 10px;">... and ${Object.keys(this.enhancedData).length - 8} more tags being logged</p>` : ''}
                </div>

                ${activeAlarms.length > 0 ? `
                <div class="api-section">
                    <h2>🚨 Active Alarms</h2>
                    ${activeAlarms.slice(0, 5).map(alarm => `
                        <div style="background: #f8d7da; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #dc3545;">
                            <strong>${alarm.tagName}</strong> - ${alarm.type} Alarm<br>
                            Value: ${alarm.value}, Limit: ${alarm.limit}<br>
                            <small>${new Date(alarm.timestamp).toLocaleString()}</small>
                        </div>
                    `).join('')}
                    ${activeAlarms.length > 5 ? `<p><em>... and ${activeAlarms.length - 5} more active alarms</em></p>` : ''}
                </div>
                ` : ''}
                
                <div class="refresh-info">
                    <p>🔄 Dashboard auto-refreshes every 10 seconds | Last updated: ${new Date().toLocaleString()}</p>
                    <p>💾 ${this.isLoggingEnabled ? 'Data logging is ACTIVE' : 'Data logging is DISABLED'} | 
                       📊 API Documentation: <a href="/api" target="_blank">/api</a></p>
                </div>
            </div>
            
            <script>
                // Auto refresh every 10 seconds
                setTimeout(() => location.reload(), 10000);
                
                // Add some interactive elements
                document.addEventListener('DOMContentLoaded', function() {
                    // Add click handlers for API endpoints
                    document.querySelectorAll('.api-endpoint').forEach(endpoint => {
                        endpoint.style.cursor = 'pointer';
                        endpoint.addEventListener('click', function() {
                            const url = this.textContent.split(' ')[1]; // Extract URL part
                            if (url && url.startsWith('/')) {
                                window.open(url, '_blank');
                            }
                        });
                    });
                });
            </script>
        </body>
        </html>`;
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    sendJSON(res, data) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data, null, 2));
    }

    sendError(res, status, message) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            error: message, 
            timestamp: new Date().toISOString() 
        }));
    }

    async start() {
        try {
            // Initialize Enhanced S7 client with logging
            await this.s7client.initialize();
            console.log('🎉 Enhanced S7 Client with Logging initialized successfully');

            // Start HTTP server
            this.server.listen(this.httpPort, () => {
                console.log(`🌐 Enhanced HTTP Server with Logging running on port ${this.httpPort}`);
                console.log(`📱 Dashboard: http://localhost:${this.httpPort}`);
                console.log(`📋 API Documentation: http://localhost:${this.httpPort}/api`);
                console.log(`📊 Logging Status: http://localhost:${this.httpPort}/api/logging/status`);
                console.log(`📈 Historical Data: http://localhost:${this.httpPort}/api/history?tag=TAGNAME`);
            });

        } catch (error) {
            console.error('❌ Failed to start Enhanced S7 Server with Logging:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        console.log('🔄 Shutting down Enhanced S7 HTTP Server with Logging...');
        
        if (this.server) {
            this.server.close();
        }
        
        await this.s7client.disconnect();
        console.log('✅ Enhanced S7 HTTP Server with Logging stopped');
        process.exit(0);
    }
}

// Configuration
const enhancedLoggingConfig = {
    // S7 PLC Configuration
    transport: 'iso-on-tcp',
    address: '192.168.1.10',
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 5000,    // 5 seconds for demonstration
    timeout: 2000,
    connmode: 'rack-slot',

    // SQL Server Configuration
    sqlConfig: {
        server: 'localhost\\SQLEXPRESS',
        database: 'PLCTags',
        tagTable: 'Tags',
        cacheRefreshInterval: 30000,
        enableAutoRefresh: true,
        options: {
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true,
            instanceName: 'SQLEXPRESS'
        }
    },

    // Enhanced Logging Configuration
    loggingConfig: {
        // Logging tables
        dataTable: 'DataHistory',
        alarmTable: 'AlarmHistory',
        eventTable: 'EventHistory',
        
        // Logging settings
        enableDataLogging: true,
        enableAlarmLogging: true,
        enableEventLogging: true,
        
        // Data logging options
        logInterval: 30000,          // Flush buffers every 30 seconds
        logOnChange: true,           // Log when values change significantly
        changeThreshold: 0.1,        // Minimum change to trigger logging
        maxBatchSize: 1000,          // Maximum records per batch
        
        // Data retention settings
        dataRetentionDays: 90,       // Keep data for 90 days
        alarmRetentionDays: 365,     // Keep alarms for 1 year
        eventRetentionDays: 30,      // Keep events for 30 days
        
        // Performance settings
        enableCompression: true,
        compressionRatio: 10,
        compressionAfterDays: 7
    }
};

const httpPort = process.env.PORT || 3000;
const server = new EnhancedS7LoggingHTTPServer(enhancedLoggingConfig, httpPort);

// Graceful shutdown
process.on('SIGINT', () => server.stop());
process.on('SIGTERM', () => server.stop());

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the enhanced server with logging
server.start().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
