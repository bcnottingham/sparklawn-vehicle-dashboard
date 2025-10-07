module.exports = {
  apps: [
    {
      name: 'sparklawn-fleet-tracker',
      script: 'dist/server.js',
      instances: 2, // Run 2 instances for redundancy
      exec_mode: 'cluster',
      
      // Auto-restart configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      
      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 8080
      },
      
      // Health monitoring
      health_check_endpoint: 'http://localhost:8080/health',
      health_check_grace_period: 3000,
      
      // Restart triggers
      watch: false, // Don't watch files in production
      ignore_watch: ['node_modules', 'logs'],
      
      // Cron restart (optional - restart daily at 3 AM)
      cron_restart: '0 3 * * *',
      
      // Process monitoring
      monitoring: false, // Set to true for PM2 Plus monitoring
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Error handling
      wait_ready: true,
      ready_event: 'server_ready'
    }
  ]
};