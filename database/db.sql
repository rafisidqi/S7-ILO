-- Enhanced SQL Server Express Database Setup Script for S7 Standalone Client
-- Comprehensive database supporting all advanced features:
-- - Enhanced tag management with engineering units
-- - Complete data logging with raw/EU values  
-- - Alarm management system
-- - Event logging and audit trail
-- - Data summarization and archival
-- - Performance optimization
-- - Automated maintenance

-- Create database if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'PLCTags')
BEGIN
    CREATE DATABASE PLCTags;
    PRINT 'Database PLCTags created successfully.';
END
ELSE
BEGIN
    PRINT 'Database PLCTags already exists.';
END
GO

-- Use the PLCTags database
USE PLCTags;
GO

PRINT '=== Creating Enhanced S7 Database Schema ===';
PRINT 'This database supports:';
PRINT '- Engineering Units scaling and conversion';
PRINT '- Historical data logging with dual values (raw/EU)';
PRINT '- Comprehensive alarm management';
PRINT '- Event logging and audit trail';
PRINT '- Data summarization and performance optimization';
PRINT '- Automated data archival and cleanup';
PRINT '';

-- ===============================
-- CORE TABLES
-- ===============================

-- Enhanced Tags table with engineering units support
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Tags' AND xtype='U')
BEGIN
    CREATE TABLE Tags (
        TagID int IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL UNIQUE,
        TagAddress nvarchar(50) NOT NULL,
        TagType nvarchar(20) DEFAULT 'REAL',
        Description nvarchar(255),
        Enabled bit DEFAULT 1,
        GroupName nvarchar(50) DEFAULT 'Default',
        
        -- Engineering Units Configuration
        RawMin float DEFAULT 0,           -- Raw value minimum (from PLC)
        RawMax float DEFAULT 32767,       -- Raw value maximum (from PLC) 
        EuMin float DEFAULT 0,            -- Engineering unit minimum
        EuMax float DEFAULT 100,          -- Engineering unit maximum
        EngineeringUnits nvarchar(20),    -- Units symbol (°C, bar, RPM, etc.)
        DecimalPlaces int DEFAULT 2,      -- Display precision
        FormatString nvarchar(50),        -- Custom format string
        
        -- Legacy support (will be calculated from EU scaling)
        ScalingFactor float DEFAULT 1.0,
        Units nvarchar(20),               -- Alias for EngineeringUnits
        
        -- Operating limits (in engineering units)
        MinValue float,                   -- Operating minimum
        MaxValue float,                   -- Operating maximum
        
        -- Alarm configuration (in engineering units)
        AlarmHigh float,                  -- High alarm limit
        AlarmLow float,                   -- Low alarm limit
        AlarmHighHigh float,              -- Critical high alarm
        AlarmLowLow float,                -- Critical low alarm
        AlarmDeadband float DEFAULT 1.0,  -- Alarm hysteresis
        AlarmEnabled bit DEFAULT 1,       -- Enable alarms for this tag
        AlarmPriority int DEFAULT 5,      -- Alarm priority (1=Critical, 5=Info)
        
        -- Data logging configuration
        LoggingEnabled bit DEFAULT 1,     -- Enable data logging
        LogOnChange bit DEFAULT 1,        -- Log when value changes
        ChangeThreshold float DEFAULT 0.01, -- Minimum change to log
        MaxLogRate int DEFAULT 60,        -- Max logs per minute
        TrendingEnabled bit DEFAULT 1,    -- Enable trending/summaries
        
        -- Data retention
        RetentionDays int DEFAULT 90,     -- How long to keep raw data
        
        -- Advanced features
        ScalingType nvarchar(20) DEFAULT 'LINEAR', -- LINEAR, SQRT, POLYNOMIAL, LOOKUP
        ScalingCoefficients nvarchar(500), -- JSON array for polynomial/custom scaling
        ValidationRules nvarchar(1000),   -- JSON validation rules
        
        -- Audit fields
        CreatedDate datetime2 DEFAULT GETDATE(),
        CreatedBy nvarchar(100) DEFAULT SYSTEM_USER,
        ModifiedDate datetime2 DEFAULT GETDATE(),
        ModifiedBy nvarchar(100) DEFAULT SYSTEM_USER,
        Version int DEFAULT 1            -- For change tracking
    );
    
    PRINT 'Enhanced Tags table created successfully.';
END
ELSE
BEGIN
    -- Add new columns to existing Tags table if they don't exist
    DECLARE @sql nvarchar(max) = '';
    
    -- Check and add engineering units columns
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'RawMin')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD RawMin float DEFAULT 0; ';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'RawMax')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD RawMax float DEFAULT 32767; ';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'EuMin')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD EuMin float DEFAULT 0; ';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'EuMax')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD EuMax float DEFAULT 100; ';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'EngineeringUnits')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD EngineeringUnits nvarchar(20); ';
    END
    
    -- Add other missing columns...
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'AlarmEnabled')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD AlarmEnabled bit DEFAULT 1; ';
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tags') AND name = 'LoggingEnabled')
    BEGIN
        SET @sql = @sql + 'ALTER TABLE Tags ADD LoggingEnabled bit DEFAULT 1; ';
    END
    
    IF LEN(@sql) > 0
    BEGIN
        EXEC sp_executesql @sql;
        PRINT 'Enhanced columns added to existing Tags table.';
    END
    ELSE
    BEGIN
        PRINT 'Enhanced Tags table already up to date.';
    END
END
GO

-- ===============================
-- LOGGING TABLES
-- ===============================

-- Enhanced DataHistory table with raw and engineering unit values
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataHistory' AND xtype='U')
BEGIN
    CREATE TABLE DataHistory (
        LogID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        RawValue float NOT NULL,           -- Original value from PLC
        EuValue float NOT NULL,            -- Scaled engineering unit value
        Quality int DEFAULT 192,           -- 192 = Good quality (OPC standard)
        Timestamp datetime2 DEFAULT GETDATE(),
        LogType nvarchar(20) DEFAULT 'PERIODIC' -- PERIODIC, CHANGE, MANUAL, ALARM, WRITE
    );
    
    -- Partitioning support for large datasets (optional)
    -- CREATE PARTITION FUNCTION pf_DataHistory(datetime2) 
    -- AS RANGE RIGHT FOR VALUES ('20240101', '20240201', '20240301'...);
    
    PRINT 'Enhanced DataHistory table created successfully.';
END
ELSE
BEGIN
    -- Add engineering units column if missing
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DataHistory') AND name = 'EuValue')
    BEGIN
        -- Handle existing data
        IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DataHistory') AND name = 'TagValue')
        BEGIN
            -- Rename TagValue to RawValue
            EXEC sp_rename 'DataHistory.TagValue', 'RawValue', 'COLUMN';
            PRINT 'Renamed TagValue to RawValue in DataHistory table.';
        END
        
        -- Add EuValue column
        ALTER TABLE DataHistory ADD EuValue float;
        
        -- Update existing records (assume no scaling for existing data)
        UPDATE DataHistory SET EuValue = RawValue WHERE EuValue IS NULL;
        
        -- Make EuValue NOT NULL
        ALTER TABLE DataHistory ALTER COLUMN EuValue float NOT NULL;
        
        PRINT 'Added EuValue column to existing DataHistory table.';
    END
    ELSE
    BEGIN
        PRINT 'DataHistory table already enhanced.';
    END
END
GO

-- Comprehensive AlarmHistory table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AlarmHistory' AND xtype='U')
BEGIN
    CREATE TABLE AlarmHistory (
        AlarmID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        AlarmType nvarchar(20) NOT NULL, -- HIGH, LOW, HIGHHIGH, LOWLOW, DEVIATION, RATE, COMMUNICATION
        AlarmState nvarchar(20) NOT NULL, -- ACTIVE, CLEARED, ACKNOWLEDGED, SHELVED
        CurrentValue float NOT NULL,      -- Current EU value when alarm occurred
        LimitValue float,                 -- The limit that was exceeded
        Deviation float,                  -- How much the limit was exceeded by
        AlarmMessage nvarchar(500),
        Severity nvarchar(20) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, CRITICAL
        Priority int DEFAULT 5,          -- 1=Highest, 10=Lowest
        
        -- State management
        ActiveTime datetime2 DEFAULT GETDATE(), -- When alarm became active
        AcknowledgedBy nvarchar(100),
        AcknowledgedAt datetime2,
        ClearedAt datetime2,
        ShelvedBy nvarchar(100),         -- Who shelved the alarm
        ShelvedAt datetime2,
        ShelvedUntil datetime2,          -- When shelving expires
        
        -- Duration tracking
        DurationSeconds as DATEDIFF(second, ActiveTime, ISNULL(ClearedAt, GETDATE())),
        
        -- Grouping for alarm floods
        AlarmGroup nvarchar(50),         -- Group similar alarms
        FloodGroup bigint,               -- ID for alarm flood detection
        
        -- Context information  
        OperatorComments nvarchar(1000),
        SystemContext nvarchar(500),     -- System state when alarm occurred
        
        -- Timestamps
        Timestamp datetime2 DEFAULT GETDATE()
    );
    
    PRINT 'Enhanced AlarmHistory table created successfully.';
END
ELSE
BEGIN
    PRINT 'AlarmHistory table already exists.';
END
GO

