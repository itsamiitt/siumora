# ── Images ──────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "app" {
  for_each             = toset(["medusa", "worker"])
  name                 = "${local.name}-${each.key}"
  image_tag_mutability = "IMMUTABLE" # a SHA tag means one image, forever
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images: enough to roll back a month of deploys"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# ── Cluster, logs ───────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["medusa-server", "medusa-worker", "outbox-worker"])
  name              = "/siumora/${var.environment}/${each.key}"
  retention_in_days = var.environment == "production" ? 90 : 14
}

# ── Roles ───────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pulls images, writes logs, reads the two secrets.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.generated.arn, aws_secretsmanager_secret.providers.arn]
    }]
  })
}

# Task role: what the running code may do — Medusa writes product images.
resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "task_images" {
  name = "product-images"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.images.arn}/*"
    }]
  })
}

# ── Container environment ───────────────────────────────────────────────

locals {
  cors_origins = join(",", concat([var.storefront_url], var.extra_store_origins))
  api_origin   = "https://${var.api_domain}"

  medusa_environment = [
    { name = "APP_ENV", value = var.environment },
    { name = "MEDUSA_DATABASE_SSL", value = "verify" },
    { name = "STOREFRONT_URL", value = var.storefront_url },
    { name = "STORE_CORS", value = local.cors_origins },
    { name = "ADMIN_CORS", value = local.api_origin },
    { name = "AUTH_CORS", value = "${local.cors_origins},${local.api_origin}" },
    { name = "ADMIN_USER_ROLES", value = var.admin_user_roles },
    { name = "S3_FILE_URL", value = local.images_url },
    { name = "S3_BUCKET", value = aws_s3_bucket.images.bucket },
    { name = "S3_REGION", value = var.region },
    { name = "S3_AUTHENTICATION_METHOD", value = "s3-iam-role" },
    { name = "SELLER_NAME", value = var.seller.name },
    { name = "SELLER_ADDRESS", value = var.seller.address },
    { name = "SELLER_GSTIN", value = var.seller.gstin },
    { name = "SELLER_STATE_CODE", value = var.seller.state_code },
    { name = "SELLER_EMAIL", value = var.seller.email },
    { name = "SELLER_PHONE", value = var.seller.phone },
    { name = "SENTRY_ENVIRONMENT", value = var.environment },
  ]

  generated_secret_refs = [
    for key in local.generated_keys : { name = key, valueFrom = "${aws_secretsmanager_secret.generated.arn}:${key}::" }
  ]
  provider_secret_refs = [
    for key in local.provider_keys : { name = key, valueFrom = "${aws_secretsmanager_secret.providers.arn}:${key}::" }
  ]

  medusa_image = "${aws_ecr_repository.app["medusa"].repository_url}:${var.image_tag}"
  worker_image = "${aws_ecr_repository.app["worker"].repository_url}:${var.image_tag}"

  log_config = {
    for key, group in aws_cloudwatch_log_group.app : key => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = group.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = key
      }
    }
  }
}

# ── Task definitions ────────────────────────────────────────────────────
# The deploy workflow registers new revisions with a new image; Terraform
# owns the shape (env, secrets, sizes), the workflow owns the tag. The
# migration task is a one-off of medusa-server with the command overridden.

resource "aws_ecs_task_definition" "medusa_server" {
  family                   = "${local.name}-medusa-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name             = "medusa"
    image            = local.medusa_image
    essential        = true
    portMappings     = [{ containerPort = 9000, protocol = "tcp" }]
    environment      = concat(local.medusa_environment, [{ name = "MEDUSA_WORKER_MODE", value = "server" }])
    secrets          = concat(local.generated_secret_refs, local.provider_secret_refs)
    logConfiguration = local.log_config["medusa-server"]
    healthCheck = {
      command     = ["CMD-SHELL", "curl -fsS http://localhost:9000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 120
    }
  }])
}

resource "aws_ecs_task_definition" "medusa_worker" {
  family                   = "${local.name}-medusa-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name             = "medusa"
    image            = local.medusa_image
    essential        = true
    environment      = concat(local.medusa_environment, [{ name = "MEDUSA_WORKER_MODE", value = "worker" }])
    secrets          = concat(local.generated_secret_refs, local.provider_secret_refs)
    logConfiguration = local.log_config["medusa-worker"]
  }])
}

resource "aws_ecs_task_definition" "outbox_worker" {
  family                   = "${local.name}-outbox-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "worker"
    image     = local.worker_image
    essential = true
    environment = [
      { name = "APP_ENV", value = var.environment },
      { name = "OUTBOX_BACKEND", value = "medusa" },
      { name = "DATABASE_SSL", value = "true" },
      { name = "SENTRY_ENVIRONMENT", value = var.environment },
    ]
    secrets = concat(
      [{ name = "MEDUSA_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.generated.arn}:MEDUSA_DATABASE_URL::" }],
      local.provider_secret_refs,
    )
    logConfiguration = local.log_config["outbox-worker"]
  }])
}

# ── Load balancer ───────────────────────────────────────────────────────
# The certificate validates by DNS: the records come out as
# `certificate_validation_records`; add them at the DNS host (Cloudflare,
# DNS-only) and the apply finishes.

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
}

resource "aws_lb" "api" {
  name                       = local.name
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = module.vpc.public_subnets
  drop_invalid_header_fields = true
  idle_timeout               = 60
}

resource "aws_lb_target_group" "medusa" {
  name                 = "${local.name}-medusa"
  port                 = 9000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = module.vpc.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.medusa.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ── Services ────────────────────────────────────────────────────────────
# task_definition is ignored after creation: the deploy workflow moves it.

resource "aws_ecs_service" "medusa_server" {
  name                              = "medusa-server"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.medusa_server.arn
  desired_count                     = var.server_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 180
  enable_execute_command            = true

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.tasks.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.medusa.arn
    container_name   = "medusa"
    container_port   = 9000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "medusa_worker" {
  name            = "medusa-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.medusa_worker.arn
  # Exactly one: scheduled jobs (payment and GST recon) must not double-run.
  desired_count = 1
  launch_type   = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.tasks.id]
  }
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_ecs_service" "outbox_worker" {
  name            = "outbox-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.outbox_worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.tasks.id]
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
}
