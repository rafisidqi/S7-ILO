-- Extended SQL Server Express Database Setup Script for S7 Standalone Client with Logging
-- This script extends the basic setup with comprehensive logging tables

USE PLCTags;
GO

PRINT 'Creating logging tables for S7 Standalone Client...';

-- Create DataHistory table for logging both raw and engineering unit values
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataHistory' AND xtype='U')
BEGIN
    CREATE TABLE DataHistory (
        LogID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        RawValue float NOT NULL,           -- Original value from PLC
        EuValue float NOT NULL,            -- Scaled engineering unit value
        Quality int DEFAULT 192,           -- 192 = Good quality (OPC standard)
        Timestamp datetime2 DEFAULT GETDATE(),
        LogType nvarchar(20) DEFAULT 'PERIODIC' -- PERIODIC, CHANGE, MANUAL, ALARM
    );

    -- Create indexes for better performance
    CREATE INDEX IX_DataHistory_TagName_Timestamp ON DataHistory(TagName, Timestamp);
    CREATE INDEX IX_DataHistory_Timestamp ON DataHistory(Timestamp);
    CREATE INDEX IX_DataHistory_LogType ON DataHistory(LogType);
    
    PRINT 'DataHistory table with EU scaling created successfully.';
END
ELSE
BEGIN
    -- Add new columns to existing DataHistory table if they don't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DataHistory') AND name = 'EuValue')
    BEGIN
        -- Rename existing TagValue to RawValue if it exists
        IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DataHistory') AND name = 'TagValue')
        BEGIN
            EXEC sp_rename 'DataHistory.TagValue', 'RawValue', 'COLUMN';
        END
        
        -- Add EuValue column
        ALTER TABLE DataHistory ADD EuValue float;
        
        -- Update existing records to have EuValue = RawValue (no scaling)
        UPDATE DataHistory SET EuValue = RawValue WHERE EuValue IS NULL;
        
        -- Make EuValue NOT NULL
        ALTER TABLE DataHistory ALTER COLUMN EuValue float NOT NULL;
        
        PRINT 'Engineering units columns added to existing DataHistory table.';
    END
    ELSE
    BEGIN
        PRINT 'DataHistory table with EU scaling already exists.';
    END
END
GO

-- Create AlarmHistory table for logging alarm events
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AlarmHistory' AND xtype='U')
BEGIN
    CREATE TABLE AlarmHistory (
        AlarmID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        AlarmType nvarchar(20) NOT NULL, -- HIGH, LOW, DEVIATION, COMMUNICATION, etc.
        AlarmState nvarchar(20) NOT NULL, -- ACTIVE, CLEARED, ACKNOWLEDGED
        AlarmValue float NOT NULL,
        LimitValue float,
        AlarmMessage nvarchar(500),
        Timestamp datetime2 DEFAULT GETDATE(),
        AcknowledgedBy nvarchar(100),
        AcknowledgedAt datetime2,
        ClearedAt datetime2,
        Severity nvarchar(20) DEFAULT 'MEDIUM' -- LOW, MEDIUM, HIGH, CRITICAL
    );

    -- Create indexes
    CREATE INDEX IX_AlarmHistory_TagName_Timestamp ON AlarmHistory(TagName, Timestamp);
    CREATE INDEX IX_AlarmHistory_AlarmState ON AlarmHistory(AlarmState);
    CREATE INDEX IX_AlarmHistory_Timestamp ON AlarmHistory(Timestamp);
    CREATE INDEX IX_AlarmHistory_AlarmType ON AlarmHistory(AlarmType);
    CREATE INDEX IX_AlarmHistory_Severity ON AlarmHistory(Severity);
    
    PRINT 'AlarmHistory table created successfully.';
END
ELSE
BEGIN
    PRINT 'AlarmHistory table already exists.';
END
GO