-- Comprehensive EventHistory table for audit trail
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EventHistory' AND xtype='U')
BEGIN
    CREATE TABLE EventHistory (
        EventID bigint IDENTITY(1,1) PRIMARY KEY,
        EventType nvarchar(50) NOT NULL, 
        EventCategory nvarchar(20) NOT NULL, -- INFO, WARNING, ERROR, CRITICAL, SECURITY
        EventMessage nvarchar(1000) NOT NULL,
        
        -- Tag-related events
        TagName nvarchar(100),
        OldValue float,                  -- Previous value (EU)
        NewValue float,                  -- New value (EU) 
        OldRawValue float,              -- Previous raw value
        NewRawValue float,              -- New raw value
        
        -- User context
        Username nvarchar(100),
        UserRole nvarchar(50),
        ClientIP nvarchar(50),
        UserAgent nvarchar(200),
        
        -- System context
        Source nvarchar(100) DEFAULT 'S7Client',
        SourceVersion nvarchar(20),
        SessionID nvarchar(50),         -- User session tracking
        RequestID nvarchar(50),         -- Request correlation
        
        -- Additional data (JSON format)
        AdditionalData nvarchar(max),   -- JSON for extra context
        
        -- Timestamps
        Timestamp datetime2 DEFAULT GETDATE()
    );
    
    PRINT 'Enhanced EventHistory table created successfully.';
END
ELSE
BEGIN
    PRINT 'EventHistory table already exists.';
END
GO

-- ===============================
-- PERFORMANCE AND SUMMARY TABLES
-- ===============================

-- Hourly data summaries for better performance
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryHourly' AND xtype='U')
BEGIN
    CREATE TABLE DataSummaryHourly (
        SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        HourTimestamp datetime2 NOT NULL,
        
        -- Statistical values (engineering units)
        MinValue float NOT NULL,
        MaxValue float NOT NULL,
        AvgValue float NOT NULL,
        LastValue float NOT NULL,
        FirstValue float NOT NULL,
        SampleCount int NOT NULL DEFAULT 0,
        StandardDeviation float,
        Variance float,
        Range AS (MaxValue - MinValue),
        
        -- Data quality metrics
        GoodQualityCount int DEFAULT 0,
        BadQualityCount int DEFAULT 0,
        QualityPercentage AS (CASE WHEN (GoodQualityCount + BadQualityCount) > 0 
                                   THEN (GoodQualityCount * 100.0) / (GoodQualityCount + BadQualityCount) 
                                   ELSE 0 END),
        
        -- Process information
        TimeInRange int DEFAULT 0,       -- Minutes within normal operating range
        TimeInAlarm int DEFAULT 0,       -- Minutes in alarm state
        AlarmCount int DEFAULT 0,        -- Number of alarms during this hour
        
        -- Timestamps
        CreatedAt datetime2 DEFAULT GETDATE(),
        
        CONSTRAINT UQ_DataSummaryHourly_TagHour UNIQUE(TagName, HourTimestamp)
    );
    
    PRINT 'DataSummaryHourly table created successfully.';
END
ELSE
BEGIN
    PRINT 'DataSummaryHourly table already exists.';
END
GO

-- Daily data summaries
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryDaily' AND xtype='U')
BEGIN
    CREATE TABLE DataSummaryDaily (
        SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL,
        DayTimestamp date NOT NULL,
        
        -- Statistical values (engineering units)
        MinValue float NOT NULL,
        MaxValue float NOT NULL,
        AvgValue float NOT NULL,
        LastValue float NOT NULL,
        FirstValue float NOT NULL,
        SampleCount int NOT NULL DEFAULT 0,
        StandardDeviation float,
        
        -- Operational metrics
        UptimeMinutes int DEFAULT 0,
        DowntimeMinutes int DEFAULT 0,
        UptimePercentage as CASE WHEN (UptimeMinutes + DowntimeMinutes) > 0 
                               THEN (UptimeMinutes * 100.0) / (UptimeMinutes + DowntimeMinutes) 
                               ELSE 0 END,
        
        -- Alarm summary
        TotalAlarms int DEFAULT 0,
        CriticalAlarms int DEFAULT 0,
        HighAlarms int DEFAULT 0,
        MediumAlarms int DEFAULT 0,
        LowAlarms int DEFAULT 0,
        
        -- Timestamps
        CreatedAt datetime2 DEFAULT GETDATE(),
        
        CONSTRAINT UQ_DataSummaryDaily_TagDay UNIQUE(TagName, DayTimestamp)
    );
    
    PRINT 'DataSummaryDaily table created successfully.';
END
ELSE
BEGIN
    PRINT 'DataSummaryDaily table already exists.';
END
GO

-- ===============================
-- CONFIGURATION TABLES
-- ===============================

-- Logging configuration per tag
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='LoggingConfiguration' AND xtype='U')
BEGIN
    CREATE TABLE LoggingConfiguration (
        ConfigID int IDENTITY(1,1) PRIMARY KEY,
        TagName nvarchar(100) NOT NULL UNIQUE,
        
        -- Basic logging settings
        EnableLogging bit DEFAULT 1,
        LogOnChange bit DEFAULT 1,
        ChangeThreshold float DEFAULT 0.01,
        MaxLogFrequency int DEFAULT 60, -- Maximum logs per minute
        
        -- Trend settings
        EnableTrending bit DEFAULT 1,
        TrendSampleRate int DEFAULT 300, -- Trend sample rate in seconds
        TrendRetentionDays int DEFAULT 90,
        
        -- Summary settings
        EnableHourlySummary bit DEFAULT 1,
        EnableDailySummary bit DEFAULT 1,
        
        -- Data quality
        EnableQualityLogging bit DEFAULT 1,
        BadQualityAction nvarchar(20) DEFAULT 'LOG', -- LOG, IGNORE, ALARM
        
        -- Advanced options
        CompressionEnabled bit DEFAULT 0,
        CompressionRatio int DEFAULT 10, -- Keep 1 in N records for long-term
        CompressionDelay int DEFAULT 7,  -- Days before compression starts
        
        -- Timestamps
        CreatedAt datetime2 DEFAULT GETDATE(),
        ModifiedAt datetime2 DEFAULT GETDATE(),
        ModifiedBy nvarchar(100) DEFAULT SYSTEM_USER
    );
    
    PRINT 'LoggingConfiguration table created successfully.';
END
ELSE
BEGIN
    PRINT 'LoggingConfiguration table already exists.';
END
GO

-- System configuration table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SystemConfiguration' AND xtype='U')
BEGIN
    CREATE TABLE SystemConfiguration (
        ConfigID int IDENTITY(1,1) PRIMARY KEY,
        ConfigGroup nvarchar(50) NOT NULL, -- LOGGING, ALARMS, SYSTEM, SECURITY
        ConfigKey nvarchar(100) NOT NULL,
        ConfigValue nvarchar(500),
        ConfigDescription nvarchar(500),
        DataType nvarchar(20) DEFAULT 'STRING', -- STRING, INT, FLOAT, BOOL, JSON
        IsSystem bit DEFAULT 0,         -- System configs can't be deleted
        
        -- Timestamps
        CreatedAt datetime2 DEFAULT GETDATE(),
        ModifiedAt datetime2 DEFAULT GETDATE(),
        ModifiedBy nvarchar(100) DEFAULT SYSTEM_USER,
        
        CONSTRAINT UQ_SystemConfiguration_GroupKey UNIQUE(ConfigGroup, ConfigKey)
    );
    
    PRINT 'SystemConfiguration table created successfully.';
END
ELSE
BEGIN
    PRINT 'SystemConfiguration table already exists.';
END
GO

-- User and security management
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserSessions' AND xtype='U')
BEGIN
    CREATE TABLE UserSessions (
        SessionID nvarchar(50) PRIMARY KEY,
        Username nvarchar(100) NOT NULL,
        UserRole nvarchar(50),
        ClientIP nvarchar(50),
        UserAgent nvarchar(200),
        LoginTime datetime2 DEFAULT GETDATE(),
        LastActivity datetime2 DEFAULT GETDATE(),
        LogoutTime datetime2,
        SessionData nvarchar(max), -- JSON for session information
        IsActive bit DEFAULT 1
    );
    
    PRINT 'UserSessions table created successfully.';
END
ELSE
BEGIN
    PRINT 'UserSessions table already exists.';
END
GO

-- ===============================
-- INDEXES FOR PERFORMANCE
-- ===============================

PRINT 'Creating performance indexes...';

-- Tags table indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_TagName' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_TagName ON Tags(TagName);
    PRINT 'Index IX_Tags_TagName created.';
END
ELSE
BEGIN
    PRINT 'Index IX_Tags_TagName already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_GroupName' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_GroupName ON Tags(GroupName);
    PRINT 'Index IX_Tags_GroupName created.';
END
ELSE
BEGIN
    PRINT 'Index IX_Tags_GroupName already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_Enabled' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_Enabled ON Tags(Enabled);
    PRINT 'Index IX_Tags_Enabled created.';
END
ELSE
BEGIN
    PRINT 'Index IX_Tags_Enabled already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_LoggingEnabled' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_LoggingEnabled ON Tags(LoggingEnabled);
    PRINT 'Index IX_Tags_LoggingEnabled created.';
END
ELSE
BEGIN
    PRINT 'Index IX_Tags_LoggingEnabled already exists.';
END

-- DataHistory indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DataHistory_TagName_Timestamp' AND object_id = OBJECT_ID('DataHistory'))
BEGIN
    CREATE INDEX IX_DataHistory_TagName_Timestamp ON DataHistory(TagName, Timestamp);
    PRINT 'Index IX_DataHistory_TagName_Timestamp created.';
END
ELSE
BEGIN
    PRINT 'Index IX_DataHistory_TagName_Timestamp already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DataHistory_Timestamp' AND object_id = OBJECT_ID('DataHistory'))
