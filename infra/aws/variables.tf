variable "environment" {
  description = "staging or production. Becomes APP_ENV in every container and the prefix of every resource."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "AWS region. Mumbai keeps shopper data in India and latency low."
  type        = string
  default     = "ap-south-1"
}

variable "api_domain" {
  description = "Public hostname of the Medusa API and dashboard, e.g. api.siumora.com."
  type        = string
}

variable "storefront_url" {
  description = "Public storefront origin, e.g. https://siumora.com. Used for CORS and emailed links."
  type        = string
}

variable "extra_store_origins" {
  description = "Further origins allowed to call the store API (e.g. https://www.siumora.com)."
  type        = list(string)
  default     = []
}

variable "admin_user_roles" {
  description = "Dashboard users' roles, email:role comma separated. Must include at least one email:owner (boot guard)."
  type        = string
}

variable "seller" {
  description = "Seller details printed on invoices. state_code must be 27 until the tax origin is configurable (boot guard). Leave gstin empty until it is issued."
  type = object({
    name       = string
    address    = string
    gstin      = string
    state_code = string
    email      = string
    phone      = string
  })
}

variable "image_tag" {
  description = "Image tag the services start on at creation. Deploys change it through the deploy workflow, not Terraform."
  type        = string
  default     = "bootstrap"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  description = "Standby in a second zone. On for production."
  type        = bool
  default     = false
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "redis_replicas" {
  description = "Replicas besides the primary. 1+ enables automatic failover (production)."
  type        = number
  default     = 0
}

variable "server_count" {
  description = "Medusa API tasks behind the load balancer."
  type        = number
  default     = 1
}

variable "server_cpu" {
  type    = number
  default = 1024
}

variable "server_memory" {
  type    = number
  default = 2048
}

variable "github_repository" {
  description = "owner/name allowed to deploy through GitHub OIDC."
  type        = string
  default     = "itsamiitt/siumora"
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider. Only the first environment applied in an account should create it."
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Where alarms are emailed (confirm the SNS subscription mail once). Empty: alarms fire with nobody subscribed."
  type        = string
  default     = ""
}

variable "images_domain" {
  description = "Custom hostname for product images, e.g. images.siumora.com. Empty keeps the *.cloudfront.net name."
  type        = string
  default     = ""
}
