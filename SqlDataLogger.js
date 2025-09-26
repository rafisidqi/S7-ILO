/**
     * Log PLC data values with engineering units
     */
    async logData(tagName, euValue, rawValue = null, logType = 'PERIODIC', quality = 192) {
        if (!this.config.const { EventEmitter } = require('events');
const sql = require('mssql');

/**
 * SQL Data Logger - Logs PLC data to SQL Server database
 * Provides historical data storage, trend analysis, and data archival
 */
class SqlDataLogger extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Inherit connection from main SQL config
            connectionPool: null,
            
            // Logging tables
            dataTable: 'DataHistory',
            alarmTable: 'AlarmHistory',
            eventTable: 'EventHistory',
            
            // Logging settings
            enableDataLogging: true,
            enableAlarmLogging: true,
            enableEventLogging: true,
            
            // Data logging options
            logInterval: 60000,          // Log data every minute
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
     * Initialize the data logger (create tables if needed)
     */
    async initialize() {
        if (!this.connectionPool) {
            throw new Error('Connection pool not provided');
        }

        try {
            console.log('Initializing SQL Data Logger...');
            
            // Create tables if they don't exist
            await this.createLogTables();
            
            // Set up cleanup job
            this.setupCleanupJob();
            
            this.isInitialized = true;
            console.log('SQL Data Logger initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize SQL Data Logger:', error);
            throw error;
        }
    }

    /**
     * Create logging tables if they don't exist
     */
    async createLogTables() {
        try {
            // Create DataHistory table
            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${this.config.dataTable}' AND xtype='U')
                CREATE TABLE ${this.config.dataTable} (
                    LogID bigint IDENTITY(1,1) PRIMARY KEY,
                    TagName nvarchar(100) NOT NULL,
                    TagValue float NOT NULL,
                    RawValue float,
                    Quality int DEFAULT 192, -- 192 = Good quality
                    Timestamp datetime2 DEFAULT GETDATE(),
                    LogType nvarchar(20) DEFAULT 'PERIODIC', -- PERIODIC, CHANGE, MANUAL
                    
                    -- Indexes for better performance
                    INDEX IX_DataHistory_TagName_Timestamp (TagName, Timestamp),
                    INDEX IX_DataHistory_Timestamp (Timestamp)
                )
            `);

            // Create AlarmHistory table
            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${this.config.alarmTable}' AND xtype='U')
                CREATE TABLE ${this.config.alarmTable} (
                    AlarmID bigint IDENTITY(1,1) PRIMARY KEY,
                    TagName nvarchar(100) NOT NULL,
                    AlarmType nvarchar(20) NOT NULL, -- HIGH, LOW, DEVIATION, etc.
                    AlarmState nvarchar(20) NOT NULL, -- ACTIVE, CLEARED, ACKNOWLEDGED
                    AlarmValue float NOT NULL,
                    LimitValue float,
                    AlarmMessage nvarchar(500),
                    Timestamp datetime2 DEFAULT GETDATE(),
                    AcknowledgedBy nvarchar(100),
                    AcknowledgedAt datetime2,
                    ClearedAt datetime2,
                    
                    INDEX IX_AlarmHistory_TagName_Timestamp (TagName, Timestamp),
                    INDEX IX_AlarmHistory_AlarmState (AlarmState),
                    INDEX IX_AlarmHistory_Timestamp (Timestamp)
                )
            `);

            // Create EventHistory table
            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${this.config.eventTable}' AND xtype='U')
                CREATE TABLE ${this.config.eventTable} (
                    EventID bigint IDENTITY(1,1) PRIMARY KEY,
                    EventType nvarchar(50) NOT NULL, -- CONNECTION, TAG_CHANGE, WRITE, ERROR, etc.
                    EventCategory nvarchar(20) NOT NULL, -- INFO, WARNING, ERROR, CRITICAL
                    EventMessage nvarchar(1000) NOT NULL,
                    TagName nvarchar(100),
                    OldValue float,
                    NewValue float,
                    Username nvarchar(100),
                    Source nvarchar(100) DEFAULT 'S7Client',
                    Timestamp datetime2 DEFAULT GETDATE(),
                    
                    INDEX IX_EventHistory_EventType_Timestamp (EventType, Timestamp),
                    INDEX IX_EventHistory_EventCategory (EventCategory),
                    INDEX IX_EventHistory_Timestamp (Timestamp)
                )
            `);

            // Create summary tables for better performance
            await this.connectionPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryHourly' AND xtype='U')
                CREATE TABLE DataSummaryHourly (
                    SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
                    TagName nvarchar(100) NOT NULL,
                    HourTimestamp datetime2 NOT NULL,
                    MinValue float NOT NULL,
                    MaxValue float NOT NULL,
                    AvgValue float NOT NULL,
                    LastValue float NOT NULL,
                    SampleCount int NOT NULL DEFAULT 0,
                    CreatedAt datetime2 DEFAULT GETDATE(),
                    
                    UNIQUE(TagName, HourTimestamp),
                    INDEX IX_DataSummaryHourly_TagName_Hour (TagName, HourTimestamp)
                )
            `);

            console.log('Data logging tables created/verified successfully');

        } catch (error) {
            console.error('Error creating log tables:', error);
            throw error;
        }
    }

    /**
     * Log PLC data values
     */
    async logData(tagName, tagValue, rawValue = null, logType = 'PERIODIC', quality = 192) {
        if (!this.config.enableDataLogging || !this.isInitialized) {
            return;
        }

        try {
            // Check if we should log this value
            const shouldLog = this.shouldLogValue(tagName, tagValue, logType);
            
            if (shouldLog) {
                const logEntry = {
                    tagName,
                    tagValue: parseFloat(tagValue) || 0,
                    rawValue: parseFloat(rawValue) || null,
                    quality,
                    logType,
                    timestamp: new Date()
                };

                // Add to buffer for batch processing
                this.logBuffer.push(logEntry);

                // Update last logged value
                this.lastLoggedValues.set(tagName, {
                    value: tagValue,
                    timestamp: logEntry.timestamp
                });

                // Process buffer if it's getting full
                if (this.logBuffer.length >= this.config.maxBatchSize) {
                    await this.flushLogBuffer();
                }

                this.emit('data_logged', logEntry);
            }

        } catch (error) {
            console.error('Error logging data:', error);
            this.emit('error', error);
        }
    }

    /**
     * Log multiple data points at once
     */
    async logDataBatch(dataPoints) {
        if (!this.config.enableDataLogging || !this.isInitialized) {
            return;
        }

        try {
            for (const point of dataPoints) {
                await this.logData(
                    point.tagName,
                    point.value,
                    point.rawValue,
                    point.logType || 'BATCH',
                    point.quality || 192
                );
            }

        } catch (error) {
            console.error('Error logging data batch:', error);
            this.emit('error', error);
        }
    }

    /**
     * Log alarm events
     */
    async logAlarm(alarmData) {
        if (!this.config.enableAlarmLogging || !this.isInitialized) {
            return;
        }

        try {
            const alarmEntry = {
                tagName: alarmData.tagName,
                alarmType: alarmData.type || 'UNKNOWN',
                alarmState: alarmData.state || 'ACTIVE',
                alarmValue: parseFloat(alarmData.value) || 0,
                limitValue: parseFloat(alarmData.limit) || null,
                alarmMessage: alarmData.message || `${alarmData.type} alarm on ${alarmData.tagName}`,
                timestamp: new Date()
            };

            this.alarmBuffer.push(alarmEntry);

            // Process alarm buffer immediately for critical alarms
            if (alarmData.critical || this.alarmBuffer.length >= 100) {
                await this.flushAlarmBuffer();
            }

            this.emit('alarm_logged', alarmEntry);

        } catch (error) {
            console.error('Error logging alarm:', error);
            this.emit('error', error);
        }
    }

    /**
     * Log system events
     */
    async logEvent(eventData) {
        if (!this.config.enableEventLogging || !this.isInitialized) {
            return;
        }

        try {
            const eventEntry = {
                eventType: eventData.type || 'GENERAL',
                eventCategory: eventData.category || 'INFO',
                eventMessage: eventData.message,
                tagName: eventData.tagName || null,
                oldValue: parseFloat(eventData.oldValue) || null,
                newValue: parseFloat(eventData.newValue) || null,
                username: eventData.username || 'SYSTEM',
                source: eventData.source || 'S7Client',
                timestamp: new Date()
            };

            this.eventBuffer.push(eventEntry);

            // Process event buffer
            if (this.eventBuffer.length >= 200) {
                await this.flushEventBuffer();
            }

            this.emit('event_logged', eventEntry);

        } catch (error) {
            console.error('Error logging event:', error);
            this.emit('error', error);
        }
    }

    /**
     * Check if a value should be logged
     */
    shouldLogValue(tagName, value, logType) {
        if (logType === 'MANUAL' || logType === 'ALARM') {
            return true;
        }

        if (!this.config.logOnChange) {
            return true;
        }

        const lastLogged = this.lastLoggedValues.get(tagName);
        if (!lastLogged) {
            return true; // First time logging this tag
        }

        // Check if value changed significantly
        const numValue = parseFloat(value);
        const lastValue = parseFloat(lastLogged.value);
        
        if (isNaN(numValue) || isNaN(lastValue)) {
            return value !== lastLogged.value; // String comparison for non-numeric values
        }

        const change = Math.abs(numValue - lastValue);
        return change >= this.config.changeThreshold;
    }

    /**
     * Flush data log buffer to database
     */
    async flushLogBuffer() {
        if (this.logBuffer.length === 0) {
            return;
        }

        try {
            const table = new sql.Table(this.config.dataTable);
            table.create = false;

            table.columns.add('TagName', sql.NVarChar(100), { nullable: false });
            table.columns.add('TagValue', sql.Float, { nullable: false });
            table.columns.add('RawValue', sql.Float, { nullable: true });
            table.columns.add('Quality', sql.Int, { nullable: false });
            table.columns.add('Timestamp', sql.DateTime2, { nullable: false });
            table.columns.add('LogType', sql.NVarChar(20), { nullable: false });

            // Add rows to table
            this.logBuffer.forEach(entry => {
                table.rows.add(
                    entry.tagName,
                    entry.tagValue,
                    entry.rawValue,
                    entry.quality,
                    entry.timestamp,
                    entry.logType
                );
            });

            // Bulk insert
            const request = this.connectionPool.request();
            await request.bulk(table);

            console.log(`Logged ${this.logBuffer.length} data points to database`);
            this.emit('buffer_flushed', { type: 'data', count: this.logBuffer.length });

            // Clear buffer
            this.logBuffer = [];

        } catch (error) {
            console.error('Error flushing log buffer:', error);
            this.emit('error', error);
        }
    }

    /**
     * Flush alarm buffer to database
     */
    async flushAlarmBuffer() {
        if (this.alarmBuffer.length === 0) {
            return;
        }

        try {
            const table = new sql.Table(this.config.alarmTable);
            table.create = false;

            table.columns.add('TagName', sql.NVarChar(100), { nullable: false });
            table.columns.add('AlarmType', sql.NVarChar(20), { nullable: false });
            table.columns.add('AlarmState', sql.NVarChar(20), { nullable: false });
            table.columns.add('AlarmValue', sql.Float, { nullable: false });
            table.columns.add('LimitValue', sql.Float, { nullable: true });
            table.columns.add('AlarmMessage', sql.NVarChar(500), { nullable: true });
            table.columns.add('Timestamp', sql.DateTime2, { nullable: false });

            // Add rows to table
            this.alarmBuffer.forEach(entry => {
                table.rows.add(
                    entry.tagName,
                    entry.alarmType,
                    entry.alarmState,
                    entry.alarmValue,
                    entry.limitValue,
                    entry.alarmMessage,
                    entry.timestamp
                );
            });

            // Bulk insert
            const request = this.connectionPool.request();
            await request.bulk(table);

            console.log(`Logged ${this.alarmBuffer.length} alarms to database`);
            this.emit('buffer_flushed', { type: 'alarm', count: this.alarmBuffer.length });

            // Clear buffer
            this.alarmBuffer = [];

        } catch (error) {
            console.error('Error flushing alarm buffer:', error);
            this.emit('error', error);
        }
    }

    /**
     * Flush event buffer to database
     */
    async flushEventBuffer() {
        if (this.eventBuffer.length === 0) {
            return;
        }

        try {
            const table = new sql.Table(this.config.eventTable);
            table.create = false;

            table.columns.add('EventType', sql.NVarChar(50), { nullable: false });
            table.columns.add('EventCategory', sql.NVarChar(20), { nullable: false });
            table.columns.add('EventMessage', sql.NVarChar(1000), { nullable: false });
            table.columns.add('TagName', sql.NVarChar(100), { nullable: true });
            table.columns.add('OldValue', sql.Float, { nullable: true });
            table.columns.add('NewValue', sql.Float, { nullable: true });
            table.columns.add('Username', sql.NVarChar(100), { nullable: true });
            table.columns.add('Source', sql.NVarChar(100), { nullable: false });
            table.columns.add('Timestamp', sql.DateTime2, { nullable: false });

            // Add rows to table
            this.eventBuffer.forEach(entry => {
                table.rows.add(
                    entry.eventType,
                    entry.eventCategory,
                    entry.eventMessage,
                    entry.tagName,
                    entry.oldValue,
                    entry.newValue,
                    entry.username,
                    entry.source,
                    entry.timestamp
                );
            });

            // Bulk insert
            const request = this.connectionPool.request();
            await request.bulk(table);

            console.log(`Logged ${this.eventBuffer.length} events to database`);
            this.emit('buffer_flushed', { type: 'event', count: this.eventBuffer.length });

            // Clear buffer
            this.eventBuffer = [];

        } catch (error) {
            console.error('Error flushing event buffer:', error);
            this.emit('error', error);
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
                    await this.flushLogBuffer();
                    await this.flushAlarmBuffer();
                    await this.flushEventBuffer();
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
     * Clean up old data based on retention settings
     */
    async cleanupOldData() {
        try {
            console.log('Starting data cleanup...');
            
            const now = new Date();
            
            // Clean up old data
            if (this.config.dataRetentionDays > 0) {
                const dataRetentionDate = new Date(now.getTime() - (this.config.dataRetentionDays * 24 * 60 * 60 * 1000));
                
                const result = await this.connectionPool.request()
                    .input('retentionDate', sql.DateTime2, dataRetentionDate)
                    .query(`DELETE FROM ${this.config.dataTable} WHERE Timestamp < @retentionDate`);
                
                if (result.rowsAffected[0] > 0) {
                    console.log(`Cleaned up ${result.rowsAffected[0]} old data records`);
                }
            }

            // Clean up old alarms
            if (this.config.alarmRetentionDays > 0) {
                const alarmRetentionDate = new Date(now.getTime() - (this.config.alarmRetentionDays * 24 * 60 * 60 * 1000));
                
                const result = await this.connectionPool.request()
                    .input('retentionDate', sql.DateTime2, alarmRetentionDate)
                    .query(`DELETE FROM ${this.config.alarmTable} WHERE Timestamp < @retentionDate`);
                
                if (result.rowsAffected[0] > 0) {
                    console.log(`Cleaned up ${result.rowsAffected[0]} old alarm records`);
                }
            }

            // Clean up old events
            if (this.config.eventRetentionDays > 0) {
                const eventRetentionDate = new Date(now.getTime() - (this.config.eventRetentionDays * 24 * 60 * 60 * 1000));
                
                const result = await this.connectionPool.request()
                    .input('retentionDate', sql.DateTime2, eventRetentionDate)
                    .query(`DELETE FROM ${this.config.eventTable} WHERE Timestamp < @retentionDate`);
                
                if (result.rowsAffected[0] > 0) {
                    console.log(`Cleaned up ${result.rowsAffected[0]} old event records`);
                }
            }

            this.emit('cleanup_completed', { timestamp: now });

        } catch (error) {
            console.error('Error cleaning up old data:', error);
            this.emit('error', error);
        }
    }

    /**
     * Generate hourly summaries for better performance
     */
    async generateHourlySummaries() {
        try {
            await this.connectionPool.request().query(`
                INSERT INTO DataSummaryHourly (TagName, HourTimestamp, MinValue, MaxValue, AvgValue, LastValue, SampleCount)
                SELECT 
                    TagName,
                    DATEADD(hour, DATEDIFF(hour, 0, Timestamp), 0) as HourTimestamp,
                    MIN(TagValue) as MinValue,
                    MAX(TagValue) as MaxValue,
                    AVG(TagValue) as AvgValue,
                    (SELECT TOP 1 TagValue FROM ${this.config.dataTable} d2 
                     WHERE d2.TagName = d1.TagName 
                     AND DATEDIFF(hour, d2.Timestamp, DATEADD(hour, DATEDIFF(hour, 0, d1.Timestamp), 0)) = 0
                     ORDER BY d2.Timestamp DESC) as LastValue,
                    COUNT(*) as SampleCount
                FROM ${this.config.dataTable} d1
                WHERE Timestamp >= DATEADD(hour, -25, GETDATE())
                  AND NOT EXISTS (SELECT 1 FROM DataSummaryHourly s 
                                 WHERE s.TagName = d1.TagName 
                                 AND s.HourTimestamp = DATEADD(hour, DATEDIFF(hour, 0, d1.Timestamp), 0))
                GROUP BY TagName, DATEADD(hour, DATEDIFF(hour, 0, Timestamp), 0)
            `);

            console.log('Hourly summaries generated successfully');

        } catch (error) {
            console.error('Error generating hourly summaries:', error);
        }
    }

    /**
     * Get logged data for a specific tag and time range
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
                        TagName,
                        TagValue,
                        RawValue,
                        Quality,
                        Timestamp,
                        LogType
                    FROM ${this.config.dataTable}
                    WHERE TagName = @tagName
                      AND Timestamp BETWEEN @startDate AND @endDate
                    ORDER BY Timestamp DESC
                `);

            return result.recordset;

        } catch (error) {
            console.error('Error getting logged data:', error);
            throw error;
        }
    }

    /**
     * Get alarm history
     */
    async getAlarmHistory(tagName = null, limit = 100) {
        try {
            let query = `
                SELECT TOP (@limit)
                    TagName,
                    AlarmType,
                    AlarmState,
                    AlarmValue,
                    LimitValue,
                    AlarmMessage,
                    Timestamp,
                    AcknowledgedBy,
                    AcknowledgedAt,
                    ClearedAt
                FROM ${this.config.alarmTable}
            `;

            const request = this.connectionPool.request().input('limit', sql.Int, limit);

            if (tagName) {
                query += ' WHERE TagName = @tagName';
                request.input('tagName', sql.NVarChar, tagName);
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
     * Flush all buffers immediately
     */
    async flushAllBuffers() {
        await Promise.all([
            this.flushLogBuffer(),
            this.flushAlarmBuffer(),
            this.flushEventBuffer()
        ]);
    }

    /**
     * Get logging statistics
     */
    async getLoggingStats() {
        try {
            const stats = {};

            // Data statistics
            const dataStats = await this.connectionPool.request().query(`
                SELECT 
                    COUNT(*) as TotalRecords,
                    COUNT(DISTINCT TagName) as UniqueTagCount,
                    MIN(Timestamp) as OldestRecord,
                    MAX(Timestamp) as LatestRecord
                FROM ${this.config.dataTable}
            `);

            stats.data = dataStats.recordset[0];

            // Alarm statistics  
            const alarmStats = await this.connectionPool.request().query(`
                SELECT 
                    COUNT(*) as TotalAlarms,
                    COUNT(CASE WHEN AlarmState = 'ACTIVE' THEN 1 END) as ActiveAlarms,
                    COUNT(DISTINCT TagName) as TagsWithAlarms
                FROM ${this.config.alarmTable}
            `);

            stats.alarms = alarmStats.recordset[0];

            // Buffer status
            stats.buffers = {
                dataBuffer: this.logBuffer.length,
                alarmBuffer: this.alarmBuffer.length,
                eventBuffer: this.eventBuffer.length
            };

            return stats;

        } catch (error) {
            console.error('Error getting logging stats:', error);
            throw error;
        }
    }

    /**
     * Shutdown the data logger
     */
    async shutdown() {
        console.log('Shutting down SQL Data Logger...');
        
        this.stopPeriodicLogging();
        
        // Flush all remaining data
        await this.flushAllBuffers();
        
        console.log('SQL Data Logger shutdown complete');
        this.emit('shutdown');
    }
}

module.exports = SqlDataLogger;
