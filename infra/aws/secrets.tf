# Two Secrets Manager secrets per environment, injected into the tasks by
# key (valueFrom "<arn>:<KEY>::"):
#
#   <name>/generated — written by Terraform: connection strings and every
#     random secret the boot guards demand. Nobody types these.
#   <name>/providers — the third-party credentials. Terraform creates it with
#     every key present and empty, then never touches the values again
#     (ignore_changes): fill them in the console. ECS refuses to start a task
#     whose secret lacks a referenced key, so every key must exist, even empty.
#
# Razorpay and Shiprocket keys are NOT here: they are saved, encrypted, in the
# dashboard (Settings → Integrations) under SETTINGS_ENCRYPTION_KEY.

resource "random_password" "app" {
  for_each = toset([
    "JWT_SECRET",
    "COOKIE_SECRET",
    "SIUMORA_TOKEN_SECRET",
    "AUTH_EVENT_SECRET",
    "SETTINGS_ENCRYPTION_KEY",
    "CLIENT_IP_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "COURIER_WEBHOOK_SECRET",
    "MESSAGING_WEBHOOK_SECRET",
  ])
  length  = 48
  special = false
}

locals {
  database_url = format(
    "postgresql://%s:%s@%s/%s",
    aws_db_instance.main.username,
    random_password.db.result,
    aws_db_instance.main.endpoint,
    aws_db_instance.main.db_name,
  )
  redis_url = format(
    "rediss://:%s@%s:6379",
    random_password.redis.result,
    aws_elasticache_replication_group.main.primary_endpoint_address,
  )

  generated_keys = concat(["MEDUSA_DATABASE_URL", "MEDUSA_REDIS_URL"], keys(random_password.app))

  provider_keys = [
    "TURNSTILE_SECRET_KEY",
    "SENTRY_DSN",
    "WHATSAPP_BSP_URL",
    "WHATSAPP_BSP_KEY",
    "WHATSAPP_TEXT_TEMPLATE",
    "WHATSAPP_OTP_TEMPLATE",
    "MSG91_AUTH_KEY",
    "MSG91_OTP_TEMPLATE_ID",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "GA4_MEASUREMENT_ID",
    "GA4_API_SECRET",
    "META_PIXEL_ID",
    "META_CAPI_TOKEN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ]
}

resource "aws_secretsmanager_secret" "generated" {
  name                    = "${local.name}/generated"
  description             = "Siumora ${var.environment}: connection strings and generated secrets (Terraform-owned)"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "generated" {
  secret_id = aws_secretsmanager_secret.generated.id
  secret_string = jsonencode(merge(
    {
      MEDUSA_DATABASE_URL = local.database_url
      MEDUSA_REDIS_URL    = local.redis_url
    },
    { for key, secret in random_password.app : key => secret.result },
  ))
}

resource "aws_secretsmanager_secret" "providers" {
  name                    = "${local.name}/providers"
  description             = "Siumora ${var.environment}: third-party credentials (fill in the console)"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "providers" {
  secret_id     = aws_secretsmanager_secret.providers.id
  secret_string = jsonencode({ for key in local.provider_keys : key => "" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
