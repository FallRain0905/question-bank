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
      script: 'npx tsx scripts/arxiv-cron.ts',
      cwd: '/root/projects/question-bank',
      cron_restart: '0 9 * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
}