-- Create EventHistory table for logging system events
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EventHistory' AND xtype='U')
BEGIN
    CREATE TABLE EventHistory (
        EventID bigint IDENTITY(1,1) PRIMARY KEY,
        EventType nvarchar(50) NOT NULL, -- CONNECTION, TAG_CHANGE, WRITE, ERROR, SYSTEM, etc.
        EventCategory nvarchar(20) NOT NULL, -- INFO, WARNING, ERROR, CRITICAL
        EventMessage nvarchar(1000) NOT NULL,
        TagName nvarchar(100),
        OldValue float,
        NewValue float,
        Username nvarchar(100),
        Source nvarchar(100) DEFAULT 'S7Client',
        Timestamp datetime2 DEFAULT GETDATE(),
        SessionID nvarchar(50) -- For tracking user sessions
    );

    -- Create indexes
    CREATE INDEX IX_EventHistory_EventType_Timestamp ON EventHistory(EventType, Timestamp);
    CREATE INDEX IX_EventHistory_EventCategory ON EventHistory(EventCategory);
    CREATE INDEX IX_EventHistory_Timestamp ON EventHistory(Timestamp);
    CREATE INDEX IX_EventHistory_TagName ON EventHistory(TagName);
    CREATE INDEX IX_EventHistory_Source ON EventHistory(Source);
    
    PRINT 'EventHistory table created successfully.';
END
ELSE
BEGIN
    PRINT 'EventHistory table already exists.';
END
GO

-- Create DataSummaryHourly table for aggregated data (better performance for reports)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryHourly' AND xtype='U')
BEGIN
    CREATE TABLE DataSummaryHourly (
        SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        HourTimestamp datetime2 NOT NULL,
        MinValue float NOT NULL,
        MaxValue float NOT NULL,
        AvgValue float NOT NULL,
        LastValue float NOT NULL,
        SampleCount int NOT NULL DEFAULT 0,
        StandardDeviation float,
        CreatedAt datetime2 DEFAULT GETDATE()
    );

    -- Create unique constraint and indexes
    ALTER TABLE DataSummaryHourly ADD CONSTRAINT UQ_DataSummaryHourly_TagHour UNIQUE(TagName, HourTimestamp);
    CREATE INDEX IX_DataSummaryHourly_TagName_Hour ON DataSummaryHourly(TagName, HourTimestamp);
    CREATE INDEX IX_DataSummaryHourly_HourTimestamp ON DataSummaryHourly(HourTimestamp);
    
    PRINT 'DataSummaryHourly table created successfully.';
END
ELSE
BEGIN
    PRINT 'DataSummaryHourly table already exists.';
END
GO

-- Create DataSummaryDaily table for daily aggregations
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryDaily' AND xtype='U')
BEGIN
    CREATE TABLE DataSummaryDaily (
        SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        DayTimestamp date NOT NULL,
        MinValue float NOT NULL,
        MaxValue float NOT NULL,
        AvgValue float NOT NULL,
        LastValue float NOT NULL,
        SampleCount int NOT NULL DEFAULT 0,
        StandardDeviation float,
        CreatedAt datetime2 DEFAULT GETDATE()
    );

    -- Create unique constraint and indexes
    ALTER TABLE DataSummaryDaily ADD CONSTRAINT UQ_DataSummaryDaily_TagDay UNIQUE(TagName, DayTimestamp);
    CREATE INDEX IX_DataSummaryDaily_TagName_Day ON DataSummaryDaily(TagName, DayTimestamp);
    CREATE INDEX IX_DataSummaryDaily_DayTimestamp ON DataSummaryDaily(DayTimestamp);
    
    PRINT 'DataSummaryDaily table created successfully.';
END
ELSE
BEGIN
    PRINT 'DataSummaryDaily table already exists.';
END
GO

-- Create LoggingConfiguration table for dynamic logging settings
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='LoggingConfiguration' AND xtype='U')
BEGIN
    CREATE TABLE LoggingConfiguration (
        ConfigID int IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL UNIQUE,
        EnableLogging bit DEFAULT 1,
        LogOnChange bit DEFAULT 1,
        ChangeThreshold float DEFAULT 0.01,
        MaxLogFrequency int DEFAULT 60, -- Maximum logs per minute
        EnableTrending bit DEFAULT 1,
        TrendSampleRate int DEFAULT 300, -- Trend sample rate in seconds
        RetentionDays int DEFAULT 90,
        CreatedAt datetime2 DEFAULT GETDATE(),
        ModifiedAt datetime2 DEFAULT GETDATE()
    );

    CREATE INDEX IX_LoggingConfiguration_TagName ON LoggingConfiguration(TagName);
    CREATE INDEX IX_LoggingConfiguration_EnableLogging ON LoggingConfiguration(EnableLogging);
    
    PRINT 'LoggingConfiguration table created successfully.';
END
ELSE
BEGIN
    PRINT 'LoggingConfiguration table already exists.';
END
GO

