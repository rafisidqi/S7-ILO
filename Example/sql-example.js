const EnhancedS7Client = require('./EnhancedS7Client');

// Configuration for Enhanced S7 Client with SQL support
const config = {
    // S7 PLC Configuration
    transport: 'iso-on-tcp',
    address: '192.168.1.10',
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 1000,
    timeout: 2000,
    connmode: 'rack-slot',

    // SQL Server Configuration
    sqlConfig: {
        // Connection settings
        server: 'localhost\\SQLEXPRESS',
        database: 'PLCTags',
        // user: 'plc_user',           // Optional: Use for SQL Server authentication
        // password: 'plc_password',   // Optional: Use for SQL Server authentication
        
        // Table configuration
        tagTable: 'Tags',
        
        // Cache settings
        cacheRefreshInterval: 30000,  // 30 seconds
        enableAutoRefresh: true,
        
        // Connection options
        options: {
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true,
            instanceName: 'SQLEXPRESS'
        }
    }
};

async function main() {
    const client = new EnhancedS7Client(config);

    // Enhanced event handlers
    client.on('initialized', () => {
        console.log('✅ Enhanced S7 Client fully initialized');
    });

    client.on('connected', () => {
        console.log('🔗 Connected to PLC');
    });

    client.on('sql_connected', () => {
        console.log('🔗 Connected to SQL Server');
    });

    client.on('disconnected', () => {
        console.log('❌ Disconnected from PLC');
    });

    client.on('sql_disconnected', () => {
        console.log('❌ Disconnected from SQL Server');
    });

    client.on('tags_updated', (info) => {
        console.log(`🏷️ Tags updated: ${info.tagCount} tags, ${info.groupCount} groups`);
    });

    client.on('error', (error) => {
        console.error('❌ S7 Error:', error.message);
    });

    client.on('sql_error', (error) => {
        console.error('❌ SQL Error:', error.message);
    });

    // Enhanced data events
    client.on('enhanced_data', (data) => {
        // Process enhanced data with scaling and metadata
        Object.entries(data).forEach(([tagName, tagInfo]) => {
            if (tagInfo.metadata) {
                const meta = tagInfo.metadata;
                console.log(`📊 ${tagName}: ${tagInfo.value}${meta.units || ''} (Raw: ${tagInfo.rawValue})`);
            }
        });
    });

    client.on('alarm', (alarm) => {
        console.log(`🚨 ALARM ${alarm.type}: ${alarm.tagName} = ${alarm.value}, Limit: ${alarm.limit}`);
    });

    client.on('tag_saved', (tagData) => {
        console.log(`💾 Tag saved: ${tagData.name}`);
    });

    client.on('tag_deleted', (tagName) => {
        console.log(`🗑️ Tag deleted: ${tagName}`);
    });

    try {
        // Initialize (connects to both SQL and PLC)
        await client.initialize();

        // Display initial status
        const status = client.getEnhancedStatus();
        console.log('\n📋 System Status:');
        console.log(`   S7 Connection: ${status.s7.connected ? '✅' : '❌'}`);
        console.log(`   SQL Connection: ${status.sql.connected ? '✅' : '❌'}`);
        console.log(`   Tags Loaded: ${status.tags.count} tags in ${status.tags.groups} groups`);

        // Display tag groups
        const groups = client.getTagGroups();
        console.log('\n🏷️ Tag Groups:');
        groups.forEach(group => {
            const groupTags = client.getTagsByGroup(group);
            console.log(`   ${group}: ${groupTags.length} tags`);
        });

        // Example: Add a new tag to database after 5 seconds
        setTimeout(async () => {
            try {
                console.log('\n➕ Adding new tag to database...');
                await client.saveTag({
                    name: 'NEW_TEMPERATURE',
                    addr: 'DB1,REAL100',
                    type: 'REAL',
                    description: 'Temperature sensor added dynamically',
                    group: 'Sensors',
                    scaling: 1.0,
                    units: '°C',
                    limits: {
                        min: -40,
                        max: 120,
                        alarmHigh: 80,
                        alarmLow: 5
                    }
                });
                console.log('✅ New tag added successfully');
                
            } catch (error) {
                console.error('❌ Error adding tag:', error.message);
            }
        }, 5000);

        // Example: Write variables with enhanced validation
        setTimeout(async () => {
            try {
                console.log('\n✏️ Writing variables...');
                
                // Get all available tags
                const allTags = Object.keys(client._vars);
                if (allTags.length > 0) {
                    // Write to first available boolean tag
                    const boolTags = allTags.filter(name => {
                        const meta = client.getTagMetadata(name);
                        return meta && meta.type === 'BOOL';
                    });
                    
                    if (boolTags.length > 0) {
                        await client.writeVariable(boolTags[0], true);
                        console.log(`✅ Wrote ${boolTags[0]} = true`);
                    }
                    
                    // Write to first available numeric tag
                    const numericTags = allTags.filter(name => {
                        const meta = client.getTagMetadata(name);
                        return meta && ['REAL', 'INT', 'DINT'].includes(meta.type);
                    });
                    
                    if (numericTags.length > 0) {
                        await client.writeVariable(numericTags[0], 42.5);
                        console.log(`✅ Wrote ${numericTags[0]} = 42.5`);
                    }
                }
                
            } catch (error) {
                console.error('❌ Error writing variables:', error.message);
            }
        }, 8000);

        // Example: Test database operations
        setTimeout(async () => {
            try {
                console.log('\n🔍 Testing database operations...');
                
                // Test connections
                const testResults = await client.testConnections();
                console.log('Connection Test Results:');
                console.log(`   SQL: ${testResults.sql.success ? '✅' : '❌'} (${testResults.sql.tagCount || 0} tags)`);
                console.log(`   S7: ${testResults.s7.connected ? '✅' : '❌'}`);
                
                // Refresh tags manually
                console.log('\n🔄 Manually refreshing tags...');
                await client.refreshTags();
                
            } catch (error) {
                console.error('❌ Error in database operations:', error.message);
            }
        }, 12000);

        // Example: Display tag information
        setTimeout(() => {
            console.log('\n📋 Detailed Tag Information:');
            const allTags = Object.keys(client._vars);
            
            allTags.slice(0, 5).forEach(tagName => {  // Show first 5 tags
                const meta = client.getTagMetadata(tagName);
                if (meta) {
                    console.log(`   ${tagName}:`);
                    console.log(`     Address: ${meta.addr}`);
                    console.log(`     Type: ${meta.type}`);
                    console.log(`     Group: ${meta.group}`);
                    console.log(`     Description: ${meta.description || 'N/A'}`);
                    console.log(`     Units: ${meta.units || 'N/A'}`);
                    if (meta.limits.min !== null || meta.limits.max !== null) {
                        console.log(`     Limits: ${meta.limits.min || 'N/A'} to ${meta.limits.max || 'N/A'}`);
                    }
                    console.log('');
                }
            });
            
            if (allTags.length > 5) {
                console.log(`   ... and ${allTags.length - 5} more tags`);
            }
        }, 15000);

    } catch (error) {
        console.error('❌ Initialization failed:', error.message);
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n🔄 Shutting down Enhanced S7 Client...');
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
    console.log('\n🚀 Enhanced S7 Client is running...');
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