BEGIN
    CREATE INDEX IX_DataHistory_Timestamp ON DataHistory(Timestamp);
    PRINT 'Index IX_DataHistory_Timestamp created.';
END
ELSE
BEGIN
    PRINT 'Index IX_DataHistory_Timestamp already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DataHistory_LogType' AND object_id = OBJECT_ID('DataHistory'))
BEGIN
    CREATE INDEX IX_DataHistory_LogType ON DataHistory(LogType);
    PRINT 'Index IX_DataHistory_LogType created.';
END
ELSE
BEGIN
    PRINT 'Index IX_DataHistory_LogType already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DataHistory_Quality' AND object_id = OBJECT_ID('DataHistory'))
BEGIN
    CREATE INDEX IX_DataHistory_Quality ON DataHistory(Quality);
    PRINT 'Index IX_DataHistory_Quality created.';
END
ELSE
BEGIN
    PRINT 'Index IX_DataHistory_Quality already exists.';
END

-- AlarmHistory indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AlarmHistory_TagName_Timestamp' AND object_id = OBJECT_ID('AlarmHistory'))
BEGIN
    CREATE INDEX IX_AlarmHistory_TagName_Timestamp ON AlarmHistory(TagName, Timestamp);
    PRINT 'Index IX_AlarmHistory_TagName_Timestamp created.';
END
ELSE
BEGIN
    PRINT 'Index IX_AlarmHistory_TagName_Timestamp already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AlarmHistory_AlarmState' AND object_id = OBJECT_ID('AlarmHistory'))
BEGIN
    CREATE INDEX IX_AlarmHistory_AlarmState ON AlarmHistory(AlarmState);
    PRINT 'Index IX_AlarmHistory_AlarmState created.';
END
ELSE
BEGIN
    PRINT 'Index IX_AlarmHistory_AlarmState already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AlarmHistory_Severity' AND object_id = OBJECT_ID('AlarmHistory'))
BEGIN
    CREATE INDEX IX_AlarmHistory_Severity ON AlarmHistory(Severity);
    PRINT 'Index IX_AlarmHistory_Severity created.';
END
ELSE
BEGIN
    PRINT 'Index IX_AlarmHistory_Severity already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AlarmHistory_ActiveTime' AND object_id = OBJECT_ID('AlarmHistory'))
BEGIN
    CREATE INDEX IX_AlarmHistory_ActiveTime ON AlarmHistory(ActiveTime);
    PRINT 'Index IX_AlarmHistory_ActiveTime created.';
END
ELSE
BEGIN
    PRINT 'Index IX_AlarmHistory_ActiveTime already exists.';
END

-- EventHistory indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EventHistory_EventType_Timestamp' AND object_id = OBJECT_ID('EventHistory'))
BEGIN
    CREATE INDEX IX_EventHistory_EventType_Timestamp ON EventHistory(EventType, Timestamp);
    PRINT 'Index IX_EventHistory_EventType_Timestamp created.';
END
ELSE
BEGIN
    PRINT 'Index IX_EventHistory_EventType_Timestamp already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EventHistory_EventCategory' AND object_id = OBJECT_ID('EventHistory'))
BEGIN
    CREATE INDEX IX_EventHistory_EventCategory ON EventHistory(EventCategory);
    PRINT 'Index IX_EventHistory_EventCategory created.';
END
ELSE
BEGIN
    PRINT 'Index IX_EventHistory_EventCategory already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EventHistory_Username' AND object_id = OBJECT_ID('EventHistory'))
BEGIN
    CREATE INDEX IX_EventHistory_Username ON EventHistory(Username);
    PRINT 'Index IX_EventHistory_Username created.';
END
ELSE
BEGIN
    PRINT 'Index IX_EventHistory_Username already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_EventHistory_Source' AND object_id = OBJECT_ID('EventHistory'))
BEGIN
    CREATE INDEX IX_EventHistory_Source ON EventHistory(Source);
    PRINT 'Index IX_EventHistory_Source created.';
END
ELSE
BEGIN
    PRINT 'Index IX_EventHistory_Source already exists.';
END

-- Summary table indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DataSummaryHourly_TagName_Hour' AND object_id = OBJECT_ID('DataSummaryHourly'))
BEGIN
    CREATE INDEX IX_DataSummaryHourly_TagName_Hour ON DataSummaryHourly(TagName, HourTimestamp);
    PRINT 'Index IX_DataSummaryHourly_TagName_Hour created.';
END
ELSE
BEGIN
    PRINT 'Index IX_DataSummaryHourly_TagName_Hour already exists.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DataSummaryDaily_TagName_Day' AND object_id = OBJECT_ID('DataSummaryDaily'))
BEGIN
    CREATE INDEX IX_DataSummaryDaily_TagName_Day ON DataSummaryDaily(TagName, DayTimestamp);
    PRINT 'Index IX_DataSummaryDaily_TagName_Day created.';
END
ELSE
BEGIN
    PRINT 'Index IX_DataSummaryDaily_TagName_Day already exists.';
END

PRINT 'Performance indexes created successfully.';

-- ===============================
-- VIEWS FOR EASY DATA ACCESS
-- ===============================

PRINT 'Creating database views...';

-- Active tags with full configuration
IF EXISTS (SELECT * FROM sys.views WHERE name = 'ActiveTags')
    DROP VIEW ActiveTags;
GO

CREATE VIEW ActiveTags AS
SELECT 
    t.TagID,
    t.TagName,
    t.TagAddress,
    t.TagType,
    t.Description,
    t.GroupName,
    
    -- Engineering Units
    t.RawMin,
    t.RawMax, 
    t.EuMin,
    t.EuMax,
    t.EngineeringUnits,
    t.DecimalPlaces,
    
    -- Limits and Alarms
    t.MinValue,
    t.MaxValue,
    t.AlarmHigh,
    t.AlarmLow,
    t.AlarmEnabled,
    
    -- Logging Configuration
    t.LoggingEnabled,
    COALESCE(lc.LogOnChange, t.LogOnChange) as LogOnChange,
    COALESCE(lc.ChangeThreshold, t.ChangeThreshold) as ChangeThreshold,
    COALESCE(lc.EnableTrending, t.TrendingEnabled) as TrendingEnabled,
    
    -- Timestamps
    t.CreatedDate,
    t.ModifiedDate
FROM Tags t
LEFT JOIN LoggingConfiguration lc ON t.TagName = lc.TagName
WHERE t.Enabled = 1;
GO

-- Recent data with engineering units (last 24 hours)
IF EXISTS (SELECT * FROM sys.views WHERE name = 'RecentData')
    DROP VIEW RecentData;
GO

CREATE VIEW RecentData AS
SELECT 
    dh.LogID,
    dh.TagName,
    dh.RawValue,
    dh.EuValue,
    dh.Quality,
    dh.Timestamp,
    dh.LogType,
    
    -- Tag metadata
    t.TagType,
    t.EngineeringUnits,
    t.GroupName,
    t.Description,
    
    -- Quality status
    CASE 
        WHEN dh.Quality = 192 THEN 'Good'
        WHEN dh.Quality >= 128 THEN 'Uncertain' 
        ELSE 'Bad'
    END as QualityText,
    
    -- Formatted value
    CASE 
        WHEN t.DecimalPlaces IS NOT NULL AND dh.EuValue IS NOT NULL 
        THEN FORMAT(dh.EuValue, 'N' + CAST(t.DecimalPlaces as nvarchar(2)))
        ELSE CAST(dh.EuValue as nvarchar(50))
    END + ' ' + ISNULL(t.EngineeringUnits, '') as FormattedValue
    
FROM DataHistory dh
INNER JOIN Tags t ON dh.TagName = t.TagName
WHERE dh.Timestamp >= DATEADD(hour, -24, GETDATE())
  AND t.Enabled = 1;
GO

-- Active alarms view
IF EXISTS (SELECT * FROM sys.views WHERE name = 'ActiveAlarms')
    DROP VIEW ActiveAlarms;
GO

CREATE VIEW ActiveAlarms AS
SELECT 
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
    
    -- Tag information
    t.Description,
    t.EngineeringUnits,
    t.GroupName,
    
    -- Duration
    DATEDIFF(minute, ah.ActiveTime, GETDATE()) as AlarmDurationMinutes,
    
    -- Formatted values
    CASE 
        WHEN t.DecimalPlaces IS NOT NULL 
        THEN FORMAT(ah.CurrentValue, 'N' + CAST(t.DecimalPlaces as nvarchar(2)))
        ELSE CAST(ah.CurrentValue as nvarchar(50))
    END + ' ' + ISNULL(t.EngineeringUnits, '') as FormattedCurrentValue,
    
    CASE 
        WHEN t.DecimalPlaces IS NOT NULL AND ah.LimitValue IS NOT NULL
        THEN FORMAT(ah.LimitValue, 'N' + CAST(t.DecimalPlaces as nvarchar(2)))
        ELSE CAST(ah.LimitValue as nvarchar(50))
    END + ' ' + ISNULL(t.EngineeringUnits, '') as FormattedLimitValue
    
FROM AlarmHistory ah
INNER JOIN Tags t ON ah.TagName = t.TagName
WHERE ah.AlarmState IN ('ACTIVE', 'ACKNOWLEDGED')
  AND t.Enabled = 1;
GO

-- Recent system events (last 7 days)
IF EXISTS (SELECT * FROM sys.views WHERE name = 'RecentEvents')
    DROP VIEW RecentEvents;
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
    Timestamp,
    
    -- Categorize events
    CASE EventCategory
        WHEN 'CRITICAL' THEN 1
        WHEN 'ERROR' THEN 2  
        WHEN 'WARNING' THEN 3
        WHEN 'INFO' THEN 4
        ELSE 5
    END as PriorityOrder
    
