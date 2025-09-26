const S7Client = require('./S7Client');
const http = require('http');
const url = require('url');

class S7HTTPServer {
    constructor(s7Config, httpPort = 3000) {
        this.s7client = new S7Client(s7Config);
        this.httpPort = httpPort;
        this.server = null;
        this.currentData = {};
        this.isConnected = false;
        
        this.setupS7Events();
        this.createHTTPServer();
    }

    setupS7Events() {
        this.s7client.on('status', (statusInfo) => {
            console.log('S7 Status:', statusInfo.status);
            this.isConnected = statusInfo.status === 'online';
        });

        this.s7client.on('connected', () => {
            console.log('S7 PLC Connected');
            this.isConnected = true;
        });

        this.s7client.on('disconnected', () => {
            console.log('S7 PLC Disconnected');
            this.isConnected = false;
        });

        this.s7client.on('error', (error) => {
            console.error('S7 Error:', error.message);
        });

        this.s7client.on('data', (values) => {
            this.currentData = { ...values };
        });

        this.s7client.on('variable_changed', (change) => {
            console.log(`Variable ${change.key} changed:`, change.value);
        });
    }

    createHTTPServer() {
        this.server = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const path = parsedUrl.pathname;
            const query = parsedUrl.query;

            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            try {
                this.handleRequest(req, res, path, query);
            } catch (error) {
                this.sendError(res, 500, error.message);
            }
        });
    }

    async handleRequest(req, res, path, query) {
        switch (path) {
            case '/api/status':
                this.handleStatus(req, res);
                break;
            case '/api/data':
                this.handleData(req, res);
                break;
            case '/api/variables':
                this.handleVariables(req, res);
                break;
            case '/api/read':
                await this.handleRead(req, res, query);
                break;
            case '/api/write':
                await this.handleWrite(req, res);
                break;
            case '/api/cycle-time':
                await this.handleCycleTime(req, res);
                break;
            case '/':
                this.handleRoot(req, res);
                break;
            default:
                this.sendError(res, 404, 'Not Found');
        }
    }

    handleStatus(req, res) {
        const status = {
            connected: this.isConnected,
            status: this.s7client.getStatus(),
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, status);
    }

    handleData(req, res) {
        const response = {
            data: this.currentData,
            connected: this.isConnected,
            timestamp: new Date().toISOString()
        };
        this.sendJSON(res, response);
    }

    handleVariables(req, res) {
        const variables = this.s7client.getVariables();
        this.sendJSON(res, { variables });
    }

    async handleRead(req, res, query) {
        if (!this.isConnected) {
            this.sendError(res, 503, 'PLC not connected');
            return;
        }

        if (query.variable) {
            const value = this.currentData[query.variable];
            if (value !== undefined) {
                this.sendJSON(res, { 
                    variable: query.variable, 
                    value: value,
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(res, 404, 'Variable not found');
            }
        } else {
            this.handleData(req, res);
        }
    }

    async handleWrite(req, res) {
        if (!this.isConnected) {
            this.sendError(res, 503, 'PLC not connected');
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const writeData = JSON.parse(body);
                
                if (writeData.variable && writeData.value !== undefined) {
                    // Single variable write
                    await this.s7client.writeVariable(writeData.variable, writeData.value);
                    this.sendJSON(res, { 
                        success: true, 
                        message: `Variable ${writeData.variable} written successfully`,
                        timestamp: new Date().toISOString()
                    });
                } else if (writeData.variables) {
                    // Multiple variables write
                    await this.s7client.writeVariables(writeData.variables);
                    this.sendJSON(res, { 
                        success: true, 
                        message: 'Variables written successfully',
                        timestamp: new Date().toISOString()
                    });
                } else {
                    this.sendError(res, 400, 'Invalid write data format');
                }
            } catch (error) {
                this.sendError(res, 500, `Write failed: ${error.message}`);
            }
        });
    }

    async handleCycleTime(req, res) {
        if (req.method === 'GET') {
            this.sendJSON(res, { 
                cycleTime: this.s7client.currentCycleTime,
                timestamp: new Date().toISOString()
            });
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                try {
                    const { cycleTime } = JSON.parse(body);
                    this.s7client.updateCycleTime(cycleTime);
                    this.sendJSON(res, { 
                        success: true, 
                        message: `Cycle time updated to ${cycleTime}ms`,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    this.sendError(res, 400, `Failed to update cycle time: ${error.message}`);
                }
            });
        } else {
            this.sendError(res, 405, 'Method Not Allowed');
        }
    }

    handleRoot(req, res) {
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>S7 PLC Client</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { padding: 20px; border-radius: 5px; margin: 10px 0; }
                .online { background-color: #d4edda; color: #155724; }
                .offline { background-color: #f8d7da; color: #721c24; }
                .api-endpoint { background-color: #f8f9fa; padding: 10px; margin: 5px 0; border-left: 3px solid #007bff; }
                pre { background-color: #f8f9fa; padding: 10px; overflow-x: auto; }
            </style>
        </head>
        <body>
            <h1>S7 PLC Client Dashboard</h1>
            <div class="status ${this.isConnected ? 'online' : 'offline'}">
                Status: ${this.isConnected ? 'Connected' : 'Disconnected'}
            </div>
            
            <h2>API Endpoints</h2>
            <div class="api-endpoint"><strong>GET /api/status</strong> - Get connection status</div>
            <div class="api-endpoint"><strong>GET /api/data</strong> - Get all current data</div>
            <div class="api-endpoint"><strong>GET /api/variables</strong> - Get configured variables</div>
            <div class="api-endpoint"><strong>GET /api/read?variable=NAME</strong> - Read specific variable</div>
            <div class="api-endpoint"><strong>POST /api/write</strong> - Write variable(s)</div>
            <div class="api-endpoint"><strong>GET/POST /api/cycle-time</strong> - Get/Set cycle time</div>
            
            <h2>Current Data</h2>
            <pre>${JSON.stringify(this.currentData, null, 2)}</pre>
            
            <script>
                // Auto refresh every 2 seconds
                setTimeout(() => location.reload(), 2000);
            </script>
        </body>
        </html>`;
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    sendJSON(res, data) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data, null, 2));
    }

    sendError(res, status, message) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message, timestamp: new Date().toISOString() }));
    }

    async start() {
        try {
            // Start S7 connection
            await this.s7client.connect();
            console.log('S7 Client connected successfully');

            // Start HTTP server
            this.server.listen(this.httpPort, () => {
                console.log(`HTTP Server running on port ${this.httpPort}`);
                console.log(`Dashboard: http://localhost:${this.httpPort}`);
                console.log(`API: http://localhost:${this.httpPort}/api/status`);
            });

        } catch (error) {
            console.error('Failed to start:', error.message);
            process.exit(1);
        }
    }

    async stop() {
        console.log('Shutting down...');
        
        if (this.server) {
            this.server.close();
        }
        
        await this.s7client.disconnect();
        process.exit(0);
    }
}

// Configuration
const s7Config = {
    transport: 'iso-on-tcp',
    address: '192.168.1.10',
    port: 102,
    rack: 0,
    slot: 2,
    cycletime: 1000,
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

const httpPort = process.env.PORT || 3000;
const s7Server = new S7HTTPServer(s7Config, httpPort);

// Graceful shutdown
process.on('SIGINT', () => s7Server.stop());
process.on('SIGTERM', () => s7Server.stop());

// Start the server
s7Server.start().catch(console.error);