-- Insert sample logging configuration for existing tags
INSERT INTO LoggingConfiguration (TagName, EnableLogging, LogOnChange, ChangeThreshold, MaxLogFrequency)
SELECT 
    TagName,
    1 as EnableLogging,
    CASE 
        WHEN TagType IN ('BOOL') THEN 1  -- Always log boolean changes
        WHEN TagType IN ('REAL', 'INT', 'DINT') THEN 1  -- Log numeric changes
        ELSE 0
    END as LogOnChange,
    CASE 
        WHEN TagType = 'REAL' THEN 0.1  -- 0.1 unit threshold for real values
        WHEN TagType IN ('INT', 'DINT') THEN 1.0  -- 1 unit threshold for integers
        ELSE 0.01
    END as ChangeThreshold,
    CASE 
        WHEN TagName LIKE '%Speed%' THEN 120  -- Speed values can change frequently
        WHEN TagName LIKE '%Pressure%' THEN 60  -- Pressure moderate frequency
        WHEN TagName LIKE '%Temperature%' THEN 30  -- Temperature lower frequency
        ELSE 60
    END as MaxLogFrequency
FROM Tags 
WHERE NOT EXISTS (SELECT 1 FROM LoggingConfiguration lc WHERE lc.TagName = Tags.TagName);

PRINT 'Sample logging configuration inserted.';
GO

-- Create stored procedures for data logging operations

-- Procedure to log data with engineering units scaling
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_LogData')
BEGIN
    DROP PROCEDURE sp_LogData;
END
GO

CREATE PROCEDURE sp_LogData
    @TagName nvarchar(100),
    @RawValue float,
    @EuValue float,
    @Quality int = 192,
    @LogType nvarchar(20) = 'PERIODIC'
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @ShouldLog bit = 1;
    DECLARE @ChangeThreshold float;
    DECLARE @LastEuValue float;
    DECLARE @MaxFrequency int;
    DECLARE @RecentLogCount int;

    -- Get logging configuration
    SELECT 
        @ChangeThreshold = ChangeThreshold,
        @MaxFrequency = MaxLogFrequency,
        @ShouldLog = EnableLogging
    FROM LoggingConfiguration 
    WHERE TagName = @TagName;

    -- If no configuration found, use defaults
    IF @ShouldLog IS NULL
    BEGIN
        SET @ShouldLog = 1;
        SET @ChangeThreshold = 0.01;
        SET @MaxFrequency = 60;
    END

    -- Check if we should log based on frequency limits
    IF @ShouldLog = 1 AND @LogType = 'PERIODIC'
    BEGIN
        -- Count recent logs in the last minute
        SELECT @RecentLogCount = COUNT(*)
        FROM DataHistory 
        WHERE TagName = @TagName 
          AND Timestamp > DATEADD(minute, -1, GETDATE());

        -- Check frequency limit
        IF @RecentLogCount >= @MaxFrequency
            SET @ShouldLog = 0;
    END

    -- Check for significant change if LogOnChange is enabled (using EU value)
    IF @ShouldLog = 1 AND @LogType = 'CHANGE'
    BEGIN
        -- Get last logged EU value
        SELECT TOP 1 @LastEuValue = EuValue 
        FROM DataHistory 
        WHERE TagName = @TagName 
        ORDER BY Timestamp DESC;

        -- Check if EU value change is significant
        IF @LastEuValue IS NOT NULL AND ABS(@EuValue - @LastEuValue) < @ChangeThreshold
            SET @ShouldLog = 0;
    END

    -- Log the data if all checks pass
    IF @ShouldLog = 1
    BEGIN
        INSERT INTO DataHistory (TagName, RawValue, EuValue, Quality, LogType)
        VALUES (@TagName, @RawValue, @EuValue, @Quality, @LogType);
        
        SELECT SCOPE_IDENTITY() as LogID, 1 as Logged;
    END
    ELSE
    BEGIN
        SELECT NULL as LogID, 0 as Logged;
    END
END
GO

-- Function to convert raw value to engineering units
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_RawToEu' AND type = 'FN')
BEGIN
    DROP FUNCTION fn_RawToEu;
END
GO

