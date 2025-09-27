module.exports = {
    apps: [
        {
            name: 'multi-plc-manager',
            script: 'multi-plc-api-server.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'development',
                PORT: 3000,
                DEBUG: 'multi-plc:*'
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000,
                DEBUG: 'multi-plc:error'
            },
            // Logging configuration
            log_file: './logs/multi-plc-combined.log',
            out_file: './logs/multi-plc-out.log',
            error_file: './logs/multi-plc-error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            
            // Process management
            restart_delay: 4000,
            max_restarts: 10,
            min_uptime: '10s',
            
            // Advanced features
            kill_timeout: 5000,
            listen_timeout: 8000,
            
            // Node.js specific
            node_args: '--max-old-space-size=1024',
            
            // Monitoring
            pmx: true,
            
            // Custom configuration for multi-PLC system
            merge_logs: true,
            
            // Cron restart (optional - restart daily at 2 AM)
            cron_restart: '0 2 * * *',
            
            // Watch options (disabled by default for production)
            ignore_watch: [
                'node_modules',
                'logs',
                'Database',
                '*.log'
            ],
            
            // Custom environment variables for multi-PLC system
            env_vars: {
                MULTI_PLC_DB_SERVER: 'localhost\\SQLEXPRESS',
                MULTI_PLC_DB_NAME: 'IndolaktoWWTP',
                MULTI_PLC_MAX_CONNECTIONS: '10',
                MULTI_PLC_HEALTH_CHECK_INTERVAL: '60000',
                MULTI_PLC_AUTO_RECONNECT: 'true'
            }
        },
        
        // Optional: Separate process for data archival/cleanup
        {
            name: 'multi-plc-archiver',
            script: 'scripts/data-archiver.js',
            instances: 1,
            autorestart: true,
            watch: false,
            cron_restart: '0 1 * * *', // Daily at 1 AM
            env: {
                NODE_ENV: 'production',
                ARCHIVE_ENABLED: 'true',
                ARCHIVE_OLDER_THAN_DAYS: '90'
            },
            log_file: './logs/archiver-combined.log',
            out_file: './logs/archiver-out.log',
            error_file: './logs/archiver-error.log'
        }
    ],
    
    // PM2 deployment configuration
    deploy: {
        production: {
            user: 'administrator',
            host: 'production-server',
            ref: 'origin/main',
            repo: 'git@github.com:yourcompany/s7-multi-plc-client.git',
            path: '/var/www/multi-plc-system',
            'pre-deploy-local': '',
            'post-deploy': 'npm install && npm run db:setup-enhanced && pm2 reload ecosystem-multi-plc.config.js --env production',
            'pre-setup': ''
        },
        
        staging: {
            user: 'administrator',
            host: 'staging-server',
            ref: 'origin/develop',
            repo: 'git@github.com:yourcompany/s7-multi-plc-client.git',
            path: '/var/www/multi-plc-system-staging',
            'post-deploy': 'npm install && npm run db:setup-enhanced && pm2 reload ecosystem-multi-plc.config.js --env staging'
        }
    }
};