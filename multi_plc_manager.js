const { EventEmitter } = require('events');
const sql = require('mssql');
const EnhancedS7ClientWithLogging = require('./EnhancedS7ClientWithLogging');

/**
 * Multi-PLC Connection Manager
 * Manages multiple S7 PLC connections dynamically from database configuration
 * Supports automatic connection management, health monitoring, and data aggregation
 */
class MultiPLCManager extends EventEmitter {
    constructor(sqlConfig) {
        super();
        
        this.sqlConfig = sqlConfig;
        this.connectionPool = null;
        this.plcClients = new Map(); // Map of PLCName -> EnhancedS7ClientWithLogging
        this.plcConfigs = new Map(); // Map of PLCName -> configuration
        this.plcStatus = new Map();  // Map of PLCName -> status
        this.aggregatedData = new Map(); // Map of "PLCName.TagName" -> value
        this.aggregatedAlarms = new Map(); // Map of AlarmID -> alarm data
        
        // Settings
        this.healthCheckInterval = 60000; // 60 seconds
        this.reconnectInterval = 30000;   // 30 seconds
        this.maxRetries = 3;
        this.isInitialized = false;
        this.isShuttingDown = false;
        
        // Timers
        this.healthCheckTimer = null;
        this.reconnectTimer = null;
        this.configRefreshTimer = null;
        
        // Statistics
        this.stats = {
            totalConnections: 0,
            activeConnections: 0,
            failedConnections: 0,
            totalTags: 0,
            activeTags: 0,
            totalAlarms: 0,
            dataPointsLogged: 0,
            startTime: new Date()
        };
        
        this.setMaxListeners(0);
    }

    /**
     * Initialize the Multi-PLC Manager
     */
    async initialize() {
        try {
            console.log('🚀 Initializing Multi-PLC Connection Manager...');
            
            // Connect to SQL Server
            await this.connectToDatabase();
            
            // Load PLC configurations from database
            await this.loadPLCConfigurations();
            
            // Start health monitoring
            this.startHealthChecking();
            
            // Start configuration refresh timer
            this.startConfigurationRefresh();
            
            // Connect to all enabled PLCs
            await this.connectAllPLCs();
            
            this.isInitialized = true;
            console.log('✅ Multi-PLC Connection Manager initialized successfully');
            this.emit('initialized', this.getSystemStats());
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize Multi-PLC Manager:', error);
            throw error;
        }
    }

    /**
     * Connect to SQL Server database
     */
    async connectToDatabase() {
        try {
            console.log('📡 Connecting to SQL Server...');
            
            const poolConfig = {
                user: this.sqlConfig.user,
                password: this.sqlConfig.password,
                server: this.sqlConfig.server,
                database: this.sqlConfig.database,
                pool: this.sqlConfig.pool || {
                    max: 20,
                    min: 0,
                    idleTimeoutMillis: 30000
                },
                options: this.sqlConfig.options || {
                    encrypt: false,
                    trustServerCertificate: true,
                    enableArithAbort: true
                }
            };

            // Use Windows Authentication if no user/password provided
            if (!this.sqlConfig.user && !this.sqlConfig.password) {
                poolConfig.options.trustedConnection = true;
            }

            this.connectionPool = await sql.connect(poolConfig);
            console.log('✅ Connected to SQL Server successfully');
            
        } catch (error) {
            console.error('❌ SQL Server connection failed:', error);
            throw error;
        }
    }

