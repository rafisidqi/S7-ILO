const S7Client = require('./S7Client');
const SqlTagManager = require('./SqlTagManager');

/**
 * Enhanced S7 Client with SQL Server tag management
 * Extends the base S7Client to support dynamic tag loading from SQL database
 */
class EnhancedS7Client extends S7Client {
    constructor(config) {
        // Extract SQL config from main config
        const { sqlConfig, ...s7Config } = config;
        
        // Initialize with empty variables initially
        super({
            ...s7Config,
            variables: []
        });

        this.sqlTagManager = new SqlTagManager(sqlConfig);
        this.tagGroups = new Map();
        this.tagMetadata = new Map();
        this.isTagsLoaded = false;

        // Set up SQL tag manager events
        this.setupSqlEvents();
    }

    /**
     * Set up SQL tag manager event handlers
     */
    setupSqlEvents() {
        this.sqlTagManager.on('connected', () => {
            console.log('SQL Tag Manager connected');
            this.emit('sql_connected');
        });

        this.sqlTagManager.on('disconnected', () => {
            console.log('SQL Tag Manager disconnected');
            this.emit('sql_disconnected');
        });

        this.sqlTagManager.on('tags_refreshed', async (info) => {
            console.log(`Tags refreshed: ${info.tagCount} tags loaded`);
            await this.updateS7Variables();
            this.emit('tags_updated', info);
        });

        this.sqlTagManager.on('error', (error) => {
            console.error('SQL Tag Manager error:', error);
            this.emit('sql_error', error);
        });

        this.sqlTagManager.on('tag_saved', (tagData) => {
            this.emit('tag_saved', tagData);
        });

        this.sqlTagManager.on('tag_deleted', (tagName) => {
            this.emit('tag_deleted', tagName);
        });
    }

    /**
     * Initialize both SQL connection and S7 connection
     */
    async initialize() {
        try {
            console.log('Initializing Enhanced S7 Client...');

            // Connect to SQL Server first
            await this.sqlTagManager.connect();
            
            // Update S7 variables from SQL
            await this.updateS7Variables();
            
            // Connect to PLC
            await this.connect();
            
            console.log('Enhanced S7 Client initialized successfully');
            this.emit('initialized');
            
            return true;

        } catch (error) {
            console.error('Failed to initialize Enhanced S7 Client:', error);
            throw error;
        }
    }

    /**
     * Update S7 client variables from SQL database
     */
    async updateS7Variables() {
        try {
            // Get tags from SQL in S7 format
            const sqlTags = this.sqlTagManager.getTagsForS7Client();
            const allTags = this.sqlTagManager.getAllTags();
            
            console.log(`Updating S7 variables with ${sqlTags.length} tags from SQL`);
            
            // Update internal variables
            this._vars = this.createTranslationTable(sqlTags);
            this.config.variables = sqlTags;
            
            // Store tag metadata and groups
            this.tagMetadata.clear();
            this.tagGroups.clear();
            
            allTags.forEach(tag => {
                this.tagMetadata.set(tag.name, tag);
                
                if (!this.tagGroups.has(tag.group)) {
                    this.tagGroups.set(tag.group, []);
                }
                this.tagGroups.get(tag.group).push(tag);
            });

            // Reinitialize item group if PLC is connected
            if (this.connected && this.itemGroup) {
                this.itemGroup.removeAllItems();
                
                const varKeys = Object.keys(this._vars);
                if (varKeys.length > 0) {
                    this.itemGroup.addItems(varKeys);
                }
            }

            this.isTagsLoaded = true;
            console.log(`S7 variables updated: ${sqlTags.length} tags active`);

        } catch (error) {
            console.error('Error updating S7 variables:', error);
            throw error;
        }
    }

    /**
     * Enhanced connect method that ensures tags are loaded
     */
    async connect() {
        if (!this.isTagsLoaded) {
            console.log('Tags not loaded, loading from SQL first...');
            await this.updateS7Variables();
        }

        return super.connect();
    }

