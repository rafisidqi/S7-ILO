const { EventEmitter } = require('events');
const nodes7 = require('@st-one-io/nodes7');

/**
 * Compares values for equality, includes special handling for arrays
 */
function equals(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length != b.length) return false;
        for (var i = 0; i < a.length; ++i) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
    return false;
}

/**
 * Creates translation table from variable configuration
 */
function createTranslationTable(vars) {
    const res = {};
    vars.forEach(function (elm) {
        if (!elm.name || !elm.addr) return;
        res[elm.name] = elm.addr;
    });
    return res;
}

/**
 * Validates TSAP configuration
 */
function validateTSAP(num) {
    num = num.toString();
    if (num.length != 2) return false;
    if (!(/^[0-9a-fA-F]+$/.test(num))) return false;
    const i = parseInt(num, 16);
    if (isNaN(i) || i < 0 || i > 0xff) return false;
    return true;
}

class S7Client extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            transport: 'iso-on-tcp',
            address: '192.168.1.10',
            port: 102,
            rack: 0,
            slot: 2,
            cycletime: 1000,
            timeout: 2000,
            connmode: 'rack-slot',
            localtsaphi: '01',
            localtsaplo: '00',
            remotetsaphi: '01',
            remotetsaplo: '00',
            variables: [],
            ...config
        };

        this.MIN_CYCLE_TIME = 50;
        this.oldValues = {};
        this.status = 'offline';
        this.readInProgress = false;
        this.readDeferred = 0;
        this.connected = false;
        this.currentCycleTime = this.config.cycletime;
        this.endpoint = null;
        this.itemGroup = null;
        this._vars = {};
        this._cycleTimer = null;

        this.setMaxListeners(0);
        this.init();
    }

    init() {
        this._vars = createTranslationTable(this.config.variables);
        
        let connOpts;
        const s7ConnOpts = { timeout: parseInt(this.config.timeout) };
        const transport = this.config.transport;

        if (transport === 'iso-on-tcp') {
            switch (this.config.connmode) {
                case "rack-slot":
                    connOpts = {
                        host: this.config.address,
                        port: Number(this.config.port),
                        rack: Number(this.config.rack),
                        slot: Number(this.config.slot),
                        s7ConnOpts: s7ConnOpts
                    };
                    break;
                case "tsap":
                    if (!validateTSAP(this.config.localtsaphi) ||
                        !validateTSAP(this.config.localtsaplo) ||
                        !validateTSAP(this.config.remotetsaphi) ||
                        !validateTSAP(this.config.remotetsaplo)) {
                        throw new Error('Invalid TSAP configuration');
                    }

                    let localTSAP = parseInt(this.config.localtsaphi, 16) << 8;
                    localTSAP += parseInt(this.config.localtsaplo, 16);
                    let remoteTSAP = parseInt(this.config.remotetsaphi, 16) << 8;
                    remoteTSAP += parseInt(this.config.remotetsaplo, 16);

                    connOpts = {
                        host: this.config.address,
                        port: this.config.port,
                        srcTSAP: localTSAP,
                        dstTSAP: remoteTSAP,
                        s7ConnOpts: s7ConnOpts
                    };
                    break;
                default:
                    throw new Error(`Invalid connection mode: ${this.config.connmode}`);
            }
        } else {
            throw new Error(`Invalid transport: ${transport}`);
        }

        this.endpoint = new nodes7.S7Endpoint(connOpts);
        this.endpoint.on('connecting', () => this.manageStatus('connecting'));
        this.endpoint.on('connect', () => this.onConnect());
        this.endpoint.on('disconnect', () => this.onDisconnect());
        this.endpoint.on('error', (e) => this.onError(e));

        this.itemGroup = new nodes7.S7ItemGroup(this.endpoint);
        this.itemGroup.setTranslationCB(k => this._vars[k]);

        const varKeys = Object.keys(this._vars);
        if (!varKeys || !varKeys.length) {
            console.warn('No variables configured');
            return;
        } else {
            this.itemGroup.addItems(varKeys);
        }

        this.manageStatus('offline');
    }

    manageStatus(newStatus) {
        if (this.status === newStatus) return;
        this.status = newStatus;
        this.emit('status', { status: newStatus });
    }

    onConnect() {
        this.readInProgress = false;
        this.readDeferred = 0;
        this.connected = true;
        this.manageStatus('online');
        this.updateCycleTime(this.currentCycleTime);
        this.emit('connected');
    }

    onDisconnect() {
        this.manageStatus('offline');
        this.connected = false;
        this.emit('disconnected');
    }

    onError(error) {
        this.manageStatus('offline');
        this.emit('error', error);
    }

    cycleCallback(values) {
        this.readInProgress = false;

        if (this.readDeferred && this.connected) {
            this.doCycle();
            this.readDeferred = 0;
        }

        this.manageStatus('online');

        let changed = false;
        this.emit('data', values);
        
        Object.keys(values).forEach((key) => {
            if (!equals(this.oldValues[key], values[key])) {
                changed = true;
                this.emit('variable_changed', { key, value: values[key] });
                this.oldValues[key] = values[key];
            }
        });
        
        if (changed) {
            this.emit('data_changed', values);
        }
    }

    doCycle() {
        if (!this.readInProgress && this.connected) {
            this.itemGroup.readAllItems()
                .then((values) => this.cycleCallback(values))
                .catch((e) => {
                    this.emit('error', e);
                    this.readInProgress = false;
                });
            this.readInProgress = true;
        } else {
            this.readDeferred++;
        }
    }

    updateCycleTime(interval) {
        const time = parseInt(interval);

        if (isNaN(time) || time < 0) {
            throw new Error(`Invalid time interval: ${interval}`);
        }

        if (this._cycleTimer) {
            clearInterval(this._cycleTimer);
            this._cycleTimer = null;
        }

        // don't set a new timer if value is zero
        if (!time) return;

        if (time < this.MIN_CYCLE_TIME) {
            console.warn(`Cycle time too short, enforcing minimum of ${this.MIN_CYCLE_TIME} ms`);
            time = this.MIN_CYCLE_TIME;
        }

        this.currentCycleTime = time;
        this._cycleTimer = setInterval(() => this.doCycle(), time);
    }

    async writeVariable(name, value) {
        return new Promise((resolve, reject) => {
            if (!this._vars[name]) {
                reject(new Error(`Unknown variable: ${name}`));
                return;
            }

            this.itemGroup.writeItems(name, value)
                .then(() => resolve())
                .catch((e) => reject(e));
        });
    }

    async writeVariables(variables) {
        const promises = [];
        
        if (Array.isArray(variables)) {
            variables.forEach(({ name, value }) => {
                promises.push(this.writeVariable(name, value));
            });
        } else {
            Object.entries(variables).forEach(([name, value]) => {
                promises.push(this.writeVariable(name, value));
            });
        }

        return Promise.all(promises);
    }

    getStatus() {
        return this.status;
    }

    getVariables() {
        return this._vars;
    }

    async connect() {
        // Connection is handled automatically by the endpoint
        return new Promise((resolve, reject) => {
            if (this.connected) {
                resolve();
                return;
            }

            const onConnected = () => {
                this.removeListener('error', onError);
                resolve();
            };

            const onError = (error) => {
                this.removeListener('connected', onConnected);
                reject(error);
            };

            this.once('connected', onConnected);
            this.once('error', onError);
        });
    }

    async disconnect() {
        return new Promise((resolve) => {
            this.manageStatus('offline');
            this.connected = false;
            
            if (this._cycleTimer) {
                clearInterval(this._cycleTimer);
                this._cycleTimer = null;
            }

            if (this.endpoint) {
                this.endpoint.disconnect()
                    .then(() => resolve())
                    .catch(() => resolve()); // Resolve anyway
            } else {
                resolve();
            }
        });
    }
}

module.exports = S7Client;
