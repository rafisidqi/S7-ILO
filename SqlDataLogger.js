const { EventEmitter } = require('events');
const sql = require('mssql/msnodesqlv8');

/**
 * Enhanced SQL Data Logger - Works with the new enhanced database schema
 * Provides comprehensive logging with engineering units, advanced alarms, and performance optimization
 */
class SqlDataLogger extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Inherit connection from main SQL config
            connectionPool: null,
            
            // Enhanced logging tables (matching new schema)
            dataTable: 'DataHistory',
            alarmTable: 'AlarmHistory',
            eventTable: 'EventHistory',
            summaryHourlyTable: 'DataSummaryHourly',
            summaryDailyTable: 'DataSummaryDaily',
            loggingConfigTable: 'LoggingConfiguration',
            
            // Logging settings
            enableDataLogging: true,
            enableAlarmLogging: true,
            enableEventLogging: true,
            
            // Data logging options
            logInterval: 30000,          // Flush buffers every 30 seconds
            logOnChange: true,           // Log immediately when value changes
            changeThreshold: 0.01,       // Minimum change to trigger logging (for REAL values)
            maxBatchSize: 1000,          // Maximum records per batch insert
            
            // Data retention settings
            dataRetentionDays: 90,       // Keep data for 90 days
            alarmRetentionDays: 365,     // Keep alarms for 1 year
            eventRetentionDays: 30,      // Keep events for 30 days
            
            // Compression settings
            enableCompression: true,
            compressionRatio: 10,        // Keep 1 in 10 records for long-term storage
            compressionAfterDays: 7,     // Start compression after 7 days
            
            ...config
        };

        this.connectionPool = this.config.connectionPool;
        this.lastLoggedValues = new Map();
        this.logBuffer = [];
        this.alarmBuffer = [];
        this.eventBuffer = [];
        this.logTimer = null;
        this.isInitialized = false;
        
        this.startPeriodicLogging();
    }

    /**
     * Initialize the enhanced data logger
     */
    async initialize() {
        if (!this.connectionPool) {
            throw new Error('Connection pool not provided');
        }

        try {
            console.log('Initializing Enhanced SQL Data Logger...');
            
            // Verify tables exist (they should be created by db.sql)
            await this.verifyTables();
            
            // Set up cleanup job
            this.setupCleanupJob();
            
            this.isInitialized = true;
            console.log('Enhanced SQL Data Logger initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Enhanced SQL Data Logger:', error);
            throw error;
        }
    }

    /**
     * Verify that all required tables exist
     */
    async verifyTables() {
        try {
            const tables = [
                this.config.dataTable,
                this.config.alarmTable,
                this.config.eventTable,
                this.config.summaryHourlyTable,
                this.config.summaryDailyTable
            ];

            for (const tableName of tables) {
                const result = await this.connectionPool.request()
                    .input('tableName', sql.NVarChar, tableName)
                    .query(`
                        SELECT COUNT(*) as TableExists 
                        FROM INFORMATION_SCHEMA.TABLES 
                        WHERE TABLE_NAME = @tableName
                    `);

                if (result.recordset[0].TableExists === 0) {
                    throw new Error(`Required table ${tableName} does not exist. Please run the enhanced database setup script first.`);
                }
            }

            console.log('All required enhanced tables verified');

        } catch (error) {
            console.error('Error verifying tables:', error);
            throw error;
        }
    }

    /**
     * Log PLC data values with engineering units using enhanced stored procedure
     */
    async logData(tagName, euValue, rawValue = null, logType = 'PERIODIC', quality = 192) {
        if (!this.config.enableDataLogging || !this.isInitialized) {
            return;
        }

        try {
            // Use the enhanced stored procedure for logging
            const request = this.connectionPool.request();
            request.input('TagName', sql.NVarChar, tagName);
            request.input('RawValue', sql.Float, parseFloat(rawValue) || parseFloat(euValue) || 0);
            request.input('EuValue', sql.Float, parseFloat(euValue) || 0);
            request.input('Quality', sql.Int, quality);
            request.input('LogType', sql.NVarChar, logType);
            request.input('AutoCalculateEU', sql.Bit, rawValue !== null && euValue === null ? 1 : 0);

            const result = await request.execute('sp_LogDataWithEU');
            
            if (result.recordset && result.recordset[0] && result.recordset[0].Logged === 1) {
                this.emit('data_logged', {
                    tagName,
                    rawValue: parseFloat(rawValue) || parseFloat(euValue) || 0,
                    euValue: result.recordset[0].CalculatedEuValue || parseFloat(euValue) || 0,
                    quality,
                    logType,
                    timestamp: new Date()
                });
            }

        } catch (error) {
            console.error('Error logging data with EU:', error);
            this.emit('error', error);
        }
    }

    /**
     * Log multiple data points at once with enhanced support
     */
    async logDataBatch(dataPoints) {
        if (!this.config.enableDataLogging || !this.isInitialized) {
            return;
        }

        try {
            const promises = [];
            
            for (const point of dataPoints) {
                promises.push(
                    this.logData(
                        point.tagName,
                        point.euValue || point.value,
                        point.rawValue,
                        point.logType || 'BATCH',
                        point.quality || 192
                    )
                );
            }

            await Promise.all(promises);
            
        } catch (error) {
            console.error('Error logging data batch:', error);
            this.emit('error', error);
        }
    }

    /**
     * Log alarm events using enhanced stored procedure
     */
    async logAlarm(alarmData) {
        if (!this.config.enableAlarmLogging || !this.isInitialized) {
            return;
        }

        try {
            // Use the enhanced stored procedure for alarm logging
            const request = this.connectionPool.request();
            request.input('TagName', sql.NVarChar, alarmData.tagName);
            request.input('AlarmType', sql.NVarChar, alarmData.type || 'UNKNOWN');
            request.input('AlarmState', sql.NVarChar, alarmData.state || 'ACTIVE');
            request.input('CurrentValue', sql.Float, parseFloat(alarmData.value) || 0);
            request.input('LimitValue', sql.Float, parseFloat(alarmData.limit) || null);
            request.input('AlarmMessage', sql.NVarChar, alarmData.message || `${alarmData.type} alarm on ${alarmData.tagName}`);
            request.input('Username', sql.NVarChar, alarmData.username || 'SYSTEM');
            request.input('SystemContext', sql.NVarChar, alarmData.systemContext || null);

            const result = await request.execute('sp_LogAlarmWithEU');
            
            if (result.recordset && result.recordset[0] && result.recordset[0].Status === 'SUCCESS') {
                this.emit('alarm_logged', {
                    alarmId: result.recordset[0].AlarmID,
                    ...alarmData,
                    timestamp: new Date()
                });
            }

        } catch (error) {
            console.error('Error logging alarm with EU:', error);
            this.emit('error', error);
        }
    }

    /**
     * Log system events with enhanced context
     */
    async logEvent(eventData) {
        if (!this.config.enableEventLogging || !this.isInitialized) {
            return;
        }

        try {
            const request = this.connectionPool.request();
            request.input('EventType', sql.NVarChar, eventData.type || 'GENERAL');
            request.input('EventCategory', sql.NVarChar, eventData.category || 'INFO');
            request.input('EventMessage', sql.NVarChar, eventData.message);
            request.input('TagName', sql.NVarChar, eventData.tagName || null);
            request.input('OldValue', sql.Float, parseFloat(eventData.oldValue) || null);
            request.input('NewValue', sql.Float, parseFloat(eventData.newValue) || null);
            request.input('OldRawValue', sql.Float, parseFloat(eventData.oldRawValue) || null);
            request.input('NewRawValue', sql.Float, parseFloat(eventData.newRawValue) || null);
            request.input('Username', sql.NVarChar, eventData.username || 'SYSTEM');
            request.input('UserRole', sql.NVarChar, eventData.userRole || null);
            request.input('ClientIP', sql.NVarChar, eventData.clientIP || null);
            request.input('Source', sql.NVarChar, eventData.source || 'S7Client');
            request.input('SourceVersion', sql.NVarChar, eventData.sourceVersion || null);
            request.input('SessionID', sql.NVarChar, eventData.sessionId || null);
            request.input('RequestID', sql.NVarChar, eventData.requestId || null);
            request.input('AdditionalData', sql.NVarChar, eventData.additionalData ? JSON.stringify(eventData.additionalData) : null);

            await request.query(`
                INSERT INTO ${this.config.eventTable} (
                    EventType, EventCategory, EventMessage, TagName,
                    OldValue, NewValue, OldRawValue, NewRawValue,
                    Username, UserRole, ClientIP, Source, SourceVersion,
                    SessionID, RequestID, AdditionalData, Timestamp
                ) VALUES (
                    @EventType, @EventCategory, @EventMessage, @TagName,
                    @OldValue, @NewValue, @OldRawValue, @NewRawValue,
                    @Username, @UserRole, @ClientIP, @Source, @SourceVersion,
                    @SessionID, @RequestID, @AdditionalData, GETDATE()
                )
            `);

            this.emit('event_logged', {
                ...eventData,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Error logging event:', error);
            this.emit('error', error);
        }
    }

    /**
     * Generate hourly summaries using enhanced stored procedure
     */
    async generateHourlySummaries(hoursBack = 25, tagName = null) {
        try {
            const request = this.connectionPool.request();
            request.input('HoursBack', sql.Int, hoursBack);
            if (tagName) {
                request.input('TagName', sql.NVarChar, tagName);
            }

            const result = await request.execute('sp_GenerateHourlySummaries');
            
            if (result.recordset && result.recordset[0]) {
                console.log(`Generated ${result.recordset[0].SummariesCreated} hourly summaries`);
                this.emit('summaries_generated', {
                    type: 'hourly',
                    count: result.recordset[0].SummariesCreated,
                    timestamp: new Date()
                });
            }

        } catch (error) {
            console.error('Error generating hourly summaries:', error);
            this.emit('error', error);
        }
    }

    /**
     * Clean up old data using enhanced stored procedure
     */
    async cleanupOldData(options = {}) {
        try {
            const request = this.connectionPool.request();
            request.input('DataRetentionDays', sql.Int, options.dataRetentionDays || this.config.dataRetentionDays);
            request.input('AlarmRetentionDays', sql.Int, options.alarmRetentionDays || this.config.alarmRetentionDays);
            request.input('EventRetentionDays', sql.Int, options.eventRetentionDays || this.config.eventRetentionDays);
            request.input('SummaryRetentionDays', sql.Int, options.summaryRetentionDays || 1095);
            request.input('DryRun', sql.Bit, options.dryRun || 0);

            const result = await request.execute('sp_CleanupOldData');
            
            if (result.recordset && result.recordset[0]) {
                const cleanupInfo = result.recordset[0];
                console.log(`Cleanup completed: ${JSON.stringify(cleanupInfo)}`);
                
                this.emit('cleanup_completed', {
                    ...cleanupInfo,
                    timestamp: new Date()
                });
            }

        } catch (error) {
            console.error('Error cleaning up old data:', error);
            this.emit('error', error);
        }
    }

    /**
     * Get logged data for a specific tag and time range with EU values
     */
    async getLoggedData(tagName, startDate, endDate, limit = 1000) {
        try {
            const result = await this.connectionPool.request()
                .input('tagName', sql.NVarChar, tagName)
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit)
                        dh.TagName,
                        dh.RawValue,
                        dh.EuValue,
                        dh.Quality,
                        dh.Timestamp,
                        dh.LogType,
                        t.EngineeringUnits,
                        t.DecimalPlaces,
                        CASE 
                            WHEN dh.Quality = 192 THEN 'Good'
                            WHEN dh.Quality >= 128 THEN 'Uncertain' 
                            ELSE 'Bad'
                        END as QualityText,
                        CASE 
                            WHEN t.DecimalPlaces IS NOT NULL AND dh.EuValue IS NOT NULL 
                            THEN FORMAT(dh.EuValue, 'N' + CAST(t.DecimalPlaces as nvarchar(2)))
                            ELSE CAST(dh.EuValue as nvarchar(50))
                        END + ' ' + ISNULL(t.EngineeringUnits, '') as FormattedValue
                    FROM ${this.config.dataTable} dh
                    LEFT JOIN Tags t ON dh.TagName = t.TagName
                    WHERE dh.TagName = @tagName
                      AND dh.Timestamp BETWEEN @startDate AND @endDate
                    ORDER BY dh.Timestamp DESC
                `);

            return result.recordset;

        } catch (error) {
            console.error('Error getting logged data:', error);
            throw error;
        }
    }

    /**
     * Get alarm history with enhanced information
     */
    async getAlarmHistory(tagName = null, limit = 100) {
        try {
            let query = `
                SELECT TOP (@limit)
                    ah.AlarmID,
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
                    ah.Timestamp,
                    t.Description,
                    t.EngineeringUnits,
                    t.GroupName,
                    CASE 
                        WHEN t.DecimalPlaces IS NOT NULL 
                        THEN FORMAT(ah.CurrentValue, 'N' + CAST(t.DecimalPlaces as nvarchar(2)))
                        ELSE CAST(ah.CurrentValue as nvarchar(50))
                    END + ' ' + ISNULL(t.EngineeringUnits, '') as FormattedCurrentValue
                FROM ${this.config.alarmTable} ah
                LEFT JOIN Tags t ON ah.TagName = t.TagName
            `;

            const request = this.connectionPool.request().input('limit', sql.Int, limit);

            if (tagName) {
                query += ' WHERE ah.TagName = @tagName';
                request.input('tagName', sql.NVarChar, tagName);
            }

            query += ' ORDER BY ah.Timestamp DESC';

            const result = await request.query(query);
            return result.recordset;

        } catch (error) {
            console.error('Error getting alarm history:', error);
            throw error;
        }
    }

    /**
     * Get system statistics using enhanced stored procedure
     */
    async getLoggingStats() {
        try {
            const result = await this.connectionPool.request().execute('sp_GetSystemStatistics');
            
            return {
                systemOverview: result.recordsets[0] ? result.recordsets[0][0] : {},
                dataLogging: result.recordsets[1] ? result.recordsets[1][0] : {},
                alarms: result.recordsets[2] ? result.recordsets[2][0] : {},
                topActiveTags: result.recordsets[3] || [],
                topAlarmedTags: result.recordsets[4] || [],
                recentEvents: result.recordsets[5] || [],
                databaseSize: result.recordsets[6] || [],
                buffers: {
                    dataBuffer: this.logBuffer.length,
                    alarmBuffer: this.alarmBuffer.length,
                    eventBuffer: this.eventBuffer.length
                }
            };

        } catch (error) {
            console.error('Error getting logging stats:', error);
            throw error;
        }
    }

    /**
     * Acknowledge alarm in database
     */
    async acknowledgeAlarm(alarmId, username = 'SYSTEM', comments = null) {
        try {
            const result = await this.connectionPool.request()
                .input('alarmId', sql.BigInt, alarmId)
                .input('username', sql.NVarChar, username)
                .input('acknowledgedAt', sql.DateTime2, new Date())
                .input('comments', sql.NVarChar, comments)
                .query(`
                    UPDATE ${this.config.alarmTable}
                    SET AlarmState = CASE 
                            WHEN AlarmState = 'ACTIVE' THEN 'ACKNOWLEDGED' 
                            ELSE AlarmState 
                        END,
                        AcknowledgedBy = @username,
                        AcknowledgedAt = @acknowledgedAt,
                        OperatorComments = ISNULL(OperatorComments + '; ', '') + ISNULL(@comments, 'Acknowledged via API')
                    WHERE AlarmID = @alarmId
                      AND AlarmState IN ('ACTIVE')
                `);

            if (result.rowsAffected[0] > 0) {
                // Log acknowledgment event
                await this.logEvent({
                    type: 'ALARM_ACKNOWLEDGED',
                    category: 'INFO',
                    message: `Alarm ${alarmId} acknowledged by ${username}`,
                    username: username,
                    source: 'AlarmSystem',
                    additionalData: { alarmId, comments }
                });

                return true;
            }

            return false;

        } catch (error) {
            console.error('Error acknowledging alarm:', error);
            throw error;
        }
    }

    /**
     * Start periodic logging timer
     */
    startPeriodicLogging() {
        if (this.logTimer) {
            clearInterval(this.logTimer);
        }

        if (this.config.logInterval > 0) {
            this.logTimer = setInterval(async () => {
                try {
                    // Generate summaries periodically
                    await this.generateHourlySummaries(2); // Process last 2 hours
                } catch (error) {
                    console.error('Error in periodic logging:', error);
                }
            }, this.config.logInterval);
        }
    }

    /**
     * Stop periodic logging
     */
    stopPeriodicLogging() {
        if (this.logTimer) {
            clearInterval(this.logTimer);
            this.logTimer = null;
        }
    }

    /**
     * Setup data cleanup job
     */
    setupCleanupJob() {
        // Run cleanup every 24 hours
        setInterval(async () => {
            try {
                await this.cleanupOldData();
            } catch (error) {
                console.error('Error in cleanup job:', error);
            }
        }, 24 * 60 * 60 * 1000);
    }

    /**
     * Force flush all logging buffers (enhanced version)
     */
    async flushAllBuffers() {
        console.log('Flushing all enhanced logging buffers...');
        // For the enhanced version, most logging happens immediately via stored procedures
        // This method is kept for compatibility
        this.emit('buffers_flushed', {
            timestamp: new Date(),
            note: 'Enhanced logging uses immediate stored procedure calls'
        });
    }

    /**
     * Export data to CSV format with enhanced features
     */
    async exportDataToCSV(tagNames, startDate, endDate) {
        try {
            const tagList = Array.isArray(tagNames) ? tagNames.join("','") : tagNames;
            
            const result = await this.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .query(`
                    SELECT 
                        dh.TagName,
                        dh.EuValue as Value,
                        dh.RawValue,
                        dh.Quality,
                        dh.Timestamp,
                        dh.LogType,
                        t.EngineeringUnits,
                        t.Description,
                        t.GroupName,
                        CASE 
                            WHEN dh.Quality = 192 THEN 'Good'
                            WHEN dh.Quality >= 128 THEN 'Uncertain' 
                            ELSE 'Bad'
                        END as QualityText
                    FROM ${this.config.dataTable} dh
                    LEFT JOIN Tags t ON dh.TagName = t.TagName
                    WHERE dh.TagName IN ('${tagList}')
                      AND dh.Timestamp BETWEEN @startDate AND @endDate
                    ORDER BY dh.TagName, dh.Timestamp
                `);

            // Convert to CSV format with enhanced headers
            const headers = [
                'TagName', 'Value', 'RawValue', 'EngineeringUnits', 'Quality', 
                'QualityText', 'Timestamp', 'LogType', 'Description', 'GroupName'
            ];
            const csvData = [headers.join(',')];
            
            result.recordset.forEach(row => {
                const csvRow = [
                    row.TagName,
                    row.Value || '',
                    row.RawValue || '',
                    row.EngineeringUnits || '',
                    row.Quality || '',
                    row.QualityText || '',
                    row.Timestamp ? row.Timestamp.toISOString() : '',
                    row.LogType || '',
                    row.Description || '',
                    row.GroupName || ''
                ];
                csvData.push(csvRow.map(field => `"${field}"`).join(','));
            });

            return csvData.join('\n');

        } catch (error) {
            console.error('Error exporting data to CSV:', error);
            throw error;
        }
    }

    /**
     * Get data availability for tags
     */
    async getTagAvailability(tagNames, startDate, endDate) {
        try {
            const tagList = Array.isArray(tagNames) ? tagNames.join("','") : tagNames;
            
            const result = await this.connectionPool.request()
                .input('startDate', sql.DateTime2, startDate)
                .input('endDate', sql.DateTime2, endDate)
                .query(`
                    SELECT 
                        t.TagName,
                        t.Description,
                        t.EngineeringUnits,
                        dbo.fn_CalculateTagAvailability(t.TagName, @startDate, @endDate) as AvailabilityPercent,
                        COUNT(dh.LogID) as TotalRecords,
                        COUNT(CASE WHEN dh.Quality = 192 THEN 1 END) as GoodQualityRecords,
                        MIN(dh.Timestamp) as FirstRecord,
                        MAX(dh.Timestamp) as LastRecord
                    FROM Tags t
                    LEFT JOIN ${this.config.dataTable} dh ON t.TagName = dh.TagName 
                        AND dh.Timestamp BETWEEN @startDate AND @endDate
                    WHERE t.TagName IN ('${tagList}')
                      AND t.Enabled = 1
                    GROUP BY t.TagName, t.Description, t.EngineeringUnits
                    ORDER BY t.TagName
                `);

            return result.recordset;

        } catch (error) {
            console.error('Error getting tag availability:', error);
            throw error;
        }
    }

    /**
     * Shutdown the enhanced data logger
     */
    async shutdown() {
        console.log('Shutting down Enhanced SQL Data Logger...');
        
        this.stopPeriodicLogging();
        
        // Log shutdown event
        if (this.isInitialized) {
            await this.logEvent({
                type: 'LOGGER_SHUTDOWN',
                category: 'INFO',
                message: 'Enhanced SQL Data Logger shutting down',
                source: 'SqlDataLogger'
            });
        }
        
        console.log('Enhanced SQL Data Logger shutdown complete');
        this.emit('shutdown');
    }
}

module.exports = SqlDataLogger;