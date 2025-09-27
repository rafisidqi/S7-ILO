# Enhanced S7 Multi-PLC Client with Advanced Database Integration

A comprehensive Node.js solution for managing multiple Siemens S7 PLCs with advanced SQL Server integration, engineering units support, and enterprise-grade data logging capabilities.

## 🚀 New Features (v2.1.0)

- **🏭 Multi-PLC Management**: Dynamic connection management for multiple PLCs
- **📊 Enhanced Database Schema**: Complete redesign with engineering units support
- **⚡ Engineering Units**: Real-time conversion between raw PLC values and engineering units
- **🚨 Advanced Alarm System**: Comprehensive alarm management with hysteresis
- **📈 Data Logging**: Enterprise-grade historical data logging and retention
- **📋 Dynamic Configuration**: Database-driven PLC and tag configuration
- **🔧 Enhanced API**: RESTful API for complete system management
- **📱 Modern Dashboard**: Real-time monitoring with responsive web interface

## 📁 Project Structure

```
s7-multi-plc-client/
├── Database/
│   └── enhanced_multi_plc_schema.sql    # Complete database schema
├── MultiPLCManager.js                   # Core multi-PLC management
├── multi-plc-api-server.js             # HTTP API server
├── EnhancedS7ClientWithLogging.js      # Enhanced S7 client
├── SqlTagManager.js                     # Tag management system
├── SqlDataLogger.js                     # Data logging system
├── EngineeringUnitsUtils.js             # Engineering units utilities
├── examples/                            # Usage examples
├── docs/                               # Documentation
└── README.md                           # This file
```

## 🛠️ Installation

### Prerequisites

- **Node.js** (v14.0.0 or higher)
- **SQL Server Express** (2019 or higher recommended)
- **Windows** (for SQL Server Express)

### Quick Setup

1. **Clone and install:**
```bash
git clone <repository-url>
cd s7-multi-plc-client
npm install
```

2. **Set up the enhanced database:**
```bash
npm run db:setup-enhanced
```

3. **Test database connection:**
```bash
npm run db:test-multi
```

4. **Start the multi-PLC system:**
```bash
npm run multi-plc
```

5. **Access the dashboard:**
   - Open: http://localhost:3000
   - API Documentation: http://localhost:3000/api

## 🗄️ Enhanced Database Schema

The new database schema supports comprehensive multi-PLC management:

### Core Tables

| Table | Purpose |
|-------|---------|
| `PLCConnections` | PLC configuration and connection details |
| `PLCConnectionStatus` | Real-time PLC connection status |
| `Tags` | Enhanced tag definitions with engineering units |
| `DataHistory` | Historical data with raw and EU values |
| `AlarmHistory` | Comprehensive alarm tracking |
| `EventHistory` | System and user events |
| `DataSummaryHourly` | Hourly data aggregations |
| `DataSummaryDaily` | Daily data summaries |

### Key Features

- **Engineering Units**: Complete raw-to-EU conversion support
- **Multi-PLC Support**: Tags linked to specific PLCs
- **Enhanced Alarms**: Advanced alarm configuration with priorities
- **Data Retention**: Configurable retention policies
- **Performance Optimization**: Indexed for high-performance queries
- **Audit Trail**: Complete change tracking

## 📊 Engineering Units Support

### Automatic Conversion

```javascript
// Raw PLC value: 16384 (0-32767 range)
// Automatically converted to: 50.0 °C (0-100 °C range)

const tag = {
    name: 'Temperature_1',
    addr: 'DB1,REAL0',
    rawMin: 0,
    rawMax: 32767,
    euMin: 0,
    euMax: 100,
    engineeringUnits: '°C',
    decimalPlaces: 1
};
```

### Supported Scaling Types

- **Linear**: Standard linear scaling
- **Square Root**: For flow measurements
- **Polynomial**: Custom polynomial scaling
- **Lookup Table**: Point-to-point interpolation

### Standard Sensor Presets

```javascript
const temperatureTag = EngineeringUnitsUtils.createStandardScaling('temperature_4_20ma', {
    tempMin: -20,
    tempMax: 150
});

const pressureTag = EngineeringUnitsUtils.createStandardScaling('pressure_4_20ma', {
    pressureMax: 10
});
```

## 🏭 Multi-PLC Configuration

### Adding PLCs via API

