# ── Postgres ────────────────────────────────────────────────────────────
# RDS keeps automated backups with point-in-time recovery for
# backup_retention_period days (plan 18 L2.6). Postgres 16 enforces TLS
# (rds.force_ssl), which the containers verify with the RDS CA bundle baked
# into the images (MEDUSA_DATABASE_SSL=verify).

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "siumora_medusa"
  username = "siumora"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period    = var.environment == "production" ? 14 : 3
  backup_window              = "20:00-21:00" # 01:30–02:30 IST, before the GST recon
  maintenance_window         = "sun:21:30-sun:22:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name}-final" : null

  performance_insights_enabled = true
}

# ── Redis ───────────────────────────────────────────────────────────────
# Medusa's event bus, workflow engine, cache, locks and the rate-limit
# counters. In transit TLS + an auth token: the URL is rediss://.

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = local.name
  description          = "Siumora ${var.environment} Medusa Redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  port                 = 6379

  num_cache_clusters         = 1 + var.redis_replicas
  automatic_failover_enabled = var.redis_replicas > 0
  multi_az_enabled           = var.redis_replicas > 0

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result

  snapshot_retention_limit = var.environment == "production" ? 3 : 0
}