CREATE FUNCTION fn_RawToEu(@TagName nvarchar(100), @RawValue float)
RETURNS float
AS
BEGIN
    DECLARE @EuValue float;
    DECLARE @RawMin float, @RawMax float, @EuMin float, @EuMax float;
    
    -- Get scaling parameters for the tag
    SELECT @RawMin = RawMin, @RawMax = RawMax, @EuMin = EuMin, @EuMax = EuMax
    FROM Tags 
    WHERE TagName = @TagName;
    
    -- If tag not found or no scaling parameters, return raw value
    IF @RawMin IS NULL OR @RawMax IS NULL OR @EuMin IS NULL OR @EuMax IS NULL
        SET @EuValue = @RawValue;
    ELSE
    BEGIN
        -- Prevent division by zero
        IF @RawMax = @RawMin
            SET @EuValue = @EuMin;
        ELSE
        BEGIN
            -- Linear scaling: EU = EuMin + (Raw - RawMin) * (EuMax - EuMin) / (RawMax - RawMin)
            SET @EuValue = @EuMin + (@RawValue - @RawMin) * (@EuMax - @EuMin) / (@RawMax - @RawMin);
        END
    END
    
    RETURN @EuValue;
END
GO

-- Function to convert engineering units to raw value  
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_EuToRaw' AND type = 'FN')
BEGIN
    DROP FUNCTION fn_EuToRaw;
END
GO

CREATE FUNCTION fn_EuToRaw(@TagName nvarchar(100), @EuValue float)
RETURNS float
AS
BEGIN
    DECLARE @RawValue float;
    DECLARE @RawMin float, @RawMax float, @EuMin float, @EuMax float;
    
    -- Get scaling parameters for the tag
    SELECT @RawMin = RawMin, @RawMax = RawMax, @EuMin = EuMin, @EuMax = EuMax
    FROM Tags 
    WHERE TagName = @TagName;
    
    -- If tag not found or no scaling parameters, return EU value
    IF @RawMin IS NULL OR @RawMax IS NULL OR @EuMin IS NULL OR @EuMax IS NULL
        SET @RawValue = @EuValue;
    ELSE
    BEGIN
        -- Prevent division by zero
        IF @EuMax = @EuMin
            SET @RawValue = @RawMin;
        ELSE
        BEGIN
            -- Inverse linear scaling: Raw = RawMin + (EU - EuMin) * (RawMax - RawMin) / (EuMax - EuMin)
            SET @RawValue = @RawMin + (@EuValue - @EuMin) * (@RawMax - @RawMin) / (@EuMax - @EuMin);
        END
    END
    
    RETURN @RawValue;
END
GO

-- Procedure to generate hourly summaries
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GenerateHourlySummaries')
BEGIN
    DROP PROCEDURE sp_GenerateHourlySummaries;
END
GO

CREATE PROCEDURE sp_GenerateHourlySummaries
    @HoursBack int = 25
AS
BEGIN
    SET NOCOUNT ON;
    
    INSERT INTO DataSummaryHourly (TagName, HourTimestamp, MinValue, MaxValue, AvgValue, LastValue, SampleCount, StandardDeviation)
    SELECT 
        TagName,
        DATEADD(hour, DATEDIFF(hour, 0, Timestamp), 0) as HourTimestamp,
        MIN(TagValue) as MinValue,
        MAX(TagValue) as MaxValue,
        AVG(TagValue) as AvgValue,
        (SELECT TOP 1 TagValue 
         FROM DataHistory d2 
         WHERE d2.TagName = d1.TagName 
           AND DATEADD(hour, DATEDIFF(hour, 0, d2.Timestamp), 0) = DATEADD(hour, DATEDIFF(hour, 0, d1.Timestamp), 0)
         ORDER BY d2.Timestamp DESC) as LastValue,
        COUNT(*) as SampleCount,
        STDEV(TagValue) as StandardDeviation
    FROM DataHistory d1
    WHERE Timestamp >= DATEADD(hour, -@HoursBack, GETDATE())
      AND NOT EXISTS (
          SELECT 1 FROM DataSummaryHourly s 
          WHERE s.TagName = d1.TagName 
            AND s.HourTimestamp = DATEADD(hour, DATEDIFF(hour, 0, d1.Timestamp), 0)
      )
    GROUP BY TagName, DATEADD(hour, DATEDIFF(hour, 0, Timestamp), 0);
    
    SELECT @@ROWCOUNT as SummariesCreated;
END
GO

-- Procedure to clean up old data based on retention policies
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_CleanupOldData')
BEGIN
    DROP PROCEDURE sp_CleanupOldData;
END
GO