```bash
curl -X POST http://localhost:3000/api/plc/add \
  -H "Content-Type: application/json" \
  -d '{
    "name": "WWTP_New_PLC",
    "description": "New WWTP Control PLC",
    "address": "192.168.1.15",
    "port": 102,
    "rack": 0,
    "slot": 2,
    "location": "Building C",
    "department": "Operations",
    "systemType": "WWTP_Secondary",
    "priority": 2,
    "autoConnect": true
  }'
```

### Database Configuration

PLCs are stored in the `PLCConnections` table with full configuration:

```sql
-- Sample PLC configuration
INSERT INTO PLCConnections (
    PLCName, PLCDescription, IPAddress, Port, Rack, Slot,
    Location, Department, SystemType, Priority, AutoConnect
) VALUES (
    'WWTP_Main_PLC', 'Main WWTP Control PLC', '192.168.1.10', 102, 0, 2,
    'Control Room A', 'Operations', 'WWTP_Primary', 1, 1
);
```

## 🏷️ Enhanced Tag Management

### Adding Tags with Engineering Units

```bash
curl -X POST http://localhost:3000/api/tags/add \
  -H "Content-Type: application/json" \
  -d '{
    "plcName": "WWTP_Main_PLC",
    "tags": [
      {
        "name": "Tank_Level",
        "addr": "DB1,REAL0",
        "type": "REAL",
        "description": "Main tank level sensor",
        "group": "Level_Sensors",
        "rawMin": 0,
        "rawMax": 32767,
        "euMin": 0,
        "euMax": 5.5,
        "units": "m",
        "decimalPlaces": 2,
        "alarmHigh": 5.0,
        "alarmLow": 0.5,
        "alarmEnabled": true,
        "loggingEnabled": true
      }
    ]
  }'
```

### Tag Features

- **PLC Association**: Each tag linked to specific PLC
- **Engineering Units**: Automatic raw-to-EU conversion
- **Alarm Limits**: High, Low, HighHigh, LowLow with hysteresis
- **Data Logging**: Configurable logging rates and retention
- **Validation**: Custom validation rules support

## 🚨 Advanced Alarm System

### Alarm Configuration

```javascript
const alarmConfig = {
    enabled: true,
    priority: 3,              // 1=Critical, 5=Info
    deadband: 1.0,           // Hysteresis to prevent oscillation
    limits: {
        high: 80.0,          // High alarm
        low: 20.0,           // Low alarm
        highHigh: 95.0,      // Critical high
        lowLow: 10.0         // Critical low
    }
};
```

### Alarm Features

- **Hysteresis**: Prevents alarm oscillation
- **Priorities**: 5-level priority system
- **Auto-acknowledgment**: Configurable acknowledgment
- **Alarm Groups**: Logical grouping for flood detection
- **Historical Tracking**: Complete alarm lifecycle logging

## 📈 Data Logging & Analytics

### Historical Data Query

```bash
# Get historical data for specific tag
curl "http://localhost:3000/api/data/historical?plc=WWTP_Main_PLC&tag=Tank_Level&start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z&limit=1000"

# Export multi-PLC data to CSV
curl "http://localhost:3000/api/data/export?plcs=WWTP_Main_PLC,WWTP_Secondary_PLC&format=csv&start=2024-01-01T00:00:00Z"
```

### Data Features

- **Dual Values**: Both raw and engineering unit values stored
- **Quality Tracking**: OPC-style quality codes
- **Compression**: Automatic data compression for long-term storage
- **Summarization**: Hourly and daily data summaries
- **Export**: CSV and JSON export capabilities

## 🌐 RESTful API

### System Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/status` | GET | Complete system status |
| `/api/system/report` | GET | Generate system reports |
| `/api/plcs/status` | GET | All PLC statuses |
| `/api/plc/connect?plc=NAME` | POST | Connect to specific PLC |

### Data Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/data/all` | GET | Data from all PLCs |
| `/api/data/historical` | GET | Historical data query |
| `/api/write` | POST | Write values to PLCs |
| `/api/alarms/history` | GET | Alarm history |

### Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/plc/add` | POST | Add new PLC |
| `/api/tags/add` | POST | Add tags to PLC |
| `/api/config/refresh` | POST | Refresh configurations |

## 📱 Web Dashboard

The included web dashboard provides:

