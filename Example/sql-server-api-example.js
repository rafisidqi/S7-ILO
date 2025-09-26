const EnhancedS7Client = require('./EnhancedS7Client');
const http = require('http');
const url = require('url');

class EnhancedS7HTTPServer {
    constructor(s7Config, httpPort = 3000) {
        this.s7client = new EnhancedS7Client(s7Config);
        this.httpPort = httpPort;
        this.server = null;
        this.currentData = {};
        this.enhancedData = {};
        this.isConnected = false;
        this.isSqlConnected = false;
        this.alarmHistory = [];
        this.maxAlarmHistory = 100;
        
        this.setupS7Events();
        this.createHTTPServer();
    }

    setupS7Events() {
        this.s7client.on('initialized', () => {
            console.log('Enhanced S7 Client initialized');
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

        this.s7client.on('data', (values) => {
            this.currentData = { ...values };
        });

        this.s7client.on('enhanced_data', (data) => {
            this.enhancedData = { ...data };
        });

        this.s7client.on('alarm', (alarm) => {
            console.log(`🚨 ALARM ${alarm.type}: ${alarm.tagName} = ${alarm.value}, Limit: ${alarm.limit}`);
            
            // Add to alarm history
            this.alarmHistory.unshift({
                ...alarm,
                timestamp: new Date().toISOString(),
                acknowledged: false
            });

            // Limit alarm history size
            if (this.alarmHistory.length > this.maxAlarmHistory) {
                this.alarmHistory = this.alarmHistory.slice(0, this.maxAlarmHistory);
            }
        });

        this.s7client.on('tags_updated', (info) => {
            console.log(`Tags updated: ${info.tagCount} tags loaded`);
        });
    }

    createHTTPServer() {
        this.server = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const path = parsedUrl.pathname;
            const query = parsedUrl.query;

            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
            case '/api/tags':
                this.handleTags(req, res);
                break;
            case '/api/groups':
                this.handleGroups(req, res);
                break;
            case '/api/group':
                await this.handleGroup(req, res, query);
                break;
            case '/api/read':
                await this.handleRead(req, res, query);
                break;
            case '/api/write':
                await this.handleWrite(req, res);
                break;
            case '/api/tag':
                await this.handleTagOperations(req, res);
                break;
            case '/api/alarms':
                this.handleAlarms(req, res);
                break;
            case '/api/alarms/acknowledge':
                await this.handleAlarmAck(req, res);
                break;
            case '/api/sql/refresh':
                await this.handleSqlRefresh(req, res);
                break;
            case '/api/sql/test':
                await this.handleSqlTest(req, res);
                break;
            case '/api/cycle-time':
                await this.handleCycleTime(req, res);
                break;
            case '/':
                this.handleRoot(req, res);
                break;
            default:
                this.sendError(res, 404, 'Not Found');
        }
    }

    handleStatus(req, res) {
        const status = this.s7client.getEnhancedStatus();
        const response = {
            ...status,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            activeAlarms: this.alarmHistory.filter(a => !a.acknowledged).length,
            totalAlarms: this.alarmHistory.length
        };
        this.sendJSON(res, response);
    }

    handleData(req, res) {
        const response = {
            data: this.currentData,
            connected: this.isConnected,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    handleEnhancedData(req, res) {
        const response = {
            data: this.enhancedData,
            connected: this.isConnected,
            sqlConnected: this.isSqlConnected,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    handleTags(req, res) {
        const allTags = this.s7client.getSqlTagManager().getAllTags();
        const response = {
            tags: allTags,
            count: allTags.length,
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
                    description: tag.description
                }))
            };
        });

        this.sendJSON(res, {
            groups: groupDetails,
            totalGroups: groups.length,
            timestamp: new Date().toISOString()
        });
    }

