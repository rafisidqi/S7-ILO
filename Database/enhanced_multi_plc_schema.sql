-- Enhanced SQL Server Express Database Setup Script for S7 Standalone Client
-- Multi-PLC Support with Dynamic Connection Management
-- Run this to create a complete multi-PLC database from scratch

-- Create database if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'IndolaktoWWTP')
BEGIN
    CREATE DATABASE IndolaktoWWTP;
    PRINT 'Database IndolaktoWWTP created successfully.';
END
ELSE
BEGIN
    PRINT 'Database IndolaktoWWTP already exists.';
END

GO

-- Use the IndolaktoWWTP database
USE [IndolaktoWWTP];
GO

PRINT '=== Creating Enhanced Multi-PLC S7 Database Schema ===';
PRINT 'This database supports:';
PRINT '- Multiple PLC connection management';
PRINT '- Engineering Units scaling and conversion per PLC';
PRINT '- Historical data logging with dual values (raw/EU)';
PRINT '- Comprehensive alarm management';
PRINT '- Event logging and audit trail';
PRINT '- Data summarization and performance optimization';
PRINT '- Automated data archival and cleanup';
PRINT '';

-- ===============================
-- PLC CONNECTION MANAGEMENT TABLES
-- ===============================

-- PLC Connection Information Table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PLCConnections' AND xtype='U')
BEGIN
    CREATE TABLE PLCConnections (
        PLCID int IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL UNIQUE,
        PLCDescription nvarchar(255),
        
        -- Connection Configuration (nodes7 compatible)
        Transport nvarchar(20) DEFAULT 'iso-on-tcp',
        IPAddress nvarchar(50) NOT NULL,
        Port int DEFAULT 102,
        Rack int DEFAULT 0,
        Slot int DEFAULT 2,
        ConnectionMode nvarchar(20) DEFAULT 'rack-slot', -- 'rack-slot' or 'tsap'
        
        -- TSAP Configuration (for TSAP mode)
        LocalTSAPHi nvarchar(2) DEFAULT '01',
        LocalTSAPLo nvarchar(2) DEFAULT '00',
        RemoteTSAPHi nvarchar(2) DEFAULT '01',
        RemoteTSAPLo nvarchar(2) DEFAULT '00',
        
        -- Connection Settings
        CycleTime int DEFAULT 1000,        -- Read cycle time in milliseconds
        Timeout int DEFAULT 2000,          -- Connection timeout
        MaxRetries int DEFAULT 3,          -- Connection retry attempts
        RetryDelay int DEFAULT 5000,       -- Delay between retries
        
        -- Status and Management
        Enabled bit DEFAULT 1,             -- Enable/disable this PLC connection
        AutoConnect bit DEFAULT 1,         -- Auto-connect on startup
        Priority int DEFAULT 5,            -- Connection priority (1=highest)
        
        -- Security
        RequiresAuth bit DEFAULT 0,        -- Future: authentication required
        AuthMethod nvarchar(20),           -- Future: authentication method
        
        -- Location and Context
        Location nvarchar(100),            -- Physical location
        Department nvarchar(50),           -- Department/area
        SystemType nvarchar(50),           -- Type of system (WWTP, Production, etc.)
        
        -- Connection Health Monitoring
        LastConnected datetime2,           -- Last successful connection
        LastDisconnected datetime2,        -- Last disconnection
        ConnectionAttempts int DEFAULT 0,  -- Total connection attempts
        SuccessfulConnections int DEFAULT 0, -- Successful connections
        FailedConnections int DEFAULT 0,   -- Failed connections
        
        -- Performance Metrics
        AverageResponseTime float,         -- Average response time in ms
        DataQualityPercent float,          -- Overall data quality percentage
        UptimePercent float,               -- Connection uptime percentage
        
        -- Maintenance
        MaintenanceMode bit DEFAULT 0,     -- Put PLC in maintenance mode
        MaintenanceReason nvarchar(500),   -- Reason for maintenance
        MaintenanceStarted datetime2,      -- When maintenance started
        MaintenanceBy nvarchar(100),       -- Who initiated maintenance
        
        -- Audit fields
        CreatedDate datetime2 DEFAULT GETDATE(),
        CreatedBy nvarchar(100) DEFAULT SYSTEM_USER,
        ModifiedDate datetime2 DEFAULT GETDATE(),
        ModifiedBy nvarchar(100) DEFAULT SYSTEM_USER,
        Version int DEFAULT 1,             -- For change tracking
        
        -- Constraints
        CONSTRAINT CK_PLCConnections_Port CHECK (Port BETWEEN 1 AND 65535),
        CONSTRAINT CK_PLCConnections_Rack CHECK (Rack BETWEEN 0 AND 7),
        CONSTRAINT CK_PLCConnections_Slot CHECK (Slot BETWEEN 0 AND 31),
        CONSTRAINT CK_PLCConnections_CycleTime CHECK (CycleTime >= 50),
        CONSTRAINT CK_PLCConnections_Priority CHECK (Priority BETWEEN 1 AND 10),
        CONSTRAINT CK_PLCConnections_ConnectionMode CHECK (ConnectionMode IN ('rack-slot', 'tsap'))
    );
    
    PRINT 'PLCConnections table created successfully.';
