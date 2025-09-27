const MultiPLCManager = require('./MultiPLCManager');
const http = require('http');
const url = require('url');
const sql = require('mssql/msnodesqlv8');

/**
 * Multi-PLC API Server - Enhanced for the new database schema
 * Provides comprehensive API for managing multiple PLCs with enhanced features
 */
class MultiPLCAPIServer {
    constructor(multiPLCConfig, httpPort = 3000) {
        this.multiPLCManager = new MultiPLCManager(multiPLCConfig);
        this.httpPort = httpPort;
        this.server = null;
        this.requestCount = 0;
        this.startTime = new Date();
        this.apiStats = {
            requests: {},
            errors: 0,
            lastError: null
        };
        
        this.setupMultiPLCEvents();
        this.createHTTPServer();
    }

    setupMultiPLCEvents() {
        this.multiPLCManager.on('initialized', () => {
            console.log('🎉 Multi-PLC Manager initialized');
        });

        this.multiPLCManager.on('plc_connected', (data) => {
            console.log(`✅ PLC connected: ${data.plcName}`);
        });

        this.multiPLCManager.on('plc_disconnected', (data) => {
            console.log(`❌ PLC disconnected: ${data.plcName}`);
        });

        this.multiPLCManager.on('plc_connection_failed', (data) => {
            console.log(`🚫 PLC connection failed: ${data.plcName} - ${data.error}`);
        });

        this.multiPLCManager.on('plc_alarm', (data) => {
            console.log(`🚨 ALARM from ${data.plcName}: ${data.type} - ${data.tagName}`);
        });

        this.multiPLCManager.on('configurations_changed', (data) => {
            console.log(`📋 PLC configurations changed: ${data.oldCount} -> ${data.newCount}`);
        });

        this.multiPLCManager.on('health_check_complete', (data) => {
            console.log(`💓 Health check: ${data.connectedPLCs}/${data.totalPLCs} PLCs connected`);
        });
    }

