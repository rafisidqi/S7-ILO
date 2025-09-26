-- SQL Server Express Database Setup Script for S7 Standalone Client
-- This script creates the database, tables, and sample data

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

-- Create Tags table
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
        ScalingFactor float DEFAULT 1.0,
        Units nvarchar(20),
        MinValue float,
        MaxValue float,
        AlarmHigh float,
        AlarmLow float,
        CreatedDate datetime2 DEFAULT GETDATE(),
        ModifiedDate datetime2 DEFAULT GETDATE()
    );
    
    PRINT 'Tags table created successfully.';
END
ELSE
BEGIN
    PRINT 'Tags table already exists.';
END
GO

-- Create indexes for better performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_TagName' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_TagName ON Tags(TagName);
    PRINT 'Index IX_Tags_TagName created.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_GroupName' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_GroupName ON Tags(GroupName);
    PRINT 'Index IX_Tags_GroupName created.';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_Enabled' AND object_id = OBJECT_ID('Tags'))
BEGIN
    CREATE INDEX IX_Tags_Enabled ON Tags(Enabled);
    PRINT 'Index IX_Tags_Enabled created.';
END
GO

-- Insert sample data
IF NOT EXISTS (SELECT * FROM Tags WHERE TagName = 'Motor1_Running')
BEGIN
    INSERT INTO Tags (TagName, TagAddress, TagType, Description, GroupName, Units)
    VALUES 
    ('Motor1_Running', 'DB1,X0.0', 'BOOL', 'Motor 1 Running Status', 'Motors', 'bool'),
    ('Motor1_Speed', 'DB1,REAL4', 'REAL', 'Motor 1 Speed Feedback', 'Motors', 'RPM'),
    ('Motor1_Current', 'DB1,REAL8', 'REAL', 'Motor 1 Current', 'Motors', 'A'),
    
    ('Motor2_Running', 'DB1,X0.1', 'BOOL', 'Motor 2 Running Status', 'Motors', 'bool'),
    ('Motor2_Speed', 'DB1,REAL12', 'REAL', 'Motor 2 Speed Feedback', 'Motors', 'RPM'),
    ('Motor2_Current', 'DB1,REAL16', 'REAL', 'Motor 2 Current', 'Motors', 'A'),
    
    ('Tank1_Level', 'DB2,REAL0', 'REAL', 'Tank 1 Level Sensor', 'Sensors', '%'),
    ('Tank1_Temperature', 'DB2,REAL4', 'REAL', 'Tank 1 Temperature', 'Sensors', '°C'),
    ('Tank1_Pressure', 'DB2,REAL8', 'REAL', 'Tank 1 Pressure', 'Sensors', 'bar'),
    
    ('Valve1_Position', 'DB3,REAL0', 'REAL', 'Valve 1 Position Feedback', 'Valves', '%'),
    ('Valve1_Command', 'DB3,REAL4', 'REAL', 'Valve 1 Position Command', 'Valves', '%'),
    ('Valve1_Manual', 'DB3,X8.0', 'BOOL', 'Valve 1 Manual Mode', 'Valves', 'bool'),
    
    ('Pump1_Running', 'DB4,X0.0', 'BOOL', 'Pump 1 Running Status', 'Pumps', 'bool'),
    ('Pump1_Speed', 'DB4,REAL4', 'REAL', 'Pump 1 Speed', 'Pumps', 'RPM'),
    ('Pump1_Flow', 'DB4,REAL8', 'REAL', 'Pump 1 Flow Rate', 'Pumps', 'L/min'),
    
    ('System_Pressure', 'DB10,REAL0', 'REAL', 'Main System Pressure', 'System', 'bar'),
    ('System_Temperature', 'DB10,REAL4', 'REAL', 'System Temperature', 'System', '°C'),
    ('Emergency_Stop', 'DB10,X8.0', 'BOOL', 'Emergency Stop Status', 'Safety', 'bool'),
    ('System_Ready', 'DB10,X8.1', 'BOOL', 'System Ready Status', 'System', 'bool'),
    ('Auto_Mode', 'DB10,X8.2', 'BOOL', 'Automatic Mode Active', 'System', 'bool');
    
    PRINT 'Sample data inserted successfully.';
END
ELSE
BEGIN
    PRINT 'Sample data already exists.';
END
GO

-- Update sample data with scaling factors and limits
UPDATE Tags SET 
    ScalingFactor = 1.0,
    MinValue = 0,
    MaxValue = 3000,
    AlarmHigh = 2800,
    AlarmLow = 100
WHERE TagName LIKE '%Speed';

UPDATE Tags SET 
    ScalingFactor = 1.0,
    MinValue = 0,
    MaxValue = 50,
    AlarmHigh = 45,
    AlarmLow = 0.5
WHERE TagName LIKE '%Current';

UPDATE Tags SET 
    ScalingFactor = 1.0,
    MinValue = 0,
    MaxValue = 100,
    AlarmHigh = 95,
    AlarmLow = 5
WHERE TagName LIKE '%Level' OR TagName LIKE '%Position';

UPDATE Tags SET 
    ScalingFactor = 1.0,
    MinValue = -20,
    MaxValue = 150,
    AlarmHigh = 120,
    AlarmLow = 0
WHERE TagName LIKE '%Temperature';