    /**
     * Load PLC configurations from database
     */
    async loadPLCConfigurations() {
        try {
            console.log('⚙️ Loading PLC configurations from database...');
            
            const result = await this.connectionPool.request()
                .execute('sp_GetPLCConfiguration');
            
            this.plcConfigs.clear();
            let enabledCount = 0;
            
            for (const row of result.recordset) {
                const config = {
                    // Basic PLC info
                    plcName: row.PLCName,
                    description: row.PLCDescription,
                    location: row.Location,
                    department: row.Department,
                    systemType: row.SystemType,
                    
                    // Connection configuration for nodes7
                    transport: row.Transport,
                    address: row.IPAddress,
                    port: row.Port,
                    rack: row.Rack,
                    slot: row.Slot,
                    connmode: row.ConnectionMode,
                    cycletime: row.CycleTime,
                    timeout: row.Timeout,
                    
                    // TSAP configuration if needed
                    localtsaphi: row.LocalTSAPHi,
                    localtsaplo: row.LocalTSAPLo,
                    remotetsaphi: row.RemoteTSAPHi,
                    remotetsaplo: row.RemoteTSAPLo,
                    
                    // Management settings
                    enabled: row.Enabled,
                    autoConnect: row.AutoConnect,
                    priority: row.Priority,
                    maxRetries: row.MaxRetries || this.maxRetries,
                    retryDelay: row.RetryDelay || this.reconnectInterval,
                    
                    // Status info
                    isConnected: row.IsConnected,
                    connectionState: row.ConnectionState,
                    lastStatusChange: row.LastStatusChange,
                    activeTagCount: row.ActiveTagCount,
                    
                    // Performance metrics
                    averageResponseTime: row.AverageResponseTime,
                    uptimePercent: row.UptimePercent,
                    dataQualityPercent: row.DataQualityPercent
                };
                
                this.plcConfigs.set(row.PLCName, config);
                
                if (config.enabled) {
                    enabledCount++;
                }
                
                // Initialize status tracking
                this.plcStatus.set(row.PLCName, {
                    connected: config.isConnected,
                    state: config.connectionState,
                    lastUpdate: new Date(),
                    retryCount: 0,
                    lastError: null,
                    startTime: null,
                    cycleCount: 0,
                    dataPoints: 0,
                    alarmCount: 0
                });
            }
            
            this.stats.totalConnections = this.plcConfigs.size;
            
            console.log(`📊 Loaded ${this.plcConfigs.size} PLC configurations (${enabledCount} enabled)`);
            this.emit('configurations_loaded', {
                total: this.plcConfigs.size,
                enabled: enabledCount,
                configs: Array.from(this.plcConfigs.values())
            });
            
        } catch (error) {
            console.error('❌ Failed to load PLC configurations:', error);
            throw error;
        }
    }

    /**
     * Load tags for a specific PLC
     */
    async loadTagsForPLC(plcName) {
        try {
            const result = await this.connectionPool.request()
                .input('PLCName', sql.NVarChar, plcName)
                .execute('sp_GetTagsForPLC');
            
            // Convert to S7Client format
            const variables = result.recordset.map(row => ({
                name: row.TagName,
                addr: row.TagAddress,
                // Store additional metadata for later use
                metadata: {
                    plcName: row.PLCName,
                    tagType: row.TagType,
                    description: row.Description,
                    group: row.GroupName,
                    engineeringUnits: row.EngineeringUnits,
                    decimalPlaces: row.DecimalPlaces,
                    rawMin: row.RawMin,
                    rawMax: row.RawMax,
                    euMin: row.EuMin,
                    euMax: row.EuMax,
                    scalingType: row.ScalingType,
                    alarmEnabled: row.AlarmEnabled,
                    loggingEnabled: row.LoggingEnabled,
                    limits: {
                        min: row.MinValue,
                        max: row.MaxValue,
                        alarmHigh: row.AlarmHigh,
                        alarmLow: row.AlarmLow,
                        alarmHighHigh: row.AlarmHighHigh,
                        alarmLowLow: row.AlarmLowLow,
                        deadband: row.AlarmDeadband
                    }
                }
            }));
            
            return variables;
            
        } catch (error) {
            console.error(`❌ Failed to load tags for PLC ${plcName}:`, error);
            return [];
        }
    }

