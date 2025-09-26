# S7-ILO

# S7 Standalone Client

A standalone Node.js client for communicating with Siemens S7 PLCs, extracted from the node-red-contrib-s7 project. This client can run independently without Node-RED and is designed to work with PM2 for production deployments.

## Features

- **Standalone Operation**: No Node-RED dependency
- **Event-Driven**: Built on EventEmitter for reactive programming
- **Cyclic Reading**: Automatically reads PLC variables at configurable intervals
- **Variable Writing**: Write single or multiple variables to the PLC
- **HTTP API**: Optional REST API for external integration
- **PM2 Ready**: Production-ready with PM2 process management
- **Error Handling**: Comprehensive error handling and reconnection logic

## Installation

1. **Clone or create the project directory:**
```bash
mkdir s7-standalone-client
cd s7-standalone-client
```

2. **Install dependencies:**
```bash
npm install
```

3. **Install PM2 globally (optional, for production):**
```bash
npm install -g pm2
```

## Configuration

### Basic S7 Configuration

```javascript
const config = {
    transport: 'iso-on-tcp',        // Transport type
    address: '192.168.1.10',        // PLC IP address
    port: 102,                      // S7 port (usually 102)
    rack: 0,                        // PLC rack number
    slot: 2,                        // PLC slot number
    cycletime: 1000,                // Read cycle time in milliseconds
    timeout: 2000,                  // Connection timeout
    connmode: 'rack-slot',          // Connection mode: 'rack-slot' or 'tsap'
    variables: [                    // Variables to monitor
        { name: 'DB1_BOOL1', addr: 'DB1,X0.0' },
        { name: 'DB1_INT1', addr: 'DB1,INT2' },
        { name: 'DB1_REAL1', addr: 'DB1,REAL4' }
    ]
};
```

### Variable Addressing

The client uses the same addressing scheme as the original Node-RED module:

| Address | Description | Data Type |
|---------|-------------|-----------|
| `DB1,X0.0` | Bit 0 of byte 0 in DB1 | Boolean |
| `DB1,B1` | Byte 1 in DB1 | Number (0-255) |
| `DB1,INT2` | 16-bit signed integer at byte 2 | Number |
| `DB1,REAL4` | 32-bit float at byte 4 | Number |
| `DB1,WORD8` | 16-bit unsigned integer at byte 8 | Number |
| `M0.0` | Memory bit 0.0 | Boolean |
| `I1.0` | Input bit 1.0 | Boolean |
| `Q2.0` | Output bit 2.0 | Boolean |

## Usage Examples

### Basic Usage

```javascript
const S7Client = require('./S7Client');

const client = new S7Client(config);

// Event handlers
client.on('connected', () => {
    console.log('Connected to PLC');
});

client.on('data', (values) => {
    console.log('Current values:', values);
});

client.on('variable_changed', (change) => {
    console.log(`${change.key} = ${change.value}`);
});

// Start connection
await client.connect();

// Write variables
await client.writeVariable('DB1_BOOL1', true);
await client.writeVariables({
    'DB1_INT1': 12345,
    'DB1_REAL1': 3.14159
});
```

### Running with PM2

1. **Start the application:**
```bash
npm run pm2:start
```

2. **Monitor the application:**
```bash
npm run pm2:monit
```

3. **View logs:**
```bash
npm run pm2:logs
```

4. **Stop the application:**
```bash
npm run pm2:stop
```

## API Events

The S7Client emits the following events:

### Connection Events
- `connected` - Emitted when successfully connected to PLC
- `disconnected` - Emitted when disconnected from PLC
- `status` - Emitted when connection status changes

### Data Events
- `data` - Emitted with all variable values on each cycle
- `data_changed` - Emitted when any variable value changes
- `variable_changed` - Emitted when a specific variable changes

### Error Events
- `error` - Emitted when an error occurs

## HTTP API (Advanced Example)

The advanced example includes a built-in HTTP server with REST API:

### Endpoints

- `GET /api/status` - Get connection status
- `GET /api/data` - Get all current data
- `GET /api/variables` - Get configured variables
- `GET /api/read?variable=NAME` - Read specific variable
- `POST /api/write` - Write variable(s)
- `GET/POST /api/cycle-time` - Get/Set cycle time

### Example API Calls

**Read all data:**
```bash
curl http://localhost:3000/api/data
```

**Read specific variable:**
```bash
curl http://localhost:3000/api/read?variable=DB1_BOOL1
```

**Write single variable:**
```bash
curl -X POST http://localhost:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{"variable": "DB1_BOOL1", "value": true}'
```

**Write multiple variables:**
```bash
curl -X POST http://localhost:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{"variables": {"DB1_BOOL1": true, "DB1_INT1": 12345}}'
```

## PM2 Configuration

The included `ecosystem.config.js` provides:

- **Process Management**: Auto-restart, memory monitoring
- **Logging**: Separate error, output, and combined logs
- **Scheduling**: Optional daily restart at 2 AM
- **Environment Variables**: Development and production environments
- **Resource Limits**: Memory limits and Node.js arguments

### PM2 Commands

```bash
# Start application
pm2 start ecosystem.config.js

# Start in production mode
pm2 start ecosystem.config.js --env production

# Monitor
pm2 monit

# View logs
pm2 logs s7-client

# Restart
pm2 restart s7-client

# Stop
pm2 stop s7-client

# Delete
pm2 delete s7-client
```

## Error Handling

The client includes comprehensive error handling:

- **Connection Errors**: Automatic reconnection attempts
- **Read/Write Errors**: Proper error propagation and logging
- **Timeout Handling**: Configurable timeouts for operations
- **Graceful Shutdown**: Clean disconnection on process termination

## Production Deployment

1. **Setup directories:**
```bash
mkdir -p logs
```

2. **Configure your PLC connection** in the configuration object

3. **Start with PM2:**
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

4. **Monitor and maintain:**
```bash
pm2 monit
pm2 logs s7-client
```

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Verify PLC IP address and port
   - Check network connectivity
   - Ensure PLC allows PUT/GET access
   - Verify rack/slot configuration

2. **Variable Not Found**
   - Check variable address format
   - Verify variable exists in PLC
   - Ensure DB is not optimized (S7-1200/1500)

3. **Write Errors**
   - Verify variable is writable
   - Check data type compatibility
   - Ensure PLC is not in STOP mode

### Debug Mode

Enable verbose logging by setting environment variable:
```bash
DEBUG=s7-client node example.js
```

## License

This project is derived from node-red-contrib-s7, which is licensed under GPL-3.0+. 

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For issues related to the S7 protocol implementation, refer to the original [@st-one-io/nodes7](https://www.npmjs.com/package/@st-one-io/nodes7) package documentation.

For PLC-specific configuration, consult your Siemens documentation for your specific PLC model.