FROM EventHistory
WHERE Timestamp >= DATEADD(day, -7, GETDATE())
  AND EventCategory IN ('WARNING', 'ERROR', 'CRITICAL');
GO

PRINT 'Database views created successfully.';

-- ===============================
-- STORED PROCEDURES
-- ===============================

PRINT 'Creating stored procedures...';

-- Enhanced procedure to add tags with engineering units
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_AddEnhancedTag')
    DROP PROCEDURE sp_AddEnhancedTag;
GO

CREATE PROCEDURE sp_AddEnhancedTag
    @TagName nvarchar(100),
    @TagAddress nvarchar(50),
    @TagType nvarchar(20) = 'REAL',
    @Description nvarchar(255) = NULL,
    @GroupName nvarchar(50) = 'Default',
    @RawMin float = 0,
    @RawMax float = 32767,
    @EuMin float = 0,
    @EuMax float = 100,
    @EngineeringUnits nvarchar(20) = NULL,
    @DecimalPlaces int = 2,
    @MinValue float = NULL,
    @MaxValue float = NULL,
    @AlarmHigh float = NULL,
    @AlarmLow float = NULL,
    @AlarmEnabled bit = 1,
    @LoggingEnabled bit = 1,
    @CreatedBy nvarchar(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- Set defaults
        IF @CreatedBy IS NULL SET @CreatedBy = SYSTEM_USER;
        
        INSERT INTO Tags (
            TagName, TagAddress, TagType, Description, GroupName,
            RawMin, RawMax, EuMin, EuMax, EngineeringUnits, DecimalPlaces,
            MinValue, MaxValue, AlarmHigh, AlarmLow, AlarmEnabled,
            LoggingEnabled, CreatedBy, ModifiedBy
        )
        VALUES (
            @TagName, @TagAddress, @TagType, @Description, @GroupName,
            @RawMin, @RawMax, @EuMin, @EuMax, @EngineeringUnits, @DecimalPlaces,
            @MinValue, @MaxValue, @AlarmHigh, @AlarmLow, @AlarmEnabled,
            @LoggingEnabled, @CreatedBy, @CreatedBy
        );
        
        -- Create logging configuration
        INSERT INTO LoggingConfiguration (TagName, EnableLogging, CreatedAt)
        VALUES (@TagName, @LoggingEnabled, GETDATE());
        
        -- Log the event
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, TagName, Username, Source)
        VALUES ('TAG_CREATED', 'INFO', 'Enhanced tag ' + @TagName + ' created successfully', @TagName, @CreatedBy, 'StoredProcedure');
        
        PRINT 'Enhanced tag ' + @TagName + ' added successfully.';
        SELECT SCOPE_IDENTITY() AS TagID, @TagName AS TagName, 'SUCCESS' AS Status;
        
    END TRY
    BEGIN CATCH
        PRINT 'Error adding enhanced tag: ' + ERROR_MESSAGE();
        SELECT NULL AS TagID, @TagName AS TagName, 'ERROR: ' + ERROR_MESSAGE() AS Status;
        THROW;
    END CATCH
END
GO

-- Enhanced procedure to log data with engineering units
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_LogDataWithEU')
    DROP PROCEDURE sp_LogDataWithEU;
GO

CREATE PROCEDURE sp_LogDataWithEU
    @TagName nvarchar(100),
    @RawValue float,
    @EuValue float = NULL,
    @Quality int = 192,
    @LogType nvarchar(20) = 'PERIODIC',
    @AutoCalculateEU bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @ShouldLog bit = 1;
    DECLARE @ChangeThreshold float;
    DECLARE @LastEuValue float;
    DECLARE @MaxFrequency int;
    DECLARE @RecentLogCount int;
    DECLARE @CalculatedEuValue float = @EuValue;

    BEGIN TRY
        -- Get tag configuration
        SELECT 
            @ChangeThreshold = COALESCE(lc.ChangeThreshold, t.ChangeThreshold, 0.01),
            @MaxFrequency = COALESCE(lc.MaxLogFrequency, t.MaxLogRate, 60),
            @ShouldLog = CASE WHEN t.LoggingEnabled = 1 AND COALESCE(lc.EnableLogging, 1) = 1 THEN 1 ELSE 0 END
        FROM Tags t
        LEFT JOIN LoggingConfiguration lc ON t.TagName = lc.TagName
        WHERE t.TagName = @TagName;

        -- Calculate EU value if not provided and auto-calculation is enabled
        IF @CalculatedEuValue IS NULL AND @AutoCalculateEU = 1
        BEGIN
            SELECT @CalculatedEuValue = dbo.fn_RawToEu(@TagName, @RawValue);
        END
        
        -- Use raw value if EU calculation failed
        IF @CalculatedEuValue IS NULL
            SET @CalculatedEuValue = @RawValue;

        -- If no configuration found, use defaults
        IF @ShouldLog IS NULL
        BEGIN
            SET @ShouldLog = 1;
            SET @ChangeThreshold = 0.01;
            SET @MaxFrequency = 60;
        END

        -- Check frequency limits for periodic logging
        IF @ShouldLog = 1 AND @LogType = 'PERIODIC'
        BEGIN
            SELECT @RecentLogCount = COUNT(*)
            FROM DataHistory 
            WHERE TagName = @TagName 
              AND Timestamp > DATEADD(minute, -1, GETDATE());

            IF @RecentLogCount >= @MaxFrequency
                SET @ShouldLog = 0;
        END

        -- Check for significant change if LogOnChange is enabled
        IF @ShouldLog = 1 AND @LogType IN ('CHANGE', 'PERIODIC')
        BEGIN
            SELECT TOP 1 @LastEuValue = EuValue 
            FROM DataHistory 
            WHERE TagName = @TagName 
            ORDER BY Timestamp DESC;

            IF @LastEuValue IS NOT NULL AND ABS(@CalculatedEuValue - @LastEuValue) < @ChangeThreshold AND @LogType <> 'MANUAL'
                SET @ShouldLog = 0;
        END

        -- Log the data if all checks pass
        IF @ShouldLog = 1
        BEGIN
            INSERT INTO DataHistory (TagName, RawValue, EuValue, Quality, LogType, Timestamp)
            VALUES (@TagName, @RawValue, @CalculatedEuValue, @Quality, @LogType, GETDATE());
            
            SELECT SCOPE_IDENTITY() as LogID, 1 as Logged, @CalculatedEuValue as CalculatedEuValue;
        END
        ELSE
        BEGIN
            SELECT NULL as LogID, 0 as Logged, @CalculatedEuValue as CalculatedEuValue;
        END
        
    END TRY
    BEGIN CATCH
        -- Log error
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, TagName, Source)
        VALUES ('LOGGING_ERROR', 'ERROR', 'Failed to log data for ' + @TagName + ': ' + ERROR_MESSAGE(), @TagName, 'sp_LogDataWithEU');
        
        THROW;
    END CATCH
END
GO

-- Enhanced alarm logging procedure
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_LogAlarmWithEU')
    DROP PROCEDURE sp_LogAlarmWithEU;
GO

CREATE PROCEDURE sp_LogAlarmWithEU
    @TagName nvarchar(100),
    @AlarmType nvarchar(20),
    @AlarmState nvarchar(20),
    @CurrentValue float,
    @LimitValue float = NULL,
    @AlarmMessage nvarchar(500) = NULL,
    @Username nvarchar(100) = NULL,
    @SystemContext nvarchar(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @Priority int = 5;
    DECLARE @Severity nvarchar(20) = 'MEDIUM';
    DECLARE @AlarmGroup nvarchar(50);
    DECLARE @Deviation float;
    
    BEGIN TRY
        -- Get tag alarm configuration
        SELECT 
            @Priority = COALESCE(AlarmPriority, 5),
            @AlarmGroup = GroupName
        FROM Tags
        WHERE TagName = @TagName;
        
        -- Calculate deviation
        IF @LimitValue IS NOT NULL
            SET @Deviation = @CurrentValue - @LimitValue;
        
        -- Determine severity based on alarm type
        SET @Severity = CASE 
            WHEN @AlarmType IN ('HIGHHIGH', 'LOWLOW') THEN 'CRITICAL'
            WHEN @AlarmType IN ('HIGH', 'LOW') THEN 'HIGH'
            WHEN @AlarmType IN ('COMMUNICATION', 'RATE') THEN 'MEDIUM'
            ELSE 'MEDIUM'
        END;
        
        -- Create default message if not provided
        IF @AlarmMessage IS NULL
            SET @AlarmMessage = @AlarmType + ' alarm for ' + @TagName + 
                               CASE WHEN @LimitValue IS NOT NULL 
                                   THEN ' (Value: ' + CAST(@CurrentValue as nvarchar(20)) + ', Limit: ' + CAST(@LimitValue as nvarchar(20)) + ')'
                                   ELSE ' (Value: ' + CAST(@CurrentValue as nvarchar(20)) + ')'
                               END;

        -- Insert alarm record
        INSERT INTO AlarmHistory (
            TagName, AlarmType, AlarmState, CurrentValue, LimitValue, Deviation,
            AlarmMessage, Severity, Priority, AlarmGroup, SystemContext,
            ActiveTime, Timestamp
        )
        VALUES (
            @TagName, @AlarmType, @AlarmState, @CurrentValue, @LimitValue, @Deviation,
            @AlarmMessage, @Severity, @Priority, @AlarmGroup, @SystemContext,
            GETDATE(), GETDATE()
        );
        
        -- Log system event
        INSERT INTO EventHistory (
            EventType, EventCategory, EventMessage, TagName, Username, Source,
            NewValue, AdditionalData
        )
        VALUES (
            'ALARM_' + @AlarmState, 
            CASE WHEN @Severity = 'CRITICAL' THEN 'CRITICAL' ELSE 'WARNING' END,
            @AlarmMessage,
            @TagName,
            COALESCE(@Username, 'SYSTEM'),
            'AlarmSystem',
            @CurrentValue,
            JSON_OBJECT('AlarmType', @AlarmType, 'Severity', @Severity, 'LimitValue', @LimitValue)
        );
        
        SELECT SCOPE_IDENTITY() as AlarmID, 'SUCCESS' as Status;
        
    END TRY
    BEGIN CATCH
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, Source)
        VALUES ('ALARM_LOG_ERROR', 'ERROR', 'Failed to log alarm: ' + ERROR_MESSAGE(), 'sp_LogAlarmWithEU');
        
        THROW;
    END CATCH