CREATE PROCEDURE sp_CleanupOldData
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @DataRetentionDays int = 90;
    DECLARE @AlarmRetentionDays int = 365;
    DECLARE @EventRetentionDays int = 30;
    DECLARE @SummaryRetentionDays int = 1095; -- 3 years for summaries
    
    DECLARE @DataDeleted int = 0;
    DECLARE @AlarmDeleted int = 0;
    DECLARE @EventDeleted int = 0;
    DECLARE @SummaryDeleted int = 0;

    -- Clean up old data history
    DELETE FROM DataHistory 
    WHERE Timestamp < DATEADD(day, -@DataRetentionDays, GETDATE());
    SET @DataDeleted = @@ROWCOUNT;

    -- Clean up old alarm history
    DELETE FROM AlarmHistory 
    WHERE Timestamp < DATEADD(day, -@AlarmRetentionDays, GETDATE())
      AND AlarmState IN ('CLEARED', 'ACKNOWLEDGED');
    SET @AlarmDeleted = @@ROWCOUNT;

    -- Clean up old event history
    DELETE FROM EventHistory 
    WHERE Timestamp < DATEADD(day, -@EventRetentionDays, GETDATE())
      AND EventCategory NOT IN ('CRITICAL', 'ERROR');
    SET @EventDeleted = @@ROWCOUNT;

    -- Clean up old summary data
    DELETE FROM DataSummaryHourly 
    WHERE HourTimestamp < DATEADD(day, -@SummaryRetentionDays, GETDATE());
    
    DELETE FROM DataSummaryDaily 
    WHERE DayTimestamp < DATEADD(day, -@SummaryRetentionDays, GETDATE());
    SET @SummaryDeleted = @@ROWCOUNT;

    -- Return cleanup results
    SELECT 
        @DataDeleted as DataRecordsDeleted,
        @AlarmDeleted as AlarmRecordsDeleted,
        @EventDeleted as EventRecordsDeleted,
        @SummaryDeleted as SummaryRecordsDeleted,
        GETDATE() as CleanupTime;
END
GO

-- Procedure to get data logging statistics
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetLoggingStatistics')
BEGIN
    DROP PROCEDURE sp_GetLoggingStatistics;
END
GO

CREATE PROCEDURE sp_GetLoggingStatistics
AS
BEGIN
    SET NOCOUNT ON;

    -- Overall statistics
    SELECT 
        'Data Records' as Category,
        COUNT(*) as TotalCount,
        COUNT(DISTINCT TagName) as UniqueTagCount,
        MIN(Timestamp) as OldestRecord,
        MAX(Timestamp) as NewestRecord,
        AVG(DATEDIFF(second, LAG(Timestamp) OVER (ORDER BY Timestamp), Timestamp)) as AvgIntervalSeconds
    FROM DataHistory
    
    UNION ALL
    
    SELECT 
        'Alarm Records' as Category,
        COUNT(*) as TotalCount,
        COUNT(DISTINCT TagName) as UniqueTagCount,
        MIN(Timestamp) as OldestRecord,
        MAX(Timestamp) as NewestRecord,
        NULL as AvgIntervalSeconds
    FROM AlarmHistory
    
    UNION ALL
    
    SELECT 
        'Event Records' as Category,
        COUNT(*) as TotalCount,
        NULL as UniqueTagCount,
        MIN(Timestamp) as OldestRecord,
        MAX(Timestamp) as NewestRecord,
        NULL as AvgIntervalSeconds
    FROM EventHistory;

    -- Data by tag statistics
    SELECT 
        TagName,
        COUNT(*) as RecordCount,
        MIN(TagValue) as MinValue,
        MAX(TagValue) as MaxValue,
        AVG(TagValue) as AvgValue,
        STDEV(TagValue) as StdDevValue,
        MIN(Timestamp) as FirstRecord,
        MAX(Timestamp) as LastRecord,
        DATEDIFF(hour, MIN(Timestamp), MAX(Timestamp)) as DataSpanHours
    FROM DataHistory
    GROUP BY TagName
    ORDER BY RecordCount DESC;

    -- Alarm statistics by tag
    SELECT 
        TagName,
        AlarmType,
        COUNT(*) as AlarmCount,
        COUNT(CASE WHEN AlarmState = 'ACTIVE' THEN 1 END) as ActiveAlarms,
        COUNT(CASE WHEN AlarmState = 'ACKNOWLEDGED' THEN 1 END) as AcknowledgedAlarms,
        AVG(DATEDIFF(minute, Timestamp, ISNULL(ClearedAt, GETDATE()))) as AvgDurationMinutes
    FROM AlarmHistory
    GROUP BY TagName, AlarmType
    ORDER BY AlarmCount DESC;
