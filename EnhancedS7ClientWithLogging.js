const EnhancedS7Client = require('./EnhancedS7Client');
const SqlDataLogger = require('./SqlDataLogger');
const EngineeringUnitsUtils = require('./EngineeringUnitsUtils');

/**
 * Enhanced S7 Client with comprehensive SQL data logging and engineering units
 * Extends EnhancedS7Client to include historical data logging and proper EU scaling
 */
class EnhancedS7ClientWithLogging extends EnhancedS7Client {
    constructor(config) {
        const { loggingConfig, ...baseConfig } = config;
        
        super(baseConfig);
        
        // Initialize data logger with shared connection pool
        this.dataLogger = new SqlDataLogger({
            connectionPool: null, // Will be set after SQL connection
            ...loggingConfig
        });
        
        this.isLoggingEnabled = true;
        this.loggingStartTime = null;
        this.engineeringUnitsCache = new Map(); // Cache for EU calculations
        
        // Set up logging event handlers
        this.setupLoggingEvents();
    }

    /**
     * Set up data logger event handlers
     */
    setupLoggingEvents() {
        this.dataLogger.on('initialized', () => {
            console.log('📊 Data Logger initialized');
            this.emit('logging_initialized');
        });

        this.dataLogger.on('data_logged', (entry) => {
            this.emit('data_logged', entry);
        });

        this.dataLogger.on('alarm_logged', (entry) => {
            this.emit('alarm_logged', entry);
        });

        this.dataLogger.on('event_logged', (entry) => {
            this.emit('event_logged', entry);
        });

        this.dataLogger.on('buffer_flushed', (info) => {
            console.log(`📝 Flushed ${info.count} ${info.type} records to database`);
            this.emit('buffer_flushed', info);
        });

        this.dataLogger.on('cleanup_completed', (info) => {
            console.log(`🧹 Data cleanup completed at ${info.timestamp}`);
            this.emit('cleanup_completed', info);
        });

        this.dataLogger.on('error', (error) => {
            console.error('📊 Data Logger error:', error);
            this.emit('logging_error', error);
        });
    }