UPDATE Tags SET 
    ScalingFactor = 1.0,
    MinValue = 0,
    MaxValue = 10,
    AlarmHigh = 9,
    AlarmLow = 0.5
WHERE TagName LIKE '%Pressure';

UPDATE Tags SET 
    ScalingFactor = 1.0,
    MinValue = 0,
    MaxValue = 1000,
    AlarmHigh = 950,
    AlarmLow = 10
WHERE TagName LIKE '%Flow';

GO

-- Create a view for easy tag monitoring
IF EXISTS (SELECT * FROM sys.views WHERE name = 'ActiveTags')
BEGIN
    DROP VIEW ActiveTags;
END
GO

CREATE VIEW ActiveTags AS
SELECT 
    TagID,
    TagName,
    TagAddress,
    TagType,
    Description,
    GroupName,
    ScalingFactor,
    Units,
    MinValue,
    MaxValue,
    AlarmHigh,
    AlarmLow,
    CreatedDate,
    ModifiedDate
FROM Tags 
WHERE Enabled = 1;
GO

PRINT 'ActiveTags view created successfully.';

-- Create stored procedures for common operations

-- Procedure to add a new tag
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_AddTag')
BEGIN
    DROP PROCEDURE sp_AddTag;
END
GO

CREATE PROCEDURE sp_AddTag
    @TagName nvarchar(100),
    @TagAddress nvarchar(50),
    @TagType nvarchar(20) = 'REAL',
    @Description nvarchar(255) = NULL,
    @GroupName nvarchar(50) = 'Default',
    @ScalingFactor float = 1.0,
    @Units nvarchar(20) = NULL,
    @MinValue float = NULL,
    @MaxValue float = NULL,
    @AlarmHigh float = NULL,
    @AlarmLow float = NULL
AS
BEGIN
    BEGIN TRY
        INSERT INTO Tags (
            TagName, TagAddress, TagType, Description, GroupName,
            ScalingFactor, Units, MinValue, MaxValue, AlarmHigh, AlarmLow
        )
        VALUES (
            @TagName, @TagAddress, @TagType, @Description, @GroupName,
            @ScalingFactor, @Units, @MinValue, @MaxValue, @AlarmHigh, @AlarmLow
        );
        
        PRINT 'Tag ' + @TagName + ' added successfully.';
        SELECT SCOPE_IDENTITY() AS TagID;
    END TRY
    BEGIN CATCH
        PRINT 'Error adding tag: ' + ERROR_MESSAGE();
        THROW;
    END CATCH
END
GO

-- Procedure to get tags by group
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetTagsByGroup')
BEGIN
    DROP PROCEDURE sp_GetTagsByGroup;
END
GO

CREATE PROCEDURE sp_GetTagsByGroup
    @GroupName nvarchar(50)
AS
BEGIN
    SELECT * FROM ActiveTags 
    WHERE GroupName = @GroupName
    ORDER BY TagName;
END
GO

-- Procedure to get tag statistics
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetTagStatistics')
BEGIN
    DROP PROCEDURE sp_GetTagStatistics;
END
GO

CREATE PROCEDURE sp_GetTagStatistics
AS
BEGIN
    SELECT 
        'Total Tags' AS Metric,
        COUNT(*) AS Count
    FROM Tags
    
    UNION ALL
    
    SELECT 
        'Active Tags' AS Metric,
        COUNT(*) AS Count
    FROM Tags
    WHERE Enabled = 1
    
    UNION ALL
    
    SELECT 
        'Tag Groups' AS Metric,
        COUNT(DISTINCT GroupName) AS Count
    FROM Tags
    WHERE Enabled = 1;
    
    -- Group breakdown
    SELECT 
        GroupName,
        COUNT(*) AS TagCount,
        COUNT(CASE WHEN Enabled = 1 THEN 1 END) AS ActiveTags
    FROM Tags
    GROUP BY GroupName
    ORDER BY TagCount DESC;
END
GO

-- Create a function to validate tag addresses
IF EXISTS (SELECT * FROM sys.objects WHERE name = 'fn_ValidateS7Address' AND type = 'FN')
BEGIN
    DROP FUNCTION fn_ValidateS7Address;
END
GO

CREATE FUNCTION fn_ValidateS7Address(@Address nvarchar(50))
RETURNS bit
AS
BEGIN
    DECLARE @IsValid bit = 0;
    
    -- Basic validation for S7 address format
    IF @Address LIKE 'DB%,%' OR @Address LIKE 'M%' OR @Address LIKE 'I%' OR @Address LIKE 'Q%'
        SET @IsValid = 1;
    
    RETURN @IsValid;
END
GO

-- Display summary information
PRINT '';
PRINT '=== Database Setup Complete ===';
PRINT '';

-- Show tag statistics
EXEC sp_GetTagStatistics;

PRINT '';
PRINT 'Database setup completed successfully!';
PRINT 'Connection string example:';
PRINT 'server: localhost\SQLEXPRESS';
PRINT 'database: PLCTags';
PRINT 'table: Tags';
PRINT '';
PRINT 'Use Windows Authentication or create a SQL user for your application.';
PRINT '';

-- Show sample data
SELECT TOP 5 
    TagName, 
    TagAddress, 
    TagType, 
    GroupName, 
    Units,
    Description
FROM Tags 
ORDER BY GroupName, TagName;

PRINT 'Showing first 5 tags...';
GO
