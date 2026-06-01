output "bucket_name" {
  description = "Bucket holding rendered plan images."
  value       = aws_s3_bucket.shots.id
}

output "uploader_role_arn" {
  description = "Role the GitHub Action assumes via OIDC to upload images."
  value       = aws_iam_role.uploader.arn
}

output "presigner_access_key_id" {
  description = "Access key id for the burnmap-presigner user. Set as the consumer's presign-access-key-id (e.g. a GitHub Actions secret) for 7-day image URLs."
  value       = aws_iam_access_key.presigner.id
}

output "presigner_secret_access_key" {
  description = "Secret access key for the burnmap-presigner user. Store as a GitHub Actions secret (presign-secret-access-key)."
  value       = aws_iam_access_key.presigner.secret
  sensitive   = true
}