    async handleGroup(req, res, query) {
        const groupName = query.group;
        if (!groupName) {
            this.sendError(res, 400, 'Group name required');
            return;
        }

        const groupTags = this.s7client.getTagsByGroup(groupName);
        const response = {
            group: groupName,
            tags: groupTags,
            count: groupTags.length,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
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
                    // Single tag write
                    await this.s7client.writeVariable(writeData.tag, writeData.value);
                    this.sendJSON(res, { 
                        success: true, 
                        message: `Tag ${writeData.tag} written successfully`,
                        timestamp: new Date().toISOString()
                    });
                } else if (writeData.tags) {
                    // Multiple tags write
                    await this.s7client.writeVariables(writeData.tags);
                    this.sendJSON(res, { 
                        success: true, 
                        message: 'Tags written successfully',
                        count: Object.keys(writeData.tags).length,
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

    async handleTagOperations(req, res) {
        if (!this.isSqlConnected) {
            this.sendError(res, 503, 'SQL Server not connected');
            return;
        }

        if (req.method === 'POST') {
            // Add new tag
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
                        message: `Tag ${tagData.name} saved successfully`,
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
                    message: `Tag ${tagName} deleted successfully`,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.sendError(res, 500, `Failed to delete tag: ${error.message}`);
            }
        } else {
            this.sendError(res, 405, 'Method Not Allowed');
        }
    }

    handleAlarms(req, res) {
        const activeAlarms = this.alarmHistory.filter(a => !a.acknowledged);
        const response = {
            activeAlarms: activeAlarms,
            alarmHistory: this.alarmHistory.slice(0, 20),
            activeCount: activeAlarms.length,
            totalCount: this.alarmHistory.length,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    async handleAlarmAck(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { alarmId, acknowledgeAll } = JSON.parse(body);
                
                if (acknowledgeAll) {
                    // Acknowledge all active alarms
                    this.alarmHistory.forEach(alarm => {
                        if (!alarm.acknowledged) {
                            alarm.acknowledged = true;
                            alarm.acknowledgedAt = new Date().toISOString();
                        }
                    });
                    
                    this.sendJSON(res, { 
                        success: true, 
                        message: 'All alarms acknowledged',
                        timestamp: new Date().toISOString()
                    });
                } else if (alarmId !== undefined) {
                    // Acknowledge specific alarm
                    const alarm = this.alarmHistory[alarmId];
                    if (alarm) {
                        alarm.acknowledged = true;
                        alarm.acknowledgedAt = new Date().toISOString();
                        
                        this.sendJSON(res, { 
                            success: true, 
                            message: 'Alarm acknowledged',
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        this.sendError(res, 404, 'Alarm not found');
                    }
                } else {
                    this.sendError(res, 400, 'Invalid acknowledgment data');
                }
            } catch (error) {
                this.sendError(res, 500, `Failed to acknowledge alarm: ${error.message}`);
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
                message: 'Tags refreshed successfully',
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
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Connection test failed: ${error.message}`);
        }
    }

    async handleCycleTime(req, res) {
        if (req.method === 'GET') {
            this.sendJSON(res, { 
                cycleTime: this.s7client.currentCycleTime,
                timestamp: new Date().toISOString()
            });
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                try {
                    const { cycleTime } = JSON.parse(body);
                    this.s7client.updateCycleTime(cycleTime);
                    this.sendJSON(res, { 
                        success: true, 
                        message: `Cycle time updated to ${cycleTime}ms`,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.sendError(res, 400, `Failed to update cycle time: ${error.message}`);
                }
            });
        } else {
            this.sendError(res, 405, 'Method Not Allowed');
        }
    }

    handleRoot(req, res) {
        const status = this.s7client.getEnhancedStatus();
        const activeAlarms = this.alarmHistory.filter(a => !a.acknowledged);
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Enhanced S7 PLC Client</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background-color: #f5f5f5;
                }
                .header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .status-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    margin-bottom: 20px;
                }
                .status-card {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    border-left: 4px solid #667eea;
                }
                .status { padding: 15px; border-radius: 8px; margin: 10px 0; font-weight: bold; }
                .online { background-color: #d4edda; color: #155724; border-left: 4px solid #28a745; }
                .offline { background-color: #f8d7da; color: #721c24; border-left: 4px solid #dc3545; }
                .warning { background-color: #fff3cd; color: #856404; border-left: 4px solid #ffc107; }
                .api-section {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .api-endpoint { 
                    background-color: #f8f9fa; 
                    padding: 12px; 
                    margin: 8px 0; 
                    border-left: 3px solid #007bff; 
                    border-radius: 4px;
                    font-family: monospace;
                }
                .alarm-section {
                    background: ${activeAlarms.length > 0 ? '#fff3cd' : 'white'};
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    ${activeAlarms.length > 0 ? 'border-left: 4px solid #ffc107;' : ''}
                }
                .alarm-item {
                    background: #f8d7da;
                    padding: 10px;
                    margin: 5px 0;
                    border-radius: 4px;
                    border-left: 3px solid #dc3545;
                }
                .data-section {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                pre { 
                    background-color: #f8f9fa; 
                    padding: 15px; 
                    overflow-x: auto; 
                    border-radius: 4px;
                    border: 1px solid #e9ecef;
                }
                .tag-group {
                    margin: 10px 0;
                    padding: 10px;
                    background: #f8f9fa;
                    border-radius: 4px;
                }
                .refresh-info {
                    font-size: 0.9em;
                    color: #6c757d;
                    text-align: center;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🏭 Enhanced S7 PLC Client Dashboard</h1>
                <p>Real-time monitoring and control with SQL Server integration</p>
            </div>
            
            <div class="status-grid">
                <div class="status-card">
                    <h3>🔌 PLC Connection</h3>
                    <div class="status ${this.isConnected ? 'online' : 'offline'}">
                        ${this.isConnected ? '✅ Connected' : '❌ Disconnected'}
                    </div>
                    <p><strong>Address:</strong> ${this.s7client.config.address}:${this.s7client.config.port}</p>
                    <p><strong>Variables:</strong> ${status.s7.variables}</p>
                </div>
                
                <div class="status-card">
                    <h3>🗄️ SQL Server</h3>
                    <div class="status ${this.isSqlConnected ? 'online' : 'offline'}">
                        ${this.isSqlConnected ? '✅ Connected' : '❌ Disconnected'}
                    </div>
                    <p><strong>Tags:</strong> ${status.tags.count}</p>
                    <p><strong>Groups:</strong> ${status.tags.groups}</p>
                    <p><strong>Last Refresh:</strong> ${status.sql.lastRefresh ? new Date(status.sql.lastRefresh).toLocaleString() : 'Never'}</p>
                </div>
                
                <div class="status-card">
                    <h3>⚠️ Alarms</h3>
                    <div class="status ${activeAlarms.length > 0 ? 'warning' : 'online'}">
                        ${activeAlarms.length > 0 ? `🚨 ${activeAlarms.length} Active` : '✅ No Alarms'}
                    </div>
                    <p><strong>Total History:</strong> ${this.alarmHistory.length}</p>
                </div>
                
                <div class="status-card">
                    <h3>📊 System Info</h3>
                    <p><strong>Uptime:</strong> ${Math.floor(process.uptime() / 60)} minutes</p>
                    <p><strong>Cycle Time:</strong> ${this.s7client.currentCycleTime}ms</p>
                    <p><strong>Node.js:</strong> ${process.version}</p>
                </div>
            </div>

            ${activeAlarms.length > 0 ? `
            <div class="alarm-section">
                <h2>🚨 Active Alarms</h2>
                ${activeAlarms.slice(0, 5).map(alarm => `
                    <div class="alarm-item">
                        <strong>${alarm.tagName}</strong> - ${alarm.type} Alarm<br>
                        Value: ${alarm.value}, Limit: ${alarm.limit}<br>
                        <small>${new Date(alarm.timestamp).toLocaleString()}</small>
                    </div>
                `).join('')}
                ${activeAlarms.length > 5 ? `<p>... and ${activeAlarms.length - 5} more alarms</p>` : ''}
            </div>
            ` : ''}
            
            <div class="api-section">
                <h2>🔗 API Endpoints</h2>
                <div class="api-endpoint"><strong>GET /api/status</strong> - System status</div>
                <div class="api-endpoint"><strong>GET /api/enhanced-data</strong> - All PLC data with metadata</div>
                <div class="api-endpoint"><strong>GET /api/tags</strong> - All configured tags</div>
                <div class="api-endpoint"><strong>GET /api/groups</strong> - Tag groups</div>
                <div class="api-endpoint"><strong>GET /api/group?group=Motors</strong> - Tags by group</div>
                <div class="api-endpoint"><strong>GET /api/read?tag=Motor1_Running</strong> - Read specific tag</div>
                <div class="api-endpoint"><strong>POST /api/write</strong> - Write tag values</div>
                <div class="api-endpoint"><strong>GET /api/alarms</strong> - Alarm information</div>
                <div class="api-endpoint"><strong>POST /api/tag</strong> - Add/update tag</div>
                <div class="api-endpoint"><strong>DELETE /api/tag?name=TagName</strong> - Delete tag</div>
                <div class="api-endpoint"><strong>POST /api/sql/refresh</strong> - Refresh tags from SQL</div>
                <div class="api-endpoint"><strong>GET /api/sql/test</strong> - Test connections</div>
            </div>
            
            <div class="data-section">
                <h2>📊 Current Data (First 10 Tags)</h2>
                <pre>${JSON.stringify(
                    Object.fromEntries(
                        Object.entries(this.enhancedData)
                            .slice(0, 10)
                            .map(([key, value]) => [key, {
                                value: value.value,
                                units: value.metadata?.units || 'N/A',
                                group: value.metadata?.group || 'N/A'
                            }])
                    ), null, 2
                )}</pre>
                ${Object.keys(this.enhancedData).length > 10 ? 
                    `<p>... and ${Object.keys(this.enhancedData).length - 10} more tags</p>` : ''}
            </div>

            <div class="refresh-info">
                <p>🔄 Page auto-refreshes every 5 seconds | Last updated: ${new Date().toLocaleString()}</p>
            </div>
            
            <script>
                // Auto refresh every 5 seconds
                setTimeout(() => location.reload(), 5000);
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
            // Initialize Enhanced S7 client
            await this.s7client.initialize();
            console.log('Enhanced S7 Client initialized successfully');

            // Start HTTP server
            this.server.listen(this.httpPort, () => {
                console.log(`🌐 Enhanced HTTP Server running on port ${this.httpPort}`);
                console.log(`📱 Dashboard: http://localhost:${this.httpPort}`);
                console.log(`🔗 API: http://localhost:${this.httpPort}/api/status`);
                console.log(`🏷️ Tags: http://localhost:${this.httpPort}/api/tags`);
            });

        } catch (error) {
            console.error('❌ Failed to start Enhanced S7 Server:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        console.log('🔄 Shutting down Enhanced S7 HTTP Server...');
        
        if (this.server) {
            this.server.close();
        }
        
        await this.s7client.disconnect();
        console.log('✅ Enhanced S7 HTTP Server stopped');
        process.exit(0);
    }
}

// Configuration
const enhancedConfig = {
    // S7 PLC Configuration
    transport: 'iso-on-tcp',
    address: '192.168.1.10',
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 1000,
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
    }
};

const httpPort = process.env.PORT || 3000;
const server = new EnhancedS7HTTPServer(enhancedConfig, httpPort);

// Graceful shutdown
process.on('SIGINT', () => server.stop());
process.on('SIGTERM', () => server.stop());

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the enhanced server
server.start().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
