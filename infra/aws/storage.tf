# Product images. Private bucket; the public reads through CloudFront with
# origin access control. Medusa writes with the task role
# (S3_AUTHENTICATION_METHOD=s3-iam-role), so no access keys exist.

resource "aws_s3_bucket" "images" {
  bucket_prefix = "${local.name}-images-"
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "images" {
  bucket = aws_s3_bucket.images.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_origin_access_control" "images" {
  name                              = "${local.name}-images"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

locals {
  custom_images = var.images_domain != ""
  images_url    = local.custom_images ? "https://${var.images_domain}" : "https://${aws_cloudfront_distribution.images.domain_name}"
}

resource "aws_acm_certificate" "images" {
  count             = local.custom_images ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.images_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "images" {
  count           = local.custom_images ? 1 : 0
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.images[0].arn
}

resource "aws_cloudfront_distribution" "images" {
  enabled         = true
  aliases         = local.custom_images ? [var.images_domain] : []
  comment         = "Siumora ${var.environment} product images"
  price_class     = "PriceClass_200" # includes India edge locations
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.images.bucket_regional_domain_name
    origin_id                = "images"
    origin_access_control_id = aws_cloudfront_origin_access_control.images.id
  }

  default_cache_behavior {
    target_origin_id       = "images"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # The *.cloudfront.net name until var.images_domain is set. Switching
  # later changes S3_FILE_URL for new uploads only; rows already uploaded
  # keep the cloudfront.net URL, which keeps working.
  viewer_certificate {
    cloudfront_default_certificate = local.custom_images ? null : true
    acm_certificate_arn            = local.custom_images ? aws_acm_certificate_validation.images[0].certificate_arn : null
    ssl_support_method             = local.custom_images ? "sni-only" : null
    minimum_protocol_version       = local.custom_images ? "TLSv1.2_2021" : null
  }
}

resource "aws_s3_bucket_policy" "images" {
  bucket = aws_s3_bucket.images.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontReads"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.images.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.images.arn } }
    }]
  })
}