    /**
     * Write variable with enhanced metadata
     */
    async writeVariable(name, value) {
        const tagMeta = this.tagMetadata.get(name);
        
        if (tagMeta) {
            // Apply scaling if configured
            if (tagMeta.scaling && tagMeta.scaling !== 1) {
                value = value * tagMeta.scaling;
            }

            // Check limits if configured
            if (tagMeta.limits) {
                if (tagMeta.limits.min !== null && value < tagMeta.limits.min) {
                    throw new Error(`Value ${value} below minimum ${tagMeta.limits.min} for tag ${name}`);
                }
                if (tagMeta.limits.max !== null && value > tagMeta.limits.max) {
                    throw new Error(`Value ${value} above maximum ${tagMeta.limits.max} for tag ${name}`);
                }
            }

            // Emit enhanced write event
            this.emit('tag_write', {
                name,
                value,
                originalValue: arguments[1],
                metadata: tagMeta
            });
        }

        return super.writeVariable(name, value);
    }

    /**
     * Enhanced cycle callback with metadata
     */
    cycleCallback(values) {
        // Apply scaling and emit enhanced data
        const enhancedValues = {};
        
        Object.entries(values).forEach(([key, value]) => {
            const tagMeta = this.tagMetadata.get(key);
            let processedValue = value;
            
            if (tagMeta && tagMeta.scaling && tagMeta.scaling !== 1) {
                processedValue = value / tagMeta.scaling;
            }
            
            enhancedValues[key] = {
                value: processedValue,
                rawValue: value,
                metadata: tagMeta
            };

            // Check alarms
            if (tagMeta && tagMeta.limits) {
                const limits = tagMeta.limits;
                if (limits.alarmHigh !== null && processedValue > limits.alarmHigh) {
                    this.emit('alarm', {
                        type: 'HIGH',
                        tagName: key,
                        value: processedValue,
                        limit: limits.alarmHigh,
                        metadata: tagMeta
                    });
                }
                if (limits.alarmLow !== null && processedValue < limits.alarmLow) {
                    this.emit('alarm', {
                        type: 'LOW',
                        tagName: key,
                        value: processedValue,
                        limit: limits.alarmLow,
                        metadata: tagMeta
                    });
                }
            }
        });

        // Emit enhanced data event
        this.emit('enhanced_data', enhancedValues);

        // Call parent cycle callback with original values
        super.cycleCallback(values);
    }

    /**
     * Get tags by group
     */
    getTagsByGroup(groupName) {
        return this.sqlTagManager.getTagsByGroup(groupName);
    }

    /**
     * Get all tag groups
     */
    getTagGroups() {
        return Array.from(this.tagGroups.keys());
    }

    /**
     * Get tag metadata
     */
    getTagMetadata(tagName) {
        return this.tagMetadata.get(tagName);
    }

    /**
     * Add or update tag in database
     */
    async saveTag(tagData) {
        return this.sqlTagManager.saveTag(tagData);
    }

    /**
     * Delete tag from database
     */
    async deleteTag(tagName) {
        return this.sqlTagManager.deleteTag(tagName);
    }

    /**
     * Refresh tags from database
     */
    async refreshTags() {
        return this.sqlTagManager.refreshTags();
    }

    /**
     * Get enhanced status including SQL connection
     */
    getEnhancedStatus() {
        return {
            s7: {
                status: this.getStatus(),
                connected: this.connected,
                variables: Object.keys(this._vars).length
            },
            sql: this.sqlTagManager.getStatus(),
            tags: {
                loaded: this.isTagsLoaded,
                count: this.tagMetadata.size,
                groups: this.tagGroups.size
            }
        };
    }

    /**
     * Enhanced disconnect
     */
    async disconnect() {
        console.log('Disconnecting Enhanced S7 Client...');
        
        // Disconnect S7 client first
        await super.disconnect();
        
        // Then disconnect SQL
        await this.sqlTagManager.disconnect();
        
        console.log('Enhanced S7 Client disconnected');
    }

    /**
     * Test both connections
     */
    async testConnections() {
        const results = {
            sql: await this.sqlTagManager.testConnection(),
            s7: {
                connected: this.connected,
                status: this.getStatus()
            }
        };

        return results;
    }

    /**
     * Create database table
     */
    async createTagTable() {
        return this.sqlTagManager.createTagTable();
    }

    /**
     * Helper method to create translation table (override parent)
     */
    createTranslationTable(vars) {
        const res = {};
        vars.forEach(function (elm) {
            if (!elm.name || !elm.addr) return;
            res[elm.name] = elm.addr;
        });
        return res;
    }

    /**
     * Get SQL tag manager instance
     */
    getSqlTagManager() {
        return this.sqlTagManager;
    }
}

module.exports = EnhancedS7Client;
