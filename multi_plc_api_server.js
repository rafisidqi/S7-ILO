            // Write Operations
            case '/api/write/tag':
                await this.handleWriteTag(req, res);
                break;
            case '/api/write/multiple':
                await this.handleWriteMultiple(req, res);
                break;

            // Alarm Management
            case '/api/alarms/all':
                this.handleAllAlarms(req, res);
                break;
            case '/api/alarms/plc':
                this.handlePLCAlarms(req, res, query);
                break;
            case '/api/alarms/acknowledge':
                await this.handleAcknowledgeAlarm(req, res);
                break;
            case '/api/alarms/active':
                this.handleActiveAlarms(req, res);
                break;

            // Tag Management
            case '/api/tags/all':
                this.handleAllTags(req, res);
                break;
            case '/api/tags/plc':
                this.handlePLCTags(req, res, query);
                break;
            case '/api/tags/groups':
                this.handleTagGroups(req, res, query);
                break;

            // Configuration Management
            case '/api/config/refresh':
                await this.handleConfigRefresh(req, res);
                break;
            case '/api/config/export':
                await this.handleConfigExport(req, res);
                break;
            case '/api/config/import':
                await this.handleConfigImport(req, res);
                break;

            // Historical Data (if needed)
            case '/api/history/plc':
                await this.handlePLCHistory(req, res, query);
                break;
            case '/api/history/tag':
                await this.handleTagHistory(req, res, query);
                break;

            default:
                this.sendError(res, 404, 'Endpoint not found');
        }
    }

    handleSystemStatus(req, res) {
        const status = this.plcManager.getDetailedStatus();
        
        const response = {
            ...status,
            server: {
                uptime: Math.floor((new Date() - this.startTime) / 1000),
                requestCount: this.requestCount,
                startTime: this.startTime.toISOString(),
                alerts: this.lastAlerts.slice(0, 5),
                version: '2.1.0'
            }
        };
        
        this.sendJSON(res, response);
    }

    handleSystemStats(req, res) {
        const stats = this.plcManager.getSystemStats();
        this.sendJSON(res, {
            ...stats,
            timestamp: new Date().toISOString()
        });
    }

    handleSystemAlerts(req, res) {
        const limit = parseInt(req.url.split('limit=')[1]) || 20;
        this.sendJSON(res, {
            alerts: this.lastAlerts.slice(0, limit),
            total: this.lastAlerts.length,
            timestamp: new Date().toISOString()
        });
    }

    async handlePLCs(req, res) {
        if (req.method === 'GET') {
            // Get all PLC configurations
            const configs = Array.from(this.plcManager.plcConfigs.values());
            const statuses = Array.from(this.plcManager.plcStatus.values());
            
            const plcs = configs.map(config => {
                const client = this.plcManager.plcClients.get(config.plcName);
                const status = this.plcManager.plcStatus.get(config.plcName);
                
                return {
                    ...config,
                    runtime: {
                        connected: client ? client.connected : false,
                        status: client ? client.getStatus() : 'OFFLINE',
                        hasClient: !!client,
                        localStatus: status
                    }
                };
            });
            
            this.sendJSON(res, {
                plcs: plcs,
                summary: {
                    total: plcs.length,
                    connected: plcs.filter(p => p.runtime.connected).length,
                    enabled: plcs.filter(p => p.enabled).length,
                    autoConnect: plcs.filter(p => p.autoConnect).length
                },
                timestamp: new Date().toISOString()
            });
            
        } else if (req.method === 'POST') {
            // Add new PLC
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const plcConfig = JSON.parse(body);
                    const result = await this.plcManager.addOrUpdatePLC(plcConfig);
                    
                    this.sendJSON(res, {
                        success: true,
                        message: `PLC ${plcConfig.plcName} added/updated successfully`,
                        result: result,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.sendError(res, 500, `Failed to add PLC: ${error.message}`);
                }
            });
        } else {
            this.sendError(res, 405, 'Method not allowed');
        }
    }

    handlePLCsStatus(req, res) {
        const statuses = [];
        
        for (const [plcName, config] of this.plcManager.plcConfigs) {
            const client = this.plcManager.plcClients.get(plcName);
            const status = this.plcManager.plcStatus.get(plcName);
            
            statuses.push({
                plcName,
                enabled: config.enabled,
                autoConnect: config.autoConnect,
                priority: config.priority,
                connected: client ? client.connected : false,
                status: client ? client.getStatus() : 'OFFLINE',
                lastUpdate: status ? status.lastUpdate : null,
                cycleCount: status ? status.cycleCount : 0,
                dataPoints: status ? status.dataPoints : 0,
                alarmCount: status ? status.alarmCount : 0,
                retryCount: status ? status.retryCount : 0,
                lastError: status ? status.lastError : null
            });
        }
        
        this.sendJSON(res, {
            statuses: statuses,
            summary: {
                total: statuses.length,
                connected: statuses.filter(s => s.connected).length,
                enabled: statuses.filter(s => s.enabled).length,
                errors: statuses.filter(s => s.lastError).length
            },
            timestamp: new Date().toISOString()
        });
    }

    async handlePLCsHealth(req, res) {
        try {
            // Trigger immediate health check
            await this.plcManager.performHealthCheck();
            
            const healthData = this.plcManager.getDetailedStatus();
            
            this.sendJSON(res, {
                health: healthData,
                recommendation: this.generateHealthRecommendations(healthData),
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.sendError(res, 500, `Health check failed: ${error.message}`);
        }
    }

    generateHealthRecommendations(healthData) {
        const recommendations = [];
        
        healthData.plcStatuses.forEach(plc => {
            if (!plc.connected && plc.config.enabled) {
                recommendations.push({
                    type: 'warning',
                    plc: plc.plcName,
                    message: 'PLC is enabled but not connected - check network connectivity',
                    action: 'reconnect'
                });
            }
            
            if (plc.localStatus && plc.localStatus.retryCount > 2) {
                recommendations.push({
                    type: 'error',
                    plc: plc.plcName,
                    message: 'Multiple connection retries - check PLC configuration',
                    action: 'check_config'
                });
            }
            
            if (plc.alarmCount > 10) {
                recommendations.push({
                    type: 'info',
                    plc: plc.plcName,
                    message: 'High alarm count - review alarm thresholds',
                    action: 'review_alarms'
                });
            }
        });
        
        return recommendations;
    }

    async handlePLCConnect(req, res) {
        const plcName = req.url.split('plc=')[1]?.split('&')[0];
        
        if (!plcName) {
            this.sendError(res, 400, 'PLC name required (?plc=NAME)');
            return;
        }
        
        try {
            await this.plcManager.connectToPLC(plcName);
            
            this.sendJSON(res, {
                success: true,
                message: `Successfully connected to PLC ${plcName}`,
                plcName: plcName,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.sendError(res, 500, `Failed to connect to PLC ${plcName}: ${error.message}`);
        }
    }

    async handlePLCDisconnect(req, res) {
        const plcName = req.url.split('plc=')[1]?.split('&')[0];
        
        if (!plcName) {
            this.sendError(res, 400, 'PLC name required (?plc=NAME)');
            return;
        }
        
        try {
            await this.plcManager.disconnectFromPLC(plcName);
            
            this.sendJSON(res, {
                success: true,
                message: `Successfully disconnected from PLC ${plcName}`,
                plcName: plcName,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.sendError(res, 500, `Failed to disconnect from PLC ${plcName}: ${error.message}`);
        }
    }

    async handlePLCEnable(req, res) {
        const plcName = req.url.split('plc=')[1]?.split('&')[0];
        const enabled = req.url.includes('enabled=false') ? false : true;
        
        if (!plcName) {
            this.sendError(res, 400, 'PLC name required (?plc=NAME&enabled=true/false)');
            return;
        }
        
        try {
            await this.plcManager.enablePLC(plcName, enabled);
            
            this.sendJSON(res, {
                success: true,
                message: `PLC ${plcName} ${enabled ? 'enabled' : 'disabled'} successfully`,
                plcName: plcName,
                enabled: enabled,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.sendError(res, 500, `Failed to ${enabled ? 'enable' : 'disable'} PLC ${plcName}: ${error.message}`);
        }
    }

    async handlePLCConfig(req, res) {
        if (req.method === 'GET') {
            const plcName = req.url.split('plc=')[1]?.split('&')[0];
            
            if (plcName) {
                const config = this.plcManager.plcConfigs.get(plcName);
                if (config) {
                    this.sendJSON(res, { config, timestamp: new Date().toISOString() });
                } else {
                    this.sendError(res, 404, `PLC ${plcName} not found`);
                }
            } else {
                // Get all configurations
                const configs = Array.from(this.plcManager.plcConfigs.values());
                this.sendJSON(res, { configs, count: configs.length, timestamp: new Date().toISOString() });
            }
            
        } else if (req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const configUpdate = JSON.parse(body);
                    const result = await this.plcManager.addOrUpdatePLC(configUpdate);
                    
                    this.sendJSON(res, {
                        success: true,
                        message: `PLC configuration updated successfully`,
                        result: result,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.sendError(res, 500, `Failed to update PLC configuration: ${error.message}`);
                }
            });
        } else {
            this.sendError(res, 405, 'Method not allowed');
        }
    }

    handleAllData(req, res) {
        const allData = this.plcManager.getAllData();
        const summary = {
            totalTags: Object.keys(allData).length,
            plcs: [...new Set(Object.keys(allData).map(key => key.split('.')[0]))],
            lastUpdate: Math.max(...Object.values(allData).map(d => new Date(d.timestamp).getTime()))
        };
        
        this.sendJSON(res, {
            data: allData,
            summary: summary,
            timestamp: new Date().toISOString()
        });
    }

    handlePLCData(req, res, query) {
        const plcName = query.plc;
        
        if (!plcName) {
            this.sendError(res, 400, 'PLC name required (?plc=NAME)');
            return;
        }
        
        const plcData = this.plcManager.getPLCData(plcName);
        
        this.sendJSON(res, {
            plcName: plcName,
            data: plcData,
            tagCount: Object.keys(plcData).length,
            timestamp: new Date().toISOString()
        });
    }

    handleTagData(req, res, query) {
        const plcName = query.plc;
        const tagName = query.tag;
        
        if (!plcName || !tagName) {
            this.sendError(res, 400, 'PLC name and tag name required (?plc=NAME&tag=TAG)');
            return;
        }
        
        try {
            const tagData = this.plcManager.readTag(plcName, tagName);
            
            this.sendJSON(res, {
                plcName: plcName,
                tagName: tagName,
                data: tagData,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.sendError(res, 404, error.message);
        }
    }

    handleAggregatedData(req, res, query) {
        const groupBy = query.groupBy || 'plc'; // 'plc' or 'group'
        const allData = this.plcManager.getAllData();
        const aggregated = {};
        
        Object.entries(allData).forEach(([fullTagName, data]) => {
            const [plcName, tagName] = fullTagName.split('.');
            let groupKey;
            
            if (groupBy === 'plc') {
                groupKey = plcName;
            } else if (groupBy === 'group') {
                groupKey = data.metadata?.group || 'Unknown';
            } else {
                groupKey = 'All';
            }
            
            if (!aggregated[groupKey]) {
                aggregated[groupKey] = {};
            }
            
            aggregated[groupKey][fullTagName] = data;
        });
        
        this.sendJSON(res, {
            aggregatedData: aggregated,
            groupBy: groupBy,
            groupCount: Object.keys(aggregated).length,
            timestamp: new Date().toISOString()
        });
    }

    async handleWriteTag(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { plcName, tagName, value, isEuValue = true } = JSON.parse(body);
                
                if (!plcName || !tagName || value === undefined) {
                    this.sendError(res, 400, 'plcName, tagName, and value are required');
                    return;
                }
                
                await this.plcManager.writeTag(plcName, tagName, value, isEuValue);
                
                this.sendJSON(res, {
                    success: true,
                    message: `Successfully wrote ${value} to ${plcName}.${tagName}`,
                    write: { plcName, tagName, value, isEuValue },
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                this.sendError(res, 500, `Write failed: ${error.message}`);
            }
        });
    }

    async handleWriteMultiple(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { writes } = JSON.parse(body);
                
                if (!writes || !Array.isArray(writes)) {
                    this.sendError(res, 400, 'writes array is required');
                    return;
                }
                
                const results = await this.plcManager.writeMultipleTags(writes);
                
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;
                
                this.sendJSON(res, {
                    success: failed === 0,
                    message: `Write operation completed: ${successful} successful, ${failed} failed`,
                    results: results,
                    summary: { successful, failed, total: writes.length },
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                this.sendError(res, 500, `Multiple write failed: ${error.message}`);
            }
        });
    }

    handleAllAlarms(req, res) {
        const allAlarms = this.plcManager.getAllAlarms();
        
        this.sendJSON(res, {
            alarms: allAlarms,
            count: allAlarms.length,
            activeCount: allAlarms.filter(a => a.state === 'ACTIVE').length,
            acknowledgedCount: allAlarms.filter(a => a.state === 'ACKNOWLEDGED').length,
            timestamp: new Date().toISOString()
        });
    }

    handlePLCAlarms(req, res, query) {
        const plcName = query.plc;
        
        if (!plcName) {
            this.sendError(res, 400, 'PLC name required (?plc=NAME)');
            return;
        }
        
        const plcAlarms = this.plcManager.getPLCAlarms(plcName);
        
        this.sendJSON(res, {
            plcName: plcName,
            alarms: plcAlarms,
            count: plcAlarms.length,
            timestamp: new Date().toISOString()
        });
    }

    handleActiveAlarms(req, res) {
        const activeAlarms = this.plcManager.getAllAlarms()
            .filter(alarm => alarm.state === 'ACTIVE');
        
        this.sendJSON(res, {
            activeAlarms: activeAlarms,
            count: activeAlarms.length,
            byPLC: this.groupAlarmsByPLC(activeAlarms),
            timestamp: new Date().toISOString()
        });
    }

    groupAlarmsByPLC(alarms) {
        const grouped = {};
        alarms.forEach(alarm => {
            if (!grouped[alarm.plcName]) {
                grouped[alarm.plcName] = [];
            }
            grouped[alarm.plcName].push(alarm);
        });
        return grouped;
    }

    async handleAcknowledgeAlarm(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { alarmId, username = 'API_USER' } = JSON.parse(body);
                
                if (!alarmId) {
                    this.sendError(res, 400, 'alarmId is required');
                    return;
                }
                
                await this.plcManager.acknowledgeAlarm(alarmId, username);
                
                this.sendJSON(res, {
                    success: true,
                    message: `Alarm ${alarmId} acknowledged successfully`,
                    alarmId: alarmId,
                    acknowledgedBy: username,
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                this.sendError(res, 500, `Failed to acknowledge alarm: ${error.message}`);
            }
        });
    }

    handleAllTags(req, res) {
        const allData = this.plcManager.getAllData();
        const tags = [];
        
        Object.entries(allData).forEach(([fullTagName, data]) => {
            const [plcName, tagName] = fullTagName.split('.');
            tags.push({
                plcName,
                tagName,
                fullName: fullTagName,
                currentValue: data.value,
                units: data.metadata?.engineeringUnits || '',
                group: data.metadata?.group || 'Unknown',
                description: data.metadata?.description || '',
                lastUpdate: data.timestamp
            });
        });
        
        this.sendJSON(res, {
            tags: tags,
            count: tags.length,
            byPLC: this.groupTagsByPLC(tags),
            timestamp: new Date().toISOString()
        });
    }

    handlePLCTags(req, res, query) {
        const plcName = query.plc;
        
        if (!plcName) {
            this.sendError(res, 400, 'PLC name required (?plc=NAME)');
            return;
        }
        
        const plcData = this.plcManager.getPLCData(plcName);
        const tags = Object.entries(plcData).map(([tagName, data]) => ({
            plcName,
            tagName,
            fullName: `${plcName}.${tagName}`,
            currentValue: data.value,
            units: data.metadata?.engineeringUnits || '',
            group: data.metadata?.group || 'Unknown',
            description: data.metadata?.description || '',
            lastUpdate: data.timestamp
        }));
        
        this.sendJSON(res, {
            plcName: plcName,
            tags: tags,
            count: tags.length,
            timestamp: new Date().toISOString()
        });
    }

    handleTagGroups(req, res, query) {
        const allData = this.plcManager.getAllData();
        const groups = {};
        
        Object.entries(allData).forEach(([fullTagName, data]) => {
            const group = data.metadata?.group || 'Unknown';
            if (!groups[group]) {
                groups[group] = [];
            }
            
            const [plcName, tagName] = fullTagName.split('.');
            groups[group].push({
                plcName,
                tagName,
                fullName: fullTagName,
                currentValue: data.value,
                units: data.metadata?.engineeringUnits || ''
            });
        });
        
        this.sendJSON(res, {
            groups: groups,
            groupCount: Object.keys(groups).length,
            totalTags: Object.values(groups).reduce((sum, group) => sum + group.length, 0),
            timestamp: new Date().toISOString()
        });
    }

    groupTagsByPLC(tags) {
        const grouped = {};
        tags.forEach(tag => {
            if (!grouped[tag.plcName]) {
                grouped[tag.plcName] = [];
            }
            grouped[tag.plcName].push(tag);
        });
        return grouped;
    }

    async handleConfigRefresh(req, res) {
        try {
            await this.plcManager.refreshConfigurations();
            
            this.sendJSON(res, {
                success: true,
                message: 'Configurations refreshed successfully',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            this.sendError(res, 500, `Failed to refresh configurations: ${error.message}`);
        }
    }

    async handleConfigExport(req, res) {
        try {
            const configs = Array.from(this.plcManager.plcConfigs.values());
            const exportData = {
                version: '2.1.0',
                exportDate: new Date().toISOString(),
                plcConfigurations: configs
            };
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="plc-configurations.json"');
            res.end(JSON.stringify(exportData, null, 2));
            
        } catch (error) {
            this.sendError(res, 500, `Failed to export configurations: ${error.message}`);
        }
    }

    async handleConfigImport(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const importData = JSON.parse(body);
                
                if (!importData.plcConfigurations || !Array.isArray(importData.plcConfigurations)) {
                    this.sendError(res, 400, 'Invalid import format - plcConfigurations array required');
                    return;
                }
                
                const results = [];
                for (const config of importData.plcConfigurations) {
                    try {
                        const result = await this.plcManager.addOrUpdatePLC(config);
                        results.push({ plcName: config.plcName, success: true, result });
                    } catch (error) {
                        results.push({ plcName: config.plcName, success: false, error: error.message });
                    }
                }
                
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;
                
                this.sendJSON(res, {
                    success: failed === 0,
                    message: `Import completed: ${successful} successful, ${failed} failed`,
                    results: results,
                    summary: { successful, failed, total: importData.plcConfigurations.length },
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                this.sendError(res, 500, `Failed to import configurations: ${error.message}`);
            }
        });
    }

    handleDashboard(req, res) {
        const status = this.plcManager.getDetailedStatus();
        const allAlarms = this.plcManager.getAllAlarms();
        const activeAlarms = allAlarms.filter(a => a.state === 'ACTIVE');
        const uptime = Math.floor((new Date() - this.startTime) / 1000);
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Multi-PLC Manager Dashboard</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
                    font-size: 2.5em;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .stat-card {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    border-left: 4px solid #007bff;
                    text-align: center;
                }
                .stat-card.success { border-left-color: #28a745; }
                .stat-card.warning { border-left-color: #ffc107; }
                .stat-card.danger { border-left-color: #dc3545; }
                .stat-card.info { border-left-color: #17a2b8; }
                .stat-number {
                    font-size: 2.5em;
                    font-weight: bold;
                    margin: 10px 0;
                }
                .stat-label {
                    color: #666;
                    font-size: 1.1em;
                }
                .plc-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .plc-card {
                    background: white;
                    border-radius: 10px;
                    padding: 20px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    border-left: 4px solid #dc3545;
                }
                .plc-card.connected { border-left-color: #28a745; }
                .plc-card.connecting { border-left-color: #ffc107; }
                .plc-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }
                .plc-name {
                    font-size: 1.3em;
                    font-weight: bold;
                }
                .plc-status {
                    padding: 5px 10px;
                    border-radius: 15px;
                    font-size: 0.9em;
                    font-weight: bold;
                    color: white;
                }
                .plc-status.connected { background: #28a745; }
                .plc-status.offline { background: #dc3545; }
                .plc-status.connecting { background: #ffc107; }
                .plc-metrics {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    margin-top: 15px;
                }
                .plc-metric {
                    text-align: center;
                    padding: 8px;
                    background: #f8f9fa;
                    border-radius: 5px;
                }
                .plc-metric-value {
                    font-weight: bold;
                    font-size: 1.2em;
                    display: block;
                }
                .plc-metric-label {
                    font-size: 0.8em;
                    color: #666;
                }
                .alarms-section {
                    background: white;
                    border-radius: 10px;
                    padding: 20px;
                    margin: 20px 0;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .alarm-item {
                    padding: 10px;
                    margin: 10px 0;
                    border-radius: 5px;
                    border-left: 4px solid #dc3545;
                    background: #f8d7da;
                }
                .alarm-item.acknowledged {
                    border-left-color: #ffc107;
                    background: #fff3cd;
                }
                .api-section {
                    background: white;
                    border-radius: 10px;
                    padding: 20px;
                    margin: 20px 0;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .api-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
                    cursor: pointer;
                }
                .api-endpoint:hover {
                    background: #dee2e6;
                }
                .refresh-info {
                    text-align: center;
                    color: #6c757d;
                    margin-top: 20px;
                    font-style: italic;
                }
                .alerts-section {
                    background: white;
                    border-radius: 10px;
                    padding: 20px;
                    margin: 20px 0;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    max-height: 300px;
                    overflow-y: auto;
                }
                .alert-item {
                    padding: 8px 12px;
                    margin: 5px 0;
                    border-radius: 5px;
                    font-size: 0.9em;
                }
                .alert-item.success { background: #d4edda; color: #155724; }
                .alert-item.warning { background: #fff3cd; color: #856404; }
                .alert-item.error { background: #f8d7da; color: #721c24; }
                .alert-item.alarm { background: #f8d7da; color: #721c24; font-weight: bold; }
                .alert-item.info { background: #d1ecf1; color: #0c5460; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🏭 Multi-PLC Manager Dashboard</h1>
                    <p style="font-size: 1.2em; color: #666; margin: 10px 0;">
                        Centralized monitoring and control for multiple PLC connections
                    </p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card ${status.plcStatuses.filter(p => p.connected).length === status.plcStatuses.length ? 'success' : 'warning'}">
                        <div class="stat-number">${status.plcStatuses.filter(p => p.connected).length}/${status.plcStatuses.length}</div>
                        <div class="stat-label">PLCs Connected</div>
                    </div>
                    
                    <div class="stat-card info">
                        <div class="stat-number">${Object.keys(this.plcManager.getAllData()).length}</div>
                        <div class="stat-label">Active Tags</div>
                    </div>
                    
                    <div class="stat-card ${activeAlarms.length > 0 ? 'danger' : 'success'}">
                        <div class="stat-number">${activeAlarms.length}</div>
                        <div class="stat-label">Active Alarms</div>
                    </div>
                    
                    <div class="stat-card info">
                        <div class="stat-number">${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m</div>
                        <div class="stat-label">System Uptime</div>
                    </div>
                </div>
                
                <div class="plc-grid">
                    ${status.plcStatuses.map(plc => `
                        <div class="plc-card ${plc.connected ? 'connected' : 'offline'}">
                            <div class="plc-header">
                                <div class="plc-name">${plc.plcName}</div>
                                <div class="plc-status ${plc.connected ? 'connected' : 'offline'}">
                                    ${plc.connected ? '✅ ONLINE' : '❌ OFFLINE'}
                                </div>
                            </div>
                            <div style="color: #666; margin-bottom: 10px;">
                                ${plc.config.description || 'No description'}
                            </div>
                            <div style="font-size: 0.9em; color: #666;">
                                📍 ${plc.config.location || 'Unknown'} | 
                                🏢 ${plc.config.department || 'Unknown'} |
                                🌐 ${plc.config.address}:${plc.config.port}
                            </div>
                            <div class="plc-metrics">
                                <div class="plc-metric">
                                    <span class="plc-metric-value">${plc.tagCount}</span>
                                    <span class="plc-metric-label">Tags</span>
                                </div>
                                <div class="plc-metric">
                                    <span class="plc-metric-value">${plc.alarmCount}</span>
                                    <span class="plc-metric-label">Alarms</span>
                                </div>
                                <div class="plc-metric">
                                    <span class="plc-metric-value">${plc.config.cycletime}ms</span>
                                    <span class="plc-metric-label">Cycle</span>
                                </div>
                                <div class="plc-metric">
                                    <span class="plc-metric-value">P${plc.config.priority}</span>
                                    <span class="plc-metric-label">Priority</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                ${activeAlarms.length > 0 ? `
                <div class="alarms-section">
                    <h2>🚨 Active Alarms (${activeAlarms.length})</h2>
                    ${activeAlarms.slice(0, 10).map(alarm => `
                        <div class="alarm-item ${alarm.state === 'ACKNOWLEDGED' ? 'acknowledged' : ''}">
                            <strong>${alarm.plcName}.${alarm.tagName}</strong> - ${alarm.type} Alarm<br>
                            Value: ${alarm.value}, Limit: ${alarm.limit}<br>
                            <small>${new Date(alarm.timestamp).toLocaleString()}</small>
                        </div>
                    `).join('')}
                    ${activeAlarms.length > 10 ? `<p><em>... and ${activeAlarms.length - 10} more active alarms</em></p>` : ''}
                </div>
                ` : `
                <div class="alarms-section">
                    <h2>✅ No Active Alarms</h2>
                    <p>All systems operating normally</p>
                </div>
                `}
                
                <div class="alerts-section">
                    <h2>📢 Recent System Alerts</h2>
                    ${this.lastAlerts.slice(0, 10).map(alert => `
                        <div class="alert-item ${alert.type}">
                            <strong>${new Date(alert.timestamp).toLocaleTimeString()}</strong> - ${alert.message}
                        </div>
                    `).join('')}
                </div>
                
                <div class="api-section">
                    <h2>🔗 Multi-PLC API Endpoints</h2>
                    <div class="api-grid">
                        <div class="api-category">
                            <h4>🏭 PLC Management</h4>
                            <div class="api-endpoint">GET /api/plcs</div>
                            <div class="api-endpoint">GET /api/plcs/status</div>
                            <div class="api-endpoint">GET /api/plcs/health</div>
                            <div class="api-endpoint">POST /api/plc/connect?plc=NAME</div>
                            <div class="api-endpoint">POST /api/plc/disconnect?plc=NAME</div>
                            <div class="api-endpoint">POST /api/plc/enable?plc=NAME</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>📊 Data Access</h4>
                            <div class="api-endpoint">GET /api/data/all</div>
                            <div class="api-endpoint">GET /api/data/plc?plc=NAME</div>
                            <div class="api-endpoint">GET /api/data/tag?plc=NAME&tag=TAG</div>
                            <div class="api-endpoint">GET /api/data/aggregated</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>✍️ Write Operations</h4>
                            <div class="api-endpoint">POST /api/write/tag</div>
                            <div class="api-endpoint">POST /api/write/multiple</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🚨 Alarm Management</h4>
                            <div class="api-endpoint">GET /api/alarms/all</div>
                            <div class="api-endpoint">GET /api/alarms/active</div>
                            <div class="api-endpoint">GET /api/alarms/plc?plc=NAME</div>
                            <div class="api-endpoint">POST /api/alarms/acknowledge</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>🏷️ Tag Management</h4>
                            <div class="api-endpoint">GET /api/tags/all</div>
                            <div class="api-endpoint">GET /api/tags/plc?plc=NAME</div>
                            <div class="api-endpoint">GET /api/tags/groups</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>⚙️ Configuration</h4>
                            <div class="api-endpoint">GET /api/plc/config</div>
                            <div class="api-endpoint">POST /api/config/refresh</div>
                            <div class="api-endpoint">GET /api/config/export</div>
                            <div class="api-endpoint">POST /api/config/import</div>
                        </div>
                        
                        <div class="api-category">
                            <h4>📈 System Monitoring</h4>
                            <div class="api-endpoint">GET /api/system/status</div>
                            <div class="api-endpoint">GET /api/system/stats</div>
                            <div class="api-endpoint">GET /api/system/alerts</div>
                        </div>
                    </div>
                </div>
                
                <div class="refresh-info">
                    <p>🔄 Dashboard auto-refreshes every 10 seconds | Last updated: ${new Date().toLocaleString()}</p>
                    <p>📊 Multi-PLC Manager v2.1.0 | 
                       📋 API Documentation: <a href="/api" target="_blank">/api</a> |
                       📈 System Status: <a href="/api/system/status" target="_blank">/api/system/status</a></p>
                </div>
            </div>
            
            <script>
                // Auto refresh every 10 seconds
                setTimeout(() => location.reload(), 10000);
                
                // Add click handlers for API endpoints
                document.addEventListener('DOMContentLoaded', function() {
                    document.querySelectorAll('.api-endpoint').forEach(endpoint => {
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

    handleApiDocumentation(req, res) {
        const documentation = {
            title: "Multi-PLC Manager API",
            version: "2.1.0",
            description: "Comprehensive API for managing multiple S7 PLC connections with advanced monitoring and control",
            features: [
                "Dynamic PLC connection management",
                "Real-time data aggregation from multiple PLCs",
                "Centralized alarm management",
                "Configuration import/export",
                "Health monitoring and diagnostics",
                "Engineering units conversion",
                "Historical data access"
            ],
            endpoints: {
                "System Management": {
                    "GET /api/system/status": "Get comprehensive system status",
                    "GET /api/system/stats": "Get system statistics",
                    "GET /api/system/alerts": "Get recent system alerts"
                },
                "PLC Management": {
                    "GET /api/plcs": "Get all PLC configurations and status",
                    "POST /api/plcs": "Add new PLC configuration",
                    "GET /api/plcs/status": "Get connection status for all PLCs",
                    "GET /api/plcs/health": "Perform health check on all PLCs",
                    "POST /api/plc/connect?plc=NAME": "Connect to specific PLC",
                    "POST /api/plc/disconnect?plc=NAME": "Disconnect from specific PLC",
                    "POST /api/plc/enable?plc=NAME&enabled=true/false": "Enable/disable PLC",
                    "GET /api/plc/config?plc=NAME": "Get PLC configuration",
                    "PUT /api/plc/config": "Update PLC configuration"
                },
                "Data Access": {
                    "GET /api/data/all": "Get all current data from all PLCs",
                    "GET /api/data/plc?plc=NAME": "Get current data from specific PLC",
                    "GET /api/data/tag?plc=NAME&tag=TAG": "Get specific tag data",
                    "GET /api/data/aggregated?groupBy=plc/group": "Get aggregated data grouped by PLC or tag group"
                },
                "Write Operations": {
                    "POST /api/write/tag": "Write value to specific tag (body: {plcName, tagName, value, isEuValue})",
                    "POST /api/write/multiple": "Write multiple values (body: {writes: [{plcName, tagName, value}]})"
                },
                "Alarm Management": {
                    "GET /api/alarms/all": "Get all alarms from all PLCs",
                    "GET /api/alarms/active": "Get only active alarms",
                    "GET /api/alarms/plc?plc=NAME": "Get alarms from specific PLC",
                    "POST /api/alarms/acknowledge": "Acknowledge alarm (body: {alarmId, username})"
                },
                "Tag Management": {
                    "GET /api/tags/all": "Get all tags from all PLCs",
                    "GET /api/tags/plc?plc=NAME": "Get tags from specific PLC",
                    "GET /api/tags/groups": "Get tags grouped by tag groups"
                },
                "Configuration": {
                    "POST /api/config/refresh": "Refresh configurations from database",
                    "GET /api/config/export": "Export all PLC configurations",
                    "POST /api/config/import": "Import PLC configurations"
                }
            },
            examples: {
                "Connect to PLC": "POST /api/plc/connect?plc=WWTP_Main_PLC",
                "Get PLC data": "GET /api/data/plc?plc=WWTP_Main_PLC",
                "Write tag value": "POST /api/write/tag {\"plcName\": \"WWTP_Main_PLC\", \"tagName\": \"Influent_Flow\", \"value\": 125.5}",
                "Get active alarms": "GET /api/alarms/active",
                "Acknowledge alarm": "POST /api/alarms/acknowledge {\"alarmId\": \"WWTP_Main_PLC.Tank1_Level.1640995200000\", \"username\": \"operator1\"}"
            },
            notes: [
                "All timestamps are in ISO 8601 format",
                "Engineering unit values are automatically converted based on tag configuration",
                "PLC connections are managed automatically based on database configuration",
                "Health checks run automatically every 60 seconds",
                "Configuration changes are automatically detected and applied"
            ]
        };

        this.sendJSON(res, documentation);
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
            await this.plcManager.initialize();
            console.log('🎉 Multi-PLC Manager initialized successfully');

            // Start HTTP server
            this.server.listen(this.httpPort, () => {
                console.log(`🌐 Multi-PLC HTTP Server running on port ${this.httpPort}`);
                console.log(`📱 Dashboard: http://localhost:${this.httpPort}`);
                console.log(`📋 API Documentation: http://localhost:${this.httpPort}/api`);
                console.log(`📊 System Status: http://localhost:${this.httpPort}/api/system/status`);
                console.log(`🏭 PLCs Status: http://localhost:${this.httpPort}/api/plcs/status`);
                console.log(`📈 All Data: http://localhost:${this.httpPort}/api/data/all`);
            });

        } catch (error) {
            console.error('❌ Failed to start Multi-PLC Server:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        console.log('🔄 Shutting down Multi-PLC HTTP Server...');
        
        if (this.server) {
            this.server.close();
        }
        
        await this.plcManager.shutdown();
        console.log('✅ Multi-PLC HTTP Server stopped');
        process.exit(0);
    }
}

// Configuration
const multiPLCConfig = {
    // SQL Server Configuration
    server: 'localhost\\SQLEXPRESS',
    database: 'IndolaktoWWTP',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        instanceName: 'SQLEXPRESS'
    },
    pool: {
        max: 20,
        min: 2,
        idleTimeoutMillis: 30000
    }
};

const httpPort = process.env.PORT || 3000;
const server = new MultiPLCHTTPServer(multiPLCConfig, httpPort);

// Graceful shutdown
process.on('SIGINT', () => server.stop());
process.on('SIGTERM', () => server.stop());

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the multi-PLC server
server.start().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});

module.exports = MultiPLCHTTPServer;
                const MultiPLCManager = require('./MultiPLCManager');
const http = require('http');
const url = require('url');

/**
 * Multi-PLC HTTP API Server
 * Provides comprehensive REST API for managing multiple PLC connections
 * with advanced monitoring, control, and data aggregation capabilities
 */
class MultiPLCHTTPServer {
    constructor(sqlConfig, httpPort = 3000) {
        this.plcManager = new MultiPLCManager(sqlConfig);
        this.httpPort = httpPort;
        this.server = null;
        this.requestCount = 0;
        this.startTime = new Date();
        this.lastAlerts = [];
        this.maxAlerts = 50;
        
        this.setupPLCManagerEvents();
        this.createHTTPServer();
    }

    setupPLCManagerEvents() {
        this.plcManager.on('initialized', (stats) => {
            console.log('🎉 Multi-PLC Manager initialized with stats:', stats);
        });

        this.plcManager.on('plc_connected', (data) => {
            console.log(`✅ PLC Connected: ${data.plcName}`);
            this.addAlert('success', `PLC ${data.plcName} connected successfully`, data);
        });

        this.plcManager.on('plc_disconnected', (data) => {
            console.log(`❌ PLC Disconnected: ${data.plcName}`);
            this.addAlert('warning', `PLC ${data.plcName} disconnected`, data);
        });

        this.plcManager.on('plc_error', (data) => {
            console.error(`❌ PLC Error ${data.plcName}:`, data.error);
            this.addAlert('error', `PLC ${data.plcName} error: ${data.error}`, data);
        });

        this.plcManager.on('multi_plc_alarm', (alarm) => {
            console.log(`🚨 Multi-PLC Alarm: ${alarm.plcName}.${alarm.tagName} - ${alarm.type}`);
            this.addAlert('alarm', `${alarm.type} alarm on ${alarm.plcName}.${alarm.tagName}`, alarm);
        });

        this.plcManager.on('health_check_complete', (results) => {
            const unhealthyPLCs = results.results.filter(r => !r.isHealthy);
            if (unhealthyPLCs.length > 0) {
                this.addAlert('warning', `${unhealthyPLCs.length} PLC(s) unhealthy`, results);
            }
        });

        this.plcManager.on('configurations_refreshed', (data) => {
            if (data.changed.length > 0) {
                this.addAlert('info', `${data.changed.length} PLC configurations updated`, data);
            }
        });
    }

    addAlert(type, message, data = null) {
        const alert = {
            id: Date.now(),
            type,
            message,
            data,
            timestamp: new Date()
        };
        
        this.lastAlerts.unshift(alert);
        if (this.lastAlerts.length > this.maxAlerts) {
            this.lastAlerts = this.lastAlerts.slice(0, this.maxAlerts);
        }
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
        // Multi-PLC Management endpoints
        switch (path) {
            // Dashboard and system overview
            case '/':
                this.handleDashboard(req, res);
                break;
            case '/api':
                this.handleApiDocumentation(req, res);
                break;
            case '/api/system/status':
                this.handleSystemStatus(req, res);
                break;
            case '/api/system/stats':
                this.handleSystemStats(req, res);
                break;
            case '/api/system/alerts':
                this.handleSystemAlerts(req, res);
                break;

            // PLC Management
            case '/api/plcs':
                await this.handlePLCs(req, res);
                break;
            case '/api/plcs/status':
                this.handlePLCsStatus(req, res);
                break;
            case '/api/plcs/health':
                await this.handlePLCsHealth(req, res);
                break;
            case '/api/plc/connect':
                await this.handlePLCConnect(req, res);
                break;
            case '/api/plc/disconnect':
                await this.handlePLCDisconnect(req, res);
                break;
            case '/api/plc/enable':
                await this.handlePLCEnable(req, res);
                break;
            case '/api/plc/config':
                await this.handlePLCConfig(req, res);
                break;

            // Data Access
            case '/api/data/all':
                this.handleAllData(req, res);
                break;
            case '/api/data/plc':
                this.handlePLCData(req, res, query);
                break;
            case '/api/data/tag':
                this.handleTagData(req, res, query);
                break;
            case '/api/data/aggregated':
                this.handleAggregatedData(req, res, query);
                break;

            // Write Operations
            case '/api/write/tag':
                await this.handleWriteTag(req