END
GO

-- Generate hourly summaries with enhanced statistics
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GenerateHourlySummaries')
    DROP PROCEDURE sp_GenerateHourlySummaries;
GO

CREATE PROCEDURE sp_GenerateHourlySummaries
    @HoursBack int = 25,
    @TagName nvarchar(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @ProcessedCount int = 0;
    
    BEGIN TRY
        INSERT INTO DataSummaryHourly (
            TagName, HourTimestamp, MinValue, MaxValue, AvgValue, 
            FirstValue, LastValue, SampleCount, StandardDeviation, Variance,
            GoodQualityCount, BadQualityCount, CreatedAt
        )
        SELECT 
            dh.TagName,
            DATEADD(hour, DATEDIFF(hour, 0, dh.Timestamp), 0) as HourTimestamp,
            MIN(dh.EuValue) as MinValue,
            MAX(dh.EuValue) as MaxValue,
            AVG(dh.EuValue) as AvgValue,
            FIRST_VALUE(dh.EuValue) OVER (PARTITION BY dh.TagName, DATEADD(hour, DATEDIFF(hour, 0, dh.Timestamp), 0) ORDER BY dh.Timestamp) as FirstValue,
            LAST_VALUE(dh.EuValue) OVER (PARTITION BY dh.TagName, DATEADD(hour, DATEDIFF(hour, 0, dh.Timestamp), 0) ORDER BY dh.Timestamp ROWS UNBOUNDED FOLLOWING) as LastValue,
            COUNT(*) as SampleCount,
            STDEV(dh.EuValue) as StandardDeviation,
            VAR(dh.EuValue) as Variance,
            COUNT(CASE WHEN dh.Quality = 192 THEN 1 END) as GoodQualityCount,
            COUNT(CASE WHEN dh.Quality <> 192 THEN 1 END) as BadQualityCount,
            GETDATE() as CreatedAt
        FROM DataHistory dh
        INNER JOIN Tags t ON dh.TagName = t.TagName
        WHERE dh.Timestamp >= DATEADD(hour, -@HoursBack, GETDATE())
          AND t.TrendingEnabled = 1
          AND (@TagName IS NULL OR dh.TagName = @TagName)
          AND NOT EXISTS (
              SELECT 1 FROM DataSummaryHourly s 
              WHERE s.TagName = dh.TagName 
                AND s.HourTimestamp = DATEADD(hour, DATEDIFF(hour, 0, dh.Timestamp), 0)
          )
        GROUP BY dh.TagName, DATEADD(hour, DATEDIFF(hour, 0, dh.Timestamp), 0);
        
        SET @ProcessedCount = @@ROWCOUNT;
        
        -- Log the operation
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, Source)
        VALUES ('SUMMARY_GENERATED', 'INFO', 
                'Generated ' + CAST(@ProcessedCount as nvarchar(10)) + ' hourly summaries', 
                'sp_GenerateHourlySummaries');
        
        SELECT @ProcessedCount as SummariesCreated, 'SUCCESS' as Status;
        
    END TRY
    BEGIN CATCH
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, Source)
        VALUES ('SUMMARY_ERROR', 'ERROR', 
                'Error generating hourly summaries: ' + ERROR_MESSAGE(), 
                'sp_GenerateHourlySummaries');
        THROW;
    END CATCH
END
GO

-- Comprehensive data cleanup procedure
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_CleanupOldData')
    DROP PROCEDURE sp_CleanupOldData;
GO

CREATE PROCEDURE sp_CleanupOldData
    @DataRetentionDays int = NULL,
    @AlarmRetentionDays int = NULL,
    @EventRetentionDays int = NULL,
    @SummaryRetentionDays int = NULL,
    @DryRun bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @DefaultDataRetention int = 90;
    DECLARE @DefaultAlarmRetention int = 365;
    DECLARE @DefaultEventRetention int = 30;
    DECLARE @DefaultSummaryRetention int = 1095; -- 3 years
    
    DECLARE @DataDeleted int = 0;
    DECLARE @AlarmDeleted int = 0;
    DECLARE @EventDeleted int = 0;
    DECLARE @SummaryDeleted int = 0;
    DECLARE @CompressedRecords int = 0;
    
    -- Use defaults if not provided
    SET @DataRetentionDays = COALESCE(@DataRetentionDays, @DefaultDataRetention);
    SET @AlarmRetentionDays = COALESCE(@AlarmRetentionDays, @DefaultAlarmRetention);
    SET @EventRetentionDays = COALESCE(@EventRetentionDays, @DefaultEventRetention);
    SET @SummaryRetentionDays = COALESCE(@SummaryRetentionDays, @DefaultSummaryRetention);

    BEGIN TRY
        PRINT 'Starting data cleanup process...';
        PRINT 'Data Retention: ' + CAST(@DataRetentionDays as nvarchar(10)) + ' days';
        PRINT 'Alarm Retention: ' + CAST(@AlarmRetentionDays as nvarchar(10)) + ' days';
        PRINT 'Event Retention: ' + CAST(@EventRetentionDays as nvarchar(10)) + ' days';
        PRINT 'Summary Retention: ' + CAST(@SummaryRetentionDays as nvarchar(10)) + ' days';
        PRINT 'Dry Run Mode: ' + CASE WHEN @DryRun = 1 THEN 'YES' ELSE 'NO' END;
        PRINT '';

        -- Clean up old data history
        IF @DryRun = 1
        BEGIN
            SELECT @DataDeleted = COUNT(*)
            FROM DataHistory 
            WHERE Timestamp < DATEADD(day, -@DataRetentionDays, GETDATE());
            
            PRINT 'Would delete ' + CAST(@DataDeleted as nvarchar(10)) + ' data history records';
        END
        ELSE
        BEGIN
            DELETE FROM DataHistory 
            WHERE Timestamp < DATEADD(day, -@DataRetentionDays, GETDATE());
            SET @DataDeleted = @@ROWCOUNT;
            
            PRINT 'Deleted ' + CAST(@DataDeleted as nvarchar(10)) + ' data history records';
        END

        -- Clean up old alarms (only cleared/acknowledged ones)
        IF @DryRun = 1
        BEGIN
            SELECT @AlarmDeleted = COUNT(*)
            FROM AlarmHistory 
            WHERE Timestamp < DATEADD(day, -@AlarmRetentionDays, GETDATE())
              AND AlarmState IN ('CLEARED', 'ACKNOWLEDGED');
              
            PRINT 'Would delete ' + CAST(@AlarmDeleted as nvarchar(10)) + ' alarm history records';
        END
        ELSE
        BEGIN
            DELETE FROM AlarmHistory 
            WHERE Timestamp < DATEADD(day, -@AlarmRetentionDays, GETDATE())
              AND AlarmState IN ('CLEARED', 'ACKNOWLEDGED');
            SET @AlarmDeleted = @@ROWCOUNT;
            
            PRINT 'Deleted ' + CAST(@AlarmDeleted as nvarchar(10)) + ' alarm history records';
        END

        -- Clean up old events (except critical ones)
        IF @DryRun = 1
        BEGIN
            SELECT @EventDeleted = COUNT(*)
            FROM EventHistory 
            WHERE Timestamp < DATEADD(day, -@EventRetentionDays, GETDATE())
              AND EventCategory NOT IN ('CRITICAL');
              
            PRINT 'Would delete ' + CAST(@EventDeleted as nvarchar(10)) + ' event history records';
        END
        ELSE
        BEGIN
            DELETE FROM EventHistory 
            WHERE Timestamp < DATEADD(day, -@EventRetentionDays, GETDATE())
              AND EventCategory NOT IN ('CRITICAL');
            SET @EventDeleted = @@ROWCOUNT;
            
            PRINT 'Deleted ' + CAST(@EventDeleted as nvarchar(10)) + ' event history records';
        END

        -- Clean up old summary data
        IF @DryRun = 1
        BEGIN
            SELECT @SummaryDeleted = COUNT(*) FROM DataSummaryHourly 
            WHERE HourTimestamp < DATEADD(day, -@SummaryRetentionDays, GETDATE());
            
            SET @SummaryDeleted = @SummaryDeleted + (
                SELECT COUNT(*) FROM DataSummaryDaily 
                WHERE DayTimestamp < DATEADD(day, -@SummaryRetentionDays, GETDATE())
            );
            
            PRINT 'Would delete ' + CAST(@SummaryDeleted as nvarchar(10)) + ' summary records';
        END
        ELSE
        BEGIN
            DELETE FROM DataSummaryHourly 
            WHERE HourTimestamp < DATEADD(day, -@SummaryRetentionDays, GETDATE());
            SET @SummaryDeleted = @@ROWCOUNT;
            
            DELETE FROM DataSummaryDaily 
            WHERE DayTimestamp < DATEADD(day, -@SummaryRetentionDays, GETDATE());
            SET @SummaryDeleted = @SummaryDeleted + @@ROWCOUNT;
            
            PRINT 'Deleted ' + CAST(@SummaryDeleted as nvarchar(10)) + ' summary records';
        END

        -- Data compression (keep every Nth record for old data)
        IF @DryRun = 0
        BEGIN
            -- Compress data older than 7 days (keep every 10th record)
            WITH CompressedData AS (
                SELECT LogID, 
                       ROW_NUMBER() OVER (PARTITION BY TagName, CAST(Timestamp as date) ORDER BY Timestamp) as RowNum
                FROM DataHistory
                WHERE Timestamp BETWEEN DATEADD(day, -30, GETDATE()) AND DATEADD(day, -7, GETDATE())
            )
            DELETE FROM DataHistory 
            WHERE LogID IN (
                SELECT LogID FROM CompressedData WHERE RowNum % 10 <> 1
            );
            
            SET @CompressedRecords = @@ROWCOUNT;
            PRINT 'Compressed ' + CAST(@CompressedRecords as nvarchar(10)) + ' data records';
        END

        -- Log cleanup operation
        IF @DryRun = 0
        BEGIN
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, Source, AdditionalData)
            VALUES ('DATA_CLEANUP', 'INFO', 
                    'Data cleanup completed successfully', 
                    'sp_CleanupOldData',
                    JSON_OBJECT(
                        'DataRecordsDeleted', @DataDeleted,
                        'AlarmRecordsDeleted', @AlarmDeleted, 
                        'EventRecordsDeleted', @EventDeleted,
                        'SummaryRecordsDeleted', @SummaryDeleted,
                        'CompressedRecords', @CompressedRecords
                    ));
        END

        -- Return cleanup results
        SELECT 
            @DataDeleted as DataRecordsDeleted,
            @AlarmDeleted as AlarmRecordsDeleted,
            @EventDeleted as EventRecordsDeleted,
            @SummaryDeleted as SummaryRecordsDeleted,
            @CompressedRecords as CompressedRecords,
            GETDATE() as CleanupTime,
            CASE WHEN @DryRun = 1 THEN 'DRY_RUN' ELSE 'SUCCESS' END as Status;
            
        PRINT '';
        PRINT 'Data cleanup completed successfully!';
        
    END TRY
    BEGIN CATCH
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, Source)
        VALUES ('CLEANUP_ERROR', 'ERROR', 
                'Data cleanup failed: ' + ERROR_MESSAGE(), 
                'sp_CleanupOldData');
        THROW;
    END CATCH
