resource "aws_s3_bucket" "shots" {
  bucket = var.bucket_name
}

# Private: block every form of public access.
resource "aws_s3_bucket_public_access_block" "shots" {
  bucket                  = aws_s3_bucket.shots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "shots" {
  bucket = aws_s3_bucket.shots.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Expire rendered images; reviewers reach them via short-TTL presigned URLs
# (and GitHub's Camo proxy caches the bytes at comment-render time).
resource "aws_s3_bucket_lifecycle_configuration" "shots" {
  bucket = aws_s3_bucket.shots.id
  rule {
    id     = "expire-shots"
    status = "Enabled"
    filter {
      prefix = "burnmap/"
    }
    expiration {
      days = var.image_expiry_days
    }
  }
}