END
ELSE
BEGIN
    PRINT 'PLCConnections table already exists.';
END
GO

-- Real-time PLC Connection Status
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PLCConnectionStatus' AND xtype='U')
BEGIN
    CREATE TABLE PLCConnectionStatus (
        StatusID int IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL,
        
        -- Current Status
        IsConnected bit DEFAULT 0,
        ConnectionState nvarchar(20) DEFAULT 'OFFLINE', -- OFFLINE, CONNECTING, ONLINE, ERROR, MAINTENANCE
        LastStatusChange datetime2 DEFAULT GETDATE(),
        
        -- Performance Metrics
        CurrentCycleTime int,
        AverageResponseTime float,
        PacketsSent bigint DEFAULT 0,
        PacketsReceived bigint DEFAULT 0,
        PacketsLost bigint DEFAULT 0,
        ErrorCount bigint DEFAULT 0,
        
        -- Data Quality
        ActiveTags int DEFAULT 0,
        GoodQualityTags int DEFAULT 0,
        BadQualityTags int DEFAULT 0,
        LastDataUpdate datetime2,
        
        -- Session Information
        SessionStarted datetime2,
        SessionDuration as DATEDIFF(second, SessionStarted, GETDATE()),
        TotalUptime bigint DEFAULT 0,     -- Total uptime in seconds
        TotalDowntime bigint DEFAULT 0,   -- Total downtime in seconds
        
        -- Error Information
        LastError nvarchar(500),
        LastErrorTime datetime2,
        ErrorCategory nvarchar(50),       -- CONNECTION, COMMUNICATION, TIMEOUT, etc.
        
        -- Resources
        MemoryUsage float,                -- Memory usage in MB
        CPUUsage float,                   -- CPU usage percentage
        
        -- Timestamps
        StatusTimestamp datetime2 DEFAULT GETDATE(),
        
        CONSTRAINT FK_PLCConnectionStatus_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    -- Create unique index to ensure one status record per PLC
    CREATE UNIQUE INDEX IX_PLCConnectionStatus_PLCName ON PLCConnectionStatus(PLCName);
    
    PRINT 'PLCConnectionStatus table created successfully.';
END
ELSE
BEGIN
    PRINT 'PLCConnectionStatus table already exists.';
END
GO

-- Enhanced Tags table with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Tags' AND xtype='U')
BEGIN
    CREATE TABLE Tags (
        TagID int IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL, -- Reference to PLC
        TagName nvarchar(100) NOT NULL,
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
        RetentionDays int DEFAULT 3650,     -- How long to keep raw data
        
        -- Advanced features
        ScalingType nvarchar(20) DEFAULT 'LINEAR', -- LINEAR, SQRT, POLYNOMIAL, LOOKUP
        ScalingCoefficients nvarchar(500), -- JSON array for polynomial/custom scaling
        ValidationRules nvarchar(1000),   -- JSON validation rules
        
        -- Audit fields
        CreatedDate datetime2 DEFAULT GETDATE(),
        CreatedBy nvarchar(100) DEFAULT SYSTEM_USER,
        ModifiedDate datetime2 DEFAULT GETDATE(),
        ModifiedBy nvarchar(100) DEFAULT SYSTEM_USER,
        Version int DEFAULT 1,            -- For change tracking
        
        -- Constraints
        CONSTRAINT UQ_Tags_PLCName_TagName UNIQUE(PLCName, TagName),
        CONSTRAINT FK_Tags_PLCConnections FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'Enhanced Tags table with PLC reference created successfully.';
END
ELSE
BEGIN
    PRINT 'Tags table already exists.';
END
GO

-- Enhanced DataHistory table with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataHistory' AND xtype='U')
BEGIN
    CREATE TABLE DataHistory (
        LogID bigint IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL,   -- PLC reference
        TagName nvarchar(100) NOT NULL,
        RawValue float NOT NULL,           -- Original value from PLC
        EuValue float NOT NULL,            -- Scaled engineering unit value
        Quality int DEFAULT 192,           -- 192 = Good quality (OPC standard)
        Timestamp datetime2 DEFAULT GETDATE(),
        LogType nvarchar(20) DEFAULT 'PERIODIC', -- PERIODIC, CHANGE, MANUAL, ALARM, WRITE
        
        CONSTRAINT FK_DataHistory_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'Enhanced DataHistory table with PLC reference created successfully.';
END
ELSE
BEGIN
    PRINT 'DataHistory table already exists.';
END
GO

-- Enhanced AlarmHistory table with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AlarmHistory' AND xtype='U')
BEGIN
    CREATE TABLE AlarmHistory (
        AlarmID bigint IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL,   -- PLC reference
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
        Timestamp datetime2 DEFAULT GETDATE(),
        
        CONSTRAINT FK_AlarmHistory_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'Enhanced AlarmHistory table with PLC reference created successfully.';
END
ELSE
BEGIN
    PRINT 'AlarmHistory table already exists.';
END
GO

-- Enhanced EventHistory table with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EventHistory' AND xtype='U')
BEGIN
    CREATE TABLE EventHistory (
        EventID bigint IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100),            -- PLC reference (nullable for system events)
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
        Timestamp datetime2 DEFAULT GETDATE(),
        
        CONSTRAINT FK_EventHistory_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'Enhanced EventHistory table with PLC reference created successfully.';
END
ELSE
BEGIN
    PRINT 'EventHistory table already exists.';
END
GO

-- Enhanced summary tables with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryHourly' AND xtype='U')
BEGIN
    CREATE TABLE DataSummaryHourly (
        SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL,
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
        
        CONSTRAINT UQ_DataSummaryHourly_PLC_Tag_Hour UNIQUE(PLCName, TagName, HourTimestamp),
        CONSTRAINT FK_DataSummaryHourly_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'DataSummaryHourly table with PLC reference created successfully.';
END
GO

-- Daily data summaries with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DataSummaryDaily' AND xtype='U')
BEGIN
    CREATE TABLE DataSummaryDaily (
        SummaryID bigint IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL,
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
        
        CONSTRAINT UQ_DataSummaryDaily_PLC_Tag_Day UNIQUE(PLCName, TagName, DayTimestamp),
        CONSTRAINT FK_DataSummaryDaily_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'DataSummaryDaily table with PLC reference created successfully.';
END
GO

-- Logging configuration per tag with PLC reference
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='LoggingConfiguration' AND xtype='U')
BEGIN
    CREATE TABLE LoggingConfiguration (
        ConfigID int IDENTITY(1,1) PRIMARY KEY,
        PLCName nvarchar(100) NOT NULL,
        TagName nvarchar(100) NOT NULL,
        
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
        ModifiedBy nvarchar(100) DEFAULT SYSTEM_USER,
        
        -- Constraints
        CONSTRAINT UQ_LoggingConfiguration_PLC_Tag UNIQUE(PLCName, TagName),
        CONSTRAINT FK_LoggingConfiguration_PLCConnections 
            FOREIGN KEY (PLCName) REFERENCES PLCConnections(PLCName)
            ON UPDATE CASCADE ON DELETE CASCADE
    );
    
    PRINT 'LoggingConfiguration table with PLC reference created successfully.';
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

-- ===============================
-- STORED PROCEDURES FOR MULTI-PLC
-- ===============================

PRINT 'Creating stored procedures for multi-PLC management...';

-- Procedure to add/update PLC connection
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_AddPLCConnection')
    DROP PROCEDURE sp_AddPLCConnection;
GO

CREATE PROCEDURE sp_AddPLCConnection
    @PLCName nvarchar(100),
    @PLCDescription nvarchar(255) = NULL,
    @IPAddress nvarchar(50),
    @Port int = 102,
    @Rack int = 0,
    @Slot int = 2,
    @Transport nvarchar(20) = 'iso-on-tcp',
    @ConnectionMode nvarchar(20) = 'rack-slot',
    @CycleTime int = 1000,
    @Timeout int = 2000,
    @Enabled bit = 1,
    @AutoConnect bit = 1,
    @Priority int = 5,
    @Location nvarchar(100) = NULL,
    @Department nvarchar(50) = NULL,
    @SystemType nvarchar(50) = NULL,
    @CreatedBy nvarchar(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- Set defaults
        IF @CreatedBy IS NULL SET @CreatedBy = SYSTEM_USER;
        IF @PLCDescription IS NULL SET @PLCDescription = 'PLC Connection: ' + @PLCName;
        
        -- Check if PLC already exists
        IF EXISTS (SELECT 1 FROM PLCConnections WHERE PLCName = @PLCName)
        BEGIN
            -- Update existing PLC
            UPDATE PLCConnections
            SET PLCDescription = @PLCDescription,
                IPAddress = @IPAddress,
                Port = @Port,
                Rack = @Rack,
                Slot = @Slot,
                Transport = @Transport,
                ConnectionMode = @ConnectionMode,
                CycleTime = @CycleTime,
                Timeout = @Timeout,
                Enabled = @Enabled,
                AutoConnect = @AutoConnect,
                Priority = @Priority,
                Location = @Location,
                Department = @Department,
                SystemType = @SystemType,
                ModifiedDate = GETDATE(),
                ModifiedBy = @CreatedBy,
                Version = Version + 1
            WHERE PLCName = @PLCName;
            
            -- Log the event
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, Username, Source)
            VALUES ('PLC_UPDATED', 'INFO', 'PLC connection ' + @PLCName + ' updated successfully', @PLCName, @CreatedBy, 'sp_AddPLCConnection');
            
            SELECT 'UPDATED' as Action, @PLCName as PLCName, 'SUCCESS' as Status;
        END
        ELSE
        BEGIN
            -- Insert new PLC
            INSERT INTO PLCConnections (
                PLCName, PLCDescription, IPAddress, Port, Rack, Slot,
                Transport, ConnectionMode, CycleTime, Timeout,
                Enabled, AutoConnect, Priority, Location, Department, SystemType,
                CreatedBy, ModifiedBy
            )
            VALUES (
                @PLCName, @PLCDescription, @IPAddress, @Port, @Rack, @Slot,
                @Transport, @ConnectionMode, @CycleTime, @Timeout,
                @Enabled, @AutoConnect, @Priority, @Location, @Department, @SystemType,
                @CreatedBy, @CreatedBy
            );
            
            -- Create initial status record
            INSERT INTO PLCConnectionStatus (PLCName, IsConnected, ConnectionState)
            VALUES (@PLCName, 0, 'OFFLINE');
            
            -- Log the event
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, Username, Source)
            VALUES ('PLC_CREATED', 'INFO', 'PLC connection ' + @PLCName + ' created successfully', @PLCName, @CreatedBy, 'sp_AddPLCConnection');
            
            SELECT 'CREATED' as Action, @PLCName as PLCName, 'SUCCESS' as Status;
        END
        
    END TRY
    BEGIN CATCH
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, Source)
        VALUES ('PLC_ERROR', 'ERROR', 'Failed to add/update PLC ' + @PLCName + ': ' + ERROR_MESSAGE(), @PLCName, 'sp_AddPLCConnection');
        
        SELECT 'ERROR' as Action, @PLCName as PLCName, 'ERROR: ' + ERROR_MESSAGE() as Status;
        THROW;
    END CATCH
END
GO

-- Procedure to update PLC connection status
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_UpdatePLCStatus')
    DROP PROCEDURE sp_UpdatePLCStatus;
GO

CREATE PROCEDURE sp_UpdatePLCStatus
    @PLCName nvarchar(100),
    @IsConnected bit,
    @ConnectionState nvarchar(20) = NULL,
    @CurrentCycleTime int = NULL,
    @ResponseTime float = NULL,
    @ActiveTags int = NULL,
    @GoodQualityTags int = NULL,
    @BadQualityTags int = NULL,
    @ErrorMessage nvarchar(500) = NULL,
    @ErrorCategory nvarchar(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- Set default connection state based on connected status
        IF @ConnectionState IS NULL
            SET @ConnectionState = CASE WHEN @IsConnected = 1 THEN 'ONLINE' ELSE 'OFFLINE' END;
        
        -- Update or insert status record
        IF EXISTS (SELECT 1 FROM PLCConnectionStatus WHERE PLCName = @PLCName)
        BEGIN
            UPDATE PLCConnectionStatus
            SET IsConnected = @IsConnected,
                ConnectionState = @ConnectionState,
                LastStatusChange = GETDATE(),
                CurrentCycleTime = COALESCE(@CurrentCycleTime, CurrentCycleTime),
                AverageResponseTime = COALESCE(@ResponseTime, AverageResponseTime),
                ActiveTags = COALESCE(@ActiveTags, ActiveTags),
                GoodQualityTags = COALESCE(@GoodQualityTags, GoodQualityTags),
                BadQualityTags = COALESCE(@BadQualityTags, BadQualityTags),
                LastDataUpdate = CASE WHEN @IsConnected = 1 THEN GETDATE() ELSE LastDataUpdate END,
                LastError = COALESCE(@ErrorMessage, LastError),
                LastErrorTime = CASE WHEN @ErrorMessage IS NOT NULL THEN GETDATE() ELSE LastErrorTime END,
                ErrorCategory = COALESCE(@ErrorCategory, ErrorCategory),
                StatusTimestamp = GETDATE()
            WHERE PLCName = @PLCName;
        END
        ELSE
        BEGIN
            INSERT INTO PLCConnectionStatus (
                PLCName, IsConnected, ConnectionState, CurrentCycleTime,
                AverageResponseTime, ActiveTags, GoodQualityTags, BadQualityTags,
                LastError, ErrorCategory, SessionStarted
            )
            VALUES (
                @PLCName, @IsConnected, @ConnectionState, @CurrentCycleTime,
                @ResponseTime, @ActiveTags, @GoodQualityTags, @BadQualityTags,
                @ErrorMessage, @ErrorCategory, CASE WHEN @IsConnected = 1 THEN GETDATE() ELSE NULL END
            );
        END
        
        -- Update main PLC table statistics
        UPDATE PLCConnections
        SET LastConnected = CASE WHEN @IsConnected = 1 THEN GETDATE() ELSE LastConnected END,
            LastDisconnected = CASE WHEN @IsConnected = 0 THEN GETDATE() ELSE LastDisconnected END,
            ConnectionAttempts = ConnectionAttempts + 1,
            SuccessfulConnections = SuccessfulConnections + CASE WHEN @IsConnected = 1 THEN 1 ELSE 0 END,
            FailedConnections = FailedConnections + CASE WHEN @IsConnected = 0 AND @ErrorMessage IS NOT NULL THEN 1 ELSE 0 END,
            AverageResponseTime = COALESCE(@ResponseTime, AverageResponseTime),
            ModifiedDate = GETDATE()
        WHERE PLCName = @PLCName;
        
        -- Log significant status changes
        IF @IsConnected = 1 AND @ConnectionState = 'ONLINE'
        BEGIN
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, Source)
            VALUES ('PLC_CONNECTED', 'INFO', 'PLC ' + @PLCName + ' connected successfully', @PLCName, 'sp_UpdatePLCStatus');
        END
        ELSE IF @IsConnected = 0 OR @ConnectionState = 'OFFLINE'
        BEGIN
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, Source)
            VALUES ('PLC_DISCONNECTED', 'WARNING', 
                    'PLC ' + @PLCName + ' disconnected' + COALESCE(' - ' + @ErrorMessage, ''), 
                    @PLCName, 'sp_UpdatePLCStatus');
        END
        
        SELECT 'SUCCESS' as Status, @PLCName as PLCName, @ConnectionState as ConnectionState;
        
    END TRY
    BEGIN CATCH
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, Source)
        VALUES ('PLC_STATUS_ERROR', 'ERROR', 
                'Failed to update PLC status for ' + @PLCName + ': ' + ERROR_MESSAGE(), 
                @PLCName, 'sp_UpdatePLCStatus');
        THROW;
    END CATCH
END
GO

-- Enhanced procedure to add tags with PLC reference
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_AddEnhancedTagWithPLC')
    DROP PROCEDURE sp_AddEnhancedTagWithPLC;
GO

CREATE PROCEDURE sp_AddEnhancedTagWithPLC
    @PLCName nvarchar(100),
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
        
        -- Validate PLC exists
        IF NOT EXISTS (SELECT 1 FROM PLCConnections WHERE PLCName = @PLCName)
        BEGIN
            RAISERROR('PLC "%s" does not exist. Please create the PLC connection first.', 16, 1, @PLCName);
            RETURN;
        END
        
        -- Check if tag already exists for this PLC
        IF EXISTS (SELECT 1 FROM Tags WHERE PLCName = @PLCName AND TagName = @TagName)
        BEGIN
            -- Update existing tag
            UPDATE Tags
            SET TagAddress = @TagAddress,
                TagType = @TagType,
                Description = @Description,
                GroupName = @GroupName,
                RawMin = @RawMin,
                RawMax = @RawMax,
                EuMin = @EuMin,
                EuMax = @EuMax,
                EngineeringUnits = @EngineeringUnits,
                DecimalPlaces = @DecimalPlaces,
                MinValue = @MinValue,
                MaxValue = @MaxValue,
                AlarmHigh = @AlarmHigh,
                AlarmLow = @AlarmLow,
                AlarmEnabled = @AlarmEnabled,
                LoggingEnabled = @LoggingEnabled,
                ModifiedBy = @CreatedBy,
                ModifiedDate = GETDATE(),
                Version = Version + 1
            WHERE PLCName = @PLCName AND TagName = @TagName;
            
            -- Log the event
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, TagName, Username, Source)
            VALUES ('TAG_UPDATED', 'INFO', 'Enhanced tag ' + @TagName + ' updated for PLC ' + @PLCName, @PLCName, @TagName, @CreatedBy, 'sp_AddEnhancedTagWithPLC');
            
            SELECT 'UPDATED' as Action, SCOPE_IDENTITY() AS TagID, @PLCName as PLCName, @TagName AS TagName, 'SUCCESS' AS Status;
        END
        ELSE
        BEGIN
            -- Insert new tag
            INSERT INTO Tags (
                PLCName, TagName, TagAddress, TagType, Description, GroupName,
                RawMin, RawMax, EuMin, EuMax, EngineeringUnits, DecimalPlaces,
                MinValue, MaxValue, AlarmHigh, AlarmLow, AlarmEnabled,
                LoggingEnabled, CreatedBy, ModifiedBy
            )
            VALUES (
                @PLCName, @TagName, @TagAddress, @TagType, @Description, @GroupName,
                @RawMin, @RawMax, @EuMin, @EuMax, @EngineeringUnits, @DecimalPlaces,
                @MinValue, @MaxValue, @AlarmHigh, @AlarmLow, @AlarmEnabled,
                @LoggingEnabled, @CreatedBy, @CreatedBy
            );
            
            -- Create logging configuration
            INSERT INTO LoggingConfiguration (PLCName, TagName, EnableLogging, CreatedAt)
            VALUES (@PLCName, @TagName, @LoggingEnabled, GETDATE());
            
            -- Log the event
            INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, TagName, Username, Source)
            VALUES ('TAG_CREATED', 'INFO', 'Enhanced tag ' + @TagName + ' created for PLC ' + @PLCName, @PLCName, @TagName, @CreatedBy, 'sp_AddEnhancedTagWithPLC');
            
            SELECT 'CREATED' as Action, SCOPE_IDENTITY() AS TagID, @PLCName as PLCName, @TagName AS TagName, 'SUCCESS' AS Status;
        END
        
    END TRY
    BEGIN CATCH
        INSERT INTO EventHistory (EventType, EventCategory, EventMessage, PLCName, TagName, Source)
        VALUES ('TAG_ERROR', 'ERROR', 'Failed to add/update tag ' + @TagName + ' for PLC ' + @PLCName + ': ' + ERROR_MESSAGE(), @PLCName, @TagName, 'sp_AddEnhancedTagWithPLC');
        
        SELECT 'ERROR' as Action, NULL AS TagID, @PLCName as PLCName, @TagName AS TagName, 'ERROR: ' + ERROR_MESSAGE() AS Status;
        THROW;
    END CATCH
