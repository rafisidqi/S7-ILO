const { EventEmitter } = require('events');
const sql = require('mssql');

/**
 * Enhanced SQL Tag Manager - Works with the new enhanced database schema
 * Supports engineering units, enhanced configuration, and modern features
 */
class SqlTagManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // SQL Server connection settings
            server: 'localhost\\SQLEXPRESS',
            database: 'PLCTags',
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true,
                instanceName: 'SQLEXPRESS'
            },
            // Table configuration - updated for new schema
            tagTable: 'Tags',
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
            console.log('Connecting to SQL Server...');
            
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
            
            console.log('Connected to SQL Server successfully');
            this.emit('connected');

            // Initial tag refresh
            await this.refreshTags();

            // Start auto-refresh if enabled
            if (this.config.enableAutoRefresh) {
                this.startAutoRefresh();
            }

            return true;

        } catch (error) {
            console.error('SQL Server connection failed:', error);
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
            console.log('Disconnecting from SQL Server...');
            
            // Stop auto-refresh
            this.stopAutoRefresh();

            if (this.connectionPool) {
                await this.connectionPool.close();
                this.connectionPool = null;
            }

            this.isConnected = false;
            this.tagCache.clear();
            
            console.log('Disconnected from SQL Server');
            this.emit('disconnected');

        } catch (error) {
            console.error('Error disconnecting from SQL Server:', error);
            this.emit('error', error);
        }
    }

    /**
     * Refresh tags from database with enhanced schema support
     */
    async refreshTags() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            console.log('Refreshing tags from enhanced database...');
            
            const result = await this.connectionPool.request().query(`
                SELECT 
                    TagID,
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
                ORDER BY GroupName, TagName
            `);

            const oldSize = this.tagCache.size;
            this.tagCache.clear();

            // Process and cache tags with enhanced metadata
            const tagGroups = new Map();
            
            result.recordset.forEach(row => {
                const tag = {
                    // Basic tag information
                    id: row.TagID,
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

                this.tagCache.set(tag.name, tag);

                // Group tags by group name
                if (!tagGroups.has(tag.group)) {
                    tagGroups.set(tag.group, []);
                }
                tagGroups.get(tag.group).push(tag);
            });

            this.lastRefresh = new Date();
            
            console.log(`Refreshed ${this.tagCache.size} enhanced tags from database`);
            
            if (oldSize !== this.tagCache.size) {
                console.log(`Tag count changed: ${oldSize} -> ${this.tagCache.size}`);
            }

            this.emit('tags_refreshed', {
                tagCount: this.tagCache.size,
                groupCount: tagGroups.size,
                timestamp: this.lastRefresh
            });

            return {
                tags: Array.from(this.tagCache.values()),
                groups: Object.fromEntries(tagGroups),
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
     * Get all tags in S7Client format
     */
    getTagsForS7Client() {
        const tags = [];
        
        for (const tag of this.tagCache.values()) {
            if (tag.enabled) {
                tags.push({
                    name: tag.name,
                    addr: tag.addr
                });
            }
        }
        
        return tags;
    }

    /**
     * Get tags by group
     */
    getTagsByGroup(groupName) {
        const tags = [];
        
        for (const tag of this.tagCache.values()) {
            if (tag.group === groupName && tag.enabled) {
                tags.push(tag);
            }
        }
        
        return tags;
    }

    /**
     * Get tag by name with full enhanced metadata
     */
    getTag(tagName) {
        return this.tagCache.get(tagName);
    }

    /**
     * Get all tags with enhanced metadata
     */
    getAllTags() {
        return Array.from(this.tagCache.values());
    }

    /**
     * Get tag groups
     */
    getGroups() {
        const groups = new Set();
        
        for (const tag of this.tagCache.values()) {
            if (tag.group) {
                groups.add(tag.group);
            }
        }
        
        return Array.from(groups).sort();
    }

    /**
     * Add or update a tag in database with enhanced support
     */
    async saveTag(tagData) {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            // Use stored procedure for enhanced tag creation
            const request = this.connectionPool.request();
            
            // Input parameters for the enhanced stored procedure
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

            const result = await request.execute('sp_AddEnhancedTag');
            
            // Refresh cache
            await this.refreshTags();
            
            this.emit('tag_saved', tagData);
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
    async deleteTag(tagName) {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            const result = await this.connectionPool.request()
                .input('tagName', sql.NVarChar, tagName)
                .query(`DELETE FROM ${this.config.tagTable} WHERE TagName = @tagName`);

            if (result.rowsAffected[0] > 0) {
                // Log the deletion
                await this.connectionPool.request()
                    .input('eventType', sql.NVarChar, 'TAG_DELETED')
                    .input('eventCategory', sql.NVarChar, 'INFO')
                    .input('eventMessage', sql.NVarChar, `Tag ${tagName} deleted via API`)
                    .input('tagName', sql.NVarChar, tagName)
                    .input('username', sql.NVarChar, 'API_USER')
                    .input('source', sql.NVarChar, 'SqlTagManager')
                    .query(`
                        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, TagName, Username, Source)
                        VALUES (@eventType, @eventCategory, @eventMessage, @tagName, @username, @source)
                    `);
                    
                await this.refreshTags();
                this.emit('tag_deleted', tagName);
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
            lastRefresh: this.lastRefresh,
            autoRefresh: !!this.refreshTimer,
            refreshInterval: this.config.cacheRefreshInterval,
            features: {
                engineeringUnits: true,
                enhancedAlarms: true,
                dataLogging: true,
                advancedScaling: true
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

            // Test with enhanced query
            const result = await this.connectionPool.request()
                .query(`
                    SELECT 
                        COUNT(*) as TagCount,
                        COUNT(CASE WHEN Enabled = 1 THEN 1 END) as EnabledTags,
                        COUNT(CASE WHEN LoggingEnabled = 1 THEN 1 END) as LoggingEnabledTags,
                        COUNT(CASE WHEN AlarmEnabled = 1 THEN 1 END) as AlarmEnabledTags,
                        COUNT(DISTINCT GroupName) as GroupCount
                    FROM ${this.config.tagTable}
                `);

            return {
                success: true,
                ...result.recordset[0],
                databaseVersion: '2.0.0',
                features: ['EngineeringUnits', 'EnhancedAlarms', 'DataLogging', 'AdvancedScaling'],
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
                systemOverview: result.recordsets[0][0],
                dataLogging: result.recordsets[1][0],
                alarms: result.recordsets[2][0],
                topActiveTags: result.recordsets[3],
                topAlarmedTags: result.recordsets[4],
                recentEvents: result.recordsets[5],
                databaseSize: result.recordsets[6]
            };
        } catch (error) {
            console.error('Error getting enhanced statistics:', error);
            throw error;
        }
    }

    /**
     * Create enhanced database table (for setup)
     */
    async createEnhancedTables() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            console.log('Creating enhanced database tables...');
            
            // Read and execute the enhanced database setup script
            const fs = require('fs').promises;
            const path = require('path');
            
            const sqlScript = await fs.readFile(path.join(__dirname, 'database', 'db.sql'), 'utf8');
            
            // Execute the script in batches (split by GO statements)
            const batches = sqlScript.split(/\r?\nGO\r?\n/);
            
            for (const batch of batches) {
                if (batch.trim()) {
                    await this.connectionPool.request().query(batch);
                }
            }
            
            console.log('Enhanced database tables created successfully');
            return true;

        } catch (error) {
            console.error('Error creating enhanced tables:', error);
            throw error;
        }
    }
}

module.exports = SqlTagManager;