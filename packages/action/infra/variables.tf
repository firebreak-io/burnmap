variable "region" {
  description = "AWS region for the burnmap bucket."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Globally-unique S3 bucket name for rendered plan images."
  type        = string
}

variable "github_repo" {
  description = "owner/repo allowed to assume the upload role via OIDC."
  type        = string
}

variable "image_expiry_days" {
  description = "Days after which rendered images are expired from the bucket."
  type        = number
  default     = 30
}
