const MultiPLCManager = require('./MultiPLCManager');

/**
 * Complete Multi-PLC System Example
 * Demonstrates the full capabilities of the enhanced multi-PLC system
 */

// Configuration for the Multi-PLC system
const config = {
    // SQL Server connection
    server: 'localhost',
    database: 'IndolaktoWWTP',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        trustedConnection: true,
        enableArithAbort: true,
        instanceName: 'MSSQLSERVER'
    },
    
    // Multi-PLC settings
    maxConcurrentConnections: 5,
    connectionRetryInterval: 30000,
    autoReconnectEnabled: true,
    healthCheckInterval: 60000,
    priorityBasedConnection: true,
    
    // Logging configuration
    loggingConfig: {
        enableDataLogging: true,
        enableAlarmLogging: true,
        enableEventLogging: true,
        logInterval: 30000,
        dataRetentionDays: 90,
        alarmRetentionDays: 365,
        eventRetentionDays: 30
    }
};

class MultiPLCExample {
    constructor() {
        this.manager = new MultiPLCManager(config);
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // System events
        this.manager.on('initialized', () => {
            console.log('🎉 Multi-PLC Manager initialized successfully');
            this.displaySystemStatus();
        });

        this.manager.on('database_connected', () => {
            console.log('📊 Database connected successfully');
        });

        this.manager.on('configurations_loaded', (info) => {
            console.log(`📋 Loaded ${info.count} PLC configurations`);
        });

        // PLC events
        this.manager.on('plc_connected', (data) => {
            console.log(`✅ PLC Connected: ${data.plcName}`);
            this.displayPLCInfo(data.plcName);
        });

        this.manager.on('plc_disconnected', (data) => {
            console.log(`❌ PLC Disconnected: ${data.plcName}`);
        });

        this.manager.on('plc_connection_failed', (data) => {
            console.log(`🚫 PLC Connection Failed: ${data.plcName} - ${data.error}`);
        });

        this.manager.on('plc_alarm', (data) => {
            console.log(`🚨 ALARM from ${data.plcName}: ${data.type} - ${data.tagName} = ${data.value}`);
        });

        this.manager.on('plc_data', (data) => {
            // Throttle data logging to prevent spam
            if (Math.random() < 0.01) { // Log 1% of data events
                console.log(`📊 Data from ${data.plcName}: ${Object.keys(data.data).length} tags updated`);
            }
        });

        // System maintenance events
        this.manager.on('health_check_complete', (data) => {
            console.log(`💓 Health Check: ${data.connectedPLCs}/${data.totalPLCs} PLCs connected`);
        });

        this.manager.on('configurations_changed', (data) => {
            console.log(`📋 Configuration Change: ${data.oldCount} -> ${data.newCount} PLCs`);
        });
    }

    async run() {
        try {
            console.log('🚀 Starting Multi-PLC Example...');
            console.log('=' .repeat(60));

            // Initialize the system
            await this.manager.initialize();

            // Wait a moment for connections to establish
            await this.delay(5000);

            // Demonstrate various operations
            await this.demonstrateOperations();

            // Set up periodic reporting
            this.startPeriodicReporting();

            // Keep the example running
            console.log('\n📊 Multi-PLC system running. Press Ctrl+C to stop.');
            console.log('=' .repeat(60));

        } catch (error) {
            console.error('❌ Failed to start Multi-PLC example:', error);
            process.exit(1);
        }
    }

    async demonstrateOperations() {
        console.log('\n🔧 Demonstrating Multi-PLC Operations...');

        try {
            // 1. Display system status
            console.log('\n1️⃣ System Status:');
            const systemStatus = this.manager.getSystemStatus();
            console.log(`   PLCs: ${systemStatus.plcs.connected}/${systemStatus.plcs.total} connected`);
            console.log(`   Data Points: ${systemStatus.data.pointsLogged.toLocaleString()} logged`);
            console.log(`   Alarms: ${systemStatus.data.alarmsGenerated} generated`);

            // 2. Show PLC statuses
            console.log('\n2️⃣ PLC Detailed Status:');
            const plcStatuses = await this.manager.getPLCStatuses();
            plcStatuses.forEach(plc => {
                const status = plc.status.connected ? '✅ Online' : '❌ Offline';
                console.log(`   ${plc.name}: ${status} (${plc.address}:${plc.port})`);
                console.log(`      Tags: ${plc.status.activeTags || 0}, Quality: ${(plc.statistics.dataQualityPercent || 0).toFixed(1)}%`);
            });

            // 3. Get data from all PLCs
            console.log('\n3️⃣ Current Data from All PLCs:');
            const allData = this.manager.getAllPLCData();
            Object.entries(allData).forEach(([plcName, plcData]) => {
                console.log(`   ${plcName}: ${plcData.connected ? 'Connected' : 'Disconnected'}`);
                if (plcData.connected && plcData.data) {
                    const tagCount = Object.keys(plcData.data).length;
                    console.log(`      Active Tags: ${tagCount}`);
                    
                    // Show first few tags as example
                    const sampleTags = Object.entries(plcData.data).slice(0, 3);
                    sampleTags.forEach(([tagName, tagInfo]) => {
                        if (tagInfo.formattedValue) {
                            console.log(`         ${tagName}: ${tagInfo.formattedValue} ${tagInfo.units || ''}`);
                        }
                    });
                }
            });

            // 4. Demonstrate adding a new PLC (commented out to avoid actual changes)
            console.log('\n4️⃣ PLC Management Example:');
            console.log('   Example: Adding new PLC configuration');
            console.log('   (This would add a new PLC to the system)');
            /*
            const newPLCConfig = {
                name: 'DEMO_PLC',
                description: 'Demo PLC for testing',
                address: '192.168.1.100',
                port: 102,
                rack: 0,
                slot: 2,
                location: 'Demo Area',
                department: 'Testing',
                systemType: 'DEMO',
                priority: 9,
                autoConnect: false // Don't auto-connect demo PLC
            };
            await this.manager.addPLCConfiguration(newPLCConfig);
            console.log('   ✅ Demo PLC configuration added');
            */

            // 5. Show historical data example
            console.log('\n5️⃣ Historical Data Example:');
            const endDate = new Date();
            const startDate = new Date(endDate - 60 * 60 * 1000); // Last hour
            
            try {
                const historicalData = await this.manager.getMultiPLCHistoricalData(
                    { plcName: null }, // All PLCs
                    startDate,
                    endDate,
                    10 // Limit to 10 records for demo
                );
                
                console.log(`   Found ${historicalData.length} historical records in the last hour`);
                if (historicalData.length > 0) {
                    const sample = historicalData[0];
                    console.log(`   Sample: ${sample.PLCName}.${sample.TagName} = ${sample.EuValue} ${sample.EngineeringUnits || ''}`);
                }
            } catch (error) {
                console.log(`   No historical data available yet: ${error.message}`);
            }

            // 6. Show alarm history
            console.log('\n6️⃣ Recent Alarms:');
            try {
                const alarmHistory = await this.manager.getMultiPLCAlarmHistory({}, 5);
                if (alarmHistory.length > 0) {
                    console.log(`   Found ${alarmHistory.length} recent alarms`);
                    alarmHistory.forEach(alarm => {
                        console.log(`   🚨 ${alarm.PLCName}.${alarm.TagName}: ${alarm.AlarmType} (${alarm.Severity})`);
                    });
                } else {
                    console.log('   ✅ No recent alarms');
                }
            } catch (error) {
                console.log(`   Could not retrieve alarm history: ${error.message}`);
            }

        } catch (error) {
            console.error('❌ Error during demonstration:', error);
        }
    }

