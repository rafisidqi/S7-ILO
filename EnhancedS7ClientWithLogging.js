const EnhancedS7Client = require('./EnhancedS7Client');
const SqlDataLogger = require('./SqlDataLogger');
const EngineeringUnitsUtils = require('./EngineeringUnitsUtils');

/**
 * Enhanced S7 Client with comprehensive SQL data logging and engineering units
 * Updated to work with the new enhanced database schema (db.sql)
 * Supports full engineering units conversion, advanced alarms, and comprehensive logging
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
        this.alarmStates = new Map(); // Track current alarm states for hysteresis
        
        // Set up logging event handlers
        this.setupLoggingEvents();
    }

    /**
     * Set up data logger event handlers
     */
    setupLoggingEvents() {
        this.dataLogger.on('initialized', () => {
            console.log('📊 Enhanced Data Logger initialized');
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

        this.dataLogger.on('summaries_generated', (info) => {
            console.log(`📈 Generated ${info.count} ${info.type} summaries`);
            this.emit('summaries_generated', info);
        });

        this.dataLogger.on('cleanup_completed', (info) => {
            console.log(`🧹 Data cleanup completed: ${JSON.stringify(info)}`);
            this.emit('cleanup_completed', info);
        });

        this.dataLogger.on('buffers_flushed', (info) => {
            this.emit('buffers_flushed', info);
        });

        this.dataLogger.on('error', (error) => {
            console.error('📊 Enhanced Data Logger error:', error);
            this.emit('logging_error', error);
        });
    }

    /**
     * Initialize with enhanced logging support
     */
    async initialize() {
        try {
            console.log('Initializing Enhanced S7 Client with Advanced Logging...');

            // Initialize base client first (SQL + S7)
            await super.initialize();

            // Share the connection pool with data logger
            this.dataLogger.connectionPool = this.sqlTagManager.connectionPool;

            // Initialize enhanced data logger
            await this.dataLogger.initialize();

            // Log initialization event with enhanced context
            await this.dataLogger.logEvent({
                type: 'SYSTEM_START',
                category: 'INFO',
                message: 'Enhanced S7 Client with Advanced Logging and Engineering Units initialized successfully',
                source: 'EnhancedS7ClientWithLogging',
                sourceVersion: '2.0.0',
                additionalData: {
                    plcAddress: this.config.address,
                    plcPort: this.config.port,
                    cycleTime: this.config.cycletime,
                    tagCount: this.tagMetadata.size
                }
            });

            this.loggingStartTime = new Date();
            console.log('✅ Enhanced S7 Client with Advanced Logging initialized successfully');
            this.emit('fully_initialized');

            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Enhanced S7 Client with Advanced Logging:', error);
            
            // Log initialization error if possible
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'SYSTEM_ERROR',
                    category: 'CRITICAL',
                    message: `Failed to initialize: ${error.message}`,
                    source: 'EnhancedS7ClientWithLogging',
                    additionalData: { error: error.stack }
                });
            }
            
            throw error;
        }
    }

    /**
     * Enhanced cycle callback with engineering units and advanced data logging
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
                // Create engineering units object with enhanced metadata
                const euObject = this.createEnhancedEuObject(rawValue, tagMeta);
                
                // Store in enhanced values
                enhancedValues[tagName] = {
                    rawValue: rawValue,
                    value: euObject.euValue, // EU value as the primary value
                    formattedValue: euObject.formattedValue,
                    units: euObject.units,
                    quality: euObject.quality,
                    metadata: tagMeta
                };

                // Cache EU calculation for performance
                this.engineeringUnitsCache.set(tagName, euObject);

                // Prepare for enhanced logging if enabled
                if (this.isLoggingEnabled && this.dataLogger.isInitialized && tagMeta.loggingConfig.enabled) {
                    logDataPoints.push({
                        plcName: plcName,
                        tagName: tagName,
                        euValue: euObject.euValue,
                        rawValue: rawValue,
                        logType: 'PERIODIC',
                        quality: 192
                    });
                }

                // Enhanced alarm processing using EU values with hysteresis
                this.processAdvancedAlarmsWithEu(tagName, euObject.euValue, oldValues[tagName], tagMeta);

            } else {
                // No metadata available, use raw value
                enhancedValues[tagName] = {
                    rawValue: rawValue,
                    value: rawValue,
                    formattedValue: rawValue?.toFixed(2) || 'N/A',
                    units: '',
                    quality: 'UNKNOWN',
                    metadata: null
                };

                // Log without EU conversion if logging is enabled for unknown tags
                if (this.isLoggingEnabled && this.dataLogger.isInitialized) {
                    logDataPoints.push({
                        plcName: plcName,
                        tagName: tagName,
                        euValue: rawValue,
                        rawValue: rawValue,
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

        // Log data points in batch using enhanced logging
        if (logDataPoints.length > 0) {
            this.logBatchDataEnhanced(logDataPoints);
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
     * Create enhanced engineering units object with full metadata support
     */
    createEnhancedEuObject(rawValue, tagMeta) {
        if (!tagMeta || !tagMeta.scalingConfig) {
            return {
                rawValue: rawValue,
                euValue: rawValue,
                formattedValue: this.formatValue(rawValue, 2),
                units: tagMeta?.units || '',
                quality: 'UNKNOWN',
                scaling: null
            };
        }

        const scaling = tagMeta.scalingConfig;
        let euValue;

        // Apply different scaling types
        switch (scaling.type) {
            case 'SQRT':
                euValue = this.applySqrtScaling(rawValue, scaling);
                break;
            case 'POLYNOMIAL':
                euValue = this.applyPolynomialScaling(rawValue, scaling, scaling.coefficients);
                break;
            case 'LINEAR':
            default:
                euValue = EngineeringUnitsUtils.rawToEu(rawValue, scaling);
                break;
        }

        const decimalPlaces = tagMeta.decimalPlaces || 2;
        const units = tagMeta.engineeringUnits || tagMeta.units || '';
        const formatString = tagMeta.formatString;

        return {
            rawValue: rawValue,
            euValue: euValue,
            formattedValue: this.formatValue(euValue, decimalPlaces, formatString),
            units: units,
            quality: 'GOOD',
            scaling: scaling,
            metadata: {
                decimalPlaces: decimalPlaces,
                formatString: formatString,
                description: tagMeta.description,
                group: tagMeta.group,
                scalingType: scaling.type
            }
        };
    }

    /**
     * Apply square root scaling for flow measurements
     */
    applySqrtScaling(rawValue, scaling) {
        const linearValue = EngineeringUnitsUtils.rawToEu(rawValue, scaling);
        
        if (linearValue < 0) {
            return 0; // Flow cannot be negative
        }
        
        return Math.sqrt(linearValue / (scaling.euMax || 100)) * (scaling.euMax || 100);
    }

    /**
     * Apply polynomial scaling for non-linear sensors
     */
    applyPolynomialScaling(rawValue, scaling, coefficients) {
        if (!coefficients || coefficients.length === 0) {
            return EngineeringUnitsUtils.rawToEu(rawValue, scaling);
        }

        // First normalize the raw value to 0-1 range
        const normalizedValue = (rawValue - scaling.rawMin) / (scaling.rawMax - scaling.rawMin);
        
        // Apply polynomial
        let result = 0;
        for (let i = 0; i < coefficients.length; i++) {
            result += coefficients[i] * Math.pow(normalizedValue, i);
        }

        // Scale to engineering units range
        return scaling.euMin + result * (scaling.euMax - scaling.euMin);
    }

    /**
     * Format value with enhanced options
     */
    formatValue(value, decimalPlaces = 2, formatString = null) {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }

        if (formatString) {
            try {
                // Handle basic format strings
                if (formatString.includes('{0}')) {
                    return formatString.replace('{0}', value.toFixed(decimalPlaces));
                }
                // Could add more sophisticated formatting here
            } catch (error) {
                // Fall back to default formatting if custom format fails
            }
        }

        return value.toFixed(decimalPlaces);
    }

    /**
     * Process advanced alarms using engineering unit values with hysteresis and priorities
     */
    processAdvancedAlarmsWithEu(tagName, euValue, oldRawValue, tagMeta) {
        if (!tagMeta || !tagMeta.alarmConfig || !tagMeta.alarmConfig.enabled) {
            return;
        }

        // Convert old raw value to EU for comparison
        let oldEuValue = null;
        if (oldRawValue !== null && oldRawValue !== undefined) {
            const oldEuObject = this.createEnhancedEuObject(oldRawValue, tagMeta);
            oldEuValue = oldEuObject.euValue;
        }

        const alarmConfig = tagMeta.alarmConfig;
        const limits = alarmConfig.limits;
        const deadband = alarmConfig.deadband || 1.0;

        // Get current alarm states for this tag
        const currentStates = this.alarmStates.get(tagName) || {
            highHigh: false,
            high: false,
            low: false,
            lowLow: false
        };

        // Check Critical High Alarm (HIGHHIGH) with hysteresis
        if (limits.highHigh !== null && limits.highHigh !== undefined) {
            const wasHighHigh = currentStates.highHigh;
            let isHighHigh = false;

            if (!wasHighHigh && euValue > limits.highHigh) {
                isHighHigh = true; // Alarm activates
            } else if (wasHighHigh && euValue < (limits.highHigh - deadband)) {
                isHighHigh = false; // Alarm clears with hysteresis
            } else {
                isHighHigh = wasHighHigh; // Maintain current state
            }

            if (isHighHigh !== wasHighHigh) {
                this.emitAndLogAdvancedAlarm(tagName, 'HIGHHIGH', isHighHigh ? 'ACTIVE' : 'CLEARED', 
                                           euValue, limits.highHigh, tagMeta, 'CRITICAL');
                currentStates.highHigh = isHighHigh;
            }
        }

        // Check High Alarm with hysteresis
        if (limits.high !== null && limits.high !== undefined) {
            const wasHigh = currentStates.high;
            let isHigh = false;

            if (!wasHigh && euValue > limits.high) {
                isHigh = true; // Alarm activates
            } else if (wasHigh && euValue < (limits.high - deadband)) {
                isHigh = false; // Alarm clears with hysteresis
            } else {
                isHigh = wasHigh; // Maintain current state
            }

            if (isHigh !== wasHigh) {
                this.emitAndLogAdvancedAlarm(tagName, 'HIGH', isHigh ? 'ACTIVE' : 'CLEARED', 
                                           euValue, limits.high, tagMeta, 'HIGH');
                currentStates.high = isHigh;
            }
        }

        // Check Low Alarm with hysteresis
        if (limits.low !== null && limits.low !== undefined) {
            const wasLow = currentStates.low;
            let isLow = false;

            if (!wasLow && euValue < limits.low) {
                isLow = true; // Alarm activates
            } else if (wasLow && euValue > (limits.low + deadband)) {
                isLow = false; // Alarm clears with hysteresis
            } else {
                isLow = wasLow; // Maintain current state
            }

            if (isLow !== wasLow) {
                this.emitAndLogAdvancedAlarm(tagName, 'LOW', isLow ? 'ACTIVE' : 'CLEARED', 
                                           euValue, limits.low, tagMeta, 'HIGH');
                currentStates.low = isLow;
            }
        }

        // Check Critical Low Alarm (LOWLOW) with hysteresis
        if (limits.lowLow !== null && limits.lowLow !== undefined) {
            const wasLowLow = currentStates.lowLow;
            let isLowLow = false;

            if (!wasLowLow && euValue < limits.lowLow) {
                isLowLow = true; // Alarm activates
            } else if (wasLowLow && euValue > (limits.lowLow + deadband)) {
                isLowLow = false; // Alarm clears with hysteresis
            } else {
                isLowLow = wasLowLow; // Maintain current state
            }

            if (isLowLow !== wasLowLow) {
                this.emitAndLogAdvancedAlarm(tagName, 'LOWLOW', isLowLow ? 'ACTIVE' : 'CLEARED', 
                                           euValue, limits.lowLow, tagMeta, 'CRITICAL');
                currentStates.lowLow = isLowLow;
            }
        }

        // Update alarm states
        this.alarmStates.set(tagName, currentStates);
    }

    /**
     * Emit advanced alarm event and log it with enhanced context
     */
    async emitAndLogAdvancedAlarm(tagName, alarmType, alarmState, euValue, limit, tagMeta, severity = 'MEDIUM') {
        const alarmData = {
            tagName,
            type: alarmType,
            state: alarmState,
            value: euValue, // EU value
            limit,
            deviation: euValue - limit,
            units: tagMeta.engineeringUnits || tagMeta.units || '',
            severity,
            priority: tagMeta.alarmConfig.priority || 5,
            message: `${alarmType} alarm ${alarmState.toLowerCase()} for ${tagName}: ${euValue}${tagMeta.engineeringUnits || ''} (Limit: ${limit}${tagMeta.engineeringUnits || ''}) - ${tagMeta.description || 'No description'}`,
            metadata: tagMeta,
            alarmGroup: tagMeta.group,
            systemContext: this.getSystemContext()
        };

        // Emit alarm event
        this.emit('alarm', alarmData);

        // Log alarm to database using enhanced stored procedure
        if (this.dataLogger.isInitialized) {
            await this.dataLogger.logAlarm({
                tagName,
                type: alarmType,
                state: alarmState,
                value: euValue,
                limit,
                message: alarmData.message,
                username: 'SYSTEM',
                systemContext: alarmData.systemContext
            });

            // Also log as system event with enhanced context
            await this.dataLogger.logEvent({
                type: 'ALARM_' + alarmState,
                category: severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
                message: alarmData.message,
                tagName,
                newValue: euValue,
                source: 'AdvancedAlarmSystem',
                sourceVersion: '2.0.0',
                additionalData: {
                    alarmType,
                    severity,
                    priority: alarmData.priority,
                    limit,
                    deviation: alarmData.deviation,
                    units: alarmData.units,
                    alarmGroup: alarmData.alarmGroup
                }
            });
        }
    }

    /**
     * Get current system context for alarm logging
     */
    getSystemContext() {
        return JSON.stringify({
            plcConnected: this.connected,
            sqlConnected: this.isSqlConnected,
            loggingEnabled: this.isLoggingEnabled,
            cycleTime: this.currentCycleTime,
            activeTags: this.tagMetadata.size,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log batch data with enhanced engineering units support
     */
    async logBatchDataEnhanced(dataPoints) {
        try {
            // Use the enhanced batch logging method
            await this.dataLogger.logDataBatch(dataPoints);
        } catch (error) {
            console.error('Error logging enhanced batch data:', error);
            
            // Log the error event
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'LOGGING_ERROR',
                    category: 'ERROR',
                    message: `Failed to log batch data: ${error.message}`,
                    source: 'EnhancedS7ClientWithLogging',
                    additionalData: { batchSize: dataPoints.length, error: error.stack }
                });
            }
        }
    }

    /**
     * Enhanced write variable with engineering units conversion and comprehensive logging
     */
    async writeVariable(name, value, isEuValue = true) {
        const oldRawValue = this.currentData[name];
        let rawValueToWrite = value;
        let euValueToWrite = value;
        let oldEuValue = null;
        
        try {
            const tagMeta = this.tagMetadata.get(name);
            
            if (tagMeta && tagMeta.scalingConfig) {
                // Calculate old EU value for logging
                if (oldRawValue !== null && oldRawValue !== undefined) {
                    const oldEuObject = this.createEnhancedEuObject(oldRawValue, tagMeta);
                    oldEuValue = oldEuObject.euValue;
                }

                if (isEuValue) {
                    // Convert EU value to raw value for writing to PLC
                    rawValueToWrite = this.convertEuToRaw(value, tagMeta.scalingConfig);
                    euValueToWrite = value;
                } else {
                    // Value is already raw, convert to EU for logging
                    rawValueToWrite = value;
                    const euObject = this.createEnhancedEuObject(value, tagMeta);
                    euValueToWrite = euObject.euValue;
                }

                console.log(`Writing ${name}: EU=${euValueToWrite}${tagMeta.engineeringUnits || ''} -> Raw=${rawValueToWrite}`);
            } else {
                oldEuValue = oldRawValue;
            }

            // Validate write value against limits
            if (tagMeta && tagMeta.limits && isEuValue) {
                if (tagMeta.limits.min !== null && euValueToWrite < tagMeta.limits.min) {
                    throw new Error(`EU value ${euValueToWrite} below minimum operating limit ${tagMeta.limits.min} for tag ${name}`);
                }
                if (tagMeta.limits.max !== null && euValueToWrite > tagMeta.limits.max) {
                    throw new Error(`EU value ${euValueToWrite} above maximum operating limit ${tagMeta.limits.max} for tag ${name}`);
                }
            }

            // Perform the write operation with raw value
            await super.writeVariable(name, rawValueToWrite);

            // Log the write event with comprehensive context
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'VARIABLE_WRITE',
                    category: 'INFO',
                    message: `Variable ${name} written successfully: EU=${euValueToWrite}${tagMeta?.engineeringUnits || ''} (Raw=${rawValueToWrite})`,
                    tagName: name,
                    oldValue: oldEuValue,
                    newValue: euValueToWrite,
                    oldRawValue: oldRawValue,
                    newRawValue: rawValueToWrite,
                    username: 'SYSTEM',
                    source: 'EnhancedS7Client',
                    sourceVersion: '2.0.0',
                    additionalData: {
                        isEuValue,
                        units: tagMeta?.engineeringUnits || '',
                        scalingType: tagMeta?.scalingConfig?.type || 'LINEAR'
                    }
                });

                // Log the new value immediately using enhanced logging
                await this.dataLogger.logData(name, euValueToWrite, rawValueToWrite, 'MANUAL', 192);
            }

        } catch (error) {
            // Log write error with enhanced context
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.logEvent({
                    type: 'WRITE_ERROR',
                    category: 'ERROR',
                    message: `Failed to write variable ${name}: ${error.message}`,
                    tagName: name,
                    newValue: isEuValue ? euValueToWrite : rawValueToWrite,
                    username: 'SYSTEM',
                    source: 'EnhancedS7Client',
                    additionalData: {
                        isEuValue,
                        targetValue: value,
                        error: error.stack
                    }
                });
            }

            throw error;
        }
    }

    /**
     * Convert engineering units to raw value using enhanced scaling
     */
    convertEuToRaw(euValue, scalingConfig) {
        switch (scalingConfig.type) {
            case 'SQRT':
                // Inverse square root scaling
                const normalizedEu = (euValue - scalingConfig.euMin) / (scalingConfig.euMax - scalingConfig.euMin);
                const sqrtValue = Math.pow(normalizedEu, 2);
                return scalingConfig.rawMin + sqrtValue * (scalingConfig.rawMax - scalingConfig.rawMin);
                
            case 'POLYNOMIAL':
                // Would need inverse polynomial calculation - complex, fallback to linear
                return EngineeringUnitsUtils.euToRaw(euValue, scalingConfig);
                
            case 'LINEAR':
            default:
                return EngineeringUnitsUtils.euToRaw(euValue, scalingConfig);
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
     * Get engineering units value for a tag with caching
     */
    getEuValue(tagName) {
        const cached = this.engineeringUnitsCache.get(tagName);
        if (cached) {
            return cached.euValue;
        }

        const rawValue = this.currentData[tagName];
        if (rawValue === null || rawValue === undefined) {
            return null;
        }

        const tagMeta = this.tagMetadata.get(tagName);
        if (tagMeta) {
            const euObject = this.createEnhancedEuObject(rawValue, tagMeta);
            this.engineeringUnitsCache.set(tagName, euObject);
            return euObject.euValue;
        }

        return rawValue;
    }

    /**
     * Get formatted value for display with enhanced formatting
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
            const euObject = this.createEnhancedEuObject(rawValue, tagMeta);
            return `${euObject.formattedValue} ${euObject.units}`.trim();
        }

        return rawValue.toString();
    }

    /**
     * Enhanced connection events with comprehensive logging
     */
    onConnect() {
        super.onConnect();
        
        // Log connection event with enhanced context
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'PLC_CONNECTED',
                category: 'INFO',
                message: `Connected to PLC successfully`,
                source: 'EnhancedS7Client',
                sourceVersion: '2.0.0',
                additionalData: {
                    plcAddress: this.config.address,
                    plcPort: this.config.port,
                    cycleTime: this.config.cycletime,
                    tagCount: this.tagMetadata.size,
                    connectionTime: new Date().toISOString()
                }
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
                message: `Disconnected from PLC`,
                source: 'EnhancedS7Client',
                additionalData: {
                    plcAddress: this.config.address,
                    uptime: this.loggingStartTime ? (new Date() - this.loggingStartTime) / 1000 : 0,
                    disconnectionTime: new Date().toISOString()
                }
            });
        }
    }

    onError(error) {
        super.onError(error);
        
        // Log error event with enhanced context
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'PLC_ERROR',
                category: 'ERROR',
                message: `PLC communication error: ${error.message}`,
                source: 'EnhancedS7Client',
                additionalData: {
                    error: error.stack,
                    plcAddress: this.config.address,
                    plcPort: this.config.port
                }
            });
        }
    }

    /**
     * Enhanced tag operations with comprehensive logging
     */
    async saveTag(tagData) {
        try {
            await super.saveTag(tagData);
            
            // Log tag save event with enhanced context
            await this.dataLogger.logEvent({
                type: 'TAG_SAVED',
                category: 'INFO',
                message: `Enhanced tag ${tagData.name} saved to database`,
                tagName: tagData.name,
                source: 'EnhancedTagManager',
                sourceVersion: '2.0.0',
                additionalData: {
                    tagType: tagData.type,
                    group: tagData.group,
                    engineeringUnits: tagData.engineeringUnits,
                    scalingType: tagData.scalingConfig?.type || 'LINEAR',
                    alarmEnabled: tagData.alarmConfig?.enabled || false,
                    loggingEnabled: tagData.loggingConfig?.enabled || false
                }
            });

        } catch (error) {
            // Log save error
            await this.dataLogger.logEvent({
                type: 'TAG_SAVE_ERROR',
                category: 'ERROR',
                message: `Failed to save enhanced tag ${tagData.name}: ${error.message}`,
                tagName: tagData.name,
                source: 'EnhancedTagManager',
                additionalData: {
                    error: error.stack,
                    tagData: JSON.stringify(tagData)
                }
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
                message: `Enhanced tag ${tagName} deleted from database`,
                tagName: tagName,
                source: 'EnhancedTagManager'
            });

        } catch (error) {
            // Log deletion error
            await this.dataLogger.logEvent({
                type: 'TAG_DELETE_ERROR',
                category: 'ERROR',
                message: `Failed to delete enhanced tag ${tagName}: ${error.message}`,
                tagName: tagName,
                source: 'EnhancedTagManager',
                additionalData: { error: error.stack }
            });
            
            throw error;
        }
    }

    /**
     * Get historical data for a tag using enhanced data logger
     */
    async getHistoricalData(tagName, startDate, endDate, limit = 1000) {
        return await this.dataLogger.getLoggedData(tagName, startDate, endDate, limit);
    }

    /**
     * Get alarm history using enhanced data logger
     */
    async getAlarmHistory(tagName = null, limit = 100) {
        return await this.dataLogger.getAlarmHistory(tagName, limit);
    }

    /**
     * Get comprehensive logging statistics
     */
    async getLoggingStatistics() {
        return await this.dataLogger.getLoggingStats();
    }

    /**
     * Acknowledge alarm in database
     */
    async acknowledgeAlarm(alarmId, username = 'SYSTEM', comments = null) {
        return await this.dataLogger.acknowledgeAlarm(alarmId, username, comments);
    }

    /**
     * Generate data summary report using enhanced features
     */
    async generateDataSummary(startDate, endDate) {
        try {
            const result = await this.dataLogger.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .query(`
                    SELECT 
                        dh.TagName,
                        COUNT(*) as RecordCount,
                        MIN(dh.EuValue) as MinValue,
                        MAX(dh.EuValue) as MaxValue,
                        AVG(dh.EuValue) as AvgValue,
                        STDEV(dh.EuValue) as StdDeviation,
                        MIN(dh.Timestamp) as FirstRecord,
                        MAX(dh.Timestamp) as LastRecord,
                        t.EngineeringUnits,
                        t.GroupName,
                        t.Description,
                        COUNT(CASE WHEN dh.Quality = 192 THEN 1 END) * 100.0 / COUNT(*) as GoodQualityPercentage
                    FROM ${this.dataLogger.config.dataTable} dh
                    LEFT JOIN Tags t ON dh.TagName = t.TagName
                    WHERE dh.Timestamp BETWEEN @startDate AND @endDate
                    GROUP BY dh.TagName, t.EngineeringUnits, t.GroupName, t.Description
                    ORDER BY dh.TagName
                `);

            return result.recordset;

        } catch (error) {
            console.error('Error generating enhanced data summary:', error);
            throw error;
        }
    }

    /**
     * Export data to CSV format with enhanced features
     */
    async exportDataToCSV(tagNames, startDate, endDate) {
        return await this.dataLogger.exportDataToCSV(tagNames, startDate, endDate);
    }

    /**
     * Get tag availability metrics
     */
    async getTagAvailability(tagNames, startDate, endDate) {
        return await this.dataLogger.getTagAvailability(tagNames, startDate, endDate);
    }

    /**
     * Enable/disable logging with enhanced event tracking
     */
    setLoggingEnabled(enabled) {
        const wasEnabled = this.isLoggingEnabled;
        this.isLoggingEnabled = enabled;
        
        const message = enabled ? 'Enhanced data logging enabled' : 'Enhanced data logging disabled';
        console.log(`📊 ${message}`);
        
        if (this.dataLogger.isInitialized) {
            this.dataLogger.logEvent({
                type: 'LOGGING_STATE_CHANGE',
                category: 'INFO',
                message: message,
                source: 'EnhancedS7Client',
                additionalData: {
                    previousState: wasEnabled,
                    newState: enabled,
                    changedAt: new Date().toISOString()
                }
            });
        }
        
        this.emit('logging_state_changed', { enabled, previousState: wasEnabled });
    }

    /**
     * Force flush all logging buffers (enhanced version handles this automatically)
     */
    async flushLoggingBuffers() {
        if (this.dataLogger.isInitialized) {
            await this.dataLogger.flushAllBuffers();
        }
    }

    /**
     * Get enhanced status with comprehensive logging information
     */
    getEnhancedStatusWithLogging() {
        const baseStatus = super.getEnhancedStatus();
        
        return {
            ...baseStatus,
            logging: {
                enabled: this.isLoggingEnabled,
                initialized: this.dataLogger.isInitialized,
                startTime: this.loggingStartTime,
                features: {
                    engineeringUnits: true,
                    advancedAlarms: true,
                    hysteresis: true,
                    comprehensiveLogging: true,
                    dataRetention: true,
                    summaryGeneration: true
                }
            },
            alarms: {
                activeStates: this.alarmStates.size,
                stateTracking: true
            },
            engineeringUnits: {
                cacheSize: this.engineeringUnitsCache.size,
                supportedScaling: ['LINEAR', 'SQRT', 'POLYNOMIAL']
            }
        };
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

    /**
     * Enhanced disconnect with comprehensive cleanup and logging
     */
    async disconnect() {
        console.log('🔄 Disconnecting Enhanced S7 Client with Advanced Logging...');
        
        try {
            // Log shutdown event with comprehensive context
            if (this.dataLogger.isInitialized) {
                const uptime = this.loggingStartTime ? (new Date() - this.loggingStartTime) / 1000 : 0;
                
                await this.dataLogger.logEvent({
                    type: 'SYSTEM_SHUTDOWN',
                    category: 'INFO',
                    message: 'Enhanced S7 Client with Advanced Logging shutting down gracefully',
                    source: 'EnhancedS7ClientWithLogging',
                    sourceVersion: '2.0.0',
                    additionalData: {
                        uptime: uptime,
                        tagsProcessed: this.tagMetadata.size,
                        alarmsTracked: this.alarmStates.size,
                        shutdownTime: new Date().toISOString()
                    }
                });
            }

            // Flush any remaining data and generate final summaries
            await this.flushLoggingBuffers();
            
            if (this.dataLogger.isInitialized) {
                await this.dataLogger.generateHourlySummaries(1); // Final summary generation
            }
            
            // Shutdown data logger
            await this.dataLogger.shutdown();
            
            // Disconnect base client
            await super.disconnect();
            
            console.log('✅ Enhanced S7 Client with Advanced Logging disconnected successfully');

        } catch (error) {
            console.error('❌ Error during enhanced disconnect:', error);
        }
    }

    /**
     * Get data logger instance for advanced operations
     */
    getDataLogger() {
        return this.dataLogger;
    }
}

module.exports = EnhancedS7ClientWithLogging;