    createHTTPServer() {
        this.server = http.createServer((req, res) => {
            this.requestCount++;
            
            const parsedUrl = url.parse(req.url, true);
            const path = parsedUrl.pathname;
            const query = parsedUrl.query;

            // Track API usage
            if (!this.apiStats.requests[path]) {
                this.apiStats.requests[path] = 0;
            }
            this.apiStats.requests[path]++;

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
                this.apiStats.errors++;
                this.apiStats.lastError = { error: error.message, path, timestamp: new Date() };
                this.sendError(res, 500, error.message);
            }
        });
    }

    async handleRequest(req, res, path, query) {
        // System management endpoints
        switch (path) {
            case '/api/system/status':
                this.handleSystemStatus(req, res);
                break;
            case '/api/system/report':
                await this.handleSystemReport(req, res, query);
                break;
            case '/api/system/statistics':
                await this.handleSystemStatistics(req, res);
                break;
                
            // PLC management endpoints
            case '/api/plcs':
                await this.handlePLCs(req, res);
                break;
            case '/api/plcs/status':
                await this.handlePLCStatuses(req, res);
                break;
            case '/api/plc/connect':
                await this.handlePLCConnect(req, res, query);
                break;
            case '/api/plc/disconnect':
                await this.handlePLCDisconnect(req, res, query);
                break;
            case '/api/plc/add':
                await this.handleAddPLC(req, res);
                break;
                
            // Data access endpoints
            case '/api/data/all':
                this.handleAllPLCData(req, res);
                break;
            case '/api/data/plc':
                this.handlePLCData(req, res, query);
                break;
            case '/api/data/historical':
                await this.handleHistoricalData(req, res, query);
                break;
            case '/api/data/export':
                await this.handleDataExport(req, res, query);
                break;
                
            // Tag management endpoints
            case '/api/tags/add':
                await this.handleAddTags(req, res);
                break;
            case '/api/tags/plc':
                await this.handlePLCTags(req, res, query);
                break;
                
            // Write operations
            case '/api/write':
                await this.handleWrite(req, res);
                break;
                
            // Alarm management
            case '/api/alarms/history':
                await this.handleAlarmHistory(req, res, query);
                break;
            case '/api/alarms/acknowledge':
                await this.handleAlarmAcknowledge(req, res);
                break;
                
            // Configuration management
            case '/api/config/refresh':
                await this.handleConfigRefresh(req, res);
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

    handleSystemStatus(req, res) {
        const status = this.multiPLCManager.getSystemStatus();
        const response = {
            ...status,
            api: {
                uptime: Math.floor((new Date() - this.startTime) / 1000),
                requestCount: this.requestCount,
                startTime: this.startTime.toISOString(),
                stats: this.apiStats
            },
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    async handleSystemReport(req, res, query) {
        try {
            const reportType = query.type || 'summary';
            const timeRange = query.range || '24h';
            
            const report = await this.multiPLCManager.generateSystemReport(reportType, timeRange);
            this.sendJSON(res, report);
        } catch (error) {
            this.sendError(res, 500, `Failed to generate system report: ${error.message}`);
        }
    }

    async handleSystemStatistics(req, res) {
        try {
            // Get comprehensive statistics from the database
            const result = await this.multiPLCManager.connectionPool.request()
                .execute('sp_GetSystemStatistics');
            
            const statistics = {
                systemOverview: result.recordsets[0] ? result.recordsets[0][0] : {},
                dataLogging: result.recordsets[1] ? result.recordsets[1][0] : {},
                alarms: result.recordsets[2] ? result.recordsets[2][0] : {},
                topActiveTags: result.recordsets[3] || [],
                topAlarmedTags: result.recordsets[4] || [],
                recentEvents: result.recordsets[5] || [],
                databaseSize: result.recordsets[6] || [],
                multiPLCStats: this.multiPLCManager.getSystemStatus(),
                timestamp: new Date().toISOString()
            };
            
            this.sendJSON(res, statistics);
        } catch (error) {
            this.sendError(res, 500, `Failed to get system statistics: ${error.message}`);
        }
    }

    async handlePLCs(req, res) {
        if (req.method === 'GET') {
            // Get all PLC configurations
            const configs = Array.from(this.multiPLCManager.plcConfigurations.values());
            this.sendJSON(res, {
                plcs: configs,
                count: configs.length,
                timestamp: new Date().toISOString()
            });
        } else {
            this.sendError(res, 405, 'Method Not Allowed');
        }
    }

    async handlePLCStatuses(req, res) {
        try {
            const statuses = await this.multiPLCManager.getPLCStatuses();
            this.sendJSON(res, {
                statuses: statuses,
                count: statuses.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to get PLC statuses: ${error.message}`);
        }
    }

    async handlePLCConnect(req, res, query) {
        try {
            const plcName = query.plc;
            if (!plcName) {
                this.sendError(res, 400, 'PLC name is required');
                return;
            }

            await this.multiPLCManager.connectToPLC(plcName);
            this.sendJSON(res, {
                success: true,
                message: `Successfully connected to PLC: ${plcName}`,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to connect to PLC: ${error.message}`);
        }
    }

    async handlePLCDisconnect(req, res, query) {
        try {
            const plcName = query.plc;
            if (!plcName) {
                this.sendError(res, 400, 'PLC name is required');
                return;
            }

            await this.multiPLCManager.disconnectFromPLC(plcName);
            this.sendJSON(res, {
                success: true,
                message: `Successfully disconnected from PLC: ${plcName}`,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to disconnect from PLC: ${error.message}`);
        }
    }

    async handleAddPLC(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const plcData = JSON.parse(body);
                const result = await this.multiPLCManager.addPLCConfiguration(plcData);
                
                this.sendJSON(res, {
                    success: true,
                    message: `PLC ${plcData.name} added successfully`,
                    result: result,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.sendError(res, 500, `Failed to add PLC: ${error.message}`);
            }
        });
    }

    handleAllPLCData(req, res) {
        const allData = this.multiPLCManager.getAllPLCData();
        this.sendJSON(res, {
            data: allData,
            plcCount: Object.keys(allData).length,
            timestamp: new Date().toISOString()
        });
    }

    handlePLCData(req, res, query) {
        const plcName = query.plc;
        if (!plcName) {
            this.sendError(res, 400, 'PLC name is required');
            return;
        }

        const plcData = this.multiPLCManager.getPLCData(plcName);
        if (!plcData) {
            this.sendError(res, 404, `PLC ${plcName} not found or not connected`);
            return;
        }

        this.sendJSON(res, {
            plcName: plcName,
            ...plcData,
            timestamp: new Date().toISOString()
        });
    }

    async handleHistoricalData(req, res, query) {
        try {
            const filters = {
                plcName: query.plc,
                tagName: query.tag,
                groupName: query.group
            };
            
            const startDate = query.start ? new Date(query.start) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const endDate = query.end ? new Date(query.end) : new Date();
            const limit = parseInt(query.limit) || 1000;

            const data = await this.multiPLCManager.getMultiPLCHistoricalData(filters, startDate, endDate, limit);
            
            this.sendJSON(res, {
                filters: filters,
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

    async handleDataExport(req, res, query) {
        try {
            const options = {
                plcNames: query.plcs ? query.plcs.split(',') : null,
                tagNames: query.tags ? query.tags.split(',') : null,
                startDate: query.start ? new Date(query.start) : new Date(Date.now() - 24 * 60 * 60 * 1000),
                endDate: query.end ? new Date(query.end) : new Date(),
                includeMetadata: query.metadata !== 'false'
            };
            
            const format = query.format || 'json';

            if (format === 'csv') {
                const csvData = await this.multiPLCManager.exportMultiPLCData(options);
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="multi_plc_data_${Date.now()}.csv"`);
                res.end(csvData);
            } else {
                // JSON format
                const data = await this.multiPLCManager.getMultiPLCHistoricalData({
                    plcName: options.plcNames ? options.plcNames[0] : null,
                    tagName: options.tagNames ? options.tagNames[0] : null
                }, options.startDate, options.endDate, 10000);
                
                this.sendJSON(res, {
                    options: options,
                    format: 'json',
                    recordCount: data.length,
                    data: data,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            this.sendError(res, 500, `Failed to export data: ${error.message}`);
        }
    }

    async handleAddTags(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { plcName, tags } = JSON.parse(body);
                
                if (!plcName || !tags || !Array.isArray(tags)) {
                    this.sendError(res, 400, 'PLC name and tags array are required');
                    return;
                }

                const results = await this.multiPLCManager.addTagsToPLC(plcName, tags);
                
                this.sendJSON(res, {
                    success: true,
                    message: `Added ${tags.length} tags to PLC ${plcName}`,
                    results: results,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.sendError(res, 500, `Failed to add tags: ${error.message}`);
            }
        });
    }

    async handlePLCTags(req, res, query) {
        try {
            const plcName = query.plc;
            if (!plcName) {
                this.sendError(res, 400, 'PLC name is required');
                return;
            }

            const result = await this.multiPLCManager.connectionPool.request()
                .input('PLCName', sql.NVarChar, plcName)
                .execute('sp_GetTagsForPLC');

            this.sendJSON(res, {
                plcName: plcName,
                tags: result.recordset,
                count: result.recordset.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to get PLC tags: ${error.message}`);
        }
    }

    async handleWrite(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const writeData = JSON.parse(body);
                
                if (!writeData.plc || !writeData.tag || writeData.value === undefined) {
                    this.sendError(res, 400, 'PLC name, tag name, and value are required');
                    return;
                }

                const isEuValue = writeData.isEuValue !== false; // Default to true
                await this.multiPLCManager.writeToPLC(writeData.plc, writeData.tag, writeData.value, isEuValue);
                
                this.sendJSON(res, {
                    success: true,
                    message: `Successfully wrote ${writeData.value} to ${writeData.plc}.${writeData.tag}`,
                    plc: writeData.plc,
                    tag: writeData.tag,
                    value: writeData.value,
                    isEuValue: isEuValue,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.sendError(res, 500, `Write failed: ${error.message}`);
            }
        });
    }

    async handleAlarmHistory(req, res, query) {
        try {
            const filters = {
                plcName: query.plc,
                alarmType: query.type,
                severity: query.severity,
                startDate: query.start ? new Date(query.start) : null
            };
            
            const limit = parseInt(query.limit) || 100;
            const alarmHistory = await this.multiPLCManager.getMultiPLCAlarmHistory(filters, limit);
            
            this.sendJSON(res, {
                filters: filters,
                recordCount: alarmHistory.length,
                alarms: alarmHistory,
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

                // Use the first available PLC client to acknowledge the alarm
                const firstClient = Array.from(this.multiPLCManager.plcClients.values())[0];
                if (!firstClient) {
                    this.sendError(res, 503, 'No PLC clients available');
                    return;
                }

                await firstClient.acknowledgeAlarm(alarmId, username || 'API_USER');
                
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

    async handleConfigRefresh(req, res) {
        try {
            await this.multiPLCManager.loadPLCConfigurations();
            
            this.sendJSON(res, {
                success: true,
                message: 'PLC configurations refreshed successfully',
                plcCount: this.multiPLCManager.plcConfigurations.size,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.sendError(res, 500, `Failed to refresh configurations: ${error.message}`);
        }
    }

    handleApiDocumentation(req, res) {
        const documentation = {
            title: "Multi-PLC Management API",
            version: "2.1.0",
            description: "Comprehensive API for managing multiple S7 PLCs with enhanced database schema support",
            features: [
                "Dynamic PLC connection management",
                "Engineering units support",
                "Enhanced alarm management",
                "Comprehensive data logging",
                "Multi-PLC data aggregation",
                "Historical data analysis",
                "System monitoring and reporting"
            ],
            endpoints: {
                "System Management": {
                    "GET /api/system/status": "Get comprehensive system status",
                    "GET /api/system/report?type=summary&range=24h": "Generate system report",
                    "GET /api/system/statistics": "Get detailed system statistics"
                },
                "PLC Management": {
                    "GET /api/plcs": "Get all PLC configurations",
                    "GET /api/plcs/status": "Get detailed PLC statuses",
                    "POST /api/plc/connect?plc=NAME": "Connect to specific PLC",
                    "POST /api/plc/disconnect?plc=NAME": "Disconnect from PLC",
                    "POST /api/plc/add": "Add new PLC configuration"
                },
                "Data Access": {
                    "GET /api/data/all": "Get data from all connected PLCs",
                    "GET /api/data/plc?plc=NAME": "Get data from specific PLC",
                    "GET /api/data/historical?plc=NAME&tag=TAG&start=DATE&end=DATE": "Get historical data",
                    "GET /api/data/export?plcs=PLC1,PLC2&format=csv": "Export multi-PLC data"
                },
                "Tag Management": {
                    "POST /api/tags/add": "Add tags to PLC",
                    "GET /api/tags/plc?plc=NAME": "Get tags for specific PLC"
                },
                "Operations": {
                    "POST /api/write": "Write value to PLC tag",
                    "GET /api/alarms/history?plc=NAME": "Get alarm history",
                    "POST /api/alarms/acknowledge": "Acknowledge alarm"
                },
                "Configuration": {
                    "POST /api/config/refresh": "Refresh PLC configurations"
                }
            },
            examples: {
                "Add PLC": {
                    "method": "POST",
                    "url": "/api/plc/add",
                    "body": {
                        "name": "WWTP_NEW_PLC",
                        "description": "New WWTP PLC",
                        "address": "192.168.1.15",
                        "port": 102,
                        "rack": 0,
                        "slot": 2,
                        "location": "Building C",
                        "department": "Operations",
                        "systemType": "WWTP_Tertiary"
                    }
                },
                "Add Tags": {
                    "method": "POST",
                    "url": "/api/tags/add",
                    "body": {
                        "plcName": "WWTP_Main_PLC",
                        "tags": [
                            {
                                "name": "New_Flow_Meter",
                                "addr": "DB1,REAL100",
                                "type": "REAL",
                                "description": "New flow measurement",
                                "group": "Flow_Meters",
                                "rawMin": 0,
                                "rawMax": 32767,
                                "euMin": 0,
                                "euMax": 1000,
                                "units": "L/min",
                                "alarmHigh": 900,
                                "alarmLow": 50
                            }
                        ]
                    }
                },
                "Write Value": {
                    "method": "POST",
                    "url": "/api/write",
                    "body": {
                        "plc": "WWTP_Main_PLC",
                        "tag": "Pump1_Setpoint",
                        "value": 75.5,
                        "isEuValue": true
                    }
                },
                "Export Data": "GET /api/data/export?plcs=WWTP_Main_PLC,WWTP_Secondary_PLC&start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z&format=csv"
            },
            databaseSchema: {
                "PLCConnections": "PLC configuration and connection details",
                "PLCConnectionStatus": "Real-time PLC connection status",
                "Tags": "Enhanced tag definitions with engineering units",
                "DataHistory": "Historical data with raw and EU values",
                "AlarmHistory": "Comprehensive alarm tracking",
                "EventHistory": "System and user events"
            }
        };

        this.sendJSON(res, documentation);
    }

    handleRoot(req, res) {
        const systemStatus = this.multiPLCManager.getSystemStatus();
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Multi-PLC Management System</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                    min-height: 100vh;
                    color: #333;
                }
                .container {
                    max-width: 1600px;
                    margin: 0 auto;
                    background: rgba(255,255,255,0.95);
                    border-radius: 15px;
                    padding: 30px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .header h1 {
                    margin: 0;
                    font-size: 3em;
                    background: linear-gradient(135deg, #1e3c72, #2a5298);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .header .subtitle {
                    font-size: 1.3em;
                    color: #666;
                    margin: 10px 0;
                }
                .overview-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .overview-card {
                    background: white;
                    padding: 25px;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    border-left: 5px solid;
                    text-align: center;
                }
                .overview-card.system { border-left-color: #17a2b8; }
                .overview-card.plcs { border-left-color: #28a745; }
                .overview-card.data { border-left-color: #ffc107; }
                .overview-card.alarms { border-left-color: #dc3545; }
                .metric-number {
                    font-size: 2.5em;
                    font-weight: bold;
                    margin: 10px 0;
                }
                .metric-label {
                    color: #666;
                    font-size: 1.1em;
                }
                .plc-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 20px;
                    margin: 30px 0;
                }
                .plc-card {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    border-left: 4px solid;
                }
                .plc-card.connected { border-left-color: #28a745; }
                .plc-card.disconnected { border-left-color: #dc3545; }
                .plc-card.maintenance { border-left-color: #ffc107; }
                .plc-status {
                    display: inline-block;
                    padding: 4px 12px;
                    border-radius: 15px;
                    font-size: 0.9em;
                    font-weight: bold;
                    color: white;
                    margin: 5px 0;
                }
                .status-online { background: #28a745; }
                .status-offline { background: #dc3545; }
                .status-maintenance { background: #ffc107; color: #856404; }
                .api-section {
                    background: white;
                    padding: 25px;
                    border-radius: 10px;
                    margin: 20px 0;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .api-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                    gap: 20px;
                }
                .api-category {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    border-left: 4px solid #007bff;
                }
                .api-endpoint {
                    font-family: 'Courier New', monospace;
                    background: #e9ecef;
                    padding: 8px 12px;
                    margin: 8px 0;
                    border-radius: 4px;
                    font-size: 0.85em;
                    cursor: pointer;
                    transition: background-color 0.2s;
                }
                .api-endpoint:hover {
                    background: #dee2e6;
                }
                .refresh-info {
                    text-align: center;
                    color: #6c757d;
                    margin-top: 30px;
                    font-style: italic;
                }
                .feature-badge {
                    display: inline-block;
                    background: linear-gradient(135deg, #1e3c72, #2a5298);
                    color: white;
                    padding: 3px 8px;
                    border-radius: 12px;
                    font-size: 0.8em;
                    margin: 2px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🏭 Multi-PLC Management System</h1>
                    <div class="subtitle">Enhanced Industrial Automation Control & Monitoring</div>
                    <div style="margin-top: 15px;">
                        <span class="feature-badge">Dynamic PLC Management</span>
                        <span class="feature-badge">Engineering Units</span>
                        <span class="feature-badge">Enhanced Alarms</span>
                        <span class="feature-badge">Data Logging</span>
                        <span class="feature-badge">Historical Analysis</span>
                    </div>
                </div>
                
                <div class="overview-grid">
                    <div class="overview-card system">
                        <div class="metric-number">${systemStatus.system.initialized ? '✅' : '❌'}</div>
                        <div class="metric-label">System Status</div>
                        <div style="font-size: 0.9em; margin-top: 10px;">
                            Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m
                        </div>
                    </div>
                    
                    <div class="overview-card plcs">
                        <div class="metric-number">${systemStatus.plcs.connected}/${systemStatus.plcs.total}</div>
                        <div class="metric-label">PLCs Connected</div>
                        <div style="font-size: 0.9em; margin-top: 10px;">
                            Success Rate: ${systemStatus.connections.successRate.toFixed(1)}%
                        </div>
                    </div>
                    
                    <div class="overview-card data">
                        <div class="metric-number">${systemStatus.data.pointsLogged.toLocaleString()}</div>
                        <div class="metric-label">Data Points Logged</div>
                        <div style="font-size: 0.9em; margin-top: 10px;">
                            Active Loggers: ${systemStatus.data.loggingActive}
                        </div>
                    </div>
                    
                    <div class="overview-card alarms">
                        <div class="metric-number">${systemStatus.data.alarmsGenerated}</div>
                        <div class="metric-label">Alarms Generated</div>
                        <div style="font-size: 0.9em; margin-top: 10px;">
                            System Health: ${systemStatus.plcs.connected > 0 ? 'Good' : 'Check PLCs'}
                        </div>
                    </div>
                </div>
                
                <div class="api-section">
                    <h2>🔗 Multi-PLC API Endpoints</h2>
                    <div class="api-grid">
                        <div class="api-category">
                            <h4>🖥️ System Management</h4>
                            <div class="api-endpoint">GET /api/system/status</div>
                            <div class="api-endpoint">GET /api/system/report?type=summary</div>
                            <div class="api-endpoint">GET /api/system/statistics</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🏭 PLC Management</h4>
                            <div class="api-endpoint">GET /api/plcs</div>
                            <div class="api-endpoint">GET /api/plcs/status</div>
                            <div class="api-endpoint">POST /api/plc/add</div>
                            <div class="api-endpoint">POST /api/plc/connect?plc=NAME</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>📊 Data Access</h4>
                            <div class="api-endpoint">GET /api/data/all</div>
                            <div class="api-endpoint">GET /api/data/historical</div>
                            <div class="api-endpoint">GET /api/data/export?format=csv</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🏷️ Tag Management</h4>
                            <div class="api-endpoint">POST /api/tags/add</div>
                            <div class="api-endpoint">GET /api/tags/plc?plc=NAME</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>✍️ Operations</h4>
                            <div class="api-endpoint">POST /api/write</div>
                            <div class="api-endpoint">GET /api/alarms/history</div>
                            <div class="api-endpoint">POST /api/alarms/acknowledge</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>⚙️ Configuration</h4>
                            <div class="api-endpoint">POST /api/config/refresh</div>
                            <div class="api-endpoint">GET /api</div>
                        </div>
                    </div>
                </div>
                
                <div class="refresh-info">
                    <p>🔄 Dashboard auto-refreshes every 15 seconds | Last updated: ${new Date().toLocaleString()}</p>
                    <p>📚 Complete API Documentation: <a href="/api" target="_blank">/api</a> | 
                       🏭 Multi-PLC System v2.1.0</p>
                </div>
            </div>
            
            <script>
                // Auto refresh every 15 seconds
                setTimeout(() => location.reload(), 15000);
                
                // Add click handlers for API endpoints
                document.addEventListener('DOMContentLoaded', function() {
                    document.querySelectorAll('.api-endpoint').forEach(endpoint => {
                        endpoint.addEventListener('click', function() {
                            const text = this.textContent.trim();
                            const parts = text.split(' ');
                            if (parts.length >= 2 && parts[1].startsWith('/')) {
                                const url = parts[1];
                                if (parts[0] === 'GET') {
                                    window.open(url, '_blank');
                                } else {
                                    navigator.clipboard.writeText(text).then(() => {
                                        this.style.background = '#d4edda';
                                        setTimeout(() => {
                                            this.style.background = '#e9ecef';
                                        }, 1000);
                                    });
                                }
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
            // Initialize Multi-PLC Manager
            await this.multiPLCManager.initialize();
            console.log('🎉 Multi-PLC Manager initialized successfully');

            // Start HTTP server
            this.server.listen(this.httpPort, () => {
                console.log(`🌐 Multi-PLC API Server running on port ${this.httpPort}`);
                console.log(`📱 Dashboard: http://localhost:${this.httpPort}`);
                console.log(`📋 API Documentation: http://localhost:${this.httpPort}/api`);
                console.log(`🏭 System Status: http://localhost:${this.httpPort}/api/system/status`);
                console.log(`📊 PLC Status: http://localhost:${this.httpPort}/api/plcs/status`);
            });

        } catch (error) {
            console.error('❌ Failed to start Multi-PLC API Server:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        console.log('🔄 Shutting down Multi-PLC API Server...');
        
        if (this.server) {
            this.server.close();
        }
        
        await this.multiPLCManager.shutdown();
        console.log('✅ Multi-PLC API Server stopped');
        process.exit(0);
    }
}

// Configuration for the Multi-PLC system
const multiPLCConfig = {
    // SQL Server connection for PLC configuration
    server: 'localhost\\SQLEXPRESS',
    database: 'IndolaktoWWTP',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        instanceName: 'SQLEXPRESS'
    },
    
    // Multi-PLC settings
    maxConcurrentConnections: 10,
    connectionRetryInterval: 30000,
    autoReconnectEnabled: true,
    healthCheckInterval: 60000,
    priorityBasedConnection: true,
    
    // Logging configuration
    loggingConfig: {
        enableDataLogging: true,
        enableAlarmLogging: true,
        enableEventLogging: true,
        logInterval: 30000,
        dataRetentionDays: 90,
        alarmRetentionDays: 365,
        eventRetentionDays: 30
    }
};

// Start the Multi-PLC API Server
const httpPort = process.env.PORT || 3000;
const server = new MultiPLCAPIServer(multiPLCConfig, httpPort);

// Graceful shutdown handlers
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT signal, shutting down gracefully...');
    server.stop();
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM signal, shutting down gracefully...');
    server.stop();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Start the server
console.log('🚀 Starting Multi-PLC Management System...');
console.log('📋 Database: IndolaktoWWTP');
console.log('🔧 Features: Enhanced Schema, Engineering Units, Advanced Alarms, Multi-PLC Support');
console.log('');

server.start().catch(error => {
    console.error('❌ Fatal error starting Multi-PLC API Server:', error.message);
    process.exit(1);
});

module.exports = MultiPLCAPIServer;