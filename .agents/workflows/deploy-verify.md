---
description: 部署验证 — 部署变更并验证其正常工作
---
// turbo-all

# Deploy & Verify Workflow

Use this after implementing changes that need to be deployed and verified on a remote server.

## 1. Pre-Deploy Check
- Confirm all local tests pass
- Confirm `bun tsc --noEmit` has zero errors
- Verify the correct branch is checked out
- Check `git status` for uncommitted changes

## 2. Deploy
- Push changes to the target branch
- SSH into the target server
- Pull latest changes: `git pull`
- Install dependencies if needed (e.g. `bun install`, `npm install`, `pnpm install`)
- Restart the service via the project's process manager (e.g. `pm2 restart <app>`, `systemctl restart <service>`, `docker compose up -d --force-recreate`)

## 3. Smoke Test
- Verify health check endpoint responds: `curl http://localhost:<port>/health`
- Test 2-3 critical user flows manually or via curl
- Check logs for errors via the project's process manager (e.g. `pm2 logs <app>`, `journalctl -u <service>`, `docker compose logs <service>`)

## 4. Verify Evidence
Record concrete evidence of successful deployment:
- Health check response
- Key API endpoint responses
- Log output showing no errors

## 5. Rollback Plan
If verification fails:
- Revert to previous commit: `git revert HEAD`
- Restart the service
- Re-verify health

## Completion Checklist
- [ ] Local tests pass
- [ ] Changes pushed and deployed
- [ ] Health check responds correctly
- [ ] Critical user flows work
- [ ] No error logs
- [ ] Evidence recorded in response

## Notes
- Always have a rollback plan before deploying
- For database migrations, verify rollback script exists before forward migration
- Record `Rejected:` trailer in commits if a deployment approach was abandoned for a specific reason