END
GO

-- Procedure to get PLC configuration for nodes7
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetPLCConfiguration')
    DROP PROCEDURE sp_GetPLCConfiguration;
GO

CREATE PROCEDURE sp_GetPLCConfiguration
    @PLCName nvarchar(100) = NULL,
    @EnabledOnly bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        plc.PLCName,
        plc.PLCDescription,
        plc.Transport,
        plc.IPAddress,
        plc.Port,
        plc.Rack,
        plc.Slot,
        plc.ConnectionMode,
        plc.LocalTSAPHi,
        plc.LocalTSAPLo,
        plc.RemoteTSAPHi,
        plc.RemoteTSAPLo,
        plc.CycleTime,
        plc.Timeout,
        plc.MaxRetries,
        plc.RetryDelay,
        plc.AutoConnect,
        plc.Priority,
        plc.Location,
        plc.Department,
        plc.SystemType,
        plc.MaintenanceMode,
        
        -- Connection status
        COALESCE(status.IsConnected, 0) as IsConnected,
        COALESCE(status.ConnectionState, 'OFFLINE') as ConnectionState,
        status.LastStatusChange,
        
        -- Tag counts
        (SELECT COUNT(*) FROM Tags t WHERE t.PLCName = plc.PLCName AND t.Enabled = 1) as ActiveTagCount,
        
        -- Performance metrics
        plc.AverageResponseTime,
        plc.UptimePercent,
        plc.DataQualityPercent
        
    FROM PLCConnections plc
    LEFT JOIN PLCConnectionStatus status ON plc.PLCName = status.PLCName
    WHERE (@PLCName IS NULL OR plc.PLCName = @PLCName)
      AND (@EnabledOnly = 0 OR plc.Enabled = 1)
    ORDER BY plc.Priority, plc.PLCName;