END
GO

-- Get comprehensive system statistics
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetSystemStatistics')
    DROP PROCEDURE sp_GetSystemStatistics;
GO

CREATE PROCEDURE sp_GetSystemStatistics
AS
BEGIN
    SET NOCOUNT ON;

    -- Overall statistics
    SELECT 
        'System Overview' as Category,
        COUNT(DISTINCT t.TagName) as ConfiguredTags,
        COUNT(DISTINCT CASE WHEN t.Enabled = 1 THEN t.TagName END) as ActiveTags,
        COUNT(DISTINCT t.GroupName) as TagGroups,
        COUNT(DISTINCT CASE WHEN t.LoggingEnabled = 1 THEN t.TagName END) as LoggedTags,
        COUNT(DISTINCT CASE WHEN t.AlarmEnabled = 1 THEN t.TagName END) as AlarmedTags
    FROM Tags t;

    -- Data logging statistics
    SELECT 
        'Data Logging' as Category,
        COUNT(*) as TotalDataRecords,
        COUNT(DISTINCT TagName) as TagsWithData,
        MIN(Timestamp) as OldestRecord,
        MAX(Timestamp) as NewestRecord,
        AVG(CAST(Quality as float)) as AverageQuality,
        COUNT(CASE WHEN Quality = 192 THEN 1 END) * 100.0 / COUNT(*) as GoodQualityPercentage
    FROM DataHistory
    WHERE Timestamp >= DATEADD(day, -30, GETDATE());

    -- Alarm statistics
    SELECT 
        'Alarms' as Category,
        COUNT(*) as TotalAlarms,
        COUNT(CASE WHEN AlarmState = 'ACTIVE' THEN 1 END) as ActiveAlarms,
        COUNT(CASE WHEN AlarmState = 'ACKNOWLEDGED' THEN 1 END) as AcknowledgedAlarms,
        COUNT(CASE WHEN AlarmState = 'CLEARED' THEN 1 END) as ClearedAlarms,
        COUNT(DISTINCT TagName) as TagsWithAlarms,
        AVG(CASE WHEN ClearedAt IS NOT NULL THEN DATEDIFF(minute, ActiveTime, ClearedAt) END) as AvgAlarmDurationMinutes
    FROM AlarmHistory
    WHERE ActiveTime >= DATEADD(day, -30, GETDATE());

    -- Top 10 most active tags (by data volume)
    SELECT TOP 10
        'Most Active Tags' as Category,
        TagName,
        COUNT(*) as DataPointCount,
        MIN(Timestamp) as FirstLog,
        MAX(Timestamp) as LastLog,
        AVG(EuValue) as AverageValue,
        STDEV(EuValue) as StandardDeviation
    FROM DataHistory
    WHERE Timestamp >= DATEADD(day, -7, GETDATE())
    GROUP BY TagName
    ORDER BY COUNT(*) DESC;

    -- Alarm summary by tag
    SELECT TOP 10
        'Most Alarmed Tags' as Category,
        ah.TagName,
        t.Description,
        t.GroupName,
        COUNT(*) as AlarmCount,
        COUNT(CASE WHEN ah.Severity = 'CRITICAL' THEN 1 END) as CriticalAlarms,
        COUNT(CASE WHEN ah.AlarmState = 'ACTIVE' THEN 1 END) as ActiveAlarms,
        MAX(ah.ActiveTime) as LastAlarmTime
    FROM AlarmHistory ah
    INNER JOIN Tags t ON ah.TagName = t.TagName
    WHERE ah.ActiveTime >= DATEADD(day, -30, GETDATE())
    GROUP BY ah.TagName, t.Description, t.GroupName
    ORDER BY COUNT(*) DESC;

    -- System events summary
    SELECT 
        EventCategory,
        COUNT(*) as EventCount,
        MAX(Timestamp) as LastEventTime
    FROM EventHistory
    WHERE Timestamp >= DATEADD(day, -7, GETDATE())
    GROUP BY EventCategory
    ORDER BY COUNT(*) DESC;

    -- Database size information
    SELECT 
        'Database Size' as Category,
        t.name as TableName,
        p.rows as RowCount,
        (a.total_pages * 8) / 1024.0 as SizeMB,
        (a.used_pages * 8) / 1024.0 as UsedSizeMB
    FROM sys.tables t
    INNER JOIN sys.indexes i ON t.object_id = i.object_id
    INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
    INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
    WHERE t.name IN ('Tags', 'DataHistory', 'AlarmHistory', 'EventHistory', 'DataSummaryHourly', 'DataSummaryDaily')
      AND i.index_id <= 1
    ORDER BY (a.total_pages * 8) / 1024.0 DESC;
END
GO

-- ===============================
-- FUNCTIONS FOR ENGINEERING UNITS
-- ===============================

PRINT 'Creating engineering units functions...';

-- Function to convert raw value to engineering units
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_RawToEu' AND type = 'FN')
    DROP FUNCTION fn_RawToEu;
GO

CREATE FUNCTION fn_RawToEu(@TagName nvarchar(100), @RawValue float)
RETURNS float
AS
BEGIN
    DECLARE @EuValue float;
    DECLARE @RawMin float, @RawMax float, @EuMin float, @EuMax float;
    DECLARE @ScalingType nvarchar(20);
    
    -- Get scaling parameters for the tag
    SELECT 
        @RawMin = RawMin, 
        @RawMax = RawMax, 
        @EuMin = EuMin, 
        @EuMax = EuMax,
        @ScalingType = ISNULL(ScalingType, 'LINEAR')
    FROM Tags 
    WHERE TagName = @TagName AND Enabled = 1;
    
    -- If tag not found or no scaling parameters, return raw value
    IF @RawMin IS NULL OR @RawMax IS NULL OR @EuMin IS NULL OR @EuMax IS NULL
    BEGIN
        RETURN @RawValue;
    END
    
    -- Handle different scaling types
    IF @ScalingType = 'LINEAR'
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
    ELSE IF @ScalingType = 'SQRT'
    BEGIN
        -- Square root scaling for flow measurements
        DECLARE @NormalizedValue float = (@RawValue - @RawMin) / (@RawMax - @RawMin);
        SET @EuValue = @EuMin + SQRT(ABS(@NormalizedValue)) * (@EuMax - @EuMin);
    END
    ELSE
    BEGIN
        -- Default to linear scaling for unknown types
        SET @EuValue = @EuMin + (@RawValue - @RawMin) * (@EuMax - @EuMin) / (@RawMax - @RawMin);
    END
    
    RETURN @EuValue;
END
GO

-- Function to convert engineering units to raw value
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_EuToRaw' AND type = 'FN')
    DROP FUNCTION fn_EuToRaw;
GO