    /**
     * Connect to all enabled PLCs
     */
    async connectAllPLCs() {
        const enabledPLCs = Array.from(this.plcConfigs.values())
            .filter(config => config.enabled && config.autoConnect)
            .sort((a, b) => a.priority - b.priority); // Connect by priority
        
        console.log(`🔌 Connecting to ${enabledPLCs.length} enabled PLCs...`);
        
        const connectionPromises = enabledPLCs.map(config => 
            this.connectToPLC(config.plcName)
        );
        
        // Wait for all connections (don't fail if some fail)
        const results = await Promise.allSettled(connectionPromises);
        
        let successful = 0;
        let failed = 0;
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successful++;
            } else {
                failed++;
                console.error(`❌ Failed to connect to ${enabledPLCs[index].plcName}:`, result.reason);
            }
        });
        
        this.stats.activeConnections = successful;
        this.stats.failedConnections = failed;
        
        console.log(`📊 Connection summary: ${successful} successful, ${failed} failed`);
        this.emit('mass_connection_complete', { successful, failed, total: enabledPLCs.length });
    }

    /**
     * Connect to a specific PLC
     */
    async connectToPLC(plcName) {
        try {
            const config = this.plcConfigs.get(plcName);
            if (!config) {
                throw new Error(`PLC configuration not found: ${plcName}`);
            }
            
            if (!config.enabled) {
                console.log(`⏸️ PLC ${plcName} is disabled, skipping connection`);
                return false;
            }
            
            console.log(`🔌 Connecting to PLC: ${plcName} (${config.address}:${config.port})`);
            
            // Load tags for this PLC
            const variables = await this.loadTagsForPLC(plcName);
            console.log(`📋 Loaded ${variables.length} tags for PLC ${plcName}`);
            
            // Create enhanced S7 client configuration
            const s7Config = {
                // S7 PLC Configuration
                transport: config.transport,
                address: config.address,
                port: config.port,
                rack: config.rack,
                slot: config.slot,
                cycletime: config.cycletime,
                timeout: config.timeout,
                connmode: config.connmode,
                localtsaphi: config.localtsaphi,
                localtsaplo: config.localtsaplo,
                remotetsaphi: config.remotetsaphi,
                remotetsaplo: config.remotetsaplo,
                variables: variables,
                
                // SQL Server Configuration (shared connection pool)
                sqlConfig: {
                    connectionPool: this.connectionPool,
                    tagTable: 'Tags',
                    cacheRefreshInterval: 60000,
                    enableAutoRefresh: false // We manage this centrally
                },
                
                // Enhanced Logging Configuration
                loggingConfig: {
                    dataTable: 'DataHistory',
                    alarmTable: 'AlarmHistory',
                    eventTable: 'EventHistory',
                    enableDataLogging: true,
                    enableAlarmLogging: true,
                    enableEventLogging: true,
                    logInterval: 30000,
                    dataRetentionDays: 90,
                    alarmRetentionDays: 365
                }
            };
            
            // Create enhanced S7 client
            const client = new EnhancedS7ClientWithLogging(s7Config);
            
            // Set up event handlers for this PLC
            this.setupPLCEventHandlers(client, plcName, config);
            
            // Initialize the client
            await client.initialize();
            
            // Store the client
            this.plcClients.set(plcName, client);
            
            // Update status
            await this.updatePLCStatus(plcName, true, 'ONLINE');
            
            console.log(`✅ Successfully connected to PLC: ${plcName}`);
            this.emit('plc_connected', { plcName, config });
            
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to connect to PLC ${plcName}:`, error);
            
            // Update status
            await this.updatePLCStatus(plcName, false, 'ERROR', error.message);
            
            // Update retry count
            const status = this.plcStatus.get(plcName);
            if (status) {
                status.retryCount++;
                status.lastError = error.message;
            }
            
            this.emit('plc_connection_failed', { plcName, error: error.message });
            
            // Schedule retry if enabled
            if (config && status && status.retryCount < config.maxRetries) {
                setTimeout(() => {
                    if (!this.isShuttingDown) {
                        console.log(`🔄 Retrying connection to PLC ${plcName} (attempt ${status.retryCount + 1})`);
                        this.connectToPLC(plcName);
                    }
                }, config.retryDelay);
            }
            
            throw error;
        }
    }

    /**
     * Set up event handlers for a PLC client
     */
    setupPLCEventHandlers(client, plcName, config) {
        // Connection events
        client.on('connected', () => {
            console.log(`✅ PLC ${plcName} connected`);
            this.updatePLCStatus(plcName, true, 'ONLINE');
            
            const status = this.plcStatus.get(plcName);
            if (status) {
                status.retryCount = 0;
                status.lastError = null;
                status.startTime = new Date();
            }
            
            this.stats.activeConnections++;
            this.emit('plc_connected', { plcName, config });
        });

        client.on('disconnected', () => {
            console.log(`❌ PLC ${plcName} disconnected`);
            this.updatePLCStatus(plcName, false, 'OFFLINE');
            
            this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
            this.emit('plc_disconnected', { plcName, config });
        });

        client.on('error', (error) => {
            console.error(`❌ PLC ${plcName} error:`, error.message);
            this.updatePLCStatus(plcName, false, 'ERROR', error.message);
            
            const status = this.plcStatus.get(plcName);
            if (status) {
                status.lastError = error.message;
            }
            
            this.emit('plc_error', { plcName, error: error.message, config });
        });

        // Data events
        client.on('enhanced_data', (data) => {
            // Store data with PLC prefix
            Object.entries(data).forEach(([tagName, tagData]) => {
                const fullTagName = `${plcName}.${tagName}`;
                this.aggregatedData.set(fullTagName, {
                    ...tagData,
                    plcName: plcName,
                    timestamp: new Date(),
                    plcConfig: config
                });
            });
            
            // Update statistics
            const status = this.plcStatus.get(plcName);
            if (status) {
                status.cycleCount++;
                status.dataPoints += Object.keys(data).length;
                status.lastUpdate = new Date();
            }
            
            this.stats.activeTags = this.aggregatedData.size;
            this.stats.dataPointsLogged += Object.keys(data).length;
            
            this.emit('aggregated_data_updated', {
                plcName,
                tagCount: Object.keys(data).length,
                totalActiveTags: this.aggregatedData.size
            });
        });

        // Alarm events
        client.on('alarm', (alarm) => {
            const enhancedAlarm = {
                ...alarm,
                plcName: plcName,
                plcConfig: config,
                alarmId: `${plcName}.${alarm.tagName}.${Date.now()}`,
                timestamp: new Date()
            };
            
            this.aggregatedAlarms.set(enhancedAlarm.alarmId, enhancedAlarm);
            
            // Update statistics
            const status = this.plcStatus.get(plcName);
            if (status) {
                status.alarmCount++;
            }
            this.stats.totalAlarms++;
            
            console.log(`🚨 ALARM from ${plcName}: ${alarm.type} - ${alarm.tagName} = ${alarm.value}`);
            this.emit('multi_plc_alarm', enhancedAlarm);
        });

        // Logging events
        client.on('data_logged', (entry) => {
            this.emit('data_logged_from_plc', { plcName, entry });
        });

        client.on('alarm_logged', (entry) => {
            this.emit('alarm_logged_from_plc', { plcName, entry });
        });

        client.on('event_logged', (entry) => {
            this.emit('event_logged_from_plc', { plcName, entry });
        });
    }

    /**
     * Update PLC status in database
     */
    async updatePLCStatus(plcName, isConnected, state, errorMessage = null) {
        try {
            const client = this.plcClients.get(plcName);
            const status = this.plcStatus.get(plcName);
            
            await this.connectionPool.request()
                .input('PLCName', sql.NVarChar, plcName)
                .input('IsConnected', sql.Bit, isConnected)
                .input('ConnectionState', sql.NVarChar, state)
                .input('CurrentCycleTime', sql.Int, client ? client.currentCycleTime : null)
                .input('ActiveTags', sql.Int, status ? status.dataPoints : 0)
                .input('ErrorMessage', sql.NVarChar, errorMessage)
                .execute('sp_UpdatePLCStatus');
            
            // Update local status
            if (status) {
                status.connected = isConnected;
                status.state = state;
                status.lastUpdate = new Date();
                if (errorMessage) {
                    status.lastError = errorMessage;
                }
            }
            
        } catch (error) {
            console.error(`Failed to update status for PLC ${plcName}:`, error);
        }
    }

    /**
     * Disconnect from a specific PLC
     */
    async disconnectFromPLC(plcName) {
        try {
            const client = this.plcClients.get(plcName);
            if (client) {
                console.log(`🔌 Disconnecting from PLC: ${plcName}`);
                await client.disconnect();
                this.plcClients.delete(plcName);
                
                // Remove data from aggregated store
                for (const [key] of this.aggregatedData) {
                    if (key.startsWith(`${plcName}.`)) {
                        this.aggregatedData.delete(key);
                    }
                }
                
                await this.updatePLCStatus(plcName, false, 'OFFLINE');
                console.log(`✅ Disconnected from PLC: ${plcName}`);
            }
            
        } catch (error) {
            console.error(`❌ Error disconnecting from PLC ${plcName}:`, error);
        }
    }

    /**
     * Start health checking for all PLCs
     */
    startHealthChecking() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        this.healthCheckTimer = setInterval(async () => {
            if (!this.isShuttingDown) {
                await this.performHealthCheck();
            }
        }, this.healthCheckInterval);
        
        console.log(`💓 Health checking started (interval: ${this.healthCheckInterval}ms)`);
    }

    /**
     * Perform health check on all PLC connections
     */
    async performHealthCheck() {
        const healthResults = [];
        
        for (const [plcName, client] of this.plcClients) {
            try {
                const config = this.plcConfigs.get(plcName);
                const status = this.plcStatus.get(plcName);
                
                if (!config || !status) continue;
                
                const isHealthy = client.connected && client.getStatus() === 'online';
                const timeSinceLastUpdate = status.lastUpdate ? 
                    (Date.now() - status.lastUpdate.getTime()) / 1000 : Infinity;
                
                const health = {
                    plcName,
                    connected: client.connected,
                    status: client.getStatus(),
                    isHealthy,
                    timeSinceLastUpdate,
                    cycleCount: status.cycleCount,
                    dataPoints: status.dataPoints,
                    alarmCount: status.alarmCount,
                    retryCount: status.retryCount,
                    lastError: status.lastError,
                    uptime: status.startTime ? (Date.now() - status.startTime.getTime()) / 1000 : 0
                };
                
                healthResults.push(health);
                
                // Check if PLC needs attention
                if (!isHealthy) {
                    console.log(`⚠️ PLC ${plcName} health issue: ${client.getStatus()}`);
                    
                    // Attempt reconnection if configured
                    if (config.autoConnect && status.retryCount < config.maxRetries) {
                        console.log(`🔄 Attempting to reconnect to unhealthy PLC: ${plcName}`);
                        this.connectToPLC(plcName).catch(error => {
                            console.error(`Failed to reconnect to ${plcName}:`, error.message);
                        });
                    }
                }
                
                // Update database with current status
                await this.updatePLCStatus(plcName, client.connected, client.getStatus());
                
            } catch (error) {
                console.error(`Health check failed for PLC ${plcName}:`, error);
                healthResults.push({
                    plcName,
                    connected: false,
                    status: 'ERROR',
                    isHealthy: false,
                    error: error.message
                });
            }
        }
        
        this.emit('health_check_complete', {
            timestamp: new Date(),
            results: healthResults,
            totalPLCs: this.plcClients.size,
            healthyPLCs: healthResults.filter(r => r.isHealthy).length
        });
    }

    /**
     * Start configuration refresh timer
     */
    startConfigurationRefresh() {
        if (this.configRefreshTimer) {
            clearInterval(this.configRefreshTimer);
        }
        
        // Refresh configurations every 5 minutes
        this.configRefreshTimer = setInterval(async () => {
            if (!this.isShuttingDown) {
                await this.refreshConfigurations();
            }
        }, 5 * 60 * 1000);
        
        console.log('⚙️ Configuration refresh timer started (5 minute interval)');
    }

    /**
     * Refresh PLC configurations from database
     */
    async refreshConfigurations() {
        try {
            console.log('🔄 Refreshing PLC configurations...');
            
            const oldConfigs = new Map(this.plcConfigs);
            await this.loadPLCConfigurations();
            
            // Check for changes and handle them
            for (const [plcName, newConfig] of this.plcConfigs) {
                const oldConfig = oldConfigs.get(plcName);
                
                if (!oldConfig) {
                    // New PLC added
                    console.log(`➕ New PLC detected: ${plcName}`);
                    if (newConfig.enabled && newConfig.autoConnect) {
                        this.connectToPLC(plcName).catch(error => {
                            console.error(`Failed to connect to new PLC ${plcName}:`, error.message);
                        });
                    }
                } else if (this.hasConfigChanged(oldConfig, newConfig)) {
                    // Configuration changed
                    console.log(`🔧 PLC configuration changed: ${plcName}`);
                    
                    if (this.plcClients.has(plcName)) {
                        // Reconnect with new configuration
                        await this.disconnectFromPLC(plcName);
                        if (newConfig.enabled && newConfig.autoConnect) {
                            setTimeout(() => {
                                this.connectToPLC(plcName).catch(error => {
                                    console.error(`Failed to reconnect PLC ${plcName}:`, error.message);
                                });
                            }, 2000); // Wait 2 seconds before reconnecting
                        }
                    } else if (newConfig.enabled && newConfig.autoConnect) {
                        // Connect if now enabled
                        this.connectToPLC(plcName).catch(error => {
                            console.error(`Failed to connect updated PLC ${plcName}:`, error.message);
                        });
                    }
                }
            }
            
            // Check for removed PLCs
            for (const [plcName] of oldConfigs) {
                if (!this.plcConfigs.has(plcName)) {
                    console.log(`➖ PLC removed: ${plcName}`);
                    await this.disconnectFromPLC(plcName);
                }
            }
            
            this.emit('configurations_refreshed', {
                total: this.plcConfigs.size,
                changed: Array.from(this.plcConfigs.keys()).filter(name => 
                    !oldConfigs.has(name) || this.hasConfigChanged(oldConfigs.get(name), this.plcConfigs.get(name))
                )
            });
            
        } catch (error) {
            console.error('❌ Failed to refresh configurations:', error);
        }
    }

    /**
     * Check if PLC configuration has changed
     */
    hasConfigChanged(oldConfig, newConfig) {
        const keysToCheck = [
            'address', 'port', 'rack', 'slot', 'cycletime', 'timeout',
            'enabled', 'autoConnect', 'priority', 'transport', 'connmode'
        ];
        
        return keysToCheck.some(key => oldConfig[key] !== newConfig[key]);
    }

    /**
     * Write value to a specific PLC tag
     */
    async writeTag(plcName, tagName, value, isEuValue = true) {
        try {
            const client = this.plcClients.get(plcName);
            if (!client) {
                throw new Error(`PLC ${plcName} is not connected`);
            }
            
            if (!client.connected) {
                throw new Error(`PLC ${plcName} is not online`);
            }
            
            await client.writeVariable(tagName, value, isEuValue);
            
            console.log(`✍️ Written to ${plcName}.${tagName}: ${value}`);
            this.emit('tag_written', { plcName, tagName, value, isEuValue });
            
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to write to ${plcName}.${tagName}:`, error);
            this.emit('write_error', { plcName, tagName, value, error: error.message });
            throw error;
        }
    }

    /**
     * Write values to multiple tags across PLCs
     */
    async writeMultipleTags(writes) {
        const results = [];
        
        for (const write of writes) {
            try {
                await this.writeTag(write.plcName, write.tagName, write.value, write.isEuValue);
                results.push({ ...write, success: true });
            } catch (error) {
                results.push({ ...write, success: false, error: error.message });
            }
        }
        
        return results;
    }

    /**
     * Read current value from a specific PLC tag
     */
    readTag(plcName, tagName) {
        const fullTagName = `${plcName}.${tagName}`;
        const data = this.aggregatedData.get(fullTagName);
        
        if (!data) {
            throw new Error(`Tag ${fullTagName} not found or no recent data`);
        }
        
        return data;
    }

    /**
     * Get all current data from all PLCs
     */
    getAllData() {
        const result = {};
        
        for (const [fullTagName, data] of this.aggregatedData) {
            result[fullTagName] = data;
        }
        
        return result;
    }

    /**
     * Get data from a specific PLC
     */
    getPLCData(plcName) {
        const result = {};
        const prefix = `${plcName}.`;
        
        for (const [fullTagName, data] of this.aggregatedData) {
            if (fullTagName.startsWith(prefix)) {
                const tagName = fullTagName.substring(prefix.length);
                result[tagName] = data;
            }
        }
        
        return result;
    }

    /**
     * Get all active alarms from all PLCs
     */
    getAllAlarms() {
        return Array.from(this.aggregatedAlarms.values())
            .filter(alarm => alarm.state === 'ACTIVE' || alarm.state === 'ACKNOWLEDGED')
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Get alarms from a specific PLC
     */
    getPLCAlarms(plcName) {
        return Array.from(this.aggregatedAlarms.values())
            .filter(alarm => alarm.plcName === plcName)
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Acknowledge alarm
     */
    async acknowledgeAlarm(alarmId, username = 'SYSTEM') {
        try {
            const alarm = this.aggregatedAlarms.get(alarmId);
            if (!alarm) {
                throw new Error(`Alarm ${alarmId} not found`);
            }
            
            const client = this.plcClients.get(alarm.plcName);
            if (client && client.acknowledgeAlarm) {
                await client.acknowledgeAlarm(alarmId, username);
            }
            
            // Update local alarm state
            alarm.state = 'ACKNOWLEDGED';
            alarm.acknowledgedBy = username;
            alarm.acknowledgedAt = new Date();
            
            this.emit('alarm_acknowledged', { alarmId, alarm, username });
            
            return true;
            
        } catch (error) {
            console.error(`Failed to acknowledge alarm ${alarmId}:`, error);
            throw error;
        }
    }

    /**
     * Get system statistics
     */
    getSystemStats() {
        const connectedPLCs = Array.from(this.plcClients.values()).filter(client => client.connected).length;
        const totalTags = this.aggregatedData.size;
        const activeAlarms = this.getAllAlarms().length;
        const uptime = (Date.now() - this.stats.startTime.getTime()) / 1000;
        
        return {
            system: {
                uptime: uptime,
                startTime: this.stats.startTime,
                isInitialized: this.isInitialized
            },
            plcs: {
                total: this.plcConfigs.size,
                connected: connectedPLCs,
                configured: this.stats.totalConnections,
                failed: this.stats.failedConnections
            },
            tags: {
                total: totalTags,
                active: totalTags,
                dataPointsLogged: this.stats.dataPointsLogged
            },
            alarms: {
                total: this.stats.totalAlarms,
                active: activeAlarms
            },
            performance: {
                averageResponseTime: this.calculateAverageResponseTime(),
                dataPointsPerSecond: uptime > 0 ? this.stats.dataPointsLogged / uptime : 0
            }
        };
    }

    /**
     * Calculate average response time across all PLCs
     */
    calculateAverageResponseTime() {
        const responseTimes = [];
        
        for (const [plcName, config] of this.plcConfigs) {
            if (config.averageResponseTime) {
                responseTimes.push(config.averageResponseTime);
            }
        }
        
        return responseTimes.length > 0 ? 
            responseTimes.reduce((a, b) => a + b) / responseTimes.length : 0;
    }

    /**
     * Get detailed status for all PLCs
     */
    getDetailedStatus() {
        const plcStatuses = [];
        
        for (const [plcName, config] of this.plcConfigs) {
            const client = this.plcClients.get(plcName);
            const status = this.plcStatus.get(plcName);
            
            plcStatuses.push({
                plcName,
                config,
                connected: client ? client.connected : false,
                status: client ? client.getStatus() : 'OFFLINE',
                clientExists: !!client,
                localStatus: status,
                tagCount: Object.keys(this.getPLCData(plcName)).length,
                alarmCount: this.getPLCAlarms(plcName).length
            });
        }
        
        return {
            timestamp: new Date(),
            systemStats: this.getSystemStats(),
            plcStatuses: plcStatuses
        };
    }

    /**
     * Enable/disable a PLC connection
     */
    async enablePLC(plcName, enabled = true) {
        try {
            await this.connectionPool.request()
                .input('PLCName', sql.NVarChar, plcName)
                .input('Enabled', sql.Bit, enabled)
                .query('UPDATE PLCConnections SET Enabled = @Enabled WHERE PLCName = @PLCName');
            
            // Refresh configuration
            await this.loadPLCConfigurations();
            
            if (enabled) {
                const config = this.plcConfigs.get(plcName);
                if (config && config.autoConnect) {
                    await this.connectToPLC(plcName);
                }
            } else {
                await this.disconnectFromPLC(plcName);
            }
            
            this.emit('plc_enabled_changed', { plcName, enabled });
            return true;
            
        } catch (error) {
            console.error(`Failed to ${enabled ? 'enable' : 'disable'} PLC ${plcName}:`, error);
            throw error;
        }
    }

    /**
     * Add or update PLC configuration
     */
    async addOrUpdatePLC(plcConfig) {
        try {
            const request = this.connectionPool.request();
            
            // Add all parameters for sp_AddPLCConnection
            request.input('PLCName', sql.NVarChar, plcConfig.plcName);
            request.input('PLCDescription', sql.NVarChar, plcConfig.description || null);
            request.input('IPAddress', sql.NVarChar, plcConfig.address);
            request.input('Port', sql.Int, plcConfig.port || 102);
            request.input('Rack', sql.Int, plcConfig.rack || 0);
            request.input('Slot', sql.Int, plcConfig.slot || 2);
            request.input('Transport', sql.NVarChar, plcConfig.transport || 'iso-on-tcp');
            request.input('ConnectionMode', sql.NVarChar, plcConfig.connmode || 'rack-slot');
            request.input('CycleTime', sql.Int, plcConfig.cycletime || 1000);
            request.input('Timeout', sql.Int, plcConfig.timeout || 2000);
            request.input('Enabled', sql.Bit, plcConfig.enabled !== false);
            request.input('AutoConnect', sql.Bit, plcConfig.autoConnect !== false);
            request.input('Priority', sql.Int, plcConfig.priority || 5);
            request.input('Location', sql.NVarChar, plcConfig.location || null);
            request.input('Department', sql.NVarChar, plcConfig.department || null);
            request.input('SystemType', sql.NVarChar, plcConfig.systemType || null);
            request.input('CreatedBy', sql.NVarChar, 'MultiPLCManager');
            
            const result = await request.execute('sp_AddPLCConnection');
            
            // Refresh configurations
            await this.loadPLCConfigurations();
            
            this.emit('plc_config_updated', { plcName: plcConfig.plcName, result });
            return result;
            
        } catch (error) {
            console.error(`Failed to add/update PLC ${plcConfig.plcName}:`, error);
            throw error;
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        try {
            console.log('🔄 Shutting down Multi-PLC Manager...');
            this.isShuttingDown = true;
            
            // Clear timers
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = null;
            }
            
            if (this.configRefreshTimer) {
                clearInterval(this.configRefreshTimer);
                this.configRefreshTimer = null;
            }
            
            // Disconnect all PLCs
            const disconnectPromises = [];
            for (const plcName of this.plcClients.keys()) {
                disconnectPromises.push(this.disconnectFromPLC(plcName));
            }
            
            await Promise.allSettled(disconnectPromises);
            
            // Close database connection
            if (this.connectionPool) {
                await this.connectionPool.close();
                this.connectionPool = null;
            }
            
            console.log('✅ Multi-PLC Manager shut down successfully');
            this.emit('shutdown_complete');
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
}

module.exports = MultiPLCManager;
            