const { EventEmitter } = require('events');
const sql = require('mssql/msnodesqlv8');
const EnhancedS7ClientWithLogging = require('./EnhancedS7ClientWithLogging');

/**
 * Multi-PLC Manager for Dynamic PLC Connection Management
 * Works with the enhanced multi-PLC database schema (enhanced_multi_plc_schema.sql)
 * Supports dynamic PLC discovery, connection management, and centralized monitoring
 */
class MultiPLCManager extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // // SQL Server connection for PLC configuration
            // server: 'localhost',
            // database: 'IndolaktoWWTP',
            // options: {
            //     //encrypt: false,
            //     trustServerCertificate: true,
            //     //enableArithAbort: true,
            //     trustedConnection: true,
            //     //instanceName: 'MSSQLSERVER'
            // },
            // driver: "msnodesqlv8",
            
            // Multi-PLC settings
            // maxConcurrentConnections: 10,
            // connectionRetryInterval: 30000,    // 30 seconds
            // autoReconnectEnabled: true,
            // healthCheckInterval: 60000,        // 1 minute
            // priorityBasedConnection: true,
            
            // // Logging configuration
            // loggingConfig: {
            //     enableDataLogging: true,
            //     enableAlarmLogging: true,
            //     enableEventLogging: true,
            //     logInterval: 30000,
            //     dataRetentionDays: 90,
            //     alarmRetentionDays: 365,
            //     eventRetentionDays: 30
            // },
            
            ...config
        };

        // Connection management
        this.connectionPool = null;
        this.plcClients = new Map();          // PLCName -> EnhancedS7ClientWithLogging
        this.plcConfigurations = new Map();   // PLCName -> Config
        this.plcStatuses = new Map();         // PLCName -> Status
        
        // Management timers
        this.healthCheckTimer = null;
        this.reconnectTimer = null;
        this.configRefreshTimer = null;
        
        // Statistics
        this.systemStats = {
            startTime: new Date(),
            totalConnections: 0,
            successfulConnections: 0,
            failedConnections: 0,
            dataPointsLogged: 0,
            alarmsGenerated: 0
        };

        this.isInitialized = false;
    }

    /**
     * Initialize the Multi-PLC Manager
     */
    async initialize() {
        try {
            console.log('🚀 Initializing Multi-PLC Manager...');
            
            // Connect to database
            await this.connectToDatabase();
            
            // Load PLC configurations
            await this.loadPLCConfigurations();
            
            // Start management services
            this.startManagementServices();
            
            // Connect to enabled PLCs
            await this.connectToAllPLCs();
            
            this.isInitialized = true;
            console.log('✅ Multi-PLC Manager initialized successfully');
            this.emit('initialized');
            
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Multi-PLC Manager:', error);
            throw error;
        }
    }

    /**
     * Connect to the central database
     */
    async connectToDatabase() {
        try {
            console.log('📊 Connecting to Multi-PLC database...');
            
            const poolConfig = {
                user: this.config.user,
                password: this.config.password,
                server: this.config.server,
                database: this.config.database,
                pool: {
                     max: 20,
                     min: 0,
                     idleTimeoutMillis: 30000
                },
                options: this.config.options,
            };

            // Use Windows Authentication if no user/password provided
            if (!this.config.user && !this.config.password) {
                poolConfig.options.trustedConnection = true;
            }

            this.connectionPool = await sql.connect(poolConfig);
            console.log('✅ Connected to Multi-PLC database');
            
            // Log system startup event
            await this.logSystemEvent('SYSTEM_START', 'Multi-PLC Manager started', 'INFO');
            
            this.emit('database_connected');
            
        } catch (error) {
            console.error('❌ Database connection failed:', error);
            throw error;
        }
    }

    /**
     * Load PLC configurations from database
     */
    async loadPLCConfigurations() {
        try {
            console.log('📋 Loading PLC configurations...');
            
            const result = await this.connectionPool.request().execute('sp_GetPLCConfiguration');
            
            this.plcConfigurations.clear();
            
            for (const plcConfig of result.recordset) {
                this.plcConfigurations.set(plcConfig.PLCName, {
                    // Basic configuration
                    name: plcConfig.PLCName,
                    description: plcConfig.PLCDescription,
                    enabled: plcConfig.Enabled,
                    autoConnect: plcConfig.AutoConnect,
                    priority: plcConfig.Priority,
                    
                    // Connection parameters
                    transport: plcConfig.Transport,
                    address: plcConfig.IPAddress,
                    port: plcConfig.Port,
                    rack: plcConfig.Rack,
                    slot: plcConfig.Slot,
                    cycletime: plcConfig.CycleTime,
                    timeout: plcConfig.Timeout,
                    connmode: plcConfig.ConnectionMode,
                    
                    // TSAP configuration
                    localtsaphi: plcConfig.LocalTSAPHi,
                    localtsaplo: plcConfig.LocalTSAPLo,
                    remotetsaphi: plcConfig.RemoteTSAPHi,
                    remotetsaplo: plcConfig.RemoteTSAPLo,
                    
                    // Retry settings
                    maxRetries: plcConfig.MaxRetries,
                    retryDelay: plcConfig.RetryDelay,
                    
                    // Context information
                    location: plcConfig.Location,
                    department: plcConfig.Department,
                    systemType: plcConfig.SystemType,
                    maintenanceMode: plcConfig.MaintenanceMode,
                    
                    // SQL configuration for this PLC
                    sqlConfig: {
                        server: this.config.server,
                        database: this.config.database,
                        tagTable: 'Tags',
                        connectionPool: this.connectionPool,
                        options: this.config.options
                    },
                    
                    // Logging configuration
                    loggingConfig: {
                        ...this.config.loggingConfig,
                        connectionPool: this.connectionPool
                    }
                });
            }
            
            console.log(`📋 Loaded ${this.plcConfigurations.size} PLC configurations`);
            this.emit('configurations_loaded', { count: this.plcConfigurations.size });
            
        } catch (error) {
            console.error('❌ Failed to load PLC configurations:', error);
            throw error;
        }
    }

    /**
     * Connect to all enabled PLCs based on priority
     */
    async connectToAllPLCs() {
        try {
            console.log('🔌 Connecting to all enabled PLCs...');
            
            // Get enabled PLCs sorted by priority
            const enabledPLCs = Array.from(this.plcConfigurations.values())
                .filter(config => config.enabled && config.autoConnect && !config.maintenanceMode)
                .sort((a, b) => a.priority - b.priority);
            
            console.log(`🎯 Found ${enabledPLCs.length} PLCs to connect`);
            
            // Connect to PLCs respecting priority and concurrent connection limits
            const connectionPromises = [];
            let activeConnections = 0;
            
            for (const plcConfig of enabledPLCs) {
                if (activeConnections >= this.config.maxConcurrentConnections) {
                    console.log(`⏸️ Delaying connection to ${plcConfig.name} - max concurrent connections reached`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    activeConnections = Array.from(this.plcClients.values()).filter(client => client.connected).length;
                }
                
                if (activeConnections < this.config.maxConcurrentConnections) {
                    connectionPromises.push(this.connectToPLC(plcConfig.name));
                    activeConnections++;
                }
            }
            
            // Wait for all connections
            const results = await Promise.allSettled(connectionPromises);
            
            // Report results
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            
            console.log(`🔌 Connection results: ${successful} successful, ${failed} failed`);
            this.emit('mass_connection_complete', { successful, failed, total: results.length });
            
        } catch (error) {
            console.error('❌ Failed to connect to PLCs:', error);
            throw error;
        }
    }

    /**
     * Connect to a specific PLC
     */
    async connectToPLC(plcName) {
        try {
            const plcConfig = this.plcConfigurations.get(plcName);
            if (!plcConfig) {
                throw new Error(`PLC configuration not found: ${plcName}`);
            }
            
            if (this.plcClients.has(plcName)) {
                console.log(`⚠️ PLC ${plcName} already has a client instance`);
                return;
            }
            
            console.log(`🔌 Connecting to PLC: ${plcName} (${plcConfig.address}:${plcConfig.port})`);
            
            // Update status to connecting
            await this.updatePLCStatus(plcName, false, 'CONNECTING');
            
            // Create enhanced S7 client with logging for this PLC
            const client = new EnhancedS7ClientWithLogging(plcConfig);
            
            // Set up PLC-specific event handlers
            this.setupPLCEventHandlers(client, plcName, plcConfig);
            
            // Store client
            this.plcClients.set(plcName, client);
            
            // Initialize client (connects to both SQL and PLC)
            await client.initialize();
            
            this.systemStats.totalConnections++;
            this.systemStats.successfulConnections++;
            
            console.log(`✅ Successfully connected to PLC: ${plcName}`);
            await this.logSystemEvent('PLC_CONNECTED', `Successfully connected to PLC ${plcName}`, 'INFO', plcName);
            
            this.emit('plc_connected', { plcName, config: plcConfig });
            
        } catch (error) {
            console.error(`❌ Failed to connect to PLC ${plcName}:`, error);
            
            this.systemStats.totalConnections++;
            this.systemStats.failedConnections++;
            
            await this.updatePLCStatus(plcName, false, 'ERROR', null, null, error.message);
            await this.logSystemEvent('PLC_CONNECTION_FAILED', `Failed to connect to PLC ${plcName}: ${error.message}`, 'ERROR', plcName);
            
            this.emit('plc_connection_failed', { plcName, error: error.message });
            throw error;
        }
    }

    /**
     * Set up event handlers for a PLC client
     */
    setupPLCEventHandlers(client, plcName, plcConfig) {
        // Connection events
        client.on('fully_initialized', () => {
            console.log(`🎉 PLC ${plcName} fully initialized with logging`);
        });

        client.on('connected', async () => {
            console.log(`🔌 PLC ${plcName} connected`);
            await this.updatePLCStatus(plcName, true, 'ONLINE');
        });

        client.on('disconnected', async () => {
            console.log(`🔌 PLC ${plcName} disconnected`);
            await this.updatePLCStatus(plcName, false, 'OFFLINE');
            
            // Schedule reconnection if auto-reconnect is enabled
            if (this.config.autoReconnectEnabled && plcConfig.autoConnect) {
                this.scheduleReconnection(plcName);
            }
        });

        client.on('error', async (error) => {
            console.error(`❌ PLC ${plcName} error:`, error.message);
            await this.updatePLCStatus(plcName, false, 'ERROR', null, null, error.message);
        });

        // Data events
        client.on('enhanced_data', (data) => {
            this.emit('plc_data', { plcName, data });
            // Update statistics
            this.systemStats.dataPointsLogged += Object.keys(data).length;
        });

        client.on('alarm', async (alarm) => {
            console.log(`🚨 ALARM from ${plcName}: ${alarm.type} - ${alarm.tagName}`);
            this.systemStats.alarmsGenerated++;
            this.emit('plc_alarm', { plcName, ...alarm });
        });

        // Logging events
        client.on('data_logged', (entry) => {
            this.emit('data_logged', { plcName, ...entry });
        });

        client.on('alarm_logged', (entry) => {
            this.emit('alarm_logged', { plcName, ...entry });
        });

        // SQL events
        client.on('tags_updated', (info) => {
            console.log(`📋 Tags updated for PLC ${plcName}: ${info.tagCount} tags`);
            this.emit('plc_tags_updated', { plcName, ...info });
        });
    }

    /**
     * Update PLC connection status in database
     */
    async updatePLCStatus(plcName, isConnected, connectionState = null, cycleTime = null, responseTime = null, errorMessage = null) {
        try {
            const request = this.connectionPool.request();
            request.input('PLCName', sql.NVarChar, plcName);
            request.input('IsConnected', sql.Bit, isConnected);
            request.input('ConnectionState', sql.NVarChar, connectionState);
            request.input('CurrentCycleTime', sql.Int, cycleTime);
            request.input('ResponseTime', sql.Float, responseTime);
            request.input('ErrorMessage', sql.NVarChar, errorMessage);
            
            await request.execute('sp_UpdatePLCStatus');
            
            // Update local status cache
            this.plcStatuses.set(plcName, {
                isConnected,
                connectionState,
                lastUpdate: new Date(),
                errorMessage
            });
            
        } catch (error) {
            console.error(`Error updating status for PLC ${plcName}:`, error);
        }
    }

    /**
     * Disconnect from a specific PLC
     */
    async disconnectFromPLC(plcName) {
        try {
            const client = this.plcClients.get(plcName);
            if (!client) {
                console.log(`⚠️ No client found for PLC: ${plcName}`);
                return;
            }
            
            console.log(`🔌 Disconnecting from PLC: ${plcName}`);
            
            await client.disconnect();
            this.plcClients.delete(plcName);
            
            await this.updatePLCStatus(plcName, false, 'OFFLINE');
            await this.logSystemEvent('PLC_DISCONNECTED', `Disconnected from PLC ${plcName}`, 'INFO', plcName);
            
            this.emit('plc_disconnected', { plcName });
            
        } catch (error) {
            console.error(`❌ Error disconnecting from PLC ${plcName}:`, error);
        }
    }

    /**
     * Add a new PLC configuration
     */
    async addPLCConfiguration(plcData) {
        try {
            const request = this.connectionPool.request();
            
            // Use the enhanced stored procedure
            request.input('PLCName', sql.NVarChar, plcData.name);
            request.input('PLCDescription', sql.NVarChar, plcData.description || '');
            request.input('IPAddress', sql.NVarChar, plcData.address);
            request.input('Port', sql.Int, plcData.port || 102);
            request.input('Rack', sql.Int, plcData.rack || 0);
            request.input('Slot', sql.Int, plcData.slot || 2);
            request.input('Transport', sql.NVarChar, plcData.transport || 'iso-on-tcp');
            request.input('ConnectionMode', sql.NVarChar, plcData.connmode || 'rack-slot');
            request.input('CycleTime', sql.Int, plcData.cycletime || 1000);
            request.input('Timeout', sql.Int, plcData.timeout || 2000);
            request.input('Enabled', sql.Bit, plcData.enabled !== false);
            request.input('AutoConnect', sql.Bit, plcData.autoConnect !== false);
            request.input('Priority', sql.Int, plcData.priority || 5);
            request.input('Location', sql.NVarChar, plcData.location);
            request.input('Department', sql.NVarChar, plcData.department);
            request.input('SystemType', sql.NVarChar, plcData.systemType);
            request.input('CreatedBy', sql.NVarChar, plcData.createdBy || 'API_USER');
            
            const result = await request.execute('sp_AddPLCConnection');
            
            // Reload configurations
            await this.loadPLCConfigurations();
            
            // Auto-connect if enabled
            if (plcData.enabled && plcData.autoConnect) {
                await this.connectToPLC(plcData.name);
            }
            
            await this.logSystemEvent('PLC_CONFIGURATION_ADDED', `PLC configuration added: ${plcData.name}`, 'INFO');
            this.emit('plc_configuration_added', { plcName: plcData.name });
            
            return result.recordset[0];
            
        } catch (error) {
            console.error('❌ Failed to add PLC configuration:', error);
            throw error;
        }
    }

    /**
     * Add tags to a specific PLC
     */
    async addTagsToPLC(plcName, tags) {
        try {
            if (!this.plcConfigurations.has(plcName)) {
                throw new Error(`PLC ${plcName} not found`);
            }
            
            const client = this.plcClients.get(plcName);
            if (!client) {
                throw new Error(`PLC ${plcName} is not connected`);
            }
            
            const results = [];
            
            for (const tagData of tags) {
                const request = this.connectionPool.request();
                
                // Use the enhanced stored procedure for tag creation
                request.input('PLCName', sql.NVarChar, plcName);
                request.input('TagName', sql.NVarChar, tagData.name);
                request.input('TagAddress', sql.NVarChar, tagData.addr);
                request.input('TagType', sql.NVarChar, tagData.type || 'REAL');
                request.input('Description', sql.NVarChar, tagData.description || '');
                request.input('GroupName', sql.NVarChar, tagData.group || 'Default');
                request.input('RawMin', sql.Float, tagData.rawMin || 0);
                request.input('RawMax', sql.Float, tagData.rawMax || 32767);
                request.input('EuMin', sql.Float, tagData.euMin || 0);
                request.input('EuMax', sql.Float, tagData.euMax || 100);
                request.input('EngineeringUnits', sql.NVarChar, tagData.units || '');
                request.input('DecimalPlaces', sql.Int, tagData.decimalPlaces || 2);
                request.input('MinValue', sql.Float, tagData.minValue);
                request.input('MaxValue', sql.Float, tagData.maxValue);
                request.input('AlarmHigh', sql.Float, tagData.alarmHigh);
                request.input('AlarmLow', sql.Float, tagData.alarmLow);
                request.input('AlarmEnabled', sql.Bit, tagData.alarmEnabled !== false);
                request.input('LoggingEnabled', sql.Bit, tagData.loggingEnabled !== false);
                request.input('CreatedBy', sql.NVarChar, 'API_USER');
                
                const result = await request.execute('sp_AddEnhancedTagWithPLC');
                results.push(result.recordset[0]);
            }
            
            // Refresh tags in the client
            await client.refreshTags();
            
            await this.logSystemEvent('TAGS_ADDED', `Added ${tags.length} tags to PLC ${plcName}`, 'INFO', plcName);
            this.emit('tags_added', { plcName, count: tags.length });
            
            return results;
            
        } catch (error) {
            console.error(`❌ Failed to add tags to PLC ${plcName}:`, error);
            throw error;
        }
    }

    /**
     * Get data from a specific PLC
     */
    getPLCData(plcName) {
        const client = this.plcClients.get(plcName);
        if (!client) {
            return null;
        }
        
        return {
            connected: client.connected,
            data: client.enhancedData || {},
            status: client.getEnhancedStatusWithLogging()
        };
    }

    /**
     * Get data from all connected PLCs
     */
    getAllPLCData() {
        const allData = {};
        
        for (const [plcName, client] of this.plcClients) {
            allData[plcName] = {
                connected: client.connected,
                data: client.enhancedData || {},
                status: client.getEnhancedStatusWithLogging(),
                lastUpdate: new Date()
            };
        }
        
        return allData;
    }

    /**
     * Write value to a tag on a specific PLC
     */
    async writeToPLC(plcName, tagName, value, isEuValue = true) {
        const client = this.plcClients.get(plcName);
        if (!client) {
            throw new Error(`PLC ${plcName} is not connected`);
        }
        
        await client.writeVariable(tagName, value, isEuValue);
        
        await this.logSystemEvent('VALUE_WRITTEN', 
            `Written to ${plcName}.${tagName}: ${value}`, 'INFO', plcName, tagName);
    }

    /**
     * Schedule reconnection for a PLC
     */
    scheduleReconnection(plcName) {
        const config = this.plcConfigurations.get(plcName);
        if (!config || !config.autoConnect) {
            return;
        }
        
        const retryDelay = config.retryDelay || this.config.connectionRetryInterval;
        
        console.log(`⏰ Scheduling reconnection for PLC ${plcName} in ${retryDelay}ms`);
        
        setTimeout(async () => {
            try {
                if (!this.plcClients.has(plcName) || !this.plcClients.get(plcName).connected) {
                    console.log(`🔄 Attempting to reconnect to PLC ${plcName}`);
                    await this.connectToPLC(plcName);
                }
            } catch (error) {
                console.error(`❌ Reconnection failed for PLC ${plcName}:`, error.message);
                // Schedule another attempt
                if (this.config.autoReconnectEnabled) {
                    this.scheduleReconnection(plcName);
                }
            }
        }, retryDelay);
    }

    /**
     * Start management services (health checks, etc.)
     */
    startManagementServices() {
        console.log('🛠️ Starting management services...');
        
        // Health check timer
        if (this.config.healthCheckInterval > 0) {
            this.healthCheckTimer = setInterval(() => {
                this.performHealthCheck();
            }, this.config.healthCheckInterval);
        }
        
        // Configuration refresh timer
        this.configRefreshTimer = setInterval(() => {
            this.refreshConfigurations();
        }, 300000); // 5 minutes
    }

    /**
     * Perform health check on all PLCs
     */
    async performHealthCheck() {
        try {
            for (const [plcName, client] of this.plcClients) {
                const status = client.getEnhancedStatusWithLogging();
                
                await this.updatePLCStatus(
                    plcName,
                    client.connected,
                    client.connected ? 'ONLINE' : 'OFFLINE',
                    client.currentCycleTime,
                    status.s7.averageResponseTime
                );
            }
            
            this.emit('health_check_complete', { 
                timestamp: new Date(), 
                connectedPLCs: Array.from(this.plcClients.values()).filter(c => c.connected).length,
                totalPLCs: this.plcClients.size
            });
            
        } catch (error) {
            console.error('❌ Health check error:', error);
        }
    }

    /**
     * Refresh configurations from database
     */
    async refreshConfigurations() {
        try {
            console.log('🔄 Refreshing PLC configurations...');
            
            const oldCount = this.plcConfigurations.size;
            await this.loadPLCConfigurations();
            const newCount = this.plcConfigurations.size;
            
            if (newCount !== oldCount) {
                console.log(`📋 Configuration changes detected: ${oldCount} -> ${newCount} PLCs`);
                this.emit('configurations_changed', { oldCount, newCount });
            }
            
        } catch (error) {
            console.error('❌ Failed to refresh configurations:', error);
        }
    }

    /**
     * Log system events
     */
    async logSystemEvent(eventType, message, category = 'INFO', plcName = null, tagName = null) {
        try {
            const request = this.connectionPool.request();
            request.input('PLCName', sql.NVarChar, plcName);
            request.input('EventType', sql.NVarChar, eventType);
            request.input('EventCategory', sql.NVarChar, category);
            request.input('EventMessage', sql.NVarChar, message);
            request.input('TagName', sql.NVarChar, tagName);
            request.input('Username', sql.NVarChar, 'SYSTEM');
            request.input('Source', sql.NVarChar, 'MultiPLCManager');
            request.input('SourceVersion', sql.NVarChar, '2.1.0');
            request.input('AdditionalData', sql.NVarChar, JSON.stringify({
                totalPLCs: this.plcClients.size,
                connectedPLCs: Array.from(this.plcClients.values()).filter(c => c.connected).length,
                systemUptime: (new Date() - this.systemStats.startTime) / 1000
            }));
            
            await request.query(`
                INSERT INTO EventHistory (
                    PLCName, EventType, EventCategory, EventMessage, TagName,
                    Username, Source, SourceVersion, AdditionalData, Timestamp
                ) VALUES (
                    @PLCName, @EventType, @EventCategory, @EventMessage, @TagName,
                    @Username, @Source, @SourceVersion, @AdditionalData, GETDATE()
                )
            `);
            
        } catch (error) {
            console.error('❌ Failed to log system event:', error);
        }
    }

    /**
     * Get comprehensive system status
     */
    getSystemStatus() {
        const connectedPLCs = Array.from(this.plcClients.values()).filter(c => c.connected);
        const uptime = (new Date() - this.systemStats.startTime) / 1000;
        
        return {
            // System overview
            system: {
                initialized: this.isInitialized,
                uptime: uptime,
                startTime: this.systemStats.startTime,
                version: '2.1.0'
            },
            
            // PLC statistics
            plcs: {
                total: this.plcConfigurations.size,
                connected: connectedPLCs.length,
                clients: this.plcClients.size,
                configurations: Array.from(this.plcConfigurations.keys())
            },
            
            // Connection statistics
            connections: {
                total: this.systemStats.totalConnections,
                successful: this.systemStats.successfulConnections,
                failed: this.systemStats.failedConnections,
                successRate: this.systemStats.totalConnections > 0 ? 
                    (this.systemStats.successfulConnections / this.systemStats.totalConnections) * 100 : 0
            },
            
            // Data statistics
            data: {
                pointsLogged: this.systemStats.dataPointsLogged,
                alarmsGenerated: this.systemStats.alarmsGenerated,
                loggingActive: connectedPLCs.filter(c => c.isLoggingEnabled).length
            },
            
            // Service status
            services: {
                healthCheck: !!this.healthCheckTimer,
                autoReconnect: this.config.autoReconnectEnabled,
                configRefresh: !!this.configRefreshTimer
            },
            
            // Database status
            database: {
                connected: !!this.connectionPool,
                server: this.config.server,
                database: this.config.database
            },
            
            timestamp: new Date()
        };
    }

    /**
     * Get detailed PLC statuses
     */
    async getPLCStatuses() {
        try {
            const result = await this.connectionPool.request()
                .query(`
                    SELECT 
                        plc.PLCName,
                        plc.PLCDescription,
                        plc.IPAddress,
                        plc.Port,
                        plc.Location,
                        plc.Department,
                        plc.SystemType,
                        plc.Enabled,
                        plc.AutoConnect,
                        plc.Priority,
                        plc.MaintenanceMode,
                        
                        status.IsConnected,
                        status.ConnectionState,
                        status.LastStatusChange,
                        status.CurrentCycleTime,
                        status.AverageResponseTime,
                        status.ActiveTags,
                        status.GoodQualityTags,
                        status.BadQualityTags,
                        status.LastDataUpdate,
                        status.LastError,
                        status.LastErrorTime,
                        status.SessionStarted,
                        status.SessionDuration,
                        
                        plc.ConnectionAttempts,
                        plc.SuccessfulConnections,
                        plc.FailedConnections,
                        plc.UptimePercent,
                        plc.DataQualityPercent
                        
                    FROM PLCConnections plc
                    LEFT JOIN PLCConnectionStatus status ON plc.PLCName = status.PLCName
                    ORDER BY plc.Priority, plc.PLCName
                `);
            
            return result.recordset.map(row => ({
                name: row.PLCName,
                description: row.PLCDescription,
                address: row.IPAddress,
                port: row.Port,
                location: row.Location,
                department: row.Department,
                systemType: row.SystemType,
                enabled: row.Enabled,
                autoConnect: row.AutoConnect,
                priority: row.Priority,
                maintenanceMode: row.MaintenanceMode,
                
                status: {
                    connected: row.IsConnected,
                    state: row.ConnectionState,
                    lastChange: row.LastStatusChange,
                    cycleTime: row.CurrentCycleTime,
                    responseTime: row.AverageResponseTime,
                    activeTags: row.ActiveTags,
                    goodQualityTags: row.GoodQualityTags,
                    badQualityTags: row.BadQualityTags,
                    lastDataUpdate: row.LastDataUpdate,
                    lastError: row.LastError,
                    lastErrorTime: row.LastErrorTime,
                    sessionStarted: row.SessionStarted,
                    sessionDuration: row.SessionDuration
                },
                
                statistics: {
                    connectionAttempts: row.ConnectionAttempts,
                    successfulConnections: row.SuccessfulConnections,
                    failedConnections: row.FailedConnections,
                    uptimePercent: row.UptimePercent,
                    dataQualityPercent: row.DataQualityPercent
                },
                
                hasClient: this.plcClients.has(row.PLCName),
                clientConnected: this.plcClients.has(row.PLCName) ? 
                    this.plcClients.get(row.PLCName).connected : false
            }));
            
        } catch (error) {
            console.error('❌ Failed to get PLC statuses:', error);
            throw error;
        }
    }

    /**
     * Get historical data across multiple PLCs
     */
    async getMultiPLCHistoricalData(tagFilters = {}, startDate, endDate, limit = 1000) {
        try {
            let whereClause = 'WHERE dh.Timestamp BETWEEN @startDate AND @endDate';
            const request = this.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .input('limit', sql.Int, limit);
            
            // Add PLC filter if specified
            if (tagFilters.plcName) {
                whereClause += ' AND dh.PLCName = @plcName';
                request.input('plcName', sql.NVarChar, tagFilters.plcName);
            }
            
            // Add tag filter if specified
            if (tagFilters.tagName) {
                whereClause += ' AND dh.TagName = @tagName';
                request.input('tagName', sql.NVarChar, tagFilters.tagName);
            }
            
            // Add group filter if specified
            if (tagFilters.groupName) {
                whereClause += ' AND t.GroupName = @groupName';
                request.input('groupName', sql.NVarChar, tagFilters.groupName);
            }
            
            const result = await request.query(`
                SELECT TOP (@limit)
                    dh.PLCName,
                    dh.TagName,
                    dh.RawValue,
                    dh.EuValue,
                    dh.Quality,
                    dh.Timestamp,
                    dh.LogType,
                    t.EngineeringUnits,
                    t.GroupName,
                    t.Description,
                    plc.PLCDescription,
                    plc.Location,
                    plc.Department,
                    plc.SystemType,
                    CASE 
                        WHEN dh.Quality = 192 THEN 'Good'
                        WHEN dh.Quality >= 128 THEN 'Uncertain' 
                        ELSE 'Bad'
                    END as QualityText
                FROM DataHistory dh
                LEFT JOIN Tags t ON dh.PLCName = t.PLCName AND dh.TagName = t.TagName
                LEFT JOIN PLCConnections plc ON dh.PLCName = plc.PLCName
                ${whereClause}
                ORDER BY dh.Timestamp DESC, dh.PLCName, dh.TagName
            `);
            
            return result.recordset;
            
        } catch (error) {
            console.error('❌ Failed to get multi-PLC historical data:', error);
            throw error;
        }
    }

    /**
     * Get alarm history across all PLCs
     */
    async getMultiPLCAlarmHistory(filters = {}, limit = 100) {
        try {
            let whereClause = 'WHERE 1=1';
            const request = this.connectionPool.request()
                .input('limit', sql.Int, limit);
            
            if (filters.plcName) {
                whereClause += ' AND ah.PLCName = @plcName';
                request.input('plcName', sql.NVarChar, filters.plcName);
            }
            
            if (filters.alarmType) {
                whereClause += ' AND ah.AlarmType = @alarmType';
                request.input('alarmType', sql.NVarChar, filters.alarmType);
            }
            
            if (filters.severity) {
                whereClause += ' AND ah.Severity = @severity';
                request.input('severity', sql.NVarChar, filters.severity);
            }
            
            if (filters.startDate) {
                whereClause += ' AND ah.ActiveTime >= @startDate';
                request.input('startDate', sql.DateTime2, filters.startDate);
            }
            
            const result = await request.query(`
                SELECT TOP (@limit)
                    ah.AlarmID,
                    ah.PLCName,
                    ah.TagName,
                    ah.AlarmType,
                    ah.AlarmState,
                    ah.CurrentValue,
                    ah.LimitValue,
                    ah.Deviation,
                    ah.AlarmMessage,
                    ah.Severity,
                    ah.Priority,
                    ah.ActiveTime,
                    ah.AcknowledgedBy,
                    ah.AcknowledgedAt,
                    ah.ClearedAt,
                    ah.DurationSeconds,
                    ah.AlarmGroup,
                    ah.OperatorComments,
                    t.EngineeringUnits,
                    t.Description as TagDescription,
                    plc.PLCDescription,
                    plc.Location,
                    plc.Department,
                    plc.SystemType
                FROM AlarmHistory ah
                LEFT JOIN Tags t ON ah.PLCName = t.PLCName AND ah.TagName = t.TagName
                LEFT JOIN PLCConnections plc ON ah.PLCName = plc.PLCName
                ${whereClause}
                ORDER BY ah.ActiveTime DESC
            `);
            
            return result.recordset;
            
        } catch (error) {
            console.error('❌ Failed to get multi-PLC alarm history:', error);
            throw error;
        }
    }

    /**
     * Generate comprehensive system report
     */
    async generateSystemReport(reportType = 'summary', timeRange = '24h') {
        try {
            const endDate = new Date();
            let startDate;
            
            switch (timeRange) {
                case '1h':
                    startDate = new Date(endDate - 60 * 60 * 1000);
                    break;
                case '24h':
                    startDate = new Date(endDate - 24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    startDate = new Date(endDate - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startDate = new Date(endDate - 30 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startDate = new Date(endDate - 24 * 60 * 60 * 1000);
            }
            
            const report = {
                reportType,
                timeRange,
                generatedAt: new Date(),
                startDate,
                endDate
            };
            
            if (reportType === 'summary' || reportType === 'full') {
                // System overview
                report.systemOverview = this.getSystemStatus();
                
                // PLC statuses
                report.plcStatuses = await this.getPLCStatuses();
                
                // Recent alarms
                report.recentAlarms = await this.getMultiPLCAlarmHistory({
                    startDate
                }, 50);
                
                // Data quality metrics
                const dataQualityResult = await this.connectionPool.request()
                    .input('startDate', sql.DateTime2, startDate)
                    .input('endDate', sql.DateTime2, endDate)
                    .query(`
                        SELECT 
                            dh.PLCName,
                            COUNT(*) as TotalRecords,
                            COUNT(CASE WHEN dh.Quality = 192 THEN 1 END) as GoodRecords,
                            COUNT(CASE WHEN dh.Quality < 192 THEN 1 END) as BadRecords,
                            CAST(COUNT(CASE WHEN dh.Quality = 192 THEN 1 END) * 100.0 / COUNT(*) as DECIMAL(5,2)) as QualityPercentage
                        FROM DataHistory dh
                        WHERE dh.Timestamp BETWEEN @startDate AND @endDate
                        GROUP BY dh.PLCName
                        ORDER BY dh.PLCName
                    `);
                
                report.dataQuality = dataQualityResult.recordset;
            }
            
            if (reportType === 'detailed' || reportType === 'full') {
                // Tag performance metrics
                const tagPerformanceResult = await this.connectionPool.request()
                    .input('startDate', sql.DateTime2, startDate)
                    .input('endDate', sql.DateTime2, endDate)
                    .query(`
                        SELECT 
                            dh.PLCName,
                            dh.TagName,
                            COUNT(*) as RecordCount,
                            MIN(dh.EuValue) as MinValue,
                            MAX(dh.EuValue) as MaxValue,
                            AVG(dh.EuValue) as AvgValue,
                            STDEV(dh.EuValue) as StdDeviation,
                            t.EngineeringUnits,
                            t.GroupName
                        FROM DataHistory dh
                        LEFT JOIN Tags t ON dh.PLCName = t.PLCName AND dh.TagName = t.TagName
                        WHERE dh.Timestamp BETWEEN @startDate AND @endDate
                        GROUP BY dh.PLCName, dh.TagName, t.EngineeringUnits, t.GroupName
                        HAVING COUNT(*) > 10
                        ORDER BY dh.PLCName, dh.TagName
                    `);
                
                report.tagPerformance = tagPerformanceResult.recordset;
                
                // Alarm summary by PLC
                const alarmSummaryResult = await this.connectionPool.request()
                    .input('startDate', sql.DateTime2, startDate)
                    .input('endDate', sql.DateTime2, endDate)
                    .query(`
                        SELECT 
                            ah.PLCName,
                            ah.Severity,
                            COUNT(*) as AlarmCount,
                            AVG(ah.DurationSeconds) as AvgDurationSeconds
                        FROM AlarmHistory ah
                        WHERE ah.ActiveTime BETWEEN @startDate AND @endDate
                        GROUP BY ah.PLCName, ah.Severity
                        ORDER BY ah.PLCName, ah.Severity
                    `);
                
                report.alarmSummary = alarmSummaryResult.recordset;
            }
            
            await this.logSystemEvent('REPORT_GENERATED', 
                `Generated ${reportType} report for ${timeRange}`, 'INFO');
            
            return report;
            
        } catch (error) {
            console.error('❌ Failed to generate system report:', error);
            throw error;
        }
    }

    /**
     * Stop all management services and disconnect from all PLCs
     */
    async shutdown() {
        try {
            console.log('🔄 Shutting down Multi-PLC Manager...');
            
            // Stop timers
            if (this.healthCheckTimer) {
                clearInterval(this.healthCheckTimer);
                this.healthCheckTimer = null;
            }
            
            if (this.reconnectTimer) {
                clearInterval(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            
            if (this.configRefreshTimer) {
                clearInterval(this.configRefreshTimer);
                this.configRefreshTimer = null;
            }
            
            // Disconnect from all PLCs
            const disconnectPromises = [];
            for (const plcName of this.plcClients.keys()) {
                disconnectPromises.push(this.disconnectFromPLC(plcName));
            }
            
            await Promise.allSettled(disconnectPromises);
            
            // Log shutdown event
            await this.logSystemEvent('SYSTEM_SHUTDOWN', 
                'Multi-PLC Manager shutting down gracefully', 'INFO');
            
            // Close database connection
            if (this.connectionPool) {
                await this.connectionPool.close();
                this.connectionPool = null;
            }
            
            console.log('✅ Multi-PLC Manager shutdown complete');
            this.emit('shutdown');
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }

    /**
     * Export multi-PLC data to CSV
     */
    async exportMultiPLCData(options = {}) {
        try {
            const {
                plcNames = null,
                tagNames = null,
                startDate = new Date(Date.now() - 24 * 60 * 60 * 1000),
                endDate = new Date(),
                includeMetadata = true
            } = options;
            
            let whereClause = 'WHERE dh.Timestamp BETWEEN @startDate AND @endDate';
            const request = this.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate);
            
            if (plcNames && plcNames.length > 0) {
                const plcList = plcNames.map(name => `'${name}'`).join(',');
                whereClause += ` AND dh.PLCName IN (${plcList})`;
            }
            
            if (tagNames && tagNames.length > 0) {
                const tagList = tagNames.map(name => `'${name}'`).join(',');
                whereClause += ` AND dh.TagName IN (${tagList})`;
            }
            
            const result = await request.query(`
                SELECT 
                    dh.PLCName,
                    dh.TagName,
                    dh.EuValue as Value,
                    dh.RawValue,
                    dh.Quality,
                    dh.Timestamp,
                    dh.LogType,
                    t.EngineeringUnits,
                    t.GroupName,
                    t.Description,
                    plc.PLCDescription,
                    plc.Location,
                    plc.Department,
                    plc.SystemType,
                    CASE 
                        WHEN dh.Quality = 192 THEN 'Good'
                        WHEN dh.Quality >= 128 THEN 'Uncertain' 
                        ELSE 'Bad'
                    END as QualityText
                FROM DataHistory dh
                LEFT JOIN Tags t ON dh.PLCName = t.PLCName AND dh.TagName = t.TagName
                LEFT JOIN PLCConnections plc ON dh.PLCName = plc.PLCName
                ${whereClause}
                ORDER BY dh.PLCName, dh.TagName, dh.Timestamp
            `);
            
            // Build CSV headers
            let headers = [
                'PLCName', 'TagName', 'Value', 'RawValue', 'EngineeringUnits', 
                'Quality', 'QualityText', 'Timestamp', 'LogType'
            ];
            
            if (includeMetadata) {
                headers = headers.concat([
                    'GroupName', 'Description', 'PLCDescription', 
                    'Location', 'Department', 'SystemType'
                ]);
            }
            
            // Build CSV data
            const csvData = [headers.join(',')];
            
            result.recordset.forEach(row => {
                let csvRow = [
                    row.PLCName,
                    row.TagName,
                    row.Value || '',
                    row.RawValue || '',
                    row.EngineeringUnits || '',
                    row.Quality || '',
                    row.QualityText || '',
                    row.Timestamp ? row.Timestamp.toISOString() : '',
                    row.LogType || ''
                ];
                
                if (includeMetadata) {
                    csvRow = csvRow.concat([
                        row.GroupName || '',
                        row.Description || '',
                        row.PLCDescription || '',
                        row.Location || '',
                        row.Department || '',
                        row.SystemType || ''
                    ]);
                }
                
                csvData.push(csvRow.map(field => `"${field}"`).join(','));
            });
            
            return csvData.join('\n');
            
        } catch (error) {
            console.error('❌ Failed to export multi-PLC data:', error);
            throw error;
        }
    }
}

module.exports = MultiPLCManager;