CREATE FUNCTION fn_EuToRaw(@TagName nvarchar(100), @EuValue float)
RETURNS float
AS
BEGIN
    DECLARE @RawValue float;
    DECLARE @RawMin float, @RawMax float, @EuMin float, @EuMax float;
    DECLARE @ScalingType nvarchar(20);
    
    -- Get scaling parameters for the tag
    SELECT 
        @RawMin = RawMin, 
        @RawMax = RawMax, 
        @EuMin = EuMin, 
        @EuMax = EuMax,
        @ScalingType = ISNULL(ScalingType, 'LINEAR')
    FROM Tags 
    WHERE TagName = @TagName AND Enabled = 1;
    
    -- If tag not found or no scaling parameters, return EU value
    IF @RawMin IS NULL OR @RawMax IS NULL OR @EuMin IS NULL OR @EuMax IS NULL
    BEGIN
        RETURN @EuValue;
    END
    
    -- Handle different scaling types
    IF @ScalingType = 'LINEAR'
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
    ELSE IF @ScalingType = 'SQRT'
    BEGIN
        -- Inverse square root scaling
        DECLARE @EuNormalized float = (@EuValue - @EuMin) / (@EuMax - @EuMin);
        SET @RawValue = @RawMin + (POWER(@EuNormalized, 2) * (@RawMax - @RawMin));
    END
    ELSE
    BEGIN
        -- Default to linear scaling
        SET @RawValue = @RawMin + (@EuValue - @EuMin) * (@RawMax - @RawMin) / (@EuMax - @EuMin);
    END
    
    RETURN @RawValue;
END
GO

-- Function to validate S7 address format
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_ValidateS7Address' AND type = 'FN')
    DROP FUNCTION fn_ValidateS7Address;
GO

CREATE FUNCTION fn_ValidateS7Address(@Address nvarchar(50))
RETURNS bit
AS
BEGIN
    DECLARE @IsValid bit = 0;
    
    -- Basic validation for S7 address format
    IF @Address LIKE 'DB%,%' 
        OR @Address LIKE 'M%' 
        OR @Address LIKE 'I%' 
        OR @Address LIKE 'Q%'
        OR @Address LIKE 'MW%'
        OR @Address LIKE 'MD%'
        OR @Address LIKE 'IW%'
        OR @Address LIKE 'QW%'
        SET @IsValid = 1;
    
    RETURN @IsValid;
END
GO

-- Function to calculate tag availability percentage
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_CalculateTagAvailability' AND type = 'FN')
    DROP FUNCTION fn_CalculateTagAvailability;
GO

CREATE FUNCTION fn_CalculateTagAvailability(
    @TagName nvarchar(100), 
    @StartDate datetime2, 
    @EndDate datetime2
)
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

-- ===============================
-- TRIGGERS FOR AUTOMATION
-- ===============================

PRINT 'Creating database triggers...';

-- Trigger to update modified date on Tags table
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_Tags_UpdateModified')
    DROP TRIGGER tr_Tags_UpdateModified;
GO

CREATE TRIGGER tr_Tags_UpdateModified
ON Tags
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE Tags
    SET ModifiedDate = GETDATE(),
        ModifiedBy = SYSTEM_USER,
        Version = Version + 1
    FROM Tags t
    INNER JOIN inserted i ON t.TagID = i.TagID;
    
    -- Log significant changes
    INSERT INTO EventHistory (EventType, EventCategory, EventMessage, TagName, Username, Source, AdditionalData)
    SELECT 
        'TAG_MODIFIED',
        'INFO',
        'Tag configuration updated: ' + i.TagName,
        i.TagName,
        SYSTEM_USER,
        'Database_Trigger',
        JSON_OBJECT(
            'OldDescription', d.Description,
            'NewDescription', i.Description,
            'OldGroup', d.GroupName,
            'NewGroup', i.GroupName,
            'OldEnabled', d.Enabled,
            'NewEnabled', i.Enabled
        )
    FROM inserted i
    INNER JOIN deleted d ON i.TagID = d.TagID
    WHERE i.Description <> d.Description 
       OR i.GroupName <> d.GroupName 
       OR i.Enabled <> d.Enabled;
END
GO

-- Trigger to update LoggingConfiguration modified date
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_LoggingConfiguration_Update')
    DROP TRIGGER tr_LoggingConfiguration_Update;
GO

CREATE TRIGGER tr_LoggingConfiguration_Update
ON LoggingConfiguration
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE LoggingConfiguration
    SET ModifiedAt = GETDATE(),
        ModifiedBy = SYSTEM_USER
    FROM LoggingConfiguration lc
    INNER JOIN inserted i ON lc.ConfigID = i.ConfigID;
END
GO

-- Trigger for alarm state management
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_AlarmHistory_StateManagement')
    DROP TRIGGER tr_AlarmHistory_StateManagement;
GO

CREATE TRIGGER tr_AlarmHistory_StateManagement
ON AlarmHistory
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Update cleared timestamp when alarm is cleared
    UPDATE AlarmHistory
    SET ClearedAt = GETDATE()
    FROM AlarmHistory ah
    INNER JOIN inserted i ON ah.AlarmID = i.AlarmID
    INNER JOIN deleted d ON ah.AlarmID = d.AlarmID
    WHERE i.AlarmState = 'CLEARED' 
      AND d.AlarmState <> 'CLEARED' 
      AND ah.ClearedAt IS NULL;
      
    -- Update acknowledged timestamp when alarm is acknowledged
    UPDATE AlarmHistory
    SET AcknowledgedAt = GETDATE()
    FROM AlarmHistory ah
    INNER JOIN inserted i ON ah.AlarmID = i.AlarmID
    INNER JOIN deleted d ON ah.AlarmID = d.AlarmID
    WHERE i.AlarmState IN ('ACKNOWLEDGED') 
      AND d.AlarmState NOT IN ('ACKNOWLEDGED') 
      AND ah.AcknowledgedAt IS NULL;
END
GO

-- ===============================
-- SAMPLE DATA AND CONFIGURATION
-- ===============================

PRINT 'Inserting sample data and configuration...';

-- Insert system configuration
INSERT INTO SystemConfiguration (ConfigGroup, ConfigKey, ConfigValue, ConfigDescription, DataType, IsSystem)
VALUES 
    ('LOGGING', 'DefaultRetentionDays', '90', 'Default data retention period in days', 'INT', 1),
    ('LOGGING', 'MaxBatchSize', '1000', 'Maximum records per batch insert', 'INT', 1),
    ('LOGGING', 'AutoCleanupEnabled', 'true', 'Enable automatic data cleanup', 'BOOL', 1),
    ('LOGGING', 'CleanupSchedule', '02:00', 'Daily cleanup time (HH:MM format)', 'STRING', 1),
    ('ALARMS', 'AutoAcknowledgeTimeout', '24', 'Auto acknowledge alarms after N hours', 'INT', 1),
    ('ALARMS', 'FloodDetectionCount', '10', 'Number of alarms to trigger flood detection', 'INT', 1),
    ('ALARMS', 'FloodDetectionMinutes', '5', 'Time window for flood detection', 'INT', 1),
    ('SYSTEM', 'DatabaseVersion', '2.0.0', 'Database schema version', 'STRING', 1),
    ('SYSTEM', 'CreatedDate', CONVERT(nvarchar(50), GETDATE(), 120), 'Database creation timestamp', 'STRING', 1);

-- Insert enhanced sample tags with engineering units
IF NOT EXISTS (SELECT * FROM Tags WHERE TagName = 'Motor1_Running')
BEGIN
    EXEC sp_AddEnhancedTag 
        @TagName = 'Motor1_Running',
        @TagAddress = 'DB1,X0.0',
        @TagType = 'BOOL',
        @Description = 'Motor 1 Running Status - Main Production Motor',
        @GroupName = 'Motors',
        @RawMin = 0, @RawMax = 1, @EuMin = 0, @EuMax = 1,
        @EngineeringUnits = 'bool',
        @DecimalPlaces = 0,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Motor1_Speed',
        @TagAddress = 'DB1,REAL4',
        @TagType = 'REAL',
        @Description = 'Motor 1 Speed Feedback - Variable Frequency Drive',
        @GroupName = 'Motors',
        @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 3000,
        @EngineeringUnits = 'RPM',
        @DecimalPlaces = 0,
        @MinValue = 0, @MaxValue = 3000,
        @AlarmHigh = 2800, @AlarmLow = 100,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Motor1_Current',
        @TagAddress = 'DB1,REAL8',
        @TagType = 'REAL',
        @Description = 'Motor 1 Current Draw - 4-20mA Signal',
        @GroupName = 'Motors',
        @RawMin = 0, @RawMax = 32767, @EuMin = 4, @EuMax = 20,
        @EngineeringUnits = 'A',
        @DecimalPlaces = 2,
        @MinValue = 4, @MaxValue = 20,
        @AlarmHigh = 18, @AlarmLow = 4.5,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Tank1_Level',
        @TagAddress = 'DB2,REAL0',
        @TagType = 'REAL',
        @Description = 'Tank 1 Level Sensor - Hydrostatic Pressure',
        @GroupName = 'Sensors',
        @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 100,
        @EngineeringUnits = '%',
        @DecimalPlaces = 1,
        @MinValue = 0, @MaxValue = 100,
        @AlarmHigh = 95, @AlarmLow = 5,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Tank1_Temperature',
        @TagAddress = 'DB2,REAL4',
        @TagType = 'REAL',
        @Description = 'Tank 1 Temperature - RTD Pt100 Sensor',
        @GroupName = 'Sensors',
        @RawMin = 0, @RawMax = 32767, @EuMin = -20, @EuMax = 150,
        @EngineeringUnits = '°C',
        @DecimalPlaces = 1,
        @MinValue = -20, @MaxValue = 150,
        @AlarmHigh = 120, @AlarmLow = 0,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Tank1_Pressure',
        @TagAddress = 'DB2,REAL8',
        @TagType = 'REAL',
        @Description = 'Tank 1 Pressure - Differential Pressure Transmitter',
        @GroupName = 'Sensors',
        @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 10,
        @EngineeringUnits = 'bar',
        @DecimalPlaces = 2,
        @MinValue = 0, @MaxValue = 10,
        @AlarmHigh = 9, @AlarmLow = 0.5,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Flow1_Rate',
        @TagAddress = 'DB3,REAL0',
        @TagType = 'REAL',
        @Description = 'Flow Rate - Magnetic Flow Meter with Square Root Extraction',
        @GroupName = 'Flow',
        @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 1000,
        @EngineeringUnits = 'L/min',
        @DecimalPlaces = 1,
        @MinValue = 0, @MaxValue = 1000,
        @AlarmHigh = 950, @AlarmLow = 10,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    -- Update flow meter to use square root scaling
    UPDATE Tags 
    SET ScalingType = 'SQRT'
    WHERE TagName = 'Flow1_Rate';

    EXEC sp_AddEnhancedTag 
        @TagName = 'System_Pressure',
        @TagAddress = 'DB10,REAL0',
        @TagType = 'REAL',
        @Description = 'Main System Pressure - Critical Safety Parameter',
        @GroupName = 'System',
        @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 10,
        @EngineeringUnits = 'bar',
        @DecimalPlaces = 2,
        @MinValue = 0, @MaxValue = 10,
        @AlarmHigh = 9, @AlarmLow = 0.5,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    EXEC sp_AddEnhancedTag 
        @TagName = 'Emergency_Stop',
        @TagAddress = 'DB10,X8.0',
        @TagType = 'BOOL',
        @Description = 'Emergency Stop Status - Safety Critical',
        @GroupName = 'Safety',
        @RawMin = 0, @RawMax = 1, @EuMin = 0, @EuMax = 1,
        @EngineeringUnits = 'bool',
        @DecimalPlaces = 0,
        @AlarmEnabled = 1,
        @CreatedBy = 'SYSTEM_SETUP';

    PRINT 'Enhanced sample tags created successfully.';
