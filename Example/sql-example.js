const EnhancedS7ClientWithLogging = require('./EnhancedS7ClientWithLogging');

// Enhanced configuration for the new database schema
const config = {
    // S7 PLC Configuration
    transport: 'iso-on-tcp',
    address: '192.168.1.10',
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 5000,    // 5 seconds for demonstration
    timeout: 2000,
    connmode: 'rack-slot',

    // SQL Server Configuration - Updated for enhanced database
    sqlConfig: {
        server: 'localhost\\SQLEXPRESS',
        database: 'PLCTags',
        tagTable: 'Tags', // Enhanced table with engineering units
        cacheRefreshInterval: 30000,
        enableAutoRefresh: true,
        options: {
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true,
            instanceName: 'SQLEXPRESS'
        }
    },

    // Enhanced Logging Configuration - Works with new database schema
    loggingConfig: {
        // Enhanced logging tables (matching db.sql schema)
        dataTable: 'DataHistory',
        alarmTable: 'AlarmHistory',
        eventTable: 'EventHistory',
        summaryHourlyTable: 'DataSummaryHourly',
        summaryDailyTable: 'DataSummaryDaily',
        
        // Logging settings
        enableDataLogging: true,
        enableAlarmLogging: true,
        enableEventLogging: true,
        
        // Data logging options
        logInterval: 30000,          // Flush buffers every 30 seconds
        logOnChange: true,           // Log when values change significantly
        changeThreshold: 0.1,        // Minimum change to trigger logging
        maxBatchSize: 1000,          // Maximum records per batch
        
        // Data retention settings
        dataRetentionDays: 90,       // Keep data for 90 days
        alarmRetentionDays: 365,     // Keep alarms for 1 year
        eventRetentionDays: 30,      // Keep events for 30 days
        
        // Performance settings
        enableCompression: true,
        compressionRatio: 10,
        compressionAfterDays: 7
    }
};

