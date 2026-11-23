# AWS infrastructure (Mumbai, ap-south-1)

Terraform for Siumora's backend on AWS (plan 18, decision D1: AWS Mumbai +
Vercel). One root module, applied once per environment — `staging` and
`production` — each with its own state, VPC, database and secrets.

## What it creates

| Piece | Resource | Notes |
|---|---|---|
| Network | VPC 10.40.0.0/16, 2 public + 2 private subnets, 1 NAT gateway | Tasks, Postgres and Redis are private |
| Postgres 16 | RDS, gp3, encrypted, PITR (3 days staging / 14 production) | Multi-AZ in production; TLS enforced and verified |
| Redis 7.1 | ElastiCache, TLS + auth token | Primary + replica with failover in production |
| Product images | private S3 bucket + CloudFront (origin access control) | Medusa writes with its task role — no keys |
| Images registry | ECR `siumora-<env>-medusa`, `-worker` | Immutable SHA tags, last 30 kept |
| Compute | ECS Fargate: `medusa-server` (behind the ALB), `medusa-worker` (exactly one: scheduled jobs), `outbox-worker` | Circuit breaker rolls back a failing deploy |
| Ingress | ALB, HTTPS only (HTTP → 301), ACM certificate for `api_domain` | |
| Secrets | Secrets Manager `siumora-<env>/generated` (Terraform) and `/providers` (you) | Injected into tasks by key |
| CI access | GitHub OIDC role trusted only by this repo's `<env>` GitHub Environment | No AWS keys in GitHub |
| Logs | CloudWatch `/siumora/<env>/*`, 14 / 90 days | |

Not here, by design: the storefront (Vercel), DNS (Cloudflare), and
Razorpay/Shiprocket credentials (saved encrypted in the Medusa dashboard,
Settings → Integrations).

## Bootstrap (once per AWS account)

Requires Terraform ≥ 1.10 and an admin AWS session (`aws sso login`).

```bash
aws s3api create-bucket --bucket siumora-terraform-state --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket siumora-terraform-state \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket siumora-terraform-state \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## Apply an environment

Edit `env/<env>.tfvars` first: `admin_user_roles` (real staff, at least one
`email:owner`) and, for production, the `seller` block.

```bash
cd infra/aws
terraform init -backend-config=env/staging.backend.hcl
terraform apply -var-file=env/staging.tfvars
```

The apply pauses on the API certificate until it validates:

1. `terraform output certificate_validation_records` → add each CNAME at
   Cloudflare (**DNS only**, not proxied). The apply then completes.
2. Point `api_domain` (e.g. `api-staging.siumora.com`) at
   `terraform output api_load_balancer_dns` (CNAME, DNS only).

The services start on the `bootstrap` image tag, which does not exist, so
their tasks fail until the first deploy. That is expected.

Production is applied the same way with `env/production.*`. It sets
`create_github_oidc_provider = false`, because the staging apply already
created the account-wide GitHub OIDC provider. Apply staging first.

## After the apply

1. **Provider secrets:** in the console, open the secret
   `terraform output -json secrets | jq -r .providers` and fill the keys that
   apply (Turnstile, Sentry, WhatsApp BSP, MSG91, Resend, GA4, Meta, Google).
   Leave unused ones empty. Medusa will not boot in production without
   `TURNSTILE_SECRET_KEY`.
2. **Webhook secrets** for the providers' dashboards are in the
   `generated` secret: `RAZORPAY_WEBHOOK_SECRET`, `COURIER_WEBHOOK_SECRET`,
   `MESSAGING_WEBHOOK_SECRET`.
3. **Storefront (Vercel):** set `CLIENT_IP_SECRET` to
   `terraform output -raw client_ip_secret`, `MEDUSA_URL` and
   `MEDUSA_ADMIN_URL` to `https://<api_domain>`, and `APP_ENV` to the
   environment. The rest of the storefront's env is in plan 18 §L2.4.
4. **GitHub Environment** `<env>` (Settings → Environments):
   - secret `AWS_DEPLOY_ROLE_ARN` = `terraform output -raw deploy_role_arn`
   - secret `VERCEL_TOKEN`
   - variables: every key of `terraform output deploy_settings`, plus
     `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and for staging `VERCEL_ALIAS`
   - production: add required reviewers.
5. Set the **repository** variable `AWS_DEPLOY_ENABLED=true`. From then on CI
   success on `main` deploys staging; production is Actions → Deploy → Run
   workflow → `production`.
6. First deploy, then seed the store once and create the owner
   (`docs/deploy-runbook.md`, "First deploy of an environment"), using
   `aws ecs execute-command` or a one-off `run-task` with a command override.

## Rough monthly cost (on-demand, ap-south-1)

Staging ≈ US$110–140: NAT gateway ~$35, ALB ~$20, RDS t4g.small ~$30, Redis
t4g.micro ~$12, Fargate ~$30, plus CloudWatch, Secrets Manager and data
transfer. Production with Multi-AZ RDS (t4g.medium), a Redis replica and two
API tasks ≈ US$300–380. Check the AWS pricing calculator before applying;
these are estimates.