END
GO

-- Enhanced procedure to get tags for specific PLC
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetTagsForPLC')
    DROP PROCEDURE sp_GetTagsForPLC;
GO

CREATE PROCEDURE sp_GetTagsForPLC
    @PLCName nvarchar(100),
    @EnabledOnly bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        t.TagID,
        t.PLCName,
        t.TagName,
        t.TagAddress,
        t.TagType,
        t.Description,
        t.GroupName,
        t.Enabled,
        
        -- Engineering Units Configuration
        t.RawMin,
        t.RawMax,
        t.EuMin,
        t.EuMax,
        t.EngineeringUnits,
        t.DecimalPlaces,
        t.FormatString,
        
        -- Limits and Alarms
        t.MinValue,
        t.MaxValue,
        t.AlarmHigh,
        t.AlarmLow,
        t.AlarmHighHigh,
        t.AlarmLowLow,
        t.AlarmDeadband,
        t.AlarmEnabled,
        t.AlarmPriority,
        
        -- Logging Configuration
        t.LoggingEnabled,
        t.LogOnChange,
        t.ChangeThreshold,
        t.MaxLogRate,
        t.TrendingEnabled,
        t.RetentionDays,
        
        -- Advanced Features
        t.ScalingType,
        t.ScalingCoefficients,
        t.ValidationRules,
        
        -- PLC Information
        plc.PLCDescription,
        plc.IPAddress,
        plc.Location,
        plc.Department,
        
        -- Timestamps
        t.CreatedDate,
        t.ModifiedDate,
        t.Version
        
    FROM Tags t
    INNER JOIN PLCConnections plc ON t.PLCName = plc.PLCName
    WHERE t.PLCName = @PLCName
      AND (@EnabledOnly = 0 OR (t.Enabled = 1 AND plc.Enabled = 1))
    ORDER BY t.GroupName, t.TagName;