async function main() {
    const client = new EnhancedS7ClientWithLogging(config);

    // Enhanced event handlers for the new system
    client.on('fully_initialized', () => {
        console.log('✅ Enhanced S7 Client with Advanced Logging fully initialized');
    });

    client.on('connected', () => {
        console.log('🔗 Connected to PLC');
    });

    client.on('sql_connected', () => {
        console.log('🔗 Connected to Enhanced SQL Server Database');
    });

    client.on('disconnected', () => {
        console.log('❌ Disconnected from PLC');
    });

    client.on('sql_disconnected', () => {
        console.log('❌ Disconnected from SQL Server');
    });

    client.on('tags_updated', (info) => {
        console.log(`🏷️ Enhanced tags updated: ${info.tagCount} tags, ${info.groupCount} groups`);
    });

    client.on('error', (error) => {
        console.error('❌ S7 Error:', error.message);
    });

    client.on('sql_error', (error) => {
        console.error('❌ SQL Error:', error.message);
    });

    client.on('logging_error', (error) => {
        console.error('❌ Logging Error:', error.message);
    });

    // Enhanced data events with engineering units
    client.on('enhanced_data', (data) => {
        // Display first few tags with engineering units
        const tagNames = Object.keys(data).slice(0, 3);
        tagNames.forEach(tagName => {
            const tagInfo = data[tagName];
            if (tagInfo.metadata) {
                console.log(`📊 ${tagName}: ${tagInfo.formattedValue} ${tagInfo.units} (Raw: ${tagInfo.rawValue})`);
                
                // Show scaling information
                if (tagInfo.metadata.scalingConfig) {
                    const scaling = tagInfo.metadata.scalingConfig;
                    console.log(`   Scaling: Raw[${scaling.rawMin}-${scaling.rawMax}] -> EU[${scaling.euMin}-${scaling.euMax}] (${scaling.type})`);
                }
            }
        });
    });

    // Advanced alarm events with engineering units
    client.on('alarm', (alarm) => {
        console.log(`🚨 ALARM [${alarm.severity}] ${alarm.type}: ${alarm.tagName} = ${alarm.value} ${alarm.units}`);
        console.log(`   Limit: ${alarm.limit} ${alarm.units}, Deviation: ${alarm.deviation?.toFixed(2)} ${alarm.units}`);
        console.log(`   State: ${alarm.state}, Priority: ${alarm.priority}, Group: ${alarm.alarmGroup}`);
    });

    // Logging events
    client.on('data_logged', (entry) => {
        // Only show occasional logging messages to avoid spam
        if (Math.random() < 0.1) { // Show 10% of log entries
            console.log(`📝 Logged: ${entry.tagName} = ${entry.euValue} (Raw: ${entry.rawValue})`);
        }
    });

    client.on('alarm_logged', (entry) => {
        console.log(`🔔 Alarm logged: ${entry.tagName} - ${entry.type} ${entry.state}`);
    });

    client.on('summaries_generated', (info) => {
        console.log(`📈 Generated ${info.count} ${info.type} summaries`);
    });

    client.on('cleanup_completed', (info) => {
        console.log(`🧹 Cleanup completed: ${JSON.stringify(info)}`);
    });

    client.on('tag_saved', (tagData) => {
        console.log(`💾 Enhanced tag saved: ${tagData.name}`);
    });

    client.on('tag_deleted', (tagName) => {
        console.log(`🗑️ Tag deleted: ${tagName}`);
    });

    try {
        // Initialize the enhanced system
        await client.initialize();

        // Display initial status with enhanced information
        const status = client.getEnhancedStatusWithLogging();
        console.log('\n📋 Enhanced System Status:');
        console.log(`   S7 Connection: ${status.s7.connected ? '✅' : '❌'}`);
        console.log(`   SQL Connection: ${status.sql.connected ? '✅' : '❌'}`);
        console.log(`   Data Logging: ${status.logging.enabled ? '✅' : '❌'}`);
        console.log(`   Tags Loaded: ${status.tags.count} tags in ${status.tags.groups} groups`);
        console.log(`   Engineering Units: ${status.engineeringUnits.supportedScaling.join(', ')}`);
        console.log(`   Features: ${Object.keys(status.logging.features).filter(k => status.logging.features[k]).join(', ')}`);

        // Display enhanced tag groups with engineering units info
        const groups = client.getTagGroups();
        console.log('\n🏷️ Enhanced Tag Groups:');
        groups.forEach(group => {
            const groupTags = client.getTagsByGroup(group);
            const euTags = groupTags.filter(tag => tag.engineeringUnits);
            console.log(`   ${group}: ${groupTags.length} tags (${euTags.length} with EU)`);
            
            // Show first tag details
            if (groupTags.length > 0) {
                const firstTag = groupTags[0];
                const euInfo = firstTag.scalingConfig ? 
                    `EU[${firstTag.scalingConfig.euMin}-${firstTag.scalingConfig.euMax}] ${firstTag.engineeringUnits}` : 
                    'No EU scaling';
                console.log(`     Sample: ${firstTag.name} - ${euInfo}`);
            }
        });

        // Example: Add a new enhanced tag with engineering units after 5 seconds
        setTimeout(async () => {
            try {
                console.log('\n➕ Adding new enhanced tag with engineering units...');
                await client.saveTag({
                    name: 'DEMO_TEMPERATURE',
                    addr: 'DB1,REAL200',
                    type: 'REAL',
                    description: 'Demo temperature sensor with 4-20mA scaling',
                    group: 'Demo',
                    
                    // Engineering units configuration
                    rawMin: 0,
                    rawMax: 32767,
                    euMin: -20,
                    euMax: 150,
                    engineeringUnits: '°C',
                    decimalPlaces: 1,
                    
                    // Scaling configuration
                    scalingConfig: {
                        type: 'LINEAR',
                        rawMin: 0,
                        rawMax: 32767,
                        euMin: -20,
                        euMax: 150
                    },
                    
                    // Alarm configuration
                    alarmConfig: {
                        enabled: true,
                        priority: 3,
                        limits: {
                            high: 100,
                            low: 0,
                            highHigh: 120,
                            lowLow: -10
                        }
                    },
                    
                    // Logging configuration
                    loggingConfig: {
                        enabled: true,
                        logOnChange: true,
                        changeThreshold: 0.5,
                        trendingEnabled: true
                    },
                    
                    // Operating limits
                    limits: {
                        min: -20,
                        max: 150,
                        alarmHigh: 100,
                        alarmLow: 0
                    }
                });
                console.log('✅ Enhanced tag with EU scaling added successfully');
                
            } catch (error) {
                console.error('❌ Error adding enhanced tag:', error.message);
            }
        }, 5000);

        // Example: Demonstrate enhanced write operations with EU values
        setTimeout(async () => {
            try {
                console.log('\n✏️ Demonstrating enhanced write operations...');
                
                // Get all available tags
                const allTags = Object.keys(client._vars);
                if (allTags.length > 0) {
                    // Write using engineering units (if supported)
                    const tempTags = allTags.filter(name => {
                        const meta = client.getTagMetadata(name);
                        return meta && meta.engineeringUnits && meta.engineeringUnits.includes('°C');
                    });
                    
                    if (tempTags.length > 0) {
                        await client.writeVariable(tempTags[0], 25.5, true); // Write 25.5°C as EU value
                        console.log(`✅ Wrote ${tempTags[0]} = 25.5°C (EU value)`);
                    }
                    
                    // Write using raw value
                    const boolTags = allTags.filter(name => {
                        const meta = client.getTagMetadata(name);
                        return meta && meta.type === 'BOOL';
                    });
                    
                    if (boolTags.length > 0) {
                        await client.writeVariable(boolTags[0], 1, false); // Write raw value
                        console.log(`✅ Wrote ${boolTags[0]} = 1 (Raw value)`);
                    }
                }
                
            } catch (error) {
                console.error('❌ Error writing enhanced variables:', error.message);
            }
        }, 8000);

        // Example: Display enhanced statistics after 12 seconds
        setTimeout(async () => {
            try {
                console.log('\n📊 Getting enhanced logging statistics...');
                
                const stats = await client.getLoggingStatistics();
                console.log('Enhanced Statistics:');
                console.log(`   System: ${stats.systemOverview.ConfiguredTags || 0} configured tags, ${stats.systemOverview.ActiveTags || 0} active`);
                console.log(`   Data: ${stats.dataLogging.TotalDataRecords || 0} records, ${stats.dataLogging.GoodQualityPercentage || 0}% good quality`);
                console.log(`   Alarms: ${stats.alarms.TotalAlarms || 0} total, ${stats.alarms.ActiveAlarms || 0} active`);
                
                // Show top active tags if available
                if (stats.topActiveTags && stats.topActiveTags.length > 0) {
                    console.log('   Top Active Tags:');
                    stats.topActiveTags.slice(0, 3).forEach(tag => {
                        console.log(`     ${tag.TagName}: ${tag.DataPointCount} data points`);
                    });
                }
                
            } catch (error) {
                console.error('❌ Error getting enhanced statistics:', error.message);
            }
        }, 12000);

        // Example: Demonstrate data export functionality
        setTimeout(async () => {
            try {
                console.log('\n📤 Demonstrating enhanced data export...');
                
                const allTags = Object.keys(client._vars);
                if (allTags.length > 0) {
                    const startDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
                    const endDate = new Date();
                    
                    // Get historical data for first tag
                    const historicalData = await client.getHistoricalData(allTags[0], startDate, endDate, 10);
                    console.log(`Historical data for ${allTags[0]}: ${historicalData.length} records`);
                    
                    if (historicalData.length > 0) {
                        console.log('Sample record:', {
                            timestamp: historicalData[0].Timestamp,
                            euValue: historicalData[0].EuValue,
                            rawValue: historicalData[0].RawValue,
                            units: historicalData[0].EngineeringUnits,
                            quality: historicalData[0].QualityText
                        });
                    }
                }
                
            } catch (error) {
                console.error('❌ Error getting historical data:', error.message);
            }
        }, 15000);

        // Example: Test alarm acknowledgment
        setTimeout(async () => {
            try {
                console.log('\n🔔 Testing alarm history and acknowledgment...');
                
                const alarmHistory = await client.getAlarmHistory(null, 5);
                console.log(`Found ${alarmHistory.length} recent alarms`);
                
                if (alarmHistory.length > 0) {
                    console.log('Recent alarm sample:', {
                        tagName: alarmHistory[0].TagName,
                        type: alarmHistory[0].AlarmType,
                        state: alarmHistory[0].AlarmState,
                        value: alarmHistory[0].FormattedCurrentValue,
                        severity: alarmHistory[0].Severity
                    });
                }
                
            } catch (error) {
                console.error('❌ Error getting alarm history:', error.message);
            }
        }, 18000);

    } catch (error) {
        console.error('❌ Initialization failed:', error.message);
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n🔄 Shutting down Enhanced S7 Client with Advanced Logging...');
        try {
            await client.disconnect();
            console.log('✅ Shutdown completed successfully');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during shutdown:', error.message);
            process.exit(1);
        }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    console.log('\n🚀 Enhanced S7 Client with Advanced Logging is running...');
    console.log('Features available:');
    console.log('  📊 Engineering Units scaling and conversion');
    console.log('  🚨 Advanced alarm management with hysteresis');
    console.log('  📝 Comprehensive data logging to SQL Server');
    console.log('  📈 Automatic data summarization and trending');
    console.log('  🧹 Automated data retention and cleanup');
    console.log('  ⚡ Real-time data processing and quality tracking');
    console.log('Press Ctrl+C to stop\n');
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

main().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});