- **Real-time Monitoring**: Live PLC data with engineering units
- **System Overview**: Connection status and statistics
- **Alarm Management**: Active alarms and acknowledgment
- **Historical Trends**: Data visualization and analysis
- **Configuration**: PLC and tag management interface

Access at: http://localhost:3000

## 🏃‍♂️ Usage Examples

### Basic Multi-PLC Setup

```javascript
const MultiPLCManager = require('./MultiPLCManager');

const manager = new MultiPLCManager({
    server: 'localhost\\SQLEXPRESS',
    database: 'IndolaktoWWTP',
    maxConcurrentConnections: 10,
    autoReconnectEnabled: true
});

// Initialize and connect to all configured PLCs
await manager.initialize();

// Get data from all PLCs
const allData = manager.getAllPLCData();
console.log('Multi-PLC Data:', allData);
```

### Enhanced S7 Client with Logging

```javascript
const EnhancedS7ClientWithLogging = require('./EnhancedS7ClientWithLogging');

const client = new EnhancedS7ClientWithLogging({
    // S7 Configuration
    address: '192.168.1.10',
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 1000,
    
    // SQL Configuration
    sqlConfig: {
        server: 'localhost\\SQLEXPRESS',
        database: 'IndolaktoWWTP'
    },
    
    // Logging Configuration
    loggingConfig: {
        enableDataLogging: true,
        enableAlarmLogging: true,
        logInterval: 30000,
        dataRetentionDays: 90
    }
});

// Event handlers
client.on('enhanced_data', (data) => {
    Object.entries(data).forEach(([tagName, tagInfo]) => {
        console.log(`${tagName}: ${tagInfo.formattedValue} ${tagInfo.units}`);
    });
});

client.on('alarm', (alarm) => {
    console.log(`🚨 ALARM: ${alarm.tagName} = ${alarm.value} ${alarm.units}`);
});

// Initialize with full logging
await client.initialize();
```

### Engineering Units Conversion

```javascript
const EngineeringUnitsUtils = require('./EngineeringUnitsUtils');

// Manual conversion
const scaling = { rawMin: 0, rawMax: 32767, euMin: 0, euMax: 100 };
const euValue = EngineeringUnitsUtils.rawToEu(16384, scaling);
console.log(`EU Value: ${euValue}%`); // Output: EU Value: 50%

// Create complete EU object
const tagMetadata = {
    rawMin: 0, rawMax: 32767, euMin: -20, euMax: 150,
    engineeringUnits: '°C', decimalPlaces: 1
};
const euObject = EngineeringUnitsUtils.createEuObject(16384, tagMetadata);
console.log(euObject.formattedValue); // Output: "65.0 °C"
```

## 📊 Performance Monitoring

### System Statistics

```bash
# Get comprehensive system statistics
curl http://localhost:3000/api/system/statistics
```

Returns detailed metrics including:
- Connection statistics per PLC
- Data logging rates and quality
- Alarm frequency and response times
- Database performance metrics
- Memory and CPU usage

### Health Monitoring

The system includes built-in health monitoring:

- **Connection Health**: Automatic reconnection attempts
- **Data Quality**: Quality percentage tracking
- **Performance Metrics**: Response time monitoring
- **Resource Usage**: Memory and CPU tracking
- **Error Tracking**: Comprehensive error logging

## 🔧 Configuration Management

### Database-Driven Configuration

All PLC and tag configurations are stored in the database, enabling:

- **Dynamic Updates**: Changes without restart
- **Version Control**: Configuration change tracking
- **Backup/Restore**: Easy configuration backup
- **Multi-Environment**: Different configs per environment

### Configuration Scripts

```bash
# Set up complete database schema
npm run db:setup-enhanced

# Test database connectivity
npm run db:test-multi

# Run with development settings
npm run dev

# Production deployment
npm run pm2:start-multi
```

## 🚀 Production Deployment

### PM2 Process Management

```bash
# Start with PM2
npm run pm2:start-multi

# Monitor processes
npm run pm2:monit

# View logs
npm run pm2:logs

# Restart services
npm run pm2:restart
```

### Database Optimization

For production environments:

1. **Indexing**: Ensure proper indexing on timestamp columns
2. **Partitioning**: Consider table partitioning for large datasets
3. **Maintenance**: Regular database maintenance and cleanup
4. **Backup**: Automated backup strategies

### Security Considerations

