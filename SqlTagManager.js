const { EventEmitter } = require('events');
const sql = require('mssql');

/**
 * SQL Tag Manager - Manages PLC tags from SQL Server Express database
 * Provides functionality to read, cache, and monitor tag configurations
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
            // Table configuration
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
     * Refresh tags from database
     */
    async refreshTags() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            console.log('Refreshing tags from database...');
            
            const result = await this.connectionPool.request().query(`
                SELECT 
                    TagID,
                    TagName,
                    TagAddress,
                    TagType,
                    Description,
                    Enabled,
                    GroupName,
                    ScalingFactor,
                    Units,
                    MinValue,
                    MaxValue,
                    AlarmHigh,
                    AlarmLow,
                    CreatedDate,
                    ModifiedDate
                FROM ${this.config.tagTable}
                WHERE Enabled = 1
                ORDER BY GroupName, TagName
            `);

            const oldSize = this.tagCache.size;
            this.tagCache.clear();

            // Process and cache tags
            const tagGroups = new Map();
            
            result.recordset.forEach(row => {
                const tag = {
                    id: row.TagID,
                    name: row.TagName,
                    addr: row.TagAddress,
                    type: row.TagType,
                    description: row.Description,
                    enabled: row.Enabled,
                    group: row.GroupName,
                    scaling: row.ScalingFactor || 1,
                    units: row.Units,
                    limits: {
                        min: row.MinValue,
                        max: row.MaxValue,
                        alarmHigh: row.AlarmHigh,
                        alarmLow: row.AlarmLow
                    },
                    timestamps: {
                        created: row.CreatedDate,
                        modified: row.ModifiedDate
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
            
            console.log(`Refreshed ${this.tagCache.size} tags from database`);
            
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
     * Get tag by name
     */
    getTag(tagName) {
        return this.tagCache.get(tagName);
    }

    /**
     * Get all tags
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
     * Add or update a tag in database
     */
    async saveTag(tagData) {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            const request = this.connectionPool.request();
            
            // Check if tag exists
            const existingTag = await request
                .input('tagName', sql.NVarChar, tagData.name)
                .query(`SELECT TagID FROM ${this.config.tagTable} WHERE TagName = @tagName`);

            if (existingTag.recordset.length > 0) {
                // Update existing tag
                await request
                    .input('tagID', sql.Int, existingTag.recordset[0].TagID)
                    .input('tagAddress', sql.NVarChar, tagData.addr)
                    .input('tagType', sql.NVarChar, tagData.type || 'REAL')
                    .input('description', sql.NVarChar, tagData.description || '')
                    .input('enabled', sql.Bit, tagData.enabled !== false)
                    .input('groupName', sql.NVarChar, tagData.group || 'Default')
                    .input('scalingFactor', sql.Float, tagData.scaling || 1)
                    .input('units', sql.NVarChar, tagData.units || '')
                    .input('minValue', sql.Float, tagData.limits?.min)
                    .input('maxValue', sql.Float, tagData.limits?.max)
                    .input('alarmHigh', sql.Float, tagData.limits?.alarmHigh)
                    .input('alarmLow', sql.Float, tagData.limits?.alarmLow)
                    .query(`
                        UPDATE ${this.config.tagTable}
                        SET TagAddress = @tagAddress,
                            TagType = @tagType,
                            Description = @description,
                            Enabled = @enabled,
                            GroupName = @groupName,
                            ScalingFactor = @scalingFactor,
                            Units = @units,
                            MinValue = @minValue,
                            MaxValue = @maxValue,
                            AlarmHigh = @alarmHigh,
                            AlarmLow = @alarmLow,
                            ModifiedDate = GETDATE()
                        WHERE TagID = @tagID
                    `);
            } else {
                // Insert new tag
                await request.query(`
                    INSERT INTO ${this.config.tagTable} (
                        TagName, TagAddress, TagType, Description, Enabled,
                        GroupName, ScalingFactor, Units, MinValue, MaxValue,
                        AlarmHigh, AlarmLow, CreatedDate, ModifiedDate
                    ) VALUES (
                        @tagName, @tagAddress, @tagType, @description, @enabled,
                        @groupName, @scalingFactor, @units, @minValue, @maxValue,
                        @alarmHigh, @alarmLow, GETDATE(), GETDATE()
                    )
                `);
            }

            // Refresh cache
            await this.refreshTags();
            
            this.emit('tag_saved', tagData);
            return true;

        } catch (error) {
            console.error('Error saving tag:', error);
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
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            tagCount: this.tagCache.size,
            lastRefresh: this.lastRefresh,
            autoRefresh: !!this.refreshTimer,
            refreshInterval: this.config.cacheRefreshInterval
        };
    }

    /**
     * Test database connection
     */
    async testConnection() {
        try {
            if (!this.isConnected) {
                await this.connect();
            }

            // Test with a simple query
            const result = await this.connectionPool.request()
                .query(`SELECT COUNT(*) as TagCount FROM ${this.config.tagTable}`);

            return {
                success: true,
                tagCount: result.recordset[0].TagCount,
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
     * Create database table if it doesn't exist
     */
    async createTagTable() {
        if (!this.isConnected || !this.connectionPool) {
            throw new Error('Not connected to SQL Server');
        }

        try {
            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${this.config.tagTable}' AND xtype='U')
                CREATE TABLE ${this.config.tagTable} (
                    TagID int IDENTITY(1,1) PRIMARY KEY,
                    TagName nvarchar(100) NOT NULL UNIQUE,
                    TagAddress nvarchar(50) NOT NULL,
                    TagType nvarchar(20) DEFAULT 'REAL',
                    Description nvarchar(255),
                    Enabled bit DEFAULT 1,
                    GroupName nvarchar(50) DEFAULT 'Default',
                    ScalingFactor float DEFAULT 1.0,
                    Units nvarchar(20),
                    MinValue float,
                    MaxValue float,
                    AlarmHigh float,
                    AlarmLow float,
                    CreatedDate datetime2 DEFAULT GETDATE(),
                    ModifiedDate datetime2 DEFAULT GETDATE()
                )
            `);

            // Create indexes for better performance
            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_TagName')
                CREATE INDEX IX_Tags_TagName ON ${this.config.tagTable}(TagName)
            `);

            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_GroupName')
                CREATE INDEX IX_Tags_GroupName ON ${this.config.tagTable}(GroupName)
            `);

            console.log(`Table ${this.config.tagTable} created successfully`);
            return true;

        } catch (error) {
            console.error('Error creating table:', error);
            throw error;
        }
    }
}

module.exports = SqlTagManager;