END
GO

-- Create views for easier data access

-- View for recent data (last 24 hours)
IF EXISTS (SELECT * FROM sys.views WHERE name = 'RecentData')
BEGIN
    DROP VIEW RecentData;
END
GO

CREATE VIEW RecentData AS
SELECT 
    dh.TagName,
    dh.TagValue,
    dh.RawValue,
    dh.Quality,
    dh.Timestamp,
    dh.LogType,
    t.TagType,
    t.Units,
    t.GroupName,
    t.ScalingFactor
FROM DataHistory dh
INNER JOIN Tags t ON dh.TagName = t.TagName
WHERE dh.Timestamp >= DATEADD(hour, -24, GETDATE())
  AND t.Enabled = 1;
GO

-- View for active alarms
IF EXISTS (SELECT * FROM sys.views WHERE name = 'ActiveAlarms')
BEGIN
    DROP VIEW ActiveAlarms;
END
GO

CREATE VIEW ActiveAlarms AS
SELECT 
    ah.AlarmID,
    ah.TagName,
    ah.AlarmType,
    ah.AlarmState,
    ah.AlarmValue,
    ah.LimitValue,
    ah.AlarmMessage,
    ah.Timestamp,
    ah.Severity,
    t.Description,
    t.Units,
    t.GroupName,
    DATEDIFF(minute, ah.Timestamp, GETDATE()) as AlarmDurationMinutes
FROM AlarmHistory ah
INNER JOIN Tags t ON ah.TagName = t.TagName
WHERE ah.AlarmState IN ('ACTIVE')
  AND t.Enabled = 1;
GO

-- View for recent events (last 7 days)
IF EXISTS (SELECT * FROM sys.views WHERE name = 'RecentEvents')
BEGIN
    DROP VIEW RecentEvents;
END
GO

CREATE VIEW RecentEvents AS
SELECT 
    EventID,
    EventType,
    EventCategory,
    EventMessage,
    TagName,
    OldValue,
    NewValue,
    Username,
    Source,
    Timestamp
FROM EventHistory
WHERE Timestamp >= DATEADD(day, -7, GETDATE())
  AND EventCategory IN ('WARNING', 'ERROR', 'CRITICAL');
GO

-- Create functions for data analysis

-- Function to calculate tag availability (percentage of time with good quality data)
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_CalculateTagAvailability' AND type = 'FN')
BEGIN
    DROP FUNCTION fn_CalculateTagAvailability;
END
GO

CREATE FUNCTION fn_CalculateTagAvailability(@TagName nvarchar(100), @StartDate datetime2, @EndDate datetime2)
RETURNS float
AS
BEGIN
    DECLARE @TotalMinutes float;
    DECLARE @GoodQualityMinutes float;
    DECLARE @Availability float = 0;

    -- Calculate total time span in minutes
    SET @TotalMinutes = DATEDIFF(minute, @StartDate, @EndDate);

    -- Calculate minutes with good quality data (Quality = 192)
    SELECT @GoodQualityMinutes = COUNT(*) 
    FROM DataHistory
    WHERE TagName = @TagName
      AND Timestamp BETWEEN @StartDate AND @EndDate
      AND Quality = 192;

    -- Calculate availability percentage
    IF @TotalMinutes > 0
        SET @Availability = (@GoodQualityMinutes / @TotalMinutes) * 100;

    RETURN @Availability;
END
GO

-- Create triggers for automatic summary generation

-- Trigger to update logging configuration modified date
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_LoggingConfiguration_Update')
BEGIN
    DROP TRIGGER tr_LoggingConfiguration_Update;
END
GO

CREATE TRIGGER tr_LoggingConfiguration_Update
ON LoggingConfiguration
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE LoggingConfiguration
    SET ModifiedAt = GETDATE()
    FROM LoggingConfiguration lc
    INNER JOIN inserted i ON lc.ConfigID = i.ConfigID;
END
GO

