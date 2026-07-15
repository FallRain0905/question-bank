const rootDir = __dirname

module.exports = {
  apps: [
    {
      name: 'question-bank',
      script: 'npm',
      args: 'start',
      cwd: rootDir,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        SYNAPSE_AGENT_WORKSPACE_DIR: '/srv/synap-agent'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    },
    {
      name: 'arxiv-cron',
      script: './node_modules/.bin/tsx',
      args: 'scripts/arxiv-cron.ts',
      cwd: rootDir,
      cron_restart: '0 9 * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'crawl-service',
      script: '.venv/bin/python',
      args: '-m uvicorn app:app --host 0.0.0.0 --port 8002',
      cwd: `${rootDir}/crawl-service`,
      env: {
        PYTHONUNBUFFERED: '1',
        CRAWL_ENABLE_BROWSER: '0',
        CRAWL_CONCURRENCY: '1',
        CRAWL_TIMEOUT_SECONDS: '20'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '700M'
    }
  ]
}
