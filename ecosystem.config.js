module.exports = {
  apps: [
    {
      name: 'question-bank',
      script: 'npm',
      args: 'start',
      cwd: '/root/projects/question-bank',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
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
      cwd: '/root/projects/question-bank',
      cron_restart: '0 9 * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'crawl-service',
      script: '.venv/bin/python',
      args: '-m uvicorn app:app --host 0.0.0.0 --port 8002',
      cwd: '/root/projects/question-bank/crawl-service',
      env: {
        PYTHONUNBUFFERED: '1'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '700M'
    }
  ]
}
