const S7Client = require('./S7Client');

// Configuration for your PLC connection
const config = {
    transport: 'iso-on-tcp',
    address: '192.168.1.10',  // PLC IP address
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 1000,  // Read cycle time in ms
    timeout: 2000,
    connmode: 'rack-slot',
    variables: [
        { name: 'DB1_BOOL1', addr: 'DB1,X0.0' },
        { name: 'DB1_BOOL2', addr: 'DB1,X0.1' },
        { name: 'DB1_INT1', addr: 'DB1,INT2' },
        { name: 'DB1_REAL1', addr: 'DB1,REAL4' },
        { name: 'DB1_WORD1', addr: 'DB1,WORD8' },
        { name: 'DB1_CHAR1', addr: 'DB1,C12.6' }
    ]
};

async function main() {
    const s7client = new S7Client(config);

    // Event handlers
    s7client.on('status', (statusInfo) => {
        console.log('Status changed:', statusInfo.status);
    });

    s7client.on('connected', () => {
        console.log('Connected to PLC');
    });

    s7client.on('disconnected', () => {
        console.log('Disconnected from PLC');
    });

    s7client.on('error', (error) => {
        console.error('S7 Error:', error.message);
    });

    s7client.on('data', (values) => {
        console.log('All variables:', values);
    });

    s7client.on('variable_changed', (change) => {
        console.log(`Variable ${change.key} changed to:`, change.value);
    });

    s7client.on('data_changed', (values) => {
        console.log('Data changed:', values);
    });

    try {
        // Wait for connection
        await s7client.connect();
        console.log('Successfully connected to PLC');

        // Example: Write a variable after 5 seconds
        setTimeout(async () => {
            try {
                await s7client.writeVariable('DB1_BOOL1', true);
                console.log('Successfully wrote DB1_BOOL1 = true');
                
                await s7client.writeVariable('DB1_INT1', 12345);
                console.log('Successfully wrote DB1_INT1 = 12345');
                
                // Write multiple variables at once
                await s7client.writeVariables({
                    'DB1_BOOL2': false,
                    'DB1_REAL1': 3.14159
                });
                console.log('Successfully wrote multiple variables');
                
            } catch (error) {
                console.error('Write error:', error.message);
            }
        }, 5000);

        // Example: Change cycle time after 10 seconds
        setTimeout(() => {
            s7client.updateCycleTime(500); // 500ms cycle time
            console.log('Changed cycle time to 500ms');
        }, 10000);

    } catch (error) {
        console.error('Connection failed:', error.message);
        process.exit(1);
    }

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down...');
        await s7client.disconnect();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('Shutting down...');
        await s7client.disconnect();
        process.exit(0);
    });
}

main().catch(console.error);