- **Database Security**: Use SQL Server authentication
- **Network Security**: Configure firewall rules
- **API Security**: Implement authentication if needed
- **Data Encryption**: Enable TLS for database connections

## 🔍 Troubleshooting

### Common Issues

**PLC Connection Failed:**
```bash
# Check PLC configuration
curl http://localhost:3000/api/plcs/status

# Test specific PLC connection
curl -X POST "http://localhost:3000/api/plc/connect?plc=WWTP_Main_PLC"
```

**Database Connection Issues:**
```bash
# Test database connection
npm run db:test-multi

# Check SQL Server service
services.msc -> SQL Server (SQLEXPRESS)
```

**Tag Data Not Logging:**
```bash
# Check logging status
curl http://localhost:3000/api/logging/status

# Enable logging if disabled
curl -X POST http://localhost:3000/api/logging/enable
```

### Debug Mode

Enable verbose logging:
```bash
DEBUG=s7-multi-plc:* npm run multi-plc
```

### Log Files

Check log files for detailed error information:
- Application logs: `logs/multi-plc.log`
- Error logs: `logs/error.log`
- Database logs: SQL Server error logs

## 📚 API Documentation

### Complete API Reference

Visit http://localhost:3000/api for interactive API documentation.

### Example API Calls

**System Status:**
```bash
curl http://localhost:3000/api/system/status
```

**Add PLC:**
```bash
curl -X POST http://localhost:3000/api/plc/add \
  -H "Content-Type: application/json" \
  -d '{"name": "NEW_PLC", "address": "192.168.1.20"}'
```

**Write Value:**
```bash
curl -X POST http://localhost:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{"plc": "WWTP_Main_PLC", "tag": "Setpoint_1", "value": 75.5}'
```

**Export Data:**
```bash
curl "http://localhost:3000/api/data/export?format=csv&plcs=WWTP_Main_PLC&start=2024-01-01T00:00:00Z"
```

## 🧪 Testing

### Unit Tests
```bash
npm run test:unit
```

### Integration Tests
```bash
npm run test:integration
```

### Database Tests
```bash
npm run test:db
```

## 📈 Roadmap

### Planned Features

- **Advanced Analytics**: Machine learning integration
- **Mobile App**: React Native mobile application
- **OEE Calculations**: Overall Equipment Effectiveness
- **Report Generation**: Automated PDF reports
- **Cloud Integration**: Azure IoT Hub connectivity
- **Docker Support**: Containerized deployment
- **GraphQL API**: Alternative API interface
- **Real-time Notifications**: WebSocket support

### Version History

- **v2.1.0**: Multi-PLC support with enhanced database schema
- **v2.0.0**: Engineering units and advanced logging
- **v1.5.0**: Enhanced S7 client with SQL integration
- **v1.0.0**: Basic S7 client with simple logging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone <repository-url>
cd s7-multi-plc-client
npm install
npm run db:setup-enhanced
npm run dev
```

### Code Style

- Use ESLint configuration
- Follow JavaScript Standard Style
- Comment complex functions
- Write unit tests for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check `/docs` folder for detailed guides
- **Issues**: Use GitHub Issues for bug reports
- **Discussions**: GitHub Discussions for questions
- **Email**: support@yourcompany.com

## 🙏 Acknowledgments

- **@st-one-io/nodes7**: S7 communication library
- **Microsoft SQL Server**: Database platform
- **Node.js Community**: Runtime environment
- **Industrial Automation Community**: Feedback and testing

## 📋 Quick Reference

### Essential Commands

```bash
# Setup
npm install
npm run db:setup-enhanced

# Development
npm run dev
npm run multi-plc

# Production
npm run pm2:start-multi
npm run pm2:monit

# Testing
npm run db:test-multi
npm run test

# Maintenance
npm run pm2:logs
npm run pm2:restart
```

### Key Files

- `MultiPLCManager.js` - Core multi-PLC management
- `multi-plc-api-server.js` - HTTP API server
- `Database/enhanced_multi_plc_schema.sql` - Database schema
- `package.json` - Dependencies and scripts

### Important URLs

- Dashboard: http://localhost:3000
- API Docs: http://localhost:3000/api
- System Status: http://localhost:3000/api/system/status
- PLC Status: http://localhost:3000/api/plcs/status

---

**🏭 Industrial Automation Made Simple with Multi-PLC Support!**

For more information, visit the [project documentation](docs/) or contact the development team.