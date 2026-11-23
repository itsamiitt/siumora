# AWS WAF in front of the API load balancer (plan 18 L2.7 — the API is on
# the ALB directly, so this replaces the Cloudflare rules the plan named).
#
# Most store traffic arrives from the storefront's servers (Vercel), so the
# source IP is Vercel's, shared by many shoppers. Limiting by source IP would
# throttle the storefront. The storefront forwards each shopper's IP in
# x-siumora-client-ip (HMAC-signed with CLIENT_IP_SECRET; Medusa's own limiter
# verifies it). The WAF therefore counts by that header when it is present
# and by source IP only for callers that do not send it (browsers on the
# dashboard, provider webhooks, anyone calling the API directly). These are
# coarse ceilings above Medusa's per-route limits (src/lib/rate-limit.ts),
# there to absorb floods before they reach a task.

locals {
  client_ip_header = "x-siumora-client-ip"

  # Routes where each hit costs money or is a guessing surface.
  sensitive_paths = ["/store/siumora-auth/", "/store/siumora/coupons", "/auth/"]
}

resource "aws_wafv2_web_acl" "api" {
  name  = "${local.name}-api"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-api"
    sampled_requests_enabled   = true
  }

  # ── Managed protections ──
  rule {
    name     = "aws-ip-reputation"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Product image uploads and the remittance CSV are larger than the
        # 8 KB body ceiling; counted, not blocked.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common"
      sampled_requests_enabled   = true
    }
  }

  # ── Sensitive routes, per shopper (signed header present) ──
  rule {
    name     = "sensitive-per-shopper"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 100 # per 5 minutes
        evaluation_window_sec = 300
        aggregate_key_type    = "CUSTOM_KEYS"
        custom_key {
          header {
            name = local.client_ip_header
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
        scope_down_statement {
          or_statement {
            dynamic "statement" {
              for_each = local.sensitive_paths
              content {
                byte_match_statement {
                  search_string         = statement.value
                  positional_constraint = "STARTS_WITH"
                  field_to_match {
                    uri_path {}
                  }
                  text_transformation {
                    priority = 0
                    type     = "LOWERCASE"
                  }
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "sensitive-per-shopper"
      sampled_requests_enabled   = true
    }
  }

  # ── Sensitive routes, direct callers (no signed header) ──
  rule {
    name     = "sensitive-direct"
    priority = 50
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 100 # per 5 minutes, per source IP
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        scope_down_statement {
          and_statement {
            statement {
              not_statement {
                statement {
                  size_constraint_statement {
                    comparison_operator = "GT"
                    size                = 0
                    field_to_match {
                      single_header {
                        name = local.client_ip_header
                      }
                    }
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
              }
            }
            statement {
              or_statement {
                dynamic "statement" {
                  for_each = local.sensitive_paths
                  content {
                    byte_match_statement {
                      search_string         = statement.value
                      positional_constraint = "STARTS_WITH"
                      field_to_match {
                        uri_path {}
                      }
                      text_transformation {
                        priority = 0
                        type     = "LOWERCASE"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "sensitive-direct"
      sampled_requests_enabled   = true
    }
  }

  # ── Everything else from a direct caller: a flood ceiling ──
  rule {
    name     = "direct-flood"
    priority = 60
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 3000 # per 5 minutes, per source IP (10/s)
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        scope_down_statement {
          not_statement {
            statement {
              size_constraint_statement {
                comparison_operator = "GT"
                size                = 0
                field_to_match {
                  single_header {
                    name = local.client_ip_header
                  }
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "direct-flood"
      sampled_requests_enabled   = true
    }
  }
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_lb.api.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}