    async displayPLCInfo(plcName) {
        try {
            const plcData = this.manager.getPLCData(plcName);
            if (plcData && plcData.connected) {
                const tagCount = Object.keys(plcData.data || {}).length;
                console.log(`   📊 ${plcName}: ${tagCount} tags active`);
            }
        } catch (error) {
            console.log(`   ⚠️ Could not get data for ${plcName}: ${error.message}`);
        }
    }

    displaySystemStatus() {
        const status = this.manager.getSystemStatus();
        console.log('\n📊 System Overview:');
        console.log(`   🏭 PLCs: ${status.plcs.connected}/${status.plcs.total} connected`);
        console.log(`   📈 Data Points: ${status.data.pointsLogged.toLocaleString()}`);
        console.log(`   🚨 Alarms: ${status.data.alarmsGenerated}`);
        console.log(`   ⏱️ Uptime: ${Math.floor(status.system.uptime / 3600)}h ${Math.floor((status.system.uptime % 3600) / 60)}m`);
        console.log(`   ✅ Success Rate: ${status.connections.successRate.toFixed(1)}%`);
    }

    startPeriodicReporting() {
        // Report system status every 2 minutes
        setInterval(() => {
            console.log('\n' + '─'.repeat(40));
            console.log('📊 Periodic Status Report');
            this.displaySystemStatus();
            
            // Show quick data summary
            const allData = this.manager.getAllPLCData();
            const connectedPLCs = Object.values(allData).filter(plc => plc.connected);
            const totalTags = connectedPLCs.reduce((sum, plc) => 
                sum + Object.keys(plc.data || {}).length, 0);
            
            console.log(`   📋 Active Tags: ${totalTags} across ${connectedPLCs.length} PLCs`);
            console.log('─'.repeat(40));
            
        }, 120000); // Every 2 minutes
    }

    async generateSystemReport() {
        try {
            console.log('\n📋 Generating System Report...');
            const report = await this.manager.generateSystemReport('summary', '24h');
            
            console.log('System Report Summary:');
            console.log(`   Report Type: ${report.reportType}`);
            console.log(`   Time Range: ${report.timeRange}`);
            console.log(`   Generated: ${report.generatedAt}`);
            console.log(`   PLCs: ${report.systemOverview.plcs.total} total, ${report.systemOverview.plcs.connected} connected`);
            
            if (report.dataQuality && report.dataQuality.length > 0) {
                console.log('\n   Data Quality by PLC:');
                report.dataQuality.forEach(dq => {
                    console.log(`     ${dq.PLCName}: ${dq.QualityPercentage}% (${dq.GoodRecords}/${dq.TotalRecords})`);
                });
            }
            
            if (report.recentAlarms && report.recentAlarms.length > 0) {
                console.log(`\n   Recent Alarms: ${report.recentAlarms.length} in last 24h`);
            }
            
        } catch (error) {
            console.error('❌ Failed to generate system report:', error);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async shutdown() {
        console.log('\n🔄 Shutting down Multi-PLC Example...');
        
        try {
            await this.manager.shutdown();
            console.log('✅ Multi-PLC Example shutdown complete');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
        
        process.exit(0);
    }
}

// Create and run the example
const example = new MultiPLCExample();

// Graceful shutdown handlers
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT signal...');
    example.shutdown();
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM signal...');
    example.shutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    example.shutdown();
});

// Start the example
console.log('🚀 Multi-PLC System Example Starting...');
console.log('📋 Database: IndolaktoWWTP');
console.log('🔧 Features: Dynamic PLC Management, Engineering Units, Advanced Logging');
console.log('');

example.run().catch(error => {
    console.error('❌ Fatal error in Multi-PLC example:', error);
    process.exit(1);
});

module.exports = MultiPLCExample;