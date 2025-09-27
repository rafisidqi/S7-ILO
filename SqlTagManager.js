const { EventEmitter } = require('events');
const sql = require('mssql');

/**
 * Enhanced SQL Tag Manager - Updated for Multi-PLC Schema
 * Works with the new enhanced multi-PLC database schema (enhanced_multi_plc_schema.sql)
 * Supports PLC-specific tag management, engineering units, and enhanced configuration
 */
class SqlTagManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // SQL Server connection settings
            server: 'localhost\\SQLEXPRESS',
            database: 'IndolaktoWWTP',  // Updated for multi-PLC schema
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true,
                instanceName: 'SQLEXPRESS'
            },
            // Table configuration - updated for new multi-PLC schema
            tagTable: 'Tags',
            plcTable: 'PLCConnections',
            // PLC context - for single PLC clients using this manager
            plcName: null,  // Will be set when used with specific PLC
            // Cache settings
            cacheRefreshInterval: 30000, // 30 seconds
            enableAutoRefresh: true,
            // Connection pool settings
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            },
            ...config
        };

        this.connectionPool = null;
        this.tagCache = new Map();
        this.plcCache = new Map();
        this.lastRefresh = null;
        this.refreshTimer = null;
        this.isConnected = false;

        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.refreshTags = this.refreshTags.bind(this);
    }

    /**
     * Initialize connection to SQL Server
     */
    async connect() {
        try {
            console.log('Connecting to Multi-PLC SQL Server...');
            
            const poolConfig = {
                user: this.config.user,
                password: this.config.password,
                server: this.config.server,
                database: this.config.database,
                pool: this.config.pool,
                options: this.config.options
            };

            // Use Windows Authentication if no user/password provided
            if (!this.config.user && !this.config.password) {
                poolConfig.options.trustedConnection = true;
            }

            this.connectionPool = await sql.connect(poolConfig);
            this.isConnected = true;
            
            console.log('Connected to Multi-PLC SQL Server successfully');
            this.emit('connected');

            // Load PLC configurations first
            await this.refreshPLCConfigurations();

            // Initial tag refresh
            await this.refreshTags();

            // Start auto-refresh if enabled
            if (this.config.enableAutoRefresh) {
                this.startAutoRefresh();
            }

            return true;

        } catch (error) {
            console.error('Multi-PLC SQL Server connection failed:', error);
            this.isConnected = false;
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Disconnect from SQL Server
     */
    async disconnect() {
        try {
            console.log('Disconnecting from Multi-PLC SQL Server...');
            
            // Stop auto-refresh
            this.stopAutoRefresh();

            if (this.connectionPool) {
                await this.connectionPool.close();
                this.connectionPool = null;
            }

            this.isConnected = false;
            this.tagCache.clear();
            this.plcCache.clear();
            
            console.log('Disconnected from Multi-PLC SQL Server');
            this.emit('disconnected');

        } catch (error) {
            console.error('Error disconnecting from Multi-PLC SQL Server:', error);
            this.emit('error', error);
        }
    }

    /**
     * Refresh PLC configurations from database
     */
    async refreshPLCConfigurations() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            console.log('Refreshing PLC configurations...');
            
            const result = await this.connectionPool.request().query(`
                SELECT 
                    PLCName,
                    PLCDescription,
                    IPAddress,
                    Port,
                    Rack,
                    Slot,
                    Transport,
                    ConnectionMode,
                    CycleTime,
                    Timeout,
                    Enabled,
                    AutoConnect,
                    Priority,
                    Location,
                    Department,
                    SystemType,
                    MaintenanceMode,
                    CreatedDate,
                    ModifiedDate
                FROM PLCConnections
                ORDER BY Priority, PLCName
            `);

            this.plcCache.clear();
            
            result.recordset.forEach(row => {
                this.plcCache.set(row.PLCName, {
                    name: row.PLCName,
                    description: row.PLCDescription,
                    address: row.IPAddress,
                    port: row.Port,
                    rack: row.Rack,
                    slot: row.Slot,
                    transport: row.Transport,
                    connectionMode: row.ConnectionMode,
                    cycleTime: row.CycleTime,
                    timeout: row.Timeout,
                    enabled: row.Enabled,
                    autoConnect: row.AutoConnect,
                    priority: row.Priority,
                    location: row.Location,
                    department: row.Department,
                    systemType: row.SystemType,
                    maintenanceMode: row.MaintenanceMode,
                    createdDate: row.CreatedDate,
                    modifiedDate: row.ModifiedDate
                });
            });

            console.log(`Refreshed ${this.plcCache.size} PLC configurations`);
            
        } catch (error) {
            console.error('Error refreshing PLC configurations:', error);
            throw error;
        }
    }

    /**
     * Refresh tags from database with enhanced multi-PLC schema support
     */
    async refreshTags() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            console.log('Refreshing tags from enhanced multi-PLC database...');
            
            let query = `
                SELECT 
                    TagID,
                    PLCName,
                    TagName,
                    TagAddress,
                    TagType,
                    Description,
                    Enabled,
                    GroupName,
                    
                    -- Engineering Units Configuration
                    RawMin,
                    RawMax,
                    EuMin,
                    EuMax,
                    EngineeringUnits,
                    DecimalPlaces,
                    FormatString,
                    
                    -- Legacy support
                    ScalingFactor,
                    Units,
                    
                    -- Operating limits
                    MinValue,
                    MaxValue,
                    
                    -- Alarm configuration  
                    AlarmHigh,
                    AlarmLow,
                    AlarmHighHigh,
                    AlarmLowLow,
                    AlarmDeadband,
                    AlarmEnabled,
                    AlarmPriority,
                    
                    -- Data logging configuration
                    LoggingEnabled,
                    LogOnChange,
                    ChangeThreshold,
                    MaxLogRate,
                    TrendingEnabled,
                    RetentionDays,
                    
                    -- Advanced features
                    ScalingType,
                    ScalingCoefficients,
                    ValidationRules,
                    
                    -- Audit fields
                    CreatedDate,
                    CreatedBy,
                    ModifiedDate,
                    ModifiedBy,
                    Version
                FROM ${this.config.tagTable}
                WHERE Enabled = 1
            `;

            // If this tag manager is bound to a specific PLC, filter by PLC name
            const request = this.connectionPool.request();
            if (this.config.plcName) {
                query += ' AND PLCName = @plcName';
                request.input('plcName', sql.NVarChar, this.config.plcName);
            }

            query += ' ORDER BY PLCName, GroupName, TagName';

            const result = await request.query(query);

            const oldSize = this.tagCache.size;
            this.tagCache.clear();

            // Process and cache tags with enhanced metadata
            const tagGroups = new Map();
            const plcTagCounts = new Map();
            
            result.recordset.forEach(row => {
                const tag = {
                    // Basic tag information
                    id: row.TagID,
                    plcName: row.PLCName,
                    name: row.TagName,
                    addr: row.TagAddress,
                    type: row.TagType,
                    description: row.Description,
                    enabled: row.Enabled,
                    group: row.GroupName,
                    
                    // Engineering Units Configuration
                    rawMin: row.RawMin || 0,
                    rawMax: row.RawMax || 32767,
                    euMin: row.EuMin || 0,
                    euMax: row.EuMax || 100,
                    engineeringUnits: row.EngineeringUnits || row.Units || '',
                    decimalPlaces: row.DecimalPlaces || 2,
                    formatString: row.FormatString,
                    
                    // Legacy support
                    scaling: row.ScalingFactor || 1,
                    units: row.EngineeringUnits || row.Units || '',
                    
                    // Scaling configuration
                    scalingConfig: {
                        rawMin: row.RawMin || 0,
                        rawMax: row.RawMax || 32767,
                        euMin: row.EuMin || 0,
                        euMax: row.EuMax || 100,
                        type: row.ScalingType || 'LINEAR',
                        coefficients: row.ScalingCoefficients ? JSON.parse(row.ScalingCoefficients) : null
                    },
                    
                    // Operating limits
                    limits: {
                        min: row.MinValue,
                        max: row.MaxValue,
                        alarmHigh: row.AlarmHigh,
                        alarmLow: row.AlarmLow,
                        alarmHighHigh: row.AlarmHighHigh,
                        alarmLowLow: row.AlarmLowLow,
                        alarmDeadband: row.AlarmDeadband || 1.0
                    },
                    
                    // Alarm configuration
                    alarmConfig: {
                        enabled: row.AlarmEnabled || false,
                        priority: row.AlarmPriority || 5,
                        deadband: row.AlarmDeadband || 1.0,
                        limits: {
                            high: row.AlarmHigh,
                            low: row.AlarmLow,
                            highHigh: row.AlarmHighHigh,
                            lowLow: row.AlarmLowLow
                        }
                    },
                    
                    // Data logging configuration
                    loggingConfig: {
                        enabled: row.LoggingEnabled !== false,
                        logOnChange: row.LogOnChange !== false,
                        changeThreshold: row.ChangeThreshold || 0.01,
                        maxLogRate: row.MaxLogRate || 60,
                        trendingEnabled: row.TrendingEnabled !== false,
                        retentionDays: row.RetentionDays || 90
                    },
                    
                    // Validation rules
                    validationRules: row.ValidationRules ? JSON.parse(row.ValidationRules) : null,
                    
                    // Audit information
                    audit: {
                        created: {
                            date: row.CreatedDate,
                            by: row.CreatedBy
                        },
                        modified: {
                            date: row.ModifiedDate,
                            by: row.ModifiedBy
                        },
                        version: row.Version || 1
                    }
                };

                // Create composite key for multi-PLC support
                const tagKey = this.config.plcName ? tag.name : `${tag.plcName}.${tag.name}`;
                this.tagCache.set(tagKey, tag);

                // Group tags by group name and PLC
                const groupKey = `${tag.plcName}.${tag.group}`;
                if (!tagGroups.has(groupKey)) {
                    tagGroups.set(groupKey, []);
                }
                tagGroups.get(groupKey).push(tag);

                // Count tags per PLC
                if (!plcTagCounts.has(tag.plcName)) {
                    plcTagCounts.set(tag.plcName, 0);
                }
                plcTagCounts.set(tag.plcName, plcTagCounts.get(tag.plcName) + 1);
            });

            this.lastRefresh = new Date();
            
            console.log(`Refreshed ${this.tagCache.size} enhanced tags from database`);
            
            if (this.config.plcName) {
                console.log(`  - Tags for PLC ${this.config.plcName}: ${this.tagCache.size}`);
            } else {
                console.log(`  - Tags per PLC:`, Object.fromEntries(plcTagCounts));
            }
            
            if (oldSize !== this.tagCache.size) {
                console.log(`Tag count changed: ${oldSize} -> ${this.tagCache.size}`);
            }

            this.emit('tags_refreshed', {
                tagCount: this.tagCache.size,
                groupCount: tagGroups.size,
                plcCount: plcTagCounts.size,
                timestamp: this.lastRefresh
            });

            return {
                tags: Array.from(this.tagCache.values()),
                groups: Object.fromEntries(tagGroups),
                plcTagCounts: Object.fromEntries(plcTagCounts),
                count: this.tagCache.size,
                refreshTime: this.lastRefresh
            };

        } catch (error) {
            console.error('Error refreshing tags:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get all tags in S7Client format (for specific PLC if configured)
     */
    getTagsForS7Client() {
        const tags = [];
        
        for (const tag of this.tagCache.values()) {
            if (tag.enabled) {
                // Only include tags for the configured PLC, or all if no PLC specified
                if (!this.config.plcName || tag.plcName === this.config.plcName) {
                    tags.push({
                        name: tag.name,
                        addr: tag.addr
                    });
                }
            }
        }
        
        return tags;
    }

    /**
     * Get tags by group (optionally filtered by PLC)
     */
    getTagsByGroup(groupName) {
        const tags = [];
        
        for (const tag of this.tagCache.values()) {
            if (tag.group === groupName && tag.enabled) {
                // Only include tags for the configured PLC, or all if no PLC specified
                if (!this.config.plcName || tag.plcName === this.config.plcName) {
                    tags.push(tag);
                }
            }
        }
        
        return tags;
    }

    /**
     * Get tag by name with full enhanced metadata
     */
    getTag(tagName) {
        // Try direct lookup first
        const directTag = this.tagCache.get(tagName);
        if (directTag) {
            return directTag;
        }

        // If we have a PLC context, try with PLC prefix
        if (this.config.plcName) {
            return this.tagCache.get(`${this.config.plcName}.${tagName}`);
        }

        // For multi-PLC mode, search through all tags
        for (const tag of this.tagCache.values()) {
            if (tag.name === tagName) {
                return tag;
            }
        }

        return null;
    }

    /**
     * Get all tags with enhanced metadata (optionally filtered by PLC)
     */
    getAllTags() {
        const tags = Array.from(this.tagCache.values());
        
        if (this.config.plcName) {
            return tags.filter(tag => tag.plcName === this.config.plcName);
        }
        
        return tags;
    }

    /**
     * Get tag groups (optionally filtered by PLC)
     */
    getGroups() {
        const groups = new Set();
        
        for (const tag of this.tagCache.values()) {
            if (!this.config.plcName || tag.plcName === this.config.plcName) {
                if (tag.group) {
                    groups.add(tag.group);
                }
            }
        }
        
        return Array.from(groups).sort();
    }

    /**
     * Get all PLCs
     */
    getAllPLCs() {
        return Array.from(this.plcCache.values());
    }

    /**
     * Get PLC configuration by name
     */
    getPLC(plcName) {
        return this.plcCache.get(plcName);
    }

    /**
     * Add or update a tag in database with enhanced multi-PLC support
     */
    async saveTag(tagData) {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            // Ensure we have a PLC name
            const plcName = tagData.plcName || this.config.plcName;
            if (!plcName) {
                throw new Error('PLC name is required for tag creation');
            }

            // Verify PLC exists
            if (!this.plcCache.has(plcName)) {
                throw new Error(`PLC ${plcName} not found in configuration`);
            }

            // Use enhanced stored procedure for tag creation
            const request = this.connectionPool.request();
            
            // Input parameters for the enhanced stored procedure
            request.input('PLCName', sql.NVarChar, plcName);
            request.input('TagName', sql.NVarChar, tagData.name);
            request.input('TagAddress', sql.NVarChar, tagData.addr);
            request.input('TagType', sql.NVarChar, tagData.type || 'REAL');
            request.input('Description', sql.NVarChar, tagData.description || '');
            request.input('GroupName', sql.NVarChar, tagData.group || 'Default');
            
            // Engineering Units
            request.input('RawMin', sql.Float, tagData.rawMin || tagData.scalingConfig?.rawMin || 0);
            request.input('RawMax', sql.Float, tagData.rawMax || tagData.scalingConfig?.rawMax || 32767);
            request.input('EuMin', sql.Float, tagData.euMin || tagData.scalingConfig?.euMin || 0);
            request.input('EuMax', sql.Float, tagData.euMax || tagData.scalingConfig?.euMax || 100);
            request.input('EngineeringUnits', sql.NVarChar, tagData.engineeringUnits || tagData.units || '');
            request.input('DecimalPlaces', sql.Int, tagData.decimalPlaces || 2);
            
            // Operating limits
            request.input('MinValue', sql.Float, tagData.limits?.min || null);
            request.input('MaxValue', sql.Float, tagData.limits?.max || null);
            request.input('AlarmHigh', sql.Float, tagData.limits?.alarmHigh || tagData.alarmConfig?.limits?.high || null);
            request.input('AlarmLow', sql.Float, tagData.limits?.alarmLow || tagData.alarmConfig?.limits?.low || null);
            request.input('AlarmEnabled', sql.Bit, tagData.alarmConfig?.enabled !== false);
            request.input('LoggingEnabled', sql.Bit, tagData.loggingConfig?.enabled !== false);
            request.input('CreatedBy', sql.NVarChar, tagData.createdBy || 'API_USER');

            const result = await request.execute('sp_AddEnhancedTagWithPLC');
            
            // Refresh cache
            await this.refreshTags();
            
            this.emit('tag_saved', { ...tagData, plcName });
            return result.recordset[0];

        } catch (error) {
            console.error('Error saving enhanced tag:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Delete a tag from database
     */
    async deleteTag(tagName, plcName = null) {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            // Use provided PLC name or configured PLC name
            const targetPLC = plcName || this.config.plcName;
            
            let query = `DELETE FROM ${this.config.tagTable} WHERE TagName = @tagName`;
            const request = this.connectionPool.request().input('tagName', sql.NVarChar, tagName);
            
            // Add PLC filter if specified
            if (targetPLC) {
                query += ' AND PLCName = @plcName';
                request.input('plcName', sql.NVarChar, targetPLC);
            }

            const result = await request.query(query);

            if (result.rowsAffected[0] > 0) {
                // Log the deletion
                await this.connectionPool.request()
                    .input('plcName', sql.NVarChar, targetPLC)
                    .input('eventType', sql.NVarChar, 'TAG_DELETED')
                    .input('eventCategory', sql.NVarChar, 'INFO')
                    .input('eventMessage', sql.NVarChar, `Tag ${tagName} deleted from PLC ${targetPLC || 'ALL'} via API`)
                    .input('tagName', sql.NVarChar, tagName)
                    .input('username', sql.NVarChar, 'API_USER')
                    .input('source', sql.NVarChar, 'SqlTagManager')
                    .query(`
                        INSERT INTO EventHistory (PLCName, EventType, EventCategory, EventMessage, TagName, Username, Source)
                        VALUES (@plcName, @eventType, @eventCategory, @eventMessage, @tagName, @username, @source)
                    `);
                    
                await this.refreshTags();
                this.emit('tag_deleted', { tagName, plcName: targetPLC });
                return true;
            }

            return false;

        } catch (error) {
            console.error('Error deleting tag:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Set PLC context for this tag manager
     */
    setPLCContext(plcName) {
        this.config.plcName = plcName;
        console.log(`SqlTagManager PLC context set to: ${plcName}`);
    }

    /**
     * Clear PLC context (for multi-PLC mode)
     */
    clearPLCContext() {
        this.config.plcName = null;
        console.log('SqlTagManager PLC context cleared - multi-PLC mode');
    }

    /**
     * Start auto-refresh timer
     */
    startAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }

        if (this.config.cacheRefreshInterval > 0) {
            this.refreshTimer = setInterval(() => {
                this.refreshTags().catch(error => {
                    console.error('Auto-refresh error:', error);
                    this.emit('error', error);
                });
            }, this.config.cacheRefreshInterval);
        }
    }

    /**
     * Stop auto-refresh timer
     */
    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Get connection status with enhanced information
     */
    getStatus() {
        return {
            connected: this.isConnected,
            tagCount: this.tagCache.size,
            plcCount: this.plcCache.size,
            plcContext: this.config.plcName,
            lastRefresh: this.lastRefresh,
            autoRefresh: !!this.refreshTimer,
            refreshInterval: this.config.cacheRefreshInterval,
            database: this.config.database,
            features: {
                multiPLCSupport: true,
                engineeringUnits: true,
                enhancedAlarms: true,
                dataLogging: true,
                advancedScaling: true,
                plcManagement: true
            }
        };
    }

    /**
     * Test database connection with enhanced features
     */
    async testConnection() {
        try {
            if (!this.isConnected) {
                await this.connect();
            }

            // Test with enhanced multi-PLC query
            const result = await this.connectionPool.request()
                .query(`
                    SELECT 
                        COUNT(*) as TagCount,
                        COUNT(CASE WHEN Enabled = 1 THEN 1 END) as EnabledTags,
                        COUNT(CASE WHEN LoggingEnabled = 1 THEN 1 END) as LoggingEnabledTags,
                        COUNT(CASE WHEN AlarmEnabled = 1 THEN 1 END) as AlarmEnabledTags,
                        COUNT(DISTINCT GroupName) as GroupCount,
                        COUNT(DISTINCT PLCName) as PLCCount
                    FROM ${this.config.tagTable}
                `);

            const plcResult = await this.connectionPool.request()
                .query(`
                    SELECT 
                        COUNT(*) as TotalPLCs,
                        COUNT(CASE WHEN Enabled = 1 THEN 1 END) as EnabledPLCs,
                        COUNT(CASE WHEN AutoConnect = 1 THEN 1 END) as AutoConnectPLCs
                    FROM PLCConnections
                `);

            return {
                success: true,
                tags: result.recordset[0],
                plcs: plcResult.recordset[0],
                databaseVersion: '2.1.0',
                schemaType: 'Multi-PLC Enhanced',
                features: ['MultiPLC', 'EngineeringUnits', 'EnhancedAlarms', 'DataLogging', 'AdvancedScaling'],
                timestamp: new Date()
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                timestamp: new Date()
            };
        }
    }

    /**
     * Get enhanced statistics
     */
    async getEnhancedStatistics() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            // Execute the enhanced statistics stored procedure
            const result = await this.connectionPool.request().execute('sp_GetSystemStatistics');
            
            return {
                systemOverview: result.recordsets[0] ? result.recordsets[0][0] : {},
                dataLogging: result.recordsets[1] ? result.recordsets[1][0] : {},
                alarms: result.recordsets[2] ? result.recordsets[2][0] : {},
                topActiveTags: result.recordsets[3] || [],
                topAlarmedTags: result.recordsets[4] || [],
                recentEvents: result.recordsets[5] || [],
                databaseSize: result.recordsets[6] || [],
                tagManager: {
                    cacheStatus: this.getStatus(),
                    plcContext: this.config.plcName,
                    multiPLCMode: !this.config.plcName
                }
            };
        } catch (error) {
            console.error('Error getting enhanced statistics:', error);
            throw error;
        }
    }

    /**
     * Get tags for specific PLC with enhanced metadata
     */
    async getTagsForPLC(plcName) {
        try {
            const result = await this.connectionPool.request()
                .input('PLCName', sql.NVarChar, plcName)
                .input('EnabledOnly', sql.Bit, 1)
                .execute('sp_GetTagsForPLC');

            return result.recordset.map(row => ({
                id: row.TagID,
                plcName: row.PLCName,
                name: row.TagName,
                addr: row.TagAddress,
                type: row.TagType,
                description: row.Description,
                group: row.GroupName,
                enabled: row.Enabled,
                
                // Engineering Units
                rawMin: row.RawMin,
                rawMax: row.RawMax,
                euMin: row.EuMin,
                euMax: row.EuMax,
                engineeringUnits: row.EngineeringUnits,
                decimalPlaces: row.DecimalPlaces,
                formatString: row.FormatString,
                
                // Scaling
                scalingConfig: {
                    rawMin: row.RawMin,
                    rawMax: row.RawMax,
                    euMin: row.EuMin,
                    euMax: row.EuMax,
                    type: row.ScalingType,
                    coefficients: row.ScalingCoefficients ? JSON.parse(row.ScalingCoefficients) : null
                },
                
                // Limits and alarms
                limits: {
                    min: row.MinValue,
                    max: row.MaxValue,
                    alarmHigh: row.AlarmHigh,
                    alarmLow: row.AlarmLow,
                    alarmHighHigh: row.AlarmHighHigh,
                    alarmLowLow: row.AlarmLowLow
                },
                
                // Logging configuration
                loggingConfig: {
                    enabled: row.LoggingEnabled,
                    logOnChange: row.LogOnChange,
                    changeThreshold: row.ChangeThreshold,
                    maxLogRate: row.MaxLogRate,
                    trendingEnabled: row.TrendingEnabled,
                    retentionDays: row.RetentionDays
                },
                
                // PLC information
                plcInfo: {
                    description: row.PLCDescription,
                    address: row.IPAddress,
                    location: row.Location,
                    department: row.Department
                },
                
                // Metadata
                createdDate: row.CreatedDate,
                modifiedDate: row.ModifiedDate,
                version: row.Version
            }));
            
        } catch (error) {
            console.error(`Error getting tags for PLC ${plcName}:`, error);
            throw error;
        }
    }

    /**
     * Get tag summary by PLC
     */
    async getTagSummaryByPLC() {
        try {
            const result = await this.connectionPool.request()
                .query(`
                    SELECT 
                        t.PLCName,
                        plc.PLCDescription,
                        plc.Location,
                        plc.Department,
                        plc.SystemType,
                        plc.Enabled as PLCEnabled,
                        COUNT(*) as TotalTags,
                        COUNT(CASE WHEN t.Enabled = 1 THEN 1 END) as EnabledTags,
                        COUNT(CASE WHEN t.LoggingEnabled = 1 THEN 1 END) as LoggingEnabledTags,
                        COUNT(CASE WHEN t.AlarmEnabled = 1 THEN 1 END) as AlarmEnabledTags,
                        COUNT(DISTINCT t.GroupName) as GroupCount,
                        MIN(t.CreatedDate) as FirstTagCreated,
                        MAX(t.ModifiedDate) as LastTagModified
                    FROM ${this.config.tagTable} t
                    LEFT JOIN PLCConnections plc ON t.PLCName = plc.PLCName
                    GROUP BY t.PLCName, plc.PLCDescription, plc.Location, plc.Department, plc.SystemType, plc.Enabled
                    ORDER BY t.PLCName
                `);

            return result.recordset;
            
        } catch (error) {
            console.error('Error getting tag summary by PLC:', error);
            throw error;
        }
    }

    /**
     * Create enhanced database tables (for setup)
     */
    async createEnhancedTables() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            console.log('Creating enhanced multi-PLC database tables...');
            
            // Read and execute the enhanced database setup script
            const fs = require('fs').promises;
            const path = require('path');
            
            const sqlScript = await fs.readFile(path.join(__dirname, 'Database', 'enhanced_multi_plc_schema.sql'), 'utf8');
            
            // Execute the script in batches (split by GO statements)
            const batches = sqlScript.split(/\r?\nGO\r?\n/);
            
            for (const batch of batches) {
                if (batch.trim()) {
                    await this.connectionPool.request().query(batch);
                }
            }
            
            console.log('Enhanced multi-PLC database tables created successfully');
            
            // Refresh configurations and tags
            await this.refreshPLCConfigurations();
            await this.refreshTags();
            
            return true;

        } catch (error) {
            console.error('Error creating enhanced tables:', error);
            throw error;
        }
    }

    /**
     * Validate tag configuration for multi-PLC environment
     */
    validateTagConfig(tagData) {
        const errors = [];
        const warnings = [];

        // Required fields
        if (!tagData.name) errors.push('Tag name is required');
        if (!tagData.addr) errors.push('Tag address is required');
        
        // PLC validation
        const plcName = tagData.plcName || this.config.plcName;
        if (!plcName) {
            errors.push('PLC name is required for tag creation');
        } else if (!this.plcCache.has(plcName)) {
            errors.push(`PLC ${plcName} not found in configuration`);
        }

        // Engineering units validation
        if (tagData.rawMin >= tagData.rawMax) {
            errors.push('Raw maximum must be greater than raw minimum');
        }
        if (tagData.euMin >= tagData.euMax) {
            errors.push('EU maximum must be greater than EU minimum');
        }

        // Alarm validation
        if (tagData.alarmConfig?.enabled) {
            const limits = tagData.alarmConfig.limits;
            if (limits.high && limits.low && limits.high <= limits.low) {
                warnings.push('High alarm limit should be greater than low alarm limit');
            }
            if (limits.highHigh && limits.high && limits.highHigh <= limits.high) {
                warnings.push('High-high alarm limit should be greater than high alarm limit');
            }
            if (limits.lowLow && limits.low && limits.lowLow >= limits.low) {
                warnings.push('Low-low alarm limit should be less than low alarm limit');
            }
        }

        // Address format validation
        const addressPattern = /^(DB\d+,|M|I|Q)/i;
        if (!addressPattern.test(tagData.addr)) {
            warnings.push('Tag address format may not be valid for S7 PLCs');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Bulk import tags from CSV or JSON
     */
    async bulkImportTags(tagData, format = 'json') {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            let tags = [];
            
            if (format === 'csv') {
                // Parse CSV format (implementation would depend on CSV structure)
                throw new Error('CSV import not implemented yet');
            } else {
                // JSON format
                tags = Array.isArray(tagData) ? tagData : [tagData];
            }

            const results = {
                success: [],
                errors: [],
                warnings: []
            };

            for (let i = 0; i < tags.length; i++) {
                const tag = tags[i];
                
                try {
                    // Validate tag configuration
                    const validation = this.validateTagConfig(tag);
                    
                    if (!validation.valid) {
                        results.errors.push({
                            index: i,
                            tag: tag.name || `Tag ${i}`,
                            errors: validation.errors
                        });
                        continue;
                    }

                    if (validation.warnings.length > 0) {
                        results.warnings.push({
                            index: i,
                            tag: tag.name,
                            warnings: validation.warnings
                        });
                    }

                    // Save the tag
                    const result = await this.saveTag(tag);
                    results.success.push({
                        index: i,
                        tag: tag.name,
                        result: result
                    });

                } catch (error) {
                    results.errors.push({
                        index: i,
                        tag: tag.name || `Tag ${i}`,
                        errors: [error.message]
                    });
                }
            }

            // Refresh tags after bulk import
            if (results.success.length > 0) {
                await this.refreshTags();
            }

            console.log(`Bulk import completed: ${results.success.length} success, ${results.errors.length} errors`);
            
            return results;

        } catch (error) {
            console.error('Error during bulk import:', error);
            throw error;
        }
    }

    /**
     * Export tags to JSON format
     */
    async exportTags(plcName = null, includeDisabled = false) {
        try {
            let tags = this.getAllTags();
            
            // Filter by PLC if specified
            if (plcName) {
                tags = tags.filter(tag => tag.plcName === plcName);
            }
            
            // Filter out disabled tags if requested
            if (!includeDisabled) {
                tags = tags.filter(tag => tag.enabled);
            }

            // Create export object with metadata
            const exportData = {
                exportInfo: {
                    exportDate: new Date().toISOString(),
                    exportedBy: 'SqlTagManager',
                    version: '2.1.0',
                    schemaType: 'Multi-PLC Enhanced',
                    plcFilter: plcName,
                    includeDisabled: includeDisabled,
                    tagCount: tags.length
                },
                tags: tags.map(tag => ({
                    // Remove internal IDs and audit fields for clean export
                    plcName: tag.plcName,
                    name: tag.name,
                    addr: tag.addr,
                    type: tag.type,
                    description: tag.description,
                    group: tag.group,
                    enabled: tag.enabled,
                    
                    // Engineering units
                    rawMin: tag.rawMin,
                    rawMax: tag.rawMax,
                    euMin: tag.euMin,
                    euMax: tag.euMax,
                    engineeringUnits: tag.engineeringUnits,
                    decimalPlaces: tag.decimalPlaces,
                    formatString: tag.formatString,
                    
                    // Scaling
                    scalingConfig: tag.scalingConfig,
                    
                    // Limits and alarms
                    limits: tag.limits,
                    alarmConfig: tag.alarmConfig,
                    
                    // Logging
                    loggingConfig: tag.loggingConfig,
                    
                    // Validation
                    validationRules: tag.validationRules
                }))
            };

            return exportData;

        } catch (error) {
            console.error('Error exporting tags:', error);
            throw error;
        }
    }

    /**
     * Get performance metrics for tag operations
     */
    getPerformanceMetrics() {
        return {
            cacheSize: this.tagCache.size,
            plcCacheSize: this.plcCache.size,
            lastRefreshTime: this.lastRefresh,
            refreshInterval: this.config.cacheRefreshInterval,
            autoRefreshEnabled: !!this.refreshTimer,
            connectionPoolStats: this.connectionPool ? {
                totalConnections: this.connectionPool.pool.totalCount,
                idleConnections: this.connectionPool.pool.idleCount,
                activeConnections: this.connectionPool.pool.activeCount
            } : null,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        };
    }
}

module.exports = SqlTagManager;