END
GO

-- ===============================
-- SAMPLE DATA FOR MULTI-PLC
-- ===============================

PRINT 'Inserting sample PLC connections and tags...';

-- Insert sample PLC connections
EXEC sp_AddPLCConnection 
    @PLCName = 'WWTP_Main_PLC',
    @PLCDescription = 'Main WWTP Control PLC - Primary Processes',
    @IPAddress = '192.168.1.10',
    @Port = 102,
    @Rack = 0,
    @Slot = 2,
    @CycleTime = 1000,
    @Priority = 1,
    @Location = 'Control Room A',
    @Department = 'Operations',
    @SystemType = 'WWTP_Primary',
    @CreatedBy = 'SYSTEM_SETUP';

EXEC sp_AddPLCConnection 
    @PLCName = 'WWTP_Secondary_PLC',
    @PLCDescription = 'Secondary WWTP PLC - Aeration and Clarification',
    @IPAddress = '192.168.1.11',
    @Port = 102,
    @Rack = 0,
    @Slot = 2,
    @CycleTime = 2000,
    @Priority = 2,
    @Location = 'Aeration Building',
    @Department = 'Operations',
    @SystemType = 'WWTP_Secondary',
    @CreatedBy = 'SYSTEM_SETUP';

EXEC sp_AddPLCConnection 
    @PLCName = 'WWTP_Sludge_PLC',
    @PLCDescription = 'Sludge Processing PLC - Digestion and Dewatering',
    @IPAddress = '192.168.1.12',
    @Port = 102,
    @Rack = 0,
    @Slot = 2,
    @CycleTime = 5000,
    @Priority = 3,
    @Location = 'Sludge Processing Building',
    @Department = 'Operations',
    @SystemType = 'WWTP_Sludge',
    @CreatedBy = 'SYSTEM_SETUP';