-- Insert sample data for testing (if tables are empty)
IF NOT EXISTS (SELECT * FROM DataHistory)
BEGIN
    PRINT 'Inserting sample data for testing...';
    
    -- Insert sample data for the last 24 hours
    DECLARE @StartTime datetime2 = DATEADD(hour, -24, GETDATE());
    DECLARE @CurrentTime datetime2 = @StartTime;
    DECLARE @TagName nvarchar(100);
    DECLARE @BaseValue float;
    
    DECLARE tag_cursor CURSOR FOR
    SELECT TOP 5 TagName FROM Tags WHERE Enabled = 1 ORDER BY TagName;
    
    OPEN tag_cursor;
    FETCH NEXT FROM tag_cursor INTO @TagName;
    
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @BaseValue = CASE 
            WHEN @TagName LIKE '%Speed%' THEN 1500
            WHEN @TagName LIKE '%Temperature%' THEN 25
            WHEN @TagName LIKE '%Pressure%' THEN 5
            WHEN @TagName LIKE '%Level%' THEN 50
            ELSE 100
        END;
        
        SET @CurrentTime = @StartTime;
        
        WHILE @CurrentTime < GETDATE()
        BEGIN
            INSERT INTO DataHistory (TagName, TagValue, RawValue, Quality, LogType, Timestamp)
            VALUES (
                @TagName, 
                @BaseValue + (RAND() * 20 - 10), -- Add some random variation
                @BaseValue + (RAND() * 20 - 10),
                192, 
                'PERIODIC',
                @CurrentTime
            );
            
            SET @CurrentTime = DATEADD(minute, 5, @CurrentTime); -- 5-minute intervals
        END;
        
        FETCH NEXT FROM tag_cursor INTO @TagName;
    END;
    
    CLOSE tag_cursor;
    DEALLOCATE tag_cursor;
    
    PRINT 'Sample data inserted successfully.';
END
GO

-- Create scheduled job for automatic maintenance (SQL Server Agent required)
-- This is commented out as it requires SQL Server Agent which may not be available in Express edition
/*
-- Create job for hourly summary generation
EXEC sp_add_job
    @job_name = 'Generate Hourly Data Summaries',
    @enabled = 1,
    @description = 'Generates hourly summaries for PLC data';

EXEC sp_add_jobstep
    @job_name = 'Generate Hourly Data Summaries',
    @step_name = 'Generate Summaries',
    @command = 'EXEC sp_GenerateHourlySummaries',
    @database_name = 'PLCTags';

EXEC sp_add_schedule
    @schedule_name = 'Hourly',
    @freq_type = 4,
    @freq_interval = 1,
    @freq_subday_type = 8,
    @freq_subday_interval = 1;

EXEC sp_attach_schedule
    @job_name = 'Generate Hourly Data Summaries',
    @schedule_name = 'Hourly';

EXEC sp_add_jobserver
    @job_name = 'Generate Hourly Data Summaries';
*/

-- Display final summary
PRINT '';
PRINT '=== Data Logging Setup Complete ===';
PRINT '';

-- Show table counts
SELECT 
    'Tags' as TableName, COUNT(*) as RecordCount FROM Tags
UNION ALL
SELECT 
    'DataHistory' as TableName, COUNT(*) as RecordCount FROM DataHistory
UNION ALL
SELECT 
    'AlarmHistory' as TableName, COUNT(*) as RecordCount FROM AlarmHistory
UNION ALL
SELECT 
    'EventHistory' as TableName, COUNT(*) as RecordCount FROM EventHistory
UNION ALL
SELECT 
    'LoggingConfiguration' as TableName, COUNT(*) as RecordCount FROM LoggingConfiguration;

PRINT '';
PRINT 'Data logging database setup completed successfully!';
PRINT '';
PRINT 'Available stored procedures:';
PRINT '  - sp_LogData: Log data with automatic quality control';
PRINT '  - sp_GenerateHourlySummaries: Create hourly data summaries';
PRINT '  - sp_CleanupOldData: Clean up old data based on retention policies';
PRINT '  - sp_GetLoggingStatistics: Get comprehensive logging statistics';
PRINT '';
PRINT 'Available views:';
PRINT '  - RecentData: Data from last 24 hours';
PRINT '  - ActiveAlarms: Currently active alarms';
PRINT '  - RecentEvents: Events from last 7 days';
PRINT '';
PRINT 'Available functions:';
PRINT '  - fn_CalculateTagAvailability: Calculate data availability percentage';
PRINT '';

-- Test the logging system
PRINT 'Testing logging system...';
EXEC sp_GetLoggingStatistics;

GO
