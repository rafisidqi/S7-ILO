const sql = require('mssql/msnodesqlv8');
const EventEmitter = require('events');

/**
 * Enhanced SQL Data Logger with Multi-PLC Support
 * Handles data logging with engineering units and PLCName support
 */
class SqlDataLogger extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Database configuration
            server: config.server || 'localhost\\SQLEXPRESS',
            database: config.database || 'PLCTags',
            
            // Table names
            dataTable: config.dataTable || 'DataHistory',
            alarmTable: config.alarmTable || 'AlarmHistory',
            eventTable: config.eventTable || 'EventHistory',
            summaryHourlyTable: config.summaryHourlyTable || 'DataSummaryHourly',
            summaryDailyTable: config.summaryDailyTable || 'DataSummaryDaily',
            
            // Logging settings
            enableDataLogging: config.enableDataLogging !== false,
            enableAlarmLogging: config.enableAlarmLogging !== false,
            enableEventLogging: config.enableEventLogging !== false,
            
            // Data retention
            dataRetentionDays: config.dataRetentionDays || 90,
            alarmRetentionDays: config.alarmRetentionDays || 180,
            eventRetentionDays: config.eventRetentionDays || 365,
            
            // Performance settings
            batchSize: config.batchSize || 100,
            flushInterval: config.flushInterval || 30000,
            
            // Connection options
            options: {
                encrypt: false,
                trustServerCertificate: true,
                ...config.options
            }
        };

        this.connectionPool = null;
        this.isInitialized = false;
        this.dataBuffer = [];
        this.flushTimer = null;
    }

    /**
     * Initialize the SQL Data Logger
     */
    async initialize() {
        try {
            console.log('Initializing Enhanced SQL Data Logger...');

            // Create connection pool
            this.connectionPool = new sql.ConnectionPool({
                server: this.config.server,
                database: this.config.database,
                ...this.config.options
            });

            // Connect to database
            await this.connectionPool.connect();
            console.log('Enhanced SQL Data Logger connected to database');

            // Verify required tables exist
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
     * Updated to include PLCName parameter
     */
    async logData(tagName, euValue, rawValue = null, logType = 'PERIODIC', quality = 192, plcName = null) {
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
            
            // Add PLCName parameter - this is the key fix
            if (plcName) {
                request.input('PLCName', sql.NVarChar, plcName);
            }

            const result = await request.execute('sp_LogDataWithEU');
            
            if (result.recordset && result.recordset[0] && result.recordset[0].Logged === 1) {
                this.emit('data_logged', {
                    tagName,
                    rawValue: parseFloat(rawValue) || parseFloat(euValue) || 0,
                    euValue: result.recordset[0].CalculatedEuValue || parseFloat(euValue) || 0,
                    quality,
                    logType,
                    plcName,
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
     * Updated to include PLCName for each data point
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
                        point.quality || 192,
                        point.plcName  // Include PLCName in batch logging
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
     * Updated to include PLCName parameter
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
            
            // Add PLCName parameter for alarm logging
            if (alarmData.plcName) {
                request.input('PLCName', sql.NVarChar, alarmData.plcName);
            }

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
     * Log system events using enhanced stored procedure
     * Updated to include PLCName parameter
     */
    async logEvent(eventData) {
        if (!this.config.enableEventLogging || !this.isInitialized) {
            return;
        }

        try {
            const request = this.connectionPool.request();
            request.input('EventType', sql.NVarChar, eventData.type || 'SYSTEM');
            request.input('EventCategory', sql.NVarChar, eventData.category || 'INFO');
            request.input('EventMessage', sql.NVarChar, eventData.message || '');
            request.input('TagName', sql.NVarChar, eventData.tagName || null);
            request.input('Username', sql.NVarChar, eventData.username || 'SYSTEM');
            request.input('Source', sql.NVarChar, eventData.source || 'SqlDataLogger');
            request.input('SourceVersion', sql.NVarChar, eventData.sourceVersion || '2.0.0');
            request.input('AdditionalData', sql.NVarChar, 
                eventData.additionalData ? JSON.stringify(eventData.additionalData) : null);
            
            // Add PLCName parameter for event logging
            if (eventData.plcName) {
                request.input('PLCName', sql.NVarChar, eventData.plcName);
            }

            const result = await request.execute('sp_LogEventWithEU');
            
            if (result.recordset && result.recordset[0] && result.recordset[0].Status === 'SUCCESS') {
                this.emit('event_logged', {
                    eventId: result.recordset[0].EventID,
                    ...eventData,
                    timestamp: new Date()
                });
            }

        } catch (error) {
            console.error('Error logging event:', error);
            this.emit('error', error);
        }
    }

    /**
     * Get historical data for a specific tag with optional PLC filtering
     */
    async getHistoricalData(tagName, startDate, endDate, limit = 1000, plcName = null) {
        try {
            const request = this.connectionPool.request();
            request.input('TagName', sql.NVarChar, tagName);
            request.input('StartDate', sql.DateTime, startDate);
            request.input('EndDate', sql.DateTime, endDate);
            request.input('Limit', sql.Int, limit);
            
            let query = `
                SELECT TOP (@Limit)
                    TagName,
                    RawValue,
                    EuValue,
                    Quality,
                    LogType,
                    Timestamp,
                    PLCName
                FROM ${this.config.dataTable}
                WHERE TagName = @TagName
                AND Timestamp BETWEEN @StartDate AND @EndDate
            `;
            
            // Add PLCName filter if specified
            if (plcName) {
                request.input('PLCName', sql.NVarChar, plcName);
                query += ' AND PLCName = @PLCName';
            }
            
            query += ' ORDER BY Timestamp DESC';

            const result = await request.query(query);
            return result.recordset;

        } catch (error) {
            console.error('Error getting historical data:', error);
            throw error;
        }
    }

    /**
     * Get alarm history with optional PLC filtering
     */
    async getAlarmHistory(startDate, endDate, limit = 100, plcName = null) {
        try {
            const request = this.connectionPool.request();
            request.input('StartDate', sql.DateTime, startDate);
            request.input('EndDate', sql.DateTime, endDate);
            request.input('Limit', sql.Int, limit);
            
            let query = `
                SELECT TOP (@Limit)
                    AlarmID,
                    TagName,
                    AlarmType,
                    AlarmState,
                    CurrentValue,
                    LimitValue,
                    AlarmMessage,
                    Timestamp,
                    AcknowledgeTime,
                    Username,
                    PLCName
                FROM ${this.config.alarmTable}
                WHERE Timestamp BETWEEN @StartDate AND @EndDate
            `;
            
            // Add PLCName filter if specified
            if (plcName) {
                request.input('PLCName', sql.NVarChar, plcName);
                query += ' AND PLCName = @PLCName';
            }
            
            query += ' ORDER BY Timestamp DESC';

            const result = await request.query(query);
            return result.recordset;

        } catch (error) {
            console.error('Error getting alarm history:', error);
            throw error;
        }
    }

    /**
     * Set up automatic cleanup job for old data
     */
    setupCleanupJob() {
        // Run cleanup every 24 hours
        setInterval(async () => {
            try {
                await this.cleanupOldData();
            } catch (error) {
                console.error('Error during automatic cleanup:', error);
            }
        }, 24 * 60 * 60 * 1000);

        console.log('Automatic data cleanup job scheduled');
    }

    /**
     * Clean up old data based on retention policies
     */
    async cleanupOldData() {
        try {
            const request = this.connectionPool.request();
            
            // Cleanup old data
            request.input('DataRetentionDays', sql.Int, this.config.dataRetentionDays);
            await request.query(`
                DELETE FROM ${this.config.dataTable}
                WHERE Timestamp < DATEADD(day, -@DataRetentionDays, GETDATE())
            `);

            // Cleanup old alarms
            request.input('AlarmRetentionDays', sql.Int, this.config.alarmRetentionDays);
            await request.query(`
                DELETE FROM ${this.config.alarmTable}
                WHERE Timestamp < DATEADD(day, -@AlarmRetentionDays, GETDATE())
            `);

            // Cleanup old events
            request.input('EventRetentionDays', sql.Int, this.config.eventRetentionDays);
            await request.query(`
                DELETE FROM ${this.config.eventTable}
                WHERE Timestamp < DATEADD(day, -@EventRetentionDays, GETDATE())
            `);

            console.log('Database cleanup completed successfully');
            this.emit('cleanup_completed');

        } catch (error) {
            console.error('Error during database cleanup:', error);
            this.emit('cleanup_error', error);
        }
    }

    /**
     * Get logging statistics
     */
    async getLoggingStatistics() {
        try {
            const request = this.connectionPool.request();
            
            const result = await request.query(`
                SELECT 
                    (SELECT COUNT(*) FROM ${this.config.dataTable}) as TotalDataRecords,
                    (SELECT COUNT(*) FROM ${this.config.alarmTable}) as TotalAlarmRecords,
                    (SELECT COUNT(*) FROM ${this.config.eventTable}) as TotalEventRecords,
                    (SELECT COUNT(*) FROM ${this.config.dataTable} WHERE Timestamp >= DATEADD(day, -1, GETDATE())) as DataRecordsLast24h,
                    (SELECT COUNT(*) FROM ${this.config.alarmTable} WHERE Timestamp >= DATEADD(day, -1, GETDATE())) as AlarmRecordsLast24h,
                    (SELECT COUNT(DISTINCT PLCName) FROM ${this.config.dataTable}) as ActivePLCs,
                    (SELECT COUNT(DISTINCT TagName) FROM ${this.config.dataTable}) as ActiveTags
            `);

            return result.recordset[0];

        } catch (error) {
            console.error('Error getting logging statistics:', error);
            throw error;
        }
    }

    /**
     * Disconnect from the database
     */
    async disconnect() {
        try {
            if (this.flushTimer) {
                clearInterval(this.flushTimer);
                this.flushTimer = null;
            }

            if (this.connectionPool) {
                await this.connectionPool.close();
                this.connectionPool = null;
            }

            this.isInitialized = false;
            console.log('Enhanced SQL Data Logger disconnected');
            this.emit('disconnected');

        } catch (error) {
            console.error('Error disconnecting Enhanced SQL Data Logger:', error);
        }
    }
}

module.exports = SqlDataLogger;