-- Insert sample tags for Main PLC
EXEC sp_AddEnhancedTagWithPLC 
    @PLCName = 'WWTP_Main_PLC',
    @TagName = 'Influent_Flow',
    @TagAddress = 'DB1,REAL0',
    @TagType = 'REAL',
    @Description = 'Influent Flow Rate - Main Inlet',
    @GroupName = 'Influent',
    @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 500,
    @EngineeringUnits = 'L/s',
    @DecimalPlaces = 1,
    @MinValue = 0, @MaxValue = 500,
    @AlarmHigh = 450, @AlarmLow = 10,
    @AlarmEnabled = 1,
    @CreatedBy = 'SYSTEM_SETUP';

EXEC sp_AddEnhancedTagWithPLC 
    @PLCName = 'WWTP_Main_PLC',
    @TagName = 'Influent_pH',
    @TagAddress = 'DB1,REAL4',
    @TagType = 'REAL',
    @Description = 'Influent pH Level - Water Quality Monitoring',
    @GroupName = 'Water_Quality',
    @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 14,
    @EngineeringUnits = 'pH',
    @DecimalPlaces = 2,
    @MinValue = 0, @MaxValue = 14,
    @AlarmHigh = 9, @AlarmLow = 5,
    @AlarmEnabled = 1,
    @CreatedBy = 'SYSTEM_SETUP';