    /**
     * Initialize with logging support
     */
    async initialize() {
        try {
            console.log('Initializing Enhanced S7 Client with Logging...');

            // Initialize base client first (SQL + S7)
            await super.initialize();

            // Share the connection pool with data logger
            this.dataLogger.connectionPool = this.sqlTagManager.connectionPool;

            // Initialize data logger
            await this.dataLogger.initialize();

            // Log initialization event
            await this.dataLogger.logEvent({
                type: 'SYSTEM_START',
                category: 'INFO',
                message: 'Enhanced S7 Client with Logging and Engineering Units initialized successfully',
                source: 'EnhancedS7ClientWithLogging'
            });

            this.loggingStartTime = new Date();
            console.log('✅ Enhanced S7 Client with Logging initialized successfully');
            this.emit('fully_initialized');

            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Enhanced S7 Client with Logging:', error);
            
            // Log initialization error
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'SYSTEM_ERROR',
                    category: 'CRITICAL',
                    message: `Failed to initialize: ${error.message}`,
                    source: 'EnhancedS7ClientWithLogging'
                });
            }
            
            throw error;
        }
    }

    /**
     * Enhanced cycle callback with engineering units and data logging
     */
    cycleCallback(values) {
        // Store old values for comparison and alarm processing
        const oldValues = { ...this.currentData };
        
        // Update current data
        this.currentData = { ...values };

        // Process engineering units and create enhanced data
        const enhancedValues = {};
        const logDataPoints = [];

        Object.entries(values).forEach(([tagName, rawValue]) => {
            const tagMeta = this.tagMetadata.get(tagName);
            
            if (tagMeta) {
                // Create engineering units object
                const euObject = EngineeringUnitsUtils.createEuObject(rawValue, tagMeta);
                
                // Store in enhanced values
                enhancedValues[tagName] = {
                    rawValue: rawValue,
                    value: euObject.euValue, // EU value as the primary value
                    formattedValue: euObject.formattedValue,
                    units: euObject.units,
                    metadata: tagMeta
                };

                // Cache EU calculation for performance
                this.engineeringUnitsCache.set(tagName, euObject);

                // Prepare for logging
                if (this.isLoggingEnabled && this.dataLogger.isInitialized) {
                    logDataPoints.push({
                        tagName: tagName,
                        rawValue: rawValue,
                        euValue: euObject.euValue,
                        logType: 'PERIODIC',
                        quality: 192
                    });
                }

                // Enhanced alarm processing using EU values
                this.processAlarmsWithEu(tagName, euObject.euValue, oldValues[tagName], tagMeta);

            } else {
                // No metadata available, use raw value
                enhancedValues[tagName] = {
                    rawValue: rawValue,
                    value: rawValue,
                    formattedValue: rawValue?.toFixed(2) || 'N/A',
                    units: '',
                    metadata: null
                };

                // Log without EU conversion
                if (this.isLoggingEnabled && this.dataLogger.isInitialized) {
                    logDataPoints.push({
                        tagName: tagName,
                        rawValue: rawValue,
                        euValue: rawValue, // Same as raw when no scaling
                        logType: 'PERIODIC',
                        quality: 192
                    });
                }
            }
        });

        // Update enhanced data
        this.enhancedData = enhancedValues;

        // Emit enhanced data event
        this.emit('enhanced_data', enhancedValues);

        // Log data points in batch
        if (logDataPoints.length > 0) {
            this.logBatchData(logDataPoints);
        }

        // Emit standard data events
        let changed = false;
        this.emit('data', values);
        
        Object.keys(values).forEach(function (key) {
            if (!this.equals(oldValues[key], values[key])) {
                changed = true;
                this.emit(key, values[key]);
                this.emit('variable_changed', {
                    key: key,
                    rawValue: values[key],
                    euValue: enhancedValues[key]?.value,
                    formattedValue: enhancedValues[key]?.formattedValue
                });
            }
        }.bind(this));
        
        if (changed) {
            this.emit('data_changed', values);
        }

        // Update status
        this.manageStatus('online');
        this.readInProgress = false;

        if (this.readDeferred && this.connected) {
            this.doCycle();
            this.readDeferred = 0;
        }
    }

    /**
     * Process alarms using engineering unit values
     */
    processAlarmsWithEu(tagName, euValue, oldRawValue, tagMeta) {
        if (!tagMeta || !tagMeta.limits) return;

        // Convert old raw value to EU for comparison
        let oldEuValue = null;
        if (oldRawValue !== null && oldRawValue !== undefined) {
            const oldEuObject = EngineeringUnitsUtils.createEuObject(oldRawValue, tagMeta);
            oldEuValue = oldEuObject.euValue;
        }

        const limits = tagMeta.limits;

        // Check for high alarm
        if (limits.alarmHigh !== null) {
            const isHighAlarm = euValue > limits.alarmHigh;
            const wasHighAlarm = oldEuValue !== null && oldEuValue > limits.alarmHigh;

            if (isHighAlarm && !wasHighAlarm) {
                // Alarm activated
                this.emitAndLogAlarm(tagName, 'HIGH', 'ACTIVE', euValue, limits.alarmHigh, tagMeta);
            } else if (!isHighAlarm && wasHighAlarm) {
                // Alarm cleared
                this.emitAndLogAlarm(tagName, 'HIGH', 'CLEARED', euValue, limits.alarmHigh, tagMeta);
            }
        }

        // Check for low alarm
        if (limits.alarmLow !== null) {
            const isLowAlarm = euValue < limits.alarmLow;
            const wasLowAlarm = oldEuValue !== null && oldEuValue < limits.alarmLow;

            if (isLowAlarm && !wasLowAlarm) {
                // Alarm activated
                this.emitAndLogAlarm(tagName, 'LOW', 'ACTIVE', euValue, limits.alarmLow, tagMeta);
            } else if (!isLowAlarm && wasLowAlarm) {
                // Alarm cleared
                this.emitAndLogAlarm(tagName, 'LOW', 'CLEARED', euValue, limits.alarmLow, tagMeta);
            }
        }
    }

    /**
     * Emit alarm event and log it
     */
    async emitAndLogAlarm(tagName, alarmType, alarmState, euValue, limit, tagMeta) {
        const alarmData = {
            tagName,
            type: alarmType,
            state: alarmState,
            value: euValue, // EU value
            limit,
            units: tagMeta.engineeringUnits || tagMeta.units || '',
            message: `${alarmType} alarm ${alarmState.toLowerCase()} for ${tagName}: ${euValue}${tagMeta.engineeringUnits || ''} (${tagMeta.description || 'No description'})`,
            metadata: tagMeta
        };

        // Emit alarm event
        this.emit('alarm', alarmData);

        // Log alarm to database
        if (this.dataLogger.isInitialized) {
            await this.dataLogger.logAlarm(alarmData);

            // Also log as system event
            await this.dataLogger.logEvent({
                type: 'ALARM',
                category: alarmData.critical ? 'CRITICAL' : 'WARNING',
                message: alarmData.message,
                tagName,
                newValue: euValue,
                source: 'AlarmSystem'
            });
        }
    }

    /**
     * Log batch data with engineering units
     */
    async logBatchData(dataPoints) {
        try {
            for (const point of dataPoints) {
                await this.dataLogger.logData(
                    point.tagName,
                    point.euValue,
                    point.rawValue,
                    point.logType,
                    point.quality
                );
            }
        } catch (error) {
            console.error('Error logging batch data:', error);
        }
    }

    /**
     * Enhanced write variable with engineering units conversion
     */
    async writeVariable(name, value, isEuValue = true) {
        const oldRawValue = this.currentData[name];
        let rawValueToWrite = value;
        let euValueToWrite = value;
        
        try {
            const tagMeta = this.tagMetadata.get(name);
            
            if (tagMeta && isEuValue) {
                // Convert EU value to raw value for writing to PLC
                const scaling = tagMeta.scaling || {
                    rawMin: tagMeta.rawMin || 0,
                    rawMax: tagMeta.rawMax || 32767,
                    euMin: tagMeta.euMin || 0,
                    euMax: tagMeta.euMax || 100
                };

                rawValueToWrite = EngineeringUnitsUtils.euToRaw(value, scaling);
                euValueToWrite = value;

                console.log(`Writing ${name}: EU=${euValueToWrite}${tagMeta.engineeringUnits || ''} -> Raw=${rawValueToWrite}`);
            } else if (tagMeta && !isEuValue) {
                // Value is already raw, convert to EU for logging
                const scaling = tagMeta.scaling || {
                    rawMin: tagMeta.rawMin || 0,
                    rawMax: tagMeta.rawMax || 32767,
                    euMin: tagMeta.euMin || 0,
                    euMax: tagMeta.euMax || 100
                };

                rawValueToWrite = value;
                euValueToWrite = EngineeringUnitsUtils.rawToEu(value, scaling);
            }

            // Perform the write operation with raw value
            await super.writeVariable(name, rawValueToWrite);

            // Log the write event with both raw and EU values
            if (this.dataLogger.isInitialized) {
                const oldEuValue = tagMeta ? EngineeringUnitsUtils.rawToEu(oldRawValue || 0, tagMeta.scaling) : oldRawValue;

                await this.dataLogger.logEvent({
                    type: 'VARIABLE_WRITE',
                    category: 'INFO',
                    message: `Variable ${name} written: EU=${euValueToWrite}${tagMeta?.engineeringUnits || ''} (Raw=${rawValueToWrite})`,
                    tagName: name,
                    oldValue: oldEuValue,
                    newValue: euValueToWrite,
                    username: 'SYSTEM',
                    source: 'S7Client'
                });

                // Log the new value immediately
                await this.dataLogger.logData(name, euValueToWrite, rawValueToWrite, 'MANUAL', 192);
            }

        } catch (error) {
            // Log write error
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'WRITE_ERROR',
                    category: 'ERROR',
                    message: `Failed to write variable ${name}: ${error.message}`,
                    tagName: name,
                    newValue: isEuValue ? euValueToWrite : rawValueToWrite,
                    username: 'SYSTEM',
                    source: 'S7Client'
                });
            }

            throw error;
        }
    }

    /**
     * Write multiple variables with engineering units
     */
    async writeVariables(variables, areEuValues = true) {
        const writePromises = [];
        
        if (Array.isArray(variables)) {
            variables.forEach(({ name, value }) => {
                writePromises.push(this.writeVariable(name, value, areEuValues));
            });
        } else {
            Object.entries(variables).forEach(([name, value]) => {
                writePromises.push(this.writeVariable(name, value, areEuValues));
            });
        }

        return Promise.all(writePromises);
    }

    /**
     * Get engineering units value for a tag
     */
    getEuValue(tagName) {
        const rawValue = this.currentData[tagName];
        if (rawValue === null || rawValue === undefined) {
            return null;
        }

        const cached = this.engineeringUnitsCache.get(tagName);
        if (cached) {
            return cached.euValue;
        }

        const tagMeta = this.tagMetadata.get(tagName);
        if (tagMeta) {
            const euObject = EngineeringUnitsUtils.createEuObject(rawValue, tagMeta);
            this.engineeringUnitsCache.set(tagName, euObject);
            return euObject.euValue;
        }

        return rawValue;
    }

    /**
     * Get formatted value for display
     */
    getFormattedValue(tagName) {
        const cached = this.engineeringUnitsCache.get(tagName);
        if (cached) {
            return `${cached.formattedValue} ${cached.units}`.trim();
        }

        const rawValue = this.currentData[tagName];
        if (rawValue === null || rawValue === undefined) {
            return 'N/A';
        }

        const tagMeta = this.tagMetadata.get(tagName);
        if (tagMeta) {
            const euObject = EngineeringUnitsUtils.createEuObject(rawValue, tagMeta);
            return `${euObject.formattedValue} ${euObject.units}`.trim();
        }

        return rawValue.toString();
    }

    /**
     * Utility function for deep equality comparison
     */
    equals(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length != b.length) return false;
            for (var i = 0; i < a.length; ++i) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        }
        return false;
    }

    // ... [Rest of the methods remain the same as in the original implementation]
    constructor(config) {
        const { loggingConfig, ...baseConfig } = config;
        
        super(baseConfig);
        
        // Initialize data logger with shared connection pool
        this.dataLogger = new SqlDataLogger({
            connectionPool: null, // Will be set after SQL connection
            ...loggingConfig
        });
        
        this.isLoggingEnabled = true;
        this.loggingStartTime = null;
        
        // Set up logging event handlers
        this.setupLoggingEvents();
    }

    /**
     * Set up data logger event handlers
     */
    setupLoggingEvents() {
        this.dataLogger.on('initialized', () => {
            console.log('📊 Data Logger initialized');
            this.emit('logging_initialized');
        });

        this.dataLogger.on('data_logged', (entry) => {
            this.emit('data_logged', entry);
        });

        this.dataLogger.on('alarm_logged', (entry) => {
            this.emit('alarm_logged', entry);
        });

        this.dataLogger.on('event_logged', (entry) => {
            this.emit('event_logged', entry);
        });

        this.dataLogger.on('buffer_flushed', (info) => {
            console.log(`📝 Flushed ${info.count} ${info.type} records to database`);
            this.emit('buffer_flushed', info);
        });

        this.dataLogger.on('cleanup_completed', (info) => {
            console.log(`🧹 Data cleanup completed at ${info.timestamp}`);
            this.emit('cleanup_completed', info);
        });

        this.dataLogger.on('error', (error) => {
            console.error('📊 Data Logger error:', error);
            this.emit('logging_error', error);
        });
    }

    /**
     * Initialize with logging support
     */
    async initialize() {
        try {
            console.log('Initializing Enhanced S7 Client with Logging...');

            // Initialize base client first (SQL + S7)
            await super.initialize();

            // Share the connection pool with data logger
            this.dataLogger.connectionPool = this.sqlTagManager.connectionPool;

            // Initialize data logger
            await this.dataLogger.initialize();

            // Log initialization event
            await this.dataLogger.logEvent({
                type: 'SYSTEM_START',
                category: 'INFO',
                message: 'Enhanced S7 Client with Logging initialized successfully',
                source: 'EnhancedS7ClientWithLogging'
            });

            this.loggingStartTime = new Date();
            console.log('✅ Enhanced S7 Client with Logging initialized successfully');
            this.emit('fully_initialized');

            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Enhanced S7 Client with Logging:', error);
            
            // Log initialization error
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'SYSTEM_ERROR',
                    category: 'CRITICAL',
                    message: `Failed to initialize: ${error.message}`,
                    source: 'EnhancedS7ClientWithLogging'
                });
            }
            
            throw error;
        }
    }

    /**
     * Enhanced cycle callback with data logging
     */
    cycleCallback(values) {
        // Call parent cycle callback first
        super.cycleCallback(values);

        // Log data if logging is enabled
        if (this.isLoggingEnabled && this.dataLogger.isInitialized) {
            this.logCyclicData(values);
        }
    }

    /**
     * Log cyclic PLC data
     */
    async logCyclicData(values) {
        try {
            const dataPoints = [];

            Object.entries(values).forEach(([tagName, rawValue]) => {
                const tagMeta = this.tagMetadata.get(tagName);
                let scaledValue = rawValue;

                // Apply scaling if available
                if (tagMeta && tagMeta.scaling && tagMeta.scaling !== 1) {
                    scaledValue = rawValue / tagMeta.scaling;
                }

                dataPoints.push({
                    tagName,
                    value: scaledValue,
                    rawValue: rawValue,
                    logType: 'PERIODIC',
                    quality: 192 // Good quality
                });
            });

            // Log data points in batch
            await this.dataLogger.logDataBatch(dataPoints);

        } catch (error) {
            console.error('Error logging cyclic data:', error);
        }
    }

    /**
     * Enhanced write variable with logging
     */
    async writeVariable(name, value) {
        const oldValue = this.currentData[name];
        
        try {
            // Perform the write operation
            await super.writeVariable(name, value);

            // Log the write event
            await this.dataLogger.logEvent({
                type: 'VARIABLE_WRITE',
                category: 'INFO',
                message: `Variable ${name} written successfully`,
                tagName: name,
                oldValue: parseFloat(oldValue) || null,
                newValue: parseFloat(value),
                username: 'SYSTEM',
                source: 'S7Client'
            });

            // Log the new value immediately
            const tagMeta = this.tagMetadata.get(name);
            let scaledValue = value;

            if (tagMeta && tagMeta.scaling && tagMeta.scaling !== 1) {
                scaledValue = value / tagMeta.scaling;
            }

            await this.dataLogger.logData(name, scaledValue, value, 'MANUAL', 192);

        } catch (error) {
            // Log write error
            await this.dataLogger.logEvent({
                type: 'WRITE_ERROR',
                category: 'ERROR',
                message: `Failed to write variable ${name}: ${error.message}`,
                tagName: name,
                oldValue: parseFloat(oldValue) || null,
                newValue: parseFloat(value),
                username: 'SYSTEM',
                source: 'S7Client'
            });

            throw error;
        }
    }

    /**
     * Enhanced alarm handling with logging
     */
    cycleCallback(values) {
        // Store old values for comparison
        const oldValues = { ...this.currentData };
        
        // Call parent cycle callback
        super.cycleCallback(values);

        // Enhanced alarm processing with logging
        Object.entries(values).forEach(([tagName, rawValue]) => {
            const tagMeta = this.tagMetadata.get(tagName);
            
            if (tagMeta && tagMeta.limits) {
                let scaledValue = rawValue;
                
                if (tagMeta.scaling && tagMeta.scaling !== 1) {
                    scaledValue = rawValue / tagMeta.scaling;
                }

                const limits = tagMeta.limits;
                const oldScaledValue = oldValues[tagName] ? (oldValues[tagName] / (tagMeta.scaling || 1)) : null;

                // Check for high alarm
                if (limits.alarmHigh !== null) {
                    const isHighAlarm = scaledValue > limits.alarmHigh;
                    const wasHighAlarm = oldScaledValue !== null && oldScaledValue > limits.alarmHigh;

                    if (isHighAlarm && !wasHighAlarm) {
                        // Alarm activated
                        this.logAlarmEvent(tagName, 'HIGH', 'ACTIVE', scaledValue, limits.alarmHigh, tagMeta);
                    } else if (!isHighAlarm && wasHighAlarm) {
                        // Alarm cleared
                        this.logAlarmEvent(tagName, 'HIGH', 'CLEARED', scaledValue, limits.alarmHigh, tagMeta);
                    }
                }

                // Check for low alarm
                if (limits.alarmLow !== null) {
                    const isLowAlarm = scaledValue < limits.alarmLow;
                    const wasLowAlarm = oldScaledValue !== null && oldScaledValue < limits.alarmLow;

                    if (isLowAlarm && !wasLowAlarm) {
                        // Alarm activated
                        this.logAlarmEvent(tagName, 'LOW', 'ACTIVE', scaledValue, limits.alarmLow, tagMeta);
                    } else if (!isLowAlarm && wasLowAlarm) {
                        // Alarm cleared
                        this.logAlarmEvent(tagName, 'LOW', 'CLEARED', scaledValue, limits.alarmLow, tagMeta);
                    }
                }
            }
        });
    }

    /**
     * Log alarm events
     */
    async logAlarmEvent(tagName, alarmType, alarmState, value, limit, tagMeta) {
        try {
            const alarmData = {
                tagName,
                type: alarmType,
                state: alarmState,
                value,
                limit,
                message: `${alarmType} alarm ${alarmState.toLowerCase()} for ${tagName} (${tagMeta.description || 'No description'})`,
                critical: alarmType === 'HIGH' && tagMeta.group === 'Safety'
            };

            await this.dataLogger.logAlarm(alarmData);

            // Also log as system event
            await this.dataLogger.logEvent({
                type: 'ALARM',
                category: alarmData.critical ? 'CRITICAL' : 'WARNING',
                message: alarmData.message,
                tagName,
                newValue: value,
                source: 'AlarmSystem'
            });

        } catch (error) {
            console.error('Error logging alarm event:', error);
        }
    }

    /**
     * Enhanced connection events with logging
     */
    onConnect() {
        super.onConnect();
        
        // Log connection event
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'PLC_CONNECTED',
                category: 'INFO',
                message: `Connected to PLC at ${this.config.address}:${this.config.port}`,
                source: 'S7Client'
            });
        }
    }

    onDisconnect() {
        super.onDisconnect();
        
        // Log disconnection event
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'PLC_DISCONNECTED',
                category: 'WARNING',
                message: `Disconnected from PLC at ${this.config.address}:${this.config.port}`,
                source: 'S7Client'
            });
        }
    }

    onError(error) {
        super.onError(error);
        
        // Log error event
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'PLC_ERROR',
                category: 'ERROR',
                message: `PLC communication error: ${error.message}`,
                source: 'S7Client'
            });
        }
    }

    /**
     * Enhanced tag operations with logging
     */
    async saveTag(tagData) {
        try {
            await super.saveTag(tagData);
            
            // Log tag save event
            await this.dataLogger.logEvent({
                type: 'TAG_SAVED',
                category: 'INFO',
                message: `Tag ${tagData.name} saved to database`,
                tagName: tagData.name,
                source: 'TagManager'
            });

        } catch (error) {
            // Log save error
            await this.dataLogger.logEvent({
                type: 'TAG_SAVE_ERROR',
                category: 'ERROR',
                message: `Failed to save tag ${tagData.name}: ${error.message}`,
                tagName: tagData.name,
                source: 'TagManager'
            });
            
            throw error;
        }
    }

    async deleteTag(tagName) {
        try {
            await super.deleteTag(tagName);
            
            // Log tag deletion event
            await this.dataLogger.logEvent({
                type: 'TAG_DELETED',
                category: 'INFO',
                message: `Tag ${tagName} deleted from database`,
                tagName: tagName,
                source: 'TagManager'
            });

        } catch (error) {
            // Log deletion error
            await this.dataLogger.logEvent({
                type: 'TAG_DELETE_ERROR',
                category: 'ERROR',
                message: `Failed to delete tag ${tagName}: ${error.message}`,
                tagName: tagName,
                source: 'TagManager'
            });
            
            throw error;
        }
    }

    /**
     * Get historical data for a tag
     */
    async getHistoricalData(tagName, startDate, endDate, limit = 1000) {
        return await this.dataLogger.getLoggedData(tagName, startDate, endDate, limit);
    }

    /**
     * Get alarm history
     */
    async getAlarmHistory(tagName = null, limit = 100) {
        return await this.dataLogger.getAlarmHistory(tagName, limit);
    }

    /**
     * Get logging statistics
     */
    async getLoggingStatistics() {
        return await this.dataLogger.getLoggingStats();
    }

    /**
     * Acknowledge alarm in database
     */
    async acknowledgeAlarm(alarmId, username = 'SYSTEM') {
        try {
            await this.dataLogger.connectionPool.request()
                .input('alarmId', sql.BigInt, alarmId)
                .input('username', sql.NVarChar, username)
                .input('acknowledgedAt', sql.DateTime2, new Date())
                .query(`
                    UPDATE ${this.dataLogger.config.alarmTable}
                    SET AlarmState = 'ACKNOWLEDGED',
                        AcknowledgedBy = @username,
                        AcknowledgedAt = @acknowledgedAt
                    WHERE AlarmID = @alarmId
                `);

            // Log acknowledgment event
            await this.dataLogger.logEvent({
                type: 'ALARM_ACKNOWLEDGED',
                category: 'INFO',
                message: `Alarm ${alarmId} acknowledged by ${username}`,
                username: username,
                source: 'AlarmSystem'
            });

            return true;

        } catch (error) {
            console.error('Error acknowledging alarm:', error);
            throw error;
        }
    }

    /**
     * Enable/disable logging
     */
    setLoggingEnabled(enabled) {
        this.isLoggingEnabled = enabled;
        
        const message = enabled ? 'Data logging enabled' : 'Data logging disabled';
        console.log(`📊 ${message}`);
        
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'LOGGING_STATE_CHANGE',
                category: 'INFO',
                message: message,
                source: 'S7Client'
            });
        }
        
        this.emit('logging_state_changed', { enabled });
    }

    /**
     * Force flush all logging buffers
     */
    async flushLoggingBuffers() {
        if (this.dataLogger.isInitialized) {
            await this.dataLogger.flushAllBuffers();
        }
    }

    /**
     * Get enhanced status with logging information
     */
    getEnhancedStatusWithLogging() {
        const baseStatus = super.getEnhancedStatus();
        
        return {
            ...baseStatus,
            logging: {
                enabled: this.isLoggingEnabled,
                initialized: this.dataLogger.isInitialized,
                startTime: this.loggingStartTime,
                bufferCounts: {
                    data: this.dataLogger.logBuffer.length,
                    alarms: this.dataLogger.alarmBuffer.length,
                    events: this.dataLogger.eventBuffer.length
                }
            }
        };
    }

    /**
     * Enhanced disconnect with logging
     */
    async disconnect() {
        console.log('🔄 Disconnecting Enhanced S7 Client with Logging...');
        
        try {
            // Log shutdown event
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'SYSTEM_SHUTDOWN',
                    category: 'INFO',
                    message: 'Enhanced S7 Client with Logging shutting down',
                    source: 'EnhancedS7ClientWithLogging'
                });
            }

            // Flush all remaining data
            await this.flushLoggingBuffers();
            
            // Shutdown data logger
            await this.dataLogger.shutdown();
            
            // Disconnect base client
            await super.disconnect();
            
            console.log('✅ Enhanced S7 Client with Logging disconnected successfully');

        } catch (error) {
            console.error('❌ Error during disconnect:', error);
        }
    }

    /**
     * Get data logger instance for advanced operations
     */
    getDataLogger() {
        return this.dataLogger;
    }

    /**
     * Generate data summary report
     */
    async generateDataSummary(startDate, endDate) {
        try {
            const result = await this.dataLogger.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .query(`
                    SELECT 
                        TagName,
                        COUNT(*) as RecordCount,
                        MIN(TagValue) as MinValue,
                        MAX(TagValue) as MaxValue,
                        AVG(TagValue) as AvgValue,
                        STDEV(TagValue) as StdDeviation,
                        MIN(Timestamp) as FirstRecord,
                        MAX(Timestamp) as LastRecord
                    FROM ${this.dataLogger.config.dataTable}
                    WHERE Timestamp BETWEEN @startDate AND @endDate
                    GROUP BY TagName
                    ORDER BY TagName
                `);

            return result.recordset;

        } catch (error) {
            console.error('Error generating data summary:', error);
            throw error;
        }
    }

    /**
     * Export data to CSV format
     */
    async exportDataToCSV(tagNames, startDate, endDate) {
        try {
            const tagList = Array.isArray(tagNames) ? tagNames.join("','") : tagNames;
            
            const result = await this.dataLogger.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .query(`
                    SELECT 
                        TagName,
                        TagValue,
                        RawValue,
                        Quality,
                        Timestamp,
                        LogType
                    FROM ${this.dataLogger.config.dataTable}
                    WHERE TagName IN ('${tagList}')
                      AND Timestamp BETWEEN @startDate AND @endDate
                    ORDER BY TagName, Timestamp
                `);

            // Convert to CSV format
            const headers = ['TagName', 'TagValue', 'RawValue', 'Quality', 'Timestamp', 'LogType'];
            const csvData = [headers.join(',')];
            
            result.recordset.forEach(row => {
                const csvRow = [
                    row.TagName,
                    row.TagValue,
                    row.RawValue || '',
                    row.Quality,
                    row.Timestamp.toISOString(),
                    row.LogType
                ];
                csvData.push(csvRow.join(','));
            });

            return csvData.join('\n');

        } catch (error) {
            console.error('Error exporting data to CSV:', error);
            throw error;
        }
    }
}

module.exports = EnhancedS7ClientWithLogging;
