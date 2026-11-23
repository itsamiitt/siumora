terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in S3 with locking, one key per environment. Configured at
  # init time so the same code serves staging and production:
  #   terraform init -backend-config=env/production.backend.hcl
  # See README.md "Bootstrap" for creating the state bucket once.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "siumora"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