-- Insert sample tags for Secondary PLC
EXEC sp_AddEnhancedTagWithPLC 
    @PLCName = 'WWTP_Secondary_PLC',
    @TagName = 'Aeration_Tank_DO',
    @TagAddress = 'DB1,REAL0',
    @TagType = 'REAL',
    @Description = 'Dissolved Oxygen in Aeration Tank',
    @GroupName = 'Aeration',
    @RawMin = 0, @RawMax = 32767, @EuMin = 0, @EuMax = 20,
    @EngineeringUnits = 'mg/L',
    @DecimalPlaces = 2,
    @MinValue = 0, @MaxValue = 20,
    @AlarmHigh = 15, @AlarmLow = 2,
    @AlarmEnabled = 1,
    @CreatedBy = 'SYSTEM_SETUP';

-- Insert system configuration for multi-PLC support
INSERT INTO SystemConfiguration (ConfigGroup, ConfigKey, ConfigValue, ConfigDescription, DataType, IsSystem)
VALUES 
    ('MULTI_PLC', 'EnableMultiPLCSupport', 'true', 'Enable multiple PLC connection support', 'BOOL', 1),
    ('MULTI_PLC', 'MaxConcurrentConnections', '10', 'Maximum concurrent PLC connections', 'INT', 1),
    ('MULTI_PLC', 'ConnectionRetryInterval', '30', 'Retry interval for failed connections in seconds', 'INT', 1),
    ('MULTI_PLC', 'AutoReconnectEnabled', 'true', 'Enable automatic reconnection for failed PLCs', 'BOOL', 1),
    ('MULTI_PLC', 'HealthCheckInterval', '60', 'Health check interval for PLC connections in seconds', 'INT', 1),
    ('MULTI_PLC', 'PriorityBasedConnection', 'true', 'Connect to PLCs based on priority order', 'BOOL', 1),
    ('MULTI_PLC', 'DatabaseVersion', '2.1.0', 'Multi-PLC database schema version', 'STRING', 1);

