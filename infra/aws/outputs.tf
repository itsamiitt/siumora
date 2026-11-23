output "api_load_balancer_dns" {
  description = "Point api_domain at this (CNAME, DNS-only at Cloudflare)."
  value       = aws_lb.api.dns_name
}

output "certificate_validation_records" {
  description = "Add these CNAMEs at the DNS host so the API certificate validates."
  value = [
    for option in aws_acm_certificate.api.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}

output "images_url" {
  description = "S3_FILE_URL: where product images are served from."
  value       = "https://${aws_cloudfront_distribution.images.domain_name}"
}

output "ecr_repositories" {
  value = { for key, repo in aws_ecr_repository.app : key => repo.repository_url }
}

output "deploy_role_arn" {
  description = "AWS_DEPLOY_ROLE_ARN for this environment's GitHub Environment."
  value       = aws_iam_role.deploy.arn
}

output "deploy_settings" {
  description = "The non-secret values the deploy workflow needs, as GitHub Environment variables."
  value = {
    AWS_REGION            = var.region
    ECS_CLUSTER           = aws_ecs_cluster.main.name
    ECR_MEDUSA            = aws_ecr_repository.app["medusa"].repository_url
    ECR_WORKER            = aws_ecr_repository.app["worker"].repository_url
    MIGRATION_SUBNETS     = join(",", module.vpc.private_subnets)
    MIGRATION_SECURITY_GP = aws_security_group.tasks.id
    TASK_FAMILY_SERVER    = aws_ecs_task_definition.medusa_server.family
    TASK_FAMILY_WORKER    = aws_ecs_task_definition.medusa_worker.family
    TASK_FAMILY_OUTBOX    = aws_ecs_task_definition.outbox_worker.family
    API_URL               = "https://${var.api_domain}"
  }
}

output "client_ip_secret" {
  description = "Set the storefront's CLIENT_IP_SECRET (Vercel) to this exact value."
  value       = random_password.app["CLIENT_IP_SECRET"].result
  sensitive   = true
}

output "secrets" {
  description = "Fill the providers secret in the console; the generated one is Terraform's."
  value = {
    generated = aws_secretsmanager_secret.generated.name
    providers = aws_secretsmanager_secret.providers.name
  }
}