END
ELSE
BEGIN
    PRINT 'Sample tags already exist - updating with engineering units if needed.';
    
    -- Update existing tags with engineering units if missing
    UPDATE Tags 
    SET RawMin = 0, RawMax = 32767, EuMin = 0, EuMax = 3000, EngineeringUnits = 'RPM'
    WHERE TagName = 'Motor1_Speed' AND EngineeringUnits IS NULL;
    
    UPDATE Tags 
    SET RawMin = 0, RawMax = 32767, EuMin = 4, EuMax = 20, EngineeringUnits = 'A'
    WHERE TagName LIKE '%Current' AND EngineeringUnits IS NULL;
    
    UPDATE Tags 
    SET RawMin = 0, RawMax = 32767, EuMin = -20, EuMax = 150, EngineeringUnits = '°C'
    WHERE TagName LIKE '%Temperature' AND EngineeringUnits IS NULL;
END

-- Insert sample historical data for demonstration
IF NOT EXISTS (SELECT * FROM DataHistory WHERE TagName = 'Motor1_Speed')
BEGIN
    PRINT 'Generating sample historical data...';
    
    DECLARE @StartTime datetime2 = DATEADD(hour, -48, GETDATE());
    DECLARE @CurrentTime datetime2 = @StartTime;
    DECLARE @EndTime datetime2 = GETDATE();
    DECLARE @Counter int = 0;
    
    WHILE @CurrentTime <= @EndTime AND @Counter < 1000
    BEGIN
        -- Generate realistic sample data with some variation
        EXEC sp_LogDataWithEU 
            @TagName = 'Motor1_Speed',
            @RawValue = 16000 + (RAND() * 8000) - 4000, -- Raw value varying around 16000
            @Quality = 192,
            @LogType = 'PERIODIC';
            
        EXEC sp_LogDataWithEU 
            @TagName = 'Tank1_Level',
            @RawValue = 16000 + (RAND() * 10000) - 5000, -- Raw value for 50% +/- 25%
            @Quality = 192,
            @LogType = 'PERIODIC';
            
        EXEC sp_LogDataWithEU 
            @TagName = 'Tank1_Temperature',
            @RawValue = 13000 + (RAND() * 6000) - 3000, -- Around 65°C +/- 15°C
            @Quality = 192,
            @LogType = 'PERIODIC';
            
        SET @CurrentTime = DATEADD(minute, 5, @CurrentTime);
        SET @Counter = @Counter + 1;
    END
    
    PRINT 'Sample historical data generated.';
END

-- Insert sample alarms
IF NOT EXISTS (SELECT * FROM AlarmHistory WHERE TagName = 'Motor1_Speed')
BEGIN
    PRINT 'Creating sample alarm history...';
    
    EXEC sp_LogAlarmWithEU
        @TagName = 'Motor1_Speed',
        @AlarmType = 'HIGH',
        @AlarmState = 'CLEARED',
        @CurrentValue = 2850,
        @LimitValue = 2800,
        @AlarmMessage = 'Motor 1 speed exceeded high limit during startup sequence',
        @Username = 'SYSTEM';
        
    -- Update alarm as cleared after 10 minutes
    UPDATE AlarmHistory 
    SET AlarmState = 'CLEARED', ClearedAt = DATEADD(minute, 10, ActiveTime)
    WHERE TagName = 'Motor1_Speed' AND AlarmType = 'HIGH';
    
    PRINT 'Sample alarm history created.';
END

-- ===============================
-- MAINTENANCE JOBS
-- ===============================

PRINT 'Setting up maintenance jobs...';

-- Generate initial hourly summaries
EXEC sp_GenerateHourlySummaries @HoursBack = 48;

-- Create job schedule information in system configuration
INSERT INTO SystemConfiguration (ConfigGroup, ConfigKey, ConfigValue, ConfigDescription, DataType, IsSystem)
VALUES 
    ('MAINTENANCE', 'HourlySummaryJob', '*/15 * * * *', 'Cron expression for hourly summary generation (every 15 minutes)', 'STRING', 1),
    ('MAINTENANCE', 'DataCleanupJob', '0 2 * * *', 'Cron expression for daily data cleanup (2 AM daily)', 'STRING', 1),
    ('MAINTENANCE', 'StatisticsUpdateJob', '0 */6 * * *', 'Cron expression for statistics update (every 6 hours)', 'STRING', 1);

-- Display setup completion summary
PRINT '';
PRINT '=== Enhanced Database Setup Complete ===';
PRINT '';

-- Show system statistics
EXEC sp_GetSystemStatistics;

-- Show configuration
SELECT 
    ConfigGroup,
    COUNT(*) as ConfigCount
FROM SystemConfiguration
GROUP BY ConfigGroup
ORDER BY ConfigGroup;

PRINT '';
PRINT '✅ SETUP COMPLETED SUCCESSFULLY!';
PRINT '';
PRINT '🏷️ Enhanced Features Available:';
PRINT '   • Engineering Units scaling (Linear, Square Root, Polynomial)';
PRINT '   • Comprehensive data logging with dual values (Raw + EU)';
PRINT '   • Advanced alarm management with hysteresis and priorities';
PRINT '   • Historical data summarization and trending';
PRINT '   • Automated data archival and cleanup';
PRINT '   • Performance optimization with indexes and views';
PRINT '   • Complete audit trail and event logging';
PRINT '   • Data quality tracking and availability metrics';
PRINT '';
PRINT '📊 Database Objects Created:';
PRINT '   • Tables: 8 (Tags, DataHistory, AlarmHistory, EventHistory, etc.)';
PRINT '   • Views: 4 (ActiveTags, RecentData, ActiveAlarms, RecentEvents)';
PRINT '   • Stored Procedures: 6 (Enhanced tag management, logging, cleanup)';
PRINT '   • Functions: 4 (EU conversion, validation, availability)';
PRINT '   • Triggers: 3 (Auto-update timestamps and audit logging)';
PRINT '';
PRINT '🔧 Connection Details:';
PRINT '   Server: localhost\SQLEXPRESS';
PRINT '   Database: PLCTags';
PRINT '   Authentication: Windows Authentication (default)';
PRINT '';
PRINT '📝 Next Steps:';
PRINT '   1. Configure your S7 client to use this database';
PRINT '   2. Customize tag configurations via sp_AddEnhancedTag';
PRINT '   3. Monitor system performance via sp_GetSystemStatistics';
PRINT '   4. Set up automated maintenance jobs (optional)';
PRINT '';
PRINT '⚙️ Key Stored Procedures:';
PRINT '   • EXEC sp_AddEnhancedTag - Add tags with engineering units';
PRINT '   • EXEC sp_LogDataWithEU - Log data with EU conversion';
PRINT '   • EXEC sp_GenerateHourlySummaries - Create trend data';
PRINT '   • EXEC sp_CleanupOldData - Maintain database size';
PRINT '   • EXEC sp_GetSystemStatistics - System health check';
PRINT '';

-- Show sample of what was created
SELECT TOP 5 
    TagName, 
    TagAddress, 
    TagType, 
    GroupName, 
    EngineeringUnits,
    CAST(EuMin as nvarchar(10)) + ' - ' + CAST(EuMax as nvarchar(10)) + ' ' + ISNULL(EngineeringUnits, '') as EuRange,
    Description
FROM Tags 
WHERE Enabled = 1
ORDER BY GroupName, TagName;

PRINT '';
PRINT 'Showing sample tags configuration...';
PRINT 'Database is ready for production use! 🚀';

GO