-- ===============================
-- COMPLETION SUMMARY
-- ===============================

PRINT '';
PRINT '=== 🎉 ENHANCED MULTI-PLC SYSTEM SETUP COMPLETE! ===';
PRINT '';
PRINT '✅ What has been created:';
PRINT '';
PRINT '📊 Enhanced Database Schema:';
PRINT '   • PLCConnections table - Store multiple PLC configurations';
PRINT '   • PLCConnectionStatus table - Real-time connection monitoring';
PRINT '   • Enhanced Tags table with PLC references';
PRINT '   • Advanced stored procedures for PLC management';
PRINT '   • Multi-PLC views and functions';
PRINT '';
PRINT '🔧 Key Features:';
PRINT '   • Dynamic PLC connection management from database';
PRINT '   • Real-time data aggregation from multiple PLCs';
PRINT '   • Centralized alarm management across all PLCs';
PRINT '   • Health monitoring and automatic reconnection';
PRINT '   • Configuration import/export capabilities';
PRINT '   • Comprehensive monitoring dashboard';
PRINT '';
PRINT '🚀 Getting Started:';
PRINT '   1. Your database is now ready for multi-PLC operations';
PRINT '   2. Use MultiPLCManager.js for JavaScript integration';
PRINT '   3. Start with: npm run multi-plc';
PRINT '   4. Dashboard: http://localhost:3000';
PRINT '';
PRINT '📋 Key Stored Procedures:';
PRINT '   • EXEC sp_AddPLCConnection - Add PLC configurations';
PRINT '   • EXEC sp_GetPLCConfiguration - Get PLC configs';
PRINT '   • EXEC sp_AddEnhancedTagWithPLC - Add tags to PLCs';
PRINT '   • EXEC sp_UpdatePLCStatus - Update connection status';
PRINT '';
PRINT 'Your multi-PLC system is now ready for industrial deployment! 🏭';
GO