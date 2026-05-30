output "bucket_name" {
  description = "Bucket holding rendered plan images."
  value       = aws_s3_bucket.shots.id
}

output "uploader_role_arn" {
  description = "Role the GitHub Action assumes via OIDC to upload images."
  value       = aws_iam_role.uploader.arn
}
